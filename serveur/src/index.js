/**
 * Point d'entrée : démarre l'API sur 127.0.0.1 (jamais sur le réseau, §2).
 */
import { config } from './config.js';
import { construireApp } from './app.js';
import { db } from './db.js';

const app = await construireApp();

try {
  await db.$queryRaw`SELECT 1`;
} catch (erreur) {
  app.log.fatal(
    `PostgreSQL ne répond pas (${erreur.message}).\n` +
      '  → Vérifiez que le service PostgreSQL est démarré, puis relancez.',
  );
  process.exit(1);
}

try {
  await app.listen({ host: config.HOTE, port: config.PORT });
  app.log.info(`iCity GED prêt sur http://${config.HOTE}:${config.PORT}`);
} catch (erreur) {
  app.log.fatal(erreur.code === 'EADDRINUSE' ? `Le port ${config.PORT} est déjà utilisé : changez PORT dans serveur/.env.` : erreur);
  process.exit(1);
}

// Arrêt propre (Ctrl+C) : on termine les requêtes en cours et on ferme la base.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
}
