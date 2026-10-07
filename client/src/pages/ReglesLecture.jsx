/**
 * L'éditeur des règles de lecture d'une source (Paramètres → Sources de marchés).
 *
 * Si un site change sa page, on corrige ici la règle qui ne trouve plus
 * l'information, on l'essaie sur la vraie page, et on enregistre : pas de code
 * à modifier. Chaque champ a plusieurs règles, essayées dans l'ordre.
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical, Plus, RotateCcw, X } from 'lucide-react';
import { api } from '../api.js';
import { dateCourte } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ } from '../ui/Champ.jsx';
import { Alerte } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';

/** Les champs d'une offre, dans l'ordre où on les montre. */
const CHAMPS = [
  ['idExterne', 'Identifiant (stable)'],
  ['urlOfficielle', 'Adresse de l’annonce'],
  ['reference', 'Référence'],
  ['objet', 'Objet'],
  ['resume', 'Résumé'],
  ['acheteur', 'Acheteur public'],
  ['categorie', 'Catégorie'],
  ['domaines', 'Domaines'],
  ['procedure', 'Procédure'],
  ['lieu', 'Lieu'],
  ['datePublication', 'Date de publication'],
  ['dateLimite', 'Date limite'],
  ['estimation', 'Estimation'],
  ['caution', 'Caution'],
  ['lots', 'Lots'],
  ['reponseElectronique', 'Réponse électronique'],
  ['documents', 'Documents'],
  ['statutExterne', 'Statut sur la source'],
];
const libelle = (c) => CHAMPS.find(([k]) => k === c)?.[1] ?? `${c} (aide)`;

const AIDE = [
  ['css:SÉLECTEUR', 'le texte d’un élément', 'css:span.ref'],
  ['css:SÉLECTEUR@attribut', 'un attribut', 'css:input[id$="_refCons"]@value'],
  ['etiquette:LIBELLÉ', 'le texte après « LIBELLÉ : »', 'etiquette:Acheteur public'],
  ['regex:MOTIF', 'dans le HTML (groupes réunis)', 'regex:(\\d{2}/\\d{2}/\\d{4})'],
  ['texte:MOTIF', 'dans le texte sans balises', 'texte:Estimation[^:]*:\\s*([\\d .,]+)'],
  ['json:chemin', 'dans une annonce JSON', 'json:acheteur.nom'],
  ['modele:… {champ} …', 'à partir d’autres champs', 'modele:pmmp-{_org}-{_ref}'],
  ['fixe:valeur', 'une valeur fixe', 'fixe:En cours'],
  ['documents:MOTIF', 'les liens dont l’adresse correspond', 'documents:\\.pdf$'],
  ['… | sans:MOTIF', 'retire un morceau', 'css:div.acheteur | sans:^Acheteur\\s*:'],
];

