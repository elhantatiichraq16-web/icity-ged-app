/**
 * L'écran « À classer » (§7) : les propositions du classement automatique,
 * que l'utilisateur accepte ou corrige en un clic.
 *
 * Accepter écrit la valeur sur le document ET verrouille le champ : le
 * classement ne reviendra plus dessus. Refuser verrouille aussi — c'est une
 * décision, pas un oubli.
 */
import { z } from 'zod';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';
import { accepter, chargerReferentiels, enregistrerPropositions, proposerPour, refuser } from '../services/suggestions.js';

const LIBELLES = { marche: 'Marché', client: 'Client', type: 'Type de pièce', objet_technique: 'Objet technique' };

function vueSuggestion(s) {
  return {
    id: s.id,
    champ: s.champ,
    champLibelle: LIBELLES[s.champ] ?? s.champ,
    valeur: s.valeur,
    cibleId: s.cibleId,
    raison: s.raison,
    confiance: s.confiance,
    statut: s.statut,
    // « à créer » quand la référence lue ne correspond à aucun marché connu.
    creeUnMarche: s.champ === 'marche' && !s.cibleId,
    document: {
      id: s.document.id,
      titre: s.document.titre,
      type: s.document.typeDocument?.nom ?? null,
      marche: s.document.marche ? { id: s.document.marche.id, reference: s.document.marche.reference } : null,
      client: s.document.client?.nom ?? null,
      objetTechnique: s.document.objetTechnique,
    },
  };
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesSuggestions(app) {
  // Corriger le classement est le métier du responsable documentaire (§8).
  const reserve = { preHandler: exiger('modifier', 'Document') };

  app.get('/api/suggestions', reserve, async (requete) => {
    const { champ, statut = 'en_attente' } = requete.query;
    const where = { statut: String(statut), ...(champ ? { champ: String(champ) } : {}), document: { supprimeLe: null } };

    const [suggestions, parChamp] = await Promise.all([
      db.suggestion.findMany({
        where,
        include: { document: { include: { typeDocument: true, marche: true, client: true } } },
        orderBy: [{ confiance: 'desc' }, { id: 'asc' }],
        take: 300,
      }),
      db.suggestion.groupBy({ by: ['champ'], where: { statut: 'en_attente' }, _count: { _all: true } }),
    ]);

    return {
      suggestions: suggestions.map(vueSuggestion),
      compteurs: Object.fromEntries(parChamp.map((c) => [c.champ, c._count._all])),
    };
  });

  /** Relance le classement sur tout le fonds (bouton « Relancer le classement »). */
  app.post('/api/suggestions/relancer', reserve, async (requete) => {
    const referentiels = await chargerReferentiels();
    const documents = await db.document.findMany({
      where: { supprimeLe: null, texteOcr: { not: null } },
      select: { id: true, texteOcr: true, marcheId: true, clientId: true, typeDocumentId: true, objetTechnique: true, champsVerrouilles: true },
    });
    let total = 0;
    for (const document of documents) {
      const { propositions } = proposerPour(document, referentiels);
      total += await enregistrerPropositions(document.id, propositions);
    }
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'classement.relance', commentaire: `${total} propositions`, ip: requete.ip }, requete.log);
    return { propositions: total, documents: documents.length };
  });

  app.post('/api/suggestions/:id/:decision', reserve, async (requete) => {
    const { decision } = valider(z.object({ decision: z.enum(['accepter', 'refuser']) }), requete.params);
    const suggestion = await db.suggestion.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!suggestion) throw introuvable('Proposition');
    if (suggestion.statut !== 'en_attente') throw new ErreurHttp(409, 'Cette proposition a déjà été tranchée.');

    if (decision === 'accepter') await accepter(suggestion, requete.utilisateur.id);
    else await refuser(suggestion, requete.utilisateur.id);

    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: `classement.${decision === 'accepter' ? 'accepte' : 'refuse'}`,
        objetType: 'Document',
        objetId: suggestion.documentId,
        apres: { champ: suggestion.champ, valeur: suggestion.valeur },
        ip: requete.ip,
      },
      requete.log,
    );
    return { ok: true };
  });

  /** Accepte d'un coup toutes les propositions d'un champ au-dessus d'un seuil. */
  app.post('/api/suggestions/accepter-lot', reserve, async (requete) => {
    const { champ, confianceMinimale } = valider(
      z.object({ champ: z.enum(['marche', 'client', 'type', 'objet_technique']).optional(), confianceMinimale: z.number().int().min(0).max(100).default(80) }),
      requete.body,
    );
    const suggestions = await db.suggestion.findMany({
      where: { statut: 'en_attente', confiance: { gte: confianceMinimale }, ...(champ ? { champ } : {}), document: { supprimeLe: null } },
      orderBy: { confiance: 'desc' },
    });
    for (const s of suggestions) await accepter(s, requete.utilisateur.id);
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'classement.accepte_lot', commentaire: `${suggestions.length} propositions (confiance ≥ ${confianceMinimale})`, ip: requete.ip },
      requete.log,
    );
    return { acceptees: suggestions.length };
  });
}
