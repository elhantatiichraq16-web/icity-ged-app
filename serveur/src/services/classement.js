/**
 * Le classement automatique d'un document d'après son texte (§7).
 *
 * Repris de `classer-par-ocr.py` et `affiner-types.py` du projet actuel, avec
 * leurs motifs exacts : ils ont été réglés sur ce fonds, scan après scan.
 *
 * Le classement ne décide jamais seul : il PROPOSE. Un humain accepte ou
 * corrige (tableau des suggestions), et un champ corrigé à la main est
 * verrouillé — le classement ne le touche plus jamais.
 */

/**
 * Le « n° » tel que l'OCR le rend sur ces scans : n°, N°, en°, No, Nr, W°, nr.
 * C'est le point faible de la lecture ; ce fragment les absorbe tous.
 */
const NUM = String.raw`\b(?:en|n|N|w|W)\s*[°ºoOeEr\*9]?\s*[:.]?\s*`;

/** Les formes de référence rencontrées dans le fonds (§5). */
const FORMES = [
  // 639/SAM/FRA/2022 — appels d'offres à deux codes de service.
  /\b(\d{1,5}[A-Z]{0,2}\/[A-Z][A-Z0-9]{1,7}\/[A-Z][A-Z0-9]{1,7}\/(?:19|20)\d\d)\b/gi,
  // 23C/2017/TGR — Trésorerie ; 04/DRCA/2014 — directions régionales.
  // Le segment du milieu doit contenir une lettre : sans cette exigence,
  // « 03/02/2020 » — une date — passerait pour un marché.
  /\b(\d{1,5}[A-Z]{0,2}\/[A-Z][A-Z0-9]{1,7}\/(?:19|20)\d\d)\b/gi,
  /\b(\d{1,5}[A-Z]{0,2}\/(?:19|20)\d\d\/[A-Z][A-Z0-9]{1,7})\b/gi,
  // MAR202200027 — Crédit Agricole. Les bons de livraison écrivent le numéro nu.
  /\b(MAR\s?\d{8,12})\b/gi,
  new RegExp(String.raw`march[ée]\s{0,3}` + NUM + String.raw`(\d{8,12})\b`, 'gi'),
  // M.0S.AO/CA/2012 — références anciennes à points.
  /\b([A-Z]\.[\w.]{2,8}\/[A-Z]{2,4}\/(?:19|20)\d\d)\b/gi,
  // 31/2016 — format court, exigé précédé de « marché » pour ne pas
  // confondre avec une date ou un article de loi.
  new RegExp(String.raw`march[ée]s?\s{0,3}(?:reconductible\s{0,3})?` + NUM + String.raw`(\d{1,4}\/(?:19|20)\d\d)(?!\/)\b`, 'gi'),
  // 10879/2018 — un bon de commande tient lieu d'affaire.
  new RegExp(String.raw`(?:bon\s+de\s+commande|\bB\.?C\.?)\s*` + NUM + String.raw`(\d{1,6}(?:\/[A-Z]{2,5})?\/(?:(?:19|20)\d\d|\d\d))\b`, 'gi'),
  // IGCAM000092200 — demandes d'achat internes du Crédit Agricole.
  /\b((?:IG|DA)[A-Z]{0,4}\d{6,14})\b/gi,
];

/**
 * La nature de la pièce, du plus spécifique au plus général (§7).
 * L'ordre est la règle : un « avenant au marché » est un avenant, pas un marché.
 */
