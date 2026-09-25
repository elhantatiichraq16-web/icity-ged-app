/**
 * Les attestations de référence et les marchés qu'elles prouvent.
 *
 * Le maître d'ouvrage ne délivre une attestation de référence qu'une fois le
 * travail fait et reçu : un marché qui en porte une a été gagné, puis
 * exécuté jusqu'au bout. C'est la règle métier d'iCity.
 *
 * Or beaucoup d'attestations citent des marchés anciens dont le dossier n'a
 * jamais été numérisé : sans rien faire, elles resteraient orphelines, et la
 * référence — ce qu'on met en avant dans un nouvel appel d'offres — serait
 * perdue. Le marché est donc déclaré d'après l'attestation, gagné et clos.
 *
 * Une attestation dont on ne lit pas le numéro de marché reste à part, sans
 * marché. Elle le rejoindra quand un meilleur OCR le rendra lisible : le
 * classement repasse après chaque lecture et appelle ce service.
 *
 * Une référence citée une seule fois suffit ici, alors que le classement
 * général en exige deux : une attestation ne cite en principe que le marché
 * qu'elle atteste.
 */
import { extraireLot, memeAffaire, normaliserReference } from '@icity/commun/marches';
import { db } from '../db.js';
import { referencePrincipale } from './classement.js';
import { journaliser } from './journal.js';
import { recalculerPhase } from './phase-marche.js';

/** L'identifiant le plus fréquent d'une liste, ou null. */
function majorite(ids) {
  const comptes = new Map();
  for (const id of ids) comptes.set(id, (comptes.get(id) ?? 0) + 1);
  return [...comptes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Rattache les attestations sans marché au marché qu'elles citent, en le
 * déclarant s'il n'existe pas encore.
 *
 * @param {{ appliquer?: boolean, ids?: number[], utilisateurId?: number | null, log?: object }} options
 *   `appliquer: false` ne fait que décrire ce qui serait fait (simulation) ;
 *   `ids` limite le travail à ces attestations.
 * @returns {Promise<{ declares: object[], rejoints: object[], rattachees: number, illisibles: number }>}
 */
export async function rattacherAttestations({ appliquer = true, ids, utilisateurId = null, log = console } = {}) {
  const [attestations, marches, internes] = await Promise.all([
    db.document.findMany({
      where: { supprimeLe: null, marcheId: null, typeDocument: { code: 'ATT' }, ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, texteOcr: true, clientId: true },
      orderBy: { id: 'asc' },
    }),
    db.marche.findMany({ select: { id: true, reference: true, referenceNormalisee: true, clientId: true } }),
    db.client.findMany({ where: { interne: true }, select: { id: true } }),
  ]);
  const clientsInternes = new Set(internes.map((c) => c.id));

  // Les attestations regroupées par marché cité : trois attestations du même
  // marché ne déclarent qu'un marché.
  const groupes = new Map();
  let illisibles = 0;
  for (const a of attestations) {
    const lu = referencePrincipale(a.texteOcr ?? '');
    // Un lot ne se retient que s'il est écrit en lettre (« 23C/2017/TGR ») :
    // dans « 020/CAS/08 » ou « 027/NDR/16 », le dernier chiffre appartient au
    // numéro. `extraireLot` le prendrait pour un lot mal lu par l'OCR.
    const lot = lu && /^\d+[A-Z]\//i.test(lu.reference) ? extraireLot(lu.reference) : null;
    const cle = lu ? normaliserReference(lu.reference) + (lot ? `#${lot}` : '') : '';
    if (!cle) {
      illisibles += 1;
      continue;
    }
    const groupe = groupes.get(cle) ?? { cle, lot, lectures: new Map(), attestations: [] };
    groupe.lectures.set(lu.reference, (groupe.lectures.get(lu.reference) ?? 0) + 1);
    groupe.attestations.push(a);
    groupes.set(cle, groupe);
  }

  const bilan = { declares: [], rejoints: [], rattachees: 0, illisibles };

  for (const g of groupes.values()) {
    // L'écriture la plus lue sert de référence affichée.
    const reference = [...g.lectures].sort((a, b) => b[1] - a[1])[0][0];
    let marche = marches.find((m) => m.referenceNormalisee === g.cle || memeAffaire(m.reference, reference));
    // Le client : celui que la lecture a reconnu sur ces attestations, jamais
    // la société elle-même (elle signe, elle n'atteste pas).
    const clientId = marche?.clientId ?? majorite(g.attestations.map((a) => a.clientId).filter((id) => id && !clientsInternes.has(id)));
    const ligne = { reference, cle: g.cle, clientId, attestations: g.attestations.length };

    (marche ? bilan.rejoints : bilan.declares).push(ligne);
    bilan.rattachees += g.attestations.length;
    if (!appliquer) continue;

    const idsAttestations = g.attestations.map((a) => a.id);
    if (!marche) {
      marche = await db.marche.create({
        data: { reference, referenceNormalisee: g.cle, variantes: [...g.lectures.keys()], lot: g.lot, clientId, statutAffaire: 'Gagné' },
      });
      marches.push(marche);
      await journaliser(
        { utilisateurId, action: 'marche.declare_par_attestation', objetType: 'Marche', objetId: marche.id, apres: { reference, attestations: idsAttestations } },
        log,
      ).catch(() => {});
    }

    await db.document.updateMany({ where: { id: { in: idsAttestations } }, data: { marcheId: marche.id, statutClassement: 'classe' } });
    if (marche.clientId) {
      await db.document.updateMany({ where: { id: { in: idsAttestations }, clientId: null }, data: { clientId: marche.clientId } });
    }
    // L'attestation clôt le marché (commun/marches.js, phaseDe).
    await recalculerPhase(marche.id);
  }

  return bilan;
}
