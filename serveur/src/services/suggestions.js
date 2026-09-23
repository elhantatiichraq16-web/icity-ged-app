/**
 * Le classement propose, l'utilisateur dispose (§7).
 *
 * Ce service lit le texte des documents, en tire une référence, un client et
 * un type, puis enregistre des SUGGESTIONS. Rien n'est écrit sur le document
 * tant que personne ne les a acceptées — et un champ corrigé à la main est
 * verrouillé : le classement ne le proposera plus.
 */
import { extraireLot, memeAffaire, memeNumeroEtAnnee, normaliserReference } from '@icity/commun/marches';
import { db } from '../db.js';
import { analyser } from './classement.js';
import { recalculerPhase } from './phase-marche.js';

/** Les champs qu'un document peut se voir proposer. */
export const CHAMPS = ['marche', 'client', 'type', 'objet_technique'];

const estVerrouille = (document, champ) => Array.isArray(document.champsVerrouilles) && document.champsVerrouilles.includes(champ);

/**
 * Compare ce que dit le texte à ce que porte le document, et rend la liste
 * des propositions à enregistrer.
 */
export function proposerPour(document, { clients, marches, types }) {
  const lecture = analyser(document, clients);
  if (!lecture.lisible) return { lisible: false, propositions: [] };

  const propositions = [];

  // ── La référence, donc le marché ──
  if (lecture.reference && !estVerrouille(document, 'marche')) {
    const lue = lecture.reference.reference;
    // D'abord la correspondance sûre, puis le rapprochement par numéro et
    // année — utile quand le registre porte « 639/2022 », tiré d'un nom de
    // dossier, et la pièce « 639/SAM/FRA/2022 ».
    //
    // Le lot compte : « 23B/2017/TGR » et « 23A/2017/TGR » sont deux contrats.
    // La normalisation du §5 efface la lettre de lot — elle sert à rapprocher
    // deux LECTURES d'une même référence, pas deux lots. On l'exige donc
    // identique quand la pièce la porte.
    const lotLu = extraireLot(lue);
    const memeLot = (m) => (lotLu ? m.lot === lotLu : !m.lot || !lotLu);
    const memeRacine = (m) => memeAffaire(m.referenceNormalisee.split('#')[0], lue) || memeAffaire(m.reference, lue);
    const sur = marches.find((m) => memeRacine(m) && memeLot(m)) ?? (lotLu ? null : marches.find(memeRacine));
    const approchant = sur ?? marches.find((m) => memeNumeroEtAnnee(m.reference, lue) && memeLot(m));
    const marche = approchant;
    const dejaBon = marche && marche.id === document.marcheId;
    if (!dejaBon) {
      propositions.push({
        champ: 'marche',
        valeur: marche ? marche.reference : lue,
        cibleId: marche?.id ?? null,
        // Une référence citée dix fois est plus sûre qu'une citée une fois ;
        // un simple rapprochement de numéro l'est moins qu'une égalité.
        confiance: Math.min(95, 55 + lecture.reference.citations * 10) - (sur ? 0 : 20),
        raison: sur
          ? `« ${lue} » lu ${lecture.reference.citations} fois dans le texte — correspond au marché ${sur.reference}`
          : marche
            ? `« ${lue} » lu ${lecture.reference.citations} fois — même numéro et même année que le marché ${marche.reference}, à confirmer`
            : `« ${lue} » lu ${lecture.reference.citations} fois — aucun marché ne porte cette référence : il reste à créer`,
      });
    }
  }

  // ── Le client ──
  if (lecture.client && lecture.client.id !== document.clientId && !estVerrouille(document, 'client')) {
    propositions.push({
      champ: 'client',
      valeur: lecture.client.nom,
      cibleId: lecture.client.id,
      confiance: lecture.client.interne ? 40 : 80,
      raison: `« ${lecture.motifClient} » trouvé dans le texte`,
    });
  }

  // ── Le type de pièce ──
  if (lecture.type && !estVerrouille(document, 'type')) {
    const type = types.find((t) => t.code === lecture.type.code);
    if (type && type.id !== document.typeDocumentId) {
      propositions.push({
        champ: 'type',
        valeur: type.nom,
        cibleId: type.id,
        confiance: lecture.type.raison.includes('en-tête') ? 85 : 65,
        raison: lecture.type.raison,
      });
    }
  }

  // ── L'objet technique ──
  if (lecture.objetTechnique && lecture.objetTechnique !== document.objetTechnique && !estVerrouille(document, 'objet_technique')) {
    propositions.push({ champ: 'objet_technique', valeur: lecture.objetTechnique, cibleId: null, confiance: 70, raison: 'vocabulaire technique reconnu' });
  }

  return { lisible: true, propositions, lecture };
}

