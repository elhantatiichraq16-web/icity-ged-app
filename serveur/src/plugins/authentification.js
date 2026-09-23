/**
 * Qui fait la requête, et en a-t-il le droit ?
 *
 * À chaque requête, ce plugin :
 *  1. lit le cookie de session et retrouve l'utilisateur ;
 *  2. calcule ses droits (matrice partagée dans commun/droits.js) ;
 *  3. pour toute écriture (POST, PUT, PATCH, DELETE), bloque les requêtes
 *     venues d'un autre site (CSRF) : l'origine doit être la nôtre, et un
 *     utilisateur connecté doit renvoyer son jeton CSRF dans un en-tête.
 *
 * Les routes s'en servent ensuite avec `exigerConnexion` et `exiger(action, sujet)`.
 */
import fp from 'fastify-plugin';
import { droitsPour } from '@icity/commun/droits';
import { config } from '../config.js';
import { ErreurHttp, interdit, nonConnecte } from '../erreurs.js';
import { lireSession, NOM_COOKIE } from '../services/sessions.js';
import { egalesSansFuite } from '../securite/crypto.js';

const ECRITURES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** L'utilisateur tel que les routes et les écrans le voient (sans secrets). */
export function utilisateurPublic(u) {
  return {
    id: u.id,
    nom: u.nom,
    email: u.email,
    role: u.role.code,
    roleNom: u.role.nom,
    avatar: u.avatar ? `/api/utilisateurs/${u.id}/avatar?v=${encodeURIComponent(u.avatar.slice(0, 8))}` : null,
    deuxFacteurs: Boolean(u.deuxFacteursActiveLe),
    derniereConnexion: u.derniereConnexion,
  };
}

async function authentification(app) {
  app.decorateRequest('session', null);
  app.decorateRequest('utilisateur', null);
  app.decorateRequest('droits', null);

  app.addHook('onRequest', async (requete) => {
    // ── Contrôle d'origine sur les écritures ──
    // Un navigateur envoie toujours l'en-tête Origin avec un POST venu d'une
    // page. S'il désigne un autre site, c'est une tentative de CSRF.
    if (ECRITURES.has(requete.method)) {
      const origine = requete.headers.origin;
      if (origine && !config.ORIGINES.includes(origine)) {
        throw new ErreurHttp(403, 'Origine de la requête refusée.');
      }
    }

    const session = await lireSession(requete.cookies[NOM_COOKIE]);
    requete.session = session;

    // Session complète seulement : entre le mot de passe et le code 2FA,
    // on n'est pas encore connecté.
    const connecte = session && !session.attenteDeuxFacteurs;
    requete.utilisateur = connecte ? session.utilisateur : null;
    requete.droits = droitsPour(connecte ? { id: session.utilisateur.id, role: session.utilisateur.role.code } : null);

    // ── Jeton CSRF ──
    // Deuxième ligne de défense : un site tiers ne peut pas lire ce jeton,
    // donc ne peut pas le renvoyer. On l'exige dès qu'une session existe.
    if (session && ECRITURES.has(requete.method)) {
      const recu = requete.headers['x-csrf-token'];
      if (!recu || !egalesSansFuite(recu, session.jetonCsrf)) {
        throw new ErreurHttp(419, 'La page a expiré. Rechargez-la puis réessayez.');
      }
    }
  });
}

export default fp(authentification, { name: 'authentification', dependencies: ['@fastify/cookie'] });

/** preHandler : refuse l'accès si personne n'est connecté. */
export async function exigerConnexion(requete) {
  if (!requete.utilisateur) throw nonConnecte();
}

/**
 * preHandler : exige un droit.
 * @param {string} action
 * @param {string} sujet
 */
export function exiger(action, sujet) {
  return async (requete) => {
    if (!requete.utilisateur) throw nonConnecte();
    if (!requete.droits.can(action, sujet)) throw interdit();
  };
}
