/**
 * Les clients (§11, écran 9) : la liste des maîtres d'ouvrage, et la fiche
 * d'un client avec ses marchés.
 *
 * La liste s'affiche en tableau (pour comparer et trier) ou en grille (pour
 * parcourir). Le statut de chaque client vient du serveur, qui le déduit des
 * phases de ses marchés : il n'est jamais saisi.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DropdownMenu } from 'radix-ui';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Copy,
  Download,
  EllipsisVertical,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  LayoutGrid,
  List,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { STATUTS_CLIENT } from '@icity/commun/marches';
import { erreursParChamp, schemaClient } from '@icity/commun/schemas';
import { api, ErreurApi } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateCourte } from '../format.js';
import { useFormulaire } from '../formulaire.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { Modale } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';
import { cx } from '../ui/cx.js';
import { BadgeEtatMarche } from './Marches.jsx';

const plat = (t) => t.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

// ── La pastille d'initiales ─────────────────────────────────────

/** Les petits mots qu'on saute pour faire des initiales parlantes. */
const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'l', 'd', 'au', 'aux', 'en', 'pour', 'sur']);

/**
 * Les initiales d'un client : son sigle s'il est court (« ADII », « TGR »),
 * sinon les premières lettres de ses deux premiers mots utiles
 * (« Barid Al-Maghrib » → « BA »). Un nom d'un seul mot est souvent déjà un
 * sigle (« OCP », « ONCF ») : court, il sert tel quel ; long, il donne ses deux
 * premières lettres (« CIRCET » → « CI ») plutôt qu'une lettre isolée.
 */
function initiales(client) {
  if (client.sigle && client.sigle.length <= 4) return client.sigle.toUpperCase();
  const mots = plat(client.nom)
    .split(/[^a-z0-9]+/)
    .filter((m) => m && !MOTS_VIDES.has(m));
  if (mots.length === 1) return (mots[0].length <= 4 ? mots[0] : mots[0].slice(0, 2)).toUpperCase();
  return mots.slice(0, 2).map((m) => m[0]).join('').toUpperCase() || '?';
}

/**
 * Une teinte stable, tirée du nom : le même client garde sa couleur d'un
 * écran à l'autre, et deux clients voisins se distinguent d'un coup d'œil.
 */
function teinte(texte) {
  let h = 0;
  for (const caractere of texte) h = (h * 31 + caractere.codePointAt(0)) % 360;
  return h;
}

function PastilleClient({ client, className }) {
  const texte = initiales(client);
  return (
    <span
      aria-hidden
      style={{ '--teinte': teinte(client.nom) }}
      className={cx(
        'pastille-client grid size-10 shrink-0 place-items-center rounded-xl font-semibold tracking-tight',
        texte.length > 3 ? 'text-[11px]' : 'text-[13px]',
        className,
      )}
    >
      {texte}
    </span>
  );
}

/** Un compteur en pastille arrondie : « 3 marchés ». */
function Pilule({ icone: Icone, children, className }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border border-trait bg-surface-2 px-2.5 py-0.5 text-[12.5px] font-medium whitespace-nowrap text-encre-2', className)}>
      {Icone && <Icone className="size-3.5 text-encre-3" aria-hidden />}
      {children}
    </span>
  );
}

function BadgeStatut({ statut, className }) {
  const s = STATUTS_CLIENT[statut] ?? STATUTS_CLIENT.sans_marche;
  return (
    <Badge ton={s.ton} className={className}>
      {s.nom}
    </Badge>
  );
}

// ── Le menu d'actions d'un client (⋮) ───────────────────────────

const ELEMENT_MENU =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-encre outline-none select-none data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-45';

