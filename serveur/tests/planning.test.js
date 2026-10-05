/**
 * Le planning d'un marché (le module Projet d'Odoo) : ses étapes, leurs dates
 * et leur avancement, au fil, au calendrier, selon les droits.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let marche;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.tacheMarche.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await viderBase();
  marche = await db.marche.create({ data: { reference: 'PROJET ESSAI', referenceNormalisee: 'PROJET ESSAI' } });
});

describe('planning d’un marché', () => {
  it('ajoute des étapes, rangées par date, et refuse une fin avant le début', async () => {
    const chef = await creerUtilisateur('chef_projet');
    const requete = en(app, await connecter(app, chef.email));
    await requete('POST', `/api/marches/${marche.id}/taches`, { titre: 'Formation', debut: '2026-12-01', fin: '2026-12-05' });
    const r = await requete('POST', `/api/marches/${marche.id}/taches`, { titre: 'Installation', debut: '2026-11-02', fin: '2026-11-20', responsableId: chef.id });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ titre: 'Installation', avancement: 0, responsable: { nom: chef.nom } });

    expect((await requete('GET', `/api/marches/${marche.id}/taches`)).json().map((t) => t.titre)).toEqual(['Installation', 'Formation']);
    const refus = await requete('POST', `/api/marches/${marche.id}/taches`, { titre: 'Erreur', debut: '2026-11-10', fin: '2026-11-01' });
    expect(refus.json().erreurs.fin).toMatch(/précéder le début/);
  });

  it('une étape terminée s’inscrit au fil ; les étapes en cours paraissent au calendrier', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const t = (await requete('POST', `/api/marches/${marche.id}/taches`, { titre: 'Installation', debut: '2026-11-02', fin: '2026-11-20' })).json();
    await requete('POST', `/api/marches/${marche.id}/taches`, { titre: 'Réception', debut: '2026-11-25', fin: '2026-11-26' });

    const cal = (await requete('GET', '/api/calendrier?debut=2026-11-01&fin=2026-11-30')).json().filter((e) => e.type === 'tache');
    expect(cal.map((e) => e.titre)).toEqual(['PROJET ESSAI : Installation', 'PROJET ESSAI : Réception']);

    await requete('PATCH', `/api/taches/${t.id}`, { titre: 'Installation', debut: '2026-11-02', fin: '2026-11-20', avancement: 100 });
    const { elements } = (await requete('GET', `/api/fil/marche/${marche.id}`)).json();
    expect(elements[0]).toMatchObject({ texte: 'a terminé une étape du planning', commentaire: 'Installation' });
    const apres = (await requete('GET', '/api/calendrier?debut=2026-11-01&fin=2026-11-30')).json().filter((e) => e.type === 'tache');
    expect(apres.map((e) => e.titre)).toEqual(['PROJET ESSAI : Réception']);
  });

  it('un lecteur consulte le planning sans le modifier', async () => {
    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('GET', `/api/marches/${marche.id}/taches`)).statusCode).toBe(200);
    expect((await lecteur('POST', `/api/marches/${marche.id}/taches`, { titre: 'Essai', debut: '2026-11-01', fin: '2026-11-02' })).statusCode).toBe(403);
  });
});
