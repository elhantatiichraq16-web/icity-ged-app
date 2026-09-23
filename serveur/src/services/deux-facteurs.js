/**
 * Double authentification TOTP : le code à 6 chiffres qui change toutes les
 * 30 secondes dans une application comme Google Authenticator.
 */
import crypto from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { db } from '../db.js';
import { chiffrer, dechiffrer, empreinte } from '../securite/crypto.js';

const EMETTEUR = 'iCity GED';

/** Prépare un nouveau secret (pas encore actif tant qu'il n'est pas confirmé). */
export async function preparer(utilisateur) {
  const secret = generateSecret();
  await db.utilisateur.update({
    where: { id: utilisateur.id },
    data: { deuxFacteursSecret: chiffrer(secret), deuxFacteursActiveLe: null, codesSecours: null, deuxFacteursDernierPas: null },
  });
  const uri = generateURI({ issuer: EMETTEUR, label: utilisateur.email, secret });
  return { secret, uri, qrCode: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/**
 * Vérifie un code TOTP.
 *
 * On tolère 30 s d'écart d'horloge entre le téléphone et le PC. Un code déjà
 * accepté est refusé ensuite : quelqu'un qui l'aperçoit par-dessus l'épaule
 * ne peut pas le rejouer.
 */
export async function verifierCode(utilisateur, code) {
  if (!utilisateur.deuxFacteursSecret || !/^\d{6}$/.test(code)) return false;
  const secret = dechiffrer(utilisateur.deuxFacteursSecret);
  const resultat = await verify({ secret, token: code, epochTolerance: 30 });
  if (!resultat.valid) return false;
  if (utilisateur.deuxFacteursDernierPas != null && resultat.timeStep <= utilisateur.deuxFacteursDernierPas) return false;
  await db.utilisateur.update({ where: { id: utilisateur.id }, data: { deuxFacteursDernierPas: resultat.timeStep } });
  return true;
}

/** Génère 8 codes de secours, rendus une seule fois en clair. */
export async function genererCodesSecours(utilisateurId) {
  const codes = Array.from({ length: 8 }, () => {
    const brut = crypto.randomBytes(5).toString('hex'); // 10 caractères
    return `${brut.slice(0, 5)}-${brut.slice(5)}`;
  });
  // Ces codes sont longs et aléatoires : une empreinte SHA-256 suffit,
  // contrairement à un mot de passe choisi par un humain.
  await db.utilisateur.update({ where: { id: utilisateurId }, data: { codesSecours: codes.map(empreinte) } });
  return codes;
}

/** Utilise un code de secours : il est retiré de la liste s'il est bon. */
export async function utiliserCodeSecours(utilisateur, code) {
  const liste = Array.isArray(utilisateur.codesSecours) ? utilisateur.codesSecours : [];
  const cible = empreinte(code.trim().toLowerCase());
  if (!liste.includes(cible)) return false;
  await db.utilisateur.update({ where: { id: utilisateur.id }, data: { codesSecours: liste.filter((e) => e !== cible) } });
  return true;
}
