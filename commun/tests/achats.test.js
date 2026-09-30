/**
 * Les calculs des achats : ce que le classeur faisait à la main, et ce qu'il
 * ne voyait pas (marge négative, total faux, retard, marge surestimée).
 * Tous les montants sont inventés.
 */
import { describe, expect, it } from 'vitest';
import {
  alertesLigne,
  ecartFacture,
  echeanceDe,
  lireConditions,
  lireDelai,
  lireFacture,
  lireMontant,
  livraisonPrevue,
  marge,
  paiementCommande,
  paiementsAPrevoir,
  prochaineAction,
  prochaineActionCommande,
  resumeAchats,
  schemaCommande,
  schemaLigneAchat,
  schemaModificationCommande,
  schemaModificationLigneAchat,
  total,
  ttcDesLignes,
} from '../src/achats.js';
import { droitsPour } from '../src/droits.js';

const codes = (alertes) => alertes.map((a) => a.code);

describe('les totaux et la marge', () => {
  it('multiplie le prix unitaire par la quantité, sans rien inventer quand un prix manque', () => {
    expect(total(1250, 4)).toBe(5000);
    expect(total('1250.5', '2')).toBe(2501);
    expect(total(null, 4)).toBeNull();
  });

  it('calcule la marge sur le prix de vente, négative quand on vend à perte', () => {
    expect(marge(60, 100)).toBeCloseTo(0.4);
    expect(marge(150, 100)).toBeCloseTo(-0.5);
    expect(marge(60, null)).toBeNull();
    expect(marge(60, 0)).toBeNull();
  });
});

describe('les alertes d’une ligne', () => {
  const base = { quantite: 2, statut: 'en_attente' };

  it('signale une vente à perte et un achat au-dessus du budget', () => {
    expect(codes(alertesLigne({ ...base, puBudget: 100, puAchat: 180, puVente: 120 }))).toEqual(['marge_negative', 'budget_depasse']);
  });

  it('signale une livraison en retard, mais pas pour une ligne déjà livrée', () => {
    const commandee = { ...base, statut: 'commande_envoyee', etd: '2026-06-01' };
    expect(codes(alertesLigne(commandee, { aujourdhui: '2026-06-15' }))).toEqual(['retard']);
    expect(codes(alertesLigne({ ...commandee, statut: 'livre' }, { aujourdhui: '2026-06-15' }))).toEqual([]);
    expect(codes(alertesLigne(commandee, { aujourdhui: '2026-05-20' }))).toEqual([]);
  });

  it('compare les références sans tenir compte de la ponctuation ni de la casse', () => {
    expect(codes(alertesLigne({ ...base, referenceOffre: 'S6730-H24X6C', referenceAchat: 's6730 h24x6c' }))).toEqual([]);
    expect(codes(alertesLigne({ ...base, referenceOffre: 'R760xs', referenceAchat: 'R760' }))).toEqual(['reference_differente']);
  });

  it('ne calcule aucune alerte de prix pour qui ne voit pas les prix', () => {
    expect(codes(alertesLigne({ ...base, puBudget: 100, puAchat: 180, puVente: 120 }, { prix: false }))).toEqual([]);
  });
});

describe('le résumé d’une liste', () => {
  it('ne compte dans la marge que les lignes chiffrées à l’achat et à la vente', () => {
    const r = resumeAchats([
      { quantite: 1, puBudget: 120, puAchat: 60, puVente: 100, statut: 'livre' },
      // Vendue mais pas encore chiffrée à l'achat : le classeur la comptait dans la marge.
      { quantite: 1, puVente: 400, statut: 'attente_validation' },
    ]);
    expect(r).toMatchObject({ lignes: 2, budget: 120, achat: 60, vente: 500, lignesSansAchat: 1 });
    expect(r.marge).toBeCloseTo(0.4);
    expect(r.parStatut).toMatchObject({ livre: 1, attente_validation: 1, en_attente: 0 });
  });

  it('compte les livraisons en retard', () => {
    const r = resumeAchats([{ quantite: 1, statut: 'en_cours', etd: '2026-01-10' }], { aujourdhui: '2026-02-01' });
    expect(r.enRetard).toBe(1);
  });
});

