/**
 * La phase d'un marché : calculée d'après ses pièces, jamais saisie (§5).
 *
 * Le calcul lui-même vit dans commun/marches.js, partagé avec les écrans.
 * Ici, on va chercher les pièces en base et on recopie le résultat dans la
 * colonne `phase` — pour pouvoir filtrer et trier en SQL sans tout relire.
 */
import { phaseDe, PIECES_CYCLE } from '@icity/commun/marches';
import { db } from '../db.js';

const CODE_VERS_CLE = new Map(PIECES_CYCLE.map((p) => [p.code, p.cle]));

/**
 * Les pièces du cycle présentes, par marché.
 *
 * Une seule requête pour tout le fonds : compter marché par marché ferait
 * autant d'allers-retours que de marchés.
 *
 * La valeur est **l'identifiant du document**, pas un simple `true` : le
 * tableau des marchés en fait un lien vers la pièce. Un identifiant est
 * toujours vrai, donc `phaseDe` continue de fonctionner tel quel.
 *
 * @param {number[]} [marcheIds] limite le calcul à ces marchés
 * @returns {Promise<Map<number, Record<string, number>>>}
 */
export async function piecesParMarche(marcheIds) {
  const lignes = await db.document.findMany({
    where: {
      supprimeLe: null,
      marcheId: marcheIds ? { in: marcheIds } : { not: null },
      typeDocument: { pieceAttendue: true },
    },
    select: { id: true, marcheId: true, typeDocument: { select: { code: true } } },
    // La plus récente d'abord : si un marché porte deux PV provisoires, le
    // lien mène au dernier versé, celui qu'on veut voir.
    orderBy: { creeLe: 'desc' },
    distinct: ['marcheId', 'typeDocumentId'],
  });

  const parMarche = new Map();
  for (const l of lignes) {
    const cle = CODE_VERS_CLE.get(l.typeDocument.code);
    if (!cle) continue;
    const pieces = parMarche.get(l.marcheId) ?? {};
    pieces[cle] = l.id;
    parMarche.set(l.marcheId, pieces);
  }
  return parMarche;
}

/** Recalcule et enregistre la phase d'un marché. Rend la phase obtenue. */
export async function recalculerPhase(marcheId) {
  if (!marcheId) return null;
  const pieces = (await piecesParMarche([marcheId])).get(marcheId) ?? {};
  const phase = phaseDe(pieces);
  await db.marche.updateMany({ where: { id: marcheId, phase: { not: phase } }, data: { phase } });
  return phase;
}

/**
 * Recalcule toutes les phases. Sert après un versement en masse, et à la
 * commande de vérification.
 * @returns {Promise<number>} le nombre de marchés dont la phase a changé
 */
export async function recalculerToutesLesPhases() {
  const marches = await db.marche.findMany({ select: { id: true, phase: true } });
  const pieces = await piecesParMarche();
  let changes = 0;
  for (const m of marches) {
    const phase = phaseDe(pieces.get(m.id) ?? {});
    if (phase !== m.phase) {
      await db.marche.update({ where: { id: m.id }, data: { phase } });
      changes += 1;
    }
  }
  return changes;
}
