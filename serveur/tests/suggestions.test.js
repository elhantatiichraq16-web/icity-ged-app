import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { accepter, proposerPour, refuser } from '../src/services/suggestions.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let tgr;
let types;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.suggestion.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany();
  await db.etiquette.deleteMany();
  await db.typeDocument.deleteMany();
  await viderBase();

  tgr = await db.client.create({ data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR', synonymes: ['tresorerie generale'] } });
  await db.etiquette.create({ data: { nom: 'Contrat manquant', couleur: '#C2352F', famille: 'traitement' } });
  types = {
    ATT: await db.typeDocument.create({ data: { code: 'ATT', nom: 'Attestation de référence', ordreCycle: 5, pieceAttendue: true } }),
    OS: await db.typeDocument.create({ data: { code: 'OS', nom: 'Ordre de service', ordreCycle: 1, pieceAttendue: true } }),
  };
});

const referentiels = async () => ({
  clients: await db.client.findMany(),
  marches: await db.marche.findMany({ select: { id: true, reference: true, referenceNormalisee: true, lot: true } }),
  types: await db.typeDocument.findMany(),
});

const doc = (texte, champs = {}) =>
  db.document.create({ data: { titre: 'Pièce de test', texteOcr: texte, statutOcr: 'non_necessaire', ...champs } });

describe('propositions du classement', () => {
  it('rattache au bon lot : 23B ne va pas dans le lot A', async () => {
    const lotA = await db.marche.create({ data: { reference: '23A/2017/TGR', referenceNormalisee: '23/2017/TGR#A', lot: 'A', clientId: tgr.id } });
    const lotB = await db.marche.create({ data: { reference: '23B/2017/TGR', referenceNormalisee: '23/2017/TGR#B', lot: 'B', clientId: tgr.id } });

    const d = await doc('Marché n° 23B/2017/TGR — ordre de service n° 1 relatif au marché 23B/2017/TGR de la Trésorerie Générale du Royaume.');
    const { propositions } = proposerPour(d, await referentiels());
    const marche = propositions.find((p) => p.champ === 'marche');

    expect(marche.cibleId).toBe(lotB.id);
    expect(marche.cibleId).not.toBe(lotA.id);
  });

  it('propose de créer le marché quand la référence est inconnue', async () => {
    const d = await doc('ATTESTATION DE REFERENCE — nous attestons que les prestations du marché n° 82/2018 ont été réalisées.');
    const { propositions } = proposerPour(d, await referentiels());
    const marche = propositions.find((p) => p.champ === 'marche');
    expect(marche.cibleId).toBeNull();
    expect(marche.valeur).toBe('82/2018');
    expect(marche.raison).toMatch(/reste à créer/);
  });

  it('ne propose rien sur un champ verrouillé (corrigé à la main, §7)', async () => {
    await db.marche.create({ data: { reference: '31/2016', referenceNormalisee: '31/2016' } });
    const d = await doc('Le marché n° 31/2016 porte sur la vidéosurveillance.', { champsVerrouilles: ['marche', 'objet_technique'] });
    const champs = proposerPour(d, await referentiels()).propositions.map((p) => p.champ);
    expect(champs).not.toContain('marche');
    expect(champs).not.toContain('objet_technique');
  });

  it('ne propose pas ce que le document porte déjà', async () => {
    const m = await db.marche.create({ data: { reference: '31/2016', referenceNormalisee: '31/2016' } });
    const d = await doc('Le marché n° 31/2016, Trésorerie Générale du Royaume, ordre de service n° 2.', {
      marcheId: m.id,
      clientId: tgr.id,
      typeDocumentId: types.OS.id,
    });
    expect(proposerPour(d, await referentiels()).propositions).toHaveLength(0);
  });
});

