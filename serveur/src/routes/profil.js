/**
 * Le profil de l'utilisateur connecté : nom, avatar, mot de passe, sessions
 * actives, double authentification.
 */
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { schemaChangerMotDePasse, schemaCodeDeuxFacteurs, schemaProfil } from '@icity/commun/schemas';
import { config } from '../config.js';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exigerConnexion, utilisateurPublic } from '../plugins/authentification.js';
import { genererCodesSecours, preparer, verifierCode } from '../services/deux-facteurs.js';
import { journaliser } from '../services/journal.js';
import { hacher, verifier } from '../services/mots-de-passe.js';
import { fermerAutresSessions, fermerSession } from '../services/sessions.js';

const DOSSIER_AVATARS = () => path.join(config.STOCKAGE, 'avatars');
const TYPES_AVATAR = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const TAILLE_MAX_AVATAR = 2 * 1024 * 1024;

/** Décrit une session pour l'écran, sans jamais exposer son identifiant complet. */
function sessionPublique(s, courante) {
  return {
    id: s.id.slice(0, 16),
    ip: s.ip,
    agent: s.agent,
    creeLe: s.creeLe,
    derniereActivite: s.derniereActivite,
    courante: s.id === courante,
  };
}

async function supprimerFichierAvatar(nom) {
  if (!nom) return;
  // basename : un nom stocké ne peut pas faire sortir du dossier des avatars.
  await fs.rm(path.join(DOSSIER_AVATARS(), path.basename(nom)), { force: true });
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesProfil(app) {
  app.addHook('preHandler', async (requete) => {
    // Seule l'image d'avatar est accessible hors de ce préfixe ; elle exige
    // aussi une connexion (vérifiée plus bas).
    if (requete.routeOptions.url?.startsWith('/api/profil')) await exigerConnexion(requete);
  });

  app.get('/api/profil', async (requete) => {
    const sessions = await db.session.findMany({
      where: { utilisateurId: requete.utilisateur.id, attenteDeuxFacteurs: false, expireLe: { gt: new Date() } },
      orderBy: { derniereActivite: 'desc' },
    });
    return {
      utilisateur: utilisateurPublic(requete.utilisateur),
      sessions: sessions.map((s) => sessionPublique(s, requete.session.id)),
    };
  });

  app.patch('/api/profil', async (requete) => {
    const { nom } = valider(schemaProfil, requete.body);
    const avant = requete.utilisateur.nom;
    const u = await db.utilisateur.update({ where: { id: requete.utilisateur.id }, data: { nom }, include: { role: true } });
    await journaliser({ utilisateurId: u.id, action: 'profil.modifie', objetType: 'Utilisateur', objetId: u.id, avant: { nom: avant }, apres: { nom }, ip: requete.ip }, requete.log);
    return { utilisateur: utilisateurPublic(u) };
  });

  // ── Avatar ────────────────────────────────────────────────────
  app.post('/api/profil/avatar', async (requete) => {
    const fichier = await requete.file({ limits: { fileSize: TAILLE_MAX_AVATAR, files: 1 } });
    if (!fichier) throw new ErreurHttp(422, 'Choisissez une image.');
    const contenu = await fichier.toBuffer().catch(() => {
      throw new ErreurHttp(413, 'Image trop lourde : 2 Mo au plus.');
    });

    // Le type se lit dans les octets du fichier, pas dans son nom ni dans ce
    // que déclare le navigateur : les deux se falsifient facilement (§13).
    const type = await fileTypeFromBuffer(contenu);
    const extension = type && TYPES_AVATAR[type.mime];
    if (!extension) throw new ErreurHttp(422, 'Formats acceptés : PNG, JPEG ou WEBP.');

    await fs.mkdir(DOSSIER_AVATARS(), { recursive: true });
    const nom = `${crypto.randomUUID()}.${extension}`;
    await fs.writeFile(path.join(DOSSIER_AVATARS(), nom), contenu);

    await supprimerFichierAvatar(requete.utilisateur.avatar);
    const u = await db.utilisateur.update({ where: { id: requete.utilisateur.id }, data: { avatar: nom }, include: { role: true } });
    return { utilisateur: utilisateurPublic(u) };
  });

  app.delete('/api/profil/avatar', async (requete) => {
    await supprimerFichierAvatar(requete.utilisateur.avatar);
    const u = await db.utilisateur.update({ where: { id: requete.utilisateur.id }, data: { avatar: null }, include: { role: true } });
    return { utilisateur: utilisateurPublic(u) };
  });

  // Servie par le serveur, jamais depuis un dossier public (§13).
  app.get('/api/utilisateurs/:id/avatar', { preHandler: exigerConnexion }, async (requete, reponse) => {
    const id = Number(requete.params.id);
    const u = Number.isInteger(id) ? await db.utilisateur.findUnique({ where: { id }, select: { avatar: true } }) : null;
    if (!u?.avatar) throw introuvable('Avatar');
    const extension = path.extname(u.avatar).slice(1);
    const mime = Object.entries(TYPES_AVATAR).find(([, e]) => e === extension)?.[0] ?? 'application/octet-stream';
    reponse.header('Content-Type', mime).header('Cache-Control', 'private, max-age=86400');
    return reponse.send(createReadStream(path.join(DOSSIER_AVATARS(), path.basename(u.avatar))));
  });

  // ── Mot de passe ──────────────────────────────────────────────
  app.post('/api/profil/mot-de-passe', async (requete) => {
    const { actuel, motDePasse } = valider(schemaChangerMotDePasse, requete.body);
    if (!(await verifier(actuel, requete.utilisateur.motDePasse))) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { actuel: 'Mot de passe actuel incorrect.' } });
    }
    await db.utilisateur.update({ where: { id: requete.utilisateur.id }, data: { motDePasse: await hacher(motDePasse) } });
    // Les autres appareils perdent leur session : c'est souvent la raison
    // même du changement de mot de passe.
    await fermerAutresSessions(requete.utilisateur.id, requete.session.id);
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'mot_de_passe.change', ip: requete.ip }, requete.log);
    return { message: 'Mot de passe modifié. Vos autres sessions ont été fermées.' };
  });

  // ── Sessions actives ──────────────────────────────────────────
  app.delete('/api/profil/sessions/autres', async (requete) => {
    const { count } = await fermerAutresSessions(requete.utilisateur.id, requete.session.id);
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'sessions.fermees', commentaire: `${count} session(s)`, ip: requete.ip }, requete.log);
    return { fermees: count };
  });

  app.delete('/api/profil/sessions/:id', async (requete) => {
    const prefixe = z.string().regex(/^[0-9a-f]{16}$/).parse(requete.params.id);
    const sessions = await db.session.findMany({ where: { utilisateurId: requete.utilisateur.id, id: { startsWith: prefixe } } });
    if (sessions.length !== 1) throw introuvable('Session');
    if (sessions[0].id === requete.session.id) throw new ErreurHttp(422, 'Pour fermer cette session, utilisez « Se déconnecter ».');
    await fermerSession(sessions[0].id);
    return { fermees: 1 };
  });

  // ── Double authentification ───────────────────────────────────
  app.post('/api/profil/deux-facteurs', async (requete) => {
    if (requete.utilisateur.deuxFacteursActiveLe) throw new ErreurHttp(409, 'La double authentification est déjà active.');
    return preparer(requete.utilisateur);
  });

  app.post('/api/profil/deux-facteurs/confirmer', async (requete) => {
    const { code } = valider(schemaCodeDeuxFacteurs, requete.body);
    const u = await db.utilisateur.findUnique({ where: { id: requete.utilisateur.id } });
    if (!u.deuxFacteursSecret || u.deuxFacteursActiveLe) throw new ErreurHttp(409, 'Recommencez l’activation.');
    if (!(await verifierCode(u, code))) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { code: 'Code incorrect. Vérifiez l’heure de votre téléphone.' } });
    }
    await db.utilisateur.update({ where: { id: u.id }, data: { deuxFacteursActiveLe: new Date() } });
    const codesSecours = await genererCodesSecours(u.id);
    await journaliser({ utilisateurId: u.id, action: 'deux_facteurs.active', ip: requete.ip }, requete.log);
    return { codesSecours };
  });

  app.post('/api/profil/deux-facteurs/desactiver', async (requete) => {
    const { motDePasse } = valider(z.object({ motDePasse: z.string().min(1, { error: 'Saisissez votre mot de passe.' }) }), requete.body);
    // Désactiver une protection demande de prouver qu'on est bien le titulaire.
    if (!(await verifier(motDePasse, requete.utilisateur.motDePasse))) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { motDePasse: 'Mot de passe incorrect.' } });
    }
    await db.utilisateur.update({
      where: { id: requete.utilisateur.id },
      data: { deuxFacteursSecret: null, deuxFacteursActiveLe: null, codesSecours: null, deuxFacteursDernierPas: null },
    });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'deux_facteurs.desactive', ip: requete.ip }, requete.log);
    return { ok: true };
  });
}
