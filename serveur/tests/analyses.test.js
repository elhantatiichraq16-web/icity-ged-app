/**
 * Les analyses, comme le tableau croisé d'Odoo : une mesure, regroupée en
 * lignes et en colonnes, avec ses totaux ; les prix restent aux achats et à
 * la direction.
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
  await db.commandeFournisseur.deleteMany();
  await db.fournisseur.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany({ where: { nom: { in: ['TGR', 'ONEE'] } } });
  await viderBase();
  const tgr = await db.client.create({ data: { nom: 'TGR' } });
  const onee = await db.client.create({ data: { nom: 'ONEE' } });
  const m1 = await db.marche.create({ data: { reference: 'A', referenceNormalisee: 'A', clientId: tgr.id, montantTtc: 1000, ville: 'Rabat', statutAffaire: 'Gagné' } });
  await db.marche.create({ data: { reference: 'B', referenceNormalisee: 'B', clientId: tgr.id, montantTtc: 500, ville: 'Fès', statutAffaire: 'Gagné' } });
  await db.marche.create({ data: { reference: 'C', referenceNormalisee: 'C', clientId: onee.id, montantTtc: 300, ville: 'Rabat', statutAffaire: 'Gagné' } });
  await db.marche.create({ data: { reference: 'D', referenceNormalisee: 'D', clientId: onee.id, montantTtc: 9999, archiveLe: new Date() } });
  const ingram = await db.fournisseur.create({ data: { nom: 'INGRAM' } });
  await db.ligneAchat.create({ data: { marcheId: m1.id, categorie: 'Serveurs', designation: 'Serveur', quantite: 2, puAchat: 100, puVente: 150, fournisseurId: ingram.id } });
});

describe('analyses', () => {
  it('croise une mesure par client et par ville, avec les totaux, sans les archives', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const t = (await requete('GET', '/api/analyses/marches?lignes=client&colonnes=ville&mesure=montantTtc')).json();
    expect(t).toMatchObject({
      titre: 'Montant TTC par client et par ville',
      lignes: ['TGR', 'ONEE'],
      colonnes: ['Rabat', 'Fès'],
      valeurs: [
        [1000, 500],
        [300, 0],
      ],
      totauxLignes: [1500, 300],
      totauxColonnes: [1300, 500],
      total: 1800,
    });
    const avecArchives = (await requete('GET', '/api/analyses/marches?lignes=client&mesure=nombre&archives=1')).json();
    expect(avecArchives.total).toBe(4);
  });

  it('les montants d’achat restent aux achats et à la direction', async () => {
    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const jeux = (await lecteur('GET', '/api/analyses')).json();
    const achats = jeux.find((j) => j.cle === 'achats');
    expect(achats.mesures.map((m) => m.cle)).toEqual(['nombre', 'quantite']);
    expect(jeux.map((j) => j.cle)).not.toContain('commandes');
    expect((await lecteur('GET', '/api/analyses/commandes')).statusCode).toBe(404);

    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const marge = (await directeur('GET', '/api/analyses/achats?lignes=fournisseur&mesure=marge')).json();
    expect(marge).toMatchObject({ lignes: ['INGRAM'], total: 100 });
  });

  it('s’exporte en Excel avec la ligne de total', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const r = await requete('GET', '/api/analyses/marches/export.xlsx?lignes=client&mesure=montantTtc');
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    const { lireClasseur } = await import('../src/services/lecture-xlsx.js');
    const [feuille] = lireClasseur(r.rawPayload);
    expect(feuille.cellules.get('A4').valeur).toBe('Total');
    expect(feuille.cellules.get('B4').valeur).toBe(1800);
  });
});
