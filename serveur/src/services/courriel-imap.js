/**
 * La relève d'une boîte IMAP (§10) et l'enregistrement des messages.
 *
 * Deux règles tiennent la fiabilité :
 *
 *  - **On ne se fie pas à « non lu ».** Un mail lu avant d'être classé, et
 *    tout mail envoyé, seraient ignorés. On pose donc un libellé Gmail après
 *    traitement (`iCity-Verse`) et on mémorise le Message-ID : un message déjà
 *    vu n'est jamais retraité.
 *  - **Un verrou par compte.** Deux relèves simultanées verseraient les pièces
 *    jointes en double.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db } from '../db.js';
import { EN_COURS } from './archivage.js';
import { dechiffrer } from '../securite/crypto.js';
import { preparerMail, rattacherParFil } from './courriel-entrant.js';
import { recalculerPhase } from './phase-marche.js';
import { FORMATS, verserFichier } from './stockage.js';

/** Au-delà, on considère qu'une relève s'est interrompue et on reprend la main. */
const VERROU_PERIME_MINUTES = 15;

/** Les référentiels dont le rattachement a besoin. */
async function contexte(compte) {
  const [clients, marches] = await Promise.all([
    db.client.findMany({ orderBy: [{ interne: 'asc' }, { nom: 'asc' }] }),
    // Un mail qui cite un marché archivé reste « à rattacher » : il ne
    // rejoint pas tout seul une affaire qu'on a rangée.
    db.marche.findMany({ where: EN_COURS, select: { id: true, reference: true, referenceNormalisee: true } }),
  ]);
  return { compte, clients, marches };
}

/**
 * Le mot de passe d'application, tel que le serveur l'attend.
 *
 * Google l'affiche en quatre blocs, « abcd efgh ijkl mnop » : les espaces ne
 * servent qu'à la lecture, et on colle souvent le tout. Un mot de passe
 * d'application n'en contient jamais : on les retire ici, pour la relève comme
 * pour l'envoi.
 */
export function motDePasseDe(compte) {
  return dechiffrer(compte.motDePasse).replace(/\s+/g, '');
}

/**
 * La raison d'un échec de connexion, en clair pour l'écran Paramètres.
 *
 * ImapFlow ne dit que « Command failed » : la vraie cause est dans la réponse
 * du serveur, et c'est presque toujours le mot de passe.
 */
function raisonEchec(erreur, compte) {
  if (!erreur.authenticationFailed) {
    return erreur.responseText ? `${erreur.message} (${erreur.responseText})` : erreur.message;
  }
  const conseil = /(gmail|googlemail)\.com$/i.test(compte.serveur)
    ? ` Il faut un mot de passe d'application Google (16 lettres), créé pour ${compte.adresse}.`
    : '';
  return `Mot de passe refusé par le serveur (« ${erreur.responseText ?? erreur.message} »).${conseil}`;
}

/** Ouvre la connexion IMAP d'un compte. */
export async function connecter(compte) {
  const client = new ImapFlow({
    host: compte.serveur,
    port: compte.port,
    secure: compte.securite === 'ssl',
    auth: { user: compte.adresse, pass: motDePasseDe(compte) },
    logger: false,
    // Sur un PC lent, la poignée de main peut traîner.
    greetingTimeout: 20_000,
    socketTimeout: 120_000,
  });
  try {
    await client.connect();
  } catch (erreur) {
    // Après un refus, le socket reste ouvert : sans cette fermeture, il
    // expirait deux minutes plus tard en « erreur non rattrapée » du worker.
    client.close();
    throw new Error(raisonEchec(erreur, compte), { cause: erreur });
  }
  return client;
}

