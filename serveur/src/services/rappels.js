/**
 * Le rappel du matin, comme le résumé quotidien d'Odoo : à chacun, par mail,
 * ses activités en retard et celles du jour, avec un lien vers l'application.
 *
 * Il part une seule fois par jour et par personne (`rappelEnvoyeLe`) : le
 * worker le tente à 8 h, et au démarrage si le PC était éteint à 8 h. Qui n'a
 * rien à faire ne reçoit rien ; qui l'a désactivé dans son profil non plus.
 *
 * Une activité avec un rappel (« 2 jours avant ») paraît aussi, dès ce jour-là,
 * dans la partie « Bientôt » du mail, et une seule fois dans la cloche
 * (`notifierRappels`). Les participants d'une réunion sont prévenus comme la
 * personne chargée.
 *
 * Une activité à heure fixe donne aussi une alerte, comme celles d'Odoo :
 * 10 minutes avant, dans la cloche et par mail (`alerterAvantHeure`).
 */
import { debutRappel, jourCasablanca, nomTypeActivite } from '@icity/commun/activites';
import { config } from '../config.js';
import { db } from '../db.js';
import { lienActivite, QUI_ME_CONCERNENT, quandFr } from './activites.js';
import { envoyerSansArchiver } from './courriel-sortant.js';

const iso = (d) => d.toISOString().slice(0, 10);
const plusJours = (jour, n) => new Date(Date.parse(`${jour}T00:00:00Z`) + n * 86_400_000);

/** « demain », « dans 2 jours » */
const dansCombien = (echeance, aujourdhui) => {
  const n = Math.round((Date.parse(`${echeance}T00:00:00Z`) - Date.parse(`${aujourdhui}T00:00:00Z`)) / 86_400_000);
  return n === 1 ? 'demain' : `dans ${n} jours`;
};

