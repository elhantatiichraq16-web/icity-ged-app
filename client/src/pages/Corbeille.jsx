/**
 * La corbeille (§9).
 *
 * Rien n'est jamais supprimé d'un clic dans iCity : une pièce écartée passe
 * ici, et y reste trente jours. Au-delà, le worker l'efface pour de bon, avec
 * son fichier — sinon le stockage garderait des pièces que plus rien ne
 * référence.
 *
 * Aucune suppression définitive n'est possible à la main : le délai est la
 * seule porte de sortie, et c'est ce qui rend la suppression sûre.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { depuis } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { useToasts } from '../ui/Toasts.jsx';

export function PageCorbeille() {
  const file = useQueryClient();
  const { notifier } = useToasts();
  const corbeille = useQuery({ queryKey: ['corbeille'], queryFn: () => api('/api/corbeille') });

  const restaurer = useMutation({
    mutationFn: (id) => api(`/api/documents/${id}/restaurer`, { methode: 'POST' }),
    onSuccess: () => {
      file.invalidateQueries({ queryKey: ['corbeille'] });
      file.invalidateQueries({ queryKey: ['documents'] });
      // La phase du marché a pu changer : une pièce restaurée compte à nouveau.
      file.invalidateQueries({ queryKey: ['marches'] });
      notifier({ titre: 'Document restauré', message: 'Il reprend sa place dans le fonds.', ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Restauration impossible', message: e.message, ton: 'alerte' }),
  });

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Corbeille"
        description="Les pièces écartées, et le temps qu’il reste avant leur suppression définitive."
      />

      {corbeille.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={4} />
        </Carte>
      ) : corbeille.isError ? (
        <Alerte ton="alerte">{corbeille.error.message}</Alerte>
      ) : corbeille.data.documents.length === 0 ? (
        <Carte>
          <EtatVide titre="Corbeille vide">
            Aucune pièce écartée. Rien n’est jamais supprimé directement : tout passe par ici.
          </EtatVide>
        </Carte>
      ) : (
        <>
          <Alerte ton="info" className="mb-4">
            Les pièces écartées restent ici <strong>{corbeille.data.joursAvantVidage} jours</strong>, puis sont supprimées
            automatiquement. Aucune suppression définitive n’est possible à la main.
          </Alerte>

          <Carte>
            <ul className="divide-y divide-trait">
              {corbeille.data.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Trash2 className="size-4 shrink-0 text-encre-3" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{d.titre}</span>
                  <span className="text-[13px] text-encre-3">écartée {depuis(d.supprimeLe)}</span>
                  {/* Sous une semaine, l'alerte : après, la pièce est perdue. */}
                  <Badge ton={d.joursRestants <= 7 ? 'alerte' : 'neutre'}>{d.joursRestants} jours restants</Badge>
                  <Bouton
                    variante="secondaire"
                    taille="petit"
                    icone={ArchiveRestore}
                    chargement={restaurer.isPending}
                    onClick={() => restaurer.mutate(d.id)}
                  >
                    Restaurer
                  </Bouton>
                </li>
              ))}
            </ul>
          </Carte>
        </>
      )}
    </div>
  );
}
