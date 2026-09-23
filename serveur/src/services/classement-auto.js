/**
 * Le classement appliqué au versement (§7).
 *
 * Les règles de lecture vivent dans `classement.js` ; ici on décide quoi en
 * faire. Auparavant elles produisaient des suggestions qu'un écran faisait
 * valider ; désormais le classement s'écrit directement sur la pièce.
 *
 * Deux garde-fous tiennent ce choix :
 *
 *  - **On ne remplace jamais ce qui est déjà renseigné.** Un rattachement fait
 *    à la main est un jugement humain : la machine ne le contredit pas. Seuls
 *    les champs vides sont remplis.
 *  - **On n'écrit que ce dont on est sûr.** Une référence citée une seule fois
 *    peut être un renvoi ; un marché introuvable au référentiel ne se crée
 *    pas. Dans le doute, on laisse vide plutôt que de classer de travers —
 *    une pièce non classée se voit, une pièce mal classée se perd.
 */
import { db } from '../db.js';
import { analyser } from './classement.js';
import { journaliser } from './journal.js';
import { recalculerPhase } from './phase-marche.js';

/** En dessous, une référence citée une fois peut n'être qu'un renvoi. */
const CITATIONS_MINIMALES = 1;

/** Les référentiels dont la lecture a besoin, chargés une fois par lot. */
export async function chargerReferentiels() {
  const [clients, marches, types] = await Promise.all([
    db.client.findMany({ orderBy: [{ interne: 'asc' }, { nom: 'asc' }] }),
    db.marche.findMany({ select: { id: true, reference: true, referenceNormalisee: true, clientId: true } }),
    db.typeDocument.findMany({ select: { id: true, code: true } }),
  ]);
  return { clients, marches, types };
}

/** Deux références désignent le même marché si leur forme normalisée coïncide. */
function memeReference(a, b) {
  const plat = (t) =>
    String(t ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  return plat(a) === plat(b);
}

/**
 * Classe une pièce d'après son texte, et écrit ce qui est sûr.
 *
 * @param {object} document une ligne de la table Document
 * @param {{ clients: object[], marches: object[], types: object[] }} referentiels
 * @param {{ requete?: object, log?: object }} options
 * @returns {Promise<{ classe: boolean, motif?: string, ecrits: string[] }>}
 */
export async function classerDocument(document, referentiels, { requete, log = console } = {}) {
  const lecture = analyser(document, referentiels.clients);
  if (!lecture.lisible) {
    // Trop peu de texte pour juger : ce n'est pas un échec, c'est une pièce
    // qui attend son OCR ou qui n'en portera jamais.
    return { classe: false, motif: 'texte insuffisant', ecrits: [] };
  }

  const aEcrire = {};
  const ecrits = [];

  // ── Le marché ──
  if (!document.marcheId && lecture.reference && lecture.reference.citations > CITATIONS_MINIMALES) {
    const marche = referentiels.marches.find(
      (m) => memeReference(m.reference, lecture.reference.reference) || memeReference(m.referenceNormalisee, lecture.reference.reference),
    );
    // Une référence absente du référentiel ne crée pas de marché : elle
    // viendrait d'un renvoi à un autre dossier, ou d'une lecture fautive.
    if (marche) {
      aEcrire.marcheId = marche.id;
      ecrits.push('marché');
      // Le client suit le marché : c'est plus sûr que de le deviner du texte.
      if (!document.clientId && marche.clientId) {
        aEcrire.clientId = marche.clientId;
        ecrits.push('client (du marché)');
      }
    }
  }

  // ── Le client, si le marché ne l'a pas donné ──
  if (!document.clientId && !aEcrire.clientId && lecture.client) {
    aEcrire.clientId = lecture.client.id;
    ecrits.push('client');
  }

  // ── Le type ──
  if (!document.typeDocumentId && lecture.type) {
    const type = referentiels.types.find((t) => t.code === lecture.type.code);
    if (type) {
      aEcrire.typeDocumentId = type.id;
      ecrits.push('type');
    }
  }

  // ── L'objet technique ──
  if (!document.objetTechnique && lecture.objetTechnique) {
    aEcrire.objetTechnique = lecture.objetTechnique;
    ecrits.push('objet');
  }

  if (!ecrits.length) return { classe: false, motif: 'rien de sûr à écrire', ecrits: [] };

  // `statutClassement` dit que la machine est passée : une pièce qu'elle n'a
  // pas su classer reste « en_attente », et se retrouve par ce filtre.
  await db.document.update({
    where: { id: document.id },
    data: { ...aEcrire, statutClassement: aEcrire.marcheId || aEcrire.typeDocumentId ? 'classe' : 'partiel' },
  });

  // La phase d'un marché se déduit de ses pièces : elle change dès qu'une
  // pièce du cycle le rejoint.
  if (aEcrire.marcheId) await recalculerPhase(aEcrire.marcheId);

  // Une trace, parce que le classement n'est plus validé par personne : c'est
  // ce qu'on relira si une pièce se retrouve au mauvais endroit.
  if (requete?.utilisateur) {
    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'document.classe_auto',
        objetType: 'Document',
        objetId: document.id,
        apres: { ...aEcrire, lu: ecrits },
        ip: requete.ip,
      },
      log,
    ).catch(() => {});
  }

  return { classe: true, ecrits };
}

/**
 * Passe tout le fonds au classement : les pièces que rien ne rattache encore.
 *
 * Sert après un import, ou quand un marché absent du référentiel vient d'y
 * être ajouté — les pièces qui le citaient peuvent alors le rejoindre.
 *
 * @param {{ limite?: number, log?: object }} options
 */
export async function classerLeFonds({ limite = 500, log = console } = {}) {
  const referentiels = await chargerReferentiels();

  const aClasser = await db.document.findMany({
    where: {
      supprimeLe: null,
      texteOcr: { not: null },
      // Ce qui a déjà tout n'a rien à gagner d'un nouveau passage.
      OR: [{ marcheId: null }, { typeDocumentId: null }, { clientId: null }],
    },
    orderBy: { creeLe: 'desc' },
    take: limite,
  });

  const bilan = { lus: aClasser.length, classes: 0, laisses: 0 };
  for (const document of aClasser) {
    const r = await classerDocument(document, referentiels, { log });
    if (r.classe) bilan.classes += 1;
    else bilan.laisses += 1;
  }

  if (bilan.classes) log.log?.(`Classement : ${bilan.classes} pièce(s) rattachée(s) sur ${bilan.lus} lue(s).`);
  return bilan;
}
