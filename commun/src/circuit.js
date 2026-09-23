/**
 * Le circuit de validation d'un document (§8).
 *
 *   Brouillon → Soumis au contrôle → À corriger / Contrôlé
 *             → Soumis à validation → Validé → Officiel → Archivé
 *
 * Deux règles tiennent la valeur probatoire du fonds :
 *  - on ne saute pas d'étape : un document ne devient pas « Validé » sans
 *    être passé par le contrôle documentaire ;
 *  - une pièce critique (contrat, PV, attestation) exige un contrôle humain :
 *    aucun automatisme ne s'y substitue.
 *
 * Ce fichier est partagé : le serveur refuse les transitions interdites, et
 * les écrans n'affichent que les boutons qui mènent quelque part.
 */

export const ETATS = {
  brouillon: { nom: 'Brouillon', ton: 'neutre', description: "Déposé, pas encore soumis" },
  soumis_controle: { nom: 'Soumis au contrôle', ton: 'attente', description: 'Attend le responsable documentaire' },
  a_corriger: { nom: 'À corriger', ton: 'alerte', description: 'Renvoyé au déposant' },
  controle: { nom: 'Contrôlé', ton: 'cyan', description: 'Métadonnées vérifiées' },
  soumis_validation: { nom: 'Soumis à validation', ton: 'attente', description: 'Attend la direction' },
  valide: { nom: 'Validé', ton: 'ok', description: 'La direction a validé' },
  officiel: { nom: 'Officiel', ton: 'ok', description: 'Fait foi' },
  archive: { nom: 'Archivé', ton: 'neutre', description: 'Conservé, hors circuit actif' },
};

export const ORDRE_ETATS = ['brouillon', 'soumis_controle', 'controle', 'soumis_validation', 'valide', 'officiel', 'archive'];

/**
 * Les transitions possibles : depuis quels états, vers quel état, avec quel
 * droit. `commentaireObligatoire` pour celles qui renvoient en arrière — on
 * doit dire ce qui ne va pas.
 */
export const TRANSITIONS = {
  soumettre: { de: ['brouillon', 'a_corriger'], vers: 'soumis_controle', droit: 'soumettre', libelle: 'Soumettre au contrôle' },
  controler: { de: ['soumis_controle'], vers: 'controle', droit: 'controler', libelle: 'Marquer contrôlé' },
  soumettre_validation: { de: ['controle'], vers: 'soumis_validation', droit: 'controler', libelle: 'Soumettre à la direction' },
  valider: { de: ['soumis_validation'], vers: 'valide', droit: 'valider', libelle: 'Valider' },
  officialiser: { de: ['valide'], vers: 'officiel', droit: 'valider', libelle: 'Rendre officiel' },
  archiver: { de: ['officiel', 'valide'], vers: 'archive', droit: 'archiver', libelle: 'Archiver' },
  renvoyer: {
    de: ['soumis_controle', 'controle', 'soumis_validation'],
    vers: 'a_corriger',
    droit: 'controler',
    libelle: 'Renvoyer pour correction',
    commentaireObligatoire: true,
  },
};

/** Les pièces qui engagent : contrôle humain obligatoire (§8). */
export const TYPES_CRITIQUES = ['CM', 'AV', 'PVP', 'PVD', 'PVMD', 'ATT', 'CAU', 'MLV'];

export function criticiteDe(codeType) {
  if (TYPES_CRITIQUES.includes(codeType)) return 'critique';
  if (['DAO', 'ETU', 'PLAN', 'FAC', 'DEC', 'BC', 'BL'].includes(codeType)) return 'important';
  return 'courant';
}

/**
 * Les transitions qu'un utilisateur peut déclencher sur un document.
 *
 * @param {{ etatCircuit: string, versePar?: number|null }} document
 * @param {{ can: (action: string, sujet: any) => boolean }} droits
 * @returns {Array<{ cle: string, libelle: string, vers: string, commentaireObligatoire?: boolean }>}
 */
export function transitionsPossibles(document, droits, sujet) {
  return Object.entries(TRANSITIONS)
    .filter(([, t]) => t.de.includes(document.etatCircuit) && droits.can(t.droit, sujet ?? 'Document'))
    .map(([cle, t]) => ({ cle, libelle: t.libelle, vers: t.vers, commentaireObligatoire: Boolean(t.commentaireObligatoire) }));
}

/**
 * Vérifie une transition. Rend { ok: true } ou la raison du refus — en
 * français, telle qu'elle s'affichera.
 */
export function verifierTransition(document, cle, { commentaire } = {}) {
  const transition = TRANSITIONS[cle];
  if (!transition) return { ok: false, raison: 'Cette action n’existe pas.' };
  if (!transition.de.includes(document.etatCircuit)) {
    return { ok: false, raison: `Impossible depuis l’état « ${ETATS[document.etatCircuit]?.nom ?? document.etatCircuit} ».` };
  }
  if (transition.commentaireObligatoire && !String(commentaire ?? '').trim()) {
    return { ok: false, raison: 'Dites ce qui doit être corrigé : le déposant doit savoir quoi reprendre.' };
  }
  return { ok: true, vers: transition.vers };
}
