/**
 * Le rappel du matin, comme le résumé d'Odoo : les activités en retard et du
 * jour, par mail, une seule fois par jour et par personne.
 *
 * Nodemailer est remplacé par un faux transport.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const envois = [];
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message) => {
        envois.push(message);
        return { messageId: `<rappel-${envois.length}@icity.test>` };
      },
      verify: async () => true,
    }),
  },
}));

const { db } = await import('../src/db.js');
const { chiffrer } = await import('../src/securite/crypto.js');
const { envoyerRappelsDuJour } = await import('../src/services/rappels.js');
const { connecter, creerUtilisateur, en, nouvelleApp, viderBase } = await import('./outils.js');

let app;
const le = (iso) => new Date(`${iso}T00:00:00Z`);
// Un lundi, 9 h à Casablanca.
const MAINTENANT = new Date('2026-11-09T08:00:00Z');

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await db.compteMail.deleteMany({ where: { adresse: 'rappels@exemple.invalid' } });
  await app.close();
});

beforeEach(async () => {
  envois.length = 0;
  await db.activite.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await viderBase();
  // Les autres tests laissent des comptes : seul celui-ci envoie.
  await db.compteMail.updateMany({ data: { actif: false } });
  await db.compteMail.upsert({
    where: { adresse: 'rappels@exemple.invalid' },
    update: { actif: true },
    create: { libelle: 'iCity', adresse: 'rappels@exemple.invalid', serveur: 'imap.exemple.invalid', motDePasse: chiffrer('essai') },
  });
});

describe('rappel du matin', () => {
  it('liste les activités en retard et du jour, sans celles à venir, une seule fois par jour', async () => {
    const moi = await creerUtilisateur('chef_projet', { nom: 'Karim Alami' });
    const marche = await db.marche.create({ data: { reference: '31/2016', referenceNormalisee: '31/2016' } });
    await db.activite.create({ data: { type: 'appel', resume: 'Relancer le client', echeance: le('2026-11-05'), assigneId: moi.id, marcheId: marche.id } });
    await db.activite.create({ data: { resume: 'Préparer le PV', echeance: le('2026-11-09'), assigneId: moi.id, marcheId: marche.id } });
    await db.activite.create({ data: { resume: 'Plus tard', echeance: le('2026-11-20'), assigneId: moi.id, marcheId: marche.id } });

    expect(await envoyerRappelsDuJour({ maintenant: MAINTENANT })).toEqual({ envoyes: 1 });
    expect(envois).toHaveLength(1);
    expect(envois[0]).toMatchObject({ to: moi.email, subject: 'Vos activités du jour : 2 (dont 1 en retard)' });
    expect(envois[0].text).toContain('Bonjour Karim');
    expect(envois[0].text).toContain('Appel : Relancer le client (31/2016) — prévue le 5 novembre');
    expect(envois[0].text).toContain('À faire : Préparer le PV (31/2016)');
    expect(envois[0].text).not.toContain('Plus tard');

    // Relancé le même jour : rien ne repart.
    expect(await envoyerRappelsDuJour({ maintenant: MAINTENANT })).toEqual({ envoyes: 0 });
    // Ces mails internes ne s'archivent pas dans le courriel des affaires.
    expect(await db.mail.count({ where: { objet: { startsWith: 'Vos activités' } } })).toBe(0);
  });

  it('rien pour qui n’a rien à faire, ni pour qui l’a désactivé dans son profil', async () => {
    const libre = await creerUtilisateur('chef_projet');
    const occupe = await creerUtilisateur('chef_projet');
    const marche = await db.marche.create({ data: { reference: '31/2016', referenceNormalisee: '31/2016' } });
    await db.activite.create({ data: { resume: 'Appeler', echeance: le('2026-11-09'), assigneId: occupe.id, marcheId: marche.id } });

    const requete = en(app, await connecter(app, occupe.email));
    const r = await requete('PATCH', '/api/profil/rappels', { rappelQuotidien: false });
    expect(r.json().utilisateur.rappelQuotidien).toBe(false);

    expect(await envoyerRappelsDuJour({ maintenant: MAINTENANT })).toEqual({ envoyes: 0 });
    expect(envois).toHaveLength(0);
    expect(libre.id).toBeTruthy();
  });
});
