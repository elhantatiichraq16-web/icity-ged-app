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

import { versXlsx } from './ecriture-xlsx.js';

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
export function nomFichier(base, extension = 'csv') {
  const jour = new Date().toISOString().slice(0, 10);
  return `${base}-${jour}.${extension}`.replace(/[^a-zA-Z0-9.\-_]/g, '-');
}

/**
 * Un export de tableau, comme ceux d'Odoo : en Excel (.xlsx) ou en CSV, avec
 * les colonnes choisies.
 *
 *  - `GET <chemin>/export/colonnes` : les colonnes qu'on peut choisir (selon
 *    les droits : les prix restent aux achats et à la direction) ;
 *  - `GET <chemin>/export.xlsx` et `<chemin>/export.csv` : le tableau, avec les
 *    mêmes filtres et les mêmes droits que l'écran ; `?colonnes=a,b,c` n'en
 *    garde que celles-là, dans leur ordre d'origine.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {{ chemin: string, options?: object, base: string, feuille: string,
 *           construire: (requete: object) => Promise<{ colonnes: {cle: string, titre: string}[], lignes: object[] }> }} p
 */
export function enregistrerExport(app, { chemin, options = {}, base, feuille, construire }) {
  app.get(`${chemin}/export/colonnes`, options, async (requete) => (await construire(requete)).colonnes);

  for (const format of ['csv', 'xlsx']) {
    app.get(`${chemin}/export.${format}`, options, async (requete, reponse) => {
      const { colonnes, lignes } = await construire(requete);
      const choix = requete.query.colonnes ? String(requete.query.colonnes).split(',') : null;
      const retenues = choix ? colonnes.filter((c) => choix.includes(c.cle)) : colonnes;
      if (!retenues.length) return reponse.code(422).send({ message: 'Choisissez au moins une colonne.' });
      if (format === 'csv') {
        return reponse
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${nomFichier(base)}"`)
          .send(versCsv({ colonnes: retenues, lignes }));
      }
      return reponse
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${nomFichier(base, 'xlsx')}"`)
        .send(versXlsx({ colonnes: retenues, lignes, feuille }));
    });
  }
}
