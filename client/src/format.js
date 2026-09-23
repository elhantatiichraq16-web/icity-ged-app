/** Formats d'affichage, toujours en français et à l'heure du Maroc. */

const FUSEAU = 'Africa/Casablanca';

export function dateHeure(valeur) {
  if (!valeur) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: FUSEAU }).format(new Date(valeur));
}

/** « il y a 5 min », « il y a 3 j »… */
export function depuis(valeur) {
  if (!valeur) return 'jamais';
  const secondes = Math.round((new Date(valeur).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  const unites = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unite, taille] of unites) {
    if (Math.abs(secondes) >= taille) return rtf.format(Math.round(secondes / taille), unite);
  }
  return 'à l’instant';
}

/** Un nom lisible pour un navigateur, d'après son « user-agent ». */
export function appareil(agent = '') {
  const navigateur = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Navigateur';
  const systeme = /Windows/.test(agent) ? 'Windows' : /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Mac OS/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '';
  return systeme ? `${navigateur} sur ${systeme}` : navigateur;
}

/** Une date en « 12 juin 2024 ». */
export function dateCourte(valeur) {
  if (!valeur) return '—';
  const d = valeur instanceof Date ? valeur : new Date(`${String(valeur).slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Un montant en dirhams : « 1 250 000,00 DH ». */
export function montant(valeur) {
  if (valeur === null || valeur === undefined) return '—';
  return new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD', maximumFractionDigits: 2 }).format(valeur);
}
