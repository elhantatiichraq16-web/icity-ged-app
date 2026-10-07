/**
 * Les abonnés et les notifications, sur le modèle d'Odoo.
 *
 *  - Suivre une fiche (marché, client, fournisseur, commande) : être prévenu,
 *    dans la cloche, de ce qu'y font les autres.
 *  - Être mentionné dans une note (« @Nassira Bennani ») : être prévenu, et
 *    suivre la fiche désormais.
 *
 * On n'est jamais prévenu de ses propres gestes, ni d'une fiche qu'on n'a pas
 * le droit de voir (les fournisseurs et les commandes restent aux achats et à
 * la direction). Une note interne ne prévient que les personnes mentionnées,
 * comme dans Odoo.
 */
import { droitsPour } from '@icity/commun/droits';
import { db } from '../db.js';
import { PHRASES } from './phrases.js';

/** Les fiches qu'on peut suivre : leur lien, leur nom, le droit qu'il faut pour les voir. */
const FICHES = {
  Marche: { lien: (id) => `/marches/${id}`, nom: async (id) => (await db.marche.findUnique({ where: { id }, select: { reference: true } }))?.reference, droit: null },
  Client: { lien: (id) => `/clients/${id}`, nom: async (id) => (await db.client.findUnique({ where: { id }, select: { nom: true } }))?.nom, droit: null },
  Fournisseur: { lien: (id) => `/achats/fournisseurs/${id}`, nom: async (id) => (await db.fournisseur.findUnique({ where: { id }, select: { nom: true } }))?.nom, droit: ['lire', 'Fournisseur'] },
  CommandeFournisseur: {
    lien: (id) => `/achats/commandes/${id}`,
    nom: async (id) => {
      const c = await db.commandeFournisseur.findUnique({ where: { id }, select: { fournisseur: { select: { nom: true } } } });
      return c ? `la commande ${c.fournisseur.nom}` : null;
    },
    droit: ['lire', 'PrixAchat'],
  },
};

FICHES.OffrePotentielle = {
  lien: (id) => `/marches-potentiels/${id}`,
  nom: async (id) => {
    const o = await db.offrePotentielle.findUnique({ where: { id }, select: { reference: true, objet: true } });
    return o ? o.reference ?? (o.objet.length > 60 ? `${o.objet.slice(0, 59)}…` : o.objet) : null;
  },
  droit: ['lire', 'MarchePotentiel'],
};

export const TYPES_SUIVIS = Object.keys(FICHES);

/** Ce qui ne prévient personne : les consultations, les connexions, les notes (seules les mentions préviennent). */
const ACTIONS_TAIRES = new Set(['note', 'document.telecharge', 'connexion', 'deconnexion', 'connexion.echec']);

/** Cette personne peut-elle voir ce type de fiche ? */
function peutVoir(utilisateur, objetType) {
  const droit = FICHES[objetType]?.droit;
  if (!droit) return true;
  return droitsPour({ id: utilisateur.id, role: utilisateur.role.code }).can(...droit);
}

/** Suivre une fiche (sans effet si on la suit déjà). */
export async function abonner(utilisateurId, objetType, objetId) {
  if (!FICHES[objetType] || !utilisateurId || !objetId) return;
  await db.abonnement.upsert({
    where: { utilisateurId_objetType_objetId: { utilisateurId, objetType, objetId } },
    update: {},
    create: { utilisateurId, objetType, objetId },
  });
}

/**
 * Prévient les abonnés d'une fiche d'une ligne de journal qui la concerne.
 * Une pièce (Document) concerne le marché qui la porte.
 *
 * @param {{ utilisateurId?: number | null, action: string, objetType?: string, objetId?: number, commentaire?: string }} entree
 */
export async function notifierAbonnes(entree) {
  if (ACTIONS_TAIRES.has(entree.action) || entree.action.startsWith('connexion')) return;
  let { objetType, objetId } = entree;
  let piece = null;
  if (objetType === 'Document' && objetId) {
    piece = await db.document.findUnique({ where: { id: objetId }, select: { titre: true, marcheId: true } });
    if (!piece?.marcheId) return;
    objetType = 'Marche';
    objetId = piece.marcheId;
  }
  if (!FICHES[objetType] || !objetId) return;

  const abonnes = await db.abonnement.findMany({
    where: { objetType, objetId, ...(entree.utilisateurId ? { utilisateurId: { not: entree.utilisateurId } } : {}), utilisateur: { actif: true } },
    include: { utilisateur: { include: { role: true } } },
  });
  const destinataires = abonnes.filter((a) => peutVoir(a.utilisateur, objetType));
  if (!destinataires.length) return;

  const [acteur, nomFiche] = await Promise.all([
    entree.utilisateurId ? db.utilisateur.findUnique({ where: { id: entree.utilisateurId }, select: { nom: true } }) : null,
    FICHES[objetType].nom(objetId),
  ]);
  const phrase = (PHRASES[entree.action] ?? entree.action).replace('{piece}', piece ? `« ${piece.titre} »` : 'une pièce');
  const texte = `${acteur?.nom ?? 'Le système'} ${phrase} — ${nomFiche ?? ''}`.slice(0, 255);
  await db.notification.createMany({
    data: destinataires.map((a) => ({ utilisateurId: a.utilisateurId, parId: entree.utilisateurId ?? null, genre: 'suivi', texte, lien: FICHES[objetType].lien(objetId) })),
  });
}

/**
 * Les mentions d'une note : « @Nom Complet » d'un collègue actif. Chacun est
 * prévenu, et suit la fiche désormais.
 *
 * @returns {Promise<string[]>} les noms des personnes mentionnées
 */
export async function notifierMentions({ texte, objetType, objetId, auteurId }) {
  if (!texte.includes('@') || !FICHES[objetType]) return [];
  const equipe = await db.utilisateur.findMany({ where: { actif: true, id: { not: auteurId } }, include: { role: true } });
  const bas = texte.toLocaleLowerCase('fr');
  const mentionnes = equipe.filter((u) => bas.includes(`@${u.nom.toLocaleLowerCase('fr')}`) && peutVoir(u, objetType));
  if (!mentionnes.length) return [];

  const [auteur, nomFiche] = await Promise.all([db.utilisateur.findUnique({ where: { id: auteurId }, select: { nom: true } }), FICHES[objetType].nom(objetId)]);
  const extrait = texte.length > 90 ? `${texte.slice(0, 90)}…` : texte;
  await db.notification.createMany({
    data: mentionnes.map((u) => ({
      utilisateurId: u.id,
      parId: auteurId,
      genre: 'mention',
      texte: `${auteur?.nom ?? 'Quelqu’un'} vous a mentionné sur ${nomFiche ?? 'une fiche'} : « ${extrait} »`.slice(0, 255),
      lien: FICHES[objetType].lien(objetId),
    })),
  });
  for (const u of mentionnes) await abonner(u.id, objetType, objetId);
  return mentionnes.map((u) => u.nom);
}
