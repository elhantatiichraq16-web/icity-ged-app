/**
 * L'archivage des marchés.
 *
 * Un marché archivé sort de la vue courante (liste, tableau de bord,
 * classement automatique) sans rien perdre : il se retrouve dans les
 * archives, se modifie comme avant, et se désarchive à tout moment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { rattacherAttestations } from '../src/services/attestations.js';
import { chargerReferentiels, classerDocument } from '../src/services/classement-auto.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let client;
let types;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany();
  await db.typeDocument.deleteMany();
  await viderBase();

  types = {};
  for (const [code, nom, ordre] of [
    ['OS', 'Ordre de service', 1],
    ['ATT', 'Attestation de référence', 5],
    ['CM', 'Contrat de marché', null],
  ]) {
    types[code] = await db.typeDocument.create({ data: { code, nom, ordreCycle: ordre, pieceAttendue: ordre !== null } });
  }
  client = await db.client.create({ data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR' } });
});

const creerMarche = (reference, champs = {}) =>
  db.marche.create({ data: { reference, referenceNormalisee: reference, clientId: client.id, ...champs } });

const archiverEnBase = (marche) => db.marche.update({ where: { id: marche.id }, data: { archiveLe: new Date() } });

async function directeur() {
  const u = await creerUtilisateur('directeur');
  return { u, requete: en(app, await connecter(app, u.email)) };
}

describe('archiver et désarchiver', () => {
  it('sort le marché de la liste, le garde dans les archives, puis le ramène', async () => {
    const ancien = await creerMarche('31/2016');
    await creerMarche('07/2026');
    const { u, requete } = await directeur();

    const archive = await requete('POST', '/api/marches/archiver', { ids: [ancien.id] });
    expect(archive.statusCode).toBe(200);
    expect(archive.json()).toEqual({ modifies: 1 });

    expect((await requete('GET', '/api/marches')).json().map((m) => m.reference)).toEqual(['07/2026']);
    const archives = (await requete('GET', '/api/marches?archives=seuls')).json();
    expect(archives.map((m) => m.reference)).toEqual(['31/2016']);
    expect(archives[0].archive.par).toBe(u.nom);
    expect((await requete('GET', '/api/marches?archives=tous')).json()).toHaveLength(2);

    // Le geste est tracé, marché par marché.
    expect(await db.journal.count({ where: { action: 'marche.archive', objetId: ancien.id } })).toBe(1);

    await requete('POST', '/api/marches/desarchiver', { ids: [ancien.id] });
    expect((await requete('GET', '/api/marches')).json()).toHaveLength(2);
    expect((await db.marche.findUnique({ where: { id: ancien.id } })).archiveParId).toBeNull();
  });

  it('ignore ce qui est déjà dans l’état demandé : la date d’archivage ne bouge pas', async () => {
    const m = await creerMarche('31/2016');
    const { requete } = await directeur();
    await requete('POST', '/api/marches/archiver', { ids: [m.id] });
    const premiere = (await db.marche.findUnique({ where: { id: m.id } })).archiveLe;

    expect((await requete('POST', '/api/marches/archiver', { ids: [m.id] })).json()).toEqual({ modifies: 0 });
    expect((await db.marche.findUnique({ where: { id: m.id } })).archiveLe).toEqual(premiere);
  });

  it('est réservé à l’administrateur et au directeur', async () => {
    const m = await creerMarche('31/2016');
    for (const role of ['chef_projet', 'responsable_documentaire', 'lecteur']) {
      const requete = en(app, await connecter(app, (await creerUtilisateur(role)).email));
      expect((await requete('POST', '/api/marches/archiver', { ids: [m.id] })).statusCode).toBe(403);
    }
    const admin = en(app, await connecter(app, (await creerUtilisateur('administrateur')).email));
    expect((await admin('POST', '/api/marches/archiver', { ids: [m.id] })).statusCode).toBe(200);
  });

  it('laisse tout le monde consulter les archives', async () => {
    await archiverEnBase(await creerMarche('31/2016'));
    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('GET', '/api/marches?archives=seuls')).json()).toHaveLength(1);
  });
});

describe('un marché archivé reste modifiable', () => {
  it('sa fiche s’ouvre et se modifie', async () => {
    const m = await archiverEnBase(await creerMarche('31/2016'));
    const requete = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));

    const fiche = await requete('GET', `/api/marches/${m.id}`);
    expect(fiche.statusCode).toBe(200);
    expect(fiche.json().archive).not.toBeNull();

    const modif = await requete('PATCH', `/api/marches/${m.id}`, { objet: 'Vidéosurveillance' });
    expect(modif.statusCode).toBe(200);
    expect(modif.json()).toMatchObject({ objet: 'Vidéosurveillance', archive: { par: null } });
  });

  it('on peut y ranger une pièce à la main', async () => {
    const m = await archiverEnBase(await creerMarche('31/2016'));
    const piece = await db.document.create({ data: { titre: 'Avenant', clientId: client.id } });
    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));

    const r = await requete('PATCH', `/api/documents/${piece.id}`, { marcheId: m.id });
    expect(r.statusCode).toBe(200);
    expect(r.json().marche).toMatchObject({ id: m.id, archive: true });
  });

  it('sa référence ne se recrée pas : on renvoie vers les archives', async () => {
    await archiverEnBase(await creerMarche('31/2016'));
    const requete = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const r = await requete('POST', '/api/marches', { reference: '31/2016' });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toMatch(/archives/);
  });
});

describe('hors de la vue courante', () => {
  it('ne compte plus au tableau de bord, ni ses pièces', async () => {
    const ancien = await archiverEnBase(await creerMarche('31/2016'));
    await db.document.create({ data: { titre: 'OS ancien', marcheId: ancien.id, typeDocumentId: types.OS.id } });
    const recent = await creerMarche('07/2026');
    await db.document.create({ data: { titre: 'OS récent', marcheId: recent.id, typeDocumentId: types.OS.id } });

    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const { tuiles } = (await requete('GET', '/api/tableau-bord')).json();
    expect(tuiles.marchesTotal).toBe(1);
    expect(tuiles.documents).toBe(1);
  });

  it('ses pièces quittent la liste des documents, sauf à les demander', async () => {
    const ancien = await archiverEnBase(await creerMarche('31/2016'));
    await db.document.create({ data: { titre: 'Pièce archivée', marcheId: ancien.id } });
    await db.document.create({ data: { titre: 'Pièce sans marché' } });

    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await requete('GET', '/api/documents')).json().documents.map((d) => d.titre)).toEqual(['Pièce sans marché']);
    expect((await requete('GET', '/api/documents?archives=tous')).json().total).toBe(2);
    // Depuis la fiche du marché, ses pièces restent visibles.
    expect((await requete('GET', `/api/documents?marcheId=${ancien.id}`)).json().total).toBe(1);
  });

  it('les clients ne comptent que leurs marchés en cours', async () => {
    // « Gagné » : sans pièce ni statut, une affaire compterait comme appel d'offres.
    await archiverEnBase(await creerMarche('31/2016', { statutAffaire: 'Gagné' }));
    await creerMarche('07/2026', { statutAffaire: 'Gagné' });
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const tgr = (await requete('GET', '/api/clients')).json().find((c) => c.id === client.id);
    expect(tgr.nbMarches).toBe(1);
    // Sa fiche, elle, montre tout, les archives en dernier.
    const fiche = (await requete('GET', `/api/clients/${client.id}`)).json();
    expect(fiche.marches.map((m) => m.reference)).toEqual(['07/2026', '31/2016']);
  });

  it('la recherche trouve toujours le marché archivé, et le signale', async () => {
    await archiverEnBase(await creerMarche('31/2016'));
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const { marches } = (await requete('GET', '/api/recherche?q=31/2016')).json();
    expect(marches).toMatchObject([{ reference: '31/2016', archive: true }]);
  });
});

describe('archiver des pièces', () => {
  it('sort une pièce hors marché de la liste, des files du tri et du tableau de bord', async () => {
    const a = await db.document.create({ data: { titre: 'Scan ancien', statutOcr: 'fait', texteOcr: 'rien de lisible' } });
    await db.document.create({ data: { titre: 'Scan récent', statutOcr: 'fait', texteOcr: 'rien de lisible' } });
    const { u, requete } = await directeur();

    expect((await requete('GET', '/api/a-classer')).json().total).toBe(2);
    const r = await requete('POST', '/api/documents/archiver', { ids: [a.id] });
    expect(r.json()).toEqual({ modifies: 1 });

    expect((await requete('GET', '/api/documents')).json().documents.map((d) => d.titre)).toEqual(['Scan récent']);
    expect((await requete('GET', '/api/a-classer')).json().total).toBe(1);
    expect((await requete('GET', '/api/tableau-bord')).json().tuiles.documents).toBe(1);

    const archivees = (await requete('GET', '/api/documents?archives=seuls')).json().documents;
    expect(archivees).toMatchObject([{ titre: 'Scan ancien', archive: { parSonMarche: false } }]);
    expect((await db.document.findUnique({ where: { id: a.id } })).archiveParId).toBe(u.id);
    expect(await db.journal.count({ where: { action: 'document.archive', objetId: a.id } })).toBe(1);

    await requete('POST', '/api/documents/desarchiver', { ids: [a.id] });
    expect((await requete('GET', '/api/a-classer')).json().total).toBe(2);
  });

  it('les pièces d’un marché archivé figurent aux archives, « avec leur marché »', async () => {
    const m = await archiverEnBase(await creerMarche('31/2016'));
    await db.document.create({ data: { titre: 'OS', marcheId: m.id } });
    const { requete } = await directeur();
    expect((await requete('GET', '/api/documents?archives=seuls')).json().documents).toMatchObject([{ titre: 'OS', archive: { parSonMarche: true } }]);
  });

  it('est réservé à l’administrateur et au directeur', async () => {
    const a = await db.document.create({ data: { titre: 'Scan' } });
    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    expect((await requete('POST', '/api/documents/archiver', { ids: [a.id] })).statusCode).toBe(403);
  });

  it('une pièce archivée reste modifiable, mais le classement automatique n’y touche plus', async () => {
    const m = await creerMarche('23C/2017/TGR', { referenceNormalisee: '23/2017/TGR#C' });
    const texte = 'Marché n° 23C/2017/TGR. Le marché 23C/2017/TGR, relatif au marché 23C/2017/TGR, porte sur la vidéosurveillance de la Trésorerie Générale du Royaume.';
    const a = await db.document.create({ data: { titre: 'OS', texteOcr: texte, statutOcr: 'fait', archiveLe: new Date() } });

    await classerDocument(await db.document.findUnique({ where: { id: a.id } }), await chargerReferentiels());
    expect((await db.document.findUnique({ where: { id: a.id } })).marcheId).toBeNull();

    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    const r = await requete('PATCH', `/api/documents/${a.id}`, { marcheId: m.id });
    expect(r.statusCode).toBe(200);
  });

  it('la recherche signale une pièce archivée', async () => {
    await db.document.create({ data: { titre: 'Caution', texteOcr: 'caution bancaire définitive restituée', statutOcr: 'fait', archiveLe: new Date() } });
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const { resultats } = (await requete('GET', '/api/recherche?q=caution')).json();
    expect(resultats).toMatchObject([{ titre: 'Caution', archive: true }]);
  });
});

describe('le classement automatique ne range rien dans les archives', () => {
  // Le texte et la référence des tests du classement (classement-auto.test.js).
  const TEXTE = `
    ORDRE DE SERVICE
    Marché n° 23C/2017/TGR — Trésorerie Générale du Royaume
    Le présent ordre de service, relatif au marché 23C/2017/TGR, prescrit à
    l'entrepreneur de commencer les travaux. Le marché 23C/2017/TGR porte sur
    l'installation d'un système de vidéosurveillance.
  `;
  const marcheCite = () => creerMarche('23C/2017/TGR', { referenceNormalisee: '23/2017/TGR#C' });

  it('une pièce qui cite un marché archivé reste à classer', async () => {
    await archiverEnBase(await marcheCite());
    const piece = await db.document.create({ data: { titre: 'OS', texteOcr: TEXTE, statutOcr: 'fait' } });

    await classerDocument(piece, await chargerReferentiels());
    expect((await db.document.findUnique({ where: { id: piece.id } })).marcheId).toBeNull();
  });

  it('la même pièce rejoint le marché s’il n’est pas archivé', async () => {
    const m = await marcheCite();
    const piece = await db.document.create({ data: { titre: 'OS', texteOcr: TEXTE, statutOcr: 'fait' } });

    await classerDocument(piece, await chargerReferentiels());
    expect((await db.document.findUnique({ where: { id: piece.id } })).marcheId).toBe(m.id);
  });

  it('une attestation d’un marché archivé ne le rejoint pas, et n’en déclare pas un second', async () => {
    await archiverEnBase(await creerMarche('82/2018'));
    const att = await db.document.create({
      data: {
        titre: 'Attestation',
        texteOcr: 'Nous attestons que la société a réalisé le marché n° 82/2018 relatif à la vidéosurveillance.',
        statutOcr: 'non_necessaire',
        typeDocumentId: types.ATT.id,
      },
    });

    const bilan = await rattacherAttestations();
    expect(bilan.archives).toHaveLength(1);
    expect(bilan.rattachees).toBe(0);
    expect(await db.marche.count()).toBe(1);
    expect((await db.document.findUnique({ where: { id: att.id } })).marcheId).toBeNull();
  });

  it('le tri signale la correspondance avec le marché archivé', async () => {
    const m = await archiverEnBase(await marcheCite());
    await db.document.create({ data: { titre: 'OS', texteOcr: TEXTE, statutOcr: 'fait', typeDocumentId: types.OS.id } });

    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    const { pieces } = (await requete('GET', '/api/a-classer')).json();
    expect(pieces[0].indices.reference.marche).toEqual({ id: m.id, reference: '23C/2017/TGR', archive: true });
  });
});

describe('le rappel des archives', () => {
  it('compte les marchés et les pièces archivés, selon ce qu’on peut voir', async () => {
    const m = await archiverEnBase(await creerMarche('31/2016'));
    await db.document.create({ data: { titre: 'OS', marcheId: m.id } });
    await db.document.create({ data: { titre: 'Scan', archiveLe: new Date() } });
    await db.document.create({ data: { titre: 'Secret', archiveLe: new Date(), confidentialite: 'confidentiel' } });
    await db.document.create({ data: { titre: 'En cours' } });

    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('GET', '/api/archives/resume')).json()).toEqual({ marches: 1, documents: 2 });
  });
});
