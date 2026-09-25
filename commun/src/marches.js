/**
 * Les règles de marché (§5 du cahier des charges) : normaliser une référence,
 * en tirer le lot, déduire la phase, dire ce qui manque, calculer l'échéance.
 *
 * Elles sont ici, dans « commun », parce que le serveur les applique et que
 * les écrans les affichent. Une règle écrite deux fois finit par diverger.
 */

// ── Les confusions de l'OCR sur ces scans (§5) ───────────────────
// L'OCR lit tantôt une lettre, tantôt le chiffre qui lui ressemble ; et sur
// les codes d'organisme, T, F et E se confondent, comme G et C.
const CONFUSIONS = { 0: 'O', 1: 'I', 5: 'S', 6: 'G', 8: 'B', F: 'T', E: 'T', C: 'G', Q: 'O' };

/** Le suffixe de lot : 23A, 23B, 23C — que l'OCR rend souvent par un chiffre. */
const SUFFIXE_LOT = /^(\d{2})([A-Z0-9])$/;

const ANNEE_LONGUE = /^(?:19|20)\d{3,}$/;

/**
 * Les années de quatre chiffres qu'une lecture trop longue peut cacher.
 *
 * L'OCR ajoute parfois un chiffre : « 20114 » peut être 2011 comme 2014.
 * Deviner serait arbitraire ; on rend donc toutes les lectures plausibles,
 * et c'est le rapprochement avec les autres pièces qui départage.
 */
function anneesPossibles(p) {
  if (!ANNEE_LONGUE.test(p)) return [p];
  const sortie = new Set();
  for (let i = 0; i < p.length; i++) {
    const essai = p.slice(0, i) + p.slice(i + 1);
    if (/^(?:19|20)\d\d$/.test(essai)) sortie.add(essai);
  }
  return sortie.size ? [...sortie] : [p];
}

/**
 * Toutes les clés sous lesquelles une référence peut être reconnue.
 *
 * Une lecture certaine en donne une seule ; une année visiblement fautive en
 * donne autant que de corrections plausibles. Deux références désignent la
 * même affaire dès que leurs jeux de clés se croisent.
 *
 * @param {string} reference
 * @returns {string[]}
 */
export function formesReference(reference) {
  const r = String(reference ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^[./-]+|[./-]+$/g, '');
  if (!r) return [];

  if (!r.includes('/')) {
    // MAR202200027 et 202200027 sont le même marché : le contrat porte le
    // préfixe, les bons de livraison l'omettent.
    //
    // On garde TOUS les chiffres. Le cahier des charges n'en retenait que
    // cinq, par tolérance aux chiffres que l'OCR ajoute ou perd ; mais le
    // fonds contient MAR202200027 et MAR202200096 — deux marchés bien
    // distincts que cette troncature confondait. La tolérance à l'OCR est
    // reportée sur memeAffaire(), qui accepte un chiffre d'écart.
    const nu = r.startsWith('MAR') ? r.slice(3) : r;
    return [/^\d{8,}$/.test(nu) ? `MAR${nu}` : r];
  }

  const parts = r.split('/').map((p, i) => {
    // Un code d'organisme (TGR, DRCA, HB…) se compare à confusions près.
    if (/[A-Z]/.test(p) && !/^\d/.test(p)) {
      return [...p].map((c) => CONFUSIONS[c] ?? c).join('');
    }
    // Le numéro de tête s'écrit « 04 » ou « 4 » selon les pièces : on retire
    // les zéros de tête pour que les deux lectures se rejoignent.
    if (i === 0 && /^0\d+$/.test(p)) return String(Number(p));
    return p;
  });

  // « 23A », « 23B » et « 23C » sont trois lots du marché 23. La règle ne vaut
  // que pour une référence à trois segments : sans cette réserve,
  // « 639/SAM/FRA/2022 » — quatre segments — perdrait son 9.
  if (parts.length === 3) {
    const m = SUFFIXE_LOT.exec(parts[0]);
    if (m) parts[0] = m[1];
  }

  // Chaque position qui ressemble à une année longue ouvre plusieurs lectures.
  let cles = [''];
  parts.forEach((p, i) => {
    const sep = i ? '/' : '';
    const suivantes = [];
    for (const debut of cles) for (const v of anneesPossibles(p)) suivantes.push(debut + sep + v);
    cles = suivantes;
  });
  return [...new Set(cles)];
}

