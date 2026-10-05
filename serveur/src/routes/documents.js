/**
 * Les documents : liste filtrable, fiche, et lecture du fichier.
 *
 * Le fichier n'est jamais servi depuis un dossier public : il passe par ce
 * contrôleur, qui vérifie les droits et la confidentialité à chaque fois
 * (§13). Le nom réel du fichier (UUID) n'apparaît nulle part.
 */
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { confidentialitesVisibles } from '@icity/commun/droits';
import { CONFIDENTIALITES } from '@icity/commun/roles';
import { config } from '../config.js';
import { db } from '../db.js';
import { ErreurHttp, interdit, introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { archiverPieces, PIECES_ARCHIVEES, PIECES_HORS_ARCHIVES, pieceArchivee } from '../services/archivage.js';
import { detecterDoublons, doublonsEnAttente, ecarterDoublon, garderLesDeux } from '../services/arbitrage-doublons.js';
import { journaliser } from '../services/journal.js';
import { recalculerPhase } from '../services/phase-marche.js';
import { fichierStocke, FORMATS, servirFichier, TAILLE_MAX, verserFichier } from '../services/stockage.js';
import { chargerReferentiels, classerDocument } from '../services/classement-auto.js';
import { languesInstallees, resteALire, tesseractDisponible, traiterFile } from '../services/ocr.js';
import { listerSauvegardes, sauvegarder } from '../services/sauvegarde.js';

const PAGE = 50;

/**
 * Ce qu'on corrige à la main sur une pièce (§7).
 *
 * Un rangement fait à la main est un jugement humain : la pièce passe en
 * classement « manuel », et le classement automatique ne la touche plus —
 * pas même pour remplir une case laissée vide exprès.
 */
const schemaPiece = z.object({
  titre: z.string().trim().min(2).max(255).optional(),
  marcheId: z.number().int().positive().nullable().optional(),
  clientId: z.number().int().positive().nullable().optional(),
  typeDocumentId: z.number().int().positive().nullable().optional(),
  confidentialite: z.enum(CONFIDENTIALITES.map((c) => c.code)).optional(),
});

/** Ce qu'un utilisateur a le droit de voir : sa confidentialité, ou ses dépôts. */
function filtreVisibilite(utilisateur) {
  return {
    OR: [{ confidentialite: { in: confidentialitesVisibles(utilisateur.role.code) } }, { verseParId: utilisateur.id }],
  };
}

function vueDocument(d) {
  return {
    id: d.id,
    titre: d.titre,
    nomOrigine: d.nomOrigine,
    type: d.typeDocument ? { id: d.typeDocument.id, code: d.typeDocument.code, nom: d.typeDocument.nom } : null,
    marche: d.marche ? { id: d.marche.id, reference: d.marche.reference, archive: Boolean(d.marche.archiveLe) } : null,
    client: d.client ? { id: d.client.id, nom: d.client.nom } : null,
    dateDocument: d.dateDocument?.toISOString().slice(0, 10) ?? null,
    pages: d.pages,
    taille: d.taille === null || d.taille === undefined ? null : Number(d.taille),
    statutOcr: d.statutOcr,
    ocrConfiance: d.ocrConfiance,
    statutClassement: d.statutClassement,
    source: d.source,
    confidentialite: d.confidentialite,
    criticite: d.criticite,
    etatCircuit: d.etatCircuit,
    lotScan: d.lotScan,
    pageScan: d.pageScan,
    aUnFichier: Boolean(d.cheminOriginal),
    extension: d.nomOrigine ? path.extname(d.nomOrigine).toLowerCase() : null,
    creeLe: d.creeLe,
    // Archivée elle-même (`le`), ou par son marché : hors de la vue courante,
    // toujours modifiable. `null` si la pièce est en cours.
    archive: pieceArchivee(d) ? { le: (d.archiveLe ?? d.marche.archiveLe).toISOString(), parSonMarche: !d.archiveLe } : null,
  };
}

/** Archiver ou désarchiver : un lot de pièces cochées. */
const schemaLotPieces = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) });

