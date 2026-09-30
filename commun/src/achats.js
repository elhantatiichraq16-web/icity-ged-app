/**
 * Les achats d'un marché : le matériel à acheter, son budget, ses prix
 * d'achat et de vente, sa commande, sa livraison et son paiement.
 *
 * Ce qui se calcule se calcule ici, pour l'écran comme pour le serveur : le
 * prix total, la marge, l'échéance d'un paiement, les alertes. Rien de ce qui
 * se déduit ne se saisit — c'est ce qui rendait le classeur Excel faux : un
 * total tapé à la main, un tableau de bord recopié qui ne disait plus la même
 * chose que la feuille d'origine.
 *
 * Ce qui s'écrivait en toutes lettres se lit aussi : le délai du fournisseur
 * donne la date de livraison, ses conditions donnent l'avance et la modalité,
 * sa facture donne le montant et la date. Et la prochaine chose à faire se
 * déduit de l'état de la ligne, au lieu d'un commentaire tapé à la main.
 */
import { z } from 'zod';

/**
 * Le suivi d'une ligne, dans l'ordre où elle avance. Les sept premiers
 * reprennent la légende du classeur, ses libellés et ses couleurs : rouge
 * pour ce qui n'est pas commandé, jaune pour ce qui attend, vert pour ce qui
 * est parti chez le fournisseur ou disponible, bleu pour ce qui se traite.
 * « Livré » manquait — les livraisons étaient notées dans la feuille des
 * paiements.
 */
export const STATUTS_ACHAT = [
  { code: 'en_attente', nom: 'En attente', description: 'Action requise — non commandé', ton: 'alerte' },
  { code: 'attente_validation_ref', nom: 'Attente validation réf.', description: 'Référence produit à confirmer', ton: 'attente' },
  { code: 'attente_validation', nom: 'En attente validation', description: 'Nécessite une validation avant commande', ton: 'attente' },
  { code: 'commande_preparee', nom: 'Commande préparée', description: 'Commande prête, en attente d’envoi', ton: 'attente' },
  { code: 'commande_envoyee', nom: 'Commande envoyée', description: 'Bon de commande transmis au fournisseur', ton: 'ok' },
  { code: 'en_cours', nom: 'En cours', description: 'Commande en traitement', ton: 'cyan' },
  { code: 'disponible', nom: 'Disponible', description: 'Matériel disponible chez le fournisseur', ton: 'ok' },
  { code: 'livre', nom: 'Livré', description: 'Matériel reçu', ton: 'ok' },
];
export const CODES_STATUT_ACHAT = STATUTS_ACHAT.map((s) => s.code);
export const statutAchat = (code) => STATUTS_ACHAT.find((s) => s.code === code) ?? STATUTS_ACHAT[0];

/** Commandée mais pas encore reçue : une livraison est attendue. */
export const STATUTS_COMMANDES = ['commande_envoyee', 'en_cours', 'disponible'];

/** Pas encore partie chez le fournisseur : le bon de commande la fera avancer. */
export const STATUTS_AVANT_ENVOI = ['en_attente', 'attente_validation_ref', 'attente_validation', 'commande_preparee'];

/**
 * Les pièces d'un fournisseur, et ce que leur dépôt fait tout seul. Le bon de
 * commande et la facture portent les prix : ils sont confidentiels.
 */
export const PIECES_FOURNISSEUR = [
  { code: 'BCF', nom: 'Bon de commande', effet: 'Les lignes passent en « Commande envoyée » et leur date de livraison se calcule.', confidentialite: 'confidentiel' },
  { code: 'BLF', nom: 'Bon de livraison', effet: 'Les lignes reçues passent en « Livré ».', confidentialite: 'interne' },
  { code: 'FACF', nom: 'Facture', effet: 'Le montant et la date se lisent sur la facture ; l’échéance se calcule.', confidentialite: 'confidentiel' },
];
export const CODES_PIECE = PIECES_FOURNISSEUR.map((p) => p.code);
export const pieceFournisseur = (code) => PIECES_FOURNISSEUR.find((p) => p.code === code);

