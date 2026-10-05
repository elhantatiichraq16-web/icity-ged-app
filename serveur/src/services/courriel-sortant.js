/**
 * Écrire à un client depuis l'application (§10).
 *
 * Le message part par le compte Gmail déjà configuré pour la relève : même
 * adresse, même mot de passe d'application, en SMTP cette fois. L'intérêt est
 * là — l'échange reste dans la boîte du client comme un mail ordinaire, et
 * la copie archivée dans iCity porte les mêmes en-têtes.
 *
 * Deux points qui comptent :
 *
 *  - **Le fil est conservé.** Une réponse porte `In-Reply-To` et `References`
 *    du message d'origine : le client la voit sous sa question, pas comme un
 *    message isolé. C'est ce qui permet aussi à `rattacherParFil` de relier
 *    l'envoi au bon client (§10).
 *  - **L'envoi est archivé tout de suite.** On n'attend pas la prochaine
 *    relève : le message apparaît dans l'écran dès qu'il est parti, avec son
 *    Message-ID réel — celui-là même que Gmail renverra, donc aucun doublon
 *    quand la relève passera sur le dossier « Envoyés ».
 */
import path from 'node:path';
import nodemailer from 'nodemailer';
import { db } from '../db.js';
import { filDe } from './courriel-entrant.js';
import { motDePasseDe } from './courriel-imap.js';
import { cheminComplet } from './stockage.js';

/** Gmail en SMTP : 465 en SSL direct, le même mot de passe d'application. */
const PORT_SMTP = 465;

/**
 * Le serveur d'envoi qui correspond au serveur de relève.
 *
 * `imap.gmail.com` → `smtp.gmail.com`. Pour un autre hébergeur, la même
 * substitution donne le bon nom dans l'immense majorité des cas.
 */
export function serveurSmtp(serveurImap) {
  return String(serveurImap).replace(/^imap\./i, 'smtp.');
}

function transportDe(compte) {
  return nodemailer.createTransport({
    host: serveurSmtp(compte.serveur),
    port: PORT_SMTP,
    secure: true,
    auth: { user: compte.adresse, pass: motDePasseDe(compte) },
  });
}

/** Le texte d'un message, replié en HTML simple : les retours à la ligne comptent. */
function htmlDepuisTexte(texte) {
  const echappe = String(texte).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;white-space:pre-wrap">${echappe}</div>`;
}

/**
 * Prépare les pièces jointes à partir de documents déjà dans le fonds.
 *
 * On joint le fichier stocké sous son nom d'origine : le client reçoit
 * « Marche signe.pdf », pas un UUID.
 */
async function piecesDepuisDocuments(documentIds) {
  if (!documentIds?.length) return { pieces: [], documents: [] };

  const documents = await db.document.findMany({
    where: { id: { in: documentIds }, supprimeLe: null },
    select: { id: true, nomOrigine: true, titre: true, cheminOriginal: true },
  });

  const pieces = documents
    .filter((d) => d.cheminOriginal)
    .map((d) => ({
      filename: d.nomOrigine || `${d.titre}${path.extname(d.cheminOriginal)}`,
      path: cheminComplet(d.cheminOriginal),
    }));

  return { pieces, documents };
}

/**
 * Envoie un message et l'archive.
 *
 * @param {object} options
 * @param {number} options.compteId le compte expéditeur
 * @param {string[]} options.a destinataires
 * @param {string} options.objet
 * @param {string} options.texte le corps, en texte brut
 * @param {number[]} [options.documentIds] documents du fonds à joindre
 * @param {number} [options.repondA] l'id du mail auquel on répond
 * @param {number} [options.clientId] rattachement explicite
 * @param {number} [options.marcheId]
 * @returns {Promise<object>} le mail archivé
 */
