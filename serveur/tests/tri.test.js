/**
 * Créer une affaire, ranger une pièce à la main, et les deux files du tri.
 *
 * Le classement automatique écrit seul ce dont il est sûr ; ces écrans
 * servent à finir ce qu'il a laissé. On vérifie surtout ce qui protège le
 * fonds : un rangement fait à la main que la machine ne défait plus, et des
 * droits qui ne laissent ni créer ni ranger n'importe qui.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { classerLeFonds } from '../src/services/classement-auto.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let douanes;
let typeOs;
let typeAtt;

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

  douanes = await db.client.create({ data: { nom: 'Administration des Douanes et Impôts Indirects', sigle: 'ADII' } });
  typeOs = await db.typeDocument.create({ data: { code: 'OS', nom: 'Ordre de service', ordreCycle: 1, pieceAttendue: true } });
  typeAtt = await db.typeDocument.create({ data: { code: 'ATT', nom: 'Attestation de référence', ordreCycle: 5, pieceAttendue: true } });
});

let empreinte = 0;
function piece(champs = {}) {
  empreinte += 1;
  return db.document.create({
    data: { titre: `Pièce ${empreinte}`, source: 'versement', sha256: `tri${String(empreinte).padStart(61, '0')}`, taille: BigInt(1024), statutOcr: 'fait', ...champs },
  });
}

const connecte = async (role) => en(app, await connecter(app, (await creerUtilisateur(role)).email));

describe('créer une affaire à la main', () => {
  it('déclare un marché, avec sa clé de regroupement et une trace au journal', async () => {
    const requete = await connecte('chef_projet');
    const r = await requete('POST', '/api/marches', { reference: '13/2018', clientId: douanes.id, objet: 'Contrôle d’accès', objetTechnique: "Contrôle d'accès" });
    expect(r.statusCode).toBe(201);
    expect(r.json().client.id).toBe(douanes.id);

    const m = await db.marche.findUniqueOrThrow({ where: { id: r.json().id } });
    expect(m.referenceNormalisee).toBe('13/2018');
    expect(await db.journal.count({ where: { action: 'marche.cree', objetId: m.id } })).toBe(1);
  });

  it('sépare deux lots d’un même appel d’offres, comme l’import des archives', async () => {
    const requete = await connecte('chef_projet');
    expect((await requete('POST', '/api/marches', { reference: '47/2012', lot: '2' })).statusCode).toBe(201);
    expect((await requete('POST', '/api/marches', { reference: '47/2012', lot: '1' })).statusCode).toBe(201);
    const cles = (await db.marche.findMany({ orderBy: { referenceNormalisee: 'asc' } })).map((m) => m.referenceNormalisee);
    expect(cles).toEqual(['47/2012#1', '47/2012#2']);
  });

  it('ne double pas une affaire qui existe : il la désigne', async () => {
    const existant = await db.marche.create({ data: { reference: '13/2018', referenceNormalisee: '13/2018' } });
    const requete = await connecte('chef_projet');
    const r = await requete('POST', '/api/marches', { reference: ' 13/2018 ' });
    expect(r.statusCode).toBe(409);
    expect(r.json().existant.id).toBe(existant.id);
  });

  it('est refusée à un lecteur, et exige une référence', async () => {
    expect((await (await connecte('lecteur'))('POST', '/api/marches', { reference: '13/2018' })).statusCode).toBe(403);
    expect((await (await connecte('chef_projet'))('POST', '/api/marches', { objet: 'sans référence' })).statusCode).toBe(422);
  });
});

describe('ranger une pièce à la main', () => {
  it('rattache au marché, le client suit, la phase se recalcule', async () => {
    const m = await db.marche.create({ data: { reference: '13/2018', referenceNormalisee: '13/2018', clientId: douanes.id } });
    const os = await piece({ typeDocumentId: typeOs.id });

    const requete = await connecte('responsable_documentaire');
    const r = await requete('PATCH', `/api/documents/${os.id}`, { marcheId: m.id, titre: 'Ordre de service — marché 13/2018' });
    expect(r.statusCode).toBe(200);
    expect(r.json().marche.id).toBe(m.id);
    expect(r.json().client.id).toBe(douanes.id);
    expect(r.json().statutClassement).toBe('manuel');
    // L'OS ouvre l'exécution : la phase suit la pièce rangée.
    expect((await db.marche.findUniqueOrThrow({ where: { id: m.id } })).phase).toBe('cours');
    expect(await db.journal.count({ where: { action: 'document.modifie', objetId: os.id } })).toBe(1);
  });

  it('un rangement manuel n’est plus défait par le classement automatique', async () => {
    const m = await db.marche.create({ data: { reference: '13/2018', referenceNormalisee: '13/2018', clientId: douanes.id } });
    // Le texte cite le marché deux fois : sans la main, la machine le rattacherait.
    const d = await piece({ texteOcr: 'Marché n° 13/2018 relatif au contrôle d’accès. Le marché n° 13/2018 est reconductible. '.repeat(3) });

    const requete = await connecte('responsable_documentaire');
    expect((await requete('PATCH', `/api/documents/${d.id}`, { marcheId: null })).statusCode).toBe(200);

    await classerLeFonds({ log: { log() {}, error() {} } });
    const apres = await db.document.findUniqueOrThrow({ where: { id: d.id } });
    expect(apres.marcheId).toBeNull();
    expect(m.id).toBeGreaterThan(0);
  });

  it('refuse un lecteur, un marché inconnu, et un niveau que le rôle ne voit pas', async () => {
    const d = await piece();
    expect((await (await connecte('lecteur'))('PATCH', `/api/documents/${d.id}`, { titre: 'Autre titre' })).statusCode).toBe(403);

    const requete = await connecte('responsable_documentaire');
    const inconnu = await requete('PATCH', `/api/documents/${d.id}`, { marcheId: 999999 });
    expect(inconnu.statusCode).toBe(422);
    expect(inconnu.json().erreurs.marcheId).toBeTruthy();
    // Le responsable documentaire voit jusqu'à « Restreint » : il ne range pas en « Confidentiel ».
    expect((await requete('PATCH', `/api/documents/${d.id}`, { confidentialite: 'confidentiel' })).statusCode).toBe(422);
  });
});

describe('les files du tri', () => {
  it('« À classer » montre ce qui reste, avec les indices de la lecture', async () => {
    const m = await db.marche.create({ data: { reference: '13/2018', referenceNormalisee: '13/2018', clientId: douanes.id } });
    const lue = await piece({ texteOcr: 'Procès-verbal. Nous soussignés … le marché n° 13/2018 relatif à la maintenance du contrôle d’accès, Administration des Douanes. '.repeat(2) });
    await piece({ statutOcr: 'en_attente' }); // pas encore lue : elle attend l'OCR
    await piece({ statutClassement: 'manuel' }); // laissée vide exprès
    await piece({ marcheId: m.id, typeDocumentId: typeOs.id }); // déjà rangée
    await piece({ typeDocumentId: typeAtt.id }); // attestation orpheline : elle est dans « À vérifier »

    const r = await (await connecte('responsable_documentaire'))('GET', '/api/a-classer');
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(1);
    expect(r.json().enLecture).toBe(1);
    const [p] = r.json().pieces;
    expect(p.id).toBe(lue.id);
    expect(p.indices.reference.texte).toBe('13/2018');
    expect(p.indices.reference.marche.id).toBe(m.id);
  });

  it('« À vérifier » réunit lectures ratées, attestations orphelines et affaires sans client', async () => {
    const illisible = await piece({ statutOcr: 'illisible' });
    const orpheline = await piece({ typeDocumentId: typeAtt.id });
    await db.marche.create({ data: { reference: 'CONSULTATION_X', referenceNormalisee: 'CONSULTATION_X' } });

    const r = await (await connecte('directeur'))('GET', '/api/a-verifier');
    expect(r.statusCode).toBe(200);
    expect(r.json().lectures.map((d) => d.id)).toEqual([illisible.id]);
    expect(r.json().attestations.map((d) => d.id)).toEqual([orpheline.id]);
    expect(r.json().affairesSansClient.map((m) => m.reference)).toEqual(['CONSULTATION_X']);
  });

  it('« À vérifier » montre les doublons probables à trancher', async () => {
    const a = await piece();
    const b = await piece();
    await db.doublon.create({ data: { documentAId: a.id, documentBId: b.id, score: 91, raisons: { raisons: ['même objet'] } } });

    const r = await (await connecte('responsable_documentaire'))('GET', '/api/a-verifier');
    expect(r.json().doublons).toHaveLength(1);
    expect(r.json().doublons[0].score).toBe(91);
  });

  it('les files sont réservées à ceux qui tiennent la qualité du fonds', async () => {
    const chef = await connecte('chef_projet');
    expect((await chef('GET', '/api/a-classer')).statusCode).toBe(403);
    expect((await chef('GET', '/api/a-verifier')).statusCode).toBe(403);
  });

  it('une lecture ratée se relance ; un PDF qui porte son texte, non', async () => {
    const ratee = await piece({ statutOcr: 'echec' });
    const texte = await piece({ statutOcr: 'non_necessaire' });
    const requete = await connecte('responsable_documentaire');

    expect((await requete('POST', `/api/documents/${ratee.id}/relire`)).statusCode).toBe(200);
    expect((await db.document.findUniqueOrThrow({ where: { id: ratee.id } })).statutOcr).toBe('en_attente');
    expect((await requete('POST', `/api/documents/${ratee.id}/relire`)).statusCode).toBe(409);
    expect((await requete('POST', `/api/documents/${texte.id}/relire`)).statusCode).toBe(422);
  });
});
