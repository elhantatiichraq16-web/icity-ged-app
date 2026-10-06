/**
 * Les activités, sur le modèle d'Odoo : un rappel posé sur une fiche, pour une
 * personne, à une date.
 *
 *  - `ActivitesFiche` : les activités prévues d'un marché ou d'un client, en
 *    tête de son fil, avec « Planifier une activité ».
 *  - `MesActivites` : celles qu'on doit faire, sur le tableau de bord.
 *  - `ModaleActivite` : planifier ou modifier, aussi depuis le calendrier,
 *    pour un événement libre (sans fiche), avec heure, participants et rappel.
 *
 * Rouge : en retard. Orange : aujourd'hui. Vert : à venir — les couleurs d'Odoo.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarClock, CalendarPlus, Check, Clock, FileQuestion, ListTodo, Mail, Pencil, Phone, Plus, Trash2, Users, X } from 'lucide-react';
import { DUREES, jourCasablanca, RAPPELS, schemaActivite, TYPES_ACTIVITES } from '@icity/commun/activites';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateCourte } from '../format.js';
import { useFormulaire } from '../formulaire.js';
import { Bouton } from '../ui/Bouton.jsx';
import { CaseACocher, Champ, Selection, ZoneTexte } from '../ui/Champ.jsx';
import { Alerte, Carte, SqueletteLignes } from '../ui/Elements.jsx';
import { Confirmation, Modale } from '../ui/Modale.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';

const ICONES = { a_faire: ListTodo, appel: Phone, mail: Mail, reunion: Users, piece: FileQuestion };

const TONS = {
  retard: 'bg-alerte-voile text-alerte-texte',
  aujourdhui: 'bg-attente-voile text-attente',
  avenir: 'bg-ok-voile text-ok',
};

/** « En retard de 3 jours », « Aujourd'hui », « Demain », « Dans 4 jours ». */
function quand(echeance) {
  const jours = Math.round((new Date(`${echeance}T00:00:00Z`) - new Date(`${jourCasablanca()}T00:00:00Z`)) / 86_400_000);
  if (jours < -1) return `En retard de ${-jours} jours`;
  if (jours === -1) return 'En retard d’un jour';
  if (jours === 0) return 'Aujourd’hui';
  if (jours === 1) return 'Demain';
  return `Dans ${jours} jours`;
}

/** Un jour décalé de `n` jours, au format des champs date. */
const dans = (n) => jourCasablanca(new Date(Date.now() + n * 86_400_000));

/** Tout ce qui montre des activités est relu après un geste. */
function useRelire() {
  const file = useQueryClient();
  return () => {
    for (const cle of [['activites'], ['fil'], ['notifications'], ['calendrier']]) file.invalidateQueries({ queryKey: cle });
  };
}

/**
 * Planifier une activité, ou la modifier.
 *
 * Sans `fiche` (depuis le calendrier ou le tableau de bord), c'est un événement :
 * la fiche devient facultative (on peut le rattacher à un marché), et la date
 * de départ est le jour cliqué (`date`).
 */
