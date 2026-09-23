/**
 * Mettre plusieurs pièces en corbeille d'un coup.
 *
 * Le geste est large : cinquante documents peuvent partir d'un clic. On
 * vérifie donc qu'il ne déborde pas — rien d'autre que les pièces demandées,
 * un identifiant inconnu qui n'emporte pas le lot, et la phase des marchés
 * touchés remise à jour.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let marche;
let typeOs;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.documentEtiquette.deleteMany();
  await db.suggestion.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.typeDocument.deleteMany();
  await viderBase();

  typeOs = await db.typeDocument.create({ data: { code: 'OS', nom: 'Ordre de service', pieceAttendue: true, ordreCycle: 1 } });
  marche = await db.marche.create({ data: { reference: '23C/2017/TGR', referenceNormalisee: '23/2017/TGR#C', phase: 'cours' } });
});

let empreinte = 0;
/** Une pièce du fonds, rattachée au marché sauf mention contraire. */
function piece(champs = {}) {
  empreinte += 1;
  return db.document.create({
    data: {
      titre: `Pièce ${empreinte}`,
      source: 'versement',
      marcheId: marche.id,
      sha256: String(empreinte).padStart(64, '0'),
      taille: BigInt(1024),
      ...champs,
    },
  });
}

/** Une session avec le droit de supprimer. */
async function sessionDirecteur() {
  const u = await creerUtilisateur('directeur');
  return en(app, await connecter(app, u.email));
}

describe('POST /api/documents/corbeille', () => {
  it('met les pièces demandées en corbeille, et elles seules', async () => {
    const a = await piece();
    const b = await piece();
    const epargnee = await piece();

    const requete = await sessionDirecteur();
    const reponse = await requete('POST', '/api/documents/corbeille', { ids: [a.id, b.id] });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().supprimes).toBe(2);

    const restantes = await db.document.findMany({ where: { supprimeLe: null } });
    expect(restantes.map((d) => d.id)).toEqual([epargnee.id]);
  });

  it('ignore un identifiant inconnu sans faire échouer le lot', async () => {
    const a = await piece();

    const requete = await sessionDirecteur();
    const reponse = await requete('POST', '/api/documents/corbeille', { ids: [a.id, 999_999] });

    // Un identifiant périmé — une liste rafraîchie entre-temps — ne doit pas
    // empêcher la suppression du reste.
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().supprimes).toBe(1);
  });

  it('ne compte pas deux fois une pièce déjà en corbeille', async () => {
    const dejaPartie = await piece({ supprimeLe: new Date() });

    const requete = await sessionDirecteur();
    const reponse = await requete('POST', '/api/documents/corbeille', { ids: [dejaPartie.id] });

    expect(reponse.json().supprimes).toBe(0);
  });

  it('recalcule la phase du marché touché', async () => {
    const os = await piece({ typeDocumentId: typeOs.id });
    expect((await db.marche.findUnique({ where: { id: marche.id } })).phase).toBe('cours');

    const requete = await sessionDirecteur();
    await requete('POST', '/api/documents/corbeille', { ids: [os.id] });

    // L'OS parti, le marché retombe en attente : la phase se déduit des
    // pièces présentes (§5).
    expect((await db.marche.findUnique({ where: { id: marche.id } })).phase).toBe('attente');
  });

  it('laisse une trace du lot dans le journal', async () => {
    const a = await piece();
    const b = await piece();

    const requete = await sessionDirecteur();
    await requete('POST', '/api/documents/corbeille', { ids: [a.id, b.id] });

    const trace = await db.journal.findFirst({ where: { action: 'document.corbeille_lot' } });
    expect(trace).not.toBeNull();
    // Le détail compte : c'est ce qu'on relira si le lot était malheureux.
    expect(trace.apres.ids).toEqual([a.id, b.id]);
  });

  it("ne supprime pas une pièce confidentielle qu'on n'a pas le droit de voir", async () => {
    // Le responsable documentaire voit jusqu'au « restreint », pas le
    // « confidentiel » (§8). Il peut supprimer — mais pas celle-là.
    const ordinaire = await piece();
    const secrete = await piece({ confidentialite: 'confidentiel', verseParId: null });

    const u = await creerUtilisateur('responsable_documentaire');
    const requete = en(app, await connecter(app, u.email));
    const reponse = await requete('POST', '/api/documents/corbeille', { ids: [ordinaire.id, secrete.id] });

    // Le lot passe, mais amputé de ce qui lui échappe.
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().supprimes).toBe(1);
    expect((await db.document.findUnique({ where: { id: secrete.id } })).supprimeLe).toBeNull();
    expect((await db.document.findUnique({ where: { id: ordinaire.id } })).supprimeLe).not.toBeNull();
  });

  it('laisse supprimer sa propre pièce même confidentielle', async () => {
    const u = await creerUtilisateur('responsable_documentaire');
    // Celui qui a versé la pièce la voit toujours (§8) : il peut la retirer.
    const sienne = await piece({ confidentialite: 'confidentiel', verseParId: u.id });

    const requete = en(app, await connecter(app, u.email));
    const reponse = await requete('POST', '/api/documents/corbeille', { ids: [sienne.id] });

    expect(reponse.json().supprimes).toBe(1);
  });

  it('refuse un lecteur', async () => {
    const a = await piece();
    const lecteur = await creerUtilisateur('lecteur');
    const requete = en(app, await connecter(app, lecteur.email));

    const reponse = await requete('POST', '/api/documents/corbeille', { ids: [a.id] });

    expect(reponse.statusCode).toBe(403);
    expect((await db.document.findUnique({ where: { id: a.id } })).supprimeLe).toBeNull();
  });

  it('refuse une liste vide', async () => {
    const requete = await sessionDirecteur();
    expect((await requete('POST', '/api/documents/corbeille', { ids: [] })).statusCode).toBe(422);
  });
});
