/**
 * La veille des marchés, côté paramètres :
 *  - `ParametresSources` : les sources d'offres (ajouter, modifier, activer,
 *    tester, synchroniser, importer un CSV, supprimer) ;
 *  - `ParametresCriteres` : les critères iCity qui calculent le score.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Pencil, Plus, PlugZap, RefreshCw, Trash2, X } from 'lucide-react';
import { CONNECTEURS } from '@icity/commun/marches-potentiels';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateHeure, depuis } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { CaseACocher, Champ, Selection, ZoneTexte } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, SqueletteLignes } from '../ui/Elements.jsx';
import { Confirmation, Modale } from '../ui/Modale.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';

const CLE_SOURCES = ['sources-marches'];
const nomConnecteur = (code) => CONNECTEURS.find((c) => c.code === code)?.nom ?? code;
const TONS_ETAT = { ok: 'ok', partielle: 'attente', erreur: 'alerte' };

// ════════════════════════════ Les sources ════════════════════════════

export function ParametresSources() {
  const sources = useQuery({ queryKey: CLE_SOURCES, queryFn: () => api('/api/sources-marches') });
  const [edition, setEdition] = useState(null); // null | 'nouvelle' | une source
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-[14px] text-encre-2">
          Les sites où iCity repère les appels d’offres. Une source n’est synchronisée que si elle est <b>active</b> ; n’activez une collecte automatique qu’avec l’accord de l’éditeur du site. Sinon,
          importez ses offres par fichier CSV ou par l’adresse de chaque annonce.
        </p>
        <Bouton icone={Plus} onClick={() => setEdition('nouvelle')}>
          Ajouter une source
        </Bouton>
      </div>
      {sources.isPending ? (
        <Carte className="p-5">
          <SqueletteLignes lignes={4} />
        </Carte>
      ) : sources.isError ? (
        <Alerte ton="alerte">{sources.error.message}</Alerte>
      ) : (
        sources.data.map((s) => <CarteSource key={s.id} s={s} modifier={() => setEdition(s)} />)
      )}
      {edition && <ModaleSource source={edition === 'nouvelle' ? null : edition} surFermer={() => setEdition(null)} />}
    </div>
  );
}

function CarteSource({ s, modifier }) {
  const file = useQueryClient();
  const { notifier } = useToasts();
  const [supprimer, setSupprimer] = useState(false);
  const [historique, setHistorique] = useState(false);
  const fichier = useRef(null);
  const relire = () => {
    file.invalidateQueries({ queryKey: CLE_SOURCES });
    file.invalidateQueries({ queryKey: ['offres'] });
  };
  const useAction = (nom, chemin, message) =>
    useMutation({
      mutationKey: [nom, s.id],
      mutationFn: (corps) => api(chemin, { methode: corps?.methode ?? 'POST', corps: corps?.corps, fichier: corps?.fichier }),
      onSuccess: (r) => {
        relire();
        message?.(r);
      },
      onError: (e) => notifier({ titre: 'Impossible', message: e.message, ton: 'alerte' }),
    });
  const tester = useAction('tester', `/api/sources-marches/${s.id}/tester`, (r) =>
    notifier(r.ok ? { titre: 'Connexion réussie', message: `Réponse ${r.statut} en ${r.dureeMs} ms${r.annoncesLisibles !== null ? ` · ${r.annoncesLisibles} annonce(s) lisible(s)` : ''}.`, ton: 'ok' } : { titre: 'Connexion impossible', message: r.message, ton: 'alerte' }),
  );
  const synchroniser = useAction('synchroniser', `/api/sources-marches/${s.id}/synchroniser`, (r) =>
    notifier(r.etat === 'erreur' ? { titre: 'Synchronisation en erreur', message: r.erreur, ton: 'alerte' } : { titre: 'Synchronisée', message: r.resume, ton: 'ok' }),
  );
  const importer = useAction('importer', `/api/sources-marches/${s.id}/import-csv`, (r) =>
    notifier({ titre: 'Import terminé', message: `${r.nouvelles} nouvelle(s), ${r.misesAJour} mise(s) à jour${r.erreurs.length ? `, ${r.erreurs.length} ligne(s) refusée(s)` : ''}.`, ton: r.erreurs.length ? 'attente' : 'ok' }),
  );
  const basculer = useAction('basculer', `/api/sources-marches/${s.id}`, (r) => notifier({ titre: r.active ? 'Source activée' : 'Source désactivée', message: r.nom, ton: 'ok' }));
  const effacer = useAction('supprimer', `/api/sources-marches/${s.id}`, (r) => notifier({ titre: 'Source supprimée', message: `${r.offresSupprimees} offre(s) retirée(s).`, ton: 'ok' }));

  const corpsSource = (changes) => ({ nom: s.nom, siteWeb: s.siteWeb, connecteur: s.connecteur, adresse: s.adresse ?? '', frequenceMinutes: s.frequenceMinutes, pagesMax: s.pagesMax, delaiRequetesMs: s.delaiRequetesMs, active: s.active, autoriserHttp: s.autoriserHttp, parametres: s.parametres, ...changes });

  return (
    <Carte className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{s.nom}</h3>
            <Badge ton={s.active ? 'ok' : 'neutre'}>{s.active ? 'Active' : 'Désactivée'}</Badge>
            {s.derniereSyncEtat && <Badge ton={TONS_ETAT[s.derniereSyncEtat] ?? 'neutre'}>{s.derniereSyncEtat === 'ok' ? 'Dernière synchro réussie' : s.derniereSyncEtat === 'partielle' ? 'Partielle' : 'En erreur'}</Badge>}
          </div>
          <p className="mt-1 text-[13px] text-encre-3">
            {nomConnecteur(s.connecteur)} · {s.nbOffres} offre(s)
            {s.connecteurAutomatique && ` · toutes les ${s.frequenceMinutes} min · ${s.pagesMax} page(s) · ${Math.round(s.delaiRequetesMs / 1000)} s entre deux requêtes`}
            {s.aDesSecrets && ' · identifiants enregistrés (chiffrés)'}
          </p>
          <p className="truncate text-[13px] text-encre-3" title={s.adresse ?? s.siteWeb}>
            {s.adresse ?? s.siteWeb}
          </p>
          <p className={cx('mt-1 text-[13px]', s.derniereSyncEtat === 'erreur' ? 'text-alerte-texte' : 'text-encre-2')}>
            {s.derniereSyncLe ? `${depuis(s.derniereSyncLe)} : ` : ''}
            {s.derniereErreur ?? s.derniereSyncResume ?? 'Jamais synchronisée.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Bouton variante="secondaire" taille="petit" icone={Pencil} onClick={modifier}>
            Modifier
          </Bouton>
          <Bouton variante="secondaire" taille="petit" chargement={basculer.isPending} onClick={() => basculer.mutate({ methode: 'PATCH', corps: corpsSource({ active: !s.active }) })}>
            {s.active ? 'Désactiver' : 'Activer'}
          </Bouton>
          {s.connecteurAutomatique && (
            <>
              <Bouton variante="secondaire" taille="petit" icone={PlugZap} chargement={tester.isPending} onClick={() => tester.mutate()}>
                Tester
              </Bouton>
              <Bouton variante="secondaire" taille="petit" icone={RefreshCw} chargement={synchroniser.isPending} disabled={!s.active} onClick={() => synchroniser.mutate()}>
                Synchroniser
              </Bouton>
            </>
          )}
          <Bouton variante="secondaire" taille="petit" icone={FileUp} chargement={importer.isPending} onClick={() => fichier.current?.click()}>
            Importer un CSV
          </Bouton>
          <input
            ref={fichier}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const donnees = new FormData();
              donnees.append('fichier', f);
              importer.mutate({ fichier: donnees });
              e.target.value = '';
            }}
          />
          <Bouton variante="secondaire" taille="petit" icone={Trash2} className="text-alerte-texte!" onClick={() => setSupprimer(true)}>
            Supprimer
          </Bouton>
        </div>
      </div>
      {s.historique.length > 0 && (
        <div className="mt-3 border-t border-trait pt-2">
          <button type="button" onClick={() => setHistorique((x) => !x)} className="text-[13px] font-medium text-cyan-texte hover:underline">
            {historique ? 'Masquer' : 'Voir'} les dernières synchronisations
          </button>
          {historique && (
            <table className="mt-2 w-full text-[13px]">
              <tbody>
                {s.historique.map((h) => (
                  <tr key={h.id} className="border-b border-trait last:border-b-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-encre-3">{dateHeure(h.debut)}</td>
                    <td className="pr-3">{h.declenchement === 'auto' ? 'Automatique' : h.declenchement === 'import' ? 'Import' : 'Manuelle'}</td>
                    <td className="pr-3">
                      <Badge ton={TONS_ETAT[h.etat] ?? 'neutre'}>{h.etat}</Badge>
                    </td>
                    <td className="text-encre-2">{h.erreur ?? `${h.recues} reçue(s), ${h.nouvelles} nouvelle(s), ${h.misesAJour} mise(s) à jour`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <Confirmation
        ouverte={supprimer}
        surChangement={setSupprimer}
        titre={`Supprimer « ${s.nom} » ?`}
        description={`Ses ${s.nbOffres} offre(s) seront retirées, avec leurs favoris et leurs activités. Une source dont une offre a été convertie en marché ne peut pas être supprimée : désactivez-la.`}
        libelle="Supprimer la source"
        chargement={effacer.isPending}
        surConfirmer={() => effacer.mutate({ methode: 'DELETE' }, { onSettled: () => setSupprimer(false) })}
      />
    </Carte>
  );
}

function ModaleSource({ source, surFermer }) {
  const [v, setV] = useState(() => ({
    nom: source?.nom ?? '',
    siteWeb: source?.siteWeb ?? 'https://',
    connecteur: source?.connecteur ?? 'rss',
    adresse: source?.adresse ?? '',
    frequenceMinutes: String(source?.frequenceMinutes ?? 60),
    pagesMax: String(source?.pagesMax ?? 1),
    delaiRequetesMs: String(source?.delaiRequetesMs ?? 3000),
    active: source?.active ?? false,
    autoriserHttp: source?.autoriserHttp ?? false,
    secrets: '',
    effacerSecrets: false,
  }));
  const [erreurs, setErreurs] = useState({});
  const file = useQueryClient();
  const { notifier } = useToasts();
  const champ = (cle) => ({ value: v[cle], erreur: erreurs[cle], onChange: (e) => setV((x) => ({ ...x, [cle]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })) });
  const enregistrer = useMutation({
    mutationFn: () =>
      api(source ? `/api/sources-marches/${source.id}` : '/api/sources-marches', {
        methode: source ? 'PATCH' : 'POST',
        corps: { ...v, frequenceMinutes: Number(v.frequenceMinutes), pagesMax: Number(v.pagesMax), delaiRequetesMs: Number(v.delaiRequetesMs), parametres: source?.parametres ?? null },
      }),
    onSuccess: () => {
      file.invalidateQueries({ queryKey: CLE_SOURCES });
      notifier({ titre: source ? 'Source enregistrée' : 'Source ajoutée', message: v.nom, ton: 'ok' });
      surFermer();
    },
    onError: (e) => setErreurs(Object.keys(e.erreurs ?? {}).length ? e.erreurs : { nom: e.message }),
  });
  const automatique = CONNECTEURS.find((c) => c.code === v.connecteur)?.automatique;
  return (
    <Modale
      ouverte
      surChangement={(x) => !x && surFermer()}
      largeur="max-w-2xl"
      titre={source ? `Modifier « ${source.nom} »` : 'Ajouter une source'}
      pied={
        <>
          <Bouton variante="fantome" onClick={surFermer}>
            Annuler
          </Bouton>
          <Bouton chargement={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
            Enregistrer
          </Bouton>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ libelle="Nom" {...champ('nom')} />
        <Selection libelle="Type de connecteur" {...champ('connecteur')}>
          {CONNECTEURS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.nom}
            </option>
          ))}
        </Selection>
        <Champ libelle="Site web" className="sm:col-span-2" {...champ('siteWeb')} />
        <Champ libelle="Adresse de l’API, du flux ou de la page de recherche" facultatif className="sm:col-span-2" {...champ('adresse')} />
        {automatique && (
          <>
            <Champ libelle="Fréquence (minutes)" type="number" min={30} {...champ('frequenceMinutes')} />
            <Champ libelle="Pages au plus par passage" type="number" min={1} max={10} {...champ('pagesMax')} />
            <Champ libelle="Délai entre deux requêtes (ms)" type="number" min={1000} step={500} {...champ('delaiRequetesMs')} />
          </>
        )}
        {!automatique && <Alerte ton="info" className="sm:col-span-2">Ce type de source n’a pas de collecte automatique : ses offres s’importent par fichier CSV ou par adresse.</Alerte>}
        <ZoneTexte
          libelle="En-têtes ou identifiants (JSON)"
          facultatif
          className="sm:col-span-2"
          lignes={2}
          placeholder={source?.aDesSecrets ? 'Déjà enregistrés (chiffrés) : laissez vide pour les garder' : '{"Authorization": "Bearer …"}'}
          aide="Chiffrés en base, jamais réaffichés ni écrits au journal."
          {...champ('secrets')}
        />
        {source?.aDesSecrets && <CaseACocher libelle="Effacer les identifiants enregistrés" checked={v.effacerSecrets} onChange={champ('effacerSecrets').onChange} />}
        <CaseACocher libelle="Source active (synchronisée automatiquement)" checked={v.active} onChange={champ('active').onChange} />
        <CaseACocher libelle="Autoriser HTTP non chiffré (déconseillé)" checked={v.autoriserHttp} onChange={champ('autoriserHttp').onChange} />
        {v.active && v.connecteur === 'pmmp' && (
          <Alerte ton="attente" className="sm:col-span-2">
            Les conditions d’utilisation du portail ne disent rien de la collecte automatique. Activez cette source seulement après l’accord écrit de l’éditeur du portail.
          </Alerte>
        )}
      </div>
    </Modale>
  );
}

// ════════════════════════════ Les critères ════════════════════════════

/** Une liste de termes, un par ligne. */
const lignes = (t) =>
  t
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

