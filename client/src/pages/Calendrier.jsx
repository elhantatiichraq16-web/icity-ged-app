/**
 * Le calendrier, comme la vue Calendrier d'Odoo : échéances des marchés,
 * activités, livraisons attendues et paiements, sur un mois.
 *
 * Deux affichages : la grille du mois, et l'agenda (une liste par jour), plus
 * lisible sur un petit écran.
 *
 * Un clic sur un jour crée un événement à cette date (une réunion, une
 * formation…), avec son heure, ses participants et son rappel. Un événement
 * libre s'ouvre ici même ; les autres mènent à leur fiche.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, CreditCard, Flag, GanttChart, ListTodo, Plus, Truck } from 'lucide-react';
import { jourCasablanca, nomTypeActivite, RAPPELS } from '@icity/commun/activites';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateCourte, montant } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Carte, EnTetePage, SqueletteLignes } from '../ui/Elements.jsx';
import { CaseACocher } from '../ui/Champ.jsx';
import { Modale } from '../ui/Modale.jsx';
import { cx } from '../ui/cx.js';
import { ModaleActivite } from './Activites.jsx';

/** Les sortes d'événements, leur couleur et leur icône. */
const TYPES = {
  echeance: { libelle: 'Échéances des marchés', Icone: Flag, classe: 'bg-cyan-voile text-cyan-texte' },
  activite: { libelle: 'Activités', Icone: ListTodo, classe: 'bg-attente-voile text-attente' },
  tache: { libelle: 'Étapes de chantier', Icone: GanttChart, classe: 'bg-surface-2 text-encre-2 border border-trait' },
  livraison: { libelle: 'Livraisons attendues', Icone: Truck, classe: 'bg-ok-voile text-ok' },
  paiement: { libelle: 'Paiements', Icone: CreditCard, classe: 'bg-[color-mix(in_oklab,var(--bordeaux),transparent_88%)] text-bordeaux' },
};

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Les 6 semaines affichées pour un mois : du lundi avant le 1er au dimanche suivant. */
function grilleDuMois(annee, mois) {
  const premier = new Date(annee, mois, 1);
  const decalage = (premier.getDay() + 6) % 7; // lundi = 0
  const debut = new Date(annee, mois, 1 - decalage);
  return Array.from({ length: 42 }, (_, i) => new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + i));
}

function Evenement({ e, compact, ouvrir }) {
  const { Icone, classe } = TYPES[e.type];
  const proprietes = {
    title: [e.titre, e.detail, e.montant ? montant(e.montant) : null].filter(Boolean).join(' — '),
    className: cx('flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[12.5px] leading-tight hover:brightness-95', classe, e.alerte && 'ring-1 ring-alerte'),
  };
  const contenu = (
    <>
      <Icone className="size-3 shrink-0" aria-hidden />
      <span className={cx('min-w-0', compact ? 'truncate' : '')}>{e.titre}</span>
    </>
  );
  // Un événement libre n'a pas de fiche : il s'ouvre dans le calendrier même.
  return e.libre ? (
    <button type="button" onClick={() => ouvrir(e.activiteId)} {...proprietes}>
      {contenu}
    </button>
  ) : (
    <Link to={e.lien} {...proprietes}>
      {contenu}
    </Link>
  );
}

