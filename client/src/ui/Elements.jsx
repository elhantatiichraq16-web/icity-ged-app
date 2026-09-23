/**
 * Petits éléments d'affichage : carte, en-tête de page, badge, alerte,
 * squelette de chargement, état vide.
 */
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cx } from './cx.js';

export function Carte({ className, children, as: Balise = 'section', ...reste }) {
  return (
    <Balise className={cx('rounded-carte border border-trait bg-surface shadow-carte', className)} {...reste}>
      {children}
    </Balise>
  );
}

/** Le titre d'un écran, avec sa description et ses actions à droite. */
export function EnTetePage({ titre, description, actions, surtitre }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {surtitre && <p className="mb-1 text-[12px] font-semibold tracking-[0.08em] text-cyan-texte uppercase">{surtitre}</p>}
        <h1 className="text-[28px] leading-tight font-semibold sm:text-[32px]">{titre}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-encre-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

const TONS_BADGE = {
  neutre: 'bg-surface-2 text-encre-2 border-trait',
  cyan: 'bg-cyan-voile text-cyan-texte border-transparent',
  ok: 'bg-ok-voile text-ok border-transparent',
  attente: 'bg-attente-voile text-attente border-transparent',
  alerte: 'bg-alerte-voile text-alerte-texte border-transparent',
  bordeaux: 'bg-[color-mix(in_oklab,var(--bordeaux),transparent_90%)] text-bordeaux border-transparent',
};

export function Badge({ ton = 'neutre', className, children }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap', TONS_BADGE[ton], className)}>
      {children}
    </span>
  );
}

const TONS_ALERTE = {
  info: { classes: 'border-cyan bg-cyan-voile text-encre', Icone: Info, couleur: 'text-cyan-texte' },
  ok: { classes: 'border-ok bg-ok-voile text-encre', Icone: CheckCircle2, couleur: 'text-ok' },
  attente: { classes: 'border-attente bg-attente-voile text-encre', Icone: AlertTriangle, couleur: 'text-attente' },
  alerte: { classes: 'border-alerte bg-alerte-voile text-alerte-texte', Icone: XCircle, couleur: 'text-alerte' },
};

/** Un message dans la page, avec un filet coloré à gauche (repris du portail). */
export function Alerte({ ton = 'info', titre, children, className }) {
  const { classes, Icone, couleur } = TONS_ALERTE[ton];
  return (
    <div role={ton === 'alerte' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-lg border-l-[3px] px-4 py-3 text-[13.5px]', classes, className)}>
      <Icone className={cx('mt-0.5 size-4 shrink-0', couleur)} aria-hidden />
      <div className="min-w-0">
        {titre && <p className="font-semibold">{titre}</p>}
        {children}
      </div>
    </div>
  );
}

/** Un bloc gris qui palpite pendant le chargement, à la forme du contenu attendu. */
export function Squelette({ className }) {
  return <div aria-hidden className={cx('animate-miroitement rounded-md bg-trait', className)} />;
}

export function SqueletteLignes({ lignes = 4 }) {
  return (
    <div className="grid gap-3" role="status" aria-label="Chargement…">
      {Array.from({ length: lignes }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Squelette className="size-9 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Squelette className="h-3.5 w-1/3" />
            <Squelette className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Un écran ou une liste sans contenu : une illustration sobre, une phrase
 * qui dit pourquoi, et l'action pour en sortir.
 */
export function EtatVide({ titre, children, action, illustration = 'dossier', className }) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      <IllustrationVide type={illustration} />
      <h2 className="mt-5 text-xl font-semibold">{titre}</h2>
      {children && <p className="mt-2 max-w-md text-encre-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function IllustrationVide({ type }) {
  // Dessins en SVG, aux couleurs du thème : ils suivent le mode sombre.
  return (
    <svg viewBox="0 0 160 120" className="h-28 w-auto" aria-hidden>
      <ellipse cx="80" cy="106" rx="54" ry="7" fill="var(--trait)" />
      {type === 'chantier' ? (
        <>
          <rect x="34" y="30" width="92" height="64" rx="10" fill="var(--surface)" stroke="var(--trait-fort)" strokeWidth="2" />
          <path d="M34 48h92" stroke="var(--trait-fort)" strokeWidth="2" />
          <circle cx="46" cy="39" r="3" fill="var(--bordeaux)" />
          <circle cx="56" cy="39" r="3" fill="var(--attente)" />
          <circle cx="66" cy="39" r="3" fill="var(--ok)" />
          <path d="M50 82l18-20 12 12 10-8 20 16" fill="none" stroke="var(--cyan)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M104 18l14 10-10 14-14-10z" fill="var(--cyan-vif)" opacity=".85" />
        </>
      ) : (
        <>
          <path d="M30 40a8 8 0 0 1 8-8h26l10 10h48a8 8 0 0 1 8 8v44a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8z" fill="var(--cyan-voile)" stroke="var(--cyan)" strokeWidth="2" />
          <rect x="48" y="24" width="56" height="42" rx="5" fill="var(--surface)" stroke="var(--trait-fort)" strokeWidth="2" transform="rotate(-6 76 45)" />
          <path d="M58 38h30M58 46h22" stroke="var(--trait-fort)" strokeWidth="2.5" strokeLinecap="round" transform="rotate(-6 76 45)" />
          <path d="M30 58h100v36a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8z" fill="var(--surface)" stroke="var(--cyan)" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}
