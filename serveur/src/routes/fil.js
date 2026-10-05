/**
 * Le fil d'activité d'une fiche, sur le modèle du « chatter » d'Odoo.
 *
 * Sous la fiche d'un marché ou d'un client, tout ce qui s'y est passé, du
 * plus récent au plus ancien : les notes internes, les modifications (« Statut
 * : En cours → Gagné, par Ichrak »), la vie de ses pièces et les mails
 * échangés.
 *
 * Rien n'est stocké en plus : le fil se lit dans le journal d'audit et les
 * mails rattachés. Une note interne est une ligne de journal comme une autre
 * (action « note ») : elle ne se modifie ni ne s'efface, comme dans Odoo.
 */
import { z } from 'zod';
import { ETATS } from '@icity/commun/circuit';
import { confidentialitesVisibles } from '@icity/commun/droits';
import { TYPES_ORGANISMES } from '@icity/commun/schemas';
import { db } from '../db.js';
import { interdit, introuvable, valider } from '../erreurs.js';
import { exigerConnexion } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';

/** Les consultations ne sont pas des événements : elles encombreraient le fil. */
const ACTIONS_TAIRES = ['document.telecharge'];

/** Au-delà, le fil remonterait trop loin pour être lu. */
const LIMITE = 200;

/** Les fiches qui ont un fil : leur nom dans l'URL, leur type au journal. */
const TYPES = { marche: 'Marche', client: 'Client', fournisseur: 'Fournisseur' };

/** Les noms lisibles des champs, pour dire ce qui a changé. */
const CHAMPS = {
  reference: 'Référence',
  clientId: 'Client',
  objet: 'Objet',
  numeroAo: 'N° d’appel d’offres',
  lot: 'Lot',
  montantHt: 'Montant HT',
  montantTtc: 'Montant TTC',
  dateSignature: 'Date de signature',
  dateOs: 'Ordre de service',
  delaiMois: 'Délai (mois)',
  dateFin: 'Date de fin',
  ville: 'Ville',
  responsableId: 'Responsable',
  emplacementPapier: 'Emplacement papier',
  statutAffaire: 'Statut',
  conservation: 'Conservation',
  objetTechnique: 'Objet technique',
  signe: 'Signé',
  nom: 'Nom',
  sigle: 'Sigle',
  synonymes: 'Autres écritures',
  domainesEmail: 'Domaines e-mail',
  typeOrganisme: 'Type d’organisme',
  ice: 'ICE',
  identifiantFiscal: 'IF',
  registreCommerce: 'RC',
  adresse: 'Adresse',
  codePostal: 'Code postal',
  pays: 'Pays',
  telephone: 'Téléphone',
  email: 'E-mail',
  siteWeb: 'Site web',
  notes: 'Notes internes',
  marcheId: 'Marché',
  typeDocumentId: 'Type',
  titre: 'Titre',
  confidentialite: 'Confidentialité',
};

/** Ce que dit chaque action, en clair. `{piece}` est remplacé par le titre de la pièce. */
const PHRASES = {
  'marche.cree': 'a créé l’affaire',
  'marche.modifie': 'a modifié la fiche',
  'marche.archive': 'a archivé le marché',
  'marche.desarchive': 'a désarchivé le marché',
  'marche.declare_par_attestation': 'a déclaré l’affaire d’après une attestation',
  'achats.import': 'a importé le classeur des achats',
  'activite.planifiee': 'a planifié une activité',
  'activite.faite': 'a fait une activité',
  'activite.annulee': 'a annulé une activité',
  'client.cree': 'a créé le client',
  'client.modifie': 'a modifié la fiche',
  'client.contact_ajoute': 'a ajouté un contact',
  'client.contact_modifie': 'a modifié un contact',
  'client.contact_retire': 'a retiré un contact',
  'fournisseur.cree': 'a créé le fournisseur',
  'fournisseur.modifie': 'a modifié la fiche',
  'fournisseur.fusionne': 'a fusionné un doublon dans cette fiche',
  'fournisseur.contact_ajoute': 'a ajouté un contact',
  'fournisseur.contact_modifie': 'a modifié un contact',
  'fournisseur.contact_retire': 'a retiré un contact',
  'document.verse': 'a versé {piece}',
  'document.modifie': 'a rangé ou corrigé {piece}',
  'document.classe_auto': 'a rangé automatiquement {piece}',
  'document.corbeille': 'a mis {piece} en corbeille',
  'document.restaure': 'a restauré {piece}',
  'document.archive': 'a archivé {piece}',
  'document.desarchive': 'a désarchivé {piece}',
  'document.nouvelle_version': 'a déposé une nouvelle version de {piece}',
  'document.relecture': 'a relancé la lecture de {piece}',
  'document.corbeille_lot': 'a mis des pièces en corbeille, dont {piece}',
};

