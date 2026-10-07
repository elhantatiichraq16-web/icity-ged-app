/**
 * La vie des offres potentielles : les enregistrer sans doublon, les noter,
 * les faire expirer, prévenir l'équipe, les convertir en marché.
 *
 * La synchronisation des sources (qui va chercher les offres) est dans
 * synchronisation.js ; ici, tout ce qui suit la réception.
 */
import { droitsPour } from '@icity/commun/droits';
import { jourCasablanca } from '@icity/commun/activites';
import { CRITERES_PAR_DEFAUT, schemaCriteres, scoreOffre, STATUTS_OUVERTS } from '@icity/commun/marches-potentiels';
import { config } from '../../config.js';
import { db } from '../../db.js';
import { envoyerSansArchiver } from '../courriel-sortant.js';
import { journaliser } from '../journal.js';
import { ADRESSE_LISTE } from './connecteurs/pmmp.js';
import { fuseauMaroc, normaliserOffre } from './normalisation.js';

export const NOM_SOURCE_MANUELLE = 'Import manuel';

/**
 * Au premier usage : les critères par défaut, la source du portail marocain
 * (désactivée) et la source des imports manuels. Sans effet ensuite.
 */
export async function assurerInitialisation() {
  await db.criteresMarches.upsert({ where: { id: 1 }, update: {}, create: { id: 1, criteres: CRITERES_PAR_DEFAUT } });
  if (!(await db.sourceMarches.count())) {
    await db.sourceMarches.createMany({
      data: [
        {
          nom: 'Portail marocain des marchés publics',
          siteWeb: 'https://www.marchespublics.gov.ma/pmmp/',
          connecteur: 'pmmp',
          adresse: ADRESSE_LISTE,
          frequenceMinutes: 120,
          pagesMax: 1,
          delaiRequetesMs: 5000,
          active: false,
          derniereSyncResume: 'Désactivée : la collecte automatique attend l’accord de l’éditeur du portail.',
        },
        { nom: NOM_SOURCE_MANUELLE, siteWeb: 'https://www.marchespublics.gov.ma/pmmp/', connecteur: 'manuel', active: false },
      ],
      skipDuplicates: true,
    });
  }
}

/** Les critères iCity en vigueur. */
export async function chargerCriteres() {
  const ligne = await db.criteresMarches.findUnique({ where: { id: 1 } });
  return schemaCriteres.parse(ligne?.criteres ?? CRITERES_PAR_DEFAUT);
}

/** La source des imports manuels (créée au besoin). */
export async function sourceManuelle() {
  await assurerInitialisation();
  return db.sourceMarches.upsert({ where: { nom: NOM_SOURCE_MANUELLE }, update: {}, create: { nom: NOM_SOURCE_MANUELLE, siteWeb: 'https://www.marchespublics.gov.ma/pmmp/', connecteur: 'manuel' } });
}

/** Les champs d'une offre qui viennent de la source (jamais le suivi interne). */
const CHAMPS_EXTERNES = ['urlOfficielle', 'reference', 'objet', 'resume', 'acheteur', 'categorie', 'domaines', 'procedure', 'lieu', 'datePublication', 'dateLimite', 'estimation', 'caution', 'lots', 'reponseElectronique', 'documents', 'statutExterne'];

/** Le statut d'une offre dont la date limite vient de passer. */
const estPassee = (dateLimite, maintenant) => dateLimite && dateLimite.getTime() < maintenant.getTime();

/**
 * Enregistre les offres reçues d'une source : crée les nouvelles, met à jour
 * les connues (champs externes seulement : le statut, le responsable et les
 * notes de l'équipe ne sont jamais écrasés), recalcule leur score.
 *
 * @param {{ id: number }} source
 * @param {object[]} brutes ce que le connecteur a lu
 * @returns {Promise<{ nouvelles: object[], misesAJour: number, ignorees: number }>}
 */
