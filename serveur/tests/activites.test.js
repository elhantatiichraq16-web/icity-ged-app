/**
 * Les activités (rappels), sur le modèle d'Odoo : planifier sur une fiche,
 * retrouver dans « Mes activités », marquer fait, annuler.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jourCasablanca } from '@icity/commun/activites';
import { db } from '../src/db.js';
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
  await db.activite.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany();
  await viderBase();
  client = await db.client.create({ data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR' } });
  marche = await db.marche.create({ data: { reference: '31/2016', referenceNormalisee: '31/2016', clientId: client.id } });
});

/** Un jour, décalé de `n` jours par rapport à aujourd'hui (AAAA-MM-JJ). */
const dans = (n) => jourCasablanca(new Date(Date.now() + n * 86_400_000));

describe('activités', () => {
  it('se planifient sur un marché pour un collègue, et le fil le dit', async () => {
    const chef = await creerUtilisateur('chef_projet');
    const collegue = await creerUtilisateur('commercial_ao');
    const requete = en(app, await connecter(app, chef.email));

    const r = await requete('POST', '/api/activites', { type: 'appel', resume: 'Relancer pour le PV', echeance: dans(2), assigneId: collegue.id, marcheId: marche.id });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ typeNom: 'Appel', etat: 'avenir', assigne: { nom: collegue.nom }, marche: { reference: '31/2016' } });

    expect((await requete('GET', `/api/activites?marcheId=${marche.id}`)).json()).toHaveLength(1);
    const { elements } = (await requete('GET', `/api/fil/marche/${marche.id}`)).json();
    expect(elements[0]).toMatchObject({ texte: 'a planifié une activité', commentaire: expect.stringContaining('Appel : Relancer pour le PV') });
  });

  it('« Mes activités » : les miennes, de la plus urgente à la plus lointaine, avec leur état', async () => {
    const moi = await creerUtilisateur('chef_projet');
    const autre = await creerUtilisateur('chef_projet');
    for (const [resume, decalage, assigne] of [
      ['Plus tard', 5, moi],
      ['En retard', -2, moi],
      ['Aujourd’hui', 0, moi],
      ['Pas à moi', 0, autre],
    ]) {
      await db.activite.create({ data: { resume, echeance: new Date(`${dans(decalage)}T00:00:00Z`), assigneId: assigne.id, clientId: client.id } });
    }
    const requete = en(app, await connecter(app, moi.email));
    const miennes = (await requete('GET', '/api/activites?miennes=1')).json();
    expect(miennes.map((a) => [a.resume, a.etat])).toEqual([
      ['En retard', 'retard'],
      ['Aujourd’hui', 'aujourdhui'],
      ['Plus tard', 'avenir'],
    ]);
    // La cloche compte les retards et celles du jour.
    const { taches } = (await requete('GET', '/api/notifications')).json();
    expect(taches.find((t) => t.cle === 'activites').libelle).toMatch(/^2 activité/);
  });

  it('se marque faite avec un compte rendu, qui s’inscrit au fil', async () => {
    const moi = await creerUtilisateur('chef_projet');
    const a = await db.activite.create({ data: { type: 'appel', resume: 'Appeler l’ordonnateur', echeance: new Date(`${dans(0)}T00:00:00Z`), assigneId: moi.id, marcheId: marche.id } });
    const requete = en(app, await connecter(app, moi.email));

    const r = await requete('POST', `/api/activites/${a.id}/fait`, { compteRendu: 'Le PV part lundi.' });
    expect(r.json()).toMatchObject({ etat: 'faite', compteRendu: 'Le PV part lundi.' });
    expect((await requete('GET', `/api/activites?marcheId=${marche.id}`)).json()).toHaveLength(0);
    expect((await requete('POST', `/api/activites/${a.id}/fait`, {})).statusCode).toBe(409);

    const { elements } = (await requete('GET', `/api/fil/marche/${marche.id}`)).json();
    expect(elements[0]).toMatchObject({ texte: 'a fait une activité', commentaire: 'Appel : Appeler l’ordonnateur — Le PV part lundi.' });
  });

  it('ne se touche que par son auteur, la personne chargée, ou la direction', async () => {
    const auteur = await creerUtilisateur('chef_projet');
    const charge = await creerUtilisateur('commercial_ao');
    const a = await db.activite.create({ data: { resume: 'Récupérer la caution', echeance: new Date(`${dans(3)}T00:00:00Z`), assigneId: charge.id, creeParId: auteur.id, clientId: client.id } });

    const intrus = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    expect((await intrus('POST', `/api/activites/${a.id}/fait`, {})).statusCode).toBe(403);
    expect((await intrus('DELETE', `/api/activites/${a.id}`)).statusCode).toBe(403);

    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    expect((await directeur('DELETE', `/api/activites/${a.id}`)).statusCode).toBe(200);
    expect(await db.activite.count()).toBe(0);
  });

  it('un lecteur ne planifie pas ; une activité vise une seule fiche et un compte actif', async () => {
    const chef = await creerUtilisateur('chef_projet');
    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('POST', '/api/activites', { resume: 'Essai', echeance: dans(1), assigneId: chef.id, marcheId: marche.id })).statusCode).toBe(403);

    const requete = en(app, await connecter(app, chef.email));
    expect((await requete('POST', '/api/activites', { resume: 'Essai', echeance: dans(1), assigneId: chef.id })).statusCode).toBe(422);
    expect((await requete('POST', '/api/activites', { resume: 'Essai', echeance: dans(1), assigneId: chef.id, marcheId: marche.id, clientId: client.id })).statusCode).toBe(422);
    const inactif = await creerUtilisateur('chef_projet', { actif: false });
    const r = await requete('POST', '/api/activites', { resume: 'Essai', echeance: dans(1), assigneId: inactif.id, marcheId: marche.id });
    expect(r.json().erreurs.assigneId).toMatch(/compte actif/);
  });
});
