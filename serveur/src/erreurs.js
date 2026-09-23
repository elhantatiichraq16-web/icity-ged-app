/**
 * Les erreurs métier, transformées en réponses HTTP claires par app.js.
 */
import { ZodError } from 'zod';
import { erreursParChamp } from '@icity/commun/schemas';

export class ErreurHttp extends Error {
  /**
   * @param {number} statut
   * @param {string} message   message affiché à l'utilisateur, en français
   * @param {object} [details]
   */
  constructor(statut, message, details) {
    super(message);
    this.statut = statut;
    this.details = details;
  }
}

export const nonConnecte = () => new ErreurHttp(401, 'Connectez-vous pour continuer.');
export const interdit = () => new ErreurHttp(403, "Vous n'avez pas le droit de faire cette action.");
export const introuvable = (quoi = 'Élément') => new ErreurHttp(404, `${quoi} introuvable.`);

/** Valide un corps de requête avec un schéma Zod, ou lève une erreur 422. */
export function valider(schema, donnees) {
  const r = schema.safeParse(donnees ?? {});
  if (!r.success) throw r.error;
  return r.data;
}

/** Le gestionnaire d'erreurs de Fastify : une forme de réponse unique. */
export function gestionnaireErreurs(erreur, requete, reponse) {
  if (erreur instanceof ZodError) {
    return reponse.code(422).send({ message: 'Certains champs sont à corriger.', erreurs: erreursParChamp(erreur) });
  }
  if (erreur instanceof ErreurHttp) {
    return reponse.code(erreur.statut).send({ message: erreur.message, ...erreur.details });
  }
  // Limite de tentatives dépassée (@fastify/rate-limit).
  if (erreur.statusCode === 429) {
    return reponse.code(429).send({ message: erreur.message });
  }
  // Erreurs de Fastify lui-même (corps illisible, fichier trop gros…).
  if (erreur.statusCode && erreur.statusCode < 500) {
    return reponse.code(erreur.statusCode).send({ message: 'Requête invalide.' });
  }
  // Le détail d'une erreur interne reste dans les logs : il pourrait révéler
  // la structure de la base ou un chemin de fichier.
  requete.log.error(erreur);
  return reponse.code(500).send({ message: 'Une erreur interne est survenue. Réessayez.' });
}
