/**
 * Lire un classeur Excel (.xlsx) sans bibliothèque.
 *
 * Un .xlsx est une archive ZIP de fichiers XML. On n'en tire que ce qu'un
 * import demande : les feuilles, la valeur de chaque cellule (texte, nombre,
 * date, booléen) et les plages fusionnées. Les formules ne sont pas
 * recalculées : on lit la dernière valeur qu'Excel a enregistrée.
 *
 * Le fichier vient d'un utilisateur : la taille décompressée est bornée,
 * pour qu'une archive piégée ne sature pas la mémoire du poste.
 */
import zlib from 'node:zlib';

const TAILLE_MAX_DECOMPRESSEE = 40 * 1024 * 1024;

export class ErreurClasseur extends Error {}

/** Les fichiers d'une archive ZIP : `lire(nom)` rend le texte d'un fichier, ou null. */
export function lireZip(tampon) {
  // La fin du répertoire central se cherche depuis la fin : un commentaire
  // de 64 Ko au plus peut la suivre.
  let fin = -1;
  for (let i = tampon.length - 22; i >= Math.max(0, tampon.length - 22 - 0xffff); i--) {
    if (tampon.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new ErreurClasseur('Ce fichier n’est pas un classeur Excel (.xlsx).');

  const fichiers = new Map();
  let pos = tampon.readUInt32LE(fin + 16);
  const nombre = tampon.readUInt16LE(fin + 10);
  for (let k = 0; k < nombre; k++) {
    if (pos + 46 > tampon.length || tampon.readUInt32LE(pos) !== 0x02014b50) throw new ErreurClasseur('Le classeur est abîmé.');
    const methode = tampon.readUInt16LE(pos + 10);
    const taille = tampon.readUInt32LE(pos + 20);
    const longueurNom = tampon.readUInt16LE(pos + 28);
    const longueurExtra = tampon.readUInt16LE(pos + 30);
    const longueurCommentaire = tampon.readUInt16LE(pos + 32);
    const entete = tampon.readUInt32LE(pos + 42);
    const nom = tampon.toString('utf8', pos + 46, pos + 46 + longueurNom);
    // L'en-tête local a ses propres longueurs, qui peuvent différer.
    const debut = entete + 30 + tampon.readUInt16LE(entete + 26) + tampon.readUInt16LE(entete + 28);
    fichiers.set(nom, { methode, brut: tampon.subarray(debut, debut + taille) });
    pos += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }

  return {
    noms: [...fichiers.keys()],
    lire(nom) {
      const f = fichiers.get(nom);
      if (!f) return null;
      if (f.methode === 0) return f.brut.toString('utf8');
      if (f.methode !== 8) throw new ErreurClasseur(`Compression non prise en charge dans ${nom}.`);
      try {
        return zlib.inflateRawSync(f.brut, { maxOutputLength: TAILLE_MAX_DECOMPRESSEE }).toString('utf8');
      } catch {
        throw new ErreurClasseur('Le classeur est trop volumineux ou abîmé.');
      }
    },
  };
}

// ── Un peu de XML ───────────────────────────────────────────────

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decoder = (t) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (tout, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITES[e] ?? tout;
  });
const attributs = (texte) => Object.fromEntries([...texte.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, cle, v]) => [cle, decoder(v)]));
/** Le texte d'un élément riche : ses <t>, sans les indications phonétiques. */
const texteRiche = (xml) => decoder([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

/** « AB12 » → { colonne: 'AB', ligne: 12 } */
export function decouperReference(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { colonne: m[1], ligne: Number(m[2]) } : null;
}

// ── Les dates ───────────────────────────────────────────────────

/** Les formats de nombre qui sont des dates : intégrés (14 à 22…) ou écrits avec j/m/a. */
function formatsDate(stylesXml) {
  const personnalises = Object.fromEntries([...stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)].map(([, a]) => attributs(a)).map((a) => [Number(a.numFmtId), a.formatCode]));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\b([^>]*)(?:\/>|>)/g)].map(([, a]) => {
    const id = Number(attributs(a).numFmtId ?? 0);
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
    const code = (personnalises[id] ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
    return /[dmy]/i.test(code) && !code.includes('#');
  });
}

/** Un numéro de série Excel (1900) en « AAAA-MM-JJ ». */
const dateExcel = (serie) => new Date(Date.UTC(1899, 11, 30) + Math.round(serie) * 86_400_000).toISOString().slice(0, 10);

// ── Le classeur ─────────────────────────────────────────────────

/**
 * Les feuilles d'un classeur, dans l'ordre des onglets.
 *
 * Chaque cellule vaut { valeur, type } : type 's' (texte), 'n' (nombre),
 * 'd' (date, valeur « AAAA-MM-JJ ») ou 'b' (booléen).
 *
 * @param {Buffer} tampon
 * @returns {{ nom: string, cellules: Map<string, { valeur: any, type: string }>, fusions: string[] }[]}
 */
export function lireClasseur(tampon) {
  const zip = lireZip(tampon);
  const classeur = zip.lire('xl/workbook.xml');
  if (!classeur) throw new ErreurClasseur('Ce fichier n’est pas un classeur Excel (.xlsx).');

  const chaines = [...(zip.lire('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texteRiche(m[1]));
  const dates = formatsDate(zip.lire('xl/styles.xml') ?? '');
  const cibles = Object.fromEntries(
    [...(zip.lire('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)].map(([, a]) => attributs(a)).map((a) => [a.Id, a.Target]),
  );

  return [...classeur.matchAll(/<sheet\b([^>]*)\/?>/g)].map(([, a]) => {
    const { name: nom, 'r:id': rid } = attributs(a);
    const cible = cibles[rid] ?? '';
    const chemin = cible.startsWith('/') ? cible.slice(1) : `xl/${cible.replace(/^\.\//, '')}`;
    const xml = zip.lire(chemin) ?? '';

    const cellules = new Map();
    for (const [, attrs, contenu = ''] of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const { r, t, s } = attributs(attrs);
      if (!r) continue;
      const brut = /<v>([\s\S]*?)<\/v>/.exec(contenu)?.[1];
      let cellule = null;
      if (t === 'inlineStr') cellule = { valeur: texteRiche(contenu), type: 's' };
      else if (brut === undefined) continue;
      else if (t === 's') cellule = { valeur: chaines[Number(brut)] ?? '', type: 's' };
      else if (t === 'str' || t === 'e') cellule = { valeur: decoder(brut), type: 's' };
      else if (t === 'b') cellule = { valeur: brut === '1', type: 'b' };
      else if (dates[Number(s ?? 0)]) cellule = { valeur: dateExcel(Number(brut)), type: 'd' };
      else cellule = { valeur: Number(brut), type: 'n' };
      if (cellule.type === 's' && !String(cellule.valeur).trim()) continue;
      cellules.set(r, cellule);
    }
    const fusions = [...xml.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/g)].map((m) => m[1]);
    return { nom, cellules, fusions };
  });
}
