/**
 * La fiche d'un marché (§11, écran 3) : en-tête, progression du cycle,
 * pièces rangées par étape avec les manquantes en rouge, puis les onglets
 * Documents / Échanges / Journal / Informations.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, FileText, X } from 'lucide-react';
import { CONSERVATIONS, ORDRE_PHASES, PHASES, PIECES_CYCLE, STATUTS_AFFAIRE } from '@icity/commun/marches';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateCourte, montant } from '../format.js';
import { useFormulaire } from '../formulaire.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';
import { BadgePhase, CLE_MARCHES } from './Marches.jsx';

const ONGLETS = [
  { cle: 'documents', libelle: 'Documents' },
  { cle: 'echanges', libelle: 'Échanges', phase: 8 },
  { cle: 'journal', libelle: 'Journal', phase: 9 },
  { cle: 'informations', libelle: 'Informations' },
];

export function PageFicheMarche() {
  const { id } = useParams();
  const [onglet, setOnglet] = useState('documents');
  const marche = useQuery({ queryKey: ['marche', id], queryFn: () => api(`/api/marches/${id}`) });

  if (marche.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={5} />
      </Carte>
    );
  }
  if (marche.isError) return <Alerte ton="alerte">{marche.error.message}</Alerte>;

  const m = marche.data;

  return (
    <div className="animate-apparition">
      <Link to="/marches" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-cyan-texte hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Tous les marchés
      </Link>

      <EnTeteMarche m={m} />

      <nav aria-label="Sections de la fiche" className="-mx-1 mt-7 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-trait px-1">
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            type="button"
            onClick={() => setOnglet(o.cle)}
            aria-current={onglet === o.cle ? 'page' : undefined}
            className={cx(
              '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              onglet === o.cle ? 'border-cyan text-cyan-texte' : 'border-transparent text-encre-2 hover:text-encre',
            )}
          >
            {o.libelle}
            {o.cle === 'documents' && <span className="ml-1.5 text-encre-3">{m.documents.length}</span>}
          </button>
        ))}
      </nav>

      {onglet === 'documents' && <OngletDocuments m={m} />}
      {onglet === 'informations' && <OngletInformations m={m} />}
      {(onglet === 'echanges' || onglet === 'journal') && (
        <Carte>
          <EtatVide illustration="chantier" titre={onglet === 'echanges' ? 'Les échanges de ce marché' : 'Le journal de ce marché'}>
            {onglet === 'echanges'
              ? 'Les mails reçus et envoyés au sujet de ce marché apparaîtront ici, par conversation (phase 8).'
              : 'Chaque modification et chaque validation y laisseront une trace (phase 9).'}
          </EtatVide>
        </Carte>
      )}
    </div>
  );
}

function EnTeteMarche({ m }) {
  const etape = ORDRE_PHASES.indexOf(m.phase);
  return (
    <Carte className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h1 className="chiffres text-[26px] leading-tight font-semibold">{m.reference}</h1>
            {m.lot && <Badge>lot {m.lot}</Badge>}
            <BadgePhase phase={m.phase} />
          </div>
          <p className="text-encre-2">
            {m.client ? (
              <Link to={`/clients/${m.client.id}`} className="font-medium text-cyan-texte hover:underline">
                {m.client.nom}
              </Link>
            ) : (
              <span className="text-encre-3">Client à rattacher</span>
            )}
            {m.ville && <span className="text-encre-3"> · {m.ville}</span>}
            {m.objetTechnique && <span className="text-encre-3"> · {m.objetTechnique}</span>}
          </p>
          {m.objet && <p className="mt-2 max-w-2xl">{m.objet}</p>}
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Info libelle="Montant TTC" valeur={montant(m.montantTtc)} />
          <Info libelle="Signature" valeur={dateCourte(m.dateSignature)} />
          <Info libelle="Ordre de service" valeur={dateCourte(m.dateOs)} />
          <Info
            libelle="Échéance"
            valeur={m.echeance ? dateCourte(m.echeance) : '—'}
            ton={m.etatEcheance === 'depassee' ? 'alerte' : m.etatEcheance === 'proche' ? 'attente' : null}
          />
        </dl>
      </div>

      {/* Progression du cycle */}
      <ol className="mt-6 flex flex-wrap gap-1.5" aria-label="Progression du marché">
        {ORDRE_PHASES.map((p, i) => (
          <li key={p} className="flex-1 basis-32">
            <div className={cx('h-1.5 rounded-full', i <= etape ? 'bg-cyan' : 'bg-trait')} />
            <span className={cx('mt-1.5 block text-[11.5px]', i === etape ? 'font-semibold text-encre' : 'text-encre-3')}>{PHASES[p].court}</span>
          </li>
        ))}
      </ol>

      {m.manquantes.length > 0 && (
        <Alerte ton="attente" className="mt-5" titre={`${m.manquantes.length} pièce(s) manquante(s) à ce stade`}>
          {m.manquantes.map((cle) => PIECES_CYCLE.find((p) => p.cle === cle).nom).join(', ')}.
        </Alerte>
      )}
    </Carte>
  );
}

