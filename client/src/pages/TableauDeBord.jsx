/**
 * Le tableau de bord (§11, écran 1).
 *
 * Les chiffres viennent du serveur, tels quels : l'écran ne recalcule rien.
 * Il se rafraîchit tout seul toutes les 60 secondes.
 */
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArcElement, BarElement, CategoryScale, Chart, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { AlertTriangle, FileText, FolderKanban, Layers, ShieldAlert, Trash2 } from 'lucide-react';
import { ORDRE_PHASES, PHASES } from '@icity/commun/marches';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { depuis } from '../format.js';
import { Alerte, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';

Chart.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Tooltip);

/** Les couleurs des graphiques, lues dans le thème : elles suivent le mode sombre. */
function couleurs() {
  const style = getComputedStyle(document.documentElement);
  const v = (nom) => style.getPropertyValue(nom).trim();
  return {
    cyan: v('--cyan'),
    cyanVif: v('--cyan-vif'),
    teal: v('--teal'),
    bordeaux: v('--bordeaux'),
    ok: v('--ok'),
    attente: v('--attente'),
    alerte: v('--alerte'),
    encre: v('--encre-2'),
    trait: v('--trait'),
  };
}

const OPTIONS = (c) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { backgroundColor: c.encre } },
  scales: {
    x: { grid: { display: false }, ticks: { color: c.encre, font: { size: 11 } } },
    y: { beginAtZero: true, grid: { color: c.trait }, ticks: { color: c.encre, precision: 0, font: { size: 11 } } },
  },
});