/** La clé principale d'une référence : celle qui sert d'identifiant unique. */
export function normaliserReference(reference) {
  const formes = formesReference(reference);
  return formes.length ? formes.slice().sort()[0] : '';
}

/**
 * Deux lectures ne diffèrent-elles que d'un caractère ajouté ou perdu ?
 *
 * C'est la faute type de l'OCR sur les longues suites de chiffres :
 * « 20220027 » pour « 202200027 ». Une différence de deux caractères, ou un
 * caractère remplacé, n'est pas tolérée : 202200027 et 202200096 sont deux
 * marchés, pas deux lectures du même.
 */
function unCaractereDEcart(a, b) {
  if (Math.abs(a.length - b.length) !== 1) return false;
  const [court, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < court.length && court[i] === long[i]) i += 1;
  return court.slice(i) === long.slice(i + 1);
}

/** Deux références désignent-elles la même affaire ? */
export function memeAffaire(a, b) {
  const fa = formesReference(a);
  const fb = formesReference(b);
  if (fa.some((f) => fb.includes(f))) return true;
  // Tolérance à l'OCR, réservée aux numéros sans séparateur (MAR…).
  return fa.some((x) => fb.some((y) => x.startsWith('MAR') && y.startsWith('MAR') && unCaractereDEcart(x, y)));
}

/**
 * Le couple (numéro, année) d'une référence, quand il se lit.
 *
 * Sert à rapprocher deux écritures d'une même affaire qui ne portent pas le
 * même nombre de segments : « 639/2022 », tiré du nom d'un dossier, et
 * « 639/SAM/FRA/2022 », lu dans le contrat lui-même.
 */
export function numeroEtAnnee(reference) {
  const r = String(reference ?? '').toUpperCase().replace(/\s+/g, '');
  const parts = r.split('/');
  if (parts.length < 2) return null;
  const numero = /^(\d{1,5})[A-Z]?$/.exec(parts[0])?.[1];
  const annee = parts.find((p) => /^(?:19|20)\d\d$/.test(p));
  return numero && annee ? { numero: String(Number(numero)), annee } : null;
}

/**
 * Deux références peuvent-elles désigner la même affaire écrite autrement ?
 * Moins sûr que memeAffaire() : à ne proposer qu'avec un garde-fou (le même
 * client, par exemple).
 */
export function memeNumeroEtAnnee(a, b) {
  const x = numeroEtAnnee(a);
  const y = numeroEtAnnee(b);
  return Boolean(x && y && x.numero === y.numero && x.annee === y.annee);
}

/**
 * Le lot lu dans une référence à trois segments (23A/2017/TGR → « A »), ou
 * null. Le lot est stocké à part : il distingue trois marchés d'un même
 * appel d'offres.
 */
export function extraireLot(reference) {
  const r = String(reference ?? '').toUpperCase().replace(/\s+/g, '');
  const parts = r.split('/');
  if (parts.length !== 3) return null;
  const m = SUFFIXE_LOT.exec(parts[0]);
  if (!m) return null;
  // L'OCR rend la lettre par un chiffre : 238 pour 23B, 234 pour 23A.
  const brut = m[2];
  return /\d/.test(brut) ? (CONFUSIONS[brut] ?? brut) : brut;
}

