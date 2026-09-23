/**
 * Outils partagés par les tests du serveur.
 */
import { ROLES } from '@icity/commun/roles';
import { construireApp } from '../src/app.js';
import { db } from '../src/db.js';
import { boiteDeTest } from '../src/services/courriel.js';
import { hacher } from '../src/services/mots-de-passe.js';

export const MOT_DE_PASSE = 'Casablanca2026';
export const ORIGINE = 'http://127.0.0.1:5173';

/** Vide les tables et remet les 7 rôles, pour partir d'un état connu. */
export async function viderBase() {
  await db.journal.deleteMany();
  await db.jeton.deleteMany();
  await db.session.deleteMany();
  await db.utilisateur.deleteMany();
  for (const role of ROLES) {
    await db.role.upsert({ where: { code: role.code }, update: {}, create: role });
  }
  boiteDeTest.length = 0;
}

let compteur = 0;

/** Crée un compte actif avec le rôle demandé. */
export async function creerUtilisateur(role = 'lecteur', champs = {}) {
  compteur += 1;
  const r = await db.role.findUniqueOrThrow({ where: { code: role } });
  return db.utilisateur.create({
    data: {
      nom: `Test ${role} ${compteur}`,
      email: `test${compteur}-${Date.now()}@exemple.ma`,
      motDePasse: await hacher(MOT_DE_PASSE),
      roleId: r.id,
      ...champs,
    },
    include: { role: true },
  });
}

/** Une application neuve (compteurs de tentatives remis à zéro). */
export function nouvelleApp() {
  return construireApp({ journal: false });
}

/** Extrait le cookie de session d'une réponse. */
export function cookieDe(reponse) {
  const c = reponse.cookies.find((x) => x.name === 'icity_session');
  return c ? `icity_session=${c.value}` : undefined;
}

/**
 * Connecte un utilisateur et rend de quoi faire des requêtes en son nom.
 * @returns {Promise<{ cookie: string, csrf: string, reponse: any }>}
 */
export async function connecter(app, email, motDePasse = MOT_DE_PASSE) {
  const reponse = await app.inject({
    method: 'POST',
    url: '/api/auth/connexion',
    headers: { origin: ORIGINE },
    payload: { email, motDePasse },
  });
  return { cookie: cookieDe(reponse), csrf: reponse.json().csrf, reponse };
}

/** Une requête faite par un utilisateur connecté (cookie + jeton CSRF). */
export function en(app, { cookie, csrf }) {
  return (method, url, payload) =>
    app.inject({ method, url, payload, headers: { cookie, 'x-csrf-token': csrf, origin: ORIGINE } });
}
