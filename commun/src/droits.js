/**
 * Qui peut faire quoi — la matrice des droits d'iCity GED.
 *
 * On utilise CASL : on déclare des règles « peut <action> <sujet> [si
 * condition] », puis on les interroge avec `droits.can('valider', doc)`.
 *
 * Le même fichier sert au serveur ET aux écrans :
 *   - le serveur refuse l'action (c'est la seule vraie protection : un
 *     bouton caché n'empêche personne d'appeler l'API directement) ;
 *   - l'écran masque les boutons inutiles, par simple confort.
 *
 * Sujets : Document, Marche, Client, Mail, AVerifier, Utilisateur,
 * Referentiel, CompteMail, Sauvegarde, Journal, Parametres.
 */
import { AbilityBuilder, createMongoAbility, subject } from '@casl/ability';
import { CONFIDENTIALITES, NIVEAU_MAX_PAR_ROLE } from './roles.js';

export { subject };

/** Les rôles qui déposent des pièces (tout le monde sauf le Lecteur). */
const DEPOSANTS = ['directeur', 'responsable_documentaire', 'chef_projet', 'commercial_ao', 'achats'];

/**
 * Les codes de confidentialité qu'un rôle a le droit de voir.
 * Sert aussi au serveur pour filtrer les listes en SQL.
 *
 * @param {string} codeRole
 * @returns {string[]}
 */
export function confidentialitesVisibles(codeRole) {
  const max = NIVEAU_MAX_PAR_ROLE[codeRole] ?? 0;
  return CONFIDENTIALITES.filter((c) => c.niveau <= max).map((c) => c.code);
}

/**
 * Construit les droits d'un utilisateur connecté.
 *
 * @param {{ id: number, role: string } | null} utilisateur
 */
export function droitsPour(utilisateur) {
  const { can, cannot, build } = new AbilityBuilder(createMongoAbility);

  if (!utilisateur) return build();

  const role = utilisateur.role;
  const moi = utilisateur.id;

  // ── L'administrateur : tout, y compris le confidentiel ──
  if (role === 'administrateur') {
    can('manage', 'all');
    return build();
  }

  // ── Ce que tout compte actif peut faire ──
  can('lire', ['TableauDeBord', 'Marche', 'Client']);
  can('rechercher', 'Document');

  // Un document se lit selon sa confidentialité (§8). Celui qui l'a versé
  // le voit toujours : on ne perd pas de vue ce qu'on vient de déposer.
  can('lire', 'Document', { confidentialite: { $in: confidentialitesVisibles(role) } });
  can('lire', 'Document', { versePar: moi });

  // Les achats : chacun voit le matériel d'un marché et où en est sa
  // commande. Les prix, les marges et les paiements (« PrixAchat ») restent
  // aux achats et à la direction.
  can('lire', 'Achat');

  if (role === 'lecteur') return build();

  // ── Déposants ──
  if (DEPOSANTS.includes(role)) {
    can('verser', 'Document');
    can('lire', 'Mail');
    // Tant qu'il n'est pas soumis, le déposant corrige sa propre pièce.
    can('modifier', 'Document', { versePar: moi, etatCircuit: { $in: ['brouillon', 'a_corriger'] } });
    can('soumettre', 'Document', { versePar: moi, etatCircuit: { $in: ['brouillon', 'a_corriger'] } });
  }

  // ── Marchés : ceux qui les font vivre ──
  if (['directeur', 'responsable_documentaire', 'chef_projet', 'commercial_ao'].includes(role)) {
    can(['creer', 'modifier'], 'Marche');
    can('rattacher', 'Mail');
    // Écrire au client fait partie du suivi d'un marché : qui rattache un
    // échange peut aussi y répondre (§10).
    can('envoyer', 'Mail');
  }

  // ── Responsable documentaire : qualité du fonds ──
  if (role === 'responsable_documentaire') {
    can('modifier', 'Document');
    can('controler', 'Document');
    can('supprimer', 'Document');
    can('gerer', ['AVerifier', 'Client']);
  }

  // ── Achats : la personne responsable gère tout, et valide elle-même ──
  if (role === 'achats') {
    can('gerer', ['Achat', 'Fournisseur']);
    can('lire', ['PrixAchat', 'Fournisseur']);
  }

  // Les comptes mail portent un mot de passe d'application : seul
  // l'administrateur les configure (§10).

  // ── Directeur : validation finale ──
  if (role === 'directeur') {
    can('modifier', 'Document');
    can(['controler', 'valider', 'archiver', 'supprimer'], 'Document');
    can('supprimer', 'Marche');
    can('gerer', ['AVerifier', 'Client']);
    can('lire', 'Journal');
    // Il suit les achats et leurs prix, sans les saisir.
    can('lire', ['PrixAchat', 'Fournisseur']);
  }

  // Garde-fou : quel que soit le rôle (hors administrateur), on ne touche
  // pas à un document qu'on n'a pas le droit de voir.
  cannot(['modifier', 'supprimer', 'controler', 'valider', 'archiver'], 'Document', {
    confidentialite: { $nin: confidentialitesVisibles(role) },
    versePar: { $ne: moi },
  });

  return build();
}
