/**
 * Les marchés : liste filtrable, fiche, modification des informations.
 *
 * La phase, les pièces manquantes et l'échéance ne sont jamais enregistrées
 * telles quelles : elles se calculent ici, côté serveur, pour que deux écrans
 * ne puissent pas afficher deux chiffres différents (spécification, M03).
 */
import { z } from 'zod';
import { confidentialitesVisibles } from '@icity/commun/droits';
import {
  CONSERVATIONS,
  echeanceDe,
  estAppelOffres,
  etatEcheance,
  extraireLot,
  normaliserReference,
  OBJETS_TECHNIQUES,
  phaseDe,
  piecesManquantes,
  statutClient,
  STATUTS_AFFAIRE,
  STATUTS_CLIENT,
} from '@icity/commun/marches';
import { schemaClient } from '@icity/commun/schemas';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { doublonsEnAttente } from '../services/arbitrage-doublons.js';
import { EN_COURS, PIECES_ARCHIVEES } from '../services/archivage.js';
import { journaliser } from '../services/journal.js';
import { codesParMarche, piecesParMarche } from '../services/phase-marche.js';
import { nomFichier, versCsv } from '../services/export-csv.js';

/** Ce que l'écran reçoit d'un client, sans ses compteurs. */
function vueClient(c) {
  return {
    id: c.id,
    nom: c.nom,
    sigle: c.sigle,
    interne: c.interne,
    synonymes: c.synonymes ?? [],
    domainesEmail: c.domainesEmail ?? [],
  };
}

/** Les champs modifiables à la main sur une fiche marché (§11, onglet Informations). */
const schemaMarche = z.object({
  reference: z.string().trim().min(2).max(80).optional(),
  clientId: z.number().int().positive().nullable().optional(),
  objet: z.string().trim().max(255).nullable().optional(),
  numeroAo: z.string().trim().max(60).nullable().optional(),
  lot: z.string().trim().max(10).nullable().optional(),
  montantHt: z.number().nonnegative().nullable().optional(),
  montantTtc: z.number().nonnegative().nullable().optional(),
  dateSignature: z.iso.date().nullable().optional(),
  dateOs: z.iso.date().nullable().optional(),
  delaiMois: z.number().int().positive().max(120).nullable().optional(),
  dateFin: z.iso.date().nullable().optional(),
  ville: z.string().trim().max(80).nullable().optional(),
  responsableId: z.number().int().positive().nullable().optional(),
  emplacementPapier: z.string().trim().max(160).nullable().optional(),
  statutAffaire: z.enum(STATUTS_AFFAIRE).nullable().optional(),
  conservation: z.enum(CONSERVATIONS).nullable().optional(),
  objetTechnique: z.enum(OBJETS_TECHNIQUES).nullable().optional(),
  signe: z.boolean().optional(),
});

/** Archiver ou désarchiver : un lot de marchés, cochés dans la liste. */
const schemaLotMarches = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });

/** Ce qu'une fiche marché charge avec elle. */
const AVEC = {
  client: true,
  responsable: { select: { id: true, nom: true } },
  archivePar: { select: { id: true, nom: true } },
};

/** À la création, la référence est la seule information obligatoire. */
const schemaNouveauMarche = schemaMarche.extend({ reference: z.string().trim().min(2).max(80) });

const date = (v) => (v ? new Date(`${v}T00:00:00Z`) : null);

/**
 * La clé de regroupement d'une affaire (§5), calculée comme à l'import des
 * archives : la référence normalisée, suivie du lot s'il y en a un. Deux lots
 * d'un même appel d'offres sont deux contrats, donc deux affaires.
 */
export function cleDeReference(reference, lot) {
  const lu = extraireLot(reference) ?? (lot ? String(lot).trim().toUpperCase() : null);
  return normaliserReference(reference) + (lu ? `#${lu}` : '');
}

/** Un type de document. Le code sert au classement automatique (§7). */
const schemaType = z.object({
  nom: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().min(1).max(10),
  ordreCycle: z.number().int().min(1).max(99).nullable().optional(),
  pieceAttendue: z.boolean().default(false),
});

