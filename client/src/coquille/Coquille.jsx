/**
 * La mise en page de l'application connectée (§11) :
 *  - barre latérale repliable (tiroir sur téléphone) ;
 *  - barre du haut : recherche globale (Ctrl+K), cloche, menu utilisateur ;
 *  - la page courante au centre (<Outlet />).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { DropdownMenu, Popover, Tooltip } from 'radix-ui';
import { Bell, ChevronRight, ChevronsLeft, ChevronsRight, LogOut, Menu, Monitor, Moon, Search, Sun, User, X } from 'lucide-react';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { cx } from '../ui/cx.js';
import { depuis } from '../format.js';
import { Logo, Pictogramme } from '../ui/Logo.jsx';
import { groupesVisibles, ICONES_GROUPES } from './navigation.js';
import { PaletteCommandes } from './PaletteCommandes.jsx';
import { useTheme } from './theme.js';

const CLE_REPLIE = 'icity.barre-repliee';
const CLE_GROUPES = 'icity.groupes-ouverts';

/**
 * Les groupes du menu ouverts ou fermés à la main, `{ Affaires: true }` :
 * un confort, perdu sans dommage.
 */
function lireChoixGroupes() {
  try {
    const lu = JSON.parse(localStorage.getItem(CLE_GROUPES) ?? '{}');
    return lu && typeof lu === 'object' && !Array.isArray(lu) ? lu : {};
  } catch {
    return {};
  }
}

function lireReplie() {
  try {
    return localStorage.getItem(CLE_REPLIE) === '1';
  } catch {
    return false;
  }
}

