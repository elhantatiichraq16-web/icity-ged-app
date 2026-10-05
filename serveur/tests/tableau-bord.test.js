/**
 * Le tableau de bord à la Odoo : une période au choix, et ses chiffres
 * comparés à la période précédente.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { bornesPeriode } from '../src/routes/tableau-bord.js';
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
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await viderBase();
});

describe('les bornes d’une période', () => {
  const le = new Date(2026, 9, 5); // 5 octobre 2026

  it('mois, trimestre, année : le début, et celui de la période précédente', () => {
    expect(bornesPeriode('mois', le)).toEqual({ debut: new Date(2026, 9, 1), debutPrecedente: new Date(2026, 8, 1) });
    expect(bornesPeriode('trimestre', le)).toEqual({ debut: new Date(2026, 9, 1), debutPrecedente: new Date(2026, 6, 1) });
    expect(bornesPeriode('annee', le)).toEqual({ debut: new Date(2026, 0, 1), debutPrecedente: new Date(2025, 0, 1) });
    expect(bornesPeriode('tout', le)).toEqual({ debut: null, debutPrecedente: null });
  });

  it('janvier se compare à décembre de l’année d’avant', () => {
    expect(bornesPeriode('mois', new Date(2027, 0, 12)).debutPrecedente).toEqual(new Date(2026, 11, 1));
  });
});

describe('les chiffres de la période', () => {
  it('compte les nouvelles affaires et leur montant, comparés au mois précédent', async () => {
    const maintenant = new Date();
    const moisDernier = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 15);
    await db.marche.create({ data: { reference: 'A', referenceNormalisee: 'A', montantTtc: 1000 } });
    await db.marche.create({ data: { reference: 'B', referenceNormalisee: 'B', montantTtc: 500 } });
    await db.marche.create({ data: { reference: 'C', referenceNormalisee: 'C', creeLe: moisDernier } });
    // Un marché archivé ne compte pas : il n'est plus « en cours ».
    await db.marche.create({ data: { reference: 'D', referenceNormalisee: 'D', archiveLe: new Date() } });

    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const { periode } = (await requete('GET', '/api/tableau-bord?periode=mois')).json();
    const indicateur = (cle) => periode.indicateurs.find((i) => i.cle === cle);
    expect(periode).toMatchObject({ code: 'mois', libelle: 'Ce mois', precedente: 'le mois précédent' });
    expect(indicateur('marches')).toMatchObject({ valeur: 2, precedent: 1 });
    expect(indicateur('montant')).toMatchObject({ valeur: 1500, precedent: 0 });
  });

  it('« depuis le début » n’a pas de comparaison ; une période inconnue revient au mois', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const tout = (await requete('GET', '/api/tableau-bord?periode=tout')).json().periode;
    expect(tout.indicateurs.every((i) => i.precedent === null)).toBe(true);
    expect((await requete('GET', '/api/tableau-bord?periode=n-importe')).json().periode.code).toBe('mois');
  });
});
