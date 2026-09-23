/**
 * Le journal d'audit (§13) : toute action sensible y laisse une ligne.
 *
 * Une panne d'écriture du journal ne doit pas faire échouer l'action
 * elle-même aux yeux de l'utilisateur, mais elle ne doit pas passer
 * inaperçue non plus : on la signale dans les logs du serveur.
 */
import { db } from '../db.js';

/**
 * @param {object} entree
 * @param {number|null} [entree.utilisateurId]
 * @param {string} entree.action          ex. « connexion », « utilisateur.invite »
 * @param {string} [entree.objetType]      ex. « Utilisateur »
 * @param {number} [entree.objetId]
 * @param {object} [entree.avant]
 * @param {object} [entree.apres]
 * @param {string} [entree.commentaire]
 * @param {string} [entree.ip]
 * @param {import('fastify').FastifyBaseLogger} [log]
 */
export async function journaliser(entree, log) {
  try {
    await db.journal.create({
      data: {
        utilisateurId: entree.utilisateurId ?? null,
        action: entree.action,
        objetType: entree.objetType ?? null,
        objetId: entree.objetId ?? null,
        avant: entree.avant ?? undefined,
        apres: entree.apres ?? undefined,
        commentaire: entree.commentaire ?? null,
        ip: entree.ip ?? null,
      },
    });
  } catch (erreur) {
    (log ?? console).error({ err: erreur, action: entree.action }, 'Écriture du journal impossible');
  }
}
