/**
 * Le circuit de validation, les versions et le journal d'audit (§8, §13).
 *
 * Chaque transition est journalisée : qui, quand, de quel état vers quel
 * état, avec quel commentaire. Une version n'écrase jamais la précédente.
 */
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { criticiteDe, ETATS, transitionsPossibles, verifierTransition } from '@icity/commun/circuit';
import { confidentialitesVisibles, droitsPour } from '@icity/commun/droits';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';
import { cheminComplet, empreinteFichier, FORMATS, nombreDePages, TAILLE_MAX, texteDuPdf } from '../services/stockage.js';

/** Le document, s'il est visible par le demandeur. */
async function documentVisible(requete) {
  const id = Number(requete.params.id) || 0;
  const d = await db.document.findFirst({
    where: {
      id,
      supprimeLe: null,
      OR: [{ confidentialite: { in: confidentialitesVisibles(requete.utilisateur.role.code) } }, { verseParId: requete.utilisateur.id }],
    },
    include: { typeDocument: true },
  });
  if (!d) throw introuvable('Document');
  return d;
}

/** Les droits de cet utilisateur SUR CE document (confidentialité comprise). */
function droitsSur(requete, document) {
  const droits = droitsPour({ id: requete.utilisateur.id, role: requete.utilisateur.role.code });
  const sujet = { __caslSubjectType__: 'Document', ...document, versePar: document.verseParId };
  return { droits, sujet };
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesCircuit(app) {
  app.addHook('preHandler', exigerConnexion);

  // ── Où en est ce document, et que peut-on en faire ? ──────────
  app.get('/api/documents/:id/circuit', async (requete) => {
    const document = await documentVisible(requete);
    const { droits, sujet } = droitsSur(requete, document);

    const historique = await db.journal.findMany({
      where: { objetType: 'Document', objetId: document.id, action: { startsWith: 'circuit.' } },
      include: { utilisateur: { select: { nom: true } } },
      orderBy: { creeLe: 'desc' },
      take: 50,
    });

    return {
      etat: document.etatCircuit,
      etatNom: ETATS[document.etatCircuit]?.nom ?? document.etatCircuit,
      criticite: document.criticite,
      // Une pièce qui engage exige un contrôle humain : on le rappelle à l'écran.
      controleHumainObligatoire: criticiteDe(document.typeDocument?.code) === 'critique',
      transitions: transitionsPossibles(document, droits, sujet),
      historique: historique.map((h) => ({
        id: h.id,
        action: h.action.replace('circuit.', ''),
        avant: h.avant?.etat ?? null,
        apres: h.apres?.etat ?? null,
        commentaire: h.commentaire,
        par: h.utilisateur?.nom ?? 'système',
        creeLe: h.creeLe,
      })),
    };
  });

  // ── Faire avancer le document ─────────────────────────────────
  app.post('/api/documents/:id/circuit', async (requete) => {
    const document = await documentVisible(requete);
    const { transition, commentaire } = valider(
      z.object({ transition: z.string().min(2).max(40), commentaire: z.string().trim().max(1000).optional() }),
      requete.body,
    );

    const { droits, sujet } = droitsSur(requete, document);
    const possibles = transitionsPossibles(document, droits, sujet).map((t) => t.cle);
    if (!possibles.includes(transition)) throw new ErreurHttp(403, 'Votre rôle ne permet pas cette action sur ce document.');

    const controle = verifierTransition(document, transition, { commentaire });
    if (!controle.ok) throw new ErreurHttp(422, controle.raison);

    const modifie = await db.document.update({ where: { id: document.id }, data: { etatCircuit: controle.vers } });

    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: `circuit.${transition}`,
        objetType: 'Document',
        objetId: document.id,
        avant: { etat: document.etatCircuit },
        apres: { etat: controle.vers },
        commentaire: commentaire || null,
        ip: requete.ip,
      },
      requete.log,
    );

    return { etat: modifie.etatCircuit, etatNom: ETATS[modifie.etatCircuit].nom };
  });

  // ── Les versions (§8) ─────────────────────────────────────────
  app.get('/api/documents/:id/versions', async (requete) => {
    const document = await documentVisible(requete);
    const versions = await db.documentVersion.findMany({
      where: { documentId: document.id },
      include: { auteur: { select: { nom: true } } },
      orderBy: { numero: 'desc' },
    });
    return versions.map((v) => ({
      id: v.id,
      numero: v.numero,
      nomOrigine: v.nomOrigine,
      taille: v.taille ? Number(v.taille) : null,
      pages: v.pages,
      motif: v.motif,
      auteur: v.auteur?.nom ?? null,
      creeLe: v.creeLe,
      courante: false,
    }));
  });

  /**
   * Déposer une nouvelle version.
   *
   * L'ancienne n'est pas remplacée : elle descend dans l'historique, avec son
   * fichier. C'est la règle inviolable du §8.
   */
  app.post('/api/documents/:id/versions', { preHandler: exiger('modifier', 'Document') }, async (requete, reponse) => {
    const document = await documentVisible(requete);
    const fichier = await requete.file({ limits: { fileSize: TAILLE_MAX } });
    if (!fichier) throw new ErreurHttp(422, 'Aucun fichier reçu.');

    const extension = path.extname(fichier.filename ?? '').toLowerCase();
    if (!FORMATS[extension]) throw new ErreurHttp(422, `Format refusé : ${extension || 'sans extension'}.`);

    const provisoire = path.join(os.tmpdir(), `icity-version-${crypto.randomUUID()}${extension}`);
    try {
      await pipeline(fichier.file, createWriteStream(provisoire));
      if (fichier.file.truncated) throw new ErreurHttp(413, 'Fichier trop lourd : 50 Mo au plus.');

      const motifChamp = fichier.fields?.motif;
      const motif = (Array.isArray(motifChamp) ? motifChamp[0]?.value : motifChamp?.value) ?? null;

      // 1. L'actuelle descend dans l'historique, avec son fichier intact.
      const derniere = await db.documentVersion.findFirst({ where: { documentId: document.id }, orderBy: { numero: 'desc' } });
      const numero = (derniere?.numero ?? 0) + 1;
      if (document.cheminOriginal) {
        await db.documentVersion.create({
          data: {
            documentId: document.id,
            numero,
            chemin: document.cheminOriginal,
            nomOrigine: document.nomOrigine,
            sha256: document.sha256 ?? '',
            taille: document.taille,
            pages: document.pages,
            auteurId: document.verseParId,
            motif: 'version précédente',
          },
        });
      }

      // 2. La nouvelle prend sa place, sous un nouveau nom UUID.
      const annee = String(new Date().getFullYear());
      const relatif = path.join('documents', annee, `${crypto.randomUUID()}${extension}`).replace(/\\/g, '/');
      const destination = cheminComplet(relatif);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(provisoire, destination);

      const { size } = await fs.stat(destination);
      const texte = extension === '.pdf' ? await texteDuPdf(destination) : '';
      const aDuTexte = texte.replace(/\s/g, '').length >= 120;

      const modifie = await db.document.update({
        where: { id: document.id },
        data: {
          cheminOriginal: relatif,
          nomOrigine: fichier.filename,
          sha256: await empreinteFichier(destination),
          taille: BigInt(size),
          pages: extension === '.pdf' ? await nombreDePages(destination) : 1,
          texteOcr: aDuTexte ? texte : null,
          statutOcr: aDuTexte ? 'non_necessaire' : 'en_attente',
          // Une nouvelle version repart au contrôle : ce qui a changé n'a pas
          // encore été relu.
          etatCircuit: ['officiel', 'valide', 'archive'].includes(document.etatCircuit) ? 'soumis_controle' : document.etatCircuit,
        },
      });

      await journaliser(
        {
          utilisateurId: requete.utilisateur.id,
          action: 'document.nouvelle_version',
          objetType: 'Document',
          objetId: document.id,
          apres: { version: numero + 1, fichier: fichier.filename },
          commentaire: motif,
          ip: requete.ip,
        },
        requete.log,
      );

      return reponse.code(201).send({ version: numero + 1, etat: modifie.etatCircuit });
    } finally {
      await fs.rm(provisoire, { force: true });
    }
  });

  // ── Le journal d'audit (§13) ──────────────────────────────────
  app.get('/api/journal', { preHandler: exiger('lire', 'Journal') }, async (requete) => {
    const { action, utilisateurId, objetType, page = '1' } = requete.query;
    const parPage = 50;
    const numero = Math.max(1, Number(page) || 1);

    const where = {
      ...(action ? { action: { startsWith: String(action) } } : {}),
      ...(utilisateurId ? { utilisateurId: Number(utilisateurId) } : {}),
      ...(objetType ? { objetType: String(objetType) } : {}),
    };

    const [total, lignes, actions] = await Promise.all([
      db.journal.count({ where }),
      db.journal.findMany({
        where,
        include: { utilisateur: { select: { id: true, nom: true } } },
        orderBy: { creeLe: 'desc' },
        skip: (numero - 1) * parPage,
        take: parPage,
      }),
      db.journal.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { _count: { action: 'desc' } }, take: 25 }),
    ]);

    return {
      total,
      page: numero,
      pages: Math.max(1, Math.ceil(total / parPage)),
      lignes: lignes.map((l) => ({
        id: l.id,
        action: l.action,
        objetType: l.objetType,
        objetId: l.objetId,
        avant: l.avant,
        apres: l.apres,
        commentaire: l.commentaire,
        ip: l.ip,
        par: l.utilisateur ? { id: l.utilisateur.id, nom: l.utilisateur.nom } : null,
        creeLe: l.creeLe,
      })),
      actions: actions.map((a) => ({ action: a.action, n: a._count._all })),
    };
  });
}
