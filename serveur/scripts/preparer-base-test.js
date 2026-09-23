/**
 * Prépare la base de TEST (icity_ged_test) avant de lancer les tests : on y
 * applique les migrations manquantes (« migrate deploy », qui n'efface rien).
 * Chaque test vide ensuite lui-même les tables dont il a besoin.
 * La base de travail (icity_ged) n'est jamais touchée : le nom est vérifié.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(RACINE, '.env.test'));
} catch {
  console.error('serveur/.env.test manquant : copiez .env.test.example en .env.test et complétez-le.');
  process.exit(1);
}

const base = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!base.endsWith('_test')) {
  console.error(`Refus : la base « ${base} » ne se termine pas par « _test ». Les tests vident ses tables.`);
  process.exit(1);
}

// Pas de shell : le programme et ses arguments sont passés séparément.
const prisma = path.join(RACINE, '..', 'node_modules', 'prisma', 'build', 'index.js');
execFileSync(process.execPath, [prisma, 'migrate', 'deploy'], {
  cwd: RACINE,
  stdio: 'inherit',
  env: process.env,
});
