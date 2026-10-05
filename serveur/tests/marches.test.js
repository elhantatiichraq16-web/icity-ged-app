import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { recalculerPhase, recalculerToutesLesPhases } from '../src/services/phase-marche.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;
let client;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany();
  await db.typeDocument.deleteMany();
  await viderBase();

  // Les six pièces du cycle suffisent à ces tests.
  for (const [code, nom, ordre] of [
    ['OS', 'Ordre de service', 1],
    ['BL', 'Bon de livraison', 2],
    ['PVP', 'PV de réception provisoire', 3],
    ['PVD', 'PV de réception définitive', 4],
    ['MLV', 'Mainlevée de caution', 6],
    ['CM', 'Contrat de marché', null],
  ]) {
    await db.typeDocument.create({ data: { code, nom, ordreCycle: ordre, pieceAttendue: ordre !== null } });
  }
  client = await db.client.create({ data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR' } });
});

async function creerMarche(reference, champs = {}) {
  return db.marche.create({
    data: { reference, referenceNormalisee: reference, clientId: client.id, ...champs },
  });
}

async function poser(marche, code, champs = {}) {
  const type = await db.typeDocument.findUniqueOrThrow({ where: { code } });
  return db.document.create({
    data: { titre: `${code} de ${marche.reference}`, marcheId: marche.id, clientId: client.id, typeDocumentId: type.id, ...champs },
  });
}

describe('phase calculée (§5)', () => {
  it('part de « en attente d’OS » et suit les pièces versées', async () => {
    const m = await creerMarche('31/2016');
    expect(await recalculerPhase(m.id)).toBe('attente');

    await poser(m, 'OS');
    expect(await recalculerPhase(m.id)).toBe('cours');

    await poser(m, 'PVP');
    expect(await recalculerPhase(m.id)).toBe('provisoire');

    await poser(m, 'MLV');
    expect(await recalculerPhase(m.id)).toBe('cloture');
  });

  it('un contrat ne fait pas avancer le cycle', async () => {
    const m = await creerMarche('17/2022');
    await poser(m, 'CM');
    expect(await recalculerPhase(m.id)).toBe('attente');
  });

  it('un document en corbeille ne compte plus', async () => {
    const m = await creerMarche('26/2019');
    const os = await poser(m, 'OS');
    expect(await recalculerPhase(m.id)).toBe('cours');
    await db.document.update({ where: { id: os.id }, data: { supprimeLe: new Date() } });
    expect(await recalculerPhase(m.id)).toBe('attente');
  });

  it('recalcule tout le fonds en une passe', async () => {
    const a = await creerMarche('07/2019');
    const b = await creerMarche('07/2023');
    await poser(a, 'OS');
    await poser(b, 'PVD');
    expect(await recalculerToutesLesPhases()).toBe(2);
    expect((await db.marche.findUnique({ where: { id: a.id } })).phase).toBe('cours');
    expect((await db.marche.findUnique({ where: { id: b.id } })).phase).toBe('caution');
    // Relancé, plus rien ne change.
    expect(await recalculerToutesLesPhases()).toBe(0);
  });
});

