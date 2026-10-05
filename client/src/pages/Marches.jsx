/**
 * La liste des marchés (§11, écran 2) : filtrable, triable, avec le badge de
 * phase, l'échéance et les six colonnes de pièces ✓ ✗ ·
 *
 * Deux onglets : les marchés gagnés, et les appels d'offres qui ne le sont
 * pas (ou pas encore). Le serveur fait le tri (`appelOffres`) d'après les
 * pièces du dossier et le statut choisi à la main.
 *
 * Les marchés archivés n'y figurent pas : ils ont leur page, « Archives ».
 * La direction coche ici ceux qui sont terminés pour les y ranger.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowDown, ArrowRight, ArrowUp, Check, Download, LoaderCircle, Minus, Plus, Search, Upload, X } from 'lucide-react';
import { ORDRE_PHASES, PHASES, PIECES_CYCLE, STATUTS_APPEL_OFFRES } from '@icity/commun/marches';
import { api } from '../api.js';
import { dateCourte } from '../format.js';
import { Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { Bouton } from '../ui/Bouton.jsx';
import { CaseACocher } from '../ui/Champ.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';
import { Confirmation } from '../ui/Modale.jsx';
import { useSession } from '../auth/session.jsx';
import { CaseLigne, RappelArchives, useArchivage } from './Archives.jsx';

export const CLE_MARCHES = ['marches'];

/** Le badge coloré d'une phase. */
export function BadgePhase({ phase }) {
  const p = PHASES[phase];
  return <Badge ton={p?.ton ?? 'neutre'}>{p?.court ?? phase}</Badge>;
}

/**
 * L'état d'une affaire : sa phase si c'est un marché, son statut si c'est un
 * appel d'offres (« AO déposé », « Perdu »…) — un AO n'a pas de cycle.
 */
export function BadgeEtatMarche({ marche }) {
  if (!marche.appelOffres) return <BadgePhase phase={marche.phase} />;
  return <Badge ton={marche.statutAffaire === 'Perdu' ? 'alerte' : 'attente'}>{marche.statutAffaire ?? 'Appel d’offres'}</Badge>;
}

/** Les statuts proposés pour qualifier un appel d'offres ; « Gagné » en fait un marché. */
const CHOIX_STATUT_AO = [...STATUTS_APPEL_OFFRES, 'Gagné'];

/**
 * Le statut d'un appel d'offres, modifiable sur place.
 *
 * Vide, c'est la détection automatique qui range l'affaire ici (« à
 * qualifier ») ; choisir « Gagné » la fait passer dans l'onglet Marchés.
 */