/** Comment se paie une commande, et combien de jours après la facture. */
export const MODALITES_PAIEMENT = [
  { code: 'virement', nom: 'Virement', jours: 0 },
  { code: 'cheque', nom: 'Chèque', jours: 0 },
  { code: 'comptant', nom: 'Comptant', jours: 0 },
  { code: 'effet_30', nom: 'Effet à 30 jours', jours: 30 },
  { code: 'effet_60', nom: 'Effet à 60 jours', jours: 60 },
  { code: 'effet_90', nom: 'Effet à 90 jours', jours: 90 },
];
export const CODES_MODALITE = MODALITES_PAIEMENT.map((m) => m.code);
export const modalitePaiement = (code) => MODALITES_PAIEMENT.find((m) => m.code === code) ?? MODALITES_PAIEMENT[0];

/** Où en est le paiement d'une commande. */
export const ETATS_PAIEMENT = {
  avance_a_payer: { nom: 'Avance à payer', ton: 'attente' },
  reste_a_payer: { nom: 'Reste à payer', ton: 'cyan' },
  soldee: { nom: 'Soldée', ton: 'ok' },
};

/** La TVA marocaine sur le matériel, pour proposer un montant TTC. */
export const TVA = 0.2;

// ── Les calculs ─────────────────────────────────────────────────

const nombre = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const arrondi = (n) => Math.round(n * 100) / 100;

/** Prix unitaire × quantité, ou null sans prix. */
export function total(prixUnitaire, quantite) {
  const pu = nombre(prixUnitaire);
  const q = nombre(quantite);
  return pu === null || q === null ? null : arrondi(pu * q);
}

/** La marge sur le prix de vente : (vente − achat) / vente. Négative, on vend à perte. */
export function marge(puAchat, puVente) {
  const a = nombre(puAchat);
  const v = nombre(puVente);
  return a === null || v === null || v === 0 ? null : (v - a) / v;
}

