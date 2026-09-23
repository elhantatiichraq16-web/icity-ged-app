/**
 * Sauvegarde complète : la base ET les fichiers (§13).
 *
 *   npm run sauvegarder -w serveur
 *   npm run sauvegarder -w serveur -- --vers "D:\\sauvegardes"
 *
 * Le travail lui-même vit dans `services/sauvegarde.js`, partagé avec l'écran
 * des Paramètres : une sauvegarde lancée d'un clic doit valoir celle qu'on
 * lance au clavier.
 *
 * Rotation : les quatre dernières sauvegardes sont conservées.
 */
import { db } from '../src/db.js';
import { sauvegarder } from '../src/services/sauvegarde.js';

const argument = (nom, defaut) => {
  const i = process.argv.indexOf(nom);
  return i !== -1 ? process.argv[i + 1] : defaut;
};

const mo = (octets) => `${(octets / 1024 / 1024).toFixed(1)} Mo`;

try {
  const bilan = await sauvegarder({ vers: argument('--vers') });

  console.log(`\n  SAUVEGARDE → ${bilan.dossier}\n`);
  console.log(`  base   ${bilan.base} → ${mo(bilan.octetsSql)}`);
  console.log(`  fichiers ${bilan.fichiers} (${mo(bilan.octets)})`);
  console.log(`  contenu  ${bilan.documents} documents · ${bilan.marches} marchés · ${bilan.mails} messages`);
  console.log(`\n  Sauvegarde terminée.`);
  console.log(`  Pour restaurer : npm run restaurer -w serveur -- "${bilan.dossier}"\n`);
} catch (erreur) {
  console.error(`\n  Échec de la sauvegarde : ${erreur.message}`);
  console.error(`  Si pg_dump est introuvable, indiquez son dossier dans PG_BIN.\n`);
  process.exitCode = 1;
}

await db.$disconnect();
