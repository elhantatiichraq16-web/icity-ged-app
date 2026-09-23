import { describe, expect, it } from 'vitest';
import { chercherPaires, comparer, motsLongs, preparer, ressemblance, signature } from '../src/services/doublons.js';

/** Un texte d'attestation, assez long pour que la comparaison ait un sens. */
const ATTESTATION = `
  Nous soussignés SOMAPORT, société anonyme sise à Casablanca, attestons par la
  présente que la société INTELIFEX SYSTEMS, inscrite au registre de commerce de
  Casablanca, assure dans le cadre du marché numéro 22/SGPTV/2017 les prestations
  de fourniture, installation et mise en service des équipements de
  vidéosurveillance pour un montant de 1 250 000,00 dirhams toutes taxes
  comprises, réalisées conformément aux règles de l'art durant la période
  couverte par ledit marché.`;

/** La même pièce relue par l'OCR : quelques mots abîmés, le sens intact. */
const RELECTURE = ATTESTATION.replace('INTELIFEX', 'INTELlFEX').replace('conformément', 'conformement');

const doc = (champs) => ({ id: 1, titre: 'Pièce', clientId: 1, marcheId: null, lotScan: null, pageScan: null, texteOcr: ATTESTATION, ...champs });

describe('vocabulaire et ressemblance', () => {
  it('ne garde que les mots d’au moins cinq lettres, sans accents', () => {
    const mots = motsLongs('Réception provisoire du lot n°3');
    expect(mots.has('reception')).toBe(true);
    expect(mots.has('provisoire')).toBe(true);
    expect(mots.has('lot')).toBe(false); // trois lettres
  });

  it('mesure la part de vocabulaire commun', () => {
    expect(ressemblance(new Set(['alpha', 'bravo']), new Set(['alpha', 'bravo']))).toBe(1);
    expect(ressemblance(new Set(['alpha']), new Set(['bravo']))).toBe(0);
  });
});

describe('signature d’une pièce', () => {
  it('relève montants, dates, références et numéros de lot', () => {
    const s = signature('Marché 23C/2017/TGR, lot n°3, signé le 12/03/2017 pour 1 250 000,00 dirhams');
    expect([...s.montants]).toContain('125000000');
    expect([...s.dates]).toContain('12/03/2017');
    expect([...s.references]).toContain('23C/2017/TGR');
    expect([...s.lots]).toContain('3');
  });
});

describe('comparaison de deux pièces (§9)', () => {
  it('reconnaît deux relectures du même papier', () => {
    const r = comparer(preparer(doc({ id: 1 })), preparer(doc({ id: 2, texteOcr: RELECTURE })));
    expect(r.probable).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.raisons.join(' ')).toMatch(/même client/);
  });

  it('écarte deux pièces du même modèle mais de lots différents', () => {
    const lot1 = doc({ id: 1, texteOcr: `${ATTESTATION} Le présent marché porte sur le lot n°1.` });
    const lot3 = doc({ id: 2, texteOcr: `${ATTESTATION} Le présent marché porte sur le lot n°3.` });
    const r = comparer(preparer(lot1), preparer(lot3));
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.probable).toBe(false);
    expect(r.ecarts.join(' ')).toMatch(/lot/);
  });

  it('écarte deux pages d’un même passage de scanner', () => {
    const a = doc({ id: 1, lotScan: '20260910140626873', pageScan: 11 });
    const b = doc({ id: 2, lotScan: '20260910140626873', pageScan: 12, texteOcr: RELECTURE });
    const r = comparer(preparer(a), preparer(b));
    expect(r.probable).toBe(false);
    expect(r.ecarts.join(' ')).toMatch(/même passage/);
  });

  it('retient l’indice fort : même page dans deux passages différents', () => {
    const a = doc({ id: 1, lotScan: '20260910132832435', pageScan: 18 });
    const b = doc({ id: 2, lotScan: '20260910135739507', pageScan: 18, texteOcr: RELECTURE });
    const r = comparer(preparer(a), preparer(b));
    expect(r.probable).toBe(true);
    expect(r.raisons.join(' ')).toMatch(/même numéro de page/);
  });

  it('une valeur absente d’un seul côté n’est pas une contradiction', () => {
    // L'OCR a perdu le montant sur la seconde lecture.
    const sansMontant = RELECTURE.replace('1 250 000,00 dirhams', 'dirhams');
    const r = comparer(preparer(doc({ id: 1 })), preparer(doc({ id: 2, texteOcr: sansMontant })));
    expect(r.probable).toBe(true);
  });

  it('deux montants différents, eux, contredisent', () => {
    const autreMontant = RELECTURE.replace('1 250 000,00', '2 480 000,00');
    const r = comparer(preparer(doc({ id: 1 })), preparer(doc({ id: 2, texteOcr: autreMontant })));
    expect(r.probable).toBe(false);
    expect(r.ecarts.join(' ')).toMatch(/montants différents/);
  });

  it('écarte deux clients différents', () => {
    const r = comparer(preparer(doc({ id: 1, clientId: 1 })), preparer(doc({ id: 2, clientId: 2, texteOcr: RELECTURE })));
    expect(r.probable).toBe(false);
    expect(r.ecarts.join(' ')).toMatch(/clients différents/);
  });

  it('ne conclut pas sur un texte trop court', () => {
    const r = comparer(preparer(doc({ id: 1, texteOcr: 'reçu de versement' })), preparer(doc({ id: 2, texteOcr: 'reçu de versement' })));
    expect(r.probable).toBe(false);
    expect(r.ecarts.join(' ')).toMatch(/trop court/);
  });
});

describe('recherche des paires', () => {
  it('rend les paires suspectes, la plus ressemblante d’abord', () => {
    const documents = [
      doc({ id: 1 }),
      doc({ id: 2, texteOcr: RELECTURE }),
      doc({ id: 3, texteOcr: 'Un tout autre document parlant de maintenance des équipements informatiques du ministère avec des mots entièrement différents des autres pièces comparées ici aujourd’hui.' }),
    ];
    const paires = chercherPaires(documents);
    expect(paires).toHaveLength(1);
    expect(paires[0].a.id).toBe(1);
    expect(paires[0].b.id).toBe(2);
    expect(paires[0].probable).toBe(true);
  });
});
