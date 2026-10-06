/**
 * Ce que partagent les routes des activités, le calendrier et les rappels :
 * qui une activité concerne, où elle mène, comment dire sa date.
 */

/** Les activités qui me concernent : confiées à moi, ou auxquelles je participe. */
export const QUI_ME_CONCERNENT = (moi) => ({ OR: [{ assigneId: moi }, { participants: { some: { utilisateurId: moi } } }] });

/**
 * Les activités qu'on a le droit de voir : celles d'un fournisseur ou d'une
 * commande restent, comme leurs fiches, aux achats et à la direction.
 *
 * @param {import('@casl/ability').PureAbility} droits
 */
export function activitesVisibles(droits) {
  const cachees = [];
  if (!droits.can('lire', 'Fournisseur')) cachees.push({ fournisseurId: { not: null } });
  if (!droits.can('lire', 'PrixAchat')) cachees.push({ commandeId: { not: null } });
  return cachees.length ? { NOT: cachees } : {};
}

/** Peut-on voir cette activité-là ? */
export const activiteVisible = (droits, a) => (!a.fournisseurId || droits.can('lire', 'Fournisseur')) && (!a.commandeId || droits.can('lire', 'PrixAchat'));

/** Où mène une activité : sa fiche, ou le calendrier à sa date pour un événement libre. */
export function lienActivite(a) {
  if (a.marcheId) return `/marches/${a.marcheId}`;
  if (a.clientId) return `/clients/${a.clientId}`;
  if (a.commandeId) return `/achats/commandes/${a.commandeId}`;
  if (a.fournisseurId) return `/achats/fournisseurs/${a.fournisseurId}`;
  return `/calendrier?date=${a.echeance.toISOString().slice(0, 10)}`;
}

const jourFr = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** « le jeudi 9 octobre à 10:00 » */
export const quandFr = (a) => `le ${jourFr(a.echeance.toISOString().slice(0, 10))}${a.heure ? ` à ${a.heure}` : ''}`;