export async function envoyerMail({ compteId, a, objet, texte, documentIds = [], repondA = null, clientId = null, marcheId = null, log = console }) {
  const compte = await db.compteMail.findUnique({ where: { id: compteId } });
  if (!compte) throw new Error("Ce compte d'envoi n'existe pas.");
  if (!compte.actif) throw new Error('Ce compte est désactivé.');

  const destinataires = (Array.isArray(a) ? a : [a]).map((x) => String(x).trim()).filter(Boolean);
  if (!destinataires.length) throw new Error('Indiquez au moins un destinataire.');

  // Une réponse hérite du fil et du rattachement du message d'origine :
  // l'échange reste d'un seul tenant, chez le client comme chez nous.
  let origine = null;
  if (repondA) {
    origine = await db.mail.findUnique({ where: { id: repondA } });
    if (!origine) throw new Error("Le message auquel vous répondez n'existe plus.");
  }

  const { pieces, documents } = await piecesDepuisDocuments(documentIds);

  const references = origine
    ? [origine.referencesMail, origine.messageId].filter(Boolean).join(' ').trim()
    : undefined;

  const envoi = await transportDe(compte).sendMail({
    from: `"${compte.libelle}" <${compte.adresse}>`,
    to: destinataires.join(', '),
    subject: objet,
    text: texte,
    html: htmlDepuisTexte(texte),
    attachments: pieces,
    inReplyTo: origine?.messageId ?? undefined,
    references,
  });

  // Le Message-ID rendu par le serveur est celui que Gmail gardera : en
  // l'archivant tel quel, la relève du dossier « Envoyés » reconnaîtra ce
  // message comme déjà vu et ne le versera pas une seconde fois (§10).
  // Le rattachement explicite l'emporte ; sinon on hérite de celui du message
  // d'origine. Sans l'un ni l'autre, l'envoi rejoint la file « à rattacher ».
  const clientRetenu = clientId ?? origine?.clientId ?? null;
  const marcheRetenu = marcheId ?? origine?.marcheId ?? null;

  /*
   * À partir d'ici, le message est PARTI : on ne le rappelle pas. Si
   * l'archivage échoue — `messageId` est unique, l'objet limité à 255
   * caractères —, l'erreur ne doit pas laisser croire que rien n'a été
   * envoyé : sans cette trace, on renverrait le message une seconde fois.
   */
  const donnees = {
    compteId: compte.id,
    direction: 'envoye',
    messageId: envoi.messageId,
    inReplyTo: origine?.messageId ?? null,
    referencesMail: references || null,
    fil: filDe(objet),
    expediteur: compte.adresse,
    destinataires,
    date: new Date(),
    objet: String(objet).slice(0, 255),
    corpsTexte: texte,
    corpsHtml: htmlDepuisTexte(texte),
    clientId: clientRetenu,
    marcheId: marcheRetenu,
    statutRattachement: clientRetenu ? 'rattache' : 'a_rattacher',
  };

  let mail;
  try {
    mail = await db.mail.create({ data: donnees });
  } catch (erreur) {
    log.error?.(
      `Message ENVOYÉ mais non archivé (à ${destinataires.join(', ')} · Message-ID ${envoi.messageId}) : ${erreur.message}`,
    );
    const echec = new Error(
      "Le message est bien parti, mais n'a pas pu être archivé. Ne le renvoyez pas : vérifiez vos messages envoyés.",
    );
    echec.cause = erreur;
    echec.envoye = true;
    throw echec;
  }

  // Les documents joints restent liés au message : on saura ce qui est parti,
  // à qui et quand — sans dupliquer le fichier dans le stockage. Un seul
  // aller-retour, même avec vingt pièces.
  if (documents.length) {
    await db.pieceJointeMail.createMany({
      data: documents.map((document) => ({
        mailId: mail.id,
        nom: document.nomOrigine ?? document.titre,
        taille: BigInt(0),
        documentId: document.id,
      })),
    });
  }

  return mail;
}

/**
 * Vérifie que l'envoi est possible sans écrire à personne.
 *
 * Sert au bouton « Tester » de l'écran Paramètres : un mot de passe
 * d'application valide en IMAP ne l'est pas toujours en SMTP.
 */
/**
 * Un message interne de l'application (le rappel du matin) : il part par le
 * compte de messagerie, mais ne s'archive pas dans le courriel des affaires.
 *
 * @param {{ compteId: number, a: string, objet: string, texte: string }} options
 */
export async function envoyerSansArchiver({ compteId, a, objet, texte }) {
  const compte = await db.compteMail.findUnique({ where: { id: compteId } });
  if (!compte || !compte.actif) throw new Error("Aucun compte d'envoi actif.");
  await transportDe(compte).sendMail({ from: `"${compte.libelle}" <${compte.adresse}>`, to: a, subject: objet, text: texte, html: htmlDepuisTexte(texte) });
}

export async function testerEnvoi(compteId) {
  const compte = await db.compteMail.findUnique({ where: { id: compteId } });
  if (!compte) throw new Error("Ce compte n'existe pas.");
  try {
    await transportDe(compte).verify();
    return { ok: true, serveur: serveurSmtp(compte.serveur), port: PORT_SMTP };
  } catch (erreur) {
    return { ok: false, motif: erreur.message };
  }
}
