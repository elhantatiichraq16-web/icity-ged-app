/**
 * Les marchés potentiels : les appels d'offres repérés sur les sources
 * externes (portail des marchés publics, flux, imports), notés selon les
 * critères iCity, triés par l'équipe, et convertis en affaire.
 *
 *  - `PageMarchesPotentiels` : les chiffres, les filtres, la liste ou le Kanban.
 *  - `PageFicheOffre` : une offre, son score expliqué, son suivi, ses documents,
 *    ses activités et son fil — et la conversion en marché.
 *
 * Rien n'est lu ici sur un site externe : tout passe par le serveur.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, CalendarClock, Columns3, ExternalLink, FileDown, Filter, Import, List, RefreshCw, Sparkles, Star, ThumbsDown, ThumbsUp, Wand2 } from 'lucide-react';
import { STATUTS_AFFAIRE } from '@icity/commun/marches';
import { STATUTS_MANUELS, STATUTS_OFFRES, nomStatutOffre } from '@icity/commun/marches-potentiels';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateCourte, dateHeure, depuis, montant } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { CaseACocher, Champ, Selection, ZoneTexte } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { Confirmation, Modale } from '../ui/Modale.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';
import { FilActivite } from './FilActivite.jsx';

const AVERTISSEMENT = 'Les informations sont synchronisées depuis une source externe. Vérifiez toujours l’annonce officielle avant toute décision ou soumission.';
const tonStatut = (code) => STATUTS_OFFRES.find((s) => s.code === code)?.ton ?? 'neutre';

/** Le score en pastille : vert fort, orange moyen, gris faible. */
function PastilleScore({ score, grand = false }) {
  const ton = score >= 70 ? 'bg-ok text-white' : score >= 50 ? 'bg-ok-voile text-ok' : score >= 30 ? 'bg-attente-voile text-attente' : 'bg-surface-2 text-encre-3';
  return (
    <span className={cx('chiffres inline-grid shrink-0 place-items-center rounded-full font-semibold', ton, grand ? 'size-16 text-xl' : 'size-9 text-[13px]')} title={`Score de pertinence : ${score}/100`}>
      {score}
    </span>
  );
}

/** « dans 12 j », « aujourd'hui », « dépassée » — en couleur. */
function Echeance({ o }) {
  if (!o.dateLimite) return <span className="text-encre-3">—</span>;
  const j = o.joursRestants;
  return (
    <span className={cx('whitespace-nowrap', j < 0 ? 'text-encre-3 line-through' : j <= 7 ? 'font-semibold text-alerte-texte' : j <= 14 ? 'font-semibold text-attente' : 'text-encre-2')}>
      {dateCourte(o.dateLimite)}
      <span className="ml-1 text-[12.5px] font-normal">{j < 0 ? '(passée)' : j === 0 ? '(aujourd’hui)' : `(${j} j)`}</span>
    </span>
  );
}

function BoutonFavori({ o, petit = false }) {
  const file = useQueryClient();
  const basculer = useMutation({
    mutationFn: () => api(`/api/marches-potentiels/${o.id}/favori`, { methode: 'POST', corps: { favori: !o.favori } }),
    onSuccess: () => file.invalidateQueries({ queryKey: ['offres'] }),
  });
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        basculer.mutate();
      }}
      aria-pressed={o.favori}
      aria-label={o.favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={cx('grid place-items-center rounded-lg hover:bg-surface-2', petit ? 'size-8' : 'size-9', o.favori ? 'text-attente' : 'text-encre-3')}
    >
      <Star className={cx('size-4', o.favori && 'fill-current')} aria-hidden />
    </button>
  );
}

// ════════════════════════════ La liste ════════════════════════════

const FILTRES_VIDES = { q: '', sourceId: '', scoreMin: '', statut: '', domaine: '', acheteur: '', lieu: '', publieDepuis: '', limiteAvant: '', nonExpirees: true, responsableId: '', favoris: false, tri: 'pertinence' };

/** La vue choisie (liste ou Kanban), retenue sur ce poste. */
function vueRetenue() {
  try {
    return localStorage.getItem('icity.offres.vue') ?? 'liste';
  } catch {
    return 'liste';
  }
}

