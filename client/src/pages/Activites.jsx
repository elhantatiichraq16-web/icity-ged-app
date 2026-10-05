/**
 * Les activités, sur le modèle d'Odoo : un rappel posé sur une fiche, pour une
 * personne, à une date.
 *
 *  - `ActivitesFiche` : les activités prévues d'un marché ou d'un client, en
 *    tête de son fil, avec « Planifier une activité ».
 *  - `MesActivites` : celles qu'on doit faire, sur le tableau de bord.
 *
 * Rouge : en retard. Orange : aujourd'hui. Vert : à venir — les couleurs d'Odoo.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, FileQuestion, ListTodo, Mail, Pencil, Phone, Plus, Users, X } from 'lucide-react';
import { jourCasablanca, schemaActivite, TYPES_ACTIVITES } from '@icity/commun/activites';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateCourte } from '../format.js';
import { useFormulaire } from '../formulaire.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection, ZoneTexte } from '../ui/Champ.jsx';
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
    for (const cle of [['activites'], ['fil'], ['notifications']]) file.invalidateQueries({ queryKey: cle });
  };
}

/** Planifier une activité, ou la modifier. */
function ModaleActivite({ ouverte, surChangement, fiche, activite }) {
  const { utilisateur } = useSession();
  const equipe = useQuery({ queryKey: ['equipe'], queryFn: () => api('/api/equipe'), enabled: ouverte });
  const depart = activite
    ? { type: activite.type, resume: activite.resume, note: activite.note ?? '', echeance: activite.echeance, assigneId: String(activite.assigne.id) }
    : { type: 'a_faire', resume: '', note: '', echeance: dans(1), assigneId: String(utilisateur.id) };
  const f = useFormulaire(depart);
  const relire = useRelire();
  const { notifier } = useToasts();

  function fermer(etat) {
    if (!etat) {
      f.setValeurs(depart);
      f.setErreurGenerale('');
    }
    surChangement(etat);
  }

  const envoyer = f.soumettre(schemaActivite, async (v) => {
    await api(activite ? `/api/activites/${activite.id}` : '/api/activites', {
      methode: activite ? 'PATCH' : 'POST',
      corps: activite ? v : { ...v, ...fiche },
    });
    relire();
    notifier({ titre: activite ? 'Activité modifiée' : 'Activité planifiée', message: v.resume, ton: 'ok' });
    fermer(false);
  });

  return (
    <Modale
      ouverte={ouverte}
      surChangement={fermer}
      titre={activite ? 'Modifier l’activité' : 'Planifier une activité'}
      description="Un rappel sur cette fiche, pour vous ou pour un collègue : il apparaîtra dans ses activités à la date choisie."
      pied={
        <>
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
        <Selection libelle="Pour" {...f.champ('assigneId')}>
          {(equipe.data ?? [{ id: utilisateur.id, nom: utilisateur.nom }]).map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.id === utilisateur.id ? `${u.nom} (moi)` : u.nom}
            </option>
          ))}
        </Selection>
        <Champ libelle="Résumé" className="sm:col-span-2" placeholder="Relancer pour le PV de réception" autoFocus {...f.champ('resume')} />
        <div className="grid gap-1.5 sm:col-span-2">
          <Champ libelle="Échéance" type="date" {...f.champ('echeance')} />
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
        <ZoneTexte libelle="Note" facultatif className="sm:col-span-2" lignes={2} {...f.champ('note')} />
      </form>
    </Modale>
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
          <span className="text-encre-3"> · {dateCourte(a.echeance)} · </span>
          <span className="font-medium">{a.typeNom}</span>
          <span> : {a.resume}</span>
        </p>
        <p className="text-[13px] text-encre-3">
          pour {a.assigne.id === utilisateur.id ? 'moi' : a.assigne.nom}
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
  const activites = useQuery({ queryKey: ['activites', 'miennes'], queryFn: () => api('/api/activites?miennes=1') });
  const liste = activites.data ?? [];
  const retard = liste.filter((a) => a.etat === 'retard').length;
  const jour = liste.filter((a) => a.etat === 'aujourdhui').length;

  return (
    <Carte className={cx('p-5', className)}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Mes activités</h2>
        {retard > 0 && <span className="rounded-full bg-alerte-voile px-2 text-[13px] font-semibold text-alerte-texte">{retard} en retard</span>}
        {jour > 0 && <span className="rounded-full bg-attente-voile px-2 text-[13px] font-semibold text-attente">{jour} aujourd’hui</span>}
      </div>
      {activites.isPending ? (
        <SqueletteLignes lignes={3} />
      ) : liste.length === 0 ? (
        <p className="py-2 text-[14px] text-encre-3">Rien à faire pour l’instant. Planifiez une activité depuis la fiche d’un marché ou d’un client.</p>
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
