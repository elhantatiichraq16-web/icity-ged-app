/**
 * Les deux files du tri (§9) : « À classer » et « À vérifier ».
 *
 * Le classement automatique écrit seul ce dont il est sûr, au versement puis
 * après chaque lecture (services/classement-auto.js). Ces files montrent ce
 * qu'il a laissé : il ne faut plus rien valider derrière lui, seulement
 * finir ce qu'il n'a pas pu faire — « une pièce non classée se voit ».
 *
 *  - À classer : les pièces sans marché ou sans type. La lecture y est
 *    montrée comme indice (référence citée, type reconnu, client probable),
 *    mais rien n'est écrit sans un clic.
 *  - À vérifier : ce qui demande un œil humain — doublons probables,
 *    lectures ratées, attestations dont le numéro ne se lit pas, affaires
 *    sans client.
 */
import { confidentialitesVisibles } from '@icity/commun/droits';
import { memeAffaire } from '@icity/commun/marches';
import { db } from '../db.js';
import { ErreurHttp, introuvable } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { analyser } from '../services/classement.js';
import { journaliser } from '../services/journal.js';

/** Au-delà, la file se traite par morceaux : l'écran reste léger. */
const LIMITE = 200;

/** Les pièces que cet utilisateur voit (confidentialité, ou ses dépôts). */
function visibles(utilisateur) {
  return { OR: [{ confidentialite: { in: confidentialitesVisibles(utilisateur.role.code) } }, { verseParId: utilisateur.id }] };
}

/**
 * Ce qui reste à classer : sans marché ou sans type, déjà lu, et que
 * personne n'a rangé à la main (une case laissée vide exprès n'y revient pas).
 *
 * Les attestations sans marché ont leur propre rubrique dans « À vérifier » :
 * souvent anciennes, elles citent des affaires jamais numérisées, et
 * noieraient ici les pièces récentes.
 */
export function filtreAClasser(utilisateur) {
  return {
    supprimeLe: null,
    statutClassement: { not: 'manuel' },
    // Une pièce en attente d'OCR sera classée après sa lecture : trop tôt.
    statutOcr: { notIn: ['en_attente', 'en_cours'] },
    OR: [{ marcheId: null }, { typeDocumentId: null }],
    NOT: { typeDocument: { code: 'ATT' } },
    AND: [visibles(utilisateur)],
  };
}

/** Les référentiels dont les indices ont besoin, chargés une fois par écran. */
async function contexteIndices() {
  const [clients, marches, types] = await Promise.all([
    db.client.findMany({ orderBy: [{ interne: 'asc' }, { nom: 'asc' }] }),
    db.marche.findMany({ select: { id: true, reference: true } }),
    db.typeDocument.findMany({ select: { id: true, code: true, nom: true } }),
  ]);
  return { clients, marches, types };
}

/**
 * Une pièce de file, avec les indices de sa lecture : ce qu'un humain
 * regarderait d'abord. Rien n'en est écrit sans son clic.
 */
function avecIndices(d, { clients, marches, types }) {
  const lecture = analyser(d, clients);
  const lu = lecture.lisible ? lecture.reference : null;
  const connu = lu ? marches.find((m) => memeAffaire(m.reference, lu.reference)) : null;
  const type = lecture.lisible && lecture.type ? types.find((t) => t.code === lecture.type.code) : null;
  return {
    ...petit(d),
    statutOcr: d.statutOcr,
    creeLe: d.creeLe,
    indices: {
      reference: lu ? { texte: lu.reference, citations: lu.citations, marche: connu ?? null } : null,
      type: type ?? null,
      client: lecture.lisible && lecture.client && !d.client ? { id: lecture.client.id, nom: lecture.client.nom } : null,
    },
  };
}

const petit = (d) => ({
  id: d.id,
  titre: d.titre,
  pages: d.pages,
  type: d.typeDocument ? { id: d.typeDocument.id, code: d.typeDocument.code, nom: d.typeDocument.nom } : null,
  marche: d.marche ? { id: d.marche.id, reference: d.marche.reference } : null,
  client: d.client ? { id: d.client.id, nom: d.client.nom } : null,
});