export function ModaleActivite({ ouverte, surChangement, fiche, activite, date }) {
  const { utilisateur } = useSession();
  const libre = !fiche && !activite;
  const equipe = useQuery({ queryKey: ['equipe'], queryFn: () => api('/api/equipe'), enabled: ouverte });
  const marches = useQuery({ queryKey: ['marches'], queryFn: () => api('/api/marches'), enabled: ouverte && libre });
  const depart = activite
    ? {
        type: activite.type,
        resume: activite.resume,
        note: activite.note ?? '',
        echeance: activite.echeance,
        assigneId: String(activite.assigne.id),
        heure: activite.heure ?? '',
        dureeMinutes: activite.dureeMinutes ? String(activite.dureeMinutes) : '',
        rappelJours: activite.rappelJours ? String(activite.rappelJours) : '',
        participantIds: activite.participants.map((p) => p.id),
      }
    : {
        type: libre ? 'reunion' : 'a_faire',
        resume: '',
        note: '',
        echeance: date ?? dans(1),
        assigneId: String(utilisateur.id),
        heure: '',
        dureeMinutes: '',
        rappelJours: libre ? '1' : '',
        participantIds: [],
      };
  const f = useFormulaire(depart);
  const [marcheId, setMarcheId] = useState('');
  const [tousLesParticipants, setTousLesParticipants] = useState(false);
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);
  const relire = useRelire();
  const { notifier } = useToasts();

  // Supprimer : l'activité disparaît des activités, du calendrier et des rappels ; le fil garde la trace.
  const supprimer = useMutation({
    mutationFn: () => api(`/api/activites/${activite.id}`, { methode: 'DELETE' }),
    onSuccess: () => {
      relire();
      setConfirmerSuppression(false);
      notifier({ titre: 'Supprimé', message: activite.resume, ton: 'ok' });
      surChangement(false);
    },
    onError: (e) => notifier({ titre: 'Impossible', message: e.message, ton: 'alerte' }),
  });
  const autres = (equipe.data ?? []).filter((u) => String(u.id) !== f.valeurs.assigneId);

  function fermer(etat) {
    if (!etat) {
      f.setValeurs(depart);
      f.setErreurGenerale('');
      setMarcheId('');
    }
    surChangement(etat);
  }

  const basculerParticipant = (id) =>
    f.setValeurs((v) => ({ ...v, participantIds: v.participantIds.includes(id) ? v.participantIds.filter((x) => x !== id) : [...v.participantIds, id] }));

  const envoyer = f.soumettre(schemaActivite, async (v) => {
    const corps = { ...v, participantIds: v.participantIds.filter((id) => String(id) !== String(v.assigneId)) };
    await api(activite ? `/api/activites/${activite.id}` : '/api/activites', {
      methode: activite ? 'PATCH' : 'POST',
      corps: activite ? corps : { ...corps, ...(fiche ?? (marcheId ? { marcheId: Number(marcheId) } : {})) },
    });
    relire();
    notifier({ titre: activite ? 'Activité modifiée' : libre ? 'Événement planifié' : 'Activité planifiée', message: v.resume, ton: 'ok' });
    fermer(false);
  });

  return (
    <>
      <Modale
        ouverte={ouverte}
        surChangement={fermer}
        largeur="max-w-2xl"
        titre={activite ? 'Modifier l’activité' : libre ? 'Nouvel événement' : 'Planifier une activité'}
        description={
          libre
            ? 'Une réunion, une formation, une échéance à ne pas oublier : chaque personne conviée la verra dans ses activités et son calendrier, et sera prévenue.'
            : 'Un rappel sur cette fiche, pour vous ou pour un collègue : il apparaîtra dans ses activités à la date choisie.'
        }
        pied={
          <>
            {activite && (
              <Bouton variante="secondaire" icone={Trash2} onClick={() => setConfirmerSuppression(true)} disabled={f.envoi} className="mr-auto text-alerte-texte! hover:bg-alerte-voile!">
                Supprimer
              </Bouton>
            )}
            <Bouton variante="fantome" onClick={() => fermer(false)} disabled={f.envoi}>
              Annuler
            </Bouton>
            <Bouton type="submit" form="formulaire-activite" icone={activite ? undefined : CalendarClock} chargement={f.envoi} libelleChargement="Enregistrement…">
              {activite ? 'Enregistrer' : 'Planifier'}
            </Bouton>
          </>
        }
      >
        <form id="formulaire-activite" onSubmit={envoyer} noValidate className="grid gap-4 sm:grid-cols-2">
          {f.erreurGenerale && (
            <Alerte ton="alerte" className="sm:col-span-2">
              {f.erreurGenerale}
            </Alerte>
          )}
          <Selection libelle="Type" {...f.champ('type')}>
            {TYPES_ACTIVITES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.nom}
              </option>
            ))}
          </Selection>
          <Selection libelle={libre || f.valeurs.type === 'reunion' ? 'Organisé par' : 'Pour'} {...f.champ('assigneId')}>
            {(equipe.data ?? [{ id: utilisateur.id, nom: utilisateur.nom }]).map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.id === utilisateur.id ? `${u.nom} (moi)` : u.nom}
              </option>
            ))}
          </Selection>
          <Champ
            libelle="Résumé"
            className="sm:col-span-2"
            placeholder={libre ? 'Réunion d’équipe du lundi' : 'Relancer pour le PV de réception'}
            autoFocus
            {...f.champ('resume')}
          />
          <div className="grid gap-1.5 sm:col-span-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <Champ libelle={libre ? 'Date' : 'Échéance'} type="date" {...f.champ('echeance')} />
              <Champ libelle="Heure" facultatif type="time" step={300} {...f.champ('heure')} />
              <Selection libelle="Durée" facultatif {...f.champ('dureeMinutes')} disabled={!f.valeurs.heure}>
                <option value="">—</option>
                {DUREES.map((d) => (
                  <option key={d.minutes} value={String(d.minutes)}>
                    {d.nom}
                  </option>
                ))}
              </Selection>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                ['Aujourd’hui', 0],
                ['Demain', 1],
                ['Dans une semaine', 7],
                ['Dans un mois', 30],
              ].map(([libelle, n]) => (
                <button
                  key={libelle}
                  type="button"
                  onClick={() => f.setValeurs((v) => ({ ...v, echeance: dans(n) }))}
                  className="rounded-full border border-trait px-2.5 py-0.5 text-[13px] text-encre-2 hover:border-trait-fort hover:bg-surface-2"
                >
                  {libelle}
                </button>
              ))}
            </div>
          </div>
          <Selection libelle="Me le rappeler" {...f.champ('rappelJours')}>
            {RAPPELS.map((r) => (
              <option key={r.nom} value={r.jours ? String(r.jours) : ''}>
                {r.nom}
              </option>
            ))}
          </Selection>
          {libre ? (
            <Selection libelle="Marché concerné" facultatif value={marcheId} onChange={(e) => setMarcheId(e.target.value)}>
              <option value="">— aucun (événement libre) —</option>
              {(marches.data ?? []).map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.reference}
                  {m.client?.nom ? ` — ${m.client.nom}` : ''}
                </option>
              ))}
            </Selection>
          ) : (
            <p className="self-end pb-2 text-[13px] text-encre-3">
              <BellRing className="mr-1 inline size-3.5" aria-hidden />
              Dans la cloche, « Mes activités » et le mail du matin.
            </p>
          )}

          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-1.5 text-[13px] font-semibold text-encre-2">
              Participants <span className="font-normal text-encre-3">(facultatif)</span>
              {f.valeurs.participantIds.length > 0 && <span className="chiffres ml-2 font-normal text-encre-3">{f.valeurs.participantIds.length} convié(s)</span>}
            </legend>
            {autres.length === 0 ? (
              <p className="text-[13px] text-encre-3">Aucun autre compte actif.</p>
            ) : (
              <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-3">
                {(tousLesParticipants ? autres : autres.slice(0, 9)).map((u) => (
                  <CaseACocher key={u.id} libelle={u.nom} checked={f.valeurs.participantIds.includes(u.id)} onChange={() => basculerParticipant(u.id)} />
                ))}
              </div>
            )}
            {autres.length > 9 && (
              <button type="button" onClick={() => setTousLesParticipants((x) => !x)} className="justify-self-start text-[13px] font-medium text-cyan-texte hover:underline">
                {tousLesParticipants ? 'Moins de noms' : `Voir les ${autres.length} collègues`}
              </button>
            )}
            {f.erreurs.participantIds && <p className="text-[13px] text-alerte-texte">{f.erreurs.participantIds}</p>}
          </fieldset>

          <ZoneTexte libelle="Note" facultatif className="sm:col-span-2" lignes={2} placeholder={libre ? 'Lieu, ordre du jour…' : undefined} {...f.champ('note')} />
        </form>
      </Modale>
      {activite && (
        <Confirmation
          ouverte={confirmerSuppression}
          surChangement={setConfirmerSuppression}
          titre="Supprimer cet événement ?"
          description={`« ${activite.resume} » disparaîtra du calendrier et des activités${activite.participants.length ? ', y compris pour les participants' : ''}. Le fil gardera la trace de la suppression.`}
          libelle="Supprimer"
          chargement={supprimer.isPending}
          surConfirmer={() => supprimer.mutate()}
        />
      )}
    </>
  );
}

