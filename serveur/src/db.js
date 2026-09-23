/**
 * La connexion à PostgreSQL, partagée par tout le serveur.
 *
 * Prisma 7 passe par un « adaptateur » : ici le pilote `pg`. Le nombre de
 * connexions reste bas : un seul poste, peu de mémoire (§2).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config.js';

const adaptateur = new PrismaPg({
  connectionString: config.DATABASE_URL,
  // Peu de connexions : ce PC a 3,7 Go (§2). En test, chaque fichier ouvre
  // son propre pool ; au-delà de deux connexions, Windows finit par tuer le
  // processus.
  max: config.estTest ? 2 : 5,
});

export const db = new PrismaClient({ adapter: adaptateur });
