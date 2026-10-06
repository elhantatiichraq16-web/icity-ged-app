/**
 * Les analyses, comme les vues Graphique et Tableau croisé d'Odoo : on choisit
 * les données, la mesure, le regroupement en lignes et, au besoin, en
 * colonnes ; le résultat se lit en tableau (avec ses totaux) ou en graphique,
 * et s'exporte en Excel.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { ChartColumn, Download, Table2 } from 'lucide-react';
import { api } from '../api.js';
import { montant } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { CaseACocher, Selection } from '../ui/Champ.jsx';
import { Alerte, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

/** Les couleurs des séries, lues dans le thème : elles suivent le mode sombre. */
function palette() {
  const style = getComputedStyle(document.documentElement);
  return ['--cyan', '--teal', '--attente', '--ok', '--bordeaux', '--cyan-vif', '--alerte', '--encre-2'].map((v) => style.getPropertyValue(v).trim());
}

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function PageAnalyses() {
  const jeux = useQuery({ queryKey: ['analyses'], queryFn: () => api('/api/analyses') });
  const [choix, setChoix] = useState({ jeu: 'marches', mesure: '', lignes: '', colonnes: '', archives: false });
  const [vue, setVue] = useState('graphique');

  const jeu = (jeux.data ?? []).find((j) => j.cle === choix.jeu) ?? jeux.data?.[0];
  // Un autre jeu : on reprend sa première mesure et son premier regroupement.
  useEffect(() => {
    if (!jeu) return;
    setChoix((c) => ({
      ...c,
      jeu: jeu.cle,
      mesure: jeu.mesures.some((m) => m.cle === c.mesure) ? c.mesure : jeu.mesures[0].cle,
      lignes: jeu.regroupements.some((r) => r.cle === c.lignes) ? c.lignes : jeu.regroupements[0].cle,
      colonnes: jeu.regroupements.some((r) => r.cle === c.colonnes) ? c.colonnes : '',
    }));
  }, [jeu]);

  const parametres = new URLSearchParams({ mesure: choix.mesure, lignes: choix.lignes, ...(choix.colonnes ? { colonnes: choix.colonnes } : {}), ...(choix.archives ? { archives: '1' } : {}) });
  const tableau = useQuery({
    queryKey: ['analyse', choix],
    queryFn: () => api(`/api/analyses/${choix.jeu}?${parametres}`),
    enabled: Boolean(jeu && choix.mesure && choix.lignes),
    placeholderData: (precedent) => precedent,
  });
  const t = tableau.data;
  const valeur = (n) => (t?.mesure.monnaie ? montant(n) : nf.format(n));
  const changer = (cle) => (e) => setChoix((c) => ({ ...c, [cle]: cle === 'archives' ? e.target.checked : e.target.value }));

  return (
    <div className="animate-apparition">
      <EnTetePage
        titre="Analyses"
        description="Croisez une mesure par client, fournisseur, mois… en tableau ou en graphique."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Affichage" className="inline-flex rounded-[10px] border border-trait bg-surface p-0.5">
              {[
                ['graphique', 'Graphique', ChartColumn],
                ['tableau', 'Tableau croisé', Table2],
              ].map(([code, libelle, Icone]) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={vue === code}
                  onClick={() => setVue(code)}
                  className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium', vue === code ? 'bg-cyan-voile text-cyan-texte' : 'text-encre-2 hover:bg-surface-2')}
                >
                  <Icone className="size-4" aria-hidden /> {libelle}
                </button>
              ))}
            </div>
            <Bouton variante="secondaire" taille="petit" icone={Download} disabled={!t} onClick={() => (window.location.href = `/api/analyses/${choix.jeu}/export.xlsx?${parametres}`)}>
              Excel
            </Bouton>
          </div>
        }
      />

      {jeux.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={4} />
        </Carte>
      ) : jeux.isError ? (
        <Alerte ton="alerte">{jeux.error.message}</Alerte>
      ) : (
        <>
          <Carte className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <Selection libelle="Données" value={choix.jeu} onChange={changer('jeu')}>
              {jeux.data.map((j) => (
                <option key={j.cle} value={j.cle}>
                  {j.nom}
                </option>
              ))}
            </Selection>
            <Selection libelle="Mesure" value={choix.mesure} onChange={changer('mesure')}>
              {jeu?.mesures.map((m) => (
                <option key={m.cle} value={m.cle}>
                  {m.nom}
                </option>
              ))}
            </Selection>
            <Selection libelle="Regrouper en lignes" value={choix.lignes} onChange={changer('lignes')}>
              {jeu?.regroupements.map((r) => (
                <option key={r.cle} value={r.cle}>
                  {r.nom}
                </option>
              ))}
            </Selection>
            <Selection libelle="En colonnes (facultatif)" value={choix.colonnes} onChange={changer('colonnes')}>
              <option value="">—</option>
              {jeu?.regroupements
                .filter((r) => r.cle !== choix.lignes)
                .map((r) => (
                  <option key={r.cle} value={r.cle}>
                    {r.nom}
                  </option>
                ))}
            </Selection>
            <div className="flex items-end pb-2.5">
              <CaseACocher libelle="Avec les archives" checked={choix.archives} onChange={changer('archives')} />
            </div>
          </Carte>

          {!t ? (
            <Carte className="p-5">
              <SqueletteLignes lignes={6} />
            </Carte>
          ) : t.lignes.length === 0 ? (
            <Carte>
              <EtatVide titre="Rien à analyser">Aucune donnée pour ce choix. Cochez « Avec les archives » pour inclure le fonds précédent.</EtatVide>
            </Carte>
          ) : vue === 'graphique' ? (
            <Carte className="p-5">
              <h2 className="mb-4 font-semibold">{t.titre}</h2>
              <div style={{ height: Math.max(260, Math.min(600, t.lignes.length * 34 + 80)) }}>
                <Bar
                  data={{
                    labels: t.lignes,
                    datasets: t.colonnes.map((c, j) => ({
                      label: c,
                      data: t.valeurs.map((ligne) => ligne[j]),
                      backgroundColor: palette()[j % 8],
                      borderRadius: 4,
                      maxBarThickness: 28,
                    })),
                  }}
                  options={{
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: t.colonnes.length > 1, position: 'bottom' },
                      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label} : ${valeur(ctx.parsed.x)}` } },
                    },
                    scales: { x: { stacked: true, beginAtZero: true, ticks: { callback: (v) => nf.format(v) } }, y: { stacked: true } },
                  }}
                />
              </div>
              <p className="mt-3 text-right text-[14px]">
                Total : <strong className="chiffres">{valeur(t.total)}</strong>
              </p>
            </Carte>
          ) : (
            <Carte className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <caption className="px-5 pt-4 pb-2 text-left font-semibold">{t.titre}</caption>
                <thead>
                  <tr className="border-b border-trait bg-surface-2 text-[13px] font-semibold text-encre-3">
                    <th className="px-3 py-2.5 text-left" />
                    {t.colonnes.map((c) => (
                      <th key={c} className="px-3 py-2.5 text-right">
                        {c}
                      </th>
                    ))}
                    {t.colonnes.length > 1 && <th className="px-3 py-2.5 text-right">Total</th>}
                  </tr>
                </thead>
                <tbody>
                  {t.lignes.map((l, i) => (
                    <tr key={l} className="border-b border-trait">
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        {l}
                      </th>
                      {t.valeurs[i].map((v, j) => (
                        <td key={t.colonnes[j]} className={cx('chiffres px-3 py-2 text-right', !v && 'text-encre-3')}>
                          {v ? valeur(v) : '—'}
                        </td>
                      ))}
                      {t.colonnes.length > 1 && <td className="chiffres px-3 py-2 text-right font-semibold">{valeur(t.totauxLignes[i])}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-2 font-semibold">
                    <th scope="row" className="px-3 py-2.5 text-left">
                      Total
                    </th>
                    {t.totauxColonnes.map((v, j) => (
                      <td key={t.colonnes[j]} className="chiffres px-3 py-2.5 text-right">
                        {valeur(v)}
                      </td>
                    ))}
                    {t.colonnes.length > 1 && <td className="chiffres px-3 py-2.5 text-right">{valeur(t.total)}</td>}
                  </tr>
                </tfoot>
              </table>
            </Carte>
          )}
        </>
      )}
    </div>
  );
}
