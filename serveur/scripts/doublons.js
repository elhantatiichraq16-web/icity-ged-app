/**
 * Cherche les pièces scannées deux fois (§9).
 *
 *   npm run doublons -w serveur            simulation
 *   npm run doublons -w serveur -- --oui   enregistre les paires à arbitrer
 *
 * Ce script SIGNALE ; il ne supprime rien. C'est l'écran « À vérifier » qui
 * permet de trancher, pièce sous les yeux.
 */
import { db } from '../src/db.js';
import { chercherPaires } from '../src/services/doublons.js';

const appliquer = process.argv.includes('--oui');

const documents = await db.document.findMany({
  where: { supprimeLe: null, texteOcr: { not: null } },
  select: { id: true, titre: true, clientId: true, marcheId: true, lotScan: true, pageScan: true, texteOcr: true },
});

const paires = chercherPaires(documents);
const probables = paires.filter((p) => p.probable);
const ecartees = paires.filter((p) => !p.probable);

console.log(`\n  ${appliquer ? 'ENREGISTREMENT' : 'SIMULATION'} — ${documents.length} documents comparés`);
console.log('  ' + '═'.repeat(72));
console.log(`\n  ${probables.length} paires probables · ${ecartees.length} paires écartées par un indice contraire\n`);

for (const p of probables.slice(0, 20)) {
  console.log(`   ${String(p.score).padStart(3)} %  ${p.a.titre.slice(0, 34).padEnd(34)} ≈ ${p.b.titre.slice(0, 34)}`);
  console.log(`          ${p.raisons.join(' · ')}`);
}

if (ecartees.length) {
  console.log(`\n  ÉCARTÉES — elles se ressemblent, mais quelque chose les sépare :\n`);
  for (const p of ecartees.slice(0, 10)) {
    console.log(`   ${String(p.score).padStart(3)} %  ${p.a.titre.slice(0, 30)} / ${p.b.titre.slice(0, 30)}`);
    console.log(`          ${p.ecarts.join(' · ')}`);
  }
}

if (appliquer) {
  let nouvelles = 0;
  for (const p of probables) {
    const [a, b] = p.a.id < p.b.id ? [p.a.id, p.b.id] : [p.b.id, p.a.id];
    const existante = await db.doublon.findUnique({ where: { documentAId_documentBId: { documentAId: a, documentBId: b } } });
    // Une paire déjà tranchée ne revient pas (§9).
    if (existante) continue;
    await db.doublon.create({ data: { documentAId: a, documentBId: b, score: p.score, raisons: { raisons: p.raisons, ecarts: p.ecarts } } });
    nouvelles += 1;
  }
  console.log(`\n  ${nouvelles} nouvelles paires à arbitrer dans « À vérifier ».`);
} else {
  console.log('\n  Simulation — rien n’a été enregistré. Relancez avec --oui.');
}
console.log();

await db.$disconnect();
