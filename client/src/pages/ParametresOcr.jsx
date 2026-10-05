/**
 * L'état de la lecture automatique (§6).
 *
 * Un PDF né d'un traitement de texte porte déjà son texte ; un scan n'est
 * qu'une image, et sans OCR il reste introuvable par la recherche. Cet écran
 * dit où en est cette lecture — et, si l'outil manque, le dit franchement
 * plutôt que de laisser chercher pourquoi un scan versé reste muet.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Play, ScanText } from 'lucide-react';
import { api } from '../api.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Badge, Carte, SqueletteLignes } from '../ui/Elements.jsx';
import { useToasts } from '../ui/Toasts.jsx';

/** Ce que raconte chaque état, dans l'ordre où on veut les lire. */
const ETATS = [
  { cle: 'non_necessaire', libelle: 'Texte déjà présent', ton: 'ok', aide: 'Le PDF portait son texte : aucune lecture nécessaire.' },
  { cle: 'fait', libelle: 'Lu par l’OCR', ton: 'ok', aide: 'L’image a été déchiffrée, le texte est cherchable.' },
  { cle: 'en_attente', libelle: 'En attente', ton: 'attente', aide: 'Ces pièces attendent leur tour.' },
  { cle: 'en_cours', libelle: 'En cours', ton: 'cyan', aide: 'Lecture en train de se faire.' },
  { cle: 'illisible', libelle: 'Illisible', ton: 'attente', aide: 'L’outil a fonctionné mais n’a presque rien tiré : photo, plan ou cachet.' },
  { cle: 'echec', libelle: 'En échec', ton: 'alerte', aide: 'La lecture s’est interrompue sur une erreur.' },
];

export function ParametresOcr() {
  const file = useQueryClient();
  const { notifier } = useToasts();

  const etat = useQuery({
    queryKey: ['ocr'],
    queryFn: () => api('/api/ocr'),
    // Pendant une lecture, les compteurs bougent : on les rafraîchit.
    refetchInterval: (q) => (q.state.data?.reste > 0 ? 5000 : false),
  });

  const relancer = useMutation({
    mutationFn: () => api('/api/ocr/relancer', { methode: 'POST' }),
    onSuccess: (b) => {
      file.invalidateQueries({ queryKey: ['ocr'] });
      file.invalidateQueries({ queryKey: ['documents'] });
      notifier({
        titre: b.traites ? `${b.traites} pièce(s) lue(s)` : 'Rien à lire',
        message: b.traites ? `${b.lus} avec texte, ${b.illisibles} illisible(s), ${b.echecs} en échec.` : 'La file est vide.',
        ton: 'ok',
      });
    },
    onError: (e) => notifier({ titre: 'Lecture impossible', message: e.message, ton: 'alerte' }),
  });

  if (etat.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={5} />
      </Carte>
    );
  }
  if (etat.isError) return <Alerte ton="alerte">{etat.error.message}</Alerte>;

  const { outil, reste, parStatut } = etat.data;
  const manquantes = outil.languesVoulues.filter((l) => outil.ok && !outil.langues.includes(l));

  return (
    <div className="grid gap-5">
      {/* L'outil d'abord : sans lui, le reste de l'écran n'a pas de sens. */}
      <Carte className="p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {outil.ok ? <CircleCheck className="size-5 text-ok" aria-hidden /> : <CircleX className="size-5 text-alerte" aria-hidden />}
          <h2 className="font-titre flex-1 text-lg font-semibold">Lecture automatique</h2>
          <Badge ton={outil.ok ? 'ok' : 'alerte'}>{outil.ok ? 'Disponible' : 'Indisponible'}</Badge>
        </div>

        {outil.ok ? (
          <>
            <p className="text-sm text-encre-2">
              {outil.version} — langues installées : <strong>{outil.langues.join(', ') || 'aucune'}</strong>
            </p>
            {manquantes.length > 0 && (
              <Alerte ton="attente" className="mt-3" titre="Des langues manquent">
                L’application attend <strong>{manquantes.join(', ')}</strong>, qui ne {manquantes.length > 1 ? 'sont' : 'est'} pas
                installée{manquantes.length > 1 ? 's' : ''}. Les documents dans cette langue seront mal lus.
              </Alerte>
            )}
          </>
        ) : (
          <Alerte ton="alerte" titre="Tesseract n’est pas installé">
            <p className="mb-2">
              {outil.motif}. Les PDF qui portent déjà leur texte restent cherchables, mais un <strong>scan</strong> versé
              maintenant ne le sera jamais : il attendra indéfiniment.
            </p>
            <p className="text-[13px]">
              Installez Tesseract avec les langues <strong>{outil.languesVoulues.join(', ')}</strong>, puis relancez
              l’application. Les pièces en attente repartiront d’elles-mêmes — rien n’est perdu.
            </p>
          </Alerte>
        )}
      </Carte>

      <Carte className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <ScanText className="size-5 text-encre-3" aria-hidden />
          <h2 className="font-titre flex-1 text-lg font-semibold">État du fonds</h2>
          {reste > 0 && outil.ok && (
            <Bouton
              variante="secondaire"
              taille="petit"
              icone={Play}
              chargement={relancer.isPending}
              libelleChargement="Lecture…"
              onClick={() => relancer.mutate()}
            >
              Lire maintenant
            </Bouton>
          )}
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          {ETATS.map((e) => {
            const n = parStatut[e.cle] ?? 0;
            return (
              <div key={e.cle} className={cxLigne(n)}>
                <dt className="flex items-center gap-2">
                  <Badge ton={n > 0 ? e.ton : 'neutre'}>{n}</Badge>
                  <span className="text-sm font-medium">{e.libelle}</span>
                </dt>
                <dd className="mt-1 text-[13px] text-encre-3">{e.aide}</dd>
              </div>
            );
          })}
        </dl>

        {reste > 0 && (
          <p className="mt-4 text-[13px] text-encre-2">
            {reste} pièce{reste > 1 ? 's' : ''} en attente de lecture.{' '}
            {outil.ok ? 'Le worker les traite une par une, toutes les deux minutes.' : 'Elles attendront l’installation de Tesseract.'}
          </p>
        )}
      </Carte>
    </div>
  );
}

/** Une ligne pâlit quand son compteur est à zéro : l'œil va à ce qui compte. */
function cxLigne(n) {
  return n > 0 ? 'rounded-[10px] border border-trait p-3' : 'rounded-[10px] border border-trait p-3 opacity-60';
}
