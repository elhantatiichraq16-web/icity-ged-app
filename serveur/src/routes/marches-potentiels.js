/**
 * Les marchés potentiels : la veille des appels d'offres publiés par des
 * sources externes, leur tri par l'équipe, et leur conversion en affaire.
 *
 * Toute collecte se fait ICI, côté serveur (jamais depuis le navigateur), à
 * travers services/veille/recuperation.js : HTTPS, pas de réseau local,
 * délais et tailles limités. Les droits viennent de commun/droits.js :
 * lire / gerer / convertir « MarchePotentiel », gerer « SourceMarche » et
 * « CriteresMarches ».
 */
import { z } from 'zod';
import { STATUTS_AFFAIRE } from '@icity/commun/marches';
import {
  CODES_STATUTS_OFFRES,
  schemaAlertesOffres,
  schemaCriteres,
  schemaOffreManuelle,
  schemaSource,
  schemaSuiviOffre,
  STATUTS_OUVERTS,
} from '@icity/commun/marches-potentiels';
import { db } from '../db.js';
import { ErreurHttp, interdit, introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { chiffrer } from '../securite/crypto.js';
import { journaliser } from '../services/journal.js';
import { abonner } from '../services/notifications.js';
import { actualiserOffre, apercuAdresse, creerOffreManuelle, importerCsv, importerDocument } from '../services/veille/actions.js';
import { connecteurDe } from '../services/veille/connecteurs/index.js';
import { assurerInitialisation, chargerCriteres, recalculerScores } from '../services/veille/offres.js';
import { recupererPour, synchroniserSource, synchroniserTout } from '../services/veille/synchronisation.js';
import { fuseauMaroc } from '../services/veille/normalisation.js';
import { verifierUrl } from '../services/veille/recuperation.js';
import { cleDeReference } from './marches.js';

const jour = (d) => (d ? d.toISOString().slice(0, 10) : null);
const nombre = (d) => (d === null || d === undefined ? null : Number(d));

/** Pas plus de 6 synchronisations ou lectures d'annonce par minute et par personne. */
const limiteCollecte = { rateLimit: { max: 6, timeWindow: '1 minute', errorResponseBuilder: (_r, c) => ({ statusCode: 429, message: `Trop de demandes vers les sources externes. Réessayez dans ${Math.ceil(c.ttl / 1000)} s.` }) } };

const AVEC_LISTE = {
  source: { select: { id: true, nom: true } },
  responsable: { select: { id: true, nom: true } },
};

/** Une offre dans une liste. */
function vueOffre(o, favoris = new Set(), maintenant = new Date()) {
  const restant = o.dateLimite ? Math.ceil((o.dateLimite.getTime() - maintenant.getTime()) / 86_400_000) : null;
  return {
    id: o.id,
    reference: o.reference,
    objet: o.objet,
    acheteur: o.acheteur,
    categorie: o.categorie,
    lieu: o.lieu,
    procedure: o.procedure,
    datePublication: jour(o.datePublication),
    dateLimite: o.dateLimite?.toISOString() ?? null,
    joursRestants: restant,
    estimation: nombre(o.estimation),
    score: o.score,
    statut: o.statut,
    source: o.source,
    responsable: o.responsable,
    favori: favoris.has(o.id),
    marcheId: o.marcheId,
    urlOfficielle: o.urlOfficielle,
  };
}

/** Une offre, avec tout ce que sa fiche montre. */
function vueFiche(o, favori) {
  return {
    ...vueOffre(o, new Set(favori ? [o.id] : [])),
    resume: o.resume,
    domaines: o.domaines ?? [],
    caution: nombre(o.caution),
    lots: o.lots ?? [],
    reponseElectronique: o.reponseElectronique,
    documents: o.documents ?? [],
    premiereDetection: o.premiereDetection,
    derniereVerification: o.derniereVerification,
    disparueLe: o.disparueLe,
    statutExterne: o.statutExterne,
    raisonsScore: o.raisonsScore ?? [],
    motsCles: o.motsCles ?? [],
    notes: o.notes,
    archiveLe: o.archiveLe,
    convertieLe: o.convertieLe,
    marche: o.marche ? { id: o.marche.id, reference: o.marche.reference } : null,
    idExterne: o.idExterne,
  };
}

/** Une source, sans jamais ses secrets. */
function vueSource(s, nbOffres = 0) {
  const { secrets, ...reste } = s;
  return { ...reste, aDesSecrets: Boolean(secrets), nbOffres, connecteurAutomatique: Boolean(connecteurDe(s.connecteur)?.automatique) };
}

/** Le filtre Prisma des paramètres de la liste. */
function filtreListe(q, moi, maintenant) {
  const et = [];
  const texte = String(q.q ?? '').trim();
  if (texte) et.push({ OR: ['objet', 'reference', 'acheteur', 'lieu', 'resume'].map((c) => ({ [c]: { contains: texte, mode: 'insensitive' } })) });
  if (q.sourceId) et.push({ sourceId: Number(q.sourceId) || 0 });
  if (q.scoreMin) et.push({ score: { gte: Number(q.scoreMin) || 0 } });
  const statuts = String(q.statut ?? '').split(',').filter((s) => CODES_STATUTS_OFFRES.includes(s));
  if (statuts.length) et.push({ statut: { in: statuts } });
  else if (q.archives !== '1') et.push({ statut: { not: 'archivee' } });
  if (q.domaine) et.push({ OR: [{ categorie: { contains: String(q.domaine), mode: 'insensitive' } }, { objet: { contains: String(q.domaine), mode: 'insensitive' } }] });
  if (q.acheteur) et.push({ acheteur: { contains: String(q.acheteur), mode: 'insensitive' } });
  if (q.lieu) et.push({ lieu: { contains: String(q.lieu), mode: 'insensitive' } });
  const borne = (v, fin) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? new Date(`${v}T${fin ? '23:59:59' : '00:00:00'}+01:00`) : null);
  if (borne(q.publieDepuis)) et.push({ datePublication: { gte: borne(q.publieDepuis) } });
  if (borne(q.publieAvant, true)) et.push({ datePublication: { lte: borne(q.publieAvant, true) } });
  if (borne(q.limiteDepuis)) et.push({ dateLimite: { gte: borne(q.limiteDepuis) } });
  if (borne(q.limiteAvant, true)) et.push({ dateLimite: { lte: borne(q.limiteAvant, true) } });
  if (q.nonExpirees === '1') et.push({ statut: { not: 'expiree' }, OR: [{ dateLimite: null }, { dateLimite: { gte: maintenant } }] });
  if (q.responsableId) et.push({ responsableId: q.responsableId === 'moi' ? moi : Number(q.responsableId) || 0 });
  if (q.favoris === '1') et.push({ favoris: { some: { utilisateurId: moi } } });
  return et.length ? { AND: et } : {};
}

