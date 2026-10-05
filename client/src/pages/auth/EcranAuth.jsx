/**
 * L'écran partagé des pages d'authentification, repris du portail actuel
 * (connexion/index.html) :
 *  - à gauche, la colonne de marque en dégradé, avec des formes SVG et trois
 *    repères ;
 *  - à droite, le formulaire.
 * Sous 900 px, la colonne de marque disparaît : sur un téléphone, elle
 * repousserait le formulaire hors du premier écran.
 */
import { FileSearch, FolderKanban, ShieldCheck } from 'lucide-react';
import { Logo } from '../../ui/Logo.jsx';

const REPERES = [
  { icone: FolderKanban, titre: 'Marchés suivis', texte: 'du dépôt à la mainlevée de caution' },
  { icone: FileSearch, titre: 'Texte cherchable', texte: 'OCR en français, arabe et anglais' },
  { icone: ShieldCheck, titre: 'Circuit de validation', texte: 'chaque pièce contrôlée et tracée' },
];

export function EcranAuth({ titre, sousTitre, children }) {
  return (
    <div className="grid min-h-screen min-[900px]:grid-cols-[1.15fr_1fr]">
      {/* ── Colonne de marque ── */}
      <aside aria-hidden className="relative hidden overflow-hidden bg-[linear-gradient(152deg,#0B93A5_0%,#0E8296_42%,#054f59_100%)] px-[6vw] py-14 text-white min-[900px]:flex min-[900px]:items-center">
        <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <radialGradient id="halo" cx="30%" cy="18%" r="78%">
              <stop offset="0%" stopColor="#3fd3e8" stopOpacity=".30" />
              <stop offset="100%" stopColor="#3fd3e8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="600" height="900" fill="url(#halo)" />
          <path d="M-60 640c120-90 210 40 330-30s180-210 350-150v440H-60z" fill="#fff" opacity=".045" />
          <path d="M-40 762c150-70 240 60 360-10s200-150 320-100v248H-40z" fill="#fff" opacity=".055" />
          <circle cx="505" cy="148" r="150" fill="#fff" opacity=".04" />
          <circle cx="92" cy="322" r="78" fill="#fff" opacity=".05" />
          <circle cx="430" cy="470" r="34" fill="#7ce8f7" opacity=".14" />
        </svg>

        <div className="relative max-w-[30rem]">
          <div className="mb-10 flex items-center gap-3">
            <Logo className="h-[59px] w-[140px]" couleur="#fff" />
            <span className="rounded-[3px] border border-white/40 px-2.5 py-1 text-[13px] font-bold tracking-[0.12em] text-white/90">GED</span>
          </div>
          <h1 className="mb-5 font-titre text-[clamp(32px,3.4vw,44px)] leading-[1.1] font-semibold text-balance text-white">
            Gestion documentaire des marchés
          </h1>
          <p className="mb-10 max-w-[36ch] text-[15.5px] leading-relaxed text-white/80">
            Les marchés, les références et les pièces contractuelles d'iCity, du dépôt jusqu'à la mainlevée de caution.
          </p>
          <ul className="grid gap-5 border-t border-white/20 pt-7">
            {REPERES.map(({ icone: Icone, titre: t, texte }) => (
              <li key={t} className="flex items-center gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/12 ring-1 ring-white/20">
                  <Icone className="size-5" />
                </span>
                <span className="leading-snug">
                  <strong className="block text-[15px] font-semibold">{t}</strong>
                  <span className="text-[13px] text-white/70">{texte}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* ── Colonne du formulaire ── */}
      <main className="grid place-items-start bg-fond px-5 py-10 min-[900px]:place-items-center min-[900px]:bg-surface min-[900px]:px-[5vw]">
        <div className="w-full max-w-[400px] rounded-carte border border-trait bg-surface px-7 pt-8 pb-6 shadow-carte max-[900px]:mx-auto min-[900px]:border-0 min-[900px]:p-0 min-[900px]:shadow-none">
          <Logo className="mb-7 h-[52px] w-[122px] text-teal min-[900px]:hidden" />
          <h2 className="mb-1.5 text-[28px] font-semibold">{titre}</h2>
          {sousTitre && <p className="mb-8 text-sm text-encre-2">{sousTitre}</p>}
          {children}
          <footer className="mt-9 border-t border-trait pt-5 text-[12.5px] text-encre-3">
            Propulsé par <strong className="font-bold tracking-[0.04em] text-bordeaux">ABA TECHNOLOGY</strong> — Casablanca, Maroc
          </footer>
        </div>
      </main>
    </div>
  );
}
