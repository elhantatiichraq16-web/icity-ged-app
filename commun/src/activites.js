/**
 * Les activités, sur le modèle d'Odoo : un rappel posé sur une fiche, pour une
 * personne, à une date. Partagé entre le serveur (validation, compteurs) et
 * les écrans (libellés, couleurs).
 */
import { z } from 'zod';

/** Les types d'activité, avec le verbe qu'on lit dans le fil. */
export const TYPES_ACTIVITES = [
  { code: 'a_faire', nom: 'À faire' },
  { code: 'appel', nom: 'Appel' },
  { code: 'mail', nom: 'Mail' },
  { code: 'reunion', nom: 'Réunion' },
  { code: 'piece', nom: 'Pièce à obtenir' },
];

export const nomTypeActivite = (code) => TYPES_ACTIVITES.find((t) => t.code === code)?.nom ?? code;

/**
 * Où en est l'échéance : « retard » (rouge), « aujourdhui » (orange) ou
 * « avenir » (vert), comme les couleurs d'Odoo.
 *
 * @param {string} echeance  AAAA-MM-JJ
 * @param {string} aujourdhui AAAA-MM-JJ, le jour à Casablanca
 */
export function etatActivite(echeance, aujourdhui) {
  if (echeance < aujourdhui) return 'retard';
  if (echeance === aujourdhui) return 'aujourdhui';
  return 'avenir';
}

/** Le jour d'aujourd'hui à Casablanca, en AAAA-MM-JJ. */
export function jourCasablanca(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(date);
}

/** Planifier ou modifier une activité. */
export const schemaActivite = z.object({
  type: z.enum(TYPES_ACTIVITES.map((t) => t.code), { error: 'Choisissez un type.' }).default('a_faire'),
  resume: z
    .string({ error: 'Résumez l’activité.' })
    .trim()
    .min(2, { error: 'Résumez l’activité en quelques mots.' })
    .max(160, { error: '160 caractères au plus.' }),
  note: z
    .string()
    .trim()
    .max(2000, { error: '2 000 caractères au plus.' })
    .transform((v) => v || null)
    .nullish(),
  echeance: z.iso.date({ error: 'Choisissez une date.' }),
  assigneId: z.coerce.number({ error: 'Choisissez la personne.' }).int().positive({ error: 'Choisissez la personne.' }),
});
