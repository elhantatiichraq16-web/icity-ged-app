/**
 * Déclare dans l'application les marchés d'un dossier d'archives classées.
 *
 *   npm run archives -w serveur -- "C:\\chemin\\du\\dossier"          simulation
 *   npm run archives -w serveur -- "C:\\chemin\\du\\dossier" --oui    applique
 *
 * Phase 2 : clients et marchés seulement — aucun fichier n'est copié, aucun
 * document n'est créé. C'est la phase 3 (versement + OCR) qui apportera les
 * pièces ; ce script sera alors relancé et complétera ce qu'il a déclaré ici.
 *
 * Il ne lit que des NOMS de dossiers et de fichiers. Vos documents ne sont ni
 * ouverts, ni déplacés, ni modifiés.
 *
 * Relançable : un marché déjà déclaré est mis à jour, jamais dupliqué — la
 * référence normalisée (§5) sert de clé.
 */
import path from 'node:path';
import { normaliserReference } from '@icity/commun/marches';
import { db } from '../src/db.js';
import { lireArchives, nomDepuisDossier } from '../src/services/archives.js';
import { recalculerToutesLesPhases } from '../src/services/phase-marche.js';
import { verserFichier } from '../src/services/stockage.js';

const arguments_ = process.argv.slice(2);
const appliquer = arguments_.includes('--oui');
/** --documents verse aussi les fichiers (copie + empreinte + texte). */
const avecDocuments = arguments_.includes('--documents');
const racine = arguments_.find((a) => !a.startsWith('--'));

if (!racine) {
  console.error('Indiquez le dossier des archives.\n  npm run archives -w serveur -- "C:\\chemin" [--oui]');
  process.exit(1);
}

const mo = (octets) => `${(octets / 1024 / 1024).toFixed(1)} Mo`;

const plan = await lireArchives(path.resolve(racine));

console.log(`\n  ${appliquer ? 'IMPORT' : 'SIMULATION'} — ${racine}`);
console.log('  ' + '═'.repeat(72));
console.log(`\n  ${plan.marches.length} marchés, ${plan.attestations.length} lots d'attestations,`);
console.log(`  ${plan.fichiers} fichiers (${mo(plan.octets)}), ${plan.ignores.length} notes de travail écartées.\n`);

console.log('  MARCHÉS');
for (const m of plan.marches) {
  const marque = m.certaine ? ' ' : '?';
  console.log(`   ${marque} ${m.reference.padEnd(24)} ${String(m.fichiers.length).padStart(3)} pièces   ${m.nomClient}`);
  if (m.dossiers.length > 1) console.log(`       lots : ${m.dossiers.join(', ')}`);
}

console.log('\n  ATTESTATIONS DÉTACHÉES (sans marché identifié)');
for (const a of plan.attestations) {
  console.log(`     ${(a.nomClient ?? `patrimoine : ${a.patrimoine}`).padEnd(46)} ${String(a.fichiers.length).padStart(3)} pièces`);
}

const sansType = plan.marches.flatMap((m) => m.fichiers).filter((f) => !f.typeCode).length;
if (sansType) console.log(`\n  ${sansType} fichiers dont le nom ne dit pas la nature : l'OCR tranchera (phase 4).`);

if (!appliquer) {
  console.log('\n  ' + '═'.repeat(72));
  console.log('  Simulation — rien n’a été créé. Relancez avec --oui pour appliquer.\n');
  await db.$disconnect();
  process.exit(0);
}

// ── Application ───────────────────────────────────────────────────
console.log('\n  ' + '═'.repeat(72) + '\n');

/** Le client, retrouvé par son dossier d'origine, son nom, ou créé. */
const cacheClients = new Map();
async function clientDe(dossier) {
  if (!dossier) return null;
  if (cacheClients.has(dossier)) return cacheClients.get(dossier);

  let client = await db.client.findFirst({ where: { dossierOrigine: dossier } });
  if (!client) {
    // Le référentiel peut porter le même client sous une orthographe voisine.
    const nom = nomDepuisDossier(dossier);
    client = await db.client.findFirst({ where: { nom } });
    if (client) {
      await db.client.update({ where: { id: client.id }, data: { dossierOrigine: dossier } });
    } else {
      client = await db.client.create({ data: { nom, dossierOrigine: dossier, synonymes: [], domainesEmail: [] } });
      console.log(`    client créé : ${nom}`);
    }
  }
  cacheClients.set(dossier, client);
  return client;
}

let crees = 0;
let majs = 0;

