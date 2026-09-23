import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { simpleParser } from 'mailparser';
import { db } from '../src/db.js';
import { adresseDe, clientDuMessage, directionDe, filDe, nettoyerHtml, rattacherParFil, referenceDeLObjet } from '../src/services/courriel-entrant.js';
import { enregistrerMessage } from '../src/services/courriel-imap.js';
import { chiffrer } from '../src/securite/crypto.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let compte;
let client;
let marche;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.pieceJointeMail.deleteMany();
  await db.mail.deleteMany();
  await db.releve.deleteMany();
  await db.compteMail.deleteMany();
  await db.doublon.deleteMany();
  await db.suggestion.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany();
  await db.etiquette.deleteMany();
  await viderBase();

  client = await db.client.create({ data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR', domainesEmail: ['tgr.gov.ma'], synonymes: ['tresorerie generale'] } });
  marche = await db.marche.create({ data: { reference: '23C/2017/TGR', referenceNormalisee: '23/2017/TGR#C', lot: 'C', clientId: client.id } });
  for (const nom of ['Versé depuis mail', 'Reçu', 'Envoyé', 'Original papier']) {
    await db.etiquette.create({ data: { nom, couleur: '#6247A8', famille: 'traitement' } });
  }
  compte = await db.compteMail.create({
    data: {
      libelle: 'Boîte documentaire',
      adresse: 'documents@icity.ma',
      serveur: 'imap.gmail.com',
      motDePasse: chiffrer('mot-de-passe-application'),
      adressesScanner: ['copieur@icity.ma'],
    },
  });
});

/** Un message .eml, comme ceux qu'on relèverait dans la boîte. */
function eml({ de, a = 'documents@icity.ma', objet, corps = 'Bonjour,\n\nCi-joint la pièce demandée.\n', html, piece, messageId = `<${Math.random().toString(36).slice(2)}@exemple.ma>`, inReplyTo }) {
  const limite = '----icity-test';
  const entetes = [
    `From: ${de}`,
    `To: ${a}`,
    `Subject: ${objet}`,
    `Message-ID: ${messageId}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    'Date: Wed, 17 Sep 2026 10:00:00 +0100',
    'MIME-Version: 1.0',
  ].filter(Boolean);

  if (!piece && !html) {
    return `${entetes.join('\r\n')}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${corps}`;
  }

  const parties = [`--${limite}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${corps}\r\n`];
  if (html) parties.push(`--${limite}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n`);
  if (piece) {
    // Un PDF minimal mais valide : il doit passer le versement.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');
    parties.push(`--${limite}\r\nContent-Type: application/pdf; name="${piece}"\r\nContent-Disposition: attachment; filename="${piece}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${pdf}\r\n`);
  }
  return `${entetes.join('\r\n')}\r\nContent-Type: multipart/mixed; boundary="${limite}"\r\n\r\n${parties.join('')}--${limite}--\r\n`;
}

const contexte = async () => ({
  compte,
  clients: await db.client.findMany(),
  marches: await db.marche.findMany({ select: { id: true, reference: true, referenceNormalisee: true } }),
});