const TYPES = [
  ['AV', [/\bavenant\s+n/i]],
  // « attestons par la présente que » : la forme réelle des attestations du
  // fonds. « atteste que » seul, du script d'origine, les manquait toutes.
  ['ATT', [/attestation\s+de\s+r[eé]f[eé]rence/i, /attest(?:e|ons|ent)\s+(?:par\s+la\s+pr[eé]sente\s+)?que/i, /soussign[eé]s?[^.]{0,80}attest/i]],
  // « ordre de service » figure dans le corps de tout marché, qui en prévoit
  // l'usage : seule une notification en porte le numéro.
  ['OS', [/ordre\s+de\s+service\s+n[°ºe]?\s*\d/i, /notification\s+de\s+l.ordre\s+de\s+service/i]],
  // Le procès-verbal passe avant les pièces qu'il cite.
  ['PVMD', [/proc[eè]s[\s-]*verbal\s+relatif\s+aux?\s+d[eé]cisions?\s+de\s+mise\s+en\s+demeure/i]],
  ['PVD', [/r[eé]ception\s+d[eé]finitive/i]],
  ['PVP', [/proc[eè]s[\s-]*verbal\s+de\s+r[eé]cept/i, /proc.{0,3}\s*v[oe]rbal\s+de\s+r[eé]cept/i, /r[eé]ception\s+provisoire/i]],
  ['BL', [/bon\s+de\s+livraison/i]],
  ['BC', [/bon\s+de\s+commande/i]],
  ['MLV', [/mainlev[eé]e/i, /restitution\s+de\s+(la\s+)?caution/i, /lib[eé]ration\s+de\s+(la\s+)?caution/i]],
  ['CAU', [/caution\s+(d[eé]finiti|provisoi|bancaire)/i]],
  // L'OCR perd souvent le R initial de « REÇU » sur ces imprimés.
  ['RV', [/re[cç]u\s+de\s+versement/i, /\becu\s+de\s+versement/i]],
  ['FAC', [/\bfacture\s+n/i]],
  ['DEC', [/d[eé]compte\s+(d[eé]finitif|provisoire|g[eé]n[eé]ral)/i]],
  ['DAO', [/r[eè]glement\s+de\s+consultation/i, /avis\s+d.appel\s+d.offres/i]],
  ['CM', [/objet\s+du\s+march[eé]/i, /cahier\s+des\s+(clauses|prescriptions)/i, /march[ée]\s+(reconductible\s+)?n/i]],
  ['COU', [/salutations\s+distingu/i, /^\s*objet\s*:/im]],
];

/** L'objet technique (§7), pour l'affichage. */
const OBJETS = [
  ["Contrôle d'accès", [/contr[oô]le\s+d.acc[eè]s/i, /lecteur\s+de\s+badge/i, /tourniquet/i, /barri[eè]re\s+levante/i]],
  ['Vidéosurveillance', [/vid[eé]osurveillance/i, /cam[eé]ra\s+de/i, /\bCCTV\b/i]],
  ["Système d'alarme", [/syst[eè]me[s]?\s+d.alarme/i, /anti[\s-]?intrusion/i, /d[eé]tecteur\s+de\s+mouvement/i]],
  ['Détection incendie', [/d[eé]tection\s+incendie/i, /d[eé]tecteur\s+de\s+fum/i]],
  ['Maintenance', [/maintenance\s+des?\s+[eé]quipements/i, /entretien\s+(pr[eé]ventif|curatif)/i]],
];

/**
 * Le titre d'une pièce tient dans ses premières lignes (§7). Au-delà, une
 * mention n'est plus un titre mais une citation — l'article d'un contrat qui
 * décrit la procédure de réception.
 *
 * La fenêtre est large parce que l'OCR échoue sur les en-têtes officiels
 * bilingues : le vrai titre arrive après ce charabia.
 */
const EN_TETE = 1200;

/**
 * Un procès-verbal constate, il est court. Un cahier des charges décrit la
 * réception sur plusieurs articles. Au-delà de ce seuil, la pièce est un
 * contrat, quoi que dise son en-tête.
 */
const TAILLE_PV = 6000;

export const sansAccent = (t) => (t ?? '').normalize('NFD').replace(/\p{Mn}/gu, '');

/** Toutes les références citées, avec le nombre de fois qu'elles le sont. */
export function referencesDuTexte(texte) {
  const trouvees = new Map();
  for (const forme of FORMES) {
    for (const m of String(texte).matchAll(forme)) {
      const brute = m[1]?.trim().replace(/^[.,;:]+|[.,;:]+$/g, '');
      if (!brute || brute.length <= 4) continue;
      trouvees.set(brute.toUpperCase(), (trouvees.get(brute.toUpperCase()) ?? 0) + 1);
    }
  }
  return trouvees;
}

