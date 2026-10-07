/**
 * Les marchés potentiels : les appels d'offres publiés ailleurs (portail des
 * marchés publics, flux, fichier), repérés et notés pour iCity.
 *
 * Partagé entre le serveur (validation, score, synchronisation) et les écrans
 * (libellés, couleurs, formulaires). Le score est un calcul déterministe,
 * fondé sur des critères modifiables : chaque point gagné a sa raison.
 */
import { z } from 'zod';

// ── Le cycle de traitement d'une offre ──────────────────────────────

export const STATUTS_OFFRES = [
  { code: 'nouvelle', nom: 'Nouvelle', ton: 'cyan' },
  { code: 'a_etudier', nom: 'À étudier', ton: 'attente' },
  { code: 'interessante', nom: 'Intéressante', ton: 'ok' },
  { code: 'a_preparer', nom: 'À préparer', ton: 'bordeaux' },
  { code: 'ecartee', nom: 'Écartée', ton: 'neutre' },
  { code: 'convertie', nom: 'Convertie', ton: 'ok' },
  { code: 'expiree', nom: 'Expirée', ton: 'alerte' },
  { code: 'archivee', nom: 'Archivée', ton: 'neutre' },
];
export const CODES_STATUTS_OFFRES = STATUTS_OFFRES.map((s) => s.code);
export const nomStatutOffre = (code) => STATUTS_OFFRES.find((s) => s.code === code)?.nom ?? code;

/** Les statuts qu'on choisit à la main : « convertie » et « expirée » se constatent. */
export const STATUTS_MANUELS = ['nouvelle', 'a_etudier', 'interessante', 'a_preparer', 'ecartee', 'archivee'];

/** Une offre encore « vivante » : ni écartée, ni convertie, ni expirée, ni archivée. */
export const STATUTS_OUVERTS = ['nouvelle', 'a_etudier', 'interessante', 'a_preparer'];

// ── Les sources ─────────────────────────────────────────────────────

export const CONNECTEURS = [
  { code: 'pmmp', nom: 'Portail marocain des marchés publics (HTML)', automatique: true },
  { code: 'rss', nom: 'Flux RSS ou Atom', automatique: true },
  { code: 'api', nom: 'API (JSON)', automatique: false },
  { code: 'html', nom: 'Page HTML autorisée', automatique: false },
  { code: 'csv', nom: 'Fichier CSV', automatique: false },
  { code: 'manuel', nom: 'Saisie et import manuels', automatique: false },
];
export const CODES_CONNECTEURS = CONNECTEURS.map((c) => c.code);

const texteFacultatif = (max) =>
  z
    .string()
    .trim()
    .max(max, { error: `${max} caractères au plus.` })
    .transform((v) => v || null)
    .nullish();

/** Ajouter ou modifier une source. */
export const schemaSource = z.object({
  nom: z.string({ error: 'Nommez la source.' }).trim().min(2, { error: 'Nommez la source.' }).max(120),
  siteWeb: z.url({ error: 'Une adresse complète, comme https://www.exemple.ma' }).max(255),
  connecteur: z.enum(CODES_CONNECTEURS, { error: 'Choisissez un type de connecteur.' }),
  adresse: z.union([z.url({ error: 'Une adresse complète, comme https://…' }).max(500), z.literal('')]).transform((v) => v || null).nullish(),
  frequenceMinutes: z.coerce.number().int().min(30, { error: '30 minutes au moins : ne surchargez pas la source.' }).max(10_080).default(60),
  pagesMax: z.coerce.number().int().min(1).max(10, { error: '10 pages au plus par passage.' }).default(1),
  delaiRequetesMs: z.coerce.number().int().min(1000, { error: 'Une seconde au moins entre deux requêtes.' }).max(60_000).default(3000),
  active: z.boolean().default(false),
  autoriserHttp: z.boolean().default(false),
  parametres: z.record(z.string(), z.unknown()).nullish(),
  /** Un secret saisi n'est jamais relu : vide = on garde l'ancien. */
  secrets: texteFacultatif(4000),
});

// ── Les critères iCity ──────────────────────────────────────────────

const terme = z.string().trim().min(2).max(80);
const pondere = z.object({ terme, poids: z.coerce.number().int().min(0).max(100) });
const liste = z.object({ termes: z.array(terme).max(200).default([]), poids: z.coerce.number().int().min(0).max(100).default(10) });

export const schemaCriteres = z.object({
  motsCles: z.array(pondere).max(200).default([]),
  /** Au plus ce total pour les mots-clés : un objet bavard ne fait pas 100 à lui seul. */
  plafondMotsCles: z.coerce.number().int().min(0).max(100).default(50),
  motsExclus: z.array(terme).max(200).default([]),
  domaines: z.array(pondere).max(100).default([]),
  lieux: liste,
  acheteursFavoris: liste,
  typesPrestations: liste,
  montantMin: z.coerce.number().nonnegative().nullable().default(null),
  montantMax: z.coerce.number().nonnegative().nullable().default(null),
  poidsMontant: z.coerce.number().int().min(0).max(100).default(5),
  delaiMinJours: z.coerce.number().int().min(0).max(365).default(10),
  poidsDelai: z.coerce.number().int().min(0).max(100).default(10),
  seuil: z.coerce.number().int().min(0).max(100).default(50),
  exclureExpirees: z.boolean().default(true),
});

