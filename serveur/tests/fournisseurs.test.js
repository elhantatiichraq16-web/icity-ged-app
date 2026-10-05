/**
 * La fiche fournisseur à la Odoo : identité, contacts, fil, activités, et la
 * fusion des doublons (« MEDITEN / CYBIONET » dans « CYBIONET »).
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
  await db.activite.deleteMany();
  await db.ligneAchat.deleteMany();
  await db.commandeFournisseur.deleteMany();
  await db.fournisseur.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await viderBase();
  marche = await db.marche.create({ data: { reference: 'PROJET ESSAI', referenceNormalisee: 'PROJET ESSAI' } });
});

const achats = async () => en(app, await connecter(app, (await creerUtilisateur('achats')).email));

describe('fiche fournisseur', () => {
  it('se complète comme dans Odoo, avec ses contacts', async () => {
    const f = await db.fournisseur.create({ data: { nom: 'CYBIONET' } });
    const requete = await achats();

    const r = await requete('PATCH', `/api/fournisseurs/${f.id}`, { ice: '001234567000089', ville: 'Casablanca', synonymes: ['Cybionet SARL', 'Cybionet SARL'] });
    expect(r.statusCode).toBe(200);
    expect((await requete('PATCH', `/api/fournisseurs/${f.id}`, { ice: '123' })).json().erreurs.ice).toMatch(/15 chiffres/);

    await requete('POST', `/api/fournisseurs/${f.id}/contacts`, { nom: 'Youssef Idrissi', fonction: 'Commercial', mobile: '06 61 00 00 00' });
    const fiche = (await requete('GET', `/api/fournisseurs/${f.id}`)).json();
    expect(fiche).toMatchObject({ ice: '001234567000089', ville: 'Casablanca', synonymes: ['Cybionet SARL'], contacts: [{ nom: 'Youssef Idrissi', fonction: 'Commercial' }] });

    // Son fil dit ce qui s'est passé.
    const { elements } = (await requete('GET', `/api/fil/fournisseur/${f.id}`)).json();
    expect(elements.map((e) => e.texte)).toContain('a ajouté un contact : Youssef Idrissi');
  });

  it('reste aux achats et à la direction', async () => {
    const f = await db.fournisseur.create({ data: { nom: 'INGRAM' } });
    const chef = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    expect((await chef('GET', `/api/fournisseurs/${f.id}`)).statusCode).toBe(403);
    expect((await chef('GET', `/api/fil/fournisseur/${f.id}`)).statusCode).toBe(403);
    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    expect((await directeur('GET', `/api/fournisseurs/${f.id}`)).statusCode).toBe(200);
    expect((await directeur('POST', `/api/fournisseurs/${f.id}/contacts`, { nom: 'Essai' })).statusCode).toBe(403);
  });

  it('porte des activités, retrouvées dans « Mes activités »', async () => {
    const f = await db.fournisseur.create({ data: { nom: 'INGRAM' } });
    const u = await creerUtilisateur('achats');
    const requete = en(app, await connecter(app, u.email));
    const r = await requete('POST', '/api/activites', { type: 'appel', resume: 'Relancer pour la livraison', echeance: '2026-12-01', assigneId: u.id, fournisseurId: f.id });
    expect(r.statusCode).toBe(201);
    expect((await requete('GET', '/api/activites?miennes=1')).json()[0]).toMatchObject({ fournisseur: { nom: 'INGRAM' } });
  });
});

describe('fusion des doublons', () => {
  it('passe tout sur le fournisseur gardé, et son nom devient une autre écriture', async () => {
    const garde = await db.fournisseur.create({ data: { nom: 'CYBIONET' } });
    const doublon = await db.fournisseur.create({ data: { nom: 'MEDITEN / CYBIONET', telephone: '0522 00 00 00', notes: 'Passer par Meditèn pour le stock.' } });
    await db.ligneAchat.create({ data: { marcheId: marche.id, categorie: 'Réseau', designation: 'Switch', quantite: 2, fournisseurId: doublon.id } });
    await db.commandeFournisseur.create({ data: { marcheId: marche.id, fournisseurId: doublon.id, modalite: 'virement' } });
    const requete = await achats();

    const r = await requete('POST', `/api/fournisseurs/${doublon.id}/fusionner`, { versId: garde.id });
    expect(r.json()).toMatchObject({ lignes: 1, commandes: 1 });
    expect(await db.fournisseur.findUnique({ where: { id: doublon.id } })).toBeNull();
    const apres = await db.fournisseur.findUnique({ where: { id: garde.id } });
    expect(apres).toMatchObject({ synonymes: ['MEDITEN / CYBIONET'], telephone: '0522 00 00 00', notes: 'Passer par Meditèn pour le stock.' });
    expect(await db.ligneAchat.count({ where: { fournisseurId: garde.id } })).toBe(1);

    // Le prochain achat saisi au nom du doublon rejoint le fournisseur gardé.
    const ligne = await requete('POST', '/api/achats', { marcheId: marche.id, categorie: 'Réseau', designation: 'Câble', quantite: 1, fournisseur: 'meditèn / cybionet' });
    expect(ligne.statusCode).toBe(201);
    expect(await db.fournisseur.count()).toBe(1);
  });

  it('refuse de fusionner un fournisseur avec lui-même', async () => {
    const f = await db.fournisseur.create({ data: { nom: 'SMART' } });
    const requete = await achats();
    expect((await requete('POST', `/api/fournisseurs/${f.id}/fusionner`, { versId: f.id })).statusCode).toBe(422);
  });
});
