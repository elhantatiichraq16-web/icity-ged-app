import { forwardRef } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from './cx.js';

const VARIANTES = {
  principal:
    'bg-cyan text-white shadow-[0_2px_6px_rgb(14_130_150/0.28)] hover:bg-[color-mix(in_oklab,var(--cyan),black_12%)] dark:text-[#04232a]',
  secondaire: 'bg-surface text-encre border border-trait hover:border-trait-fort hover:bg-surface-2',
  fantome: 'text-encre-2 hover:bg-surface-2 hover:text-encre',
  danger: 'bg-alerte text-white hover:bg-[color-mix(in_oklab,var(--alerte),black_12%)] dark:text-[#2a0a0a]',
};

const TAILLES = {
  petit: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  normal: 'h-10 px-4 text-sm gap-2 rounded-[10px]',
  grand: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
  icone: 'h-9 w-9 justify-center rounded-lg',
};

/**
 * Le bouton de l'application.
 *
 * `chargement` le désactive et affiche une roue avec son libellé d'attente
 * (« Vérification… ») : on voit que la demande est partie, et un double clic
 * n'envoie pas deux fois.
 */
export const Bouton = forwardRef(function Bouton(
  { variante = 'principal', taille = 'normal', chargement = false, libelleChargement, icone: Icone, className, children, disabled, type = 'button', ...reste },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || chargement}
      aria-busy={chargement || undefined}
      className={cx(
        'inline-flex select-none items-center font-semibold whitespace-nowrap transition-[background-color,border-color,color,transform,box-shadow] duration-150',
        'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0',
        VARIANTES[variante],
        TAILLES[taille],
        className,
      )}
      {...reste}
    >
      {chargement ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : Icone ? <Icone className="size-4 shrink-0" aria-hidden /> : null}
      {chargement && libelleChargement ? libelleChargement : children}
    </button>
  );
});