const jourFr = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** Le texte du rappel d'une personne. */
export function texteRappel(nom, activites, aujourdhui, url = config.APP_URL) {
  const retard = activites.filter((a) => iso(a.echeance) < aujourdhui);
  const jour = activites.filter((a) => iso(a.echeance) === aujourdhui);
  const bientot = activites.filter((a) => iso(a.echeance) > aujourdhui);
  const ligne = (a) => {
    const fiche = a.marche?.reference ?? a.client?.nom ?? a.fournisseur?.nom ?? (a.commande ? `commande ${a.commande.fournisseur?.nom ?? ''}`.trim() : null);
    const e = iso(a.echeance);
    const quand = e < aujourdhui ? ` — prévue le ${jourFr(e)}` : e > aujourdhui ? ` — le ${jourFr(e)}${a.heure ? ` à ${a.heure}` : ''}` : a.heure ? ` — à ${a.heure}` : '';
    return `  • ${nomTypeActivite(a.type)} : ${a.resume}${fiche ? ` (${fiche})` : ''}${quand}`;
  };
  return [
    `Bonjour ${nom.split(' ')[0]},`,
    '',
    retard.length ? `En retard (${retard.length}) :` : null,
    ...retard.map(ligne),
    retard.length ? '' : null,
    jour.length ? `Pour aujourd’hui (${jour.length}) :` : null,
    ...jour.map(ligne),
    jour.length ? '' : null,
    bientot.length ? `Bientôt (${bientot.length}) :` : null,
    ...bientot.map(ligne),
    bientot.length ? '' : null,
    `Vos activités : ${url}/`,
    '',
    'Ce rappel se désactive dans votre profil.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * Envoie les rappels du jour qui ne sont pas encore partis.
 *
 * @param {{ maintenant?: Date, log?: object }} options
 * @returns {Promise<{ envoyes: number, sansCompte?: boolean }>}
 */
export async function envoyerRappelsDuJour({ maintenant = new Date(), log = console } = {}) {
  const aujourdhui = jourCasablanca(maintenant);
  const compte = await db.compteMail.findFirst({ where: { actif: true }, orderBy: { id: 'asc' } });
  if (!compte) return { envoyes: 0, sansCompte: true };

  const personnes = await db.utilisateur.findMany({
    where: {
      actif: true,
      rappelQuotidien: true,
      motDePasse: { not: null },
      OR: [{ rappelEnvoyeLe: null }, { rappelEnvoyeLe: { lt: new Date(`${aujourdhui}T00:00:00Z`) } }],
    },
    select: { id: true, nom: true, email: true },
  });

  let envoyes = 0;
  for (const p of personnes) {
    // Les activités échues, et celles à venir dont le rappel a commencé (30 jours au plus).
    const candidates = await db.activite.findMany({
      where: {
        AND: [
          QUI_ME_CONCERNENT(p.id),
          { faiteLe: null, OR: [{ echeance: { lte: new Date(`${aujourdhui}T00:00:00Z`) } }, { rappelJours: { not: null }, echeance: { lte: plusJours(aujourdhui, 30) } }] },
        ],
      },
      include: {
        marche: { select: { reference: true } },
        client: { select: { nom: true } },
        fournisseur: { select: { nom: true } },
        commande: { select: { fournisseur: { select: { nom: true } } } },
      },
      orderBy: [{ echeance: 'asc' }, { heure: { sort: 'asc', nulls: 'first' } }],
    });
    const activites = candidates.filter((a) => iso(a.echeance) <= aujourdhui || debutRappel(iso(a.echeance), a.rappelJours) <= aujourdhui);
    if (!activites.length) continue;
    const echues = activites.filter((a) => iso(a.echeance) <= aujourdhui).length;
    const enRetard = activites.filter((a) => iso(a.echeance) < aujourdhui).length;
    const aVenir = activites.length - echues;
    const objet = echues
      ? `Vos activités du jour : ${echues}${enRetard ? ` (dont ${enRetard} en retard)` : ''}${aVenir ? `, et ${aVenir} à venir` : ''}`
      : `Rappel : ${aVenir} activité(s) à venir`;
    try {
      await envoyerSansArchiver({
        compteId: compte.id,
        a: p.email,
        objet,
        texte: texteRappel(p.nom, activites, aujourdhui),
      });
      // Noté seulement une fois parti : un échec sera retenté au prochain passage.
      await db.utilisateur.update({ where: { id: p.id }, data: { rappelEnvoyeLe: new Date(`${aujourdhui}T00:00:00Z`) } });
      envoyes += 1;
    } catch (erreur) {
      log.error?.(`Rappel du jour pour ${p.email} en échec : ${erreur.message}`);
    }
  }
  return { envoyes };
}

/**
 * Le rappel dans la cloche, N jours avant : une seule fois par activité
 * (`rappelNotifieLe`), pour la personne chargée et les participants. Sans
 * effet quand rien n'est dû : le worker peut l'appeler toutes les heures.
 *
 * @param {{ maintenant?: Date }} options
 * @returns {Promise<{ notifies: number }>}
 */
export async function notifierRappels({ maintenant = new Date() } = {}) {
  const aujourdhui = jourCasablanca(maintenant);
  const candidates = await db.activite.findMany({
    where: {
      faiteLe: null,
      rappelNotifieLe: null,
      rappelJours: { not: null },
      echeance: { gt: new Date(`${aujourdhui}T00:00:00Z`), lte: plusJours(aujourdhui, 30) },
    },
    include: { participants: { select: { utilisateurId: true } } },
  });
  let notifies = 0;
  for (const a of candidates) {
    if (debutRappel(iso(a.echeance), a.rappelJours) > aujourdhui) continue;
    const ids = [a.assigneId, ...a.participants.map((p) => p.utilisateurId)];
    const actifs = await db.utilisateur.findMany({ where: { id: { in: ids }, actif: true }, select: { id: true } });
    const texte = `Rappel ${dansCombien(iso(a.echeance), aujourdhui)} : ${nomTypeActivite(a.type)} : ${a.resume} — ${quandFr(a)}`.slice(0, 255);
    await db.notification.createMany({ data: actifs.map((u) => ({ utilisateurId: u.id, genre: 'rappel', texte, lien: lienActivite(a) })) });
    await db.activite.update({ where: { id: a.id }, data: { rappelNotifieLe: maintenant } });
    notifies += actifs.length;
  }
  return { notifies };
}

/** Combien de minutes avant l'heure part l'alerte. */
export const ALERTE_MINUTES = 10;

/** L'heure de Casablanca en minutes depuis minuit, et le jour. */
function horloge(maintenant) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(maintenant);
  const valeur = (type) => Number(parts.find((p) => p.type === type).value);
  return { jour: jourCasablanca(maintenant), minutes: valeur('hour') * 60 + valeur('minute') };
}
const enMinutes = (heure) => Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5));

