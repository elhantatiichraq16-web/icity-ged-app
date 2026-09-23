/**
 * Les documents (§11, écran 4) : liste filtrable, et visionneuse PDF avec le
 * texte OCR à côté.
 *
 * Le PDF s'affiche dans une iframe servie par notre API : c'est la visionneuse
 * PDF.js du navigateur qui le rend, sans rien télécharger de plus. Le fichier
 * n'est jamais accessible sans passer par le contrôle des droits.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, Search, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { dateCourte, dateHeure } from '../format.js';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { Bouton } from '../ui/Bouton.jsx';
import { cx } from '../ui/cx.js';
import { Confirmation } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';
import { useSession } from '../auth/session.jsx';
import { Visionneuse } from '../ui/Visionneuse.jsx';
import { CircuitDocument } from './CircuitDocument.jsx';

/** L'état de lecture d'un document, en clair. */
export const ETATS_OCR = {
  en_attente: { libelle: 'Lecture en attente', ton: 'attente' },
  en_cours: { libelle: 'Lecture en cours…', ton: 'cyan' },
  fait: { libelle: 'Texte lu', ton: 'ok' },
  echec: { libelle: 'Lecture échouée', ton: 'alerte' },
  non_necessaire: { libelle: 'Texte déjà présent', ton: 'ok' },
};

const poids = (octets) => (octets ? `${(octets / 1024 / 1024).toFixed(1)} Mo` : '—');

