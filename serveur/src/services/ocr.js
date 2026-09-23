/**
 * La lecture des documents muets : l'OCR (§6).
 *
 * Un PDF né d'un traitement de texte porte son texte, et `pdftotext` suffit.
 * Un scan, lui, n'est qu'une image : sans OCR il reste introuvable par la
 * recherche. C'est ce service qui lui donne son texte.
 *
 * Trois règles tiennent tout :
 *
 *  - **Un document à la fois.** Ce PC a 3,7 Go de mémoire (§2) : deux
 *    Tesseract en parallèle le mettent à genoux. La file est donc traitée en
 *    série, page après page.
 *  - **Page par page.** Un scan de 80 pages traité d'un bloc tient des
 *    minutes en mémoire. On rend chaque page au fur et à mesure, et
 *    `ocrPageCourante` permet de suivre l'avancement à l'écran.
 *  - **Jamais de ligne de commande.** Les outils externes reçoivent un
 *    tableau d'arguments : un nom de fichier piégé ne peut pas s'y glisser
 *    comme une commande.
 *
 * Tesseract n'est pas toujours installé. Dans ce cas le service le dit une
 * fois et laisse les documents en attente : rien n'est perdu, la file
 * repartira le jour où l'outil sera là.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { db } from '../db.js';
import { cheminComplet, nombreDePages } from './stockage.js';

const executer = promisify(execFile);

/** En dessous, la page est restée muette : l'OCR n'a rien tiré d'utile. */
const TEXTE_SUFFISANT = 120;

/** Au-delà, on arrête les frais : une page qui résiste tant résistera encore. */
const DELAI_PAGE_MS = 120_000;

/** Résolution de rastérisation. 300 ppp est le minimum pour du texte fiable. */
const RESOLUTION = 300;

const outilPoppler = (nom) => (config.POPPLER_BIN ? path.join(config.POPPLER_BIN, nom) : nom);
const outilTesseract = () => (config.TESSERACT_BIN ? path.join(config.TESSERACT_BIN, 'tesseract') : 'tesseract');

/**
 * Appelle un outil externe, toujours avec un tableau d'arguments — jamais une
 * ligne de commande, jamais `shell: true` : un nom de fichier piégé ne doit
 * pas pouvoir s'exécuter.
 *
 * `prefixe` permet aux tests de glisser un faux binaire devant les arguments
 * (un script Node lancé par node.exe) sans que le code de production change
 * de forme.
 */
const PREFIXE_TEST = process.env.ICITY_OCR_PREFIXE ? [process.env.ICITY_OCR_PREFIXE] : [];

function lancer(outil, arguments_, options) {
  // Tesseract cherche ses langues dans TESSDATA_PREFIX. On le passe
  // explicitement : hérité de l'environnement, il dépendrait de la façon dont
  // l'application a été lancée, et une langue manquante ne dit pas pourquoi.
  const avecLangues = config.TESSDATA_PREFIX
    ? { ...options, env: { ...process.env, TESSDATA_PREFIX: config.TESSDATA_PREFIX } }
    : options;

  return PREFIXE_TEST.length
    ? executer(process.execPath, [...PREFIXE_TEST, outil, ...arguments_], avecLangues)
    : executer(outil, arguments_, avecLangues);
}

/**
 * Tesseract est-il utilisable ?
 *
 * On le demande à l'outil lui-même plutôt que de tester l'existence d'un
 * fichier : sur Windows le binaire s'appelle `tesseract.exe`, ailleurs non,
 * et il peut très bien vivre dans le PATH sans TESSERACT_BIN.
 */
export async function tesseractDisponible() {
  try {
    const { stdout } = await lancer(outilTesseract(), ['--version'], { timeout: 15_000 });
    return { ok: true, version: stdout.split('\n')[0]?.trim() ?? '' };
  } catch (erreur) {
    return { ok: false, motif: erreur.code === 'ENOENT' ? 'Tesseract introuvable' : erreur.message };
  }
}

