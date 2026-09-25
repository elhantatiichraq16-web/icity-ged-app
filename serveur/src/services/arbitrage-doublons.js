/**
 * Les doublons du fonds : les repérer, régler seuls les cas sûrs, et appliquer
 * la décision prise à la main pour les autres (§9).
 *
 * La comparaison elle-même vit dans `doublons.js`. Ici, on décide quoi en
 * faire.
 *
 * **Réglé seul** — un rescan sûr : le même numéro de page dans deux passages
 * de scanner différents, et au moins 90 % de vocabulaire commun. C'est la
 * signature d'une pile repassée sous le copieur. Le scan le plus récent part
 * à la corbeille (trente jours pour se raviser).
 *
 * **Signalé** — tout le reste : deux pièces peuvent se ressembler sans être le
 * même papier (le même formulaire pour deux marchés). La fiche du marché et la
 * page du document le montrent, et l'utilisateur tranche d'un clic.
 *
 * Dans les deux cas, rien ne se perd : avant d'écarter un double, son marché,
 * son client, son type et ses étiquettes sont reportés sur la pièce gardée.
 */
import { db } from '../db.js';
import { chercherPaires, comparer, MOTS_MINIMUM, preparer } from './doublons.js';
import { journaliser } from './journal.js';
import { recalculerPhase } from './phase-marche.js';

/** Au-dessus, avec le même numéro de page dans deux passages, le rescan est sûr. */
export const SCORE_SUR = 90;

/** Les champs dont la comparaison a besoin. */
const CHAMPS = { id: true, titre: true, clientId: true, marcheId: true, lotScan: true, pageScan: true, texteOcr: true };

/**
 * Une paire se règle-t-elle sans humain ?
 *
 * @param {{ probable: boolean, score: number, a: object, b: object }} paire
 */
export function estSure(paire) {
  const { a, b } = paire;
  return (
    paire.probable &&
    paire.score >= SCORE_SUR &&
    Boolean(a.lotScan && b.lotScan && a.lotScan !== b.lotScan) &&
    Boolean(a.pageScan) &&
    a.pageScan === b.pageScan
  );
}

/**
 * Laquelle garder : le premier passage au scanner. Son lot est un horodatage
 * (« 20260910132832435 ») ; à défaut, la pièce entrée la première.
 */
function premierScan(a, b) {
  if (a.lotScan && b.lotScan && a.lotScan !== b.lotScan) return a.lotScan < b.lotScan ? a : b;
  return a.id < b.id ? a : b;
}

/**
 * Écarte un double : report de ce qu'il porte sur la pièce gardée, puis
 * corbeille. La paire est marquée tranchée pour ne jamais revenir.
 *
 * @param {object} paire une ligne de la table Doublon
 * @param {number} garderId la pièce à garder
 */
export async function ecarterDoublon(paire, garderId, { utilisateurId = null, automatique = false, ip, log = console } = {}) {
  const [garde, ecarte] = await Promise.all(
    [garderId, garderId === paire.documentAId ? paire.documentBId : paire.documentAId].map((id) => db.document.findUniqueOrThrow({ where: { id } })),
  );

  // Sans ce report, un rattachement disparaîtrait avec la copie.
  const reports = {};
  if (!garde.marcheId && ecarte.marcheId) reports.marcheId = ecarte.marcheId;
  if (!garde.clientId && ecarte.clientId) reports.clientId = ecarte.clientId;
  if (!garde.typeDocumentId && ecarte.typeDocumentId) reports.typeDocumentId = ecarte.typeDocumentId;
  if (Object.keys(reports).length) await db.document.update({ where: { id: garde.id }, data: reports });

  const etiquettes = await db.documentEtiquette.findMany({ where: { documentId: ecarte.id } });
  if (etiquettes.length) {
    await db.documentEtiquette.createMany({ data: etiquettes.map((e) => ({ documentId: garde.id, etiquetteId: e.etiquetteId })), skipDuplicates: true });
  }

  // Suppression douce : la pièce part en corbeille, pour trente jours.
  await db.document.update({ where: { id: ecarte.id }, data: { supprimeLe: new Date() } });
  await db.doublon.update({
    where: { id: paire.id },
    data: { decision: ecarte.id === paire.documentBId ? 'supprime_b' : 'supprime_a', decidePar: utilisateurId, decideLe: new Date() },
  });

  for (const marcheId of new Set([ecarte.marcheId, garde.marcheId ?? reports.marcheId].filter(Boolean))) await recalculerPhase(marcheId);

  await journaliser(
    {
      utilisateurId,
      action: automatique ? 'doublon.ecarte_auto' : 'doublon.ecarte',
      objetType: 'Document',
      objetId: ecarte.id,
      commentaire: `doublon de « ${garde.titre} » (${paire.score} %), mis en corbeille${automatique ? ' automatiquement : même page dans deux passages de scanner' : ''}`,
      ip,
    },
    log,
  ).catch(() => {});

  return { garde, ecarte };
}

