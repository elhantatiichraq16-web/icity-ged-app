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
import { connecteurApi, connecteurHtml } from './generique.js';
import { connecteurPmmp } from './pmmp.js';
import { connecteurRss } from './rss.js';

/** Les connecteurs qui savent lire seuls. « csv » et « manuel » : import seulement. « html » et « api » suivent les règles de la source. */
export const CONNECTEURS = {
  pmmp: connecteurPmmp,
  rss: connecteurRss,
  html: connecteurHtml,
  api: connecteurApi,
};

export const connecteurDe = (code) => CONNECTEURS[code] ?? null;

/** Le connecteur qui reconnaît cette adresse d'annonce (import par adresse). */
export const connecteurPourAdresse = (adresse) => Object.values(CONNECTEURS).find((c) => c.reconnait?.(adresse)) ?? null;
