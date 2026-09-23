/**
 * Les documents : liste filtrable, fiche, et lecture du fichier.
 *
 * Le fichier n'est jamais servi depuis un dossier public : il passe par ce
 * contrôleur, qui vérifie les droits et la confidentialité à chaque fois
 * (§13). Le nom réel du fichier (UUID) n'apparaît nulle part.
 */
import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { confidentialitesVisibles } from '@icity/commun/droits';
import { config } from '../config.js';
import { db } from '../db.js';
import { ErreurHttp, introuvable } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';
import { recalculerPhase } from '../services/phase-marche.js';
import { cheminComplet, FORMATS, TAILLE_MAX, verserFichier } from '../services/stockage.js';
import { chargerReferentiels, classerDocument } from '../services/classement-auto.js';
import { languesInstallees, resteALire, tesseractDisponible, traiterFile } from '../services/ocr.js';
import { listerSauvegardes, sauvegarder } from '../services/sauvegarde.js';

const PAGE = 50;

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
    marche: d.marche ? { id: d.marche.id, reference: d.marche.reference } : null,
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
  };
}

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
    const { marcheId, clientId, typeId, statutOcr, source, sansMarche, q, page = '1' } = requete.query;
    const numero = Math.max(1, Number(page) || 1);

    const where = {
      supprimeLe: null,
      ...filtreVisibilite(requete.utilisateur),
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

  // ── Fiche ─────────────────────────────────────────────────────
  app.get('/api/documents/:id', async (requete) => {
    const d = await documentVisible(requete, { versePar: { select: { id: true, nom: true } }, etiquettes: { include: { etiquette: true } } });
    return {
      ...vueDocument(d),
      texteOcr: d.texteOcr,
      langue: d.langue,
      versePar: d.versePar ? { id: d.versePar.id, nom: d.versePar.nom } : null,
      etiquettes: d.etiquettes.map((e) => ({ id: e.etiquette.id, nom: e.etiquette.nom, couleur: e.etiquette.couleur, famille: e.etiquette.famille })),
    };
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

      const champ = (nom) => {
        const v = fichier.fields?.[nom];
        const valeur = Array.isArray(v) ? v[0]?.value : v?.value;
        return valeur ? Number(valeur) || null : null;
      };

      const { document, doublon, cree } = await verserFichier(provisoire, {
        // Le nom d'origine du navigateur est conservé pour l'affichage, mais
        // le fichier est stocké sous un UUID (§13).
        titre: undefined,
        marcheId: champ('marcheId'),
        clientId: champ('clientId'),
        typeDocumentId: champ('typeDocumentId'),
        source: 'versement',
        verseParId: requete.utilisateur.id,
        nomOrigine: fichier.filename,
      });

      if (!cree) {
        // Empreinte déjà connue : on refuse, et on montre l'original (§6).
        return reponse.code(409).send({
          message: 'Ce fichier est déjà au fonds, au bit près.',
          doublon: { id: doublon.id, titre: doublon.titre, marche: doublon.marche ? { id: doublon.marche.id, reference: doublon.marche.reference } : null },
        });
      }

      if (document.marcheId) await recalculerPhase(document.marcheId);
      await journaliser({ utilisateurId: requete.utilisateur.id, action: 'document.verse', objetType: 'Document', objetId: document.id, commentaire: fichier.filename, ip: requete.ip }, requete.log);

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

      const complet = cheminComplet(d.cheminOriginal);
      try {
        await fs.access(complet);
      } catch {
        throw new ErreurHttp(410, 'Le fichier n’est plus dans le stockage.');
      }

      const extension = path.extname(d.cheminOriginal).toLowerCase();
      // Le type MIME vient de notre table, jamais de ce que dit le fichier.
      const mime = FORMATS[extension] ?? 'application/octet-stream';
      // Le nom proposé est nettoyé : un nom d'origine peut contenir des
      // guillemets ou des sauts de ligne, qui casseraient l'en-tête.
      const nom = (d.nomOrigine ?? `document-${d.id}${extension}`).replace(/[^\w.\- ]+/g, '_');

      if (disposition === 'attachment') {
        await journaliser({ utilisateurId: requete.utilisateur.id, action: 'document.telecharge', objetType: 'Document', objetId: d.id, ip: requete.ip }, requete.log);
      }

      // L'application affiche le PDF dans un cadre de sa propre page. Les
      // en-têtes généraux interdisent tout cadre (frame-ancestors 'none') :
      // on les desserre ici pour notre seule origine, et pour ce fichier.
      // Un autre site ne peut toujours pas l'encadrer.
      reponse.header('X-Frame-Options', 'SAMEORIGIN').header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");

      return reponse
        .header('Content-Type', mime)
        .header('Content-Disposition', `${disposition}; filename="${nom}"`)
        .header('Content-Length', String(d.taille ?? 0))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, max-age=300')
        .send(createReadStream(complet));
    });
  }
}
