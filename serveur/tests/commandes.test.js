/**
 * La fiche d'une commande fournisseur, à la Odoo : ses totaux, son bon de
 * commande en PDF, son envoi au fournisseur, et les pièces qui la font
 * avancer (bon de livraison, facture).
 *
 * Nodemailer est remplacé par un faux transport : on ne teste pas Gmail.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const envois = [];
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message) => {
        envois.push(message);
        return { messageId: `<bc-${envois.length}@icity.test>` };
      },
      verify: async () => true,
    }),
  },
}));

const { db } = await import('../src/db.js');
const { chiffrer } = await import('../src/securite/crypto.js');
const { connecter, creerUtilisateur, en, nouvelleApp, ORIGINE, viderBase } = await import('./outils.js');

let app;
let marche;
let fournisseur;
let commande;
let lignes;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await db.pieceJointeMail.deleteMany();
  await db.mail.deleteMany();
  await db.compteMail.deleteMany({ where: { adresse: 'achats@exemple.invalid' } });
  await app.close();
});

beforeEach(async () => {
  envois.length = 0;
  await db.pieceJointeMail.deleteMany();
  await db.mail.deleteMany();
  await db.compteMail.deleteMany({ where: { adresse: 'achats@exemple.invalid' } });
  await db.activite.deleteMany();
  await db.ligneAchat.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.commandeFournisseur.deleteMany();
  await db.fournisseur.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany({ where: { interne: true } });
  await viderBase();
  for (const [code, nom] of [
    ['BCF', 'Bon de commande fournisseur'],
    ['BLF', 'Bon de livraison fournisseur'],
    ['FACF', 'Facture fournisseur'],
  ]) {
    await db.typeDocument.upsert({ where: { code }, update: {}, create: { code, nom } });
  }
  await db.client.create({ data: { nom: 'Société Essai', interne: true, ville: 'Rabat', ice: '001234567000089' } });
  marche = await db.marche.create({ data: { reference: 'PROJET ESSAI', referenceNormalisee: 'PROJET ESSAI', objet: 'Supervision' } });
  fournisseur = await db.fournisseur.create({ data: { nom: 'INGRAM', email: 'ventes@ingram.example' } });
  commande = await db.commandeFournisseur.create({ data: { marcheId: marche.id, fournisseurId: fournisseur.id, modalite: 'virement', avancePourcent: 30 } });
  lignes = [];
  for (const [designation, quantite, puAchat] of [
    ['Serveur', 2, 1000],
    ['Écran', 4, 250],
  ]) {
    lignes.push(await db.ligneAchat.create({ data: { marcheId: marche.id, categorie: 'Matériel', designation, quantite, puAchat, fournisseurId: fournisseur.id, commandeId: commande.id, statut: 'commande_preparee' } }));
  }
});

const achats = async () => {
  const u = await creerUtilisateur('achats');
  const s = await connecter(app, u.email);
  return { u, s, requete: en(app, s) };
};

/** Verse une pièce sur la commande, comme le navigateur : les champs d'abord. */
function verserPiece(s, champs, contenu = `Pièce ${Date.now()}-${Math.random()}`) {
  const limite = '----icity-commande';
  const parties = Object.entries(champs).map(([nom, valeur]) => `--${limite}\r\nContent-Disposition: form-data; name="${nom}"\r\n\r\n${valeur}\r\n`);
  const corps = `${parties.join('')}--${limite}\r\nContent-Disposition: form-data; name="fichier"; filename="piece.txt"\r\nContent-Type: text/plain\r\n\r\n${contenu}\r\n--${limite}--\r\n`;
  return app.inject({
    method: 'POST',
    url: `/api/commandes-fournisseur/${commande.id}/pieces`,
    payload: corps,
    headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, origin: ORIGINE, 'content-type': `multipart/form-data; boundary=${limite}` },
  });
}

describe('fiche d’une commande', () => {
  it('donne ses lignes, ses totaux HT, TVA, TTC, son numéro et son étape', async () => {
    const { requete } = await achats();
    const fiche = (await requete('GET', `/api/commandes-fournisseur/${commande.id}`)).json();
    expect(fiche).toMatchObject({ etape: 'preparee', fournisseur: { nom: 'INGRAM' }, totaux: { ht: 3000, tva: 600, ttc: 3600 } });
    expect(fiche.numero).toMatch(/^BC-\d{4}-\d{4}$/);
    expect(fiche.lignes).toHaveLength(2);
    expect(fiche.internes.map((s) => s.nom)).toEqual(['Société Essai']);
  });

  it('reste aux achats et à la direction', async () => {
    const chef = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    expect((await chef('GET', `/api/commandes-fournisseur/${commande.id}`)).statusCode).toBe(403);
    expect((await chef('GET', `/api/fil/commande/${commande.id}`)).statusCode).toBe(403);
  });
});

