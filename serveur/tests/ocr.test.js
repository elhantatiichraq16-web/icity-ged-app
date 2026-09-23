/**
 * L'OCR sans Tesseract installé.
 *
 * On ne teste pas la qualité de reconnaissance de Tesseract — ce n'est pas
 * notre code. On teste ce qui est à nous : la file, les statuts, le découpage
 * page par page, et le fait qu'un outil absent ne perde aucun document.
 *
 * De faux binaires en Node remplacent pdftoppm et tesseract : le service les
 * appelle vraiment, avec de vrais arguments, sans rien installer.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const atelier = await fs.mkdtemp(path.join(os.tmpdir(), 'icity-ocr-test-'));
const faux = path.join(atelier, 'bin');
const stockage = path.join(atelier, 'stockage');

/**
 * Écrit un faux outil : un script Node nommé comme le binaire attendu.
 *
 * ICITY_OCR_PREFIXE fait lancer ces scripts par node.exe, ce qui évite les
 * `.cmd` — qu'execFile refuse sous Windows (EINVAL) — sans jamais recourir à
 * `shell: true` dans le service.
 */
async function fauxOutil(nom, corps) {
  const cible = path.join(faux, nom);
  await fs.writeFile(cible, corps, 'utf8');
  return cible;
}

const lanceur = path.join(atelier, 'lanceur.cjs');

beforeAll(async () => {
  await fs.mkdir(faux, { recursive: true });
  // Reçoit le chemin de l'outil puis ses arguments, et exécute le script du
  // même nom : c'est ce que fait ICITY_OCR_PREFIXE côté service.
  await fs.writeFile(
    lanceur,
    `process.argv.splice(1, 1);
require(process.argv[1]);
`,
    'utf8',
  );
  await fs.mkdir(path.join(stockage, 'documents', '2026'), { recursive: true });

  // pdftoppm -f N -l N source prefixe → écrit « prefixe-N.png ».
  await fauxOutil(
    'pdftoppm',
    `const a = process.argv.slice(2);
     const fs = require('fs');
     const page = a[a.indexOf('-f') + 1];
     const prefixe = a[a.length - 1];
     fs.writeFileSync(prefixe + '-' + page + '.png', 'PNG-' + page);`,
  );

  await restaurerTesseract();
});

/**
 * Le faux Tesseract nominal.
 *
 * Un test le remplace par une variante muette : il doit pouvoir remettre
 * celui-ci, sinon les tests suivants hériteraient d'un outil qui ne lit rien.
 */
async function restaurerTesseract() {
  // tesseract image stdout -l langues tsv → une ligne par mot, avec sa
  // confiance en colonne 11, comme le vrai.
  await fauxOutil(
    'tesseract',
    `const a = process.argv.slice(2);
     if (a[0] === '--version') { console.log('tesseract 5.3.3'); process.exit(0); }
     if (a[0] === '--list-langs') { console.log('List of available languages:'); console.log('ara'); console.log('fra'); process.exit(0); }
     const fs = require('fs');
     const page = (fs.readFileSync(a[0], 'utf8').match(/PNG-(\\d+)/) || [,'?'])[1];
     const mots = ('MARCHE PUBLIC numero ' + page + ' ' + 'texte lisible '.repeat(20)).trim().split(' ');
     console.log('level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext');
     // Une ligne de structure, que le service doit ignorer : conf = -1.
     // Elle porte un libellé, comme le vrai Tesseract sur certaines lignes :
     // si le service ne filtrait que sur le texte vide, elle passerait et
     // ferait chuter la moyenne.
     console.log('2\\t1\\t1\\t0\\t0\\t0\\t0\\t0\\t100\\t100\\t-1\\tbloc');
     for (const [i, mot] of mots.entries()) {
       console.log('5\\t1\\t1\\t1\\t1\\t' + (i + 1) + '\\t0\\t0\\t10\\t10\\t90\\t' + mot);
     }`,
  );
}

afterAll(async () => {
  await fs.rm(atelier, { recursive: true, force: true });
});

// La config est lue à l'import : on la fixe avant de charger quoi que ce soit.
vi.stubEnv('ICITY_OCR_PREFIXE', lanceur);
vi.stubEnv('POPPLER_BIN', faux);
vi.stubEnv('TESSERACT_BIN', faux);
vi.stubEnv('STOCKAGE', stockage);
vi.stubEnv('OCR_LANGUES', 'fra+ara');

// nombreDePages appelle pdfinfo depuis stockage.js, hors du préfixe de test :
// on lui fait dire trois pages, ce qui est le seul rôle qu'il joue ici.
vi.mock('../src/services/stockage.js', async (original) => ({
  ...(await original()),
  nombreDePages: async () => 3,
}));

const { db } = await import('../src/db.js');
const { languesInstallees, lireDocument, resteALire, tesseractDisponible, traiterFile } = await import('../src/services/ocr.js');

/** Un document muet, avec son fichier sur le disque. */
async function documentMuet(champs = {}) {
  const relatif = `documents/2026/${crypto.randomUUID()}.pdf`;
  await fs.writeFile(path.join(stockage, relatif), '%PDF-1.4 faux scan');
  return db.document.create({
    data: {
      titre: 'Scan sans texte',
      source: 'versement',
      cheminOriginal: relatif,
      nomOrigine: 'scan.pdf',
      sha256: crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'),
      taille: BigInt(1024),
      statutOcr: 'en_attente',
      ...champs,
    },
  });
}

