/**
 * Les sept rôles d'iCity GED, d'après la spécification technique (module M01).
 *
 * Ce fichier est partagé : le serveur s'en sert pour vérifier les droits, les
 * écrans pour afficher les libellés. Un rôle renommé ici l'est partout.
 */

/** @typedef {'administrateur'|'directeur'|'responsable_documentaire'|'chef_projet'|'commercial_ao'|'achats'|'lecteur'} CodeRole */

export const ROLES = /** @type {const} */ ([
  {
    code: 'administrateur',
    nom: 'Administrateur',
    description: "Référentiels, comptes, droits, journaux, sauvegardes",
  },
  {
    code: 'directeur',
    nom: 'Directeur',
    description: 'Validation finale, accès aux pièces confidentielles',
  },
  {
    code: 'responsable_documentaire',
    nom: 'Responsable documentaire',
    description: 'Contrôle des dépôts, qualité des métadonnées',
  },
  {
    code: 'chef_projet',
    nom: 'Chef de projet',
    description: 'Dépôt, mise à jour des fiches marché',
  },
  {
    code: 'commercial_ao',
    nom: 'Commercial / AO',
    description: "Appels d'offres, attestations de référence",
  },
  {
    code: 'achats',
    nom: 'Achats',
    description: 'Commandes, livraisons, fournisseurs',
  },
  {
    code: 'lecteur',
    nom: 'Lecteur',
    description: 'Consultation selon habilitation',
  },
]);

export const CODES_ROLES = ROLES.map((r) => r.code);

/** Le libellé d'un rôle, ou le code lui-même s'il est inconnu. */
export function nomRole(code) {
  return ROLES.find((r) => r.code === code)?.nom ?? code;
}

/**
 * Les niveaux de confidentialité, du plus ouvert au plus fermé.
 *
 * Un nombre plutôt qu'un simple libellé : « peut voir jusqu'à Restreint »
 * devient une comparaison, et un niveau ajouté plus tard se range tout seul.
 */
export const CONFIDENTIALITES = /** @type {const} */ ([
  { code: 'public', nom: 'Public', niveau: 0 },
  { code: 'interne', nom: 'Interne', niveau: 1 },
  { code: 'restreint', nom: 'Restreint', niveau: 2 },
  { code: 'confidentiel', nom: 'Confidentiel', niveau: 3 },
]);

export function niveauConfidentialite(code) {
  return CONFIDENTIALITES.find((c) => c.code === code)?.niveau ?? 0;
}

/**
 * Jusqu'où chaque rôle voit. Le Lecteur s'arrête à « Interne » ; seuls
 * l'Administrateur et le Directeur voient le « Confidentiel » (§8).
 */
export const NIVEAU_MAX_PAR_ROLE = {
  administrateur: 3,
  directeur: 3,
  responsable_documentaire: 2,
  chef_projet: 2,
  commercial_ao: 2,
  achats: 2,
  lecteur: 1,
};
