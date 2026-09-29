/**
 * Les appels au serveur, en un seul endroit.
 *
 * Chaque écriture (POST, PATCH, DELETE) renvoie le jeton CSRF reçu à la
 * connexion : le serveur refuse toute écriture sans lui.
 */

let jetonCsrf = null;

/** Retient le jeton CSRF donné par /api/auth/moi ou par la connexion. */
export function definirCsrf(jeton) {
  jetonCsrf = jeton;
}

/** Une erreur renvoyée par le serveur, avec ses messages par champ. */
export class ErreurApi extends Error {
  constructor(statut, corps) {
    super(corps?.message || `Erreur ${statut}`);
    this.statut = statut;
    /** @type {Record<string, string>} */
    this.erreurs = corps?.erreurs ?? {};
    /** Le reste de la réponse : un 409 y désigne l'élément qui existe déjà. */
    this.donnees = corps ?? null;
  }
}

/**
 * @param {string} chemin
 * @param {{ methode?: string, corps?: any, fichier?: FormData, signal?: AbortSignal }} [options]
 */
export async function api(chemin, { methode = 'GET', corps, fichier, signal } = {}) {
  const entetes = { Accept: 'application/json' };
  if (methode !== 'GET' && jetonCsrf) entetes['X-CSRF-Token'] = jetonCsrf;

  let body;
  if (fichier) {
    body = fichier; // le navigateur pose lui-même l'en-tête multipart
  } else if (corps !== undefined) {
    entetes['Content-Type'] = 'application/json';
    body = JSON.stringify(corps);
  }

  let reponse;
  try {
    reponse = await fetch(chemin, { method: methode, headers: entetes, body, credentials: 'same-origin', signal });
  } catch (erreur) {
    if (erreur.name === 'AbortError') throw erreur;
    throw new ErreurApi(0, { message: 'Le serveur ne répond pas. Vérifiez qu’il est démarré.' });
  }

  const texte = await reponse.text();
  let donnees = null;
  try {
    donnees = texte ? JSON.parse(texte) : null;
  } catch {
    donnees = null;
  }

  if (!reponse.ok) {
    const erreur = new ErreurApi(reponse.status, donnees);
    // Session perdue (expirée, fermée ailleurs) : l'application revient à
    // l'écran de connexion. Les écrans d'authentification gèrent leur 401 eux-mêmes.
    if ((reponse.status === 401 || reponse.status === 419) && !chemin.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('icity:session-perdue'));
    }
    throw erreur;
  }
  return donnees;
}
