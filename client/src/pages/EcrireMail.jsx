/**
 * Écrire à un client (§10).
 *
 * Une fenêtre de rédaction ordinaire : destinataires, objet, message, et des
 * pièces prises dans le fonds plutôt que sur le disque — c'est la différence
 * avec une boîte mail classique. Joindre un document déjà versé garde le lien
 * entre ce qui est parti et ce qui est archivé.
 *
 * En réponse, l'objet et le destinataire sont pré-remplis, et le message part
 * dans le fil d'origine : chez le client, il se range sous sa question.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Search, Send, X } from 'lucide-react';
import { api, ErreurApi } from '../api.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection } from '../ui/Champ.jsx';
import { Alerte, Badge } from '../ui/Elements.jsx';
import { Modale } from '../ui/Modale.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';

/** Retire les préfixes de réponse déjà là : « RE: RE: » n'aide personne. */
function objetDeReponse(objet) {
  return /^re\s*:/i.test(objet ?? '') ? objet : `RE: ${objet ?? ''}`;
}

/** Les adresses d'où ce client nous a déjà écrit. */
function adressesVues(mails) {
  const vues = (mails ?? []).filter((m) => m.direction === 'recu').map((m) => m.expediteur);
  return [...new Set(vues)].slice(0, 6);
}

