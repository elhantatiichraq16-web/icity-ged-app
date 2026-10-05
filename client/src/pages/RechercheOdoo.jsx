/**
 * La barre de recherche d'Odoo, pour la liste des marchés : des filtres prêts
 * à cocher, un « Regrouper par », et des favoris (une recherche enregistrée
 * sous un nom, rappelée d'un clic).
 *
 * Les favoris sont gardés sur ce poste, pour chaque compte : un confort
 * personnel, qui ne touche à aucune donnée du fonds.
 */
import { useState } from 'react';
import { Popover } from 'radix-ui';
import { ChevronDown, Filter, Layers, Star, Trash2, X } from 'lucide-react';
import { ORDRE_PHASES, PHASES } from '@icity/commun/marches';
import { cx } from '../ui/cx.js';

/** Les filtres prêts à cocher. `test(m, moi)` dit si un marché passe. */
export const FILTRES_MARCHES = [
  { cle: 'incomplets', libelle: 'Dossier incomplet', test: (m) => m.manquantes.length > 0 },
  { cle: 'retard', libelle: 'Échéance dépassée', test: (m) => m.etatEcheance === 'depassee' },
  { cle: 'proche', libelle: 'Échéance proche', test: (m) => m.etatEcheance === 'proche' },
  { cle: 'sansClient', libelle: 'Sans client', test: (m) => !m.client },
  { cle: 'miens', libelle: 'Mes marchés', test: (m, moi) => m.responsable?.id === moi },
  { cle: 'sansMontant', libelle: 'Montant non renseigné', test: (m) => !m.montantTtc },
];

/** Les regroupements possibles : un libellé de groupe pour chaque marché. */
export const REGROUPEMENTS = [
  { cle: 'client', libelle: 'Client', valeur: (m) => m.client?.nom ?? 'Sans client' },
  { cle: 'phase', libelle: 'Phase', valeur: (m) => PHASES[m.phase]?.nom ?? m.phase, ordre: (m) => ORDRE_PHASES.indexOf(m.phase) },
  { cle: 'ville', libelle: 'Ville', valeur: (m) => m.ville ?? 'Sans ville' },
  { cle: 'objetTechnique', libelle: 'Objet technique', valeur: (m) => m.objetTechnique ?? 'Non précisé' },
  { cle: 'responsable', libelle: 'Responsable', valeur: (m) => m.responsable?.nom ?? 'Sans responsable' },
];

/**
 * Les marchés regroupés : `[{ libelle, marches, montant }]`, dans l'ordre
 * naturel du regroupement (les phases dans l'ordre du cycle, le reste par nom).
 */
export function regrouper(marches, cle) {
  const r = REGROUPEMENTS.find((x) => x.cle === cle);
  if (!r) return null;
  const groupes = new Map();
  for (const m of marches) {
    const libelle = r.valeur(m);
    const g = groupes.get(libelle) ?? { libelle, marches: [], montant: 0, ordre: r.ordre ? r.ordre(m) : 0 };
    g.marches.push(m);
    g.montant += m.montantTtc ?? 0;
    groupes.set(libelle, g);
  }
  return [...groupes.values()].sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle, 'fr', { numeric: true }));
}

/** Les favoris d'un compte, gardés sur ce poste. */
export function useFavoris(cle) {
  const lire = () => {
    try {
      const lu = JSON.parse(localStorage.getItem(cle) ?? '[]');
      return Array.isArray(lu) ? lu : [];
    } catch {
      return [];
    }
  };
  const [favoris, setFavoris] = useState(lire);
  function ecrire(liste) {
    setFavoris(liste);
    try {
      localStorage.setItem(cle, JSON.stringify(liste));
    } catch {
      // Navigation privée : les favoris seront oubliés, rien de plus.
    }
  }
  return {
    favoris,
    enregistrer: (nom, etat) => ecrire([...favoris.filter((f) => f.nom !== nom), { nom, ...etat }]),
    retirer: (nom) => ecrire(favoris.filter((f) => f.nom !== nom)),
  };
}

const TITRE = 'mb-2 flex items-center gap-1.5 font-sans text-[13px] font-semibold tracking-[0.06em] text-encre-3 uppercase';
const CHOIX = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-surface-2';

/**
 * Le bouton « Filtres ▾ » et son panneau en trois colonnes, comme Odoo.
 *
 * @param {{ filtres: Set<string>, basculerFiltre: (cle: string) => void, groupe: string,
 *           setGroupe: (cle: string) => void, favoris: object[], appliquerFavori: (f: object) => void,
 *           enregistrerFavori: (nom: string) => void, retirerFavori: (nom: string) => void }} props
 */
