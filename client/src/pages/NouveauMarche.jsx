/**
 * Déclarer une affaire à la main (maquette A09) : un marché dont on tient le
 * contrat, ou un appel d'offres auquel on répond.
 *
 * Seule la référence est obligatoire. Le statut dit de quel côté l'affaire se
 * range : un statut d'appel d'offres (« AO déposé »…) la met dans l'onglet
 * « Appels d'offres », un statut gagné dans « Marchés gagnés » ; sans statut,
 * ce sont les pièces versées qui trancheront.
 *
 * L'écran « À classer » y mène avec la référence lue dans une pièce : le
 * formulaire arrive prérempli, et la pièce rejoindra l'affaire au prochain
 * passage du classement.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import { OBJETS_TECHNIQUES, STATUTS_AFFAIRE } from '@icity/commun/marches';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { useFormulaire } from '../formulaire.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection } from '../ui/Champ.jsx';
import { Alerte, Carte, EnTetePage } from '../ui/Elements.jsx';
import { useToasts } from '../ui/Toasts.jsx';
import { ModaleNouveauClient } from './Clients.jsx';
import { CLE_MARCHES } from './Marches.jsx';

export function PageNouveauMarche() {
  const [parametres] = useSearchParams();
  const aller = useNavigate();
  const file = useQueryClient();
  const { notifier } = useToasts();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api('/api/clients') });
  const appelOffres = parametres.get('nature') === 'ao';
  const [existant, setExistant] = useState(null);
  // Un client absent de la liste s'ajoute sans quitter le formulaire.
  const [creationClient, setCreationClient] = useState(false);
  const { droits } = useSession();
  const peutCreerClient = droits.can('gerer', 'Client');

  const f = useFormulaire({
    reference: parametres.get('reference') ?? '',
    clientId: parametres.get('clientId') ?? '',
    objet: '',
    statutAffaire: appelOffres ? 'AO en préparation' : '',
    numeroAo: '',
    lot: '',
    ville: '',
    objetTechnique: '',
    emplacementPapier: '',
  });

  const envoyer = f.soumettre(null, async (v) => {
    setExistant(null);
    try {
      const m = await api('/api/marches', {
        methode: 'POST',
        corps: {
          reference: v.reference.trim(),
          clientId: v.clientId ? Number(v.clientId) : null,
          objet: v.objet.trim() || null,
          statutAffaire: v.statutAffaire || null,
          numeroAo: v.numeroAo.trim() || null,
          lot: v.lot.trim() || null,
          ville: v.ville.trim() || null,
          objetTechnique: v.objetTechnique || null,
          emplacementPapier: v.emplacementPapier.trim() || null,
        },
      });
      file.invalidateQueries({ queryKey: CLE_MARCHES });
      file.invalidateQueries({ queryKey: ['clients'] });
      notifier({ titre: 'Affaire créée', message: `${m.reference} rejoint la liste. Les pièces qui la citent la rejoindront à leur tour.`, ton: 'ok' });
      aller(`/marches/${m.id}`);
    } catch (erreur) {
      // L'affaire existe déjà : on y mène plutôt que de la doubler.
      if (erreur.statut === 409 && erreur.donnees?.existant) {
        setExistant(erreur.donnees.existant);
        return;
      }
      throw erreur;
    }
  });

  return (
    <div className="animate-apparition">
      <Link to={appelOffres ? '/marches?onglet=ao' : '/marches'} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-cyan-texte hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> {appelOffres ? 'Appels d’offres' : 'Marchés'}
      </Link>
      <EnTetePage
        titre={appelOffres ? 'Nouvel appel d’offres' : 'Nouvelle affaire'}
        description="Seule la référence est obligatoire. Le reste se complète à tout moment depuis la fiche."
      />

      <Carte className="max-w-3xl p-6">
        {existant && (
          <Alerte ton="attente" className="mb-5" titre="Cette affaire existe déjà">
            <Link to={`/marches/${existant.id}`} className="font-semibold text-cyan-texte hover:underline">
              Ouvrir {existant.reference}
            </Link>{' '}
            plutôt que d’en créer une seconde.
          </Alerte>
        )}
        {f.erreurGenerale && (
          <Alerte ton="alerte" className="mb-5">
            {f.erreurGenerale}
          </Alerte>
        )}

        <form noValidate onSubmit={envoyer} className="grid gap-4 sm:grid-cols-2">
          <Champ libelle="Référence" aide="Telle qu’elle figure sur le contrat ou l’avis : 13/2018, 44/AOO/DRAN-ANP/2022…" autoFocus {...f.champ('reference')} />
          <Selection
            libelle="Client"
            {...f.champ('clientId')}
            aide={
              peutCreerClient ? (
                <button type="button" onClick={() => setCreationClient(true)} className="inline-flex items-center gap-1 font-semibold text-cyan-texte hover:underline">
                  <Plus className="size-3.5" aria-hidden /> Client absent de la liste ? L’ajouter
                </button>
              ) : (
                'Client absent de la liste ? Demandez à la direction de l’ajouter.'
              )
            }
          >
            <option value="">— à rattacher plus tard —</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nom}
              </option>
            ))}
          </Selection>
          <Champ libelle="Objet" className="sm:col-span-2" facultatif {...f.champ('objet')} />
          <Selection
            libelle="Statut de l’affaire"
            aide="Un statut d’appel d’offres la range dans « Appels d’offres » ; sans statut, les pièces versées trancheront."
            {...f.champ('statutAffaire')}
          >
            <option value="">— à qualifier plus tard —</option>
            {STATUTS_AFFAIRE.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Selection>
          <Selection libelle="Objet technique" {...f.champ('objetTechnique')}>
            <option value="">—</option>
            {OBJETS_TECHNIQUES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Selection>
          <Champ libelle="Numéro d’appel d’offres" facultatif {...f.champ('numeroAo')} />
          <Champ libelle="Lot" aide="Deux lots d’un même appel d’offres sont deux affaires." facultatif {...f.champ('lot')} />
          <Champ libelle="Ville" facultatif {...f.champ('ville')} />
          <Champ libelle="Emplacement du papier" aide="Où trouver l’original au siège." facultatif {...f.champ('emplacementPapier')} />

          <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
            <Bouton variante="fantome" onClick={() => aller(-1)}>
              Annuler
            </Bouton>
            <Bouton type="submit" chargement={f.envoi} libelleChargement="Création…">
              Créer l’affaire
            </Bouton>
          </div>
        </form>
      </Carte>

      {/* Hors du <form> de l'affaire : dans React, l'envoi du formulaire du
          client remonterait jusqu'à lui et créerait l'affaire au passage. */}
      {peutCreerClient && (
        <ModaleNouveauClient
          ouverte={creationClient}
          surChangement={setCreationClient}
          surCree={(cree) => f.setValeurs((v) => ({ ...v, clientId: String(cree.id) }))}
        />
      )}
    </div>
  );
}
