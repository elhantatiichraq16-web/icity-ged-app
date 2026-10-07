/**
 * L'import d'un fichier CSV d'offres : pour une source qui ne permet pas de
 * synchronisation automatique, ou pour reprendre un export fait à la main.
 *
 * Séparateur « ; » ou « , » (détecté), guillemets doubles, BOM accepté.
 * Les colonnes sont reconnues par leur nom, avec ou sans accents :
 *   reference, objet (obligatoire), acheteur, categorie, procedure, lieu,
 *   date_publication, date_limite, estimation, caution, url, identifiant, domaines.
 */

const COLONNES = {
  identifiant: 'idExterne', id: 'idExterne', id_externe: 'idExterne',
  reference: 'reference', ref: 'reference',
  objet: 'objet', intitule: 'objet',
  resume: 'resume', description: 'resume',
  acheteur: 'acheteur', acheteur_public: 'acheteur', maitre_ouvrage: 'acheteur',
  categorie: 'categorie',
  procedure: 'procedure',
  lieu: 'lieu', lieu_execution: 'lieu', lieu_d_execution: 'lieu', ville: 'lieu',
  date_publication: 'datePublication', date_de_publication: 'datePublication', publie_le: 'datePublication', publication: 'datePublication',
  date_limite: 'dateLimite', date_limite_remise_plis: 'dateLimite', date_limite_de_remise_des_plis: 'dateLimite', echeance: 'dateLimite',
  estimation: 'estimation', montant: 'estimation',
  caution: 'caution', caution_provisoire: 'caution',
  url: 'urlOfficielle', lien: 'urlOfficielle', url_officielle: 'urlOfficielle',
  domaines: 'domaines', domaine: 'domaines',
};

const cleColonne = (t) =>
  t
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Découpe un CSV en lignes de cellules (guillemets et retours à la ligne dans les cellules compris). */
export function lireCsv(texte) {
  const t = texte.replace(/^﻿/, '');
  const premiere = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (premiere.match(/;/g)?.length ?? 0) >= (premiere.match(/,/g)?.length ?? 0) ? ';' : ',';
  const lignes = [];
  let ligne = [];
  let cellule = '';
  let entreGuillemets = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreGuillemets) {
      if (c === '"' && t[i + 1] === '"') {
        cellule += '"';
        i++;
      } else if (c === '"') entreGuillemets = false;
      else cellule += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === sep) {
      ligne.push(cellule);
      cellule = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(cellule);
      if (ligne.some((x) => x.trim())) lignes.push(ligne);
      ligne = [];
      cellule = '';
    } else cellule += c;
  }
  ligne.push(cellule);
  if (ligne.some((x) => x.trim())) lignes.push(ligne);
  return lignes;
}

/**
 * Le CSV → des offres brutes, et les lignes refusées.
 *
 * @returns {{ offres: object[], erreurs: { ligne: number, message: string }[] }}
 */
export function analyserCsv(texte) {
  const [entete, ...lignes] = lireCsv(texte);
  if (!entete) return { offres: [], erreurs: [{ ligne: 1, message: 'Fichier vide.' }] };
  const champs = entete.map((t) => COLONNES[cleColonne(t)] ?? null);
  if (!champs.includes('objet')) return { offres: [], erreurs: [{ ligne: 1, message: 'Il manque la colonne « objet ».' }] };
  const offres = [];
  const erreurs = [];
  lignes.slice(0, 5000).forEach((cellules, i) => {
    const brute = {};
    champs.forEach((champ, j) => {
      if (champ && cellules[j]?.trim()) brute[champ] = cellules[j].trim();
    });
    if (brute.domaines) brute.domaines = brute.domaines.split('|').map((d) => d.trim());
    if (!brute.objet) erreurs.push({ ligne: i + 2, message: 'objet manquant' });
    else offres.push(brute);
  });
  if (lignes.length > 5000) erreurs.push({ ligne: 5002, message: 'au-delà de 5 000 lignes, le reste est ignoré' });
  return { offres, erreurs };
}
