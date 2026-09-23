/**
 * La corbeille (§9).
 *
 * Rien n'est jamais supprimé d'un clic : une pièce écartée passe ici, et y
 * reste trente jours. Au-delà, le worker l'efface pour de bon, avec son
 * fichier — sinon le stockage garderait des pièces que plus rien ne
 * référence.
 *
 * Aucune route ne supprime définitivement : le délai est la seule porte de
 * sortie, et c'est ce qui rend la suppression sûre.
 */
import { z } from 'zod';
import { confidentialitesVisibles } from '@icity/commun/droits';
import { db } from '../db.js';
import { introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';
import { JOURS_CORBEILLE } from '../services/entretien.js';
import { recalculerPhase } from '../services/phase-marche.js';

/** Les identifiants d'un lot : assez pour une page, pas pour tout le fonds. */
const schemaLot = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'Choisissez au moins une pièce.').max(200),
});

const AVEC = { typeDocument: true, marche: true, client: true };

function vueDocument(d) {
  return {
    id: d.id,
    titre: d.titre,
    nomOrigine: d.nomOrigine,
    pages: d.pages,
    type: d.typeDocument?.nom ?? null,
    marche: d.marche ? { id: d.marche.id, reference: d.marche.reference } : null,
    client: d.client?.nom ?? null,
    supprimeLe: d.supprimeLe,
  };
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesCorbeille(app) {
  app.addHook('preHandler', exigerConnexion);

  const reserve = { preHandler: exiger('gerer', 'AVerifier') };

  app.get('/api/corbeille', reserve, async () => {
    const documents = await db.document.findMany({
      where: { supprimeLe: { not: null } },
      include: AVEC,
      orderBy: { supprimeLe: 'desc' },
      take: 200,
    });

    return {
      joursAvantVidage: JOURS_CORBEILLE,
      documents: documents.map((d) => ({
        ...vueDocument(d),
        // Ce qu'il reste avant le vidage automatique.
        joursRestants: Math.max(0, JOURS_CORBEILLE - Math.floor((Date.now() - d.supprimeLe.getTime()) / 86_400_000)),
      })),
    };
  });

  app.post('/api/documents/:id/corbeille', { preHandler: exiger('supprimer', 'Document') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const d = await db.document.findFirst({ where: { id, supprimeLe: null } });
    if (!d) throw introuvable('Document');

    await db.document.update({ where: { id }, data: { supprimeLe: new Date() } });
    if (d.marcheId) await recalculerPhase(d.marcheId);
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'document.corbeille', objetType: 'Document', objetId: id, ip: requete.ip },
      requete.log,
    );
    return { ok: true };
  });

  /**
   * Mettre plusieurs pièces en corbeille d'un coup.
   *
   * Trier un fonds se fait par lots : cinquante scans d'essai, une série
   * versée en double. Cinquante requêtes séparées feraient cinquante
   * recalculs de phase et cinquante lignes de journal pour un seul geste.
   */
  app.post('/api/documents/corbeille', { preHandler: exiger('supprimer', 'Document') }, async (requete) => {
    const { ids } = valider(schemaLot, requete.body);

    // On ne touche qu'à ce qui existe et n'est pas déjà en corbeille : un
    // identifiant inconnu ne doit pas faire échouer tout le lot.
    //
    // Et surtout : on ne supprime pas ce qu'on n'a pas le droit de voir.
    // `exiger` ne contrôle que le type « Document » ; la règle qui protège le
    // confidentiel (§8) porte sur les champs d'une pièce précise, et ne
    // s'évalue donc pas là.
    const documents = await db.document.findMany({
      where: {
        id: { in: ids },
        supprimeLe: null,
        OR: [
          { confidentialite: { in: confidentialitesVisibles(requete.utilisateur.role.code) } },
          { verseParId: requete.utilisateur.id },
        ],
      },
      select: { id: true, marcheId: true },
    });
    if (!documents.length) return { supprimes: 0, marches: 0 };

    await db.document.updateMany({
      where: { id: { in: documents.map((d) => d.id) } },
      data: { supprimeLe: new Date() },
    });

    // Chaque marché touché voit sa phase recalculée une seule fois, même si
    // le lot lui prenait dix pièces.
    const marches = [...new Set(documents.map((d) => d.marcheId).filter(Boolean))];
    for (const marcheId of marches) await recalculerPhase(marcheId);

    // Une trace pour le lot, avec le détail de ce qui est parti : c'est ce
    // qu'on voudra relire si une suppression groupée se révèle malheureuse.
    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'document.corbeille_lot',
        objetType: 'Document',
        objetId: documents[0].id,
        apres: { ids: documents.map((d) => d.id) },
        ip: requete.ip,
      },
      requete.log,
    );

    return { supprimes: documents.length, marches: marches.length };
  });

  app.post('/api/documents/:id/restaurer', reserve, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const d = await db.document.findFirst({ where: { id, supprimeLe: { not: null } } });
    if (!d) throw introuvable('Document');

    await db.document.update({ where: { id }, data: { supprimeLe: null } });
    if (d.marcheId) await recalculerPhase(d.marcheId);
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'document.restaure', objetType: 'Document', objetId: id, ip: requete.ip },
      requete.log,
    );
    return { ok: true };
  });
}
