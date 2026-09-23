/**
 * Le classement appliqué au versement (§7).
 *
 * Il n'y a plus d'écran pour valider : ce que la machine écrit part
 * directement sur la pièce. On vérifie donc surtout ce qui la retient — un
 * rattachement fait à la main qu'elle ne doit pas contredire, et le doute
 * qui doit la faire renoncer plutôt que classer de travers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { chargerReferentiels, classerDocument, classerLeFonds } from '../src/services/classement-auto.js';
import { viderBase } from './outils.js';

let client;
let marche;
let typeOs;
let typeContrat;

beforeAll(async () => {
  await viderBase();
});
afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.typeDocument.deleteMany();
  await db.client.deleteMany();

  client = await db.client.create({
    data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR', synonymes: ['tresorerie generale'] },
  });
  marche = await db.marche.create({
    data: { reference: '23C/2017/TGR', referenceNormalisee: '23/2017/TGR#C', clientId: client.id },
  });
  typeOs = await db.typeDocument.create({ data: { code: 'OS', nom: 'Ordre de service', pieceAttendue: true, ordreCycle: 1 } });
  // Le texte d'essai parle surtout du marché : c'est « contrat de marché »
  // que la lecture retient, et non l'ordre de service.
  typeContrat = await db.typeDocument.create({ data: { code: 'CM', nom: 'Contrat de marché', ordreCycle: 0 } });
});

let empreinte = 0;
/** Une pièce versée, avec le texte que l'OCR en aurait tiré. */
function piece(texteOcr, champs = {}) {
  empreinte += 1;
  return db.document.create({
    data: {
      titre: `Pièce ${empreinte}`,
      source: 'versement',
      sha256: String(empreinte).padStart(64, '0'),
      taille: BigInt(1024),
      texteOcr,
      ...champs,
    },
  });
}

/** Un texte d'ordre de service citant le marché plusieurs fois. */
const TEXTE_OS = `
  ORDRE DE SERVICE
  Marché n° 23C/2017/TGR — Trésorerie Générale du Royaume
  Le présent ordre de service, relatif au marché 23C/2017/TGR, prescrit à
  l'entrepreneur de commencer les travaux. Le marché 23C/2017/TGR porte sur
  l'installation d'un système de vidéosurveillance.
`;

describe('classer au versement', () => {
  it('rattache la pièce à son marché, son client et son type', async () => {
    const doc = await piece(TEXTE_OS);
    const r = await classerDocument(doc, await chargerReferentiels());

    expect(r.classe).toBe(true);

    const relu = await db.document.findUnique({ where: { id: doc.id } });
    expect(relu.marcheId).toBe(marche.id);
    // Le client vient du marché : plus sûr que de le deviner du texte.
    expect(relu.clientId).toBe(client.id);
    expect(relu.typeDocumentId).toBe(typeContrat.id);
    expect(relu.statutClassement).toBe('classe');
  });

  it('ne contredit jamais un rattachement fait à la main', async () => {
    const autre = await db.marche.create({ data: { reference: '07/2019', referenceNormalisee: '07/2019' } });
    // La pièce parle du marché 23C/2017, mais quelqu'un l'a rattachée ailleurs.
    const doc = await piece(TEXTE_OS, { marcheId: autre.id });

    await classerDocument(doc, await chargerReferentiels());

    const relu = await db.document.findUnique({ where: { id: doc.id } });
    // Un jugement humain prime : la machine ne le défait pas.
    expect(relu.marcheId).toBe(autre.id);
  });

  it('remplit les cases vides sans toucher aux autres', async () => {
    const doc = await piece(TEXTE_OS, { typeDocumentId: typeOs.id });
    await classerDocument(doc, await chargerReferentiels());

    const relu = await db.document.findUnique({ where: { id: doc.id } });
    expect(relu.marcheId).toBe(marche.id);
    expect(relu.typeDocumentId).toBe(typeOs.id);
  });

  it('ne crée pas un marché absent du référentiel', async () => {
    // Une référence que le fonds ne connaît pas : un renvoi à un autre
    // dossier, ou une lecture fautive. On ne devine pas.
    const doc = await piece(`
      Marché n° 99Z/2099/INCONNU — le présent marché 99Z/2099/INCONNU porte
      sur des travaux. Le marché 99Z/2099/INCONNU est attribué ce jour.
    `);

    await classerDocument(doc, await chargerReferentiels());

    const relu = await db.document.findUnique({ where: { id: doc.id } });
    expect(relu.marcheId).toBeNull();
    expect(await db.marche.count()).toBe(1);
  });

  it('renonce quand une référence n’est citée qu’une fois', async () => {
    // Une seule mention peut n'être qu'un renvoi : mieux vaut laisser vide.
    const doc = await piece('Facture de maintenance. Voir aussi le marché 23C/2017/TGR pour le contexte.');

    await classerDocument(doc, await chargerReferentiels());

    const relu = await db.document.findUnique({ where: { id: doc.id } });
    expect(relu.marcheId).toBeNull();
  });

  it('laisse une pièce sans texte exploitable', async () => {
    const doc = await piece('Trop court.');
    const r = await classerDocument(doc, await chargerReferentiels());

    expect(r.classe).toBe(false);
    expect(r.motif).toBe('texte insuffisant');
  });

  it('recalcule la phase quand une pièce du cycle rejoint le marché', async () => {
    expect((await db.marche.findUnique({ where: { id: marche.id } })).phase).toBe('attente');

    // Une pièce déjà typée « ordre de service » : la phase doit suivre dès
    // que le classement la rattache au marché (§5).
    const doc = await piece(TEXTE_OS, { typeDocumentId: typeOs.id });
    await classerDocument(doc, await chargerReferentiels());

    expect((await db.marche.findUnique({ where: { id: marche.id } })).phase).toBe('cours');
  });
});

describe('classer le fonds entier', () => {
  it('rattrape les pièces que rien ne rattachait', async () => {
    await piece(TEXTE_OS);
    await piece(TEXTE_OS);
    // Déjà rattachée : elle n'a rien à gagner d'un passage.
    await piece(TEXTE_OS, { marcheId: marche.id, clientId: client.id, typeDocumentId: typeOs.id });

    const bilan = await classerLeFonds({ log: { log() {} } });

    expect(bilan.classes).toBe(2);
    expect(await db.document.count({ where: { marcheId: marche.id } })).toBe(3);
  });

  it('ignore les pièces en corbeille', async () => {
    await piece(TEXTE_OS, { supprimeLe: new Date() });
    const bilan = await classerLeFonds({ log: { log() {} } });
    expect(bilan.lus).toBe(0);
  });
});
