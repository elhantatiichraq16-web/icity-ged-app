/**
 * L'écran « À vérifier » (§9) : doublons probables, pièces incomplètes,
 * rescans, attestations orphelines, et corbeille.
 *
 * Rien n'est supprimé pour de bon : la corbeille garde trente jours, et avant
 * d'écarter une pièce on reporte ses étiquettes et son marché sur celle qu'on
 * garde — sinon on perdrait un rattachement en croyant faire le ménage.
 */
import { z } from 'zod';
import { confidentialitesVisibles } from '@icity/commun/droits';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';
import { recalculerPhase } from '../services/phase-marche.js';

const JOURS_CORBEILLE = 30;

const AVEC = { typeDocument: true, marche: true, client: true, etiquettes: { include: { etiquette: true } } };

function vueDocument(d) {
  return {
    id: d.id,
    titre: d.titre,
    nomOrigine: d.nomOrigine,
    pages: d.pages,
    type: d.typeDocument?.nom ?? null,
    marche: d.marche ? { id: d.marche.id, reference: d.marche.reference } : null,
    client: d.client?.nom ?? null,
    lotScan: d.lotScan,
    pageScan: d.pageScan,
    supprimeLe: d.supprimeLe,
    etiquettes: (d.etiquettes ?? []).map((e) => e.etiquette.nom),
  };
}

/** @param {import('fastify').FastifyInstance} app */
/** Les identifiants d'un lot : assez pour une page, pas pour tout le fonds. */
const schemaLot = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'Choisissez au moins une pièce.').max(200),
});

