/**
 * Le dépôt d'une pièce directement dans la case du tableau des marchés.
 *
 * La case connaît son marché (la ligne) et son type (la colonne) : le
 * versement ne demande donc rien de plus. On vérifie ici que ce chemin
 * court aboutit au même résultat que le versement ordinaire — pièce
 * rattachée, phase recalculée — et que la case rend bien de quoi ouvrir le
 * document.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { piecesParMarche, recalculerPhase } from '../src/services/phase-marche.js';
import { creerUtilisateur, viderBase } from './outils.js';

let client;
let marche;
let types;

beforeAll(async () => {
  await creerUtilisateur('directeur');
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.documentEtiquette.deleteMany();
  await db.document.deleteMany();
  await db.marche.deleteMany();
  await db.client.deleteMany();
  await db.typeDocument.deleteMany();
  await viderBase();

  client = await db.client.create({ data: { nom: 'Trésorerie Générale du Royaume', sigle: 'TGR' } });
  marche = await db.marche.create({
    data: { reference: '23C/2017/TGR', referenceNormalisee: '23/2017/TGR#C', clientId: client.id },
  });

  types = {};
  for (const [i, [code, nom]] of [
    ['OS', 'Ordre de service'],
    ['PVP', 'PV de réception provisoire'],
    ['MLV', 'Mainlevée de caution'],
  ].entries()) {
    types[code] = await db.typeDocument.create({ data: { code, nom, pieceAttendue: true, ordreCycle: i + 1 } });
  }
});

/** Une pièce versée sur le marché, comme le ferait un dépôt dans la case. */
function verser(code, champs = {}) {
  return db.document.create({
    data: {
      titre: `Pièce ${code}`,
      source: 'versement',
      marcheId: marche.id,
      clientId: client.id,
      typeDocumentId: types[code].id,
      sha256: `${code}`.padEnd(64, '0'),
      taille: BigInt(1024),
      ...champs,
    },
  });
}

describe('les pièces rendues au tableau', () => {
  it("donne l'identifiant du document, pas un simple oui", async () => {
    const os = await verser('OS');
    const pieces = (await piecesParMarche([marche.id])).get(marche.id);

    // C'est ce qui permet à la case d'être un lien vers la pièce.
    expect(pieces.os).toBe(os.id);
  });

  it('ne rend rien pour une pièce absente', async () => {
    const pieces = (await piecesParMarche([marche.id])).get(marche.id) ?? {};
    expect(pieces.os).toBeUndefined();
  });

  it('ignore une pièce mise en corbeille', async () => {
    await verser('OS', { supprimeLe: new Date() });
    const pieces = (await piecesParMarche([marche.id])).get(marche.id) ?? {};
    expect(pieces.os).toBeUndefined();
  });

  it('mène à la plus récente quand le marché en porte deux', async () => {
    await verser('PVP', { sha256: 'ancien'.padEnd(64, '0'), creeLe: new Date('2026-01-01') });
    const recent = await verser('PVP', { sha256: 'recent'.padEnd(64, '0'), creeLe: new Date('2026-09-01') });

    const pieces = (await piecesParMarche([marche.id])).get(marche.id);
    // Deux PV provisoires : le lien doit mener au dernier versé.
    expect(pieces.pvp).toBe(recent.id);
  });
});

describe('la phase après un dépôt', () => {
  it("passe en exécution dès que l'OS arrive", async () => {
    expect(await recalculerPhase(marche.id)).toBe('attente');

    await verser('OS');
    expect(await recalculerPhase(marche.id)).toBe('cours');

    // La colonne « phase » est recopiée en base pour trier et filtrer en SQL.
    const relu = await db.marche.findUnique({ where: { id: marche.id } });
    expect(relu.phase).toBe('cours');
  });

  it('va jusqu’à la clôture avec la mainlevée', async () => {
    await verser('OS');
    await verser('MLV');
    expect(await recalculerPhase(marche.id)).toBe('cloture');
  });

  it("continue de fonctionner bien que la valeur soit un identifiant", async () => {
    // phaseDe teste la véracité, pas « === true » : un identifiant convient.
    await verser('PVP');
    const pieces = (await piecesParMarche([marche.id])).get(marche.id);
    expect(typeof pieces.pvp).toBe('number');
    expect(await recalculerPhase(marche.id)).toBe('provisoire');
  });
});