/** Retrouve un document visible par cet utilisateur, ou lève 404. */
async function documentVisible(requete, extra = {}) {
  const id = Number(requete.params.id) || 0;
  const d = await db.document.findFirst({
    where: { id, supprimeLe: null, ...filtreVisibilite(requete.utilisateur) },
    include: { typeDocument: true, marche: true, client: true, ...extra },
  });
  if (!d) throw introuvable('Document');
  return d;
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesDocuments(app) {
  app.addHook('preHandler', exigerConnexion);

  // ── Liste ─────────────────────────────────────────────────────
  app.get('/api/documents', async (requete) => {
    const { marcheId, clientId, typeId, statutOcr, source, sansMarche, q, ids, archives, page = '1' } = requete.query;
    const numero = Math.max(1, Number(page) || 1);
    // Les pièces d'un versement, que l'écran suit jusqu'à la fin de leur lecture.
    const listeIds = ids === undefined ? null : String(ids).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, PAGE);

    const where = {
      supprimeLe: null,
      ...filtreVisibilite(requete.utilisateur),
      ...(listeIds ? { id: { in: listeIds } } : {}),
      // Les pièces archivées (elles-mêmes ou par leur marché) restent hors de
      // la liste, sauf à les demander — ou à ouvrir un marché précis.
      ...(archives === 'seuls'
        ? { AND: [PIECES_ARCHIVEES] }
        : archives === 'tous' || marcheId || listeIds
          ? {}
          : PIECES_HORS_ARCHIVES),
      ...(marcheId ? { marcheId: Number(marcheId) } : {}),
      ...(sansMarche === 'true' ? { marcheId: null } : {}),
      ...(clientId ? { clientId: Number(clientId) } : {}),
      ...(typeId ? { typeDocumentId: Number(typeId) } : {}),
      ...(statutOcr ? { statutOcr: String(statutOcr) } : {}),
      ...(source ? { source: String(source) } : {}),
      ...(q
        ? {
            OR: [
              { titre: { contains: String(q) } },
              { nomOrigine: { contains: String(q) } },
              { marche: { reference: { contains: String(q) } } },
              { client: { nom: { contains: String(q) } } },
            ],
          }
        : {}),
    };

    const [total, documents] = await Promise.all([
      db.document.count({ where }),
      db.document.findMany({
        where,
        include: { typeDocument: true, marche: true, client: true },
        orderBy: [{ creeLe: 'desc' }, { id: 'desc' }],
        skip: (numero - 1) * PAGE,
        take: PAGE,
      }),
    ]);

    return { total, page: numero, pages: Math.max(1, Math.ceil(total / PAGE)), documents: documents.map(vueDocument) };
  });

  /**
   * Archiver des pièces, ou les désarchiver : réservé à la direction, comme
   * pour les marchés. Une pièce archivée par son marché ne se désarchive pas
   * seule : c'est le marché qu'il faut désarchiver.
   */
  for (const [chemin, archiver] of [
    ['/api/documents/archiver', true],
    ['/api/documents/desarchiver', false],
  ]) {
    app.post(chemin, { preHandler: exiger('archiver', 'Marche') }, async (requete) => {
      const { ids } = valider(schemaLotPieces, requete.body);
      // On n'archive pas ce qu'on ne voit pas : la confidentialité tient ici aussi.
      const visibles = await db.document.findMany({ where: { id: { in: ids }, ...filtreVisibilite(requete.utilisateur) }, select: { id: true } });
      const modifies = await archiverPieces(
        visibles.map((d) => d.id),
        { archiver, utilisateurId: requete.utilisateur.id, ip: requete.ip, journaliser, log: requete.log },
      );
      return { modifies };
    });
  }

  // ── Fiche ─────────────────────────────────────────────────────
  app.get('/api/documents/:id', async (requete) => {
    const d = await documentVisible(requete, { versePar: { select: { id: true, nom: true } }, etiquettes: { include: { etiquette: true } } });
    return {
      ...vueDocument(d),
      texteOcr: d.texteOcr,
      langue: d.langue,
      versePar: d.versePar ? { id: d.versePar.id, nom: d.versePar.nom } : null,
      etiquettes: d.etiquettes.map((e) => ({ id: e.etiquette.id, nom: e.etiquette.nom, couleur: e.etiquette.couleur, famille: e.etiquette.famille })),
      // Les doublons probables encore à trancher (§9), montrés sur la page.
      doublons: (await doublonsEnAttente([d.id], { confidentialites: confidentialitesVisibles(requete.utilisateur.role.code) })).get(d.id) ?? [],
    };
  });

  // ── Modifier une pièce ────────────────────────────────────────
  app.patch('/api/documents/:id', async (requete) => {
    const d = await documentVisible(requete);
    // Les droits sur CETTE pièce : un déposant ne corrige que ses brouillons.
    if (!requete.droits.can('modifier', { __caslSubjectType__: 'Document', ...d, versePar: d.verseParId })) throw interdit();

    const champs = valider(schemaPiece, requete.body);
    const erreurs = {};
    // On ne range pas une pièce hors de sa propre vue : on la perdrait aussitôt.
    if (champs.confidentialite && !confidentialitesVisibles(requete.utilisateur.role.code).includes(champs.confidentialite)) {
      erreurs.confidentialite = 'Ce niveau dépasse ce que votre rôle peut voir.';
    }
    const marche = champs.marcheId ? await db.marche.findUnique({ where: { id: champs.marcheId } }) : null;
    if (champs.marcheId && !marche) erreurs.marcheId = 'Ce marché n’existe pas.';
    if (champs.clientId && !(await db.client.findUnique({ where: { id: champs.clientId } }))) erreurs.clientId = 'Ce client n’existe pas.';
    if (champs.typeDocumentId && !(await db.typeDocument.findUnique({ where: { id: champs.typeDocumentId } }))) erreurs.typeDocumentId = 'Ce type n’existe pas.';
    if (Object.keys(erreurs).length) throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs });

    const data = { ...champs, statutClassement: 'manuel' };
    // Le client suit le marché, comme au classement automatique — sauf s'il
    // est précisé, ou déjà renseigné.
    if (marche?.clientId && !('clientId' in champs) && !d.clientId) data.clientId = marche.clientId;

    const apres = await db.document.update({ where: { id: d.id }, data, include: { typeDocument: true, marche: true, client: true } });

    // La phase se déduit des pièces : l'ancien marché et le nouveau peuvent changer.
    for (const id of new Set([d.marcheId, apres.marcheId].filter(Boolean))) await recalculerPhase(id);

    const modifies = Object.keys(champs);
    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'document.modifie',
        objetType: 'Document',
        objetId: d.id,
        avant: Object.fromEntries(modifies.map((c) => [c, d[c]])),
        apres: champs,
        ip: requete.ip,
      },
      requete.log,
    );
    return vueDocument(apres);
  });

  /**
   * Trancher un doublon probable (§9) : garder les deux pièces, ou écarter
   * l'une — ce qu'elle porte (marché, client, type, étiquettes) passe sur
   * l'autre avant la corbeille.
   */
  app.post('/api/doublons/:id/decision', { preHandler: exiger('gerer', 'AVerifier') }, async (requete) => {
    const { decision, garderId } = valider(
      z.object({ decision: z.enum(['gardes', 'supprime']), garderId: z.number().int().positive().optional() }),
      requete.body,
    );
    const paire = await db.doublon.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!paire) throw introuvable('Paire de doublons');
    if (paire.decision !== 'en_attente') throw new ErreurHttp(409, 'Cette paire a déjà été tranchée.');

    const options = { utilisateurId: requete.utilisateur.id, ip: requete.ip, log: requete.log };
    if (decision === 'gardes') {
      await garderLesDeux(paire, options);
      return { ok: true };
    }

    if (![paire.documentAId, paire.documentBId].includes(garderId)) {
      throw new ErreurHttp(422, 'Indiquez la pièce à garder.', { erreurs: { garderId: 'La pièce à garder doit être l’une des deux.' } });
    }
    const { ecarte } = await ecarterDoublon(paire, garderId, options);
    return { ok: true, ecarteId: ecarte.id };
  });

  // ── Verser une pièce (§6) ─────────────────────────────────────
  app.post('/api/documents', { preHandler: exiger('verser', 'Document') }, async (requete, reponse) => {
    const fichier = await requete.file({ limits: { fileSize: TAILLE_MAX } });
    if (!fichier) throw new ErreurHttp(422, 'Aucun fichier reçu.');

    const extension = path.extname(fichier.filename ?? '').toLowerCase();
    if (!FORMATS[extension]) {
      throw new ErreurHttp(422, `Format refusé : ${extension || 'sans extension'}. Formats acceptés : ${Object.keys(FORMATS).join(', ')}.`);
    }

    // Le fichier transite par un dossier temporaire : l'empreinte se calcule
    // sur un fichier posé, pas sur un flux qu'on ne peut relire.
    const provisoire = path.join(os.tmpdir(), `icity-${crypto.randomUUID()}${extension}`);
    try {
      await pipeline(fichier.file, createWriteStream(provisoire));
      if (fichier.file.truncated) throw new ErreurHttp(413, 'Fichier trop lourd : 50 Mo au plus.');

      const texte = (nom) => {
        const v = fichier.fields?.[nom];
        const valeur = Array.isArray(v) ? v[0]?.value : v?.value;
        return typeof valeur === 'string' && valeur.trim() ? valeur.trim() : null;
      };
      const nombre = (nom) => Number(texte(nom)) || null;

      // La fiche du versement (maquette A10) : ce que le déposant a indiqué
      // fait foi, il doit donc exister — et une confidentialité ne dépasse
      // pas ce que son rôle voit, comme au rangement à la main.
      const fiche = {
        marcheId: nombre('marcheId'),
        clientId: nombre('clientId'),
        typeDocumentId: nombre('typeDocumentId'),
        confidentialite: texte('confidentialite') ?? 'interne',
      };
      const erreurs = {};
      if (!CONFIDENTIALITES.some((c) => c.code === fiche.confidentialite)) erreurs.confidentialite = 'Ce niveau de confidentialité n’existe pas.';
      else if (!confidentialitesVisibles(requete.utilisateur.role.code).includes(fiche.confidentialite)) {
        erreurs.confidentialite = 'Ce niveau dépasse ce que votre rôle peut voir.';
      }
      if (fiche.marcheId && !(await db.marche.findUnique({ where: { id: fiche.marcheId } }))) erreurs.marcheId = 'Ce marché n’existe pas.';
      if (fiche.clientId && !(await db.client.findUnique({ where: { id: fiche.clientId } }))) erreurs.clientId = 'Ce client n’existe pas.';
      if (fiche.typeDocumentId && !(await db.typeDocument.findUnique({ where: { id: fiche.typeDocumentId } }))) erreurs.typeDocumentId = 'Ce type n’existe pas.';
      if (Object.keys(erreurs).length) throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs });

      const { document, doublon, cree } = await verserFichier(provisoire, {
        // Le nom d'origine du navigateur est conservé pour l'affichage, mais
        // le fichier est stocké sous un UUID (§13).
        titre: undefined,
        ...fiche,
        source: 'versement',
        verseParId: requete.utilisateur.id,
        nomOrigine: fichier.filename,
      });

      if (!cree) {
        // Empreinte déjà connue : on refuse, et on montre l'original (§6).
        return reponse.code(409).send({
          message: 'Ce fichier est déjà au fonds, au bit près.',
          doublon: { id: doublon.id, titre: doublon.titre, marche: doublon.marche ? { id: doublon.marche.id, reference: doublon.marche.reference, archive: Boolean(doublon.marche.archiveLe) } : null },
        });
      }

      if (document.marcheId) await recalculerPhase(document.marcheId);
      await journaliser(
        { utilisateurId: requete.utilisateur.id, action: 'document.verse', objetType: 'Document', objetId: document.id, apres: fiche, commentaire: fichier.filename, ip: requete.ip },
        requete.log,
      );

      /*
       * Le classement s'applique tout de suite (§7).
       *
       * Il ne remplace jamais ce qui a été indiqué au versement : si le
       * marché ou le type sont déjà renseignés, ils font foi. La machine ne
       * remplit que les cases vides, et seulement quand elle est sûre.
       *
       * Un échec ici ne doit pas faire échouer le versement : la pièce est
       * entrée, c'est l'essentiel. Elle restera « à classer ».
       */
      try {
        const referentiels = await chargerReferentiels();
        await classerDocument(document, referentiels, { requete, log: requete.log });
      } catch (erreur) {
        requete.log.error?.({ err: erreur }, `Classement automatique en échec pour le document ${document.id}`);
      }

      // Un rescan d'une pièce déjà au fonds : sûr, il est écarté ; probable,
      // il est signalé (§9). Un scan sans texte attendra son OCR (worker).
      if (document.texteOcr) {
        try {
          await detecterDoublons({ ids: [document.id], utilisateurId: requete.utilisateur.id, log: requete.log });
        } catch (erreur) {
          requete.log.error?.({ err: erreur }, `Recherche de doublons en échec pour le document ${document.id}`);
        }
      }

      const complet = await db.document.findUnique({ where: { id: document.id }, include: { typeDocument: true, marche: true, client: true } });
      return reponse.code(201).send({ document: vueDocument(complet) });
    } finally {
      await fs.rm(provisoire, { force: true });
    }
  });

  /**
   * L'état de la lecture automatique (§6).
   *
   * Sans Tesseract installé, la file ne se vide jamais : l'écran doit le dire
   * franchement, avec ce qui attend, plutôt que de laisser chercher pourquoi
   * un scan reste introuvable.
   */
  app.get('/api/ocr', { preHandler: exiger('gerer', 'Utilisateur') }, async () => {
    const [outil, parStatut, reste] = await Promise.all([
      tesseractDisponible(),
      db.document.groupBy({ by: ['statutOcr'], where: { supprimeLe: null }, _count: { _all: true } }),
      resteALire(),
    ]);

    return {
      outil: {
        ok: outil.ok,
        version: outil.version ?? null,
        motif: outil.motif ?? null,
        langues: outil.ok ? await languesInstallees() : [],
        languesVoulues: config.OCR_LANGUES.split('+'),
      },
      reste,
      parStatut: Object.fromEntries(parStatut.map((s) => [s.statutOcr, s._count._all])),
    };
  });

  /** Relance la file à la main, sans attendre le passage du worker. */
  app.post('/api/ocr/relancer', { preHandler: exiger('gerer', 'Utilisateur') }, async (requete) => {
    const bilan = await traiterFile({ limite: 10, log: requete.log });
    if (bilan.ignoree) throw new ErreurHttp(422, `La lecture est impossible : ${bilan.motif}.`);
    return bilan;
  });

  /**
   * Les sauvegardes présentes (§13).
   *
   * Réservé à l'administrateur : la liste dit où vit le fonds et ce qu'il
   * pèse.
   */
  app.get('/api/sauvegardes', { preHandler: exiger('gerer', 'Utilisateur') }, async () => {
    return listerSauvegardes();
  });

  /**
   * Lance une sauvegarde à la demande.
   *
   * Le worker en fait une chaque dimanche, mais seulement s'il tourne à ce
   * moment-là : sur un portable éteint le week-end, elle ne part jamais. Ce
   * bouton existe pour cela.
   */
  app.post('/api/sauvegardes', { preHandler: exiger('gerer', 'Utilisateur') }, async (requete) => {
    try {
      const bilan = await sauvegarder({ log: requete.log });
      await journaliser(
        {
          utilisateurId: requete.utilisateur.id,
          action: 'sauvegarde.lancee',
          apres: { dossier: bilan.dossier, documents: bilan.documents, fichiers: bilan.fichiers },
          ip: requete.ip,
        },
        requete.log,
      );
      return bilan;
    } catch (erreur) {
      // pg_dump absent, disque plein : le motif doit remonter à l'écran,
      // sinon on ne saurait pas quoi corriger.
      throw new ErreurHttp(500, `La sauvegarde a échoué : ${erreur.message}`);
    }
  });

  // ── Le fichier lui-même ───────────────────────────────────────
  for (const [suffixe, disposition] of [
    ['fichier', 'inline'],
    ['telecharger', 'attachment'],
  ]) {
    app.get(`/api/documents/:id/${suffixe}`, async (requete, reponse) => {
      const d = await documentVisible(requete);
      if (!d.cheminOriginal) throw introuvable('Fichier');
      const complet = await fichierStocke(d);

      if (disposition === 'attachment') {
        await journaliser({ utilisateurId: requete.utilisateur.id, action: 'document.telecharge', objetType: 'Document', objetId: d.id, ip: requete.ip }, requete.log);
      }
      return servirFichier(reponse, d, complet, disposition);
    });
  }
}