export function ParametresCriteres() {
  const { droits } = useSession();
  const criteres = useQuery({ queryKey: ['criteres-marches'], queryFn: () => api('/api/criteres-marches') });
  if (criteres.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={6} />
      </Carte>
    );
  }
  if (criteres.isError) return <Alerte ton="alerte">{criteres.error.message}</Alerte>;
  return <FormulaireCriteres initiaux={criteres.data} modifiable={droits.can('gerer', 'CriteresMarches')} />;
}

function EditeurPonderes({ titre, aide, valeur, surChangement, modifiable }) {
  return (
    <Carte className="p-5">
      <h3 className="font-semibold">{titre}</h3>
      <p className="mb-3 text-[13px] text-encre-3">{aide}</p>
      <ul className="grid gap-2">
        {valeur.map((m, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              value={m.terme}
              disabled={!modifiable}
              onChange={(e) => surChangement(valeur.map((x, j) => (j === i ? { ...x, terme: e.target.value } : x)))}
              aria-label="Terme"
              className="h-9 min-w-0 flex-1 rounded-lg border border-trait bg-surface-2 px-3 text-[14px] focus:border-cyan focus:outline-none"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={m.poids}
              disabled={!modifiable}
              onChange={(e) => surChangement(valeur.map((x, j) => (j === i ? { ...x, poids: e.target.value } : x)))}
              aria-label={`Points pour « ${m.terme} »`}
              className="chiffres h-9 w-20 rounded-lg border border-trait bg-surface-2 px-2 text-right text-[14px] focus:border-cyan focus:outline-none"
            />
            {modifiable && (
              <button type="button" onClick={() => surChangement(valeur.filter((_, j) => j !== i))} aria-label={`Retirer « ${m.terme} »`} className="grid size-8 place-items-center rounded-lg text-encre-3 hover:bg-surface-2 hover:text-alerte">
                <X className="size-4" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {modifiable && (
        <Bouton variante="fantome" taille="petit" icone={Plus} className="mt-2" onClick={() => surChangement([...valeur, { terme: '', poids: 10 }])}>
          Ajouter
        </Bouton>
      )}
    </Carte>
  );
}

function FormulaireCriteres({ initiaux, modifiable }) {
  const [c, setC] = useState(() => ({
    ...initiaux,
    motsExclusTexte: initiaux.motsExclus.join('\n'),
    lieuxTexte: initiaux.lieux.termes.join('\n'),
    acheteursTexte: initiaux.acheteursFavoris.termes.join('\n'),
    typesTexte: initiaux.typesPrestations.termes.join('\n'),
  }));
  const [erreur, setErreur] = useState('');
  const file = useQueryClient();
  const { notifier } = useToasts();
  const maj = (cle) => (e) => setC((x) => ({ ...x, [cle]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const nombreOuNul = (v) => (v === '' || v === null ? null : Number(v));

  const enregistrer = useMutation({
    mutationFn: () =>
      api('/api/criteres-marches', {
        methode: 'PUT',
        corps: {
          motsCles: c.motsCles.filter((m) => m.terme.trim().length >= 2).map((m) => ({ terme: m.terme.trim(), poids: Number(m.poids) })),
          plafondMotsCles: Number(c.plafondMotsCles),
          motsExclus: lignes(c.motsExclusTexte),
          domaines: c.domaines.filter((m) => m.terme.trim().length >= 2).map((m) => ({ terme: m.terme.trim(), poids: Number(m.poids) })),
          lieux: { termes: lignes(c.lieuxTexte), poids: Number(c.lieux.poids) },
          acheteursFavoris: { termes: lignes(c.acheteursTexte), poids: Number(c.acheteursFavoris.poids) },
          typesPrestations: { termes: lignes(c.typesTexte), poids: Number(c.typesPrestations.poids) },
          montantMin: nombreOuNul(c.montantMin),
          montantMax: nombreOuNul(c.montantMax),
          poidsMontant: Number(c.poidsMontant),
          delaiMinJours: Number(c.delaiMinJours),
          poidsDelai: Number(c.poidsDelai),
          seuil: Number(c.seuil),
          exclureExpirees: c.exclureExpirees,
        },
      }),
    onSuccess: (r) => {
      setErreur('');
      file.invalidateQueries({ queryKey: ['offres'] });
      file.invalidateQueries({ queryKey: ['criteres-marches'] });
      notifier({ titre: 'Critères enregistrés', message: `${r.recalculees} offre(s) ouverte(s) recalculée(s).`, ton: 'ok' });
    },
    onError: (e) => setErreur(e.message),
  });
  const sousListe = (cle, texte) => ({ ...c[cle], poids: texte });

  return (
    <div className="grid gap-4">
      <p className="max-w-3xl text-[14px] text-encre-2">
        Le score d’une offre (0 à 100) additionne les points des critères qu’elle remplit. Un mot exclu ou une échéance passée le met à 0. Chaque point est expliqué sur la fiche de l’offre. Aucune intelligence artificielle
        n’intervient : seulement ces règles.
      </p>
      {!modifiable && <Alerte ton="info">Vous pouvez consulter ces critères ; seuls la direction et les commerciaux AO les modifient.</Alerte>}
      <div className="grid gap-4 xl:grid-cols-2">
        <EditeurPonderes titre="Mots-clés positifs" aide="Cherchés dans l’objet et le résumé, sans accents ni pluriel." valeur={c.motsCles} surChangement={(m) => setC((x) => ({ ...x, motsCles: m }))} modifiable={modifiable} />
        <div className="grid content-start gap-4">
          <EditeurPonderes titre="Domaines d’activité" aide="Cherchés dans la catégorie et les domaines publiés : le meilleur compte." valeur={c.domaines} surChangement={(m) => setC((x) => ({ ...x, domaines: m }))} modifiable={modifiable} />
          <Carte className="grid gap-3 p-5">
            <h3 className="font-semibold">Mots exclus</h3>
            <ZoneTexte libelle="Un par ligne : l’offre tombe à 0" lignes={4} value={c.motsExclusTexte} onChange={maj('motsExclusTexte')} disabled={!modifiable} />
          </Carte>
        </div>
        <Carte className="grid gap-3 p-5 sm:grid-cols-[1fr_120px]">
          <h3 className="font-semibold sm:col-span-2">Lieux, acheteurs, prestations</h3>
          <ZoneTexte libelle="Villes et régions suivies (une par ligne)" lignes={3} value={c.lieuxTexte} onChange={maj('lieuxTexte')} disabled={!modifiable} />
          <Champ libelle="Points" type="number" min={0} max={100} value={c.lieux.poids} onChange={(e) => setC((x) => ({ ...x, lieux: sousListe('lieux', e.target.value) }))} disabled={!modifiable} />
          <ZoneTexte libelle="Acheteurs publics favoris" lignes={3} value={c.acheteursTexte} onChange={maj('acheteursTexte')} disabled={!modifiable} />
          <Champ libelle="Points" type="number" min={0} max={100} value={c.acheteursFavoris.poids} onChange={(e) => setC((x) => ({ ...x, acheteursFavoris: sousListe('acheteursFavoris', e.target.value) }))} disabled={!modifiable} />
          <ZoneTexte libelle="Types de prestations (catégorie)" lignes={2} value={c.typesTexte} onChange={maj('typesTexte')} disabled={!modifiable} />
          <Champ libelle="Points" type="number" min={0} max={100} value={c.typesPrestations.poids} onChange={(e) => setC((x) => ({ ...x, typesPrestations: sousListe('typesPrestations', e.target.value) }))} disabled={!modifiable} />
        </Carte>
        <Carte className="grid gap-3 p-5 sm:grid-cols-3">
          <h3 className="font-semibold sm:col-span-3">Montant, délai, seuil</h3>
          <Champ libelle="Montant minimum (DH)" facultatif type="number" min={0} value={c.montantMin ?? ''} onChange={maj('montantMin')} disabled={!modifiable} />
          <Champ libelle="Montant maximum (DH)" facultatif type="number" min={0} value={c.montantMax ?? ''} onChange={maj('montantMax')} disabled={!modifiable} />
          <Champ libelle="Points si dans la fourchette" type="number" min={0} max={100} value={c.poidsMontant} onChange={maj('poidsMontant')} disabled={!modifiable} />
          <Champ libelle="Délai minimal (jours)" type="number" min={0} value={c.delaiMinJours} onChange={maj('delaiMinJours')} disabled={!modifiable} />
          <Champ libelle="Points si le délai suffit" type="number" min={0} max={100} value={c.poidsDelai} onChange={maj('poidsDelai')} disabled={!modifiable} />
          <Champ libelle="Plafond des mots-clés" type="number" min={0} max={100} value={c.plafondMotsCles} onChange={maj('plafondMotsCles')} disabled={!modifiable} />
          <Champ libelle="Seuil de pertinence" aide="À partir de ce score, une nouvelle offre déclenche une alerte." type="number" min={0} max={100} value={c.seuil} onChange={maj('seuil')} disabled={!modifiable} />
          <div className="flex items-end sm:col-span-2">
            <CaseACocher libelle="Exclure les offres déjà expirées (score 0)" checked={c.exclureExpirees} onChange={maj('exclureExpirees')} disabled={!modifiable} />
          </div>
        </Carte>
      </div>
      {erreur && <Alerte ton="alerte">{erreur}</Alerte>}
      {modifiable && (
        <div>
          <Bouton chargement={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
            Enregistrer et recalculer les scores
          </Bouton>
        </div>
      )}
    </div>
  );
}
