/**
 * L'export CSV et l'entretien du fonds.
 *
 * Deux sujets sans rapport, mais qui partagent un point commun : ce sont des
 * pièges silencieux. Un CSV mal échappé ouvre une injection de formule dans
 * Excel ; une purge mal bornée efface ce qu'il fallait garder.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { cellule, nomFichier, versCsv } from '../src/services/export-csv.js';
import { JOURS_JOURNAL, purgerJournal, viderCorbeille } from '../src/services/entretien.js';

const silence = { log() {} };

describe('les cellules CSV', () => {
  it('laisse le texte ordinaire intact', () => {
    expect(cellule('Marché 23C/2017')).toBe('Marché 23C/2017');
    expect(cellule(42)).toBe('42');
    expect(cellule(null)).toBe('');
  });

  it('entoure ce qui contient un point-virgule ou un saut de ligne', () => {
    // Sans guillemets, Excel couperait la valeur en deux colonnes.
    expect(cellule('Rabat; Salé')).toBe('"Rabat; Salé"');
    expect(cellule('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"');
  });

  it('double les guillemets internes', () => {
    expect(cellule('Marché dit "urgent"')).toBe('"Marché dit ""urgent"""');
  });

  it.each(['=1+1', '+SOMME(A1)', '-2', '@import', '=cmd|\' /c calc\'!A1'])('neutralise la formule %s', (piege) => {
    // Excel exécuterait cette cellule : l'apostrophe la rend inerte, et le
    // texte reste lisible tel qu'il a été saisi.
    expect(cellule(piege).startsWith("'")).toBe(true);
  });

  it.each([
    [' =1+1', 'espace avant'],
    ['\u00a0=1+1', 'espace insécable'],
    ['\u0000=1+1', 'octet nul'],
    ['  	 =SOMME(A1)', 'blancs mêlés'],
  ])('neutralise %s malgré les blancs de tête (%s)', (piege) => {
    // Excel ignore les blancs avant d'interpréter : sans cela, la formule
    // s'exécuterait quand même à l'ouverture du fichier.
    expect(cellule(piege).startsWith("'")).toBe(true);
  });

  it('laisse le texte ordinaire intact malgré le nouveau test', () => {
    // La protection ne doit pas se déclencher sur du texte banal.
    expect(cellule(' Rabat')).toBe(' Rabat');
    expect(cellule('Marché 23C/2017')).toBe('Marché 23C/2017');
  });

  it('rend une date lisible', () => {
    expect(cellule(new Date('2026-09-21T10:00:00Z'))).toBe('2026-09-21');
  });
});

describe('le fichier CSV', () => {
  it('porte un BOM et des fins de ligne Windows', () => {
    const csv = versCsv({
      colonnes: [
        { cle: 'reference', titre: 'Référence' },
        { cle: 'ville', titre: 'Ville' },
      ],
      lignes: [{ reference: '23C/2017', ville: 'Rabat' }],
    });

    // Sans BOM, Excel affiche « Référence » comme « RÃ©fÃ©rence ».
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Référence;Ville');
    expect(csv).toContain('23C/2017;Rabat');
    expect(csv).toContain('\r\n');
  });

  it('rend un fichier vide mais valide sans aucune ligne', () => {
    const csv = versCsv({ colonnes: [{ cle: 'a', titre: 'A' }], lignes: [] });
    expect(csv).toBe('﻿A\r\n');
  });

  it('date le nom du fichier et refuse les caractères interdits', () => {
    const nom = nomFichier('marchés/2026');
    expect(nom).toMatch(/^march-s-2026-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe("l'entretien du fonds", () => {
  it('efface les traces de plus de deux ans et garde les récentes', async () => {
    await db.journal.deleteMany();

    const vieille = new Date(Date.now() - (JOURS_JOURNAL + 10) * 86_400_000);
    const recente = new Date(Date.now() - 30 * 86_400_000);
    await db.journal.create({ data: { action: 'test.vieux', creeLe: vieille } });
    await db.journal.create({ data: { action: 'test.recent', creeLe: recente } });

    const efface = await purgerJournal({ log: silence });

    expect(efface).toBe(1);
    const restantes = await db.journal.findMany();
    expect(restantes).toHaveLength(1);
    // Une trace d'audit récente doit survivre : c'est tout son intérêt.
    expect(restantes[0].action).toBe('test.recent');

    await db.journal.deleteMany();
  });

  it('ne touche pas à un document supprimé il y a moins de trente jours', async () => {
    await db.documentEtiquette.deleteMany();
    await db.document.deleteMany();

    await db.document.create({
      data: {
        titre: 'Supprimé hier',
        source: 'versement',
        sha256: 'c'.repeat(64),
        taille: BigInt(1),
        supprimeLe: new Date(Date.now() - 2 * 86_400_000),
      },
    });

    expect(await viderCorbeille({ log: silence })).toBe(0);
    expect(await db.document.count()).toBe(1);

    await db.document.deleteMany();
  });
});
