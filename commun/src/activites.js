/**
 * Les activités, sur le modèle d'Odoo : un rappel posé sur une fiche (ou un
 * événement libre), pour une personne et ses participants, à une date et
 * éventuellement une heure, avec un rappel quelques jours avant. Partagé entre le serveur (validation, compteurs) et
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

/** Quand prévenir avant l'activité : le jour même seulement, la veille, 2 jours, une semaine. */
export const RAPPELS = [
  { jours: null, nom: 'Le jour même seulement' },
  { jours: 1, nom: 'La veille' },
  { jours: 2, nom: '2 jours avant' },
  { jours: 7, nom: 'Une semaine avant' },
];

/** Les durées proposées pour une réunion, en minutes. */
export const DUREES = [
  { minutes: 30, nom: '30 min' },
  { minutes: 60, nom: '1 h' },
  { minutes: 90, nom: '1 h 30' },
  { minutes: 120, nom: '2 h' },
  { minutes: 180, nom: '3 h' },
  { minutes: 240, nom: 'Une demi-journée' },
  { minutes: 480, nom: 'La journée' },
];

/**
 * Le premier jour où l'on est prévenu : l'échéance moins `rappelJours`.
 *
 * @param {string} echeance AAAA-MM-JJ
 * @param {number | null | undefined} rappelJours
 */
export function debutRappel(echeance, rappelJours) {
  if (!rappelJours) return echeance;
  return new Date(Date.parse(`${echeance}T00:00:00Z`) - rappelJours * 86_400_000).toISOString().slice(0, 10);
}

/** « 10:00 » et 90 minutes → « 10:00 – 11:30 ». */
export function plageHoraire(heure, dureeMinutes) {
  if (!heure) return null;
  if (!dureeMinutes) return heure;
  const [h, m] = heure.split(':').map(Number);
  const fin = Math.min(h * 60 + m + dureeMinutes, 24 * 60 - 1);
  return `${heure} – ${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`;
}

/** Un champ numérique facultatif : vide → null. */
const nombreFacultatif = (schema) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), schema.nullable()).optional();

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
  heure: z
    .string()
    .trim()
    .refine((v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), { error: 'Une heure comme 09:30.' })
    .transform((v) => v || null)
    .nullish(),
  dureeMinutes: nombreFacultatif(z.number().int().min(5, { error: 'Une durée d’au moins 5 minutes.' }).max(1440, { error: 'Une journée au plus.' })),
  rappelJours: nombreFacultatif(z.number().int().min(1).max(30, { error: '30 jours avant au plus.' })),
  participantIds: z.array(z.coerce.number().int().positive()).max(50, { error: '50 participants au plus.' }).default([]),
});
