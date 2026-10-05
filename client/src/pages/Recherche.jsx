/**
 * La recherche plein texte (§11, écran 5).
 *
 * La frappe est temporisée de 350 ms : on ne lance pas une requête par
 * caractère. Les mots trouvés sont surlignés dans les extraits — et ces
 * extraits restent du TEXTE : les positions à surligner viennent du serveur,
 * on n'injecte jamais de HTML issu de l'OCR (§13).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import { FileText, FolderKanban, Search } from 'lucide-react';
import { api } from '../api.js';
import { dateCourte } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { BadgePhase } from './Marches.jsx';

/** Rend un extrait avec ses passages surlignés, sans jamais interpréter de HTML. */
function Extrait({ extrait }) {
  const morceaux = [];
  let curseur = 0;
  for (const marque of extrait.marques) {
    if (marque.debut > curseur) morceaux.push({ texte: extrait.texte.slice(curseur, marque.debut) });
    morceaux.push({ texte: extrait.texte.slice(marque.debut, marque.fin), surligne: true });
    curseur = marque.fin;
  }
  morceaux.push({ texte: extrait.texte.slice(curseur) });

  return (
    <p className="mt-1.5 text-[13px] leading-relaxed text-encre-2">
      {morceaux.map((m, i) =>
        m.surligne ? (
          <mark key={i} className="rounded bg-[color-mix(in_oklab,var(--cyan),transparent_75%)] px-0.5 font-semibold text-encre">
            {m.texte}
          </mark>
        ) : (
          <span key={i}>{m.texte}</span>
        ),
      )}
    </p>
  );
}

