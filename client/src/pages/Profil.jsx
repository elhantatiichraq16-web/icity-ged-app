/**
 * Mon profil : identité et avatar, mot de passe, double authentification,
 * sessions actives.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, LaptopMinimal, ShieldCheck, ShieldOff, Trash2, Upload } from 'lucide-react';
import { schemaChangerMotDePasse, schemaCodeDeuxFacteurs, schemaProfil } from '@icity/commun/schemas';
import { api } from '../api.js';
import { CLE_MOI, useSession } from '../auth/session.jsx';
import { appareil, depuis, dateHeure } from '../format.js';
import { useFormulaire } from '../formulaire.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, ChampMotDePasse } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage, SqueletteLignes } from '../ui/Elements.jsx';
import { Modale } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';

const CLE_PROFIL = ['profil'];

function Section({ titre, description, children, icone: Icone }) {
  return (
    <Carte className="p-6">
      <div className="mb-5 flex items-start gap-3">
        {Icone && (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-voile text-cyan-texte">
            <Icone className="size-[18px]" aria-hidden />
          </span>
        )}
        <div>
          <h2 className="text-lg font-semibold">{titre}</h2>
          {description && <p className="mt-0.5 text-sm text-encre-2">{description}</p>}
        </div>
      </div>
      {children}
    </Carte>
  );
}

export function PageProfil() {
  const profil = useQuery({ queryKey: CLE_PROFIL, queryFn: () => api('/api/profil') });

  return (
    <div className="animate-apparition">
      <EnTetePage titre="Mon profil" description="Vos informations, la sécurité de votre compte et vos appareils connectés." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Identite />
        <MotDePasse />
        <DeuxFacteurs />
        <Sessions profil={profil} />
      </div>
    </div>
  );
}

// ── Identité et avatar ───────────────────────────────────────────
function Identite() {
  const { utilisateur } = useSession();
  const client = useQueryClient();
  const { notifier } = useToasts();
  const fichier = useRef(null);
  const f = useFormulaire({ nom: utilisateur.nom });

  const majUtilisateur = (u) => client.setQueryData(CLE_MOI, (ancien) => ({ ...ancien, utilisateur: u }));

  const enregistrer = f.soumettre(schemaProfil, async (donnees) => {
    const r = await api('/api/profil', { methode: 'PATCH', corps: donnees });
    majUtilisateur(r.utilisateur);
    notifier({ titre: 'Profil enregistré', ton: 'ok' });
  });

  const avatar = useMutation({
    mutationFn: (image) => {
      const donnees = new FormData();
      donnees.append('avatar', image);
      return api('/api/profil/avatar', { methode: 'POST', fichier: donnees });
    },
    onSuccess: (r) => {
      majUtilisateur(r.utilisateur);
      notifier({ titre: 'Photo mise à jour', ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Photo refusée', message: e.message, ton: 'alerte' }),
  });

  const retirerAvatar = useMutation({
    mutationFn: () => api('/api/profil/avatar', { methode: 'DELETE' }),
    onSuccess: (r) => majUtilisateur(r.utilisateur),
  });

  return (
    <Section titre="Identité" description="Votre nom apparaît dans le journal et sur les pièces que vous versez.">
      <div className="mb-6 flex flex-wrap items-center gap-5">
        <Avatar utilisateur={utilisateur} taille="grand" />
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Bouton variante="secondaire" taille="petit" icone={Upload} chargement={avatar.isPending} onClick={() => fichier.current?.click()}>
              Changer la photo
            </Bouton>
            {utilisateur.avatar && (
              <Bouton variante="fantome" taille="petit" icone={Trash2} onClick={() => retirerAvatar.mutate()}>
                Retirer
              </Bouton>
            )}
          </div>
          <p className="text-[13px] text-encre-3">PNG, JPEG ou WEBP, 2 Mo au plus.</p>
          <input
            ref={fichier}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Choisir une photo"
            onChange={(e) => {
              const image = e.target.files?.[0];
              if (image) avatar.mutate(image);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <form onSubmit={enregistrer} noValidate className="grid gap-4">
        <Champ libelle="Nom complet" autoComplete="name" {...f.champ('nom')} />
        <Champ libelle="Adresse e-mail" value={utilisateur.email} disabled aide="Seul l’administrateur peut la modifier." onChange={() => {}} />
        <div className="flex items-center justify-between gap-3">
          <Badge ton="cyan">{utilisateur.roleNom}</Badge>
          <Bouton type="submit" chargement={f.envoi} libelleChargement="Enregistrement…">
            Enregistrer
          </Bouton>
        </div>
      </form>
    </Section>
  );
}

// ── Mot de passe ─────────────────────────────────────────────────
function MotDePasse() {
  const client = useQueryClient();
  const { notifier } = useToasts();
  const vide = { actuel: '', motDePasse: '', confirmation: '' };
  const f = useFormulaire(vide);

  const envoyer = f.soumettre(schemaChangerMotDePasse, async (donnees) => {
    const r = await api('/api/profil/mot-de-passe', { methode: 'POST', corps: donnees });
    f.setValeurs(vide);
    client.invalidateQueries({ queryKey: CLE_PROFIL });
    notifier({ titre: 'Mot de passe modifié', message: r.message, ton: 'ok' });
  });

  return (
    <Section titre="Mot de passe" icone={KeyRound} description="Changer de mot de passe déconnecte vos autres appareils.">
      {f.erreurGenerale && <Alerte ton="alerte" className="mb-4">{f.erreurGenerale}</Alerte>}
      <form onSubmit={envoyer} noValidate className="grid gap-4">
        <input type="text" name="username" autoComplete="username" hidden readOnly />
        <ChampMotDePasse libelle="Mot de passe actuel" autoComplete="current-password" {...f.champ('actuel')} />
        <ChampMotDePasse libelle="Nouveau mot de passe" autoComplete="new-password" aide="Au moins 10 caractères, avec une lettre et un chiffre." {...f.champ('motDePasse')} />
        <ChampMotDePasse libelle="Confirmation" autoComplete="new-password" {...f.champ('confirmation')} />
        <div className="flex justify-end">
          <Bouton type="submit" chargement={f.envoi} libelleChargement="Enregistrement…">
            Changer le mot de passe
          </Bouton>
        </div>
      </form>
    </Section>
  );
}

// ── Double authentification ──────────────────────────────────────
function DeuxFacteurs() {
  const { utilisateur } = useSession();
  const client = useQueryClient();
  const { notifier } = useToasts();
  const [activation, setActivation] = useState(null); // { secret, qrCode }
  const [codes, setCodes] = useState(null);
  const [desactiver, setDesactiver] = useState(false);
  const confirmation = useFormulaire({ code: '' });
  const motDePasse = useFormulaire({ motDePasse: '' });

  const relireMoi = () => client.invalidateQueries({ queryKey: CLE_MOI });

  const demarrer = useMutation({
    mutationFn: () => api('/api/profil/deux-facteurs', { methode: 'POST' }),
    onSuccess: setActivation,
    onError: (e) => notifier({ titre: 'Activation impossible', message: e.message, ton: 'alerte' }),
  });

  const confirmer = confirmation.soumettre(schemaCodeDeuxFacteurs, async (donnees) => {
    const r = await api('/api/profil/deux-facteurs/confirmer', { methode: 'POST', corps: donnees });
    setActivation(null);
    confirmation.setValeurs({ code: '' });
    setCodes(r.codesSecours);
    relireMoi();
  });

  const couper = motDePasse.soumettre(null, async (donnees) => {
    await api('/api/profil/deux-facteurs/desactiver', { methode: 'POST', corps: donnees });
    setDesactiver(false);
    motDePasse.setValeurs({ motDePasse: '' });
    relireMoi();
    notifier({ titre: 'Double authentification désactivée', ton: 'attente' });
  });

  return (
    <Section
      titre="Double authentification"
      icone={ShieldCheck}
      description="Un code à 6 chiffres, donné par une application comme Google Authenticator, en plus du mot de passe."
    >
      {utilisateur.deuxFacteurs ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge ton="ok">
            <ShieldCheck className="size-3.5" aria-hidden /> Activée
          </Badge>
          <Bouton variante="secondaire" icone={ShieldOff} onClick={() => setDesactiver(true)}>
            Désactiver
          </Bouton>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge ton="attente">Non activée</Badge>
          <Bouton icone={ShieldCheck} chargement={demarrer.isPending} onClick={() => demarrer.mutate()}>
            Activer
          </Bouton>
        </div>
      )}

      {/* Étape 1 : scanner le QR code, puis saisir le premier code */}
      <Modale
        ouverte={Boolean(activation)}
        surChangement={(o) => !o && setActivation(null)}
        titre="Activer la double authentification"
        description="Scannez ce code avec votre application, puis saisissez le code à 6 chiffres qu’elle affiche."
      >
        {activation && (
          <form onSubmit={confirmer} noValidate className="grid gap-5">
            <div className="grid place-items-center gap-3 rounded-xl bg-surface-2 p-5">
              <img src={activation.qrCode} alt="QR code à scanner avec l’application d’authentification" className="size-[200px] rounded-lg bg-white p-2" />
              <p className="text-center text-[13px] text-encre-3">
                Scan impossible ? Saisissez cette clé : <span className="chiffres break-all text-encre select-all">{activation.secret}</span>
              </p>
            </div>
            <Champ libelle="Code à 6 chiffres" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus className="[&_input]:chiffres [&_input]:tracking-[0.3em]" {...confirmation.champ('code')} />
            {confirmation.erreurGenerale && <Alerte ton="alerte">{confirmation.erreurGenerale}</Alerte>}
            <div className="flex justify-end gap-2">
              <Bouton variante="fantome" onClick={() => setActivation(null)}>
                Annuler
              </Bouton>
              <Bouton type="submit" chargement={confirmation.envoi} libelleChargement="Vérification…">
                Confirmer
              </Bouton>
            </div>
          </form>
        )}
      </Modale>

      {/* Étape 2 : les codes de secours, montrés une seule fois */}
      <Modale
        ouverte={Boolean(codes)}
        surChangement={(o) => !o && setCodes(null)}
        titre="Vos codes de secours"
        description="Chacun sert une fois, si vous n’avez plus votre téléphone. Ils ne seront plus affichés : notez-les en lieu sûr."
        pied={
          <>
            <Bouton
              variante="secondaire"
              icone={Copy}
              onClick={async () => {
                await navigator.clipboard?.writeText(codes.join('\n'));
                notifier({ titre: 'Codes copiés', ton: 'ok' });
              }}
            >
              Copier
            </Bouton>
            <Bouton onClick={() => setCodes(null)}>J’ai noté mes codes</Bouton>
          </>
        }
      >
        <ul className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-4">
          {codes?.map((c) => (
            <li key={c} className="chiffres text-center text-[15px] text-encre select-all">
              {c}
            </li>
          ))}
        </ul>
      </Modale>

      <Modale ouverte={desactiver} surChangement={setDesactiver} titre="Désactiver la double authentification" description="Confirmez avec votre mot de passe.">
        <form onSubmit={couper} noValidate className="grid gap-4">
          <input type="text" name="username" autoComplete="username" hidden readOnly />
          <ChampMotDePasse autoComplete="current-password" autoFocus {...motDePasse.champ('motDePasse')} />
          {motDePasse.erreurGenerale && <Alerte ton="alerte">{motDePasse.erreurGenerale}</Alerte>}
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setDesactiver(false)}>
              Annuler
            </Bouton>
            <Bouton type="submit" variante="danger" chargement={motDePasse.envoi}>
              Désactiver
            </Bouton>
          </div>
        </form>
      </Modale>
    </Section>
  );
}