describe('les paiements', () => {
  it('place l’échéance d’un effet après la facture, et celle d’un virement le jour même', () => {
    expect(echeanceDe('2026-07-10', 'effet_60')).toBe('2026-09-08');
    expect(echeanceDe('2026-07-10', 'virement')).toBe('2026-07-10');
    expect(echeanceDe(null, 'effet_30')).toBeNull();
  });

  it('calcule l’avance, le reste et l’état, et garde une échéance datée à la main', () => {
    const c = { montantTtc: 1000, avancePourcent: 13, modalite: 'effet_60', dateFacture: '2026-07-10' };
    expect(paiementCommande(c)).toEqual({ avance: 130, reste: 870, echeance: '2026-09-08', etat: 'avance_a_payer', estime: false });
    expect(paiementCommande({ ...c, avancePayeeLe: '2026-06-01' }).etat).toBe('reste_a_payer');
    expect(paiementCommande({ ...c, avancePayeeLe: '2026-06-01', soldePayeLe: '2026-09-08' }).etat).toBe('soldee');
    expect(paiementCommande({ ...c, echeance: '2026-09-10' }).echeance).toBe('2026-09-10');
    expect(paiementCommande({ ...c, avancePourcent: 0 }).etat).toBe('reste_a_payer');
  });

  it('estime l’avance d’après les lignes tant que la facture n’est pas là', () => {
    const c = { montantTtc: null, montantEstime: 2400, avancePourcent: 50, modalite: 'virement' };
    expect(paiementCommande(c)).toMatchObject({ avance: 1200, reste: 1200, estime: true, etat: 'avance_a_payer' });
  });

  it('une commande payée entièrement d’avance est soldée', () => {
    expect(paiementCommande({ montantTtc: 500, avancePourcent: 100, modalite: 'virement', avancePayeeLe: '2026-06-01' }).etat).toBe('soldee');
  });

  it('additionne les lignes TTC, et signale une facture qui ne tombe pas juste', () => {
    expect(ttcDesLignes([{ puAchat: 100, quantite: 2 }, { puAchat: 50, quantite: 1 }])).toBe(300);
    expect(ttcDesLignes([{ puAchat: 100, quantite: 2 }, { puAchat: null, quantite: 1 }])).toBeNull();
    expect(ecartFacture(300, 300)).toBeNull();
    expect(ecartFacture(300.8, 300)).toBeNull(); // moins d'un dirham : un arrondi
    expect(ecartFacture(342, 300)).toBe(42);
    expect(ecartFacture(null, 300)).toBeNull();
  });

  it('range les paiements à prévoir par urgence et fait les totaux', () => {
    const aujourdhui = '2026-07-01';
    const { paiements, totaux, engage } = paiementsAPrevoir(
      [
        { id: 1, montantTtc: 1000, avancePourcent: 30, modalite: 'virement' }, // avance attendue
        { id: 2, montantTtc: 200, avancePourcent: 0, modalite: 'virement', dateFacture: '2026-06-20' }, // en retard
        { id: 3, montantTtc: 300, avancePourcent: 0, modalite: 'effet_30', dateFacture: '2026-06-03' }, // le 3 juillet
        { id: 4, montantTtc: 400, avancePourcent: 0, modalite: 'effet_60', dateFacture: '2026-06-20' }, // en août
        { id: 5, montantTtc: null, montantEstime: 600, avancePourcent: 0, modalite: 'virement' }, // pas de facture
        { id: 6, montantTtc: 900, avancePourcent: 0, modalite: 'virement', dateFacture: '2026-06-01', soldePayeLe: '2026-06-02' },
      ],
      { aujourdhui },
    );
    expect(paiements.map((p) => [p.commande.id, p.groupe])).toEqual([
      [2, 'retard'],
      [1, 'avances'],
      [3, 'semaine'],
      [4, 'plus_tard'],
      [5, 'a_la_facture'],
    ]);
    expect(totaux).toEqual({ retard: 200, avances: 300, semaine: 300, plus_tard: 400, a_la_facture: 600 });
    expect(engage).toBe(2500);
  });
});

