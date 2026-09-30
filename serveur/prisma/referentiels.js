/**
 * Les référentiels de départ (§4 du cahier des charges).
 *
 * Ils sont repris du paramétrage Paperless actuel (configurer-icity.py) et
 * des scripts de classement, en gardant les mêmes noms : les documents déjà
 * classés doivent se retrouver sous les mêmes libellés.
 */

/**
 * Les types de pièce. `ordreCycle` marque les six pièces attendues d'un
 * marché, dans l'ordre du cycle de vie (§5) — ce sont elles qui donnent la
 * phase. Le `code` sert aux colonnes du tableau des marchés.
 */
export const TYPES_DOCUMENTS = [
  { code: 'OS', nom: 'Ordre de service', ordreCycle: 1, pieceAttendue: true },
  { code: 'BL', nom: 'Bon de livraison', ordreCycle: 2, pieceAttendue: true },
  { code: 'PVP', nom: 'PV de réception provisoire', ordreCycle: 3, pieceAttendue: true },
  { code: 'PVD', nom: 'PV de réception définitive', ordreCycle: 4, pieceAttendue: true },
  { code: 'ATT', nom: 'Attestation de référence', ordreCycle: 5, pieceAttendue: true },
  { code: 'MLV', nom: 'Mainlevée de caution', ordreCycle: 6, pieceAttendue: true },

  { code: 'CM', nom: 'Contrat de marché' },
  { code: 'AV', nom: 'Avenant' },
  { code: 'DAO', nom: "Dossier d'appel d'offres" },
  { code: 'BC', nom: 'Bon de commande' },
  { code: 'PVMD', nom: 'PV de mise en demeure' },
  { code: 'PLAN', nom: 'Plan' },
  { code: 'ETU', nom: 'Étude technique' },
  { code: 'CR', nom: 'Compte rendu de réunion' },
  { code: 'COU', nom: 'Courrier' },
  { code: 'FAC', nom: 'Facture' },
  { code: 'DEC', nom: 'Décompte' },
  { code: 'RV', nom: 'Reçu de versement' },
  { code: 'CAU', nom: 'Caution bancaire' },
  { code: 'RMS', nom: 'Rapport de mise en service' },
  { code: 'MAIL', nom: 'Mail' },

  // Les pièces des fournisseurs, versées depuis la partie Achats. Elles ont
  // leurs propres types : le bon de livraison d'un fournisseur n'est pas celui
  // du client, il ne doit pas faire avancer la phase du marché.
  { code: 'BCF', nom: 'Bon de commande fournisseur' },
  { code: 'BLF', nom: 'Bon de livraison fournisseur' },
  { code: 'FACF', nom: 'Facture fournisseur' },
];

/** Les étiquettes, par famille et par couleur (reprises du paramétrage actuel). */
export const ETIQUETTES = [
  // Circuit de validation
  { nom: 'À contrôler', couleur: '#B26A08', famille: 'circuit' },
  { nom: 'À valider', couleur: '#B26A08', famille: 'circuit' },
  { nom: 'Validé', couleur: '#1E7F4C', famille: 'circuit' },
  { nom: 'À corriger', couleur: '#C2352F', famille: 'circuit' },
  { nom: 'Archivé', couleur: '#6247A8', famille: 'circuit' },

  // Criticité
  { nom: 'Critique', couleur: '#C2352F', famille: 'criticite' },
  { nom: 'Important', couleur: '#B26A08', famille: 'criticite' },
  { nom: 'Courant', couleur: '#6C7E8D', famille: 'criticite' },

  // Confidentialité
  { nom: 'Public', couleur: '#1E7F4C', famille: 'confidentialite' },
  { nom: 'Interne', couleur: '#0E8296', famille: 'confidentialite' },
  { nom: 'Restreint', couleur: '#B26A08', famille: 'confidentialite' },
  { nom: 'Confidentiel', couleur: '#C2352F', famille: 'confidentialite' },

  // Patrimoine hors marché
  { nom: 'REFERENCE', couleur: '#6247A8', famille: 'patrimoine' },
  { nom: 'MODELE', couleur: '#6247A8', famille: 'patrimoine' },
  { nom: 'PIECE-ADMIN', couleur: '#6247A8', famille: 'patrimoine' },

  // Traitement
  { nom: 'Original papier', couleur: '#6C7E8D', famille: 'traitement' },
  { nom: 'OCR à vérifier', couleur: '#C2352F', famille: 'traitement' },
  { nom: 'Versé depuis mail', couleur: '#6247A8', famille: 'traitement' },
  { nom: 'Reçu', couleur: '#2E7D32', famille: 'traitement' },
  { nom: 'Envoyé', couleur: '#1565C0', famille: 'traitement' },
  { nom: 'Contrat manquant', couleur: '#C2352F', famille: 'traitement' },
  { nom: 'Rescan à arbitrer', couleur: '#C2352F', famille: 'traitement' },
];

/**
 * Les maîtres d'ouvrage (§4), plus ceux que portent les attestations du
 * fonds. `synonymes` sert à reconnaître le client dans un texte OCR ou dans
 * un nom de dossier ; `dossierOrigine` fait le lien avec les archives.
 */
