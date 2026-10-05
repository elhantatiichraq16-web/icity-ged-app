/**
 * Les pages d'authentification : connexion, double authentification, mot de
 * passe oublié, choix du mot de passe (réinitialisation ou invitation).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { schemaCodeDeuxFacteurs, schemaConnexion, schemaMotDePasseOublie, schemaNouveauMotDePasse } from '@icity/commun/schemas';
import { api } from '../../api.js';
import { useSession } from '../../auth/session.jsx';
import { useFormulaire } from '../../formulaire.js';
import { Bouton } from '../../ui/Bouton.jsx';
import { CaseACocher, Champ, ChampMotDePasse } from '../../ui/Champ.jsx';
import { Alerte, Squelette } from '../../ui/Elements.jsx';
import { EcranAuth } from './EcranAuth.jsx';

// Seul l'e-mail est retenu par « Se souvenir de moi » côté navigateur ; le
// mot de passe jamais (il serait lisible par tout script de la page).
const MEMOIRE_EMAIL = 'icity.email';

function lireEmailRetenu() {
  try {
    return localStorage.getItem(MEMOIRE_EMAIL) || '';
  } catch {
    return '';
  }
}

const lienDiscret = 'text-[13.5px] font-medium text-cyan-texte hover:underline';

// ─────────────────────────────────────────────────────────────────
export function PageConnexion() {
  const session = useSession();
  const naviguer = useNavigate();
  const lieu = useLocation();
  const retenu = lireEmailRetenu();
  const f = useFormulaire({ email: retenu, motDePasse: '', seSouvenir: Boolean(retenu) });
  const refMdp = useRef(null);

  // L'e-mail est déjà rempli : il ne reste que le mot de passe à saisir.
  useEffect(() => {
    if (retenu) refMdp.current?.focus();
  }, [retenu]);

  const destination = lieu.state?.depuis ?? '/';
  const message = lieu.state?.message;

  const envoyer = f.soumettre(schemaConnexion, async (donnees) => {
    let reponse;
    try {
      reponse = await api('/api/auth/connexion', { methode: 'POST', corps: donnees });
    } catch (erreur) {
      // On vide le mot de passe refusé, et on garde l'e-mail.
      if (erreur.statut === 401) f.setValeurs((v) => ({ ...v, motDePasse: '' }));
      refMdp.current?.focus();
      throw erreur;
    }
    try {
      if (donnees.seSouvenir) localStorage.setItem(MEMOIRE_EMAIL, donnees.email);
      else localStorage.removeItem(MEMOIRE_EMAIL);
    } catch {
      /* confort seulement */
    }
    session.definir(reponse);
    naviguer(reponse.deuxFacteursEnAttente ? '/deux-facteurs' : destination, { replace: true, state: { depuis: destination } });
  });

  return (
    <EcranAuth titre="Connexion" sousTitre="Accédez au suivi des marchés et au fonds documentaire.">
      {message && <Alerte ton="ok" className="mb-5">{message}</Alerte>}
      {f.erreurGenerale && <Alerte ton="alerte" className="mb-5">{f.erreurGenerale}</Alerte>}
      <form onSubmit={envoyer} noValidate className="grid gap-[18px]">
        <Champ libelle="Adresse e-mail" type="email" autoComplete="username" autoFocus={!retenu} spellCheck={false} placeholder="prenom.nom@icity.ma" {...f.champ('email')} />
        <ChampMotDePasse ref={refMdp} autoComplete="current-password" placeholder="••••••••••" {...f.champ('motDePasse')} />
        <div className="-mt-0.5 flex flex-wrap items-center justify-between gap-3">
          <CaseACocher libelle="Se souvenir de moi" {...f.champ('seSouvenir', { type: 'checkbox' })} />
          <Link to="/mot-de-passe-oublie" className={lienDiscret}>
            Mot de passe oublié ?
          </Link>
        </div>
        <Bouton type="submit" taille="grand" className="mt-1.5 w-full justify-center" chargement={f.envoi} libelleChargement="Vérification…">
          Se connecter
        </Bouton>
      </form>
      <p className="mt-6 text-[13px] text-encre-3">Pas de compte ? Les accès sont créés par l'administrateur, sur invitation.</p>
    </EcranAuth>
  );
}

