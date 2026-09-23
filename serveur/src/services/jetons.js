/**
 * Jetons à usage unique envoyés par e-mail : invitation (7 jours) et
 * réinitialisation du mot de passe (60 minutes).
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { empreinte, jetonAleatoire } from '../securite/crypto.js';

const DUREES = {
  invitation: 7 * 24 * 60 * 60_000,
  reinitialisation: 60 * 60_000,
};

const CHEMINS = {
  invitation: '/invitation',
  reinitialisation: '/reinitialiser',
};

/**
 * Crée un jeton et rend le lien à envoyer. Les jetons précédents du même type
 * sont annulés : seul le dernier e-mail reçu fonctionne.
 *
 * @param {number} utilisateurId
 * @param {'invitation'|'reinitialisation'} type
 */
export async function creerJeton(utilisateurId, type) {
  const jeton = jetonAleatoire();
  await db.$transaction([
    db.jeton.deleteMany({ where: { utilisateurId, type, utiliseLe: null } }),
    db.jeton.create({
      data: { utilisateurId, type, empreinte: empreinte(jeton), expireLe: new Date(Date.now() + DUREES[type]) },
    }),
  ]);
  return `${config.APP_URL}${CHEMINS[type]}/${jeton}`;
}

/** Le jeton valide (non expiré, non utilisé) avec son utilisateur, ou null. */
export async function trouverJeton(jeton, type) {
  if (!jeton || jeton.length > 200) return null;
  const trouve = await db.jeton.findUnique({ where: { empreinte: empreinte(jeton) }, include: { utilisateur: true } });
  if (!trouve || trouve.type !== type || trouve.utiliseLe || trouve.expireLe < new Date() || !trouve.utilisateur.actif) {
    return null;
  }
  return trouve;
}

export function consommerJeton(id) {
  return db.jeton.update({ where: { id }, data: { utiliseLe: new Date() } });
}
