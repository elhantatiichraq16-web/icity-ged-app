/**
 * Les archives : les marchés et les pièces rangés en fin d'exercice.
 *
 * Ce qui est archivé sort de la vue courante — liste des marchés, documents,
 * files du tri, tableau de bord, classement automatique — mais rien n'est
 * perdu : tout se retrouve ici, s'ouvre et se modifie comme avant, et la
 * recherche le trouve toujours.
 *
 * Deux onglets : les marchés, et les pièces (archivées seules, ou avec leur
 * marché).
 *
 * Ce fichier porte aussi le geste lui-même (`useArchivage`), partagé avec la
 * liste des marchés, la fiche d'un marché et la liste des documents.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { api } from '../api.js';
import { dateCourte } from '../format.js';
import { cx } from '../ui/cx.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { Confirmation } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';
import { useSession } from '../auth/session.jsx';
import { BadgeEtatMarche, CLE_MARCHES } from './Marches.jsx';

// Écrite en entier, pas déduite de CLE_MARCHES : Marches.jsx importe ce
// fichier à son tour, et la constante n'y serait pas encore définie.
export const CLE_ARCHIVES = ['marches', 'archives'];

/**
 * Archiver ou désarchiver des marchés (`quoi: 'marches'`, par défaut) ou des
 * pièces (`quoi: 'documents'`).
 *
 * Tout ce qui les compte est relu ensuite : les listes, les archives, le
 * tableau de bord, les files du tri, les notifications.
 */
export function useArchivage() {
  const file = useQueryClient();
  const { notifier } = useToasts();
  return useMutation({
    mutationFn: ({ ids, archiver, quoi = 'marches' }) => api(`/api/${quoi}/${archiver ? 'archiver' : 'desarchiver'}`, { methode: 'POST', corps: { ids } }),
    onSuccess: ({ modifies }, { archiver, quoi = 'marches' }) => {
      // `['marches']` couvre aussi les archives (`['marches', 'archives']`).
      for (const cle of [CLE_MARCHES, ['marche'], ['document'], ['documents'], ['tableau-bord'], ['clients'], ['achats-marches'], ['a-classer'], ['a-verifier'], ['notifications']]) {
        file.invalidateQueries({ queryKey: cle });
      }
      const n = modifies > 1 ? 's' : '';
      const [nom, e] = quoi === 'documents' ? ['pièce', 'e'] : ['marché', ''];
      notifier(
        archiver
          ? { titre: `${modifies} ${nom}${n} archivé${e}${n}`, message: 'Retrouvez-les dans « Archives ».', ton: 'ok' }
          : { titre: `${modifies} ${nom}${n} désarchivé${e}${n}`, message: 'Retour dans la vue courante.', ton: 'ok' },
      );
    },
    onError: (erreur) => notifier({ titre: 'Opération impossible', message: erreur.message, ton: 'alerte' }),
  });
}

/** Une case à cocher de tableau : un clic ne doit pas ouvrir la ligne. */
export function CaseLigne({ libelle, ...reste }) {
  return (
    <td className="w-10 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" aria-label={libelle} className="size-4 cursor-pointer rounded accent-[var(--cyan)]" {...reste} />
    </td>
  );
}

