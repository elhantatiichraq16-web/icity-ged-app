/**
 * Assemble le serveur : sécurité, plugins, routes.
 *
 * construireApp() ne démarre rien : elle rend l'application prête. index.js
 * la fait écouter sur le port ; les tests l'interrogent directement, sans
 * réseau, avec app.inject().
 */
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config, RACINE_SERVEUR } from './config.js';
import { gestionnaireErreurs } from './erreurs.js';
import authentification from './plugins/authentification.js';
import routesAchats from './routes/achats.js';
import routesActivites from './routes/activites.js';
import routesAnalyses from './routes/analyses.js';
import routesCalendrier from './routes/calendrier.js';
import routesAuth from './routes/auth.js';
import routesCircuit from './routes/circuit.js';
import routesCorbeille from './routes/corbeille.js';
import routesCourriel from './routes/courriel.js';
import routesDocuments from './routes/documents.js';
import routesFil from './routes/fil.js';
import routesMarches from './routes/marches.js';
import routesModeles from './routes/modeles.js';
import routesPlanning from './routes/planning.js';
import routesNotifications from './routes/notifications.js';
import routesProfil from './routes/profil.js';
import routesRecherche from './routes/recherche.js';
import routesTableauBord from './routes/tableau-bord.js';
import routesTri from './routes/tri.js';
import routesUtilisateurs from './routes/utilisateurs.js';

const DOSSIER_CLIENT = path.resolve(RACINE_SERVEUR, '..', 'client', 'dist');

export async function construireApp({ journal = !config.estTest } = {}) {
  const app = Fastify({
    logger: journal ? { level: config.estProduction ? 'info' : 'debug' } : false,
    // Ce que le navigateur peut envoyer : 1 Mo de JSON. Les fichiers (50 Mo)
    // passeront par le multipart, qui a sa propre limite.
    bodyLimit: 1024 * 1024,
  });

  app.setErrorHandler(gestionnaireErreurs);

  // ── En-têtes de sécurité (§13) ────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Les composants d'interface posent des styles en ligne (positions
        // des menus) : on les autorise, pas les scripts.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },                               // X-Frame-Options
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // HTTP simple sur 127.0.0.1 : HSTS n'aurait pas de sens.
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart);
  await app.register(authentification);

  // Les réponses de l'API ne doivent jamais être mises en cache par le
  // navigateur : elles dépendent de l'utilisateur connecté.
  app.addHook('onSend', async (requete, reponse) => {
    if (requete.url.startsWith('/api/') && !reponse.hasHeader('Cache-Control')) {
      reponse.header('Cache-Control', 'no-store');
    }
  });

  // ── Routes ────────────────────────────────────────────────────
  app.get('/api/sante', async () => ({ ok: true }));
  await app.register(routesAuth);
  await app.register(routesMarches);
  await app.register(routesDocuments);
  await app.register(routesRecherche);
  await app.register(routesTableauBord);
  await app.register(routesCorbeille);
  await app.register(routesTri);
  await app.register(routesCourriel);
  await app.register(routesCircuit);
  await app.register(routesNotifications);
  await app.register(routesProfil);
  await app.register(routesUtilisateurs);
  await app.register(routesAchats);
  await app.register(routesFil);
  await app.register(routesActivites);
  await app.register(routesCalendrier);
  await app.register(routesAnalyses);
  await app.register(routesModeles);
  await app.register(routesPlanning);

  // ── Écrans React (une fois construits avec `npm run build`) ────
  // En développement, c'est Vite qui les sert sur le port 5173.
  if (fs.existsSync(DOSSIER_CLIENT)) {
    await app.register(fastifyStatic, { root: DOSSIER_CLIENT, wildcard: false });
  }

  app.setNotFoundHandler((requete, reponse) => {
    if (requete.url.startsWith('/api/') || requete.method !== 'GET' || !fs.existsSync(DOSSIER_CLIENT)) {
      return reponse.code(404).send({ message: 'Adresse inconnue.' });
    }
    // Application monopage : toute adresse d'écran (/marches, /profil…)
    // renvoie index.html, et React Router affiche le bon écran.
    return reponse.type('text/html').sendFile('index.html');
  });

  return app;
}
