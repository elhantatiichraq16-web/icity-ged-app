/**
 * Aller chercher les offres des sources actives, poliment.
 *
 *  - une source après l'autre, et une erreur n'arrête jamais les suivantes ;
 *  - chaque source a sa fréquence, son nombre de pages, son délai entre deux
 *    requêtes ; après des échecs répétés, on espace les tentatives (×2, ×4…) ;
 *  - chaque passage laisse un compte rendu (synchronisations_sources).
 */
import { dechiffrer } from '../../securite/crypto.js';
import { db } from '../../db.js';
import { connecteurDe } from './connecteurs/index.js';
import { alerterNouvellesOffres, assurerInitialisation, enregistrerOffres, expirerOffres } from './offres.js';
import { ErreurRecuperation, pause, recuperer as recupererBrut } from './recuperation.js';

/** Les en-têtes secrets d'une source (JSON chiffré), jamais montrés. */
function entetesDe(source) {
  if (!source.secrets) return {};
  try {
    const valeur = JSON.parse(dechiffrer(source.secrets));
    return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? Object.fromEntries(Object.entries(valeur).map(([k, v]) => [k, String(v)])) : {};
  } catch {
    return {};
  }
}

/**
 * Le « recuperer » donné à un connecteur : les règles de la source (HTTP ou
 * non, en-têtes), et une pause entre deux requêtes.
 */
export function recupererPour(source, { attente = pause } = {}) {
  let premiere = true;
  return async (adresse, options = {}) => {
    if (!premiere) await attente(source.delaiRequetesMs);
    premiere = false;
    return recupererBrut(adresse, { autoriserHttp: source.autoriserHttp, entetes: entetesDe(source), ...options });
  };
}

/** Un message d'erreur montrable : jamais de pile, jamais de secret. */
const messageDe = (e) => (e instanceof ErreurRecuperation || e?.message ? String(e.message).slice(0, 500) : 'Erreur inconnue.');

/**
 * Synchronise une source.
 *
 * @param {object} source une ligne de sources_marches
 * @param {{ declenchement?: 'auto'|'manuelle', utilisateurId?: number, recuperer?: Function, maintenant?: Date }} options
 */
export async function synchroniserSource(source, { declenchement = 'auto', utilisateurId = null, recuperer, maintenant = new Date() } = {}) {
  const connecteur = connecteurDe(source.connecteur);
  const sync = await db.synchronisationSource.create({ data: { sourceId: source.id, declenchement, declencheParId: utilisateurId, debut: maintenant } });
  try {
    if (!connecteur) throw new Error('Cette source n’a pas de connecteur automatique : importez ses offres par CSV ou par adresse.');
    const { offres, pagesLues, total, remarques = [] } = await connecteur.lister({ source, recuperer: recuperer ?? recupererPour(source) });
    const { nouvelles, misesAJour } = await enregistrerOffres(source, offres, { maintenant });
    await alerterNouvellesOffres(nouvelles, { maintenant });
    const resume = [`${offres.length} reçue(s), ${nouvelles.length} nouvelle(s), ${misesAJour} mise(s) à jour`, total ? `${total} annonces sur le portail` : null, ...remarques].filter(Boolean).join(' · ').slice(0, 255);
    const etat = remarques.length ? 'partielle' : 'ok';
    await db.synchronisationSource.update({ where: { id: sync.id }, data: { fin: new Date(), etat, pagesLues, recues: offres.length, nouvelles: nouvelles.length, misesAJour } });
    await db.sourceMarches.update({ where: { id: source.id }, data: { derniereSyncLe: maintenant, derniereSyncEtat: etat, derniereSyncResume: resume, derniereErreur: null, echecsConsecutifs: 0 } });
    return { etat, nouvelles: nouvelles.length, misesAJour, recues: offres.length, resume };
  } catch (erreur) {
    const message = messageDe(erreur);
    await db.synchronisationSource.update({ where: { id: sync.id }, data: { fin: new Date(), etat: 'erreur', erreur: message } });
    await db.sourceMarches.update({ where: { id: source.id }, data: { derniereSyncLe: maintenant, derniereSyncEtat: 'erreur', derniereSyncResume: 'Échec de la synchronisation', derniereErreur: message, echecsConsecutifs: { increment: 1 } } });
    return { etat: 'erreur', erreur: message };
  }
}

/** Une source est-elle due ? Sa fréquence, allongée après des échecs (2, 4, 8… fois, 32 au plus). */
export function estDue(source, maintenant = new Date()) {
  if (!source.derniereSyncLe) return true;
  const facteur = 2 ** Math.min(source.echecsConsecutifs, 5);
  return maintenant.getTime() - source.derniereSyncLe.getTime() >= source.frequenceMinutes * 60_000 * facteur;
}

/**
 * Le passage du worker : les sources actives et dues, l'une après l'autre,
 * puis l'expiration des offres échues.
 *
 * @param {{ maintenant?: Date, forcer?: boolean, utilisateurId?: number, recuperer?: Function }} options
 */
export async function synchroniserTout({ maintenant = new Date(), forcer = false, utilisateurId = null, recuperer, log = console } = {}) {
  await assurerInitialisation();
  const sources = await db.sourceMarches.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
  const bilans = [];
  for (const source of sources) {
    if (!connecteurDe(source.connecteur)?.automatique) continue;
    if (!forcer && !estDue(source, maintenant)) continue;
    try {
      bilans.push({ source: source.nom, ...(await synchroniserSource(source, { declenchement: forcer ? 'manuelle' : 'auto', utilisateurId, recuperer, maintenant })) });
    } catch (erreur) {
      // Même une erreur imprévue (base indisponible…) ne bloque pas les autres sources.
      log.error?.(`Synchronisation de « ${source.nom} » : ${erreur.message}`);
      bilans.push({ source: source.nom, etat: 'erreur', erreur: messageDe(erreur) });
    }
  }
  const expirees = await expirerOffres({ maintenant });
  return { bilans, expirees };
}