for (const m of plan.marches) {
  const client = await clientDe(m.dossierClient);
  // La clé vient du plan : elle porte déjà le lot, qui sépare deux contrats
  // d'un même appel d'offres. La recalculer ici les confondrait.
  const cle = m.cle || normaliserReference(m.reference) || m.reference;
  const donnees = {
    reference: m.reference,
    referenceNormalisee: cle,
    variantes: m.dossiers,
    clientId: client?.id ?? null,
    lot: m.lot,
    ville: m.ville,
    objetTechnique: m.objetTechnique,
    dossierOrigine: m.dossiers[0],
  };
  const existant = await db.marche.findUnique({ where: { referenceNormalisee: cle } });
  if (existant) {
    // On ne réécrit pas ce qui a pu être corrigé à la main : seulement ce
    // que le dossier d'origine nous apprend et qui manque encore.
    await db.marche.update({
      where: { id: existant.id },
      data: {
        clientId: existant.clientId ?? donnees.clientId,
        lot: existant.lot ?? donnees.lot,
        ville: existant.ville ?? donnees.ville,
        objetTechnique: existant.objetTechnique ?? donnees.objetTechnique,
        variantes: donnees.variantes,
      },
    });
    majs += 1;
  } else {
    await db.marche.create({ data: donnees });
    crees += 1;
    console.log(`    marché créé : ${m.reference.padEnd(24)} ${m.nomClient}`);
  }
}

// Les clients des attestations détachées doivent exister, même sans marché.
for (const a of plan.attestations) {
  if (a.dossierClient) await clientDe(a.dossierClient);
}

console.log(`\n  ${crees} marchés créés, ${majs} mis à jour.`);

// ── Versement des pièces ──────────────────────────────────────────
if (!avecDocuments) {
  console.log('  Ajoutez --documents pour verser les fichiers eux-mêmes.\n');
  await db.$disconnect();
  process.exit(0);
}

const types = new Map((await db.typeDocument.findMany()).map((t) => [t.code, t.id]));
const bilan = { verses: 0, doublons: 0, erreurs: 0 };

/** Verse une liste de fichiers, en les rattachant au marché et au client. */
async function verserLot(fichiers, { marcheId = null, clientId = null, etiquette = null }) {
  for (const f of fichiers) {
    try {
      const { doublon, cree, document } = await verserFichier(f.chemin, {
        marcheId,
        clientId,
        typeDocumentId: f.typeCode ? (types.get(f.typeCode) ?? null) : null,
        source: 'versement',
      });
      if (cree) {
        bilan.verses += 1;
        if (etiquette) {
          const e = await db.etiquette.findUnique({ where: { nom: etiquette } });
          if (e) await db.documentEtiquette.create({ data: { documentId: document.id, etiquetteId: e.id } }).catch(() => {});
        }
      } else {
        // Même empreinte au bit près : le fichier est déjà au fonds, on ne le
        // verse pas deux fois (§6). Rien n'est perdu : l'original est indiqué.
        bilan.doublons += 1;
        console.log(`    doublon exact ignoré : ${f.nom} (déjà versé sous « ${doublon.titre} »)`);
      }
    } catch (erreur) {
      bilan.erreurs += 1;
      console.log(`    échec : ${f.nom} — ${erreur.message}`);
    }
    const total = bilan.verses + bilan.doublons + bilan.erreurs;
    if (total % 25 === 0) console.log(`    … ${total} fichiers traités`);
  }
}

console.log('\n  Versement des pièces (copie, empreinte, lecture du texte déjà présent)…\n');

for (const m of plan.marches) {
  const marche = await db.marche.findUnique({ where: { referenceNormalisee: m.cle } });
  const client = m.dossierClient ? await clientDe(m.dossierClient) : null;
  await verserLot(m.fichiers, { marcheId: marche?.id ?? null, clientId: client?.id ?? null });
}

for (const a of plan.attestations) {
  const client = a.dossierClient ? await clientDe(a.dossierClient) : null;
  // Le patrimoine hors marché (modèles, références) porte son étiquette.
  await verserLot(a.fichiers, { clientId: client?.id ?? null, etiquette: a.patrimoine ? 'REFERENCE' : null });
}

const changees = await recalculerToutesLesPhases();

console.log(`\n  ${bilan.verses} pièces versées, ${bilan.doublons} doublons exacts ignorés, ${bilan.erreurs} échecs.`);
console.log(`  ${changees} marchés ont changé de phase.`);
console.log('  L’OCR des scans se lancera ensuite, un document à la fois.\n');

await db.$disconnect();
