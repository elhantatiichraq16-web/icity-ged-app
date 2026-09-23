/**
 * Connexion, double authentification, déconnexion, mot de passe oublié,
 * invitation. Il n'existe pas d'inscription publique (§11) : un compte naît
 * toujours d'une invitation de l'administrateur.
 */
import {
  schemaCodeDeuxFacteurs,
  schemaConnexion,
  schemaMotDePasseOublie,
  schemaNouveauMotDePasse,
} from '@icity/commun/schemas';
import { db } from '../db.js';
import { ErreurHttp, valider } from '../erreurs.js';
import { utilisateurPublic } from '../plugins/authentification.js';
import { envoyerReinitialisation } from '../services/courriel.js';
import { utiliserCodeSecours, verifierCode } from '../services/deux-facteurs.js';
import { consommerJeton, creerJeton, trouverJeton } from '../services/jetons.js';
import { journaliser } from '../services/journal.js';
import { hacher, verifier } from '../services/mots-de-passe.js';
import { fermerAutresSessions, fermerSession, NOM_COOKIE, optionsCookie, ouvrirSession } from '../services/sessions.js';

const REFUS = 'Adresse e-mail ou mot de passe incorrect.';

/**
 * Limite de tentatives : 5 essais par quart d'heure pour un même couple
 * adresse + e-mail. Assez pour une faute de frappe, trop peu pour deviner.
 */
