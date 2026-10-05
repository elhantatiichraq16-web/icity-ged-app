/**
 * Le planning d'un marché, comme le module Projet d'Odoo : ses étapes
 * (installation, formation, réception…) sur un diagramme de Gantt.
 *
 * Une barre par étape, de son début à sa fin ; la part faite en plus foncé ;
 * en rouge, une étape dont la fin est passée sans qu'elle soit terminée ; une
 * ligne pour aujourd'hui.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { jourCasablanca } from '@icity/commun/activites';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateCourte } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection, ZoneTexte } from '../ui/Champ.jsx';
import { Alerte, Carte, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { Modale } from '../ui/Modale.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';

const JOUR = 86_400_000;
const t = (iso) => new Date(`${iso}T00:00:00Z`).getTime();
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Ajouter ou corriger une étape. */
function ModaleTache({ ouverte, surChangement, marcheId, tache }) {
  const equipe = useQuery({ queryKey: ['equipe'], queryFn: () => api('/api/equipe'), enabled: ouverte });
  const aujourdhui = jourCasablanca();
  const [v, setV] = useState(() =>
    tache
      ? { titre: tache.titre, debut: tache.debut, fin: tache.fin, responsableId: tache.responsable ? String(tache.responsable.id) : '', avancement: tache.avancement, notes: tache.notes ?? '' }
      : { titre: '', debut: aujourdhui, fin: iso(t(aujourdhui) + 7 * JOUR), responsableId: '', avancement: 0, notes: '' },
  );
  const [erreurs, setErreurs] = useState({});
  const file = useQueryClient();
  const { notifier } = useToasts();
  const relire = () => {
    for (const cle of [['taches', String(marcheId)], ['fil', 'marche'], ['calendrier']]) file.invalidateQueries({ queryKey: cle });
  };

  const enregistrer = useMutation({
    mutationFn: () => api(tache ? `/api/taches/${tache.id}` : `/api/marches/${marcheId}/taches`, { methode: tache ? 'PATCH' : 'POST', corps: { ...v, avancement: Number(v.avancement) } }),
    onSuccess: () => {
      relire();
      notifier({ titre: tache ? 'Étape enregistrée' : 'Étape ajoutée', message: v.titre, ton: 'ok' });
      surChangement(false);
    },
    onError: (e) => setErreurs(e.erreurs ?? { titre: e.message }),
  });
  const supprimer = useMutation({
    mutationFn: () => api(`/api/taches/${tache.id}`, { methode: 'DELETE' }),
    onSuccess: () => {
      relire();
      surChangement(false);
    },
  });
  const champ = (cle) => ({
    value: v[cle],
    erreur: erreurs[cle],
    onChange: (e) => {
      setV((x) => ({ ...x, [cle]: e.target.value }));
      setErreurs((x) => ({ ...x, [cle]: undefined }));
    },
  });

  return (
    <Modale
      ouverte={ouverte}
      surChangement={surChangement}
      titre={tache ? `Étape « ${tache.titre} »` : 'Nouvelle étape'}
      pied={
        <>
          {tache && (
            <Bouton variante="fantome" icone={Trash2} chargement={supprimer.isPending} onClick={() => supprimer.mutate()} className="mr-auto">
              Retirer
            </Bouton>
          )}
          <Bouton variante="fantome" onClick={() => surChangement(false)}>
            Annuler
          </Bouton>
          <Bouton chargement={enregistrer.isPending} disabled={v.titre.trim().length < 2} onClick={() => enregistrer.mutate()}>
            Enregistrer
          </Bouton>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ libelle="Étape" className="sm:col-span-2" placeholder="Installation des caméras" autoFocus {...champ('titre')} />
        <Champ libelle="Début" type="date" {...champ('debut')} />
        <Champ libelle="Fin" type="date" {...champ('fin')} />
        <Selection libelle="Responsable" {...champ('responsableId')}>
          <option value="">— personne —</option>
          {(equipe.data ?? []).map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.nom}
            </option>
          ))}
        </Selection>
        <div className="grid gap-1.5">
          <label htmlFor="avancement-tache" className="text-[13px] font-semibold text-encre-2">
            Avancement : {v.avancement} %
          </label>
          <input id="avancement-tache" type="range" min={0} max={100} step={10} value={v.avancement} onChange={(e) => setV((x) => ({ ...x, avancement: Number(e.target.value) }))} className="accent-[var(--cyan)]" />
        </div>
        <ZoneTexte libelle="Notes" facultatif className="sm:col-span-2" lignes={2} {...champ('notes')} />
      </div>
    </Modale>
  );
}

