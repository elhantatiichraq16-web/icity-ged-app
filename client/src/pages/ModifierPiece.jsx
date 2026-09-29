/**
 * Corriger une pièce à la main (maquette A08) : son titre, son marché, son
 * type, son client, sa confidentialité.
 *
 * Ce qu'on range ici est un jugement humain : le serveur marque la pièce
 * « rangée à la main », et le classement automatique ne la touchera plus.
 * Seuls les champs changés partent au serveur — un client laissé tel quel
 * suit alors le marché choisi, comme au classement automatique.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { confidentialitesVisibles } from '@icity/commun/droits';
import { CONFIDENTIALITES } from '@icity/commun/roles';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { useFormulaire } from '../formulaire.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection } from '../ui/Champ.jsx';
import { Alerte } from '../ui/Elements.jsx';
import { Modale } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';
import { CLE_MARCHES } from './Marches.jsx';

/** Les listes qu'une pièce rangée peut avoir changées. */
export const CLES_APRES_RANGEMENT = [['document'], ['documents'], ['marche'], CLE_MARCHES, ['a-classer'], ['a-verifier'], ['notifications'], ['tableau-bord']];

/** Le libellé d'une affaire dans une liste : référence, client, et « AO » si ce n'en est qu'un. */
export function libelleAffaire(m) {
  return `${m.reference}${m.client ? ` · ${m.client.nom}` : ''}${m.appelOffres ? ' (appel d’offres)' : ''}`;
}

export function ModalePiece({ piece, ouverte, surChangement }) {
  return (
    <Modale ouverte={ouverte} surChangement={surChangement} titre="Modifier la pièce" description="Ce que vous rangez ici ne sera plus modifié par le classement automatique." largeur="max-w-xl">
      {/* Monté à chaque ouverture : le formulaire repart des valeurs actuelles. */}
      {ouverte && <FormulairePiece piece={piece} fermer={() => surChangement(false)} />}
    </Modale>
  );
}

function FormulairePiece({ piece, fermer }) {
  const { utilisateur } = useSession();
  const file = useQueryClient();
  const { notifier } = useToasts();
  const marches = useQuery({ queryKey: CLE_MARCHES, queryFn: () => api('/api/marches') });
  const referentiels = useQuery({ queryKey: ['referentiels'], queryFn: () => api('/api/referentiels') });
  // Les clients internes compris : une pièce de la société elle-même y est rattachée.
  const clients = useQuery({ queryKey: ['clients', 'avec-internes'], queryFn: () => api('/api/clients?interne=true') });

  const initiales = {
    titre: piece.titre,
    marcheId: piece.marche ? String(piece.marche.id) : '',
    typeDocumentId: piece.type ? String(piece.type.id) : '',
    clientId: piece.client ? String(piece.client.id) : '',
    confidentialite: piece.confidentialite ?? 'interne',
  };
  const f = useFormulaire(initiales);
  const niveaux = CONFIDENTIALITES.filter((c) => confidentialitesVisibles(utilisateur.role).includes(c.code));
  const affaires = [...(marches.data ?? [])].sort((a, b) => a.reference.localeCompare(b.reference, 'fr', { numeric: true }));

  const enregistrer = f.soumettre(null, async (v) => {
    const nombre = (x) => (x ? Number(x) : null);
    const corps = {};
    if (v.titre.trim() !== initiales.titre) corps.titre = v.titre.trim();
    if (v.marcheId !== initiales.marcheId) corps.marcheId = nombre(v.marcheId);
    if (v.typeDocumentId !== initiales.typeDocumentId) corps.typeDocumentId = nombre(v.typeDocumentId);
    if (v.clientId !== initiales.clientId) corps.clientId = nombre(v.clientId);
    if (v.confidentialite !== initiales.confidentialite) corps.confidentialite = v.confidentialite;
    if (!Object.keys(corps).length) return fermer();

    await api(`/api/documents/${piece.id}`, { methode: 'PATCH', corps });
    for (const cle of CLES_APRES_RANGEMENT) file.invalidateQueries({ queryKey: cle });
    notifier({ titre: 'Pièce enregistrée', message: 'Rangée à la main : le classement automatique ne la modifiera plus.', ton: 'ok' });
    fermer();
  });

  return (
    <form noValidate onSubmit={enregistrer} className="grid gap-4">
      {f.erreurGenerale && <Alerte ton="alerte">{f.erreurGenerale}</Alerte>}
      <Champ libelle="Titre" {...f.champ('titre')} />
      <Selection libelle="Marché ou appel d’offres" aide="Le client suit le marché s’il n’est pas déjà renseigné." {...f.champ('marcheId')}>
        <option value="">— sans marché —</option>
        {affaires.map((m) => (
          <option key={m.id} value={String(m.id)}>
            {libelleAffaire(m)}
          </option>
        ))}
      </Selection>
      <div className="grid gap-4 sm:grid-cols-2">
        <Selection libelle="Type de pièce" {...f.champ('typeDocumentId')}>
          <option value="">— sans type —</option>
          {(referentiels.data?.types ?? []).map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.nom}
            </option>
          ))}
        </Selection>
        <Selection libelle="Confidentialité" {...f.champ('confidentialite')}>
          {niveaux.map((c) => (
            <option key={c.code} value={c.code}>
              {c.nom}
            </option>
          ))}
        </Selection>
      </div>
      <Selection libelle="Client" {...f.champ('clientId')}>
        <option value="">— sans client —</option>
        {(clients.data ?? []).map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.nom}
          </option>
        ))}
      </Selection>
      <div className="mt-2 flex justify-end gap-2">
        <Bouton variante="fantome" onClick={fermer}>
          Annuler
        </Bouton>
        <Bouton type="submit" chargement={f.envoi} libelleChargement="Enregistrement…">
          Enregistrer
        </Bouton>
      </div>
    </form>
  );
}
