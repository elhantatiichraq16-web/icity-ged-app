/**
 * Les formulaires, décrits une seule fois avec Zod.
 *
 * L'écran s'en sert pour afficher l'erreur sous le champ avant l'envoi ; le
 * serveur s'en sert pour refuser ce qui arrive quand même. Les messages sont
 * en français et s'affichent tels quels.
 */
import { z } from 'zod';
import { CODES_ROLES } from './roles.js';

// Messages par défaut de Zod en français, pour les cas non prévus ci-dessous.
z.config(z.locales.fr());

const email = z
  .string({ error: 'Saisissez une adresse e-mail.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Cette adresse e-mail n'est pas valide." }));

/**
 * Règle des mots de passe. Au moins 10 caractères, une lettre et un chiffre.
 *
 * Le plafond de 72 octets n'est pas arbitraire : bcrypt ignore tout ce qui
 * dépasse. Deux mots de passe identiques sur leurs 72 premiers octets
 * seraient acceptés l'un pour l'autre ; on refuse donc plutôt que de tronquer
 * en silence.
 */
export const motDePasse = z
  .string({ error: 'Saisissez un mot de passe.' })
  .min(10, { error: 'Au moins 10 caractères.' })
  .refine((v) => new TextEncoder().encode(v).length <= 72, {
    error: '72 octets au plus (environ 70 caractères).',
  })
  .refine((v) => /\p{L}/u.test(v) && /\d/.test(v), {
    error: 'Au moins une lettre et un chiffre.',
  });

export const schemaConnexion = z.object({
  email,
  motDePasse: z.string({ error: 'Saisissez votre mot de passe.' }).min(1, { error: 'Saisissez votre mot de passe.' }),
  seSouvenir: z.boolean().optional().default(false),
});

export const schemaCodeDeuxFacteurs = z.object({
  // Un code à 6 chiffres, ou un code de secours de la forme xxxx-xxxx.
  code: z
    .string({ error: 'Saisissez le code à 6 chiffres.' })
    .trim()
    .min(6, { error: 'Saisissez le code à 6 chiffres.' })
    .max(20),
});

export const schemaMotDePasseOublie = z.object({ email });

/** Nouveau mot de passe, avec confirmation. Sert à la réinitialisation et à l'invitation. */
export const schemaNouveauMotDePasse = z
  .object({
    jeton: z.string({ error: 'Lien invalide.' }).min(20, { error: 'Lien invalide.' }).max(200, { error: 'Lien invalide.' }),
    motDePasse,
    confirmation: z.string({ error: 'Confirmez le mot de passe.' }),
  })
  .refine((d) => d.motDePasse === d.confirmation, {
    path: ['confirmation'],
    error: 'Les deux mots de passe ne sont pas identiques.',
  });

export const schemaChangerMotDePasse = z
  .object({
    actuel: z.string({ error: 'Saisissez votre mot de passe actuel.' }).min(1, { error: 'Saisissez votre mot de passe actuel.' }),
    motDePasse,
    confirmation: z.string({ error: 'Confirmez le mot de passe.' }),
  })
  .refine((d) => d.motDePasse === d.confirmation, {
    path: ['confirmation'],
    error: 'Les deux mots de passe ne sont pas identiques.',
  });

export const schemaProfil = z.object({
  nom: z.string({ error: 'Saisissez un nom.' }).trim().min(2, { error: 'Au moins 2 caractères.' }).max(120),
});

export const schemaInvitation = z.object({
  nom: z.string({ error: 'Saisissez un nom.' }).trim().min(2, { error: 'Au moins 2 caractères.' }).max(120),
  email,
  role: z.enum(CODES_ROLES, { error: 'Choisissez un rôle.' }),
});

export const schemaModifierUtilisateur = z.object({
  role: z.enum(CODES_ROLES).optional(),
  actif: z.boolean().optional(),
});

/** Une liste saisie sans doublon : « TGR, TGR » ne fait qu'un synonyme. */
const sansDoublon = (liste) => [...new Set(liste)];

/**
 * Un maître d'ouvrage (écran Clients).
 *
 * Les synonymes servent à reconnaître le client dans le texte lu (§7), les
 * domaines à rattacher ses mails (§10). Ils arrivent déjà découpés en listes.
 */
export const schemaClient = z.object({
  nom: z
    .string({ error: 'Saisissez le nom du client.' })
    .trim()
    .min(2, { error: 'Au moins 2 caractères.' })
    .max(160, { error: '160 caractères au plus.' }),
  sigle: z
    .string()
    .trim()
    .max(40, { error: '40 caractères au plus.' })
    .transform((v) => v || null)
    .nullish(),
  synonymes: z.array(z.string().trim().min(1).max(120)).max(30, { error: '30 synonymes au plus.' }).default([]).transform(sansDoublon),
  domainesEmail: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/, { error: 'Domaine invalide : écrivez par exemple « tgr.gov.ma », sans @.' }),
    )
    .max(20, { error: '20 domaines au plus.' })
    .default([])
    .transform(sansDoublon),
});

/**
 * Transforme les erreurs Zod en { champ: message }, la forme qu'affichent
 * les formulaires.
 *
 * @param {import('zod').ZodError} erreur
 * @returns {Record<string, string>}
 */
export function erreursParChamp(erreur) {
  const sortie = {};
  for (const probleme of erreur.issues) {
    const champ = probleme.path.join('.') || '_';
    sortie[champ] ??= probleme.message;
  }
  return sortie;
}
