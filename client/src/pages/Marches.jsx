/**
 * La liste des marchés (§11, écran 2) : filtrable, triable, avec le badge de
 * phase, l'échéance et les six colonnes de pièces ✓ ✗ ·
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Download, LoaderCircle, Minus, Search, Upload, X } from 'lucide-react';
import { ORDRE_PHASES, PHASES, PIECES_CYCLE } from '@icity/commun/marches';
import { api } from '../api.js';
import { dateCourte } from '../format.js';
import { Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { Bouton } from '../ui/Bouton.jsx';
import { CaseACocher } from '../ui/Champ.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';
import { useSession } from '../auth/session.jsx';

export const CLE_MARCHES = ['marches'];

/** Le badge coloré d'une phase. */
export function BadgePhase({ phase }) {
  const p = PHASES[phase];
  return <Badge ton={p?.ton ?? 'neutre'}>{p?.court ?? phase}</Badge>;
}

/**
 * Une pièce du cycle, dans le tableau des marchés.
 *
 * Trois états, et la forme les porte autant que la couleur (accessibilité) :
 * présente (✓), manquante (✗), pas encore attendue (·).
 *
 * La case fait deux choses de plus :
 *
 *  - **présente, elle ouvre la pièce.** C'est le chemin le plus court entre
 *    « il manque quelque chose à ce marché » et le document lui-même.
 *  - **absente, elle accepte un fichier déposé dessus.** Le type et le marché
 *    sont déduits de la colonne et de la ligne : rien à ressaisir, là où le
 *    versement ordinaire demande de choisir les deux.
 */
function CasePiece({ documentId, manquante, piece, typeId, marche, surVerse, peutVerser }) {
  const [survol, setSurvol] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const { notifier } = useToasts();
  const etat = documentId ? 'présente' : manquante ? 'manquante' : 'pas encore attendue';

  // Sans type connu, on ne saurait pas quoi verser : la case reste inerte.
  const accepteDepot = peutVerser && !documentId && Boolean(typeId);

  async function deposer(fichiers) {
    const fichier = fichiers?.[0];
    if (!fichier || envoi) return;

    setEnvoi(true);
    try {
      const formulaire = new FormData();
      formulaire.append('fichier', fichier);
      formulaire.append('marcheId', String(marche.id));
      formulaire.append('typeDocumentId', String(typeId));
      if (marche.client?.id) formulaire.append('clientId', String(marche.client.id));

      await api('/api/documents', { methode: 'POST', fichier: formulaire });
      notifier({ titre: `${piece.nom} versé`, message: `${marche.reference} — la phase est recalculée.`, ton: 'ok' });
      surVerse?.();
    } catch (erreur) {
      // Le doublon exact a son propre message : il n'est pas une erreur, mais
      // un refus utile (§6).
      notifier({
        titre: erreur.statut === 409 ? 'Cette pièce est déjà au fonds' : 'Versement impossible',
        message: erreur.message,
        ton: erreur.statut === 409 ? 'attente' : 'alerte',
      });
    } finally {
      setEnvoi(false);
      setSurvol(false);
    }
  }

  const contenu = envoi ? (
    <LoaderCircle className="mx-auto size-4 animate-spin text-cyan" aria-hidden />
  ) : documentId ? (
    <Check className="mx-auto size-4 text-ok" aria-hidden />
  ) : survol ? (
    <Upload className="mx-auto size-4 text-cyan" aria-hidden />
  ) : manquante ? (
    <X className="mx-auto size-4 text-alerte" aria-hidden />
  ) : (
    <Minus className="mx-auto size-3.5 text-encre-3/60" aria-hidden />
  );

  return (
    <td
      className={cx('px-1 text-center', survol && 'rounded bg-cyan-voile ring-1 ring-cyan')}
      title={accepteDepot ? `${piece.nom} : ${etat} — déposez un fichier ici` : `${piece.nom} : ${etat}`}
      onDragOver={accepteDepot ? (e) => { e.preventDefault(); setSurvol(true); } : undefined}
      onDragLeave={accepteDepot ? () => setSurvol(false) : undefined}
      onDrop={
        accepteDepot
          ? (e) => {
              e.preventDefault();
              deposer(e.dataTransfer.files);
            }
          : undefined
      }
      // La ligne entière ouvre le marché : un clic sur une pièce ne doit pas
      // y remonter, sinon on n'atteindrait jamais le document.
      onClick={(e) => e.stopPropagation()}
    >
      <span className="sr-only">{`${piece.nom} : ${etat}`}</span>
      {documentId ? (
        <Link to={`/documents/${documentId}`} className="block rounded hover:bg-ok-voile" aria-label={`Ouvrir ${piece.nom} de ${marche.reference}`}>
          {contenu}
        </Link>
      ) : (
        contenu
      )}
    </td>
  );
}

