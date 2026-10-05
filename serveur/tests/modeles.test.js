/**
 * Les modèles de mails : les blancs se remplissent, la direction les gère,
 * chacun les utilise.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { remplirModele } from '@icity/commun/modeles';
import { db } from '../src/db.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await db.modeleMail.deleteMany({ where: { nom: { startsWith: 'Essai', mode: 'insensitive' } } });
  await viderBase();
});

describe('modèles de mails', () => {
  it('remplit les blancs connus, et laisse voir ceux qui manquent', () => {
    expect(remplirModele('Marché {marche} pour {client} : {montant}', { marche: '31/2016', client: 'TGR', montant: '' })).toBe('Marché 31/2016 pour TGR : {montant}');
  });

  it('les modèles de départ existent, filtrés par usage', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const fournisseur = (await requete('GET', '/api/modeles-mails?usage=fournisseur')).json().map((m) => m.nom);
    expect(fournisseur).toEqual(expect.arrayContaining(['Envoi du bon de commande', 'Relance de livraison']));
    expect(fournisseur).not.toContain('Demande de PV de réception');
  });

  it('la direction les gère, les autres non', async () => {
    const chef = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const corps = { nom: 'Essai relance', usage: 'client', objet: 'Relance {marche}', corps: 'Bonjour {client}' };
    expect((await chef('POST', '/api/modeles-mails', corps)).statusCode).toBe(403);
    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const r = await directeur('POST', '/api/modeles-mails', corps);
    expect(r.statusCode).toBe(201);
    expect((await directeur('POST', '/api/modeles-mails', { ...corps, nom: 'essai RELANCE' })).statusCode).toBe(409);
    expect((await directeur('DELETE', `/api/modeles-mails/${r.json().id}`)).statusCode).toBe(200);
  });
});