describe('lecture d’un message', () => {
  it('normalise l’objet en fil de discussion (§10)', () => {
    expect(filDe('RE: TR: Transmission du PV')).toBe('transmission du pv');
    expect(filDe('Réf : Réception provisoire')).toBe('reception provisoire');
    expect(filDe('Transmission du PV')).toBe(filDe('Fwd: Transmission du PV'));
  });

  it('extrait l’adresse seule', () => {
    expect(adresseDe('Service Marchés <marches@tgr.gov.ma>')).toBe('marches@tgr.gov.ma');
    expect(adresseDe('marches@tgr.gov.ma')).toBe('marches@tgr.gov.ma');
  });

  it('distingue reçu, envoyé et scanner (§10 bis)', () => {
    expect(directionDe({ expediteur: 'marches@tgr.gov.ma', compte })).toBe('recu');
    expect(directionDe({ expediteur: 'Documents <documents@icity.ma>', compte })).toBe('envoye');
    expect(directionDe({ expediteur: 'copieur@icity.ma', compte })).toBe('scanner');
  });

  it('reconnaît le client par le domaine, puis par le nom', async () => {
    const clients = await db.client.findMany();
    expect(clientDuMessage({ direction: 'recu', expediteur: 'a@tgr.gov.ma', clients }).client.id).toBe(client.id);
    expect(clientDuMessage({ direction: 'recu', expediteur: 'Trésorerie Générale du Royaume <x@autre.ma>', clients }).client.id).toBe(client.id);
    expect(clientDuMessage({ direction: 'recu', expediteur: 'inconnu@nulle-part.ma', clients })).toBeNull();
  });

  it('lit une référence de marché dans l’objet', () => {
    expect(referenceDeLObjet('Scan du 17/09 — marché 23C/2017/TGR')).toBe('23C/2017/TGR');
    expect(referenceDeLObjet('Bon de commande 10879/2018')).toBe('10879/2018');
    expect(referenceDeLObjet('Dossier M17-2022 complet')).toBe('17/2022');
    expect(referenceDeLObjet('Bonjour')).toBeNull();
  });

  it('nettoie le HTML : ni script, ni lien javascript (§13)', () => {
    const propre = nettoyerHtml('<p>Bonjour<script>alert(1)</script></p><a href="javascript:alert(1)">clic</a><img src="x.png">');
    expect(propre).not.toMatch(/script/i);
    expect(propre).not.toMatch(/javascript:/i);
    expect(propre).not.toMatch(/<img/i);
    expect(propre).toMatch(/Bonjour/);
  });
});

describe('enregistrement d’un message', () => {
  it('range un mail reçu, son client et sa pièce jointe', async () => {
    const message = await simpleParser(eml({ de: 'Service Marchés <marches@tgr.gov.ma>', objet: 'Transmission du PV — marché 23C/2017/TGR', piece: 'PV_RECEPTION.pdf' }));
    const r = await enregistrerMessage(message, await contexte());

    expect(r.mail.direction).toBe('recu');
    expect(r.mail.clientId).toBe(client.id);
    expect(r.mail.marcheId).toBe(marche.id);
    expect(r.pieces).toBe(1);

    const document = await db.document.findFirst({ where: { nomOrigine: 'PV_RECEPTION.pdf' }, include: { etiquettes: { include: { etiquette: true } } } });
    expect(document.source).toBe('courriel');
    expect(document.marcheId).toBe(marche.id);
    expect(document.etiquettes.map((e) => e.etiquette.nom)).toEqual(expect.arrayContaining(['Versé depuis mail', 'Reçu']));
  });

  it('ne retraite jamais un message déjà vu (§10)', async () => {
    const brut = eml({ de: 'marches@tgr.gov.ma', objet: 'Doublon', messageId: '<meme-id@exemple.ma>' });
    const ctx = await contexte();
    expect(await enregistrerMessage(await simpleParser(brut), ctx)).not.toBeNull();
    expect(await enregistrerMessage(await simpleParser(brut), ctx)).toBeNull();
    expect(await db.mail.count()).toBe(1);
  });

  it('un mail du copieur : pièces versées en « scan », corps non conservé (§10 bis)', async () => {
    const message = await simpleParser(eml({ de: 'copieur@icity.ma', objet: 'Scan 23C/2017/TGR', piece: 'scan0042.pdf' }));
    const r = await enregistrerMessage(message, await contexte());

    expect(r.mail.direction).toBe('scanner');
    expect(r.mail.corpsTexte).toBeNull();
    // L'objet portait la référence : la pièce est rattachée dès l'arrivée.
    expect(r.mail.marcheId).toBe(marche.id);

    const document = await db.document.findFirst({ where: { nomOrigine: 'scan0042.pdf' }, include: { etiquettes: { include: { etiquette: true } } } });
    expect(document.source).toBe('scan');
    expect(document.etiquettes.map((e) => e.etiquette.nom)).toContain('Original papier');
  });

  it('un envoi sans client se rattache au fil de l’échange (§10)', async () => {
    const ctx = await contexte();
    await enregistrerMessage(await simpleParser(eml({ de: 'marches@tgr.gov.ma', objet: 'Demande de caution', messageId: '<recu-1@x.ma>' })), ctx);
    await enregistrerMessage(
      await simpleParser(eml({ de: 'documents@icity.ma', a: 'inconnu@ailleurs.ma', objet: 'RE: Demande de caution', messageId: '<envoye-1@x.ma>', inReplyTo: '<recu-1@x.ma>' })),
      ctx,
    );

    const mails = await db.mail.findMany({ select: { id: true, fil: true, direction: true, clientId: true } });
    const rattachements = rattacherParFil(mails);
    expect(rattachements).toHaveLength(1);
    expect(rattachements[0].clientId).toBe(client.id);
  });

  it('deux clients sur le même objet : on ne devine pas', async () => {
    const autre = await db.client.create({ data: { nom: 'Barid Al-Maghrib', domainesEmail: ['barid.ma'] } });
    const mails = [
      { id: 1, fil: 'transmission', direction: 'recu', clientId: client.id },
      { id: 2, fil: 'transmission', direction: 'recu', clientId: autre.id },
      { id: 3, fil: 'transmission', direction: 'envoye', clientId: null },
    ];
    expect(rattacherParFil(mails)).toHaveLength(0);
  });
});

