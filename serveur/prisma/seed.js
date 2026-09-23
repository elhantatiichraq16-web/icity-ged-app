/**
 * Données de départ de la phase 1 : les 7 rôles et le premier administrateur.
 *
 * Relançable sans risque : rien n'est créé deux fois.
 *
 * Le premier administrateur ne reçoit pas de mot de passe écrit dans le code.
 * Deux possibilités :
 *  - ADMIN_MOT_DE_PASSE est défini dans .env → il est utilisé ;
 *  - sinon → un mot de passe aléatoire est tiré et affiché UNE fois ici.
 */
import crypto from 'node:crypto';
import { ROLES } from '@icity/commun/roles';
import { motDePasse as regleMotDePasse } from '@icity/commun/schemas';
import { db } from '../src/db.js';
import { hacher } from '../src/services/mots-de-passe.js';
import { CLIENTS, ETIQUETTES, TYPES_DOCUMENTS } from './referentiels.js';

async function main() {
  for (const role of ROLES) {
    await db.role.upsert({
      where: { code: role.code },
      update: { nom: role.nom, description: role.description },
      create: role,
    });
  }
  console.log(`  ${ROLES.length} rôles en place.`);

  // ── Référentiels (§4) ──
  // upsert : relancer le seed corrige les libellés sans rien dupliquer, et
  // sans toucher aux documents déjà rattachés.
  for (const type of TYPES_DOCUMENTS) {
    await db.typeDocument.upsert({
      where: { code: type.code },
      update: { nom: type.nom, ordreCycle: type.ordreCycle ?? null, pieceAttendue: type.pieceAttendue ?? false },
      create: { ...type, ordreCycle: type.ordreCycle ?? null, pieceAttendue: type.pieceAttendue ?? false },
    });
  }
  console.log(`  ${TYPES_DOCUMENTS.length} types de documents.`);

  for (const e of ETIQUETTES) {
    await db.etiquette.upsert({ where: { nom: e.nom }, update: { couleur: e.couleur, famille: e.famille }, create: e });
  }
  console.log(`  ${ETIQUETTES.length} étiquettes.`);

  for (const c of CLIENTS) {
    const donnees = {
      nom: c.nom,
      sigle: c.sigle ?? null,
      synonymes: c.synonymes ?? [],
      domainesEmail: c.domainesEmail ?? [],
      interne: c.interne ?? false,
      dossierOrigine: c.dossierOrigine ?? null,
    };
    await db.client.upsert({ where: { nom: c.nom }, update: donnees, create: donnees });
  }
  console.log(`  ${CLIENTS.length} clients (dont ${CLIENTS.filter((c) => c.interne).length} internes).`);

  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!email) {
    console.log('  ADMIN_EMAIL absent de serveur/.env : aucun administrateur créé.');
    return;
  }

  const existe = await db.utilisateur.findUnique({ where: { email } });
  if (existe) {
    console.log(`  L'administrateur ${email} existe déjà.`);
    return;
  }

  let mdp = process.env.ADMIN_MOT_DE_PASSE;
  let tire = false;
  if (!mdp) {
    // 16 caractères aléatoires + un chiffre : conforme à la règle.
    mdp = crypto.randomBytes(12).toString('base64url') + '7';
    tire = true;
  }
  const verif = regleMotDePasse.safeParse(mdp);
  if (!verif.success) throw new Error(`ADMIN_MOT_DE_PASSE refusé : ${verif.error.issues[0].message}`);

  const admin = await db.role.findUniqueOrThrow({ where: { code: 'administrateur' } });
  await db.utilisateur.create({
    data: { nom: process.env.ADMIN_NOM || 'Administrateur', email, roleId: admin.id, motDePasse: await hacher(mdp) },
  });

  console.log(`  Administrateur créé : ${email}`);
  if (tire) {
    console.log('  ┌──────────────────────────────────────────────────────────');
    console.log(`  │ Mot de passe provisoire : ${mdp}`);
    console.log('  │ Notez-le, il ne sera plus affiché. Changez-le dans Profil.');
    console.log('  └──────────────────────────────────────────────────────────');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
