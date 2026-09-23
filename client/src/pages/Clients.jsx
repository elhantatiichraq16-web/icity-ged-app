/**
 * Les clients (§11, écran 9) : la liste des maîtres d'ouvrage, et la fiche
 * d'un client avec ses marchés.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, FileText, FolderKanban, Search } from 'lucide-react';
import { api } from '../api.js';
import { dateCourte } from '../format.js';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { BadgePhase } from './Marches.jsx';

const plat = (t) => t.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();

export function PageClients() {
  const [filtre, setFiltre] = useState('');
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api('/api/clients') });

  const visibles = useMemo(
    () => (clients.data ?? []).filter((c) => plat(`${c.nom} ${c.sigle ?? ''}`).includes(plat(filtre.trim()))),
    [clients.data, filtre],
  );

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Clients"
        description="Les maîtres d’ouvrage du fonds. La société elle-même n’y figure pas : elle n’est jamais sa propre cliente."
        actions={<Badge ton="cyan">{clients.data?.length ?? 0} clients</Badge>}
      />

      <Carte className="mb-5 p-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-3" aria-hidden />
          <input
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            placeholder="Filtrer par nom ou sigle…"
            aria-label="Filtrer les clients"
            className="h-10 w-full rounded-[10px] border border-trait bg-surface-2 pr-3 pl-9 text-sm focus:border-cyan focus:outline-none"
          />
        </div>
      </Carte>

      {clients.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={6} />
        </Carte>
      ) : visibles.length === 0 ? (
        <Carte>
          <EtatVide titre="Aucun client trouvé">Modifiez le filtre pour élargir la recherche.</EtatVide>
        </Carte>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((c) => (
            <li key={c.id}>
              <Link to={`/clients/${c.id}`} className="group block h-full">
                <Carte as="div" className="flex h-full items-start gap-4 p-5 transition-[box-shadow,border-color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-trait-fort group-hover:shadow-haute">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-cyan-voile text-cyan-texte">
                    <Building2 className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-encre">{c.nom}</span>
                    {c.sigle && <span className="text-[12.5px] text-encre-3">{c.sigle}</span>}
                    <span className="mt-2 flex flex-wrap gap-3 text-[12.5px] text-encre-2">
                      <span className="inline-flex items-center gap-1">
                        <FolderKanban className="size-3.5 text-encre-3" aria-hidden /> {c.nbMarches} marché{c.nbMarches > 1 ? 's' : ''}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FileText className="size-3.5 text-encre-3" aria-hidden /> {c.nbDocuments} pièce{c.nbDocuments > 1 ? 's' : ''}
                      </span>
                    </span>
                  </span>
                </Carte>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PageFicheClient() {
  const { id } = useParams();
  const client = useQuery({ queryKey: ['client', id], queryFn: () => api(`/api/clients/${id}`) });

  if (client.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }
  if (client.isError) return <Alerte ton="alerte">{client.error.message}</Alerte>;

  const c = client.data;

  return (
    <div className="animate-apparition">
      <Link to="/clients" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-cyan-texte hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Tous les clients
      </Link>

      <EnTetePage
        surtitre={c.sigle ?? undefined}
        titre={c.nom}
        description={c.synonymes.length ? `Aussi écrit : ${c.synonymes.join(', ')}` : undefined}
        actions={c.interne ? <Badge ton="bordeaux">Société interne</Badge> : <Badge ton="cyan">{c.marches.length} marchés</Badge>}
      />

      <Carte>
        <h2 className="border-b border-trait px-5 py-3.5 font-semibold">Marchés</h2>
        {c.marches.length === 0 ? (
          <EtatVide titre="Aucun marché">Ce client ne porte que des attestations, ou ses marchés ne sont pas encore versés.</EtatVide>
        ) : (
          <ul className="divide-y divide-trait">
            {c.marches.map((m) => (
              <li key={m.id}>
                <Link to={`/marches/${m.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-surface-2">
                  <span className="chiffres min-w-40 font-medium text-cyan-texte">{m.reference}</span>
                  {m.lot && <Badge>lot {m.lot}</Badge>}
                  <span className="min-w-0 flex-1 truncate text-encre-2">{m.objet ?? m.objetTechnique ?? '—'}</span>
                  <BadgePhase phase={m.phase} />
                  <span className={cx('chiffres text-[13px] text-encre-3', m.etatEcheance === 'depassee' && 'font-semibold text-alerte')}>
                    {m.echeance ? dateCourte(m.echeance) : '—'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte className="mt-5">
        <h2 className="border-b border-trait px-5 py-3.5 font-semibold">Échanges</h2>
        <EtatVide illustration="chantier" titre="Les mails avec ce client">
          La chronologie des messages reçus et envoyés, par conversation, arrive en phase 8.
        </EtatVide>
      </Carte>
    </div>
  );
}
