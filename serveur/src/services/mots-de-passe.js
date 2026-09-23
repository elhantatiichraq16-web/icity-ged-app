/**
 * Hachage des mots de passe avec bcrypt (§13).
 *
 * bcryptjs est la version en pur JavaScript : aucune compilation sous
 * Windows. Le coût 12 prend environ un quart de seconde par essai : rien pour
 * un utilisateur, beaucoup pour qui essaie des millions de mots de passe.
 */
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

// Les tests créent beaucoup de comptes : un coût bas les garde rapides.
const COUT = config.estTest ? 4 : 12;

// Un hachage factice, comparé quand l'e-mail n'existe pas. Sans lui, la
// réponse serait plus rapide pour un compte inconnu, et le temps de réponse
// trahirait quelles adresses ont un compte.
const HACHAGE_LEURRE = bcrypt.hashSync('leurre-sans-valeur-0', COUT);

export function hacher(motDePasse) {
  return bcrypt.hash(motDePasse, COUT);
}

export async function verifier(motDePasse, hachage) {
  return bcrypt.compare(motDePasse, hachage ?? HACHAGE_LEURRE).then((ok) => ok && Boolean(hachage));
}
