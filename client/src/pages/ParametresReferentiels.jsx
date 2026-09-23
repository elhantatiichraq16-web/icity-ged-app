/**
 * Les référentiels : types de document et étiquettes (§4).
 *
 * Ils structurent tout le fonds — le classement automatique s'y réfère, les
 * pièces du cycle en dépendent. On les modifie donc rarement, mais il faut
 * pouvoir le faire : un nouveau type de pièce apparaît, une étiquette change
 * de nom.
 *
 * Chaque entrée affiche le nombre de pièces qui la portent. C'est ce qui
 * permet de juger avant de toucher : renommer un type utilisé par cinquante
 * documents n'est pas anodin, et le supprimer est refusé.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { api, ErreurApi } from '../api.js';
import { Bouton } from '../ui/Bouton.jsx';
import { CaseACocher, Champ } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, SqueletteLignes } from '../ui/Elements.jsx';
import { Confirmation, Modale } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';

export function ParametresReferentiels() {
  const etat = useQuery({ queryKey: ['referentiels-detail'], queryFn: () => api('/api/referentiels/detail') });

  if (etat.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={6} />
      </Carte>
    );
  }
  if (etat.isError) return <Alerte ton="alerte">{etat.error.message}</Alerte>;

  return (
    <div className="grid gap-5">
      <Table
        titre="Types de document"
        aide="Le code sert au classement automatique. « Pièce du cycle » désigne les pièces qui font avancer la phase d’un marché : OS, BL, PV, attestation, mainlevée."
        chemin="types-document"
        cle="types"
        entrees={etat.data.types}
        colonnes={[
          { cle: 'code', titre: 'Code', className: 'chiffres w-20' },
          { cle: 'nom', titre: 'Nom' },
          { cle: 'ordreCycle', titre: 'Ordre', className: 'chiffres w-16 text-right' },
        ]}
        champs={[
          { cle: 'nom', libelle: 'Nom', requis: true },
          { cle: 'code', libelle: 'Code', requis: true, aide: 'Court et stable : « PVP », « MLV ».' },
          { cle: 'ordreCycle', libelle: 'Ordre dans le cycle', type: 'number', aide: 'Laissez vide si la pièce n’appartient pas au cycle.' },
          { cle: 'pieceAttendue', libelle: 'Pièce du cycle', type: 'case' },
        ]}
      />

      <Table
        titre="Étiquettes"
        aide="La famille les range : circuit, criticité, confidentialité, traitement, patrimoine."
        chemin="etiquettes"
        cle="etiquettes"
        entrees={etat.data.etiquettes}
        groupePar="famille"
        colonnes={[
          { cle: 'nom', titre: 'Nom', couleur: true },
          { cle: 'famille', titre: 'Famille' },
        ]}
        champs={[
          { cle: 'nom', libelle: 'Nom', requis: true },
          { cle: 'couleur', libelle: 'Couleur', type: 'color', requis: true },
          { cle: 'famille', libelle: 'Famille', requis: true, aide: 'circuit, criticite, confidentialite, traitement, patrimoine.' },
        ]}
      />
    </div>
  );
}

/** Une table de référentiel, avec ses trois gestes : ajouter, modifier, retirer. */
function Table({ titre, aide, chemin, cle, entrees, colonnes, champs, groupePar }) {
  const file = useQueryClient();
  const { notifier } = useToasts();
  const [edite, setEdite] = useState(null);
  const [supprime, setSupprime] = useState(null);

  const rafraichir = () => {
    file.invalidateQueries({ queryKey: ['referentiels-detail'] });
    // Les listes déroulantes de toute l'application s'en servent.
    file.invalidateQueries({ queryKey: ['referentiels'] });
  };

  const retirer = useMutation({
    mutationFn: (id) => api(`/api/${chemin}/${id}`, { methode: 'DELETE' }),
    onSuccess: () => {
      rafraichir();
      notifier({ titre: 'Entrée retirée', ton: 'ok' });
      setSupprime(null);
    },
    onError: (e) => notifier({ titre: 'Suppression impossible', message: e.message, ton: 'alerte' }),
  });

  // Les étiquettes se lisent par famille ; les types dans leur ordre.
  const groupes = groupePar
    ? [...new Map(entrees.map((e) => [e[groupePar], null])).keys()].map((g) => ({
        nom: g,
        lignes: entrees.filter((e) => e[groupePar] === g),
      }))
    : [{ nom: null, lignes: entrees }];

  return (
    <Carte className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-trait p-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-titre text-lg font-semibold">{titre}</h2>
          <p className="mt-1 text-[13px] text-encre-2">{aide}</p>
        </div>
        <Badge ton="cyan">{entrees.length}</Badge>
        <Bouton variante="secondaire" taille="petit" icone={Plus} onClick={() => setEdite({})}>
          Ajouter
        </Bouton>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{titre}</caption>
          <thead>
            <tr className="border-b border-trait text-left text-[12px] tracking-wide text-encre-3 uppercase">
              {colonnes.map((c) => (
                <th key={c.cle} scope="col" className={`px-4 py-3 font-semibold ${c.className ?? ''}`}>
                  {c.titre}
                </th>
              ))}
              <th scope="col" className="px-3 py-3 text-right font-semibold">Pièces</th>
              <th scope="col" className="w-24 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {groupes.map((groupe) => (
              <FragmentGroupe
                key={groupe.nom ?? 'tout'}
                groupe={groupe}
                colonnes={colonnes}
                surEditer={setEdite}
                surSupprimer={setSupprime}
              />
            ))}
          </tbody>
        </table>
      </div>

      {edite && (
        <Formulaire
          entree={edite}
          champs={champs}
          chemin={chemin}
          titre={edite.id ? `Modifier « ${edite.nom} »` : `Ajouter dans ${titre.toLowerCase()}`}
          surFermer={() => setEdite(null)}
          surSucces={rafraichir}
        />
      )}

      <Confirmation
        ouverte={Boolean(supprime)}
        surChangement={(o) => !o && setSupprime(null)}
        titre={supprime ? `Retirer « ${supprime.nom} » ?` : ''}
        description={
          supprime?.documents
            ? `${supprime.documents} pièce(s) la portent : le serveur refusera tant qu’elles ne sont pas reclassées.`
            : 'Aucune pièce ne la porte : le retrait est sans conséquence.'
        }
        libelle="Retirer"
        chargement={retirer.isPending}
        surConfirmer={() => retirer.mutate(supprime.id)}
      />
    </Carte>
  );
}