/** Des exemples pour une société Smart City et informatique : tout se modifie. */
export const CRITERES_PAR_DEFAUT = schemaCriteres.parse({
  motsCles: [
    ...['smart city', 'ville intelligente', 'système d’information', 'transformation digitale', 'dématérialisation', 'GED', 'archivage électronique', 'plateforme numérique', 'centre de supervision', 'vidéosurveillance', 'IoT', 'objets connectés', 'SIG'].map((t) => ({ terme: t, poids: 25 })),
    ...['logiciel', 'numérisation', 'développement informatique', 'cybersécurité', 'télécommunications', 'géolocalisation', 'data center', 'cloud', 'infrastructure informatique', 'matériel informatique', 'contrôle d’accès', 'maintenance informatique'].map((t) => ({ terme: t, poids: 15 })),
    { terme: 'réseau informatique', poids: 15 },
    { terme: 'réseaux', poids: 5 },
  ],
  plafondMotsCles: 50,
  motsExclus: ['nettoyage', 'gardiennage', 'restauration collective', 'carburant'],
  domaines: [
    { terme: 'informatique', poids: 20 },
    { terme: 'technologies de l’information', poids: 20 },
    { terme: 'télécommunications', poids: 15 },
  ],
  lieux: { termes: [], poids: 10 },
  acheteursFavoris: { termes: [], poids: 10 },
  typesPrestations: { termes: ['Services', 'Fournitures'], poids: 5 },
  montantMin: null,
  montantMax: null,
  poidsMontant: 5,
  delaiMinJours: 10,
  poidsDelai: 10,
  seuil: 50,
  exclureExpirees: true,
});

// ── Le texte, sans accents ni pluriels ──────────────────────────────

/** « Systèmes d’Information » → « systeme d information » : on compare des mots, pas des lettres. */
export function texteComparable(t) {
  return ` ${String(t ?? '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((m) => (m.length > 3 && /[sx]$/.test(m) ? m.slice(0, -1) : m))
    .join(' ')} `;
}

/** Le terme apparaît-il dans le texte, mot pour mot ? */
export const contient = (texteCompare, t) => {
  const cherche = texteComparable(t);
  return cherche.trim().length > 0 && texteCompare.includes(cherche);
};

// ── Le score ────────────────────────────────────────────────────────

const jours = (deIso, aIso) => Math.round((Date.parse(`${aIso}T00:00:00Z`) - Date.parse(`${deIso}T00:00:00Z`)) / 86_400_000);
const jourDe = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n).replace(/ /g, ' ');

/**
 * Le score d'une offre, entre 0 et 100, et ses raisons.
 *
 * @param {{ objet: string, resume?: string, acheteur?: string, categorie?: string, domaines?: string[], lieu?: string, estimation?: number, dateLimite?: Date|string }} offre
 * @param {ReturnType<typeof schemaCriteres.parse>} criteres
 * @param {string} aujourdhui AAAA-MM-JJ
 * @returns {{ score: number, raisons: { texte: string, points: number }[], motsCles: string[] }}
 */