/** Une valeur de journal, lisible. */
function lisible(champ, valeur, noms) {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  if (champ === 'clientId') return noms.clients.get(valeur) ?? `n° ${valeur}`;
  if (champ === 'marcheId') return noms.marches.get(valeur) ?? `n° ${valeur}`;
  if (champ === 'responsableId') return noms.utilisateurs.get(valeur) ?? `n° ${valeur}`;
  if (champ === 'typeDocumentId') return noms.types.get(valeur) ?? `n° ${valeur}`;
  if (champ === 'typeOrganisme') return TYPES_ORGANISMES.find((t) => t.code === valeur)?.nom ?? valeur;
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  if (Array.isArray(valeur)) return valeur.join(', ') || '—';
  if (typeof valeur === 'object') return JSON.stringify(valeur);
  return String(valeur);
}

/** Les changements d'une ligne de journal : [{ champ, avant, apres }]. */
function changementsDe(ligne, noms) {
  const avant = ligne.avant && typeof ligne.avant === 'object' ? ligne.avant : {};
  const apres = ligne.apres && typeof ligne.apres === 'object' ? ligne.apres : {};
  return Object.keys(apres)
    .filter((c) => CHAMPS[c] && JSON.stringify(avant[c] ?? null) !== JSON.stringify(apres[c] ?? null))
    .map((c) => ({ champ: CHAMPS[c], avant: c in avant ? lisible(c, avant[c], noms) : null, apres: lisible(c, apres[c], noms) }));
}

/** Les noms à mettre à la place des identifiants, chargés en une fois. */
async function chargerNoms(lignes) {
  const ids = { clients: new Set(), marches: new Set(), utilisateurs: new Set(), types: new Set() };
  for (const l of lignes) {
    for (const cote of [l.avant, l.apres]) {
      if (!cote || typeof cote !== 'object') continue;
      if (cote.clientId) ids.clients.add(cote.clientId);
      if (cote.marcheId) ids.marches.add(cote.marcheId);
      if (cote.responsableId) ids.utilisateurs.add(cote.responsableId);
      if (cote.typeDocumentId) ids.types.add(cote.typeDocumentId);
    }
  }
  const [clients, marches, utilisateurs, types] = await Promise.all([
    db.client.findMany({ where: { id: { in: [...ids.clients] } }, select: { id: true, nom: true } }),
    db.marche.findMany({ where: { id: { in: [...ids.marches] } }, select: { id: true, reference: true } }),
    db.utilisateur.findMany({ where: { id: { in: [...ids.utilisateurs] } }, select: { id: true, nom: true } }),
    db.typeDocument.findMany({ where: { id: { in: [...ids.types] } }, select: { id: true, nom: true } }),
  ]);
  return {
    clients: new Map(clients.map((c) => [c.id, c.nom])),
    marches: new Map(marches.map((m) => [m.id, m.reference])),
    utilisateurs: new Map(utilisateurs.map((u) => [u.id, u.nom])),
    types: new Map(types.map((t) => [t.id, t.nom])),
  };
}

/** Une ligne de journal, telle que le fil l'affiche. */
function elementJournal(l, noms, pieces) {
  const par = l.utilisateur?.nom ?? 'Le système';
  if (l.action === 'note') {
    return { genre: 'note', id: `j${l.id}`, date: l.creeLe, par, texte: l.commentaire ?? '' };
  }
  const piece = l.objetType === 'Document' ? pieces.get(l.objetId) : null;
  const nomPiece = piece ? `« ${piece.titre} »` : 'une pièce';
  let phrase = PHRASES[l.action];
  let changements = changementsDe(l, noms);
  if (l.action.startsWith('circuit.')) {
    const de = ETATS[l.avant?.etat]?.nom ?? l.avant?.etat;
    const vers = ETATS[l.apres?.etat]?.nom ?? l.apres?.etat;
    phrase = `a fait passer ${nomPiece} : ${de} → ${vers}`;
    changements = [];
  } else if (l.action.startsWith('client.contact_') || l.action.startsWith('fournisseur.contact_')) {
    // Le contact concerné, plutôt qu'une liste de champs.
    phrase = `${PHRASES[l.action]} : ${(l.apres ?? l.avant)?.nom ?? ''}`;
    changements = [];
  }
  return {
    genre: 'suivi',
    id: `j${l.id}`,
    date: l.creeLe,
    par,
    texte: (phrase ?? l.action).replace('{piece}', nomPiece),
    pieceId: piece?.id ?? null,
    changements,
    commentaire: l.action.startsWith('circuit.') || l.action.startsWith('activite.') || ['achats.import', 'fournisseur.fusionne'].includes(l.action) ? l.commentaire : null,
  };
}

