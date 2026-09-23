import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criticiteDe, transitionsPossibles, verifierTransition } from '@icity/commun/circuit';
import { droitsPour } from '@icity/commun/droits';
import { db } from '../src/db.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let type;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.documentVersion.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.typeDocument.deleteMany();
  await viderBase();
  type = await db.typeDocument.create({ data: { code: 'CM', nom: 'Contrat de marché' } });
});

const doc = (champs = {}) =>
  db.document.create({ data: { titre: 'Contrat', typeDocumentId: type.id, criticite: 'critique', ...champs } });

describe('règles du circuit (§8)', () => {
  it('ne laisse pas sauter d’étape', () => {
    expect(verifierTransition({ etatCircuit: 'brouillon' }, 'valider').ok).toBe(false);
    expect(verifierTransition({ etatCircuit: 'soumis_validation' }, 'valider').ok).toBe(true);
  });

  it('exige un commentaire pour renvoyer en correction', () => {
    const sans = verifierTransition({ etatCircuit: 'soumis_controle' }, 'renvoyer');
    expect(sans.ok).toBe(false);
    expect(sans.raison).toMatch(/corrigé/);
    expect(verifierTransition({ etatCircuit: 'soumis_controle' }, 'renvoyer', { commentaire: 'Date erronée' }).ok).toBe(true);
  });

  it('marque critiques les pièces qui engagent', () => {
    expect(criticiteDe('CM')).toBe('critique');
    expect(criticiteDe('PVD')).toBe('critique');
    expect(criticiteDe('ATT')).toBe('critique');
    expect(criticiteDe('COU')).toBe('courant');
  });

  it('n’offre à chaque rôle que ses transitions', () => {
    const sujet = { __caslSubjectType__: 'Document', confidentialite: 'interne', etatCircuit: 'soumis_controle', versePar: 7 };
    const chef = transitionsPossibles({ etatCircuit: 'soumis_controle' }, droitsPour({ id: 7, role: 'chef_projet' }), sujet).map((t) => t.cle);
    const resp = transitionsPossibles({ etatCircuit: 'soumis_controle' }, droitsPour({ id: 4, role: 'responsable_documentaire' }), sujet).map((t) => t.cle);
    expect(chef).not.toContain('controler');
    expect(resp).toContain('controler');
    expect(resp).toContain('renvoyer');
  });
});

describe('API du circuit', () => {
  it('fait passer un document du dépôt à l’officiel, en journalisant chaque étape', async () => {
    const chef = await creerUtilisateur('chef_projet');
    const d = await doc({ verseParId: chef.id, etatCircuit: 'brouillon' });

    const commeChef = en(app, await connecter(app, chef.email));
    const commeResp = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    const commeDir = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));

    expect((await commeChef('POST', `/api/documents/${d.id}/circuit`, { transition: 'soumettre' })).json().etat).toBe('soumis_controle');
    expect((await commeResp('POST', `/api/documents/${d.id}/circuit`, { transition: 'controler' })).json().etat).toBe('controle');
    expect((await commeResp('POST', `/api/documents/${d.id}/circuit`, { transition: 'soumettre_validation' })).json().etat).toBe('soumis_validation');
    expect((await commeDir('POST', `/api/documents/${d.id}/circuit`, { transition: 'valider' })).json().etat).toBe('valide');
    expect((await commeDir('POST', `/api/documents/${d.id}/circuit`, { transition: 'officialiser' })).json().etat).toBe('officiel');

    const traces = await db.journal.findMany({ where: { objetId: d.id, action: { startsWith: 'circuit.' } } });
    expect(traces).toHaveLength(5);
    expect(traces[0].avant).toEqual({ etat: 'brouillon' });
    expect(traces[0].apres).toEqual({ etat: 'soumis_controle' });
  });

  it('refuse à un chef de projet de valider son propre document', async () => {
    const chef = await creerUtilisateur('chef_projet');
    const d = await doc({ verseParId: chef.id, etatCircuit: 'soumis_validation' });
    const commeChef = en(app, await connecter(app, chef.email));
    const r = await commeChef('POST', `/api/documents/${d.id}/circuit`, { transition: 'valider' });
    expect(r.statusCode).toBe(403);
  });

  it('renvoyer en correction exige un motif, et le garde', async () => {
    const d = await doc({ etatCircuit: 'soumis_controle' });
    const resp = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));

    expect((await resp('POST', `/api/documents/${d.id}/circuit`, { transition: 'renvoyer' })).statusCode).toBe(422);

    const ok = await resp('POST', `/api/documents/${d.id}/circuit`, { transition: 'renvoyer', commentaire: 'Le montant ne correspond pas au contrat.' });
    expect(ok.json().etat).toBe('a_corriger');
    const trace = await db.journal.findFirst({ where: { objetId: d.id, action: 'circuit.renvoyer' } });
    expect(trace.commentaire).toMatch(/montant/);
  });

  it('signale qu’une pièce critique exige un contrôle humain', async () => {
    const d = await doc({ etatCircuit: 'brouillon' });
    const resp = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    const r = (await resp('GET', `/api/documents/${d.id}/circuit`)).json();
    expect(r.controleHumainObligatoire).toBe(true);
    expect(r.etatNom).toBe('Brouillon');
  });
});

describe('journal d’audit (§13)', () => {
  it('liste les actions, réservé au directeur et à l’administrateur', async () => {
    const d = await doc({ etatCircuit: 'soumis_controle' });
    const resp = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    await resp('POST', `/api/documents/${d.id}/circuit`, { transition: 'controler' });

    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const r = (await directeur('GET', '/api/journal')).json();
    expect(r.total).toBeGreaterThan(0);
    expect(r.lignes[0]).toHaveProperty('par.nom');

    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('GET', '/api/journal')).statusCode).toBe(403);
  });

  it('filtre par action', async () => {
    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const r = (await directeur('GET', '/api/journal?action=connexion')).json();
    expect(r.lignes.every((l) => l.action.startsWith('connexion'))).toBe(true);
  });
});
