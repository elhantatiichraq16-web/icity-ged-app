/**
 * Le circuit de validation d'un document, et ses versions (§8), affichés sur
 * la fiche du document.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, ShieldAlert, Upload } from 'lucide-react';
import { ETATS, ORDRE_ETATS } from '@icity/commun/circuit';
import { api } from '../api.js';
import { dateHeure, depuis } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { Modale } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';

const poids = (o) => (o ? `${(o / 1024 / 1024).toFixed(1)} Mo` : '—');

export function CircuitDocument({ documentId }) {
  const client = useQueryClient();
  const { notifier } = useToasts();
  const [renvoi, setRenvoi] = useState(null);
  const [commentaire, setCommentaire] = useState('');
  const fichier = useRef(null);
  const [motif, setMotif] = useState('');

  const circuit = useQuery({ queryKey: ['circuit', documentId], queryFn: () => api(`/api/documents/${documentId}/circuit`) });
  const versions = useQuery({ queryKey: ['versions', documentId], queryFn: () => api(`/api/documents/${documentId}/versions`) });

  const rafraichir = () => {
    client.invalidateQueries({ queryKey: ['circuit', documentId] });
    client.invalidateQueries({ queryKey: ['document', String(documentId)] });
    client.invalidateQueries({ queryKey: ['versions', documentId] });
  };

  const avancer = useMutation({
    mutationFn: ({ transition, commentaire: motifRenvoi }) => api(`/api/documents/${documentId}/circuit`, { methode: 'POST', corps: { transition, commentaire: motifRenvoi } }),
    onSuccess: (r) => {
      rafraichir();
      setRenvoi(null);
      setCommentaire('');
      notifier({ titre: `Document « ${r.etatNom} »`, ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Action refusée', message: e.message, ton: 'alerte' }),
  });

  const nouvelleVersion = useMutation({
    mutationFn: (image) => {
      const corps = new FormData();
      corps.append('motif', motif);
      corps.append('fichier', image, image.name);
      return api(`/api/documents/${documentId}/versions`, { methode: 'POST', fichier: corps });
    },
    onSuccess: (r) => {
      rafraichir();
      setMotif('');
      notifier({ titre: `Version ${r.version} déposée`, message: 'La précédente reste consultable dans l’historique.', ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Dépôt refusé', message: e.message, ton: 'alerte' }),
  });

  if (circuit.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={3} />
      </Carte>
    );
  }

  const c = circuit.data;
  const etape = ORDRE_ETATS.indexOf(c.etat === 'a_corriger' ? 'brouillon' : c.etat);

  return (
    <div className="grid gap-5">
      <Carte className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Circuit de validation</h2>
          <Badge ton={ETATS[c.etat]?.ton ?? 'neutre'}>{c.etatNom}</Badge>
        </div>

        {/* La progression du circuit */}
        <ol className="mb-4 flex flex-wrap gap-1" aria-label="Étapes du circuit">
          {ORDRE_ETATS.filter((e) => e !== 'archive').map((e, i) => (
            <li key={e} className="min-w-16 flex-1">
              <div className={cx('h-1.5 rounded-full', c.etat === 'a_corriger' && i > 0 ? 'bg-alerte-voile' : i <= etape ? 'bg-cyan' : 'bg-trait')} />
              <span className={cx('mt-1 block text-[10.5px]', i === etape ? 'font-semibold text-encre' : 'text-encre-3')}>{ETATS[e].nom}</span>
            </li>
          ))}
        </ol>

        {c.etat === 'a_corriger' && (
          <Alerte ton="alerte" className="mb-4" titre="Renvoyé pour correction">
            {c.historique.find((h) => h.action === 'renvoyer')?.commentaire ?? 'Corrigez la pièce, puis soumettez-la de nouveau.'}
          </Alerte>
        )}

        {c.controleHumainObligatoire && (
          <p className="mb-4 flex items-start gap-2 text-[12.5px] text-encre-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-attente" aria-hidden />
            Pièce critique (contrat, PV, attestation) : le contrôle humain est obligatoire, aucun automatisme ne s’y substitue.
          </p>
        )}

        {c.transitions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {c.transitions.map((t) => (
              <Bouton
                key={t.cle}
                variante={t.cle === 'renvoyer' ? 'secondaire' : 'principal'}
                taille="petit"
                chargement={avancer.isPending && avancer.variables?.transition === t.cle}
                onClick={() => (t.commentaireObligatoire ? setRenvoi(t) : avancer.mutate({ transition: t.cle }))}
              >
                {t.libelle}
              </Bouton>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-encre-3">Aucune action ne vous est ouverte à ce stade.</p>
        )}

        {c.historique.length > 0 && (
          <div className="mt-5 border-t border-trait pt-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-encre-3 uppercase">
              <History className="size-3.5" aria-hidden /> Historique
            </h3>
            <ul className="grid gap-2">
              {c.historique.map((h) => (
                <li key={h.id} className="text-[13px]">
                  <span className="font-medium">{h.par}</span> <span className="text-encre-2">— {ETATS[h.avant]?.nom ?? h.avant} → {ETATS[h.apres]?.nom ?? h.apres}</span>
                  <span className="block text-[12px] text-encre-3">
                    {depuis(h.creeLe)}
                    {h.commentaire ? ` · « ${h.commentaire} »` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Carte>

      {/* ── Versions ── */}
      <Carte className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Versions</h2>
          <Bouton variante="secondaire" taille="petit" icone={Upload} chargement={nouvelleVersion.isPending} onClick={() => fichier.current?.click()}>
            Déposer une nouvelle version
          </Bouton>
          <input
            ref={fichier}
            type="file"
            className="sr-only"
            aria-label="Choisir la nouvelle version"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) nouvelleVersion.mutate(f);
              e.target.value = '';
            }}
          />
        </div>

        <Champ libelle="Motif de la prochaine version" aide="Pourquoi cette nouvelle version ? (facultatif)" value={motif} onChange={(e) => setMotif(e.target.value)} />

        <p className="mt-3 text-[12.5px] text-encre-3">
          Une version n’écrase jamais la précédente : c’est ce qui donne au fonds sa valeur de preuve. Une nouvelle version repart au contrôle.
        </p>

        {versions.data?.length ? (
          <ul className="mt-4 grid gap-2">
            {versions.data.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-trait px-3 py-2 text-[13px]">
                <Badge>v{v.numero}</Badge>
                <span className="min-w-0 flex-1 truncate">{v.nomOrigine ?? '—'}</span>
                <span className="chiffres text-[12px] text-encre-3">{poids(v.taille)}</span>
                <span className="text-[12px] text-encre-3">{v.auteur ?? '—'} · {dateHeure(v.creeLe)}</span>
                {v.motif && <span className="w-full text-[12px] text-encre-3">« {v.motif} »</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-[13px] text-encre-3">Version unique : aucune version antérieure.</p>
        )}
      </Carte>

      {/* Renvoyer exige un motif : le déposant doit savoir quoi reprendre. */}
      <Modale
        ouverte={Boolean(renvoi)}
        surChangement={(o) => !o && setRenvoi(null)}
        titre="Renvoyer pour correction"
        description="Dites ce qui ne va pas : le déposant reçoit ce motif."
        pied={
          <>
            <Bouton variante="fantome" onClick={() => setRenvoi(null)}>
              Annuler
            </Bouton>
            <Bouton variante="danger" chargement={avancer.isPending} onClick={() => avancer.mutate({ transition: renvoi.cle, commentaire })}>
              Renvoyer
            </Bouton>
          </>
        }
      >
        <Champ libelle="Motif" autoFocus value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Le montant ne correspond pas au contrat…" />
      </Modale>
    </div>
  );
}
