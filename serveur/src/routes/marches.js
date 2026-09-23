/**
 * Les marchés : liste filtrable, fiche, modification des informations.
 *
 * La phase, les pièces manquantes et l'échéance ne sont jamais enregistrées
 * telles quelles : elles se calculent ici, côté serveur, pour que deux écrans
 * ne puissent pas afficher deux chiffres différents (spécification, M03).
 */
import { z } from 'zod';
import { confidentialitesVisibles } from '@icity/commun/droits';
import { CONSERVATIONS, echeanceDe, etatEcheance, phaseDe, piecesManquantes, STATUTS_AFFAIRE } from '@icity/commun/marches';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';
import { piecesParMarche } from '../services/phase-marche.js';
import { nomFichier, versCsv } from '../services/export-csv.js';

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
  signe: z.boolean().optional(),
});

const date = (v) => (v ? new Date(`${v}T00:00:00Z`) : null);

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
function vueMarche(m, pieces = {}, nbDocuments = 0) {
  const phase = phaseDe(pieces);
  const echeance = echeanceDe({ dateFin: m.dateFin, dateOs: m.dateOs, delaiMois: m.delaiMois });
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
    // Calculés (§5) :
    pieces,
    phase,
    manquantes: piecesManquantes(pieces, phase),
    echeance,
    etatEcheance: etatEcheance(echeance, phase),
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
    const { phase, clientId, incomplets, q } = requete.query;

    const marches = await db.marche.findMany({
      where: {
        ...(clientId ? { clientId: Number(clientId) } : {}),
        ...(q
          ? {
              OR: [
                { reference: { contains: String(q) } },
                { objet: { contains: String(q) } },
                { ville: { contains: String(q) } },
                { client: { nom: { contains: String(q) } } },
              ],
            }
          : {}),
      },
      include: { client: true, responsable: { select: { id: true, nom: true } } },
      orderBy: [{ reference: 'asc' }],
    });

    const pieces = await piecesParMarche();
    // Les documents visibles seulement : un Lecteur ne doit pas deviner le
    // nombre de pièces confidentielles d'un marché.
    const comptes = await db.document.groupBy({
      by: ['marcheId'],
      where: { supprimeLe: null, marcheId: { not: null }, confidentialite: { in: confidentialitesVisibles(requete.utilisateur.role.code) } },
      _count: { _all: true },
    });
    const parMarche = new Map(comptes.map((c) => [c.marcheId, c._count._all]));

    let sortie = marches.map((m) => vueMarche(m, pieces.get(m.id) ?? {}, parMarche.get(m.id) ?? 0));
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
        { cle: 'montant', titre: 'Montant' },
        { cle: 'documents', titre: 'Documents' },
        { cle: 'manquantes', titre: 'Pièces manquantes' },
      ],
      lignes: marches.map((m) => ({
        reference: m.reference,
        client: m.client?.nom ?? '',
        objet: m.objet ?? '',
        ville: m.ville ?? '',
        phase: m.phase ?? '',
        statutAffaire: m.statutAffaire ?? '',
        montant: m.montant ?? '',
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
      include: { client: true, responsable: { select: { id: true, nom: true } } },
    });
    if (!m) throw introuvable('Marché');

    const visibles = confidentialitesVisibles(requete.utilisateur.role.code);
    const documents = await db.document.findMany({
      where: { marcheId: id, supprimeLe: null, OR: [{ confidentialite: { in: visibles } }, { verseParId: requete.utilisateur.id }] },
      include: { typeDocument: true },
      orderBy: [{ dateDocument: 'asc' }, { titre: 'asc' }],
    });

    const pieces = (await piecesParMarche([id])).get(id) ?? {};
    return {
      ...vueMarche(m, pieces, documents.length),
      documents: documents.map((d) => ({
        id: d.id,
        titre: d.titre,
        type: d.typeDocument ? { code: d.typeDocument.code, nom: d.typeDocument.nom, ordreCycle: d.typeDocument.ordreCycle } : null,
        dateDocument: d.dateDocument?.toISOString().slice(0, 10) ?? null,
        etatCircuit: d.etatCircuit,
        source: d.source,
      })),
    };
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

    const apres = await db.marche.update({
      where: { id },
      data,
      include: { client: true, responsable: { select: { id: true, nom: true } } },
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
    return vueMarche(apres, pieces);
  });

  // ── Clients ───────────────────────────────────────────────────
  app.get('/api/clients', async (requete) => {
    const clients = await db.client.findMany({
      orderBy: { nom: 'asc' },
      include: { _count: { select: { marches: true, documents: true } } },
    });
    const { interne } = requete.query;
    return clients
      .filter((c) => (interne === 'true' ? true : !c.interne || interne === 'seuls'))
      .map((c) => ({
        id: c.id,
        nom: c.nom,
        sigle: c.sigle,
        interne: c.interne,
        synonymes: c.synonymes ?? [],
        domainesEmail: c.domainesEmail ?? [],
        nbMarches: c._count.marches,
        nbDocuments: c._count.documents,
      }));
  });

  app.get('/api/clients/:id', async (requete) => {
    const id = Number(requete.params.id) || 0;
    const client = await db.client.findUnique({ where: { id } });
    if (!client) throw introuvable('Client');

    const marches = await db.marche.findMany({
      where: { clientId: id },
      include: { client: true, responsable: { select: { id: true, nom: true } } },
      orderBy: { reference: 'asc' },
    });
    const pieces = await piecesParMarche(marches.map((m) => m.id));
    return {
      id: client.id,
      nom: client.nom,
      sigle: client.sigle,
      interne: client.interne,
      synonymes: client.synonymes ?? [],
      domainesEmail: client.domainesEmail ?? [],
      marches: marches.map((m) => vueMarche(m, pieces.get(m.id) ?? {})),
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
