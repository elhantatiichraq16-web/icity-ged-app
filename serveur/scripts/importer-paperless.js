/**
 * Import depuis l'ancienne installation Paperless-ngx (§12).
 *
 *   npm run paperless -w serveur              simulation (par défaut)
 *   npm run paperless -w serveur -- --oui     importe
 *
 * Ce script ne refait AUCUN OCR : il reprend le texte déjà calculé par
 * Paperless. C'est tout l'intérêt — l'OCR de ce fonds a coûté des heures.
 *
 * Relançable sans créer de doublons : l'empreinte SHA-256 fait foi. Les
 * documents en corbeille de Paperless ne sont pas importés.
 *
 * L'adresse et les identifiants se lisent dans .env, jamais dans le code :
 *   PAPERLESS_URL=http://localhost:8000
 *   PAPERLESS_UTILISATEUR=admin
 *   PAPERLESS_MOT_DE_PASSE=…
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/db.js';
import { journaliser } from '../src/services/journal.js';
import { recalculerToutesLesPhases } from '../src/services/phase-marche.js';
import { verserFichier } from '../src/services/stockage.js';

const appliquer = process.argv.includes('--oui');
const URL_BASE = (process.env.PAPERLESS_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const UTILISATEUR = process.env.PAPERLESS_UTILISATEUR ?? 'admin';
const MOT_DE_PASSE = process.env.PAPERLESS_MOT_DE_PASSE;

if (!MOT_DE_PASSE) {
  console.error('  PAPERLESS_MOT_DE_PASSE manquant dans serveur/.env.');
  console.error('  (Ne le mettez jamais dans le code : .env est ignoré par Git.)');
  process.exit(1);
}

const entetes = {
  Authorization: `Basic ${Buffer.from(`${UTILISATEUR}:${MOT_DE_PASSE}`).toString('base64')}`,
  Accept: 'application/json; version=9',
};

/** Un appel à l'API de Paperless. */
async function api(chemin) {
  const reponse = await fetch(`${URL_BASE}/api/${chemin}`, { headers: entetes });
  if (!reponse.ok) throw new Error(`${chemin} → HTTP ${reponse.status}`);
  return reponse.json();
}

/** Toutes les pages d'une ressource. */
async function tout(ressource, suffixe = '') {
  const sortie = [];
  let page = 1;
  for (;;) {
    const d = await api(`${ressource}/?page_size=100&page=${page}${suffixe}`);
    sortie.push(...d.results);
    if (!d.next) return sortie;
    page += 1;
  }
}

// ── Lecture de l'existant ──
let documents;
let types;
let correspondants;
let etiquettes;
try {
  [documents, types, correspondants, etiquettes] = await Promise.all([tout('documents'), tout('document_types'), tout('correspondents'), tout('tags')]);
} catch (erreur) {
  console.error(`\n  Paperless injoignable sur ${URL_BASE} : ${erreur.message}`);
  console.error('  Démarrez-le (docker compose up -d dans le dossier paperless/) puis relancez.\n');
  process.exit(1);
}

const nomType = new Map(types.map((t) => [t.id, t.name]));
const nomCorrespondant = new Map(correspondants.map((c) => [c.id, c.name]));
const nomEtiquette = new Map(etiquettes.map((t) => [t.id, t.name]));

console.log(`\n  ${appliquer ? 'IMPORT' : 'SIMULATION'} — ${URL_BASE}`);
console.log('  ' + '═'.repeat(70));
console.log(`\n  ${documents.length} documents · ${types.length} types · ${correspondants.length} correspondants · ${etiquettes.length} étiquettes\n`);

