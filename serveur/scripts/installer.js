/**
 * Installation locale, à lancer une fois : npm run installer -w serveur
 *
 * 1. crée dans PostgreSQL un rôle « icity » avec un mot de passe aléatoire,
 *    et trois bases : icity_ged (travail), icity_ged_test (tests),
 *    icity_ged_shadow (utilisée par Prisma pour vérifier les migrations) ;
 * 2. écrit serveur/.env et serveur/.env.test avec ces accès et une clé de
 *    chiffrement neuve.
 *
 * Rien n'est écrasé : si .env existe déjà, le script s'arrête. Aucun secret
 * n'est affiché ni écrit ailleurs que dans ces deux fichiers, ignorés par Git.
 *
 * Réglages facultatifs (variables d'environnement) :
 *   PG_BIN           dossier de psql.exe (défaut : PostgreSQL 17)
 *   PGPASSWORD       mot de passe du superutilisateur « postgres »
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = path.join(RACINE, '.env');
const ENV_TEST = path.join(RACINE, '.env.test');
const PSQL = path.join(process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin', 'psql.exe');

if (fs.existsSync(ENV)) {
  console.log('serveur/.env existe déjà : rien à faire. Supprimez-le pour tout recréer.');
  process.exit(0);
}
if (!fs.existsSync(PSQL)) {
  console.error(`psql.exe introuvable : ${PSQL}\nIndiquez son dossier dans la variable PG_BIN.`);
  process.exit(1);
}
if (!process.env.PGPASSWORD) {
  console.error('PGPASSWORD manquant : indiquez le mot de passe du compte « postgres ».');
  process.exit(1);
}

// Uniquement des lettres et chiffres : aucun échappement à craindre, ni en SQL ni dans l'URL.
const mdp = crypto.randomBytes(24).toString('base64url').replace(/[-_]/g, 'x');
const cle = () => crypto.randomBytes(32).toString('base64');

/*
 * PostgreSQL n'a pas de « CREATE DATABASE IF NOT EXISTS » : on interroge
 * d'abord, on crée ensuite. Le rôle, lui, se met à jour dans un bloc.
 */
const sqlRole = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'icity') THEN
    CREATE ROLE icity LOGIN PASSWORD '${mdp}';
  ELSE
    ALTER ROLE icity LOGIN PASSWORD '${mdp}';
  END IF;
END $$;
`;

const bases = ['icity_ged', 'icity_ged_test', 'icity_ged_shadow'];

/** Lance du SQL en tant que superutilisateur. */
const enTantQuePostgres = (sql, base = 'postgres') =>
  // Le SQL passe par l'entrée standard et le mot de passe par
  // l'environnement : ni l'un ni l'autre n'apparaît dans la liste des
  // processus. Pas de shell (execFile).
  execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-d', base], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

try {
  enTantQuePostgres(sqlRole);

  for (const base of bases) {
    const existe = execFileSync(
      PSQL,
      ['-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname = '${base}'`],
      { encoding: 'utf8' },
    ).trim();

    if (!existe) enTantQuePostgres(`CREATE DATABASE ${base} OWNER icity ENCODING 'UTF8'`);
    // Depuis PostgreSQL 15, le schéma public appartient à postgres : sans ce
    // droit, Prisma ne peut pas y créer ses tables.
    enTantQuePostgres('GRANT ALL ON SCHEMA public TO icity', base);
  }
} catch {
  console.error('\nConnexion à PostgreSQL impossible. Le service est-il démarré, et PGPASSWORD correct ?');
  process.exit(1);
}

const url = (base) => `postgresql://icity:${mdp}@127.0.0.1:5432/${base}`;
const modele = fs.readFileSync(path.join(RACINE, '.env.example'), 'utf8');

fs.writeFileSync(
  ENV,
  modele
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url('icity_ged')}\nSHADOW_DATABASE_URL=${url('icity_ged_shadow')}`)
    .replace(/^CLE_APP=.*$/m, `CLE_APP=${cle()}`),
);
fs.writeFileSync(
  ENV_TEST,
  fs
    .readFileSync(path.join(RACINE, '.env.test.example'), 'utf8')
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url('icity_ged_test')}\nSHADOW_DATABASE_URL=${url('icity_ged_shadow')}`)
    .replace(/^CLE_APP=.*$/m, `CLE_APP=${cle()}`),
);

console.log('Bases et rôle PostgreSQL « icity » prêts.');
console.log('serveur/.env et serveur/.env.test écrits.');
console.log('Complétez ADMIN_NOM et ADMIN_EMAIL dans serveur/.env, puis : npm run db:migrer && npm run db:seed');