/** Un mail, tel que le fil l'affiche. */
function elementMail(m) {
  return {
    genre: 'mail',
    id: `m${m.id}`,
    mailId: m.id,
    date: m.date,
    direction: m.direction,
    objet: m.objet,
    expediteur: m.expediteur,
    destinataires: m.destinataires ?? [],
    piecesJointes: m.piecesJointes.map((p) => ({ id: p.id, nom: p.nom, documentId: p.documentId })),
  };
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesFil(app) {
  app.addHook('preHandler', exigerConnexion);

  /** La fiche visée, ou 404. */
  async function fiche(requete) {
    const type = TYPES[requete.params.type];
    const id = Number(requete.params.id) || 0;
    // Les fournisseurs (et leurs prix) restent aux achats et à la direction.
    if (type === 'Fournisseur' && !requete.droits.can('lire', 'Fournisseur')) throw interdit();
    const lire = { Marche: () => db.marche.findUnique({ where: { id } }), Client: () => db.client.findUnique({ where: { id } }), Fournisseur: () => db.fournisseur.findUnique({ where: { id } }) };
    const existe = type ? await lire[type]() : null;
    if (!existe) throw introuvable({ Client: 'Client', Fournisseur: 'Fournisseur' }[type] ?? 'Marché');
    return { type, id };
  }

  app.get('/api/fil/:type/:id', async (requete) => {
    const { type, id } = await fiche(requete);
    const vus = confidentialitesVisibles(requete.utilisateur.role.code);

    // Les pièces d'un marché : leur vie compte dans son fil. Seulement celles
    // qu'on a le droit de voir, comme partout.
    const pieces =
      type === 'Marche'
        ? await db.document.findMany({
            where: { marcheId: id, OR: [{ confidentialite: { in: vus } }, { verseParId: requete.utilisateur.id }] },
            select: { id: true, titre: true },
          })
        : [];
    const parPiece = new Map(pieces.map((p) => [p.id, p]));

    const lignes = await db.journal.findMany({
      where: {
        OR: [
          { objetType: type, objetId: id },
          ...(pieces.length ? [{ objetType: 'Document', objetId: { in: pieces.map((p) => p.id) } }] : []),
        ],
        action: { notIn: ACTIONS_TAIRES },
      },
      include: { utilisateur: { select: { nom: true } } },
      orderBy: { creeLe: 'desc' },
      take: LIMITE,
    });

    // Un mail se rattache à un marché ou à un client, pas à un fournisseur.
    const mails = type !== 'Fournisseur' && requete.droits.can('lire', 'Mail')
      ? await db.mail.findMany({
          where: type === 'Marche' ? { marcheId: id } : { clientId: id },
          include: { piecesJointes: true },
          orderBy: { date: 'desc' },
          take: LIMITE,
        })
      : [];

    const noms = await chargerNoms(lignes);
    const elements = [...lignes.map((l) => elementJournal(l, noms, parPiece)), ...mails.map(elementMail)]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, LIMITE);
    return { elements };
  });

  /**
   * Écrire une note interne sur la fiche : une remarque pour les collègues
   * (« le client attend le BL avant vendredi »). Tout compte connecté peut en
   * laisser une ; elle reste au journal, signée, sans retouche possible.
   */
  app.post('/api/fil/:type/:id/notes', async (requete, reponse) => {
    const { type, id } = await fiche(requete);
    const { texte } = valider(
      z.object({ texte: z.string({ error: 'Écrivez la note.' }).trim().min(1, { error: 'Écrivez la note.' }).max(4000, { error: '4 000 caractères au plus.' }) }),
      requete.body,
    );
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'note', objetType: type, objetId: id, commentaire: texte, ip: requete.ip }, requete.log);
    const ligne = await db.journal.findFirst({
      where: { action: 'note', objetType: type, objetId: id, utilisateurId: requete.utilisateur.id },
      include: { utilisateur: { select: { nom: true } } },
      orderBy: { id: 'desc' },
    });
    return reponse.code(201).send(elementJournal(ligne, await chargerNoms([]), new Map()));
  });
}
