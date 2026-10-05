/**
 * Exporter un tableau, comme dans Odoo : en Excel ou en CSV, avec les
 * colonnes qu'on choisit. Le choix est retenu sur ce poste, pour chaque
 * tableau : un confort, perdu sans dommage.
 *
 * Les colonnes viennent du serveur : elles suivent les droits (les prix
 * restent aux achats et à la direction).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { api } from '../api.js';
import { Bouton } from './Bouton.jsx';
import { SqueletteLignes } from './Elements.jsx';
import { Modale } from './Modale.jsx';
import { cx } from './cx.js';

function lireChoix(cle) {
  try {
    const lu = JSON.parse(localStorage.getItem(cle) ?? 'null');
    return lu && Array.isArray(lu.colonnes) ? lu : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ ouverte: boolean, surChangement: (o: boolean) => void, chemin: string, titre: string, filtres?: URLSearchParams }} props
 *   `chemin` : « /api/marches » ; `filtres` : ceux de l'écran, repris tels quels.
 */
export function ModaleExport({ ouverte, surChangement, chemin, titre, filtres }) {
  const cle = `icity.export${chemin.replace(/\//g, '.')}`;
  const retenu = lireChoix(cle);
  const colonnes = useQuery({ queryKey: ['export-colonnes', chemin], queryFn: () => api(`${chemin}/export/colonnes`), enabled: ouverte });
  const [format, setFormat] = useState(retenu?.format ?? 'xlsx');
  const [choisies, setChoisies] = useState(() => (retenu ? new Set(retenu.colonnes) : null));
  const toutes = colonnes.data ?? [];
  // Sans choix retenu, tout est coché.
  const actives = choisies ?? new Set(toutes.map((c) => c.cle));

  function basculer(c) {
    const apres = new Set(actives);
    if (apres.has(c)) apres.delete(c);
    else apres.add(c);
    setChoisies(apres);
  }

  function exporter() {
    const liste = toutes.filter((c) => actives.has(c.cle)).map((c) => c.cle);
    try {
      localStorage.setItem(cle, JSON.stringify({ format, colonnes: liste }));
    } catch {
      // Navigation privée : le choix sera oublié.
    }
    const parametres = new URLSearchParams(filtres ?? '');
    parametres.set('colonnes', liste.join(','));
    // Un lien, pas un appel : le navigateur enregistre le fichier lui-même.
    window.location.href = `${chemin}/export.${format}?${parametres}`;
    surChangement(false);
  }

  return (
    <Modale
      ouverte={ouverte}
      surChangement={surChangement}
      titre={titre}
      description="Le tableau tel qu’à l’écran (mêmes filtres), avec les colonnes cochées."
      pied={
        <>
          <Bouton variante="fantome" onClick={() => surChangement(false)}>
            Annuler
          </Bouton>
          <Bouton icone={Download} disabled={!actives.size} onClick={exporter}>
            Exporter
          </Bouton>
        </>
      }
    >
      <div role="radiogroup" aria-label="Format" className="mb-4 grid grid-cols-2 gap-2">
        {[
          ['xlsx', 'Excel (.xlsx)', 'Des nombres qu’on additionne, un filtre sur chaque colonne'],
          ['csv', 'CSV', 'Pour un autre logiciel'],
        ].map(([code, libelle, aide]) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={format === code}
            onClick={() => setFormat(code)}
            className={cx('rounded-[10px] border p-3 text-left', format === code ? 'border-cyan bg-cyan-voile' : 'border-trait hover:border-trait-fort')}
          >
            <span className="flex items-center gap-2 text-[14px] font-semibold">
              <FileSpreadsheet className="size-4" aria-hidden /> {libelle}
            </span>
            <span className="mt-0.5 block text-[13px] text-encre-3">{aide}</span>
          </button>
        ))}
      </div>

      {colonnes.isPending ? (
        <SqueletteLignes lignes={4} />
      ) : (
        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-[13px] font-semibold text-encre-2">
            Colonnes ({actives.size} sur {toutes.length})
            <span className="flex gap-3 font-normal">
              <button type="button" onClick={() => setChoisies(new Set(toutes.map((c) => c.cle)))} className="text-cyan-texte hover:underline">
                Tout cocher
              </button>
              <button type="button" onClick={() => setChoisies(new Set())} className="text-cyan-texte hover:underline">
                Tout décocher
              </button>
            </span>
          </legend>
          <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
            {toutes.map((c) => (
              <label key={c.cle} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[14px] hover:bg-surface-2">
                <input type="checkbox" checked={actives.has(c.cle)} onChange={() => basculer(c.cle)} className="size-4 accent-[var(--cyan)]" />
                {c.titre}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </Modale>
  );
}