/** « 47,1 % » ; « −181,5 % ». */
export function pourcent(fraction) {
  if (fraction === null || fraction === undefined) return '—';
  return `${(fraction * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

/** « 2026-07-20 » → « 20/07/2026 ». */
export function dateFr(iso) {
  if (!iso) return '—';
  const [a, m, j] = String(iso).slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
}

/** Une référence réduite à ses lettres et chiffres : « S6730-H24X6C » vaut « s6730 h24x6c ». */
const referencePlate = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * Ce qui demande l'attention sur une ligne, du plus grave au moins grave.
 * Les alertes de prix ne sont calculées que pour qui a le droit de les voir.
 *
 * @param {object} ligne  les champs d'une ligne ; etd en « AAAA-MM-JJ »
 * @param {{ aujourdhui?: string, prix?: boolean }} [options]
 */
export function alertesLigne(ligne, { aujourdhui = new Date().toISOString().slice(0, 10), prix = true } = {}) {
  const alertes = [];
  const m = marge(ligne.puAchat, ligne.puVente);
  if (prix && m !== null && m < 0) {
    alertes.push({ code: 'marge_negative', ton: 'alerte', message: `Vendu moins cher qu’acheté : marge de ${pourcent(m)}` });
  }
  if (ligne.etd && STATUTS_COMMANDES.includes(ligne.statut) && String(ligne.etd).slice(0, 10) < aujourdhui) {
    alertes.push({ code: 'retard', ton: 'alerte', message: `Livraison attendue le ${dateFr(ligne.etd)}, pas encore reçue` });
  }
  const budget = nombre(ligne.puBudget);
  const achat = nombre(ligne.puAchat);
  if (prix && budget && achat !== null && achat > budget) {
    alertes.push({ code: 'budget_depasse', ton: 'attente', message: `Acheté au-dessus du budget de l’appel d’offres : +${pourcent((achat - budget) / budget)}` });
  }
  if (ligne.referenceOffre && ligne.referenceAchat && referencePlate(ligne.referenceOffre) !== referencePlate(ligne.referenceAchat)) {
    alertes.push({ code: 'reference_differente', ton: 'attente', message: 'La référence achetée diffère de celle de l’offre technique' });
  }
  if (prix && achat === null && nombre(ligne.puVente) !== null) {
    alertes.push({ code: 'sans_prix_achat', ton: 'neutre', message: 'Pas encore de prix d’achat : la marge globale ne compte pas cette ligne' });
  }
  return alertes;
}

/**
 * Les totaux d'une liste de lignes.
 *
 * La marge ne compte que les lignes qui ont à la fois un prix d'achat et un
 * prix de vente : le classeur divisait par toute la vente, y compris celle
 * du matériel pas encore chiffré, et surestimait la marge.
 */
export function resumeAchats(lignes, { aujourdhui } = {}) {
  let budget = 0;
  let achat = 0;
  let vente = 0;
  let achatVendu = 0;
  let venteChiffree = 0;
  let lignesSansAchat = 0;
  let enRetard = 0;
  const parStatut = Object.fromEntries(CODES_STATUT_ACHAT.map((c) => [c, 0]));
  for (const l of lignes) {
    const b = total(l.puBudget, l.quantite);
    const a = total(l.puAchat, l.quantite);
    const v = total(l.puVente, l.quantite);
    if (b !== null) budget += b;
    if (a !== null) achat += a;
    if (v !== null) vente += v;
    if (a !== null && v !== null) {
      achatVendu += a;
      venteChiffree += v;
    } else if (v !== null) {
      lignesSansAchat += 1;
    }
    parStatut[l.statut] = (parStatut[l.statut] ?? 0) + 1;
    if (alertesLigne(l, { aujourdhui, prix: false }).some((x) => x.code === 'retard')) enRetard += 1;
  }
  return {
    lignes: lignes.length,
    budget: arrondi(budget),
    achat: arrondi(achat),
    vente: arrondi(vente),
    marge: venteChiffree ? (venteChiffree - achatVendu) / venteChiffree : null,
    lignesSansAchat,
    parStatut,
    enRetard,
  };
}

/** « 2026-06-12 » plus 21 jours → « 2026-07-03 ». */
export function ajouterJours(iso, jours) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** L'échéance d'un paiement : la date de facture, plus le délai de la modalité. */
export function echeanceDe(dateFacture, modalite) {
  return dateFacture ? ajouterJours(dateFacture, modalitePaiement(modalite).jours) : null;
}

/**
 * L'avance, le reste, l'échéance et l'état d'une commande. Une échéance
 * saisie à la main (un effet daté) l'emporte sur celle qu'on calcule.
 *
 * Tant que la facture n'est pas arrivée, le montant est estimé d'après les
 * lignes (`montantEstime`) : on sait déjà ce que coûtera l'avance.
 */
export function paiementCommande(c) {
  const saisi = nombre(c.montantTtc);
  const ttc = saisi ?? nombre(c.montantEstime) ?? 0;
  const avance = arrondi((ttc * (nombre(c.avancePourcent) ?? 0)) / 100);
  const reste = arrondi(ttc - avance);
  const echeance = c.echeance ? String(c.echeance).slice(0, 10) : echeanceDe(c.dateFacture, c.modalite);
  // Tout payé d'avance (« 100 % à la commande ») : l'avance solde la commande.
  const soldee = Boolean(c.soldePayeLe) || (Boolean(c.avancePayeeLe) && ttc > 0 && reste <= 0);
  const etat = soldee ? 'soldee' : avance > 0 && !c.avancePayeeLe ? 'avance_a_payer' : 'reste_a_payer';
  return { avance, reste, echeance, etat, estime: saisi === null };
}

/** Ce que coûtent des lignes, TVA comprise ; null si l'une n'a pas encore son prix d'achat. */
export function ttcDesLignes(lignes) {
  if (!lignes.length || lignes.some((l) => nombre(l.puAchat) === null)) return null;
  return arrondi(lignes.reduce((s, l) => s + (total(l.puAchat, l.quantite) ?? 0), 0) * (1 + TVA));
}

/**
 * L'écart entre la facture et les lignes commandées, TVA comprise, s'il
 * dépasse un dirham et un demi pour cent — le classeur avait trois factures
 * qui ne tombaient pas juste, et personne ne le voyait.
 */
export function ecartFacture(montantTtc, montantLignesTtc) {
  const facture = nombre(montantTtc);
  const lignes = nombre(montantLignesTtc);
  if (facture === null || !lignes) return null;
  const ecart = arrondi(facture - lignes);
  return Math.abs(ecart) > Math.max(1, lignes * 0.005) ? ecart : null;
}

/** Les paiements à prévoir, par urgence : ce que les calculs de côté de la feuille « PAIEMENT » additionnaient à la main. */
export const GROUPES_PAIEMENT = [
  { code: 'retard', nom: 'En retard', ton: 'alerte' },
  { code: 'avances', nom: 'Avances à payer', note: 'La commande attend l’avance', ton: 'alerte' },
  { code: 'semaine', nom: 'Cette semaine', note: 'Échéance dans les 7 jours', ton: 'attente' },
  { code: 'plus_tard', nom: 'Plus tard', ton: 'neutre' },
  { code: 'a_la_facture', nom: 'À la réception de la facture', note: 'L’échéance se calculera sur la facture', ton: 'neutre' },
];

/**
 * @param {object[]} commandes  avec leurs montants (saisi ou estimé) et leurs dates
 * @param {{ aujourdhui: string }} options
 */
export function paiementsAPrevoir(commandes, { aujourdhui }) {
  const dansUneSemaine = ajouterJours(aujourdhui, 7);
  const paiements = [];
  for (const c of commandes) {
    const p = paiementCommande(c);
    if (p.etat === 'soldee') continue;
    if (p.etat === 'avance_a_payer') {
      paiements.push({ commande: c, nature: 'avance', montant: p.avance, echeance: null, groupe: 'avances', estime: p.estime });
    } else if (p.reste > 0) {
      const groupe = !p.echeance ? 'a_la_facture' : p.echeance < aujourdhui ? 'retard' : p.echeance <= dansUneSemaine ? 'semaine' : 'plus_tard';
      paiements.push({ commande: c, nature: 'solde', montant: p.reste, echeance: p.echeance, groupe, estime: p.estime });
    }
  }
  const ordre = GROUPES_PAIEMENT.map((g) => g.code);
  paiements.sort((a, b) => ordre.indexOf(a.groupe) - ordre.indexOf(b.groupe) || (a.echeance ?? '').localeCompare(b.echeance ?? ''));
  const totaux = Object.fromEntries(ordre.map((g) => [g, arrondi(paiements.filter((p) => p.groupe === g).reduce((s, p) => s + p.montant, 0))]));
  // Tout ce qui reste dû, avance comprise quand elle attend encore.
  const engage = arrondi(
    commandes.reduce((s, c) => {
      const p = paiementCommande(c);
      return p.etat === 'soldee' ? s : s + p.reste + (p.etat === 'avance_a_payer' ? p.avance : 0);
    }, 0),
  );
  return { paiements, totaux, engage };
}

// ── Ce qui se lit dans les textes libres ────────────────────────

/** Sans accents ni majuscules : « Chèque à 60 Jours » → « cheque a 60 jours ». */
const simple = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase();

/** Ce que vaut « disponible » : le temps de préparer et de livrer. */
const JOURS_SI_DISPONIBLE = 7;

/**
 * Le délai écrit par le fournisseur, en jours. On compte au plus long —
 * c'est la date qu'on peut promettre : « 6 à 8 semaines » → 56, « 3-5 sem. »
 * → 35, « 45 jours » → 45, « disponible » → 7. Un délai compté « dès
 * l'acompte » part du paiement de l'avance, pas de la commande.
 *
 * @returns {{ jours: number|null, depuisAcompte: boolean } | null}
 */
export function lireDelai(texte) {
  const t = simple(texte);
  if (!t.trim()) return null;
  const depuisAcompte = /acompte|avance/.test(t);
  let jours = null;
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)(?:\s*(?:a|-|–|ou)\s*(\d+(?:[.,]\d+)?))?\s*(semaines?|sem|jours?|jrs?|j|mois|heures?|h)\b/g)) {
    const valeur = Number((m[2] ?? m[1]).replace(',', '.'));
    const unite = m[3].startsWith('sem') ? 7 : m[3] === 'mois' ? 30 : m[3].startsWith('h') ? 1 / 24 : 1;
    jours = Math.max(jours ?? 0, Math.ceil(valeur * unite));
  }
  if (jours === null && /disponible|en stock|immediat/.test(t)) jours = JOURS_SI_DISPONIBLE;
  if (jours === null && !depuisAcompte) return null;
  return { jours, depuisAcompte };
}

/**
 * La livraison qu'on peut attendre : la date de commande — ou celle du
 * paiement de l'avance, pour un délai compté dès l'acompte — plus le délai.
 */
export function livraisonPrevue({ delaiLivraison, dateCommande, avancePayeeLe }) {
  const d = lireDelai(delaiLivraison);
  if (!d || d.jours === null) return null;
  const depart = d.depuisAcompte ? avancePayeeLe : dateCommande;
  return depart ? ajouterJours(depart, d.jours) : null;
}

/**
 * L'avance et la modalité écrites dans les conditions du fournisseur :
 * « 13% Avance / 87% à 60 Jours » → 13 %, effet à 60 jours ;
 * « 50% commande / 50% livraison » → 50 %, virement ; « Comptant ».
 *
 * @returns {{ avancePourcent: number|null, modalite: string|null } | null}
 */
export function lireConditions(texte) {
  const t = simple(texte);
  if (!t.trim()) return null;
  const avance = /(\d+(?:[.,]\d+)?)\s*%[^%\d]{0,16}?(?:avance|acompte|commande)/.exec(t) ?? /(?:avance|acompte)[^%\d]{0,12}(\d+(?:[.,]\d+)?)\s*%/.exec(t);
  const pourcentage = avance ? Number(avance[1].replace(',', '.')) : null;
  const avancePourcent = pourcentage !== null && pourcentage <= 100 ? pourcentage : null;
  const jours = /(\d{2,3})\s*(?:jours?|jrs?|j)\b/.exec(t);
  let modalite = null;
  if (jours && CODES_MODALITE.includes(`effet_${jours[1]}`)) modalite = `effet_${jours[1]}`;
  else if (/comptant|espece/.test(t)) modalite = 'comptant';
  else if (/cheque/.test(t)) modalite = 'cheque';
  // Une avance sans autre précision : le solde se règle par virement.
  else if (/virement/.test(t) || avancePourcent !== null) modalite = 'virement';
  if (avancePourcent === null && modalite === null) return null;
  return { avancePourcent, modalite };
}

/** « 1 234 567,89 », « 1.234.567,89 » ou « 1,234,567.89 » → 1234567.89 ; « 12.500 » → 12500. */
export function lireMontant(brut) {
  const s = String(brut ?? '').replace(/[\s  ']/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const dernier = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  // Un ou deux chiffres après le dernier séparateur : ce sont des décimales.
  // Trois : c'était un séparateur de milliers.
  const decimales = dernier > -1 && s.length - dernier - 1 <= 2;
  const entier = (decimales ? s.slice(0, dernier) : s).replace(/[.,]/g, '');
  const n = Number(decimales ? `${entier}.${s.slice(dernier + 1)}` : entier);
  return Number.isFinite(n) ? n : null;
}

const NOMBRE = /\d{1,3}(?:[   .]\d{3})+(?:[.,]\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?/;
const ETIQUETTE_TTC = /(?:total|montant|net)\s*(?:general\s*)?(?:a\s*payer\s*)?t\.?\s*t\.?\s*c\.?|net\s*a\s*payer|total\s*a\s*payer/g;
const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

function dateValide(annee, mois, jour) {
  const a = Number(annee) < 100 ? Number(annee) + 2000 : Number(annee);
  const d = new Date(Date.UTC(a, Number(mois) - 1, Number(jour)));
  // Le 31/02 déborde sur mars : ce n'est pas une date.
  if (a < 2000 || a > 2100 || d.getUTCMonth() !== Number(mois) - 1 || d.getUTCDate() !== Number(jour)) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Le montant TTC, la date et le numéro d'une facture, lus dans son texte —
 * celui du PDF, ou la lecture (OCR) d'un scan. Ce qui n'est pas sûr reste
 * vide ; l'écran montre ce qui a été lu, pour qu'on le vérifie.
 */
export function lireFacture(texte) {
  const t = simple(texte);

  // Le montant : le plus grand de ceux qu'annonce une étiquette « TTC » ou
  // « net à payer » (une colonne « montant TTC » précède aussi des lignes).
  const montants = [];
  for (const m of t.matchAll(ETIQUETTE_TTC)) {
    const suite = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const n = NOMBRE.exec(suite);
    const v = n ? lireMontant(n[0]) : null;
    if (v) montants.push(v);
  }

  // La date : celle qu'annonce « date » (pas celle de l'échéance ni de la
  // livraison), sinon celle qui suit « le », sinon la première du texte.
  const dates = [];
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) dates.push({ index: m.index, iso: dateValide(m[3], m[2], m[1]) });
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${MOIS.join('|')})\\s+(\\d{4})\\b`, 'g'))) {
    dates.push({ index: m.index, iso: dateValide(m[3], MOIS.indexOf(m[2]) + 1, m[1]) });
  }
  const valides = dates.filter((d) => d.iso).sort((a, b) => a.index - b.index);
  const annoncee = (mot) =>
    valides.find((d) => {
      const avant = t.slice(Math.max(0, d.index - 40), d.index);
      const etiquette = new RegExp(`\\b${mot}\\b[^\\d\\n]{0,22}$`).exec(avant);
      if (!etiquette) return false;
      // « Date d'échéance », « livrée le » : ce n'est pas la date de la facture.
      const contexte = mot === 'le' ? avant.slice(Math.max(0, etiquette.index - 20)) : etiquette[0];
      return !/echeance|livr|commande|expedi|validite/.test(contexte);
    });
  const horsContexte = (d) => !/echeance|livr|commande|expedi|validite/.test(t.slice(Math.max(0, d.index - 30), d.index));
  const date = annoncee('date') ?? annoncee('le') ?? valides.find(horsContexte);

  const numero = /facture\s*(?:n\s*[°ºo.:]|num(?:ero)?\.?)\s*[:.]?\s*([a-z0-9/_.-]*\d[a-z0-9/_.-]*)/.exec(t);

  return {
    montantTtc: montants.length ? Math.max(...montants) : null,
    dateFacture: date?.iso ?? null,
    numero: numero ? numero[1].toUpperCase() : null,
  };
}

