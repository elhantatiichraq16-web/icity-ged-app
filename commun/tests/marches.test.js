import { describe, expect, it } from 'vitest';
import {
  echeanceDe,
  memeNumeroEtAnnee,
  etatEcheance,
  extraireLot,
  formesReference,
  memeAffaire,
  normaliserReference,
  phaseDe,
  estAppelOffres,
  piecesManquantes,
  statutClient,
} from '../src/marches.js';

describe('normalisation des références (§5)', () => {
  it('garde les formes déjà propres', () => {
    expect(normaliserReference('23C/2017/TGR')).toBe('23/2017/TGR');
    // Le zéro de tête disparaît : « 04 » et « 4 » désignent le même marché.
    expect(normaliserReference('04/DRCA/2014')).toBe('4/DRGA/2014');
    expect(normaliserReference('31/2016')).toBe('31/2016');
  });

  it('regroupe les lots d’un même marché (3 segments seulement)', () => {
    const a = normaliserReference('23A/2017/TGR');
    expect(normaliserReference('23B/2017/TGR')).toBe(a);
    expect(normaliserReference('23/2017/TGR')).toBe(a);
    // 238 est la lecture fautive de 23B.
    expect(normaliserReference('238/2017/TGR')).toBe(a);
  });

  it('ne rogne pas une référence à quatre segments', () => {
    // 639/SAM/FRA/2022 perdrait son 9 si la règle des lots s'y appliquait.
    expect(normaliserReference('639/SAM/FRA/2022')).toBe('639/SAM/TRA/2022');
  });

  it('ramène MAR + chiffres et le numéro nu au même marché', () => {
    expect(normaliserReference('MAR202200027')).toBe('MAR202200027');
    expect(normaliserReference('202200027')).toBe('MAR202200027');
    // L'OCR a perdu un chiffre : même marché quand même.
    expect(memeAffaire('MAR202200027', '20220027')).toBe(true);
    // Mais deux marchés voisins restent deux marchés (cas réel du fonds).
    expect(memeAffaire('MAR202200027', 'MAR202200096')).toBe(false);
  });

  it('corrige les confusions de l’OCR sur les codes d’organisme', () => {
    // TGR lu FGR : la même affaire.
    expect(memeAffaire('23/2017/TGR', '23/2017/FGR')).toBe(true);
    // 12/H8/2011 lu pour 12/HB/2011.
    expect(memeAffaire('12/HB/2011', '12/H8/2011')).toBe(true);
  });

  it('propose toutes les années plausibles pour une année trop longue', () => {
    expect(formesReference('13/HB/20114').sort()).toEqual(['13/HB/2011', '13/HB/2014']);
    expect(memeAffaire('13/HB/20114', '13/HB/2011')).toBe(true);
    expect(memeAffaire('13/HB/20114', '13/HB/2014')).toBe(true);
    // Mais deux années sûres et différentes restent deux affaires.
    expect(memeAffaire('13/HB/2011', '13/HB/2014')).toBe(false);
  });

  it('ignore la casse, les espaces et la ponctuation qui traîne', () => {
    expect(normaliserReference('  mar 202200027 ')).toBe('MAR202200027');
    expect(normaliserReference('/23C/2017/TGR.')).toBe('23/2017/TGR');
  });

  it('lit le lot, seulement sur trois segments', () => {
    expect(extraireLot('23A/2017/TGR')).toBe('A');
    expect(extraireLot('238/2017/TGR')).toBe('B'); // 8 lu pour B
    expect(extraireLot('23/2017/TGR')).toBeNull();
    expect(extraireLot('10879/2018')).toBeNull(); // un bon de commande n'a pas de lot
    expect(extraireLot('639/SAM/FRA/2022')).toBeNull();
  });

  it('rapproche « 04/DRCA/2014 » et « 4/DRCA/2014 » (zéro de tête)', () => {
    expect(memeAffaire('04/DRCA/2014', '4/DRCA/2014')).toBe(true);
  });

  it('rapproche par numéro et année deux écritures de longueur différente', () => {
    // « 639/2022 » vient du nom du dossier ; « 639/SAM/FRA/2022 » du contrat.
    expect(memeAffaire('639/2022', '639/SAM/FRA/2022')).toBe(false);
    expect(memeNumeroEtAnnee('639/2022', '639/SAM/FRA/2022')).toBe(true);
    // Deux années différentes ne se rapprochent pas.
    expect(memeNumeroEtAnnee('07/2019', '07/2023')).toBe(false);
  });

  it('rend une chaîne vide pour une référence vide', () => {
    expect(normaliserReference('')).toBe('');
    expect(normaliserReference(null)).toBe('');
  });
});