function Info({ libelle, valeur, ton }) {
  return (
    <div>
      <dt className="text-[12px] text-encre-3">{libelle}</dt>
      <dd className={cx('chiffres font-medium', ton === 'alerte' && 'text-alerte', ton === 'attente' && 'text-attente')}>{valeur}</dd>
    </div>
  );
}

/** Les pièces du cycle, dans l'ordre, présentes ou manquantes. */
function OngletDocuments({ m }) {
  const autres = m.documents.filter((d) => !d.type?.ordreCycle);
  return (
    <div className="grid gap-5">
      <Carte className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Les pièces du cycle</h2>
        <ol className="grid gap-2">
          {PIECES_CYCLE.map((p) => {
            const pieces = m.documents.filter((d) => d.type?.code === p.code);
            const manquante = m.manquantes.includes(p.cle);
            return (
              <li
                key={p.cle}
                className={cx(
                  'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
                  pieces.length ? 'border-trait' : manquante ? 'border-alerte bg-alerte-voile' : 'border-dashed border-trait',
                )}
              >
                <span className={cx('grid size-8 shrink-0 place-items-center rounded-lg', pieces.length ? 'bg-ok-voile text-ok' : manquante ? 'bg-alerte-voile text-alerte' : 'bg-surface-2 text-encre-3')}>
                  {pieces.length ? <Check className="size-4" aria-hidden /> : manquante ? <X className="size-4" aria-hidden /> : <span className="text-[11px] font-bold">{p.code}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{p.nom}</p>
                  <p className="text-[12.5px] text-encre-3">
                    {pieces.length ? `${pieces.length} pièce(s) versée(s)` : manquante ? `Manquante — ${p.role}` : `Pas encore attendue — ${p.role}`}
                  </p>
                </div>
                {pieces.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {pieces.map((d) => (
                      <li key={d.id}>
                        <Badge ton="cyan">{d.titre}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </Carte>

      <Carte className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Les autres pièces du dossier</h2>
        {autres.length === 0 ? (
          <EtatVide titre="Aucune autre pièce">
            Les contrats, avenants, factures et courriers apparaîtront ici après le versement (phase 3).
          </EtatVide>
        ) : (
          <ul className="grid gap-1.5">
            {autres.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-lg border border-trait px-3 py-2">
                <FileText className="size-4 shrink-0 text-encre-3" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{d.titre}</span>
                {d.type && <Badge>{d.type.nom}</Badge>}
                <span className="chiffres text-[12.5px] text-encre-3">{dateCourte(d.dateDocument)}</span>
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}

/** Les informations modifiables à la main (la phase, elle, ne se saisit pas). */
function OngletInformations({ m }) {
  const { droits } = useSession();
  const client = useQueryClient();
  const { notifier } = useToasts();
  const modifiable = droits.can('modifier', 'Marche');
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api('/api/clients') });

  const f = useFormulaire({
    reference: m.reference,
    clientId: m.client?.id ? String(m.client.id) : '',
    objet: m.objet ?? '',
    numeroAo: m.numeroAo ?? '',
    lot: m.lot ?? '',
    montantHt: m.montantHt ?? '',
    montantTtc: m.montantTtc ?? '',
    dateSignature: m.dateSignature ?? '',
    dateOs: m.dateOs ?? '',
    delaiMois: m.delaiMois ?? '',
    dateFin: m.dateFin ?? '',
    ville: m.ville ?? '',
    emplacementPapier: m.emplacementPapier ?? '',
    statutAffaire: m.statutAffaire ?? '',
    conservation: m.conservation ?? '',
  });

  const enregistrer = useMutation({
    mutationFn: (valeurs) =>
      api(`/api/marches/${m.id}`, {
        methode: 'PATCH',
        corps: {
          reference: valeurs.reference.trim(),
          clientId: valeurs.clientId ? Number(valeurs.clientId) : null,
          objet: valeurs.objet.trim() || null,
          numeroAo: valeurs.numeroAo.trim() || null,
          lot: valeurs.lot.trim() || null,
          montantHt: valeurs.montantHt === '' ? null : Number(valeurs.montantHt),
          montantTtc: valeurs.montantTtc === '' ? null : Number(valeurs.montantTtc),
          dateSignature: valeurs.dateSignature || null,
          dateOs: valeurs.dateOs || null,
          delaiMois: valeurs.delaiMois === '' ? null : Number(valeurs.delaiMois),
          dateFin: valeurs.dateFin || null,
          ville: valeurs.ville.trim() || null,
          emplacementPapier: valeurs.emplacementPapier.trim() || null,
          statutAffaire: valeurs.statutAffaire || null,
          conservation: valeurs.conservation || null,
        },
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['marche', String(m.id)] });
      client.invalidateQueries({ queryKey: CLE_MARCHES });
      notifier({ titre: 'Marché enregistré', ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Enregistrement refusé', message: e.message, ton: 'alerte' }),
  });

  const commun = (nom) => ({ ...f.champ(nom), disabled: !modifiable });

  return (
    <Carte className="p-6">
      {!modifiable && (
        <Alerte ton="info" className="mb-5">
          Votre rôle permet de consulter ce marché, pas de le modifier.
        </Alerte>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          enregistrer.mutate(f.valeurs);
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Champ libelle="Référence" aide="Celle qui s’affiche. La clé de regroupement se recalcule seule." {...commun('reference')} />
        <Selection libelle="Client" {...commun('clientId')}>
          <option value="">— à rattacher —</option>
          {(clients.data ?? []).map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.nom}
            </option>
          ))}
        </Selection>
        <Champ libelle="Objet" className="sm:col-span-2" {...commun('objet')} />
        <Champ libelle="Numéro d’appel d’offres" {...commun('numeroAo')} />
        <Champ libelle="Lot" {...commun('lot')} />
        <Champ libelle="Montant HT (DH)" type="number" step="0.01" min="0" {...commun('montantHt')} />
        <Champ libelle="Montant TTC (DH)" type="number" step="0.01" min="0" {...commun('montantTtc')} />
        <Champ libelle="Date de signature" type="date" {...commun('dateSignature')} />
        <Champ libelle="Date d’ordre de service" type="date" {...commun('dateOs')} />
        <Champ libelle="Délai (mois)" type="number" min="1" max="120" aide="Sert à calculer l’échéance quand la date de fin est inconnue." {...commun('delaiMois')} />
        <Champ libelle="Date de fin" type="date" {...commun('dateFin')} />
        <Champ libelle="Ville" {...commun('ville')} />
        <Champ libelle="Emplacement du papier" aide="Où trouver l’original au siège." {...commun('emplacementPapier')} />
        <Selection libelle="Statut de l’affaire" {...commun('statutAffaire')}>
          <option value="">—</option>
          {STATUTS_AFFAIRE.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Selection>
        <Selection libelle="Conservation" {...commun('conservation')}>
          <option value="">—</option>
          {CONSERVATIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Selection>

        <div className="mt-2 flex items-center gap-3 sm:col-span-2">
          <AlertTriangle className="size-4 shrink-0 text-encre-3" aria-hidden />
          <p className="flex-1 text-[12.5px] text-encre-3">
            La phase (« {PHASES[m.phase].nom} ») se calcule d’après les pièces versées : elle ne se saisit jamais à la main.
          </p>
          {modifiable && (
            <Bouton type="submit" chargement={enregistrer.isPending} libelleChargement="Enregistrement…">
              Enregistrer
            </Bouton>
          )}
        </div>
      </form>
    </Carte>
  );
}