export function PageArchives() {
  // L'onglet dans l'URL : un lien peut mener droit aux pièces archivées.
  const [parametres, setParametres] = useSearchParams();
  const onglet = parametres.get('onglet') === 'documents' ? 'documents' : 'marches';
  const marches = useQuery({ queryKey: CLE_ARCHIVES, queryFn: () => api('/api/marches?archives=seuls') });
  const [page, setPage] = useState(1);
  const pieces = useQuery({ queryKey: ['documents', 'archives', page], queryFn: () => api(`/api/documents?archives=seuls&page=${page}`) });

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Archives"
        description="Les marchés et les pièces rangés : hors de la vue courante, toujours consultables et modifiables."
      />

      <div role="tablist" aria-label="Marchés ou documents archivés" className="mb-5 flex gap-1 border-b border-trait">
        {[
          ['marches', 'Marchés', marches.data?.length],
          ['documents', 'Documents', pieces.data?.total],
        ].map(([cle, libelle, n]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            aria-selected={onglet === cle}
            onClick={() => setParametres(cle === 'documents' ? { onglet: 'documents' } : {}, { replace: true })}
            className={cx(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors',
              onglet === cle ? 'border-cyan text-encre' : 'border-transparent text-encre-3 hover:text-encre',
            )}
          >
            {libelle}
            {n !== undefined && (
              <span className={cx('chiffres rounded-full px-2 text-[11.5px]', onglet === cle ? 'bg-cyan-voile text-cyan-texte' : 'bg-surface-2')}>{n}</span>
            )}
          </button>
        ))}
      </div>

      {onglet === 'documents' ? <OngletDocuments pieces={pieces} page={page} setPage={setPage} /> : <OngletMarches archives={marches} />}
    </div>
  );
}