export function PageRecherche() {
  const [parametres, setParametres] = useSearchParams();
  const q = parametres.get('q') ?? '';
  const typeId = parametres.get('typeId') ?? '';
  const clientId = parametres.get('clientId') ?? '';
  const annee = parametres.get('annee') ?? '';
  const page = Number(parametres.get('page') ?? 1);

  const [saisie, setSaisie] = useState(q);

  // Frappe temporisée : 350 ms sans nouvelle touche avant d'interroger.
  useEffect(() => {
    const minuterie = setTimeout(() => {
      if (saisie === q) return;
      const suivant = new URLSearchParams(parametres);
      if (saisie) suivant.set('q', saisie);
      else suivant.delete('q');
      suivant.delete('page');
      setParametres(suivant, { replace: true });
    }, 350);
    return () => clearTimeout(minuterie);
  }, [saisie, q, parametres, setParametres]);

  const requete = useMemo(() => {
    const p = new URLSearchParams({ q, page: String(page) });
    if (typeId) p.set('typeId', typeId);
    if (clientId) p.set('clientId', clientId);
    if (annee) p.set('annee', annee);
    return p.toString();
  }, [q, page, typeId, clientId, annee]);

  const resultats = useQuery({
    queryKey: ['recherche', requete],
    queryFn: () => api(`/api/recherche?${requete}`),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });

  /**
   * Change un filtre et revient à la première page. Cliquer deux fois sur le
   * même filtre le retire : c'est ce qui permet de le désélectionner.
   */
  function filtrer(cle, valeur) {
    const suivant = new URLSearchParams(parametres);
    if (valeur && suivant.get(cle) !== String(valeur)) suivant.set(cle, String(valeur));
    else suivant.delete(cle);
    suivant.delete('page');
    setParametres(suivant);
  }

  /**
   * Changer de page garde les filtres — et la page.
   *
   * Passer par `filtrer` ne marcherait pas : il efface « page » à chaque
   * appel, et rebascule un même numéro cliqué deux fois.
   */
  function allerPage(numero) {
    const suivant = new URLSearchParams(parametres);
    suivant.set('page', String(numero));
    setParametres(suivant);
  }

  const d = resultats.data;

  return (
    <div className="animate-apparition">
      <EnTetePage titre="Recherche" description="Dans les titres et dans le texte de chaque page. Les guillemets cherchent une expression exacte." />

      <Carte className="mb-5 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-encre-3" aria-hidden />
          <input
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            autoFocus
            placeholder="caution, mainlevée, « 23C/2017/TGR », vidéosurveillance…"
            aria-label="Rechercher dans le fonds"
            className="h-12 w-full rounded-xl border border-trait bg-surface-2 pr-4 pl-11 text-[15px] focus:border-cyan focus:bg-surface focus:outline-none"
          />
        </div>
        {(typeId || clientId || annee) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-encre-3">Filtres :</span>
            {typeId && <BoutonFiltre libelle={d?.facettes.types.find((t) => String(t.id) === typeId)?.nom ?? 'type'} onRetirer={() => filtrer('typeId', null)} />}
            {clientId && <BoutonFiltre libelle={d?.facettes.clients.find((c) => String(c.id) === clientId)?.nom ?? 'client'} onRetirer={() => filtrer('clientId', null)} />}
            {annee && <BoutonFiltre libelle={annee} onRetirer={() => filtrer('annee', null)} />}
          </div>
        )}
      </Carte>

      {!q.trim() ? (
        <Carte>
          <EtatVide titre="Que cherchez-vous ?">
            Tapez un mot : il est cherché dans le texte de toutes les pages, pas seulement dans les titres.
          </EtatVide>
        </Carte>
      ) : resultats.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={5} />
        </Carte>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="grid content-start gap-3">
            <p className="text-[13px] text-encre-2" role="status">
              <strong>{d.total}</strong> document{d.total > 1 ? 's' : ''} trouvé{d.total > 1 ? 's' : ''}
              {d.marches.length > 0 && ` · ${d.marches.length} marché(s)`}
            </p>

            {d.marches.map((m) => (
              <Link key={`m${m.id}`} to={`/marches/${m.id}`}>
                <Carte as="div" className="flex items-center gap-3 p-4 hover:border-trait-fort">
                  <FolderKanban className="size-5 shrink-0 text-cyan-texte" aria-hidden />
                  <span className="chiffres font-semibold text-cyan-texte">{m.reference}</span>
                  <span className="min-w-0 flex-1 truncate text-encre-2">{m.objet ?? m.client ?? ''}</span>
                  {m.archive && <Badge>archivé</Badge>}
                  <BadgePhase phase={m.phase} />
                </Carte>
              </Link>
            ))}

            {d.resultats.length === 0 && d.marches.length === 0 ? (
              <Carte>
                <EtatVide titre="Aucun résultat">
                  Essayez un mot plus court, ou retirez un filtre. Les mots de moins de trois lettres ne sont pas indexés.
                </EtatVide>
              </Carte>
            ) : (
              d.resultats.map((r) => (
                <Carte key={r.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/documents/${r.id}`} className="flex items-center gap-2 font-semibold text-cyan-texte hover:underline">
                      <FileText className="size-4 shrink-0 text-encre-3" aria-hidden />
                      {r.titre}
                    </Link>
                    {r.type && <Badge>{r.type.nom}</Badge>}
                    {r.marche && (
                      <Link to={`/marches/${r.marche.id}`} className="chiffres text-[12.5px] text-encre-2 hover:underline">
                        {r.marche.reference}
                      </Link>
                    )}
                    {r.archive && <Badge>archivée</Badge>}
                    {r.client && <span className="text-[12.5px] text-encre-3">{r.client.nom}</span>}
                    <span className="ml-auto text-[12px] text-encre-3">
                      {r.pages ?? '?'} page{r.pages > 1 ? 's' : ''} · {dateCourte(r.dateDocument)}
                    </span>
                  </div>
                  {r.extraits.map((e, i) => (
                    <Extrait key={i} extrait={e} />
                  ))}
                </Carte>
              ))
            )}

            {d.total > d.parPage && (
              <nav className="flex items-center justify-center gap-2 pt-2" aria-label="Pages de résultats">
                <Bouton variante="secondaire" taille="petit" disabled={page <= 1} onClick={() => allerPage(page - 1)}>
                  Précédent
                </Bouton>
                <span className="text-[13px] text-encre-2">
                  Page {d.page} sur {Math.ceil(d.total / d.parPage)}
                </span>
                <Bouton variante="secondaire" taille="petit" disabled={page >= Math.ceil(d.total / d.parPage)} onClick={() => allerPage(page + 1)}>
                  Suivant
                </Bouton>
              </nav>
            )}
          </div>

          {/* ── Facettes ── */}
          <div className="grid content-start gap-4">
            <Facette titre="Type de pièce" entrees={d.facettes.types} actif={typeId} surClic={(id) => filtrer('typeId', id)} />
            <Facette titre="Client" entrees={d.facettes.clients} actif={clientId} surClic={(id) => filtrer('clientId', id)} />
            <Facette
              titre="Année"
              entrees={d.facettes.annees.map((a) => ({ id: a.annee, nom: String(a.annee), n: a.n }))}
              actif={annee}
              surClic={(id) => filtrer('annee', id)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BoutonFiltre({ libelle, onRetirer }) {
  return (
    <button type="button" onClick={onRetirer} className="inline-flex items-center gap-1 rounded-full bg-cyan-voile px-2.5 py-1 font-medium text-cyan-texte hover:underline">
      {libelle} <span aria-hidden>×</span>
      <span className="sr-only">Retirer ce filtre</span>
    </button>
  );
}

function Facette({ titre, entrees, actif, surClic }) {
  if (!entrees?.length) return null;
  return (
    <Carte className="p-4">
      <h2 className="mb-2 text-[12px] font-semibold tracking-wide text-encre-3 uppercase">{titre}</h2>
      <ul className="grid gap-0.5">
        {entrees.slice(0, 8).map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => surClic(e.id)}
              aria-pressed={String(actif) === String(e.id)}
              className={cx(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
                String(actif) === String(e.id) ? 'bg-cyan-voile font-semibold text-cyan-texte' : 'text-encre-2',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{e.nom}</span>
              <span className="chiffres text-[12px] text-encre-3">{e.n}</span>
            </button>
          </li>
        ))}
      </ul>
    </Carte>
  );
}
