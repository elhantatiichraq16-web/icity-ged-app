/**
 * Restauration d'une sauvegarde (§13).
 *
 *   npm run restaurer -w serveur -- "C:\\...\\icity-2026-09-17T22-00-00"
 *   npm run restaurer -w serveur -- "<dossier>" --oui
 *
 * Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde : c'est
 * un espoir. Ce script existe pour que la procédure soit testée.
 *
 * Il ÉCRASE la base visée. Sans --oui, il se contente de décrire ce qu'il
 * ferait, et vérifie que la sauvegarde est complète.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import readline from 'node:readline/promises';
import { config } from '../src/config.js';

const executer = promisify(execFile);
const PSQL = path.join(process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin', 'psql.exe');

const arguments_ = process.argv.slice(2);
const appliquer = arguments_.includes('--oui');
const dossier = arguments_.find((a) => !a.startsWith('--'));

if (!dossier) {
  console.error('Indiquez le dossier de sauvegarde.\n  npm run restaurer -w serveur -- "C:\\chemin\\icity-…" [--oui]');
  process.exit(1);
}

const racine = path.resolve(dossier);
const url = new URL(config.DATABASE_URL);
const base = url.pathname.slice(1);

// ── Vérification de la sauvegarde ──
let contenu;
try {
  contenu = JSON.parse(await fs.readFile(path.join(racine, 'contenu.json'), 'utf8'));
} catch {
  console.error(`  Sauvegarde illisible : ${path.join(racine, 'contenu.json')} manquant.`);
  process.exit(1);
}

const fichierSql = path.join(racine, `${contenu.base}.sql`);
const stockage = path.join(racine, 'stockage');
for (const chemin of [fichierSql, stockage]) {
  try {
    await fs.access(chemin);
  } catch {
    console.error(`  Sauvegarde incomplète : ${chemin} manquant.`);
    process.exit(1);
  }
}

console.log(`\n  ${appliquer ? 'RESTAURATION' : 'VÉRIFICATION'} — ${racine}`);
console.log('  ' + '═'.repeat(70));
console.log(`\n  Sauvegarde du ${new Date(contenu.date).toLocaleString('fr-FR')}`);
console.log(`  ${contenu.documents} documents · ${contenu.marches} marchés · ${contenu.mails} messages`);
console.log(`  ${contenu.fichiers} fichiers (${(contenu.octets / 1024 / 1024).toFixed(1)} Mo)\n`);
console.log(`  Cible : base « ${base} » et stockage « ${config.STOCKAGE} »`);

if (!appliquer) {
  console.log('\n  ' + '═'.repeat(70));
  console.log('  Vérification seulement — rien n’a été touché.');
  console.log('  La sauvegarde est complète et lisible. Relancez avec --oui pour restaurer.\n');
  process.exit(0);
}

// ── Confirmation : on écrase des données ──
const question = readline.createInterface({ input: process.stdin, output: process.stdout });
const reponse = await question.question(`\n  Cette opération ÉCRASE la base « ${base} » et le stockage actuel.\n  Tapez le nom de la base pour confirmer : `);
question.close();
if (reponse.trim() !== base) {
  console.log('\n  Annulé : le nom ne correspond pas.\n');
  process.exit(1);
}

// ── 1. La base ──
const sql = await fs.readFile(fichierSql, 'utf8');
await executer(
  PSQL,
  [
    '-h',
    url.hostname,
    '-p',
    String(url.port || 5432),
    '-U',
    decodeURIComponent(url.username),
    // Sans cela, psql poursuit après une erreur et laisse une base à moitié
    // restaurée : mieux vaut s'arrêter net et savoir pourquoi.
    '-v',
    'ON_ERROR_STOP=1',
    '-d',
    base,
  ],
  {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    input: sql,
    maxBuffer: 512 * 1024 * 1024,
  },
);
console.log('\n  Base restaurée.');

// ── 2. Les fichiers ──
await fs.rm(config.STOCKAGE, { recursive: true, force: true });
await fs.cp(stockage, config.STOCKAGE, { recursive: true });
console.log('  Stockage restauré.');

console.log('\n  Restauration terminée. Relancez le serveur.\n');