const TRIS = {
  pertinence: [{ score: 'desc' }, { dateLimite: { sort: 'asc', nulls: 'last' } }],
  publication: [{ datePublication: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
  limite: [{ dateLimite: { sort: 'asc', nulls: 'last' } }, { score: 'desc' }],
  acheteur: [{ acheteur: { sort: 'asc', nulls: 'last' } }, { score: 'desc' }],
  source: [{ sourceId: 'asc' }, { score: 'desc' }],
};

/** Ce qui change entre deux états d'une offre, pour le journal (et le fil). */
function difference(avant, apres) {
  const a = {};
  const b = {};
  for (const [cle, valeur] of Object.entries(apres)) {
    if (valeur === undefined || JSON.stringify(avant[cle] ?? null) === JSON.stringify(valeur ?? null)) continue;
    a[cle] = avant[cle] ?? null;
    b[cle] = valeur;
  }
  return { avant: a, apres: b };
}

/** Le secret d'une source : un objet JSON d'en-têtes, chiffré. */
function secretsChiffres(texte) {
  let valeur;
  try {
    valeur = JSON.parse(texte);
  } catch {
    throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { secrets: 'Un objet JSON d’en-têtes, par exemple {"Authorization": "Bearer …"}.' } });
  }
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { secrets: 'Un objet JSON d’en-têtes.' } });
  return chiffrer(JSON.stringify(valeur));
}

