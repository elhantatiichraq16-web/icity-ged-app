/**
 * Écrire à un client depuis l'application (§10).
 *
 * Nodemailer est remplacé par un faux transport : on ne teste pas Gmail,
 * mais ce qui est à nous — les en-têtes du fil, l'archivage de l'envoi, les
 * pièces jointes prises dans le fonds, et les droits.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Ce que le faux transport a « envoyé ». */
const envois = [];

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message) => {
        envois.push(message);
        // Le vrai serveur rend le Message-ID qu'il a attribué.
        return { messageId: `<envoi-${envois.length}@icity.test>` };
      },
      verify: async () => true,
    }),
  },
}));

const { db } = await import('../src/db.js');
const { chiffrer } = await import('../src/securite/crypto.js');
const { envoyerMail, serveurSmtp } = await import('../src/services/courriel-sortant.js');
const { config } = await import('../src/config.js');
const { connecter, creerUtilisateur, en, nouvelleApp, viderBase } = await import('./outils.js');

let app;
let compte;
let client;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  envois.length = 0;
  await db.pieceJointeMail.deleteMany();
  await db.mail.deleteMany();
  await db.compteMail.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.client.deleteMany();
  await viderBase();

  client = await db.client.create({ data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR', domainesEmail: ['tgr.gov.ma'] } });
  compte = await db.compteMail.create({
    data: {
      libelle: 'iCity Documents',
      adresse: 'documents@icity.ma',
      serveur: 'imap.gmail.com',
      motDePasse: chiffrer('mot-de-passe-application'),
    },
  });
});

describe('le serveur d\'envoi', () => {
  it('se déduit du serveur de relève', () => {
    expect(serveurSmtp('imap.gmail.com')).toBe('smtp.gmail.com');
    expect(serveurSmtp('imap.ovh.net')).toBe('smtp.ovh.net');
  });
});

describe('envoyer un message', () => {
  it('part au destinataire et s\'archive aussitôt', async () => {
    const mail = await envoyerMail({
      compteId: compte.id,
      a: ['contact@tgr.gov.ma'],
      objet: 'Dossier 23C/2017',
      texte: 'Bonjour,\nVeuillez trouver le décompte.',
      clientId: client.id,
    });

    expect(envois).toHaveLength(1);
    expect(envois[0].to).toBe('contact@tgr.gov.ma');
    expect(envois[0].subject).toBe('Dossier 23C/2017');

    // L'envoi est visible dans l'écran sans attendre la prochaine relève.
    const archive = await db.mail.findUnique({ where: { id: mail.id } });
    expect(archive.direction).toBe('envoye');
    expect(archive.expediteur).toBe('documents@icity.ma');
    expect(archive.clientId).toBe(client.id);
    expect(archive.statutRattachement).toBe('rattache');
    // Le Message-ID archivé est celui rendu par le serveur : la relève du
    // dossier « Envoyés » y reconnaîtra un message déjà vu (§10).
    expect(archive.messageId).toBe('<envoi-1@icity.test>');
  });

  it('refuse un compte désactivé', async () => {
    await db.compteMail.update({ where: { id: compte.id }, data: { actif: false } });
    await expect(envoyerMail({ compteId: compte.id, a: ['x@tgr.gov.ma'], objet: 'o', texte: 't' })).rejects.toThrow(/désactivé/);
  });
});

describe('répondre à un message', () => {
  it('garde le fil et hérite du rattachement', async () => {
    const recu = await db.mail.create({
      data: {
        compteId: compte.id,
        direction: 'recu',
        messageId: '<question@tgr.gov.ma>',
        referencesMail: '<debut@tgr.gov.ma>',
        fil: 'dossier 23c/2017',
        expediteur: 'contact@tgr.gov.ma',
        date: new Date(),
        objet: 'Dossier 23C/2017',
        clientId: client.id,
        statutRattachement: 'rattache',
      },
    });

    const reponse = await envoyerMail({
      compteId: compte.id,
      a: ['contact@tgr.gov.ma'],
      objet: 'RE: Dossier 23C/2017',
      texte: 'Bien reçu.',
      repondA: recu.id,
    });

    // Chez le client, la réponse se range sous sa question.
    expect(envois[0].inReplyTo).toBe('<question@tgr.gov.ma>');
    expect(envois[0].references).toContain('<debut@tgr.gov.ma>');
    expect(envois[0].references).toContain('<question@tgr.gov.ma>');

    const archive = await db.mail.findUnique({ where: { id: reponse.id } });
    // « RE: » retiré : la réponse rejoint la conversation d'origine.
    expect(archive.fil).toBe('dossier 23c/2017');
    expect(archive.clientId).toBe(client.id);
  });
});