/** Une partie des règles (la liste, ou la page de détail) : un champ = des règles, une par ligne. */
function EditeurChamps({ champs, surChangement }) {
  const [nouveau, setNouveau] = useState('');
  const presents = Object.keys(champs);
  const proposes = CHAMPS.map(([k]) => k).filter((k) => !presents.includes(k));
  return (
    <div className="grid gap-2">
      {presents.map((c) => (
        <div key={c} className="grid gap-1 sm:grid-cols-[170px_1fr_32px] sm:items-start">
          <span className={cx('pt-2 text-[13px] font-semibold', c.startsWith('_') ? 'text-encre-3' : 'text-encre-2')}>{libelle(c)}</span>
          <textarea
            value={champs[c].join('\n')}
            onChange={(e) => surChangement({ ...champs, [c]: e.target.value.split('\n') })}
            onBlur={(e) => surChangement({ ...champs, [c]: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })}
            // Une règle longue se lit en entier : la zone grandit avec elle (8 lignes au plus).
            rows={Math.min(8, Math.max(1, champs[c].reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 60)), 0)))}
            spellCheck={false}
            aria-label={`Règles pour « ${libelle(c)} », une par ligne`}
            className="min-w-0 rounded-lg border border-trait bg-surface-2 px-2 py-1.5 font-mono text-[12.5px] leading-relaxed focus:border-cyan focus:outline-none"
          />
          <button
            type="button"
            onClick={() => surChangement(Object.fromEntries(Object.entries(champs).filter(([k]) => k !== c)))}
            aria-label={`Retirer « ${libelle(c)} »`}
            className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface-2 hover:text-alerte"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <select value={nouveau} onChange={(e) => setNouveau(e.target.value)} aria-label="Champ à ajouter" className="h-9 rounded-lg border border-trait bg-surface-2 px-2 text-[13px]">
          <option value="">Ajouter un champ…</option>
          {proposes.map((k) => (
            <option key={k} value={k}>
              {libelle(k)}
            </option>
          ))}
          <option value="_aide">Une aide (pour un modèle)…</option>
        </select>
        <Bouton
          variante="fantome"
          taille="petit"
          icone={Plus}
          disabled={!nouveau}
          onClick={() => {
            const nom = nouveau === '_aide' ? `_${(window.prompt('Nom de l’aide (lettres seulement) :') ?? '').replace(/[^a-zA-Z]/g, '')}` : nouveau;
            if (nom.length > 1) surChangement({ ...champs, [nom]: [''] });
            setNouveau('');
          }}
        >
          Ajouter
        </Bouton>
      </div>
    </div>
  );
}

/**
 * @param {{ source: object|null, connecteur: string, adresse: string, autoriserHttp: boolean, regles: object|null, surChangement: (regles: object|null) => void }} props
 *   `regles` null = les règles par défaut (pour le portail des marchés publics).
 */
