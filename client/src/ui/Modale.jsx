/**
 * Fenêtre modale accessible (Radix Dialog) : le focus reste à l'intérieur,
 * Échap la ferme, le titre est annoncé aux lecteurs d'écran.
 */
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cx } from './cx.js';
import { Bouton } from './Bouton.jsx';

export function Modale({ ouverte, surChangement, titre, description, children, pied, largeur = 'max-w-lg' }) {
  return (
    <Dialog.Root open={ouverte} onOpenChange={surChangement}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-apparition bg-[rgb(8_15_20/0.45)] backdrop-blur-[2px]" />
        <Dialog.Content
          className={cx(
            'fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
            'animate-apparition rounded-carte border border-trait bg-surface p-6 shadow-haute focus:outline-none',
            largeur,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-titre text-xl font-semibold">{titre}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-encre-2">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{titre}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface-2 hover:text-encre" aria-label="Fermer">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>
          {children}
          {/* Les boutons restent visibles en bas, même quand la fenêtre défile (petit écran). */}
          {pied && <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 mt-6 flex flex-wrap justify-end gap-2 border-t border-trait bg-surface px-6 py-4">{pied}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * La demande de confirmation avant un geste qu'on ne défait pas d'un clic.
 *
 * Le bouton qui confirme porte le verbe de l'action — « Mettre en corbeille »
 * plutôt qu'« OK » : on doit savoir ce qu'on valide sans relire la question.
 */
export function Confirmation({ ouverte, surChangement, titre, description, libelle = 'Confirmer', ton = 'danger', chargement = false, surConfirmer }) {
  return (
    <Modale ouverte={ouverte} surChangement={surChangement} titre={titre} description={description}>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Bouton variante="fantome" onClick={() => surChangement(false)} disabled={chargement}>
          Annuler
        </Bouton>
        <Bouton variante={ton} onClick={surConfirmer} chargement={chargement} libelleChargement="…">
          {libelle}
        </Bouton>
      </div>
    </Modale>
  );
}