/** Les référentiels dont le classement a besoin, lus une seule fois. */
export async function chargerReferentiels() {
  const [clients, marches, types] = await Promise.all([
    db.client.findMany({ orderBy: [{ interne: 'asc' }, { nom: 'asc' }] }),
    db.marche.findMany({ select: { id: true, reference: true, referenceNormalisee: true, lot: true } }),
    db.typeDocument.findMany(),
  ]);
  return { clients, marches, types };
}

/**
 * Enregistre les propositions d'un document (une par champ : la nouvelle
 * remplace l'ancienne tant qu'elle n'a pas été tranchée).
 */
export async function enregistrerPropositions(documentId, propositions) {
  for (const p of propositions) {
    await db.suggestion.upsert({
      where: { documentId_champ: { documentId, champ: p.champ } },
      update: { ...p, statut: 'en_attente', decideePar: null, decideeLe: null },
      create: { documentId, ...p },
    });
  }
  return propositions.length;
}

/**
 * Applique une suggestion au document, et verrouille le champ : ce qui a été
 * tranché par un humain ne doit plus être écrasé par le classement (§7).
 *
 * @param {object} suggestion
 * @param {number} utilisateurId
 */
export async function accepter(suggestion, utilisateurId) {
  const document = await db.document.findUniqueOrThrow({ where: { id: suggestion.documentId } });
  const data = {};
  let marcheTouche = document.marcheId;

  if (suggestion.champ === 'marche') {
    let marcheId = suggestion.cibleId;
    if (!marcheId) {
      // Le marché n'existe pas encore : l'attestation prouve l'affaire, on la
      // déclare (logique de declarer-affaires.py).
      const cle = normaliserReference(suggestion.valeur) || suggestion.valeur;
      const cree = await db.marche.upsert({
        where: { referenceNormalisee: cle },
        update: {},
        create: { reference: suggestion.valeur, referenceNormalisee: cle, clientId: document.clientId ?? null },
      });
      marcheId = cree.id;
      // Ce marché n'a pas de contrat au fonds : c'est ce qu'il reste à retrouver.
      const etiquette = await db.etiquette.findUnique({ where: { nom: 'Contrat manquant' } });
      if (etiquette) await db.documentEtiquette.createMany({ data: [{ documentId: document.id, etiquetteId: etiquette.id }], skipDuplicates: true });
    }
    data.marcheId = marcheId;
    marcheTouche = marcheId;
  } else if (suggestion.champ === 'client') {
    data.clientId = suggestion.cibleId;
  } else if (suggestion.champ === 'type') {
    data.typeDocumentId = suggestion.cibleId;
    data.statutClassement = 'classe';
  } else if (suggestion.champ === 'objet_technique') {
    data.objetTechnique = suggestion.valeur;
  }

  const verrous = new Set(Array.isArray(document.champsVerrouilles) ? document.champsVerrouilles : []);
  verrous.add(suggestion.champ);
  data.champsVerrouilles = [...verrous];

  await db.document.update({ where: { id: document.id }, data });
  await db.suggestion.update({ where: { id: suggestion.id }, data: { statut: 'acceptee', decideePar: utilisateurId, decideeLe: new Date() } });

  // Une pièce du cycle qui change de marché ou de type change la phase des
  // deux marchés concernés.
  if (document.marcheId && document.marcheId !== marcheTouche) await recalculerPhase(document.marcheId);
  if (marcheTouche) await recalculerPhase(marcheTouche);

  return data;
}

/** Refuse une suggestion : elle ne reviendra pas, et le champ est verrouillé. */
export async function refuser(suggestion, utilisateurId) {
  const document = await db.document.findUniqueOrThrow({ where: { id: suggestion.documentId } });
  const verrous = new Set(Array.isArray(document.champsVerrouilles) ? document.champsVerrouilles : []);
  verrous.add(suggestion.champ);
  await db.document.update({ where: { id: document.id }, data: { champsVerrouilles: [...verrous] } });
  await db.suggestion.update({ where: { id: suggestion.id }, data: { statut: 'refusee', decideePar: utilisateurId, decideeLe: new Date() } });
}