function StatutAppelOffres({ marche, peutModifier }) {
  const file = useQueryClient();
  const { notifier } = useToasts();

  const changer = useMutation({
    mutationFn: (statutAffaire) => api(`/api/marches/${marche.id}`, { methode: 'PATCH', corps: { statutAffaire: statutAffaire || null } }),
    onSuccess: (m) => {
      file.invalidateQueries({ queryKey: CLE_MARCHES });
      file.invalidateQueries({ queryKey: ['clients'] });
      file.invalidateQueries({ queryKey: ['tableau-bord'] });
      notifier(
        m.appelOffres
          ? { titre: 'Statut enregistré', message: `${m.reference} : ${m.statutAffaire ?? 'à qualifier'}.`, ton: 'ok' }
          : { titre: `${m.reference} est un marché gagné`, message: 'Il passe dans l’onglet Marchés gagnés.', ton: 'ok' },
      );
    },
    onError: (erreur) => notifier({ titre: 'Statut non enregistré', message: erreur.message, ton: 'alerte' }),
  });

  if (!peutModifier) return <BadgeEtatMarche marche={marche} />;
  return (
    <select
      value={marche.statutAffaire ?? ''}
      disabled={changer.isPending}
      onChange={(e) => changer.mutate(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Statut de l’appel d’offres ${marche.reference}`}
      className="h-9 rounded-[10px] border border-trait bg-surface-2 px-2.5 text-[13px] focus:border-cyan focus:outline-none disabled:opacity-60"
    >
      <option value="">À qualifier</option>
      {CHOIX_STATUT_AO.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

/** La case d'en-tête qui coche, ou décoche, toutes les lignes affichées. */
function CaseToutCocher({ selection }) {
  return (
    <th scope="col" className="w-10 px-3 py-3">
      <input
        type="checkbox"
        aria-label="Tout cocher"
        checked={selection.toutCoche}
        onChange={selection.basculerTout}
        className="size-4 cursor-pointer rounded accent-[var(--cyan)]"
      />
    </th>
  );
}

/** L'onglet des appels d'offres : ce qui a été préparé ou déposé, sans être gagné. */
function TableauAppelsOffres({ appels, peutModifier, selection }) {
  const aller = useNavigate();
  if (!appels.length) {
    return (
      <Carte>
        <EtatVide titre="Aucun appel d’offres en cours">
          Une affaire arrive ici quand son dossier ne contient qu’un dossier d’appel d’offres, sans contrat ni ordre de service.
        </EtatVide>
      </Carte>
    );
  }
  return (
    <Carte>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Appels d’offres non gagnés</caption>
          <thead>
            <tr className="border-b border-trait text-left text-[13px] tracking-wide text-encre-3 uppercase">
              {selection && <CaseToutCocher selection={selection} />}
              <th scope="col" className="px-4 py-3 font-semibold">Référence</th>
              <th scope="col" className="px-4 py-3 font-semibold">Client</th>
              <th scope="col" className="px-4 py-3 font-semibold">Objet</th>
              <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Pièces</th>
            </tr>
          </thead>
          <tbody>
            {appels.map((m) => (
              <tr key={m.id} onClick={() => aller(`/marches/${m.id}`)} className="cursor-pointer border-b border-trait last:border-0 hover:bg-surface-2">
                {selection && <CaseLigne libelle={`Cocher ${m.reference}`} checked={selection.coches.has(m.id)} onChange={() => selection.basculer(m.id)} />}
                <td className="px-4 py-3">
                  <Link to={`/marches/${m.id}`} onClick={(e) => e.stopPropagation()} className="chiffres font-medium text-cyan-texte hover:underline">
                    {m.reference}
                  </Link>
                </td>
                <td className="max-w-52 truncate px-4 py-3 text-encre-2" title={m.client?.nom}>
                  {m.client?.nom ?? '—'}
                </td>
                <td className="max-w-64 truncate px-4 py-3 text-encre-2" title={m.objet ?? m.objetTechnique ?? ''}>
                  {m.objet ?? m.objetTechnique ?? <span className="text-encre-3">—</span>}
                </td>
                <td className="px-4 py-3">
                  <StatutAppelOffres marche={m} peutModifier={peutModifier} />
                </td>
                <td className="chiffres px-4 py-3 text-right text-encre-2">{m.nbDocuments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Carte>
  );
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
  // L'onglet dans l'URL : le tableau de bord peut mener droit aux appels d'offres.
  const [parametres, setParametres] = useSearchParams();
  const onglet = parametres.get('onglet') === 'ao' ? 'ao' : 'marches';
  const [phase, setPhase] = useState('');
  const [clientId, setClientId] = useState('');
  const [incomplets, setIncomplets] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [tri, setTri] = useState({ colonne: 'reference', sens: 1 });
  const [coches, setCoches] = useState(() => new Set());
  const [confirmerArchivage, setConfirmerArchivage] = useState(false);

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
  const peutArchiver = droits.can('archiver', 'Marche');
  const archivage = useArchivage();
  const typeAttestation = (referentiels.data?.types ?? []).find((t) => t.code === 'ATT');

  // Les attestations mises à part : leur numéro de marché ne se lit pas.
  const attestationsEnAttente = useQuery({
    queryKey: ['documents', 'attestations-en-attente', typeAttestation?.id],
    queryFn: () => api(`/api/documents?typeId=${typeAttestation.id}&sansMarche=true`),
    enabled: Boolean(typeAttestation),
  });

  /** Après un dépôt : la phase et les pièces ont changé, on relit. */
  function apresVersement() {
    file.invalidateQueries({ queryKey: CLE_MARCHES });
    file.invalidateQueries({ queryKey: ['documents'] });
  }

  const gagnes = useMemo(() => (marches.data ?? []).filter((m) => !m.appelOffres), [marches.data]);
  const appels = useMemo(() => (marches.data ?? []).filter((m) => m.appelOffres), [marches.data]);

  const visibles = useMemo(() => {
    let liste = gagnes;
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
  }, [gagnes, recherche, phase, clientId, incomplets, tri]);

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

  const total = gagnes.length;
  const enAttente = attestationsEnAttente.data?.total ?? 0;

  // La sélection ne porte que sur les lignes affichées : changer d'onglet ou
  // de filtre ne doit pas faire archiver ce qu'on ne voit plus.
  const affiches = onglet === 'ao' ? appels : visibles;
  const choisis = affiches.filter((m) => coches.has(m.id));
  const selection = peutArchiver
    ? {
        coches,
        toutCoche: affiches.length > 0 && choisis.length === affiches.length,
        basculer: (id) =>
          setCoches((avant) => {
            const apres = new Set(avant);
            if (apres.has(id)) apres.delete(id);
            else apres.add(id);
            return apres;
          }),
        basculerTout: () => setCoches(choisis.length === affiches.length ? new Set() : new Set(affiches.map((m) => m.id))),
      }
    : null;

  function archiver() {
    archivage.mutate(
      { ids: choisis.map((m) => m.id), archiver: true },
      {
        onSuccess: () => {
          setCoches(new Set());
          setConfirmerArchivage(false);
        },
      },
    );
  }

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Marchés"
        description="Chaque affaire, sa phase calculée d’après les pièces versées, et ce qui manque à son dossier."
        actions={
          <div className="flex items-center gap-3">
            {peutArchiver && (
              <Bouton variante="secondaire" taille="petit" icone={Archive} disabled={!choisis.length} onClick={() => setConfirmerArchivage(true)}>
                Archiver{choisis.length ? ` (${choisis.length})` : ''}
              </Bouton>
            )}
            {onglet === 'marches' && (
              <>
                <Badge ton="cyan">{total} marchés</Badge>
                {/* Un lien, pas un appel : le navigateur enregistre le fichier
                    lui-même, sans que la page ait à le tenir en mémoire. */}
                <Bouton
                  variante="secondaire"
                  taille="petit"
                  icone={Download}
                  onClick={() => {
                    const filtres = new URLSearchParams({ nature: 'marches' });
                    if (phase) filtres.set('phase', phase);
                    if (clientId) filtres.set('clientId', clientId);
                    if (incomplets) filtres.set('incomplets', 'true');
                    if (recherche.trim()) filtres.set('q', recherche.trim());
                    window.location.href = `/api/marches/export.csv?${filtres}`;
                  }}
                >
                  Exporter
                </Bouton>
              </>
            )}
            {droits.can('creer', 'Marche') && (
              <Bouton taille="petit" icone={Plus} onClick={() => aller(onglet === 'ao' ? '/marches/nouveau?nature=ao' : '/marches/nouveau')}>
                {onglet === 'ao' ? 'Nouvel appel d’offres' : 'Nouveau marché'}
              </Bouton>
            )}
          </div>
        }
      />

      {/* Plus rien en cours : on rappelle où est le fonds précédent. */}
      {marches.data && marches.data.length === 0 && <RappelArchives className="mb-5" />}

      <div role="tablist" aria-label="Marchés ou appels d’offres" className="mb-5 flex gap-1 border-b border-trait">
        {[
          ['marches', 'Marchés gagnés', total],
          ['ao', 'Appels d’offres', appels.length],
        ].map(([cle, libelle, n]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            aria-selected={onglet === cle}
            onClick={() => setParametres(cle === 'ao' ? { onglet: 'ao' } : {}, { replace: true })}
            className={cx(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors',
              onglet === cle ? 'border-cyan text-encre' : 'border-transparent text-encre-3 hover:text-encre',
            )}
          >
            {libelle}
            <span className={cx('chiffres rounded-full px-2 text-[12.5px]', onglet === cle ? 'bg-cyan-voile text-cyan-texte' : 'bg-surface-2')}>{n}</span>
          </button>
        ))}
      </div>

      {onglet === 'ao' ? (
        marches.isPending ? (
          <Carte className="p-5">
            <SqueletteLignes lignes={3} />
          </Carte>
        ) : (
          <TableauAppelsOffres appels={appels} peutModifier={droits.can('modifier', 'Marche')} selection={selection} />
        )
      ) : (
      <>
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
              {PHASES[p].nom} ({gagnes.filter((m) => m.phase === p).length})
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
                <tr className="border-b border-trait text-[13px] tracking-wide text-encre-3 uppercase">
                  {selection && <CaseToutCocher selection={selection} />}
                  <Colonne id="reference">Référence</Colonne>
                  <Colonne id="client">Client</Colonne>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Objet</th>
                  <Colonne id="phase">Phase</Colonne>
                  <Colonne id="echeance">Échéance</Colonne>
                  {PIECES_CYCLE.map((p) => (
                    <th key={p.cle} scope="col" className="px-1 py-3 text-center text-[12px] font-semibold" title={p.nom}>
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
                    {selection && <CaseLigne libelle={`Cocher ${m.reference}`} checked={coches.has(m.id)} onChange={() => selection.basculer(m.id)} />}
                    <td className="px-3 py-2.5">
                      <Link
                        to={`/marches/${m.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="chiffres font-medium text-cyan-texte hover:underline"
                      >
                        {m.reference}
                      </Link>
                      {m.lot && <span className="ml-1.5 text-[12.5px] text-encre-3">lot {m.lot}</span>}
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

      <p className="mt-3 text-[13px] text-encre-3">
        <Check className="inline size-3.5 text-ok" aria-hidden /> versée ·{' '}
        <X className="inline size-3.5 text-alerte" aria-hidden /> manquante à ce stade ·{' '}
        <Minus className="inline size-3 text-encre-3" aria-hidden /> pas encore attendue
      </p>

      {enAttente > 0 && typeAttestation && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 rounded-[10px] border border-trait bg-surface-2 px-4 py-3 text-[13.5px] text-encre-2">
          <strong className="font-semibold text-encre">{enAttente} attestation(s) de référence</strong> attendent leur marché : leur numéro de marché est illisible.
          Elles le rejoindront dès qu’elles seront rescannées ou que le marché sera versé.
          <Link to={`/documents?typeId=${typeAttestation.id}&sansMarche=true`} className="inline-flex items-center gap-1 font-semibold text-cyan-texte hover:underline">
            Les voir <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </p>
      )}
      </>
      )}

      <Confirmation
        ouverte={confirmerArchivage}
        surChangement={setConfirmerArchivage}
        titre={`Archiver ${choisis.length} ${onglet === 'ao' ? 'appel' : 'marché'}${choisis.length > 1 ? 's' : ''} ${onglet === 'ao' ? 'd’offres ' : ''}?`}
        description="Ils quittent cette liste et le tableau de bord, et le classement automatique n’y range plus rien. Rien n’est supprimé : vous les retrouvez dans « Archives », toujours modifiables, et vous pouvez les désarchiver à tout moment."
        libelle="Archiver"
        ton="principal"
        chargement={archivage.isPending}
        surConfirmer={archiver}
      />
    </div>
  );
}