export async function enregistrerOffres(source, brutes, { maintenant = new Date(), criteres } = {}) {
  const regles = criteres ?? (await chargerCriteres());
  const aujourdhui = jourCasablanca(maintenant);
  const nouvelles = [];
  let misesAJour = 0;
  let ignorees = 0;
  const vues = new Set();

  for (const brute of brutes) {
    const offre = normaliserOffre(brute);
    // Sans objet, ou deux fois dans le même envoi : on ne crée rien.
    if (!offre || vues.has(offre.idExterne)) {
      ignorees += 1;
      continue;
    }
    vues.add(offre.idExterne);
    const { score, raisons, motsCles } = scoreOffre(offre, regles, aujourdhui);
    const externes = Object.fromEntries(CHAMPS_EXTERNES.map((c) => [c, offre[c] ?? null]));
    const existante = await db.offrePotentielle.findUnique({ where: { sourceId_idExterne: { sourceId: source.id, idExterne: offre.idExterne } } });

    if (existante) {
      // Une annonce reçue sans un champ (liste courte) ne doit pas effacer ce qu'on savait déjà (détail).
      const complets = Object.fromEntries(Object.entries(externes).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length)));
      const fusion = { ...existante, ...complets };
      const note = scoreOffre(fusion, regles, aujourdhui);
      await db.offrePotentielle.update({
        where: { id: existante.id },
        data: {
          ...complets,
          score: note.score,
          raisonsScore: note.raisons,
          motsCles: note.motsCles,
          derniereVerification: maintenant,
          disparueLe: null,
          // Une date limite repoussée rouvre une offre expirée.
          ...(existante.statut === 'expiree' && complets.dateLimite && !estPassee(complets.dateLimite, maintenant) ? { statut: 'nouvelle' } : {}),
        },
      });
      misesAJour += 1;
    } else {
      const creee = await db.offrePotentielle.create({
        data: {
          ...externes,
          sourceId: source.id,
          idExterne: offre.idExterne,
          objet: offre.objet,
          score,
          raisonsScore: raisons,
          motsCles,
          premiereDetection: maintenant,
          derniereVerification: maintenant,
          statut: estPassee(offre.dateLimite, maintenant) ? 'expiree' : 'nouvelle',
        },
      });
      nouvelles.push(creee);
    }
  }
  return { nouvelles, misesAJour, ignorees };
}

/** Recalcule le score des offres ouvertes (après un changement de critères). */
export async function recalculerScores({ maintenant = new Date() } = {}) {
  const regles = await chargerCriteres();
  const aujourdhui = jourCasablanca(maintenant);
  const offres = await db.offrePotentielle.findMany({ where: { statut: { in: STATUTS_OUVERTS } } });
  for (const o of offres) {
    const { score, raisons, motsCles } = scoreOffre(o, regles, aujourdhui);
    if (score !== o.score || JSON.stringify(raisons) !== JSON.stringify(o.raisonsScore)) {
      await db.offrePotentielle.update({ where: { id: o.id }, data: { score, raisonsScore: raisons, motsCles } });
    }
  }
  return offres.length;
}

/** Les offres ouvertes dont la date limite est passée deviennent « expirées ». */
export async function expirerOffres({ maintenant = new Date() } = {}) {
  const echues = await db.offrePotentielle.findMany({ where: { statut: { in: STATUTS_OUVERTS }, dateLimite: { lt: maintenant } }, select: { id: true } });
  if (!echues.length) return 0;
  await db.offrePotentielle.updateMany({ where: { id: { in: echues.map((o) => o.id) } }, data: { statut: 'expiree' } });
  for (const o of echues) await journaliser({ action: 'offre.expiree', objetType: 'OffrePotentielle', objetId: o.id });
  return echues.length;
}

const jourLong = (d) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: fuseauMaroc(d) }).format(d);

/** Le texte de l'alerte : « Nouvelle opportunité à 86 % : … — échéance le 20 novembre 2026. » */
export const texteAlerte = (o) => `Nouvelle opportunité à ${o.score} % : ${o.objet.length > 120 ? `${o.objet.slice(0, 119)}…` : o.objet}${o.dateLimite ? ` — échéance le ${jourLong(o.dateLimite)}` : ''}.`.slice(0, 255);