export function MenuRecherche({ filtres, basculerFiltre, groupe, setGroupe, favoris, appliquerFavori, enregistrerFavori, retirerFavori }) {
  const [nom, setNom] = useState('');
  const actifs = filtres.size + (groupe ? 1 : 0);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cx(
            'inline-flex h-10 items-center gap-2 rounded-[10px] border px-3 text-sm font-medium transition-colors',
            actifs ? 'border-cyan bg-cyan-voile text-cyan-texte' : 'border-trait bg-surface-2 text-encre-2 hover:border-trait-fort',
          )}
        >
          <Filter className="size-4" aria-hidden /> Filtres
          {actifs > 0 && <span className="chiffres rounded-full bg-cyan px-1.5 text-[12.5px] text-white">{actifs}</span>}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 grid w-[min(44rem,calc(100vw-2rem))] animate-apparition gap-5 rounded-carte border border-trait bg-surface p-4 shadow-haute sm:grid-cols-3"
        >
          <div>
            <p className={TITRE}>
              <Filter className="size-3.5" aria-hidden /> Filtres
            </p>
            {FILTRES_MARCHES.map((f) => (
              <label key={f.cle} className={cx(CHOIX, 'cursor-pointer')}>
                <input type="checkbox" checked={filtres.has(f.cle)} onChange={() => basculerFiltre(f.cle)} className="size-4 accent-[var(--cyan)]" />
                {f.libelle}
              </label>
            ))}
          </div>

          <div>
            <p className={TITRE}>
              <Layers className="size-3.5" aria-hidden /> Regrouper par
            </p>
            {REGROUPEMENTS.map((r) => (
              <label key={r.cle} className={cx(CHOIX, 'cursor-pointer')}>
                <input type="radio" name="regrouper" checked={groupe === r.cle} onChange={() => setGroupe(r.cle)} className="size-4 accent-[var(--cyan)]" />
                {r.libelle}
              </label>
            ))}
            {groupe && (
              <button type="button" onClick={() => setGroupe('')} className="mt-1 px-2 text-[13px] font-semibold text-cyan-texte hover:underline">
                Ne plus regrouper
              </button>
            )}
          </div>

          <div>
            <p className={TITRE}>
              <Star className="size-3.5" aria-hidden /> Favoris
            </p>
            {favoris.length === 0 && <p className="px-2 pb-2 text-[13px] text-encre-3">Aucune recherche enregistrée.</p>}
            {favoris.map((f) => (
              <div key={f.nom} className="flex items-center">
                <Popover.Close asChild>
                  <button type="button" onClick={() => appliquerFavori(f)} className={cx(CHOIX, 'min-w-0 flex-1')}>
                    <Star className="size-3.5 shrink-0 text-attente" aria-hidden />
                    <span className="truncate">{f.nom}</span>
                  </button>
                </Popover.Close>
                <button type="button" onClick={() => retirerFavori(f.nom)} aria-label={`Retirer le favori « ${f.nom} »`} className="grid size-7 shrink-0 place-items-center rounded-md text-encre-3 hover:bg-surface-2 hover:text-alerte">
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            ))}
            <form
              className="mt-2 grid gap-1.5 border-t border-trait pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!nom.trim()) return;
                enregistrerFavori(nom.trim());
                setNom('');
              }}
            >
              <label htmlFor="nom-favori" className="text-[13px] text-encre-2">
                Enregistrer la recherche actuelle
              </label>
              <input
                id="nom-favori"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                placeholder="Ex. : mes marchés en retard"
                maxLength={60}
                className="h-9 rounded-lg border border-trait bg-surface-2 px-2.5 text-[14px] focus:border-cyan focus:outline-none"
              />
              <button type="submit" disabled={!nom.trim()} className="h-8 rounded-lg bg-cyan px-3 text-[13px] font-semibold text-white disabled:opacity-50">
                Enregistrer
              </button>
            </form>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Les étiquettes des filtres actifs, chacune avec sa croix, comme dans Odoo. */
export function EtiquettesRecherche({ filtres, basculerFiltre, groupe, setGroupe }) {
  if (!filtres.size && !groupe) return null;
  const libelleGroupe = REGROUPEMENTS.find((r) => r.cle === groupe)?.libelle;
  return (
    <div className="flex flex-wrap gap-1.5 sm:basis-full">
      {[...filtres].map((cle) => (
        <span key={cle} className="inline-flex items-center gap-1 rounded-full bg-cyan-voile py-0.5 pr-1 pl-2.5 text-[13px] font-medium text-cyan-texte">
          <Filter className="size-3" aria-hidden /> {FILTRES_MARCHES.find((f) => f.cle === cle)?.libelle ?? cle}
          <button type="button" onClick={() => basculerFiltre(cle)} aria-label="Retirer ce filtre" className="grid size-5 place-items-center rounded-full hover:bg-[color-mix(in_oklab,var(--cyan),transparent_80%)]">
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {groupe && (
        <span className="inline-flex items-center gap-1 rounded-full bg-attente-voile py-0.5 pr-1 pl-2.5 text-[13px] font-medium text-attente">
          <Layers className="size-3" aria-hidden /> Regroupé par {libelleGroupe?.toLowerCase()}
          <button type="button" onClick={() => setGroupe('')} aria-label="Ne plus regrouper" className="grid size-5 place-items-center rounded-full hover:bg-[color-mix(in_oklab,var(--attente),transparent_80%)]">
            <X className="size-3" aria-hidden />
          </button>
        </span>
      )}
    </div>
  );
}
