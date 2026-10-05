/**
 * Les modèles de mails, comme ceux d'Odoo.
 *
 *  - `ChoixModele` : la liste « Partir d'un modèle » des fenêtres d'écriture ;
 *    le modèle choisi remplit l'objet et le message, blancs remplis.
 *  - `ParametresModeles` : la rubrique des paramètres qui les gère.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { remplirModele, schemaModeleMail, USAGES_MODELES, VARIABLES_MODELES } from '@icity/commun/modeles';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { useFormulaire } from '../formulaire.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection, ZoneTexte } from '../ui/Champ.jsx';
import { Alerte, Carte, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { Confirmation, Modale } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';

/**
 * « Partir d'un modèle » : remplit l'objet et le message.
 *
 * @param {{ usage: 'client' | 'fournisseur', valeurs: Record<string, string>, surChoix: (objet: string, corps: string) => void }} props
 */
export function ChoixModele({ usage, valeurs, surChoix }) {
  const { utilisateur } = useSession();
  const modeles = useQuery({ queryKey: ['modeles-mails', usage], queryFn: () => api(`/api/modeles-mails?usage=${usage}`) });
  if (!modeles.data?.length) return null;
  const tout = { mon_nom: utilisateur.nom, date: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date()), ...valeurs };
  return (
    <Selection
      libelle="Partir d’un modèle"
      value=""
      onChange={(e) => {
        const m = modeles.data.find((x) => String(x.id) === e.target.value);
        if (m) surChoix(remplirModele(m.objet, tout), remplirModele(m.corps, tout));
      }}
    >
      <option value="">— aucun —</option>
      {modeles.data.map((m) => (
        <option key={m.id} value={String(m.id)}>
          {m.nom}
        </option>
      ))}
    </Selection>
  );
}

const VIDE = { nom: '', usage: 'client', objet: '', corps: '' };

function ModaleModele({ ouverte, surChangement, modele }) {
  const depart = modele ? { nom: modele.nom, usage: modele.usage, objet: modele.objet, corps: modele.corps } : VIDE;
  const f = useFormulaire(depart);
  const file = useQueryClient();
  const { notifier } = useToasts();

  function fermer(etat) {
    if (!etat) {
      f.setValeurs(depart);
      f.setErreurGenerale('');
    }
    surChangement(etat);
  }

  const envoyer = f.soumettre(schemaModeleMail, async (v) => {
    await api(modele ? `/api/modeles-mails/${modele.id}` : '/api/modeles-mails', { methode: modele ? 'PATCH' : 'POST', corps: v });
    file.invalidateQueries({ queryKey: ['modeles-mails'] });
    notifier({ titre: modele ? 'Modèle enregistré' : 'Modèle ajouté', message: v.nom, ton: 'ok' });
    fermer(false);
  });

  return (
    <Modale
      ouverte={ouverte}
      surChangement={fermer}
      largeur="max-w-2xl"
      titre={modele ? `Modifier « ${modele.nom} »` : 'Nouveau modèle de mail'}
      description="Les blancs entre accolades se remplissent au moment d’écrire ; ceux qui restent vides restent visibles, pour être complétés à la main."
      pied={
        <>
          <Bouton variante="fantome" onClick={() => fermer(false)} disabled={f.envoi}>
            Annuler
          </Bouton>
          <Bouton type="submit" form="formulaire-modele" chargement={f.envoi} libelleChargement="Enregistrement…">
            Enregistrer
          </Bouton>
        </>
      }
    >
      <form id="formulaire-modele" onSubmit={envoyer} noValidate className="grid gap-4 sm:grid-cols-2">
        {f.erreurGenerale && (
          <Alerte ton="alerte" className="sm:col-span-2">
            {f.erreurGenerale}
          </Alerte>
        )}
        <Champ libelle="Nom" placeholder="Relance de livraison" autoFocus {...f.champ('nom')} />
        <Selection libelle="Proposé pour" {...f.champ('usage')}>
          {USAGES_MODELES.map((u) => (
            <option key={u.code} value={u.code}>
              {u.nom}
            </option>
          ))}
        </Selection>
        <Champ libelle="Objet" className="sm:col-span-2" {...f.champ('objet')} />
        <ZoneTexte libelle="Message" className="sm:col-span-2" lignes={8} {...f.champ('corps')} />
        <div className="text-[13px] text-encre-2 sm:col-span-2">
          <p className="mb-1 font-semibold">Blancs disponibles</p>
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {VARIABLES_MODELES.map((v) => (
              <li key={v.cle}>
                <code className="rounded bg-surface-2 px-1">{`{${v.cle}}`}</code> : {v.nom}
              </li>
            ))}
          </ul>
        </div>
      </form>
    </Modale>
  );
}

/** Paramètres → Modèles de mails. */
export function ParametresModeles() {
  const modeles = useQuery({ queryKey: ['modeles-mails', 'tous'], queryFn: () => api('/api/modeles-mails') });
  const [edition, setEdition] = useState(null); // null | 'nouveau' | un modèle
  const [aSupprimer, setASupprimer] = useState(null);
  const file = useQueryClient();
  const { notifier } = useToasts();
  const supprimer = useMutation({
    mutationFn: (m) => api(`/api/modeles-mails/${m.id}`, { methode: 'DELETE' }),
    onSuccess: () => {
      file.invalidateQueries({ queryKey: ['modeles-mails'] });
      setASupprimer(null);
    },
    onError: (e) => notifier({ titre: 'Suppression impossible', message: e.message, ton: 'alerte' }),
  });

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Bouton taille="petit" icone={Plus} onClick={() => setEdition('nouveau')}>
          Nouveau modèle
        </Bouton>
      </div>
      {modeles.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={4} />
        </Carte>
      ) : !modeles.data?.length ? (
        <Carte>
          <EtatVide titre="Aucun modèle">Un modèle de mail fait gagner du temps : une relance, une demande de PV, l’envoi d’un bon de commande.</EtatVide>
        </Carte>
      ) : (
        <Carte>
          <ul className="divide-y divide-trait">
            {modeles.data.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{m.nom}</p>
                  <p className="text-[13px] text-encre-3">
                    {USAGES_MODELES.find((u) => u.code === m.usage)?.nom} · objet : {m.objet}
                  </p>
                </div>
                <Bouton variante="fantome" taille="petit" icone={Pencil} onClick={() => setEdition(m)}>
                  Modifier
                </Bouton>
                <Bouton variante="fantome" taille="petit" icone={Trash2} onClick={() => setASupprimer(m)}>
                  Supprimer
                </Bouton>
              </li>
            ))}
          </ul>
        </Carte>
      )}
      <ModaleModele
        key={edition === 'nouveau' ? 'nouveau' : (edition?.id ?? 'aucun')}
        ouverte={edition !== null}
        surChangement={(o) => !o && setEdition(null)}
        modele={edition === 'nouveau' ? null : edition}
      />
      <Confirmation
        ouverte={aSupprimer !== null}
        surChangement={(o) => !o && setASupprimer(null)}
        titre={`Supprimer « ${aSupprimer?.nom ?? ''} » ?`}
        description="Le modèle ne sera plus proposé. Les mails déjà envoyés ne changent pas."
        libelle="Supprimer"
        chargement={supprimer.isPending}
        surConfirmer={() => supprimer.mutate(aSupprimer)}
      />
    </div>
  );
}