beforeEach(async () => {
  await db.documentEtiquette.deleteMany();
  await db.suggestion.deleteMany();
  await db.document.deleteMany();
});

describe('disponibilité de Tesseract', () => {
  it('le détecte et lit sa version', async () => {
    const etat = await tesseractDisponible();
    expect(etat.ok).toBe(true);
    expect(etat.version).toContain('tesseract');
  });

  it('liste les langues installées', async () => {
    expect(await languesInstallees()).toEqual(['ara', 'fra']);
  });
});

describe('lecture d\'un document muet', () => {
  it('lit les trois pages et enregistre le texte', async () => {
    const doc = await documentMuet();
    const vues = [];
    const resultat = await lireDocument(doc, { log: { error() {} }, surPage: (n, t) => vues.push(`${n}/${t}`) });

    expect(resultat.ok).toBe(true);
    expect(resultat.pages).toBe(3);
    // Chaque page est rendue puis lue séparément : c'est ce qui tient la
    // mémoire sur un PC de 3,7 Go.
    expect(vues).toEqual(['1/3', '2/3', '3/3']);

    const relu = await db.document.findUnique({ where: { id: doc.id } });
    expect(relu.statutOcr).toBe('fait');
    expect(relu.texteOcr).toContain('MARCHE PUBLIC numero 1');
    expect(relu.texteOcr).toContain('MARCHE PUBLIC numero 3');
    expect(relu.langue).toBe('fra');
    // L'avancement est remis à zéro une fois le travail fini.
    expect(relu.ocrPageCourante).toBeNull();
  });

  it('enregistre la confiance que Tesseract accorde à sa lecture', async () => {
    const doc = await documentMuet();
    await lireDocument(doc, { log: { error() {} } });

    const relu = await db.document.findUnique({ where: { id: doc.id } });
    // Le faux outil annonce 90 sur chaque mot : c'est la moyenne attendue.
    // La ligne de structure (conf = -1) ne doit pas entrer dans le calcul,
    // sinon la moyenne tomberait sous 90.
    expect(relu.ocrConfiance).toBe(90);
  });

  it('marque « illisible » ce qui ne rend presque rien', async () => {
    // Un outil qui rend un TSV sans aucun mot : la page est une photo ou un
    // plan. On le restaure ensuite, sinon les tests suivants hériteraient
    // d'un Tesseract muet.
    await fauxOutil(
      'tesseract',
      `const a = process.argv.slice(2);
       if (a[0] === '--version') { console.log('tesseract 5.3.3'); process.exit(0); }
       console.log('level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext');
       console.log('2\\t1\\t1\\t0\\t0\\t0\\t0\\t0\\t100\\t100\\t-1\\t');`,
    );

    try {
      const doc = await documentMuet();
      const resultat = await lireDocument(doc, { log: { error() {} } });

      expect(resultat.ok).toBe(false);
      const relu = await db.document.findUnique({ where: { id: doc.id } });
      // « illisible » et non « echec » : l'outil a marché, c'est la page qui
      // est une photo ou un plan. L'écran « À vérifier » tranchera.
      expect(relu.statutOcr).toBe('illisible');
      // Aucun mot reconnu : on ne prétend pas mesurer une confiance.
      expect(relu.ocrConfiance).toBeNull();
    } finally {
      await restaurerTesseract();
    }
  });
});

describe('la file d\'attente', () => {
  it('traite les documents en attente et compte le reste', async () => {
    await documentMuet();
    await documentMuet();
    await documentMuet({ statutOcr: 'non_necessaire', texteOcr: 'déjà lu' });

    expect(await resteALire()).toBe(2);
    const bilan = await traiterFile({ log: { error() {} } });

    expect(bilan.traites).toBe(2);
    expect(await resteALire()).toBe(0);
  });

  it('reprend un document laissé « en_cours » par un worker interrompu', async () => {
    await documentMuet({ statutOcr: 'en_cours', ocrPageCourante: 2 });
    const bilan = await traiterFile({ log: { error() {} } });
    expect(bilan.traites).toBe(1);
  });

  it('ne touche pas à la corbeille', async () => {
    await documentMuet({ supprimeLe: new Date() });
    expect(await resteALire()).toBe(0);
    expect((await traiterFile({ log: { error() {} } })).traites).toBe(0);
  });

  it('sans Tesseract, laisse tout en attente sans rien perdre', async () => {
    vi.stubEnv('TESSERACT_BIN', path.join(atelier, 'nulle-part'));
    vi.resetModules();
    const { traiterFile: file, resteALire: reste } = await import('../src/services/ocr.js');

    await documentMuet();
    const bilan = await file({ log: { error() {} } });

    expect(bilan.ignoree).toBe(true);
    expect(bilan.traites).toBe(0);
    // Le document attend toujours : il repartira le jour de l'installation.
    expect(await reste()).toBe(1);

    vi.stubEnv('TESSERACT_BIN', faux);
    vi.resetModules();
  });
});
