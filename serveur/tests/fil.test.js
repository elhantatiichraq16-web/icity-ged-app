/**
 * Le fil d'activité d'une fiche (le « chatter » d'Odoo) : notes internes,
 * modifications lisibles, vie des pièces, mails.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { chiffrer } from '../src/securite/crypto.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let client;
let marche;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  // Pas de compte de messagerie laissé derrière : le worker tenterait de s'y
  // connecter s'il tournait sur la base de test.
  await db.mail.deleteMany();
  await db.compteMail.deleteMany({ where: { adresse: 'fil@exemple.invalid' } });
  await app.close();
});

beforeEach(async () => {
  await db.pieceJointeMail.deleteMany();
  await db.mail.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany();
  await viderBase();
  client = await db.client.create({ data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR' } });
  marche = await db.marche.create({ data: { reference: '31/2016', referenceNormalisee: '31/2016', clientId: client.id } });
});

describe('fil d’activité', () => {
  it('montre une note interne, signée, en tête du fil', async () => {
    const u = await creerUtilisateur('chef_projet');
    const requete = en(app, await connecter(app, u.email));

    const note = await requete('POST', `/api/fil/marche/${marche.id}/notes`, { texte: 'Le client attend le BL avant vendredi.' });
    expect(note.statusCode).toBe(201);

    const { elements } = (await requete('GET', `/api/fil/marche/${marche.id}`)).json();
    expect(elements[0]).toMatchObject({ genre: 'note', par: u.nom, texte: 'Le client attend le BL avant vendredi.' });
  });

  it('refuse une note vide', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await requete('POST', `/api/fil/marche/${marche.id}/notes`, { texte: '   ' })).statusCode).toBe(422);
  });

  it('dit en clair ce qui a changé, avec les noms plutôt que les numéros', async () => {
    const autre = await db.client.create({ data: { nom: 'Banque Atlas' } });
    const requete = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    await requete('PATCH', `/api/marches/${marche.id}`, { statutAffaire: 'Gagné', clientId: autre.id });

    const { elements } = (await requete('GET', `/api/fil/marche/${marche.id}`)).json();
    const suivi = elements.find((e) => e.genre === 'suivi');
    expect(suivi.texte).toBe('a modifié la fiche');
    expect(suivi.changements).toEqual(
      expect.arrayContaining([
        { champ: 'Statut', avant: '—', apres: 'Gagné' },
        { champ: 'Client', avant: 'Trésorerie Générale du Royaume', apres: 'Banque Atlas' },
      ]),
    );
  });

  it('raconte la vie des pièces du marché, sans les consultations ni les pièces cachées', async () => {
    const visible = await db.document.create({ data: { titre: 'PV de réception', marcheId: marche.id } });
    const cachee = await db.document.create({ data: { titre: 'Offre financière', marcheId: marche.id, confidentialite: 'confidentiel' } });
    for (const [d, action] of [
      [visible, 'document.verse'],
      [visible, 'document.telecharge'],
      [cachee, 'document.verse'],
    ]) {
      await db.journal.create({ data: { action, objetType: 'Document', objetId: d.id } });
    }

    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const { elements } = (await requete('GET', `/api/fil/marche/${marche.id}`)).json();
    expect(elements.map((e) => e.texte)).toEqual(['a versé « PV de réception »']);
  });

  it('montre les mails à qui peut les lire, pas aux autres', async () => {
    const compte = await db.compteMail.upsert({
      where: { adresse: 'fil@exemple.invalid' },
      update: {},
      create: { libelle: 'Essai', adresse: 'fil@exemple.invalid', serveur: 'imap.exemple.invalid', motDePasse: chiffrer('essai') },
    });
    await db.mail.create({
      data: { compteId: compte.id, messageId: '<1@tgr>', fil: 'f1', direction: 'recu', objet: 'Réception provisoire', expediteur: 'bo@tgr.gov.ma', date: new Date(), marcheId: marche.id, clientId: client.id },
    });

    const chef = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    expect((await chef('GET', `/api/fil/client/${client.id}`)).json().elements).toMatchObject([{ genre: 'mail', objet: 'Réception provisoire' }]);
    expect((await chef('GET', `/api/marches/${marche.id}`)).json().nbMails).toBe(1);

    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('GET', `/api/fil/client/${client.id}`)).json().elements).toEqual([]);
  });

  it('répond 404 pour une fiche qui n’existe pas', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await requete('GET', '/api/fil/marche/999999')).statusCode).toBe(404);
    expect((await requete('GET', `/api/fil/inconnu/${marche.id}`)).statusCode).toBe(404);
  });
});