if (!appliquer) {
  const parType = new Map();
  for (const d of documents) {
    const nom = nomType.get(d.document_type) ?? '(sans type)';
    parType.set(nom, (parType.get(nom) ?? 0) + 1);
  }
  for (const [nom, n] of [...parType].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${nom}`);
  console.log('\n  ' + '═'.repeat(70));
  console.log('  Simulation — rien n’a été importé. Relancez avec --oui.\n');
  await db.$disconnect();
  process.exit(0);
}

// ── Import ──
const bilan = { importes: 0, ignores: 0, erreurs: 0 };
const cacheTypes = new Map((await db.typeDocument.findMany()).map((t) => [t.nom, t.id]));
const cacheClients = new Map((await db.client.findMany()).map((c) => [c.nom, c.id]));
const cacheEtiquettes = new Map((await db.etiquette.findMany()).map((e) => [e.nom, e.id]));
const marches = await db.marche.findMany({ select: { id: true, reference: true, referenceNormalisee: true } });

for (const d of documents) {
  try {
    // Le fichier original, tel que Paperless le détient.
    const reponse = await fetch(`${URL_BASE}/api/documents/${d.id}/download/?original=true`, { headers: entetes });
    if (!reponse.ok) throw new Error(`téléchargement HTTP ${reponse.status}`);

    const extension = path.extname(d.original_file_name ?? `${d.title}.pdf`).toLowerCase() || '.pdf';
    const provisoire = path.join(os.tmpdir(), `icity-paperless-${crypto.randomUUID()}${extension}`);
    await fs.writeFile(provisoire, Buffer.from(await reponse.arrayBuffer()));

    try {
      const nomDuType = nomType.get(d.document_type);
      const nomDuClient = nomCorrespondant.get(d.correspondent);
      // Les étiquettes d'affaire portent la référence du marché.
      const noms = (d.tags ?? []).map((t) => nomEtiquette.get(t)).filter(Boolean);
      const marche = marches.find((m) => noms.some((n) => n && (m.reference === n || m.referenceNormalisee.split('#')[0] === n)));

      const { document, cree } = await verserFichier(provisoire, {
        titre: d.title,
        nomOrigine: d.original_file_name ?? `${d.title}${extension}`,
        typeDocumentId: nomDuType ? (cacheTypes.get(nomDuType) ?? null) : null,
        clientId: nomDuClient ? (cacheClients.get(nomDuClient) ?? null) : null,
        marcheId: marche?.id ?? null,
        source: 'import',
      });

      if (!cree) {
        // Déjà au fonds : l'empreinte l'a reconnu. Relancer ne duplique rien.
        bilan.ignores += 1;
        continue;
      }

      // Le texte OCR déjà calculé est repris tel quel : pas de nouvel OCR (§12).
      await db.document.update({
        where: { id: document.id },
        data: {
          texteOcr: d.content || null,
          statutOcr: d.content ? 'non_necessaire' : 'en_attente',
          dateDocument: d.created ? new Date(String(d.created).slice(0, 10)) : null,
          pages: d.page_count ?? document.pages,
        },
      });

      // Les étiquettes connues du référentiel suivent.
      const ids = noms.map((n) => cacheEtiquettes.get(n)).filter(Boolean);
      if (ids.length) {
        await db.documentEtiquette.createMany({ data: ids.map((etiquetteId) => ({ documentId: document.id, etiquetteId })), skipDuplicates: true });
      }

      bilan.importes += 1;
      if (bilan.importes % 10 === 0) console.log(`    … ${bilan.importes} documents importés`);
    } finally {
      await fs.rm(provisoire, { force: true });
    }
  } catch (erreur) {
    bilan.erreurs += 1;
    console.log(`    échec : ${d.title?.slice(0, 50)} — ${erreur.message}`);
  }
}

const phases = await recalculerToutesLesPhases();
await journaliser({ action: 'import.paperless', commentaire: `${bilan.importes} importés, ${bilan.ignores} déjà présents, ${bilan.erreurs} échecs` });

console.log(`\n  ${bilan.importes} importés · ${bilan.ignores} déjà présents · ${bilan.erreurs} échecs`);
console.log(`  ${phases} marchés ont changé de phase.\n`);

await db.$disconnect();
