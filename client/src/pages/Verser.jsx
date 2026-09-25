/**
 * L'écran « Verser » (§6) : glisser-déposer de plusieurs fichiers, avec la
 * progression de chacun (envoi… / versé / doublon / erreur).
 *
 * Les fichiers partent un par un : sur ce PC, dix envois simultanés de 50 Mo
 * satureraient la mémoire, et le serveur lit le texte de chaque PDF au passage.
 */
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, FileUp, LoaderCircle, Upload, XCircle } from 'lucide-react';
import { api, ErreurApi } from '../api.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Selection } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';

const FORMATS = '.pdf,.jpg,.jpeg,.png,.tif,.tiff,.webp,.docx,.odt,.txt';
const TAILLE_MAX = 50 * 1024 * 1024;

const ETATS = {
  attente: { libelle: 'en attente', icone: FileUp, classe: 'text-encre-3' },
  envoi: { libelle: 'envoi…', icone: LoaderCircle, classe: 'text-cyan animate-spin' },
  verse: { libelle: 'versé', icone: CheckCircle2, classe: 'text-ok' },
  doublon: { libelle: 'déjà au fonds', icone: Copy, classe: 'text-attente' },
  erreur: { libelle: 'refusé', icone: XCircle, classe: 'text-alerte' },
};

const poids = (o) => `${(o / 1024 / 1024).toFixed(1)} Mo`;

