/**
 * L'écran « À classer » (§7) : le tableau des suggestions.
 *
 * Le classement automatique propose ; ici, on accepte ou on corrige en un
 * clic. Chaque proposition dit d'où elle vient (« lu 11 fois dans le texte »),
 * pour qu'on puisse juger sans ouvrir le document.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FilePlus2, RefreshCw, X } from 'lucide-react';
import { api } from '../api.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';

const CLE = ['suggestions'];

const ONGLETS = [
  { champ: '', libelle: 'Toutes' },
  { champ: 'marche', libelle: 'Marché' },
  { champ: 'type', libelle: 'Type de pièce' },
  { champ: 'client', libelle: 'Client' },
  { champ: 'objet_technique', libelle: 'Objet technique' },
];

/** La confiance, en mots plutôt qu'en pourcentage seul. */
function Confiance({ valeur }) {
  const ton = valeur >= 80 ? 'ok' : valeur >= 60 ? 'attente' : 'alerte';
  const mot = valeur >= 80 ? 'sûr' : valeur >= 60 ? 'probable' : 'à vérifier';
  return (
    <Badge ton={ton}>
      {mot} · {valeur} %
    </Badge>
  );
}

export function PageAClasser() {
  const [champ, setChamp] = useState('');
  const client = useQueryClient();
  const { notifier } = useToasts();

  const donnees = useQuery({ queryKey: [...CLE, champ], queryFn: () => api(`/api/suggestions${champ ? `?champ=${champ}` : ''}`) });

  const rafraichir = () => client.invalidateQueries({ queryKey: CLE });

  const trancher = useMutation({
    mutationFn: ({ id, decision }) => api(`/api/suggestions/${id}/${decision}`, { methode: 'POST' }),
    onSuccess: (_r, { decision }) => {
      rafraichir();
      client.invalidateQueries({ queryKey: ['marches'] });
      client.invalidateQueries({ queryKey: ['documents'] });
      notifier({ titre: decision === 'accepter' ? 'Proposition acceptée' : 'Proposition écartée', ton: decision === 'accepter' ? 'ok' : 'neutre' });
    },
    onError: (e) => notifier({ titre: 'Action refusée', message: e.message, ton: 'alerte' }),
  });

  const relancer = useMutation({
    mutationFn: () => api('/api/suggestions/relancer', { methode: 'POST' }),
    onSuccess: (r) => {
      rafraichir();
      notifier({ titre: 'Classement relancé', message: `${r.propositions} propositions sur ${r.documents} documents.`, ton: 'ok' });
    },
  });

  const accepterLot = useMutation({
    mutationFn: () => api('/api/suggestions/accepter-lot', { methode: 'POST', corps: { champ: champ || undefined, confianceMinimale: 80 } }),
    onSuccess: (r) => {
      rafraichir();
      client.invalidateQueries({ queryKey: ['marches'] });
      notifier({ titre: `${r.acceptees} propositions acceptées`, message: 'Seules les propositions sûres (≥ 80 %) ont été appliquées.', ton: 'ok' });
    },
  });

  const suggestions = donnees.data?.suggestions ?? [];
  const compteurs = donnees.data?.compteurs ?? {};
  const total = Object.values(compteurs).reduce((a, b) => a + b, 0);

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="À classer"
        description="Ce que la lecture des documents propose. Vous acceptez, ou vous corrigez : un champ tranché à la main n’est plus jamais touché par le classement."
        actions={
          <>
            <Bouton variante="secondaire" icone={RefreshCw} chargement={relancer.isPending} onClick={() => relancer.mutate()}>
              Relancer le classement
            </Bouton>
            <Bouton icone={Check} chargement={accepterLot.isPending} disabled={!suggestions.length} onClick={() => accepterLot.mutate()}>
              Accepter les sûres
            </Bouton>
          </>
        }
      />

      <nav aria-label="Filtrer par champ" className="-mx-1 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-trait px-1">
        {ONGLETS.map((o) => (
          <button
            key={o.champ || 'tout'}
            type="button"
            onClick={() => setChamp(o.champ)}
            aria-current={champ === o.champ ? 'page' : undefined}
            className={cx(
              '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              champ === o.champ ? 'border-cyan text-cyan-texte' : 'border-transparent text-encre-2 hover:text-encre',
            )}
          >
            {o.libelle}
            <span className="ml-1.5 text-encre-3">{o.champ ? (compteurs[o.champ] ?? 0) : total}</span>
          </button>
        ))}
      </nav>

      {donnees.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={6} />
        </Carte>
      ) : donnees.isError ? (
        <Alerte ton="alerte">{donnees.error.message}</Alerte>
      ) : suggestions.length === 0 ? (
        <Carte>
          <EtatVide titre="Rien à classer">
            Toutes les propositions ont été tranchées. Relancez le classement après un nouveau versement.
          </EtatVide>
        </Carte>
      ) : (
        <ul className="grid gap-3">
          {suggestions.map((s) => (
            <li key={s.id}>
              <Carte className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-56 flex-1">
                  <Link to={`/documents/${s.document.id}`} className="font-medium text-cyan-texte hover:underline">
                    {s.document.titre}
                  </Link>
                  <p className="mt-0.5 text-[12.5px] text-encre-3">
                    {s.document.type ?? 'sans type'}
                    {s.document.marche ? ` · ${s.document.marche.reference}` : ' · sans marché'}
                    {s.document.client ? ` · ${s.document.client}` : ''}
                  </p>
                </div>

                <div className="min-w-64 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] text-encre-3">{s.champLibelle} :</span>
                    <strong className="chiffres text-encre">{s.valeur}</strong>
                    {s.creeUnMarche && (
                      <Badge ton="bordeaux">
                        <FilePlus2 className="size-3" aria-hidden /> marché à créer
                      </Badge>
                    )}
                    <Confiance valeur={s.confiance} />
                  </p>
                  {s.raison && <p className="mt-1 text-[12.5px] text-encre-2">{s.raison}</p>}
                </div>

                <div className="flex gap-2">
                  <Bouton taille="petit" icone={Check} chargement={trancher.isPending && trancher.variables?.id === s.id} onClick={() => trancher.mutate({ id: s.id, decision: 'accepter' })}>
                    Accepter
                  </Bouton>
                  <Bouton variante="secondaire" taille="petit" icone={X} onClick={() => trancher.mutate({ id: s.id, decision: 'refuser' })}>
                    Écarter
                  </Bouton>
                </div>
              </Carte>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
