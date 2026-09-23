import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { boiteDeTest } from '../src/services/courriel.js';
import { connecter, creerUtilisateur, en, nouvelleApp, ORIGINE, viderBase } from './outils.js';

let app;
beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(viderBase);

async function commeRole(role) {
  const u = await creerUtilisateur(role);
  return { u, requete: en(app, await connecter(app, u.email)) };
}

describe('invitation par l’administrateur', () => {
  it('crée le compte, envoie le lien, et le nouvel utilisateur choisit son mot de passe', async () => {
    const { requete } = await commeRole('administrateur');
    const r = await requete('POST', '/api/utilisateurs', { nom: 'Rim Elmers', email: 'Rim@Exemple.ma', role: 'chef_projet' });
    expect(r.statusCode).toBe(201);
    expect(r.json().utilisateur).toMatchObject({ email: 'rim@exemple.ma', invitationEnAttente: true });
    expect(boiteDeTest.at(-1).a).toBe('rim@exemple.ma');

    const jeton = boiteDeTest.at(-1).texte.match(/\/invitation\/([\w-]+)/)[1];
    const info = await app.inject({ url: `/api/auth/jeton/invitation/${jeton}` });
    expect(info.json()).toMatchObject({ nom: 'Rim Elmers' });

    const mdp = 'Kenitra2026abc';
    const accepte = await app.inject({
      method: 'POST',
      url: '/api/auth/invitation',
      headers: { origin: ORIGINE },
      payload: { jeton, motDePasse: mdp, confirmation: mdp },
    });
    expect(accepte.statusCode).toBe(200);
    expect((await connecter(app, 'rim@exemple.ma', mdp)).reponse.json().utilisateur.role).toBe('chef_projet');
  });

  it('refuse une adresse déjà utilisée', async () => {
    const { requete } = await commeRole('administrateur');
    const existant = await creerUtilisateur('lecteur');
    const r = await requete('POST', '/api/utilisateurs', { nom: 'Doublon', email: existant.email, role: 'lecteur' });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreurs.email).toBeDefined();
  });

  it.each(['directeur', 'responsable_documentaire', 'chef_projet', 'commercial_ao', 'achats', 'lecteur'])(
    'le rôle %s ne peut ni lister ni inviter',
    async (role) => {
      const { requete } = await commeRole(role);
      expect((await requete('GET', '/api/utilisateurs')).statusCode).toBe(403);
      expect((await requete('POST', '/api/utilisateurs', { nom: 'X Y', email: 'x@y.ma', role: 'administrateur' })).statusCode).toBe(403);
    },
  );

  it('sans connexion : 401', async () => {
    expect((await app.inject({ url: '/api/utilisateurs' })).statusCode).toBe(401);
  });
});

describe('modification des comptes', () => {
  it('désactiver un compte le déconnecte partout et le journalise', async () => {
    const { u: admin, requete } = await commeRole('administrateur');
    const cible = await creerUtilisateur('achats');
    const sessionCible = await connecter(app, cible.email);

    const r = await requete('PATCH', `/api/utilisateurs/${cible.id}`, { actif: false });
    expect(r.statusCode).toBe(200);
    const moi = await app.inject({ url: '/api/auth/moi', headers: { cookie: sessionCible.cookie } });
    expect(moi.json().utilisateur).toBeNull();

    const trace = await db.journal.findFirst({ where: { action: 'utilisateur.modifie', objetId: cible.id } });
    expect(trace).toMatchObject({ utilisateurId: admin.id, avant: { actif: true }, apres: { actif: false } });
  });

  it("l'administrateur ne peut pas se retirer ses propres droits", async () => {
    const { u, requete } = await commeRole('administrateur');
    expect((await requete('PATCH', `/api/utilisateurs/${u.id}`, { role: 'lecteur' })).statusCode).toBe(422);
    expect((await requete('PATCH', `/api/utilisateurs/${u.id}`, { actif: false })).statusCode).toBe(422);
  });
});

describe('profil', () => {
  it('modifie le nom', async () => {
    const { requete } = await commeRole('lecteur');
    const r = await requete('PATCH', '/api/profil', { nom: 'Ichrak Elhantati' });
    expect(r.json().utilisateur.nom).toBe('Ichrak Elhantati');
  });

  it('change le mot de passe seulement avec l’actuel, et ferme les autres sessions', async () => {
    const u = await creerUtilisateur('lecteur');
    const ici = await connecter(app, u.email);
    const ailleurs = await connecter(app, u.email);
    const requete = en(app, ici);

    const faux = await requete('POST', '/api/profil/mot-de-passe', { actuel: 'pas-le-bon', motDePasse: 'Agadir2026abc', confirmation: 'Agadir2026abc' });
    expect(faux.statusCode).toBe(422);

    const bon = await requete('POST', '/api/profil/mot-de-passe', { actuel: 'Casablanca2026', motDePasse: 'Agadir2026abc', confirmation: 'Agadir2026abc' });
    expect(bon.statusCode).toBe(200);

    expect((await app.inject({ url: '/api/auth/moi', headers: { cookie: ici.cookie } })).json().utilisateur).not.toBeNull();
    expect((await app.inject({ url: '/api/auth/moi', headers: { cookie: ailleurs.cookie } })).json().utilisateur).toBeNull();
  });

  it('liste les sessions actives et ferme les autres', async () => {
    const u = await creerUtilisateur('lecteur');
    await connecter(app, u.email);
    await connecter(app, u.email);
    const requete = en(app, await connecter(app, u.email));

    const profil = await requete('GET', '/api/profil');
    expect(profil.json().sessions).toHaveLength(3);
    expect(profil.json().sessions.filter((s) => s.courante)).toHaveLength(1);

    expect((await requete('DELETE', '/api/profil/sessions/autres')).json().fermees).toBe(2);
    expect((await requete('GET', '/api/profil')).json().sessions).toHaveLength(1);
  });

  it('refuse un avatar qui n’est pas une vraie image, même nommé .png', async () => {
    const u = await creerUtilisateur('lecteur');
    const s = await connecter(app, u.email);
    const limite = '----icity';
    const corps = `--${limite}\r\nContent-Disposition: form-data; name="avatar"; filename="piege.png"\r\nContent-Type: image/png\r\n\r\n<script>alert(1)</script>\r\n--${limite}--\r\n`;
    const r = await app.inject({
      method: 'POST',
      url: '/api/profil/avatar',
      payload: corps,
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, origin: ORIGINE, 'content-type': `multipart/form-data; boundary=${limite}` },
    });
    expect(r.statusCode).toBe(422);
  });
});

describe('en-têtes de sécurité', () => {
  it('pose CSP, X-Frame-Options, nosniff et Referrer-Policy', async () => {
    const r = await app.inject({ url: '/api/auth/moi' });
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
