/**
 * Les marchés potentiels : connecteurs (sur des réponses enregistrées,
 * jamais le site réel), normalisation, doublons, mises à jour, expiration,
 * sources en erreur, alertes uniques, droits, sécurité des adresses,
 * conversion en marché, import CSV.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { analyserDetail, analyserListe, ADRESSE_LISTE, lireListePmmp, REGLES_PMMP } from '../src/services/veille/connecteurs/pmmp.js';
import * as lecture from '../src/services/veille/lecture.js';
import { analyserFlux } from '../src/services/veille/connecteurs/rss.js';
import { analyserCsv } from '../src/services/veille/connecteurs/csv.js';
import { normaliserOffre } from '../src/services/veille/normalisation.js';
import { alerterNouvellesOffres, assurerInitialisation, enregistrerOffres, expirerOffres } from '../src/services/veille/offres.js';
import { synchroniserTout } from '../src/services/veille/synchronisation.js';
import { AGENT, estAdressePrivee, verifierUrl } from '../src/services/veille/recuperation.js';
import { connecter, creerUtilisateur, en, nouvelleApp, ORIGINE, viderBase } from './outils.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const fixture = (nom) => fs.readFileSync(path.join(ICI, 'fixtures', 'veille', nom), 'utf8');
const LISTE = fixture('pmmp-liste.html');
const DETAIL = fixture('pmmp-detail.html');
const FLUX = fixture('flux.rss');
const CSV = fixture('offres.csv');

// Le « 6 octobre 2026 » des tests : l'offre du 30 septembre est déjà échue.
const MAINTENANT = new Date('2026-10-06T09:00:00Z');

let app;
let pmmp;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.activite.deleteMany();
  await db.notification.deleteMany();
  await db.abonnement.deleteMany();
  await db.favoriOffre.deleteMany();
  await db.offrePotentielle.deleteMany();
  await db.synchronisationSource.deleteMany();
  await db.sourceMarches.deleteMany();
  await db.criteresMarches.deleteMany();
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany({ where: { nom: { contains: 'EXEMPLE', mode: 'insensitive' } } });
  await viderBase();
  await assurerInitialisation();
  pmmp = await db.sourceMarches.findFirstOrThrow({ where: { connecteur: 'pmmp' } });
});

/** Un faux « recuperer » : les réponses enregistrées, sans réseau. */
const fauxRecuperer = (reponses) => async (adresse) => {
  const texte = reponses[adresse] ?? reponses['*'];
  if (texte instanceof Error) throw texte;
  return { url: adresse, statut: 200, type: 'text/html; charset=utf-8', texte };
};

