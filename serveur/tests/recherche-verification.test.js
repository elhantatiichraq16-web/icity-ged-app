import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { expressionBooleenne, extraits } from '../src/services/recherche.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let client;
let marche;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.doublon.deleteMany();
  await db.suggestion.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany();
  await db.etiquette.deleteMany();
  await db.typeDocument.deleteMany();
  await viderBase();

  client = await db.client.create({ data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR' } });
  marche = await db.marche.create({ data: { reference: '23C/2017/TGR', referenceNormalisee: '23/2017/TGR#C', lot: 'C', clientId: client.id } });
  await db.etiquette.create({ data: { nom: 'Contrat manquant', couleur: '#C2352F', famille: 'traitement' } });
});

const doc = (titre, texte, champs = {}) =>
  db.document.create({ data: { titre, texteOcr: texte, statutOcr: 'non_necessaire', clientId: client.id, ...champs } });

describe('expression de recherche', () => {
  it('exige tous les mots et garde les références entières', () => {
    // « & » exige les deux mots ; « :* » complète à droite, pour que la
    // recherche se resserre à mesure qu'on tape.
    expect(expressionBooleenne('caution bancaire')).toBe('caution:* & bancaire:*');
    // PostgreSQL reconnaît « 23C/2017/TGR » comme un seul élément : le
    // découper produirait trois mots qui n'existent pas dans l'index.
    expect(expressionBooleenne('23C/2017/TGR')).toBe("'23C/2017/TGR'");
    // « <-> » exige les mots dans cet ordre, l'un après l'autre.
    expect(expressionBooleenne('"réception provisoire"')).toBe('réception <-> provisoire');
  });

  it('ignore les mots trop courts et neutralise les caractères spéciaux', () => {
    // Le « + » que certains tapent par habitude cherche le mot.
    expect(expressionBooleenne('le pv de +réception')).toBe('réception:*');
    expect(expressionBooleenne('--')).toBe('');
    // Le tiret reste : il appartient aux références de marché.
    expect(expressionBooleenne('M23A-2017-TGR')).toBe('M23A-2017-TGR:*');
  });
});

describe('extraits surlignés', () => {
  it('rend un passage autour du mot, avec ses positions', () => {
    const [e] = extraits('Le présent marché porte sur la vidéosurveillance du siège.', ['videosurveillance']);
    expect(e.texte).toMatch(/vidéosurveillance/);
    expect(e.marques.length).toBeGreaterThan(0);
    const trouve = e.texte.slice(e.marques[0].debut, e.marques[0].fin);
    expect(trouve.toLowerCase()).toContain('vidéosurveillance');
  });

  it('ne rend rien quand le mot n’apparaît pas', () => {
    expect(extraits('Un texte quelconque', ['absent'])).toEqual([]);
  });
});

describe('API de recherche', () => {
  it('trouve un document par un mot de son texte, avec facettes', async () => {
    const type = await db.typeDocument.create({ data: { code: 'CM', nom: 'Contrat de marché' } });
    await doc('Marché signé', 'Le présent marché de vidéosurveillance porte sur les équipements du siège.', { marcheId: marche.id, typeDocumentId: type.id });
    await doc('Autre pièce', 'Facture de maintenance des équipements informatiques.');

    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const r = (await requete('GET', '/api/recherche?q=videosurveillance')).json();

    expect(r.total).toBe(1);
    expect(r.resultats[0].titre).toBe('Marché signé');
    expect(r.resultats[0].extraits.length).toBeGreaterThan(0);
    expect(r.facettes.types[0]).toMatchObject({ nom: 'Contrat de marché', n: 1 });
  });

  it('ne montre pas à un lecteur un document confidentiel', async () => {
    await doc('Pièce confidentielle', 'Un rapport confidentiel sur la vidéosurveillance du siège.', { confidentialite: 'confidentiel' });

    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));

    expect((await lecteur('GET', '/api/recherche?q=videosurveillance')).json().total).toBe(0);
    expect((await directeur('GET', '/api/recherche?q=videosurveillance')).json().total).toBe(1);
  });

  it('propose aussi les marchés dont la référence correspond', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const r = (await requete('GET', '/api/recherche?q=23C')).json();
    expect(r.marches.map((m) => m.reference)).toContain('23C/2017/TGR');
  });
});

describe('tableau de bord', () => {
  it('calcule les tuiles côté serveur', async () => {
    const os = await db.typeDocument.create({ data: { code: 'OS', nom: 'Ordre de service', ordreCycle: 1, pieceAttendue: true } });
    await doc('Ordre de service', 'Ordre de service du marché.', { marcheId: marche.id, typeDocumentId: os.id });
    await doc('Pièce sans marché', 'Une pièce non rattachée.');

    const requete = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const r = (await requete('GET', '/api/tableau-bord')).json();

    expect(r.tuiles.documents).toBe(2);
    expect(r.tuiles.rattaches).toBe(1);
    expect(r.tuiles.tauxRattachement).toBe(50);
    expect(r.tuiles.parPhase.cours).toBe(1);
    expect(r.graphiques.natureDesPieces.length).toBeGreaterThan(0);
  });
});

describe('la corbeille (§9)', () => {
  it('écarte une pièce sans la supprimer, et la restaure', async () => {
    const d = await doc('Pièce à écarter', 'Texte assez long pour exister dans la base de test.');
    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));

    expect((await requete('POST', `/api/documents/${d.id}/corbeille`)).statusCode).toBe(200);
    // Corbeille, pas suppression : la pièce existe toujours.
    expect((await db.document.findUnique({ where: { id: d.id } })).supprimeLe).not.toBeNull();

    const liste = (await requete('GET', '/api/corbeille')).json();
    expect(liste.documents.map((x) => x.id)).toContain(d.id);
    expect(liste.joursAvantVidage).toBe(30);

    expect((await requete('POST', `/api/documents/${d.id}/restaurer`)).statusCode).toBe(200);
    expect((await db.document.findUnique({ where: { id: d.id } })).supprimeLe).toBeNull();
  });

  it('refuse la corbeille à un lecteur', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await requete('GET', '/api/corbeille')).statusCode).toBe(403);
  });
});

describe('la cloche (§11)', () => {
  it('annonce ce qui travaille et ce qui attend', async () => {
    await doc('Scan muet', 'Texte assez long pour exister dans la base de test.', { statutOcr: 'en_attente' });

    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    const r = (await requete('GET', '/api/notifications')).json();

    expect(r.taches.map((t) => t.cle)).toContain('ocr_attente');
    expect(r.arrivees).toBeGreaterThan(0);
  });
});
