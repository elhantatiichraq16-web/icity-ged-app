import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generate } from 'otplib';
import { db } from '../src/db.js';
import { boiteDeTest } from '../src/services/courriel.js';
import { dechiffrer } from '../src/securite/crypto.js';
import { connecter, cookieDe, creerUtilisateur, en, MOT_DE_PASSE, nouvelleApp, ORIGINE, viderBase } from './outils.js';

let app;
beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(viderBase);

const post = (url, payload, headers = {}) => app.inject({ method: 'POST', url, payload, headers: { origin: ORIGINE, ...headers } });

/** Le jeton contenu dans le dernier lien envoyé par e-mail. */
function jetonDuDernierMail() {
  const texte = boiteDeTest.at(-1).texte;
  return texte.match(/\/(?:reinitialiser|invitation)\/([\w-]+)/)[1];
}

describe('connexion', () => {
  it('connecte avec le bon mot de passe et pose un cookie HttpOnly', async () => {
    const u = await creerUtilisateur('chef_projet');
    const { reponse } = await connecter(app, u.email);
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().utilisateur).toMatchObject({ email: u.email, role: 'chef_projet' });
    const c = reponse.cookies.find((x) => x.name === 'icity_session');
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    // Le journal garde la trace de la connexion.
    expect(await db.journal.count({ where: { utilisateurId: u.id, action: 'connexion' } })).toBe(1);
  });

  it('refuse un mauvais mot de passe avec un message qui ne dit pas si le compte existe', async () => {
    const u = await creerUtilisateur();
    const mauvais = await connecter(app, u.email, 'Mauvais2026xx');
    const inconnu = await connecter(app, 'personne@exemple.ma', 'Mauvais2026xx');
    expect(mauvais.reponse.statusCode).toBe(401);
    expect(inconnu.reponse.statusCode).toBe(401);
    expect(mauvais.reponse.json().message).toBe(inconnu.reponse.json().message);
  });

  it('bloque après 5 tentatives (limite de tentatives)', async () => {
    const u = await creerUtilisateur();
    for (let i = 0; i < 5; i++) await connecter(app, u.email, 'Mauvais2026xx');
    const sixieme = await connecter(app, u.email); // même le bon mot de passe
    expect(sixieme.reponse.statusCode).toBe(429);
    expect(sixieme.reponse.json().message).toMatch(/Trop de tentatives/);
  });

  it('refuse un compte désactivé', async () => {
    const u = await creerUtilisateur('lecteur', { actif: false });
    const { reponse } = await connecter(app, u.email);
    expect(reponse.statusCode).toBe(401);
  });

  it("refuse un compte dont l'invitation n'est pas acceptée (pas de mot de passe)", async () => {
    const u = await creerUtilisateur('lecteur', { motDePasse: null });
    const { reponse } = await connecter(app, u.email, 'nimporte');
    expect(reponse.statusCode).toBe(401);
  });

  it('régénère la session : un nouveau jeton à chaque connexion, l’ancien ne sert plus', async () => {
    const u = await creerUtilisateur();
    const premiere = await connecter(app, u.email);
    const seconde = await app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      payload: { email: u.email, motDePasse: MOT_DE_PASSE },
      headers: { origin: ORIGINE, cookie: premiere.cookie, 'x-csrf-token': premiere.csrf },
    });
    expect(cookieDe(seconde)).not.toBe(premiere.cookie);
    const moi = await app.inject({ url: '/api/auth/moi', headers: { cookie: premiere.cookie } });
    expect(moi.json().utilisateur).toBeNull();
  });

  it('« Se souvenir de moi » donne un cookie persistant, sinon un cookie de session', async () => {
    const u = await creerUtilisateur();
    const court = await post('/api/auth/connexion', { email: u.email, motDePasse: MOT_DE_PASSE });
    const long = await post('/api/auth/connexion', { email: u.email, motDePasse: MOT_DE_PASSE, seSouvenir: true });
    expect(court.cookies.find((c) => c.name === 'icity_session').expires).toBeUndefined();
    expect(long.cookies.find((c) => c.name === 'icity_session').expires).toBeInstanceOf(Date);
  });

  it('une session expirée ne connecte plus personne', async () => {
    const u = await creerUtilisateur();
    const s = await connecter(app, u.email);
    await db.session.updateMany({ where: { utilisateurId: u.id }, data: { expireLe: new Date(Date.now() - 1000) } });
    const moi = await app.inject({ url: '/api/auth/moi', headers: { cookie: s.cookie } });
    expect(moi.json().utilisateur).toBeNull();
  });

  it('la déconnexion supprime la session', async () => {
    const u = await creerUtilisateur();
    const s = await connecter(app, u.email);
    const r = await en(app, s)('POST', '/api/auth/deconnexion');
    expect(r.statusCode).toBe(200);
    expect(await db.session.count({ where: { utilisateurId: u.id } })).toBe(0);
  });
});

describe('protection CSRF', () => {
  it('refuse une écriture sans jeton CSRF quand une session existe', async () => {
    const u = await creerUtilisateur();
    const s = await connecter(app, u.email);
    const r = await app.inject({ method: 'POST', url: '/api/activites', payload: {}, headers: { cookie: s.cookie, origin: ORIGINE } });
    expect(r.statusCode).toBe(419);
  });

  it('laisse se reconnecter malgré un vieux cookie de session sans jeton', async () => {
    const u = await creerUtilisateur();
    const ancienne = await connecter(app, u.email);
    const r = await post('/api/auth/connexion', { email: u.email, motDePasse: MOT_DE_PASSE }, { cookie: ancienne.cookie });
    expect(r.statusCode).toBe(200);
    expect(cookieDe(r)).not.toBe(ancienne.cookie);
  });

  it('refuse une écriture venue d’un autre site', async () => {
    const r = await post('/api/auth/connexion', { email: 'a@b.ma', motDePasse: 'x' }, { origin: 'https://site-malveillant.example' });
    expect(r.statusCode).toBe(403);
  });
});

