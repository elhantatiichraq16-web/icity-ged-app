/**
 * Passe tout le fonds au classement automatique (§7).
 *
 *   npm run classer -w serveur              simulation : ce qui serait proposé
 *   npm run classer -w serveur -- --oui     enregistre les propositions
 *
 * Rien n'est écrit sur les documents : seules des SUGGESTIONS sont créées.
 * C'est l'écran « À classer » qui permet de les accepter ou de les corriger.
 */
import { db } from '../src/db.js';
import { chargerReferentiels, enregistrerPropositions, proposerPour } from '../src/services/suggestions.js';

const appliquer = process.argv.includes('--oui');

const referentiels = await chargerReferentiels();
const documents = await db.document.findMany({
  where: { supprimeLe: null, texteOcr: { not: null } },
  select: { id: true, titre: true, texteOcr: true, marcheId: true, clientId: true, typeDocumentId: true, objetTechnique: true, champsVerrouilles: true },
});

const bilan = { lisibles: 0, muets: 0, propositions: 0, parChamp: {}, marchesInconnus: new Map() };

for (const document of documents) {
  const { lisible, propositions } = proposerPour(document, referentiels);
  if (!lisible) {
    bilan.muets += 1;
    continue;
  }
  bilan.lisibles += 1;
  bilan.propositions += propositions.length;
  for (const p of propositions) {
    bilan.parChamp[p.champ] = (bilan.parChamp[p.champ] ?? 0) + 1;
    if (p.champ === 'marche' && !p.cibleId) {
      bilan.marchesInconnus.set(p.valeur, (bilan.marchesInconnus.get(p.valeur) ?? 0) + 1);
    }
  }
  if (appliquer) await enregistrerPropositions(document.id, propositions);
}

console.log(`\n  ${appliquer ? 'CLASSEMENT' : 'SIMULATION'} — ${documents.length} documents lus`);
console.log('  ' + '═'.repeat(70));
console.log(`\n  ${bilan.lisibles} documents lisibles · ${bilan.muets} trop courts ou muets`);
console.log(`  ${bilan.propositions} propositions :`);
for (const [champ, n] of Object.entries(bilan.parChamp)) console.log(`      ${String(n).padStart(4)}  ${champ}`);

if (bilan.marchesInconnus.size) {
  console.log(`\n  ${bilan.marchesInconnus.size} références citées mais absentes du registre`);
  console.log('    (l’attestation prouve l’affaire ; le contrat, lui, n’a pas été retrouvé)\n');
  for (const [reference, n] of [...bilan.marchesInconnus].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`      ${reference.padEnd(26)} cité par ${n} pièce(s)`);
  }
}

console.log('\n  ' + '═'.repeat(70));
console.log(appliquer ? "  Propositions enregistrées. Ouvrez l'écran « À classer » pour trancher.\n" : '  Simulation — rien n’a été enregistré. Relancez avec --oui.\n');

await db.$disconnect();