describe('connecteur PMMP (réponses enregistrées)', () => {
  it('lit la liste des consultations et normalise chaque offre', () => {
    const offres = analyserListe(LISTE).map(normaliserOffre);
    expect(offres).toHaveLength(3);
    expect(offres[0]).toMatchObject({
      idExterne: 'pmmp-x1a-900001',
      reference: '12/2026/CE',
      acheteur: "COMMUNE D'EXEMPLE",
      categorie: 'Services',
      procedure: "Appel d'offres ouvert",
      lieu: 'RABAT',
      reponseElectronique: 'Réponse électronique obligatoire',
      urlOfficielle: 'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation=900001&orgAcronyme=x1a',
    });
    expect(offres[0].objet).toMatch(/^Mise en place d'une plateforme Smart City/);
    // 20/11/2026 10:00, heure du Maroc : GMT depuis le 20 septembre 2026.
    expect(offres[0].dateLimite.toISOString()).toBe('2026-11-20T10:00:00.000Z');
    expect(offres[0].datePublication.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    // Avant le retour à GMT, la même écriture valait UTC+1.
    expect(normaliserOffre({ objet: 'x', dateLimite: '15/08/2026 10:00' }).dateLimite.toISOString()).toBe('2026-08-15T09:00:00.000Z');
  });

  it('résiste au HTML mal fermé du portail réel (lignes et cellules sans fermeture)', () => {
    const malForme = LISTE.replace(/<\/(td|tr)>/g, '').replace('<tbody>', '<tbody><div>');
    const offres = analyserListe(malForme).map(normaliserOffre);
    expect(offres.map((o) => o.idExterne)).toEqual(['pmmp-x1a-900001', 'pmmp-y2b-900002', 'pmmp-x1a-900003']);
    expect(offres.every((o) => o.dateLimite && o.datePublication && o.acheteur)).toBe(true);
  });

  it('lit une page de détail : estimation, caution, domaines, documents (sans lien piégé)', () => {
    const o = normaliserOffre(analyserDetail(DETAIL, 'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation=900001&orgAcronyme=x1a'));
    expect(o).toMatchObject({ idExterne: 'pmmp-x1a-900001', estimation: 2_400_000, caution: 24_000, categorie: 'Services', lots: null, procedure: "Appel d'offres ouvert — Sur offre de prix" });
    expect(o.domaines).toEqual(['Services / Informatique / Développement de logiciels']);
    expect(o.reponseElectronique).toMatch(/obligatoire/);
    expect(o.documents.map((d) => d.nom)).toEqual(['Avis de publicité', 'Dossier de consultation - 2,10 Mo']);
    expect(JSON.stringify(o)).not.toMatch(/javascript:|<script/);
  });

  it('une synchronisation crée les offres, les note, et fait expirer l’offre échue', async () => {
    await db.sourceMarches.update({ where: { id: pmmp.id }, data: { active: true } });
    const { bilans } = await synchroniserTout({ maintenant: MAINTENANT, recuperer: fauxRecuperer({ [ADRESSE_LISTE]: LISTE }) });
    expect(bilans).toMatchObject([{ source: pmmp.nom, etat: 'ok', nouvelles: 3, misesAJour: 0 }]);
    const offres = await db.offrePotentielle.findMany({ orderBy: { reference: 'asc' } });
    expect(offres.map((o) => [o.reference, o.statut])).toEqual([['07/2026/AO', 'expiree'], ['12/2026/CE', 'nouvelle'], ['45/2026/DR', 'nouvelle']]);
    const smart = offres[1];
    expect(smart.score).toBeGreaterThanOrEqual(60);
    expect(smart.raisonsScore.map((r) => r.texte)).toEqual(expect.arrayContaining(['« smart city » trouvé dans l’objet', '« système d’information » trouvé dans l’objet']));
    expect(offres[2].score).toBeLessThan(30); // travaux d'eau potable
    const sync = await db.synchronisationSource.findFirstOrThrow({ where: { sourceId: pmmp.id } });
    expect(sync).toMatchObject({ etat: 'ok', recues: 3, nouvelles: 3, declenchement: 'auto' });
  });
});

describe('doublons, mises à jour, expiration', () => {
  it('ne crée jamais deux fois la même offre, et ne touche pas au suivi de l’équipe', async () => {
    const brutes = analyserListe(LISTE);
    await enregistrerOffres(pmmp, brutes, { maintenant: MAINTENANT });
    const smart = await db.offrePotentielle.findFirstOrThrow({ where: { idExterne: 'pmmp-x1a-900001' } });
    await db.offrePotentielle.update({ where: { id: smart.id }, data: { statut: 'interessante', notes: 'À suivre' } });

    // Deuxième passage : l'objet a changé sur le portail, et la même ligne arrive deux fois.
    const modifiees = [{ ...brutes[0], objet: 'Plateforme Smart City (objet corrigé)' }, brutes[0], ...brutes.slice(1)];
    const { nouvelles, misesAJour, ignorees } = await enregistrerOffres(pmmp, modifiees, { maintenant: MAINTENANT });
    expect({ nouvelles: nouvelles.length, misesAJour, ignorees }).toEqual({ nouvelles: 0, misesAJour: 3, ignorees: 1 });
    expect(await db.offrePotentielle.count()).toBe(3);
    expect(await db.offrePotentielle.findUnique({ where: { id: smart.id } })).toMatchObject({ objet: 'Plateforme Smart City (objet corrigé)', statut: 'interessante', notes: 'À suivre' });
  });

  it('sans identifiant de la source : une empreinte stable évite le doublon', async () => {
    const manuelle = await db.sourceMarches.findFirstOrThrow({ where: { connecteur: 'manuel' } });
    const brute = { reference: 'X-1', acheteur: 'Commune', objet: 'Plateforme numérique', dateLimite: '2026-12-01' };
    await enregistrerOffres(manuelle, [brute], { maintenant: MAINTENANT });
    await enregistrerOffres(manuelle, [{ ...brute, objet: 'Plateforme  numérique ' }], { maintenant: MAINTENANT });
    const offres = await db.offrePotentielle.findMany({ where: { sourceId: manuelle.id } });
    expect(offres).toHaveLength(1);
    expect(offres[0].idExterne).toMatch(/^emp-[0-9a-f]{16}$/);
  });

  it('une offre ouverte dont la date limite passe devient « expirée »', async () => {
    await enregistrerOffres(pmmp, analyserListe(LISTE), { maintenant: MAINTENANT });
    expect(await expirerOffres({ maintenant: new Date('2026-11-21T00:00:00Z') })).toBe(1);
    const smart = await db.offrePotentielle.findFirstOrThrow({ where: { idExterne: 'pmmp-x1a-900001' } });
    expect(smart.statut).toBe('expiree');
    expect(await db.journal.count({ where: { action: 'offre.expiree', objetId: smart.id } })).toBe(1);
  });
});

describe('sources', () => {
  it('une source en erreur n’empêche pas les autres', async () => {
    await db.sourceMarches.update({ where: { id: pmmp.id }, data: { active: true } });
    const rss = await db.sourceMarches.create({ data: { nom: 'Flux d’exemple', siteWeb: 'https://avis.exemple.ma', connecteur: 'rss', adresse: 'https://avis.exemple.ma/flux.rss', active: true } });
    const { bilans } = await synchroniserTout({ maintenant: MAINTENANT, recuperer: fauxRecuperer({ [ADRESSE_LISTE]: new Error('La source ne répond pas (délai dépassé).'), 'https://avis.exemple.ma/flux.rss': FLUX }) });
    expect(bilans.map((b) => [b.source, b.etat])).toEqual([[pmmp.nom, 'erreur'], ['Flux d’exemple', 'ok']]);
    expect(await db.sourceMarches.findUnique({ where: { id: pmmp.id } })).toMatchObject({ derniereSyncEtat: 'erreur', echecsConsecutifs: 1, derniereErreur: 'La source ne répond pas (délai dépassé).' });
    const offresRss = await db.offrePotentielle.findMany({ where: { sourceId: rss.id }, orderBy: { idExterne: 'asc' } });
    expect(offresRss.map((o) => o.idExterne)).toEqual(['exemple-2026-031', 'exemple-2026-032']);
    // Le HTML du flux est réduit à du texte ; le mot exclu « carburant » met le score à 0.
    expect(offresRss[0].resume).toBe('Marché de maintenance informatique.');
    expect(offresRss[1].score).toBe(0);
  });

  it('une source désactivée n’est jamais synchronisée', async () => {
    const { bilans } = await synchroniserTout({ maintenant: MAINTENANT, recuperer: fauxRecuperer({ '*': LISTE }) });
    expect(bilans).toEqual([]);
    expect(await db.offrePotentielle.count()).toBe(0);
  });

  it('flux RSS : guid, lien, titre ; CSV : colonnes reconnues, ligne sans objet refusée', () => {
    expect(analyserFlux(FLUX)[0]).toMatchObject({ idExterne: 'exemple-2026-031', urlOfficielle: 'https://avis.exemple.ma/consultations/2026-031', categorie: 'Services' });
    const { offres, erreurs } = analyserCsv(CSV);
    expect(offres).toHaveLength(2);
    expect(offres[0]).toMatchObject({ reference: 'CSV-01/2026', acheteur: 'Commune d\'Exemple', lieu: 'Fès', estimation: '850 000,00', urlOfficielle: 'https://avis.exemple.ma/csv-01' });
    expect(erreurs).toEqual([{ ligne: 4, message: 'objet manquant' }]);
  });
});

describe('sécurité des adresses (SSRF)', () => {
  it('refuse le réseau local, HTTP (sauf autorisation), les identifiants et les autres protocoles', () => {
    for (const mauvaise of ['http://www.exemple.ma', 'https://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://192.168.1.10/', 'https://[::1]/', 'https://169.254.169.254/latest', 'file:///etc/passwd', 'https://user:pass@exemple.ma/', 'https://serveur.local/', 'ftp://exemple.ma/']) {
      expect(() => verifierUrl(mauvaise), mauvaise).toThrow();
    }
    expect(verifierUrl('https://www.marchespublics.gov.ma/pmmp/').hostname).toBe('www.marchespublics.gov.ma');
    expect(verifierUrl('http://www.exemple.ma', { autoriserHttp: true }).protocol).toBe('http:');
    // L'en-tête User-Agent doit rester en ASCII, sinon Node refuse toute requête réelle.
    expect(AGENT).toMatch(/^[ -~]+$/);
    expect([estAdressePrivee('172.20.1.1'), estAdressePrivee('::ffff:127.0.0.1'), estAdressePrivee('fd00::1'), estAdressePrivee('8.8.8.8')]).toEqual([true, true, true, false]);
  });

  it('une source vers le réseau local est refusée à l’enregistrement ; ses secrets ne ressortent jamais', async () => {
    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const refus = await directeur('POST', '/api/sources-marches', { nom: 'Piège', siteWeb: 'https://127.0.0.1/', connecteur: 'rss' });
    expect(refus.statusCode).toBe(422);
    expect(refus.json().erreurs.siteWeb).toMatch(/réseau local/);
    const ok = await directeur('POST', '/api/sources-marches', { nom: 'Avec jeton', siteWeb: 'https://avis.exemple.ma', connecteur: 'api', adresse: 'https://api.exemple.ma/avis', secrets: '{"Authorization":"Bearer secret-123"}' });
    expect(ok.statusCode).toBe(201);
    const liste = await directeur('GET', '/api/sources-marches');
    expect(JSON.stringify(liste.json())).not.toMatch(/secret-123|Bearer/);
    expect(liste.json().find((s) => s.nom === 'Avec jeton')).toMatchObject({ aDesSecrets: true });
    expect(JSON.stringify(await db.journal.findMany({ where: { action: 'source.creee' } }))).not.toMatch(/secret-123/);
  });
});

describe('droits d’accès', () => {
  it('lecteur : rien ; chef de projet : lecture ; commercial : suivi ; sources : direction', async () => {
    await enregistrerOffres(pmmp, analyserListe(LISTE), { maintenant: MAINTENANT });
    const offre = await db.offrePotentielle.findFirstOrThrow({ where: { idExterne: 'pmmp-x1a-900001' } });
    const lecteur = en(app, await connecter(app, (await creerUtilisateur('lecteur')).email));
    const chef = en(app, await connecter(app, (await creerUtilisateur('chef_projet')).email));
    const commercial = en(app, await connecter(app, (await creerUtilisateur('commercial_ao')).email));

    expect((await lecteur('GET', '/api/marches-potentiels')).statusCode).toBe(403);
    expect((await lecteur('GET', `/api/fil/offre/${offre.id}`)).statusCode).toBe(403);
    expect((await chef('GET', '/api/marches-potentiels')).json().total).toBe(3); // l'expirée reste visible (seule une archivée sort de la liste)
    expect((await chef('PATCH', `/api/marches-potentiels/${offre.id}`, { statut: 'interessante' })).statusCode).toBe(403);
    expect((await commercial('PATCH', `/api/marches-potentiels/${offre.id}`, { statut: 'interessante' })).statusCode).toBe(200);
    expect((await commercial('GET', '/api/sources-marches')).statusCode).toBe(403);
    expect((await commercial('PUT', '/api/criteres-marches', { seuil: 40 })).statusCode).toBe(200);
    expect((await chef('PUT', '/api/criteres-marches', { seuil: 40 })).statusCode).toBe(403);

    // Le changement de statut se lit au fil de l'offre.
    const fil = (await commercial('GET', `/api/fil/offre/${offre.id}`)).json();
    expect(JSON.stringify(fil)).toMatch(/Intéressante/);
  });
});

describe('alertes', () => {
  it('une seule notification par offre pertinente, au-dessus du seuil de chacun', async () => {
    const commercial = await creerUtilisateur('commercial_ao');
    const exigeant = await creerUtilisateur('directeur', { alerteOffresScore: 99 });
    const parMail = await creerUtilisateur('commercial_ao', { alerteOffres: 'mail' });
    await creerUtilisateur('lecteur');
    const { nouvelles } = await enregistrerOffres(pmmp, analyserListe(LISTE), { maintenant: MAINTENANT });
    expect(await alerterNouvellesOffres(nouvelles, { maintenant: MAINTENANT })).toBe(1);
    expect(await alerterNouvellesOffres(nouvelles, { maintenant: MAINTENANT })).toBe(0);
    const notes = await db.notification.findMany({ where: { genre: 'opportunite' } });
    expect(notes.map((n) => n.utilisateurId)).toEqual([commercial.id]);
    expect(notes[0].texte).toMatch(/^Nouvelle opportunité à \d+ % : Mise en place d'une plateforme Smart City.* — échéance le 20 novembre 2026\.$/);
    expect([exigeant.id, parMail.id]).not.toContain(notes[0].utilisateurId);
  });
});

describe('conversion en marché', () => {
  it('crée le client et le marché, relie l’offre, journalise, et refuse une deuxième conversion', async () => {
    await enregistrerOffres(pmmp, analyserListe(LISTE), { maintenant: MAINTENANT });
    const offre = await db.offrePotentielle.findFirstOrThrow({ where: { idExterne: 'pmmp-x1a-900001' } });
    const commercial = en(app, await connecter(app, (await creerUtilisateur('commercial_ao')).email));

    const proposition = (await commercial('GET', `/api/marches-potentiels/${offre.id}/conversion`)).json();
    expect(proposition.proposition).toMatchObject({ reference: '12/2026/CE', nouveauClient: "COMMUNE D'EXEMPLE", statutAffaire: 'AO en préparation' });
    expect(proposition.proposition.notes).toMatch(/Date limite de remise des plis : 20 novembre 2026/);

    const r = await commercial('POST', `/api/marches-potentiels/${offre.id}/convertir`, { ...proposition.proposition, clientId: null });
    expect(r.statusCode).toBe(201);
    const { marcheId, clientCree } = r.json();
    expect(clientCree.nom).toBe("COMMUNE D'EXEMPLE");
    expect(await db.marche.findUnique({ where: { id: marcheId } })).toMatchObject({ reference: '12/2026/CE', clientId: clientCree.id, statutAffaire: 'AO en préparation' });
    expect(await db.offrePotentielle.findUnique({ where: { id: offre.id } })).toMatchObject({ statut: 'convertie', marcheId });
    expect(await db.journal.count({ where: { action: 'offre.convertie', objetId: offre.id } })).toBe(1);
    expect(await db.journal.count({ where: { action: 'marche.cree', objetId: marcheId } })).toBe(1);

    const encore = await commercial('POST', `/api/marches-potentiels/${offre.id}/convertir`, { reference: '12/2026/CE-bis' });
    expect(encore.statusCode).toBe(409);
    expect(await db.marche.count()).toBe(1);
    expect((await commercial('PATCH', `/api/marches-potentiels/${offre.id}`, { statut: 'a_etudier' })).statusCode).toBe(409);
  });
});

describe('import CSV', () => {
  it('importe les lignes valides, refuse celle sans objet, et ne double rien au second import', async () => {
    const commercial = await connecter(app, (await creerUtilisateur('commercial_ao')).email);
    const manuelle = await db.sourceMarches.findFirstOrThrow({ where: { connecteur: 'manuel' } });
    const envoyer = () => {
      const limite = '----icity-csv';
      const corps = `--${limite}\r\nContent-Disposition: form-data; name="fichier"; filename="offres.csv"\r\nContent-Type: text/csv\r\n\r\n${CSV}\r\n--${limite}--\r\n`;
      return app.inject({ method: 'POST', url: `/api/sources-marches/${manuelle.id}/import-csv`, payload: corps, headers: { cookie: commercial.cookie, 'x-csrf-token': commercial.csrf, origin: ORIGINE, 'content-type': `multipart/form-data; boundary=${limite}` } });
    };
    const premier = await envoyer();
    expect(premier.statusCode).toBe(200);
    expect(premier.json()).toMatchObject({ recues: 2, nouvelles: 2, misesAJour: 0, erreurs: [{ ligne: 4, message: 'objet manquant' }] });
    const csv01 = await db.offrePotentielle.findFirstOrThrow({ where: { reference: 'CSV-01/2026' } });
    expect(Number(csv01.estimation)).toBe(850000);
    expect(csv01.dateLimite.toISOString()).toBe('2026-11-28T11:00:00.000Z');
    expect((await envoyer()).json()).toMatchObject({ nouvelles: 0, misesAJour: 2 });
    expect(await db.offrePotentielle.count({ where: { sourceId: manuelle.id } })).toBe(2);
  });
});

describe('règles de lecture (sans modifier le code)', () => {
  const { lireListe, verifierRegles, lireRegle, diagnostic } = lecture;

  it('chaque sorte de règle, et la règle de secours quand la première échoue', () => {
    const html = `<div class="annonce" data-id="77"><h2 id="x_titre">Plateforme IoT</h2><p>Acheteur public : Commune d'Exemple</p>
      <p>Date limite : 20/11/2026 à 10:00</p><a href="/avis/77.pdf">Avis</a><span class="montant">Estimation : 1 200 000,00 DH</span></div>`;
    const champs = {
      _id: ['css:div.annonce@data-id'],
      idExterne: ['modele:ex-{_id}'],
      objet: ['css:#n_existe_pas', 'css:h2'],
      acheteur: ['etiquette:Acheteur public'],
      dateLimite: ['regex:(\\d{2}/\\d{2}/\\d{4}) à (\\d{2}:\\d{2})'],
      estimation: ['texte:Estimation\\s*:\\s*([\\d\\s,]+\\d)'],
      reference: ['modele:{_absent}', 'fixe:SANS-REF'],
      lieu: ['css:span.montant | garder:(\\d[\\d ]+\\d)'],
      documents: ['documents:\\.pdf$'],
    };
    const { offres, qualite } = lireListe(html, { format: 'html', liste: { decoupage: { css: 'div.annonce' }, champs } }, { base: 'https://avis.exemple.ma/' });
    expect(offres[0]).toMatchObject({ idExterne: 'ex-77', objet: 'Plateforme IoT', acheteur: "Commune d'Exemple", dateLimite: '20/11/2026 10:00', estimation: '1 200 000,00', reference: 'SANS-REF', lieu: '1 200 000' });
    expect(offres[0].documents).toEqual([{ nom: 'Avis', url: 'https://avis.exemple.ma/avis/77.pdf' }]);
    expect(qualite.secours).toMatchObject({ objet: 1, reference: 1 });
  });

  it('refuse les règles mal écrites, avec une raison par règle', () => {
    expect(verifierRegles({ format: 'html', liste: { decoupage: { css: 'tr' }, champs: { objet: ['css:h2'] } } })).toEqual([]);
    const problemes = verifierRegles({ format: 'html', liste: { decoupage: {}, champs: { objet: ['xpath://h2'], dateLimite: ['regex:(\\d{2}'], couleur: ['fixe:bleu'], lieu: ['css:h2 | couper:x'] } } }).join(' ');
    expect(problemes).toMatch(/repère ou un sélecteur/);
    expect(problemes).toMatch(/Règle inconnue/);
    expect(problemes).toMatch(/Motif invalide/);
    expect(problemes).toMatch(/Champ inconnu : « couleur »/);
    expect(problemes).toMatch(/Filtre inconnu/);
    expect(() => lireRegle(`regex:${'a'.repeat(500)}`)).toThrow(/trop long/);
  });

  it('le site renomme ses éléments : les règles de secours lisent quand même la page', () => {
    const renomme = LISTE.replaceAll('_infosBullesObjet', '_bulleNouvelle').replaceAll('_panelBlocObjet', '_blocNouveau').replaceAll('_panelBlocDenomination', '_acheteurNouveau').replaceAll('cloture-line', 'fin-depot');
    const { offres, qualite } = lireListePmmp(renomme);
    expect(offres).toHaveLength(3);
    expect(offres[0]).toMatchObject({ objet: expect.stringMatching(/^Mise en place d'une plateforme Smart City/), acheteur: "COMMUNE D'EXEMPLE", dateLimite: '20/11/2026 10:00' });
    // La 3e annonce n'affiche son objet que dans l'élément renommé (pas d'étiquette « Objet : ») : elle seule est perdue.
    expect(qualite).toMatchObject({ blocs: 3, offres: 2, parChamp: { objet: 2, acheteur: 3, dateLimite: 3 }, secours: { objet: 2, acheteur: 3, dateLimite: 3 } });
    expect(diagnostic(qualite, REGLES_PMMP)).toBeNull();
  });

  it('une page devenue illisible : source « à vérifier », la direction prévenue une seule fois, puis corrigée dans les règles', async () => {
    const directeur = await creerUtilisateur('directeur');
    await creerUtilisateur('commercial_ao');
    await db.sourceMarches.update({ where: { id: pmmp.id }, data: { active: true } });
    const casse = LISTE.replaceAll('_refCons', '_numeroConsultation');
    const passer = (html) => synchroniserTout({ forcer: true, maintenant: MAINTENANT, recuperer: fauxRecuperer({ [ADRESSE_LISTE]: html }) });

    expect((await passer(casse)).bilans[0]).toMatchObject({ etat: 'a_verifier', probleme: expect.stringMatching(/Aucune annonce trouvée/) });
    await passer(casse);
    const alertes = await db.notification.findMany({ where: { lien: '/parametres/sources' } });
    expect(alertes.map((n) => n.utilisateurId)).toEqual([directeur.id]); // une seule fois, et seulement à qui gère les sources

    // On corrige le repère dans l'écran (les réglages de la source), sans code.
    const regles = structuredClone(REGLES_PMMP);
    regles.liste.decoupage.repere = '_numeroConsultation"';
    regles.liste.champs._ref = ['css:input[id$="_numeroConsultation"]@value'];
    await db.sourceMarches.update({ where: { id: pmmp.id }, data: { parametres: { regles } } });
    expect((await passer(casse)).bilans[0]).toMatchObject({ etat: 'ok', nouvelles: 3 });
  });

  it('une API JSON se branche par des règles, sans code', async () => {
    const champs = { idExterne: ['json:id'], urlOfficielle: ['json:url'], reference: ['json:reference'], objet: ['json:intitule'], acheteur: ['json:acheteur.nom'], categorie: ['json:categorie'], lieu: ['json:lieu'], datePublication: ['json:date_publication'], dateLimite: ['json:date_limite'], estimation: ['json:estimation'] };
    const api = await db.sourceMarches.create({
      data: { nom: 'API d’exemple', siteWeb: 'https://api.exemple.ma', connecteur: 'api', adresse: 'https://api.exemple.ma/avis', active: true, parametres: { regles: { format: 'json', liste: { decoupage: { chemin: 'data' }, champs } } } },
    });
    const { bilans } = await synchroniserTout({ maintenant: MAINTENANT, recuperer: fauxRecuperer({ 'https://api.exemple.ma/avis': fixture('api.json') }) });
    expect(bilans).toMatchObject([{ source: 'API d’exemple', etat: 'ok', nouvelles: 2 }]);
    const iot = await db.offrePotentielle.findFirstOrThrow({ where: { sourceId: api.id, idExterne: 'A-2026-101' } });
    expect(iot).toMatchObject({ acheteur: "Commune d'Exemple", lieu: 'Oujda' });
    expect(Number(iot.estimation)).toBe(950000);
    expect(iot.score).toBeGreaterThanOrEqual(25); // « IoT »
  });

  it('l’écran ne peut pas enregistrer des règles invalides ; l’essai et les règles par défaut restent à la direction', async () => {
    const directeur = en(app, await connecter(app, (await creerUtilisateur('directeur')).email));
    const commercial = en(app, await connecter(app, (await creerUtilisateur('commercial_ao')).email));
    const corps = { nom: pmmp.nom, siteWeb: pmmp.siteWeb, connecteur: 'pmmp', adresse: pmmp.adresse, parametres: { regles: { format: 'html', liste: { decoupage: { repere: 'x' }, champs: { objet: ['regex:(('] } } } } };
    const refus = await directeur('PATCH', `/api/sources-marches/${pmmp.id}`, corps);
    expect(refus.statusCode).toBe(422);
    expect(refus.json().erreurs.regles).toMatch(/Motif invalide/);
    expect((await directeur('GET', '/api/sources-marches/regles-par-defaut')).json().pmmp.liste.decoupage.repere).toBe('_refCons"');
    expect((await directeur('POST', '/api/sources-marches/essai', { connecteur: 'html', adresse: 'https://avis.exemple.ma', regles: { format: 'html', liste: { decoupage: {}, champs: {} } } })).json()).toMatchObject({ ok: false, message: expect.stringMatching(/repère ou un sélecteur/) });
    expect((await commercial('POST', '/api/sources-marches/essai', { connecteur: 'pmmp' })).statusCode).toBe(403);
  });
});