export function PageMarches() {
  const [phase, setPhase] = useState('');
  const [clientId, setClientId] = useState('');
  const [incomplets, setIncomplets] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [tri, setTri] = useState({ colonne: 'reference', sens: 1 });

  const aller = useNavigate();
  const file = useQueryClient();
  const { droits } = useSession();
  const marches = useQuery({ queryKey: CLE_MARCHES, queryFn: () => api('/api/marches') });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api('/api/clients') });
  const referentiels = useQuery({ queryKey: ['referentiels'], queryFn: () => api('/api/referentiels') });

  // Le code de la pièce (« PVP ») vers l'identifiant de son type en base :
  // le dépôt a besoin de l'identifiant, le tableau ne connaît que le code.
  const typeParCode = new Map((referentiels.data?.types ?? []).map((t) => [t.code, t.id]));
  const peutVerser = droits.can('verser', 'Document');

  /** Après un dépôt : la phase et les pièces ont changé, on relit. */
  function apresVersement() {
    file.invalidateQueries({ queryKey: CLE_MARCHES });
    file.invalidateQueries({ queryKey: ['documents'] });
  }

  const visibles = useMemo(() => {
    let liste = marches.data ?? [];
    const q = recherche.trim().toLowerCase();
    if (q) liste = liste.filter((m) => `${m.reference} ${m.objet ?? ''} ${m.client?.nom ?? ''} ${m.ville ?? ''}`.toLowerCase().includes(q));
    if (phase) liste = liste.filter((m) => m.phase === phase);
    if (clientId) liste = liste.filter((m) => String(m.client?.id) === clientId);
    if (incomplets) liste = liste.filter((m) => m.manquantes.length > 0);

    const valeur = {
      reference: (m) => m.reference,
      client: (m) => m.client?.nom ?? '',
      phase: (m) => ORDRE_PHASES.indexOf(m.phase),
      echeance: (m) => m.echeance ?? '9999',
      documents: (m) => m.nbDocuments,
    }[tri.colonne];
    return [...liste].sort((a, b) => {
      const x = valeur(a);
      const y = valeur(b);
      const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true });
      return c * tri.sens;
    });
  }, [marches.data, recherche, phase, clientId, incomplets, tri]);

  function Colonne({ id, children, className }) {
    const actif = tri.colonne === id;
    const Fleche = tri.sens > 0 ? ArrowUp : ArrowDown;
    return (
      <th scope="col" className={cx('px-3 py-3 text-left font-semibold', className)}>
        <button
          type="button"
          onClick={() => setTri((t) => ({ colonne: id, sens: t.colonne === id ? -t.sens : 1 }))}
          className={cx('inline-flex items-center gap-1 hover:text-encre', actif && 'text-cyan-texte')}
          aria-label={`Trier par ${children}`}
        >
          {children}
          {actif && <Fleche className="size-3" aria-hidden />}
        </button>
      </th>
    );
  }

  const total = marches.data?.length ?? 0;

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Marchés"
        description="Chaque affaire, sa phase calculée d’après les pièces versées, et ce qui manque à son dossier."
        actions={
          <div className="flex items-center gap-3">
            <Badge ton="cyan">{total} marchés</Badge>
            {/* Un lien, pas un appel : le navigateur enregistre le fichier
                lui-même, sans que la page ait à le tenir en mémoire. */}
            <Bouton
              variante="secondaire"
              taille="petit"
              icone={Download}
              onClick={() => {
                const filtres = new URLSearchParams();
                if (phase) filtres.set('phase', phase);
                if (clientId) filtres.set('clientId', clientId);
                if (incomplets) filtres.set('incomplets', 'true');
                if (recherche.trim()) filtres.set('q', recherche.trim());
                window.location.href = `/api/marches/export.csv?${filtres}`;
              }}
            >
              Exporter
            </Bouton>
          </div>
        }
      />

      <Carte className="mb-5 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-3" aria-hidden />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Référence, objet, client, ville…"
            aria-label="Rechercher un marché"
            className="h-10 w-full rounded-[10px] border border-trait bg-surface-2 pr-3 pl-9 text-sm focus:border-cyan focus:outline-none"
          />
        </div>
        <select value={phase} onChange={(e) => setPhase(e.target.value)} aria-label="Filtrer par phase" className="h-10 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm focus:border-cyan focus:outline-none">
          <option value="">Toutes les phases</option>
          {ORDRE_PHASES.map((p) => (
            <option key={p} value={p}>
              {PHASES[p].nom} ({(marches.data ?? []).filter((m) => m.phase === p).length})
            </option>
          ))}
        </select>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Filtrer par client" className="h-10 max-w-56 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm focus:border-cyan focus:outline-none">
          <option value="">Tous les clients</option>
          {(clients.data ?? []).filter((c) => c.nbMarches > 0).map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.nom} ({c.nbMarches})
            </option>
          ))}
        </select>
        <CaseACocher libelle="Incomplets seulement" checked={incomplets} onChange={(e) => setIncomplets(e.target.checked)} />
      </Carte>

      <Carte>
        {marches.isPending ? (
          <div className="p-5">
            <SqueletteLignes lignes={6} />
          </div>
        ) : visibles.length === 0 ? (
          <EtatVide titre={total ? 'Aucun marché ne correspond' : 'Aucun marché'}>
            {total ? 'Modifiez les filtres pour élargir la recherche.' : 'Les marchés arrivent avec le versement des dossiers d’archives.'}
          </EtatVide>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Marchés, avec leur phase et leurs pièces</caption>
              <thead>
                <tr className="border-b border-trait text-[12px] tracking-wide text-encre-3 uppercase">
                  <Colonne id="reference">Référence</Colonne>
                  <Colonne id="client">Client</Colonne>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Objet</th>
                  <Colonne id="phase">Phase</Colonne>
                  <Colonne id="echeance">Échéance</Colonne>
                  {PIECES_CYCLE.map((p) => (
                    <th key={p.cle} scope="col" className="px-1 py-3 text-center text-[11px] font-semibold" title={p.nom}>
                      {p.titre}
                    </th>
                  ))}
                  <Colonne id="documents" className="text-right">Pièces</Colonne>
                </tr>
              </thead>
              <tbody>
                {visibles.map((m) => (
                  /*
                   * Toute la ligne ouvre le marché : c'est le geste attendu
                   * d'un tableau, plutôt que de viser la seule référence. Les
                   * cases de pièces gardent leur propre lien — un clic sur un
                   * ✓ mène au document, pas au marché.
                   */
                  <tr
                    key={m.id}
                    onClick={() => aller(`/marches/${m.id}`)}
                    className="cursor-pointer border-b border-trait last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        to={`/marches/${m.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="chiffres font-medium text-cyan-texte hover:underline"
                      >
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
                      <BadgePhase phase={m.phase} />
                    </td>
                    <td className={cx('chiffres px-3 py-2.5 text-[13px]', m.etatEcheance === 'depassee' && 'font-semibold text-alerte', m.etatEcheance === 'proche' && 'font-semibold text-attente')}>
                      {m.echeance ? dateCourte(m.echeance) : <span className="text-encre-3">—</span>}
                    </td>
                    {PIECES_CYCLE.map((p) => (
                      <CasePiece
                        key={p.cle}
                        piece={p}
                        typeId={typeParCode.get(p.code)}
                        documentId={m.pieces[p.cle] ?? null}
                        manquante={m.manquantes.includes(p.cle)}
                        marche={m}
                        peutVerser={peutVerser}
                        surVerse={apresVersement}
                      />
                    ))}
                    <td className="chiffres px-3 py-2.5 text-right text-encre-2">{m.nbDocuments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Carte>

      <p className="mt-3 text-[12.5px] text-encre-3">
        <Check className="inline size-3.5 text-ok" aria-hidden /> versée ·{' '}
        <X className="inline size-3.5 text-alerte" aria-hidden /> manquante à ce stade ·{' '}
        <Minus className="inline size-3 text-encre-3" aria-hidden /> pas encore attendue
      </p>
    </div>
  );
}