describe('bon de commande', () => {
  it('se range une seule fois comme pièce confidentielle de la commande', async () => {
    const { requete } = await achats();
    const r1 = await requete('POST', `/api/commandes-fournisseur/${commande.id}/bon-de-commande`, {});
    expect(r1.statusCode).toBe(201);
    const r2 = await requete('POST', `/api/commandes-fournisseur/${commande.id}/bon-de-commande`, {});
    expect(r2.json().document.id).toBe(r1.json().document.id);

    const doc = await db.document.findUnique({ where: { id: r1.json().document.id }, include: { typeDocument: true } });
    expect(doc).toMatchObject({ commandeFournisseurId: commande.id, marcheId: marche.id, confidentialite: 'confidentiel' });
    expect(doc.typeDocument.code).toBe('BCF');
    expect(doc.texteOcr).toMatch(/BON DE COMMANDE/);
    // Préparer le bon ne fait pas partir la commande : l'envoyer, si.
    expect((await db.commandeFournisseur.findUnique({ where: { id: commande.id } })).dateCommande).toBeNull();
  });

  it('s’envoie au fournisseur avec le PDF, et la commande part', async () => {
    await db.compteMail.create({ data: { libelle: 'Achats', adresse: 'achats@exemple.invalid', serveur: 'imap.exemple.invalid', motDePasse: chiffrer('essai') } });
    const { requete } = await achats();
    const r = await requete('POST', `/api/commandes-fournisseur/${commande.id}/envoyer`, {
      a: ['ventes@ingram.example'],
      objet: 'Bon de commande',
      texte: 'Bonjour, veuillez trouver notre bon de commande.',
    });
    expect(r.statusCode).toBe(200);
    expect(envois).toHaveLength(1);
    expect(envois[0].attachments?.[0]?.filename).toMatch(/^BC-\d{4}-\d{4}\.pdf$/);
    expect(r.json().envoyees).toBe(2);

    const apres = (await requete('GET', `/api/commandes-fournisseur/${commande.id}`)).json();
    expect(apres.etape).toBe('commandee');
    const { elements } = (await requete('GET', `/api/fil/commande/${commande.id}`)).json();
    expect(elements.map((e) => e.texte)).toContain('a envoyé le bon de commande au fournisseur');
  });

  it('sans compte d’envoi, le dit clairement', async () => {
    // D'autres tests laissent des comptes dans la base de test : on les éteint.
    await db.compteMail.updateMany({ data: { actif: false } });
    const { requete } = await achats();
    const r = await requete('POST', `/api/commandes-fournisseur/${commande.id}/envoyer`, { a: ['ventes@ingram.example'], objet: 'BC', texte: 'Bonjour' });
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toMatch(/compte d’envoi/);
  });
});

describe('pièces du fournisseur', () => {
  it('un bon de livraison partiel ne livre que ses lignes ; la facture fait « facturée »', async () => {
    const { s, requete } = await achats();
    const bl = await verserPiece(s, { type: 'BLF', date: '2026-10-01', lignes: String(lignes[0].id) });
    expect(bl.statusCode).toBe(201);
    expect(bl.json().livrees).toBe(1);
    const statuts = (await db.ligneAchat.findMany({ where: { commandeId: commande.id }, orderBy: { id: 'asc' } })).map((l) => l.statut);
    expect(statuts).toEqual(['livre', 'commande_preparee']);

    await db.commandeFournisseur.update({ where: { id: commande.id }, data: { dateFacture: new Date('2026-10-02') } });
    expect((await requete('GET', `/api/commandes-fournisseur/${commande.id}`)).json().etape).toBe('facturee');
  });

  it('refuse un type de pièce inconnu', async () => {
    const { s } = await achats();
    expect((await verserPiece(s, { type: 'XXX', date: '2026-10-01' })).statusCode).toBe(422);
  });
});

describe('dupliquer une commande', () => {
  it('reprend le fournisseur, le marché et les conditions, sans lignes ni dates', async () => {
    await db.commandeFournisseur.update({ where: { id: commande.id }, data: { dateCommande: new Date('2026-09-01'), montantTtc: 3600, notes: 'Livraison au siège' } });
    const { requete } = await achats();
    const r = await requete('POST', `/api/commandes-fournisseur/${commande.id}/dupliquer`, {});
    expect(r.statusCode).toBe(201);
    const copie = await db.commandeFournisseur.findUnique({ where: { id: r.json().id }, include: { lignes: true } });
    expect(copie).toMatchObject({ marcheId: marche.id, fournisseurId: fournisseur.id, modalite: 'virement', notes: 'Livraison au siège', dateCommande: null, montantTtc: null });
    expect(Number(copie.avancePourcent)).toBe(30);
    expect(copie.lignes).toHaveLength(0);
  });
});
