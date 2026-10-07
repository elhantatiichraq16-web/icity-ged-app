/**
 * Le versement d'un fichier dans le fonds (§6).
 *
 * Trois règles tiennent tout :
 *  - le fichier est copié hors du dossier public, sous un nom UUID : personne
 *    ne peut le deviner, et un nom d'origine piégé ne peut rien casser ;
 *  - son empreinte SHA-256 est calculée ; si elle existe déjà, on refuse et
 *    on montre l'original ;
 *  - on n'OCRise pas ce qui porte déjà du texte : `pdftotext` d'abord,
 *    Tesseract seulement si la page est muette.
 *
 * Les outils externes (Poppler) sont appelés avec un tableau d'arguments,
 * jamais une ligne de commande : un nom de fichier ne peut pas s'y glisser
 * comme une commande.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { db } from '../db.js';
import { ErreurHttp } from '../erreurs.js';

const executer = promisify(execFile);

/** Les formats acceptés au versement (§6), avec leur type MIME. */
export const FORMATS = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.txt': 'text/plain',
};

export const TAILLE_MAX = 50 * 1024 * 1024; // 50 Mo par fichier (§6)

/** En dessous, la page est muette : il faudra l'OCR. */
const TEXTE_SUFFISANT = 120;

const outil = (nom) => (config.POPPLER_BIN ? path.join(config.POPPLER_BIN, nom) : nom);

/** L'empreinte SHA-256 d'un fichier, lue par morceaux (un PDF peut peser 50 Mo). */
export function empreinteFichier(chemin) {
  return new Promise((resoudre, rejeter) => {
    const hache = crypto.createHash('sha256');
    createReadStream(chemin)
      .on('data', (morceau) => hache.update(morceau))
      .on('end', () => resoudre(hache.digest('hex')))
      .on('error', rejeter);
  });
}

/** Le dossier de stockage d'une catégorie : documents, archives, vignettes. */
export function dossier(categorie) {
  return path.join(config.STOCKAGE, categorie);
}

/** Le chemin complet d'un fichier stocké, à partir de son chemin relatif. */
export function cheminComplet(relatif) {
  const complet = path.resolve(config.STOCKAGE, relatif);
  // Garde-fou : un chemin stocké ne doit jamais sortir du dossier de stockage.
  if (!complet.startsWith(path.resolve(config.STOCKAGE))) throw new Error('Chemin de stockage invalide.');
  return complet;
}

/** Le nombre de pages d'un PDF (pdfinfo), ou null. */
export async function nombreDePages(chemin) {
  try {
    const { stdout } = await executer(outil('pdfinfo'), [chemin], { timeout: 30_000 });
    return Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]) || null;
  } catch {
    return null;
  }
}

/**
 * Le texte déjà présent dans un PDF (pdftotext).
 *
 * Un PDF né d'un traitement de texte porte son texte ; un scan non. C'est ce
 * qui décide si l'OCR est nécessaire — et l'OCR, sur ce PC, coûte des minutes
 * par document.
 */
