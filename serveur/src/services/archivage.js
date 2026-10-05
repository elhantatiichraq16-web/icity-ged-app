/**
 * L'archivage des marchés et des pièces.
 *
 * Ce qui est archivé sort de la vue courante — liste des marchés, documents,
 * files du tri, tableau de bord, classement automatique, listes déroulantes —
 * mais reste dans la plateforme : la page « Archives » et la recherche le
 * montrent toujours, et tout se modifie comme avant. L'archivage range, il ne
 * verrouille pas.
 *
 * Une pièce est archivée de deux façons : elle-même (une pièce hors marché,
 * rangée en fin d'exercice), ou parce que son marché l'est.
 */
import { db } from '../db.js';

/** Un marché en cours : ce que voient la liste et le tableau de bord. */
export const EN_COURS = { archiveLe: null };

/** Une pièce dont le marché est archivé. */
const MARCHE_ARCHIVE = { marche: { is: { archiveLe: { not: null } } } };

/**
 * Les pièces hors des archives : ni archivées elles-mêmes, ni dans un marché
 * archivé. Un seul `AND`, pour se poser dans un `where` sans écraser son `OR`
 * ou son `NOT` — dans un `AND` existant, on y ajoute cet objet.
 */
export const PIECES_HORS_ARCHIVES = { AND: [{ archiveLe: null }, { NOT: MARCHE_ARCHIVE }] };

/**
 * Les paires de doublons à montrer : celles où l'une des deux pièces au moins
 * est en cours. Un rescan d'une pièce archivée doit encore se signaler.
 */
export const DOUBLONS_HORS_ARCHIVES = { OR: [{ documentA: PIECES_HORS_ARCHIVES }, { documentB: PIECES_HORS_ARCHIVES }] };

/** Les pièces archivées, d'une façon ou de l'autre. */
export const PIECES_ARCHIVEES = { OR: [{ archiveLe: { not: null } }, MARCHE_ARCHIVE] };

/** Une pièce (chargée avec son marché) est-elle archivée ? */
export const pieceArchivee = (d) => Boolean(d.archiveLe || d.marche?.archiveLe);

/**
 * Archiver ou désarchiver des pièces, avec une ligne de journal chacune.
 *
 * Ce qui est déjà dans l'état demandé est ignoré : relancer le geste ne
 * change ni la date ni l'auteur.
 *
 * @param {number[]} ids
 * @param {{ archiver: boolean, utilisateurId: number, ip?: string, journaliser: Function, log?: object }} options
 * @returns {Promise<number>} le nombre de pièces modifiées
 */
export async function archiverPieces(ids, { archiver, utilisateurId, ip, journaliser, log }) {
  const vises = await db.document.findMany({
    where: { id: { in: ids }, supprimeLe: null, archiveLe: archiver ? null : { not: null } },
    select: { id: true, titre: true },
  });
  if (!vises.length) return 0;

  await db.document.updateMany({
    where: { id: { in: vises.map((d) => d.id) } },
    data: archiver ? { archiveLe: new Date(), archiveParId: utilisateurId } : { archiveLe: null, archiveParId: null },
  });
  for (const d of vises) {
    await journaliser(
      { utilisateurId, action: archiver ? 'document.archive' : 'document.desarchive', objetType: 'Document', objetId: d.id, commentaire: d.titre, ip },
      log,
    );
  }
  return vises.length;
}