/** Une étiquette : sa famille la range dans l'écran, sa couleur l'y montre. */
const schemaEtiquette = z.object({
  nom: z.string().trim().min(2).max(80),
  couleur: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Une couleur s’écrit « #0E8296 ».'),
  famille: z.string().trim().min(2).max(20),
});

/** Un marché tel que l'écran l'attend : chiffres calculés compris. */
function vueMarche(m, pieces = {}, nbDocuments = 0, codes = []) {
  const phase = phaseDe(pieces);
  const echeance = echeanceDe({ dateFin: m.dateFin, dateOs: m.dateOs, delaiMois: m.delaiMois });
  // Un appel d'offres non gagné n'a pas de cycle : rien ne lui manque, et
  // aucune échéance ne court.
  const appelOffres = estAppelOffres(codes, m.statutAffaire);
  return {
    id: m.id,
    reference: m.reference,
    referenceNormalisee: m.referenceNormalisee,
    lot: m.lot,
    objet: m.objet,
    objetTechnique: m.objetTechnique,
    ville: m.ville,
    client: m.client ? { id: m.client.id, nom: m.client.nom, sigle: m.client.sigle } : null,
    montantHt: m.montantHt ? Number(m.montantHt) : null,
    montantTtc: m.montantTtc ? Number(m.montantTtc) : null,
    dateSignature: m.dateSignature?.toISOString().slice(0, 10) ?? null,
    dateOs: m.dateOs?.toISOString().slice(0, 10) ?? null,
    delaiMois: m.delaiMois,
    dateFin: m.dateFin?.toISOString().slice(0, 10) ?? null,
    statutAffaire: m.statutAffaire,
    conservation: m.conservation,
    emplacementPapier: m.emplacementPapier,
    numeroAo: m.numeroAo,
    signe: m.signe,
    responsable: m.responsable ? { id: m.responsable.id, nom: m.responsable.nom } : null,
    variantes: m.variantes ?? [],
    dossierOrigine: m.dossierOrigine,
    // Archivé : hors de la vue courante, toujours modifiable. `null` s'il est en cours.
    archive: m.archiveLe ? { le: m.archiveLe.toISOString(), par: m.archivePar?.nom ?? null } : null,
    // Calculés (§5) :
    pieces,
    phase,
    appelOffres,
    manquantes: appelOffres ? [] : piecesManquantes(pieces, phase),
    echeance,
    etatEcheance: appelOffres ? 'aucune' : etatEcheance(echeance, phase),
    nbDocuments,
  };
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesMarches(app) {
  app.addHook('preHandler', exigerConnexion);

  // ── Liste ─────────────────────────────────────────────────────
  /**
   * La liste filtrée, telle que l'écran la voit.
   *
   * Extraite pour que l'export CSV rende exactement les mêmes marchés, avec
   * les mêmes filtres et les mêmes droits — sans repasser par une requête
   * HTTP interne.
   */
  async function listerMarches(requete) {
    const { phase, clientId, incomplets, q, nature, archives } = requete.query;

    const marches = await db.marche.findMany({
      where: {
        // Par défaut, les marchés en cours seulement : c'est aussi ce que
        // reçoivent les listes déroulantes (verser, ranger, écrire au client).
        ...(archives === 'seuls' ? { archiveLe: { not: null } } : archives === 'tous' ? {} : EN_COURS),
        ...(clientId ? { clientId: Number(clientId) } : {}),
        ...(q
          ? {
              OR: [
                { reference: { contains: String(q), mode: 'insensitive' } },
                { objet: { contains: String(q), mode: 'insensitive' } },
                { ville: { contains: String(q), mode: 'insensitive' } },
                { client: { nom: { contains: String(q), mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: AVEC,
      orderBy: [{ reference: 'asc' }],
    });

    const [pieces, codes] = await Promise.all([piecesParMarche(), codesParMarche()]);
    // Les documents visibles seulement : un Lecteur ne doit pas deviner le
    // nombre de pièces confidentielles d'un marché.
    const comptes = await db.document.groupBy({
      by: ['marcheId'],
      where: { supprimeLe: null, marcheId: { not: null }, confidentialite: { in: confidentialitesVisibles(requete.utilisateur.role.code) } },
      _count: { _all: true },
    });
    const parMarche = new Map(comptes.map((c) => [c.marcheId, c._count._all]));

    let sortie = marches.map((m) => vueMarche(m, pieces.get(m.id) ?? {}, parMarche.get(m.id) ?? 0, codes.get(m.id) ?? []));
    // « nature » sépare les marchés gagnés des appels d'offres (deux onglets).
    if (nature === 'marches') sortie = sortie.filter((m) => !m.appelOffres);
    if (nature === 'ao') sortie = sortie.filter((m) => m.appelOffres);
    if (phase) sortie = sortie.filter((m) => m.phase === phase);
    if (incomplets === 'true' || incomplets === '1') sortie = sortie.filter((m) => m.manquantes.length > 0);
    return sortie;
  }

  app.get('/api/marches', listerMarches);

  /**
   * Le tableau des marchés en CSV, pour un rapport ou un tableur.
   *
   * L'export suit les mêmes filtres et les mêmes droits que l'écran : on ne
   * sort jamais par ce chemin ce qu'on ne verrait pas à l'écran.
   */
  app.get('/api/marches/export.csv', async (requete, reponse) => {
    const marches = await listerMarches(requete);

    const csv = versCsv({
      colonnes: [
        { cle: 'reference', titre: 'Référence' },
        { cle: 'client', titre: 'Client' },
        { cle: 'objet', titre: 'Objet' },
        { cle: 'ville', titre: 'Ville' },
        { cle: 'phase', titre: 'Phase' },
        { cle: 'statutAffaire', titre: 'Statut' },
        { cle: 'montant', titre: 'Montant TTC' },
        { cle: 'documents', titre: 'Documents' },
        { cle: 'manquantes', titre: 'Pièces manquantes' },
      ],
      lignes: marches.map((m) => ({
        reference: m.reference,
        client: m.client?.nom ?? '',
        objet: m.objet ?? '',
        ville: m.ville ?? '',
        phase: m.appelOffres ? "Appel d'offres" : (m.phase ?? ''),
        statutAffaire: m.statutAffaire ?? '',
        montant: m.montantTtc ?? '',
        documents: m.nbDocuments ?? 0,
        manquantes: (m.manquantes ?? []).join(', '),
      })),
    });

    return reponse
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${nomFichier('marches')}"`)
      .send(csv);
  });

  // ── Fiche ─────────────────────────────────────────────────────
  app.get('/api/marches/:id', async (requete) => {
    const id = Number(requete.params.id) || 0;
    const m = await db.marche.findUnique({
      where: { id },
      include: AVEC,
    });
    if (!m) throw introuvable('Marché');

    const visibles = confidentialitesVisibles(requete.utilisateur.role.code);
    const documents = await db.document.findMany({
      where: { marcheId: id, supprimeLe: null, OR: [{ confidentialite: { in: visibles } }, { verseParId: requete.utilisateur.id }] },
      include: { typeDocument: true },
      orderBy: [{ dateDocument: 'asc' }, { titre: 'asc' }],
    });

    const pieces = (await piecesParMarche([id])).get(id) ?? {};
    const codes = (await codesParMarche([id])).get(id) ?? [];
    const doublons = await doublonsEnAttente(
      documents.map((d) => d.id),
      { confidentialites: visibles },
    );
    return {
      ...vueMarche(m, pieces, documents.length, codes),
      documents: documents.map((d) => ({
        id: d.id,
        titre: d.titre,
        type: d.typeDocument ? { code: d.typeDocument.code, nom: d.typeDocument.nom, ordreCycle: d.typeDocument.ordreCycle } : null,
        dateDocument: d.dateDocument?.toISOString().slice(0, 10) ?? null,
        etatCircuit: d.etatCircuit,
        source: d.source,
        pages: d.pages,
        statutOcr: d.statutOcr,
        doublons: doublons.get(d.id) ?? [],
      })),
    };
  });

  // ── Création ──────────────────────────────────────────────────
  /**
   * Déclarer une affaire à la main : un marché dont on tient le contrat, ou
   * un appel d'offres auquel on répond.
   *
   * Jusqu'ici une affaire ne naissait que d'un import d'archives ou d'une
   * attestation. Les pièces qui citent sa référence la rejoindront ensuite
   * seules : le classement repasse après chaque lecture.
   *
   * Si la clé existe déjà, on ne crée rien : l'écran reçoit l'affaire
   * existante, pour y mener plutôt que de la doubler.
   */
  app.post('/api/marches', { preHandler: exiger('creer', 'Marche') }, async (requete, reponse) => {
    const champs = valider(schemaNouveauMarche, requete.body);
    const cle = cleDeReference(champs.reference, champs.lot);

    const existant = await db.marche.findUnique({ where: { referenceNormalisee: cle } });
    if (existant) {
      return reponse.code(409).send({
        // Une référence archivée ne se recrée pas : on ramène à l'ancienne
        // affaire, qu'il suffit de désarchiver.
        message: existant.archiveLe
          ? `L’affaire « ${existant.reference} » existe déjà, dans les archives. Désarchivez-la pour la reprendre.`
          : `L’affaire « ${existant.reference} » existe déjà.`,
        existant: { id: existant.id, reference: existant.reference },
      });
    }

    const data = { ...champs, referenceNormalisee: cle, variantes: [champs.reference] };
    for (const champDate of ['dateSignature', 'dateOs', 'dateFin']) {
      if (champDate in data) data[champDate] = date(data[champDate]);
    }
    const cree = await db.marche.create({ data, include: AVEC });

    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'marche.cree', objetType: 'Marche', objetId: cree.id, apres: champs, ip: requete.ip },
      requete.log,
    );
    return reponse.code(201).send(vueMarche(cree));
  });

  // ── Modification (onglet Informations) ────────────────────────
  app.patch('/api/marches/:id', { preHandler: exiger('modifier', 'Marche') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const avant = await db.marche.findUnique({ where: { id } });
    if (!avant) throw introuvable('Marché');

    const champs = valider(schemaMarche, requete.body);
    const data = { ...champs };
    for (const champDate of ['dateSignature', 'dateOs', 'dateFin']) {
      if (champDate in data) data[champDate] = date(data[champDate]);
    }

    // Une référence corrigée (un nom provisoire remplacé par la vraie) change
    // la clé de regroupement : sans elle, les pièces qui citent la vraie
    // référence ne reconnaîtraient pas l'affaire.
    if ('reference' in champs || 'lot' in champs) {
      const cle = cleDeReference(champs.reference ?? avant.reference, 'lot' in champs ? champs.lot : avant.lot);
      if (cle !== avant.referenceNormalisee) {
        const homonyme = await db.marche.findUnique({ where: { referenceNormalisee: cle } });
        if (homonyme) {
          throw new ErreurHttp(409, `L’affaire « ${homonyme.reference} » existe déjà.`, { erreurs: { reference: `Déjà utilisée par « ${homonyme.reference} ».` } });
        }
        data.referenceNormalisee = cle;
      }
    }

    const apres = await db.marche.update({
      where: { id },
      data,
      include: AVEC,
    });

    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'marche.modifie',
        objetType: 'Marche',
        objetId: id,
        avant: Object.fromEntries(Object.keys(champs).map((c) => [c, avant[c] instanceof Date ? avant[c].toISOString().slice(0, 10) : avant[c]])),
        apres: champs,
        ip: requete.ip,
      },
      requete.log,
    );

    const pieces = (await piecesParMarche([id])).get(id) ?? {};
    const codes = (await codesParMarche([id])).get(id) ?? [];
    return vueMarche(apres, pieces, 0, codes);
  });

  // ── Archiver, désarchiver ─────────────────────────────────────
  /**
   * Archiver des marchés : ils sortent de la vue courante, sans rien perdre,
   * et restent modifiables depuis leur fiche.
   *
   * Par lot, parce qu'on archive en fin d'exercice tout ce qui est terminé ;
   * un marché seul n'est qu'un lot d'un. Ce qui est déjà dans l'état demandé
   * est ignoré : relancer le geste ne change ni la date ni l'auteur.
   */
  for (const [chemin, archiver] of [
    ['/api/marches/archiver', true],
    ['/api/marches/desarchiver', false],
  ]) {
    app.post(chemin, { preHandler: exiger('archiver', 'Marche') }, async (requete) => {
      const { ids } = valider(schemaLotMarches, requete.body);
      const vises = await db.marche.findMany({
        where: { id: { in: ids }, archiveLe: archiver ? null : { not: null } },
        select: { id: true, reference: true },
      });
      if (!vises.length) return { modifies: 0 };

      await db.marche.updateMany({
        where: { id: { in: vises.map((m) => m.id) } },
        data: archiver ? { archiveLe: new Date(), archiveParId: requete.utilisateur.id } : { archiveLe: null, archiveParId: null },
      });

      // Une ligne par marché : c'est sur sa fiche qu'on relira qui l'a
      // archivé, et quand.
      for (const m of vises) {
        await journaliser(
          {
            utilisateurId: requete.utilisateur.id,
            action: archiver ? 'marche.archive' : 'marche.desarchive',
            objetType: 'Marche',
            objetId: m.id,
            commentaire: m.reference,
            ip: requete.ip,
          },
          requete.log,
        );
      }
      return { modifies: vises.length };
    });
  }

  /**
   * Ce que contiennent les archives, en deux chiffres.
   *
   * Les écrans vides le rappellent : après un archivage de fin d'exercice,
   * une liste vide ne doit pas faire croire que tout a été perdu.
   */
  app.get('/api/archives/resume', async (requete) => {
    const [marches, documents] = await Promise.all([
      db.marche.count({ where: { archiveLe: { not: null } } }),
      db.document.count({
        where: {
          supprimeLe: null,
          AND: [PIECES_ARCHIVEES],
          // On ne compte que ce qu'on a le droit de voir, comme partout.
          OR: [{ confidentialite: { in: confidentialitesVisibles(requete.utilisateur.role.code) } }, { verseParId: requete.utilisateur.id }],
        },
      }),
    ]);
    return { marches, documents };
  });

  // ── Clients ───────────────────────────────────────────────────
  /**
   * Les clients, avec leurs compteurs et leur statut.
   *
   * Le statut part des mêmes pièces que la phase du tableau des marchés
   * (`piecesParMarche` puis `phaseDe`) : les deux écrans ne peuvent pas se
   * contredire. Les pièces en corbeille ne sont pas comptées, comme partout
   * ailleurs.
   *
   * Extraite pour que l'export CSV rende exactement la même liste.
   */
  async function listerClients(requete) {
    const [clients, marches, documents] = await Promise.all([
      db.client.findMany({ orderBy: { nom: 'asc' } }),
      // Les compteurs d'un client portent sur ses marchés en cours : un
      // marché archivé ne fait plus de lui un client « actif ».
      db.marche.findMany({ where: { clientId: { not: null }, ...EN_COURS }, select: { id: true, clientId: true, statutAffaire: true } }),
      db.document.groupBy({ by: ['clientId'], where: { supprimeLe: null, clientId: { not: null } }, _count: { _all: true } }),
    ]);
    const ids = marches.map((m) => m.id);
    const [pieces, codes] = await Promise.all([piecesParMarche(ids), codesParMarche(ids)]);

    // Un appel d'offres non gagné ne fait pas du client un client « avec
    // marchés » : il est compté à part.
    const phasesParClient = new Map();
    const appelsOffresParClient = new Map();
    for (const m of marches) {
      if (estAppelOffres(codes.get(m.id) ?? [], m.statutAffaire)) {
        appelsOffresParClient.set(m.clientId, (appelsOffresParClient.get(m.clientId) ?? 0) + 1);
        continue;
      }
      const phases = phasesParClient.get(m.clientId) ?? [];
      phases.push(phaseDe(pieces.get(m.id) ?? {}));
      phasesParClient.set(m.clientId, phases);
    }
    const nbDocuments = new Map(documents.map((d) => [d.clientId, d._count._all]));

    const { interne } = requete.query;
    return clients
      .filter((c) => (interne === 'true' ? true : !c.interne || interne === 'seuls'))
      .map((c) => {
        const phases = phasesParClient.get(c.id) ?? [];
        return {
          ...vueClient(c),
          nbMarches: phases.length,
          nbMarchesEnCours: phases.filter((p) => p !== 'cloture').length,
          nbAppelsOffres: appelsOffresParClient.get(c.id) ?? 0,
          nbDocuments: nbDocuments.get(c.id) ?? 0,
          statut: statutClient(phases),
        };
      });
  }

  app.get('/api/clients', listerClients);

  /**
   * Un nouveau maître d'ouvrage.
   *
   * Réservé à ceux qui gèrent le référentiel des clients : un client en double
   * (« TGR » et « Trésorerie Générale ») couperait ses marchés en deux. D'où
   * aussi le refus d'un nom déjà pris, sans tenir compte des majuscules.
   */
  app.post('/api/clients', { preHandler: exiger('gerer', 'Client') }, async (requete, reponse) => {
    const donnees = valider(schemaClient, requete.body);

    const existant = await db.client.findFirst({ where: { nom: { equals: donnees.nom, mode: 'insensitive' } } });
    if (existant) {
      throw new ErreurHttp(409, 'Ce client existe déjà.', { erreurs: { nom: `« ${existant.nom} » est déjà au référentiel.` } });
    }

    const cree = await db.client.create({ data: donnees });
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'client.cree', objetType: 'Client', objetId: cree.id, apres: { nom: cree.nom }, ip: requete.ip },
      requete.log,
    );
    return reponse.code(201).send({ ...vueClient(cree), nbMarches: 0, nbMarchesEnCours: 0, nbAppelsOffres: 0, nbDocuments: 0, statut: statutClient([]) });
  });

  /** La liste des clients en CSV : mêmes lignes, même ordre que l'écran. */
  app.get('/api/clients/export.csv', async (requete, reponse) => {
    const clients = await listerClients(requete);
    const csv = versCsv({
      colonnes: [
        { cle: 'nom', titre: 'Client' },
        { cle: 'sigle', titre: 'Sigle' },
        { cle: 'nbMarches', titre: 'Marchés' },
        { cle: 'nbMarchesEnCours', titre: 'Marchés en cours' },
        { cle: 'nbDocuments', titre: 'Pièces' },
        { cle: 'statut', titre: 'Statut' },
        { cle: 'domaines', titre: 'Domaines e-mail' },
      ],
      lignes: clients.map((c) => ({
        ...c,
        sigle: c.sigle ?? '',
        statut: STATUTS_CLIENT[c.statut].nom,
        domaines: c.domainesEmail.join(', '),
      })),
    });
    return reponse
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${nomFichier('clients')}"`)
      .send(csv);
  });

  app.get('/api/clients/:id', async (requete) => {
    const id = Number(requete.params.id) || 0;
    const client = await db.client.findUnique({ where: { id } });
    if (!client) throw introuvable('Client');

    const marches = await db.marche.findMany({
      where: { clientId: id },
      include: AVEC,
      // Les marchés en cours d'abord, les archives ensuite.
      orderBy: [{ archiveLe: { sort: 'asc', nulls: 'first' } }, { reference: 'asc' }],
    });
    const ids = marches.map((m) => m.id);
    const [pieces, codes] = await Promise.all([piecesParMarche(ids), codesParMarche(ids)]);
    return {
      ...vueClient(client),
      marches: marches.map((m) => vueMarche(m, pieces.get(m.id) ?? {}, 0, codes.get(m.id) ?? [])),
    };
  });

  // ── Référentiels, pour les listes déroulantes ─────────────────
  app.get('/api/referentiels', async () => {
    const [types, etiquettes] = await Promise.all([
      db.typeDocument.findMany({ orderBy: [{ ordreCycle: 'asc' }, { nom: 'asc' }] }),
      db.etiquette.findMany({ orderBy: [{ famille: 'asc' }, { nom: 'asc' }] }),
    ]);
    return { types, etiquettes, statutsAffaire: STATUTS_AFFAIRE, conservations: CONSERVATIONS };
  });

  /*
   * Modifier les référentiels : réservé à l'administrateur.
   *
   * Un type de document ou une étiquette structure tout le fonds — le
   * classement s'y réfère, les pièces du cycle en dépendent. Les renommer ou
   * les supprimer n'est pas un geste courant.
   */
  const referentiel = { preHandler: exiger('gerer', 'Utilisateur') };

  /** Les référentiels comptés : combien de pièces derrière chaque entrée. */
  app.get('/api/referentiels/detail', referentiel, async () => {
    const [types, etiquettes, parType, parEtiquette] = await Promise.all([
      db.typeDocument.findMany({ orderBy: [{ ordreCycle: 'asc' }, { nom: 'asc' }] }),
      db.etiquette.findMany({ orderBy: [{ famille: 'asc' }, { nom: 'asc' }] }),
      db.document.groupBy({ by: ['typeDocumentId'], where: { supprimeLe: null }, _count: { _all: true } }),
      db.documentEtiquette.groupBy({ by: ['etiquetteId'], _count: { _all: true } }),
    ]);

    const nbType = new Map(parType.map((x) => [x.typeDocumentId, x._count._all]));
    const nbEtiquette = new Map(parEtiquette.map((x) => [x.etiquetteId, x._count._all]));

    return {
      types: types.map((t) => ({ ...t, documents: nbType.get(t.id) ?? 0 })),
      etiquettes: etiquettes.map((e) => ({ ...e, documents: nbEtiquette.get(e.id) ?? 0 })),
    };
  });

  app.post('/api/types-document', referentiel, async (requete, reponse) => {
    const donnees = valider(schemaType, requete.body);
    const cree = await db.typeDocument.create({ data: donnees });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'type_document.cree', objetType: 'TypeDocument', objetId: cree.id, apres: donnees, ip: requete.ip }, requete.log);
    return reponse.code(201).send(cree);
  });

  app.patch('/api/types-document/:id', referentiel, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const avant = await db.typeDocument.findUnique({ where: { id } });
    if (!avant) throw introuvable('Type de document');

    const donnees = valider(schemaType.partial(), requete.body);
    const apres = await db.typeDocument.update({ where: { id }, data: donnees });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'type_document.modifie', objetType: 'TypeDocument', objetId: id, avant, apres: donnees, ip: requete.ip }, requete.log);
    return apres;
  });

  app.delete('/api/types-document/:id', referentiel, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const type = await db.typeDocument.findUnique({ where: { id } });
    if (!type) throw introuvable('Type de document');

    // Un type encore porté par des pièces ne se supprime pas : elles
    // perdraient leur classement sans qu'on puisse le retrouver.
    const utilise = await db.document.count({ where: { typeDocumentId: id, supprimeLe: null } });
    if (utilise) {
      throw new ErreurHttp(409, `Ce type est porté par ${utilise} pièce(s). Reclassez-les avant de le supprimer.`);
    }

    await db.typeDocument.delete({ where: { id } });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'type_document.supprime', objetType: 'TypeDocument', objetId: id, avant: type, ip: requete.ip }, requete.log);
    return { ok: true };
  });

  app.post('/api/etiquettes', referentiel, async (requete, reponse) => {
    const donnees = valider(schemaEtiquette, requete.body);
    const cree = await db.etiquette.create({ data: donnees });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'etiquette.creee', objetType: 'Etiquette', objetId: cree.id, apres: donnees, ip: requete.ip }, requete.log);
    return reponse.code(201).send(cree);
  });

  app.patch('/api/etiquettes/:id', referentiel, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const avant = await db.etiquette.findUnique({ where: { id } });
    if (!avant) throw introuvable('Étiquette');

    const donnees = valider(schemaEtiquette.partial(), requete.body);
    const apres = await db.etiquette.update({ where: { id }, data: donnees });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'etiquette.modifiee', objetType: 'Etiquette', objetId: id, avant, apres: donnees, ip: requete.ip }, requete.log);
    return apres;
  });

  app.delete('/api/etiquettes/:id', referentiel, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const etiquette = await db.etiquette.findUnique({ where: { id } });
    if (!etiquette) throw introuvable('Étiquette');

    const posee = await db.documentEtiquette.count({ where: { etiquetteId: id } });
    if (posee) {
      throw new ErreurHttp(409, `Cette étiquette est posée sur ${posee} pièce(s). Retirez-la avant de la supprimer.`);
    }

    await db.etiquette.delete({ where: { id } });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'etiquette.supprimee', objetType: 'Etiquette', objetId: id, avant: etiquette, ip: requete.ip }, requete.log);
    return { ok: true };
  });
}
