/**
 * Le courriel (§10) : comptes surveillés, liste des messages, lecture,
 * rattachement manuel, et les échanges d'un client ou d'un marché.
 */
import { z } from 'zod';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { chiffrer } from '../securite/crypto.js';
import { relever, tester } from '../services/courriel-imap.js';
import { envoyerMail, testerEnvoi } from '../services/courriel-sortant.js';
import { journaliser } from '../services/journal.js';

const schemaCompte = z.object({
  libelle: z.string().trim().min(2).max(120),
  adresse: z.string().trim().toLowerCase().pipe(z.email()),
  serveur: z.string().trim().min(3).max(120).default('imap.gmail.com'),
  port: z.number().int().min(1).max(65535).default(993),
  securite: z.enum(['ssl', 'starttls', 'aucune']).default('ssl'),
  motDePasse: z.string().min(8).max(200).optional(),
  dossierSurveille: z.string().trim().min(1).max(120).default('iCity-Documents'),
  libelleTraitement: z.string().trim().max(120).default('iCity-Verse'),
  adressesScanner: z.array(z.string().trim().toLowerCase()).default([]),
  ageMaxJours: z.number().int().min(1).max(3650).default(30),
  actif: z.boolean().default(true),
});

const schemaEnvoi = z.object({
  compteId: z.number().int().positive().optional(),
  a: z.array(z.string().trim().toLowerCase().pipe(z.email())).min(1, 'Indiquez au moins un destinataire.').max(20),
  objet: z.string().trim().min(1, "L'objet est obligatoire.").max(255),
  texte: z.string().trim().min(1, 'Le message est vide.').max(50_000),
  documentIds: z.array(z.number().int().positive()).max(20).default([]),
  repondA: z.number().int().positive().nullable().default(null),
  clientId: z.number().int().positive().nullable().default(null),
  marcheId: z.number().int().positive().nullable().default(null),
});

/** Un compte tel qu'il s'affiche : jamais le mot de passe. */
function vueCompte(c, derniereReleve) {
  return {
    id: c.id,
    libelle: c.libelle,
    adresse: c.adresse,
    serveur: c.serveur,
    port: c.port,
    securite: c.securite,
    dossierSurveille: c.dossierSurveille,
    libelleTraitement: c.libelleTraitement,
    adressesScanner: c.adressesScanner ?? [],
    ageMaxJours: c.ageMaxJours,
    actif: c.actif,
    derniereReleve: c.derniereReleve,
    releveEnCours: Boolean(c.releveEnCoursDepuis),
    derniereReleveDetail: derniereReleve ?? null,
  };
}

function vueMail(m) {
  return {
    id: m.id,
    direction: m.direction,
    objet: m.objet,
    expediteur: m.expediteur,
    destinataires: m.destinataires ?? [],
    date: m.date,
    fil: m.fil,
    client: m.client ? { id: m.client.id, nom: m.client.nom } : null,
    marche: m.marche ? { id: m.marche.id, reference: m.marche.reference } : null,
    statutRattachement: m.statutRattachement,
    piecesJointes: (m.piecesJointes ?? []).map((p) => ({ id: p.id, nom: p.nom, documentId: p.documentId, taille: p.taille ? Number(p.taille) : null })),
  };
}

const AVEC = { client: true, marche: true, piecesJointes: true };

