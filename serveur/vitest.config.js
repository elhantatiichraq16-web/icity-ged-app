import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les tests partagent une vraie base PostgreSQL : on les lance l'un après
    // l'autre pour qu'ils ne se marchent pas dessus.
    fileParallelism: false,
    // Un processus par fichier, relancé à chaque fois : sur un PC de 3,7 Go,
    // un processus unique qui enchaîne toute la suite finit par manquer de
    // mémoire et être tué par Windows.
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: 1,
        minForks: 1,
        // On plafonne le tas de chaque processus : V8 nettoie alors plus tôt
        // au lieu de grossir jusqu'à ce que Windows tue le processus.
        execArgv: ['--max-old-space-size=256'],
      },
    },
    isolate: true,
    setupFiles: ['./tests/installation.js'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
