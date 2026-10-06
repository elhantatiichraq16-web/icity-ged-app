/**
 * Les champs de formulaire. Chacun a toujours un libellé relié (htmlFor),
 * et son message d'erreur est annoncé par les lecteurs d'écran
 * (aria-describedby + aria-invalid) : la couleur seule ne suffit pas.
 *
 * `enLigne` met le libellé à gauche du champ sur écran large, comme sur une
 * fiche ; sur téléphone, il repasse au-dessus.
 */
import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cx } from './cx.js';

const BASE_CHAMP =
  'w-full rounded-[10px] border bg-surface-2 px-3.5 text-[14.5px] text-encre placeholder:text-encre-3 transition-[border-color,box-shadow,background-color] duration-150 ' +
  'hover:border-trait-fort focus:bg-surface focus:outline-none focus:border-cyan focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--cyan),transparent_85%)] ' +
  'disabled:opacity-60';

function Enveloppe({ id, libelle, aide, erreur, children, className, facultatif, enLigne }) {
  return (
    <div className={cx('grid gap-1.5', enLigne && 'sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-x-4', className)}>
      {libelle && (
        <label htmlFor={id} className={cx('text-[13px] font-semibold text-encre-2', enLigne && 'sm:pt-3')}>
          {libelle}
          {facultatif && <span className="font-normal text-encre-3"> (facultatif)</span>}
        </label>
      )}
      {children}
      {erreur ? (
        <p id={`${id}-erreur`} className={cx('text-[13px] font-medium text-alerte-texte', enLigne && 'sm:col-start-2')}>
          {erreur}
        </p>
      ) : aide ? (
        <p id={`${id}-aide`} className={cx('text-[13px] text-encre-3', enLigne && 'sm:col-start-2')}>
          {aide}
        </p>
      ) : null}
    </div>
  );
}

function aria(id, erreur, aide) {
  return {
    'aria-invalid': erreur ? true : undefined,
    'aria-describedby': erreur ? `${id}-erreur` : aide ? `${id}-aide` : undefined,
  };
}

export const Champ = forwardRef(function Champ({ libelle, aide, erreur, className, facultatif, id: idFourni, ...reste }, ref) {
  const idAuto = useId();
  const id = idFourni ?? idAuto;
  return (
    <Enveloppe id={id} libelle={libelle} aide={aide} erreur={erreur} className={className} facultatif={facultatif}>
      <input
        ref={ref}
        id={id}
        className={cx(BASE_CHAMP, 'h-11', erreur ? 'border-alerte' : 'border-trait')}
        {...aria(id, erreur, aide)}
        {...reste}
      />
    </Enveloppe>
  );
});

/** Un texte de plusieurs lignes : des notes, une remarque. */
export const ZoneTexte = forwardRef(function ZoneTexte({ libelle, aide, erreur, className, facultatif, lignes = 3, ...reste }, ref) {
  const id = useId();
  return (
    <Enveloppe id={id} libelle={libelle} aide={aide} erreur={erreur} className={className} facultatif={facultatif}>
      <textarea
        ref={ref}
        id={id}
        rows={lignes}
        className={cx(BASE_CHAMP, 'resize-y py-2.5 leading-relaxed', erreur ? 'border-alerte' : 'border-trait')}
        {...aria(id, erreur, aide)}
        {...reste}
      />
    </Enveloppe>
  );
});

/** Mot de passe avec le bouton « œil » pour l'afficher ou le masquer. */
export const ChampMotDePasse = forwardRef(function ChampMotDePasse({ libelle = 'Mot de passe', aide, erreur, className, ...reste }, ref) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <Enveloppe id={id} libelle={libelle} aide={aide} erreur={erreur} className={className}>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? 'text' : 'password'}
          className={cx(BASE_CHAMP, 'h-11 pr-12', erreur ? 'border-alerte' : 'border-trait')}
          {...aria(id, erreur, aide)}
          {...reste}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          aria-pressed={visible}
          className={cx(
            'absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-lg transition-colors hover:bg-trait',
            visible ? 'text-cyan' : 'text-encre-3 hover:text-encre-2',
          )}
        >
          {visible ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
        </button>
      </div>
    </Enveloppe>
  );
});

export const Selection = forwardRef(function Selection({ libelle, aide, erreur, className, children, enLigne, facultatif, ...reste }, ref) {
  const id = useId();
  return (
    <Enveloppe id={id} libelle={libelle} aide={aide} erreur={erreur} className={className} enLigne={enLigne} facultatif={facultatif}>
      <select ref={ref} id={id} className={cx(BASE_CHAMP, 'h-11 pr-8', erreur ? 'border-alerte' : 'border-trait')} {...aria(id, erreur, aide)} {...reste}>
        {children}
      </select>
    </Enveloppe>
  );
});

export function CaseACocher({ libelle, className, erreur: _erreur, ...reste }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('inline-flex cursor-pointer items-center gap-2.5 text-[13.5px] text-encre-2', className)}>
      <input id={id} type="checkbox" className="size-4 cursor-pointer rounded accent-[var(--cyan)]" {...reste} />
      <span>{libelle}</span>
    </label>
  );
}
