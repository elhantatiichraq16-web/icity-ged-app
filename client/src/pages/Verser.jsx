/**
 * L'écran « Versement » (§6, maquette A10) : on choisit les fichiers, on dit
 * où ils vont — marché cible, type de pièce, confidentialité —, puis on verse.
 *
 * Rien ne part avant « Verser les fichiers » : envoyé dès le dépôt, un fichier
 * partait avant qu'on ait choisi son marché. Le format et la taille se
 * contrôlent dès le choix ; le doublon et la fiche, au serveur.
 *
 * Les fichiers partent un par un : sur ce PC, dix envois simultanés de 50 Mo
 * satureraient la mémoire, et le serveur lit le texte de chaque PDF au passage.
 * Ensuite, chaque ligne suit sa pièce : où le classement l'a rangée, et où en
 * est sa lecture — l'OCR tourne à part, dans le worker.
 */
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, FileUp, LoaderCircle, Upload, X, XCircle } from 'lucide-react';
import { confidentialitesVisibles } from '@icity/commun/droits';
import { CONFIDENTIALITES, NIVEAU_MAX_PAR_ROLE, ROLES } from '@icity/commun/roles';
import { api, ErreurApi } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { Bouton } from '../ui/Bouton.jsx';
import { Selection } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { CLE_MARCHES } from './Marches.jsx';
import { CLES_APRES_RANGEMENT } from './ModifierPiece.jsx';

const FORMATS = ['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.docx', '.odt', '.txt'];
const TAILLE_MAX = 50 * 1024 * 1024;

const ETATS = {
  pret: { libelle: 'prêt', icone: FileUp, classe: 'text-encre-3' },
  envoi: { libelle: 'envoi…', icone: LoaderCircle, classe: 'text-cyan animate-spin' },
  verse: { libelle: 'versé', icone: CheckCircle2, classe: 'text-ok' },
  doublon: { libelle: 'déjà au fonds', icone: Copy, classe: 'text-attente' },
  erreur: { libelle: 'refusé', icone: XCircle, classe: 'text-alerte' },
};

/** Où en est la lecture d'une pièce versée. */
const LECTURE = {
  non_necessaire: { libelle: 'texte déjà présent', ton: 'ok' },
  en_attente: { libelle: 'lecture OCR en attente', ton: 'attente' },
  en_cours: { libelle: 'lecture OCR en cours', ton: 'cyan' },
  fait: { libelle: 'texte lu par l’OCR', ton: 'ok' },
  illisible: { libelle: 'illisible pour l’OCR', ton: 'alerte' },
  echec: { libelle: 'lecture en échec', ton: 'alerte' },
};
const EN_LECTURE = new Set(['en_attente', 'en_cours']);

const poids = (o) => (o < 1024 * 1024 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);
const extension = (nom) => (nom.includes('.') ? nom.slice(nom.lastIndexOf('.')).toLowerCase() : '');

/** Qui verra une pièce de ce niveau — celui qui la verse la voit toujours. */
function lecteursDe(code) {
  const niveau = CONFIDENTIALITES.find((c) => c.code === code)?.niveau ?? 0;
  const voient = (r) => (NIVEAU_MAX_PAR_ROLE[r.code] ?? 0) >= niveau;
  const exclus = ROLES.filter((r) => !voient(r)).map((r) => r.nom);
  if (!exclus.length) return 'Tous les comptes la verront.';
  if (exclus.length < ROLES.length / 2) return `Tous les comptes la verront, sauf : ${exclus.join(', ')}.`;
  return `Seuls la verront : ${ROLES.filter(voient)
    .map((r) => r.nom)
    .join(', ')} — et vous, qui la versez.`;
}