export function PageMarchesPotentiels() {
  const { droits } = useSession();
  const gerer = droits.can('gerer', 'MarchePotentiel');
  const [vue, setVue] = useState(vueRetenue);
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  const [plus, setPlus] = useState(false);
  const [page, setPage] = useState(1);
  const [importer, setImporter] = useState(false);
  const file = useQueryClient();
  const { notifier } = useToasts();

  const parametres = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtres)) {
      if (v === true) p.set(k, '1');
      else if (v) p.set(k, v);
    }
    p.set('page', vue === 'kanban' ? '1' : String(page));
    p.set('taille', vue === 'kanban' ? '300' : '50');
    return p.toString();
  }, [filtres, page, vue]);

  const resume = useQuery({ queryKey: ['offres', 'resume'], queryFn: () => api('/api/marches-potentiels/resume') });
  const offres = useQuery({ queryKey: ['offres', 'liste', parametres], queryFn: () => api(`/api/marches-potentiels?${parametres}`), placeholderData: (p) => p });
  const synchroniser = useMutation({
    mutationFn: () => api('/api/marches-potentiels/synchroniser', { methode: 'POST' }),
    onSuccess: (r) => {
      file.invalidateQueries({ queryKey: ['offres'] });
      const nouvelles = r.bilans.reduce((n, b) => n + (b.nouvelles ?? 0), 0);
      const erreurs = r.bilans.filter((b) => b.etat === 'erreur');
      notifier({ titre: 'Synchronisation terminée', message: `${nouvelles} nouvelle(s) offre(s)${erreurs.length ? ` · ${erreurs.length} source(s) en erreur` : ''}.`, ton: erreurs.length ? 'alerte' : 'ok' });
    },
    onError: (e) => notifier({ titre: 'Synchronisation impossible', message: e.message, ton: 'alerte' }),
  });

  const changer = (cle) => (e) => {
    setPage(1);
    setFiltres((f) => ({ ...f, [cle]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  };
  const choisirVue = (v) => {
    setVue(v);
    try {
      localStorage.setItem('icity.offres.vue', v);
    } catch {
      /* rien : un simple confort */
    }
  };
  const r = resume.data;
  const derniere = r?.derniereSynchronisation;

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Marchés potentiels"
        description="Les appels d’offres repérés sur les sources externes, notés selon les critères iCity."
        actions={
          gerer && (
            <div className="flex flex-wrap gap-2">
              <Bouton variante="secondaire" icone={Import} onClick={() => setImporter(true)}>
                Importer une offre
              </Bouton>
              <Bouton icone={RefreshCw} chargement={synchroniser.isPending} libelleChargement="Synchronisation…" onClick={() => synchroniser.mutate()} disabled={r && !r.sourcesActives}>
                Synchroniser maintenant
              </Bouton>
            </div>
          )
        }
      />

      {/* Les chiffres du haut : chacun filtre la liste d'un clic. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Nouvelles offres', r?.nouvelles, () => setFiltres({ ...FILTRES_VIDES, statut: 'nouvelle' })],
          [`Pertinentes (≥ ${r?.seuil ?? '…'})`, r?.pertinentes, () => setFiltres({ ...FILTRES_VIDES, scoreMin: String(r?.seuil ?? 50) })],
          ['Échéance sous 7 jours', r?.echeances, () => setFiltres({ ...FILTRES_VIDES, tri: 'limite' })],
          ['À étudier', r?.aEtudier, () => setFiltres({ ...FILTRES_VIDES, statut: 'a_etudier' })],
        ].map(([libelle, valeur, action]) => (
          <button key={libelle} type="button" onClick={action} className="rounded-carte border border-trait bg-surface p-4 text-left shadow-[var(--ombre)] hover:border-trait-fort">
            <p className="text-[13px] text-encre-2">{libelle}</p>
            <p className="chiffres mt-1 text-2xl font-semibold">{valeur ?? '…'}</p>
          </button>
        ))}
        <Carte className="p-4">
          <p className="text-[13px] text-encre-2">Dernière synchronisation</p>
          {derniere ? (
            <>
              <p className="mt-1 font-semibold">{depuis(derniere.derniereSyncLe)}</p>
              <p className={cx('truncate text-[12.5px]', derniere.derniereSyncEtat === 'erreur' ? 'text-alerte-texte' : 'text-encre-3')} title={derniere.derniereSyncResume}>
                {derniere.nom} · {derniere.derniereSyncResume}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[13px] text-encre-3">Aucune encore</p>
          )}
        </Carte>
      </div>

      {r && !r.sourcesActives && (
        <Alerte ton="attente" titre="Aucune source synchronisée automatiquement" className="mb-4">
          La collecte automatique du portail des marchés publics est désactivée tant que l’accord de son éditeur n’est pas obtenu. En attendant, importez les offres par leur adresse ou par un fichier CSV
          {droits.can('gerer', 'SourceMarche') && (
            <>
              {' '}
              (<Link to="/parametres/sources" className="font-medium text-cyan-texte hover:underline">
                Paramètres → Sources de marchés
              </Link>
              )
            </>
          )}
          .
        </Alerte>
      )}

      {/* Les filtres */}
      <Carte className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filtres.q}
            onChange={changer('q')}
            placeholder="Objet, référence, acheteur, lieu…"
            aria-label="Rechercher"
            className="h-10 min-w-56 flex-1 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm focus:border-cyan focus:outline-none"
          />
          <select value={filtres.statut} onChange={changer('statut')} aria-label="Statut" className="h-10 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm">
            <option value="">Tous les statuts</option>
            {STATUTS_OFFRES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.nom}
              </option>
            ))}
          </select>
          <select value={filtres.scoreMin} onChange={changer('scoreMin')} aria-label="Score minimal" className="h-10 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm">
            <option value="">Tout score</option>
            {[30, 50, 70, 85].map((n) => (
              <option key={n} value={String(n)}>
                Score ≥ {n}
              </option>
            ))}
          </select>
          <select value={filtres.tri} onChange={changer('tri')} aria-label="Trier par" className="h-10 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm">
            <option value="pertinence">Tri : pertinence</option>
            <option value="limite">Tri : date limite</option>
            <option value="publication">Tri : publication</option>
            <option value="acheteur">Tri : acheteur</option>
            <option value="source">Tri : source</option>
          </select>
          <CaseACocher libelle="Non expirées" checked={filtres.nonExpirees} onChange={changer('nonExpirees')} />
          <CaseACocher libelle="Mes favoris" checked={filtres.favoris} onChange={changer('favoris')} />
          <Bouton variante="fantome" taille="petit" icone={Filter} onClick={() => setPlus((x) => !x)} aria-expanded={plus}>
            Plus de filtres
          </Bouton>
          <div role="group" aria-label="Affichage" className="ml-auto inline-flex rounded-[10px] border border-trait bg-surface p-0.5">
            {[
              ['liste', 'Liste', List],
              ['kanban', 'Kanban', Columns3],
            ].map(([code, libelle, Icone]) => (
              <button
                key={code}
                type="button"
                aria-pressed={vue === code}
                onClick={() => choisirVue(code)}
                className={cx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium', vue === code ? 'bg-cyan-voile text-cyan-texte' : 'text-encre-2 hover:bg-surface-2')}
              >
                <Icone className="size-4" aria-hidden /> {libelle}
              </button>
            ))}
          </div>
        </div>
        {plus && (
          <div className="mt-3 grid gap-3 border-t border-trait pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Selection libelle="Source" value={filtres.sourceId} onChange={changer('sourceId')}>
              <option value="">Toutes</option>
              {(r?.sources ?? []).map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.nom}
                </option>
              ))}
            </Selection>
            <Champ libelle="Domaine ou catégorie" value={filtres.domaine} onChange={changer('domaine')} placeholder="Informatique" />
            <Champ libelle="Acheteur public" value={filtres.acheteur} onChange={changer('acheteur')} />
            <Champ libelle="Lieu ou région" value={filtres.lieu} onChange={changer('lieu')} placeholder="Rabat" />
            <Champ libelle="Publiée depuis le" type="date" value={filtres.publieDepuis} onChange={changer('publieDepuis')} />
            <Champ libelle="Date limite avant le" type="date" value={filtres.limiteAvant} onChange={changer('limiteAvant')} />
            <Selection libelle="Responsable" value={filtres.responsableId} onChange={changer('responsableId')}>
              <option value="">Tous</option>
              <option value="moi">Moi</option>
            </Selection>
            <div className="flex items-end">
              <Bouton variante="fantome" taille="petit" onClick={() => setFiltres(FILTRES_VIDES)}>
                Effacer les filtres
              </Bouton>
            </div>
          </div>
        )}
      </Carte>

      <p className="mb-2 text-[13px] text-encre-3">{AVERTISSEMENT}</p>

      {offres.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={6} />
        </Carte>
      ) : offres.isError ? (
        <Alerte ton="alerte">{offres.error.message}</Alerte>
      ) : offres.data.offres.length === 0 ? (
        <Carte>
          <EtatVide titre="Aucune offre ici">
            {r?.sourcesActives ? 'Aucune offre ne correspond à ces filtres.' : 'Importez une offre par son adresse, ou un fichier CSV depuis Paramètres → Sources de marchés.'}
          </EtatVide>
        </Carte>
      ) : vue === 'kanban' ? (
        <KanbanOffres offres={offres.data.offres} deplacable={gerer} />
      ) : (
        <ListeOffres donnees={offres.data} page={page} setPage={setPage} />
      )}

      {gerer && <ModaleImport ouverte={importer} surChangement={setImporter} />}
    </div>
  );
}