/** Vérifie les identifiants sans rien relever (bouton « Tester la connexion »). */
export async function tester(compte) {
  const client = await connecter(compte);
  try {
    const dossiers = await client.list();
    const trouve = dossiers.some((d) => d.path === compte.dossierSurveille || d.name === compte.dossierSurveille);
    return {
      ok: true,
      dossierTrouve: trouve,
      dossiers: dossiers.map((d) => d.path).slice(0, 60),
    };
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Prend le verrou du compte, ou rend false si une relève est déjà en cours. */
async function prendreVerrou(compteId) {
  const perime = new Date(Date.now() - VERROU_PERIME_MINUTES * 60_000);
  const { count } = await db.compteMail.updateMany({
    where: { id: compteId, OR: [{ releveEnCoursDepuis: null }, { releveEnCoursDepuis: { lt: perime } }] },
    data: { releveEnCoursDepuis: new Date() },
  });
  return count === 1;
}

const rendreVerrou = (compteId) => db.compteMail.update({ where: { id: compteId }, data: { releveEnCoursDepuis: null } });

/**
 * Enregistre un message analysé : le mail, ses pièces jointes devenues des
 * documents, et le rattachement.
 *
 * @returns {Promise<{ mail: object, pieces: number } | null>} null si déjà connu
 */
export async function enregistrerMessage(message, ctx, { utilisateurId = null } = {}) {
  const prepare = preparerMail(message, ctx);
  const { _raisons, ...donnees } = prepare;

  // Déjà vu : on ne retraite jamais (§10).
  const existant = await db.mail.findUnique({ where: { messageId: donnees.messageId } });
  if (existant) return null;

  const mail = await db.mail.create({ data: donnees });

  let pieces = 0;
  for (const jointe of message.attachments ?? []) {
    const nom = jointe.filename ?? `piece-${pieces + 1}`;
    const extension = path.extname(nom).toLowerCase();
    // Les signatures et logos en ligne ne sont pas des pièces du fonds.
    if (!FORMATS[extension] || jointe.contentDisposition === 'inline') continue;

    const provisoire = path.join(os.tmpdir(), `icity-mail-${crypto.randomUUID()}${extension}`);
    await fs.writeFile(provisoire, jointe.content);
    try {
      const { document, cree } = await verserFichier(provisoire, {
        nomOrigine: nom,
        marcheId: mail.marcheId,
        clientId: mail.clientId,
        // Une pièce venue du copieur est un original papier scanné (§10 bis).
        source: mail.direction === 'scanner' ? 'scan' : 'courriel',
        verseParId: utilisateurId,
      });
      await db.pieceJointeMail.create({ data: { mailId: mail.id, nom, taille: BigInt(jointe.size ?? 0), documentId: document.id } });
      if (cree) {
        pieces += 1;
        await poserEtiquettes(document.id, mail.direction);
        if (document.marcheId) await recalculerPhase(document.marcheId);
      }
    } finally {
      await fs.rm(provisoire, { force: true });
    }
  }

  return { mail, pieces, raisons: _raisons };
}

/** Les étiquettes de traitement d'une pièce venue du courriel (§4). */
async function poserEtiquettes(documentId, direction) {
  const noms = direction === 'scanner' ? ['Original papier'] : ['Versé depuis mail', direction === 'recu' ? 'Reçu' : 'Envoyé'];
  const etiquettes = await db.etiquette.findMany({ where: { nom: { in: noms } } });
  if (etiquettes.length) {
    await db.documentEtiquette.createMany({
      data: etiquettes.map((e) => ({ documentId, etiquetteId: e.id })),
      skipDuplicates: true,
    });
  }
}

/**
 * Relève une boîte : lit le dossier surveillé, enregistre ce qui est nouveau,
 * puis pose le libellé de traitement sur les messages traités.
 *
 * @param {object} compte
 * @param {{ limite?: number }} options
 */
export async function relever(compte, { limite = 200 } = {}) {
  if (!(await prendreVerrou(compte.id))) {
    return { ignoree: true, motif: 'une relève est déjà en cours' };
  }

  const releve = await db.releve.create({ data: { compteId: compte.id } });
  const ctx = await contexte(compte);
  let client;
  let mailsLus = 0;
  let piecesVersees = 0;
  const nouveaux = [];

  try {
    client = await connecter(compte);
    const verrouBoite = await client.getMailboxLock(compte.dossierSurveille);
    try {
      // Au premier passage, on ne remonte pas toute la boîte (§10).
      const depuis = new Date(Date.now() - compte.ageMaxJours * 86_400_000);
      const uids = await client.search({ since: depuis }, { uid: true });
      const aTraiter = (uids ?? []).slice(-limite);

      for (const uid of aTraiter) {
        const brut = await client.download(uid, undefined, { uid: true });
        const message = await simpleParser(brut.content);
        const resultat = await enregistrerMessage(message, ctx);
        if (!resultat) continue;

        mailsLus += 1;
        piecesVersees += resultat.pieces;
        nouveaux.push(resultat.mail);

        // Le libellé Gmail marque ce qui est entré — sans retirer le message
        // de la boîte, et sans se fier à « lu / non lu » (§10).
        if (compte.libelleTraitement) {
          await client.messageCopy(uid, compte.libelleTraitement, { uid: true }).catch(() => {});
        }
      }
    } finally {
      verrouBoite.release();
    }

    // Les envois sans client se rattachent au fil de leur échange (§10).
    const tous = await db.mail.findMany({ where: { compteId: compte.id }, select: { id: true, fil: true, direction: true, clientId: true } });
    for (const { id, clientId } of rattacherParFil(tous)) {
      await db.mail.update({ where: { id }, data: { clientId, statutRattachement: 'rattache' } });
    }

    await db.releve.update({ where: { id: releve.id }, data: { fin: new Date(), mailsLus, piecesVersees } });
    await db.compteMail.update({ where: { id: compte.id }, data: { derniereReleve: new Date() } });
    return { mailsLus, piecesVersees, nouveaux };
  } catch (erreur) {
    await db.releve.update({ where: { id: releve.id }, data: { fin: new Date(), mailsLus, piecesVersees, erreur: String(erreur.message).slice(0, 1000) } });
    throw erreur;
  } finally {
    await client?.logout().catch(() => {});
    await rendreVerrou(compte.id);
  }
}

/** Relève tous les comptes actifs. Appelée par le planificateur. */
export async function releverTout(log = console) {
  const comptes = await db.compteMail.findMany({ where: { actif: true } });
  const bilan = [];
  for (const compte of comptes) {
    try {
      bilan.push({ compte: compte.adresse, ...(await relever(compte)) });
    } catch (erreur) {
      log.error?.({ err: erreur }, `Relève impossible pour ${compte.adresse}`);
      bilan.push({ compte: compte.adresse, erreur: erreur.message });
    }
  }
  return bilan;
}

/**
 * Écoute une boîte en IMAP IDLE : Gmail prévient dès qu'un message arrive
 * (§10 bis). En cas de coupure, on se reconnecte ; si IDLE échoue, l'appelant
 * retombe sur une relève chaque minute.
 */
export async function ecouter(compte, { surNouveau, log = console } = {}) {
  // Une coupure IMAP est ordinaire : Gmail ferme les connexions IDLE au bout
  // de quelques dizaines de minutes, et le Wi-Fi tombe. On se rebranche après
  // une attente qui double à chaque échec, sans dépasser cinq minutes.
  const ATTENTE_MIN = 5_000;
  const ATTENTE_MAX = 300_000;
  let attente = ATTENTE_MIN;
  let client = null;
  let arrete = false;
  let minuterie = null;

  async function brancher() {
    client = await connecter(compte);
    const verrou = await client.getMailboxLock(compte.dossierSurveille);
    verrou.release();

    // Sans cet écouteur, ImapFlow émet « error » dans le vide et Node abat le
    // processus : une simple coupure réseau suffisait à tuer le worker.
    client.on('error', (erreur) => {
      if (arrete) return;
      log.error?.({ err: erreur }, `Connexion IMAP perdue sur ${compte.adresse} : ${erreur.message}`);
      replanifier();
    });

    client.on('close', () => {
      if (!arrete) replanifier();
    });

    client.on('exists', async () => {
      try {
        const resultat = await relever(compte, { limite: 20 });
        if (resultat?.nouveaux?.length) await surNouveau?.(resultat);
      } catch (erreur) {
        log.error?.({ err: erreur }, 'Relève déclenchée par IDLE en échec');
      }
    });

    // La connexion tient : on repart d'une attente courte au prochain incident.
    attente = ATTENTE_MIN;
  }

  function replanifier() {
    if (arrete || minuterie) return;
    const client_mort = client;
    client = null;
    client_mort?.removeAllListeners();
    client_mort?.logout().catch(() => {});

    minuterie = setTimeout(async () => {
      minuterie = null;
      if (arrete) return;
      try {
        await brancher();
        log.log?.(`Écoute IMAP rétablie sur ${compte.adresse}.`);
      } catch (erreur) {
        // Toujours pas : on réessaie plus tard. La relève toutes les dix
        // minutes continue de tourner pendant ce temps, rien n'est perdu.
        log.error?.({ err: erreur }, `Reconnexion IMAP impossible (${compte.adresse}) : ${erreur.message}`);
        attente = Math.min(attente * 2, ATTENTE_MAX);
        replanifier();
      }
    }, attente);
    minuterie.unref?.();
  }

  await brancher();

  return {
    get client() {
      return client;
    },
    async arreter() {
      arrete = true;
      clearTimeout(minuterie);
      minuterie = null;
      client?.removeAllListeners();
      await client?.logout().catch(() => {});
    },
  };
}
