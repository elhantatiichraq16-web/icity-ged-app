/**
 * Repérage des pièces scannées deux fois (§9).
 *
 * Deux leçons du fonds actuel commandent tout ce fichier :
 *
 *  1. **L'empreinte ne suffit pas.** Deux passages du même papier sous le
 *     scanner ne donnent jamais les mêmes octets — la compression varie.
 *     Les 110 attestations séparées portaient 110 empreintes distinctes ;
 *     trente-neuf étaient pourtant des relectures.
 *
 *  2. **La ressemblance seule ne suffit pas non plus.** Des marchés d'une même
 *     administration, bâtis sur le même formulaire, partagent 87 % de leur
 *     vocabulaire sans être identiques.
 *
 * On exige donc un faisceau : même client, vocabulaire commun ≥ 80 %, aucune
 * contradiction sur les montants, dates et références, et deux passages de
 * scanner différents.
 */

/** Part du vocabulaire commun au-delà de laquelle deux pièces sont la même. */
export const SEUIL = 0.8;

/** Sous ce nombre de mots longs, la comparaison ne dit rien de sûr. */
export const MOTS_MINIMUM = 12;

const sansAccent = (t) => (t ?? '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();

/**
 * Les mots d'au moins cinq lettres. Les courts sont trop communs pour
 * distinguer quoi que ce soit, et les longs résistent au bruit de l'OCR :
 * « intelifex », « casablanca », « dirhams » se retrouvent d'un scan à l'autre.
 */
export function motsLongs(texte) {
  return new Set(sansAccent(texte).match(/[a-z]{5,}/g) ?? []);
}

/** La part de vocabulaire commun — indice de Jaccard. */
export function ressemblance(a, b) {
  if (!a.size || !b.size) return 0;
  let communs = 0;
  for (const mot of a) if (b.has(mot)) communs += 1;
  return communs / (a.size + b.size - communs);
}

/**
 * Ce qui identifie une pièce et permet de la séparer d'une voisine :
 * montants, dates, références et numéros de lot de marché.
 */
export function signature(texte) {
  const t = String(texte ?? '').replace(/\s+/g, ' ');
  return {
    // « 1 250 000,00 » ou « 1250000.00 » : on garde les chiffres seuls.
    montants: new Set((t.match(/\b\d{1,3}(?:[ .]\d{3})+(?:[,.]\d{2})?\b/g) ?? []).map((m) => m.replace(/[ .,]/g, ''))),
    dates: new Set(t.match(/\b\d{2}\/\d{2}\/(?:19|20)\d\d\b/g) ?? []),
    // Les trois formes du fonds, la plus longue en premier. Le « (?<!\d\/) »
    // écarte le dernier morceau d'une date : dans « 12/03/2017 », « 03/2017 »
    // n'est pas une référence de marché.
    references: new Set(
      (t.match(/(?<!\d\/)\b\d{1,5}[A-Z]?\/(?:[A-Z][A-Z0-9]{1,6}\/(?:19|20)\d\d|(?:19|20)\d\d\/[A-Z][A-Z0-9]{1,6}|(?:19|20)\d\d)\b/gi) ?? []).map((r) => r.toUpperCase()),
    ),
    // « Lot n°1 » contre « Lot n°3 » : deux contrats d'un même appel d'offres.
    lots: new Set((t.match(/[Ll]ot\s*n?[°ºe]?\s*:?\s*(\d{1,2})\b/g) ?? []).map((l) => l.replace(/\D/g, ''))),
  };
}

/**
 * Deux ensembles se contredisent-ils ?
 *
 * Une valeur absente d'un seul côté n'est PAS une contradiction : l'OCR perd
 * des lignes. Deux valeurs présentes et disjointes, si.
 */
function seContredisent(a, b) {
  if (!a.size || !b.size) return false;
  for (const v of a) if (b.has(v)) return false;
  return true;
}

/**
 * Compare deux documents déjà préparés (mots longs et signature calculés).
 *
 * @returns {{ probable: boolean, score: number, raisons: string[], ecarts: string[] }}
 */
export function comparer(a, b) {
  const raisons = [];
  const ecarts = [];

  const part = ressemblance(a.mots, b.mots);
  const score = Math.round(part * 100);

  if (a.mots.size < MOTS_MINIMUM || b.mots.size < MOTS_MINIMUM) {
    return { probable: false, score, raisons, ecarts: ['texte trop court pour conclure'] };
  }

  if (part < SEUIL) return { probable: false, score, raisons, ecarts: [`vocabulaire commun de ${score} %, sous le seuil de 80 %`] };
  raisons.push(`${score} % de vocabulaire commun`);

  // Même client : deux pièces de deux administrations ne sont pas la même.
  if (a.clientId && b.clientId && a.clientId !== b.clientId) {
    ecarts.push('clients différents');
  } else if (a.clientId && a.clientId === b.clientId) {
    raisons.push('même client');
  }

  // Deux pages d'un même passage de scanner sont deux papiers différents.
  if (a.lotScan && b.lotScan && a.lotScan === b.lotScan) {
    ecarts.push('même passage de scanner : ce sont deux pages différentes');
  } else if (a.lotScan && b.lotScan) {
    raisons.push('deux passages de scanner différents');
    if (a.pageScan && a.pageScan === b.pageScan) raisons.push(`même numéro de page (${a.pageScan}) dans les deux passages`);
  }

  for (const [nom, cle] of [
    ['montants', 'montants'],
    ['dates', 'dates'],
    ['références', 'references'],
    ['numéros de lot', 'lots'],
  ]) {
    if (seContredisent(a.signature[cle], b.signature[cle])) {
      ecarts.push(
        cle === 'lots'
          ? `lot ${[...a.signature.lots].join('/')} contre lot ${[...b.signature.lots].join('/')} : deux contrats d'un même appel d'offres`
          : `${nom} différents`,
      );
    }
  }

  return { probable: ecarts.length === 0, score, raisons, ecarts };
}

/** Prépare un document pour la comparaison (calcul fait une seule fois). */
export function preparer(document) {
  return {
    id: document.id,
    titre: document.titre,
    clientId: document.clientId,
    marcheId: document.marcheId,
    lotScan: document.lotScan,
    pageScan: document.pageScan,
    mots: motsLongs(document.texteOcr),
    signature: signature(document.texteOcr),
  };
}

/**
 * Toutes les paires suspectes d'une liste de documents.
 *
 * On ne compare pas tout avec tout à l'aveugle : un index inversé sur les mots
 * rares écarte d'emblée les couples qui n'ont presque rien en commun.
 */
export function chercherPaires(documents, { seuilAffichage = 0.6 } = {}) {
  const prepares = documents.map(preparer).filter((d) => d.mots.size >= MOTS_MINIMUM);
  const paires = [];

  for (let i = 0; i < prepares.length; i++) {
    for (let j = i + 1; j < prepares.length; j++) {
      const a = prepares[i];
      const b = prepares[j];
      // Un écart de taille de vocabulaire rend le seuil de 80 % inatteignable :
      // on saute sans calculer.
      const petit = Math.min(a.mots.size, b.mots.size);
      const grand = Math.max(a.mots.size, b.mots.size);
      if (petit / grand < seuilAffichage) continue;

      const resultat = comparer(a, b);
      if (resultat.score / 100 >= seuilAffichage) {
        paires.push({ a, b, ...resultat });
      }
    }
  }
  return paires.sort((x, y) => y.score - x.score);
}