export default async function routesAVerifier(app) {
  const reserve = { preHandler: exiger('gerer', 'AVerifier') };

  // ── Les paires à arbitrer ─────────────────────────────────────
  app.get('/api/doublons', reserve, async () => {
    const paires = await db.doublon.findMany({
      where: { decision: 'en_attente', documentA: { supprimeLe: null }, documentB: { supprimeLe: null } },
      include: { documentA: { include: AVEC }, documentB: { include: AVEC } },
      orderBy: { score: 'desc' },
      take: 100,
    });
    return paires.map((p) => ({
      id: p.id,
      score: p.score,
      raisons: p.raisons?.raisons ?? [],
      ecarts: p.raisons?.ecarts ?? [],
      a: vueDocument(p.documentA),
      b: vueDocument(p.documentB),
    }));
  });

  app.post('/api/doublons/:id/decision', reserve, async (requete) => {
    const { decision, garderId } = valider(
      z.object({ decision: z.enum(['gardes', 'supprime']), garderId: z.number().int().positive().optional() }),
      requete.body,
    );
    const paire = await db.doublon.findUnique({ where: { id: Number(requete.params.id) || 0 }, include: { documentA: true, documentB: true } });
    if (!paire) throw introuvable('Paire');
    if (paire.decision !== 'en_attente') throw new ErreurHttp(409, 'Cette paire a déjà été tranchée.');

    if (decision === 'supprime') {
      const garde = garderId === paire.documentBId ? paire.documentB : paire.documentA;
      const ecarte = garde.id === paire.documentAId ? paire.documentB : paire.documentA;

      // Avant d'écarter : on reporte le marché, le client, le type et les
      // étiquettes sur la pièce gardée (§9). Sans cela, un rattachement
      // disparaîtrait avec la copie.
      const reports = {};
      if (!garde.marcheId && ecarte.marcheId) reports.marcheId = ecarte.marcheId;
      if (!garde.clientId && ecarte.clientId) reports.clientId = ecarte.clientId;
      if (!garde.typeDocumentId && ecarte.typeDocumentId) reports.typeDocumentId = ecarte.typeDocumentId;
      if (Object.keys(reports).length) await db.document.update({ where: { id: garde.id }, data: reports });

      const etiquettes = await db.documentEtiquette.findMany({ where: { documentId: ecarte.id } });
      if (etiquettes.length) {
        await db.documentEtiquette.createMany({
          data: etiquettes.map((e) => ({ documentId: garde.id, etiquetteId: e.etiquetteId })),
          skipDuplicates: true,
        });
      }

      // Suppression douce : la pièce part en corbeille, pour trente jours.
      await db.document.update({ where: { id: ecarte.id }, data: { supprimeLe: new Date() } });
      if (ecarte.marcheId) await recalculerPhase(ecarte.marcheId);
      const marcheGarde = garde.marcheId ?? reports.marcheId;
      if (marcheGarde) await recalculerPhase(marcheGarde);

      await journaliser(
        {
          utilisateurId: requete.utilisateur.id,
          action: 'doublon.ecarte',
          objetType: 'Document',
          objetId: ecarte.id,
          commentaire: `doublon de « ${garde.titre} » (${paire.score} %), mis en corbeille`,
          ip: requete.ip,
        },
        requete.log,
      );
    } else {
      await journaliser(
        {
          utilisateurId: requete.utilisateur.id,
          action: 'doublon.gardes',
          objetType: 'Document',
          objetId: paire.documentAId,
          commentaire: `paire ${paire.id} : les deux pièces sont conservées`,
          ip: requete.ip,
        },
        requete.log,
      );
    }

    await db.doublon.update({
      where: { id: paire.id },
      data: { decision: decision === 'supprime' ? 'supprime_b' : 'gardes', decidePar: requete.utilisateur.id, decideLe: new Date() },
    });
    return { ok: true };
  });

  // ── Ce qui reste à rattacher ──────────────────────────────────
  app.get('/api/a-verifier', reserve, async (requete) => {
    const visibles = confidentialitesVisibles(requete.utilisateur.role.code);
    const commun = { supprimeLe: null, confidentialite: { in: visibles } };

    const [sansMarche, sansType, sansClient, rescans, orphelines, doublons, corbeille] = await Promise.all([
      db.document.count({ where: { ...commun, marcheId: null } }),
      db.document.count({ where: { ...commun, typeDocumentId: null } }),
      db.document.count({ where: { ...commun, clientId: null } }),
      db.document.count({ where: { ...commun, etiquettes: { some: { etiquette: { nom: 'Rescan à arbitrer' } } } } }),
      db.document.count({ where: { ...commun, etiquettes: { some: { etiquette: { nom: 'Contrat manquant' } } } } }),
      db.doublon.count({ where: { decision: 'en_attente' } }),
      db.document.count({ where: { supprimeLe: { not: null } } }),
    ]);

    const file = String(requete.query.file ?? 'sans_marche');
    const filtres = {
      sans_marche: { ...commun, marcheId: null },
      sans_type: { ...commun, typeDocumentId: null },
      sans_client: { ...commun, clientId: null },
      rescans: { ...commun, etiquettes: { some: { etiquette: { nom: 'Rescan à arbitrer' } } } },
      orphelines: { ...commun, etiquettes: { some: { etiquette: { nom: 'Contrat manquant' } } } },
    };

    const documents = await db.document.findMany({
      where: filtres[file] ?? filtres.sans_marche,
      include: AVEC,
      orderBy: { creeLe: 'desc' },
      take: 100,
    });

    return {
      compteurs: { sansMarche, sansType, sansClient, rescans, orphelines, doublons, corbeille },
      documents: documents.map(vueDocument),
    };
  });

  // ── Corbeille (§9) ────────────────────────────────────────────
  app.get('/api/corbeille', reserve, async () => {
    const documents = await db.document.findMany({ where: { supprimeLe: { not: null } }, include: AVEC, orderBy: { supprimeLe: 'desc' }, take: 200 });
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
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'document.corbeille', objetType: 'Document', objetId: id, ip: requete.ip }, requete.log);
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
    // s'évalue donc pas là. Sans ce filtre, un responsable documentaire
    // effacerait deux cents pièces qu'il ne peut même pas ouvrir.
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
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'document.restaure', objetType: 'Document', objetId: id, ip: requete.ip }, requete.log);
    return { ok: true };
  });
}