describe('API des marchés', () => {
  it('rend la phase, les pièces manquantes et l’échéance', async () => {
    const m = await creerMarche('23A/2017/TGR', { lot: 'A', dateOs: new Date('2017-03-01'), delaiMois: 6 });
    await poser(m, 'PVP'); // PV provisoire sans OS ni BL

    const u = await creerUtilisateur('lecteur');
    const requete = en(app, await connecter(app, u.email));
    const liste = (await requete('GET', '/api/marches')).json();

    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({
      reference: '23A/2017/TGR',
      phase: 'provisoire',
      manquantes: ['os', 'bl'],
      echeance: '2017-09-01',
      etatEcheance: 'depassee',
      nbDocuments: 1,
    });
    expect(liste[0].client.nom).toBe('Trésorerie Générale du Royaume');
  });

  it('filtre par phase, par client et sur les seuls incomplets', async () => {
    const complet = await creerMarche('MAR202200027');
    await poser(complet, 'OS');
    const incomplet = await creerMarche('MAR202200096');
    await poser(incomplet, 'PVD'); // PV définitif sans OS, BL ni PV provisoire

    const u = await creerUtilisateur('chef_projet');
    const requete = en(app, await connecter(app, u.email));

    expect((await requete('GET', '/api/marches?phase=cours')).json()).toHaveLength(1);
    expect((await requete('GET', '/api/marches?incomplets=true')).json().map((m) => m.reference)).toEqual(['MAR202200096']);
    expect((await requete('GET', `/api/marches?clientId=${client.id}`)).json()).toHaveLength(2);
    expect((await requete('GET', '/api/marches?q=202200096')).json()).toHaveLength(1);
  });

  it('ne compte pas les pièces qu’un lecteur n’a pas le droit de voir', async () => {
    const m = await creerMarche('31/2016');
    await poser(m, 'OS', { confidentialite: 'interne' });
    await poser(m, 'CM', { confidentialite: 'confidentiel' });

    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));

    expect((await lecteur('GET', '/api/marches')).json()[0].nbDocuments).toBe(1);
    expect((await directeur('GET', '/api/marches')).json()[0].nbDocuments).toBe(2);
  });

  it('ouvre la fiche avec ses documents', async () => {
    const m = await creerMarche('17/2022', { objet: 'Vidéosurveillance des tribunaux' });
    await poser(m, 'OS');
    const requete = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const fiche = (await requete('GET', `/api/marches/${m.id}`)).json();
    expect(fiche.objet).toBe('Vidéosurveillance des tribunaux');
    expect(fiche.documents).toHaveLength(1);
    expect(fiche.documents[0].type.code).toBe('OS');
  });

  it('modifie les informations, et le journal garde l’avant/après', async () => {
    const m = await creerMarche('26/2019');
    const u = await creerUtilisateur('chef_projet');
    const requete = en(app, await connecter(app, u.email));

    const r = await requete('PATCH', `/api/marches/${m.id}`, { objet: 'Contrôle d’accès', montantTtc: 1250000, dateOs: '2019-05-01', delaiMois: 4 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ objet: 'Contrôle d’accès', montantTtc: 1250000, echeance: '2019-09-01' });

    const trace = await db.journal.findFirst({ where: { action: 'marche.modifie', objetId: m.id } });
    expect(trace.utilisateurId).toBe(u.id);
    expect(trace.apres).toMatchObject({ objet: 'Contrôle d’accès' });
  });

  it('refuse la modification à un lecteur, et la phase ne se saisit pas', async () => {
    const m = await creerMarche('07/2019');
    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('PATCH', `/api/marches/${m.id}`, { objet: 'Tentative' })).statusCode).toBe(403);

    const chef = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    // « phase » n'est pas un champ modifiable : il est simplement ignoré.
    await chef('PATCH', `/api/marches/${m.id}`, { phase: 'cloture' });
    expect((await db.marche.findUnique({ where: { id: m.id } })).phase).toBe('attente');
  });

  it('liste les clients avec leurs compteurs, et masque les internes', async () => {
    // Un contrat : sans aucune preuve d'attribution, ce serait un appel d'offres.
    await poser(await creerMarche('31/2016'), 'CM');
    await db.client.create({ data: { nom: 'INTELIFEX SYSTEMS', interne: true } });
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));

    const clients = (await requete('GET', '/api/clients')).json();
    expect(clients.map((c) => c.nom)).toEqual(['Trésorerie Générale du Royaume']);
    expect(clients[0].nbMarches).toBe(1);
    expect((await requete('GET', '/api/clients?interne=true')).json()).toHaveLength(2);
  });

  it('ouvre la fiche client avec ses marchés', async () => {
    await creerMarche('23A/2017/TGR', { lot: 'A' });
    await creerMarche('23B/2017/TGR', { lot: 'B' });
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const fiche = (await requete('GET', `/api/clients/${client.id}`)).json();
    expect(fiche.marches).toHaveLength(2);
    expect(fiche.marches.map((m) => m.lot)).toEqual(['A', 'B']);
  });

  it('exige une connexion', async () => {
    expect((await app.inject({ url: '/api/marches' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/clients' })).statusCode).toBe(401);
  });
});

describe('API des clients', () => {
  it('déduit le statut de chaque client de ses marchés, et ne compte pas la corbeille', async () => {
    const enCours = await creerMarche('31/2016');
    await poser(enCours, 'OS');

    const autre = await db.client.create({ data: { nom: 'Barid Al-Maghrib' } });
    const clos = await db.marche.create({ data: { reference: '04/2014', referenceNormalisee: '04/2014', clientId: autre.id } });
    const mlv = await db.typeDocument.findUniqueOrThrow({ where: { code: 'MLV' } });
    await db.document.create({ data: { titre: 'Mainlevée', marcheId: clos.id, clientId: autre.id, typeDocumentId: mlv.id } });

    const seul = await db.client.create({ data: { nom: 'SOSIPO' } });
    await db.document.create({ data: { titre: 'Attestation', clientId: seul.id } });
    await db.document.create({ data: { titre: 'Jetée', clientId: seul.id, supprimeLe: new Date() } });

    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const parNom = Object.fromEntries((await requete('GET', '/api/clients')).json().map((c) => [c.nom, c]));

    expect(parNom['Trésorerie Générale du Royaume']).toMatchObject({ statut: 'en_cours', nbMarches: 1, nbMarchesEnCours: 1 });
    expect(parNom['Barid Al-Maghrib']).toMatchObject({ statut: 'clos', nbMarches: 1, nbMarchesEnCours: 0 });
    expect(parNom.SOSIPO).toMatchObject({ statut: 'sans_marche', nbMarches: 0, nbDocuments: 1 });
  });

  it('crée un client, réservé à ceux qui gèrent le référentiel', async () => {
    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await lecteur('POST', '/api/clients', { nom: 'ONCF' })).statusCode).toBe(403);

    const responsable = await creerUtilisateur('responsable_documentaire');
    const requete = en(app, await connecter(app, responsable.email));
    const r = await requete('POST', '/api/clients', {
      nom: '  Office National des Chemins de Fer ',
      sigle: 'ONCF',
      synonymes: ['ONCF', 'ONCF'],
      domainesEmail: ['ONCF.ma'],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ nom: 'Office National des Chemins de Fer', synonymes: ['ONCF'], domainesEmail: ['oncf.ma'], statut: 'sans_marche' });

    const trace = await db.journal.findFirst({ where: { action: 'client.cree' } });
    expect(trace).toMatchObject({ utilisateurId: responsable.id, objetId: r.json().id });
  });

  it('refuse un client déjà présent, sans tenir compte des majuscules', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const r = await requete('POST', '/api/clients', { nom: 'trésorerie générale du royaume' });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreurs.nom).toMatch(/déjà au référentiel/);
  });

  it('refuse un domaine e-mail mal écrit', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const r = await requete('POST', '/api/clients', { nom: 'MEDI Telecom', domainesEmail: ['contact@medi.ma'] });
    expect(r.statusCode).toBe(422);
    expect(r.json().erreurs['domainesEmail.0']).toMatch(/Domaine invalide/);
  });

  it('exporte la liste en CSV, avec le statut en toutes lettres', async () => {
    await poser(await creerMarche('31/2016'), 'CM');
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const r = await requete('GET', '/api/clients/export.csv');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.body).toContain('Client;Sigle;Marchés;Marchés en cours;Pièces;Statut;Domaines e-mail');
    expect(r.body).toContain('Trésorerie Générale du Royaume;TGR;1;1;1;Marchés en cours;');
  });
});