/** @param {import('fastify').FastifyInstance} app */
export default async function routesTri(app) {
  app.addHook('preHandler', exigerConnexion);
  const reserve = { preHandler: exiger('gerer', 'AVerifier') };

  // ── À classer ─────────────────────────────────────────────────
  app.get('/api/a-classer', reserve, async (requete) => {
    const where = filtreAClasser(requete.utilisateur);
    const [total, enLecture, pieces, contexte] = await Promise.all([
      db.document.count({ where }),
      db.document.count({ where: { supprimeLe: null, statutOcr: { in: ['en_attente', 'en_cours'] }, ...visibles(requete.utilisateur) } }),
      db.document.findMany({ where, include: { typeDocument: true, marche: true, client: true }, orderBy: [{ creeLe: 'desc' }, { id: 'desc' }], take: LIMITE }),
      contexteIndices(),
    ]);
    return { total, enLecture, pieces: pieces.map((d) => avecIndices(d, contexte)) };
  });

  // ── À vérifier ────────────────────────────────────────────────
  app.get('/api/a-verifier', reserve, async (requete) => {
    const vus = confidentialitesVisibles(requete.utilisateur.role.code);
    const cotes = { supprimeLe: null, confidentialite: { in: vus } };
    const avec = { typeDocument: true, marche: true, client: true };

    const [paires, lectures, attestations, affaires, aClasser, contexte] = await Promise.all([
      db.doublon.findMany({
        where: { decision: 'en_attente', documentA: cotes, documentB: cotes },
        include: { documentA: { include: avec }, documentB: { include: avec } },
        orderBy: { score: 'desc' },
        take: 100,
      }),
      db.document.findMany({
        where: { supprimeLe: null, statutOcr: { in: ['illisible', 'echec'] }, ...visibles(requete.utilisateur) },
        include: avec,
        orderBy: { creeLe: 'desc' },
        take: 100,
      }),
      db.document.findMany({
        where: { supprimeLe: null, marcheId: null, statutClassement: { not: 'manuel' }, typeDocument: { code: 'ATT' }, ...visibles(requete.utilisateur) },
        include: avec,
        orderBy: { id: 'asc' },
        take: 100,
      }),
      db.marche.findMany({ where: { clientId: null }, select: { id: true, reference: true, objet: true }, orderBy: { reference: 'asc' } }),
      db.document.count({ where: filtreAClasser(requete.utilisateur) }),
      contexteIndices(),
    ]);

    return {
      doublons: paires.map((p) => ({ id: p.id, score: p.score, raisons: p.raisons?.raisons ?? [], a: petit(p.documentA), b: petit(p.documentB) })),
      lectures: lectures.map((d) => ({ ...petit(d), statutOcr: d.statutOcr, ocrConfiance: d.ocrConfiance })),
      // Avec leurs indices : elles se rangent sur place, comme dans « À classer ».
      attestations: attestations.map((d) => avecIndices(d, contexte)),
      affairesSansClient: affaires,
      aClasser,
    };
  });

  /**
   * Relire une pièce dont la lecture a échoué, ou qui a été redressée : elle
   * retourne dans la file, et le worker la reprend à son prochain passage.
   * Un PDF qui porte déjà son texte n'est pas relu : l'OCR ferait moins bien.
   */
  app.post('/api/documents/:id/relire', reserve, async (requete) => {
    const d = await db.document.findFirst({ where: { id: Number(requete.params.id) || 0, supprimeLe: null, ...visibles(requete.utilisateur) } });
    if (!d) throw introuvable('Document');
    if (['en_attente', 'en_cours'].includes(d.statutOcr)) throw new ErreurHttp(409, 'Cette pièce est déjà dans la file de lecture.');
    if (d.statutOcr === 'non_necessaire') throw new ErreurHttp(422, 'Cette pièce porte déjà son texte : il n’y a rien à relire.');

    await db.document.update({ where: { id: d.id }, data: { statutOcr: 'en_attente', ocrPageCourante: null } });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'document.relecture', objetType: 'Document', objetId: d.id, ip: requete.ip }, requete.log);
    return { ok: true };
  });
}
