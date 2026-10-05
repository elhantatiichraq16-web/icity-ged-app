/**
 * Le tableau de bord (§11, écran 1).
 *
 * Tous les chiffres sont calculés ICI, côté serveur (spécification, M03) :
 * si l'écran les recalculait à partir de données partielles, deux pages
 * afficheraient deux valeurs différentes, et plus personne ne saurait laquelle
 * croire.
 */
import { confidentialitesVisibles } from '@icity/commun/droits';
import { echeanceDe, estAppelOffres, etatEcheance, ORDRE_PHASES, phaseDe, piecesManquantes, PIECES_CYCLE } from '@icity/commun/marches';
import { db } from '../db.js';
import { EN_COURS, PIECES_HORS_ARCHIVES } from '../services/archivage.js';
import { exigerConnexion } from '../plugins/authentification.js';
import { codesParMarche, piecesParMarche } from '../services/phase-marche.js';

const nombre = (v) => (typeof v === 'bigint' ? Number(v) : (v ?? 0));

/** @param {import('fastify').FastifyInstance} app */
export default async function routesTableauBord(app) {
  app.addHook('preHandler', exigerConnexion);

  app.get('/api/tableau-bord', async (requete) => {
    const visibles = confidentialitesVisibles(requete.utilisateur.role.code);
    // Le tableau de bord parle de l'activité en cours : les marchés archivés
    // et leurs pièces n'y comptent plus (ils restent dans « Archives »).
    const filtreDocuments = { supprimeLe: null, confidentialite: { in: visibles }, ...PIECES_HORS_ARCHIVES };

    const [marches, pieces, codes, totalDocuments, rattaches, pagesTotal, parType, parMois, activite, aClasser, enCorbeille] = await Promise.all([
      db.marche.findMany({ where: EN_COURS, include: { client: { select: { id: true, nom: true } } } }),
      piecesParMarche(),
      codesParMarche(),
      db.document.count({ where: filtreDocuments }),
      db.document.count({ where: { ...filtreDocuments, marcheId: { not: null } } }),
      db.document.aggregate({ where: filtreDocuments, _sum: { pages: true } }),
      db.document.groupBy({ by: ['typeDocumentId'], where: filtreDocuments, _count: { _all: true } }),
      db.$queryRaw`
        SELECT to_char(cree_le, 'YYYY-MM') AS mois, COUNT(*) AS n
          FROM documents WHERE supprime_le IS NULL
         GROUP BY mois ORDER BY mois DESC LIMIT 12`,
      db.journal.findMany({
        where: { action: { notIn: ['connexion', 'deconnexion', 'connexion.echec'] } },
        include: { utilisateur: { select: { nom: true } } },
        orderBy: { creeLe: 'desc' },
        take: 12,
      }),
      db.document.count({ where: { ...filtreDocuments, OR: [{ marcheId: null }, { typeDocumentId: null }, { clientId: null }] } }),
      db.document.count({ where: { supprimeLe: { not: null } } }),
    ]);

    // ── Les marchés, avec leur phase et ce qui leur manque ──
    // Les appels d'offres non gagnés sont comptés à part : ils n'ont ni phase,
    // ni pièce manquante, ni ordre de service à attendre.
    const appelsOffres = marches.filter((m) => estAppelOffres(codes.get(m.id) ?? [], m.statutAffaire));
    const idsAppelsOffres = new Set(appelsOffres.map((m) => m.id));
    const vus = marches.filter((m) => !idsAppelsOffres.has(m.id)).map((m) => {
      const p = pieces.get(m.id) ?? {};
      const phase = phaseDe(p);
      const echeance = echeanceDe(m);
      return {
        id: m.id,
        reference: m.reference,
        lot: m.lot,
        client: m.client?.nom ?? null,
        clientId: m.clientId,
        phase,
        manquantes: piecesManquantes(p, phase),
        echeance,
        etatEcheance: etatEcheance(echeance, phase),
      };
    });

    const parPhase = Object.fromEntries(ORDRE_PHASES.map((p) => [p, vus.filter((m) => m.phase === p).length]));
    const incomplets = vus.filter((m) => m.manquantes.length > 0);
    const cautions = vus.filter((m) => m.phase === 'caution');

    // ── Alertes (§11) ──
    const alertes = [
      ...vus
        .filter((m) => m.etatEcheance === 'depassee')
        .map((m) => ({ ton: 'alerte', marcheId: m.id, reference: m.reference, message: `échéance dépassée le ${m.echeance}` })),
      ...vus
        .filter((m) => m.etatEcheance === 'proche')
        .map((m) => ({ ton: 'attente', marcheId: m.id, reference: m.reference, message: `échéance le ${m.echeance}` })),
      ...cautions.map((m) => ({ ton: 'attente', marcheId: m.id, reference: m.reference, message: 'caution non restituée : réception définitive sans mainlevée' })),
      ...vus
        .filter((m) => m.phase === 'attente')
        .slice(0, 5)
        .map((m) => ({ ton: 'info', marcheId: m.id, reference: m.reference, message: "en attente d'ordre de service" })),
    ];

    // ── Graphiques ──
    const types = await db.typeDocument.findMany();
    const nomType = new Map(types.map((t) => [t.id, t.nom]));
    const nomClient = new Map(marches.filter((m) => m.client).map((m) => [m.clientId, m.client.nom]));
    const parClient = new Map();
    for (const m of vus) parClient.set(m.clientId ?? null, (parClient.get(m.clientId ?? null) ?? 0) + 1);

    return {
      tuiles: {
        marchesTotal: vus.length,
        appelsOffres: appelsOffres.length,
        parPhase,
        incomplets: incomplets.length,
        cautions: cautions.length,
        documents: totalDocuments,
        pages: nombre(pagesTotal._sum.pages),
        rattaches,
        // Le taux de rattachement : la part des pièces qui appartiennent à une
        // affaire. C'est la mesure de santé du fonds.
        tauxRattachement: totalDocuments ? Math.round((rattaches / totalDocuments) * 100) : 0,
        aClasser,
        corbeille: enCorbeille,
      },
      alertes: alertes.slice(0, 12),
      graphiques: {
        natureDesPieces: parType
          .map((t) => ({ nom: t.typeDocumentId ? (nomType.get(t.typeDocumentId) ?? '—') : 'Sans type', n: t._count._all }))
          .sort((a, b) => b.n - a.n)
          .slice(0, 10),
        piecesManquantes: incomplets
          .map((m) => ({ nom: m.reference, n: m.manquantes.length, detail: m.manquantes.map((c) => PIECES_CYCLE.find((p) => p.cle === c).titre).join(', ') }))
          .sort((a, b) => b.n - a.n)
          .slice(0, 10),
        marchesParClient: [...parClient]
          .map(([clientId, n]) => ({ nom: clientId ? (nomClient.get(clientId) ?? '—') : 'Sans client', n }))
          .sort((a, b) => b.n - a.n)
          .slice(0, 8),
        versementsParMois: parMois.map((m) => ({ nom: m.mois, n: nombre(m.n) })).reverse(),
      },
      activite: activite.map((a) => ({
        id: a.id,
        action: a.action,
        objetType: a.objetType,
        objetId: a.objetId,
        commentaire: a.commentaire,
        par: a.utilisateur?.nom ?? 'système',
        creeLe: a.creeLe,
      })),
    };
  });
}