/** Un groupe de lignes, précédé de son titre de famille s'il y en a un. */
function FragmentGroupe({ groupe, colonnes, surEditer, surSupprimer }) {
  return (
    <>
      {groupe.nom && (
        <tr className="bg-surface-2">
          <td colSpan={colonnes.length + 2} className="px-4 py-1.5 text-[12px] font-semibold tracking-wide text-encre-3 uppercase">
            {groupe.nom}
          </td>
        </tr>
      )}
      {groupe.lignes.map((e) => (
        <tr key={e.id} className="border-b border-trait last:border-0 hover:bg-surface-2">
          {colonnes.map((c) => (
            <td key={c.cle} className={`px-4 py-2.5 ${c.className ?? ''}`}>
              {c.couleur ? (
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-3 shrink-0 rounded-full border border-trait" style={{ background: e.couleur }} />
                  {e[c.cle] ?? <span className="text-encre-3">—</span>}
                </span>
              ) : (
                (e[c.cle] ?? <span className="text-encre-3">—</span>)
              )}
            </td>
          ))}
          <td className="chiffres px-3 py-2.5 text-right text-encre-2">{e.documents}</td>
          <td className="px-3 py-2.5">
            <span className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => surEditer(e)}
                aria-label={`Modifier ${e.nom}`}
                className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface hover:text-encre"
              >
                <Pencil className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => surSupprimer(e)}
                aria-label={`Retirer ${e.nom}`}
                className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-alerte-voile hover:text-alerte"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </span>
          </td>
        </tr>
      ))}
    </>
  );
}

/** Le formulaire d'ajout ou de modification, commun aux deux tables. */
function Formulaire({ entree, champs, chemin, titre, surFermer, surSucces }) {
  const { notifier } = useToasts();
  const [valeurs, setValeurs] = useState(() =>
    Object.fromEntries(champs.map((c) => [c.cle, entree[c.cle] ?? (c.type === 'case' ? false : c.type === 'color' ? '#0E8296' : '')])),
  );
  const [erreurs, setErreurs] = useState({});

  const enregistrer = useMutation({
    mutationFn: (corps) =>
      entree.id ? api(`/api/${chemin}/${entree.id}`, { methode: 'PATCH', corps }) : api(`/api/${chemin}`, { methode: 'POST', corps }),
    onSuccess: () => {
      surSucces();
      notifier({ titre: entree.id ? 'Entrée modifiée' : 'Entrée ajoutée', ton: 'ok' });
      surFermer();
    },
    onError: (e) => {
      setErreurs(e instanceof ErreurApi ? e.erreurs : {});
      notifier({ titre: 'Enregistrement impossible', message: e.message, ton: 'alerte' });
    },
  });

  function soumettre(evenement) {
    evenement.preventDefault();
    setErreurs({});
    // Un champ numérique vide vaut « rien », pas zéro.
    const corps = {};
    for (const c of champs) {
      const v = valeurs[c.cle];
      corps[c.cle] = c.type === 'number' ? (v === '' || v === null ? null : Number(v)) : v;
    }
    enregistrer.mutate(corps);
  }

  return (
    <Modale ouverte surChangement={(o) => !o && surFermer()} titre={titre}>
      <form onSubmit={soumettre} className="grid gap-4">
        {champs.map((c) =>
          c.type === 'case' ? (
            <CaseACocher
              key={c.cle}
              libelle={c.libelle}
              checked={Boolean(valeurs[c.cle])}
              onChange={(e) => setValeurs({ ...valeurs, [c.cle]: e.target.checked })}
            />
          ) : (
            <Champ
              key={c.cle}
              libelle={c.libelle}
              aide={c.aide}
              type={c.type ?? 'text'}
              value={valeurs[c.cle] ?? ''}
              onChange={(e) => setValeurs({ ...valeurs, [c.cle]: e.target.value })}
              erreur={erreurs[c.cle]}
              required={c.requis}
            />
          ),
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Bouton type="button" variante="fantome" onClick={surFermer}>
            Annuler
          </Bouton>
          <Bouton type="submit" icone={Tag} chargement={enregistrer.isPending} libelleChargement="Enregistrement…">
            Enregistrer
          </Bouton>
        </div>
      </form>
    </Modale>
  );
}
