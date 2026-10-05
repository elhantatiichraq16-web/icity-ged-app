/**
 * La vue Kanban des marchés, sur le modèle du pipeline d'Odoo : une colonne
 * par étape, une carte par affaire.
 *
 *  - Marchés gagnés : une colonne par phase. La phase se calcule d'après les
 *    pièces versées (§5) : elle ne se déplace donc pas à la main. Pour faire
 *    avancer un marché, on verse sa pièce.
 *  - Appels d'offres : une colonne par statut. Celui-là se choisit à la main :
 *    on fait glisser la carte, comme dans Odoo. La déposer sur « Gagné » en
 *    fait un marché.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FileText, GripVertical } from 'lucide-react';
import { ORDRE_PHASES, PHASES, STATUTS_APPEL_OFFRES } from '@icity/commun/marches';
import { api } from '../api.js';
import { dateCourte, montant } from '../format.js';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';

/** La couleur du liseré d'une colonne, d'après le ton de sa phase. */
const LISERES = {
  neutre: 'border-t-trait-fort',
  cyan: 'border-t-cyan',
  attente: 'border-t-attente',
  bordeaux: 'border-t-bordeaux',
  ok: 'border-t-ok',
  alerte: 'border-t-alerte',
};

/** Une carte d'affaire : ce qu'on regarde d'abord, comme une carte d'Odoo. */
function CarteAffaire({ m, deplacable, surDebutGlisser }) {
  return (
    <li
      draggable={deplacable}
      onDragStart={deplacable ? (e) => surDebutGlisser(e, m) : undefined}
      className={cx(
        'rounded-[10px] border border-trait bg-surface shadow-[var(--ombre)] transition-[box-shadow,border-color] hover:border-trait-fort',
        deplacable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <Link to={`/marches/${m.id}`} draggable={false} className="block p-3">
        <div className="flex items-start gap-1.5">
          <p className="chiffres min-w-0 flex-1 truncate font-semibold text-cyan-texte">
            {m.reference}
            {m.lot && <span className="ml-1 font-sans text-[12.5px] font-normal text-encre-3">lot {m.lot}</span>}
          </p>
          {deplacable && <GripVertical className="size-4 shrink-0 text-encre-3" aria-hidden />}
        </div>
        <p className="mt-0.5 truncate text-[13px] text-encre-2" title={m.client?.nom}>
          {m.client?.nom ?? 'Client à rattacher'}
        </p>
        {(m.objet || m.objetTechnique) && <p className="mt-1 line-clamp-2 text-[13px] text-encre-3">{m.objet ?? m.objetTechnique}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          {m.echeance && (
            <span className={cx('inline-flex items-center gap-1', m.etatEcheance === 'depassee' ? 'font-semibold text-alerte-texte' : m.etatEcheance === 'proche' ? 'font-semibold text-attente' : 'text-encre-3')}>
              <CalendarClock className="size-3.5" aria-hidden /> {dateCourte(m.echeance)}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-encre-3">
            <FileText className="size-3.5" aria-hidden /> {m.nbDocuments}
          </span>
          {m.manquantes?.length > 0 && <span className="rounded-full bg-attente-voile px-1.5 font-semibold text-attente">{m.manquantes.length} manquante{m.manquantes.length > 1 ? 's' : ''}</span>}
          {m.montantTtc ? <span className="chiffres ml-auto text-encre-2">{montant(m.montantTtc)}</span> : null}
        </div>
      </Link>
    </li>
  );
}

/** Une colonne : son titre, son nombre, son montant, et ses cartes. */
function Colonne({ titre, ton = 'neutre', affaires, surDeposer, deplacable, surDebutGlisser, vide }) {
  const [survol, setSurvol] = useState(false);
  const total = affaires.reduce((t, m) => t + (m.montantTtc ?? 0), 0);
  return (
    <section
      aria-label={`${titre} : ${affaires.length}`}
      onDragOver={surDeposer ? (e) => { e.preventDefault(); setSurvol(true); } : undefined}
      onDragLeave={surDeposer ? () => setSurvol(false) : undefined}
      onDrop={
        surDeposer
          ? (e) => {
              e.preventDefault();
              setSurvol(false);
              surDeposer(Number(e.dataTransfer.getData('text/plain')));
            }
          : undefined
      }
      className={cx(
        'flex w-72 shrink-0 flex-col rounded-[12px] border-t-[3px] bg-surface-2 transition-colors',
        LISERES[ton] ?? LISERES.neutre,
        survol && 'bg-cyan-voile ring-1 ring-cyan',
      )}
    >
      <header className="px-3 pt-2.5 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="truncate font-sans text-[14px] font-semibold">{titre}</h2>
          <span className="chiffres text-[13px] text-encre-3">{affaires.length}</span>
        </div>
        {total > 0 && <p className="chiffres text-[12.5px] text-encre-3">{montant(total)}</p>}
      </header>
      <ul className="grid max-h-[calc(100vh-18rem)] content-start gap-2 overflow-y-auto px-2 pb-2">
        {affaires.map((m) => (
          <CarteAffaire key={m.id} m={m} deplacable={deplacable} surDebutGlisser={surDebutGlisser} />
        ))}
        {affaires.length === 0 && <li className="px-1 py-3 text-center text-[13px] text-encre-3">{vide}</li>}
      </ul>
    </section>
  );
}

/** Les marchés gagnés, en colonnes par phase. */
export function KanbanMarches({ marches }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="flex gap-3">
        {ORDRE_PHASES.map((p) => (
          <Colonne key={p} titre={PHASES[p].nom} ton={PHASES[p].ton} affaires={marches.filter((m) => m.phase === p)} vide="Aucun marché" />
        ))}
      </div>
      <p className="mt-2 text-[13px] text-encre-3">La phase se déduit des pièces versées : pour faire avancer un marché, versez sa pièce.</p>
    </div>
  );
}

/** Les colonnes des appels d'offres : à qualifier, chaque statut, puis « Gagné ». */
const COLONNES_AO = [
  { statut: null, titre: 'À qualifier', ton: 'neutre' },
  ...STATUTS_APPEL_OFFRES.map((s) => ({ statut: s, titre: s, ton: s === 'Perdu' ? 'alerte' : s === 'AO déposé' ? 'cyan' : 'attente' })),
];

/** Les appels d'offres, en colonnes par statut, à faire glisser. */
export function KanbanAppelsOffres({ appels, peutModifier }) {
  const file = useQueryClient();
  const { notifier } = useToasts();

  const changer = useMutation({
    mutationFn: ({ id, statutAffaire }) => api(`/api/marches/${id}`, { methode: 'PATCH', corps: { statutAffaire } }),
    onSuccess: (m) => {
      for (const cle of [['marches'], ['clients'], ['tableau-bord'], ['fil']]) file.invalidateQueries({ queryKey: cle });
      notifier(
        m.appelOffres
          ? { titre: 'Statut enregistré', message: `${m.reference} : ${m.statutAffaire ?? 'à qualifier'}.`, ton: 'ok' }
          : { titre: `${m.reference} est un marché gagné`, message: 'Il passe dans l’onglet Marchés gagnés.', ton: 'ok' },
      );
    },
    onError: (erreur) => notifier({ titre: 'Statut non enregistré', message: erreur.message, ton: 'alerte' }),
  });

  function surDebutGlisser(e, m) {
    e.dataTransfer.setData('text/plain', String(m.id));
    e.dataTransfer.effectAllowed = 'move';
  }

  /** Déposer une carte sur une colonne : le statut de l'affaire change. */
  const deposerSur = (statut) => (id) => {
    const m = appels.find((x) => x.id === id);
    if (!m || (m.statutAffaire ?? null) === statut) return;
    changer.mutate({ id, statutAffaire: statut });
  };

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="flex gap-3">
        {COLONNES_AO.map((c) => (
          <Colonne
            key={c.titre}
            titre={c.titre}
            ton={c.ton}
            affaires={appels.filter((m) => (m.statutAffaire ?? null) === c.statut)}
            deplacable={peutModifier}
            surDebutGlisser={surDebutGlisser}
            surDeposer={peutModifier ? deposerSur(c.statut) : undefined}
            vide={peutModifier ? 'Déposez une carte ici' : 'Aucun'}
          />
        ))}
        {peutModifier && (
          <Colonne titre="Gagné → marché" ton="ok" affaires={[]} surDeposer={deposerSur('Gagné')} vide="Déposez ici un appel d’offres gagné : il devient un marché." />
        )}
      </div>
      {peutModifier && <p className="mt-2 text-[13px] text-encre-3">Faites glisser une carte pour changer son statut. Au clavier, la vue Liste permet le même changement.</p>}
    </div>
  );
}