// ── Ce qu'il reste à faire ──────────────────────────────────────

const formatEntier = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
/** « 22 320 DH ». */
export const enDh = (n) => (n === null || n === undefined ? '—' : `${formatEntier.format(n)} DH`);
const pourcentageAvance = (c) => `${Number(c.avancePourcent).toLocaleString('fr-FR')} %`;

/**
 * La prochaine chose à faire pour une ligne — c'est la colonne « ETD /
 * commentaire » du tableau de bord, qu'on remplissait à la main (« Manque
 * avance 30% », « Il faut préparer le paiement »). Ici elle se déduit.
 *
 * @param {object} ligne     statut, etd, delaiLivraison, fournisseur
 * @param {object|null} commande  sa commande, avec son paiement (paiementCommande)
 * @param {{ aujourdhui: string, prix?: boolean }} options  sans les prix, aucun montant ni condition
 * @returns {{ code: string, texte: string, ton: string }}
 */
export function prochaineAction(ligne, commande, { aujourdhui, prix = false }) {
  const s = ligne.statut;
  const paiement = commande ? { ...commande, ...paiementCommande(commande) } : null;
  if (s === 'livre') {
    if (paiement && prix && paiement.etat !== 'soldee') {
      if (paiement.montantTtc === null || paiement.montantTtc === undefined) return { code: 'facture', texte: 'Livré — facture à recevoir', ton: 'neutre' };
      if (paiement.echeance && paiement.echeance < aujourdhui) return { code: 'paiement_retard', texte: `Livré — ${enDh(paiement.reste)} à payer depuis le ${dateFr(paiement.echeance)}`, ton: 'alerte' };
      return { code: 'paiement', texte: `Livré — ${enDh(paiement.reste)} à payer${paiement.echeance ? ` le ${dateFr(paiement.echeance)}` : ''}`, ton: 'neutre' };
    }
    return { code: 'livre', texte: 'Livré', ton: 'ok' };
  }
  if (s === 'en_attente') {
    if (!ligne.fournisseur) return { code: 'fournisseur', texte: 'Choisir le fournisseur', ton: 'alerte' };
    if (!commande) return { code: 'commander', texte: 'Créer la commande', ton: 'alerte' };
    return { code: 'envoyer', texte: 'Envoyer le bon de commande', ton: 'alerte' };
  }
  if (s === 'attente_validation_ref') return { code: 'reference', texte: 'Faire confirmer la référence', ton: 'attente' };
  if (s === 'attente_validation') return { code: 'validation', texte: 'Faire valider la commande', ton: 'attente' };
  if (s === 'commande_preparee') return { code: 'envoyer', texte: 'Envoyer le bon de commande', ton: 'attente' };

  // Commandée : l'avance d'abord, puis la livraison.
  const delai = lireDelai(ligne.delaiLivraison);
  const suite = delai?.depuisAcompte ? ' : la livraison en dépend' : '';
  if (paiement?.etat === 'avance_a_payer') {
    const texte = prix ? `Payer l’avance de ${pourcentageAvance(paiement)} (${enDh(paiement.avance)})${suite}` : `Attend le paiement de l’avance${suite}`;
    return { code: 'avance', texte, ton: 'alerte' };
  }
  if (s === 'disponible') return { code: 'recuperer', texte: 'Disponible chez le fournisseur : organiser la livraison', ton: 'cyan' };
  const etd = ligne.etd ? String(ligne.etd).slice(0, 10) : null;
  if (etd && etd < aujourdhui) return { code: 'retard', texte: `Relancer le fournisseur : attendu le ${dateFr(etd)}`, ton: 'alerte' };
  if (etd) return { code: 'attendre', texte: `Livraison prévue le ${dateFr(etd)}`, ton: 'neutre' };
  if (delai?.depuisAcompte && !paiement?.avancePayeeLe) return { code: 'acompte', texte: 'Délai compté dès l’acompte : noter son paiement', ton: 'attente' };
  return { code: 'date', texte: 'Demander la date de livraison', ton: 'attente' };
}

