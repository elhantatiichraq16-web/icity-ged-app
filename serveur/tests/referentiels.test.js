/**
 * Modifier les référentiels (§4).
 *
 * Ils structurent tout le fonds : le classement s'y réfère, les pièces du
 * cycle en dépendent. On vérifie donc surtout ce qui protège — un type encore
 * porté par des pièces ne se supprime pas, et seul l'administrateur y touche.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { connecter, creerUtilisateur, en, nouvelleApp, viderBase } from './outils.js';

let app;

beforeAll(async () => {
  app = await nouvelleApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.etiquette.deleteMany();
  await db.typeDocument.deleteMany();
  await viderBase();
});

/** Une session d'administrateur : seul rôle qui touche aux référentiels. */
async function admin() {
  const u = await creerUtilisateur('administrateur');
  return en(app, await connecter(app, u.email));
}

describe('les types de document', () => {
  it("s'ajoutent, se modifient et se retirent", async () => {
    const requete = await admin();

    const cree = await requete('POST', '/api/types-document', { nom: 'Ordre de service', code: 'os', ordreCycle: 1, pieceAttendue: true });
    expect(cree.statusCode).toBe(201);
    // Le code est normalisé : on le compare ailleurs sans se soucier de la casse.
    expect(cree.json().code).toBe('OS');

    const id = cree.json().id;
    const modifie = await requete('PATCH', `/api/types-document/${id}`, { nom: 'Ordre de service (OS)' });
    expect(modifie.json().nom).toBe('Ordre de service (OS)');

    expect((await requete('DELETE', `/api/types-document/${id}`)).statusCode).toBe(200);
    expect(await db.typeDocument.count()).toBe(0);
  });

  it('refuse de retirer un type encore porté par des pièces', async () => {
    const requete = await admin();
    const type = await db.typeDocument.create({ data: { nom: 'Décompte', code: 'DEC' } });
    await db.document.create({
      data: { titre: 'Décompte 3', source: 'versement', typeDocumentId: type.id, sha256: 'a'.repeat(64), taille: BigInt(1) },
    });

    const reponse = await requete('DELETE', `/api/types-document/${type.id}`);

    // Sinon les pièces perdraient leur classement sans qu'on puisse le
    // retrouver : mieux vaut refuser et laisser reclasser.
    expect(reponse.statusCode).toBe(409);
    expect(reponse.json().message).toContain('1 pièce');
    expect(await db.typeDocument.count()).toBe(1);
  });

  it('laisse retirer un type dont la seule pièce est en corbeille', async () => {
    const requete = await admin();
    const type = await db.typeDocument.create({ data: { nom: 'Plan', code: 'PLA' } });
    await db.document.create({
      data: { titre: 'Plan', source: 'versement', typeDocumentId: type.id, sha256: 'b'.repeat(64), taille: BigInt(1), supprimeLe: new Date() },
    });

    expect((await requete('DELETE', `/api/types-document/${type.id}`)).statusCode).toBe(200);
  });

  it('refuse un code en double', async () => {
    const requete = await admin();
    await requete('POST', '/api/types-document', { nom: 'Facture', code: 'FAC' });
    const doublon = await requete('POST', '/api/types-document', { nom: 'Autre facture', code: 'FAC' });
    expect(doublon.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('les étiquettes', () => {
  it("s'ajoutent avec leur couleur et leur famille", async () => {
    const requete = await admin();
    const cree = await requete('POST', '/api/etiquettes', { nom: 'À contrôler', couleur: '#0E8296', famille: 'circuit' });

    expect(cree.statusCode).toBe(201);
    expect(cree.json().famille).toBe('circuit');
  });

  it('refuse une couleur qui n’en est pas une', async () => {
    const requete = await admin();
    const reponse = await requete('POST', '/api/etiquettes', { nom: 'Bancale', couleur: 'rouge', famille: 'circuit' });
    expect(reponse.statusCode).toBe(422);
  });

  it('refuse de retirer une étiquette encore posée', async () => {
    const requete = await admin();
    const etiquette = await db.etiquette.create({ data: { nom: 'Validé', couleur: '#1E9E62', famille: 'circuit' } });
    const doc = await db.document.create({
      data: { titre: 'Pièce', source: 'versement', sha256: 'c'.repeat(64), taille: BigInt(1) },
    });
    await db.documentEtiquette.create({ data: { documentId: doc.id, etiquetteId: etiquette.id } });

    const reponse = await requete('DELETE', `/api/etiquettes/${etiquette.id}`);
    expect(reponse.statusCode).toBe(409);
  });
});

describe('les droits', () => {
  it('interdisent la modification à un directeur', async () => {
    // Le directeur valide et archive, mais ne redéfinit pas le vocabulaire
    // du fonds : c'est un geste d'administration.
    const u = await creerUtilisateur('directeur');
    const requete = en(app, await connecter(app, u.email));

    expect((await requete('POST', '/api/types-document', { nom: 'Essai', code: 'ESS' })).statusCode).toBe(403);
    expect((await requete('GET', '/api/referentiels/detail')).statusCode).toBe(403);
  });

  it('laissent tout le monde lire les référentiels ordinaires', async () => {
    // Les listes déroulantes en ont besoin partout dans l'application.
    const u = await creerUtilisateur('lecteur');
    const requete = en(app, await connecter(app, u.email));
    expect((await requete('GET', '/api/referentiels')).statusCode).toBe(200);
  });
});

describe('le détail compté', () => {
  it('dit combien de pièces portent chaque entrée', async () => {
    const requete = await admin();
    const type = await db.typeDocument.create({ data: { nom: 'Contrat', code: 'CON' } });
    for (const n of [1, 2]) {
      await db.document.create({
        data: { titre: `Contrat ${n}`, source: 'versement', typeDocumentId: type.id, sha256: String(n).padStart(64, '0'), taille: BigInt(1) },
      });
    }

    const detail = (await requete('GET', '/api/referentiels/detail')).json();
    expect(detail.types.find((t) => t.id === type.id).documents).toBe(2);
  });
});