export function Coquille() {
  const { droits } = useSession();
  const [replie, setReplie] = useState(lireReplie);
  const [tiroir, setTiroir] = useState(false);
  const [palette, setPalette] = useState(false);
  const lieu = useLocation();

  // Le tiroir mobile se ferme dès qu'on change d'écran.
  useEffect(() => setTiroir(false), [lieu.pathname]);

  // Ctrl+K (Cmd+K sur Mac) ouvre la recherche globale, où qu'on soit.
  useEffect(() => {
    const surTouche = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, []);

  function basculer() {
    setReplie((r) => {
      try {
        localStorage.setItem(CLE_REPLIE, r ? '0' : '1');
      } catch {
        /* confort seulement */
      }
      return !r;
    });
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      {/* Lien d'évitement : au clavier, on saute directement au contenu. */}
      <a href="#contenu" className="sr-only z-[70] rounded-lg bg-cyan px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Aller au contenu
      </a>

      <div className="flex min-h-screen">
        {/* ── Barre latérale (ordinateur) ── */}
        <aside className={cx('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-trait bg-surface transition-[width] duration-200 lg:flex print:hidden', replie ? 'w-[76px]' : 'w-64')}>
          <ContenuBarre replie={replie} droits={droits} />
          <div className="border-t border-trait p-3">
            <button
              type="button"
              onClick={basculer}
              aria-label={replie ? 'Déplier la barre latérale' : 'Replier la barre latérale'}
              className={cx('flex h-9 w-full items-center gap-2 rounded-lg px-3 text-[13px] text-encre-3 hover:bg-surface-2 hover:text-encre', replie && 'justify-center px-0')}
            >
              {replie ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
              {!replie && 'Replier'}
            </button>
          </div>
        </aside>

        {/* ── Tiroir (téléphone et tablette) ── */}
        {tiroir && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" aria-label="Fermer le menu" className="absolute inset-0 animate-apparition bg-[rgb(8_15_20/0.45)]" onClick={() => setTiroir(false)} />
            <aside className="relative flex h-full w-72 max-w-[85vw] animate-glisse flex-col bg-surface shadow-haute">
              <button type="button" onClick={() => setTiroir(false)} aria-label="Fermer le menu" className="absolute top-4 right-3 grid size-9 place-items-center rounded-lg text-encre-3 hover:bg-surface-2">
                <X className="size-5" aria-hidden />
              </button>
              <ContenuBarre replie={false} droits={droits} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <BarreHaut ouvrirTiroir={() => setTiroir(true)} ouvrirPalette={() => setPalette(true)} />
          <main id="contenu" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
            <Outlet />
          </main>
        </div>
      </div>

      <PaletteCommandes ouverte={palette} surChangement={setPalette} />
    </Tooltip.Provider>
  );
}

function ContenuBarre({ replie, droits }) {
  return (
    <>
      <Link to="/" className={cx('flex h-16 shrink-0 items-center gap-2.5 px-5', replie && 'justify-center px-0')} aria-label="iCity GED — tableau de bord">
        {replie ? (
          <Pictogramme className="size-9" />
        ) : (
          <>
            <Logo className="h-8 w-auto text-cyan" />
            <span className="rounded border border-trait-fort px-1.5 py-px text-[10.5px] font-bold tracking-[0.12em] text-encre-2">GED</span>
          </>
        )}
      </Link>
      <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-3">
        {replie ? <MenuReplie droits={droits} /> : <MenuGroupes droits={droits} />}
      </nav>
    </>
  );
}

/** Barre repliée : toutes les icônes, un trait entre deux groupes. */
function MenuReplie({ droits }) {
  return groupesVisibles(droits).map(({ groupe, entrees }, i) => (
    <div key={groupe}>
      {i > 0 && <div aria-hidden className="mx-2 my-2 border-t border-trait" />}
      <ul className="grid gap-0.5" aria-label={groupe}>
        {entrees.map((e) => (
          <li key={e.chemin}>
            <EntreeNavigation entree={e} replie />
          </li>
        ))}
      </ul>
    </div>
  ));
}

/**
 * Barre dépliée : chaque groupe s'ouvre d'un clic sur son titre (« Affaires »
 * montre Marchés, Achats, Clients). Tant qu'on n'y a pas touché, seul le
 * groupe de la page courante est ouvert, pour qu'on voie où l'on est ; ensuite
 * il suit le dernier clic. Un groupe d'une seule entrée reste un lien direct.
 */
function MenuGroupes({ droits }) {
  const { pathname } = useLocation();
  const [choix, setChoix] = useState(lireChoixGroupes);

  function basculer(groupe, ouvert) {
    setChoix((avant) => {
      const apres = { ...avant, [groupe]: !ouvert };
      try {
        localStorage.setItem(CLE_GROUPES, JSON.stringify(apres));
      } catch {
        // Navigation privée : le menu oubliera, rien de plus.
      }
      return apres;
    });
  }

  const estCourante = (e) => (e.chemin === '/' ? pathname === '/' : pathname.startsWith(e.chemin));

  return (
    <ul className="grid gap-0.5">
      {groupesVisibles(droits).map(({ groupe, entrees }) => {
        if (entrees.length === 1) {
          return (
            <li key={groupe}>
              <EntreeNavigation entree={entrees[0]} />
            </li>
          );
        }
        const courant = entrees.some(estCourante);
        const ouvert = choix[groupe] ?? courant;
        const Icone = ICONES_GROUPES[groupe];
        const idListe = `menu-${groupe}`;
        return (
          <li key={groupe}>
            <button
              type="button"
              onClick={() => basculer(groupe, ouvert)}
              aria-expanded={ouvert}
              aria-controls={idListe}
              className={cx(
                'flex h-9 w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors',
                courant && !ouvert ? 'text-cyan-texte' : 'text-encre-2',
                'hover:bg-surface-2 hover:text-encre',
              )}
            >
              {Icone && <Icone className="size-[18px] shrink-0" aria-hidden />}
              <span className="flex-1 truncate text-left">{groupe}</span>
              <ChevronRight className={cx('size-4 shrink-0 text-encre-3 transition-transform', ouvert && 'rotate-90')} aria-hidden />
            </button>
            {ouvert && (
              <ul id={idListe} aria-label={groupe} className="mt-0.5 ml-[21px] grid gap-0.5 border-l border-trait pl-2">
                {entrees.map((e) => (
                  <li key={e.chemin}>
                    <EntreeNavigation entree={e} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EntreeNavigation({ entree, replie }) {
  const Icone = entree.icone;

  const lien = (
    <NavLink
      to={entree.chemin}
      end={entree.chemin === '/'}
      className={({ isActive }) =>
        cx(
          'group relative flex h-9 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors',
          replie && 'justify-center px-0',
          isActive ? 'bg-cyan-voile text-cyan-texte' : 'text-encre-2 hover:bg-surface-2 hover:text-encre',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-cyan" />}
          <Icone className="size-[18px] shrink-0" aria-hidden />
          {replie ? <span className="sr-only">{entree.libelle}</span> : <span className="truncate">{entree.libelle}</span>}
        </>
      )}
    </NavLink>
  );

  if (!replie) return lien;
  // Barre repliée : le libellé apparaît en info-bulle au survol et au focus.
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{lien}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={10} className="z-50 animate-apparition rounded-md bg-encre px-2.5 py-1.5 text-[13px] font-medium text-surface">
          {entree.libelle}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function BarreHaut({ ouvrirTiroir, ouvrirPalette }) {
  const surMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-trait print:hidden bg-[color-mix(in_oklab,var(--surface),transparent_12%)] px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <button type="button" onClick={ouvrirTiroir} aria-label="Ouvrir le menu" className="grid size-10 place-items-center rounded-lg text-encre-2 hover:bg-surface-2 lg:hidden">
        <Menu className="size-5" aria-hidden />
      </button>

      <button
        type="button"
        onClick={ouvrirPalette}
        className="flex h-10 w-full max-w-md items-center gap-3 rounded-[10px] border border-trait bg-surface-2 px-3 text-left text-sm text-encre-3 transition-colors hover:border-trait-fort"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Rechercher…</span>
        <kbd className="hidden rounded border border-trait bg-surface px-1.5 py-0.5 font-mono text-[11px] sm:inline">{surMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <Cloche />
        <MenuUtilisateur />
      </div>
    </header>
  );
}

/**
 * La cloche : ce qui travaille en fond, et ce qui attend une décision.
 * Elle se rafraîchit toutes les 30 secondes — assez pour suivre une relève,
 * assez peu pour ne pas peser sur un PC de 3,7 Go.
 */
/**
 * La cloche : les messages (mentions, changements sur les fiches suivies,
 * comme dans Odoo), puis les tâches de fond (lectures, relève du courriel).
 */
function Cloche() {
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => api('/api/notifications'), refetchInterval: 30_000 });
  const file = useQueryClient();
  const naviguer = useNavigate();
  const [ouverte, setOuverte] = useState(false);
  // Les messages encore non lus à l'ouverture : ils restent surlignés tant que la cloche est ouverte.
  const [nouveaux, setNouveaux] = useState(() => new Set());
  const taches = notifications.data?.taches ?? [];
  const messages = notifications.data?.messages ?? [];
  const nonLues = notifications.data?.nonLues ?? 0;

  async function marquerLues(ids) {
    await api('/api/notifications/lues', { methode: 'POST', corps: ids ? { ids } : {} }).catch(() => {});
    file.invalidateQueries({ queryKey: ['notifications'] });
  }

  // Ouvrir la cloche, c'est avoir vu ses messages : le compteur retombe à zéro.
  function ouvrirOuFermer(etat) {
    setOuverte(etat);
    if (etat) {
      setNouveaux(new Set(messages.filter((m) => !m.lue).map((m) => m.id)));
      if (nonLues > 0) marquerLues();
    }
  }

  return (
    <Popover.Root open={ouverte} onOpenChange={ouvrirOuFermer}>
      <Popover.Trigger
        className="relative grid size-10 place-items-center rounded-lg text-encre-2 hover:bg-surface-2 hover:text-encre"
        aria-label={nonLues ? `Notifications : ${nonLues} non lue(s)` : taches.length ? `Tâches en cours : ${taches.length}` : 'Notifications : aucune'}
      >
        <Bell className="size-5" aria-hidden />
        {/* Le chiffre : les messages pas encore vus. Des tâches en cours seulement : un simple point. */}
        {nonLues > 0 ? (
          <span className="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full bg-alerte text-[10px] font-bold text-white" aria-hidden>
            {nonLues > 9 ? '9+' : nonLues}
          </span>
        ) : (
          taches.length > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-cyan" aria-hidden />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-96 max-w-[calc(100vw-1rem)] animate-apparition rounded-carte border border-trait bg-surface shadow-haute focus:outline-none">
          <div className="flex items-center justify-between border-b border-trait px-4 py-3">
            <p className="font-semibold">Messages</p>
          </div>
          {messages.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-encre-3">Les mentions (@vous), les invitations, les rappels et les changements sur les fiches que vous suivez apparaîtront ici.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto p-2">
              {messages.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!m.lue) marquerLues([m.id]);
                      setOuverte(false);
                      naviguer(m.lien);
                    }}
                    className={cx('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-2', (!m.lue || nouveaux.has(m.id)) && 'bg-cyan-voile/60')}
                  >
                    <span className={cx('mt-1 size-2 shrink-0 rounded-full', m.lue && !nouveaux.has(m.id) ? 'bg-trait-fort' : m.genre === 'mention' ? 'bg-alerte' : m.genre === 'rappel' ? 'bg-attente' : 'bg-cyan')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cx('block', (!m.lue || nouveaux.has(m.id)) && 'font-medium')}>{m.texte}</span>
                      <span className="text-[12.5px] text-encre-3">{depuis(m.creeLe)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-trait px-4 py-3">
            <p className="font-semibold">Tâches en cours</p>
          </div>
          {taches.length === 0 ? (
            <p className="px-4 pb-3 text-[13px] text-encre-3">Rien en cours. Les lectures OCR et les relèves de courriel apparaîtront ici.</p>
          ) : (
            <ul className="p-2 pt-0">
              {taches.map((t) => (
                <li key={t.cle}>
                  <Link to={t.vers} onClick={() => setOuverte(false)} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] hover:bg-surface-2">
                    <span className={cx('size-2 shrink-0 rounded-full', t.ton === 'alerte' ? 'bg-alerte' : t.ton === 'attente' ? 'bg-attente' : 'bg-cyan')} aria-hidden />
                    <span className="min-w-0 flex-1">{t.libelle}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-trait px-4 py-2.5">
            <Link to="/arrivees" onClick={() => setOuverte(false)} className="text-[13px] font-medium text-cyan-texte hover:underline">
              Arrivées des dernières 24 h ({notifications.data?.arrivees ?? 0})
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuUtilisateur() {
  const { utilisateur, deconnecter } = useSession();
  const [theme, setTheme] = useTheme();
  const naviguer = useNavigate();

  const element = 'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-encre outline-none data-[highlighted]:bg-surface-2';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2.5 rounded-full p-1 hover:bg-surface-2 sm:rounded-[10px] sm:pr-3" aria-label="Menu du compte">
        <Avatar utilisateur={utilisateur} taille="petit" />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-40 truncate text-[13.5px] font-semibold text-encre">{utilisateur.nom}</span>
          <span className="block text-[13px] text-encre-3">{utilisateur.roleNom}</span>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-64 animate-apparition rounded-xl border border-trait bg-surface p-1.5 shadow-haute">
          <div className="px-2.5 pt-1.5 pb-2.5">
            <p className="truncate font-semibold">{utilisateur.nom}</p>
            <p className="truncate text-[13px] text-encre-3">{utilisateur.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-trait" />
          <DropdownMenu.Item className={element} onSelect={() => naviguer('/profil')}>
            <User className="size-4 text-encre-3" aria-hidden /> Mon profil
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-trait" />
          <DropdownMenu.Label className="px-2.5 py-1 text-[12.5px] font-semibold tracking-wide text-encre-3 uppercase">Thème</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={theme} onValueChange={setTheme}>
            {[
              ['clair', 'Clair', Sun],
              ['sombre', 'Sombre', Moon],
              ['systeme', 'Comme Windows', Monitor],
            ].map(([valeur, libelle, Icone]) => (
              <DropdownMenu.RadioItem key={valeur} value={valeur} className={cx(element, 'data-[state=checked]:font-semibold data-[state=checked]:text-cyan-texte')}>
                <Icone className="size-4 text-encre-3" aria-hidden /> {libelle}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-trait" />
          <DropdownMenu.Item
            className={cx(element, 'text-alerte-texte')}
            onSelect={async () => {
              await deconnecter();
              naviguer('/connexion', { replace: true });
            }}
          >
            <LogOut className="size-4" aria-hidden /> Se déconnecter
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