/** Les marchés archivés : recherche, et désarchivage par lot. */
function OngletMarches({ archives }) {
  const [recherche, setRecherche] = useState('');
  const [coches, setCoches] = useState(() => new Set());
  const [confirmer, setConfirmer] = useState(false);

  const aller = useNavigate();
  const { droits } = useSession();
  const peutArchiver = droits.can('archiver', 'Marche');
  const archivage = useArchivage();

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const liste = archives.data ?? [];
    const filtree = q ? liste.filter((m) => `${m.reference} ${m.objet ?? ''} ${m.client?.nom ?? ''} ${m.ville ?? ''}`.toLowerCase().includes(q)) : liste;
    return [...filtree].sort((a, b) => a.reference.localeCompare(b.reference, 'fr', { numeric: true }));
  }, [archives.data, recherche]);

  // Seules les lignes encore affichées comptent : un filtre ne doit pas
  // laisser désarchiver ce qu'on ne voit plus.
  const choisis = visibles.filter((m) => coches.has(m.id));
  const toutCoche = visibles.length > 0 && choisis.length === visibles.length;

  function basculer(id) {
    setCoches((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });
  }

  function desarchiver() {
    archivage.mutate(
      { ids: choisis.map((m) => m.id), archiver: false },
      {
        onSuccess: () => {
          setCoches(new Set());
          setConfirmer(false);
        },
      },
    );
  }

  const total = archives.data?.length ?? 0;

  return (
    <>
      {archives.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={5} />
        </Carte>
      ) : archives.isError ? (
        <Alerte ton="alerte">{archives.error.message}</Alerte>
      ) : total === 0 ? (
        <Carte>
          <EtatVide titre="Aucun marché archivé">
            Depuis la liste des marchés, cochez ceux qui sont terminés et archivez-les : ils viendront ici, sans rien perdre.
          </EtatVide>
        </Carte>
      ) : (
        <>
          <Carte className="mb-5 flex flex-wrap items-center gap-3 p-4">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-3" aria-hidden />
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Référence, objet, client, ville…"
                aria-label="Rechercher dans les archives"
                className="h-10 w-full rounded-[10px] border border-trait bg-surface-2 pr-3 pl-9 text-sm focus:border-cyan focus:outline-none"
              />
            </div>
            {peutArchiver && (
              <Bouton variante="secondaire" taille="petit" icone={ArchiveRestore} disabled={!choisis.length} onClick={() => setConfirmer(true)}>
                Désarchiver{choisis.length ? ` (${choisis.length})` : ''}
              </Bouton>
            )}
          </Carte>

          <Carte>
            {visibles.length === 0 ? (
              <EtatVide titre="Aucun marché ne correspond">Modifiez la recherche pour élargir.</EtatVide>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <caption className="sr-only">Marchés archivés</caption>
                  <thead>
                    <tr className="border-b border-trait text-left text-[12px] tracking-wide text-encre-3 uppercase">
                      {peutArchiver && (
                        <th scope="col" className="w-10 px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label="Tout cocher"
                            checked={toutCoche}
                            onChange={() => setCoches(toutCoche ? new Set() : new Set(visibles.map((m) => m.id)))}
                            className="size-4 cursor-pointer rounded accent-[var(--cyan)]"
                          />
                        </th>
                      )}
                      <th scope="col" className="px-3 py-3 font-semibold">Référence</th>
                      <th scope="col" className="px-3 py-3 font-semibold">Client</th>
                      <th scope="col" className="px-3 py-3 font-semibold">Objet</th>
                      <th scope="col" className="px-3 py-3 font-semibold">État</th>
                      <th scope="col" className="px-3 py-3 font-semibold">Archivé</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">Pièces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((m) => (
                      <tr key={m.id} onClick={() => aller(`/marches/${m.id}`)} className="cursor-pointer border-b border-trait last:border-0 hover:bg-surface-2">
                        {peutArchiver && <CaseLigne libelle={`Cocher ${m.reference}`} checked={coches.has(m.id)} onChange={() => basculer(m.id)} />}
                        <td className="px-3 py-2.5">
                          <Link to={`/marches/${m.id}`} onClick={(e) => e.stopPropagation()} className="chiffres font-medium text-cyan-texte hover:underline">
                            {m.reference}
                          </Link>
                          {m.lot && <span className="ml-1.5 text-[11.5px] text-encre-3">lot {m.lot}</span>}
                        </td>
                        <td className="max-w-44 truncate px-3 py-2.5 text-encre-2" title={m.client?.nom}>
                          {m.client?.nom ?? '—'}
                        </td>
                        <td className="max-w-64 truncate px-3 py-2.5 text-encre-2" title={m.objet ?? m.objetTechnique ?? ''}>
                          {m.objet ?? m.objetTechnique ?? <span className="text-encre-3">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <BadgeEtatMarche marche={m} />
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-encre-2">
                          <span className="chiffres">{dateCourte(m.archive.le)}</span>
                          {m.archive.par && <span className="block text-[12px] text-encre-3">par {m.archive.par}</span>}
                        </td>
                        <td className="chiffres px-3 py-2.5 text-right text-encre-2">{m.nbDocuments}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Carte>
        </>
      )}

      <Confirmation
        ouverte={confirmer}
        surChangement={setConfirmer}
        titre={`Désarchiver ${choisis.length} marché${choisis.length > 1 ? 's' : ''} ?`}
        description="Ils reviennent dans la liste des marchés et le tableau de bord, et le classement automatique pourra de nouveau y ranger des pièces."
        libelle="Désarchiver"
        ton="principal"
        chargement={archivage.isPending}
        surConfirmer={desarchiver}
      />
    </>
  );
}

/**
 * Les pièces archivées, page par page.
 *
 * Une pièce archivée avec son marché ne se coche pas : elle revient quand on
 * désarchive le marché, pas seule.
 */
function OngletDocuments({ pieces, page, setPage }) {
  const [coches, setCoches] = useState(() => new Set());
  const [confirmer, setConfirmer] = useState(false);
  const { droits } = useSession();
  const peutArchiver = droits.can('archiver', 'Marche');
  const archivage = useArchivage();

  const d = pieces.data;
  const seules = (d?.documents ?? []).filter((x) => !x.archive?.parSonMarche);
  const choisis = seules.filter((x) => coches.has(x.id));
  const toutCoche = seules.length > 0 && choisis.length === seules.length;

  function basculer(id) {
    setCoches((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });
  }

  /** Changer de page décoche tout : on ne désarchive que ce qu'on voit. */
  function allerPage(numero) {
    setCoches(new Set());
    setPage(numero);
  }

  if (pieces.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={6} />
      </Carte>
    );
  }
  if (pieces.isError) return <Alerte ton="alerte">{pieces.error.message}</Alerte>;
  if (d.total === 0) {
    return (
      <Carte>
        <EtatVide titre="Aucune pièce archivée">
          Depuis la liste des documents, cochez des pièces et archivez-les. Les pièces d’un marché archivé arrivent ici avec lui.
        </EtatVide>
      </Carte>
    );
  }

  return (
    <>
      {peutArchiver && (
        <Carte className="mb-5 flex flex-wrap items-center gap-3 p-4">
          <p className="flex-1 text-[13.5px] text-encre-2">Cochez des pièces archivées seules pour les remettre dans la liste des documents.</p>
          <Bouton variante="secondaire" taille="petit" icone={ArchiveRestore} disabled={!choisis.length} onClick={() => setConfirmer(true)}>
            Désarchiver{choisis.length ? ` (${choisis.length})` : ''}
          </Bouton>
        </Carte>
      )}

      <Carte>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Pièces archivées</caption>
            <thead>
              <tr className="border-b border-trait text-left text-[12px] tracking-wide text-encre-3 uppercase">
                {peutArchiver && (
                  <th scope="col" className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Tout cocher sur cette page"
                      checked={toutCoche}
                      disabled={!seules.length}
                      onChange={() => setCoches(toutCoche ? new Set() : new Set(seules.map((x) => x.id)))}
                      className="size-4 cursor-pointer rounded accent-[var(--cyan)]"
                    />
                  </th>
                )}
                <th scope="col" className="px-3 py-3 font-semibold">Titre</th>
                <th scope="col" className="px-3 py-3 font-semibold">Type</th>
                <th scope="col" className="px-3 py-3 font-semibold">Marché</th>
                <th scope="col" className="px-3 py-3 font-semibold">Archivée</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Pages</th>
              </tr>
            </thead>
            <tbody>
              {d.documents.map((x) => (
                <tr key={x.id} className="border-b border-trait last:border-0 hover:bg-surface-2">
                  {peutArchiver &&
                    (x.archive?.parSonMarche ? (
                      <td className="w-10 px-3 py-2.5" />
                    ) : (
                      <CaseLigne libelle={`Cocher ${x.titre}`} checked={coches.has(x.id)} onChange={() => basculer(x.id)} />
                    ))}
                  <td className="max-w-80 truncate px-3 py-2.5" title={x.titre}>
                    <Link to={`/documents/${x.id}`} className="font-medium text-cyan-texte hover:underline">
                      {x.titre}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-encre-2">{x.type?.nom ?? <span className="text-encre-3">—</span>}</td>
                  <td className="chiffres px-3 py-2.5 text-[13px]">
                    {x.marche ? (
                      <Link to={`/marches/${x.marche.id}`} className="text-cyan-texte hover:underline">
                        {x.marche.reference}
                      </Link>
                    ) : (
                      <span className="text-encre-3">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-encre-2">
                    {x.archive?.parSonMarche ? <span className="text-encre-3">avec son marché</span> : <span className="chiffres">{dateCourte(x.archive?.le)}</span>}
                  </td>
                  <td className="chiffres px-3 py-2.5 text-right text-encre-2">{x.pages ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Carte>

      {d.pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-[13px] text-encre-2">
          <Bouton variante="secondaire" taille="petit" icone={ChevronLeft} disabled={page <= 1} onClick={() => allerPage(page - 1)}>
            Précédente
          </Bouton>
          <span className="chiffres">
            Page {page} sur {d.pages}
          </span>
          <Bouton variante="secondaire" taille="petit" icone={ChevronRight} disabled={page >= d.pages} onClick={() => allerPage(page + 1)}>
            Suivante
          </Bouton>
        </div>
      )}

      <Confirmation
        ouverte={confirmer}
        surChangement={setConfirmer}
        titre={`Désarchiver ${choisis.length} pièce${choisis.length > 1 ? 's' : ''} ?`}
        description="Elles reviennent dans la liste des documents, et celles qui ne sont pas rangées retournent « à classer »."
        libelle="Désarchiver"
        ton="principal"
        chargement={archivage.isPending}
        surConfirmer={() =>
          archivage.mutate(
            { ids: choisis.map((x) => x.id), archiver: false, quoi: 'documents' },
            {
              onSuccess: () => {
                setCoches(new Set());
                setConfirmer(false);
              },
            },
          )
        }
      />
    </>
  );
}