describe('responsable d’un marché', () => {
  it('se choisit sur la fiche, et un compte inconnu est refusé clairement', async () => {
    const m = await creerMarche('31/2016');
    const chef = await creerUtilisateur('chef_projet');
    const requete = en(app, await connecter(app, chef.email));
    const r = await requete('PATCH', `/api/marches/${m.id}`, { responsableId: chef.id });
    expect(r.json().responsable).toEqual({ id: chef.id, nom: chef.nom });
    const refus = await requete('PATCH', `/api/marches/${m.id}`, { responsableId: 999999 });
    expect(refus.statusCode).toBe(422);
    expect(refus.json().erreurs.responsableId).toMatch(/n’existe pas/);
  });
});

describe('confidentialité de la recherche', () => {
  it('un mot cherché ne fait jamais voir une pièce confidentielle à un lecteur', async () => {
    const m = await creerMarche('31/2016');
    await poser(m, 'OS', { titre: 'Offre financière publique' });
    await poser(m, 'CM', { titre: 'Offre financière secrète', confidentialite: 'confidentiel' });

    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    // Sans mot : le filtre tient. Avec un mot : il doit tenir aussi.
    expect((await lecteur('GET', '/api/documents')).json().documents.map((d) => d.titre)).toEqual(['Offre financière publique']);
    expect((await lecteur('GET', '/api/documents?q=offre')).json().documents.map((d) => d.titre)).toEqual(['Offre financière publique']);
    expect((await lecteur('GET', '/api/documents?q=secrète')).json().total).toBe(0);

    // Celui qui a le droit les voit toutes les deux.
    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    expect((await directeur('GET', '/api/documents?q=offre')).json().total).toBe(2);
  });
});

