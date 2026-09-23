/**
 * La recherche globale, ouverte par Ctrl+K (ou Cmd+K sur Mac).
 *
 * Elle mène aux écrans, et cherche aussi dans les marchés et dans le texte
 * des documents (§11, écran 5). La frappe est temporisée de 350 ms.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, FileText, FolderKanban, Search, User } from 'lucide-react';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { cx } from '../ui/cx.js';
import { entreesVisibles } from './navigation.js';
import { Dialog } from 'radix-ui';

/** Compare sans tenir compte des accents ni de la casse. */
const plat = (t) => t.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();

export function PaletteCommandes({ ouverte, surChangement }) {
  const { droits } = useSession();
  const naviguer = useNavigate();
  const [texte, setTexte] = useState('');
  const [tempo, setTempo] = useState('');
  const [actif, setActif] = useState(0);
  const liste = useRef(null);

  // Frappe temporisée : on n'interroge le serveur qu'une fois la saisie posée.
  useEffect(() => {
    const minuterie = setTimeout(() => setTempo(texte.trim()), 350);
    return () => clearTimeout(minuterie);
  }, [texte]);

  const fonds = useQuery({
    queryKey: ['palette', tempo],
    queryFn: () => api(`/api/recherche?q=${encodeURIComponent(tempo)}`),
    enabled: ouverte && tempo.length >= 2,
  });

  const commandes = useMemo(() => {
    const ecrans = [
      ...entreesVisibles(droits).map((e) => ({ id: `e${e.chemin}`, libelle: e.libelle, groupe: 'Aller à', icone: e.icone, chemin: e.chemin })),
      { id: 'e/profil', libelle: 'Mon profil', groupe: 'Aller à', icone: User, chemin: '/profil' },
    ].filter((c) => plat(c.libelle).includes(plat(texte.trim())));

    const marches = (fonds.data?.marches ?? []).map((m) => ({
      id: `m${m.id}`,
      libelle: m.reference,
      detail: m.objet ?? m.client ?? '',
      groupe: 'Marchés',
      icone: FolderKanban,
      chemin: `/marches/${m.id}`,
    }));

    const documents = (fonds.data?.resultats ?? []).slice(0, 6).map((d) => ({
      id: `d${d.id}`,
      libelle: d.titre,
      detail: [d.type?.nom, d.marche?.reference, d.client?.nom].filter(Boolean).join(' · '),
      groupe: 'Documents',
      icone: FileText,
      chemin: `/documents/${d.id}`,
    }));

    const tout =
      tempo.length >= 2
        ? [{ id: 'tout', libelle: `Voir tous les résultats pour « ${tempo} »`, groupe: 'Recherche', icone: Search, chemin: `/recherche?q=${encodeURIComponent(tempo)}` }]
        : [];

    return [...ecrans, ...marches, ...documents, ...tout];
  }, [droits, texte, tempo, fonds.data]);

  useEffect(() => setActif(0), [texte, fonds.data]);
  useEffect(() => {
    if (!ouverte) {
      setTexte('');
      setTempo('');
    }
  }, [ouverte]);

  function executer(c) {
    if (!c) return;
    surChangement(false);
    naviguer(c.chemin);
  }

  function clavier(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActif((i) => Math.min(i + 1, commandes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActif((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executer(commandes[actif]);
    }
  }

  useEffect(() => {
    liste.current?.querySelector('[data-actif="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [actif]);

  let groupePrecedent = null;

  return (
    <Dialog.Root open={ouverte} onOpenChange={surChangement}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-apparition bg-[rgb(8_15_20/0.45)] backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-apparition overflow-hidden rounded-carte border border-trait bg-surface shadow-haute focus:outline-none">
          <Dialog.Title className="sr-only">Recherche globale</Dialog.Title>
          <Dialog.Description className="sr-only">Tapez pour chercher, flèches pour choisir, Entrée pour ouvrir.</Dialog.Description>
          <div className="flex items-center gap-3 border-b border-trait px-4">
            <Search className="size-5 text-encre-3" aria-hidden />
            <input
              autoFocus
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              onKeyDown={clavier}
              placeholder="Un écran, un marché, un mot dans un document…"
              aria-label="Rechercher"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-resultats"
              aria-activedescendant={commandes[actif] ? `palette-${actif}` : undefined}
              className="h-14 flex-1 bg-transparent text-[15px] text-encre placeholder:text-encre-3 focus:outline-none"
            />
            {fonds.isFetching && <span className="text-[12px] text-encre-3">recherche…</span>}
            <kbd className="rounded border border-trait px-1.5 py-0.5 font-mono text-[11px] text-encre-3">Échap</kbd>
          </div>

          <ul ref={liste} id="palette-resultats" role="listbox" className="max-h-96 overflow-y-auto p-2">
            {commandes.length === 0 && <li className="px-3 py-6 text-center text-sm text-encre-3">{texte ? `Aucun résultat pour « ${texte} ».` : 'Tapez pour chercher.'}</li>}
            {commandes.map((c, i) => {
              const Icone = c.icone;
              const nouveauGroupe = c.groupe !== groupePrecedent;
              groupePrecedent = c.groupe;
              return (
                <li key={c.id}>
                  {nouveauGroupe && <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-encre-3 uppercase">{c.groupe}</p>}
                  <div
                    id={`palette-${i}`}
                    role="option"
                    aria-selected={i === actif}
                    data-actif={i === actif}
                    onMouseMove={() => setActif(i)}
                    onClick={() => executer(c)}
                    className={cx('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm', i === actif ? 'bg-cyan-voile text-encre' : 'text-encre-2')}
                  >
                    <Icone className={cx('size-4 shrink-0', i === actif ? 'text-cyan-texte' : 'text-encre-3')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.libelle}</span>
                      {c.detail && <span className="block truncate text-[12px] text-encre-3">{c.detail}</span>}
                    </span>
                    {i === actif && <CornerDownLeft className="size-3.5 shrink-0 text-encre-3" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
