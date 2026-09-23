/**
 * La boîte mail de l'application (§10, écran 7).
 *
 * Les messages reçus ET envoyés, groupés par conversation comme dans une
 * boîte mail : une réponse se range sous la question d'origine, et l'échange
 * se lit d'un seul tenant. Le regroupement se fait sur le fil — l'objet
 * normalisé, sans RE/TR/FW ni accents.
 *
 * On peut aussi écrire d'ici : le message part par la boîte surveillée et
 * s'archive aussitôt, avec ses pièces prises dans le fonds.
 *
 * Le corps HTML s'affiche dans une iframe `sandbox` : il vient de l'extérieur
 * et ne doit jamais s'exécuter dans la page (§13).
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Mail, Paperclip, PenSquare, RefreshCw, Reply, ScanLine, Search } from 'lucide-react';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateHeure } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Selection } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';
import { EcrireMail } from './EcrireMail.jsx';

const DIRECTIONS = {
  recu: { libelle: 'Reçu', icone: ArrowDownLeft, ton: 'ok' },
  envoye: { libelle: 'Envoyé', icone: ArrowUpRight, ton: 'cyan' },
  scanner: { libelle: 'Scanner', icone: ScanLine, ton: 'attente' },
};

const FILTRES = [
  { cle: '', libelle: 'Tous' },
  { cle: 'recu', libelle: 'Reçus' },
  { cle: 'envoye', libelle: 'Envoyés' },
  { cle: 'scanner', libelle: 'Du scanner' },
];

export function PageCourriel() {
  const [parametres, setParametres] = useSearchParams();
  const direction = parametres.get('direction') ?? '';
  const page = Number(parametres.get('page') ?? 1);
  const statut = parametres.get('statut') ?? '';
  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState(null);
  const [filOuvert, setFilOuvert] = useState(null);
  const [redaction, setRedaction] = useState(null);
  const { droits } = useSession();
  const client = useQueryClient();
  const { notifier } = useToasts();

  const requete = new URLSearchParams();
  if (direction) requete.set('direction', direction);
  if (statut) requete.set('statut', statut);
  if (recherche.trim()) requete.set('q', recherche.trim());
  requete.set('page', String(page));

  // La liste est groupée par fil : c'est ce qui fait une boîte mail plutôt
  // qu'un journal de messages.
  const mails = useQuery({ queryKey: ['conversations', requete.toString()], queryFn: () => api(`/api/conversations?${requete}`) });
  const comptes = useQuery({
    queryKey: ['comptes-mail'],
    queryFn: () => api('/api/comptes-mail'),
    enabled: droits.can('gerer', 'CompteMail'),
    retry: false,
  });

  const relever = useMutation({
    mutationFn: (id) => api(`/api/comptes-mail/${id}/relever`, { methode: 'POST' }),
    onSuccess: (r) => {
      client.invalidateQueries({ queryKey: ['conversations'] });
      client.invalidateQueries({ queryKey: ['arrivees'] });
      notifier({ titre: 'Relève terminée', message: r.message, ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Relève impossible', message: e.message, ton: 'alerte' }),
  });

  /** Change un filtre et revient à la première page. */
  function filtrer(cle, valeur) {
    const suivant = new URLSearchParams(parametres);
    if (valeur) suivant.set(cle, valeur);
    else suivant.delete(cle);
    suivant.delete('page');
    setParametres(suivant);
  }

  /** Changer de page garde les filtres — et la page. */
  function allerPage(numero) {
    const suivant = new URLSearchParams(parametres);
    suivant.set('page', String(numero));
    setParametres(suivant);
  }

  const d = mails.data;
  const compte = comptes.data?.[0];

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Courriel"
        description="Les échanges avec vos clients : ce que vous recevez, ce que vous envoyez, et ce qui arrive du copieur."
        actions={
          <div className="flex flex-wrap gap-2">
            {droits.can('envoyer', 'Mail') && (
              <Bouton icone={PenSquare} onClick={() => setRedaction({})}>
                Écrire
              </Bouton>
            )}
            {compte && (
              <Bouton variante="secondaire" icone={RefreshCw} chargement={relever.isPending} libelleChargement="Relève…" onClick={() => relever.mutate(compte.id)}>
                Relever maintenant
              </Bouton>
            )}
          </div>
        }
      />

      {comptes.isSuccess && comptes.data.length === 0 && (
        <Alerte ton="attente" className="mb-5" titre="Aucune boîte surveillée">
          Ajoutez votre compte Gmail dans{' '}
          <Link to="/parametres/courriel" className="font-semibold underline">
            Paramètres → Comptes mail
          </Link>{' '}
          : il faut un mot de passe d’application, et un libellé « iCity-Documents ».
        </Alerte>
      )}

      <Carte className="mb-5 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-3" aria-hidden />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Objet, expéditeur, contenu…"
            aria-label="Rechercher un message"
            className="h-10 w-full rounded-[10px] border border-trait bg-surface-2 pr-3 pl-9 text-sm focus:border-cyan focus:outline-none"
          />
        </div>
        <div className="flex gap-1">
          {FILTRES.map((f) => (
            <button
              key={f.cle || 'tous'}
              type="button"
              onClick={() => filtrer('direction', f.cle)}
              aria-pressed={direction === f.cle}
              className={cx('rounded-lg px-3 py-2 text-[13px] font-medium', direction === f.cle ? 'bg-cyan-voile text-cyan-texte' : 'text-encre-2 hover:bg-surface-2')}
            >
              {f.libelle}
              {d?.compteurs?.[f.cle] != null && <span className="ml-1.5 text-encre-3">{d.compteurs[f.cle]}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => filtrer('statut', statut === 'a_rattacher' ? '' : 'a_rattacher')}
          aria-pressed={statut === 'a_rattacher'}
          className={cx('rounded-lg px-3 py-2 text-[13px] font-medium', statut === 'a_rattacher' ? 'bg-attente-voile text-attente' : 'text-encre-2 hover:bg-surface-2')}
        >
          À rattacher <span className="ml-1 text-encre-3">{d?.aRattacher ?? 0}</span>
        </button>
      </Carte>

      {mails.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={6} />
        </Carte>
      ) : mails.isError ? (
        <Alerte ton="alerte">{mails.error.message}</Alerte>
      ) : d.conversations.length === 0 ? (
        <Carte>
          <EtatVide illustration="chantier" titre="Aucun message">
            Les messages apparaissent après une relève de la boîte surveillée.
          </EtatVide>
        </Carte>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Carte className="overflow-hidden">
            <ul className="divide-y divide-trait">
              {d.conversations.map((c) => (
                <Conversation
                  key={c.fil}
                  conversation={c}
                  deplie={filOuvert === c.fil}
                  surDeplier={() => setFilOuvert(filOuvert === c.fil ? null : c.fil)}
                  ouvert={ouvert}
                  surOuvrir={setOuvert}
                />
              ))}
            </ul>
          </Carte>

          <div>
            {ouvert ? (
              <Message id={ouvert} surRepondre={(mail) => setRedaction({ repondA: mail })} />
            ) : (
              <Carte>
                <EtatVide titre="Choisissez un message">Son contenu et ses pièces jointes s’afficheront ici.</EtatVide>
              </Carte>
            )}
          </div>
        </div>
      )}

      {d && d.pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Bouton variante="secondaire" taille="petit" disabled={page <= 1} onClick={() => allerPage(page - 1)}>
            Précédent
          </Bouton>
          <span className="text-[13px] text-encre-2">
            Page {d.page} sur {d.pages}
          </span>
          <Bouton variante="secondaire" taille="petit" disabled={page >= d.pages} onClick={() => allerPage(page + 1)}>
            Suivant
          </Bouton>
        </div>
      )}

      {redaction && <EcrireMail ouverte surFermer={() => setRedaction(null)} repondA={redaction.repondA ?? null} />}
    </div>
  );
}