/** Les langues installées, pour vérifier que « fra » et « ara » sont bien là. */
export async function languesInstallees() {
  try {
    const { stdout } = await lancer(outilTesseract(), ['--list-langs'], { timeout: 15_000 });
    // La première ligne est un en-tête, les suivantes sont les codes.
    return stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Rend une page de PDF en image PNG, prête pour Tesseract.
 *
 * @returns {Promise<string>} le chemin de l'image produite
 */
async function rendrePage(cheminPdf, page, dossierTravail) {
  const prefixe = path.join(dossierTravail, `p${page}`);
  await lancer(
    outilPoppler('pdftoppm'),
    ['-q', '-png', '-r', String(RESOLUTION), '-f', String(page), '-l', String(page), cheminPdf, prefixe],
    { timeout: DELAI_PAGE_MS },
  );
  // pdftoppm suffixe le numéro de page avec un remplissage variable
  // (« p1-1.png », « p1-01.png ») : on prend ce qui est apparu.
  const produits = (await fs.readdir(dossierTravail)).filter((f) => f.startsWith(`p${page}-`) || f === `p${page}.png`);
  if (!produits.length) throw new Error(`Rendu de la page ${page} sans résultat`);
  return path.join(dossierTravail, produits[0]);
}

/**
 * Passe une image à Tesseract et rend son texte, avec la confiance qu'il
 * accorde à sa propre lecture.
 *
 * Le format TSV donne une ligne par mot, dont une colonne `conf` de 0 à 100.
 * C'est la seule mesure de confiance qui veuille dire quelque chose : la
 * déduire de la quantité de texte reviendrait à inventer un chiffre.
 *
 * `stdout` évite d'écrire un fichier intermédiaire : tout revient
 * directement, et rien ne traîne sur le disque.
 *
 * @returns {Promise<{ texte: string, confiances: number[] }>}
 */
async function lireImage(cheminImage, langues) {
  const { stdout } = await lancer(outilTesseract(), [cheminImage, 'stdout', '-l', langues, 'tsv'], {
    timeout: DELAI_PAGE_MS,
    maxBuffer: 20 * 1024 * 1024,
  });

  const lignes = stdout.split('\n').slice(1);
  const mots = [];
  const confiances = [];

  for (const ligne of lignes) {
    const colonnes = ligne.split('\t');
    if (colonnes.length < 12) continue;

    const mot = colonnes[11]?.trim();
    const conf = Number(colonnes[10]);
    // Tesseract met -1 sur les lignes de structure (bloc, paragraphe) : ce
    // ne sont pas des mots, et les compter fausserait la moyenne.
    if (!mot || !Number.isFinite(conf) || conf < 0) continue;

    mots.push(mot);
    confiances.push(conf);
  }

  return { texte: mots.join(' '), confiances };
}

/**
 * Lit un document muet, page par page.
 *
 * Le document est marqué « en_cours » pendant le travail : si le worker meurt
 * au milieu, on saura au redémarrage que cette lecture est à reprendre.
 *
 * @param {object} document une ligne de la table Document
 * @param {{ log?: object, surPage?: (n: number, total: number) => void }} options
 * @returns {Promise<{ ok: boolean, pages: number, caracteres: number, motif?: string }>}
 */
export async function lireDocument(document, { log = console, surPage } = {}) {
  const relatif = document.cheminOriginal;
  if (!relatif) return { ok: false, pages: 0, caracteres: 0, motif: 'document sans fichier' };

  const chemin = cheminComplet(relatif);
  const estPdf = path.extname(chemin).toLowerCase() === '.pdf';
  const langues = config.OCR_LANGUES;

  await db.document.update({ where: { id: document.id }, data: { statutOcr: 'en_cours', ocrPageCourante: 0 } });

  const dossierTravail = await fs.mkdtemp(path.join(os.tmpdir(), 'icity-ocr-'));
  try {
    // Une image se lit directement ; un PDF se rend page par page.
    const total = estPdf ? ((await nombreDePages(chemin)) ?? 1) : 1;
    const morceaux = [];
    const confiances = [];

    for (let page = 1; page <= total; page += 1) {
      let image = chemin;
      try {
        if (estPdf) image = await rendrePage(chemin, page, dossierTravail);
        const lu = await lireImage(image, langues);
        morceaux.push(lu.texte);
        confiances.push(...lu.confiances);
      } catch (erreur) {
        // Une page illisible ne condamne pas le document : on note et on suit.
        log.error?.(`OCR : page ${page}/${total} du document ${document.id} illisible — ${erreur.message}`);
      } finally {
        // L'image rendue pèse plusieurs Mo : elle part dès qu'elle a servi.
        if (estPdf && image !== chemin) await fs.rm(image, { force: true });
      }

      // L'avancement sert à afficher « page 12 sur 80 » : l'écrire à chaque
      // page ferait 80 écritures pour un seul document. Une sur cinq, plus la
      // dernière, suffit à voir la barre bouger.
      if (page % 5 === 0 || page === total) {
        await db.document.update({ where: { id: document.id }, data: { ocrPageCourante: page } });
      }
      surPage?.(page, total);
    }

    const texte = morceaux.join('\n').trim();
    const utile = texte.replace(/\s/g, '').length;

    // Trop peu de texte : la page est probablement une photo, un plan ou un
    // cachet. On le marque « illisible » plutôt que de faire croire à un
    // échec technique — l'écran « À vérifier » permettra de trancher.
    const statutOcr = utile >= TEXTE_SUFFISANT ? 'fait' : 'illisible';

    await db.document.update({
      where: { id: document.id },
      data: {
        texteOcr: texte || null,
        statutOcr,
        langue: texte ? langues.split('+')[0] : null,
        // La moyenne de ce que Tesseract dit de sa propre lecture, mot à mot.
        // Sans aucun mot reconnu, on ne prétend pas mesurer : null.
        ocrConfiance: confiances.length ? Math.round(confiances.reduce((t, c) => t + c, 0) / confiances.length) : null,
        ocrPageCourante: null,
      },
    });

    return { ok: statutOcr === 'fait', pages: total, caracteres: utile };
  } catch (erreur) {
    await db.document.update({ where: { id: document.id }, data: { statutOcr: 'echec', ocrPageCourante: null } });
    log.error?.(`OCR : document ${document.id} en échec — ${erreur.message}`);
    return { ok: false, pages: 0, caracteres: 0, motif: erreur.message };
  } finally {
    await fs.rm(dossierTravail, { recursive: true, force: true });
  }
}

/**
 * Traite la file d'attente : les documents muets, un par un.
 *
 * Les documents restés « en_cours » sont repris : ils viennent d'un worker
 * arrêté en plein travail.
 *
 * @param {{ limite?: number, log?: object }} options
 */
export async function traiterFile({ limite = 20, log = console } = {}) {
  const disponible = await tesseractDisponible();
  if (!disponible.ok) {
    return { ignoree: true, motif: disponible.motif, traites: 0, lus: 0, illisibles: 0, echecs: 0 };
  }

  const aLire = await db.document.findMany({
    where: { supprimeLe: null, statutOcr: { in: ['en_attente', 'en_cours'] } },
    orderBy: { creeLe: 'asc' },
    take: limite,
  });

  const bilan = { ignoree: false, traites: 0, lus: 0, illisibles: 0, echecs: 0 };
  for (const document of aLire) {
    const resultat = await lireDocument(document, { log });
    bilan.traites += 1;
    if (resultat.ok) bilan.lus += 1;
    else if (resultat.motif) bilan.echecs += 1;
    else bilan.illisibles += 1;
  }
  return bilan;
}

/** Combien de documents attendent d'être lus. */
export function resteALire() {
  return db.document.count({ where: { supprimeLe: null, statutOcr: { in: ['en_attente', 'en_cours'] } } });
}
