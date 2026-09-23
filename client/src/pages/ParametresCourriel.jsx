/**
 * Paramètres → Comptes mail (§10).
 *
 * Le mot de passe d'application n'est jamais réaffiché : on peut le remplacer,
 * pas le relire. Le bouton « Tester la connexion » vérifie les identifiants et
 * l'existence du libellé surveillé avant la première relève.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PlugZap, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { dateHeure, depuis } from '../format.js';
import { useFormulaire } from '../formulaire.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, ChampMotDePasse, Selection } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { useToasts } from '../ui/Toasts.jsx';

const CLE = ['comptes-mail'];

export function ParametresCourriel() {
  const client = useQueryClient();
  const { notifier } = useToasts();
  const [essai, setEssai] = useState(null);
  const comptes = useQuery({ queryKey: CLE, queryFn: () => api('/api/comptes-mail') });
  const compte = comptes.data?.[0] ?? null;

  const f = useFormulaire({
    libelle: 'Boîte documentaire iCity',
    adresse: '',
    serveur: 'imap.gmail.com',
    port: '993',
    securite: 'ssl',
    motDePasse: '',
    dossierSurveille: 'iCity-Documents',
    libelleTraitement: 'iCity-Verse',
    adressesScanner: '',
    ageMaxJours: '30',
  });

  // Une fois le compte créé, le formulaire montre ses valeurs.
  const valeurs = compte
    ? {
        ...f.valeurs,
        libelle: f.valeurs.libelle === 'Boîte documentaire iCity' ? compte.libelle : f.valeurs.libelle,
        adresse: f.valeurs.adresse || compte.adresse,
        serveur: f.valeurs.serveur || compte.serveur,
        dossierSurveille: f.valeurs.dossierSurveille || compte.dossierSurveille,
        adressesScanner: f.valeurs.adressesScanner || (compte.adressesScanner ?? []).join(', '),
      }
    : f.valeurs;

  const enregistrer = useMutation({
    mutationFn: () => {
      const corps = {
        libelle: valeurs.libelle.trim(),
        adresse: valeurs.adresse.trim(),
        serveur: valeurs.serveur.trim(),
        port: Number(valeurs.port),
        securite: valeurs.securite,
        dossierSurveille: valeurs.dossierSurveille.trim(),
        libelleTraitement: valeurs.libelleTraitement.trim(),
        adressesScanner: valeurs.adressesScanner
          .split(/[,;\s]+/)
          .map((a) => a.trim().toLowerCase())
          .filter(Boolean),
        ageMaxJours: Number(valeurs.ageMaxJours),
        ...(valeurs.motDePasse ? { motDePasse: valeurs.motDePasse } : {}),
      };
      return compte ? api(`/api/comptes-mail/${compte.id}`, { methode: 'PATCH', corps }) : api('/api/comptes-mail', { methode: 'POST', corps });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: CLE });
      f.setValeurs((v) => ({ ...v, motDePasse: '' }));
      notifier({ titre: 'Compte enregistré', ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Enregistrement refusé', message: e.message, ton: 'alerte' }),
  });

  const tester = useMutation({
    mutationFn: () => api(`/api/comptes-mail/${compte.id}/tester`, { methode: 'POST' }),
    onSuccess: setEssai,
    onError: (e) => setEssai({ ok: false, message: e.message }),
  });

  const relever = useMutation({
    mutationFn: () => api(`/api/comptes-mail/${compte.id}/relever`, { methode: 'POST' }),
    onSuccess: (r) => {
      client.invalidateQueries({ queryKey: CLE });
      client.invalidateQueries({ queryKey: ['mails'] });
      notifier({ titre: 'Relève terminée', message: r.message, ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Relève impossible', message: e.message, ton: 'alerte' }),
  });

  if (comptes.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      <Carte className="p-6">
        <h2 className="mb-1 text-lg font-semibold">{compte ? 'Boîte surveillée' : 'Ajouter la boîte surveillée'}</h2>
        <p className="mb-5 text-sm text-encre-2">
          L’application ne lit qu’un seul libellé de votre boîte : rien d’autre n’est consulté.
        </p>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            enregistrer.mutate();
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Champ libelle="Nom de la boîte" className="sm:col-span-2" {...f.champ('libelle')} value={valeurs.libelle} />
          <Champ libelle="Adresse e-mail" type="email" autoComplete="off" {...f.champ('adresse')} value={valeurs.adresse} />
          <ChampMotDePasse
            libelle={compte ? 'Nouveau mot de passe d’application' : 'Mot de passe d’application'}
            autoComplete="new-password"
            aide={compte ? 'Laissez vide pour conserver celui enregistré.' : 'Compte Google → Sécurité → Mots de passe d’application.'}
            {...f.champ('motDePasse')}
          />
          <Champ libelle="Serveur IMAP" {...f.champ('serveur')} value={valeurs.serveur} />
          <Champ libelle="Port" type="number" {...f.champ('port')} />
          <Champ libelle="Libellé surveillé" aide="Gmail expose ses libellés à la racine IMAP." {...f.champ('dossierSurveille')} value={valeurs.dossierSurveille} />
          <Champ libelle="Libellé posé après traitement" aide="Sans accent : un libellé accentué passe mal en IMAP." {...f.champ('libelleTraitement')} />
          <Champ
            libelle="Adresses du scanner"
            className="sm:col-span-2"
            aide="Le copieur et votre téléphone, séparés par des virgules. Leurs envois deviennent des documents scannés, pas des échanges."
            {...f.champ('adressesScanner')}
            value={valeurs.adressesScanner}
          />
          <Champ libelle="Ancienneté maximale (jours)" type="number" aide="Au premier passage, on ne remonte pas toute la boîte." {...f.champ('ageMaxJours')} />
          <Selection libelle="Sécurité" {...f.champ('securite')}>
            <option value="ssl">SSL (993)</option>
            <option value="starttls">STARTTLS</option>
            <option value="aucune">Aucune</option>
          </Selection>

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Bouton type="submit" chargement={enregistrer.isPending} libelleChargement="Enregistrement…">
              {compte ? 'Enregistrer' : 'Ajouter la boîte'}
            </Bouton>
            {compte && (
              <>
                <Bouton variante="secondaire" icone={PlugZap} chargement={tester.isPending} libelleChargement="Connexion…" onClick={() => tester.mutate()}>
                  Tester la connexion
                </Bouton>
                <Bouton variante="secondaire" icone={RefreshCw} chargement={relever.isPending} libelleChargement="Relève…" onClick={() => relever.mutate()}>
                  Relever maintenant
                </Bouton>
              </>
            )}
          </div>
        </form>

        {essai && (
          <Alerte ton={essai.ok ? (essai.dossierTrouve ? 'ok' : 'attente') : 'alerte'} className="mt-5" titre={essai.ok ? 'Connexion établie' : 'Connexion refusée'}>
            {essai.message}
            {essai.dossiers && !essai.dossierTrouve && <span className="mt-1 block text-[12px]">Libellés trouvés : {essai.dossiers.slice(0, 12).join(', ')}…</span>}
          </Alerte>
        )}
      </Carte>

      <div className="grid content-start gap-5">
        <Carte className="p-5">
          <h2 className="mb-3 font-semibold">État</h2>
          {compte ? (
            <dl className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-encre-3">Compte</dt>
                <dd className="truncate font-medium">{compte.adresse}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-encre-3">Dernière relève</dt>
                <dd className="font-medium">{compte.derniereReleve ? depuis(compte.derniereReleve) : 'jamais'}</dd>
              </div>
              {compte.derniereReleveDetail && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-encre-3">Dernier passage</dt>
                  <dd className="font-medium">
                    {compte.derniereReleveDetail.erreur ? (
                      <Badge ton="alerte">
                        <XCircle className="size-3" aria-hidden /> en échec
                      </Badge>
                    ) : (
                      <Badge ton="ok">
                        <CheckCircle2 className="size-3" aria-hidden /> {compte.derniereReleveDetail.mailsLus} message(s)
                      </Badge>
                    )}
                  </dd>
                </div>
              )}
              {compte.derniereReleveDetail?.erreur && <Alerte ton="alerte">{compte.derniereReleveDetail.erreur}</Alerte>}
              {compte.derniereReleveDetail?.debut && (
                <p className="text-[12px] text-encre-3">Commencée le {dateHeure(compte.derniereReleveDetail.debut)}</p>
              )}
            </dl>
          ) : (
            <EtatVide titre="Aucune boîte" className="py-4">
              Ajoutez le compte pour commencer à relever.
            </EtatVide>
          )}
        </Carte>

        <Alerte ton="info" titre="Préparer Gmail">
          <ol className="mt-1 grid list-decimal gap-1 pl-4 text-[13px]">
            <li>Activez la validation en deux étapes sur votre compte Google.</li>
            <li>Créez un <strong>mot de passe d’application</strong> et collez-le ci-contre.</li>
            <li>Créez le libellé <strong>iCity-Documents</strong> dans Gmail.</li>
            <li>
              Ajoutez un <strong>filtre Gmail</strong> : « De : adresse du copieur » → « Appliquer le libellé iCity-Documents ». Vos scans arriveront alors tout seuls.
            </li>
          </ol>
        </Alerte>
      </div>
    </div>
  );
}
