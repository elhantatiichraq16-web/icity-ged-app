/**
 * Les modèles de mails, comme ceux d'Odoo : un objet et un message dont les
 * blancs ({client}, {marche}, {fournisseur}…) se remplissent au moment
 * d'écrire. Partagé par le serveur (validation) et les écrans (remplissage).
 */
import { z } from 'zod';

/** Les blancs qu'un modèle peut contenir, et ce qu'ils deviennent. */
export const VARIABLES_MODELES = [
  { cle: 'client', nom: 'le nom du client' },
  { cle: 'marche', nom: 'la référence du marché' },
  { cle: 'objet_marche', nom: 'l’objet du marché' },
  { cle: 'fournisseur', nom: 'le nom du fournisseur' },
  { cle: 'contact', nom: 'la personne à joindre' },
  { cle: 'numero_commande', nom: 'le numéro du bon de commande' },
  { cle: 'montant', nom: 'le montant de la commande' },
  { cle: 'mon_nom', nom: 'votre nom' },
  { cle: 'date', nom: 'la date du jour' },
];

export const USAGES_MODELES = [
  { code: 'client', nom: 'Mails aux clients' },
  { code: 'fournisseur', nom: 'Mails aux fournisseurs' },
  { code: 'tous', nom: 'Partout' },
];

/**
 * Remplit les blancs d'un modèle. Un blanc sans valeur reste visible
 * (« {montant} ») : on le voit, et on le complète à la main avant d'envoyer.
 *
 * @param {string} texte
 * @param {Record<string, string | null | undefined>} valeurs
 */
export function remplirModele(texte, valeurs) {
  return String(texte ?? '').replace(/\{([a-z_]+)\}/g, (tout, cle) => {
    const v = valeurs[cle];
    return v === null || v === undefined || v === '' ? tout : String(v);
  });
}

export const schemaModeleMail = z.object({
  nom: z.string({ error: 'Nommez le modèle.' }).trim().min(2, { error: 'Au moins 2 caractères.' }).max(120, { error: '120 caractères au plus.' }),
  usage: z.enum(USAGES_MODELES.map((u) => u.code), { error: 'Choisissez où le proposer.' }),
  objet: z.string({ error: 'Écrivez l’objet.' }).trim().min(2, { error: 'Écrivez l’objet.' }).max(255),
  corps: z.string({ error: 'Écrivez le message.' }).trim().min(2, { error: 'Écrivez le message.' }).max(10_000),
});