export function EcrireMail({ ouverte, surFermer, repondA = null, clientInitial = null, marcheInitial = null }) {
  const fileAttente = useQueryClient();
  const { notifier } = useToasts();

  const [a, setA] = useState(repondA ? [repondA.expediteur] : []);
  const [saisieA, setSaisieA] = useState('');
  const [objet, setObjet] = useState(repondA ? objetDeReponse(repondA.objet) : '');
  const [texte, setTexte] = useState('');
  const [clientId, setClientId] = useState(repondA?.client?.id ?? clientInitial ?? '');
  const [marcheId, setMarcheId] = useState(repondA?.marche?.id ?? marcheInitial ?? '');
  const [documentIds, setDocumentIds] = useState([]);
  const [chercheDocument, setChercheDocument] = useState(false);
  const [erreurs, setErreurs] = useState({});

  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api('/api/clients'), enabled: ouverte });
  const marches = useQuery({ queryKey: ['marches'], queryFn: () => api('/api/marches'), enabled: ouverte });
  const comptes = useQuery({ queryKey: ['comptes-mail-envoi'], queryFn: () => api('/api/comptes-mail'), enabled: ouverte, retry: false });

  const envoyer = useMutation({
    mutationFn: (corps) => api('/api/mails', { methode: 'POST', corps }),
    onSuccess: () => {
      // L'envoi est archivé côté serveur : la liste le montre aussitôt.
      fileAttente.invalidateQueries({ queryKey: ['conversations'] });
      fileAttente.invalidateQueries({ queryKey: ['mails'] });
      notifier({ titre: 'Message envoyé', message: 'Il apparaît dans les échanges.', ton: 'ok' });
      surFermer();
    },
    onError: (e) => {
      setErreurs(e instanceof ErreurApi ? e.erreurs : {});
      notifier({ titre: "L'envoi a échoué", message: e.message, ton: 'alerte' });
    },
  });

  // Ce que le client nous a déjà écrit vaut mieux qu'une adresse devinée
  // depuis son domaine : on propose les expéditeurs réels de ses messages.
  const echanges = useQuery({
    queryKey: ['mails-du-client', clientId],
    queryFn: () => api(`/api/mails?clientId=${clientId}&direction=recu`),
    enabled: ouverte && Boolean(clientId),
  });
  const suggestions = useMemo(() => adressesVues(echanges.data?.mails), [echanges.data]);

  /** Valide l'adresse en cours de saisie et l'ajoute aux destinataires. */
  function ajouterDestinataire(valeur = saisieA) {
    const propre = valeur.trim().toLowerCase().replace(/[,;]$/, '');
    if (!propre) return;
    if (!a.includes(propre)) setA([...a, propre]);
    setSaisieA('');
  }

  function soumettre(evenement) {
    evenement.preventDefault();
    // Une adresse tapée sans validation ne doit pas être perdue au clic.
    const destinataires = saisieA.trim() ? [...a, saisieA.trim().toLowerCase()] : a;
    setErreurs({});
    envoyer.mutate({
      a: destinataires,
      objet,
      texte,
      documentIds,
      repondA: repondA?.id ?? null,
      clientId: clientId ? Number(clientId) : null,
      marcheId: marcheId ? Number(marcheId) : null,
    });
  }

  const sansCompte = comptes.isSuccess && comptes.data.length === 0;

  return (
    <Modale
      ouverte={ouverte}
      surChangement={(ouvert) => !ouvert && surFermer()}
      largeur="max-w-2xl"
      titre={repondA ? 'Répondre' : 'Écrire à un client'}
      description={repondA ? `Votre réponse se rangera dans le fil « ${repondA.objet} ».` : 'Le message part par la boîte surveillée et reste archivé ici.'}
    >
      {sansCompte ? (
        <Alerte ton="attente" titre="Aucune boîte configurée">
          Ajoutez votre compte Gmail dans Paramètres → Comptes mail avant d’écrire.
        </Alerte>
      ) : (
        <form onSubmit={soumettre} className="grid gap-4">
          {erreurs.envoi && <Alerte ton="alerte" titre="Le serveur a refusé l’envoi">{erreurs.envoi}</Alerte>}

          {/* Destinataires : des jetons, comme dans une boîte mail. */}
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-encre-2">À</span>
            <div className={cx('flex flex-wrap items-center gap-1.5 rounded-[10px] border bg-surface-2 p-1.5', erreurs.a ? 'border-alerte' : 'border-trait focus-within:border-cyan')}>
              {a.map((adresse) => (
                <span key={adresse} className="inline-flex items-center gap-1 rounded-lg bg-cyan-voile px-2 py-1 text-[13px] text-cyan-texte">
                  {adresse}
                  <button type="button" onClick={() => setA(a.filter((x) => x !== adresse))} aria-label={`Retirer ${adresse}`} className="text-cyan-texte/70 hover:text-cyan-texte">
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
              <input
                value={saisieA}
                onChange={(e) => setSaisieA(e.target.value)}
                onKeyDown={(e) => {
                  // Entrée, virgule ou point-virgule valident l'adresse.
                  if (['Enter', ',', ';'].includes(e.key)) {
                    e.preventDefault();
                    ajouterDestinataire();
                  } else if (e.key === 'Backspace' && !saisieA && a.length) {
                    setA(a.slice(0, -1));
                  }
                }}
                onBlur={() => ajouterDestinataire()}
                placeholder={a.length ? '' : 'contact@client.ma'}
                aria-label="Adresse du destinataire"
                className="h-8 min-w-40 flex-1 bg-transparent px-1.5 text-sm focus:outline-none"
              />
            </div>
            {erreurs.a && <p className="mt-1 text-[12.5px] text-alerte">{erreurs.a}</p>}
            {suggestions.length > 0 && a.length === 0 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-encre-3">
                Déjà en contact :
                {suggestions.map((adresse) => (
                  <button key={adresse} type="button" onClick={() => ajouterDestinataire(adresse)} className="rounded border border-trait px-1.5 py-0.5 hover:border-trait-fort">
                    {adresse}
                  </button>
                ))}
              </p>
            )}
          </div>

          <Champ libelle="Objet" value={objet} onChange={(e) => setObjet(e.target.value)} erreur={erreurs.objet} required />

          <div>
            <label htmlFor="corps-message" className="mb-1.5 block text-[13px] font-medium text-encre-2">
              Message
            </label>
            <textarea
              id="corps-message"
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              rows={9}
              required
              className={cx(
                'w-full rounded-[10px] border bg-surface-2 p-3 text-sm leading-relaxed focus:outline-none',
                erreurs.texte ? 'border-alerte' : 'border-trait focus:border-cyan',
              )}
            />
            {erreurs.texte && <p className="mt-1 text-[12.5px] text-alerte">{erreurs.texte}</p>}
          </div>

          {/* Le rattachement : l'échange rejoint le dossier du marché. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Selection libelle="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— aucun —</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </Selection>
            <Selection libelle="Marché" value={marcheId} onChange={(e) => setMarcheId(e.target.value)}>
              <option value="">— aucun —</option>
              {(marches.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.reference}
                </option>
              ))}
            </Selection>
          </div>

          <PiecesJointes
            documentIds={documentIds}
            surChangement={setDocumentIds}
            ouvertChercheur={chercheDocument}
            surChercheur={setChercheDocument}
            marcheId={marcheId}
          />

          <div className="mt-2 flex items-center justify-end gap-2">
            <Bouton type="button" variante="fantome" onClick={surFermer}>
              Annuler
            </Bouton>
            <Bouton type="submit" icone={Send} chargement={envoyer.isPending} libelleChargement="Envoi…">
              Envoyer
            </Bouton>
          </div>
        </form>
      )}
    </Modale>
  );
}

/**
 * Les pièces jointes, choisies dans le fonds.
 *
 * On ne téléverse rien : joindre un document déjà versé évite un deuxième
 * exemplaire dans le stockage, et garde la trace de ce qui est parti.
 */
function PiecesJointes({ documentIds, surChangement, ouvertChercheur, surChercheur, marcheId }) {
  const [recherche, setRecherche] = useState('');

  // Par défaut on propose les pièces du marché choisi : c'est presque
  // toujours ce qu'on veut envoyer.
  const requete = new URLSearchParams();
  if (recherche.trim()) requete.set('q', recherche.trim());
  else if (marcheId) requete.set('marcheId', String(marcheId));

  const documents = useQuery({
    queryKey: ['documents-a-joindre', requete.toString()],
    queryFn: () => api(`/api/documents?${requete}`),
    enabled: ouvertChercheur,
  });

  const choisis = useQuery({
    queryKey: ['documents-choisis', documentIds.join(',')],
    queryFn: async () => Promise.all(documentIds.map((id) => api(`/api/documents/${id}`))),
    enabled: documentIds.length > 0,
  });

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-encre-2">Pièces jointes</span>
        <button type="button" onClick={() => surChercheur(!ouvertChercheur)} className="text-[13px] font-medium text-cyan-texte hover:underline">
          {ouvertChercheur ? 'Fermer' : 'Joindre un document'}
        </button>
      </div>

      {(choisis.data ?? []).length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {(choisis.data ?? []).map((d) => (
            <li key={d.id}>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-trait px-2.5 py-1.5 text-[13px]">
                <Paperclip className="size-3.5 text-encre-3" aria-hidden />
                {d.titre}
                <button type="button" onClick={() => surChangement(documentIds.filter((x) => x !== d.id))} aria-label={`Retirer ${d.titre}`} className="text-encre-3 hover:text-encre">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {ouvertChercheur && (
        <div className="rounded-[10px] border border-trait bg-surface-2 p-3">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-3" aria-hidden />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={marcheId ? 'Chercher ailleurs que dans ce marché…' : 'Titre, référence…'}
              aria-label="Chercher un document à joindre"
              className="h-9 w-full rounded-lg border border-trait bg-surface pr-3 pl-9 text-sm focus:border-cyan focus:outline-none"
            />
          </div>

          {documents.isPending ? (
            <p className="p-2 text-[13px] text-encre-3">Recherche…</p>
          ) : (documents.data?.documents ?? []).length === 0 ? (
            <p className="p-2 text-[13px] text-encre-3">Aucun document trouvé.</p>
          ) : (
            <ul className="max-h-48 divide-y divide-trait overflow-auto">
              {(documents.data?.documents ?? []).map((d) => {
                const dejaLa = documentIds.includes(d.id);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      disabled={dejaLa}
                      onClick={() => surChangement([...documentIds, d.id])}
                      className={cx('flex w-full items-center gap-2 px-2 py-2 text-left text-[13px]', dejaLa ? 'text-encre-3' : 'hover:bg-surface')}
                    >
                      <Paperclip className="size-3.5 shrink-0 text-encre-3" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{d.titre}</span>
                      {d.marche && <Badge ton="cyan">{d.marche.reference}</Badge>}
                      {dejaLa && <span className="text-[12px]">joint</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
