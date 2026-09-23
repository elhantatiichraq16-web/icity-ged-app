/**
 * Les notifications éphémères (« toasts »), en bas à droite.
 *
 * Usage : const { notifier } = useToasts();
 *         notifier({ titre: 'Profil enregistré', ton: 'ok' });
 *
 * La zone est une région « aria-live » : les lecteurs d'écran annoncent
 * chaque message sans que le focus ne bouge.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { cx } from './cx.js';

const Contexte = createContext(null);

const ICONES = {
  info: { Icone: Info, couleur: 'text-cyan' },
  ok: { Icone: CheckCircle2, couleur: 'text-ok' },
  attente: { Icone: TriangleAlert, couleur: 'text-attente' },
  alerte: { Icone: XCircle, couleur: 'text-alerte' },
};

export function FournisseurToasts({ children }) {
  const [toasts, setToasts] = useState([]);
  const compteur = useRef(0);

  const retirer = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notifier = useCallback(
    ({ titre, message, ton = 'info', action, duree = 5000 }) => {
      const id = ++compteur.current;
      setToasts((t) => [...t.slice(-3), { id, titre, message, ton, action }]);
      if (duree) setTimeout(() => retirer(id), duree);
      return id;
    },
    [retirer],
  );

  const valeur = useMemo(() => ({ notifier, retirer }), [notifier, retirer]);

  return (
    <Contexte.Provider value={valeur}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => {
          const { Icone, couleur } = ICONES[t.ton] ?? ICONES.info;
          return (
            <div key={t.id} role="status" className="pointer-events-auto flex animate-glisse gap-3 rounded-xl border border-trait bg-surface p-3.5 shadow-haute">
              <Icone className={cx('mt-0.5 size-5 shrink-0', couleur)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-encre">{t.titre}</p>
                {t.message && <p className="mt-0.5 text-[13px] text-encre-2">{t.message}</p>}
                {t.action && (
                  <button type="button" onClick={() => { t.action.onClick(); retirer(t.id); }} className="mt-2 text-[13px] font-semibold text-cyan-texte hover:underline">
                    {t.action.libelle}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => retirer(t.id)} aria-label="Fermer la notification" className="grid size-7 shrink-0 place-items-center rounded-md text-encre-3 hover:bg-surface-2 hover:text-encre">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </Contexte.Provider>
  );
}

export function useToasts() {
  const v = useContext(Contexte);
  if (!v) throw new Error('useToasts() doit être utilisé sous <FournisseurToasts>.');
  return v;
}
