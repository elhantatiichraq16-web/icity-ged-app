/**
 * La fiche du versement (maquette A10) : marché cible, type de pièce et
 * confidentialité indiqués au dépôt, puis le suivi des pièces versées.
 *
 * On vérifie surtout ce qui protège le fonds : une fiche qui désigne un
 * marché absent, ou un niveau que le déposant ne voit pas, est refusée avant
 * que rien n'entre ; et ce que le déposant indique fait foi.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { connecter, creerUtilisateur, en, nouvelleApp, ORIGINE, viderBase } from './outils.js';

let app;
let marche;
let typeOs;

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

  marche = await db.marche.create({ data: { reference: '13/2018', referenceNormalisee: '13/2018' } });
  typeOs = await db.typeDocument.create({ data: { code: 'OS', nom: 'Ordre de service', ordreCycle: 1, pieceAttendue: true } });
});

const session = async (role) => connecter(app, (await creerUtilisateur(role)).email);

let numero = 0;
/** Verse un petit fichier texte avec les champs de la fiche, comme le navigateur : les champs d'abord. */
function verser(s, champs = {}, contenu) {
  numero += 1;
  const limite = '----icity-versement';
  const parties = Object.entries(champs).map(([nom, valeur]) => `--${limite}\r\nContent-Disposition: form-data; name="${nom}"\r\n\r\n${valeur}\r\n`);
  const texte = contenu ?? `Pièce de test ${numero}, ${Date.now()}-${Math.random()}`;
  const corps = `${parties.join('')}--${limite}\r\nContent-Disposition: form-data; name="fichier"; filename="piece-${numero}.txt"\r\nContent-Type: text/plain\r\n\r\n${texte}\r\n--${limite}--\r\n`;
  return app.inject({
    method: 'POST',
    url: '/api/documents',
    payload: corps,
    headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, origin: ORIGINE, 'content-type': `multipart/form-data; boundary=${limite}` },
  });
}

describe('la fiche du versement', () => {
  it('range la pièce où le déposant l’a dit, au niveau choisi, et le journal le garde', async () => {
    const r = await verser(await session('chef_projet'), { marcheId: marche.id, typeDocumentId: typeOs.id, confidentialite: 'restreint' });
    expect(r.statusCode).toBe(201);
    expect(r.json().document).toMatchObject({ marche: { id: marche.id }, type: { id: typeOs.id }, confidentialite: 'restreint' });

    const trace = await db.journal.findFirst({ where: { action: 'document.verse', objetId: r.json().document.id } });
    expect(trace.apres).toMatchObject({ marcheId: marche.id, typeDocumentId: typeOs.id, confidentialite: 'restreint' });
  });

  it('sans confidentialité indiquée, la pièce est « Interne »', async () => {
    const r = await verser(await session('chef_projet'));
    expect(r.statusCode).toBe(201);
    expect(r.json().document.confidentialite).toBe('interne');
  });

  it('refuse un niveau que le déposant ne voit pas, sans rien verser', async () => {
    const r = await verser(await session('chef_projet'), { confidentialite: 'confidentiel' });
    expect(r.statusCode).toBe(422);
    expect(r.json().erreurs.confidentialite).toBeDefined();
    expect(await db.document.count()).toBe(0);
  });

  it('le directeur, qui voit le confidentiel, peut en verser', async () => {
    const r = await verser(await session('directeur'), { confidentialite: 'confidentiel' });
    expect(r.statusCode).toBe(201);
    expect(r.json().document.confidentialite).toBe('confidentiel');
  });

  it('refuse un marché ou un type absent, et un niveau inventé', async () => {
    const r = await verser(await session('chef_projet'), { marcheId: 999999, typeDocumentId: 999999, confidentialite: 'secret' });
    expect(r.statusCode).toBe(422);
    expect(Object.keys(r.json().erreurs).sort()).toEqual(['confidentialite', 'marcheId', 'typeDocumentId']);
    expect(await db.document.count()).toBe(0);
  });

  it('refuse un fichier déjà au fonds, et désigne l’original', async () => {
    const s = await session('chef_projet');
    const premier = await verser(s, { marcheId: marche.id }, 'Le même contenu, au bit près.');
    const second = await verser(s, {}, 'Le même contenu, au bit près.');
    expect(second.statusCode).toBe(409);
    expect(second.json().doublon).toMatchObject({ id: premier.json().document.id, marche: { reference: '13/2018' } });
  });

  it('est refusé au lecteur', async () => {
    expect((await verser(await session('lecteur'))).statusCode).toBe(403);
  });
});

describe('le suivi des pièces versées', () => {
  it('rend les pièces demandées, et seulement celles qu’on a le droit de voir', async () => {
    const s = await session('chef_projet');
    const a = (await verser(s)).json().document;
    await verser(s);
    const secrete = await db.document.create({
      data: { titre: 'Pièce secrète', source: 'versement', sha256: 'f'.repeat(64), taille: BigInt(1), confidentialite: 'confidentiel' },
    });

    const r = await en(app, s)('GET', `/api/documents?ids=${a.id},${secrete.id},abc`);
    expect(r.json().documents.map((d) => d.id)).toEqual([a.id]);
  });

  it('une liste vide ne rend rien, plutôt que tout le fonds', async () => {
    const s = await session('chef_projet');
    await verser(s);
    expect((await en(app, s)('GET', '/api/documents?ids=')).json().documents).toEqual([]);
  });
});