describe('mot de passe oublié', () => {
  it('envoie un lien, qui permet de choisir un nouveau mot de passe une seule fois', async () => {
    const u = await creerUtilisateur();
    const autreSession = await connecter(app, u.email);

    const demande = await post('/api/auth/mot-de-passe-oublie', { email: u.email });
    expect(demande.statusCode).toBe(200);
    expect(boiteDeTest).toHaveLength(1);
    expect(boiteDeTest[0].a).toBe(u.email);

    const jeton = jetonDuDernierMail();
    expect((await app.inject({ url: `/api/auth/jeton/reinitialisation/${jeton}` })).statusCode).toBe(200);

    const nouveau = 'Rabat2026nouveau';
    const r = await post('/api/auth/reinitialisation', { jeton, motDePasse: nouveau, confirmation: nouveau });
    expect(r.statusCode).toBe(200);

    // Le nouveau mot de passe fonctionne, l'ancien non.
    expect((await connecter(app, u.email, nouveau)).reponse.statusCode).toBe(200);
    expect((await connecter(app, u.email)).reponse.statusCode).toBe(401);
    // Les sessions ouvertes avec l'ancien mot de passe sont fermées.
    const moi = await app.inject({ url: '/api/auth/moi', headers: { cookie: autreSession.cookie } });
    expect(moi.json().utilisateur).toBeNull();
    // Le lien ne resservira pas.
    const encore = await post('/api/auth/reinitialisation', { jeton, motDePasse: 'Autre2026abcd', confirmation: 'Autre2026abcd' });
    expect(encore.statusCode).toBe(410);
  });

  it('répond pareil pour une adresse inconnue, sans envoyer de mail', async () => {
    const r = await post('/api/auth/mot-de-passe-oublie', { email: 'inconnu@exemple.ma' });
    expect(r.statusCode).toBe(200);
    expect(r.json().message).toMatch(/Si un compte existe/);
    expect(boiteDeTest).toHaveLength(0);
  });

  it('refuse un lien expiré', async () => {
    const u = await creerUtilisateur();
    await post('/api/auth/mot-de-passe-oublie', { email: u.email });
    const jeton = jetonDuDernierMail();
    await db.jeton.updateMany({ data: { expireLe: new Date(Date.now() - 1000) } });
    const r = await post('/api/auth/reinitialisation', { jeton, motDePasse: 'Rabat2026nouveau', confirmation: 'Rabat2026nouveau' });
    expect(r.statusCode).toBe(410);
  });
});

describe('double authentification', () => {
  async function activer2FA(u) {
    const s = await connecter(app, u.email);
    const requete = en(app, s);
    const prep = await requete('POST', '/api/profil/deux-facteurs');
    expect(prep.statusCode).toBe(200);
    expect(prep.json().qrCode).toMatch(/^data:image\/png;base64,/);
    const secret = prep.json().secret;
    const conf = await requete('POST', '/api/profil/deux-facteurs/confirmer', { code: await generate({ secret }) });
    expect(conf.statusCode).toBe(200);
    expect(conf.json().codesSecours).toHaveLength(8);
    return { secret, codesSecours: conf.json().codesSecours };
  }

  it('stocke le secret chiffré, jamais en clair', async () => {
    const u = await creerUtilisateur();
    const { secret } = await activer2FA(u);
    const enBase = await db.utilisateur.findUnique({ where: { id: u.id } });
    expect(enBase.deuxFacteursSecret).not.toContain(secret);
    expect(dechiffrer(enBase.deuxFacteursSecret)).toBe(secret);
  });

  it('exige le code après le mot de passe, et refuse un mauvais code', async () => {
    const u = await creerUtilisateur();
    const { secret } = await activer2FA(u);
    // Le code de confirmation vient d'être consommé : on avance d'un pas de temps.
    await db.utilisateur.update({ where: { id: u.id }, data: { deuxFacteursDernierPas: null } });

    const etape1 = await connecter(app, u.email);
    expect(etape1.reponse.json()).toMatchObject({ deuxFacteursEnAttente: true, utilisateur: null });

    // Tant que le code n'est pas donné, rien n'est ouvert.
    const profil = await app.inject({ url: '/api/profil', headers: { cookie: etape1.cookie } });
    expect(profil.statusCode).toBe(401);

    const faux = await en(app, etape1)('POST', '/api/auth/deux-facteurs', { code: '000000' });
    expect(faux.statusCode).toBe(401);

    const bon = await en(app, etape1)('POST', '/api/auth/deux-facteurs', { code: await generate({ secret }) });
    expect(bon.statusCode).toBe(200);
    expect(bon.json().utilisateur.email).toBe(u.email);
  });

  it('accepte un code de secours, une seule fois', async () => {
    const u = await creerUtilisateur();
    const { codesSecours } = await activer2FA(u);

    const s1 = await connecter(app, u.email);
    expect((await en(app, s1)('POST', '/api/auth/deux-facteurs', { code: codesSecours[0] })).statusCode).toBe(200);

    const s2 = await connecter(app, u.email);
    expect((await en(app, s2)('POST', '/api/auth/deux-facteurs', { code: codesSecours[0] })).statusCode).toBe(401);
  });
});
