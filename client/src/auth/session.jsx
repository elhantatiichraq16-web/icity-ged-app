/**
 * Qui est connecté ? Disponible partout avec useSession().
 *
 * La réponse de /api/auth/moi est gardée en cache par TanStack Query. Après
 * une connexion ou une déconnexion, on la met à jour, et tous les écrans
 * suivent d'eux-mêmes.
 */
import { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { droitsPour } from '@icity/commun/droits';
import { api, definirCsrf } from '../api.js';

const Contexte = createContext(null);

export const CLE_MOI = ['auth', 'moi'];

async function lireMoi() {
  const moi = await api('/api/auth/moi');
  definirCsrf(moi.csrf);
  return moi;
}

export function FournisseurSession({ children }) {
  const client = useQueryClient();
  const requete = useQuery({ queryKey: CLE_MOI, queryFn: lireMoi, staleTime: 60_000, retry: 1 });

  // Si une requête découvre que la session est perdue, on relit /moi : les
  // routes protégées renverront alors vers l'écran de connexion.
  useEffect(() => {
    const surPerte = () => client.invalidateQueries({ queryKey: CLE_MOI });
    window.addEventListener('icity:session-perdue', surPerte);
    return () => window.removeEventListener('icity:session-perdue', surPerte);
  }, [client]);

  const valeur = useMemo(() => {
    const u = requete.data?.utilisateur ?? null;
    return {
      chargement: requete.isPending,
      erreur: requete.error,
      utilisateur: u,
      deuxFacteursEnAttente: Boolean(requete.data?.deuxFacteursEnAttente),
      // Les mêmes règles que le serveur, pour afficher ou masquer les boutons.
      droits: droitsPour(u ? { id: u.id, role: u.role } : null),
      /** À appeler avec la réponse de connexion : évite un aller-retour. */
      definir(reponse) {
        definirCsrf(reponse.csrf);
        client.setQueryData(CLE_MOI, reponse);
      },
      async deconnecter() {
        try {
          await api('/api/auth/deconnexion', { methode: 'POST' });
        } finally {
          definirCsrf(null);
          client.clear();
          client.setQueryData(CLE_MOI, { utilisateur: null, csrf: null, deuxFacteursEnAttente: false });
        }
      },
    };
  }, [requete.data, requete.isPending, requete.error, client]);

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSession() {
  const v = useContext(Contexte);
  if (!v) throw new Error('useSession() doit être utilisé sous <FournisseurSession>.');
  return v;
}