/**
 * La prochaine chose à faire pour une commande entière, d'après ses lignes :
 * l'en-tête de son groupe dans le suivi des commandes.
 *
 * @param {object} commande  avec son paiement et ses pièces (codes des types déposés)
 * @param {object[]} lignes  statut, etd, delaiLivraison
 */
export function prochaineActionCommande(commande, lignes, { aujourdhui, prix = true }) {
  const paiement = { ...commande, ...paiementCommande(commande) };
  const aRecevoir = lignes.filter((l) => l.statut !== 'livre');
  if (!aRecevoir.length) {
    if (paiement.etat === 'soldee') return { code: 'terminee', texte: 'Livrée et payée', ton: 'ok' };
    if (!prix) return { code: 'livree', texte: 'Livrée', ton: 'ok' };
    if (paiement.montantTtc === null || paiement.montantTtc === undefined) return { code: 'facture', texte: 'Livrée : demander la facture', ton: 'attente' };
    if (paiement.echeance && paiement.echeance < aujourdhui) return { code: 'paiement_retard', texte: `Payer ${enDh(paiement.reste)} : échéance dépassée depuis le ${dateFr(paiement.echeance)}`, ton: 'alerte' };
    return { code: 'paiement', texte: `Payer ${enDh(paiement.reste)}${paiement.echeance ? ` le ${dateFr(paiement.echeance)}` : ''}`, ton: 'neutre' };
  }
  if (aRecevoir.some((l) => l.statut === 'attente_validation' || l.statut === 'attente_validation_ref')) {
    return { code: 'validation', texte: 'Faire valider avant d’envoyer la commande', ton: 'attente' };
  }
  if (aRecevoir.some((l) => STATUTS_AVANT_ENVOI.includes(l.statut))) return { code: 'envoyer', texte: 'Envoyer le bon de commande', ton: 'alerte' };
  if (paiement.etat === 'avance_a_payer') {
    const suite = aRecevoir.some((l) => lireDelai(l.delaiLivraison)?.depuisAcompte) ? ' : la livraison en dépend' : '';
    return { code: 'avance', texte: prix ? `Payer l’avance de ${pourcentageAvance(paiement)} (${enDh(paiement.avance)})${suite}` : `Attend le paiement de l’avance${suite}`, ton: 'alerte' };
  }
  const dates = aRecevoir.map((l) => (l.etd ? String(l.etd).slice(0, 10) : null)).filter(Boolean).sort();
  if (dates.length && dates[0] < aujourdhui) return { code: 'retard', texte: `Relancer le fournisseur : attendu le ${dateFr(dates[0])}`, ton: 'alerte' };
  if (aRecevoir.some((l) => l.statut === 'disponible')) return { code: 'recuperer', texte: 'Disponible chez le fournisseur : organiser la livraison', ton: 'cyan' };
  if (dates.length) return { code: 'attendre', texte: `Livraison prévue le ${dateFr(dates[0])}`, ton: 'neutre' };
  return { code: 'date', texte: 'Demander la date de livraison', ton: 'attente' };
}