describe('joindre des documents du fonds', () => {
  it('les attache sous leur nom d\'origine et les lie au message', async () => {
    const relatif = 'documents/2026/piece-test.pdf';
    const complet = path.join(config.STOCKAGE, relatif);
    await fs.mkdir(path.dirname(complet), { recursive: true });
    await fs.writeFile(complet, '%PDF-1.4 decompte');

    const document = await db.document.create({
      data: {
        titre: 'Décompte 3',
        source: 'versement',
        cheminOriginal: relatif,
        nomOrigine: 'DECOMPTE_3.pdf',
        sha256: 'a'.repeat(64),
        taille: BigInt(17),
      },
    });

    const mail = await envoyerMail({
      compteId: compte.id,
      a: ['contact@tgr.gov.ma'],
      objet: 'Décompte',
      texte: 'Ci-joint.',
      documentIds: [document.id],
    });

    // Le client reçoit « DECOMPTE_3.pdf », pas un UUID.
    expect(envois[0].attachments).toHaveLength(1);
    expect(envois[0].attachments[0].filename).toBe('DECOMPTE_3.pdf');

    // On saura ce qui est parti, à qui et quand — sans dupliquer le fichier.
    const pieces = await db.pieceJointeMail.findMany({ where: { mailId: mail.id } });
    expect(pieces).toHaveLength(1);
    expect(pieces[0].documentId).toBe(document.id);

    await fs.rm(complet, { force: true });
  });

  it('ignore un document en corbeille', async () => {
    const document = await db.document.create({
      data: { titre: 'Supprimé', source: 'versement', cheminOriginal: 'documents/2026/x.pdf', sha256: 'b'.repeat(64), taille: BigInt(1), supprimeLe: new Date() },
    });
    await envoyerMail({ compteId: compte.id, a: ['x@tgr.gov.ma'], objet: 'o', texte: 't', documentIds: [document.id] });
    expect(envois[0].attachments ?? []).toHaveLength(0);
  });
});

describe('la route POST /api/mails', () => {
  it('interdit l\'envoi à un lecteur', async () => {
    const lecteur = await creerUtilisateur('lecteur');
    const session = await connecter(app, lecteur.email);
    const reponse = await en(app, session)('POST', '/api/mails', { a: ['x@tgr.gov.ma'], objet: 'o', texte: 't' });
    expect(reponse.statusCode).toBe(403);
    expect(envois).toHaveLength(0);
  });

  it('accepte un chef de projet et journalise l\'envoi', async () => {
    const chef = await creerUtilisateur('chef_projet');
    const session = await connecter(app, chef.email);
    const reponse = await en(app, session)('POST', '/api/mails', { a: ['contact@tgr.gov.ma'], objet: 'Relance', texte: 'Bonjour,', clientId: client.id });

    expect(reponse.statusCode).toBe(201);
    expect(envois).toHaveLength(1);

    const trace = await db.journal.findFirst({ where: { action: 'mail.envoye' } });
    expect(trace).not.toBeNull();
  });

  it('refuse un destinataire qui n\'est pas une adresse', async () => {
    const chef = await creerUtilisateur('chef_projet');
    const session = await connecter(app, chef.email);
    const reponse = await en(app, session)('POST', '/api/mails', { a: ['pas-une-adresse'], objet: 'o', texte: 't' });
    expect(reponse.statusCode).toBe(422);
    expect(envois).toHaveLength(0);
  });
});