/** L'onglet « Planning » de la fiche d'un marché. */
export function OngletPlanning({ m }) {
  const { droits } = useSession();
  const peutModifier = droits.can('modifier', 'Marche');
  const taches = useQuery({ queryKey: ['taches', String(m.id)], queryFn: () => api(`/api/marches/${m.id}/taches`) });
  const [edition, setEdition] = useState(null); // null | 'nouvelle' | une étape
  const aujourdhui = jourCasablanca();

  if (taches.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }
  if (taches.isError) return <Alerte ton="alerte">{taches.error.message}</Alerte>;
  const liste = taches.data;

  // La frise : du premier début à la dernière fin, aujourd'hui compris, avec un peu d'air.
  const debut = Math.min(...liste.map((x) => t(x.debut)), t(aujourdhui)) - 2 * JOUR;
  const fin = Math.max(...liste.map((x) => t(x.fin)), t(aujourdhui)) + 3 * JOUR;
  const duree = fin - debut;
  const pos = (ms) => `${((ms - debut) / duree) * 100}%`;
  // Les repères : chaque lundi, ou chaque 1er du mois sur une longue période.
  const parMois = duree > 120 * JOUR;
  const reperes = [];
  for (let ms = debut; ms <= fin; ms += JOUR) {
    const d = new Date(ms);
    if (parMois ? d.getUTCDate() === 1 : d.getUTCDay() === 1) reperes.push(ms);
  }
  const libelleRepere = (ms) => new Intl.DateTimeFormat('fr-FR', parMois ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(ms));

  return (
    <Carte>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-trait px-5 py-3">
        <h2 className="font-semibold">Planning du chantier</h2>
        {peutModifier && (
          <Bouton variante="secondaire" taille="petit" icone={Plus} onClick={() => setEdition('nouvelle')}>
            Ajouter une étape
          </Bouton>
        )}
      </div>

      {liste.length === 0 ? (
        <EtatVide titre="Aucune étape planifiée">Ajoutez les étapes du chantier (installation, formation, réception…) pour les suivre sur un diagramme de Gantt.</EtatVide>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* L'en-tête de la frise */}
            <div className="grid grid-cols-[16rem_1fr] border-b border-trait text-[12.5px] text-encre-3">
              <div className="px-4 py-2 font-semibold">Étape</div>
              <div className="relative h-8">
                {reperes.map((ms) => (
                  <span key={ms} className="absolute top-2 -translate-x-1/2 whitespace-nowrap" style={{ left: pos(ms) }}>
                    {libelleRepere(ms)}
                  </span>
                ))}
              </div>
            </div>
            {/* Une ligne par étape */}
            {liste.map((x) => {
              const enRetard = x.avancement < 100 && x.fin < aujourdhui;
              const finie = x.avancement === 100;
              const ligne = (
                <>
                  <div className="min-w-0 px-4 py-2.5 text-left">
                    <p className="truncate text-[14px] font-medium">{x.titre}</p>
                    <p className="text-[12.5px] text-encre-3">
                      {dateCourte(x.debut)} → {dateCourte(x.fin)}
                      {x.responsable && ` · ${x.responsable.nom}`}
                    </p>
                  </div>
                  <div className="relative">
                    {reperes.map((ms) => (
                      <span key={ms} aria-hidden className="absolute inset-y-0 border-l border-trait/70" style={{ left: pos(ms) }} />
                    ))}
                    <div
                      className={cx('absolute top-1/2 h-6 -translate-y-1/2 overflow-hidden rounded-md', finie ? 'bg-ok-voile' : enRetard ? 'bg-alerte-voile' : 'bg-cyan-voile')}
                      style={{ left: pos(t(x.debut)), width: `${((t(x.fin) + JOUR - t(x.debut)) / duree) * 100}%` }}
                      title={`${x.titre} : ${x.avancement} %`}
                    >
                      <div className={cx('h-full', finie ? 'bg-ok' : enRetard ? 'bg-alerte' : 'bg-cyan')} style={{ width: `${x.avancement}%` }} />
                      <span className="absolute inset-0 grid place-items-center text-[12px] font-semibold text-encre">{x.avancement} %</span>
                    </div>
                  </div>
                </>
              );
              return peutModifier ? (
                <button key={x.id} type="button" onClick={() => setEdition(x)} className="grid w-full grid-cols-[16rem_1fr] border-b border-trait last:border-b-0 hover:bg-surface-2">
                  {ligne}
                </button>
              ) : (
                <div key={x.id} className="grid grid-cols-[16rem_1fr] border-b border-trait last:border-b-0">
                  {ligne}
                </div>
              );
            })}
            {/* Aujourd'hui */}
            <div className="pointer-events-none relative -mt-px grid grid-cols-[16rem_1fr]">
              <div />
              <div className="relative">
                <span className="absolute bottom-0 -translate-x-1/2 rounded bg-alerte px-1 text-[11px] font-semibold text-white" style={{ left: pos(t(aujourdhui)) }}>
                  aujourd’hui
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {peutModifier && (
        <ModaleTache key={edition === 'nouvelle' ? 'nouvelle' : (edition?.id ?? 'aucune')} ouverte={edition !== null} surChangement={(o) => !o && setEdition(null)} marcheId={m.id} tache={edition === 'nouvelle' ? null : edition} />
      )}
    </Carte>
  );
}
