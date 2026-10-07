/**
 * Le score d'une offre : déterministe, explicable, borné à 100 ; l'empreinte
 * d'une offre sans identifiant : stable.
 */
import { describe, expect, it } from 'vitest';
import { CRITERES_PAR_DEFAUT, contient, empreinteOffre, schemaCriteres, scoreOffre, texteComparable } from '../src/marches-potentiels.js';

const AUJOURDHUI = '2026-10-06';
const offre = (champs) => ({ objet: 'Objet', dateLimite: '2026-11-20T10:00:00', ...champs });

describe('texte comparable', () => {
  it('ignore les accents, la casse, la ponctuation et le pluriel', () => {
    expect(texteComparable('Systèmes d’Information')).toBe(' systeme d information ');
    expect(contient(texteComparable('Mise en place des systèmes d’information'), 'système d’information')).toBe(true);
    expect(contient(texteComparable('Fourniture de GEDEON'), 'GED')).toBe(false); // mot entier seulement
  });
});

describe('score', () => {
  it('additionne des raisons explicables, plafonne les mots-clés, et reste entre 0 et 100', () => {
    const { score, raisons, motsCles } = scoreOffre(
      offre({ objet: 'Plateforme Smart City, système d’information, GED, IoT et vidéosurveillance', categorie: 'Services', domaines: ['Informatique'] }),
      CRITERES_PAR_DEFAUT,
      AUJOURDHUI,
    );
    expect(score).toBe(85); // 50 (plafond mots-clés) + 20 (domaine) + 5 (services) + 10 (délai)
    expect(raisons.reduce((n, r) => n + r.points, 0)).toBe(85);
    expect(motsCles).toEqual(expect.arrayContaining(['smart city', 'GED', 'IoT']));
    const plafonne = scoreOffre(offre({ objet: 'smart city' }), { ...CRITERES_PAR_DEFAUT, motsCles: [{ terme: 'smart city', poids: 100 }], plafondMotsCles: 100, poidsDelai: 50 }, AUJOURDHUI);
    expect(plafonne.score).toBe(100);
  });

  it('un mot exclu ou une échéance passée donnent 0, avec la raison', () => {
    expect(scoreOffre(offre({ objet: 'Nettoyage des locaux et GED' }), CRITERES_PAR_DEFAUT, AUJOURDHUI)).toMatchObject({ score: 0, raisons: [{ texte: 'mot exclu « nettoyage » trouvé dans l’objet' }] });
    expect(scoreOffre(offre({ objet: 'GED', dateLimite: '2026-10-01' }), CRITERES_PAR_DEFAUT, AUJOURDHUI).score).toBe(0);
    expect(scoreOffre(offre({ objet: 'GED', dateLimite: '2026-10-01' }), { ...CRITERES_PAR_DEFAUT, exclureExpirees: false }, AUJOURDHUI).score).toBeGreaterThan(0);
  });

  it('lieu, acheteur favori, fourchette de montant, délai court', () => {
    const criteres = schemaCriteres.parse({ ...CRITERES_PAR_DEFAUT, lieux: { termes: ['Rabat'], poids: 10 }, acheteursFavoris: { termes: ['Commune d’Exemple'], poids: 10 }, montantMin: 500_000, montantMax: 5_000_000 });
    const r = scoreOffre(offre({ objet: 'GED', lieu: 'RABAT', acheteur: 'COMMUNE D’EXEMPLE', estimation: 1_000_000, dateLimite: '2026-10-09' }), criteres, AUJOURDHUI);
    const textes = r.raisons.map((x) => `${x.texte} : ${x.points}`);
    expect(textes).toEqual(expect.arrayContaining(['lieu suivi : Rabat : 10', 'acheteur favori : Commune d’Exemple : 10', 'estimation dans la fourchette (1 000 000 DH) : 5', 'délai court : 3 jour(s) avant la remise des plis : 0']));
  });
});

describe('empreinte', () => {
  it('stable malgré les espaces, la casse et les accents ; différente si l’annonce diffère', () => {
    const a = empreinteOffre({ reference: '12/2026', acheteur: 'Commune', objet: 'Plateforme numérique', dateLimite: '2026-11-20T10:00:00Z' });
    expect(empreinteOffre({ reference: '12/2026', acheteur: 'COMMUNE', objet: '  plateforme  numerique ', dateLimite: '2026-11-20T18:00:00Z' })).toBe(a);
    expect(empreinteOffre({ reference: '13/2026', acheteur: 'Commune', objet: 'Plateforme numérique', dateLimite: '2026-11-20' })).not.toBe(a);
  });
});