export async function texteDuPdf(chemin) {
  try {
    const { stdout } = await executer(outil('pdftotext'), ['-q', '-enc', 'UTF-8', chemin, '-'], {
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Le lot de scan et le numéro de page, lus dans le nom du fichier (§6).
 * Formes rencontrées : « 20260910140626873-P18 », « …-SRC-20260910140626873-P18 ».
 */
export function lotEtPage(nomFichier) {
  const m = /(\d{13,17})[-_]P(\d{1,4})/i.exec(nomFichier);
  return m ? { lotScan: m[1], pageScan: Number(m[2]) } : { lotScan: null, pageScan: null };
}

/** Un titre lisible depuis le nom du fichier : « MARCHE_SIGNE.pdf » → « Marche signe ». */
export function titreDepuisNom(nomFichier) {
  const base = path.basename(nomFichier, path.extname(nomFichier));
  const propre = base
    .replace(/[-_]+/g, ' ')
    .replace(/\s*SRC\s*\d{10,}\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (propre.charAt(0).toUpperCase() + propre.slice(1).toLowerCase()).slice(0, 255) || base;
}

/**
 * Verse un fichier : empreinte, refus des doublons exacts, copie, lecture du
 * texte déjà présent, création du document.
 *
 * @param {string} source chemin du fichier à verser
 * @param {object} infos
 * @returns {Promise<{ document: object, doublon: object|null, cree: boolean }>}
 */
export async function verserFichier(source, infos = {}) {
  // Le fichier versé depuis le navigateur transite par un nom temporaire :
  // c'est le nom d'origine qui doit apparaître à l'écran.
  const nomOrigine = infos.nomOrigine ?? path.basename(source);
  const extension = path.extname(nomOrigine).toLowerCase();
  if (!FORMATS[extension]) throw new Error(`Format refusé : ${extension || 'sans extension'}`);

  const { size } = await fs.stat(source);
  if (size > TAILLE_MAX) throw new Error(`Fichier trop lourd (${Math.round(size / 1024 / 1024)} Mo, 50 Mo au plus).`);

  const sha256 = await empreinteFichier(source);
  const existant = await db.document.findUnique({ where: { sha256 }, include: { marche: true } });
  if (existant) return { document: existant, doublon: existant, cree: false };

  // Nom UUID, rangé par année : un dossier de 10 000 fichiers ralentit tout.
  const annee = String(new Date().getFullYear());
  const relatif = path.join('documents', annee, `${crypto.randomUUID()}${extension}`);
  const destination = cheminComplet(relatif);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);

  const estPdf = extension === '.pdf';
  const texte = estPdf ? await texteDuPdf(destination) : '';
  const aDuTexte = texte.replace(/\s/g, '').length >= TEXTE_SUFFISANT;

  const { lotScan, pageScan } = lotEtPage(nomOrigine);

  const document = await db.document.create({
    data: {
      titre: infos.titre ?? titreDepuisNom(nomOrigine),
      marcheId: infos.marcheId ?? null,
      clientId: infos.clientId ?? null,
      typeDocumentId: infos.typeDocumentId ?? null,
      commandeFournisseurId: infos.commandeFournisseurId ?? null,
      source: infos.source ?? 'versement',
      confidentialite: infos.confidentialite ?? 'interne',
      criticite: infos.criticite ?? 'courant',
      verseParId: infos.verseParId ?? null,
      cheminOriginal: relatif.replace(/\\/g, '/'),
      nomOrigine,
      urlProvenance: infos.urlProvenance ?? null,
      sha256,
      taille: BigInt(size),
      pages: estPdf ? await nombreDePages(destination) : 1,
      // Le texte déjà présent évite l'OCR : on le garde tel quel (§6).
      texteOcr: aDuTexte ? texte : null,
      statutOcr: aDuTexte ? 'non_necessaire' : 'en_attente',
      langue: aDuTexte ? 'fra' : null,
      lotScan,
      pageScan,
      statutClassement: infos.typeDocumentId ? 'classe' : 'en_attente',
    },
  });

  return { document, doublon: null, cree: true };
}

/**
 * Le chemin complet du fichier d'un document, s'il est bien dans le stockage.
 * Un fichier disparu (disque restauré à moitié) se dit franchement : 410.
 */
export async function fichierStocke(d) {
  const complet = cheminComplet(d.cheminOriginal);
  try {
    await fs.access(complet);
  } catch {
    throw new ErreurHttp(410, 'Le fichier n’est plus dans le stockage.');
  }
  return complet;
}

/**
 * Envoie le fichier d'un document au navigateur (§13).
 *
 * @param {import('fastify').FastifyReply} reponse
 * @param {{ id: number, cheminOriginal: string, nomOrigine?: string|null, taille?: bigint|number|null }} d
 * @param {string} complet    son chemin, vérifié par fichierStocke
 * @param {'inline'|'attachment'} disposition
 */
export function servirFichier(reponse, d, complet, disposition) {
  const extension = path.extname(d.cheminOriginal).toLowerCase();
  // Le type MIME vient de notre table, jamais de ce que dit le fichier.
  const mime = FORMATS[extension] ?? 'application/octet-stream';
  // Le nom proposé est nettoyé : un nom d'origine peut contenir des
  // guillemets ou des sauts de ligne, qui casseraient l'en-tête.
  const nom = (d.nomOrigine ?? `document-${d.id}${extension}`).replace(/[^\w.\- ]+/g, '_');

  // L'application affiche le PDF dans un cadre de sa propre page. Les
  // en-têtes généraux interdisent tout cadre (frame-ancestors 'none') :
  // on les desserre ici pour notre seule origine, et pour ce fichier.
  // Un autre site ne peut toujours pas l'encadrer.
  return reponse
    .header('X-Frame-Options', 'SAMEORIGIN')
    .header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'")
    .header('Content-Type', mime)
    .header('Content-Disposition', `${disposition}; filename="${nom}"`)
    .header('Content-Length', String(d.taille ?? 0))
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, max-age=300')
    .send(createReadStream(complet));
}

/** Supprime le fichier d'un document (corbeille vidée, versement annulé). */
export async function supprimerFichier(relatif) {
  if (!relatif) return;
  await fs.rm(cheminComplet(relatif), { force: true });
}
