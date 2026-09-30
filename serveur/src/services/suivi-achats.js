/**
 * Le suivi des commandes par leurs pièces.
 *
 * Ce qui se notait à la main dans le classeur des achats se déduit ici des
 * pièces du fournisseur :
 *  - le bon de commande fait partir les lignes (« Commande envoyée ») et date
 *    leur livraison d'après le délai du fournisseur ;
 *  - le bon de livraison les passe en « Livré » ;
 *  - la facture donne le montant et la date, d'où l'échéance du paiement.
 *
 * On ne remplace jamais ce qui a été saisi : une date de livraison donnée
 * par le fournisseur, un montant corrigé à la main, un statut déjà plus loin.
 */
import { livraisonPrevue, lireFacture, STATUTS_AVANT_ENVOI } from '@icity/commun/achats';
import { db } from '../db.js';
import { journaliser } from './journal.js';

const jour = (d) => (d ? d.toISOString().slice(0, 10) : null);
const versDate = (iso) => new Date(`${iso}T00:00:00Z`);

/**
 * Date la livraison des lignes d'une commande qui n'en ont pas encore : la
 * date de commande — ou du paiement de l'avance, si le délai en dépend —
 * plus le délai du fournisseur.
 *
 * @returns {Promise<number>} le nombre de lignes datées
 */
export async function daterLivraisons(commandeId) {
  const commande = await db.commandeFournisseur.findUnique({
    where: { id: commandeId },
    include: { lignes: { where: { etd: null, statut: { not: 'livre' } } } },
  });
  if (!commande) return 0;
  let datees = 0;
  for (const l of commande.lignes) {
    const etd = livraisonPrevue({ delaiLivraison: l.delaiLivraison, dateCommande: jour(commande.dateCommande), avancePayeeLe: jour(commande.avancePayeeLe) });
    if (!etd) continue;
    await db.ligneAchat.update({ where: { id: l.id }, data: { etd: versDate(etd) } });
    datees += 1;
  }
  return datees;
}

/**
 * Reporte sur la commande ce qu'on lit sur sa facture — le montant TTC et la
 * date — s'ils sont encore vides. Un scan sans texte attend l'OCR : le worker
 * le fera repasser ici.
 *
 * @returns {Promise<{ montantTtc: number|null, dateFacture: string|null, numero: string|null, reportes: string[] } | null>}
 *   null quand la pièce n'a pas encore de texte
 */
export async function reporterFacture(commandeId, document) {
  if (!document.texteOcr) return null;
  const lu = lireFacture(document.texteOcr);
  const commande = await db.commandeFournisseur.findUnique({ where: { id: commandeId } });
  if (!commande) return null;
  const data = {};
  if (lu.montantTtc && commande.montantTtc === null) data.montantTtc = lu.montantTtc;
  if (lu.dateFacture && !commande.dateFacture) data.dateFacture = versDate(lu.dateFacture);
  if (Object.keys(data).length) await db.commandeFournisseur.update({ where: { id: commandeId }, data });
  return { ...lu, reportes: Object.keys(data) };
}

/**
 * Ce que fait le dépôt d'une pièce de fournisseur sur sa commande.
 *
 * @param {object} p
 * @param {object} p.commande   la commande, telle qu'en base
 * @param {'BCF'|'BLF'|'FACF'} p.type
 * @param {string} p.date       la date de la pièce (AAAA-MM-JJ)
 * @param {number[]} [p.lignes] pour une livraison partielle : les lignes reçues
 * @param {object} p.document   la pièce versée
 * @param {number} p.utilisateurId
 */
export async function appliquerPiece({ commande, type, date, lignes, document, utilisateurId }) {
  const effets = { envoyees: 0, livrees: 0, datees: 0, facture: null };
  const suivi = { statutModifieLe: new Date(), statutModifieParId: utilisateurId };

  if (type === 'BCF') {
    // La première commande envoyée fait foi : un bon de commande révisé ne
    // repousse pas les livraisons déjà datées.
    if (!commande.dateCommande) await db.commandeFournisseur.update({ where: { id: commande.id }, data: { dateCommande: versDate(date) } });
    const envoyees = await db.ligneAchat.updateMany({
      where: { commandeId: commande.id, statut: { in: STATUTS_AVANT_ENVOI } },
      data: { statut: 'commande_envoyee', ...suivi },
    });
    effets.envoyees = envoyees.count;
    effets.datees = await daterLivraisons(commande.id);
  }

  if (type === 'BLF') {
    const livrees = await db.ligneAchat.updateMany({
      where: { commandeId: commande.id, statut: { not: 'livre' }, ...(lignes?.length ? { id: { in: lignes } } : {}) },
      data: { statut: 'livre', ...suivi },
    });
    effets.livrees = livrees.count;
  }

  if (type === 'FACF') effets.facture = await reporterFacture(commande.id, document);

  return effets;
}

/**
 * Après l'OCR : les factures de fournisseur qui viennent d'être lues
 * reportent leur montant et leur date sur leur commande.
 *
 * @param {number[]} ids les documents qui ont désormais du texte
 * @returns {Promise<number>} le nombre de commandes complétées
 */
export async function lireFacturesApresOcr(ids, { log = console } = {}) {
  if (!ids.length) return 0;
  const factures = await db.document.findMany({
    where: { id: { in: ids }, supprimeLe: null, commandeFournisseurId: { not: null }, typeDocument: { code: 'FACF' } },
  });
  let completees = 0;
  for (const d of factures) {
    const lu = await reporterFacture(d.commandeFournisseurId, d);
    if (!lu?.reportes.length) continue;
    completees += 1;
    await journaliser(
      {
        action: 'commande.facture_lue',
        objetType: 'CommandeFournisseur',
        objetId: d.commandeFournisseurId,
        apres: { montantTtc: lu.montantTtc, dateFacture: lu.dateFacture, numero: lu.numero, reportes: lu.reportes },
        commentaire: `Lu sur la facture scannée (document ${d.id})`,
      },
      log,
    );
  }
  return completees;
}