export function PageDocuments() {
  const [parametres, setParametres] = useSearchParams();
  const page = Number(parametres.get('page') ?? 1);
  const q = parametres.get('q') ?? '';
  const marcheId = parametres.get('marcheId') ?? '';
  const typeId = parametres.get('typeId') ?? '';
  const statutOcr = parametres.get('statutOcr') ?? '';

  const [recherche, setRecherche] = useState(q);

  // Les pièces cochées, par identifiant. Un Set : on coche et décoche
  // souvent, et l'ordre n'a aucune importance.
  const [choisis, setChoisis] = useState(() => new Set());
  const [confirmeLot, setConfirmeLot] = useState(false);

  const fileAttente = useQueryClient();
  const { notifier } = useToasts();
  const { droits } = useSession();

  const requete = new URLSearchParams({ page: String(page) });
  for (const [cle, valeur] of [['q', q], ['marcheId', marcheId], ['typeId', typeId], ['statutOcr', statutOcr]]) {
    if (valeur) requete.set(cle, valeur);
  }

  const documents = useQuery({ queryKey: ['documents', requete.toString()], queryFn: () => api(`/api/documents?${requete}`) });
  const marches = useQuery({ queryKey: ['marches'], queryFn: () => api('/api/marches') });
  const referentiels = useQuery({ queryKey: ['referentiels'], queryFn: () => api('/api/referentiels') });

  /**
   * Met le lot en corbeille.
   *
   * Suppression douce, comme à l'unité : les pièces y restent trente jours
   * (§9), et la corbeille permet de les reprendre.
   */
  const supprimerLot = useMutation({
    mutationFn: () => api('/api/documents/corbeille', { methode: 'POST', corps: { ids: [...choisis] } }),
    onSuccess: (r) => {
      fileAttente.invalidateQueries({ queryKey: ['documents'] });
      fileAttente.invalidateQueries({ queryKey: ['corbeille'] });
      fileAttente.invalidateQueries({ queryKey: ['a-verifier'] });
      fileAttente.invalidateQueries({ queryKey: ['marches'] });
      notifier({
        titre: `${r.supprimes} pièce(s) mise(s) en corbeille`,
        message: 'Elles y restent trente jours, et peuvent être restaurées.',
        ton: 'ok',
      });
      setChoisis(new Set());
      setConfirmeLot(false);
    },
    onError: (e) => notifier({ titre: 'Suppression impossible', message: e.message, ton: 'alerte' }),
  });

  /** Coche ou décoche une pièce. */
  function basculer(id) {
    setChoisis((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });
  }

  /**
   * Change un filtre et revient à la première page : les résultats ne sont
   * plus les mêmes, rester page 3 n'aurait pas de sens.
   */
  function filtrer(cle, valeur) {
    const suivant = new URLSearchParams(parametres);
    if (valeur) suivant.set(cle, valeur);
    else suivant.delete(cle);
    suivant.delete('page');
    setChoisis(new Set());
    setParametres(suivant);
  }

  /** Changer de page, elle, garde les filtres et la page demandée. */
  function allerPage(numero) {
    const suivant = new URLSearchParams(parametres);
    suivant.set('page', String(numero));
    // Les pièces cochées quittent l'écran : les garder cochées ferait
    // supprimer des lignes qu'on ne voit plus.
    setChoisis(new Set());
    setParametres(suivant);
  }

  const peutSupprimer = droits.can('supprimer', 'Document');
  const d = documents.data;

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Documents"
        description="Toutes les pièces du fonds. Ouvrez-en une pour la lire, avec son texte à côté."
        actions={d ? <Badge ton="cyan">{d.total} documents</Badge> : null}
      />

      <Carte className="mb-5 flex flex-wrap items-center gap-3 p-4">
        <form
          className="relative min-w-56 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            filtrer('q', recherche.trim());
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-3" aria-hidden />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Titre, nom de fichier, marché, client…"
            aria-label="Rechercher un document"
            className="h-10 w-full rounded-[10px] border border-trait bg-surface-2 pr-3 pl-9 text-sm focus:border-cyan focus:outline-none"
          />
        </form>
        <select value={marcheId} onChange={(e) => filtrer('marcheId', e.target.value)} aria-label="Filtrer par marché" className="h-10 max-w-52 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm">
          <option value="">Tous les marchés</option>
          {(marches.data ?? []).map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.reference} ({m.nbDocuments})
            </option>
          ))}
        </select>
        <select value={typeId} onChange={(e) => filtrer('typeId', e.target.value)} aria-label="Filtrer par type" className="h-10 max-w-52 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm">
          <option value="">Tous les types</option>
          {(referentiels.data?.types ?? []).map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.nom}
            </option>
          ))}
        </select>
        <select value={statutOcr} onChange={(e) => filtrer('statutOcr', e.target.value)} aria-label="Filtrer par état de lecture" className="h-10 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm">
          <option value="">Toutes les lectures</option>
          {Object.entries(ETATS_OCR).map(([cle, e]) => (
            <option key={cle} value={cle}>
              {e.libelle}
            </option>
          ))}
        </select>
      </Carte>

      {/*
        * La barre n'existe que quand une pièce est cochée : tant que rien
        * n'est choisi, elle n'aurait rien à dire et prendrait de la place.
        */}
      {choisis.size > 0 && (
        <Carte className="mb-3 flex flex-wrap items-center gap-3 border-cyan bg-cyan-voile p-3">
          <span className="text-sm font-medium text-cyan-texte">
            {choisis.size} pièce{choisis.size > 1 ? 's' : ''} choisie{choisis.size > 1 ? 's' : ''}
          </span>
          <div className="flex-1" />
          <Bouton variante="fantome" taille="petit" icone={X} onClick={() => setChoisis(new Set())}>
            Tout décocher
          </Bouton>
          <Bouton variante="danger" taille="petit" icone={Trash2} onClick={() => setConfirmeLot(true)}>
            Mettre en corbeille
          </Bouton>
        </Carte>
      )}

      <Confirmation
        ouverte={confirmeLot}
        surChangement={setConfirmeLot}
        titre={`Mettre ${choisis.size} pièce${choisis.size > 1 ? 's' : ''} en corbeille ?`}
        description="Elles seront retirées du fonds mais gardées trente jours. Vous pourrez les restaurer depuis la corbeille."
        libelle="Mettre en corbeille"
        chargement={supprimerLot.isPending}
        surConfirmer={() => supprimerLot.mutate()}
      />

      <Carte>
        {documents.isPending ? (
          <div className="p-5">
            <SqueletteLignes lignes={8} />
          </div>
        ) : d.documents.length === 0 ? (
          <EtatVide titre="Aucun document">Modifiez les filtres, ou versez des pièces depuis l’écran « Verser ».</EtatVide>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Documents du fonds</caption>
              <thead>
                <tr className="border-b border-trait text-left text-[12px] tracking-wide text-encre-3 uppercase">
                  {peutSupprimer && (
                    <th scope="col" className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        // Coche la page entière, pas tout le fonds : on ne
                        // supprime que ce qu'on a sous les yeux.
                        checked={d.documents.length > 0 && d.documents.every((x) => choisis.has(x.id))}
                        onChange={(e) =>
                          setChoisis(e.target.checked ? new Set(d.documents.map((x) => x.id)) : new Set())
                        }
                        aria-label="Tout cocher sur cette page"
                        className="size-4 accent-[var(--cyan)]"
                      />
                    </th>
                  )}
                  <th scope="col" className="px-4 py-3 font-semibold">Titre</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Type</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Marché</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Client</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Lecture</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Pages</th>
                </tr>
              </thead>
              <tbody>
                {d.documents.map((doc) => (
                  <tr
                    key={doc.id}
                    className={cx('border-b border-trait last:border-0 hover:bg-surface-2', choisis.has(doc.id) && 'bg-cyan-voile')}
                  >
                    {peutSupprimer && (
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={choisis.has(doc.id)}
                          onChange={() => basculer(doc.id)}
                          aria-label={`Choisir ${doc.titre}`}
                          className="size-4 accent-[var(--cyan)]"
                        />
                      </td>
                    )}
                    <td className="max-w-80 px-4 py-2.5">
                      <Link to={`/documents/${doc.id}`} className="flex items-center gap-2 font-medium text-cyan-texte hover:underline">
                        <FileText className="size-4 shrink-0 text-encre-3" aria-hidden />
                        <span className="truncate" title={doc.nomOrigine ?? doc.titre}>
                          {doc.titre}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{doc.type ? <Badge>{doc.type.nom}</Badge> : <Badge ton="attente">À classer</Badge>}</td>
                    <td className="chiffres px-3 py-2.5 text-[13px]">
                      {doc.marche ? (
                        <Link to={`/marches/${doc.marche.id}`} className="text-cyan-texte hover:underline">
                          {doc.marche.reference}
                        </Link>
                      ) : (
                        <span className="text-encre-3">—</span>
                      )}
                    </td>
                    <td className="max-w-44 truncate px-3 py-2.5 text-encre-2">{doc.client?.nom ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge ton={ETATS_OCR[doc.statutOcr]?.ton ?? 'neutre'}>{ETATS_OCR[doc.statutOcr]?.libelle ?? doc.statutOcr}</Badge>
                    </td>
                    <td className="chiffres px-3 py-2.5 text-right text-encre-2">{doc.pages ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Carte>

      {d && d.pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Pages de résultats">
          <Bouton variante="secondaire" taille="petit" disabled={page <= 1} onClick={() => allerPage(page - 1)}>
            Précédent
          </Bouton>
          <span className="text-[13px] text-encre-2">
            Page {d.page} sur {d.pages}
          </span>
          <Bouton variante="secondaire" taille="petit" disabled={page >= d.pages} onClick={() => allerPage(page + 1)}>
            Suivant
          </Bouton>
        </nav>
      )}
    </div>
  );
}

export function PageFicheDocument() {
  const { id } = useParams();
  const aller = useNavigate();
  const file = useQueryClient();
  const { notifier } = useToasts();
  const { droits } = useSession();
  const [confirme, setConfirme] = useState(false);
  const document_ = useQuery({ queryKey: ['document', id], queryFn: () => api(`/api/documents/${id}`) });

  /**
   * La suppression est douce : la pièce part en corbeille pour trente jours
   * (§9). Rien n'est perdu tant que le délai court — d'où le libellé, qui dit
   * ce qui se passe vraiment.
   */
  const supprimer = useMutation({
    mutationFn: () => api(`/api/documents/${id}/corbeille`, { methode: 'POST' }),
    onSuccess: () => {
      file.invalidateQueries({ queryKey: ['documents'] });
      file.invalidateQueries({ queryKey: ['a-verifier'] });
      file.invalidateQueries({ queryKey: ['corbeille'] });
      notifier({ titre: 'Pièce mise en corbeille', message: 'Elle y reste trente jours, et peut être restaurée depuis « À vérifier ».', ton: 'ok' });
      aller('/documents');
    },
    onError: (e) => notifier({ titre: 'Suppression impossible', message: e.message, ton: 'alerte' }),
  });

  if (document_.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={5} />
      </Carte>
    );
  }
  if (document_.isError) return <Alerte ton="alerte">{document_.error.message}</Alerte>;

  const d = document_.data;
  const estPdf = d.extension === '.pdf';

  return (
    <div className="animate-apparition">
      <Link to="/documents" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-cyan-texte hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Tous les documents
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{d.titre}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-encre-2">
            {d.type && <Badge>{d.type.nom}</Badge>}
            <Badge ton={ETATS_OCR[d.statutOcr]?.ton ?? 'neutre'}>{ETATS_OCR[d.statutOcr]?.libelle}</Badge>
            {d.marche && (
              <Link to={`/marches/${d.marche.id}`} className="chiffres text-cyan-texte hover:underline">
                {d.marche.reference}
              </Link>
            )}
            {d.client && <span>{d.client.nom}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/documents/${d.id}/telecharger`}>
            <Bouton variante="secondaire" icone={Download}>
              Télécharger
            </Bouton>
          </a>
          {droits.can('supprimer', 'Document') && (
            <Bouton variante="secondaire" icone={Trash2} onClick={() => setConfirme(true)}>
              Supprimer
            </Bouton>
          )}
        </div>
      </div>

      <Confirmation
        ouverte={confirme}
        surChangement={setConfirme}
        titre="Mettre cette pièce en corbeille ?"
        description={`« ${d.titre} » sera retirée du fonds mais gardée trente jours. Vous pourrez la restaurer depuis l’écran « À vérifier ».`}
        libelle="Mettre en corbeille"
        chargement={supprimer.isPending}
        surConfirmer={() => supprimer.mutate()}
      />

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Carte className="overflow-hidden">
          {estPdf ? (
            <div className="h-[70vh]">
              <Visionneuse url={`/api/documents/${d.id}/fichier`} titre={d.titre} />
            </div>
          ) : (
            <EtatVide titre="Aperçu indisponible">
              Ce format ({d.extension ?? '—'}) ne s’affiche pas dans le navigateur. Téléchargez-le pour l’ouvrir.
            </EtatVide>
          )}
        </Carte>

        <div className="grid content-start gap-5">
          <Carte className="p-5">
            <h2 className="mb-3 font-semibold">Informations</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <Ligne libelle="Fichier d’origine" valeur={d.nomOrigine} />
              <Ligne libelle="Pages" valeur={d.pages ?? '—'} />
              <Ligne libelle="Poids" valeur={poids(d.taille)} />
              <Ligne libelle="Date du document" valeur={dateCourte(d.dateDocument)} />
              <Ligne libelle="Versé le" valeur={dateHeure(d.creeLe)} />
              <Ligne libelle="Source" valeur={d.source} />
              <Ligne libelle="Confidentialité" valeur={d.confidentialite} />
              <Ligne libelle="État du circuit" valeur={d.etatCircuit.replace(/_/g, ' ')} />
              {d.lotScan && <Ligne libelle="Lot de scan" valeur={`${d.lotScan} — page ${d.pageScan}`} />}
            </dl>
            {d.etiquettes.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {d.etiquettes.map((e) => (
                  <li key={e.id}>
                    <Badge ton="cyan">{e.nom}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Carte>

          <CircuitDocument documentId={d.id} />

          <Carte className="p-5">
            <h2 className="mb-3 font-semibold">Texte du document</h2>
            {d.texteOcr ? (
              <pre className={cx('max-h-[40vh] overflow-auto rounded-lg bg-surface-2 p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap')}>{d.texteOcr}</pre>
            ) : d.statutOcr === 'en_attente' ? (
              <Alerte ton="attente" titre="Pas encore lu">
                Ce document est un scan : son texte sera lu par l’OCR (Tesseract), un document à la fois.
              </Alerte>
            ) : (
              <Alerte ton="alerte" titre="Lecture échouée">Relancez la lecture depuis la file d’attente.</Alerte>
            )}
          </Carte>
        </div>
      </div>
    </div>
  );
}

function Ligne({ libelle, valeur }) {
  return (
    <>
      <dt className="text-encre-3">{libelle}</dt>
      <dd className="truncate font-medium" title={String(valeur ?? '')}>
        {valeur ?? '—'}
      </dd>
    </>
  );
}
