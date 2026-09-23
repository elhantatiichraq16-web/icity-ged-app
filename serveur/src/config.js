/**
 * Réglages du serveur, lus une seule fois dans l'environnement (.env).
 *
 * Tout est vérifié au démarrage : un réglage manquant arrête le serveur avec
 * un message clair, plutôt que de laisser une erreur obscure surgir au
 * premier clic. Aucun secret n'a de valeur par défaut.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Fuseau du Maroc pour toutes les dates calculées par Node (§2).
process.env.TZ ??= 'Africa/Casablanca';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const RACINE_SERVEUR = path.resolve(ICI, '..');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // 127.0.0.1 seulement (§2) : l'application n'écoute jamais le réseau.
  PORT: z.coerce.number().int().default(8080),

  // L'adresse que l'on met dans les liens envoyés par e-mail.
  APP_URL: z.url().default('http://127.0.0.1:8080'),
  // Les origines d'où une requête d'écriture est acceptée (anti-CSRF).
  ORIGINES_AUTORISEES: z.string().default('http://127.0.0.1:8080,http://127.0.0.1:5173'),

  DATABASE_URL: z.string().startsWith('postgresql://', { error: 'DATABASE_URL doit commencer par postgresql://' }),

  // Clé de 32 octets en base64, pour chiffrer les secrets en base
  // (2FA, mots de passe des boîtes mail). `npm run cle -w serveur` en génère une.
  CLE_APP: z
    .string({ error: 'CLE_APP manquante : lancez « npm run cle -w serveur » et copiez-la dans serveur/.env' })
    .refine((v) => Buffer.from(v, 'base64').length === 32, { error: 'CLE_APP doit faire 32 octets encodés en base64.' }),

  STOCKAGE: z.string().default(path.join(RACINE_SERVEUR, 'stockage')),

  // Poppler (pdftotext, pdftoppm, pdfinfo, pdfunite) et Tesseract. On donne
  // le dossier, pas la commande : le PATH de Windows contient un autre
  // pdftotext (celui de Git), qui n'est pas celui de Poppler.
  POPPLER_BIN: z.string().optional(),
  TESSERACT_BIN: z.string().optional(),
  // Le dossier des langues. L'installeur Windows pose « tessdata » sous
  // Program Files, que Windows protège en écriture : ajouter le français et
  // l'arabe demande alors les droits administrateur. Un dossier à soi évite
  // cela, et Tesseract le suit par TESSDATA_PREFIX.
  TESSDATA_PREFIX: z.string().optional(),
  OCR_LANGUES: z.string().default('fra+ara+eng'),

  // Durées de session : 2 h sans activité, 30 jours avec « Se souvenir de moi ».
  SESSION_INACTIVITE_MINUTES: z.coerce.number().int().positive().default(120),
  SESSION_SOUVENIR_JOURS: z.coerce.number().int().positive().default(30),

  // Courriel sortant (Mailpit en développement).
  MAIL_HOTE: z.string().default('127.0.0.1'),
  MAIL_PORT: z.coerce.number().int().default(1025),
  MAIL_UTILISATEUR: z.string().optional(),
  MAIL_MOT_DE_PASSE: z.string().optional(),
  MAIL_EXPEDITEUR: z.string().default('iCity GED <ged@icity.local>'),
});

const lu = schema.safeParse(process.env);
if (!lu.success) {
  const lignes = lu.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`);
  throw new Error(`Configuration invalide (serveur/.env) :\n${lignes.join('\n')}`);
}

export const config = {
  ...lu.data,
  HOTE: '127.0.0.1',
  ORIGINES: lu.data.ORIGINES_AUTORISEES.split(',').map((o) => o.trim()).filter(Boolean),
  CLE: Buffer.from(lu.data.CLE_APP, 'base64'),
  estTest: lu.data.NODE_ENV === 'test',
  estProduction: lu.data.NODE_ENV === 'production',
};
