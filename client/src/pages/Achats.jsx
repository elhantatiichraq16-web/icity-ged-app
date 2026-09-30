/**
 * Les achats : la feuille « ÉTAT DES ACHATS » du classeur Excel, devenue
 * écran. Le matériel de chaque marché, son fournisseur, ses prix, sa
 * commande, sa livraison et son paiement.
 *
 * Rien de ce qui se calcule ne se saisit : totaux, marge, avance, reste,
 * échéance et tableau de bord se calculent (commun/achats.js). Chacun voit le
 * matériel et son suivi ; les prix ne viennent du serveur que pour les
 * achats et la direction.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  ETATS_PAIEMENT,
  MODALITES_PAIEMENT,
  STATUTS_ACHAT,
  STATUTS_COMMANDES,
  TVA,
  dateFr,
  marge,
  modalitePaiement,
  paiementCommande,
  pourcent,
  schemaCommande,
  schemaFournisseur,
  schemaLigneAchat,
  statutAchat,
  total,
} from '@icity/commun/achats';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { useFormulaire } from '../formulaire.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { Confirmation, Modale } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';
import { cx } from '../ui/cx.js';
import { CLE_MARCHES } from './Marches.jsx';

// ── Petits outils ───────────────────────────────────────────────

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const dh = (n) => (n === null || n === undefined ? '—' : `${nf.format(n)} DH`);
/** « 11,78 M DH » pour les grands montants, « 470 500 DH » sinon. */
const court = (n) => (n === null || n === undefined ? '—' : Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M DH` : dh(n));
/** Un nombre tapé à la française : « 12 500,50 ». */
const lu = (x) => {
  const t = String(x ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  return t === '' || Number.isNaN(Number(t)) ? null : Number(t);
};
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const ORDRE_TON = { alerte: 0, attente: 1, neutre: 2 };

/** Les listes qu'un changement dans les achats peut avoir modifiées. */
function useInvalider() {
  const file = useQueryClient();
  return () => ['achats', 'achats-marches', 'commandes-fournisseur', 'fournisseurs'].forEach((cle) => file.invalidateQueries({ queryKey: [cle] }));
}

/** Les catégories du classeur, proposées à la saisie. */
const CATEGORIES = [
  'Infrastructure Serveurs',
  'Réseau / Switching',
  'Sécurité Réseau',
  'Équipements Accès',
  'Infrastructure Rack & Énergie',
  'Stations de Travail',
  'Climatisation',
  'Sécurité Physique',
  'Supervision & Affichage',
];
const CONDITIONS = ['13 % d’avance, reste à 60 jours', '30 % d’avance, solde à la livraison', '50 % à la commande, 50 % à la livraison', 'Comptant', 'Virement à la commande'];
const DELAIS = ['Disponible', '2 à 3 semaines', '4 à 5 semaines', '6 à 8 semaines', 'En arrivage'];

function Tuile({ titre, valeur, note, ton }) {
  return (
    <Carte className="p-4">
      <p className="text-[13px] font-medium text-encre-2">{titre}</p>
      <p className={cx('chiffres mt-1 text-[24px] leading-tight font-semibold', ton === 'alerte' ? 'text-alerte-texte' : ton === 'ok' ? 'text-ok' : ton === 'attente' ? 'text-attente' : 'text-encre')}>{valeur}</p>
      {note && <p className="mt-0.5 text-[12.5px] text-encre-3">{note}</p>}
    </Carte>
  );
}

function ZoneTexte({ libelle, id, erreur, ...reste }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-semibold text-encre-2">
        {libelle}
        <span className="font-normal text-encre-3"> (facultatif)</span>
      </label>
      <textarea
        id={id}
        rows={3}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur ? `${id}-erreur` : undefined}
        className={cx(
          'w-full rounded-[10px] border bg-surface-2 px-3.5 py-2.5 text-[14.5px] text-encre transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-encre-3 hover:border-trait-fort focus:border-cyan focus:bg-surface focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--cyan),transparent_85%)] focus:outline-none',
          erreur ? 'border-alerte' : 'border-trait',
        )}
        {...reste}
      />
      {erreur && (
        <p id={`${id}-erreur`} className="text-[12.5px] font-medium text-alerte-texte">
          {erreur}
        </p>
      )}
    </div>
  );
}

// ── La page ─────────────────────────────────────────────────────

export function PageAchats() {
  const { droits } = useSession();
  const [parametres, setParametres] = useSearchParams();
  const marcheId = parametres.get('marcheId') ?? '';
  const onglet = parametres.get('onglet') ?? 'suivi';
  const [statut, setStatut] = useState('');
  const [recherche, setRecherche] = useState('');
  const [modale, setModale] = useState(null);
  const gerer = droits.can('gerer', 'Achat');
  const prix = droits.can('lire', 'PrixAchat');
  const voitFournisseurs = droits.can('lire', 'Fournisseur');

  // Le statut et la recherche ne filtrent que la liste du matériel : le
  // suivi montre toujours tout le marché.
  const filtre = new URLSearchParams({
    ...(marcheId ? { marcheId } : {}),
    ...(onglet === 'materiel' && statut ? { statut } : {}),
    ...(onglet === 'materiel' && recherche.trim() ? { q: recherche.trim() } : {}),
  }).toString();
  const achats = useQuery({ queryKey: ['achats', filtre], queryFn: () => api(`/api/achats?${filtre}`) });
  const marchesAvecAchats = useQuery({ queryKey: ['achats-marches'], queryFn: () => api('/api/achats/marches') });
  const commandes = useQuery({
    queryKey: ['commandes-fournisseur', marcheId],
    queryFn: () => api(`/api/commandes-fournisseur${marcheId ? `?marcheId=${marcheId}` : ''}`),
    enabled: prix,
  });

  const changer = (cle, valeur) => {
    const p = new URLSearchParams(parametres);
    if (valeur) p.set(cle, valeur);
    else p.delete(cle);
    setParametres(p, { replace: true });
  };
  const onglets = [
    ['suivi', 'Suivi'],
    ['materiel', 'Matériel', achats.data?.lignes.length],
    ...(prix ? [['paiements', 'Commandes et paiements', commandes.data?.length]] : []),
    ...(voitFournisseurs ? [['fournisseurs', 'Fournisseurs']] : []),
  ];

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Achats"
        description="Le matériel de chaque marché : son fournisseur, ses prix, sa commande, sa livraison et son paiement."
        actions={
          <>
            <Bouton variante="secondaire" taille="petit" icone={Download} onClick={() => (window.location.href = `/api/achats/export.csv${marcheId ? `?marcheId=${marcheId}` : ''}`)}>
              Exporter
            </Bouton>
            {gerer && (
              <>
                <Bouton variante="secondaire" taille="petit" icone={FileSpreadsheet} onClick={() => setModale({ type: 'import' })}>
                  Importer un Excel
                </Bouton>
                <Bouton taille="petit" icone={Plus} onClick={() => setModale({ type: 'ligne' })}>
                  Nouvel achat
                </Bouton>
              </>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Selection className="w-full sm:w-80" libelle="Marché" value={marcheId} onChange={(e) => changer('marcheId', e.target.value)}>
          <option value="">Tous les marchés</option>
          {(marchesAvecAchats.data ?? []).map((m) => (
            <option key={m.id} value={String(m.id)}>
              {`${m.reference}${m.client ? ` · ${m.client.nom}` : ''} — ${m.nbLignes} ligne${m.nbLignes > 1 ? 's' : ''}`}
            </option>
          ))}
        </Selection>
        {onglet === 'materiel' && (
          <>
            <Selection className="w-full sm:w-56" libelle="Statut" value={statut} onChange={(e) => setStatut(e.target.value)}>
              <option value="">Tous les statuts</option>
              {STATUTS_ACHAT.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.nom}
                </option>
              ))}
            </Selection>
            <Champ className="w-full sm:w-72" libelle="Rechercher" placeholder="Matériel, marque, référence…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          </>
        )}
      </div>

      <div role="tablist" aria-label="Sections des achats" className="-mx-1 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-trait px-1">
        {onglets.map(([cle, libelle, n]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            aria-selected={onglet === cle}
            onClick={() => changer('onglet', cle === 'suivi' ? '' : cle)}
            className={cx(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              onglet === cle ? 'border-cyan text-encre' : 'border-transparent text-encre-3 hover:text-encre',
            )}
          >
            {libelle}
            {n !== undefined && <span className={cx('chiffres rounded-full px-2 text-[11.5px]', onglet === cle ? 'bg-cyan-voile text-cyan-texte' : 'bg-surface-2')}>{n}</span>}
          </button>
        ))}
      </div>

      {onglet === 'suivi' && <OngletSuivi achats={achats} commandes={commandes} prix={prix} gerer={gerer} surImporter={() => setModale({ type: 'import' })} />}
      {onglet === 'materiel' && <TableauMateriel achats={achats} prix={prix} gerer={gerer} tousMarches={!marcheId} surModifier={(ligne) => setModale({ type: 'ligne', objet: ligne })} />}
      {onglet === 'paiements' && prix && (
        <OngletPaiements commandes={commandes} gerer={gerer} surNouvelle={() => setModale({ type: 'commande' })} surModifier={(c) => setModale({ type: 'commande', objet: c })} />
      )}
      {onglet === 'fournisseurs' && voitFournisseurs && <OngletFournisseurs gerer={droits.can('gerer', 'Fournisseur')} surModifier={(f) => setModale({ type: 'fournisseur', objet: f })} />}

      <ModaleLigne ouverte={modale?.type === 'ligne'} ligne={modale?.objet} marcheIdParDefaut={marcheId} categories={achats.data?.lignes.map((l) => l.categorie)} surChangement={() => setModale(null)} />
      <ModaleImport ouverte={modale?.type === 'import'} marcheIdParDefaut={marcheId} surChangement={() => setModale(null)} surImporte={(id) => changer('marcheId', String(id))} />
      {prix && <ModaleCommande ouverte={modale?.type === 'commande'} commande={modale?.objet} marcheIdParDefaut={marcheId} surChangement={() => setModale(null)} />}
      {voitFournisseurs && <ModaleFournisseur ouverte={modale?.type === 'fournisseur'} fournisseur={modale?.objet} surChangement={() => setModale(null)} />}
    </div>
  );
}

/** Les achats d'un marché, dans l'onglet « Achats » de sa fiche. */
export function AchatsDuMarche({ marcheId }) {
  const { droits } = useSession();
  const [modale, setModale] = useState(null);
  const filtre = `marcheId=${marcheId}`;
  const achats = useQuery({ queryKey: ['achats', filtre], queryFn: () => api(`/api/achats?${filtre}`) });
  const gerer = droits.can('gerer', 'Achat');
  const prix = droits.can('lire', 'PrixAchat');
  const resume = achats.data?.resume;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-encre-2">
          {resume
            ? `${resume.lignes} ligne${resume.lignes > 1 ? 's' : ''} de matériel · ${resume.parStatut.livre ?? 0} livrée${(resume.parStatut.livre ?? 0) > 1 ? 's' : ''}${resume.enRetard ? ` · ${resume.enRetard} en retard` : ''}${prix && resume.marge !== null ? ` · marge ${pourcent(resume.marge)}` : ''}`
            : ' '}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to={`/achats?marcheId=${marcheId}`} className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-semibold text-cyan-texte hover:bg-surface-2">
            Ouvrir dans Achats
          </Link>
          {gerer && (
            <>
              <Bouton variante="secondaire" taille="petit" icone={FileSpreadsheet} onClick={() => setModale({ type: 'import' })}>
                Importer un Excel
              </Bouton>
              <Bouton taille="petit" icone={Plus} onClick={() => setModale({ type: 'ligne' })}>
                Nouvel achat
              </Bouton>
            </>
          )}
        </div>
      </div>
      <TableauMateriel achats={achats} prix={prix} gerer={gerer} surModifier={(ligne) => setModale({ type: 'ligne', objet: ligne })} />
      <ModaleLigne ouverte={modale?.type === 'ligne'} ligne={modale?.objet} marcheIdParDefaut={String(marcheId)} categories={achats.data?.lignes.map((l) => l.categorie)} surChangement={() => setModale(null)} />
      <ModaleImport ouverte={modale?.type === 'import'} marcheIdParDefaut={String(marcheId)} surChangement={() => setModale(null)} />
    </div>
  );
}

// ── Le suivi ────────────────────────────────────────────────────

function OngletSuivi({ achats, commandes, prix, gerer, surImporter }) {
  if (achats.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }
  if (achats.isError) return <Alerte ton="alerte">{achats.error.message}</Alerte>;
  const { resume, lignes } = achats.data;
  if (!lignes.length) {
    return (
      <Carte>
        <EtatVide titre="Aucun achat pour l’instant" action={gerer && <Bouton icone={FileSpreadsheet} onClick={surImporter}>Importer un Excel</Bouton>}>
          Importez le classeur Excel d’un projet, ou ajoutez le matériel ligne par ligne.
        </EtatVide>
      </Carte>
    );
  }

  const commandees = STATUTS_COMMANDES.reduce((s, c) => s + (resume.parStatut[c] ?? 0), 0);
  const plusGrand = Math.max(1, ...Object.values(resume.parStatut));
  const alertes = lignes.flatMap((l) => l.alertes.map((a) => ({ ...a, ligne: l }))).sort((a, b) => ORDRE_TON[a.ton] - ORDRE_TON[b.ton]);
  const ecart = prix && resume.budget ? resume.achat - resume.budget : null;
  const aPayer = prix ? (commandes.data ?? []).filter((c) => c.etat !== 'soldee').sort((a, b) => (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999')) : [];

  return (
    <div className="grid gap-5">
      {prix && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tuile titre="Budget de l’appel d’offres" valeur={court(resume.budget)} note="Prévu à la réponse, hors taxes" />
          <Tuile
            titre="Achats"
            valeur={court(resume.achat)}
            ton={ecart > 0 ? 'alerte' : undefined}
            note={ecart === null ? 'Hors taxes' : ecart > 0 ? `${court(ecart)} au-dessus du budget` : `${court(-ecart)} sous le budget`}
          />
          <Tuile titre="Ventes" valeur={court(resume.vente)} note="Hors taxes" />
          <Tuile
            titre="Marge"
            valeur={pourcent(resume.marge)}
            ton={resume.marge !== null && resume.marge < 0 ? 'alerte' : undefined}
            note={resume.lignesSansAchat ? `${resume.lignesSansAchat} ligne(s) sans prix d’achat, non comptée(s)` : 'Sur les lignes chiffrées'}
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tuile titre="Lignes de matériel" valeur={resume.lignes} />
        <Tuile titre="Commandées, pas encore reçues" valeur={commandees} />
        <Tuile titre="Livrées" valeur={resume.parStatut.livre ?? 0} ton="ok" />
        <Tuile titre="Livraisons en retard" valeur={resume.enRetard} ton={resume.enRetard ? 'alerte' : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Carte className="p-5">
          <h2 className="mb-4 font-semibold">Où en est le matériel</h2>
          <ul className="grid gap-2.5">
            {STATUTS_ACHAT.map((s) => (
              <li key={s.code} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-[13px]">
                <span className="truncate text-encre-2" title={s.description}>
                  {s.nom}
                </span>
                <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-cyan" style={{ width: `${((resume.parStatut[s.code] ?? 0) / plusGrand) * 100}%` }} />
                </span>
                <span className="chiffres text-right font-medium">{resume.parStatut[s.code] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Carte>

        <Carte className="p-5">
          <h2 className="mb-4 font-semibold">À surveiller</h2>
          {alertes.length ? (
            <ul className="grid gap-2">
              {alertes.slice(0, 10).map((a) => (
                <li key={`${a.ligne.id}-${a.code}`} className={cx('rounded-md border-l-[3px] bg-surface-2 px-3 py-1.5 text-[13px]', a.ton === 'alerte' ? 'border-alerte' : a.ton === 'attente' ? 'border-attente' : 'border-trait-fort')}>
                  <span className="font-medium">{a.ligne.numero ? `Ligne ${a.ligne.numero}` : a.ligne.designation}</span>
                  <span className="text-encre-2"> — {a.message}</span>
                </li>
              ))}
              {alertes.length > 10 && <li className="text-[12.5px] text-encre-3">Et {alertes.length - 10} autre(s), dans l’onglet Matériel.</li>}
            </ul>
          ) : (
            <p className="text-sm text-encre-2">Rien à signaler : pas de retard, de marge négative ni de référence différente de l’offre.</p>
          )}
        </Carte>
      </div>

      {prix && aPayer.length > 0 && (
        <Carte className="p-5">
          <h2 className="mb-4 font-semibold">Paiements à venir</h2>
          <ul className="grid gap-2">
            {aPayer.slice(0, 6).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
                <span className="font-medium">{c.fournisseur?.nom}</span>
                <Badge ton={ETATS_PAIEMENT[c.etat].ton}>{ETATS_PAIEMENT[c.etat].nom}</Badge>
                <span className="chiffres">{c.etat === 'avance_a_payer' ? `avance de ${dh(c.avance)}` : `reste ${dh(c.reste)}`}</span>
                <span className={cx('text-encre-3', c.echeance && c.echeance < aujourdhui() && 'font-medium text-alerte-texte')}>{c.echeance ? `échéance ${dateFr(c.echeance)}` : 'sans échéance'}</span>
              </li>
            ))}
          </ul>
        </Carte>
      )}
    </div>
  );
}

// ── Le matériel ─────────────────────────────────────────────────

function ChoixStatut({ ligne }) {
  const invalider = useInvalider();
  const { notifier } = useToasts();
  const [envoi, setEnvoi] = useState(false);
  async function changer(statut) {
    setEnvoi(true);
    try {
      await api(`/api/achats/${ligne.id}`, { methode: 'PATCH', corps: { statut } });
      invalider();
    } catch (erreur) {
      notifier({ titre: 'Statut non modifié', message: erreur.message, ton: 'alerte' });
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <select
      aria-label={`Statut de ${ligne.designation}`}
      value={ligne.statut}
      disabled={envoi}
      onChange={(e) => changer(e.target.value)}
      className="w-full min-w-[9rem] rounded-lg border border-trait bg-surface-2 px-2 py-1 text-[12.5px] font-medium text-encre hover:border-trait-fort focus:border-cyan focus:outline-none disabled:opacity-60"
    >
      {STATUTS_ACHAT.map((s) => (
        <option key={s.code} value={s.code}>
          {s.nom}
        </option>
      ))}
    </select>
  );
}

function TableauMateriel({ achats, prix, gerer, tousMarches = false, surModifier }) {
  if (achats.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={5} />
      </Carte>
    );
  }
  if (achats.isError) return <Alerte ton="alerte">{achats.error.message}</Alerte>;
  const { lignes, resume } = achats.data;
  if (!lignes.length) {
    return (
      <Carte>
        <EtatVide titre="Aucune ligne de matériel">Aucun achat ne correspond à ces filtres.</EtatVide>
      </Carte>
    );
  }

  // Rangées par catégorie, dans l'ordre du classeur.
  const groupes = [];
  for (const l of lignes) {
    const cle = tousMarches ? `${l.marche?.reference} — ${l.categorie}` : l.categorie;
    const groupe = groupes.find((g) => g.cle === cle);
    if (groupe) groupe.lignes.push(l);
    else groupes.push({ cle, lignes: [l] });
  }
  // Le budget de l'appel d'offres reste dans le suivi, la fiche et l'export :
  // ici, un dépassement se signale par une alerte sur la ligne.
  const colonnes = 5 + (prix ? 3 : 0) + (gerer ? 1 : 0);

  return (
    <Carte className="overflow-x-auto">
      <table className="w-full text-[13px] [&_td]:px-2.5 [&_th]:px-2.5">
        <thead>
          <tr className="border-b border-trait bg-surface-2 text-left text-[12px] font-semibold text-encre-3">
            <th className="py-2.5">N°</th>
            <th className="py-2.5">Matériel</th>
            <th className="py-2.5 text-right">Qté</th>
            {prix && (
              <>
                <th className="py-2.5 text-right whitespace-nowrap">Achat (DH HT)</th>
                <th className="py-2.5 text-right whitespace-nowrap">Vente (DH HT)</th>
                <th className="py-2.5 text-right">Marge</th>
              </>
            )}
            <th className="py-2.5">Fournisseur</th>
            <th className="py-2.5">Statut et livraison</th>
            {gerer && (
              <th className="py-2.5">
                <span className="sr-only">Modifier</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {groupes.map((g) => (
            <GroupeMateriel key={g.cle} groupe={g} colonnes={colonnes} prix={prix} gerer={gerer} surModifier={surModifier} />
          ))}
        </tbody>
        {prix && (
          <tfoot>
            <tr className="border-t-2 border-trait-fort bg-surface-2 font-semibold">
              <td className="py-2.5" colSpan={3}>
                Totaux · budget de l’appel d’offres : <span className="chiffres">{dh(resume.budget)}</span>
              </td>
              <td className="chiffres py-2.5 text-right whitespace-nowrap">{nf.format(resume.achat)}</td>
              <td className="chiffres py-2.5 text-right whitespace-nowrap">{nf.format(resume.vente)}</td>
              <td className="chiffres py-2.5 text-right whitespace-nowrap">{pourcent(resume.marge)}</td>
              <td colSpan={colonnes - 6} />
            </tr>
          </tfoot>
        )}
      </table>
    </Carte>
  );
}

function GroupeMateriel({ groupe, colonnes, prix, gerer, surModifier }) {
  return (
    <>
      <tr className="border-b border-trait bg-cyan-voile/60">
        <td colSpan={colonnes} className="py-1.5 text-[12px] font-semibold tracking-wide text-cyan-texte uppercase">
          {groupe.cle}
        </td>
      </tr>
      {groupe.lignes.map((l) => (
        <tr key={l.id} className="border-b border-trait align-top last:border-b-0 hover:bg-surface-2/60">
          <td className="chiffres py-2.5 text-encre-3">{l.numero ?? '—'}</td>
          <td className="min-w-[15rem] py-2.5">
            <p className="font-medium">{l.designation}</p>
            <p className="text-[12px] text-encre-3">{[l.marque, l.referenceAchat ?? l.referenceOffre].filter(Boolean).join(' · ') || ' '}</p>
            {l.commentaire && <p className="mt-0.5 text-[12px] text-encre-2 italic">{l.commentaire}</p>}
            {l.alertes.map((a) => (
              <p key={a.code} className={cx('mt-0.5 text-[12px] font-medium', a.ton === 'alerte' ? 'text-alerte-texte' : a.ton === 'attente' ? 'text-attente' : 'text-encre-3')}>
                {a.message}
              </p>
            ))}
          </td>
          <td className="chiffres py-2.5 text-right">{nf.format(l.quantite)}</td>
          {prix && (
            <>
              <td className="chiffres py-2.5 text-right whitespace-nowrap">{l.totalAchat === null ? '—' : nf.format(l.totalAchat)}</td>
              <td className="chiffres py-2.5 text-right whitespace-nowrap">{l.totalVente === null ? '—' : nf.format(l.totalVente)}</td>
              <td className={cx('chiffres py-2.5 text-right whitespace-nowrap', l.marge !== null && l.marge < 0 && 'font-semibold text-alerte-texte')}>{pourcent(l.marge)}</td>
            </>
          )}
          <td className="py-2.5">{l.fournisseur?.nom ?? <span className="text-encre-3">à définir</span>}</td>
          <td className="py-2">
            {gerer ? <ChoixStatut ligne={l} /> : <Badge ton={statutAchat(l.statut).ton}>{statutAchat(l.statut).nom}</Badge>}
            <p className="mt-1 text-[12px] whitespace-nowrap">
              {l.etd ? (
                <span className={cx('chiffres', l.alertes.some((a) => a.code === 'retard') ? 'font-semibold text-alerte-texte' : 'text-encre-2')}>{`Livraison ${dateFr(l.etd)}`}</span>
              ) : (
                <span className="text-encre-3">{l.delaiLivraison ?? 'Livraison non datée'}</span>
              )}
            </p>
          </td>
          {gerer && (
            <td className="py-2">
              <button type="button" onClick={() => surModifier(l)} aria-label={`Modifier ${l.designation}`} className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface-2 hover:text-encre">
                <Pencil className="size-4" aria-hidden />
              </button>
            </td>
          )}
        </tr>
      ))}
    </>
  );
}

// ── Une ligne : créer, modifier, supprimer ──────────────────────

const LIGNE_VIDE = {
  marcheId: '',
  numero: '',
  categorie: '',
  designation: '',
  quantite: '1',
  puBudget: '',
  puAchat: '',
  puVente: '',
  marque: '',
  referenceOffre: '',
  referenceAchat: '',
  fournisseur: '',
  conditionsPaiement: '',
  delaiLivraison: '',
  statut: 'en_attente',
  etd: '',
  commentaire: '',
};
const enTexte = (v) => (v === null || v === undefined ? '' : String(v));

function ModaleLigne({ ouverte, surChangement, ligne, marcheIdParDefaut, categories = [] }) {
  return (
    <Modale ouverte={ouverte} surChangement={surChangement} titre={ligne ? 'Modifier l’achat' : 'Nouvel achat'} description="Le total, la marge et les alertes se calculent seuls." largeur="max-w-3xl">
      {ouverte && <FormulaireLigne ligne={ligne} marcheIdParDefaut={marcheIdParDefaut} categories={categories} fermer={() => surChangement(false)} />}
    </Modale>
  );
}

function FormulaireLigne({ ligne, marcheIdParDefaut, categories, fermer }) {
  const invalider = useInvalider();
  const { notifier } = useToasts();
  const { droits } = useSession();
  const marches = useQuery({ queryKey: CLE_MARCHES, queryFn: () => api('/api/marches') });
  const fournisseurs = useQuery({ queryKey: ['fournisseurs'], queryFn: () => api('/api/fournisseurs'), enabled: droits.can('lire', 'Fournisseur') });
  const [suppression, setSuppression] = useState(false);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);

  const initiales = ligne
    ? Object.fromEntries(Object.keys(LIGNE_VIDE).map((cle) => [cle, cle === 'marcheId' ? enTexte(ligne.marche?.id) : cle === 'fournisseur' ? enTexte(ligne.fournisseur?.nom) : enTexte(ligne[cle])]))
    : { ...LIGNE_VIDE, marcheId: marcheIdParDefaut ?? '' };
  const f = useFormulaire(initiales);
  const v = f.valeurs;
  const totalAchat = total(lu(v.puAchat), lu(v.quantite));
  const totalVente = total(lu(v.puVente), lu(v.quantite));
  const m = marge(lu(v.puAchat), lu(v.puVente));
  const affaires = [...(marches.data ?? [])].sort((a, b) => a.reference.localeCompare(b.reference, 'fr', { numeric: true }));
  const listeCategories = [...new Set([...categories, ...CATEGORIES])];

  const enregistrer = f.soumettre(schemaLigneAchat, async (donnees) => {
    if (ligne) {
      // Seuls les champs changés partent : le journal garde un avant/après lisible.
      const avant = schemaLigneAchat.safeParse(initiales);
      const corps = avant.success ? Object.fromEntries(Object.entries(donnees).filter(([cle, val]) => JSON.stringify(val ?? null) !== JSON.stringify(avant.data[cle] ?? null))) : donnees;
      if (!Object.keys(corps).length) return fermer();
      await api(`/api/achats/${ligne.id}`, { methode: 'PATCH', corps });
    } else {
      await api('/api/achats', { methode: 'POST', corps: donnees });
    }
    invalider();
    notifier({ titre: ligne ? 'Achat enregistré' : 'Achat ajouté', message: donnees.designation, ton: 'ok' });
    fermer();
  });

  async function supprimer() {
    setSuppressionEnCours(true);
    try {
      await api(`/api/achats/${ligne.id}`, { methode: 'DELETE' });
      invalider();
      notifier({ titre: 'Achat supprimé', message: ligne.designation, ton: 'ok' });
      fermer();
    } catch (erreur) {
      notifier({ titre: 'Suppression impossible', message: erreur.message, ton: 'alerte' });
    } finally {
      setSuppressionEnCours(false);
    }
  }

  return (
    <form noValidate onSubmit={enregistrer} className="grid gap-4">
      {f.erreurGenerale && <Alerte ton="alerte">{f.erreurGenerale}</Alerte>}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <Selection libelle="Marché" {...f.champ('marcheId')}>
          <option value="">— choisir —</option>
          {affaires.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {`${a.reference}${a.client ? ` · ${a.client.nom}` : ''}`}
            </option>
          ))}
        </Selection>
        <Champ libelle="N° au bordereau" facultatif {...f.champ('numero')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_6rem]">
        <Champ libelle="Catégorie" list="achat-categories" {...f.champ('categorie')} />
        <Champ libelle="Matériel" placeholder="Switch 48 ports – site principal" {...f.champ('designation')} />
        <Champ libelle="Quantité" inputMode="decimal" {...f.champ('quantite')} />
      </div>
      <datalist id="achat-categories">
        {listeCategories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="grid gap-4 sm:grid-cols-3">
        <Champ libelle="Marque" facultatif {...f.champ('marque')} />
        <Champ libelle="Réf. de l’offre technique" facultatif {...f.champ('referenceOffre')} />
        <Champ libelle="Réf. achetée" facultatif {...f.champ('referenceAchat')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Champ libelle="P.U. budget AO (HT)" facultatif inputMode="decimal" {...f.champ('puBudget')} />
        <Champ libelle="P.U. achat (HT)" facultatif inputMode="decimal" {...f.champ('puAchat')} />
        <Champ libelle="P.U. vente (HT)" facultatif inputMode="decimal" {...f.champ('puVente')} />
      </div>
      <p className="-mt-1 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-encre-2">
        Total achat <strong className="chiffres text-encre">{dh(totalAchat)}</strong> · total vente <strong className="chiffres text-encre">{dh(totalVente)}</strong> · marge{' '}
        <strong className={cx('chiffres', m !== null && m < 0 ? 'text-alerte-texte' : 'text-encre')}>{pourcent(m)}</strong>
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Champ libelle="Fournisseur" facultatif list="achat-fournisseurs" aide="Un nom nouveau crée le fournisseur." {...f.champ('fournisseur')} />
        <Champ libelle="Conditions de paiement" facultatif list="achat-conditions" {...f.champ('conditionsPaiement')} />
        <Champ libelle="Délai de livraison" facultatif list="achat-delais" {...f.champ('delaiLivraison')} />
      </div>
      <datalist id="achat-fournisseurs">
        {(fournisseurs.data ?? []).map((x) => (
          <option key={x.id} value={x.nom} />
        ))}
      </datalist>
      <datalist id="achat-conditions">
        {CONDITIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="achat-delais">
        {DELAIS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="grid gap-4 sm:grid-cols-2">
        <Selection libelle="Statut" {...f.champ('statut')}>
          {STATUTS_ACHAT.map((s) => (
            <option key={s.code} value={s.code}>
              {`${s.nom} — ${s.description}`}
            </option>
          ))}
        </Selection>
        <Champ libelle="Livraison prévue" facultatif type="date" {...f.champ('etd')} />
      </div>
      <ZoneTexte libelle="Commentaire" id="achat-commentaire" {...f.champ('commentaire')} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {ligne ? (
          <Bouton variante="fantome" icone={Trash2} onClick={() => setSuppression(true)}>
            Supprimer
          </Bouton>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Bouton variante="fantome" onClick={fermer}>
            Annuler
          </Bouton>
          <Bouton type="submit" chargement={f.envoi} libelleChargement="Enregistrement…">
            Enregistrer
          </Bouton>
        </div>
      </div>
      {ligne && (
        <Confirmation
          ouverte={suppression}
          surChangement={setSuppression}
          titre="Supprimer cet achat ?"
          description={`« ${ligne.designation} » disparaîtra de la liste. Le journal gardera la trace de la suppression.`}
          libelle="Supprimer l’achat"
          chargement={suppressionEnCours}
          surConfirmer={supprimer}
        />
      )}
    </form>
  );
}

// ── L'import du classeur ────────────────────────────────────────

function ModaleImport({ ouverte, surChangement, marcheIdParDefaut, surImporte }) {
  return (
    <Modale ouverte={ouverte} surChangement={surChangement} titre="Importer un classeur Excel" description="La feuille « État des achats » et la dernière feuille « Paiement » sont reprises. Un import relancé met à jour les lignes au lieu de les doubler." largeur="max-w-2xl">
      {ouverte && <FormulaireImport marcheIdParDefaut={marcheIdParDefaut} fermer={() => surChangement(false)} surImporte={surImporte} />}
    </Modale>
  );
}

function FormulaireImport({ marcheIdParDefaut, fermer, surImporte }) {
  const invalider = useInvalider();
  const marches = useQuery({ queryKey: CLE_MARCHES, queryFn: () => api('/api/marches') });
  const [marcheId, setMarcheId] = useState(marcheIdParDefaut ?? '');
  const [fichier, setFichier] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const [rapport, setRapport] = useState(null);
  const affaires = [...(marches.data ?? [])].sort((a, b) => a.reference.localeCompare(b.reference, 'fr', { numeric: true }));

  async function importer(e) {
    e.preventDefault();
    if (!marcheId) return setErreur('Choisissez le marché auquel rattacher ces achats.');
    if (!fichier) return setErreur('Choisissez le classeur (.xlsx).');
    setErreur('');
    setEnvoi(true);
    try {
      // Le marché avant le fichier : le serveur le lit en arrivant au fichier.
      const formulaire = new FormData();
      formulaire.append('marcheId', marcheId);
      formulaire.append('fichier', fichier, fichier.name);
      setRapport(await api('/api/achats/import', { methode: 'POST', fichier: formulaire }));
      invalider();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  if (rapport) {
    return (
      <div className="grid gap-4">
        <Alerte ton="ok" titre="Classeur importé">
          {`${rapport.lignes.creees} ligne(s) ajoutée(s), ${rapport.lignes.misesAJour} mise(s) à jour`}
          {rapport.feuilles.paiements ? ` · ${rapport.commandes.creees + rapport.commandes.misesAJour} commande(s) lue(s) dans « ${rapport.feuilles.paiements} »` : ' · aucune feuille de paiement'}
          {rapport.fournisseursCrees.length ? ` · fournisseurs ajoutés : ${rapport.fournisseursCrees.join(', ')}` : ''}.
        </Alerte>
        {rapport.remarques.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">À vérifier ({rapport.remarques.length})</p>
            <ul className="grid max-h-64 gap-1.5 overflow-y-auto pr-1">
              {rapport.remarques.map((r) => (
                <li key={r} className="rounded-md border-l-[3px] border-attente bg-surface-2 px-3 py-1.5 text-[13px] text-encre-2">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end">
          <Bouton
            onClick={() => {
              surImporte?.(marcheId);
              fermer();
            }}
          >
            Voir les achats
          </Bouton>
        </div>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={importer} className="grid gap-4">
      {erreur && <Alerte ton="alerte">{erreur}</Alerte>}
      <Selection libelle="Marché" value={marcheId} onChange={(e) => setMarcheId(e.target.value)} aide="Le marché n’existe pas encore ? Créez-le d’abord depuis l’écran Marchés.">
        <option value="">— choisir —</option>
        {affaires.map((a) => (
          <option key={a.id} value={String(a.id)}>
            {`${a.reference}${a.client ? ` · ${a.client.nom}` : ''}`}
          </option>
        ))}
      </Selection>
      <div className="grid gap-1.5">
        <label htmlFor="classeur-achats" className="text-[12.5px] font-semibold text-encre-2">
          Classeur Excel (.xlsx)
        </label>
        <input
          id="classeur-achats"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-trait file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-encre hover:file:bg-surface-2"
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Bouton variante="fantome" onClick={fermer}>
          Annuler
        </Bouton>
        <Bouton type="submit" icone={FileSpreadsheet} chargement={envoi} libelleChargement="Import…">
          Importer
        </Bouton>
      </div>
    </form>
  );
}

// ── Les commandes et leur paiement ──────────────────────────────

function OngletPaiements({ commandes, gerer, surNouvelle, surModifier }) {
  const invalider = useInvalider();
  const { notifier } = useToasts();
  if (commandes.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }
  if (commandes.isError) return <Alerte ton="alerte">{commandes.error.message}</Alerte>;
  const liste = commandes.data;
  const ouvertes = liste.filter((c) => c.etat !== 'soldee');
  const avances = ouvertes.filter((c) => c.etat === 'avance_a_payer').reduce((s, c) => s + c.avance, 0);
  const restes = ouvertes.reduce((s, c) => s + c.reste, 0);
  const depassees = ouvertes.filter((c) => c.echeance && c.echeance < aujourdhui()).length;

  async function marquer(c, champ) {
    try {
      await api(`/api/commandes-fournisseur/${c.id}`, { methode: 'PATCH', corps: { [champ]: aujourdhui() } });
      invalider();
    } catch (erreur) {
      notifier({ titre: 'Paiement non enregistré', message: erreur.message, ton: 'alerte' });
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Tuile titre="Avances à payer" valeur={court(avances)} ton={avances ? 'attente' : undefined} note="Avant que le fournisseur ne lance la commande" />
        <Tuile titre="Restes à payer" valeur={court(restes)} note="Toutes les commandes non soldées" />
        <Tuile titre="Échéances dépassées" valeur={depassees} ton={depassees ? 'alerte' : undefined} />
      </div>
      {gerer && (
        <div className="flex justify-end">
          <Bouton taille="petit" icone={Plus} onClick={surNouvelle}>
            Nouvelle commande
          </Bouton>
        </div>
      )}
      {!liste.length ? (
        <Carte>
          <EtatVide titre="Aucune commande">Une commande réunit les lignes payées ensemble à un fournisseur : son montant, son avance, sa modalité et son échéance.</EtatVide>
        </Carte>
      ) : (
        <Carte className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-trait bg-surface-2 text-left text-[12px] font-semibold text-encre-3">
                <th className="px-3 py-2.5">Fournisseur</th>
                <th className="px-3 py-2.5">Lignes</th>
                <th className="px-3 py-2.5 text-right">Montant TTC</th>
                <th className="px-3 py-2.5 text-right">Avance</th>
                <th className="px-3 py-2.5 text-right">Reste</th>
                <th className="px-3 py-2.5">Modalité</th>
                <th className="px-3 py-2.5">Échéance</th>
                <th className="px-3 py-2.5">État</th>
                {gerer && (
                  <th className="px-3 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {liste.map((c) => (
                <tr key={c.id} className="border-b border-trait align-top last:border-b-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{c.fournisseur?.nom}</p>
                    <p className="text-[12px] text-encre-3">{c.marche?.reference}</p>
                  </td>
                  <td className="max-w-[14rem] px-3 py-2.5 text-[12.5px] text-encre-2" title={c.lignes.map((l) => l.designation).join('\n')}>
                    {c.lignes.length ? c.lignes.map((l) => l.numero ?? '·').join(', ') : '—'}
                  </td>
                  <td className="chiffres px-3 py-2.5 text-right whitespace-nowrap">{dh(c.montantTtc)}</td>
                  <td className="chiffres px-3 py-2.5 text-right whitespace-nowrap">
                    {c.avance ? dh(c.avance) : '—'}
                    {c.avancePourcent ? <span className="block text-[11.5px] text-encre-3">{`${c.avancePourcent.toLocaleString('fr-FR')} %`}</span> : null}
                  </td>
                  <td className="chiffres px-3 py-2.5 text-right whitespace-nowrap">{dh(c.reste)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{modalitePaiement(c.modalite).nom}</td>
                  <td className={cx('chiffres px-3 py-2.5 whitespace-nowrap', c.etat !== 'soldee' && c.echeance && c.echeance < aujourdhui() && 'font-semibold text-alerte-texte')}>
                    {c.echeance ? dateFr(c.echeance) : '—'}
                    {c.dateFacture && <span className="block text-[11.5px] font-normal text-encre-3">{`facture ${dateFr(c.dateFacture)}`}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge ton={ETATS_PAIEMENT[c.etat].ton}>{ETATS_PAIEMENT[c.etat].nom}</Badge>
                  </td>
                  {gerer && (
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {c.etat === 'avance_a_payer' && (
                          <Bouton variante="secondaire" taille="petit" onClick={() => marquer(c, 'avancePayeeLe')}>
                            Avance payée
                          </Bouton>
                        )}
                        {c.etat !== 'soldee' && (
                          <Bouton variante="secondaire" taille="petit" onClick={() => marquer(c, 'soldePayeLe')}>
                            Soldée
                          </Bouton>
                        )}
                        <button type="button" onClick={() => surModifier(c)} aria-label={`Modifier la commande ${c.fournisseur?.nom}`} className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface-2 hover:text-encre">
                          <Pencil className="size-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Carte>
      )}
    </div>
  );
}

const COMMANDE_VIDE = { marcheId: '', fournisseurId: '', lignes: [], montantTtc: '', avancePourcent: '0', modalite: 'virement', dateFacture: '', echeance: '', avancePayeeLe: '', soldePayeLe: '', notes: '' };

function ModaleCommande({ ouverte, surChangement, commande, marcheIdParDefaut }) {
  return (
    <Modale ouverte={ouverte} surChangement={surChangement} titre={commande ? 'Modifier la commande' : 'Nouvelle commande'} description="L’avance, le reste et l’échéance se calculent seuls." largeur="max-w-2xl">
      {ouverte && <FormulaireCommande commande={commande} marcheIdParDefaut={marcheIdParDefaut} fermer={() => surChangement(false)} />}
    </Modale>
  );
}

function FormulaireCommande({ commande, marcheIdParDefaut, fermer }) {
  const invalider = useInvalider();
  const { notifier } = useToasts();
  const marches = useQuery({ queryKey: CLE_MARCHES, queryFn: () => api('/api/marches') });
  const fournisseurs = useQuery({ queryKey: ['fournisseurs'], queryFn: () => api('/api/fournisseurs') });
  const initiales = commande
    ? {
        ...Object.fromEntries(Object.keys(COMMANDE_VIDE).map((cle) => [cle, enTexte(commande[cle])])),
        marcheId: enTexte(commande.marche?.id),
        fournisseurId: enTexte(commande.fournisseur?.id),
        echeance: enTexte(commande.echeanceSaisie),
        lignes: commande.lignes.map((l) => l.id),
      }
    : { ...COMMANDE_VIDE, marcheId: marcheIdParDefaut ?? '' };
  const f = useFormulaire(initiales);
  const v = f.valeurs;
  const lignesDuMarche = useQuery({ queryKey: ['achats', `marcheId=${v.marcheId}`], queryFn: () => api(`/api/achats?marcheId=${v.marcheId}`), enabled: Boolean(v.marcheId) });
  const [suppression, setSuppression] = useState(false);

  const cochees = (lignesDuMarche.data?.lignes ?? []).filter((l) => v.lignes.includes(l.id));
  const suggestion = cochees.length ? Math.round(cochees.reduce((s, l) => s + (l.totalAchat ?? 0), 0) * (1 + TVA) * 100) / 100 : null;
  const calcul = paiementCommande({ montantTtc: lu(v.montantTtc), avancePourcent: lu(v.avancePourcent), modalite: v.modalite, dateFacture: v.dateFacture || null, echeance: v.echeance || null });
  const affaires = [...(marches.data ?? [])].sort((a, b) => a.reference.localeCompare(b.reference, 'fr', { numeric: true }));

  const basculer = (id) => f.setValeurs((p) => ({ ...p, lignes: p.lignes.includes(id) ? p.lignes.filter((x) => x !== id) : [...p.lignes, id] }));

  const enregistrer = f.soumettre(schemaCommande, async (donnees) => {
    if (commande) {
      const avant = schemaCommande.safeParse(initiales);
      const corps = avant.success
        ? Object.fromEntries(Object.entries(donnees).filter(([cle, val]) => JSON.stringify(cle === 'lignes' ? [...val].sort() : (val ?? null)) !== JSON.stringify(cle === 'lignes' ? [...avant.data.lignes].sort() : (avant.data[cle] ?? null))))
        : donnees;
      if (!Object.keys(corps).length) return fermer();
      await api(`/api/commandes-fournisseur/${commande.id}`, { methode: 'PATCH', corps });
    } else {
      await api('/api/commandes-fournisseur', { methode: 'POST', corps: donnees });
    }
    invalider();
    notifier({ titre: commande ? 'Commande enregistrée' : 'Commande ajoutée', ton: 'ok' });
    fermer();
  });

  async function supprimer() {
    try {
      await api(`/api/commandes-fournisseur/${commande.id}`, { methode: 'DELETE' });
      invalider();
      fermer();
    } catch (erreur) {
      notifier({ titre: 'Suppression impossible', message: erreur.message, ton: 'alerte' });
    }
  }

  return (
    <form noValidate onSubmit={enregistrer} className="grid gap-4">
      {f.erreurGenerale && <Alerte ton="alerte">{f.erreurGenerale}</Alerte>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Selection libelle="Marché" {...f.champ('marcheId')}>
          <option value="">— choisir —</option>
          {affaires.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.reference}
            </option>
          ))}
        </Selection>
        <Selection libelle="Fournisseur" {...f.champ('fournisseurId')}>
          <option value="">— choisir —</option>
          {(fournisseurs.data ?? []).map((x) => (
            <option key={x.id} value={String(x.id)}>
              {x.nom}
            </option>
          ))}
        </Selection>
      </div>
      {v.marcheId && (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-[12.5px] font-semibold text-encre-2">Lignes payées ensemble</legend>
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-trait p-2">
            {(lignesDuMarche.data?.lignes ?? []).map((l) => (
              <label key={l.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--cyan)]" checked={v.lignes.includes(l.id)} onChange={() => basculer(l.id)} />
                <span>
                  <span className="chiffres text-encre-3">{l.numero ? `${l.numero}. ` : ''}</span>
                  {l.designation}
                  {l.fournisseur && <span className="text-encre-3">{` · ${l.fournisseur.nom}`}</span>}
                </span>
              </label>
            ))}
            {!lignesDuMarche.data?.lignes.length && <p className="px-1.5 py-1 text-[13px] text-encre-3">Ce marché n’a pas encore de lignes d’achat.</p>}
          </div>
          {f.erreurs.lignes && <p className="text-[12.5px] font-medium text-alerte-texte">{f.erreurs.lignes}</p>}
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Champ
          libelle="Montant TTC"
          inputMode="decimal"
          aide={suggestion ? `D’après les lignes : ${dh(suggestion)} TTC` : 'Celui de la facture ou de la proforma.'}
          {...f.champ('montantTtc')}
        />
        <Champ libelle="Avance (%)" inputMode="decimal" {...f.champ('avancePourcent')} />
        <Selection libelle="Modalité" {...f.champ('modalite')}>
          {MODALITES_PAIEMENT.map((x) => (
            <option key={x.code} value={x.code}>
              {x.nom}
            </option>
          ))}
        </Selection>
      </div>
      {suggestion && !v.montantTtc && (
        <div className="-mt-2">
          <Bouton variante="fantome" taille="petit" onClick={() => f.setValeurs((p) => ({ ...p, montantTtc: String(suggestion) }))}>
            Reprendre le montant calculé
          </Bouton>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ libelle="Date de la facture" facultatif type="date" {...f.champ('dateFacture')} />
        <Champ libelle="Échéance datée (effet)" facultatif type="date" aide="Seulement si l’effet porte une date précise ; sinon elle se calcule." {...f.champ('echeance')} />
      </div>
      <p className="-mt-1 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-encre-2">
        Avance <strong className="chiffres text-encre">{dh(calcul.avance)}</strong> · reste <strong className="chiffres text-encre">{dh(calcul.reste)}</strong> · échéance{' '}
        <strong className="chiffres text-encre">{calcul.echeance ? dateFr(calcul.echeance) : '—'}</strong>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ libelle="Avance payée le" facultatif type="date" {...f.champ('avancePayeeLe')} />
        <Champ libelle="Solde payé le" facultatif type="date" {...f.champ('soldePayeLe')} />
      </div>
      <ZoneTexte libelle="Notes" id="commande-notes" {...f.champ('notes')} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {commande ? (
          <Bouton variante="fantome" icone={Trash2} onClick={() => setSuppression(true)}>
            Supprimer
          </Bouton>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Bouton variante="fantome" onClick={fermer}>
            Annuler
          </Bouton>
          <Bouton type="submit" chargement={f.envoi} libelleChargement="Enregistrement…">
            Enregistrer
          </Bouton>
        </div>
      </div>
      {commande && (
        <Confirmation
          ouverte={suppression}
          surChangement={setSuppression}
          titre="Supprimer cette commande ?"
          description="Ses lignes restent dans la liste du matériel ; seul le suivi du paiement disparaît."
          libelle="Supprimer la commande"
          surConfirmer={supprimer}
        />
      )}
    </form>
  );
}

// ── Les fournisseurs ────────────────────────────────────────────

function OngletFournisseurs({ gerer, surModifier }) {
  const fournisseurs = useQuery({ queryKey: ['fournisseurs'], queryFn: () => api('/api/fournisseurs') });
  if (fournisseurs.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }
  if (fournisseurs.isError) return <Alerte ton="alerte">{fournisseurs.error.message}</Alerte>;
  return (
    <div className="grid gap-4">
      {gerer && (
        <div className="flex justify-end">
          <Bouton taille="petit" icone={Plus} onClick={() => surModifier(null)}>
            Nouveau fournisseur
          </Bouton>
        </div>
      )}
      {!fournisseurs.data.length ? (
        <Carte>
          <EtatVide titre="Aucun fournisseur">Ils s’ajoutent ici, ou d’eux-mêmes quand on saisit ou importe un achat.</EtatVide>
        </Carte>
      ) : (
        <Carte className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-trait bg-surface-2 text-left text-[12px] font-semibold text-encre-3">
                <th className="px-3 py-2.5">Fournisseur</th>
                <th className="px-3 py-2.5">Contact</th>
                <th className="px-3 py-2.5">Conditions habituelles</th>
                <th className="px-3 py-2.5 text-right">Lignes</th>
                <th className="px-3 py-2.5 text-right">Acheté (HT)</th>
                {gerer && (
                  <th className="px-3 py-2.5">
                    <span className="sr-only">Modifier</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {fournisseurs.data.map((x) => (
                <tr key={x.id} className="border-b border-trait last:border-b-0">
                  <td className="px-3 py-2.5 font-medium">{x.nom}</td>
                  <td className="px-3 py-2.5 text-encre-2">{[x.contact, x.telephone, x.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2.5 text-encre-2">{x.conditions ?? '—'}</td>
                  <td className="chiffres px-3 py-2.5 text-right">{x.nbLignes}</td>
                  <td className="chiffres px-3 py-2.5 text-right whitespace-nowrap">{dh(x.montantAchat)}</td>
                  {gerer && (
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => surModifier(x)} aria-label={`Modifier ${x.nom}`} className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface-2 hover:text-encre">
                        <Pencil className="size-4" aria-hidden />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Carte>
      )}
    </div>
  );
}

const FOURNISSEUR_VIDE = { nom: '', contact: '', telephone: '', email: '', conditions: '', notes: '' };

function ModaleFournisseur({ ouverte, surChangement, fournisseur }) {
  return (
    <Modale ouverte={ouverte} surChangement={surChangement} titre={fournisseur ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} largeur="max-w-xl">
      {ouverte && <FormulaireFournisseur fournisseur={fournisseur} fermer={() => surChangement(false)} />}
    </Modale>
  );
}

function FormulaireFournisseur({ fournisseur, fermer }) {
  const invalider = useInvalider();
  const { notifier } = useToasts();
  const initiales = fournisseur ? Object.fromEntries(Object.keys(FOURNISSEUR_VIDE).map((cle) => [cle, enTexte(fournisseur[cle])])) : FOURNISSEUR_VIDE;
  const f = useFormulaire(initiales);
  const enregistrer = f.soumettre(schemaFournisseur, async (donnees) => {
    if (fournisseur) await api(`/api/fournisseurs/${fournisseur.id}`, { methode: 'PATCH', corps: donnees });
    else await api('/api/fournisseurs', { methode: 'POST', corps: donnees });
    invalider();
    notifier({ titre: fournisseur ? 'Fournisseur enregistré' : 'Fournisseur ajouté', message: donnees.nom, ton: 'ok' });
    fermer();
  });
  return (
    <form noValidate onSubmit={enregistrer} className="grid gap-4">
      {f.erreurGenerale && <Alerte ton="alerte">{f.erreurGenerale}</Alerte>}
      <Champ libelle="Nom" autoFocus {...f.champ('nom')} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Champ libelle="Contact" facultatif {...f.champ('contact')} />
        <Champ libelle="Téléphone" facultatif {...f.champ('telephone')} />
        <Champ libelle="E-mail" facultatif type="email" {...f.champ('email')} />
      </div>
      <Champ libelle="Conditions habituelles" facultatif placeholder="13 % d’avance, reste à 60 jours" {...f.champ('conditions')} />
      <ZoneTexte libelle="Notes" id="fournisseur-notes" {...f.champ('notes')} />
      <div className="mt-2 flex justify-end gap-2">
        <Bouton variante="fantome" onClick={fermer}>
          Annuler
        </Bouton>
        <Bouton type="submit" chargement={f.envoi} libelleChargement="Enregistrement…">
          Enregistrer
        </Bouton>
      </div>
    </form>
  );
}
