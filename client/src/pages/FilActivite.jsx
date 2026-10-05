/**
 * Le fil d'activité d'une fiche, sur le modèle du « chatter » d'Odoo.
 *
 * Sous la fiche d'un marché ou d'un client : une note interne à écrire, puis
 * tout ce qui s'y est passé, du plus récent au plus ancien — notes, fiches
 * modifiées (avec l'ancienne et la nouvelle valeur), vie des pièces, mails.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, History, Mail, MailOpen, Paperclip, Send, StickyNote } from 'lucide-react';
import { api } from '../api.js';
import { dateHeure } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Carte, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';

/** « Aujourd'hui », « Hier », ou la date : les séparateurs du fil. */
function jourDe(date) {
  const d = new Date(date);
  const jour = (x) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Africa/Casablanca' }).format(x);
  const aujourdhui = new Date();
  const hier = new Date(Date.now() - 86_400_000);
  if (jour(d) === jour(aujourdhui)) return 'Aujourd’hui';
  if (jour(d) === jour(hier)) return 'Hier';
  return jour(d);
}

const heure = (date) => new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: 'Africa/Casablanca' }).format(new Date(date));

/** Un mail du fil : son objet, ses pièces jointes, et son contenu à déplier. */
function ElementMail({ e }) {
  const [ouvert, setOuvert] = useState(false);
  const recu = e.direction === 'recu';
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[14px]">
        <span className="font-semibold">{recu ? e.expediteur : 'Mail envoyé'}</span>
        <span className="text-encre-3"> · {recu ? 'mail reçu' : `à ${e.destinataires.join(', ')}`} · {heure(e.date)}</span>
      </p>
      <p className="mt-0.5 font-medium">{e.objet}</p>
      {e.piecesJointes.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
          {e.piecesJointes.map((p) =>
            p.documentId ? (
              <Link key={p.id} to={`/documents/${p.documentId}`} className="inline-flex items-center gap-1 text-cyan-texte hover:underline">
                <Paperclip className="size-3.5" aria-hidden /> {p.nom}
              </Link>
            ) : (
              <span key={p.id} className="inline-flex items-center gap-1 text-encre-3">
                <Paperclip className="size-3.5" aria-hidden /> {p.nom}
              </span>
            ),
          )}
        </p>
      )}
      <button type="button" onClick={() => setOuvert((o) => !o)} className="mt-1 text-[13px] font-semibold text-cyan-texte hover:underline">
        {ouvert ? 'Replier' : 'Lire le message'}
      </button>
      {/* Le corps vient de l'extérieur : il s'affiche isolé, sans script (§13). */}
      {ouvert && <iframe title={e.objet} src={`/api/mails/${e.mailId}/corps`} sandbox="" className="mt-2 h-72 w-full rounded-lg border border-trait bg-white" />}
    </div>
  );
}

/** Une note interne ou une modification. */
function ElementSuivi({ e }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[14px]">
        <span className="font-semibold">{e.par}</span>
        {e.genre === 'note' ? <span className="text-encre-3"> · note interne · {heure(e.date)}</span> : <> {e.texte} <span className="text-encre-3">· {heure(e.date)}</span></>}
      </p>
      {e.genre === 'note' && <p className="mt-1 rounded-lg bg-attente-voile px-3 py-2 text-[14px] whitespace-pre-line">{e.texte}</p>}
      {e.changements?.length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-[13px]">
          {e.changements.map((c) => (
            <li key={c.champ} className="flex flex-wrap items-center gap-1.5">
              {c.avant !== null && <span className="text-encre-3 line-through decoration-encre-3/50">{c.avant}</span>}
              {c.avant !== null && <ArrowRight className="size-3.5 text-encre-3" aria-hidden />}
              <span className="font-medium">{c.apres}</span>
              <span className="text-encre-3">({c.champ})</span>
            </li>
          ))}
        </ul>
      )}
      {e.commentaire && <p className="mt-1 text-[13px] text-encre-2 italic">« {e.commentaire} »</p>}
      {e.pieceId && (
        <Link to={`/documents/${e.pieceId}`} className="mt-0.5 inline-block text-[13px] text-cyan-texte hover:underline">
          Ouvrir la pièce
        </Link>
      )}
    </div>
  );
}

const ICONES = {
  note: { Icone: StickyNote, classe: 'bg-attente-voile text-attente' },
  suivi: { Icone: History, classe: 'bg-surface-2 text-encre-3' },
  mail: { Icone: Mail, classe: 'bg-cyan-voile text-cyan-texte' },
};

/**
 * @param {{ type: 'marche' | 'client', id: number | string, className?: string }} props
 */
