/**
 * Cherche les pièces scannées deux fois, et règle les cas sûrs (§9).
 *
 *   npm run doublons -w serveur            simulation : rien n'est écrit
 *   npm run doublons -w serveur -- --oui   applique
 *
 * Un rescan sûr — même numéro de page dans deux passages de scanner, au moins
 * 90 % de vocabulaire commun — est mis en corbeille (trente jours pour se
 * raviser) ; son marché, son client, son type et ses étiquettes passent sur la
 * pièce gardée. Les autres paires probables sont enregistrées et signalées dans
 * la fiche du marché et la page du document.
 */
import { db } from '../src/db.js';
import { detecterDoublons, SCORE_SUR } from '../src/services/arbitrage-doublons.js';

const appliquer = process.argv.includes('--oui');
const bilan = await detecterDoublons({ appliquer });

console.log(`\n  ${appliquer ? 'DOUBLONS' : 'SIMULATION DES DOUBLONS'}`);
console.log('  ' + '═'.repeat(72));
console.log(`\n  Rescans sûrs ${appliquer ? 'mis en corbeille' : 'à mettre en corbeille'} (même page, deux passages, ≥ ${SCORE_SUR} %) : ${bilan.ecartees.length}`);
for (const e of bilan.ecartees) console.log(`   ${String(e.score).padStart(3)} %  garde « ${e.garde.slice(0, 40)} »\n          écarte « ${e.ecarte.slice(0, 40)} »`);
console.log(`\n  Paires probables à trancher à la main : ${bilan.aTrancher.length}`);
for (const p of bilan.aTrancher.slice(0, 15)) console.log(`   ${String(p.score).padStart(3)} %  ${p.a.slice(0, 34).padEnd(34)} ≈ ${p.b.slice(0, 34)}`);
console.log(`\n  Paires nouvelles ${appliquer ? 'enregistrées' : 'trouvées'} : ${bilan.nouvelles}`);
if (!appliquer) console.log('\n  Rien n’a été écrit. Relancez avec --oui pour appliquer.');
console.log();

await db.$disconnect();
