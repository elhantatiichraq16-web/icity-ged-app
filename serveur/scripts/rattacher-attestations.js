/**
 * Rattache les attestations de référence déjà au fonds à leur marché.
 *
 *   npm run attestations -w serveur            simulation : rien n'est écrit
 *   npm run attestations -w serveur -- --oui   applique
 *
 * Une attestation prouve un marché gagné et clos : le marché qu'elle cite est
 * déclaré s'il n'existe pas (services/attestations.js). Les attestations dont
 * le numéro de marché ne se lit pas restent à part, sans marché.
 *
 * Relançable : une attestation déjà rattachée n'est plus relue, et un marché
 * déjà déclaré n'est pas recréé — la référence normalisée sert de clé.
 */
import { db } from '../src/db.js';
import { rattacherAttestations } from '../src/services/attestations.js';

const appliquer = process.argv.includes('--oui');

const bilan = await rattacherAttestations({ appliquer });
const clients = new Map((await db.client.findMany({ select: { id: true, nom: true } })).map((c) => [c.id, c.nom]));
const ligne = (l) => `    ${l.reference.padEnd(26)} ${String(l.attestations).padStart(3)} attestation(s)   ${clients.get(l.clientId) ?? 'client inconnu'}`;

console.log(`\n  ${appliquer ? 'RATTACHEMENT' : 'SIMULATION'} DES ATTESTATIONS DE RÉFÉRENCE`);
console.log('  ' + '═'.repeat(72));
console.log(`\n  Marchés ${appliquer ? 'déclarés' : 'à déclarer'} (gagnés et clôturés) : ${bilan.declares.length}`);
for (const l of bilan.declares) console.log(ligne(l));
console.log(`\n  Marchés déjà connus, qu'elles ${appliquer ? 'ont rejoints' : 'rejoindraient'} : ${bilan.rejoints.length}`);
for (const l of bilan.rejoints) console.log(ligne(l));
console.log(`\n  Attestations ${appliquer ? 'rattachées' : 'à rattacher'} : ${bilan.rattachees}`);
console.log(`  Attestations mises à part (numéro de marché illisible) : ${bilan.illisibles}`);
if (!appliquer) console.log('\n  Rien n’a été écrit. Relancez avec --oui pour appliquer.\n');

await db.$disconnect();