// ── Les six pièces attendues, dans l'ordre du cycle (§5) ─────────
export const PIECES_CYCLE = [
  { cle: 'os', code: 'OS', titre: 'OS', nom: 'Ordre de service', role: "ouvre l'exécution" },
  { cle: 'bl', code: 'BL', titre: 'BL', nom: 'Bon de livraison', role: 'atteste la fourniture' },
  { cle: 'pvp', code: 'PVP', titre: 'PV prov.', nom: 'PV de réception provisoire', role: 'ouvre le délai de garantie' },
  { cle: 'pvd', code: 'PVD', titre: 'PV déf.', nom: 'PV de réception définitive', role: 'ferme la garantie' },
  { cle: 'att', code: 'ATT', titre: 'Attest.', nom: 'Attestation de référence', role: "valorise l'affaire" },
  { cle: 'mlv', code: 'MLV', titre: 'Mainlevée', nom: 'Mainlevée de caution', role: 'clôt le marché' },
];

// ── Les phases, dans l'ordre du cycle ────────────────────────────
export const PHASES = {
  attente: { nom: "Attribué / en attente d'OS", court: "Attente d'OS", ton: 'neutre' },
  cours: { nom: 'En exécution', court: 'En exécution', ton: 'cyan' },
  provisoire: { nom: 'Réception provisoire', court: 'Réception prov.', ton: 'attente' },
  caution: { nom: 'Caution à récupérer', court: 'Caution à récupérer', ton: 'bordeaux' },
  cloture: { nom: 'Clôturé', court: 'Clôturé', ton: 'ok' },
};

export const ORDRE_PHASES = ['attente', 'cours', 'provisoire', 'caution', 'cloture'];

/**
 * La phase d'un marché, déduite des pièces présentes.
 *
 * Jamais saisie : une phase notée à la main se périme au versement suivant.
 * On lit le dossier en remontant le cycle, de la fin vers le début — la
 * dernière étape franchie donne la phase.
 *
 * L'attestation de référence clôt aussi le marché : le maître d'ouvrage ne la
 * délivre qu'une fois le travail fait et reçu. Beaucoup de marchés anciens ne
 * sont connus que par elle — le dossier d'exécution n'a jamais été numérisé.
 *
 * @param {{os?: boolean, bl?: boolean, pvp?: boolean, pvd?: boolean, att?: boolean, mlv?: boolean}} pieces
 */
export function phaseDe(pieces = {}) {
  if (pieces.mlv || pieces.att) return 'cloture';
  if (pieces.pvd) return 'caution'; // réception définitive sans mainlevée
  if (pieces.pvp) return 'provisoire';
  if (pieces.os) return 'cours';
  return 'attente';
}

// ── Appels d'offres et marchés ───────────────────────────────────

/** Les statuts d'une affaire qui n'est pas (ou pas encore) un marché gagné. */
export const STATUTS_APPEL_OFFRES = ['Projet préparé', 'AO en préparation', 'AO déposé', 'Perdu', 'Abandonné', 'Annulé'];

/** Les statuts d'une affaire gagnée. */
export const STATUTS_GAGNES = ['Gagné', 'En exécution', 'Terminé', 'Clôturé', 'Suspendu'];

/**
 * Les pièces qui prouvent qu'une affaire a été attribuée : le contrat, ce qui
 * l'exécute, ce qui le paie et ce qui le clôt. Une caution bancaire n'en fait
 * pas partie — la caution provisoire accompagne l'offre, avant tout résultat.
 */
export const PREUVES_ATTRIBUTION = ['CM', 'AV', 'BC', 'OS', 'BL', 'PVP', 'PVD', 'PVMD', 'RMS', 'FAC', 'DEC', 'ATT', 'MLV'];

/**
 * Une affaire est-elle un appel d'offres non gagné ?
 *
 * Le statut choisi à la main tranche d'abord : la machine ne peut pas savoir
 * qu'un AO a été perdu. Sans statut, on regarde le dossier : sans aucune
 * preuve d'attribution, ce n'est encore qu'une réponse à un appel d'offres.
 * Il devient un marché de lui-même dès qu'un contrat ou un OS est versé.
 *
 * @param {string[]} codes les codes des types de pièces présentes
 * @param {string | null} statutAffaire
 */
export function estAppelOffres(codes = [], statutAffaire = null) {
  if (STATUTS_APPEL_OFFRES.includes(statutAffaire)) return true;
  if (STATUTS_GAGNES.includes(statutAffaire)) return false;
  return !codes.some((c) => PREUVES_ATTRIBUTION.includes(c));
}

