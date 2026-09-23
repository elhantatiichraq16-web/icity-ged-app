/**
 * Exécuté avant chaque fichier de test : charge .env.test AVANT que le
 * serveur ne lise sa configuration.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.test'));
process.env.STOCKAGE ??= path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stockage-test');