const limiteConnexion = {
  rateLimit: {
    hook: 'preHandler', // après la lecture du corps, pour connaître l'e-mail
    max: 5,
    timeWindow: '15 minutes',
    keyGenerator: (req) => `${req.ip}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      message: `Trop de tentatives. Réessayez dans ${Math.ceil(ctx.ttl / 60000)} minute(s).`,
    }),
  },
};

const limiteEmail = {
  rateLimit: {
    hook: 'preHandler',
    max: 3,
    timeWindow: '15 minutes',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      message: `Trop de demandes. Réessayez dans ${Math.ceil(ctx.ttl / 60000)} minute(s).`,
    }),
  },
};

/** Pose le cookie d'une nouvelle session et rend le jeton CSRF associé. */
function poserSession(reponse, { jeton, session }) {
  reponse.setCookie(NOM_COOKIE, jeton, optionsCookie(session));
  return session.jetonCsrf;
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesAuth(app) {
  // ── Qui suis-je ? ─────────────────────────────────────────────
  // Appelée au chargement de chaque écran. Rend aussi le jeton CSRF que
  // l'écran renverra à chaque écriture.
  app.get('/api/auth/moi', async (requete) => {
    const s = requete.session;
    if (!s) return { utilisateur: null, csrf: null, deuxFacteursEnAttente: false };
    if (s.attenteDeuxFacteurs) return { utilisateur: null, csrf: s.jetonCsrf, deuxFacteursEnAttente: true };
    return { utilisateur: utilisateurPublic(s.utilisateur), csrf: s.jetonCsrf, deuxFacteursEnAttente: false };
  });

  // ── Connexion ─────────────────────────────────────────────────
  app.post('/api/auth/connexion', { config: limiteConnexion }, async (requete, reponse) => {
    const { email, motDePasse, seSouvenir } = valider(schemaConnexion, requete.body);
    const utilisateur = await db.utilisateur.findUnique({ where: { email }, include: { role: true } });

    // verifier() compare toujours un hachage, même si le compte n'existe pas :
    // le temps de réponse ne révèle pas quelles adresses ont un compte.
    const bon = await verifier(motDePasse, utilisateur?.motDePasse);
    if (!bon || !utilisateur.actif) {
      await journaliser({ utilisateurId: utilisateur?.id, action: 'connexion.echec', commentaire: email, ip: requete.ip }, requete.log);
      throw new ErreurHttp(401, utilisateur && bon && !utilisateur.actif ? 'Ce compte est désactivé. Contactez l’administrateur.' : REFUS);
    }

    // Toute session précédente sur ce navigateur est abandonnée : on repart
    // d'un jeton neuf (régénération de session, §13).
    if (requete.session) await fermerSession(requete.session.id);

    const aDeuxFacteurs = Boolean(utilisateur.deuxFacteursActiveLe);
    const ouverte = await ouvrirSession(utilisateur.id, {
      seSouvenir,
      attenteDeuxFacteurs: aDeuxFacteurs,
      ip: requete.ip,
      agent: requete.headers['user-agent'],
    });
    const csrf = poserSession(reponse, ouverte);

    if (aDeuxFacteurs) {
      return { deuxFacteursEnAttente: true, csrf, utilisateur: null };
    }

    await db.utilisateur.update({ where: { id: utilisateur.id }, data: { derniereConnexion: new Date() } });
    await journaliser({ utilisateurId: utilisateur.id, action: 'connexion', ip: requete.ip }, requete.log);
    return { deuxFacteursEnAttente: false, csrf, utilisateur: utilisateurPublic(utilisateur) };
  });

  // ── Second facteur ────────────────────────────────────────────
  app.post('/api/auth/deux-facteurs', { config: limiteConnexion }, async (requete, reponse) => {
    const s = requete.session;
    if (!s?.attenteDeuxFacteurs) throw new ErreurHttp(401, 'Reconnectez-vous avec votre mot de passe.');
    const { code } = valider(schemaCodeDeuxFacteurs, requete.body);
    const utilisateur = s.utilisateur;

    const ok = (await verifierCode(utilisateur, code.replace(/\s/g, ''))) || (await utiliserCodeSecours(utilisateur, code));
    if (!ok) {
      await journaliser({ utilisateurId: utilisateur.id, action: 'connexion.deux_facteurs_echec', ip: requete.ip }, requete.log);
      throw new ErreurHttp(401, 'Code incorrect ou expiré.');
    }

    // Nouvelle session complète, nouveau jeton : l'étape intermédiaire disparaît.
    await fermerSession(s.id);
    const ouverte = await ouvrirSession(utilisateur.id, { seSouvenir: s.seSouvenir, ip: requete.ip, agent: requete.headers['user-agent'] });
    const csrf = poserSession(reponse, ouverte);

    await db.utilisateur.update({ where: { id: utilisateur.id }, data: { derniereConnexion: new Date() } });
    await journaliser({ utilisateurId: utilisateur.id, action: 'connexion', commentaire: 'avec double authentification', ip: requete.ip }, requete.log);
    return { deuxFacteursEnAttente: false, csrf, utilisateur: utilisateurPublic(utilisateur) };
  });

  // ── Déconnexion ───────────────────────────────────────────────
  app.post('/api/auth/deconnexion', async (requete, reponse) => {
    if (requete.session) {
      await fermerSession(requete.session.id);
      await journaliser({ utilisateurId: requete.session.utilisateurId, action: 'deconnexion', ip: requete.ip }, requete.log);
    }
    reponse.clearCookie(NOM_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ── Mot de passe oublié ───────────────────────────────────────
  // La réponse est TOUJOURS la même, que l'adresse existe ou non : sinon ce
  // formulaire servirait à tester quelles adresses ont un compte.
  app.post('/api/auth/mot-de-passe-oublie', { config: limiteEmail }, async (requete) => {
    const { email } = valider(schemaMotDePasseOublie, requete.body);
    const utilisateur = await db.utilisateur.findUnique({ where: { email } });

    if (utilisateur?.actif && utilisateur.motDePasse) {
      const lien = await creerJeton(utilisateur.id, 'reinitialisation');
      try {
        await envoyerReinitialisation({ a: utilisateur.email, nom: utilisateur.nom, lien });
      } catch (erreur) {
        requete.log.error({ err: erreur }, 'Envoi du mail de réinitialisation impossible');
      }
      await journaliser({ utilisateurId: utilisateur.id, action: 'mot_de_passe.demande', ip: requete.ip }, requete.log);
    }
    return { message: 'Si un compte existe pour cette adresse, un e-mail vient de lui être envoyé.' };
  });

  // ── Vérifier un lien reçu par e-mail ──────────────────────────
  // Permet à l'écran d'afficher « lien expiré » avant qu'on tape un mot de passe.
  app.get('/api/auth/jeton/:type/:jeton', async (requete) => {
    const { type, jeton } = requete.params;
    if (!['invitation', 'reinitialisation'].includes(type)) throw new ErreurHttp(404, 'Lien inconnu.');
    const trouve = await trouverJeton(jeton, type);
    if (!trouve) throw new ErreurHttp(410, 'Ce lien a expiré ou a déjà servi.');
    return { nom: trouve.utilisateur.nom, email: trouve.utilisateur.email };
  });

  // ── Choisir un mot de passe (réinitialisation ou invitation) ──
  for (const type of ['reinitialisation', 'invitation']) {
    app.post(`/api/auth/${type}`, { config: limiteEmail }, async (requete) => {
      const { jeton, motDePasse } = valider(schemaNouveauMotDePasse, requete.body);
      const trouve = await trouverJeton(jeton, type);
      if (!trouve) throw new ErreurHttp(410, 'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.');

      await db.utilisateur.update({ where: { id: trouve.utilisateurId }, data: { motDePasse: await hacher(motDePasse) } });
      await consommerJeton(trouve.id);
      // Un mot de passe changé ferme toutes les sessions ouvertes avec l'ancien.
      await fermerAutresSessions(trouve.utilisateurId);
      await journaliser(
        { utilisateurId: trouve.utilisateurId, action: type === 'invitation' ? 'invitation.acceptee' : 'mot_de_passe.reinitialise', ip: requete.ip },
        requete.log,
      );
      return { message: 'Mot de passe enregistré. Vous pouvez vous connecter.' };
    });
  }
}