/** Garde les deux pièces : la paire est tranchée et ne revient pas. */
export async function garderLesDeux(paire, { utilisateurId = null, ip, log = console } = {}) {
  await db.doublon.update({ where: { id: paire.id }, data: { decision: 'gardes', decidePar: utilisateurId, decideLe: new Date() } });
  await journaliser(
    { utilisateurId, action: 'doublon.gardes', objetType: 'Document', objetId: paire.documentAId, commentaire: `paire ${paire.id} : les deux pièces sont conservées`, ip },
    log,
  ).catch(() => {});
}

/**
 * Cherche les doublons, enregistre les paires nouvelles, et règle les sûres.
 *
 * @param {{ ids?: number[], appliquer?: boolean, utilisateurId?: number | null, log?: object }} options
 *   `ids` : ne compare que ces pièces au reste du fonds (après un versement ou
 *   un OCR) ; sans `ids`, tout le fonds est comparé. `appliquer: false` ne fait
 *   que décrire (simulation).
 * @returns {Promise<{ nouvelles: number, ecartees: object[], aTrancher: object[] }>}
 */
export async function detecterDoublons({ ids, appliquer = true, utilisateurId = null, log = console } = {}) {
  const fonds = await db.document.findMany({ where: { supprimeLe: null, texteOcr: { not: null } }, select: CHAMPS });

  let paires;
  if (ids) {
    // Seulement les nouvelles venues contre le reste : inutile de recomparer
    // tout le fonds à chaque versement.
    const cibles = fonds.filter((d) => ids.includes(d.id)).map(preparer).filter((d) => d.mots.size >= MOTS_MINIMUM);
    const autres = fonds.filter((d) => !ids.includes(d.id)).map(preparer);
    paires = [];
    for (const a of cibles) for (const b of autres) paires.push({ a, b, ...comparer(a, b) });
    paires = paires.filter((p) => p.probable);
  } else {
    paires = chercherPaires(fonds).filter((p) => p.probable);
  }

  // Les paires déjà connues : une paire tranchée ne revient jamais (§9) ;
  // une paire en attente peut, elle, être réglée si elle est sûre.
  const connues = await db.doublon.findMany();
  const cle = (x, y) => (x < y ? `${x}-${y}` : `${y}-${x}`);
  const parCle = new Map(connues.map((d) => [cle(d.documentAId, d.documentBId), d]));

  const bilan = { nouvelles: 0, ecartees: [], aTrancher: [] };
  const deja = new Set(); // une pièce écartée ne se compare plus

  for (const p of paires) {
    if (deja.has(p.a.id) || deja.has(p.b.id)) continue;
    let paire = parCle.get(cle(p.a.id, p.b.id));
    if (paire && paire.decision !== 'en_attente') continue;

    if (!paire) {
      bilan.nouvelles += 1;
      if (appliquer) {
        const [aId, bId] = p.a.id < p.b.id ? [p.a.id, p.b.id] : [p.b.id, p.a.id];
        paire = await db.doublon.create({ data: { documentAId: aId, documentBId: bId, score: p.score, raisons: { raisons: p.raisons, ecarts: p.ecarts } } });
      }
    }

    const ligne = { a: p.a.titre, b: p.b.titre, score: p.score };
    if (estSure(p)) {
      const garde = premierScan(p.a, p.b);
      const ecarte = garde === p.a ? p.b : p.a;
      bilan.ecartees.push({ ...ligne, garde: garde.titre, ecarte: ecarte.titre });
      deja.add(ecarte.id);
      if (appliquer) await ecarterDoublon(paire, garde.id, { utilisateurId, automatique: true, log });
    } else {
      bilan.aTrancher.push(ligne);
    }
  }
  return bilan;
}

/**
 * Les paires en attente qui touchent ces pièces, pour les signaler à l'écran.
 *
 * Une paire dont l'autre pièce est trop confidentielle pour le demandeur
 * n'est pas montrée : on ne signale pas l'existence de ce qu'il ne peut ouvrir.
 *
 * @param {number[]} ids
 * @param {{ confidentialites?: string[] }} options ce que le demandeur a le droit de voir
 * @returns {Promise<Map<number, { paireId: number, score: number, raisons: string[], autre: { id: number, titre: string } }[]>>}
 */
export async function doublonsEnAttente(ids, { confidentialites } = {}) {
  const visible = { supprimeLe: null, ...(confidentialites ? { confidentialite: { in: confidentialites } } : {}) };
  const paires = await db.doublon.findMany({
    where: {
      decision: 'en_attente',
      OR: [{ documentAId: { in: ids } }, { documentBId: { in: ids } }],
      documentA: visible,
      documentB: visible,
    },
    include: { documentA: { select: { id: true, titre: true } }, documentB: { select: { id: true, titre: true } } },
  });
  const parDocument = new Map();
  for (const p of paires) {
    for (const [moi, autre] of [
      [p.documentA, p.documentB],
      [p.documentB, p.documentA],
    ]) {
      if (!ids.includes(moi.id)) continue;
      const liste = parDocument.get(moi.id) ?? [];
      liste.push({ paireId: p.id, score: p.score, raisons: p.raisons?.raisons ?? [], autre });
      parDocument.set(moi.id, liste);
    }
  }
  return parDocument;
}
