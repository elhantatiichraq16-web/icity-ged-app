/**
 * Écrire un classeur Excel (.xlsx) sans bibliothèque.
 *
 * Un .xlsx est une archive ZIP de quelques fichiers XML. On n'écrit que ce
 * qu'un tableau exporté demande : une feuille, une ligne d'en-tête en gras et
 * figée, des nombres en nombres (Excel peut les additionner), du texte en
 * texte, des colonnes à une largeur lisible et un filtre automatique.
 *
 * Comme pour le CSV, une cellule qui commence par « = », « + », « - » ou « @ »
 * reste du texte : écrite en chaîne, Excel ne l'exécute jamais.
 */
import zlib from 'node:zlib';

/** Échappe un texte pour le XML. Les caractères de contrôle, interdits en XML, sont retirés. */
const xml = (t) =>
  String(t)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** « A », « B »… « Z », « AA »… : le nom d'une colonne. */
function lettre(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Une cellule : nombre si c'en est un, texte sinon ; style 1 = en-tête en gras. */
function cellule(ref, valeur, style = 0) {
  if (valeur === null || valeur === undefined || valeur === '') return '';
  const s = style ? ` s="${style}"` : '';
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return `<c r="${ref}"${s}><v>${valeur}</v></c>`;
  const texte = valeur instanceof Date ? valeur.toISOString().slice(0, 10) : String(valeur);
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(texte)}</t></is></c>`;
}

/** Une archive ZIP (méthode « deflate »), comme Excel les lit. */
function zip(fichiers) {
  const locaux = [];
  const central = [];
  let decalage = 0;
  for (const { nom, contenu } of fichiers) {
    const brut = Buffer.from(contenu, 'utf8');
    const compresse = zlib.deflateRawSync(brut);
    const nomOctets = Buffer.from(nom, 'utf8');
    const crc = zlib.crc32(brut);

    const entete = Buffer.alloc(30);
    entete.writeUInt32LE(0x04034b50, 0);
    entete.writeUInt16LE(20, 4); // version
    entete.writeUInt16LE(0x0800, 6); // noms en UTF-8
    entete.writeUInt16LE(8, 8); // deflate
    entete.writeUInt32LE(0, 10); // heure et date : sans importance
    entete.writeUInt32LE(crc, 14);
    entete.writeUInt32LE(compresse.length, 18);
    entete.writeUInt32LE(brut.length, 22);
    entete.writeUInt16LE(nomOctets.length, 26);
    entete.writeUInt16LE(0, 28);
    locaux.push(entete, nomOctets, compresse);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compresse.length, 20);
    c.writeUInt32LE(brut.length, 24);
    c.writeUInt16LE(nomOctets.length, 28);
    c.writeUInt32LE(decalage, 42);
    central.push(c, nomOctets);

    decalage += entete.length + nomOctets.length + compresse.length;
  }
  const tailleCentral = central.reduce((t, b) => t + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(fichiers.length, 8);
  fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(tailleCentral, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, ...central, fin]);
}

/**
 * Construit un classeur d'une feuille.
 *
 * @param {{ colonnes: { cle: string, titre: string }[], lignes: object[], feuille?: string }} donnees
 * @returns {Buffer}
 */
export function versXlsx({ colonnes, lignes, feuille = 'Export' }) {
  // La largeur d'une colonne : celle de son contenu le plus long, bornée.
  const largeurs = colonnes.map((c) => Math.min(60, Math.max(8, String(c.titre).length + 2, ...lignes.slice(0, 500).map((l) => String(l[c.cle] ?? '').length + 2))));
  const derniere = lettre(colonnes.length - 1);
  const rangees = [
    `<row r="1">${colonnes.map((c, i) => cellule(`${lettre(i)}1`, c.titre, 1)).join('')}</row>`,
    ...lignes.map((l, n) => `<row r="${n + 2}">${colonnes.map((c, i) => cellule(`${lettre(i)}${n + 2}`, l[c.cle])).join('')}</row>`),
  ];
  const nomFeuille = xml(feuille.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));

  const feuilleXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${largeurs.map((l, i) => `<col min="${i + 1}" max="${i + 1}" width="${l}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rangees.join('')}</sheetData>
${lignes.length ? `<autoFilter ref="A1:${derniere}${lignes.length + 1}"/>` : ''}
</worksheet>`;

  return zip([
    {
      nom: '[Content_Types].xml',
      contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      nom: '_rels/.rels',
      contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      nom: 'xl/workbook.xml',
      contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${nomFeuille}" sheetId="1" r:id="rId1"/></sheets>
${lignes.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${nomFeuille}'!$A$1:$${derniere}$${lignes.length + 1}</definedName></definedNames>` : ''}
</workbook>`,
    },
    {
      nom: 'xl/_rels/workbook.xml.rels',
      contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      nom: 'xl/styles.xml',
      contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`,
    },
    { nom: 'xl/worksheets/sheet1.xml', contenu: feuilleXml },
  ]);
}