/** Une activité : son type, son échéance en couleur, et ce qu'on peut en faire. */
function LigneActivite({ a, avecFiche }) {
  const { utilisateur, droits } = useSession();
  const [edition, setEdition] = useState(false);
  const [fait, setFait] = useState(false);
  const [compteRendu, setCompteRendu] = useState('');
  const [annuler, setAnnuler] = useState(false);
  const relire = useRelire();
  const { notifier } = useToasts();
  const peut = a.assigne.id === utilisateur.id || a.creePar?.id === utilisateur.id || droits.can('gerer', 'Activite');
  const Icone = ICONES[a.type] ?? ListTodo;
  const avec = a.participants.filter((p) => p.id !== utilisateur.id).map((p) => p.nom);
  const jeParticipe = a.participants.some((p) => p.id === utilisateur.id);

  const marquer = useMutation({
    mutationFn: () => api(`/api/activites/${a.id}/fait`, { methode: 'POST', corps: { compteRendu } }),
    onSuccess: () => {
      relire();
      notifier({ titre: 'Activité faite', message: a.resume, ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Impossible', message: e.message, ton: 'alerte' }),
  });
  const supprimer = useMutation({
    mutationFn: () => api(`/api/activites/${a.id}`, { methode: 'DELETE' }),
    onSuccess: () => {
      relire();
      setAnnuler(false);
      notifier({ titre: 'Activité annulée', message: a.resume, ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Impossible', message: e.message, ton: 'alerte' }),
  });

  return (
    <li className="flex gap-3 py-3">
      <span className={cx('grid size-8 shrink-0 place-items-center rounded-full', TONS[a.etat])} title={a.typeNom}>
        <Icone className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px]">
          <span className={cx('font-semibold', a.etat === 'retard' ? 'text-alerte-texte' : a.etat === 'aujourdhui' ? 'text-attente' : 'text-ok')}>{quand(a.echeance)}</span>
          <span className="text-encre-3">
            {' · '}
            {dateCourte(a.echeance)}
            {a.plage && (
              <>
                {' · '}
                <Clock className="inline size-3.5 align-[-2px]" aria-hidden /> {a.plage}
              </>
            )}
            {' · '}
          </span>
          <span className="font-medium">{a.typeNom}</span>
          <span> : {a.resume}</span>
        </p>
        <p className="text-[13px] text-encre-3">
          {jeParticipe ? `organisé par ${a.assigne.nom} · vous participez` : `pour ${a.assigne.id === utilisateur.id ? 'moi' : a.assigne.nom}`}
          {avec.length > 0 && ` · avec ${avec.join(', ')}`}
          {a.enRappel && (
            <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-attente-voile px-1.5 font-medium text-attente">
              <BellRing className="size-3" aria-hidden /> rappel
            </span>
          )}
          {avecFiche && !(a.marche || a.client || a.fournisseur || a.commande) && (
            <>
              {' · '}
              <Link to={`/calendrier?date=${a.echeance}`} className="text-cyan-texte hover:underline">
                au calendrier
              </Link>
            </>
          )}
          {avecFiche && (a.marche || a.client || a.fournisseur || a.commande) && (
            <>
              {' · '}
              <Link
                to={
                  a.marche
                    ? `/marches/${a.marche.id}`
                    : a.client
                      ? `/clients/${a.client.id}`
                      : a.commande
                        ? `/achats/commandes/${a.commande.id}`
                        : `/achats/fournisseurs/${a.fournisseur.id}`
                }
                className="text-cyan-texte hover:underline"
              >
                {a.marche ? a.marche.reference : a.client ? a.client.nom : a.commande ? `commande ${a.commande.fournisseur ?? ''}` : a.fournisseur.nom}
              </Link>
            </>
          )}
        </p>
        {a.note && <p className="mt-0.5 text-[13px] whitespace-pre-line text-encre-2">{a.note}</p>}

        {fait && (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              marquer.mutate();
            }}
          >
            <input
              value={compteRendu}
              onChange={(e) => setCompteRendu(e.target.value)}
              autoFocus
              placeholder="Compte rendu (facultatif) : « le PV part lundi »"
              aria-label="Compte rendu"
              className="h-9 min-w-56 flex-1 rounded-lg border border-trait bg-surface-2 px-3 text-[14px] focus:border-cyan focus:outline-none"
            />
            <Bouton type="submit" taille="petit" icone={Check} chargement={marquer.isPending}>
              Valider
            </Bouton>
            <Bouton variante="fantome" taille="petit" onClick={() => setFait(false)}>
              Annuler
            </Bouton>
          </form>
        )}
      </div>
      {peut && !fait && (
        <div className="flex shrink-0 items-start gap-1">
          <Bouton variante="secondaire" taille="petit" icone={Check} onClick={() => setFait(true)}>
            Fait
          </Bouton>
          <button type="button" onClick={() => setEdition(true)} aria-label={`Modifier « ${a.resume} »`} className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface-2 hover:text-encre">
            <Pencil className="size-4" aria-hidden />
          </button>
          <button type="button" onClick={() => setAnnuler(true)} aria-label={`Annuler « ${a.resume} »`} className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface-2 hover:text-alerte">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      {peut && (
        <>
          <ModaleActivite ouverte={edition} surChangement={setEdition} activite={a} />
          <Confirmation
            ouverte={annuler}
            surChangement={setAnnuler}
            titre="Annuler cette activité ?"
            description={`« ${a.resume} » ne sera plus à faire. Le fil de la fiche gardera la trace de l’annulation.`}
            libelle="Annuler l’activité"
            chargement={supprimer.isPending}
            surConfirmer={() => supprimer.mutate()}
          />
        </>
      )}
    </li>
  );
}

/**
 * Les activités prévues d'une fiche, en tête de son fil, comme dans Odoo.
 *
 * @param {{ type: 'marche' | 'client' | 'fournisseur', id: number }} props
 */
export function ActivitesFiche({ type, id }) {
  const { droits } = useSession();
  const [planifier, setPlanifier] = useState(false);
  const champ = { marche: 'marcheId', client: 'clientId', fournisseur: 'fournisseurId', commande: 'commandeId' }[type];
  const activites = useQuery({ queryKey: ['activites', type, String(id)], queryFn: () => api(`/api/activites?${champ}=${id}`) });
  const liste = activites.data ?? [];

  return (
    <div className="border-b border-trait px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-sans text-[14px] font-semibold">
          Activités prévues {liste.length > 0 && <span className="chiffres ml-1 text-encre-3">{liste.length}</span>}
        </h3>
        {droits.can('planifier', 'Activite') && (
          <Bouton variante="secondaire" taille="petit" icone={Plus} onClick={() => setPlanifier(true)}>
            Planifier une activité
          </Bouton>
        )}
      </div>
      {liste.length > 0 ? (
        <ul className="divide-y divide-trait">
          {liste.map((a) => (
            <LigneActivite key={a.id} a={a} />
          ))}
        </ul>
      ) : (
        !activites.isPending && <p className="pt-1 text-[13px] text-encre-3">Aucune activité prévue.</p>
      )}
      {droits.can('planifier', 'Activite') && <ModaleActivite ouverte={planifier} surChangement={setPlanifier} fiche={{ [champ]: Number(id) }} />}
    </div>
  );
}

/** « Mes activités », pour le tableau de bord : en retard, aujourd'hui, à venir. */
export function MesActivites({ className }) {
  const { droits } = useSession();
  const [nouvel, setNouvel] = useState(false);
  const activites = useQuery({ queryKey: ['activites', 'miennes'], queryFn: () => api('/api/activites?miennes=1') });
  const liste = activites.data ?? [];
  const retard = liste.filter((a) => a.etat === 'retard').length;
  const jour = liste.filter((a) => a.etat === 'aujourdhui').length;
  const bientot = liste.filter((a) => a.enRappel).length;

  return (
    <Carte className={cx('p-5', className)}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Mes activités</h2>
        {retard > 0 && <span className="rounded-full bg-alerte-voile px-2 text-[13px] font-semibold text-alerte-texte">{retard} en retard</span>}
        {jour > 0 && <span className="rounded-full bg-attente-voile px-2 text-[13px] font-semibold text-attente">{jour} aujourd’hui</span>}
        {bientot > 0 && <span className="rounded-full bg-cyan-voile px-2 text-[13px] font-semibold text-cyan-texte">{bientot} bientôt</span>}
        {droits.can('planifier', 'Activite') && (
          <Bouton variante="secondaire" taille="petit" icone={CalendarPlus} onClick={() => setNouvel(true)} className="ml-auto">
            Nouvel événement
          </Bouton>
        )}
      </div>
      {droits.can('planifier', 'Activite') && <ModaleActivite ouverte={nouvel} surChangement={setNouvel} />}
      {activites.isPending ? (
        <SqueletteLignes lignes={3} />
      ) : liste.length === 0 ? (
        <p className="py-2 text-[14px] text-encre-3">Rien à faire pour l’instant. Planifiez une activité depuis la fiche d’un marché ou d’un client, ou un événement depuis le calendrier.</p>
      ) : (
        <ul className="divide-y divide-trait">
          {liste.slice(0, 8).map((a) => (
            <LigneActivite key={a.id} a={a} avecFiche />
          ))}
        </ul>
      )}
      {liste.length > 8 && <p className="pt-2 text-[13px] text-encre-3">Et {liste.length - 8} autre(s), plus lointaine(s).</p>}
    </Carte>
  );
}
