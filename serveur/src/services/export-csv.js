/**
 * L'export CSV des tableaux (marchés, documents).
 *
 * Deux choses à savoir sur le CSV, et elles expliquent tout ce fichier :
 *
 *  - **Excel en français attend le point-virgule.** Avec des virgules, il
 *    empile toute la ligne dans la première colonne. C'est le défaut ici.
 *  - **Une cellule commençant par `=`, `+`, `-` ou `@` est lue comme une
 *    formule** par Excel. Un objet de marché mal choisi deviendrait un calcul,
 *    voire une commande. On les neutralise par une apostrophe.
 *
 * Le fichier est préfixé d'un BOM UTF-8 : sans lui, Excel lit « Marché »
 * comme « MarchÃ© ».
 */

/** Ce qu'Excel prendrait pour une formule. */
const DEBUT_FORMULE = /^[=+\-@\t\r]/;

/**
 * Prépare une valeur pour une cellule.
 *
 * @param {unknown} valeur
 * @returns {string}
 */
export function cellule(valeur) {
  if (valeur == null) return '';

  let texte = valeur instanceof Date ? valeur.toISOString().slice(0, 10) : String(valeur);

  // Neutralise l'injection de formule : le texte reste lisible, Excel ne
  // l'exécute pas.
  //
  // On teste sans les blancs de tête : Excel les ignore avant d'interpréter
  // la cellule, si bien que « =1+1 » précédé d'un espace s'exécuterait quand
  // même. Les champs saisis à la main sont élagués par le schéma, mais pas
  // ceux qui viennent d'un import, de l'OCR ou d'un objet de courriel.
  if (DEBUT_FORMULE.test(texte.replace(/^[\s\u0000-\u001f\u00a0\ufeff]+/, ''))) texte = `'${texte}`;

  // Guillemets doublés, et entourage dès qu'un séparateur ou un saut de
  // ligne traîne dans la valeur.
  const echappe = texte.replace(/"/g, '""');
  return /[";\n\r]/.test(texte) ? `"${echappe}"` : echappe;
}

/**
 * Construit un CSV complet.
 *
 * @param {{ colonnes: {cle: string, titre: string}[], lignes: object[] }} donnees
 * @returns {string}
 */
export function versCsv({ colonnes, lignes }) {
  const entete = colonnes.map((c) => cellule(c.titre)).join(';');
  const corps = lignes.map((ligne) => colonnes.map((c) => cellule(ligne[c.cle])).join(';'));
  // Le BOM fait lire l'UTF-8 à Excel ; les fins de ligne Windows évitent
  // qu'il colle tout sur une seule ligne.
  return `﻿${[entete, ...corps].join('\r\n')}\r\n`;
}

/** Un nom de fichier daté, sans caractère que Windows refuse. */
export function nomFichier(base) {
  const jour = new Date().toISOString().slice(0, 10);
  return `${base}-${jour}.csv`.replace(/[^a-zA-Z0-9.\-_]/g, '-');
}
