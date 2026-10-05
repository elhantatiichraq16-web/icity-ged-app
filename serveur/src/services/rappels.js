/**
 * Le rappel du matin, comme le résumé quotidien d'Odoo : à chacun, par mail,
 * ses activités en retard et celles du jour, avec un lien vers l'application.
 *
 * Il part une seule fois par jour et par personne (`rappelEnvoyeLe`) : le
 * worker le tente à 8 h, et au démarrage si le PC était éteint à 8 h. Qui n'a
 * rien à faire ne reçoit rien ; qui l'a désactivé dans son profil non plus.
 */
import { jourCasablanca, nomTypeActivite } from '@icity/commun/activites';
import { config } from '../config.js';
import { db } from '../db.js';
import { envoyerSansArchiver } from './courriel-sortant.js';

const jourFr = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** Le texte du rappel d'une personne. */
export function texteRappel(nom, activites, aujourdhui, url = config.APP_URL) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const retard = activites.filter((a) => iso(a.echeance) < aujourdhui);
  const jour = activites.filter((a) => iso(a.echeance) === aujourdhui);
  const ligne = (a) => {
    const fiche = a.marche?.reference ?? a.client?.nom ?? a.fournisseur?.nom ?? (a.commande ? `commande ${a.commande.fournisseur?.nom ?? ''}`.trim() : null);
    return `  • ${nomTypeActivite(a.type)} : ${a.resume}${fiche ? ` (${fiche})` : ''}${iso(a.echeance) < aujourdhui ? ` — prévue le ${jourFr(iso(a.echeance))}` : ''}`;
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
    const activites = await db.activite.findMany({
      where: { assigneId: p.id, faiteLe: null, echeance: { lte: new Date(`${aujourdhui}T00:00:00Z`) } },
      include: {
        marche: { select: { reference: true } },
        client: { select: { nom: true } },
        fournisseur: { select: { nom: true } },
        commande: { select: { fournisseur: { select: { nom: true } } } },
      },
      orderBy: { echeance: 'asc' },
    });
    if (!activites.length) continue;
    const enRetard = activites.filter((a) => a.echeance.toISOString().slice(0, 10) < aujourdhui).length;
    try {
      await envoyerSansArchiver({
        compteId: compte.id,
        a: p.email,
        objet: `Vos activités du jour : ${activites.length}${enRetard ? ` (dont ${enRetard} en retard)` : ''}`,
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