export function ReglesLecture({ source, connecteur, adresse, autoriserHttp, regles, surChangement }) {
  const defauts = useQuery({ queryKey: ['regles-par-defaut'], queryFn: () => api('/api/sources-marches/regles-par-defaut') });
  const [aide, setAide] = useState(false);
  const [detail, setDetail] = useState(false);
  const modele = defauts.data?.[connecteur] ?? null;
  const actuelles = regles ?? (connecteur === 'pmmp' ? modele : null);

  const essai = useMutation({
    mutationFn: () => api('/api/sources-marches/essai', { methode: 'POST', corps: { sourceId: source?.id, connecteur, adresse: adresse || undefined, autoriserHttp, regles: regles ?? undefined } }),
  });

  if (!actuelles) {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-encre-2">Cette source n’a pas encore de règles de lecture.</p>
        <Bouton variante="secondaire" taille="petit" disabled={!modele} onClick={() => surChangement(structuredClone(modele))}>
          Partir d’un modèle de règles
        </Bouton>
      </div>
    );
  }
  const maj = (partie, cle, valeur) => surChangement({ ...actuelles, [partie]: { ...(actuelles[partie] ?? {}), [cle]: valeur } });
  const decoupage = actuelles.liste?.decoupage ?? {};
  const r = essai.data;

  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-encre-2">
        Pour chaque information, une ou plusieurs règles, <b>une par ligne</b>, essayées dans l’ordre : si la première ne trouve plus rien (le site a changé), la suivante prend le relais.
        {connecteur === 'pmmp' && !regles && ' Ce sont les règles par défaut du portail.'}
        <button type="button" onClick={() => setAide((x) => !x)} className="ml-1 font-medium text-cyan-texte hover:underline">
          {aide ? 'Masquer la syntaxe' : 'Voir la syntaxe'}
        </button>
      </p>
      {aide && (
        <table className="w-full text-[12.5px]">
          <tbody>
            {AIDE.map(([forme, sens, exemple]) => (
              <tr key={forme} className="border-b border-trait last:border-b-0">
                <td className="py-1 pr-3 font-mono whitespace-nowrap">{forme}</td>
                <td className="py-1 pr-3 text-encre-2">{sens}</td>
                <td className="py-1 font-mono text-encre-3">{exemple}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {actuelles.format === 'json' ? (
          <Champ libelle="Chemin du tableau des annonces" placeholder="data.annonces" value={decoupage.chemin ?? ''} onChange={(e) => maj('liste', 'decoupage', { chemin: e.target.value })} />
        ) : (
          <>
            <Champ libelle="Repère d’une annonce" aide="Un texte présent une fois par annonce." value={decoupage.repere ?? ''} onChange={(e) => maj('liste', 'decoupage', { ...decoupage, repere: e.target.value, css: undefined })} />
            <Champ libelle="… ou sélecteur d’une annonce" aide="Si le site entoure chaque annonce d’un élément." value={decoupage.css ?? ''} onChange={(e) => maj('liste', 'decoupage', { css: e.target.value || undefined, repere: e.target.value ? undefined : decoupage.repere, debut: decoupage.debut })} />
          </>
        )}
      </div>

      <EditeurChamps champs={actuelles.liste?.champs ?? {}} surChangement={(c) => maj('liste', 'champs', c)} />

      {actuelles.detail && (
        <div className="border-t border-trait pt-3">
          <button type="button" onClick={() => setDetail((x) => !x)} className="text-[13px] font-medium text-cyan-texte hover:underline">
            {detail ? 'Masquer' : 'Voir'} les règles de la page de détail d’une annonce
          </button>
          {detail && (
            <div className="mt-3">
              <EditeurChamps champs={actuelles.detail.champs ?? {}} surChangement={(c) => maj('detail', 'champs', c)} />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-trait pt-3">
        <Bouton variante="secondaire" taille="petit" icone={FlaskConical} chargement={essai.isPending} onClick={() => essai.mutate()}>
          Essayer ces règles sur la page
        </Bouton>
        {modele && (
          <Bouton variante="fantome" taille="petit" icone={RotateCcw} onClick={() => surChangement(connecteur === 'pmmp' ? null : structuredClone(modele))}>
            Rétablir les règles par défaut
          </Bouton>
        )}
      </div>

      {essai.isError && <Alerte ton="alerte">{essai.error.message}</Alerte>}
      {r && !r.ok && <Alerte ton="alerte">{r.message}</Alerte>}
      {r?.ok && (
        <div className="grid gap-2">
          <Alerte ton={r.probleme ? 'attente' : 'ok'}>
            {r.probleme ?? `Lecture correcte : ${r.qualite.offres} annonce(s) lue(s) sur ${r.qualite.blocs} trouvée(s).`}
            {Object.keys(r.qualite.secours ?? {}).length > 0 && ` Règles de secours utilisées pour : ${Object.keys(r.qualite.secours).map(libelle).join(', ')}.`}
          </Alerte>
          {r.qualite.blocs > 0 && (
            <p className="text-[12.5px] text-encre-3">
              Trouvés :{' '}
              {Object.entries(r.qualite.parChamp ?? {})
                .map(([c, n]) => `${libelle(c)} ${n}/${r.qualite.blocs}`)
                .join(' · ')}
            </p>
          )}
          {r.apercu.length > 0 && (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-encre-3">
                  <th className="py-1 pr-2">Objet</th>
                  <th className="py-1 pr-2">Acheteur</th>
                  <th className="py-1">Date limite</th>
                </tr>
              </thead>
              <tbody>
                {r.apercu.map((o, i) => (
                  <tr key={i} className="border-t border-trait align-top">
                    <td className="py-1 pr-2">{o.objet ?? <i className="text-alerte-texte">introuvable</i>}</td>
                    <td className="py-1 pr-2">{o.acheteur ?? '—'}</td>
                    <td className="py-1 whitespace-nowrap">{o.dateLimite ? dateCourte(o.dateLimite) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[12.5px] text-encre-3">Rien n’a été enregistré : enregistrez la source pour garder ces règles.</p>
        </div>
      )}
    </div>
  );
}