describe('export et recherche', () => {
  it('l’export CSV des marchés porte le montant TTC', async () => {
    const m = await creerMarche('31/2016', { montantTtc: 1250000.5 });
    await poser(m, 'OS');
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const r = await requete('GET', '/api/marches/export.csv?nature=marches');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Montant TTC');
    expect(r.body).toMatch(/31\/2016;.*;1250000[.,]5;/);
  });

  it('cherche sans tenir compte des majuscules', async () => {
    const m = await creerMarche('MAR202200027', { objet: 'Vidéosurveillance' });
    await poser(m, 'OS');
    const requete = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    expect((await requete('GET', '/api/marches?q=mar2022')).json()).toHaveLength(1);
    expect((await requete('GET', '/api/marches?q=VIDÉO')).json()).toHaveLength(1);
    expect((await requete('GET', '/api/documents?q=os de mar')).json().total).toBe(1);
    expect((await requete('GET', '/api/documents?q=tgr')).json().total).toBe(0);
    expect((await requete('GET', '/api/documents?q=trésorerie')).json().total).toBe(1);
    expect((await requete('GET', '/api/recherche?q=mar2022')).json().marches).toHaveLength(1);
  });
});

describe('fiche client (modèle Odoo)', () => {
  it('crée un client avec sa fiche complète, et la corrige', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const cree = await requete('POST', '/api/clients', {
      nom: 'Office National des Chemins de Fer',
      sigle: 'ONCF',
      typeOrganisme: 'entreprise_publique',
      ice: '001234567000089',
      adresse: '8 bis, rue Abderrahmane El Ghafiki',
      ville: 'Rabat',
      pays: 'Maroc',
      telephone: '0537 77 47 47',
      email: 'Contact@ONCF.ma',
      notes: 'Dépôt des plis au bureau d’ordre, avant 15 h.',
    });
    expect(cree.statusCode).toBe(201);
    expect(cree.json()).toMatchObject({ ice: '001234567000089', ville: 'Rabat', email: 'contact@oncf.ma', typeOrganisme: 'entreprise_publique' });

    const id = cree.json().id;
    const modif = await requete('PATCH', `/api/clients/${id}`, { nom: 'Office National des Chemins de Fer', ville: 'Rabat-Agdal', email: '' });
    expect(modif.statusCode).toBe(200);
    expect(modif.json()).toMatchObject({ ville: 'Rabat-Agdal', email: null });
    expect(await db.journal.count({ where: { action: 'client.modifie', objetId: id } })).toBe(1);
  });

  it('refuse un ICE qui n’a pas 15 chiffres, et un nom déjà pris', async () => {
    const autre = await db.client.create({ data: { nom: 'Banque Atlas' } });
    const requete = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    expect((await requete('POST', '/api/clients', { nom: 'ONCF', ice: '12345' })).json().erreurs.ice).toMatch(/15 chiffres/);
    const r = await requete('PATCH', `/api/clients/${client.id}`, { nom: 'banque atlas' });
    expect(r.statusCode).toBe(409);
    expect(autre.id).not.toBe(client.id);
  });

  it('garde plusieurs contacts, que l’on modifie et retire', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('responsable_documentaire')).email));
    const a = (await requete('POST', `/api/clients/${client.id}/contacts`, { nom: 'Karim Alami', fonction: 'Chef du service informatique', mobile: '+212 661 00 00 00' })).json();
    await requete('POST', `/api/clients/${client.id}/contacts`, { nom: 'Salma Bennani', fonction: 'Ordonnatrice', email: 's.bennani@tgr.gov.ma' });

    let fiche = (await requete('GET', `/api/clients/${client.id}`)).json();
    expect(fiche.contacts.map((p) => p.nom)).toEqual(['Karim Alami', 'Salma Bennani']);

    await requete('PATCH', `/api/contacts-clients/${a.id}`, { nom: 'Karim Alami', fonction: 'Directeur des systèmes d’information' });
    await requete('DELETE', `/api/contacts-clients/${a.id}`);
    fiche = (await requete('GET', `/api/clients/${client.id}`)).json();
    expect(fiche.contacts).toMatchObject([{ nom: 'Salma Bennani', fonction: 'Ordonnatrice' }]);
  });

  it('réserve la fiche et les contacts à ceux qui gèrent les clients', async () => {
    const requete = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    expect((await requete('PATCH', `/api/clients/${client.id}`, { nom: 'TGR' })).statusCode).toBe(403);
    expect((await requete('POST', `/api/clients/${client.id}/contacts`, { nom: 'Karim Alami' })).statusCode).toBe(403);
  });
});