/**
 * Une conversation : l'échange replié sur son dernier message.
 *
 * Un seul message ? La ligne s'ouvre directement, sans niveau inutile. Un
 * échange de plusieurs messages se déplie pour les lire dans l'ordre.
 */
function Conversation({ conversation: c, deplie, surDeplier, ouvert, surOuvrir }) {
  const plusieurs = c.messages > 1;
  const dernier = c.mails[c.mails.length - 1];

  return (
    <li>
      <button
        type="button"
        onClick={() => (plusieurs ? surDeplier() : surOuvrir(dernier.id))}
        aria-expanded={plusieurs ? deplie : undefined}
        aria-current={!plusieurs && ouvert === dernier.id ? 'true' : undefined}
        className={cx('w-full px-4 py-3 text-left hover:bg-surface-2', !plusieurs && ouvert === dernier.id && 'bg-cyan-voile')}
      >
        <span className="flex items-center gap-2">
          {plusieurs ? (
            <ChevronDown className={cx('size-4 shrink-0 text-encre-3 transition-transform', !deplie && '-rotate-90')} aria-hidden />
          ) : (
            <DirectionIcone direction={dernier.direction} />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{c.objet}</span>
          {plusieurs && <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[12px] text-encre-2">{c.messages}</span>}
          {c.pieces > 0 && (
            <span className="flex items-center gap-0.5 text-[12px] text-encre-3">
              <Paperclip className="size-3.5" aria-hidden /> {c.pieces}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-encre-3">
          <span className="truncate">{c.apercu || dernier.expediteur}</span>
          <span>· {dateHeure(c.dernierLe)}</span>
          {c.client ? <Badge ton="cyan">{c.client.nom}</Badge> : <Badge ton="attente">à rattacher</Badge>}
          {c.marche && <Badge>{c.marche.reference}</Badge>}
        </span>
      </button>

      {plusieurs && deplie && (
        <ul className="border-t border-trait bg-surface-2/50">
          {c.mails.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => surOuvrir(m.id)}
                aria-current={ouvert === m.id ? 'true' : undefined}
                className={cx('flex w-full items-center gap-2 py-2 pr-4 pl-10 text-left text-[13px] hover:bg-surface-2', ouvert === m.id && 'bg-cyan-voile')}
              >
                <DirectionIcone direction={m.direction} />
                <span className="min-w-0 flex-1 truncate">{m.direction === 'envoye' ? `À ${m.destinataires[0] ?? '—'}` : m.expediteur}</span>
                {m.piecesJointes.length > 0 && <Paperclip className="size-3.5 shrink-0 text-encre-3" aria-hidden />}
                <span className="shrink-0 text-encre-3">{dateHeure(m.date)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** La flèche qui dit d'où vient le message. */
function DirectionIcone({ direction }) {
  const info = DIRECTIONS[direction] ?? DIRECTIONS.recu;
  const Icone = info.icone;
  return (
    <Icone
      className={cx('size-4 shrink-0', direction === 'recu' ? 'text-ok' : direction === 'envoye' ? 'text-cyan' : 'text-attente')}
      aria-label={info.libelle}
    />
  );
}

/** Un message ouvert : entête, corps, pièces jointes, rattachement. */
function Message({ id, surRepondre }) {
  const client = useQueryClient();
  const { notifier } = useToasts();
  const { droits } = useSession();
  const mail = useQuery({ queryKey: ['mail', id], queryFn: () => api(`/api/mails/${id}`) });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api('/api/clients') });
  const marches = useQuery({ queryKey: ['marches'], queryFn: () => api('/api/marches') });

  const rattacher = useMutation({
    mutationFn: (corps) => api(`/api/mails/${id}`, { methode: 'PATCH', corps }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['mail', id] });
      client.invalidateQueries({ queryKey: ['conversations'] });
      notifier({ titre: 'Message rattaché', message: 'Ses pièces jointes suivent le même marché.', ton: 'ok' });
    },
  });

  if (mail.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }

  const m = mail.data;
  const info = DIRECTIONS[m.direction] ?? DIRECTIONS.recu;

  return (
    <Carte className="overflow-hidden">
      <div className="border-b border-trait p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge ton={info.ton}>{info.libelle}</Badge>
          <h2 className="min-w-0 flex-1 text-lg font-semibold">{m.objet}</h2>
          {/* On ne répond pas au copieur : ses messages ne sont qu'un transport. */}
          {droits.can('envoyer', 'Mail') && m.direction !== 'scanner' && (
            <Bouton variante="secondaire" taille="petit" icone={Reply} onClick={() => surRepondre(m)}>
              Répondre
            </Bouton>
          )}
        </div>
        <p className="text-[13px] text-encre-2">
          De <strong>{m.expediteur}</strong>
          {m.destinataires.length > 0 && <> à {m.destinataires.join(', ')}</>} · {dateHeure(m.date)}
        </p>

        {droits.can('rattacher', 'Mail') && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Selection libelle="Client" value={m.client?.id ?? ''} onChange={(e) => rattacher.mutate({ clientId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— à rattacher —</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </Selection>
            <Selection libelle="Marché" value={m.marche?.id ?? ''} onChange={(e) => rattacher.mutate({ marcheId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— aucun —</option>
              {(marches.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.reference}
                </option>
              ))}
            </Selection>
          </div>
        )}
      </div>

      {m.piecesJointes.length > 0 && (
        <div className="border-b border-trait px-5 py-3">
          <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-encre-3 uppercase">Pièces jointes</h3>
          <ul className="flex flex-wrap gap-2">
            {m.piecesJointes.map((p) => (
              <li key={p.id}>
                {p.documentId ? (
                  <Link to={`/documents/${p.documentId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-trait px-2.5 py-1.5 text-[13px] hover:border-trait-fort">
                    <Paperclip className="size-3.5 text-encre-3" aria-hidden /> {p.nom}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-trait px-2.5 py-1.5 text-[13px] text-encre-3">
                    <Paperclip className="size-3.5" aria-hidden /> {p.nom}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.direction === 'scanner' ? (
        <Alerte ton="info" className="m-5">
          Ce message vient du copieur : seules ses pièces jointes sont conservées, comme documents scannés. Le corps n’est qu’un transport.
        </Alerte>
      ) : m.aDuHtml ? (
        // sandbox sans « allow-scripts » : le HTML s'affiche, rien ne s'exécute.
        <iframe title={`Contenu de « ${m.objet} »`} src={`/api/mails/${m.id}/corps`} sandbox="" className="h-[50vh] w-full border-0 bg-surface" />
      ) : (
        <pre className="max-h-[50vh] overflow-auto p-5 text-[13px] leading-relaxed whitespace-pre-wrap">{m.corpsTexte ?? '(message vide)'}</pre>
      )}
    </Carte>
  );
}

/** La page « Arrivées » : ce qui est entré depuis 24 h (§10 bis). */
export function PageArrivees() {
  const arrivees = useQuery({ queryKey: ['arrivees'], queryFn: () => api('/api/arrivees'), refetchInterval: 15_000 });

  return (
    <div className="animate-apparition">
      <EnTetePage titre="Arrivées" description="Les pièces entrées dans les dernières 24 heures, et où elles en sont de leur traitement." />

      {arrivees.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={5} />
        </Carte>
      ) : arrivees.data.length === 0 ? (
        <Carte>
          <EtatVide titre="Rien depuis hier">Les pièces versées, scannées ou reçues par mail apparaîtront ici.</EtatVide>
        </Carte>
      ) : (
        <Carte>
          <ul className="divide-y divide-trait">
            {arrivees.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                {d.source === 'scan' ? <ScanLine className="size-4 text-attente" aria-hidden /> : d.source === 'courriel' ? <Mail className="size-4 text-cyan" aria-hidden /> : <Paperclip className="size-4 text-encre-3" aria-hidden />}
                <Link to={`/documents/${d.id}`} className="min-w-0 flex-1 truncate font-medium text-cyan-texte hover:underline">
                  {d.titre}
                </Link>
                {d.type ? <Badge>{d.type}</Badge> : <Badge ton="attente">à classer</Badge>}
                {d.marche && <Badge ton="cyan">{d.marche.reference}</Badge>}
                <Badge ton={d.statutOcr === 'en_attente' ? 'attente' : d.statutOcr === 'echec' ? 'alerte' : 'ok'}>
                  {d.statutOcr === 'en_attente' ? 'lecture en attente' : d.statutOcr === 'en_cours' ? 'lecture en cours…' : 'texte lu'}
                </Badge>
                <span className="text-[12.5px] text-encre-3">{dateHeure(d.creeLe)}</span>
              </li>
            ))}
          </ul>
        </Carte>
      )}
    </div>
  );
}