export function FilActivite({ type, id, className }) {
  const cle = ['fil', type, String(id)];
  const fil = useQuery({ queryKey: cle, queryFn: () => api(`/api/fil/${type}/${id}`) });
  const [texte, setTexte] = useState('');
  const file = useQueryClient();
  const { notifier } = useToasts();

  const noter = useMutation({
    mutationFn: () => api(`/api/fil/${type}/${id}/notes`, { methode: 'POST', corps: { texte } }),
    onSuccess: () => {
      setTexte('');
      file.invalidateQueries({ queryKey: cle });
    },
    onError: (erreur) => notifier({ titre: 'Note non enregistrée', message: erreur.message, ton: 'alerte' }),
  });

  // Les éléments regroupés par jour, comme dans Odoo.
  const jours = [];
  for (const e of fil.data?.elements ?? []) {
    const j = jourDe(e.date);
    if (jours.at(-1)?.jour === j) jours.at(-1).elements.push(e);
    else jours.push({ jour: j, elements: [e] });
  }

  return (
    <Carte id="fil-activite" className={cx('scroll-mt-20', className)}>
      <div className="border-b border-trait px-5 py-4">
        <h2 className="mb-3 font-semibold">Fil d’activité</h2>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (texte.trim()) noter.mutate();
          }}
          className="grid gap-2"
        >
          <label htmlFor={`note-${type}-${id}`} className="sr-only">
            Écrire une note interne
          </label>
          <textarea
            id={`note-${type}-${id}`}
            value={texte}
            onChange={(ev) => setTexte(ev.target.value)}
            rows={2}
            placeholder="Écrire une note interne pour les collègues…"
            className="w-full resize-y rounded-[10px] border border-trait bg-surface-2 px-3.5 py-2.5 text-[14.5px] leading-relaxed placeholder:text-encre-3 focus:border-cyan focus:bg-surface focus:outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-encre-3">Visible par tous les utilisateurs, jamais par le client.</p>
            <Bouton type="submit" taille="petit" icone={Send} disabled={!texte.trim()} chargement={noter.isPending} libelleChargement="Envoi…">
              Enregistrer la note
            </Bouton>
          </div>
        </form>
      </div>

      {fil.isPending ? (
        <div className="p-5">
          <SqueletteLignes lignes={4} />
        </div>
      ) : fil.isError ? (
        <Alerte ton="alerte" className="m-5">
          {fil.error.message}
        </Alerte>
      ) : jours.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-[14px] text-encre-3">
          <MailOpen className="size-4" aria-hidden /> Rien encore : les notes, les modifications et les mails apparaîtront ici.
        </p>
      ) : (
        <div className="px-5 py-4">
          {jours.map(({ jour, elements }) => (
            <section key={jour} className="mb-4 last:mb-0">
              <h3 className="mb-3 flex items-center gap-3 font-sans text-[13px] font-semibold text-encre-3">
                <span className="h-px flex-1 bg-trait" />
                <span className="first-letter:uppercase">{jour}</span>
                <span className="h-px flex-1 bg-trait" />
              </h3>
              <ul className="grid gap-4">
                {elements.map((e) => {
                  const { Icone, classe } = ICONES[e.genre];
                  return (
                    <li key={e.id} className="flex gap-3" title={dateHeure(e.date)}>
                      <span className={cx('grid size-8 shrink-0 place-items-center rounded-full', classe)}>
                        <Icone className="size-4" aria-hidden />
                      </span>
                      {e.genre === 'mail' ? <ElementMail e={e} /> : <ElementSuivi e={e} />}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Carte>
  );
}

/**
 * Un bouton de raccourci en haut d'une fiche, comme les « smart buttons »
 * d'Odoo : un chiffre, un libellé, et il mène à la liste.
 */
export function BoutonRaccourci({ icone: Icone, chiffre, libelle, vers, surClic }) {
  const contenu = (
    <>
      <Icone className="size-5 shrink-0 text-cyan-texte" aria-hidden />
      <span className="text-left leading-tight">
        <span className="chiffres block text-[16px] font-semibold text-encre">{chiffre}</span>
        <span className="block text-[13px] text-encre-2">{libelle}</span>
      </span>
    </>
  );
  const classe = 'flex min-w-32 items-center gap-2.5 rounded-[10px] border border-trait bg-surface px-3.5 py-2 transition-colors hover:border-trait-fort hover:bg-surface-2';
  return vers ? (
    <Link to={vers} className={classe}>
      {contenu}
    </Link>
  ) : (
    <button type="button" onClick={surClic} className={classe}>
      {contenu}
    </button>
  );
}

/** Fait défiler jusqu'au fil d'activité de la page. */
export function allerAuFil() {
  document.getElementById('fil-activite')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
