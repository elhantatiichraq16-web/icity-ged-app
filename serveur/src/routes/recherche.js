/**
 * La recherche globale (§11, écran 5) et la recherche rapide de Ctrl+K.
 */
import { confidentialitesVisibles } from '@icity/commun/droits';
import { db } from '../db.js';
import { exigerConnexion } from '../plugins/authentification.js';
import { chercher } from '../services/recherche.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function routesRecherche(app) {
  app.addHook('preHandler', exigerConnexion);

  app.get('/api/recherche', async (requete) => {
    const { q = '', marcheId, clientId, typeId, annee, page = '1' } = requete.query;
    const documents = await chercher({
      q: String(q),
      confidentialites: confidentialitesVisibles(requete.utilisateur.role.code),
      utilisateurId: requete.utilisateur.id,
      marcheId,
      clientId,
      typeId,
      annee,
      page: Number(page) || 1,
    });

    // Les marchés se cherchent sur leur référence et leur objet : ils n'ont
    // pas de texte OCR, mais c'est souvent eux que l'on veut ouvrir.
    const marches = String(q).trim().length >= 2
      ? await db.marche.findMany({
          where: { OR: [{ reference: { contains: String(q) } }, { objet: { contains: String(q) } }, { client: { nom: { contains: String(q) } } }] },
          include: { client: true },
          take: 5,
        })
      : [];

    return {
      ...documents,
      // Les marchés archivés aussi : la recherche voit tout le fonds.
      marches: marches.map((m) => ({ id: m.id, reference: m.reference, objet: m.objet, phase: m.phase, client: m.client?.nom ?? null, archive: Boolean(m.archiveLe) })),
    };
  });
}