// ── Sessions actives ─────────────────────────────────────────────
function Sessions({ profil }) {
  const client = useQueryClient();
  const { notifier } = useToasts();
  const relire = () => client.invalidateQueries({ queryKey: CLE_PROFIL });

  const fermerAutres = useMutation({
    mutationFn: () => api('/api/profil/sessions/autres', { methode: 'DELETE' }),
    onSuccess: (r) => {
      relire();
      notifier({ titre: r.fermees ? `${r.fermees} session(s) fermée(s)` : 'Aucune autre session', ton: 'ok' });
    },
  });
  const fermerUne = useMutation({
    mutationFn: (id) => api(`/api/profil/sessions/${id}`, { methode: 'DELETE' }),
    onSuccess: relire,
  });

  const sessions = profil.data?.sessions ?? [];

  return (
    <Section titre="Sessions actives" icone={LaptopMinimal} description="Les appareils connectés à votre compte. Fermez ceux que vous ne reconnaissez pas.">
      {profil.isPending ? (
        <SqueletteLignes lignes={2} />
      ) : (
        <>
          <ul className="grid gap-2">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-trait px-4 py-3">
                <LaptopMinimal className="size-5 shrink-0 text-encre-3" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {appareil(s.agent)}
                    {s.courante && <Badge ton="cyan">Cet appareil</Badge>}
                  </p>
                  <p className="text-[13px] text-encre-3" title={`Ouverte le ${dateHeure(s.creeLe)}`}>
                    {s.ip} · actif {depuis(s.derniereActivite)}
                  </p>
                </div>
                {!s.courante && (
                  <Bouton variante="fantome" taille="petit" onClick={() => fermerUne.mutate(s.id)} aria-label={`Fermer la session ${appareil(s.agent)}`}>
                    Fermer
                  </Bouton>
                )}
              </li>
            ))}
          </ul>
          {sessions.length > 1 && (
            <div className="mt-4 flex justify-end">
              <Bouton variante="secondaire" chargement={fermerAutres.isPending} onClick={() => fermerAutres.mutate()}>
                Déconnecter les autres appareils
              </Bouton>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