export const CLIENTS = [
  {
    nom: 'Trésorerie Générale du Royaume',
    sigle: 'TGR',
    synonymes: ['tresorerie generale', 'TGR'],
    dossierOrigine: 'Tresorerie_Generale_du_Royaume',
  },
  {
    nom: 'Administration des Douanes et Impôts Indirects',
    sigle: 'ADII',
    synonymes: ['administration des douanes', 'douanes et impots', 'ADII'],
    dossierOrigine: 'Administration_des_Douanes_et_Impots_indirects',
  },
  { nom: 'Crédit Agricole du Maroc', sigle: 'GCAM', synonymes: ['credit agricole', 'GCAM'], dossierOrigine: 'Credit_Agricole_du_Maroc' },
  { nom: "Ministère de l'Économie et des Finances", synonymes: ["ministere de l'economie", 'ministere des finances'] },
  { nom: 'PRESUD SARL', synonymes: ['PRESUD'], dossierOrigine: 'PRESUD' },
  { nom: 'Barid Al-Maghrib', synonymes: ['barid', 'poste maroc'], dossierOrigine: 'Barid_Al_Maghrib' },
  { nom: 'OCP', synonymes: ['OCP', 'office cherifien'] },
  { nom: 'ONCF', synonymes: ['ONCF'] },
  { nom: "Ministère de l'Aménagement du Territoire", synonymes: ['amenagement du territoire', 'politique de la ville'] },
  {
    nom: 'Administration de la Défense Nationale',
    synonymes: ['defense nationale', 'direction des realisations', 'forces royales air'],
    dossierOrigine: 'Administration_de_la_Defense_Nationale',
  },
  { nom: 'Agence Urbaine de Rabat-Salé', sigle: 'AURS', synonymes: ['agence urbaine', 'AURS'], dossierOrigine: 'Agence_Urbaine_de_Rabat-Sale' },
  { nom: 'CNSS — Polyclinique Kénitra', sigle: 'CNSS', synonymes: ['CNSS', 'polyclinique kenitra'], dossierOrigine: 'CNSS_-_Polyclinique_Kenitra' },
  { nom: 'Ministère de la Justice', synonymes: ['ministere de la justice'], dossierOrigine: 'Ministere_de_la_Justice' },
  {
    nom: 'Société des Silos Portuaires SOSIPO',
    sigle: 'SOSIPO',
    synonymes: ['SOSIPO', 'silos portuaires'],
    dossierOrigine: 'SOSIPO',
  },
  {
    nom: 'Ministère de la Santé et de la Protection Sociale',
    synonymes: ['ministere de la sante', 'protection sociale'],
    dossierOrigine: 'Ministere_de_la_Sante_et_de_la_Protection_Sociale',
  },
  { nom: 'MEDI Telecom', synonymes: ['medi telecom', 'meditel'], dossierOrigine: 'MEDI_Telecom' },
  { nom: 'MEDIOT Technology', synonymes: ['mediot'], dossierOrigine: 'MEDIOT_Technology' },
  { nom: 'NEXTRONIC', synonymes: ['nextronic'], dossierOrigine: 'NEXTRONIC' },

  // Rencontrés dans les attestations du fonds.
  { nom: 'CIRCET', synonymes: ['circet'], dossierOrigine: 'CIRCET' },
  { nom: 'Centrale de Négoce et de Prestation', synonymes: ['centrale de negoce'], dossierOrigine: 'Centrale_de_Negoce_et_de_Prestation' },
  { nom: 'Corporate Technology — Fairmont Taghazout', synonymes: ['corporate technology', 'fairmont taghazout'], dossierOrigine: 'Corporate_Technology_Fairmont_Taghazout' },
  { nom: 'ECV Vidéo Sécurité', synonymes: ['ecv video'], dossierOrigine: 'ECV_Video_Securite' },
  { nom: 'EMC PRO', synonymes: ['emc pro'], dossierOrigine: 'EMC_PRO' },
  { nom: 'Entreprise Glotem', synonymes: ['glotem'], dossierOrigine: 'Entreprise_Glotem' },
  { nom: 'Global Vision', synonymes: ['global vision'], dossierOrigine: 'Global_Vision' },
  { nom: 'Injecta', synonymes: ['injecta'], dossierOrigine: 'Injecta' },
  { nom: 'Marsa Maroc — Jorf Lasfar', synonymes: ['marsa maroc', 'jorf lasfar'], dossierOrigine: 'Marsa_Maroc_Jorf_Lasfar' },
  { nom: 'Office National des Aéroports — Nador', sigle: 'ONDA', synonymes: ['office national des aeroports', 'ONDA'], dossierOrigine: 'Office_National_des_Aeroports_Nador' },
  { nom: 'Port de Tanger Ville (SGPTV)', synonymes: ['port de tanger', 'SGPTV'], dossierOrigine: 'Port_de_Tanger_Ville_SGPTV' },
  { nom: 'Prestat.ma', synonymes: ['prestat'], dossierOrigine: 'Prestat_ma' },
  { nom: 'SOMAPORT', synonymes: ['somaport'], dossierOrigine: 'SOMAPORT' },

  // La société elle-même : jamais cliente (§4).
  { nom: 'INTELIFEX SYSTEMS', synonymes: ['intelifex', 'intolifex'], interne: true },
  { nom: 'ABA Technology', synonymes: ['aba technology'], interne: true },
];