export function PageVerser() {
  const { utilisateur, droits } = useSession();
  const file = useQueryClient();
  const entree = useRef(null);
  const [survol, setSurvol] = useState(false);
  const [lignes, setLignes] = useState([]);
  // Venu de la fiche d'un marché (« Verser une pièce »), le marché est déjà choisi.
  const [parametres] = useSearchParams();
  const [marcheId, setMarcheId] = useState(() => parametres.get('marcheId') ?? '');
  const [typeId, setTypeId] = useState('');
  const [confidentialite, setConfidentialite] = useState('interne');
  const [progression, setProgression] = useState(null);
  const enCours = progression !== null;

  const marches = useQuery({ queryKey: CLE_MARCHES, queryFn: () => api('/api/marches') });
  const referentiels = useQuery({ queryKey: ['referentiels'], queryFn: () => api('/api/referentiels') });

  const affaires = [...(marches.data ?? [])].sort((a, b) => a.reference.localeCompare(b.reference, 'fr', { numeric: true }));
  const groupes = [
    { libelle: 'Marchés', affaires: affaires.filter((m) => !m.appelOffres) },
    { libelle: 'Appels d’offres', affaires: affaires.filter((m) => m.appelOffres) },
  ].filter((g) => g.affaires.length);
  const niveaux = CONFIDENTIALITES.filter((c) => confidentialitesVisibles(utilisateur.role).includes(c.code));

  // Les pièces versées, suivies jusqu'à la fin de leur lecture : le
  // classement d'un scan ne se fait qu'une fois son texte lu.
  const versees = lignes.filter((l) => l.document).map((l) => l.document.id);
  const suivi = useQuery({
    queryKey: ['versement', versees],
    queryFn: () => api(`/api/documents?ids=${versees.join(',')}`),
    enabled: versees.length > 0 && !enCours,
    refetchInterval: (requete) => {
      const pieces = requete.state.data?.documents;
      return !pieces || pieces.some((d) => EN_LECTURE.has(d.statutOcr)) ? 5000 : false;
    },
  });
  const aJour = new Map((suivi.data?.documents ?? []).map((d) => [d.id, d]));

  /** Ajoute les fichiers choisis, contrôlés tout de suite : format et taille. */
  function ajouter(fichiers) {
    const deja = new Set(lignes.filter((l) => l.etat === 'pret').map((l) => l.empreinte));
    const nouvelles = [];
    for (const f of [...fichiers]) {
      const empreinte = `${f.name}|${f.size}|${f.lastModified}`;
      if (deja.has(empreinte)) continue;
      deja.add(empreinte);
      const refus = !FORMATS.includes(extension(f.name))
        ? `Format refusé : ${extension(f.name) || 'sans extension'}.`
        : f.size > TAILLE_MAX
          ? '50 Mo au plus par fichier.'
          : null;
      nouvelles.push({ cle: `${empreinte}-${Math.random()}`, empreinte, fichier: f, nom: f.name, taille: f.size, etat: refus ? 'erreur' : 'pret', message: refus });
    }
    if (nouvelles.length) setLignes((l) => [...l, ...nouvelles]);
  }

  const majLigne = (cle, champs) => setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, ...champs } : x)));

  /** Verse les fichiers prêts, l'un après l'autre, avec la fiche remplie. */
  async function verser() {
    const aVerser = lignes.filter((l) => l.etat === 'pret');
    setProgression({ fait: 0, total: aVerser.length });
    for (const [rang, ligne] of aVerser.entries()) {
      majLigne(ligne.cle, { etat: 'envoi' });
      // Les champs avant le fichier : le serveur les lit en arrivant au fichier.
      const formulaire = new FormData();
      if (marcheId) formulaire.append('marcheId', marcheId);
      if (typeId) formulaire.append('typeDocumentId', typeId);
      formulaire.append('confidentialite', confidentialite);
      formulaire.append('fichier', ligne.fichier, ligne.nom);

      try {
        const r = await api('/api/documents', { methode: 'POST', fichier: formulaire });
        majLigne(ligne.cle, { etat: 'verse', document: r.document, message: null });
      } catch (erreur) {
        if (erreur instanceof ErreurApi && erreur.statut === 409) {
          const original = erreur.donnees?.doublon ?? null;
          const ou = original?.marche ? `, dans le marché ${original.marche.reference}` : '';
          majLigne(ligne.cle, { etat: 'doublon', original, message: original ? `Même fichier que « ${original.titre} »${ou}.` : erreur.message });
        } else {
          const champ = erreur instanceof ErreurApi ? Object.values(erreur.erreurs)[0] : null;
          majLigne(ligne.cle, { etat: 'erreur', message: champ ?? erreur.message });
        }
      }
      setProgression({ fait: rang + 1, total: aVerser.length });
    }
    setProgression(null);
    for (const cle of CLES_APRES_RANGEMENT) file.invalidateQueries({ queryKey: cle });
  }

  const compte = (etat) => lignes.filter((l) => l.etat === etat).length;
  const prets = compte('pret');

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Versement"
        description="Choisissez les fichiers, dites où ils vont, puis versez-les : chaque pièce est contrôlée, rangée, puis lue en arrière-plan."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Carte className="p-5 sm:p-6">
          <h2 className="mb-4 text-[17px] font-semibold">Verser des documents</h2>

          {/* ── Zone de dépôt ── */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!enCours) setSurvol(true);
            }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSurvol(false);
              if (!enCours && e.dataTransfer.files?.length) ajouter(e.dataTransfer.files);
            }}
            className={cx(
              'rounded-carte border-2 border-dashed px-6 py-8 text-center transition-colors',
              survol ? 'border-cyan bg-cyan-voile' : 'border-trait-fort bg-surface-2',
            )}
          >
            <Upload className={cx('mx-auto size-9', survol ? 'text-cyan' : 'text-encre-3')} aria-hidden />
            <p className="mt-3 font-semibold">Déposer les fichiers ici</p>
            <p className="mt-1 text-[13px] text-encre-2">PDF, images (JPG, PNG, TIFF, WEBP), DOCX, ODT ou TXT — 50 Mo par fichier.</p>
            <div className="mt-4">
              <Bouton variante="secondaire" icone={FileUp} disabled={enCours} onClick={() => entree.current?.click()}>
                Choisir des fichiers
              </Bouton>
            </div>
            <input
              ref={entree}
              type="file"
              multiple
              accept={FORMATS.join(',')}
              className="sr-only"
              aria-label="Choisir des fichiers à verser"
              onChange={(e) => {
                if (e.target.files?.length) ajouter(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {/* ── Les fichiers choisis, puis ce qu'ils sont devenus ── */}
          {lignes.length > 0 && (
            <ul className="mt-4 divide-y divide-trait rounded-lg border border-trait" aria-live="polite">
              {lignes.map((l) => (
                <LigneFichier
                  key={l.cle}
                  ligne={l}
                  piece={l.document ? (aJour.get(l.document.id) ?? l.document) : null}
                  versAClasser={droits.can('gerer', 'AVerifier')}
                  retirer={!enCours && ['pret', 'erreur'].includes(l.etat) ? () => setLignes((x) => x.filter((y) => y.cle !== l.cle)) : null}
                />
              ))}
            </ul>
          )}

          {/* ── La fiche : ce qui s'applique aux fichiers versés ── */}
          <div className="mt-6 grid gap-4">
            <Selection
              enLigne
              libelle="Marché cible"
              aide="Facultatif : sans marché, le classement le cherche dans le texte de chaque pièce."
              value={marcheId}
              disabled={enCours}
              onChange={(e) => setMarcheId(e.target.value)}
            >
              <option value="">— laisser le classement le trouver —</option>
              {groupes.map((g) => (
                <optgroup key={g.libelle} label={g.libelle}>
                  {g.affaires.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {`${m.reference}${m.client ? ` · ${m.client.nom}` : ''}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Selection>
            <Selection enLigne libelle="Type de pièce" aide="Facultatif, également." value={typeId} disabled={enCours} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">— laisser le classement le trouver —</option>
              {(referentiels.data?.types ?? []).map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.nom}
                </option>
              ))}
            </Selection>
            <Selection
              enLigne
              libelle="Confidentialité"
              aide={lecteursDe(confidentialite)}
              value={confidentialite}
              disabled={enCours}
              onChange={(e) => setConfidentialite(e.target.value)}
            >
              {niveaux.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nom}
                </option>
              ))}
            </Selection>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-trait pt-4">
            {compte('verse') > 0 && <Badge ton="ok">{compte('verse')} versé(s)</Badge>}
            {compte('doublon') > 0 && <Badge ton="attente">{compte('doublon')} déjà au fonds</Badge>}
            {compte('erreur') > 0 && <Badge ton="alerte">{compte('erreur')} refusé(s)</Badge>}
            {!enCours && lignes.length > 0 && (
              <Bouton variante="fantome" taille="petit" onClick={() => setLignes([])}>
                Effacer la liste
              </Bouton>
            )}
            <Bouton icone={Upload} disabled={!prets} chargement={enCours} libelleChargement={`Versement… ${progression?.fait ?? 0} / ${progression?.total ?? 0}`} onClick={verser}>
              {prets > 1 ? `Verser les ${prets} fichiers` : 'Verser les fichiers'}
            </Bouton>
          </div>
        </Carte>

        <div className="grid content-start gap-4">
          <Alerte ton="info" titre="Les contrôles du versement">
            <ul className="mt-1 grid list-disc gap-1 pl-4">
              <li>Format et taille, dès le choix des fichiers : 50 Mo au plus.</li>
              <li>Doublon : l’empreinte SHA-256 de chaque fichier est comparée au fonds ; un fichier déjà versé est refusé, et l’original vous est montré.</li>
              <li>Fiche : le marché et le type indiqués font foi ; le classement ne remplit que ce que vous laissez vide, et seulement s’il en est sûr.</li>
              <li>Lecture : le texte d’un PDF est repris tel quel ; un scan part en lecture OCR, dont l’avancement s’affiche ici.</li>
            </ul>
          </Alerte>
        </div>
      </div>
    </div>
  );
}

/** Un fichier : avant l'envoi, ce qu'on va verser ; après, où la pièce est allée. */
function LigneFichier({ ligne: l, piece, versAClasser, retirer }) {
  const etat = ETATS[l.etat];
  const Icone = etat.icone;
  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Icone className={cx('size-4 shrink-0', etat.classe)} aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={l.nom}>
          {l.nom}
        </span>
        <span className="chiffres text-[13px] text-encre-3">{poids(l.taille)}</span>
        <span className={cx('text-[13px] font-medium', l.etat === 'erreur' ? 'text-alerte' : l.etat === 'doublon' ? 'text-attente' : 'text-encre-2')}>{etat.libelle}</span>
        {piece && (
          <Link to={`/documents/${piece.id}`} className="text-[13px] font-medium text-cyan-texte hover:underline">
            ouvrir
          </Link>
        )}
        {l.original && (
          <Link to={`/documents/${l.original.id}`} className="text-[13px] font-medium text-cyan-texte hover:underline">
            voir l’original
          </Link>
        )}
        {retirer && (
          <button
            type="button"
            onClick={retirer}
            aria-label={`Retirer ${l.nom} de la liste`}
            className="grid size-7 place-items-center rounded-md text-encre-3 transition-colors hover:bg-surface-2 hover:text-encre"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {piece && <Rangement piece={piece} versAClasser={versAClasser} />}
      {l.message && <p className="mt-1 pl-7 text-[13px] text-encre-3">{l.message}</p>}
    </li>
  );
}

/** Où la pièce a été rangée, et où en est sa lecture. */
function Rangement({ piece, versAClasser }) {
  const lecture = LECTURE[piece.statutOcr];
  const enLecture = EN_LECTURE.has(piece.statutOcr);
  const incomplete = !piece.marche || !piece.type;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-7 text-[13px]">
      {piece.marche ? <Badge ton="cyan">{piece.marche.reference}</Badge> : <Badge ton={enLecture ? 'neutre' : 'attente'}>sans marché</Badge>}
      {piece.type ? <Badge>{piece.type.nom}</Badge> : <Badge ton={enLecture ? 'neutre' : 'attente'}>type à préciser</Badge>}
      {lecture && (
        <Badge ton={lecture.ton}>
          {enLecture && <LoaderCircle className="size-3 animate-spin" aria-hidden />}
          {lecture.libelle}
        </Badge>
      )}
      {incomplete &&
        (enLecture ? (
          <span className="text-encre-3">le classement réessaiera une fois le texte lu</span>
        ) : versAClasser ? (
          <Link to="/a-classer" className="font-medium text-cyan-texte hover:underline">
            à finir dans « À classer »
          </Link>
        ) : (
          <span className="text-encre-3">elle attend son classement</span>
        ))}
    </div>
  );
}