/** Les comptes qui peuvent lire les offres. */
async function lecteursDesOffres() {
  const comptes = await db.utilisateur.findMany({ where: { actif: true, motDePasse: { not: null } }, include: { role: true } });
  return comptes.filter((u) => droitsPour({ id: u.id, role: u.role.code }).can('lire', 'MarchePotentiel'));
}

/**
 * Prévient l'équipe des nouvelles offres pertinentes : une seule fois par
 * offre (`alerteeLe`), au-dessus du seuil des critères ET du seuil de chacun ;
 * dans la cloche pour qui l'a choisi (le résumé par mail part le matin).
 */
export async function alerterNouvellesOffres(offres, { maintenant = new Date() } = {}) {
  const { seuil } = await chargerCriteres();
  const pertinentes = offres.filter((o) => o.score >= seuil && STATUTS_OUVERTS.includes(o.statut));
  if (!pertinentes.length) return 0;
  // On réserve d'abord l'alerte : deux synchronisations simultanées n'alertent pas deux fois.
  const { count } = await db.offrePotentielle.updateMany({ where: { id: { in: pertinentes.map((o) => o.id) }, alerteeLe: null }, data: { alerteeLe: maintenant } });
  if (!count) return 0;
  const reservees = await db.offrePotentielle.findMany({ where: { id: { in: pertinentes.map((o) => o.id) }, alerteeLe: maintenant } });
  const destinataires = (await lecteursDesOffres()).filter((u) => u.alerteOffres === 'cloche');
  const lignes = [];
  for (const o of reservees) {
    for (const u of destinataires) if (o.score >= u.alerteOffresScore) lignes.push({ utilisateurId: u.id, genre: 'opportunite', texte: texteAlerte(o), lien: `/marches-potentiels/${o.id}` });
  }
  if (lignes.length) await db.notification.createMany({ data: lignes });
  return lignes.length;
}

/** Le résumé quotidien par mail, pour qui l'a choisi : les nouvelles offres de son seuil depuis le dernier résumé. */
export async function envoyerResumesOffres({ maintenant = new Date(), log = console } = {}) {
  const aujourdhui = jourCasablanca(maintenant);
  const compte = await db.compteMail.findFirst({ where: { actif: true }, orderBy: { id: 'asc' } });
  if (!compte) return { envoyes: 0, sansCompte: true };
  const personnes = (await lecteursDesOffres()).filter((u) => u.alerteOffres === 'mail' && (!u.resumeOffresEnvoyeLe || u.resumeOffresEnvoyeLe.toISOString().slice(0, 10) < aujourdhui));
  let envoyes = 0;
  for (const u of personnes) {
    const depuis = u.resumeOffresEnvoyeLe ?? new Date(maintenant.getTime() - 86_400_000);
    const offres = await db.offrePotentielle.findMany({
      where: { premiereDetection: { gte: depuis }, score: { gte: u.alerteOffresScore }, statut: { in: STATUTS_OUVERTS } },
      orderBy: { score: 'desc' },
      take: 30,
    });
    if (!offres.length) continue;
    const lignes = offres.map((o) => `  • ${o.score} % — ${o.objet.slice(0, 140)}${o.acheteur ? ` (${o.acheteur})` : ''}${o.dateLimite ? ` — échéance le ${jourLong(o.dateLimite)}` : ''}\n    ${config.APP_URL}/marches-potentiels/${o.id}`);
    try {
      await envoyerSansArchiver({
        compteId: compte.id,
        a: u.email,
        objet: `Marchés potentiels : ${offres.length} nouvelle(s) opportunité(s)`,
        texte: [`Bonjour ${u.nom.split(' ')[0]},`, '', 'Les nouvelles offres repérées depuis le dernier résumé :', '', ...lignes, '', 'Vérifiez toujours l’annonce officielle avant toute décision.', 'Ce résumé se règle dans votre profil.'].join('\n'),
      });
      await db.utilisateur.update({ where: { id: u.id }, data: { resumeOffresEnvoyeLe: new Date(`${aujourdhui}T00:00:00Z`) } });
      envoyes += 1;
    } catch (erreur) {
      log.error?.(`Résumé des marchés potentiels pour ${u.email} en échec : ${erreur.message}`);
    }
  }
  return { envoyes };
}
