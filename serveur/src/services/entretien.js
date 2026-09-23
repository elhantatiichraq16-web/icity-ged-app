/**
 * L'entretien du fonds : ce qu'on efface, et au bout de combien de temps.
 *
 * Ces tâches vivent hors du worker pour pouvoir être appelées — et testées —
 * sans démarrer l'écoute IMAP et les planificateurs. Importer le worker
 * lance tout le worker ; importer ce fichier n'engage à rien.
 */
import { db } from '../db.js';
import { supprimerFichier } from './stockage.js';

/** La corbeille se vide au bout de trente jours (§9). */
export const JOURS_CORBEILLE = 30;

/**
 * Le journal d'audit se garde deux ans.
 *
 * Assez long pour retrouver qui a fait quoi sur un marché clos ; assez court
 * pour que la table ne devienne pas la plus grosse de la base. Chaque
 * connexion et chaque modification y laissent une ligne : sans purge, elle
 * grossit indéfiniment.
 */
export const JOURS_JOURNAL = 730;

/** Vide la corbeille de ce qui y dort depuis plus de trente jours. */
export async function viderCorbeille({ log = console } = {}) {
  const limite = new Date(Date.now() - JOURS_CORBEILLE * 86_400_000);
  const perimes = await db.document.findMany({
    where: { supprimeLe: { lt: limite } },
    select: { id: true, cheminOriginal: true, cheminArchive: true, cheminVignette: true },
  });

  for (const d of perimes) {
    // Le fichier part avec la ligne : sinon le stockage garderait des pièces
    // que plus rien ne référence.
    for (const chemin of [d.cheminOriginal, d.cheminArchive, d.cheminVignette]) await supprimerFichier(chemin);
    await db.document.delete({ where: { id: d.id } });
  }

  if (perimes.length) log.log?.(`Corbeille : ${perimes.length} document(s) supprimé(s) définitivement.`);
  return perimes.length;
}

/** Efface les traces d'audit de plus de deux ans. */
export async function purgerJournal({ log = console } = {}) {
  const limite = new Date(Date.now() - JOURS_JOURNAL * 86_400_000);
  const { count } = await db.journal.deleteMany({ where: { creeLe: { lt: limite } } });
  if (count) log.log?.(`Journal : ${count} trace(s) de plus de deux ans effacée(s).`);
  return count;
}
