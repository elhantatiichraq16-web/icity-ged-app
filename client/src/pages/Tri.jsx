/**
 * Les deux files du tri (maquettes A11 et A13) : « À classer » et « À vérifier ».
 *
 * Le classement automatique écrit seul ce dont il est sûr. Ces écrans ne lui
 * font pas valider son travail : ils montrent ce qu'il a laissé, pour qu'un
 * humain le finisse — « une pièce non classée se voit ».
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CopyCheck, FileQuestion, FolderInput, Plus, RotateCw, ScanLine, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { depuis } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Selection } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { useToasts } from '../ui/Toasts.jsx';
import { CLE_MARCHES } from './Marches.jsx';
import { CLES_APRES_RANGEMENT, libelleAffaire } from './ModifierPiece.jsx';

/** Ranger une pièce : même route que la fiche, mêmes listes à relire ensuite. */
function useRanger() {
  const file = useQueryClient();
  const { notifier } = useToasts();
  return useMutation({
    mutationFn: ({ id, corps }) => api(`/api/documents/${id}`, { methode: 'PATCH', corps }),
    onSuccess: (piece) => {
      for (const cle of CLES_APRES_RANGEMENT) file.invalidateQueries({ queryKey: cle });
      notifier({
        titre: 'Pièce rangée',
        message: piece.marche ? `« ${piece.titre} » rejoint ${piece.marche.reference}.` : `« ${piece.titre} » reste sans marché, à votre demande.`,
        ton: 'ok',
      });
    },
    onError: (e) => notifier({ titre: 'Rangement refusé', message: e.message, ton: 'alerte' }),
  });
}

// ── À classer ─────────────────────────────────────────────────────

