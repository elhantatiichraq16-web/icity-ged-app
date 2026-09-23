/**
 * L'écran « À vérifier » (§9).
 *
 * Quatre files : les doublons probables (aperçu côte à côte), les pièces
 * incomplètes, les attestations dont le contrat manque, et la corbeille.
 *
 * Les doublons se tranchent PIÈCE SOUS LES YEUX : deux marchés bâtis sur le
 * même formulaire se ressemblent à 90 % sans être la même chose. L'écran dit
 * donc ce qui rapproche les deux pièces, et ce qui les sépare.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, Check, Copy, FileWarning, Layers, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { depuis } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';
import { Visionneuse } from '../ui/Visionneuse.jsx';

const FILES = [
  { cle: 'doublons', libelle: 'Doublons probables', compteur: 'doublons' },
  { cle: 'sans_marche', libelle: 'Sans marché', compteur: 'sansMarche' },
  { cle: 'sans_type', libelle: 'Sans type', compteur: 'sansType' },
  { cle: 'orphelines', libelle: 'Contrat manquant', compteur: 'orphelines' },
  { cle: 'corbeille', libelle: 'Corbeille', compteur: 'corbeille' },
];

export function PageAVerifier() {
  // La file choisie vit dans l'adresse : on peut arriver droit sur la
  // corbeille depuis le menu, et le lien se partage.
  const [parametres, setParametres] = useSearchParams();
  const file = FILES.some((f) => f.cle === parametres.get('file')) ? parametres.get('file') : 'doublons';
  const setFile = (cle) => setParametres(cle === 'doublons' ? {} : { file: cle });

  const etat = useQuery({ queryKey: ['a-verifier', file], queryFn: () => api(`/api/a-verifier?file=${file}`) });
  const compteurs = etat.data?.compteurs ?? {};

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="À vérifier"
        description="Ce que la machine ne peut pas trancher seule : les pièces qui se ressemblent, celles qu’il reste à rattacher, et la corbeille."
      />

      <nav aria-label="Files à vérifier" className="-mx-1 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-trait px-1">
        {FILES.map((f) => (
          <button
            key={f.cle}
            type="button"
            onClick={() => setFile(f.cle)}
            aria-current={file === f.cle ? 'page' : undefined}
            className={cx(
              '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              file === f.cle ? 'border-cyan text-cyan-texte' : 'border-transparent text-encre-2 hover:text-encre',
            )}
          >
            {f.libelle}
            <span className="ml-1.5 text-encre-3">{compteurs[f.compteur] ?? 0}</span>
          </button>
        ))}
      </nav>

      {file === 'doublons' ? <Doublons /> : file === 'corbeille' ? <Corbeille /> : <Liste requete={etat} file={file} />}
    </div>
  );
}

// ── Doublons ─────────────────────────────────────────────────────
function Doublons() {
  const client = useQueryClient();
  const { notifier } = useToasts();
  const [ouverte, setOuverte] = useState(null);

  const paires = useQuery({ queryKey: ['doublons'], queryFn: () => api('/api/doublons') });

  const trancher = useMutation({
    mutationFn: ({ id, decision, garderId }) => api(`/api/doublons/${id}/decision`, { methode: 'POST', corps: { decision, garderId } }),
    onSuccess: (_r, { decision }) => {
      client.invalidateQueries({ queryKey: ['doublons'] });
      client.invalidateQueries({ queryKey: ['a-verifier'] });
      client.invalidateQueries({ queryKey: ['documents'] });
      setOuverte(null);
      notifier({
        titre: decision === 'supprime' ? 'Pièce mise en corbeille' : 'Les deux pièces sont conservées',
        message: decision === 'supprime' ? 'Ses étiquettes et son marché ont été reportés sur celle qui reste.' : undefined,
        ton: 'ok',
      });
    },
    onError: (e) => notifier({ titre: 'Décision refusée', message: e.message, ton: 'alerte' }),
  });

  if (paires.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }
  if (paires.isError) return <Alerte ton="alerte">{paires.error.message}</Alerte>;
  if (paires.data.length === 0) {
    return (
      <Carte>
        <EtatVide titre="Aucune paire à arbitrer">
          Rien ne se ressemble assez pour être un doublon probable. Relancez la détection après un versement.
        </EtatVide>
      </Carte>
    );
  }

  return (
    <ul className="grid gap-4">
      {paires.data.map((p) => (
        <li key={p.id}>
          <Carte className="p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Copy className="size-4 text-encre-3" aria-hidden />
              <Badge ton={p.score >= 90 ? 'alerte' : 'attente'}>{p.score} % de vocabulaire commun</Badge>
              {p.raisons.map((r, i) => (
                <span key={i} className="text-[12.5px] text-encre-2">
                  · {r}
                </span>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {[p.a, p.b].map((d, index) => (
                <div key={d.id} className="rounded-xl border border-trait p-3">
                  <Link to={`/documents/${d.id}`} className="font-medium text-cyan-texte hover:underline">
                    {d.titre}
                  </Link>
                  <p className="mt-1 text-[12.5px] text-encre-3">
                    {d.type ?? 'sans type'} · {d.pages ?? '?'} page(s)
                    {d.marche ? ` · ${d.marche.reference}` : ' · sans marché'}
                    {d.lotScan ? ` · passage ${d.lotScan.slice(-6)}${d.pageScan ? `, page ${d.pageScan}` : ''}` : ''}
                  </p>
                  {d.etiquettes.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-1">
                      {d.etiquettes.map((e) => (
                        <Badge key={e}>{e}</Badge>
                      ))}
                    </p>
                  )}
                  <div className="mt-3">
                    <Bouton
                      variante="secondaire"
                      taille="petit"
                      icone={Trash2}
                      onClick={() => trancher.mutate({ id: p.id, decision: 'supprime', garderId: index === 0 ? p.b.id : p.a.id })}
                    >
                      Écarter celle-ci
                    </Bouton>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Bouton variante="secondaire" taille="petit" onClick={() => setOuverte(ouverte === p.id ? null : p.id)}>
                {ouverte === p.id ? 'Masquer les aperçus' : 'Comparer à l’écran'}
              </Bouton>
              <Bouton taille="petit" icone={Check} onClick={() => trancher.mutate({ id: p.id, decision: 'gardes' })}>
                Garder les deux
              </Bouton>
            </div>

            {ouverte === p.id && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {[p.a, p.b].map((d) => (
                  <div key={d.id} className="h-[60vh] overflow-hidden rounded-xl border border-trait">
                    <Visionneuse url={`/api/documents/${d.id}/fichier`} titre={d.titre} />
                  </div>
                ))}
              </div>
            )}
          </Carte>
        </li>
      ))}
    </ul>
  );
}

// ── Files simples ────────────────────────────────────────────────
function Liste({ requete, file }) {
  if (requete.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={6} />
      </Carte>
    );
  }
  if (requete.isError) return <Alerte ton="alerte">{requete.error.message}</Alerte>;

  const documents = requete.data.documents;
  if (documents.length === 0) {
    return (
      <Carte>
        <EtatVide titre="Cette file est vide">Rien ne réclame votre attention ici.</EtatVide>
      </Carte>
    );
  }

  return (
    <>
      {file === 'orphelines' && (
        <Alerte ton="attente" className="mb-4" titre="Le contrat manque au fonds">
          Ces pièces citent un marché qu’aucun contrat ne documente. L’attestation prouve l’affaire ; le contrat, lui, reste à retrouver au siège.
        </Alerte>
      )}
      <Carte>
        <ul className="divide-y divide-trait">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <FileWarning className="size-4 shrink-0 text-encre-3" aria-hidden />
              <Link to={`/documents/${d.id}`} className="min-w-0 flex-1 truncate font-medium text-cyan-texte hover:underline">
                {d.titre}
              </Link>
              {d.type ? <Badge>{d.type}</Badge> : <Badge ton="attente">sans type</Badge>}
              {d.marche ? (
                <Link to={`/marches/${d.marche.id}`} className="chiffres text-[12.5px] text-cyan-texte hover:underline">
                  {d.marche.reference}
                </Link>
              ) : (
                <Badge ton="attente">sans marché</Badge>
              )}
              <span className="text-[12.5px] text-encre-3">{d.client ?? '—'}</span>
            </li>
          ))}
        </ul>
      </Carte>
      <p className="mt-3 text-[12.5px] text-encre-3">
        <Layers className="mr-1 inline size-3.5" aria-hidden />
        Le classement automatique propose des rattachements pour ces pièces :{' '}
        <Link to="/a-classer" className="font-medium text-cyan-texte hover:underline">
          voir les propositions
        </Link>
        .
      </p>
    </>
  );
}

// ── Corbeille ────────────────────────────────────────────────────
function Corbeille() {
  const client = useQueryClient();
  const { notifier } = useToasts();
  const corbeille = useQuery({ queryKey: ['corbeille'], queryFn: () => api('/api/corbeille') });

  const restaurer = useMutation({
    mutationFn: (id) => api(`/api/documents/${id}/restaurer`, { methode: 'POST' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['corbeille'] });
      client.invalidateQueries({ queryKey: ['a-verifier'] });
      client.invalidateQueries({ queryKey: ['documents'] });
      notifier({ titre: 'Document restauré', ton: 'ok' });
    },
  });

  if (corbeille.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }
  if (corbeille.data.documents.length === 0) {
    return (
      <Carte>
        <EtatVide titre="Corbeille vide">Aucune pièce écartée. Rien n’est jamais supprimé directement : tout passe par ici.</EtatVide>
      </Carte>
    );
  }

  return (
    <>
      <Alerte ton="info" className="mb-4">
        Les pièces écartées restent ici <strong>{corbeille.data.joursAvantVidage} jours</strong>, puis sont supprimées automatiquement. Aucune suppression définitive n’est possible à la main.
      </Alerte>
      <Carte>
        <ul className="divide-y divide-trait">
          {corbeille.data.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Trash2 className="size-4 shrink-0 text-encre-3" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{d.titre}</span>
              <span className="text-[12.5px] text-encre-3">écartée {depuis(d.supprimeLe)}</span>
              <Badge ton={d.joursRestants <= 7 ? 'alerte' : 'neutre'}>{d.joursRestants} jours restants</Badge>
              <Bouton variante="secondaire" taille="petit" icone={ArchiveRestore} onClick={() => restaurer.mutate(d.id)}>
                Restaurer
              </Bouton>
            </li>
          ))}
        </ul>
      </Carte>
    </>
  );
}
