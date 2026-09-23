/**
 * Petites briques de cryptographie, toutes tirées du module `crypto` de Node.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

/** Un jeton imprévisible, sûr à mettre dans une URL (256 bits). */
export function jetonAleatoire(octets = 32) {
  return crypto.randomBytes(octets).toString('base64url');
}

/**
 * L'empreinte SHA-256 d'un jeton, en hexadécimal.
 *
 * On ne stocke que l'empreinte des jetons (session, invitation,
 * réinitialisation) : qui lit la base ne peut pas s'en servir.
 */
export function empreinte(valeur) {
  return crypto.createHash('sha256').update(valeur).digest('hex');
}

/** Compare deux chaînes en temps constant (évite de deviner octet par octet). */
export function egalesSansFuite(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Chiffre un secret avec AES-256-GCM et la clé CLE_APP.
 * Résultat : « iv.tag.données », en base64url.
 */
export function chiffrer(texte) {
  const iv = crypto.randomBytes(12);
  const chiffreur = crypto.createCipheriv('aes-256-gcm', config.CLE, iv);
  const donnees = Buffer.concat([chiffreur.update(texte, 'utf8'), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();
  return [iv, tag, donnees].map((b) => b.toString('base64url')).join('.');
}

/** L'inverse de chiffrer(). Lève une erreur si la donnée a été altérée. */
export function dechiffrer(paquet) {
  const [iv, tag, donnees] = paquet.split('.').map((p) => Buffer.from(p, 'base64url'));
  const dechiffreur = crypto.createDecipheriv('aes-256-gcm', config.CLE, iv);
  dechiffreur.setAuthTag(tag);
  return Buffer.concat([dechiffreur.update(donnees), dechiffreur.final()]).toString('utf8');
}