export function PageAClasser() {
  const file = useQuery({ queryKey: ['a-classer'], queryFn: () => api('/api/a-classer') });
  const marches = useQuery({ queryKey: CLE_MARCHES, queryFn: () => api('/api/marches') });
  const referentiels = useQuery({ queryKey: ['referentiels'], queryFn: () => api('/api/referentiels') });
  const affaires = [...(marches.data ?? [])].sort((a, b) => a.reference.localeCompare(b.reference, 'fr', { numeric: true }));
  const types = referentiels.data?.types ?? [];

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="À classer"
        description="Ce que le classement automatique n’a pas su ranger : des pièces sans marché ou sans type. Les indices viennent de la lecture ; rien n’est écrit sans votre clic."
        actions={file.data && <Badge ton={file.data.total ? 'attente' : 'ok'}>{file.data.total} à classer</Badge>}
      />

      {file.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={4} />
        </Carte>
      ) : file.isError ? (
        <Alerte ton="alerte">{file.error.message}</Alerte>
      ) : (
        <>
          {file.data.enLecture > 0 && (
            <Alerte ton="info" className="mb-4">
              {file.data.enLecture} pièce(s) attendent encore leur lecture : elles seront classées automatiquement après, et n’apparaîtront ici que si la machine
              n’y arrive pas.
            </Alerte>
          )}
          {file.data.pieces.length === 0 ? (
            <Carte>
              <EtatVide titre="Tout est rangé">Chaque pièce lue a son marché et son type. Les prochaines arriveront ici si le classement ne sait pas les ranger.</EtatVide>
            </Carte>
          ) : (
            <ul className="grid gap-3">
              {file.data.pieces.map((p) => (
                <LignePiece key={p.id} piece={p} affaires={affaires} types={types} />
              ))}
            </ul>
          )}
          {file.data.total > file.data.pieces.length && (
            <p className="mt-4 text-center text-[13px] text-encre-3">
              {file.data.pieces.length} pièces affichées sur {file.data.total} : les suivantes apparaîtront au fur et à mesure.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function LignePiece({ piece: p, affaires, types }) {
  const aller = useNavigate();
  const ranger = useRanger();
  const marcheInitial = p.marche ? String(p.marche.id) : '';
  const typeInitial = p.type ? String(p.type.id) : '';
  const [marcheId, setMarcheId] = useState(marcheInitial);
  const [typeId, setTypeId] = useState(typeInitial);
  const change = marcheId !== marcheInitial || typeId !== typeInitial;
  const { reference, client } = p.indices;
  // Un type reconnu n'est un indice que si la pièce n'en a pas encore.
  const type = p.type ? null : p.indices.type;

  /** N'envoie que ce qui change : un client vide suit alors le marché choisi. */
  function enregistrer() {
    const corps = {};
    if (marcheId !== marcheInitial) corps.marcheId = marcheId ? Number(marcheId) : null;
    if (typeId !== typeInitial) corps.typeDocumentId = typeId ? Number(typeId) : null;
    ranger.mutate({ id: p.id, corps });
  }

  // La référence lue ne correspond à aucune affaire : on propose de la créer,
  // avec le client reconnu s'il y en a un.
  const creerAffaire = () => {
    const parametres = new URLSearchParams({ reference: reference.texte });
    const idClient = p.client?.id ?? client?.id;
    if (idClient) parametres.set('clientId', String(idClient));
    aller(`/marches/nouveau?${parametres}`);
  };

  return (
    <li>
      <Carte className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/documents/${p.id}`} className="font-semibold hover:text-cyan-texte hover:underline">
              {p.titre}
            </Link>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-encre-3">
              {!p.marche && <Badge ton="attente">sans marché</Badge>}
              {!p.type && <Badge ton="attente">sans type</Badge>}
              {p.marche && <span>{p.marche.reference}</span>}
              {p.type && <span>{p.type.nom}</span>}
              {p.client && <span>{p.client.nom}</span>}
              <span>{p.pages ?? '—'} p. · versée {depuis(p.creeLe)}</span>
            </p>
          </div>
        </div>

        {(reference || type || client) && (
          <div className="mt-3 grid gap-1.5 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px]">
            {reference && (
              <p className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-3.5 text-cyan-texte" aria-hidden />
                Référence lue : <strong className="chiffres">{reference.texte}</strong>
                <span className="text-encre-3">(citée {reference.citations} fois)</span>
                {/* Le classement automatique ne range rien dans un marché
                    archivé : il le signale, et l'humain décide. */}
                {reference.marche?.archive && !p.marche && <Badge>marché archivé</Badge>}
                {reference.marche && !p.marche ? (
                  <Bouton taille="petit" variante="secondaire" icone={FolderInput} disabled={ranger.isPending} onClick={() => ranger.mutate({ id: p.id, corps: { marcheId: reference.marche.id } })}>
                    Rattacher à {reference.marche.reference}
                  </Bouton>
                ) : (
                  !reference.marche && (
                    <Bouton taille="petit" variante="secondaire" icone={Plus} onClick={creerAffaire}>
                      Créer l’affaire {reference.texte}
                    </Bouton>
                  )
                )}
              </p>
            )}
            {type && (
              <p className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-3.5 text-cyan-texte" aria-hidden />
                Type reconnu : <strong>{type.nom}</strong>
                <Bouton taille="petit" variante="secondaire" disabled={ranger.isPending} onClick={() => ranger.mutate({ id: p.id, corps: { typeDocumentId: type.id } })}>
                  Appliquer
                </Bouton>
              </p>
            )}
            {client && (
              <p className="flex items-center gap-2 text-encre-2">
                <Building2 className="size-3.5 text-encre-3" aria-hidden />
                Client probable : {client.nom}
              </p>
            )}
          </div>
        )}

        <div className="mt-3 grid items-end gap-3 sm:grid-cols-[2fr_1.3fr_auto_auto]">
          <Selection libelle="Marché" value={marcheId} onChange={(e) => setMarcheId(e.target.value)}>
            <option value="">— sans marché —</option>
            {affaires.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {libelleAffaire(m)}
              </option>
            ))}
          </Selection>
          <Selection libelle="Type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">— sans type —</option>
            {types.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.nom}
              </option>
            ))}
          </Selection>
          <Bouton chargement={ranger.isPending} libelleChargement="…" disabled={!change} onClick={enregistrer}>
            Ranger
          </Bouton>
          {/* Une pièce sans affaire (comptabilité, courrier général) : on le dit
              une fois, elle ne reviendra plus dans la file. */}
          <Bouton variante="fantome" disabled={ranger.isPending} onClick={() => ranger.mutate({ id: p.id, corps: { marcheId: null } })}>
            Laisser sans marché
          </Bouton>
        </div>
      </Carte>
    </li>
  );
}

// ── À vérifier ────────────────────────────────────────────────────

export function PageAVerifier() {
  const donnees = useQuery({ queryKey: ['a-verifier'], queryFn: () => api('/api/a-verifier') });
  const marches = useQuery({ queryKey: CLE_MARCHES, queryFn: () => api('/api/marches') });
  const referentiels = useQuery({ queryKey: ['referentiels'], queryFn: () => api('/api/referentiels') });
  const affaires = [...(marches.data ?? [])].sort((a, b) => a.reference.localeCompare(b.reference, 'fr', { numeric: true }));
  const d = donnees.data;
  const total = d ? d.doublons.length + d.lectures.length + d.attestations.length + d.affairesSansClient.length : 0;

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="À vérifier"
        description="Ce qui demande un œil humain : doublons probables, lectures ratées, attestations dont le numéro de marché ne se lit pas, affaires sans client."
        actions={d && <Badge ton={total ? 'attente' : 'ok'}>{total} point(s)</Badge>}
      />

      {donnees.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={5} />
        </Carte>
      ) : donnees.isError ? (
        <Alerte ton="alerte">{donnees.error.message}</Alerte>
      ) : (
        <div className="grid gap-5">
          {d.aClasser > 0 && (
            <Alerte ton="info">
              {d.aClasser} pièce(s) attendent aussi d’être rangées :{' '}
              <Link to="/a-classer" className="font-semibold text-cyan-texte hover:underline">
                ouvrir « À classer »
              </Link>
              .
            </Alerte>
          )}
          {total === 0 ? (
            <Carte>
              <EtatVide titre="Rien à vérifier">Aucun doublon à trancher, aucune lecture ratée, aucune attestation orpheline.</EtatVide>
            </Carte>
          ) : (
            <>
              <SectionDoublons doublons={d.doublons} />
              <SectionLectures lectures={d.lectures} />
              {d.attestations.length > 0 && (
                <section>
                  <h2 className="mb-1 flex items-center gap-2 font-semibold">
                    <FileQuestion className="size-4 text-encre-3" aria-hidden /> Attestations sans marché <Badge ton="attente">{d.attestations.length}</Badge>
                  </h2>
                  <p className="mb-3 text-[13px] text-encre-3">
                    Leur numéro de marché ne se lit pas. Rattachez-les, ou laissez sans marché celles dont l’affaire n’a jamais été numérisée : elles ne reviendront plus.
                  </p>
                  <ul className="grid gap-3">
                    {d.attestations.map((a) => (
                      <LignePiece key={a.id} piece={a} affaires={affaires} types={referentiels.data?.types ?? []} />
                    ))}
                  </ul>
                </section>
              )}
              <Section titre="Affaires sans client" icone={Building2} nombre={d.affairesSansClient.length} explication="Choisissez le client dans l’onglet « Informations » de la fiche.">
                {d.affairesSansClient.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Link to={`/marches/${m.id}`} className="chiffres font-medium hover:text-cyan-texte hover:underline">
                      {m.reference}
                    </Link>
                    {m.objet && <span className="min-w-0 flex-1 truncate text-[13px] text-encre-2">{m.objet}</span>}
                  </li>
                ))}
              </Section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ titre, icone: Icone, nombre, explication, children }) {
  if (!nombre) return null;
  return (
    <Carte>
      <div className="border-b border-trait px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icone className="size-4 text-encre-3" aria-hidden /> {titre} <Badge ton="attente">{nombre}</Badge>
        </h2>
        {explication && <p className="mt-1 text-[13px] text-encre-3">{explication}</p>}
      </div>
      <ul className="divide-y divide-trait">{children}</ul>
    </Carte>
  );
}

function SectionDoublons({ doublons }) {
  const file = useQueryClient();
  const { notifier } = useToasts();
  const trancher = useMutation({
    mutationFn: ({ id, corps }) => api(`/api/doublons/${id}/decision`, { methode: 'POST', corps }),
    onSuccess: (r, { corps }) => {
      for (const cle of [...CLES_APRES_RANGEMENT, ['corbeille']]) file.invalidateQueries({ queryKey: cle });
      notifier(
        corps.decision === 'gardes'
          ? { titre: 'Les deux pièces sont gardées', message: 'Cette paire ne sera plus signalée.', ton: 'ok' }
          : { titre: 'Doublon mis en corbeille', message: 'Son marché, son type et ses étiquettes ont rejoint la pièce gardée.', ton: 'ok' },
      );
    },
    onError: (e) => notifier({ titre: 'Décision non enregistrée', message: e.message, ton: 'alerte' }),
  });

  const lien = (piece) => (
    <Link to={`/documents/${piece.id}`} className="font-medium hover:text-cyan-texte hover:underline">
      {piece.titre}
    </Link>
  );

  return (
    <Section titre="Doublons probables" icone={CopyCheck} nombre={doublons.length} explication="Ce qu’on écarte passe en corbeille trente jours ; son marché, son type et ses étiquettes rejoignent la pièce gardée.">
      {doublons.map((p) => (
        <li key={p.id} className="grid gap-2 px-5 py-3.5">
          <p className="text-[13.5px]">
            {lien(p.a)} <span className="text-encre-3">et</span> {lien(p.b)}{' '}
            <Badge ton="attente">{p.score} %</Badge>
          </p>
          {p.raisons.length > 0 && <p className="text-[13px] text-encre-3">{p.raisons.join(' · ')}</p>}
          <div className="flex flex-wrap gap-2">
            <Bouton taille="petit" variante="secondaire" disabled={trancher.isPending} onClick={() => trancher.mutate({ id: p.id, corps: { decision: 'gardes' } })}>
              Garder les deux
            </Bouton>
            <Bouton taille="petit" variante="secondaire" icone={Trash2} disabled={trancher.isPending} onClick={() => trancher.mutate({ id: p.id, corps: { decision: 'supprime', garderId: p.a.id } })}>
              Garder la première
            </Bouton>
            <Bouton taille="petit" variante="secondaire" icone={Trash2} disabled={trancher.isPending} onClick={() => trancher.mutate({ id: p.id, corps: { decision: 'supprime', garderId: p.b.id } })}>
              Garder la seconde
            </Bouton>
          </div>
        </li>
      ))}
    </Section>
  );
}

function SectionLectures({ lectures }) {
  const file = useQueryClient();
  const { notifier } = useToasts();
  const relire = useMutation({
    mutationFn: (id) => api(`/api/documents/${id}/relire`, { methode: 'POST' }),
    onSuccess: () => {
      for (const cle of [['a-verifier'], ['documents'], ['notifications']]) file.invalidateQueries({ queryKey: cle });
      notifier({ titre: 'Relecture demandée', message: 'Le worker la reprendra à son prochain passage, dans les deux minutes.', ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Relecture impossible', message: e.message, ton: 'alerte' }),
  });

  return (
    <Section
      titre="Lectures à reprendre"
      icone={ScanLine}
      nombre={lectures.length}
      explication="L’OCR n’a rien tiré d’utile : page blanche, photo, ou scan à l’envers. Relancez après avoir remplacé ou redressé le fichier."
    >
      {lectures.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
          <Link to={`/documents/${l.id}`} className="min-w-0 flex-1 truncate hover:text-cyan-texte hover:underline">
            {l.titre}
          </Link>
          <Badge ton={l.statutOcr === 'echec' ? 'alerte' : 'attente'}>{l.statutOcr === 'echec' ? 'lecture échouée' : 'illisible'}</Badge>
          <Bouton taille="petit" variante="secondaire" icone={RotateCw} disabled={relire.isPending} onClick={() => relire.mutate(l.id)}>
            Relire
          </Bouton>
        </li>
      ))}
    </Section>
  );
}