function MenuClient({ client }) {
  const naviguer = useNavigate();
  const { notifier } = useToasts();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Actions pour ${client.nom}`}
        className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface-2 hover:text-encre data-[state=open]:bg-surface-2 data-[state=open]:text-encre"
      >
        <EllipsisVertical className="size-4" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-56 animate-apparition rounded-xl border border-trait bg-surface p-1.5 shadow-haute">
          <DropdownMenu.Item className={ELEMENT_MENU} onSelect={() => naviguer(`/clients/${client.id}`)}>
            <Building2 className="size-4 text-encre-3" aria-hidden /> Ouvrir la fiche
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ELEMENT_MENU} disabled={client.nbDocuments === 0} onSelect={() => naviguer(`/documents?clientId=${client.id}`)}>
            <FileText className="size-4 text-encre-3" aria-hidden /> Voir ses pièces
            <span className="chiffres ml-auto text-[12px] text-encre-3">{client.nbDocuments}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-trait" />
          <DropdownMenu.Item
            className={ELEMENT_MENU}
            onSelect={() =>
              navigator.clipboard
                .writeText(client.nom)
                .then(() => notifier({ titre: 'Nom copié', message: client.nom, ton: 'ok' }))
                .catch(() => notifier({ titre: 'Copie impossible', message: 'Le navigateur a refusé l’accès au presse-papiers.', ton: 'alerte' }))
            }
          >
            <Copy className="size-4 text-encre-3" aria-hidden /> Copier le nom
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ── Tri ─────────────────────────────────────────────────────────

const ORDRE_STATUT = { en_cours: 0, clos: 1, sans_marche: 2 };

const TRIS = {
  nom: { libelle: 'Nom', comparer: (a, b) => a.nom.localeCompare(b.nom, 'fr') },
  nbMarches: { libelle: 'Marchés', comparer: (a, b) => a.nbMarches - b.nbMarches },
  nbDocuments: { libelle: 'Pièces', comparer: (a, b) => a.nbDocuments - b.nbDocuments },
  statut: { libelle: 'Statut', comparer: (a, b) => ORDRE_STATUT[a.statut] - ORDRE_STATUT[b.statut] },
};

/** Un en-tête de colonne qui trie, et annonce son sens aux lecteurs d'écran. */
function EnTeteTri({ cle, tri, surTri, className, children }) {
  const actif = tri.cle === cle;
  const Icone = !actif ? ArrowUpDown : tri.sens === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={actif ? (tri.sens === 'asc' ? 'ascending' : 'descending') : 'none'} className={cx('px-4 py-3 font-semibold', className)}>
      <button type="button" onClick={() => surTri(cle)} className={cx('inline-flex items-center gap-1.5 uppercase hover:text-encre', actif && 'text-encre')}>
        {children}
        <Icone className={cx('size-3.5', !actif && 'opacity-50')} aria-hidden />
      </button>
    </th>
  );
}

// ── Les deux vues ───────────────────────────────────────────────

function VueTableau({ clients, tri, surTri }) {
  return (
    <Carte className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-trait bg-surface-2 text-left text-[11.5px] tracking-[0.06em] text-encre-3">
            <tr>
              <EnTeteTri cle="nom" tri={tri} surTri={surTri}>
                Client
              </EnTeteTri>
              <th scope="col" className="px-4 py-3 font-semibold uppercase">
                Sigle
              </th>
              <EnTeteTri cle="nbMarches" tri={tri} surTri={surTri}>
                Marchés
              </EnTeteTri>
              <EnTeteTri cle="nbDocuments" tri={tri} surTri={surTri}>
                Pièces
              </EnTeteTri>
              <EnTeteTri cle="statut" tri={tri} surTri={surTri}>
                Statut
              </EnTeteTri>
              <th scope="col" className="w-12 px-2 py-3 print:hidden">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-trait">
            {clients.map((c) => (
              <tr key={c.id} className="transition-colors hover:bg-surface-2">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <PastilleClient client={c} className="print:hidden" />
                    <Link to={`/clients/${c.id}`} className="line-clamp-2 max-w-md font-semibold leading-snug text-encre hover:text-cyan-texte">
                      {c.nom}
                    </Link>
                  </div>
                </td>
                <td className="chiffres px-4 py-3 text-[13px] text-encre-2">{c.sigle ?? <span className="text-encre-3">—</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pilule>
                      <span className="chiffres">{c.nbMarches}</span>
                    </Pilule>
                    {c.nbMarchesEnCours > 0 && c.nbMarchesEnCours < c.nbMarches && (
                      <span className="text-[12px] text-encre-3">dont {c.nbMarchesEnCours} en cours</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Pilule>
                    <span className="chiffres">{c.nbDocuments}</span>
                  </Pilule>
                </td>
                <td className="px-4 py-3">
                  <BadgeStatut statut={c.statut} />
                </td>
                <td className="px-2 py-3 text-right print:hidden">
                  <MenuClient client={c} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Carte>
  );
}

function VueGrille({ clients }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {clients.map((c) => (
        <li
          key={c.id}
          className="group relative flex flex-col gap-3 rounded-carte border border-trait bg-surface p-4 shadow-carte transition-[box-shadow,border-color] duration-200 focus-within:border-cyan hover:border-trait-fort hover:shadow-haute"
        >
          <div className="flex items-start gap-3">
            <PastilleClient client={c} />
            <div className="min-w-0 flex-1">
              {/* Le lien couvre toute la carte (after:inset-0) ; le menu passe
                  au-dessus (z-10). Un bouton ne peut pas vivre dans un lien. */}
              <Link
                to={`/clients/${c.id}`}
                title={c.nom}
                className="line-clamp-2 font-semibold leading-snug text-encre after:absolute after:inset-0 after:rounded-carte after:content-[''] group-hover:text-cyan-texte focus:outline-none"
              >
                {c.nom}
              </Link>
              <p className="chiffres mt-0.5 text-[12px] text-encre-3">{c.sigle ?? ' '}</p>
            </div>
            <div className="relative z-10 -mt-1 -mr-1">
              <MenuClient client={c} />
            </div>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2">
            <Pilule icone={FolderKanban}>{pluriel(c.nbMarches, 'marché')}</Pilule>
            <Pilule icone={FileText}>{pluriel(c.nbDocuments, 'pièce')}</Pilule>
            <BadgeStatut statut={c.statut} className="ml-auto" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Nouveau client ──────────────────────────────────────────────

/** « TGR, Trésorerie » → ['TGR', 'Trésorerie'] : virgule, point-virgule ou retour à la ligne. */
const decouper = (texte) =>
  String(texte ?? '')
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** « domainesEmail.1 » → « domainesEmail » : l'erreur s'affiche sous le champ de saisie. */
function parChamp(erreurs) {
  const sortie = {};
  for (const [cle, message] of Object.entries(erreurs)) sortie[cle.split('.')[0]] ??= message;
  return sortie;
}

const VIDE = { nom: '', sigle: '', synonymes: '', domainesEmail: '' };

function ModaleNouveauClient({ ouverte, surChangement }) {
  const f = useFormulaire(VIDE);
  const fileAttente = useQueryClient();
  const naviguer = useNavigate();
  const { notifier } = useToasts();

  function fermer(etat) {
    if (!etat) {
      f.setValeurs(VIDE);
      f.setErreurGenerale('');
    }
    surChangement(etat);
  }

  // Les listes sont saisies en texte : on les découpe avant de valider avec
  // le même schéma que le serveur, puis on remet ses erreurs sous les champs.
  const envoyer = f.soumettre(null, async (v) => {
    const lu = schemaClient.safeParse({ nom: v.nom, sigle: v.sigle, synonymes: decouper(v.synonymes), domainesEmail: decouper(v.domainesEmail) });
    if (!lu.success) throw new ErreurApi(422, { message: 'Certains champs sont à corriger.', erreurs: parChamp(erreursParChamp(lu.error)) });
    let cree;
    try {
      cree = await api('/api/clients', { methode: 'POST', corps: lu.data });
    } catch (erreur) {
      if (erreur instanceof ErreurApi) erreur.erreurs = parChamp(erreur.erreurs);
      throw erreur;
    }
    await fileAttente.invalidateQueries({ queryKey: ['clients'] });
    notifier({ titre: 'Client ajouté', message: cree.nom, ton: 'ok', action: { libelle: 'Ouvrir', onClick: () => naviguer(`/clients/${cree.id}`) } });
    fermer(false);
  });

  return (
    <Modale
      ouverte={ouverte}
      surChangement={fermer}
      titre="Nouveau client"
      description="Un maître d’ouvrage ajouté au référentiel. Ses synonymes aident à le reconnaître dans les pièces lues."
      pied={
        <>
          <Bouton variante="fantome" onClick={() => fermer(false)} disabled={f.envoi}>
            Annuler
          </Bouton>
          <Bouton type="submit" form="formulaire-nouveau-client" icone={Plus} chargement={f.envoi} libelleChargement="Ajout…">
            Ajouter le client
          </Bouton>
        </>
      }
    >
      <form id="formulaire-nouveau-client" onSubmit={envoyer} noValidate className="grid gap-4">
        {f.erreurGenerale && <Alerte ton="alerte">{f.erreurGenerale}</Alerte>}
        <Champ libelle="Nom complet" placeholder="Office National des Chemins de Fer" autoFocus {...f.champ('nom')} />
        <Champ libelle="Sigle" facultatif placeholder="ONCF" {...f.champ('sigle')} />
        <Champ libelle="Autres écritures" facultatif placeholder="ONCF, Office des chemins de fer" aide="Séparées par des virgules." {...f.champ('synonymes')} />
        <Champ libelle="Domaines e-mail" facultatif placeholder="oncf.ma" aide="Pour rattacher ses mails. Séparés par des virgules, sans @." {...f.champ('domainesEmail')} />
      </form>
    </Modale>
  );
}

// ── La page ─────────────────────────────────────────────────────

const CLE_VUE = 'icity.clients.vue';

/** La vue choisie, retenue d'une visite à l'autre sur ce poste. */
function vueRetenue() {
  try {
    return localStorage.getItem(CLE_VUE) === 'grille' ? 'grille' : 'tableau';
  } catch {
    return 'tableau';
  }
}

const FILTRES = [
  { cle: '', libelle: 'Tous' },
  { cle: 'en_cours', libelle: 'Marchés en cours' },
  { cle: 'clos', libelle: 'Clôturés' },
  { cle: 'sans_marche', libelle: 'Sans marché' },
];

export function PageClients() {
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api('/api/clients') });
  const { droits } = useSession();

  // Recherche et statut dans l'URL : en revenant d'une fiche, on retrouve
  // la liste telle qu'on l'avait laissée.
  const [parametres, setParametres] = useSearchParams();
  const filtre = parametres.get('q') ?? '';
  const statut = parametres.get('statut') ?? '';

  const [vue, setVueEtat] = useState(vueRetenue);
  const [tri, setTri] = useState({ cle: 'nom', sens: 'asc' });
  const [creation, setCreation] = useState(false);

  function changer(cle, valeur) {
    const suivant = new URLSearchParams(parametres);
    if (valeur) suivant.set(cle, valeur);
    else suivant.delete(cle);
    setParametres(suivant, { replace: true });
  }

  function setVue(v) {
    setVueEtat(v);
    try {
      localStorage.setItem(CLE_VUE, v);
    } catch {
      // Stockage refusé (navigation privée) : la vue vaut pour cette visite.
    }
  }

  /** Un clic sur la colonne déjà triée inverse le sens ; les compteurs partent du plus grand. */
  function trierPar(cle) {
    setTri((t) => (t.cle === cle ? { cle, sens: t.sens === 'asc' ? 'desc' : 'asc' } : { cle, sens: cle === 'nom' || cle === 'statut' ? 'asc' : 'desc' }));
  }

  /** L'export PDF passe par l'impression du navigateur, en vue tableau. */
  function imprimer() {
    setVue('tableau');
    requestAnimationFrame(() => setTimeout(() => window.print(), 60));
  }

  const trouves = useMemo(() => {
    const cherche = plat(filtre.trim());
    return (clients.data ?? []).filter((c) => plat(`${c.nom} ${c.sigle ?? ''} ${c.synonymes.join(' ')}`).includes(cherche));
  }, [clients.data, filtre]);

  const compteurs = useMemo(() => {
    const n = { '': trouves.length, en_cours: 0, clos: 0, sans_marche: 0 };
    for (const c of trouves) n[c.statut] += 1;
    return n;
  }, [trouves]);

  const visibles = useMemo(() => {
    const liste = statut ? trouves.filter((c) => c.statut === statut) : [...trouves];
    const { comparer } = TRIS[tri.cle];
    // Le nom départage les ex æquo : l'ordre ne saute pas d'un tri à l'autre.
    liste.sort((a, b) => (tri.sens === 'asc' ? 1 : -1) * comparer(a, b) || TRIS.nom.comparer(a, b));
    return liste;
  }, [trouves, statut, tri]);

  const total = clients.data?.length ?? 0;
  const peutCreer = droits.can('gerer', 'Client');
  const filtresActifs = Boolean(filtre || statut);

  return (
    <div className="animate-apparition">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] leading-tight font-semibold sm:text-[32px]">Clients</h1>
            <Badge ton="cyan">{pluriel(total, 'client')}</Badge>
          </div>
          <p className="mt-1.5 max-w-2xl text-encre-2 print:hidden">
            Les maîtres d’ouvrage du fonds. La société elle-même n’y figure pas : elle n’est jamais sa propre cliente.
          </p>
          <p className="mt-1 hidden text-sm text-encre-3 print:block">
            iCity GED — liste imprimée le {dateCourte(new Date())}
            {filtresActifs && ` · ${visibles.length} client(s) retenus par les filtres`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Bouton variante="secondaire" icone={Download} disabled={!total}>
                Exporter
              </Bouton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-60 animate-apparition rounded-xl border border-trait bg-surface p-1.5 shadow-haute">
                <DropdownMenu.Item className={ELEMENT_MENU} onSelect={() => (window.location.href = '/api/clients/export.csv')}>
                  <FileSpreadsheet className="size-4 text-encre-3" aria-hidden /> Tableur (CSV)
                </DropdownMenu.Item>
                <DropdownMenu.Item className={ELEMENT_MENU} onSelect={imprimer}>
                  <Printer className="size-4 text-encre-3" aria-hidden /> PDF (impression)
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {peutCreer && (
            <Bouton icone={Plus} onClick={() => setCreation(true)}>
              Nouveau client
            </Bouton>
          )}
        </div>
      </header>

      {/* La barre d'outils : recherche, statut, affichage. */}
      <Carte className="mb-5 flex flex-wrap items-center gap-3 p-3 print:hidden">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-3" aria-hidden />
          <input
            value={filtre}
            onChange={(e) => changer('q', e.target.value)}
            placeholder="Nom, sigle ou autre écriture…"
            aria-label="Rechercher un client"
            className="h-10 w-full rounded-[10px] border border-trait bg-surface-2 pr-9 pl-9 text-sm focus:border-cyan focus:bg-surface focus:outline-none"
          />
          {filtre && (
            <button
              type="button"
              onClick={() => changer('q', '')}
              aria-label="Effacer la recherche"
              className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-encre-3 hover:bg-surface-2 hover:text-encre"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <div role="group" aria-label="Filtrer par statut" className="flex flex-wrap gap-1 rounded-[10px] bg-surface-2 p-1">
          {FILTRES.map((f) => (
            <button
              key={f.cle}
              type="button"
              aria-pressed={statut === f.cle}
              onClick={() => changer('statut', f.cle)}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
                statut === f.cle ? 'bg-surface text-encre shadow-carte' : 'text-encre-2 hover:text-encre',
              )}
            >
              {f.libelle}
              <span className={cx('chiffres text-[11.5px]', statut === f.cle ? 'text-cyan-texte' : 'text-encre-3')}>{compteurs[f.cle]}</span>
            </button>
          ))}
        </div>

        {vue === 'grille' && (
          <select
            value={`${tri.cle}:${tri.sens}`}
            onChange={(e) => {
              const [cle, sens] = e.target.value.split(':');
              setTri({ cle, sens });
            }}
            aria-label="Trier les clients"
            className="h-10 rounded-[10px] border border-trait bg-surface-2 px-3 text-sm"
          >
            <option value="nom:asc">Nom, de A à Z</option>
            <option value="nbMarches:desc">Plus de marchés</option>
            <option value="nbDocuments:desc">Plus de pièces</option>
            <option value="statut:asc">Statut</option>
          </select>
        )}

        <div role="group" aria-label="Affichage" className="flex gap-1 rounded-[10px] bg-surface-2 p-1">
          {[
            ['tableau', 'Tableau', List],
            ['grille', 'Grille', LayoutGrid],
          ].map(([cle, libelle, Icone]) => (
            <button
              key={cle}
              type="button"
              aria-pressed={vue === cle}
              aria-label={`Affichage en ${libelle.toLowerCase()}`}
              title={libelle}
              onClick={() => setVue(cle)}
              className={cx('grid size-8 place-items-center rounded-lg transition-colors', vue === cle ? 'bg-surface text-cyan-texte shadow-carte' : 'text-encre-3 hover:text-encre')}
            >
              <Icone className="size-4" aria-hidden />
            </button>
          ))}
        </div>
      </Carte>

      {clients.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={6} />
        </Carte>
      ) : clients.isError ? (
        <Alerte ton="alerte">{clients.error.message}</Alerte>
      ) : visibles.length === 0 ? (
        <Carte>
          <EtatVide
            titre={total === 0 ? 'Aucun client pour l’instant' : 'Aucun client ne correspond'}
            action={
              filtresActifs ? (
                <Bouton variante="secondaire" onClick={() => setParametres({}, { replace: true })}>
                  Effacer les filtres
                </Bouton>
              ) : peutCreer ? (
                <Bouton icone={Plus} onClick={() => setCreation(true)}>
                  Nouveau client
                </Bouton>
              ) : null
            }
          >
            {total === 0 ? 'Ajoutez un premier maître d’ouvrage, ou versez des pièces : le classement reconnaît les clients connus.' : 'Élargissez la recherche ou changez de statut.'}
          </EtatVide>
        </Carte>
      ) : vue === 'grille' ? (
        <VueGrille clients={visibles} />
      ) : (
        <VueTableau clients={visibles} tri={tri} surTri={trierPar} />
      )}

      {peutCreer && <ModaleNouveauClient ouverte={creation} surChangement={setCreation} />}
    </div>
  );
}

export function PageFicheClient() {
  const { id } = useParams();
  const client = useQuery({ queryKey: ['client', id], queryFn: () => api(`/api/clients/${id}`) });

  if (client.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }
  if (client.isError) return <Alerte ton="alerte">{client.error.message}</Alerte>;

  const c = client.data;

  return (
    <div className="animate-apparition">
      <Link to="/clients" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-cyan-texte hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Tous les clients
      </Link>

      <EnTetePage
        surtitre={c.sigle ?? undefined}
        titre={c.nom}
        description={c.synonymes.length ? `Aussi écrit : ${c.synonymes.join(', ')}` : undefined}
        actions={c.interne ? <Badge ton="bordeaux">Société interne</Badge> : <Badge ton="cyan">{c.marches.length} marchés</Badge>}
      />

      <Carte>
        <h2 className="border-b border-trait px-5 py-3.5 font-semibold">Marchés</h2>
        {c.marches.length === 0 ? (
          <EtatVide titre="Aucun marché">Ce client ne porte que des attestations, ou ses marchés ne sont pas encore versés.</EtatVide>
        ) : (
          <ul className="divide-y divide-trait">
            {c.marches.map((m) => (
              <li key={m.id}>
                <Link to={`/marches/${m.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-surface-2">
                  <span className="chiffres min-w-40 font-medium text-cyan-texte">{m.reference}</span>
                  {m.lot && <Badge>lot {m.lot}</Badge>}
                  <span className="min-w-0 flex-1 truncate text-encre-2">{m.objet ?? m.objetTechnique ?? '—'}</span>
                  <BadgeEtatMarche marche={m} />
                  <span className={cx('chiffres text-[13px] text-encre-3', m.etatEcheance === 'depassee' && 'font-semibold text-alerte')}>
                    {m.echeance ? dateCourte(m.echeance) : '—'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte className="mt-5">
        <h2 className="border-b border-trait px-5 py-3.5 font-semibold">Échanges</h2>
        <EtatVide illustration="chantier" titre="Les mails avec ce client">
          La chronologie des messages reçus et envoyés, par conversation, arrive en phase 8.
        </EtatVide>
      </Carte>
    </div>
  );
}