export function scoreOffre(offre, criteres, aujourdhui) {
  const c = schemaCriteres.parse(criteres ?? {});
  const objet = texteComparable(`${offre.objet ?? ''} ${offre.resume ?? ''}`);
  const domaines = texteComparable(`${offre.categorie ?? ''} ${(offre.domaines ?? []).join(' ')}`);
  const raisons = [];
  const motsCles = [];

  // Un mot exclu, ou une échéance passée : l'offre ne compte pas.
  const exclu = c.motsExclus.find((t) => contient(objet, t));
  if (exclu) return { score: 0, raisons: [{ texte: `mot exclu « ${exclu} » trouvé dans l’objet`, points: 0 }], motsCles: [] };
  const limite = jourDe(offre.dateLimite);
  if (c.exclureExpirees && limite && limite < aujourdhui) {
    return { score: 0, raisons: [{ texte: 'date limite de remise des plis dépassée', points: 0 }], motsCles: [] };
  }

  // Les mots-clés de l'objet, jusqu'au plafond.
  let pointsMots = 0;
  for (const m of [...c.motsCles].sort((a, b) => b.poids - a.poids)) {
    if (!m.poids || !contient(objet, m.terme)) continue;
    const gagne = Math.min(m.poids, c.plafondMotsCles - pointsMots);
    motsCles.push(m.terme);
    if (gagne <= 0) continue;
    pointsMots += gagne;
    raisons.push({ texte: `« ${m.terme} » trouvé dans l’objet`, points: gagne });
  }

  // Le meilleur domaine d'activité qui correspond.
  const domaine = [...c.domaines].sort((a, b) => b.poids - a.poids).find((d) => d.poids && (contient(domaines, d.terme) || contient(objet, d.terme)));
  if (domaine) raisons.push({ texte: `domaine « ${domaine.terme} »`, points: domaine.poids });

  const lieu = c.lieux.termes.find((t) => contient(texteComparable(offre.lieu), t) || contient(texteComparable(offre.acheteur), t));
  if (lieu && c.lieux.poids) raisons.push({ texte: `lieu suivi : ${lieu}`, points: c.lieux.poids });

  const acheteur = c.acheteursFavoris.termes.find((t) => contient(texteComparable(offre.acheteur), t));
  if (acheteur && c.acheteursFavoris.poids) raisons.push({ texte: `acheteur favori : ${acheteur}`, points: c.acheteursFavoris.poids });

  const type = c.typesPrestations.termes.find((t) => contient(texteComparable(offre.categorie), t));
  if (type && c.typesPrestations.poids) raisons.push({ texte: `prestation de type « ${type} »`, points: c.typesPrestations.poids });

  const montant = offre.estimation === null || offre.estimation === undefined ? null : Number(offre.estimation);
  if (montant !== null && (c.montantMin !== null || c.montantMax !== null) && c.poidsMontant) {
    const dedans = (c.montantMin === null || montant >= c.montantMin) && (c.montantMax === null || montant <= c.montantMax);
    raisons.push(dedans ? { texte: `estimation dans la fourchette (${fmt(montant)} DH)`, points: c.poidsMontant } : { texte: `estimation hors fourchette (${fmt(montant)} DH)`, points: 0 });
  }

  if (limite && c.poidsDelai) {
    const reste = jours(aujourdhui, limite);
    raisons.push(reste >= c.delaiMinJours ? { texte: `${reste} jours avant la remise des plis`, points: c.poidsDelai } : { texte: `délai court : ${reste} jour(s) avant la remise des plis`, points: 0 });
  }

  const score = Math.max(0, Math.min(100, raisons.reduce((n, r) => n + r.points, 0)));
  return { score, raisons, motsCles };
}

// ── L'identité d'une offre ──────────────────────────────────────────

/**
 * L'empreinte d'une offre dont la source ne donne pas d'identifiant stable :
 * toujours la même pour la même annonce (référence, acheteur, objet, date limite).
 * Un hachage FNV-1a 64 bits, en hexadécimal : identique côté serveur et écran.
 */
export function empreinteOffre({ reference, acheteur, objet, dateLimite }) {
  const cle = [reference, acheteur, objet, jourDe(dateLimite)].map((v) => texteComparable(v).trim()).join('|');
  let h = 0xcbf29ce484222325n;
  for (const octet of new TextEncoder().encode(cle)) {
    h ^= BigInt(octet);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `emp-${h.toString(16).padStart(16, '0')}`;
}

// ── Les formulaires des écrans ──────────────────────────────────────

/** Ce qu'on change à la main sur une offre. */
export const schemaSuiviOffre = z.object({
  statut: z.enum(STATUTS_MANUELS, { error: 'Ce statut ne se choisit pas à la main.' }).optional(),
  responsableId: z.number().int().positive().nullable().optional(),
  notes: texteFacultatif(5000),
});

/** Une offre saisie à la main (import par adresse, ou complément). */
export const schemaOffreManuelle = z.object({
  urlOfficielle: z.url({ error: 'L’adresse officielle de l’annonce, en https://…' }).max(1000),
  reference: texteFacultatif(120),
  objet: z.string({ error: 'L’objet de l’appel d’offres.' }).trim().min(5, { error: 'L’objet de l’appel d’offres.' }).max(4000),
  acheteur: texteFacultatif(255),
  categorie: texteFacultatif(120),
  lieu: texteFacultatif(255),
  datePublication: z.union([z.iso.date(), z.literal('')]).transform((v) => v || null).nullish(),
  dateLimite: z.union([z.iso.datetime({ local: true }), z.iso.date(), z.literal('')]).transform((v) => v || null).nullish(),
  estimation: z.coerce.number().nonnegative().nullable().optional(),
  caution: z.coerce.number().nonnegative().nullable().optional(),
});

/** Les préférences d'alerte d'un utilisateur. */
export const ALERTES_OFFRES = [
  { code: 'cloche', nom: 'Dans la cloche' },
  { code: 'mail', nom: 'Résumé quotidien par mail' },
  { code: 'aucune', nom: 'Aucune alerte' },
];
export const schemaAlertesOffres = z.object({
  alerteOffres: z.enum(ALERTES_OFFRES.map((a) => a.code)),
  alerteOffresScore: z.coerce.number().int().min(0).max(100),
});