// ── Le statut d'un client ────────────────────────────────────────
export const STATUTS_CLIENT = {
  en_cours: { nom: 'Marchés en cours', ton: 'cyan' },
  clos: { nom: 'Marchés clôturés', ton: 'ok' },
  sans_marche: { nom: 'Sans marché', ton: 'neutre' },
};

/**
 * Le statut d'un client, déduit des phases de ses marchés.
 *
 * Comme la phase, il n'est jamais saisi : il suivrait sinon avec retard les
 * pièces versées. Un client « sans marché » n'est pas une anomalie — c'est
 * souvent un maître d'ouvrage connu seulement par une attestation de
 * référence.
 *
 * @param {string[]} phases les phases de ses marchés
 */
export function statutClient(phases = []) {
  if (phases.length === 0) return 'sans_marche';
  return phases.some((p) => p !== 'cloture') ? 'en_cours' : 'clos';
}

/**
 * Les pièces qui manquent à ce stade (§5).
 *
 * Une pièce n'est attendue que si le marché a dépassé l'étape qui la produit :
 * réclamer un PV définitif à un marché qui démarre n'aurait pas de sens.
 */
const ATTENDUES = {
  attente: [],
  cours: ['os'],
  provisoire: ['os', 'bl'],
  caution: ['os', 'bl', 'pvp'],
  cloture: ['os', 'bl', 'pvp', 'pvd'],
};

export function piecesManquantes(pieces = {}, phase = phaseDe(pieces)) {
  return ATTENDUES[phase].filter((cle) => !pieces[cle]);
}

/**
 * Une date ramenée à « AAAA-MM-JJ », qu'elle vienne d'un formulaire (texte)
 * ou de la base (objet Date).
 *
 * Sans ce passage, `String(date)` rendait « Wed Mar 01 2017 … », dont les dix
 * premiers caractères — « Wed Mar 01 » — étaient relus comme l'an 2001.
 */
function jour(valeur) {
  if (!valeur) return null;
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur.toISOString().slice(0, 10);
  const t = String(valeur).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/**
 * L'échéance : la date de fin si elle est connue, sinon l'OS plus le délai.
 * @returns {string|null} au format AAAA-MM-JJ
 */
export function echeanceDe({ dateFin, dateOs, delaiMois } = {}) {
  const fin = jour(dateFin);
  if (fin) return fin;
  const os = jour(dateOs);
  if (os && delaiMois) {
    const d = new Date(os);
    if (Number.isNaN(d.getTime())) return null;
    const quantieme = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + Number(delaiMois));
    // Le 31 janvier + 1 mois ne donne pas le 3 mars : on revient à la fin
    // du mois visé quand il est plus court.
    if (d.getUTCDate() < quantieme) d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * L'état d'une échéance : dépassée, proche (moins de 60 jours), ou lointaine.
 * Un marché clôturé n'a plus d'échéance qui compte.
 */
export function etatEcheance(echeance, phase, aujourdhui = new Date()) {
  if (!echeance || phase === 'cloture') return 'aucune';
  const jours = Math.ceil((new Date(`${echeance}T00:00:00Z`) - aujourdhui) / 86_400_000);
  if (jours < 0) return 'depassee';
  if (jours <= 60) return 'proche';
  return 'lointaine';
}

// ── Référentiels fermés (§4) ─────────────────────────────────────
export const STATUTS_AFFAIRE = [
  'Projet préparé',
  'AO en préparation',
  'AO déposé',
  'Gagné',
  'En exécution',
  'Terminé',
  'Clôturé',
  'Perdu',
  'Suspendu',
  'Abandonné',
  'Annulé',
];

export const CONSERVATIONS = ['3 ans', '5 ans', '10 ans', 'Illimitée'];

export const OBJETS_TECHNIQUES = ["Contrôle d'accès", 'Vidéosurveillance', "Système d'alarme", 'Détection incendie', 'Maintenance'];