describe('accepter et refuser', () => {
  it('accepter écrit la valeur, verrouille le champ et recalcule la phase', async () => {
    const m = await db.marche.create({ data: { reference: '31/2016', referenceNormalisee: '31/2016' } });
    const d = await doc('Ordre de service n° 1 du marché n° 31/2016.');
    const suggestion = await db.suggestion.create({
      data: { documentId: d.id, champ: 'type', valeur: 'Ordre de service', cibleId: types.OS.id, confiance: 85 },
    });
    await db.document.update({ where: { id: d.id }, data: { marcheId: m.id } });

    const u = await creerUtilisateur('responsable_documentaire');
    await accepter(suggestion, u.id);

    const apres = await db.document.findUnique({ where: { id: d.id } });
    expect(apres.typeDocumentId).toBe(types.OS.id);
    expect(apres.champsVerrouilles).toContain('type');
    // L'OS fait passer le marché « en exécution ».
    expect((await db.marche.findUnique({ where: { id: m.id } })).phase).toBe('cours');
  });

  it('accepter une référence inconnue crée le marché et signale le contrat manquant', async () => {
    const d = await doc('ATTESTATION — marché n° 82/2018.', { clientId: tgr.id });
    const suggestion = await db.suggestion.create({ data: { documentId: d.id, champ: 'marche', valeur: '82/2018', cibleId: null, confiance: 70 } });
    const u = await creerUtilisateur('responsable_documentaire');

    await accepter(suggestion, u.id);

    const marche = await db.marche.findFirst({ where: { reference: '82/2018' } });
    expect(marche).not.toBeNull();
    expect(marche.clientId).toBe(tgr.id);
    const etiquettes = await db.documentEtiquette.findMany({ where: { documentId: d.id }, include: { etiquette: true } });
    expect(etiquettes.map((e) => e.etiquette.nom)).toContain('Contrat manquant');
  });

  it('refuser verrouille aussi : c’est une décision, pas un oubli', async () => {
    const d = await doc('Texte quelconque du document.');
    const suggestion = await db.suggestion.create({ data: { documentId: d.id, champ: 'client', valeur: 'X', cibleId: tgr.id, confiance: 60 } });
    const u = await creerUtilisateur('responsable_documentaire');

    await refuser(suggestion, u.id);

    const apres = await db.document.findUnique({ where: { id: d.id } });
    expect(apres.clientId).toBeNull();
    expect(apres.champsVerrouilles).toContain('client');
    expect((await db.suggestion.findUnique({ where: { id: suggestion.id } })).statut).toBe('refusee');
  });
});

describe('API des suggestions', () => {
  it('liste les propositions en attente avec leurs compteurs', async () => {
    const d = await doc('Marché n° 31/2016 de la Trésorerie Générale du Royaume.');
    await db.suggestion.create({ data: { documentId: d.id, champ: 'client', valeur: 'TGR', cibleId: tgr.id, confiance: 80 } });

    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    const r = await requete('GET', '/api/suggestions');
    expect(r.statusCode).toBe(200);
    expect(r.json().suggestions).toHaveLength(1);
    expect(r.json().compteurs.client).toBe(1);
  });

  it('accepte en lot seulement les propositions sûres', async () => {
    const d1 = await doc('Document 1 avec du texte.');
    const d2 = await doc('Document 2 avec du texte.');
    await db.suggestion.create({ data: { documentId: d1.id, champ: 'client', valeur: 'TGR', cibleId: tgr.id, confiance: 90 } });
    await db.suggestion.create({ data: { documentId: d2.id, champ: 'client', valeur: 'TGR', cibleId: tgr.id, confiance: 50 } });

    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    const r = await requete('POST', '/api/suggestions/accepter-lot', { confianceMinimale: 80 });

    expect(r.json().acceptees).toBe(1);
    expect((await db.document.findUnique({ where: { id: d1.id } })).clientId).toBe(tgr.id);
    expect((await db.document.findUnique({ where: { id: d2.id } })).clientId).toBeNull();
  });

  it('refuse l’accès à un rôle qui ne corrige pas le classement', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await requete('GET', '/api/suggestions')).statusCode).toBe(403);
    expect((await requete('POST', '/api/suggestions/accepter-lot', {})).statusCode).toBe(403);
  });

  it('ne tranche pas deux fois la même proposition', async () => {
    const d = await doc('Document avec du texte.');
    const s = await db.suggestion.create({ data: { documentId: d.id, champ: 'client', valeur: 'TGR', cibleId: tgr.id, confiance: 90 } });
    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));

    expect((await requete('POST', `/api/suggestions/${s.id}/accepter`)).statusCode).toBe(200);
    expect((await requete('POST', `/api/suggestions/${s.id}/refuser`)).statusCode).toBe(409);
  });
});
