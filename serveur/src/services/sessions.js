/**
 * Les sessions de connexion.
 *
 * Le principe, en trois points :
 *  1. À la connexion, on tire un jeton aléatoire de 256 bits. Il part dans
 *     un cookie `HttpOnly` (invisible au JavaScript de la page).
 *  2. La base ne garde que l'empreinte SHA-256 du jeton. Quelqu'un qui lit la
 *     base ne peut donc pas se faire passer pour un utilisateur.
 *  3. Chaque connexion crée un NOUVEAU jeton (« régénération ») : un jeton
 *     posé à l'avance par un attaquant ne devient jamais une session valide.
 *
 * Une session expire après 2 h sans activité, ou 30 jours avec « Se souvenir
 * de moi ».
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { empreinte, jetonAleatoire } from '../securite/crypto.js';

export const NOM_COOKIE = 'icity_session';

const MINUTE = 60_000;

function duree(seSouvenir) {
  return seSouvenir ? config.SESSION_SOUVENIR_JOURS * 24 * 60 * MINUTE : config.SESSION_INACTIVITE_MINUTES * MINUTE;
}

/**
 * Ouvre une session et rend le jeton à placer dans le cookie.
 *
 * @param {number} utilisateurId
 * @param {{ seSouvenir?: boolean, attenteDeuxFacteurs?: boolean, ip?: string, agent?: string }} options
 */
export async function ouvrirSession(utilisateurId, { seSouvenir = false, attenteDeuxFacteurs = false, ip, agent } = {}) {
  const jeton = jetonAleatoire();
  // L'étape 2FA se franchit en quelques minutes ou pas du tout.
  const vie = attenteDeuxFacteurs ? 10 * MINUTE : duree(seSouvenir);
  const session = await db.session.create({
    data: {
      id: empreinte(jeton),
      utilisateurId,
      jetonCsrf: jetonAleatoire(24),
      seSouvenir,
      attenteDeuxFacteurs,
      ip: ip?.slice(0, 45),
      agent: agent?.slice(0, 255),
      expireLe: new Date(Date.now() + vie),
    },
  });
  return { jeton, session };
}

/**
 * Retrouve la session d'un jeton, avec son utilisateur, ou null si elle
 * n'existe pas, a expiré, ou si le compte a été désactivé entre-temps.
 */
export async function lireSession(jeton) {
  if (!jeton || typeof jeton !== 'string' || jeton.length > 100) return null;
  const session = await db.session.findUnique({
    where: { id: empreinte(jeton) },
    include: { utilisateur: { include: { role: true } } },
  });
  if (!session) return null;

  if (session.expireLe < new Date() || !session.utilisateur.actif) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // On repousse l'expiration à chaque passage, mais pas plus d'une fois par
  // minute : écrire en base à chaque requête ralentirait tout pour rien.
  if (!session.attenteDeuxFacteurs && Date.now() - session.derniereActivite.getTime() > MINUTE) {
    const expireLe = new Date(Date.now() + duree(session.seSouvenir));
    await db.session.update({ where: { id: session.id }, data: { derniereActivite: new Date(), expireLe } });
    session.expireLe = expireLe;
  }
  return session;
}

export function fermerSession(idSession) {
  return db.session.deleteMany({ where: { id: idSession } });
}

/** Déconnecte toutes les sessions d'un utilisateur, sauf éventuellement une. */
export function fermerAutresSessions(utilisateurId, garderId = null) {
  return db.session.deleteMany({
    where: { utilisateurId, ...(garderId ? { id: { not: garderId } } : {}) },
  });
}

/** Options du cookie de session. */
export function optionsCookie(session) {
  return {
    path: '/',
    httpOnly: true,
    // « lax » : le cookie ne part pas avec un formulaire posté depuis un
    // autre site. Première ligne de défense contre le CSRF.
    sameSite: 'lax',
    // L'application tourne en http sur 127.0.0.1 : un cookie « secure »
    // ne serait jamais renvoyé. À activer derrière HTTPS.
    secure: config.APP_URL.startsWith('https://'),
    // Sans « Se souvenir de moi », le cookie meurt à la fermeture du navigateur.
    ...(session.seSouvenir ? { expires: session.expireLe } : {}),
  };
}