describe('ce qui se lit dans les textes', () => {
  it('lit un délai au plus long, et repère celui qui part de l’acompte', () => {
    expect(lireDelai('6 à 8 semaines')).toEqual({ jours: 56, depuisAcompte: false });
    expect(lireDelai('3-5 sem. dès réception de l’acompte')).toEqual({ jours: 35, depuisAcompte: true });
    expect(lireDelai('Armoire : disponible / Batteries : 2-4 sem.')).toEqual({ jours: 28, depuisAcompte: false });
    expect(lireDelai('45 jours')).toEqual({ jours: 45, depuisAcompte: false });
    expect(lireDelai('Disponible')).toEqual({ jours: 7, depuisAcompte: false });
    expect(lireDelai('En arrivage')).toBeNull();
    expect(lireDelai('')).toBeNull();
  });

  it('date la livraison depuis la commande, ou depuis l’avance quand le délai en dépend', () => {
    expect(livraisonPrevue({ delaiLivraison: '2 à 3 semaines', dateCommande: '2026-06-01' })).toBe('2026-06-22');
    expect(livraisonPrevue({ delaiLivraison: '2 à 3 semaines (date acompte)', dateCommande: '2026-06-01' })).toBeNull();
    expect(livraisonPrevue({ delaiLivraison: '2 à 3 semaines (date acompte)', dateCommande: '2026-06-01', avancePayeeLe: '2026-06-10' })).toBe('2026-07-01');
    expect(livraisonPrevue({ delaiLivraison: 'En arrivage', dateCommande: '2026-06-01' })).toBeNull();
  });

  it('lit l’avance et la modalité dans les conditions du fournisseur', () => {
    expect(lireConditions('20% Avance / 80% à 60 Jours')).toEqual({ avancePourcent: 20, modalite: 'effet_60' });
    expect(lireConditions('40% à la commande et 60% à la livraison')).toEqual({ avancePourcent: 40, modalite: 'virement' });
    expect(lireConditions('10% Acompte / Chèque 90 jours')).toEqual({ avancePourcent: 10, modalite: 'effet_90' });
    expect(lireConditions('Comptant')).toEqual({ avancePourcent: null, modalite: 'comptant' });
    expect(lireConditions('Contre-virement')).toEqual({ avancePourcent: null, modalite: 'virement' });
    expect(lireConditions('selon accord')).toBeNull();
  });

  it('lit les montants écrits de toutes les façons', () => {
    expect(lireMontant('1 234 567,89')).toBe(1234567.89);
    expect(lireMontant('1.234.567,89')).toBe(1234567.89);
    expect(lireMontant('1,234,567.89')).toBe(1234567.89);
    expect(lireMontant('12.500')).toBe(12500);
    expect(lireMontant('abc')).toBeNull();
  });

  it('lit le montant TTC, la date et le numéro d’une facture', () => {
    const facture = [
      'SOCIETE EXEMPLE SARL — Casablanca',
      'FACTURE N° FA-2026-0042',
      'Date : 14/07/2026',
      'Bon de commande du 02/06/2026',
      'Désignation   Qté   P.U. HT   Montant HT',
      'Switch 24 ports   2   5 000,00   10 000,00',
      'Total HT 10 000,00',
      'TVA 20 % 2 000,00',
      'Total TTC 12 000,00 DH',
      "Date d'échéance : 13/08/2026",
    ].join('\n');
    expect(lireFacture(facture)).toEqual({ montantTtc: 12000, dateFacture: '2026-07-14', numero: 'FA-2026-0042' });
  });

  it('se contente de ce qu’elle trouve, sans inventer', () => {
    expect(lireFacture('Casablanca, le 3 juillet 2026. Net à payer : 4.800,50')).toEqual({ montantTtc: 4800.5, dateFacture: '2026-07-03', numero: null });
    // La date de livraison n'est pas celle de la facture.
    expect(lireFacture('Livrée le 01/07/2026')).toEqual({ montantTtc: null, dateFacture: null, numero: null });
    expect(lireFacture('')).toEqual({ montantTtc: null, dateFacture: null, numero: null });
  });
});