describe('API du courriel', () => {
  async function deuxMails() {
    const ctx = await contexte();
    await enregistrerMessage(await simpleParser(eml({ de: 'marches@tgr.gov.ma', objet: 'Transmission du PV', messageId: '<a@x.ma>', piece: 'PV.pdf' })), ctx);
    await enregistrerMessage(await simpleParser(eml({ de: 'inconnu@nulle-part.ma', objet: 'Question diverse', messageId: '<b@x.ma>' })), ctx);
  }

  it('liste les messages, avec la file « à rattacher »', async () => {
    await deuxMails();
    const requete = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const r = (await requete('GET', '/api/mails')).json();
    expect(r.total).toBe(2);
    expect(r.aRattacher).toBe(1);
    expect(r.mails[0].piecesJointes.length + r.mails[1].piecesJointes.length).toBe(1);
  });

  it('rattache un message à la main, et ses pièces suivent', async () => {
    await deuxMails();
    const mail = await db.mail.findFirst({ where: { statutRattachement: 'a_rattacher' } });
    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));

    const r = await requete('PATCH', `/api/mails/${mail.id}`, { clientId: client.id, marcheId: marche.id });
    expect(r.statusCode).toBe(200);
    expect(r.json().statutRattachement).toBe('rattache');
  });

  it('groupe les échanges d’un client par fil', async () => {
    await deuxMails();
    const requete = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const fils = (await requete('GET', `/api/echanges?clientId=${client.id}`)).json();
    expect(fils).toHaveLength(1);
    expect(fils[0].messages).toHaveLength(1);
  });

  it('sert le corps HTML avec une politique qui interdit tout script (§13)', async () => {
    const ctx = await contexte();
    await enregistrerMessage(await simpleParser(eml({ de: 'marches@tgr.gov.ma', objet: 'Avec html', html: '<p>Bonjour <b>Ichrak</b></p>', messageId: '<html@x.ma>' })), ctx);
    const mail = await db.mail.findFirstOrThrow();
    const requete = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));

    const r = await requete('GET', `/api/mails/${mail.id}/corps`);
    expect(r.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(r.body).toMatch(/Bonjour/);
  });

  it('un lecteur ne voit pas le courriel, un non-administrateur ne configure pas les comptes', async () => {
    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('GET', '/api/mails')).statusCode).toBe(403);

    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    expect((await directeur('GET', '/api/comptes-mail')).statusCode).toBe(403);
  });

  it('crée un compte mail sans jamais rendre son mot de passe', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('administrateur')).email));
    const r = await requete('POST', '/api/comptes-mail', {
      libelle: 'Boîte scans',
      adresse: 'scans@icity.ma',
      serveur: 'imap.gmail.com',
      port: 993,
      securite: 'ssl',
      motDePasse: 'mot-de-passe-application',
      adressesScanner: ['copieur@icity.ma'],
    });
    expect(r.statusCode).toBe(201);
    expect(JSON.stringify(r.json())).not.toMatch(/mot-de-passe-application/);

    const enBase = await db.compteMail.findFirst({ where: { adresse: 'scans@icity.ma' } });
    expect(enBase.motDePasse).not.toBe('mot-de-passe-application');
  });
});