function ListeOffres({ donnees, page, setPage }) {
  const navigate = useNavigate();
  const pages = Math.max(1, Math.ceil(donnees.total / donnees.taille));
  return (
    <Carte className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-[14px]">
        <thead>
          <tr className="border-b border-trait text-left text-[12.5px] text-encre-3">
            <th className="w-10 px-3 py-2" />
            <th className="w-14 px-2 py-2">Score</th>
            <th className="px-2 py-2">Offre</th>
            <th className="px-2 py-2">Lieu</th>
            <th className="px-2 py-2">Publiée</th>
            <th className="px-2 py-2">Date limite</th>
            <th className="px-2 py-2">Statut</th>
          </tr>
        </thead>
        <tbody>
          {donnees.offres.map((o) => (
            <tr key={o.id} onClick={() => navigate(`/marches-potentiels/${o.id}`)} className="cursor-pointer border-b border-trait last:border-b-0 hover:bg-surface-2">
              <td className="px-3 py-2">
                <BoutonFavori o={o} petit />
              </td>
              <td className="px-2 py-2">
                <PastilleScore score={o.score} />
              </td>
              <td className="max-w-[520px] px-2 py-2">
                <Link to={`/marches-potentiels/${o.id}`} onClick={(e) => e.stopPropagation()} className="line-clamp-2 font-medium hover:text-cyan-texte">
                  {o.objet}
                </Link>
                <p className="truncate text-[12.5px] text-encre-3">
                  {[o.reference, o.acheteur, o.source?.nom].filter(Boolean).join(' · ')}
                </p>
              </td>
              <td className="px-2 py-2 text-encre-2">{o.lieu ?? '—'}</td>
              <td className="px-2 py-2 whitespace-nowrap text-encre-2">{o.datePublication ? dateCourte(o.datePublication) : '—'}</td>
              <td className="px-2 py-2">
                <Echeance o={o} />
              </td>
              <td className="px-2 py-2">
                <Badge ton={tonStatut(o.statut)}>{nomStatutOffre(o.statut)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-trait px-4 py-2 text-[13px] text-encre-3">
        <span>
          {donnees.total} offre(s) · page {page} sur {pages}
        </span>
        <div className="flex gap-2">
          <Bouton variante="secondaire" taille="petit" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Précédente
          </Bouton>
          <Bouton variante="secondaire" taille="petit" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Suivante
          </Bouton>
        </div>
      </div>
    </Carte>
  );
}

/** Le Kanban par statut : on fait glisser une carte pour la trier (statuts manuels seulement). */
function KanbanOffres({ offres, deplacable }) {
  const file = useQueryClient();
  const { notifier } = useToasts();
  const [survol, setSurvol] = useState(null);
  const deplacer = useMutation({
    mutationFn: ({ id, statut }) => api(`/api/marches-potentiels/${id}`, { methode: 'PATCH', corps: { statut } }),
    onSuccess: () => file.invalidateQueries({ queryKey: ['offres'] }),
    onError: (e) => notifier({ titre: 'Statut non changé', message: e.message, ton: 'alerte' }),
  });
  const colonnes = STATUTS_OFFRES.filter((s) => s.code !== 'archivee');
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {colonnes.map((s) => {
        const cartes = offres.filter((o) => o.statut === s.code);
        const cible = deplacable && STATUTS_MANUELS.includes(s.code);
        return (
          <section
            key={s.code}
            aria-label={s.nom}
            onDragOver={cible ? (e) => (e.preventDefault(), setSurvol(s.code)) : undefined}
            onDragLeave={() => setSurvol(null)}
            onDrop={
              cible
                ? (e) => {
                    setSurvol(null);
                    const id = Number(e.dataTransfer.getData('text/plain'));
                    const o = offres.find((x) => x.id === id);
                    if (o && o.statut !== s.code) deplacer.mutate({ id, statut: s.code });
                  }
                : undefined
            }
            className={cx('w-72 shrink-0 rounded-carte border-t-[3px] bg-surface-2 p-2', survol === s.code && 'ring-2 ring-cyan', { cyan: 'border-t-cyan', attente: 'border-t-attente', ok: 'border-t-ok', bordeaux: 'border-t-bordeaux', alerte: 'border-t-alerte', neutre: 'border-t-trait-fort' }[s.ton])}
          >
            <h3 className="mb-2 flex justify-between px-1 text-[14px] font-semibold">
              {s.nom} <span className="chiffres font-normal text-encre-3">{cartes.length}</span>
            </h3>
            <ul className="grid gap-2">
              {cartes.map((o) => (
                <li key={o.id} draggable={deplacable && o.statut !== 'convertie'} onDragStart={(e) => e.dataTransfer.setData('text/plain', String(o.id))} className="rounded-[10px] border border-trait bg-surface p-3 shadow-[var(--ombre)]">
                  <Link to={`/marches-potentiels/${o.id}`} className="block" draggable={false}>
                    <div className="flex items-start gap-2">
                      <PastilleScore score={o.score} />
                      <p className="line-clamp-3 min-w-0 flex-1 text-[13px] font-medium">{o.objet}</p>
                    </div>
                    <p className="mt-1 truncate text-[12.5px] text-encre-3">{o.acheteur ?? o.source?.nom}</p>
                    <p className="mt-1 text-[12.5px]">
                      <CalendarClock className="mr-1 inline size-3.5 text-encre-3" aria-hidden />
                      <Echeance o={o} />
                    </p>
                  </Link>
                </li>
              ))}
              {!cartes.length && <li className="px-1 py-3 text-center text-[12.5px] text-encre-3">Aucune</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Importer une offre par l'adresse de son annonce : pré-remplie si un connecteur sait la lire, sinon saisie à la main. */
function ModaleImport({ ouverte, surChangement }) {
  const vide = { urlOfficielle: '', reference: '', objet: '', acheteur: '', categorie: '', lieu: '', datePublication: '', dateLimite: '', estimation: '', caution: '' };
  const [v, setV] = useState(vide);
  const [erreurs, setErreurs] = useState({});
  const [lue, setLue] = useState(null);
  const navigate = useNavigate();
  const file = useQueryClient();
  const { notifier } = useToasts();
  const champ = (cle) => ({ value: v[cle] ?? '', erreur: erreurs[cle], onChange: (e) => setV((x) => ({ ...x, [cle]: e.target.value })) });
  /** L'heure telle que l'annonce l'affiche (heure du Maroc), au format des champs datetime-local. */
  const enChamp = (t) => {
    const fr = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/.exec(t ?? '');
    if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}T${fr[4] ?? '23:59'}`;
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t ?? '') ? t.slice(0, 16) : '';
  };


  const apercu = useMutation({
    mutationFn: () => api('/api/marches-potentiels/apercu', { methode: 'POST', corps: { url: v.urlOfficielle } }),
    onSuccess: ({ reconnue, offre }) => {
      setLue(reconnue);
      if (!reconnue) return;
      const montantTexte = (t) => (t ? String(t).replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.') : '');
      setV((x) => ({
        ...x,
        urlOfficielle: offre.urlOfficielle ?? x.urlOfficielle,
        reference: offre.reference ?? '',
        objet: offre.objet ?? '',
        acheteur: offre.acheteur ?? '',
        categorie: offre.categorie ?? '',
        lieu: offre.lieu ?? '',
        dateLimite: enChamp(offre.dateLimite),
        estimation: montantTexte(offre.estimation),
        caution: montantTexte(offre.caution),
      }));
    },
    onError: (e) => setErreurs(e.erreurs ?? { urlOfficielle: e.message }),
  });
  const creer = useMutation({
    mutationFn: () =>
      api('/api/marches-potentiels', {
        methode: 'POST',
        corps: { ...v, estimation: v.estimation === '' ? null : Number(v.estimation), caution: v.caution === '' ? null : Number(v.caution) },
      }),
    onSuccess: ({ id, creee }) => {
      file.invalidateQueries({ queryKey: ['offres'] });
      notifier({ titre: creee ? 'Offre importée' : 'Offre déjà connue, complétée', ton: 'ok' });
      fermer(false);
      navigate(`/marches-potentiels/${id}`);
    },
    onError: (e) => setErreurs(e.erreurs ?? { objet: e.message }),
  });
  function fermer(o) {
    if (!o) {
      setV(vide);
      setErreurs({});
      setLue(null);
    }
    surChangement(o);
  }

  return (
    <Modale
      ouverte={ouverte}
      surChangement={fermer}
      largeur="max-w-2xl"
      titre="Importer une offre"
      description="Collez l’adresse de l’annonce officielle. Une annonce du portail des marchés publics se pré-remplit ; sinon, complétez les champs."
      pied={
        <>
          <Bouton variante="fantome" onClick={() => fermer(false)}>
            Annuler
          </Bouton>
          <Bouton chargement={creer.isPending} onClick={() => creer.mutate()}>
            Importer
          </Bouton>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-end gap-2 sm:col-span-2">
          <Champ libelle="Adresse de l’annonce officielle" className="flex-1" placeholder="https://www.marchespublics.gov.ma/index.php?page=…" {...champ('urlOfficielle')} erreur={erreurs.urlOfficielle ?? erreurs.url} />
          <Bouton variante="secondaire" icone={Wand2} chargement={apercu.isPending} disabled={!v.urlOfficielle} onClick={() => apercu.mutate()}>
            Pré-remplir
          </Bouton>
        </div>
        {lue === false && (
          <Alerte ton="info" className="sm:col-span-2">
            Aucun connecteur ne sait lire cette adresse : complétez les informations à la main.
          </Alerte>
        )}
        <ZoneTexte libelle="Objet" className="sm:col-span-2" lignes={2} {...champ('objet')} />
        <Champ libelle="Référence" facultatif {...champ('reference')} />
        <Champ libelle="Acheteur public" facultatif {...champ('acheteur')} />
        <Champ libelle="Catégorie" facultatif placeholder="Services, Fournitures, Travaux" {...champ('categorie')} />
        <Champ libelle="Lieu d’exécution" facultatif {...champ('lieu')} />
        <Champ libelle="Date limite de remise des plis" facultatif type="datetime-local" {...champ('dateLimite')} />
        <Champ libelle="Publiée le" facultatif type="date" {...champ('datePublication')} />
        <Champ libelle="Estimation (DH TTC)" facultatif type="number" min={0} {...champ('estimation')} />
        <Champ libelle="Caution provisoire (DH)" facultatif type="number" min={0} {...champ('caution')} />
      </div>
    </Modale>
  );
}

// ════════════════════════════ La fiche ════════════════════════════

export function PageFicheOffre() {
  const { id } = useParams();
  const { droits } = useSession();
  const gerer = droits.can('gerer', 'MarchePotentiel');
  const offre = useQuery({ queryKey: ['offres', 'une', id], queryFn: () => api(`/api/marches-potentiels/${id}`) });
  const file = useQueryClient();
  const { notifier } = useToasts();
  const [conversion, setConversion] = useState(false);
  const [aImporter, setAImporter] = useState(null);

  const relire = () => {
    file.invalidateQueries({ queryKey: ['offres'] });
    file.invalidateQueries({ queryKey: ['fil', 'offre', String(id)] });
  };
  const suivre = useMutation({
    mutationFn: (corps) => api(`/api/marches-potentiels/${id}`, { methode: 'PATCH', corps }),
    onSuccess: (_r, corps) => {
      relire();
      notifier({ titre: corps.statut ? `Offre : ${nomStatutOffre(corps.statut)}` : 'Suivi enregistré', ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Non enregistré', message: e.message, ton: 'alerte' }),
  });
  const actualiser = useMutation({
    mutationFn: () => api(`/api/marches-potentiels/${id}/actualiser`, { methode: 'POST' }),
    onSuccess: () => {
      relire();
      notifier({ titre: 'Annonce relue', ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Actualisation impossible', message: e.message, ton: 'alerte' }),
  });
  const importerDoc = useMutation({
    mutationFn: (url) => api(`/api/marches-potentiels/${id}/documents`, { methode: 'POST', corps: { url } }),
    onSuccess: (r) => {
      setAImporter(null);
      relire();
      notifier({ titre: 'Document versé dans la GED', message: r.titre, ton: 'ok' });
    },
    onError: (e) => {
      setAImporter(null);
      notifier({ titre: 'Import impossible', message: e.message, ton: 'alerte' });
    },
  });

  if (offre.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={8} />
      </Carte>
    );
  }
  if (offre.isError) return <Alerte ton="alerte">{offre.error.message}</Alerte>;
  const o = offre.data;
  const convertie = Boolean(o.marche);

  const infos = [
    ['Référence', o.reference],
    ['Acheteur public', o.acheteur],
    ['Procédure', o.procedure],
    ['Catégorie', o.categorie],
    ['Domaines', o.domaines.join(' ; ')],
    ['Lieu d’exécution', o.lieu],
    ['Publiée le', o.datePublication ? dateCourte(o.datePublication) : null],
    ['Date limite de remise des plis', o.dateLimite ? dateHeure(o.dateLimite) : null],
    ['Estimation', o.estimation !== null ? montant(o.estimation) : null],
    ['Caution provisoire', o.caution !== null ? montant(o.caution) : null],
    ['Lots', o.lots.join(' ; ')],
    ['Réponse électronique', o.reponseElectronique],
    ['Statut sur la source', o.statutExterne],
    ['Source', o.source?.nom],
    ['Repérée le', dateHeure(o.premiereDetection)],
    ['Dernière vérification', dateHeure(o.derniereVerification)],
  ].filter(([, v]) => v);

  return (
    <div className="animate-apparition">
      <Link to="/marches-potentiels" className="mb-3 inline-flex items-center gap-1.5 text-[14px] font-medium text-cyan-texte hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Marchés potentiels
      </Link>

      <Carte className="mb-4 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <PastilleScore score={o.score} grand />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge ton={tonStatut(o.statut)}>{nomStatutOffre(o.statut)}</Badge>
              {o.reference && <span className="chiffres text-[13px] text-encre-3">{o.reference}</span>}
              <Echeance o={o} />
            </div>
            <h1 className="font-titre text-xl leading-snug font-semibold">{o.objet}</h1>
            <p className="mt-1 text-[14px] text-encre-2">{[o.acheteur, o.lieu].filter(Boolean).join(' · ')}</p>
          </div>
          <BoutonFavori o={o} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-trait pt-4">
          {o.urlOfficielle && (
            <a href={o.urlOfficielle} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-trait bg-surface px-3 text-[13px] font-medium hover:border-trait-fort hover:bg-surface-2">
              <ExternalLink className="size-4" aria-hidden /> Voir l’annonce officielle
            </a>
          )}
          {gerer && !convertie && (
            <>
              <Bouton variante="secondaire" taille="petit" icone={ThumbsUp} onClick={() => suivre.mutate({ statut: 'interessante' })} disabled={o.statut === 'interessante'}>
                Intéressante
              </Bouton>
              <Bouton variante="secondaire" taille="petit" icone={Sparkles} onClick={() => suivre.mutate({ statut: 'a_etudier' })} disabled={o.statut === 'a_etudier'}>
                À étudier
              </Bouton>
              <Bouton variante="secondaire" taille="petit" onClick={() => suivre.mutate({ statut: 'a_preparer' })} disabled={o.statut === 'a_preparer'}>
                À préparer
              </Bouton>
              <Bouton variante="secondaire" taille="petit" icone={ThumbsDown} onClick={() => suivre.mutate({ statut: 'ecartee' })} disabled={o.statut === 'ecartee'}>
                Écarter
              </Bouton>
            </>
          )}
          {gerer && o.statut !== 'archivee' && (
            <Bouton variante="secondaire" taille="petit" icone={Archive} onClick={() => suivre.mutate({ statut: 'archivee' })}>
              Archiver
            </Bouton>
          )}
          {gerer && (
            <Bouton variante="secondaire" taille="petit" icone={RefreshCw} chargement={actualiser.isPending} onClick={() => actualiser.mutate()}>
              Actualiser
            </Bouton>
          )}
          {convertie ? (
            <Link to={`/marches/${o.marche.id}`} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-ok-voile px-3 text-[13px] font-semibold text-ok">
              Convertie : marché {o.marche.reference}
            </Link>
          ) : (
            droits.can('convertir', 'MarchePotentiel') &&
            droits.can('creer', 'Marche') && (
              <Bouton taille="petit" className="ml-auto" onClick={() => setConversion(true)}>
                Convertir en marché
              </Bouton>
            )
          )}
        </div>
      </Carte>

      <Alerte ton="attente" className="mb-4">
        {AVERTISSEMENT}
      </Alerte>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="grid min-w-0 content-start gap-4">
          <Carte className="p-5">
            <h2 className="mb-3 font-semibold">Informations publiées</h2>
            <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[200px_1fr]">
              {infos.map(([libelle, valeur]) => (
                <div key={libelle} className="contents">
                  <dt className="text-encre-3">{libelle}</dt>
                  <dd className="min-w-0 break-words">{valeur}</dd>
                </div>
              ))}
            </dl>
            {o.resume && <p className="mt-3 border-t border-trait pt-3 text-[14px] whitespace-pre-line text-encre-2">{o.resume}</p>}
          </Carte>

          <Carte className="p-5">
            <h2 className="mb-1 font-semibold">Documents disponibles</h2>
            <p className="mb-3 text-[13px] text-encre-3">Des liens vers la source. Rien n’est téléchargé sans votre demande.</p>
            {o.documents.length === 0 ? (
              <p className="text-[14px] text-encre-3">Aucun document annoncé.</p>
            ) : (
              <ul className="divide-y divide-trait">
                {o.documents.map((d) => (
                  <li key={d.url} className="flex flex-wrap items-center gap-3 py-2 text-[14px]">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-cyan-texte hover:underline">
                      {d.nom}
                    </a>
                    {gerer && droits.can('verser', 'Document') && (
                      <Bouton variante="fantome" taille="petit" icone={FileDown} onClick={() => setAImporter(d)}>
                        Importer dans la GED
                      </Bouton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Carte>

          <FilActivite type="offre" id={o.id} />
        </div>

        <div className="grid content-start gap-4">
          <Carte className="p-5">
            <h2 className="mb-2 font-semibold">Pourquoi {o.score}/100 ?</h2>
            {o.raisonsScore.length === 0 ? (
              <p className="text-[14px] text-encre-3">Aucun critère iCity ne correspond.</p>
            ) : (
              <ul className="grid gap-1.5 text-[14px]">
                {o.raisonsScore.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={cx('chiffres w-10 shrink-0 text-right font-semibold', r.points > 0 ? 'text-ok' : 'text-encre-3')}>{r.points > 0 ? `+${r.points}` : '0'}</span>
                    <span>{r.texte}</span>
                  </li>
                ))}
              </ul>
            )}
            {droits.can('gerer', 'CriteresMarches') && (
              <Link to="/parametres/criteres" className="mt-3 inline-block text-[13px] font-medium text-cyan-texte hover:underline">
                Régler les critères iCity
              </Link>
            )}
          </Carte>
          <SuiviOffre o={o} gerer={gerer} enregistrer={(corps) => suivre.mutate(corps)} enCours={suivre.isPending} />
        </div>
      </div>

      {conversion && <ModaleConversion offre={o} surFermer={() => setConversion(false)} />}
      <Confirmation
        ouverte={aImporter !== null}
        surChangement={(x) => !x && setAImporter(null)}
        titre="Importer ce document dans la GED ?"
        description={`« ${aImporter?.nom ?? ''} » sera lu depuis la source, versé avec son adresse d’origine et son empreinte. S’il est déjà dans la GED, il ne sera pas doublé. Seul un document publiquement téléchargeable peut être importé.`}
        libelle="Importer"
        ton="principal"
        chargement={importerDoc.isPending}
        surConfirmer={() => importerDoc.mutate(aImporter.url)}
      />
    </div>
  );
}

function SuiviOffre({ o, gerer, enregistrer, enCours }) {
  const equipe = useQuery({ queryKey: ['equipe'], queryFn: () => api('/api/equipe'), enabled: gerer });
  const [responsableId, setResponsableId] = useState(o.responsable ? String(o.responsable.id) : '');
  const [notes, setNotes] = useState(o.notes ?? '');
  return (
    <Carte className="p-5">
      <h2 className="mb-3 font-semibold">Suivi</h2>
      {gerer ? (
        <div className="grid gap-3">
          <Selection libelle="Responsable" value={responsableId} onChange={(e) => setResponsableId(e.target.value)}>
            <option value="">— personne —</option>
            {(equipe.data ?? []).map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.nom}
              </option>
            ))}
          </Selection>
          <ZoneTexte libelle="Notes internes" facultatif lignes={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Bouton taille="petit" chargement={enCours} onClick={() => enregistrer({ responsableId: responsableId ? Number(responsableId) : null, notes })}>
            Enregistrer le suivi
          </Bouton>
        </div>
      ) : (
        <dl className="grid gap-1 text-[14px]">
          <dt className="text-encre-3">Responsable</dt>
          <dd>{o.responsable?.nom ?? '—'}</dd>
          <dt className="mt-2 text-encre-3">Notes internes</dt>
          <dd className="whitespace-pre-line">{o.notes ?? '—'}</dd>
        </dl>
      )}
    </Carte>
  );
}

/** Convertir en marché : on relit et on corrige ce que l'offre propose, puis on crée l'affaire. */
function ModaleConversion({ offre, surFermer }) {
  const proposition = useQuery({ queryKey: ['offres', 'conversion', offre.id], queryFn: () => api(`/api/marches-potentiels/${offre.id}/conversion`) });
  const equipe = useQuery({ queryKey: ['equipe'], queryFn: () => api('/api/equipe') });
  const [v, setV] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const navigate = useNavigate();
  const file = useQueryClient();
  const { notifier } = useToasts();
  const donnees = v ?? (proposition.data ? { ...proposition.data.proposition, clientChoisi: proposition.data.proposition.clientId ? String(proposition.data.proposition.clientId) : 'nouveau', montantTtc: proposition.data.proposition.montantTtc ?? '', lot: '' } : null);
  const champ = (cle) => ({ value: donnees?.[cle] ?? '', erreur: erreurs[cle], onChange: (e) => setV({ ...donnees, [cle]: e.target.value }) });

  const convertir = useMutation({
    mutationFn: () =>
      api(`/api/marches-potentiels/${offre.id}/convertir`, {
        methode: 'POST',
        corps: {
          reference: donnees.reference,
          lot: donnees.lot,
          objet: donnees.objet,
          clientId: donnees.clientChoisi !== 'nouveau' && donnees.clientChoisi ? Number(donnees.clientChoisi) : null,
          nouveauClient: donnees.clientChoisi === 'nouveau' ? donnees.nouveauClient : null,
          ville: donnees.ville,
          montantTtc: donnees.montantTtc === '' || donnees.montantTtc === null ? null : Number(donnees.montantTtc),
          statutAffaire: donnees.statutAffaire,
          responsableId: donnees.responsableId ? Number(donnees.responsableId) : null,
          notes: donnees.notes,
        },
      }),
    onSuccess: (r) => {
      file.invalidateQueries({ queryKey: ['offres'] });
      file.invalidateQueries({ queryKey: ['marches'] });
      notifier({ titre: 'Marché créé', message: `${r.reference}${r.clientCree ? ` · client « ${r.clientCree.nom} » créé` : ''}`, ton: 'ok' });
      navigate(`/marches/${r.marcheId}`);
    },
    onError: (e) => {
      setErreurs(e.erreurs ?? {});
      notifier({ titre: 'Conversion impossible', message: e.message, ton: 'alerte' });
    },
  });

  return (
    <Modale
      ouverte
      surChangement={(x) => !x && surFermer()}
      largeur="max-w-2xl"
      titre="Convertir en marché"
      description="Vérifiez et corrigez ce que l’offre propose : l’affaire sera créée avec ces informations, et l’offre passera « Convertie »."
      pied={
        <>
          <Bouton variante="fantome" onClick={surFermer}>
            Annuler
          </Bouton>
          <Bouton chargement={convertir.isPending} disabled={!donnees || proposition.data?.dejaConvertie} onClick={() => convertir.mutate()}>
            Créer le marché
          </Bouton>
        </>
      }
    >
      {!donnees ? (
        <SqueletteLignes lignes={5} />
      ) : proposition.data.dejaConvertie ? (
        <Alerte ton="info">Cette offre est déjà convertie en marché.</Alerte>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ libelle="Référence de l’affaire" {...champ('reference')} />
          <Champ libelle="Lot" facultatif {...champ('lot')} />
          <ZoneTexte libelle="Objet" className="sm:col-span-2" lignes={2} {...champ('objet')} />
          <Selection libelle="Client" {...champ('clientChoisi')}>
            <option value="nouveau">Nouveau client…</option>
            {proposition.data.client && <option value={String(proposition.data.client.id)}>{proposition.data.client.nom}</option>}
            {proposition.data.suggestions.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nom}
              </option>
            ))}
          </Selection>
          {donnees.clientChoisi === 'nouveau' ? <Champ libelle="Nom du nouveau client" aide="Il sera créé à la validation." {...champ('nouveauClient')} /> : <div />}
          <Champ libelle="Ville" facultatif {...champ('ville')} />
          <Champ libelle="Montant TTC estimé (DH)" facultatif type="number" min={0} {...champ('montantTtc')} />
          <Selection libelle="Statut de l’affaire" {...champ('statutAffaire')}>
            {STATUTS_AFFAIRE.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Selection>
          <Selection libelle="Responsable" {...champ('responsableId')}>
            <option value="">— personne —</option>
            {(equipe.data ?? []).map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.nom}
              </option>
            ))}
          </Selection>
          <ZoneTexte libelle="Notes (déposées au fil du marché)" facultatif className="sm:col-span-2" lignes={4} {...champ('notes')} />
        </div>
      )}
    </Modale>
  );
}
