/**
 * Abonnés et mentions, sur le modèle d'Odoo : suivre une fiche, être
 * mentionné dans une note, et le retrouver dans la cloche.
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
  await db.notification.deleteMany();
  await db.abonnement.deleteMany();
  await db.activite.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.commandeFournisseur.deleteMany();
  await db.fournisseur.deleteMany();
  await db.marche.deleteMany();
  await viderBase();
  marche = await db.marche.create({ data: { reference: '31/2016', referenceNormalisee: '31/2016' } });
});

const messages = async (requete) => (await requete('GET', '/api/notifications')).json();

describe('suivre une fiche', () => {
  it('prévient les abonnés de ce que font les autres, pas de leurs propres gestes', async () => {
    const suiveur = await creerUtilisateur('chef_projet');
    const auteur = await creerUtilisateur('directeur');
    const s = en(app, await connecter(app, suiveur.email));
    const a = en(app, await connecter(app, auteur.email));

    expect((await s('POST', `/api/fil/marche/${marche.id}/abonnement`, { suivre: true })).json()).toEqual({ abonne: true });
    expect((await s('GET', `/api/fil/marche/${marche.id}`)).json()).toMatchObject({ abonne: true, abonnes: [{ nom: suiveur.nom }] });

    await a('PATCH', `/api/marches/${marche.id}`, { statutAffaire: 'Gagné' });
    await s('PATCH', `/api/marches/${marche.id}`, { objet: 'Supervision' });

    const m = await messages(s);
    expect(m.nonLues).toBe(1);
    expect(m.messages[0]).toMatchObject({ genre: 'suivi', texte: `${auteur.nom} a modifié la fiche — 31/2016`, lien: `/marches/${marche.id}`, lue: false });

    await s('POST', '/api/notifications/lues', {});
    expect((await messages(s)).nonLues).toBe(0);

    // Ne plus suivre : plus rien.
    await s('POST', `/api/fil/marche/${marche.id}/abonnement`, { suivre: false });
    await a('PATCH', `/api/marches/${marche.id}`, { ville: 'Rabat' });
    expect((await messages(s)).nonLues).toBe(0);
  });

  it('une pièce versée sur le marché prévient ses abonnés', async () => {
    const suiveur = await creerUtilisateur('chef_projet');
    await db.abonnement.create({ data: { utilisateurId: suiveur.id, objetType: 'Marche', objetId: marche.id } });
    const piece = await db.document.create({ data: { titre: 'PV de réception', marcheId: marche.id } });
    const { journaliser } = await import('../src/services/journal.js');
    await journaliser({ action: 'document.verse', objetType: 'Document', objetId: piece.id });

    const s = en(app, await connecter(app, suiveur.email));
    expect((await messages(s)).messages[0].texte).toBe('Le système a versé « PV de réception » — 31/2016');
  });
});

describe('mentions', () => {
  it('« @Nom » dans une note prévient la personne, qui suit désormais la fiche', async () => {
    const auteur = await creerUtilisateur('chef_projet', { nom: 'Karim Alami' });
    const cible = await creerUtilisateur('directeur', { nom: 'Salma Bennani' });
    const a = en(app, await connecter(app, auteur.email));
    await a('POST', `/api/fil/marche/${marche.id}/notes`, { texte: '@Salma Bennani peux-tu valider le PV avant vendredi ?' });

    const c = en(app, await connecter(app, cible.email));
    const m = await messages(c);
    expect(m.messages[0]).toMatchObject({ genre: 'mention', par: 'Karim Alami' });
    expect(m.messages[0].texte).toMatch(/^Karim Alami vous a mentionné sur 31\/2016 : « @Salma Bennani peux-tu valider/);
    expect(await db.abonnement.count({ where: { utilisateurId: cible.id, objetType: 'Marche', objetId: marche.id } })).toBe(1);
    // L'auteur suit aussi, mais une note seule ne prévient pas les abonnés.
    expect((await messages(a)).nonLues).toBe(0);
  });

  it('ne prévient pas d’une fiche fournisseur qui n’a pas le droit de la voir', async () => {
    const f = await db.fournisseur.create({ data: { nom: 'INGRAM' } });
    const achats = await creerUtilisateur('achats');
    const chef = await creerUtilisateur('chef_projet', { nom: 'Youssef Idrissi' });
    const a = en(app, await connecter(app, achats.email));
    await a('POST', `/api/fil/fournisseur/${f.id}/notes`, { texte: '@Youssef Idrissi info' });
    expect(await db.notification.count({ where: { utilisateurId: chef.id } })).toBe(0);
  });
});