describe('la prochaine chose à faire', () => {
  const aujourdhui = '2026-07-01';
  const fournisseur = { id: 1, nom: 'Fournisseur A' };

  it('avant la commande : choisir le fournisseur, commander, faire valider', () => {
    expect(prochaineAction({ statut: 'en_attente' }, null, { aujourdhui }).code).toBe('fournisseur');
    expect(prochaineAction({ statut: 'en_attente', fournisseur }, null, { aujourdhui }).code).toBe('commander');
    expect(prochaineAction({ statut: 'attente_validation', fournisseur }, null, { aujourdhui }).texte).toBe('Faire valider la commande');
  });

  it('commandée : l’avance d’abord, avec son montant pour qui voit les prix seulement', () => {
    const commande = { montantTtc: 2400, avancePourcent: 50, modalite: 'virement' };
    const ligne = { statut: 'commande_envoyee', fournisseur, delaiLivraison: '2 à 3 semaines (date acompte)' };
    expect(prochaineAction(ligne, commande, { aujourdhui, prix: true }).texte).toMatch(/^Payer l’avance de 50 % \(1\s200 DH\) : la livraison en dépend$/);
    const sansPrix = prochaineAction(ligne, commande, { aujourdhui, prix: false }).texte;
    expect(sansPrix).toBe('Attend le paiement de l’avance : la livraison en dépend');
  });

  it('puis la livraison : prévue, en retard, ou à dater', () => {
    const commande = { montantTtc: 2400, avancePourcent: 0, modalite: 'virement' };
    expect(prochaineAction({ statut: 'en_cours', etd: '2026-07-20' }, commande, { aujourdhui })).toMatchObject({ code: 'attendre', texte: 'Livraison prévue le 20/07/2026' });
    expect(prochaineAction({ statut: 'en_cours', etd: '2026-06-20' }, commande, { aujourdhui })).toMatchObject({ code: 'retard', ton: 'alerte' });
    expect(prochaineAction({ statut: 'en_cours' }, commande, { aujourdhui }).code).toBe('date');
  });

  it('livrée : le paiement qui reste, pour qui voit les prix', () => {
    const commande = { montantTtc: 1000, avancePourcent: 0, modalite: 'virement', dateFacture: '2026-06-10' };
    expect(prochaineAction({ statut: 'livre' }, commande, { aujourdhui, prix: true }).code).toBe('paiement_retard');
    expect(prochaineAction({ statut: 'livre' }, commande, { aujourdhui, prix: false }).code).toBe('livre');
    expect(prochaineAction({ statut: 'livre' }, { ...commande, soldePayeLe: '2026-06-11' }, { aujourdhui, prix: true }).code).toBe('livre');
  });

  it('pour une commande entière : envoyer, payer l’avance, relancer, puis payer', () => {
    const commande = { montantTtc: null, montantEstime: 1000, avancePourcent: 30, modalite: 'virement' };
    expect(prochaineActionCommande(commande, [{ statut: 'commande_preparee' }], { aujourdhui }).code).toBe('envoyer');
    expect(prochaineActionCommande(commande, [{ statut: 'commande_envoyee' }], { aujourdhui }).code).toBe('avance');
    const avancePayee = { ...commande, avancePayeeLe: '2026-06-01' };
    expect(prochaineActionCommande(avancePayee, [{ statut: 'en_cours', etd: '2026-06-15' }, { statut: 'livre' }], { aujourdhui }).code).toBe('retard');
    expect(prochaineActionCommande(avancePayee, [{ statut: 'livre' }], { aujourdhui }).code).toBe('facture');
    expect(prochaineActionCommande({ ...avancePayee, montantTtc: 1000, dateFacture: '2026-06-28' }, [{ statut: 'livre' }], { aujourdhui }).code).toBe('paiement_retard');
  });
});

describe('la saisie', () => {
  it('accepte les montants écrits à la française', () => {
    const r = schemaLigneAchat.parse({ marcheId: '3', categorie: 'Réseau', designation: 'Switch 24 ports', quantite: '2', puAchat: '12 500,50', puBudget: '' });
    expect(r).toMatchObject({ marcheId: 3, quantite: 2, puAchat: 12500.5, puBudget: null, statut: 'en_attente' });
    // Un prix non envoyé reste absent : une modification partielle ne l'efface pas.
    expect('puVente' in r).toBe(false);
  });

  it('exige le marché, la catégorie, le matériel et une quantité positive', () => {
    const r = schemaLigneAchat.safeParse({ categorie: '', designation: '', quantite: '0' });
    expect(Object.keys(r.error.flatten().fieldErrors).sort()).toEqual(['categorie', 'designation', 'marcheId', 'quantite']);
  });

  it('une modification ne remet ni le statut ni les lignes à leur valeur par défaut', () => {
    expect(schemaModificationLigneAchat.parse({ puAchat: '100' })).toEqual({ puAchat: 100 });
    expect(schemaModificationCommande.parse({ notes: 'relancé' })).toEqual({ notes: 'relancé' });
  });

  it('refuse une avance de plus de 100 %', () => {
    expect(schemaCommande.safeParse({ marcheId: 1, fournisseurId: 1, montantTtc: 100, avancePourcent: 130, modalite: 'virement' }).success).toBe(false);
  });
});

describe('qui voit quoi', () => {
  const peut = (role, action, sujet) => droitsPour({ id: 1, role }).can(action, sujet);

  it('la personne des achats gère tout et voit les prix', () => {
    expect(peut('achats', 'gerer', 'Achat')).toBe(true);
    expect(peut('achats', 'gerer', 'Fournisseur')).toBe(true);
    expect(peut('achats', 'lire', 'PrixAchat')).toBe(true);
  });

  it('le directeur voit les prix sans saisir', () => {
    expect(peut('directeur', 'lire', 'PrixAchat')).toBe(true);
    expect(peut('directeur', 'gerer', 'Achat')).toBe(false);
  });

  it('les autres voient le matériel et son suivi, pas les prix', () => {
    for (const role of ['chef_projet', 'commercial_ao', 'responsable_documentaire', 'lecteur']) {
      expect(peut(role, 'lire', 'Achat')).toBe(true);
      expect(peut(role, 'lire', 'PrixAchat')).toBe(false);
      expect(peut(role, 'gerer', 'Achat')).toBe(false);
    }
  });
});