// ── Les formulaires ─────────────────────────────────────────────

/** « 433 100,50 » ou « 433100.5 » → 433100.5 ; vide → null. */
const saisieNombre = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isNaN(n) ? v : n;
};
const texte = (max) =>
  z
    .string()
    .trim()
    .max(max, { error: `${max} caractères au plus.` })
    .transform((v) => v || null)
    .nullish();
const date = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Date invalide.' }).nullish());
const prix = z.preprocess(saisieNombre, z.number({ error: 'Un montant, en chiffres.' }).nonnegative({ error: 'Un montant positif.' }).max(1e12).nullish());

// Les valeurs par défaut ne valent qu'à la création : un schéma rendu
// partiel pour une modification les garderait, et une correction du prix
// remettrait le statut à « En attente ».
const champsLigneAchat = {
  marcheId: z.coerce.number({ error: 'Choisissez le marché.' }).int().positive({ error: 'Choisissez le marché.' }),
  numero: texte(20),
  categorie: z.string({ error: 'Indiquez la catégorie.' }).trim().min(1, { error: 'Indiquez la catégorie.' }).max(80, { error: '80 caractères au plus.' }),
  designation: z.string({ error: 'Décrivez le matériel.' }).trim().min(2, { error: 'Décrivez le matériel.' }).max(255, { error: '255 caractères au plus.' }),
  quantite: z.preprocess(saisieNombre, z.number({ error: 'Indiquez la quantité.' }).positive({ error: 'Une quantité positive.' }).max(1e7)),
  puBudget: prix,
  puAchat: prix,
  puVente: prix,
  marque: texte(120),
  referenceOffre: texte(160),
  referenceAchat: texte(160),
  fournisseur: texte(160),
  conditionsPaiement: texte(160),
  delaiLivraison: texte(120),
  statut: z.enum(CODES_STATUT_ACHAT, { error: 'Choisissez un statut.' }),
  etd: date,
  commentaire: texte(2000),
};
export const schemaLigneAchat = z.object({ ...champsLigneAchat, statut: champsLigneAchat.statut.default('en_attente') });
export const schemaModificationLigneAchat = z.object(champsLigneAchat).partial();

