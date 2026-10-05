import { cx } from './cx.js';

const TAILLES = { petit: 'size-8 text-[13px]', normal: 'size-10 text-sm', grand: 'size-20 text-2xl' };

/** Les initiales d'un nom : « Ichrak Elhantati » → « IE ». */
export function initiales(nom = '') {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  return ((mots[0]?.[0] ?? '') + (mots.length > 1 ? mots.at(-1)[0] : '')).toUpperCase() || '?';
}

/** La photo de l'utilisateur, ou ses initiales sur fond cyan. */
export function Avatar({ utilisateur, taille = 'normal', className }) {
  const classes = cx('inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold', TAILLES[taille], className);
  if (utilisateur?.avatar) {
    return <img src={utilisateur.avatar} alt="" className={cx(classes, 'object-cover')} />;
  }
  return (
    <span aria-hidden className={cx(classes, 'bg-cyan-voile text-cyan-texte')}>
      {initiales(utilisateur?.nom)}
    </span>
  );
}