export function PageTableauDeBord() {
  const { utilisateur } = useSession();
  const donnees = useQuery({ queryKey: ['tableau-bord'], queryFn: () => api('/api/tableau-bord'), refetchInterval: 60_000 });

  if (donnees.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={6} />
      </Carte>
    );
  }
  if (donnees.isError) return <Alerte ton="alerte">{donnees.error.message}</Alerte>;

  const { tuiles, alertes, graphiques, activite } = donnees.data;
  const c = couleurs();
  const prenom = utilisateur.nom.split(' ')[0];

  return (
    <div className="animate-apparition">
      <EnTetePage
        surtitre={new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Africa/Casablanca' }).format(new Date())}
        titre={`Bonjour, ${prenom}`}
        description="L’état du fonds : les affaires, ce qui manque à leurs dossiers, et ce qui demande votre attention."
      />

      {/* ── Tuiles ── */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tuile
          icone={FolderKanban}
          titre="Marchés en cours"
          chiffre={tuiles.parPhase.cours + tuiles.parPhase.provisoire}
          note={`${tuiles.parPhase.attente} en attente d’OS · ${tuiles.marchesTotal} au total · ${tuiles.appelsOffres ?? 0} appel(s) d’offres`}
          vers="/marches?phase=cours"
        />
        <Tuile
          icone={Layers}
          titre="Dossiers incomplets"
          chiffre={tuiles.incomplets}
          note="des pièces manquent à l’étape franchie"
          ton={tuiles.incomplets ? 'attente' : 'ok'}
          vers="/marches"
        />
        <Tuile
          icone={ShieldAlert}
          titre="Cautions non restituées"
          chiffre={tuiles.cautions}
          note="réception définitive sans mainlevée"
          ton={tuiles.cautions ? 'alerte' : 'ok'}
          vers="/marches?phase=caution"
        />
        <Tuile icone={FileText} titre="Documents" chiffre={tuiles.documents} note={`${tuiles.pages} pages lues`} vers="/documents" />
      </div>

      {/* ── Jauge de rattachement ── */}
      <Carte className="mb-5 p-5">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-semibold">Taux de rattachement</h2>
          <p className="text-[13px] text-encre-2">
            <strong className="chiffres text-lg text-encre">{tuiles.tauxRattachement} %</strong> — {tuiles.rattaches} pièces sur {tuiles.documents} appartiennent à une affaire
          </p>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-trait" role="img" aria-label={`${tuiles.tauxRattachement} pour cent des pièces sont rattachées à un marché`}>
          <div
            className={cx('h-full rounded-full transition-[width] duration-500', tuiles.tauxRattachement >= 80 ? 'bg-ok' : tuiles.tauxRattachement >= 50 ? 'bg-attente' : 'bg-bordeaux')}
            style={{ width: `${Math.max(2, tuiles.tauxRattachement)}%` }}
          />
        </div>
      </Carte>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        {/* ── Graphiques ── */}
        <div className="grid content-start gap-5">
          <Carte className="p-5">
            <h2 className="mb-4 font-semibold">Nature des pièces</h2>
            <div className="h-64">
              <Bar
                data={{
                  labels: graphiques.natureDesPieces.map((t) => t.nom),
                  datasets: [{ data: graphiques.natureDesPieces.map((t) => t.n), backgroundColor: c.cyan, borderRadius: 6, maxBarThickness: 34 }],
                }}
                options={OPTIONS(c)}
              />
            </div>
          </Carte>

          <div className="grid gap-5 md:grid-cols-2">
            <Carte className="p-5">
              <h2 className="mb-4 font-semibold">Pièces manquantes par marché</h2>
              <div className="h-56">
                {graphiques.piecesManquantes.length ? (
                  <Bar
                    data={{
                      labels: graphiques.piecesManquantes.map((m) => m.nom),
                      datasets: [{ data: graphiques.piecesManquantes.map((m) => m.n), backgroundColor: c.bordeaux, borderRadius: 6, maxBarThickness: 28 }],
                    }}
                    options={{ ...OPTIONS(c), indexAxis: 'y' }}
                  />
                ) : (
                  <EtatVide titre="Aucune pièce manquante" className="py-6">
                    Chaque dossier porte ce que son étape exige.
                  </EtatVide>
                )}
              </div>
            </Carte>

            <Carte className="p-5">
              <h2 className="mb-4 font-semibold">Marchés par client</h2>
              <div className="h-56">
                <Doughnut
                  data={{
                    labels: graphiques.marchesParClient.map((m) => m.nom),
                    datasets: [
                      {
                        data: graphiques.marchesParClient.map((m) => m.n),
                        backgroundColor: [c.cyan, c.teal, c.cyanVif, c.ok, c.attente, c.bordeaux, c.alerte, c.encre],
                        borderWidth: 0,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '58%',
                    plugins: { legend: { position: 'right', labels: { color: c.encre, boxWidth: 10, font: { size: 11 } } } },
                  }}
                />
              </div>
            </Carte>
          </div>

          <Carte className="p-5">
            <h2 className="mb-4 font-semibold">Versements par mois</h2>
            <div className="h-48">
              <Line
                data={{
                  labels: graphiques.versementsParMois.map((m) => m.nom),
                  datasets: [{ data: graphiques.versementsParMois.map((m) => m.n), borderColor: c.cyan, backgroundColor: c.cyan, tension: 0.3, fill: false, pointRadius: 3 }],
                }}
                options={OPTIONS(c)}
              />
            </div>
          </Carte>
        </div>

        {/* ── Alertes et activité ── */}
        <div className="grid content-start gap-5">
          <Carte className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 text-attente" aria-hidden /> Ce qui demande attention
            </h2>
            {alertes.length === 0 ? (
              <p className="text-[13px] text-encre-2">Rien d’urgent : aucune échéance proche, aucune caution en attente.</p>
            ) : (
              <ul className="grid gap-2">
                {alertes.map((a, i) => (
                  <li key={i}>
                    <Link
                      to={`/marches/${a.marcheId}`}
                      className={cx(
                        'flex items-start gap-2 rounded-lg border-l-[3px] px-3 py-2 text-[13px] hover:bg-surface-2',
                        a.ton === 'alerte' ? 'border-alerte' : a.ton === 'attente' ? 'border-attente' : 'border-trait-fort',
                      )}
                    >
                      <span className="chiffres font-medium text-encre">{a.reference}</span>
                      <span className="text-encre-2">{a.message}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Carte>

          <Carte className="p-5">
            <h2 className="mb-3 font-semibold">Phases des marchés</h2>
            <ul className="grid gap-2">
              {ORDRE_PHASES.map((p) => (
                <li key={p} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-encre-2">{PHASES[p].nom}</span>
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-trait">
                    <span
                      className="block h-full rounded-full bg-cyan"
                      style={{ width: `${tuiles.marchesTotal ? (tuiles.parPhase[p] / tuiles.marchesTotal) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="chiffres w-6 text-right text-[13px] font-semibold">{tuiles.parPhase[p]}</span>
                </li>
              ))}
            </ul>
          </Carte>

          <Carte className="p-5">
            <h2 className="mb-3 font-semibold">Activité récente</h2>
            {activite.length === 0 ? (
              <p className="text-[13px] text-encre-2">Rien encore.</p>
            ) : (
              <ul className="grid gap-2.5">
                {activite.map((a) => (
                  <li key={a.id} className="text-[13px]">
                    <span className="font-medium text-encre">{a.par}</span>{' '}
                    <span className="text-encre-2">{a.action.replace(/\./g, ' · ').replace(/_/g, ' ')}</span>
                    <span className="block text-[12px] text-encre-3">
                      {depuis(a.creeLe)}
                      {a.commentaire ? ` · ${a.commentaire}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Carte>

          {tuiles.corbeille > 0 && (
            <Link to="/corbeille" className="text-[13px] text-encre-2 hover:underline">
              <Trash2 className="mr-1 inline size-4" aria-hidden /> {tuiles.corbeille} document(s) en corbeille
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Tuile({ icone: Icone, titre, chiffre, note, ton, vers }) {
  const contenu = (
    <Carte as="div" className="h-full p-5 transition-[box-shadow,border-color] duration-200 hover:border-trait-fort hover:shadow-haute">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className={cx(
            'grid size-9 place-items-center rounded-lg',
            ton === 'alerte' ? 'bg-alerte-voile text-alerte' : ton === 'attente' ? 'bg-attente-voile text-attente' : ton === 'ok' ? 'bg-ok-voile text-ok' : 'bg-cyan-voile text-cyan-texte',
          )}
        >
          <Icone className="size-[18px]" aria-hidden />
        </span>
        <span className="text-[13px] font-medium text-encre-2">{titre}</span>
      </div>
      <p className="chiffres text-[32px] leading-none font-semibold">{chiffre}</p>
      {note && <p className="mt-1.5 text-[12.5px] text-encre-3">{note}</p>}
    </Carte>
  );
  return vers ? <Link to={vers}>{contenu}</Link> : contenu;
}