export function PageVerser() {
  const client = useQueryClient();
  const entree = useRef(null);
  const [survol, setSurvol] = useState(false);
  const [lignes, setLignes] = useState([]);
  // Venu de la fiche d'un marché (« Verser une pièce »), le marché est déjà choisi.
  const [parametres] = useSearchParams();
  const [marcheId, setMarcheId] = useState(() => parametres.get('marcheId') ?? '');
  const [typeId, setTypeId] = useState('');
  const [enCours, setEnCours] = useState(false);

  const marches = useQuery({ queryKey: ['marches'], queryFn: () => api('/api/marches') });
  const referentiels = useQuery({ queryKey: ['referentiels'], queryFn: () => api('/api/referentiels') });

  function ajouter(fichiers) {
    const nouvelles = [...fichiers].map((f) => ({
      cle: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`,
      fichier: f,
      nom: f.name,
      taille: f.size,
      etat: f.size > TAILLE_MAX ? 'erreur' : 'attente',
      message: f.size > TAILLE_MAX ? '50 Mo au plus' : null,
    }));
    setLignes((l) => [...l, ...nouvelles]);
    envoyer(nouvelles);
  }

  /** Envoie les fichiers l'un après l'autre, en tenant la ligne à jour. */
  async function envoyer(aEnvoyer) {
    setEnCours(true);
    for (const ligne of aEnvoyer) {
      if (ligne.etat === 'erreur') continue;
      majLigne(ligne.cle, { etat: 'envoi' });
      const formulaire = new FormData();
      if (marcheId) formulaire.append('marcheId', marcheId);
      if (typeId) formulaire.append('typeDocumentId', typeId);
      formulaire.append('fichier', ligne.fichier, ligne.nom);

      try {
        const r = await api('/api/documents', { methode: 'POST', fichier: formulaire });
        majLigne(ligne.cle, { etat: 'verse', documentId: r.document.id, message: r.document.type?.nom ?? null });
      } catch (erreur) {
        if (erreur instanceof ErreurApi && erreur.statut === 409) {
          majLigne(ligne.cle, { etat: 'doublon', message: erreur.message, documentId: undefined });
        } else {
          majLigne(ligne.cle, { etat: 'erreur', message: erreur.message });
        }
      }
    }
    setEnCours(false);
    client.invalidateQueries({ queryKey: ['documents'] });
    client.invalidateQueries({ queryKey: ['marches'] });
    client.invalidateQueries({ queryKey: ['tableau-bord'] });
  }

  const majLigne = (cle, champs) => setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, ...champs } : x)));

  const bilan = {
    verses: lignes.filter((l) => l.etat === 'verse').length,
    doublons: lignes.filter((l) => l.etat === 'doublon').length,
    erreurs: lignes.filter((l) => l.etat === 'erreur').length,
  };

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Verser"
        description="Déposez vos pièces : chacune est copiée dans le fonds, son empreinte calculée, et son texte lu s’il en porte déjà."
      />

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="grid content-start gap-4">
          {/* ── Zone de dépôt ── */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setSurvol(true);
            }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSurvol(false);
              if (e.dataTransfer.files?.length) ajouter(e.dataTransfer.files);
            }}
            className={cx(
              'rounded-carte border-2 border-dashed p-10 text-center transition-colors',
              survol ? 'border-cyan bg-cyan-voile' : 'border-trait-fort bg-surface',
            )}
          >
            <Upload className={cx('mx-auto size-10', survol ? 'text-cyan' : 'text-encre-3')} aria-hidden />
            <p className="mt-3 font-semibold">Glissez vos fichiers ici</p>
            <p className="mt-1 text-[13px] text-encre-2">PDF, images (JPG, PNG, TIFF, WEBP), DOCX, ODT ou TXT — 50 Mo par fichier.</p>
            <div className="mt-4">
              <Bouton icone={FileUp} onClick={() => entree.current?.click()}>
                Choisir des fichiers
              </Bouton>
            </div>
            <input
              ref={entree}
              type="file"
              multiple
              accept={FORMATS}
              className="sr-only"
              aria-label="Choisir des fichiers à verser"
              onChange={(e) => {
                if (e.target.files?.length) ajouter(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {/* ── Progression, fichier par fichier ── */}
          {lignes.length > 0 && (
            <Carte>
              <div className="flex flex-wrap items-center gap-3 border-b border-trait px-5 py-3">
                <h2 className="font-semibold">
                  {lignes.length} fichier{lignes.length > 1 ? 's' : ''}
                </h2>
                {bilan.verses > 0 && <Badge ton="ok">{bilan.verses} versé(s)</Badge>}
                {bilan.doublons > 0 && <Badge ton="attente">{bilan.doublons} déjà au fonds</Badge>}
                {bilan.erreurs > 0 && <Badge ton="alerte">{bilan.erreurs} refusé(s)</Badge>}
                {!enCours && (
                  <Bouton variante="fantome" taille="petit" className="ml-auto" onClick={() => setLignes([])}>
                    Effacer la liste
                  </Bouton>
                )}
              </div>
              <ul className="divide-y divide-trait" aria-live="polite">
                {lignes.map((l) => {
                  const etat = ETATS[l.etat];
                  const Icone = etat.icone;
                  return (
                    <li key={l.cle} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                      <Icone className={cx('size-4 shrink-0', etat.classe)} aria-hidden />
                      <span className="min-w-0 flex-1 truncate" title={l.nom}>
                        {l.nom}
                      </span>
                      <span className="chiffres text-[12.5px] text-encre-3">{poids(l.taille)}</span>
                      <span className={cx('text-[12.5px] font-medium', l.etat === 'erreur' ? 'text-alerte' : l.etat === 'doublon' ? 'text-attente' : 'text-encre-2')}>
                        {etat.libelle}
                      </span>
                      {l.documentId && (
                        <Link to={`/documents/${l.documentId}`} className="text-[12.5px] font-medium text-cyan-texte hover:underline">
                          ouvrir
                        </Link>
                      )}
                      {l.message && l.etat !== 'verse' && <span className="w-full text-[12px] text-encre-3">{l.message}</span>}
                    </li>
                  );
                })}
              </ul>
            </Carte>
          )}
        </div>

        {/* ── Ce qu'on applique à tout le lot ── */}
        <div className="grid content-start gap-4">
          <Carte className="p-5">
            <h2 className="mb-3 font-semibold">Rattacher ce lot</h2>
            <div className="grid gap-4">
              <Selection libelle="Marché" aide="Facultatif : le classement le devinera après lecture." value={marcheId} onChange={(e) => setMarcheId(e.target.value)}>
                <option value="">— laisser deviner —</option>
                {(marches.data ?? []).map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.reference} {m.client ? `· ${m.client.nom}` : ''}
                  </option>
                ))}
              </Selection>
              <Selection libelle="Type de pièce" aide="Facultatif, également." value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">— laisser deviner —</option>
                {(referentiels.data?.types ?? []).map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.nom}
                  </option>
                ))}
              </Selection>
            </div>
          </Carte>

          <Alerte ton="info" titre="Ce qui se passe au versement">
            Le fichier est copié hors du dossier public sous un nom unique, son empreinte SHA-256 est calculée — si elle existe déjà, le versement est refusé et l’original vous est indiqué. Le texte
            déjà présent dans un PDF est repris tel quel ; un scan muet part en file d’attente pour l’OCR.
          </Alerte>
        </div>
      </div>
    </div>
  );
}
