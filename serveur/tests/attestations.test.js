import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { rattacherAttestations } from '../src/services/attestations.js';
import { chargerReferentiels, classerDocument } from '../src/services/classement-auto.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let adii;
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
    ['MLV', 'Mainlevée de caution', 6],
    ['CM', 'Contrat de marché', null],
    ['DAO', "Dossier d'appel d'offres", null],
  ]) {
    types[code] = await db.typeDocument.create({ data: { code, nom, ordreCycle: ordre, pieceAttendue: ordre !== null } });
  }
  adii = await db.client.create({ data: { nom: 'Administration des Douanes et Impôts Indirects', sigle: 'ADII' } });
});

const attestation = (texte, champs = {}) =>
  db.document.create({ data: { titre: 'Attestation', texteOcr: texte, statutOcr: 'non_necessaire', typeDocumentId: types.ATT.id, clientId: adii.id, ...champs } });

const TEXTE_82 = 'Nous attestons que la société a réalisé le marché n° 82/2018 relatif à la vidéosurveillance, à notre entière satisfaction.';

describe('attestations de référence', () => {
  it('déclare le marché cité, gagné et clôturé, et y range les attestations', async () => {
    const a1 = await attestation(TEXTE_82);
    const a2 = await attestation(TEXTE_82);

    const bilan = await rattacherAttestations();
    expect(bilan).toMatchObject({ rattachees: 2, illisibles: 0 });
    expect(bilan.declares).toHaveLength(1);

    const marche = await db.marche.findFirstOrThrow({ where: { reference: '82/2018' } });
    expect(marche).toMatchObject({ statutAffaire: 'Gagné', phase: 'cloture', clientId: adii.id });
    const ranges = await db.document.findMany({ where: { id: { in: [a1.id, a2.id] } } });
    expect(ranges.every((d) => d.marcheId === marche.id)).toBe(true);
  });

  it('rejoint un marché déjà connu au lieu d’en créer un second', async () => {
    const existant = await db.marche.create({ data: { reference: '23C/2017/TGR', referenceNormalisee: '23/2017/TGR#C', lot: 'C' } });
    await attestation('Attestation de référence. Marché N° 23C/2017/TGR, lot C.');

    const bilan = await rattacherAttestations();
    expect(bilan.declares).toHaveLength(0);
    expect(bilan.rejoints).toHaveLength(1);
    expect(await db.marche.count()).toBe(1);
    expect((await db.marche.findUnique({ where: { id: existant.id } })).phase).toBe('cloture');
  });

  it('ne prend pas le dernier chiffre d’un numéro pour un lot', async () => {
    await attestation('Nous attestons avoir confié à la société un bon de commande (BC N° 027/NDR/16 du 29/12/2016) relatif à la vidéosurveillance.');
    await rattacherAttestations();
    const marche = await db.marche.findFirstOrThrow({ where: { reference: '027/NDR/16' } });
    expect(marche.lot).toBeNull();
    expect(marche.referenceNormalisee).not.toContain('#');
  });

  it('met à part une attestation dont le numéro ne se lit pas', async () => {
    const a = await attestation('Travaux réalisés à notre entière satisfaction.');
    const bilan = await rattacherAttestations();
    expect(bilan).toMatchObject({ rattachees: 0, illisibles: 1 });
    expect((await db.document.findUnique({ where: { id: a.id } })).marcheId).toBeNull();
    expect(await db.marche.count()).toBe(0);
  });

  it('n’écrit rien en simulation', async () => {
    await attestation(TEXTE_82);
    const bilan = await rattacherAttestations({ appliquer: false });
    expect(bilan.declares).toHaveLength(1);
    expect(await db.marche.count()).toBe(0);
  });

  it('s’applique au classement : une attestation versée déclare son marché', async () => {
    const a = await attestation(TEXTE_82);
    const resultat = await classerDocument(a, await chargerReferentiels());
    expect(resultat.classe).toBe(true);
    expect((await db.document.findUnique({ where: { id: a.id } })).marcheId).not.toBeNull();
  });
});

describe('appels d’offres', () => {
  it('sépare un dossier d’appel d’offres d’un marché gagné, et l’exclut des compteurs', async () => {
    const ao = await db.marche.create({ data: { reference: '639/2022', referenceNormalisee: '639/2022', clientId: adii.id } });
    await db.document.create({ data: { titre: 'DAO', marcheId: ao.id, typeDocumentId: types.DAO.id } });
    const gagne = await db.marche.create({ data: { reference: '31/2016', referenceNormalisee: '31/2016', clientId: adii.id } });
    await db.document.create({ data: { titre: 'Contrat', marcheId: gagne.id, typeDocumentId: types.CM.id } });

    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const tous = (await requete('GET', '/api/marches')).json();
    expect(tous.find((m) => m.id === ao.id)).toMatchObject({ appelOffres: true, manquantes: [] });
    expect(tous.find((m) => m.id === gagne.id).appelOffres).toBe(false);

    expect((await requete('GET', '/api/marches?nature=ao')).json().map((m) => m.reference)).toEqual(['639/2022']);
    expect((await requete('GET', '/api/marches?nature=marches')).json().map((m) => m.reference)).toEqual(['31/2016']);

    const tableau = (await requete('GET', '/api/tableau-bord')).json();
    expect(tableau.tuiles).toMatchObject({ marchesTotal: 1, appelsOffres: 1 });

    const client = (await requete('GET', '/api/clients')).json().find((c) => c.id === adii.id);
    expect(client).toMatchObject({ nbMarches: 1, nbAppelsOffres: 1 });
  });

  it('suit le statut choisi à la main : « Gagné » en fait un marché', async () => {
    const ao = await db.marche.create({ data: { reference: '639/2022', referenceNormalisee: '639/2022' } });
    await db.document.create({ data: { titre: 'DAO', marcheId: ao.id, typeDocumentId: types.DAO.id } });

    const chef = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const r = await chef('PATCH', `/api/marches/${ao.id}`, { statutAffaire: 'Gagné' });
    expect(r.statusCode).toBe(200);
    expect(r.json().appelOffres).toBe(false);
  });
});