/** Un événement libre, ouvert : modifiable par qui l'a créé, la personne chargée ou la direction ; sinon, en lecture. */
function OuvrirActivite({ id, fermer }) {
  const { utilisateur, droits } = useSession();
  const activite = useQuery({ queryKey: ['activites', 'une', String(id)], queryFn: () => api(`/api/activites/${id}`) });
  if (!activite.data) return null;
  const a = activite.data;
  const peut = a.assigne.id === utilisateur.id || a.creePar?.id === utilisateur.id || droits.can('gerer', 'Activite');
  if (peut) return <ModaleActivite key={a.id} ouverte surChangement={(o) => !o && fermer()} activite={a} />;
  return (
    <Modale ouverte surChangement={(o) => !o && fermer()} titre={a.resume} description={`${a.typeNom} · ${dateCourte(a.echeance)}${a.plage ? ` · ${a.plage}` : ''}`}>
      <dl className="grid gap-2 text-[14px]">
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-encre-3">Organisé par</dt>
          <dd>{a.assigne.nom}</dd>
        </div>
        {a.participants.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-encre-3">Participants</dt>
            <dd>{a.participants.map((p) => p.nom).join(', ')}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-encre-3">Rappel</dt>
          <dd>{RAPPELS.find((r) => r.jours === a.rappelJours)?.nom ?? `${a.rappelJours} jours avant`}</dd>
        </div>
        {a.note && (
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-encre-3">Note</dt>
            <dd className="whitespace-pre-line">{a.note}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-[13px] text-encre-3">Seuls {a.assigne.nom} et la direction peuvent modifier cet événement ({nomTypeActivite(a.type).toLowerCase()}).</p>
    </Modale>
  );
}

export function PageCalendrier() {
  const auj = jourCasablanca();
  const { droits } = useSession();
  const peutPlanifier = droits.can('planifier', 'Activite');
  // `?date=` : un rappel de la cloche ouvre le mois de l'événement.
  const [parametres] = useSearchParams();
  const dateVisee = /^\d{4}-\d{2}-\d{2}$/.test(parametres.get('date') ?? '') ? parametres.get('date') : null;
  const [curseur, setCurseur] = useState(() => {
    const d = dateVisee ? new Date(`${dateVisee}T12:00:00`) : new Date();
    return { annee: d.getFullYear(), mois: d.getMonth() };
  });
  const [nouveauLe, setNouveauLe] = useState(null); // la date d'un nouvel événement
  const [ouverte, setOuverte] = useState(null); // l'id d'un événement libre ouvert
  const [vue, setVue] = useState('mois');
  const [miennes, setMiennes] = useState(false);
  const [types, setTypes] = useState(() => new Set(Object.keys(TYPES)));

  const jours = useMemo(() => grilleDuMois(curseur.annee, curseur.mois), [curseur]);
  const debut = iso(jours[0]);
  const fin = iso(jours[41]);
  const evenements = useQuery({
    queryKey: ['calendrier', debut, fin, miennes],
    queryFn: () => api(`/api/calendrier?debut=${debut}&fin=${fin}${miennes ? '&miennes=1' : ''}`),
    placeholderData: (precedents) => precedents,
  });

  const parJour = useMemo(() => {
    const m = new Map();
    for (const e of evenements.data ?? []) {
      if (!types.has(e.type)) continue;
      m.set(e.date, [...(m.get(e.date) ?? []), e]);
    }
    return m;
  }, [evenements.data, types]);

  const titre = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(curseur.annee, curseur.mois, 1));
  const decaler = (n) => setCurseur(({ annee, mois }) => ({ annee: new Date(annee, mois + n, 1).getFullYear(), mois: new Date(annee, mois + n, 1).getMonth() }));
  const moisCourant = (d) => d.getMonth() === curseur.mois;

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Calendrier"
        description="Ce qui tombe à une date : échéances des marchés, activités, livraisons et paiements."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {peutPlanifier && (
              <Bouton icone={CalendarPlus} onClick={() => setNouveauLe(auj)}>
                Nouvel événement
              </Bouton>
            )}
          <div role="group" aria-label="Affichage" className="inline-flex rounded-[10px] border border-trait bg-surface p-0.5">
            {[
              ['mois', 'Mois'],
              ['agenda', 'Agenda'],
            ].map(([code, libelle]) => (
              <button
                key={code}
                type="button"
                aria-pressed={vue === code}
                onClick={() => setVue(code)}
                className={cx('rounded-lg px-3 py-1.5 text-[13px] font-medium', vue === code ? 'bg-cyan-voile text-cyan-texte' : 'text-encre-2 hover:bg-surface-2')}
              >
                {libelle}
              </button>
            ))}
          </div>
          </div>
        }
      />

      <Carte className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => decaler(-1)} aria-label="Mois précédent" className="grid size-9 place-items-center rounded-lg hover:bg-surface-2">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <h2 className="min-w-44 text-center text-lg font-semibold first-letter:uppercase">{titre}</h2>
          <button type="button" onClick={() => decaler(1)} aria-label="Mois suivant" className="grid size-9 place-items-center rounded-lg hover:bg-surface-2">
            <ChevronRight className="size-5" aria-hidden />
          </button>
          <Bouton
            variante="secondaire"
            taille="petit"
            icone={CalendarClock}
            onClick={() => {
              const d = new Date();
              setCurseur({ annee: d.getFullYear(), mois: d.getMonth() });
            }}
          >
            Aujourd’hui
          </Bouton>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {Object.entries(TYPES).map(([code, { libelle, Icone, classe }]) => (
            <label key={code} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                checked={types.has(code)}
                onChange={() =>
                  setTypes((avant) => {
                    const apres = new Set(avant);
                    if (apres.has(code)) apres.delete(code);
                    else apres.add(code);
                    return apres;
                  })
                }
                className="size-4 accent-[var(--cyan)]"
              />
              <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5', classe)}>
                <Icone className="size-3" aria-hidden /> {libelle}
              </span>
            </label>
          ))}
          <CaseACocher libelle="Seulement mes activités" checked={miennes} onChange={(e) => setMiennes(e.target.checked)} />
        </div>
      </Carte>

      {evenements.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={6} />
        </Carte>
      ) : evenements.isError ? (
        <Alerte ton="alerte">{evenements.error.message}</Alerte>
      ) : vue === 'mois' ? (
        <Carte className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-7">
            {JOURS.map((j) => (
              <div key={j} className="border-b border-trait px-2 py-2 text-center text-[13px] font-semibold text-encre-3">
                {j}
              </div>
            ))}
            {jours.map((d) => {
              const cle = iso(d);
              const liste = parJour.get(cle) ?? [];
              const estAujourdhui = cle === auj;
              return (
                <div
                  key={cle}
                  // Un clic dans le vide d'un jour : un nouvel événement à cette date.
                  onClick={peutPlanifier ? (ev) => ev.target === ev.currentTarget && setNouveauLe(cle) : undefined}
                  className={cx(
                    'group min-h-28 border-r border-b border-trait p-1.5 [&:nth-child(7n)]:border-r-0',
                    !moisCourant(d) && 'bg-surface-2/60',
                    cle === dateVisee && 'bg-cyan-voile/40',
                    peutPlanifier && 'cursor-pointer hover:bg-surface-2/80',
                  )}
                >
                  <p className={cx('mb-1 flex items-center text-[13px]', !moisCourant(d) && 'text-encre-3', estAujourdhui && 'font-semibold')}>
                    {peutPlanifier && (
                      <button
                        type="button"
                        onClick={() => setNouveauLe(cle)}
                        aria-label={`Nouvel événement le ${dateCourte(cle)}`}
                        className="grid size-6 place-items-center rounded-md text-encre-3 opacity-0 group-hover:opacity-100 hover:bg-cyan-voile hover:text-cyan-texte focus:opacity-100"
                      >
                        <Plus className="size-4" aria-hidden />
                      </button>
                    )}
                    <span className={cx('ml-auto', estAujourdhui && 'inline-grid size-6 place-items-center rounded-full bg-cyan text-white')}>{d.getDate()}</span>
                  </p>
                  <div className="grid gap-0.5">
                    {liste.slice(0, 4).map((e) => (
                      <Evenement key={e.id} e={e} compact ouvrir={setOuverte} />
                    ))}
                    {liste.length > 4 && (
                      <button type="button" onClick={() => setVue('agenda')} className="text-left text-[12.5px] font-semibold text-cyan-texte hover:underline">
                        + {liste.length - 4} autre(s)
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Carte>
      ) : (
        <Carte>
          {[...parJour.keys()].filter((cle) => cle.slice(0, 7) === iso(new Date(curseur.annee, curseur.mois, 1)).slice(0, 7)).length === 0 ? (
            <p className="px-5 py-6 text-[14px] text-encre-3">Rien de prévu ce mois-ci.</p>
          ) : (
            <ul className="divide-y divide-trait">
              {[...parJour.entries()]
                .filter(([cle]) => cle.slice(0, 7) === iso(new Date(curseur.annee, curseur.mois, 1)).slice(0, 7))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([cle, liste]) => (
                  <li key={cle} className="flex flex-wrap gap-4 px-5 py-3">
                    <p className={cx('w-36 shrink-0 text-[14px] font-semibold first-letter:uppercase', cle === auj && 'text-cyan-texte', cle < auj && 'text-encre-3')}>
                      {new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${cle}T12:00:00`))}
                    </p>
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      {liste.map((e) => (
                        <div key={e.id} className="flex flex-wrap items-center gap-2">
                          <Evenement e={e} ouvrir={setOuverte} />
                          {e.detail && <span className="text-[13px] text-encre-3">{e.detail}</span>}
                          {e.montant ? <span className="chiffres text-[13px] text-encre-2">{montant(e.montant)}</span> : null}
                          {e.alerte && <span className="text-[13px] font-semibold text-alerte-texte">en retard</span>}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Carte>
      )}
      <p className="mt-2 text-[13px] text-encre-3">
        Un événement entouré de rouge est en retard. Un clic ouvre la fiche concernée.
        {peutPlanifier && ' Cliquez sur un jour pour y planifier un événement.'}
      </p>
      {peutPlanifier && nouveauLe && <ModaleActivite key={nouveauLe} ouverte surChangement={(o) => !o && setNouveauLe(null)} date={nouveauLe} />}
      {ouverte && <OuvrirActivite id={ouverte} fermer={() => setOuverte(null)} />}
    </div>
  );
}
