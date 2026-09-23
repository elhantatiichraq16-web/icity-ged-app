/**
 * Réglages de l'outil Prisma (migrations, génération du client).
 *
 * L'adresse de la base vient de .env : elle contient un mot de passe et ne
 * doit jamais être écrite dans un fichier suivi par Git.
 */
import { defineConfig } from 'prisma/config';

// Prisma 7 ne lit plus .env tout seul. Node sait le faire nativement ;
// l'absence du fichier (installation neuve) n'est pas une erreur.
try {
  process.loadEnvFile('.env');
} catch {
  /* pas de .env : on garde l'environnement tel quel */
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Une valeur par défaut factice permet `prisma generate` sans .env
    // (installation neuve) ; les migrations, elles, exigent la vraie.
    url: process.env.DATABASE_URL ?? 'postgresql://icity@127.0.0.1:5432/icity_ged',
    // Base jetable où Prisma rejoue les migrations pour les vérifier.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