export const schemaFournisseur = z.object({
  nom: z.string({ error: 'Saisissez le nom du fournisseur.' }).trim().min(2, { error: 'Au moins 2 caractères.' }).max(160, { error: '160 caractères au plus.' }),
  contact: texte(160),
  telephone: texte(40),
  email: z.preprocess((v) => (v === '' ? null : v), z.email({ error: 'Adresse e-mail invalide.' }).nullish()),
  conditions: texte(255),
  notes: texte(2000),
});

const champsCommande = {
  marcheId: z.coerce.number({ error: 'Choisissez le marché.' }).int().positive({ error: 'Choisissez le marché.' }),
  fournisseurId: z.coerce.number({ error: 'Choisissez le fournisseur.' }).int().positive({ error: 'Choisissez le fournisseur.' }),
  lignes: z.array(z.coerce.number().int().positive()).max(500),
  // Vide jusqu'à la facture : l'écran l'estime d'après les lignes.
  montantTtc: z.preprocess(saisieNombre, z.number({ error: 'Un montant, en chiffres.' }).positive({ error: 'Un montant positif.' }).max(1e12).nullish()),
  avancePourcent: z.preprocess(saisieNombre, z.number({ error: 'Un pourcentage, en chiffres.' }).min(0).max(100, { error: '100 % au plus.' }).nullish()),
  modalite: z.enum(CODES_MODALITE, { error: 'Choisissez la modalité de paiement.' }),
  dateCommande: date,
  dateFacture: date,
  echeance: date,
  avancePayeeLe: date,
  soldePayeLe: date,
  notes: texte(2000),
};
export const schemaCommande = z.object({ ...champsCommande, lignes: champsCommande.lignes.default([]) });
export const schemaModificationCommande = z.object(champsCommande).partial();

/** « Créer la commande » depuis les lignes d'un même fournisseur. */
export const schemaCommandeDepuisLignes = z.object({
  lignes: z.array(z.coerce.number().int().positive()).min(1, { error: 'Choisissez au moins une ligne.' }).max(500),
});

/** Le dépôt d'une pièce de fournisseur : son type, sa date, et pour une livraison partielle, les lignes reçues. */
export const schemaPieceFournisseur = z.object({
  type: z.enum(CODES_PIECE, { error: 'Choisissez le type de pièce.' }),
  date,
  lignes: z.array(z.coerce.number().int().positive()).max(500).optional(),
});
