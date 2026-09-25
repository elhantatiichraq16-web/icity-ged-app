import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { detecterDoublons } from '../src/services/arbitrage-doublons.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let client;
let marche;
let etiquette;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.doublon.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany();
  await db.etiquette.deleteMany();
  await viderBase();
  client = await db.client.create({ data: { nom: 'SOMAPORT' } });
  marche = await db.marche.create({ data: { reference: '22/SGPTV/2017', referenceNormalisee: '22/SGPTV/2017', clientId: client.id } });
  etiquette = await db.etiquette.create({ data: { nom: 'Original papier', couleur: '#0E8296', famille: 'traitement' } });
});

/** Une attestation, assez longue pour que la comparaison ait un sens. */
const ATTESTATION = `Nous soussignés SOMAPORT, société anonyme sise à Casablanca, attestons par la
  présente que la société INTELIFEX SYSTEMS, inscrite au registre de commerce de Casablanca,
  assure dans le cadre du marché numéro 22/SGPTV/2017 les prestations de fourniture,
  installation et mise en service des équipements de vidéosurveillance, réalisées
  conformément aux règles de l'art durant la période couverte par ledit marché.`;

/** La même page, repassée sous le scanner : l'OCR a perdu un accent. */
const RESCAN = ATTESTATION.replace('conformément', 'conformement');

const piece = (champs) =>
  db.document.create({ data: { titre: 'Attestation SOMAPORT', texteOcr: ATTESTATION, statutOcr: 'fait', clientId: client.id, ...champs } });

describe('doublons réglés seuls', () => {
  it('écarte le second passage d’une même page, et reporte ce qu’il portait', async () => {
    const premier = await piece({ lotScan: '20260910132832435', pageScan: 18 });
    const second = await piece({ lotScan: '20260910135739507', pageScan: 18, texteOcr: RESCAN, marcheId: marche.id });
    await db.documentEtiquette.create({ data: { documentId: second.id, etiquetteId: etiquette.id } });

    const bilan = await detecterDoublons();
    expect(bilan.ecartees).toHaveLength(1);

    const [garde, ecarte] = await Promise.all([db.document.findUnique({ where: { id: premier.id } }), db.document.findUnique({ where: { id: second.id } })]);
    expect(ecarte.supprimeLe).not.toBeNull(); // en corbeille, récupérable
    expect(garde.supprimeLe).toBeNull();
    expect(garde.marcheId).toBe(marche.id); // le marché a suivi
    expect(await db.documentEtiquette.count({ where: { documentId: premier.id } })).toBe(1);
    expect((await db.doublon.findFirst()).decision).toBe('supprime_b');
    expect(await db.journal.count({ where: { action: 'doublon.ecarte_auto' } })).toBe(1);
  });

  it('garde le premier passage même s’il est entré après', async () => {
    const tardif = await piece({ lotScan: '20260910135739507', pageScan: 4 });
    const ancien = await piece({ lotScan: '20260910132832435', pageScan: 4, texteOcr: RESCAN });
    await detecterDoublons();
    expect((await db.document.findUnique({ where: { id: ancien.id } })).supprimeLe).toBeNull();
    expect((await db.document.findUnique({ where: { id: tardif.id } })).supprimeLe).not.toBeNull();
  });

  it('ne fait que signaler une paire qui n’a pas le même numéro de page', async () => {
    await piece({ lotScan: '20260910132832435', pageScan: 3 });
    await piece({ lotScan: '20260910135739507', pageScan: 9, texteOcr: RESCAN });
    const bilan = await detecterDoublons();
    expect(bilan.ecartees).toHaveLength(0);
    expect(bilan.aTrancher).toHaveLength(1);
    expect(await db.document.count({ where: { supprimeLe: { not: null } } })).toBe(0);
    expect((await db.doublon.findFirst()).decision).toBe('en_attente');
  });

  it('n’écrit rien en simulation', async () => {
    await piece({ lotScan: '20260910132832435', pageScan: 18 });
    await piece({ lotScan: '20260910135739507', pageScan: 18, texteOcr: RESCAN });
    const bilan = await detecterDoublons({ appliquer: false });
    expect(bilan.ecartees).toHaveLength(1);
    expect(await db.doublon.count()).toBe(0);
    expect(await db.document.count({ where: { supprimeLe: { not: null } } })).toBe(0);
  });

  it('ne rouvre jamais une paire déjà tranchée', async () => {
    const a = await piece({ lotScan: '20260910132832435', pageScan: 3 });
    const b = await piece({ lotScan: '20260910135739507', pageScan: 9, texteOcr: RESCAN });
    await db.doublon.create({ data: { documentAId: a.id, documentBId: b.id, score: 100, decision: 'gardes' } });
    const bilan = await detecterDoublons();
    expect(bilan.nouvelles + bilan.aTrancher.length + bilan.ecartees.length).toBe(0);
  });
});

describe('doublons tranchés à la main', () => {
  async function paireEnAttente() {
    const a = await piece({ lotScan: '20260910132832435', pageScan: 3, marcheId: marche.id });
    const b = await piece({ lotScan: '20260910135739507', pageScan: 9, texteOcr: RESCAN, marcheId: marche.id });
    await detecterDoublons();
    return { a, b, paire: await db.doublon.findFirstOrThrow() };
  }

  it('est signalé sur la page du document et dans la fiche du marché', async () => {
    const { a, b } = await paireEnAttente();
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));

    const document = (await requete('GET', `/api/documents/${a.id}`)).json();
    expect(document.doublons).toHaveLength(1);
    expect(document.doublons[0].autre.id).toBe(b.id);

    const fiche = (await requete('GET', `/api/marches/${marche.id}`)).json();
    expect(fiche.documents.find((d) => d.id === b.id).doublons[0].autre.id).toBe(a.id);
  });

  it('« Mettre à la corbeille » écarte l’une et garde l’autre', async () => {
    const { a, b, paire } = await paireEnAttente();
    const responsable = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));

    const r = await responsable('POST', `/api/doublons/${paire.id}/decision`, { decision: 'supprime', garderId: a.id });
    expect(r.statusCode).toBe(200);
    expect((await db.document.findUnique({ where: { id: b.id } })).supprimeLe).not.toBeNull();
    expect((await responsable('POST', `/api/doublons/${paire.id}/decision`, { decision: 'gardes' })).statusCode).toBe(409);
  });

  it('« Garder les deux » ferme la paire sans rien supprimer', async () => {
    const { paire } = await paireEnAttente();
    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    expect((await directeur('POST', `/api/doublons/${paire.id}/decision`, { decision: 'gardes' })).statusCode).toBe(200);
    expect((await db.doublon.findUnique({ where: { id: paire.id } })).decision).toBe('gardes');
    expect(await db.document.count({ where: { supprimeLe: { not: null } } })).toBe(0);
  });

  it('est réservé à ceux qui gèrent le fonds', async () => {
    const { paire } = await paireEnAttente();
    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('POST', `/api/doublons/${paire.id}/decision`, { decision: 'gardes' })).statusCode).toBe(403);
  });
});
