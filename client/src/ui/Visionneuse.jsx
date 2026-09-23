/**
 * La visionneuse PDF (§11), construite avec PDF.js.
 *
 * On dessine chaque page sur un canevas plutôt que d'utiliser le lecteur PDF
 * du navigateur : celui-ci est parfois désactivé, et il ne permet ni de
 * surligner les mots trouvés (phase 5) ni de suivre la page affichée.
 *
 * Le fichier arrive par notre API, qui vérifie les droits à chaque requête.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import travailleurUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, LoaderCircle, ZoomIn, ZoomOut } from 'lucide-react';
import { Bouton } from './Bouton.jsx';
import { Alerte } from './Elements.jsx';

// PDF.js décode les pages dans un « worker », pour ne pas figer l'écran.
pdfjs.GlobalWorkerOptions.workerSrc = travailleurUrl;

export function Visionneuse({ url, titre }) {
  const canevas = useRef(null);
  const document_ = useRef(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1.2);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);

  // Ouverture du document.
  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur('');
    const tache = pdfjs.getDocument({ url, withCredentials: true });
    tache.promise.then(
      (pdf) => {
        if (annule) return;
        document_.current = pdf;
        setPages(pdf.numPages);
        setPage(1);
      },
      (e) => {
        if (!annule) {
          setErreur(e?.message || 'Ce document ne peut pas être affiché.');
          setChargement(false);
        }
      },
    );
    return () => {
      annule = true;
      tache.destroy?.();
      document_.current = null;
    };
  }, [url]);

  // Dessin de la page courante.
  const dessiner = useCallback(async () => {
    const pdf = document_.current;
    const cible = canevas.current;
    if (!pdf || !cible) return;
    setChargement(true);
    try {
      const p = await pdf.getPage(page);
      // On tient compte des écrans à haute densité, sinon le texte bave.
      const densite = Math.min(window.devicePixelRatio || 1, 2);
      const vue = p.getViewport({ scale: zoom * densite });
      cible.width = vue.width;
      cible.height = vue.height;
      cible.style.width = `${vue.width / densite}px`;
      cible.style.height = `${vue.height / densite}px`;
      await p.render({ canvasContext: cible.getContext('2d'), viewport: vue }).promise;
    } catch (e) {
      setErreur(e?.message || 'Cette page ne peut pas être affichée.');
    } finally {
      setChargement(false);
    }
  }, [page, zoom]);

  useEffect(() => {
    if (pages) dessiner();
  }, [pages, dessiner]);

  if (erreur) {
    return (
      <Alerte ton="alerte" titre="Aperçu impossible" className="m-5">
        {erreur} Vous pouvez tout de même le télécharger.
      </Alerte>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-trait px-3 py-2">
        <Bouton variante="fantome" taille="icone" aria-label="Page précédente" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          <ChevronLeft className="size-4" aria-hidden />
        </Bouton>
        <span className="chiffres text-[13px] text-encre-2" aria-live="polite">
          {pages ? `Page ${page} / ${pages}` : 'Ouverture…'}
        </span>
        <Bouton variante="fantome" taille="icone" aria-label="Page suivante" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
          <ChevronRight className="size-4" aria-hidden />
        </Bouton>
        <div className="ml-auto flex items-center gap-1">
          <Bouton variante="fantome" taille="icone" aria-label="Réduire" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>
            <ZoomOut className="size-4" aria-hidden />
          </Bouton>
          <span className="chiffres w-12 text-center text-[12.5px] text-encre-3">{Math.round(zoom * 100)} %</span>
          <Bouton variante="fantome" taille="icone" aria-label="Agrandir" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
            <ZoomIn className="size-4" aria-hidden />
          </Bouton>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto bg-surface-2 p-4">
        {chargement && (
          <div className="absolute inset-0 grid place-items-center" role="status" aria-label="Chargement de la page">
            <LoaderCircle className="size-6 animate-spin text-cyan" aria-hidden />
          </div>
        )}
        <canvas ref={canevas} className="mx-auto rounded-lg bg-white shadow-carte" aria-label={`Page ${page} de ${titre}`} />
      </div>
    </div>
  );
}