/**
 * La référence dont le document relève : la plus citée (§7). Les autres sont
 * des renvois.
 */
export function referencePrincipale(texte) {
  const trouvees = referencesDuTexte(texte);
  if (!trouvees.size) return null;
  const [reference, citations] = [...trouvees.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0];
  return { reference, citations, toutes: [...trouvees.keys()] };
}

/**
 * Le client, d'après les motifs du texte et les synonymes du référentiel.
 * La société elle-même n'est retenue qu'en dernier recours (§7).
 *
 * @param {string} texte
 * @param {Array<{id:number, nom:string, sigle?:string|null, synonymes?:string[], interne:boolean}>} clients
 */
export function clientDuTexte(texte, clients) {
  const plat = sansAccent(texte).toLowerCase();
  let recours = null;

  for (const client of clients) {
    const motifs = [client.nom, client.sigle, ...(Array.isArray(client.synonymes) ? client.synonymes : [])].filter(Boolean);
    for (const motif of motifs) {
      const m = sansAccent(String(motif)).toLowerCase().trim();
      if (m.length < 3) continue;
      // Un sigle court (TGR, ADII) se cherche en mot entier, sinon « OCP »
      // se trouverait dans « OCPQ ».
      const trouve = m.length <= 5 ? new RegExp(String.raw`\b${m}\b`, 'i').test(plat) : plat.includes(m);
      if (!trouve) continue;
      if (client.interne) {
        recours ??= { client, motif };
        continue;
      }
      return { client, motif };
    }
  }
  return recours;
}

/**
 * Le type de pièce. `affiner` applique les règles du §7 : un « PV » de plus de
 * 6 000 caractères est un contrat, et l'en-tête départage définitive,
 * provisoire et mainlevée.
 */
export function typeDuTexte(texte) {
  const t = String(texte ?? '');
  const tete = sansAccent(t.slice(0, EN_TETE));

  // Sur l'en-tête d'abord : c'est le titre de la pièce.
  for (const [code, motifs] of TYPES) {
    if (motifs.some((m) => m.test(tete))) {
      // Un procès-verbal long n'est pas un procès-verbal : c'est le contrat
      // qui décrit la procédure de réception. La confusion la plus coûteuse
      // pour le suivi — elle ferait croire un marché réceptionné.
      if ((code === 'PVP' || code === 'PVD') && t.length > TAILLE_PV) return { code: 'CM', raison: `procès-verbal de plus de ${TAILLE_PV} caractères : c'est un contrat` };
      return { code, raison: `reconnu dans l'en-tête (${EN_TETE} premiers caractères)` };
    }
  }

  // Puis dans tout le texte, pour les pièces sans en-tête lisible.
  const plat = sansAccent(t);
  for (const [code, motifs] of TYPES) {
    if (motifs.some((m) => m.test(plat))) {
      if ((code === 'PVP' || code === 'PVD') && t.length > TAILLE_PV) return { code: 'CM', raison: `procès-verbal de plus de ${TAILLE_PV} caractères : c'est un contrat` };
      return { code, raison: 'reconnu dans le corps du document' };
    }
  }
  return null;
}

/** L'objet technique du document, ou null. */
export function objetDuTexte(texte) {
  const plat = sansAccent(texte);
  for (const [objet, motifs] of OBJETS) {
    if (motifs.some((m) => m.test(plat))) return objet;
  }
  return null;
}

/**
 * Analyse un document et rend ce qu'on peut en dire.
 *
 * @param {{ texteOcr: string|null }} document
 * @param {Array} clients référentiel des clients
 */
export function analyser(document, clients) {
  const texte = document.texteOcr ?? '';
  if (texte.replace(/\s/g, '').length < 80) return { lisible: false };

  const ref = referencePrincipale(texte);
  const client = clientDuTexte(texte, clients);
  const type = typeDuTexte(texte);

  return {
    lisible: true,
    reference: ref,
    client: client?.client ?? null,
    motifClient: client?.motif ?? null,
    type,
    objetTechnique: objetDuTexte(texte),
  };
}
