/**
 * Les connecteurs de sources d'offres. Chacun sait lire UNE sorte de source ;
 * la synchronisation, elle, ne connaît que cette interface :
 *
 *   {
 *     code, automatique,
 *     lister({ source, recuperer }) → { offres, pagesLues, total?, remarques },
 *     detail?({ adresse, recuperer }) → offre brute,     // actualiser, importer par adresse
 *     reconnait?(adresse) → boolean,                       // cette adresse est-elle à moi ?
 *   }
 *
 * Ajouter une source d'un nouveau genre = écrire un fichier ici et l'inscrire
 * dans CONNECTEURS (voir docs/marches-potentiels.md).
 */
import { connecteurPmmp } from './pmmp.js';
import { connecteurRss } from './rss.js';

/**
 * Les connecteurs qui savent lire seuls. « api », « html », « csv », « manuel » :
 * import seulement. Une nouvelle source automatique = un connecteur ici, avec
 * ses règles de lecture écrites dans le code (voir pmmp.js et ../lecture.js).
 */
export const CONNECTEURS = {
  pmmp: connecteurPmmp,
  rss: connecteurRss,
};

export const connecteurDe = (code) => CONNECTEURS[code] ?? null;

/** Le connecteur qui reconnaît cette adresse d'annonce (import par adresse). */
export const connecteurPourAdresse = (adresse) => Object.values(CONNECTEURS).find((c) => c.reconnait?.(adresse)) ?? null;