/** @param {import('fastify').FastifyInstance} app */
export default async function routesCourriel(app) {
  app.addHook('preHandler', exigerConnexion);
  const admin = { preHandler: exiger('gerer', 'CompteMail') };

  // ── Comptes surveillés (Paramètres) ───────────────────────────
  app.get('/api/comptes-mail', admin, async () => {
    const comptes = await db.compteMail.findMany({ orderBy: { id: 'asc' } });
    const releves = await db.releve.findMany({ orderBy: { debut: 'desc' }, take: 20 });
    return comptes.map((c) => vueCompte(c, releves.find((r) => r.compteId === c.id) ?? null));
  });

  app.post('/api/comptes-mail', admin, async (requete, reponse) => {
    const donnees = valider(schemaCompte, requete.body);
    if (!donnees.motDePasse) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { motDePasse: "Saisissez le mot de passe d'application." } });
    }
    const cree = await db.compteMail.create({
      // Le mot de passe est chiffré (AES-256-GCM) avant d'entrer en base (§10).
      data: { ...donnees, motDePasse: chiffrer(donnees.motDePasse) },
    });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'compte_mail.cree', objetType: 'CompteMail', objetId: cree.id, apres: { adresse: cree.adresse }, ip: requete.ip }, requete.log);
    return reponse.code(201).send(vueCompte(cree));
  });

  app.patch('/api/comptes-mail/:id', admin, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const compte = await db.compteMail.findUnique({ where: { id } });
    if (!compte) throw introuvable('Compte mail');

    const donnees = valider(schemaCompte.partial(), requete.body);
    const data = { ...donnees };
    // Un mot de passe vide veut dire « ne change rien », pas « efface-le ».
    if (data.motDePasse) data.motDePasse = chiffrer(data.motDePasse);
    else delete data.motDePasse;

    const modifie = await db.compteMail.update({ where: { id }, data });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'compte_mail.modifie', objetType: 'CompteMail', objetId: id, ip: requete.ip }, requete.log);
    return vueCompte(modifie);
  });

  app.post('/api/comptes-mail/:id/tester', admin, async (requete) => {
    const compte = await db.compteMail.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!compte) throw introuvable('Compte mail');
    try {
      const resultat = await tester(compte);
      return {
        ...resultat,
        message: resultat.dossierTrouve
          ? `Connexion réussie. Le libellé « ${compte.dossierSurveille} » existe.`
          : `Connexion réussie, mais le libellé « ${compte.dossierSurveille} » est introuvable. Créez-le dans Gmail.`,
      };
    } catch (erreur) {
      return { ok: false, message: `Connexion refusée : ${erreur.message}` };
    }
  });

  app.post('/api/comptes-mail/:id/relever', admin, async (requete) => {
    const compte = await db.compteMail.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!compte) throw introuvable('Compte mail');
    try {
      const resultat = await relever(compte);
      if (resultat.ignoree) return { ...resultat, message: 'Une relève est déjà en cours.' };
      await journaliser(
        { utilisateurId: requete.utilisateur.id, action: 'courriel.releve', commentaire: `${resultat.mailsLus} message(s), ${resultat.piecesVersees} pièce(s)`, ip: requete.ip },
        requete.log,
      );
      return { ...resultat, message: `${resultat.mailsLus} nouveau(x) message(s), ${resultat.piecesVersees} pièce(s) versée(s).` };
    } catch (erreur) {
      throw new ErreurHttp(502, `Relève impossible : ${erreur.message}`);
    }
  });

  // ── Les messages ──────────────────────────────────────────────
  app.get('/api/mails', { preHandler: exiger('lire', 'Mail') }, async (requete) => {
    const { direction, clientId, marcheId, statut, q, page = '1' } = requete.query;
    const parPage = 30;
    const numero = Math.max(1, Number(page) || 1);

    const where = {
      ...(direction ? { direction: String(direction) } : {}),
      ...(clientId ? { clientId: Number(clientId) } : {}),
      ...(marcheId ? { marcheId: Number(marcheId) } : {}),
      ...(statut ? { statutRattachement: String(statut) } : {}),
      ...(q ? { OR: [{ objet: { contains: String(q) } }, { expediteur: { contains: String(q) } }, { corpsTexte: { contains: String(q) } }] } : {}),
    };

    const [total, mails, compteurs] = await Promise.all([
      db.mail.count({ where }),
      db.mail.findMany({ where, include: AVEC, orderBy: { date: 'desc' }, skip: (numero - 1) * parPage, take: parPage }),
      db.mail.groupBy({ by: ['direction'], _count: { _all: true } }),
    ]);

    return {
      total,
      page: numero,
      pages: Math.max(1, Math.ceil(total / parPage)),
      mails: mails.map(vueMail),
      compteurs: Object.fromEntries(compteurs.map((c) => [c.direction, c._count._all])),
      aRattacher: await db.mail.count({ where: { statutRattachement: 'a_rattacher' } }),
    };
  });

  /**
   * Les messages groupés par conversation (§10).
   *
   * Une boîte mail se lit par échange, pas par message isolé : les réponses
   * d'un même fil s'empilent sous la question d'origine. Le regroupement se
   * fait sur `fil` — l'objet normalisé, sans RE/TR/FW ni accents.
   */
  app.get('/api/conversations', { preHandler: exiger('lire', 'Mail') }, async (requete) => {
    const { direction, clientId, marcheId, statut, q, page = '1' } = requete.query;
    const parPage = 25;
    const numero = Math.max(1, Number(page) || 1);

    const where = {
      ...(direction ? { direction: String(direction) } : {}),
      ...(clientId ? { clientId: Number(clientId) } : {}),
      ...(marcheId ? { marcheId: Number(marcheId) } : {}),
      ...(statut ? { statutRattachement: String(statut) } : {}),
      ...(q ? { OR: [{ objet: { contains: String(q) } }, { expediteur: { contains: String(q) } }, { corpsTexte: { contains: String(q) } }] } : {}),
    };

    // Les fils de la page demandée, les plus récents d'abord. On passe par
    // une requête dédiée plutôt que de tronquer la liste des messages : un
    // échange ancien mais actif ne doit pas disparaître parce que des
    // messages récents l'ont repoussé hors d'une limite arbitraire.
    const filsPage = await db.mail.groupBy({
      by: ['fil'],
      where,
      _max: { date: true },
      orderBy: { _max: { date: 'desc' } },
      skip: (numero - 1) * parPage,
      take: parPage,
    });
    const totalFils = (await db.mail.groupBy({ by: ['fil'], where, _count: { _all: true } })).length;

    // Tous les messages des fils retenus : la conversation se lit entière.
    const mails = filsPage.length
      ? await db.mail.findMany({
          where: { AND: [where, { fil: { in: filsPage.map((f) => f.fil) } }] },
          include: AVEC,
          orderBy: { date: 'desc' },
        })
      : [];

    const fils = new Map();
    for (const mail of mails) {
      const cle = mail.fil || `mail-${mail.id}`;
      if (!fils.has(cle)) fils.set(cle, []);
      fils.get(cle).push(mail);
    }

    const conversations = [...fils.entries()].map(([fil, liste]) => {
      // La liste arrive du plus récent au plus ancien : le dernier message
      // porte l'objet affiché et la date de l'échange.
      const dernier = liste[0];
      return {
        fil,
        objet: dernier.objet,
        dernierLe: dernier.date,
        messages: liste.length,
        pieces: liste.reduce((n, m) => n + (m.piecesJointes?.length ?? 0), 0),
        directions: [...new Set(liste.map((m) => m.direction))],
        aRattacher: liste.some((m) => m.statutRattachement === 'a_rattacher'),
        client: dernier.client ? { id: dernier.client.id, nom: dernier.client.nom } : null,
        marche: dernier.marche ? { id: dernier.marche.id, reference: dernier.marche.reference } : null,
        apercu: (dernier.corpsTexte ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
        // Du plus ancien au plus récent : on lit une conversation dans l'ordre.
        mails: liste.slice().reverse().map(vueMail),
      };
    });

    conversations.sort((a, b) => new Date(b.dernierLe) - new Date(a.dernierLe));

    return {
      conversations,
      total: totalFils,
      page: numero,
      pages: Math.max(1, Math.ceil(totalFils / parPage)),
      aRattacher: await db.mail.count({ where: { statutRattachement: 'a_rattacher' } }),
    };
  });

  /**
   * Écrire à un client (§10).
   *
   * Le message part par le compte Gmail configuré, et la copie est archivée
   * immédiatement : l'échange est visible dans l'écran sans attendre la
   * prochaine relève.
   */
  app.post('/api/mails', { preHandler: exiger('envoyer', 'Mail') }, async (requete, reponse) => {
    const donnees = valider(schemaEnvoi, requete.body);

    const compte = donnees.compteId
      ? await db.compteMail.findUnique({ where: { id: donnees.compteId } })
      : await db.compteMail.findFirst({ where: { actif: true }, orderBy: { id: 'asc' } });
    if (!compte) throw new ErreurHttp(422, "Aucun compte d'envoi n'est configuré.", { erreurs: { compteId: 'Configurez un compte dans Paramètres.' } });

    let mail;
    try {
      mail = await envoyerMail({ ...donnees, compteId: compte.id });
    } catch (erreur) {
      // Un mot de passe d'application valide en IMAP peut être refusé en SMTP :
      // on rend le motif plutôt qu'une erreur 500 muette.
      throw new ErreurHttp(502, "L'envoi a échoué.", { erreurs: { envoi: erreur.message } });
    }

    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'mail.envoye',
        objetType: 'Mail',
        objetId: mail.id,
        apres: { a: mail.destinataires, objet: mail.objet, pieces: donnees.documentIds?.length ?? 0 },
        ip: requete.ip,
      },
      requete.log,
    );

    return reponse.code(201).send(vueMail(await db.mail.findUnique({ where: { id: mail.id }, include: AVEC })));
  });

  /** Vérifie que le compte peut envoyer, sans écrire à personne. */
  app.post('/api/comptes-mail/:id/tester-envoi', admin, async (requete) => {
    return testerEnvoi(Number(requete.params.id) || 0);
  });

  app.get('/api/mails/:id', { preHandler: exiger('lire', 'Mail') }, async (requete) => {
    const mail = await db.mail.findUnique({ where: { id: Number(requete.params.id) || 0 }, include: AVEC });
    if (!mail) throw introuvable('Message');
    return { ...vueMail(mail), corpsTexte: mail.corpsTexte, aDuHtml: Boolean(mail.corpsHtml) };
  });

  /**
   * Le corps HTML, servi à part pour être affiché dans une iframe `sandbox`
   * (§13) : il vient de l'extérieur et ne doit jamais s'exécuter dans la page.
   */
  app.get('/api/mails/:id/corps', { preHandler: exiger('lire', 'Mail') }, async (requete, reponse) => {
    const mail = await db.mail.findUnique({ where: { id: Number(requete.params.id) || 0 }, select: { corpsHtml: true, corpsTexte: true } });
    if (!mail) throw introuvable('Message');
    const contenu = mail.corpsHtml ?? `<pre>${(mail.corpsTexte ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`;
    return reponse
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('X-Frame-Options', 'SAMEORIGIN')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'")
      .send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{font:14px/1.6 system-ui,Segoe UI,sans-serif;color:#0f172a;margin:12px}</style></head><body>${contenu}</body></html>`);
  });

  app.patch('/api/mails/:id', { preHandler: exiger('rattacher', 'Mail') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const donnees = valider(z.object({ clientId: z.number().int().positive().nullable().optional(), marcheId: z.number().int().positive().nullable().optional() }), requete.body);
    const mail = await db.mail.findUnique({ where: { id } });
    if (!mail) throw introuvable('Message');

    const apres = { ...donnees };
    const clientFinal = 'clientId' in apres ? apres.clientId : mail.clientId;
    const marcheFinal = 'marcheId' in apres ? apres.marcheId : mail.marcheId;
    apres.statutRattachement = clientFinal || marcheFinal ? 'rattache' : 'a_rattacher';

    const modifie = await db.mail.update({ where: { id }, data: apres, include: AVEC });

    // Les pièces jointes suivent le message : c'est le même échange.
    const pieces = await db.pieceJointeMail.findMany({ where: { mailId: id, documentId: { not: null } } });
    for (const p of pieces) {
      await db.document.update({ where: { id: p.documentId }, data: { clientId: clientFinal, marcheId: marcheFinal } });
    }

    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'mail.rattache', objetType: 'Mail', objetId: id, apres: donnees, ip: requete.ip }, requete.log);
    return vueMail(modifie);
  });

  /** Les échanges d'un client ou d'un marché, groupés par fil (onglet « Échanges »). */
  app.get('/api/echanges', { preHandler: exiger('lire', 'Mail') }, async (requete) => {
    const { clientId, marcheId } = requete.query;
    if (!clientId && !marcheId) throw new ErreurHttp(422, 'Indiquez un client ou un marché.');

    const mails = await db.mail.findMany({
      where: { ...(clientId ? { clientId: Number(clientId) } : {}), ...(marcheId ? { marcheId: Number(marcheId) } : {}) },
      include: AVEC,
      orderBy: { date: 'asc' },
    });

    // Une conversation = un fil. On les rend du plus récent au plus ancien.
    const fils = new Map();
    for (const m of mails) {
      const liste = fils.get(m.fil) ?? [];
      liste.push(vueMail(m));
      fils.set(m.fil, liste);
    }
    return [...fils.entries()]
      .map(([fil, messages]) => ({ fil, objet: messages.at(-1).objet, messages, dernier: messages.at(-1).date }))
      .sort((a, b) => new Date(b.dernier) - new Date(a.dernier));
  });

  /** Les documents arrivés depuis 24 h (page « Arrivées », §10 bis). */
  app.get('/api/arrivees', async (requete) => {
    const depuis = new Date(Date.now() - 86_400_000);
    const documents = await db.document.findMany({
      where: { supprimeLe: null, creeLe: { gte: depuis } },
      include: { typeDocument: true, marche: true, client: true },
      orderBy: { creeLe: 'desc' },
      take: 50,
    });
    return documents.map((d) => ({
      id: d.id,
      titre: d.titre,
      source: d.source,
      statutOcr: d.statutOcr,
      statutClassement: d.statutClassement,
      type: d.typeDocument?.nom ?? null,
      marche: d.marche ? { id: d.marche.id, reference: d.marche.reference } : null,
      client: d.client?.nom ?? null,
      creeLe: d.creeLe,
    }));
  });
}