describe('phase déduite des pièces (§5)', () => {
  it.each([
    [{}, 'attente'],
    [{ os: true }, 'cours'],
    [{ os: true, bl: true }, 'cours'],
    [{ os: true, bl: true, pvp: true }, 'provisoire'],
    [{ pvd: true }, 'caution'],
    [{ pvd: true, mlv: true }, 'cloture'],
    [{ mlv: true }, 'cloture'],
  ])('%o → %s', (pieces, attendue) => {
    expect(phaseDe(pieces)).toBe(attendue);
  });

  it('une attestation de référence clôt le marché : elle n’est délivrée qu’après exécution', () => {
    expect(phaseDe({ att: true })).toBe('cloture');
    expect(phaseDe({ os: true, bl: true, att: true })).toBe('cloture');
  });
});

describe('pièces manquantes selon la phase (§5)', () => {
  it('ne réclame rien à un marché qui attend son OS', () => {
    expect(piecesManquantes({})).toEqual([]);
  });

  it('réclame ce que la phase franchie aurait dû produire', () => {
    // PV provisoire présent, mais ni OS ni BL versés.
    expect(piecesManquantes({ pvp: true })).toEqual(['os', 'bl']);
    // Clôturé sans aucune pièce intermédiaire.
    expect(piecesManquantes({ mlv: true })).toEqual(['os', 'bl', 'pvp', 'pvd']);
  });

  it('ne réclame rien quand le dossier est complet', () => {
    expect(piecesManquantes({ os: true, bl: true, pvp: true, pvd: true, mlv: true })).toEqual([]);
  });
});

describe('échéance', () => {
  it('prend la date de fin quand elle est connue', () => {
    expect(echeanceDe({ dateFin: '2024-06-30', dateOs: '2023-01-01', delaiMois: 6 })).toBe('2024-06-30');
  });

  it('calcule OS + délai sinon', () => {
    expect(echeanceDe({ dateOs: '2023-01-15', delaiMois: 6 })).toBe('2023-07-15');
  });

  it('ne déborde pas sur le mois suivant (31 janvier + 1 mois)', () => {
    expect(echeanceDe({ dateOs: '2023-01-31', delaiMois: 1 })).toBe('2023-02-28');
  });

  it('accepte une date venue de la base (objet Date)', () => {
    expect(echeanceDe({ dateOs: new Date('2017-03-01T00:00:00Z'), delaiMois: 6 })).toBe('2017-09-01');
    expect(echeanceDe({ dateFin: new Date('2024-06-30T00:00:00Z') })).toBe('2024-06-30');
  });

  it('rend null quand rien ne permet de la calculer', () => {
    expect(echeanceDe({ dateOs: '2023-01-15' })).toBeNull();
    expect(echeanceDe({})).toBeNull();
    expect(echeanceDe({ dateFin: 'pas une date' })).toBeNull();
  });

  it('alerte à moins de 60 jours, rouge si dépassée, rien si clôturé', () => {
    const aujourdhui = new Date('2026-09-17T00:00:00Z');
    expect(etatEcheance('2026-09-01', 'cours', aujourdhui)).toBe('depassee');
    expect(etatEcheance('2026-10-10', 'cours', aujourdhui)).toBe('proche');
    expect(etatEcheance('2027-01-01', 'cours', aujourdhui)).toBe('lointaine');
    expect(etatEcheance('2026-09-01', 'cloture', aujourdhui)).toBe('aucune');
    expect(etatEcheance(null, 'cours', aujourdhui)).toBe('aucune');
  });
});

describe('statut d’un client', () => {
  it('se déduit des phases de ses marchés', () => {
    expect(statutClient([])).toBe('sans_marche');
    expect(statutClient(['cloture', 'cloture'])).toBe('clos');
    // Un seul marché ouvert suffit : le client a des affaires en cours.
    expect(statutClient(['cloture', 'attente'])).toBe('en_cours');
    expect(statutClient(['caution'])).toBe('en_cours');
  });
});

describe('appel d’offres ou marché', () => {
  it('un dossier sans preuve d’attribution est un appel d’offres', () => {
    expect(estAppelOffres(['DAO'])).toBe(true);
    expect(estAppelOffres(['DAO', 'ETU', 'CAU'])).toBe(true); // la caution provisoire accompagne l’offre
    expect(estAppelOffres([])).toBe(true);
  });

  it('un contrat, un OS ou une attestation en fait un marché', () => {
    expect(estAppelOffres(['DAO', 'CM'])).toBe(false);
    expect(estAppelOffres(['OS'])).toBe(false);
    expect(estAppelOffres(['ATT'])).toBe(false);
  });

  it('le statut choisi à la main l’emporte sur le dossier', () => {
    expect(estAppelOffres(['CM', 'OS'], 'Perdu')).toBe(true);
    expect(estAppelOffres(['DAO'], 'Gagné')).toBe(false);
    expect(estAppelOffres(['DAO'], 'AO déposé')).toBe(true);
  });
});
