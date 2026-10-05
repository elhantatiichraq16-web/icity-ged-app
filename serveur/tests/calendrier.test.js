/**
 * Le calendrier, à la Odoo : échéances, activités, livraisons et paiements
 * d'un mois, selon les droits de chacun.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  await db.activite.deleteMany();
  await db.ligneAchat.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.commandeFournisseur.deleteMany();
  await db.fournisseur.deleteMany();
  await db.marche.deleteMany();
  await viderBase();
});

const le = (iso) => new Date(`${iso}T00:00:00Z`);

async function preparer() {
  const moi = await creerUtilisateur('achats');
  const marche = await db.marche.create({ data: { reference: 'PROJET ESSAI', referenceNormalisee: 'PROJET ESSAI', dateFin: le('2026-11-20') } });
  const archive = await db.marche.create({ data: { reference: 'ANCIEN', referenceNormalisee: 'ANCIEN', dateFin: le('2026-11-21'), archiveLe: new Date() } });
  const fournisseur = await db.fournisseur.create({ data: { nom: 'INGRAM' } });
  const commande = await db.commandeFournisseur.create({ data: { marcheId: marche.id, fournisseurId: fournisseur.id, modalite: 'virement', montantTtc: 1200, echeance: le('2026-11-10') } });
  await db.ligneAchat.create({ data: { marcheId: marche.id, categorie: 'Matériel', designation: 'Serveur', quantite: 1, fournisseurId: fournisseur.id, commandeId: commande.id, etd: le('2026-11-05'), statut: 'commande_envoyee' } });
  await db.ligneAchat.create({ data: { marcheId: marche.id, categorie: 'Matériel', designation: 'Déjà reçu', quantite: 1, etd: le('2026-11-06'), statut: 'livre' } });
  await db.activite.create({ data: { resume: 'Relancer le client', echeance: le('2026-11-03'), assigneId: moi.id, marcheId: marche.id } });
  await db.marche.update({ where: { id: archive.id }, data: {} });
  return { moi };
}

describe('calendrier', () => {
  it('réunit échéances, activités, livraisons et paiements du mois, sans les archives ni ce qui est reçu', async () => {
    const { moi } = await preparer();
    const requete = en(app, await connecter(app, moi.email));
    const r = await requete('GET', '/api/calendrier?debut=2026-11-01&fin=2026-11-30');
    expect(r.statusCode).toBe(200);
    expect(r.json().map((e) => [e.type, e.date, e.titre])).toEqual([
      ['activite', '2026-11-03', 'Relancer le client'],
      ['livraison', '2026-11-05', 'Livraison : Serveur'],
      ['paiement', '2026-11-10', 'Paiement INGRAM'],
      ['echeance', '2026-11-20', 'Échéance PROJET ESSAI'],
    ]);
  });

  it('les paiements restent aux achats et à la direction', async () => {
    await preparer();
    const chef = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const types = (await chef('GET', '/api/calendrier?debut=2026-11-01&fin=2026-11-30')).json().map((e) => e.type);
    expect(types).not.toContain('paiement');
    expect(types).toContain('echeance');
  });

  it('« miennes » ne garde que mes activités', async () => {
    await preparer();
    const autre = en(app, await connecter(app, (await creerUtilisateur('achats')).email));
    const types = (await autre('GET', '/api/calendrier?debut=2026-11-01&fin=2026-11-30&miennes=1')).json().map((e) => e.type);
    expect(types).not.toContain('activite');
  });
});
