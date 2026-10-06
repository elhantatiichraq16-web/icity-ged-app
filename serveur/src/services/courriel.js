/**
 * Envoi des e-mails de l'application : invitation et réinitialisation.
 *
 * Ils partent par le compte mail de l'application (Paramètres → Comptes mail)
 * quand il y en a un d'actif : c'est le cas dès qu'un Gmail est configuré.
 * Sinon, par le serveur SMTP du .env (Mailpit en développement, qui attrape
 * les messages sans les distribuer). En test, rien ne sort : les messages
 * sont gardés en mémoire pour que les tests puissent les lire.
 *
 * (La relève des boîtes IMAP, elle, vit dans courriel-imap.js.)
 */
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { db } from '../db.js';
import { transportDe } from './courriel-sortant.js';

/** Les messages « envoyés » pendant les tests. */
export const boiteDeTest = [];

const transport = config.estTest
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({
      host: config.MAIL_HOTE,
      port: config.MAIL_PORT,
      secure: config.MAIL_PORT === 465,
      auth: config.MAIL_UTILISATEUR ? { user: config.MAIL_UTILISATEUR, pass: config.MAIL_MOT_DE_PASSE } : undefined,
    });

/** Échappe le texte inséré dans le HTML du message (un nom peut contenir « < »). */
function html(texte) {
  return String(texte).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Gabarit commun : un message court, un bouton, le lien en clair en secours. */
function gabarit({ titre, paragraphes, bouton, lien, note }) {
  const corps = paragraphes.map((p) => `<p style="margin:0 0 14px;line-height:1.6">${html(p)}</p>`).join('');
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#F4F6F8;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:linear-gradient(152deg,#0B93A5,#0E8296 55%,#054f59);padding:22px 28px;color:#fff;font-weight:700;letter-spacing:.02em">iCity GED</div>
    <div style="padding:28px">
      <h1 style="margin:0 0 18px;font-size:20px">${html(titre)}</h1>
      ${corps}
      <p style="margin:24px 0"><a href="${html(lien)}" style="background:#0E8296;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${html(bouton)}</a></p>
      <p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">Si le bouton ne fonctionne pas, copiez ce lien : ${html(lien)}</p>
      ${note ? `<p style="margin:18px 0 0;font-size:12px;color:#64748b">${html(note)}</p>` : ''}
    </div>
  </div></body></html>`;
}

async function envoyer({ a, sujet, texte, contenuHtml }) {
  if (!config.estTest) {
    const compte = await db.compteMail.findFirst({ where: { actif: true }, orderBy: { id: 'asc' } });
    if (compte) return transportDe(compte).sendMail({ from: `"iCity GED" <${compte.adresse}>`, to: a, subject: sujet, text: texte, html: contenuHtml });
  }
  const info = await transport.sendMail({ from: config.MAIL_EXPEDITEUR, to: a, subject: sujet, text: texte, html: contenuHtml });
  if (config.estTest) boiteDeTest.push({ a, sujet, texte });
  return info;
}

export function envoyerInvitation({ a, nom, invitePar, lien }) {
  return envoyer({
    a,
    sujet: 'Votre accès à iCity GED',
    texte: `Bonjour ${nom},\n\n${invitePar} vous a créé un compte sur iCity GED.\nChoisissez votre mot de passe (lien valable 7 jours) :\n${lien}\n`,
    contenuHtml: gabarit({
      titre: `Bienvenue, ${nom}`,
      paragraphes: [`${invitePar} vous a créé un compte sur iCity GED, la gestion documentaire des marchés d'iCity.`, 'Pour activer votre accès, choisissez votre mot de passe.'],
      bouton: 'Choisir mon mot de passe',
      lien,
      note: 'Ce lien est valable 7 jours et ne sert qu’une fois.',
    }),
  });
}

export function envoyerReinitialisation({ a, nom, lien }) {
  return envoyer({
    a,
    sujet: 'Réinitialisation de votre mot de passe iCity GED',
    texte: `Bonjour ${nom},\n\nPour choisir un nouveau mot de passe (lien valable 60 minutes) :\n${lien}\n\nSi vous n'avez rien demandé, ignorez ce message.\n`,
    contenuHtml: gabarit({
      titre: 'Nouveau mot de passe',
      paragraphes: [`Bonjour ${nom},`, 'Une réinitialisation du mot de passe a été demandée pour votre compte.'],
      bouton: 'Choisir un nouveau mot de passe',
      lien,
      note: "Ce lien est valable 60 minutes. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.",
    }),
  });
}