/** Les adresses d'une source doivent passer la vérification avant d'être enregistrées. */
function verifierAdressesSource(donnees) {
  for (const champ of ['siteWeb', 'adresse']) {
    if (!donnees[champ]) continue;
    try {
      verifierUrl(donnees[champ], { autoriserHttp: donnees.autoriserHttp });
    } catch (e) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { [champ]: e.message } });
    }
  }
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesMarchesPotentiels(app) {
  app.addHook('preHandler', exigerConnexion);
  const lire = { preHandler: exiger('lire', 'MarchePotentiel') };
  const gerer = { preHandler: exiger('gerer', 'MarchePotentiel') };
  const gererSources = { preHandler: exiger('gerer', 'SourceMarche') };

  async function offreOu404(requete, include = AVEC_LISTE) {
    const o = await db.offrePotentielle.findUnique({ where: { id: Number(requete.params.id) || 0 }, include });
    if (!o) throw introuvable('Offre');
    return o;
  }

  // ── Les offres ────────────────────────────────────────────────

  app.get('/api/marches-potentiels', lire, async (requete) => {
    await assurerInitialisation();
    const maintenant = new Date();
    const moi = requete.utilisateur.id;
    const where = filtreListe(requete.query, moi, maintenant);
    const taille = Math.min(Math.max(Number(requete.query.taille) || 50, 1), 500);
    const page = Math.max(Number(requete.query.page) || 1, 1);
    const [offres, total, favoris] = await Promise.all([
      db.offrePotentielle.findMany({ where, include: AVEC_LISTE, orderBy: TRIS[requete.query.tri] ?? TRIS.pertinence, skip: (page - 1) * taille, take: taille }),
      db.offrePotentielle.count({ where }),
      db.favoriOffre.findMany({ where: { utilisateurId: moi }, select: { offreId: true } }),
    ]);
    const mesFavoris = new Set(favoris.map((f) => f.offreId));
    return { offres: offres.map((o) => vueOffre(o, mesFavoris, maintenant)), total, page, taille };
  });

  /** Les chiffres du haut de l'écran, et l'état des synchronisations. */
  app.get('/api/marches-potentiels/resume', lire, async () => {
    await assurerInitialisation();
    const maintenant = new Date();
    const { seuil } = await chargerCriteres();
    const ouvertes = { statut: { in: STATUTS_OUVERTS } };
    const [nouvelles, pertinentes, echeances, aEtudier, sources] = await Promise.all([
      db.offrePotentielle.count({ where: { statut: 'nouvelle' } }),
      db.offrePotentielle.count({ where: { ...ouvertes, score: { gte: seuil } } }),
      db.offrePotentielle.count({ where: { ...ouvertes, dateLimite: { gte: maintenant, lte: new Date(maintenant.getTime() + 7 * 86_400_000) } } }),
      db.offrePotentielle.count({ where: { statut: 'a_etudier' } }),
      db.sourceMarches.findMany({ select: { id: true, nom: true, active: true, connecteur: true, derniereSyncLe: true, derniereSyncEtat: true, derniereSyncResume: true }, orderBy: { id: 'asc' } }),
    ]);
    const derniere = sources.filter((s) => s.derniereSyncLe).sort((a, b) => b.derniereSyncLe - a.derniereSyncLe)[0] ?? null;
    return { nouvelles, pertinentes, echeances, aEtudier, seuil, sources, derniereSynchronisation: derniere, sourcesActives: sources.filter((s) => s.active).length };
  });

  app.get('/api/marches-potentiels/:id', lire, async (requete) => {
    const o = await offreOu404(requete, { ...AVEC_LISTE, marche: { select: { id: true, reference: true } } });
    const favori = await db.favoriOffre.findUnique({ where: { utilisateurId_offreId: { utilisateurId: requete.utilisateur.id, offreId: o.id } } });
    return vueFiche(o, Boolean(favori));
  });

  /** Statut, responsable, notes : le suivi de l'équipe. */
  app.patch('/api/marches-potentiels/:id', gerer, async (requete) => {
    const avant = await offreOu404(requete);
    const donnees = valider(schemaSuiviOffre, requete.body ?? {});
    if (avant.statut === 'convertie' && donnees.statut && donnees.statut !== 'archivee') {
      throw new ErreurHttp(409, 'Cette offre est déjà convertie en marché : elle ne peut plus changer de statut, seulement être archivée.');
    }
    if (donnees.responsableId && !(await db.utilisateur.findFirst({ where: { id: donnees.responsableId, actif: true } }))) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { responsableId: 'Ce compte n’est pas actif.' } });
    }
    const { avant: a, apres: b } = difference(avant, donnees);
    if (!Object.keys(b).length) return vueOffre(avant);
    const apres = await db.offrePotentielle.update({
      where: { id: avant.id },
      data: { ...b, ...(b.statut === 'archivee' ? { archiveLe: new Date() } : b.statut ? { archiveLe: null } : {}) },
      include: AVEC_LISTE,
    });
    if (b.responsableId) await abonner(b.responsableId, 'OffrePotentielle', avant.id);
    await abonner(requete.utilisateur.id, 'OffrePotentielle', avant.id);
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'offre.modifiee', objetType: 'OffrePotentielle', objetId: avant.id, avant: a, apres: b, ip: requete.ip }, requete.log);
    return vueOffre(apres);
  });

  /** Ajouter ou retirer des favoris (chacun les siens). */
  app.post('/api/marches-potentiels/:id/favori', lire, async (requete) => {
    const o = await offreOu404(requete);
    const { favori } = valider(z.object({ favori: z.boolean() }), requete.body ?? {});
    const cle = { utilisateurId: requete.utilisateur.id, offreId: o.id };
    if (favori) await db.favoriOffre.upsert({ where: { utilisateurId_offreId: cle }, update: {}, create: cle });
    else await db.favoriOffre.deleteMany({ where: cle });
    return { favori };
  });

  /** Relire l'annonce officielle de l'offre. */
  app.post('/api/marches-potentiels/:id/actualiser', { ...gerer, config: limiteCollecte }, async (requete) => {
    const o = await offreOu404(requete);
    let apres;
    try {
      apres = await actualiserOffre(o);
    } catch (e) {
      throw new ErreurHttp(502, e.message);
    }
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'offre.actualisee', objetType: 'OffrePotentielle', objetId: o.id, ip: requete.ip }, requete.log);
    return { ok: true, derniereVerification: apres.derniereVerification };
  });

  /** Verser dans la GED un document public de l'offre (après confirmation à l'écran). */
  app.post('/api/marches-potentiels/:id/documents', { preHandler: [exiger('gerer', 'MarchePotentiel'), exiger('verser', 'Document')], config: limiteCollecte }, async (requete, reponse) => {
    const o = await offreOu404(requete);
    const { url } = valider(z.object({ url: z.url() }), requete.body ?? {});
    let resultat;
    try {
      resultat = await importerDocument(o, url, { utilisateurId: requete.utilisateur.id });
    } catch (e) {
      throw new ErreurHttp(422, e.message);
    }
    if (!resultat.cree) return reponse.code(409).send({ message: `Ce document est déjà dans la GED : « ${resultat.document.titre} ».`, documentId: resultat.document.id });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'offre.document_importe', objetType: 'OffrePotentielle', objetId: o.id, apres: { url, documentId: resultat.document.id }, ip: requete.ip }, requete.log);
    return reponse.code(201).send({ documentId: resultat.document.id, titre: resultat.document.titre });
  });

  // ── Importer une offre à la main ──────────────────────────────

  /** Lire l'annonce d'une adresse pour pré-remplir le formulaire (une page, à la demande). */
  app.post('/api/marches-potentiels/apercu', { ...gerer, config: limiteCollecte }, async (requete) => {
    const { url } = valider(z.object({ url: z.url({ error: 'Collez l’adresse complète de l’annonce.' }) }), requete.body ?? {});
    try {
      return await apercuAdresse(url);
    } catch (e) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { url: e.message } });
    }
  });

  app.post('/api/marches-potentiels', gerer, async (requete, reponse) => {
    const donnees = valider(schemaOffreManuelle, requete.body ?? {});
    try {
      verifierUrl(donnees.urlOfficielle);
    } catch (e) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { urlOfficielle: e.message } });
    }
    const { offre, creee } = await creerOffreManuelle(donnees);
    await abonner(requete.utilisateur.id, 'OffrePotentielle', offre.id);
    await journaliser({ utilisateurId: requete.utilisateur.id, action: creee ? 'offre.importee' : 'offre.completee', objetType: 'OffrePotentielle', objetId: offre.id, ip: requete.ip }, requete.log);
    return reponse.code(creee ? 201 : 200).send({ id: offre.id, creee });
  });

  /** Synchroniser maintenant toutes les sources actives. */
  app.post('/api/marches-potentiels/synchroniser', { ...gerer, config: limiteCollecte }, async (requete) => {
    const actives = await db.sourceMarches.count({ where: { active: true } });
    if (!actives) throw new ErreurHttp(409, 'Aucune source active : activez une source dans Paramètres → Sources de marchés, ou importez des offres.');
    return synchroniserTout({ forcer: true, utilisateurId: requete.utilisateur.id, log: requete.log });
  });

  // ── La conversion en marché ───────────────────────────────────

  /** Ce que l'écran de conversion propose, à corriger avant de valider. */
  app.get('/api/marches-potentiels/:id/conversion', { preHandler: exiger('convertir', 'MarchePotentiel') }, async (requete) => {
    const o = await offreOu404(requete);
    const client = o.acheteur ? await db.client.findFirst({ where: { nom: { equals: o.acheteur, mode: 'insensitive' } } }) : null;
    const mots = (o.acheteur ?? '').split(/[\s\-/,]+/).filter((m) => m.length > 4).slice(0, 3);
    const suggestions = client ? [] : mots.length ? await db.client.findMany({ where: { OR: mots.map((m) => ({ nom: { contains: m, mode: 'insensitive' } })) }, take: 6, orderBy: { nom: 'asc' } }) : [];
    const date = o.dateLimite ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: fuseauMaroc(o.dateLimite) }).format(o.dateLimite) : null;
    return {
      dejaConvertie: Boolean(o.marcheId),
      marcheId: o.marcheId,
      proposition: {
        reference: o.reference ?? '',
        objet: o.objet.slice(0, 255),
        clientId: client?.id ?? null,
        nouveauClient: client ? '' : (o.acheteur ?? ''),
        ville: o.lieu?.slice(0, 80) ?? '',
        montantTtc: nombre(o.estimation),
        statutAffaire: 'AO en préparation',
        responsableId: o.responsableId ?? requete.utilisateur.id,
        notes: [`Issue de la veille des marchés : ${o.urlOfficielle ?? ''}`, date ? `Date limite de remise des plis : ${date}` : null, o.caution ? `Caution provisoire : ${nombre(o.caution)} DH` : null, o.notes].filter(Boolean).join('\n'),
      },
      client: client ? { id: client.id, nom: client.nom } : null,
      suggestions: suggestions.map((c) => ({ id: c.id, nom: c.nom })),
    };
  });

  app.post('/api/marches-potentiels/:id/convertir', { preHandler: [exiger('convertir', 'MarchePotentiel'), exiger('creer', 'Marche')] }, async (requete, reponse) => {
    const o = await offreOu404(requete);
    const donnees = valider(
      z.object({
        reference: z.string({ error: 'La référence de l’affaire.' }).trim().min(2, { error: 'La référence de l’affaire.' }).max(80),
        lot: z.string().trim().max(10).transform((v) => v || null).nullish(),
        objet: z.string().trim().max(255).transform((v) => v || null).nullish(),
        clientId: z.number().int().positive().nullable().optional(),
        nouveauClient: z.string().trim().max(160).transform((v) => v || null).nullish(),
        ville: z.string().trim().max(80).transform((v) => v || null).nullish(),
        montantTtc: z.number().nonnegative().nullable().optional(),
        statutAffaire: z.enum(STATUTS_AFFAIRE).default('AO en préparation'),
        responsableId: z.number().int().positive().nullable().optional(),
        notes: z.string().trim().max(5000).transform((v) => v || null).nullish(),
      }),
      requete.body ?? {},
    );
    if (donnees.clientId && donnees.nouveauClient) throw new ErreurHttp(422, 'Choisissez un client existant OU un nouveau client.');
    if (donnees.clientId && !(await db.client.findUnique({ where: { id: donnees.clientId } }))) throw introuvable('Client');
    const cle = cleDeReference(donnees.reference, donnees.lot);
    const moi = requete.utilisateur.id;

    const resultat = await db.$transaction(async (tx) => {
      // On réserve l'offre d'abord : un double clic ou deux personnes en même temps ne convertissent qu'une fois.
      const { count } = await tx.offrePotentielle.updateMany({ where: { id: o.id, marcheId: null, statut: { not: 'convertie' } }, data: { statut: 'convertie', convertieLe: new Date() } });
      if (!count) throw new ErreurHttp(409, 'Cette offre est déjà convertie en marché.');
      const existant = await tx.marche.findUnique({ where: { referenceNormalisee: cle } });
      if (existant) throw new ErreurHttp(409, `L’affaire « ${existant.reference} » existe déjà : changez la référence ou le lot.`, { existant: { id: existant.id, reference: existant.reference } });
      let clientId = donnees.clientId ?? null;
      let clientCree = null;
      if (donnees.nouveauClient) {
        const deja = await tx.client.findFirst({ where: { nom: { equals: donnees.nouveauClient, mode: 'insensitive' } } });
        if (deja) clientId = deja.id;
        else {
          clientCree = await tx.client.create({ data: { nom: donnees.nouveauClient } });
          clientId = clientCree.id;
        }
      }
      const marche = await tx.marche.create({
        data: { reference: donnees.reference, referenceNormalisee: cle, variantes: [donnees.reference], lot: donnees.lot, objet: donnees.objet, clientId, ville: donnees.ville, montantTtc: donnees.montantTtc ?? null, statutAffaire: donnees.statutAffaire, responsableId: donnees.responsableId ?? null },
      });
      await tx.offrePotentielle.update({ where: { id: o.id }, data: { marcheId: marche.id } });
      return { marche, clientCree };
    });

    const { marche, clientCree } = resultat;
    if (clientCree) await journaliser({ utilisateurId: moi, action: 'client.cree', objetType: 'Client', objetId: clientCree.id, apres: { nom: clientCree.nom }, commentaire: 'depuis un marché potentiel', ip: requete.ip }, requete.log);
    await journaliser({ utilisateurId: moi, action: 'marche.cree', objetType: 'Marche', objetId: marche.id, apres: { reference: marche.reference }, commentaire: `depuis le marché potentiel n° ${o.id}`, ip: requete.ip }, requete.log);
    if (donnees.notes) await journaliser({ utilisateurId: moi, action: 'note', objetType: 'Marche', objetId: marche.id, commentaire: donnees.notes, ip: requete.ip }, requete.log);
    await journaliser({ utilisateurId: moi, action: 'offre.convertie', objetType: 'OffrePotentielle', objetId: o.id, avant: { statut: o.statut }, apres: { statut: 'convertie', marcheId: marche.id }, ip: requete.ip }, requete.log);
    await abonner(moi, 'Marche', marche.id);
    if (donnees.responsableId) await abonner(donnees.responsableId, 'Marche', marche.id);
    return reponse.code(201).send({ marcheId: marche.id, reference: marche.reference, clientCree: clientCree ? { id: clientCree.id, nom: clientCree.nom } : null });
  });

  // ── Les préférences d'alerte (chacun les siennes) ─────────────

  app.patch('/api/marches-potentiels/alertes', lire, async (requete) => {
    const donnees = valider(schemaAlertesOffres, requete.body ?? {});
    await db.utilisateur.update({ where: { id: requete.utilisateur.id }, data: donnees });
    return donnees;
  });

  // ── Les critères iCity ────────────────────────────────────────

  app.get('/api/criteres-marches', lire, async () => {
    await assurerInitialisation();
    return chargerCriteres();
  });

  app.put('/api/criteres-marches', { preHandler: exiger('gerer', 'CriteresMarches') }, async (requete) => {
    // Un envoi partiel complète les critères en vigueur.
    const avant = await chargerCriteres();
    const criteres = valider(schemaCriteres, { ...avant, ...(requete.body ?? {}) });
    await db.criteresMarches.upsert({ where: { id: 1 }, update: { criteres, modifieParId: requete.utilisateur.id }, create: { id: 1, criteres, modifieParId: requete.utilisateur.id } });
    const recalculees = await recalculerScores();
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'criteres.modifies', objetType: 'CriteresMarches', objetId: 1, avant, apres: criteres, ip: requete.ip }, requete.log);
    return { criteres, recalculees };
  });

  // ── Les sources ───────────────────────────────────────────────

  app.get('/api/sources-marches', gererSources, async () => {
    await assurerInitialisation();
    const [sources, comptes, historiques] = await Promise.all([
      db.sourceMarches.findMany({ orderBy: { id: 'asc' } }),
      db.offrePotentielle.groupBy({ by: ['sourceId'], _count: { _all: true } }),
      db.synchronisationSource.findMany({ orderBy: { debut: 'desc' }, take: 60 }),
    ]);
    const parSource = new Map(comptes.map((c) => [c.sourceId, c._count._all]));
    return sources.map((s) => ({ ...vueSource(s, parSource.get(s.id) ?? 0), historique: historiques.filter((h) => h.sourceId === s.id).slice(0, 8) }));
  });

  app.post('/api/sources-marches', gererSources, async (requete, reponse) => {
    const donnees = valider(schemaSource, requete.body ?? {});
    verifierAdressesSource(donnees);
    if (await db.sourceMarches.findUnique({ where: { nom: donnees.nom } })) throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { nom: 'Une source porte déjà ce nom.' } });
    const cree = await db.sourceMarches.create({ data: { ...donnees, parametres: donnees.parametres ?? undefined, secrets: donnees.secrets ? secretsChiffres(donnees.secrets) : null } });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'source.creee', objetType: 'SourceMarches', objetId: cree.id, apres: { nom: cree.nom, connecteur: cree.connecteur, active: cree.active, adresse: cree.adresse }, ip: requete.ip }, requete.log);
    return reponse.code(201).send(vueSource(cree));
  });

  app.patch('/api/sources-marches/:id', gererSources, async (requete) => {
    const avant = await db.sourceMarches.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!avant) throw introuvable('Source');
    const { effacerSecrets, ...corps } = requete.body ?? {};
    const donnees = valider(schemaSource, corps);
    verifierAdressesSource(donnees);
    const autre = await db.sourceMarches.findUnique({ where: { nom: donnees.nom } });
    if (autre && autre.id !== avant.id) throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { nom: 'Une source porte déjà ce nom.' } });
    // Un secret vide garde l'ancien ; « effacer » le retire.
    const secrets = effacerSecrets ? null : donnees.secrets ? secretsChiffres(donnees.secrets) : avant.secrets;
    const apres = await db.sourceMarches.update({ where: { id: avant.id }, data: { ...donnees, parametres: donnees.parametres ?? undefined, secrets, ...(donnees.active && !avant.active ? { echecsConsecutifs: 0 } : {}) } });
    const trace = (s) => ({ nom: s.nom, connecteur: s.connecteur, adresse: s.adresse, active: s.active, frequenceMinutes: s.frequenceMinutes, pagesMax: s.pagesMax, delaiRequetesMs: s.delaiRequetesMs, autoriserHttp: s.autoriserHttp, secrets: s.secrets ? 'défini' : 'aucun' });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'source.modifiee', objetType: 'SourceMarches', objetId: avant.id, avant: trace(avant), apres: trace(apres), ip: requete.ip }, requete.log);
    return vueSource(apres);
  });

  app.delete('/api/sources-marches/:id', gererSources, async (requete) => {
    const source = await db.sourceMarches.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!source) throw introuvable('Source');
    const converties = await db.offrePotentielle.count({ where: { sourceId: source.id, marcheId: { not: null } } });
    if (converties) throw new ErreurHttp(409, `${converties} offre(s) de cette source ont été converties en marché : désactivez la source plutôt que de la supprimer.`);
    const offres = await db.offrePotentielle.count({ where: { sourceId: source.id } });
    await db.$transaction([db.offrePotentielle.deleteMany({ where: { sourceId: source.id } }), db.sourceMarches.delete({ where: { id: source.id } })]);
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'source.supprimee', objetType: 'SourceMarches', objetId: source.id, avant: { nom: source.nom, connecteur: source.connecteur, offres }, ip: requete.ip }, requete.log);
    return { ok: true, offresSupprimees: offres };
  });

  /** Tester la connexion : une seule requête, sans rien enregistrer. */
  app.post('/api/sources-marches/:id/tester', { ...gererSources, config: limiteCollecte }, async (requete) => {
    const source = await db.sourceMarches.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!source) throw introuvable('Source');
    const adresse = source.adresse || source.siteWeb;
    try {
      const debut = Date.now();
      const { statut, type, texte } = await recupererPour(source)(adresse);
      return { ok: true, statut, type, taille: texte.length, dureeMs: Date.now() - debut, annoncesLisibles: null };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  /** Synchroniser une source maintenant (elle doit être active). */
  app.post('/api/sources-marches/:id/synchroniser', { ...gererSources, config: limiteCollecte }, async (requete) => {
    const source = await db.sourceMarches.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!source) throw introuvable('Source');
    if (!source.active) throw new ErreurHttp(409, 'Cette source est désactivée : activez-la (après accord de son éditeur) pour la synchroniser, ou importez un CSV.');
    if (!connecteurDe(source.connecteur)) throw new ErreurHttp(409, 'Cette source n’a pas de connecteur automatique : importez ses offres par CSV ou par adresse.');
    const bilan = await synchroniserSource(source, { declenchement: 'manuelle', utilisateurId: requete.utilisateur.id });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'source.synchronisee', objetType: 'SourceMarches', objetId: source.id, apres: { etat: bilan.etat, nouvelles: bilan.nouvelles ?? 0 }, ip: requete.ip }, requete.log);
    return bilan;
  });

  /** Importer un fichier CSV d'offres dans une source. */
  app.post('/api/sources-marches/:id/import-csv', { preHandler: exiger('gerer', 'MarchePotentiel') }, async (requete) => {
    const source = await db.sourceMarches.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!source) throw introuvable('Source');
    // Importer dans une source automatique suppose de la gérer ; dans l'import manuel, gérer les offres suffit.
    if (source.connecteur !== 'manuel' && source.connecteur !== 'csv' && !requete.droits.can('gerer', 'SourceMarche')) throw interdit();
    const fichier = await requete.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!fichier) throw new ErreurHttp(422, 'Aucun fichier reçu.');
    if (!/\.(csv|txt)$/i.test(fichier.filename ?? '')) throw new ErreurHttp(422, 'Choisissez un fichier CSV.');
    const tampon = await fichier.toBuffer();
    if (fichier.file.truncated) throw new ErreurHttp(413, 'Fichier trop lourd : 5 Mo au plus.');
    const texte = new TextDecoder('utf-8').decode(tampon);
    const bilan = await importerCsv(source, texte.includes('�') ? new TextDecoder('windows-1252').decode(tampon) : texte, { utilisateurId: requete.utilisateur.id });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'source.import_csv', objetType: 'SourceMarches', objetId: source.id, apres: { fichier: fichier.filename, nouvelles: bilan.nouvelles, misesAJour: bilan.misesAJour, refusees: bilan.erreurs.length }, ip: requete.ip }, requete.log);
    return bilan;
  });

}