/**
 * L'alerte d'une activité à heure fixe : 10 minutes avant, une seule fois
 * (`alerteEnvoyeeLe`), dans la cloche et par mail, à la personne chargée et
 * aux participants. Une heure déjà passée de plus de 30 minutes (PC éteint)
 * ne déclenche plus rien. Le worker l'appelle chaque minute.
 *
 * @param {{ maintenant?: Date, log?: object }} options
 * @returns {Promise<{ alertes: number, mails: number }>}
 */
export async function alerterAvantHeure({ maintenant = new Date(), log = console } = {}) {
  const { jour, minutes } = horloge(maintenant);
  const candidates = await db.activite.findMany({
    where: { faiteLe: null, alerteEnvoyeeLe: null, heure: { not: null }, echeance: new Date(`${jour}T00:00:00Z`) },
    include: {
      participants: { select: { utilisateurId: true } },
      marche: { select: { reference: true } },
      client: { select: { nom: true } },
      fournisseur: { select: { nom: true } },
    },
  });
  const dues = candidates.filter((a) => {
    const h = enMinutes(a.heure);
    return minutes >= h - ALERTE_MINUTES && minutes <= h + 30;
  });
  if (!dues.length) return { alertes: 0, mails: 0 };

  const compte = await db.compteMail.findFirst({ where: { actif: true }, orderBy: { id: 'asc' } });
  let alertes = 0;
  let mails = 0;
  for (const a of dues) {
    // Noté d'abord : un mail en échec ne doit pas faire sonner l'alerte chaque minute.
    await db.activite.update({ where: { id: a.id }, data: { alerteEnvoyeeLe: maintenant } });
    const reste = enMinutes(a.heure) - minutes;
    const quand = reste > 0 ? `dans ${reste} min, à ${a.heure}` : reste === 0 ? `maintenant, à ${a.heure}` : `commencé à ${a.heure}`;
    const fiche = a.marche?.reference ?? a.client?.nom ?? a.fournisseur?.nom ?? null;
    const texte = `${nomTypeActivite(a.type)} ${quand} : ${a.resume}${fiche ? ` — ${fiche}` : ''}`.slice(0, 255);
    const personnes = await db.utilisateur.findMany({
      where: { id: { in: [a.assigneId, ...a.participants.map((p) => p.utilisateurId)] }, actif: true },
      select: { id: true, nom: true, email: true, rappelQuotidien: true },
    });
    await db.notification.createMany({ data: personnes.map((u) => ({ utilisateurId: u.id, genre: 'rappel', texte, lien: lienActivite(a) })) });
    alertes += personnes.length;
    if (!compte) continue;
    // Le mail suit le choix du profil (« Rappel du matin ») : qui l'a coupé ne reçoit que la cloche.
    for (const u of personnes.filter((x) => x.rappelQuotidien)) {
      try {
        await envoyerSansArchiver({
          compteId: compte.id,
          a: u.email,
          objet: `Rappel : ${a.resume} à ${a.heure}`,
          texte: [`Bonjour ${u.nom.split(' ')[0]},`, '', `${texte}.`, a.note ? `\n${a.note}` : null, '', `Ouvrir : ${config.APP_URL}${lienActivite(a)}`, '', 'Ce rappel se désactive dans votre profil.']
            .filter((l) => l !== null)
            .join('\n'),
        });
        mails += 1;
      } catch (erreur) {
        log.error?.(`Alerte pour ${u.email} en échec : ${erreur.message}`);
      }
    }
  }
  return { alertes, mails };
}
