/**
 * La sauvegarde complète : la base ET les fichiers (§13).
 *
 * Une sauvegarde qui ne contient que la base ne sert à rien — les documents
 * vivent dans le stockage, pas dans la base. On prend donc les deux, dans un
 * même dossier horodaté, avec un fichier de contrôle qui dit ce qu'il
 * contient.
 *
 * Ce service existe pour que l'écran des Paramètres et le script en ligne de
 * commande fassent exactement la même chose. Une sauvegarde lancée d'un clic
 * doit valoir celle qu'on lance au clavier.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { db } from '../db.js';

const executer = promisify(execFile);

/** Au-delà, les plus anciennes partent : un disque n'est pas extensible. */
export const A_GARDER = 4;

/** Le dossier où s'empilent les sauvegardes. */
export function racineSauvegardes(vers) {
  return path.resolve(vers ?? path.join(config.STOCKAGE, '..', 'sauvegardes'));
}

/**
 * `pg_dump`, l'outil de sauvegarde de PostgreSQL.
 *
 * Il vit à côté du serveur ; PG_BIN permet d'indiquer un autre dossier si
 * l'installation n'est pas à l'endroit habituel.
 */
const PG_DUMP = () => path.join(process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin', 'pg_dump.exe');

/** Copie récursive du stockage, et ce qu'elle pèse. */
async function copierStockage(destination) {
  await fs.cp(config.STOCKAGE, destination, { recursive: true, force: true });

  let fichiers = 0;
  let octets = 0;
  async function compter(dossier) {
    for (const e of await fs.readdir(dossier, { withFileTypes: true })) {
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) await compter(complet);
      else {
        fichiers += 1;
        octets += (await fs.stat(complet)).size;
      }
    }
  }
  await compter(destination).catch(() => {});
  return { fichiers, octets };
}

/**
 * Écrit une sauvegarde complète et rend son bilan.
 *
 * @param {{ vers?: string, log?: object }} options
 * @returns {Promise<{ dossier: string, base: string, octetsSql: number, fichiers: number, octets: number, documents: number, marches: number, mails: number, retirees: string[] }>}
 */
export async function sauvegarder({ vers, log = console } = {}) {
  const racine = racineSauvegardes(vers);
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dossier = path.join(racine, `icity-${horodatage}`);
  await fs.mkdir(dossier, { recursive: true });

  // ── La base ──
  const url = new URL(config.DATABASE_URL);
  const base = url.pathname.slice(1);
  const fichierSql = path.join(dossier, `${base}.sql`);

  // Le mot de passe passe par l'environnement, pas par la ligne de commande :
  // sinon il apparaîtrait dans la liste des processus.
  const { stdout } = await executer(
    PG_DUMP(),
    [
      '-h',
      url.hostname,
      '-p',
      String(url.port || 5432),
      '-U',
      decodeURIComponent(url.username),
      // Un dump en clair se relit et se corrige : sur un fonds de cette
      // taille, la compression n'apporterait pas grand-chose.
      '--format=plain',
      '--no-owner',
      '--no-privileges',
      base,
    ],
    { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, maxBuffer: 512 * 1024 * 1024 },
  );
  await fs.writeFile(fichierSql, stdout, 'utf8');
  const { size: octetsSql } = await fs.stat(fichierSql);

  // ── Les fichiers ──
  const { fichiers, octets } = await copierStockage(path.join(dossier, 'stockage'));

  // ── Le contrôle ──
  const [documents, marches, mails] = await Promise.all([db.document.count(), db.marche.count(), db.mail.count()]);
  await fs.writeFile(
    path.join(dossier, 'contenu.json'),
    JSON.stringify({ date: new Date().toISOString(), base, documents, marches, mails, fichiers, octets, version: 1 }, null, 2),
  );

  // ── Rotation ──
  const retirees = [];
  const anciennes = (await fs.readdir(racine, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name.startsWith('icity-'))
    .map((e) => e.name)
    .sort();
  for (const vieille of anciennes.slice(0, Math.max(0, anciennes.length - A_GARDER))) {
    await fs.rm(path.join(racine, vieille), { recursive: true, force: true });
    retirees.push(vieille);
    log.log?.(`  retirée  ${vieille}`);
  }

  await db.journal
    .create({ data: { action: 'sauvegarde.creee', commentaire: `${documents} documents, ${fichiers} fichiers → ${dossier}` } })
    .catch(() => {});

  return { dossier, base, octetsSql, fichiers, octets, documents, marches, mails, retirees };
}

/**
 * Les sauvegardes présentes, la plus récente d'abord.
 *
 * Une sauvegarde sans `contenu.json` est signalée plutôt que masquée : c'est
 * souvent une copie interrompue, et mieux vaut le savoir avant d'en avoir
 * besoin.
 */
export async function listerSauvegardes(vers) {
  const racine = racineSauvegardes(vers);

  let entrees;
  try {
    entrees = await fs.readdir(racine, { withFileTypes: true });
  } catch {
    // Aucune sauvegarde n'a encore été faite : ce n'est pas une erreur.
    return { racine, sauvegardes: [] };
  }

  const sauvegardes = [];
  for (const e of entrees.filter((x) => x.isDirectory() && x.name.startsWith('icity-'))) {
    const dossier = path.join(racine, e.name);
    try {
      const contenu = JSON.parse(await fs.readFile(path.join(dossier, 'contenu.json'), 'utf8'));
      const { size: octetsSql } = await fs.stat(path.join(dossier, `${contenu.base}.sql`)).catch(() => ({ size: 0 }));
      sauvegardes.push({ nom: e.name, chemin: dossier, complete: true, octetsSql, ...contenu });
    } catch {
      sauvegardes.push({ nom: e.name, chemin: dossier, complete: false, date: null });
    }
  }

  sauvegardes.sort((a, b) => String(b.nom).localeCompare(String(a.nom)));
  return { racine, sauvegardes };
}