// ─────────────────────────────────────────────────────────────────
export function PageDeuxFacteurs() {
  const session = useSession();
  const naviguer = useNavigate();
  const lieu = useLocation();
  const [secours, setSecours] = useState(false);
  const f = useFormulaire({ code: '' });

  const envoyer = f.soumettre(schemaCodeDeuxFacteurs, async (donnees) => {
    try {
      const reponse = await api('/api/auth/deux-facteurs', { methode: 'POST', corps: donnees });
      session.definir(reponse);
      naviguer(lieu.state?.depuis ?? '/', { replace: true });
    } catch (erreur) {
      f.setValeurs({ code: '' });
      throw erreur;
    }
  });

  // Arrivé ici sans avoir donné son mot de passe : retour à la connexion.
  if (!session.chargement && !session.deuxFacteursEnAttente) {
    return <Navigate to={session.utilisateur ? '/' : '/connexion'} replace />;
  }

  return (
    <EcranAuth
      titre="Vérification en deux étapes"
      sousTitre={secours ? 'Saisissez l’un de vos codes de secours (forme xxxxx-xxxxx).' : 'Ouvrez votre application d’authentification et saisissez le code à 6 chiffres.'}
    >
      {f.erreurGenerale && <Alerte ton="alerte" className="mb-5">{f.erreurGenerale}</Alerte>}
      <form onSubmit={envoyer} noValidate className="grid gap-[18px]">
        <Champ
          key={secours ? 'secours' : 'totp'}
          libelle={secours ? 'Code de secours' : 'Code à 6 chiffres'}
          autoComplete="one-time-code"
          inputMode={secours ? 'text' : 'numeric'}
          autoFocus
          maxLength={secours ? 11 : 6}
          placeholder={secours ? 'a1b2c-3d4e5' : '123456'}
          className="[&_input]:chiffres [&_input]:text-center [&_input]:text-lg [&_input]:tracking-[0.3em]"
          {...f.champ('code')}
        />
        <Bouton type="submit" taille="grand" className="w-full justify-center" chargement={f.envoi} libelleChargement="Vérification…">
          Valider
        </Bouton>
      </form>
      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <button type="button" className={lienDiscret} onClick={() => setSecours((s) => !s)}>
          {secours ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'}
        </button>
        <button
          type="button"
          className="text-[13.5px] text-encre-3 hover:text-encre"
          onClick={async () => {
            await session.deconnecter();
            naviguer('/connexion', { replace: true });
          }}
        >
          Annuler
        </button>
      </div>
    </EcranAuth>
  );
}

// ─────────────────────────────────────────────────────────────────
export function PageMotDePasseOublie() {
  const [envoye, setEnvoye] = useState('');
  const f = useFormulaire({ email: lireEmailRetenu() });

  const envoyer = f.soumettre(schemaMotDePasseOublie, async (donnees) => {
    const r = await api('/api/auth/mot-de-passe-oublie', { methode: 'POST', corps: donnees });
    setEnvoye(r.message);
  });

  return (
    <EcranAuth titre="Mot de passe oublié" sousTitre="Nous vous envoyons un lien pour choisir un nouveau mot de passe.">
      {envoye ? (
        <div className="grid gap-5">
          <div className="flex gap-4 rounded-xl bg-cyan-voile p-4">
            <MailCheck className="size-6 shrink-0 text-cyan-texte" aria-hidden />
            <div role="status">
              <p className="font-semibold">Vérifiez votre boîte mail</p>
              <p className="mt-1 text-sm text-encre-2">{envoye} Le lien est valable 60 minutes.</p>
            </div>
          </div>
          <Link to="/connexion" className={`${lienDiscret} inline-flex items-center gap-1.5`}>
            <ArrowLeft className="size-4" aria-hidden /> Retour à la connexion
          </Link>
        </div>
      ) : (
        <>
          {f.erreurGenerale && <Alerte ton="alerte" className="mb-5">{f.erreurGenerale}</Alerte>}
          <form onSubmit={envoyer} noValidate className="grid gap-[18px]">
            <Champ libelle="Adresse e-mail" type="email" autoComplete="username" autoFocus {...f.champ('email')} />
            <Bouton type="submit" taille="grand" className="w-full justify-center" chargement={f.envoi} libelleChargement="Envoi…">
              Envoyer le lien
            </Bouton>
          </form>
          <Link to="/connexion" className={`${lienDiscret} mt-5 inline-flex items-center gap-1.5`}>
            <ArrowLeft className="size-4" aria-hidden /> Retour à la connexion
          </Link>
        </>
      )}
    </EcranAuth>
  );
}

// ─────────────────────────────────────────────────────────────────
/**
 * Choisir son mot de passe, depuis le lien d'un e-mail.
 * @param {{ type: 'invitation' | 'reinitialisation' }} props
 */
export function PageChoisirMotDePasse({ type }) {
  const { jeton } = useParams();
  const naviguer = useNavigate();
  const invitation = type === 'invitation';
  const f = useFormulaire({ jeton, motDePasse: '', confirmation: '' });

  // On vérifie le lien avant de faire taper un mot de passe pour rien.
  const lien = useQuery({
    queryKey: ['jeton', type, jeton],
    queryFn: () => api(`/api/auth/jeton/${type}/${encodeURIComponent(jeton)}`),
    retry: false,
  });

  const envoyer = f.soumettre(schemaNouveauMotDePasse, async (donnees) => {
    const r = await api(`/api/auth/${type}`, { methode: 'POST', corps: donnees });
    naviguer('/connexion', { replace: true, state: { message: r.message } });
  });

  const titre = invitation ? 'Activer votre compte' : 'Nouveau mot de passe';

  if (lien.isPending) {
    return (
      <EcranAuth titre={titre}>
        <div className="grid gap-4" role="status" aria-label="Vérification du lien…">
          <Squelette className="h-11" />
          <Squelette className="h-11" />
          <Squelette className="h-12" />
        </div>
      </EcranAuth>
    );
  }

  if (lien.isError) {
    return (
      <EcranAuth titre={titre}>
        <Alerte ton="attente" titre="Lien expiré ou déjà utilisé">
          {invitation ? 'Demandez à l’administrateur de vous renvoyer une invitation.' : 'Vous pouvez demander un nouveau lien.'}
        </Alerte>
        <Link to={invitation ? '/connexion' : '/mot-de-passe-oublie'} className={`${lienDiscret} mt-5 inline-flex items-center gap-1.5`}>
          <ArrowLeft className="size-4" aria-hidden /> {invitation ? 'Aller à la connexion' : 'Demander un nouveau lien'}
        </Link>
      </EcranAuth>
    );
  }

  return (
    <EcranAuth
      titre={titre}
      sousTitre={invitation ? `Bienvenue, ${lien.data.nom}. Choisissez le mot de passe de ${lien.data.email}.` : `Pour le compte ${lien.data.email}.`}
    >
      {f.erreurGenerale && <Alerte ton="alerte" className="mb-5">{f.erreurGenerale}</Alerte>}
      <form onSubmit={envoyer} noValidate className="grid gap-[18px]">
        {/* Champ caché pour que le gestionnaire de mots de passe associe le bon compte. */}
        <input type="email" name="username" autoComplete="username" value={lien.data.email} readOnly hidden />
        <ChampMotDePasse libelle="Nouveau mot de passe" autoComplete="new-password" autoFocus aide="Au moins 10 caractères, avec une lettre et un chiffre." {...f.champ('motDePasse')} />
        <ChampMotDePasse libelle="Confirmation" autoComplete="new-password" {...f.champ('confirmation')} />
        <Bouton type="submit" taille="grand" className="w-full justify-center" chargement={f.envoi} libelleChargement="Enregistrement…">
          {invitation ? 'Activer mon compte' : 'Enregistrer'}
        </Bouton>
      </form>
    </EcranAuth>
  );
}
