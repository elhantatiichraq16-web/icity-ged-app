/**
 * Importer le classeur des achats d'un projet dans un marché, pour ne rien
 * retaper : la feuille « ÉTAT DES ACHATS » devient les lignes d'achat, la
 * dernière feuille « PAIEMENT » devient les commandes et leurs paiements.
 *
 * Les colonnes se reconnaissent à leur titre, pas à leur place : une colonne
 * ajoutée ou déplacée ne décale rien. Un import relancé met à jour les lignes
 * déjà importées (même numéro dans le même marché) au lieu de les doubler.
 * Rien de ce qui se calcule n'est repris : un total tapé qui ne tombe pas
 * juste est signalé, pas recopié.
 */
import { fournisseurDuNom, marge, pourcent, total } from '@icity/commun/achats';
import { db } from '../db.js';
import { decouperReference, ErreurClasseur, lireClasseur } from './lecture-xlsx.js';

const plat = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Les colonnes de la feuille des achats, reconnues à leur titre. */
const COLONNES_ACHATS = {
  numero: (t) => /^N[°O]?\.?$/.test(t),
  categorie: (t) => t.startsWith('CATEGORIE'),
  designation: (t) => t.startsWith('MATERIEL') || t.startsWith('DESIGNATION'),
  quantite: (t) => t.startsWith('QTE') || t.startsWith('QUANTITE'),
  puBudget: (t) => t.startsWith('P.U. AO') || t.startsWith('PU AO'),
  marque: (t) => t.startsWith('MARQUE'),
  referenceOffre: (t) => t.startsWith('REFERENCE') && t.includes('OFFRE'),
  referenceAchat: (t) => t.startsWith('REFERENCE ACHAT'),
  puAchat: (t) => t.startsWith('P.U. ACHAT') || t.startsWith('PU ACHAT'),
  ptAchat: (t) => t.startsWith('P.T. ACHAT') || t.startsWith('PT ACHAT'),
  puVente: (t) => t.startsWith('P.U. VENTE') || t.startsWith('PU VENTE'),
  conditionsPaiement: (t) => t.startsWith('CONDITIONS'),
  delaiLivraison: (t) => t.startsWith('DELAI'),
  fournisseur: (t) => t.startsWith('FOURNISSEUR'),
  statut: (t) => t.startsWith('STATUT'),
  etd: (t) => t.startsWith('ETD') || t.startsWith('COMMENTAIRE'),
};

/** Les colonnes de la feuille des paiements. */
const COLONNES_PAIEMENTS = {
  numero: (t) => /^N[°O]?\.?$/.test(t),
  fournisseur: (t) => t.startsWith('FOURNISSEUR'),
  montant: (t) => t.startsWith('MONTANT'),
  avance: (t) => t.startsWith('AVANCE'),
  modalite: (t) => t.startsWith('MODALITE'),
  dateFacture: (t) => t.startsWith('DATE FACTURE') || t === 'DATE DE FACTURE',
};

/** Les statuts du classeur (feuille « Légende ») et leur code. */
const STATUTS = {
  'COMMANDE ENVOYEE': 'commande_envoyee',
  'COMMANDE PREPAREE': 'commande_preparee',
  'EN ATTENTE VALIDATION': 'attente_validation',
  'ATTENTE VALIDATION': 'attente_validation',
  'ATTENTE VALIDATION REF': 'attente_validation_ref',
  'EN ATTENTE VALIDATION REF': 'attente_validation_ref',
  DISPONIBLE: 'disponible',
  'EN COURS': 'en_cours',
  'EN ATTENTE': 'en_attente',
  LIVRE: 'livre',
  LIVREE: 'livre',
  'EN STOCK': 'livre',
};
const SANS_VALEUR = new Set(['', '-', 'A DEFINIR', 'A DETERMINER', 'A CONFIRMER', 'EN ETUDE', 'N/A']);

/** Les cellules rangées par ligne : Map(n° de ligne → Map(colonne → cellule)). */
function parLigne(feuille) {
  const lignes = new Map();
  for (const [ref, cellule] of feuille.cellules) {
    const r = decouperReference(ref);
    if (!r) continue;
    if (!lignes.has(r.ligne)) lignes.set(r.ligne, new Map());
    lignes.get(r.ligne).set(r.colonne, cellule);
  }
  return new Map([...lignes].sort(([a], [b]) => a - b));
}

/** La ligne de titres et la colonne de chaque champ, ou null si la feuille ne s'y prête pas. */
function trouverEntete(lignes, colonnes, obligatoires) {
  for (const [numero, cellules] of lignes) {
    const trouvees = {};
    for (const [colonne, cellule] of cellules) {
      const titre = plat(cellule.valeur);
      for (const [champ, correspond] of Object.entries(colonnes)) {
        if (!trouvees[champ] && correspond(titre)) trouvees[champ] = colonne;
      }
    }
    if (obligatoires.every((c) => trouvees[c])) return { ligne: numero, colonnes: trouvees };
  }
  return null;
}

const texteDe = (cellule) => (cellule ? String(cellule.valeur).replace(/\s+/g, ' ').trim() || null : null);
const nombreDe = (cellule) => {
  if (!cellule) return null;
  if (cellule.type === 'n') return cellule.valeur;
  const n = Number(String(cellule.valeur).replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
};
/** « 18/05/2026 » → « 2026-05-18 » ; une cellule date passe telle quelle. */
function dateDe(cellule) {
  if (!cellule) return null;
  if (cellule.type === 'd') return cellule.valeur;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(cellule.valeur).trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
const numeroDe = (cellule) => {
  const n = nombreDe(cellule);
  if (n !== null && Number.isInteger(n)) return String(n);
  const t = texteDe(cellule);
  return t && /^\d{1,4}[A-Z]?$/i.test(t) ? t : null;
};

/** 62 jours → effet à 60 jours. */
const effetLePlusProche = (jours) => `effet_${[30, 60, 90].reduce((a, b) => (Math.abs(b - jours) < Math.abs(a - jours) ? b : a))}`;
const joursEntre = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);

/** « EFFET A 60 JOURS », « Virement », « Effet avec une date de 10/09/2026 »… */
function lireModalite(texte, dateFacture) {
  const t = plat(texte);
  const jours = /(\d+)\s*JOURS?/.exec(t)?.[1];
  const dateEcrite = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texte ?? '');
  if (t.includes('EFFET') || t.includes('TRAITE')) {
    if (jours) return { modalite: effetLePlusProche(Number(jours)), echeance: null, reconnue: true };
    if (dateEcrite) {
      const echeance = `${dateEcrite[3]}-${dateEcrite[2].padStart(2, '0')}-${dateEcrite[1].padStart(2, '0')}`;
      return { modalite: dateFacture ? effetLePlusProche(joursEntre(dateFacture, echeance)) : 'effet_60', echeance, reconnue: true };
    }
    return { modalite: 'effet_60', echeance: null, reconnue: false };
  }
  if (t.includes('VIREMENT')) return { modalite: 'virement', echeance: null, reconnue: true };
  if (t.includes('CHEQUE')) return { modalite: 'cheque', echeance: null, reconnue: true };
  if (t.includes('COMPTANT') || t.includes('ESPECE')) return { modalite: 'comptant', echeance: null, reconnue: true };
  return { modalite: 'virement', echeance: null, reconnue: false };
}

/** Les lignes couvertes par une cellule : sa plage fusionnée, ou elle seule. */
function lignesCouvertes(feuille, colonne, ligne) {
  for (const plage of feuille.fusions) {
    const [debut, fin] = plage.split(':').map(decouperReference);
    if (debut && fin && debut.colonne === colonne && debut.ligne === ligne) return [debut.ligne, fin.ligne];
  }
  return [ligne, ligne];
}

/**
 * @param {Buffer} tampon  le fichier .xlsx
 * @param {{ marcheId: number, utilisateurId: number }} options
 */
export async function importerClasseurAchats(tampon, { marcheId, utilisateurId }) {
  const feuilles = lireClasseur(tampon);

  // La feuille des achats : celle qui a les colonnes « Matériel » et « Qté »,
  // de préférence celle qui s'appelle « État des achats ».
  const candidates = feuilles
    .map((f) => ({ feuille: f, lignes: parLigne(f) }))
    .map((c) => ({ ...c, entete: trouverEntete(c.lignes, COLONNES_ACHATS, ['designation', 'quantite']) }))
    .filter((c) => c.entete);
  const achats = candidates.find((c) => plat(c.feuille.nom).includes('ETAT DES ACHATS')) ?? candidates[0];
  if (!achats) throw new ErreurClasseur('Aucune feuille n’a les colonnes « Matériel / Description » et « Qté ».');

  const remarques = [];
  const lus = [];
  const { colonnes } = achats.entete;
  for (const [numeroLigne, cellules] of achats.lignes) {
    if (numeroLigne <= achats.entete.ligne) continue;
    const cellule = (champ) => (colonnes[champ] ? cellules.get(colonnes[champ]) : undefined);
    const designation = texteDe(cellule('designation'));
    const premiere = plat(texteDe([...cellules.values()][0]));
    if (!designation || premiere.startsWith('TOTAUX')) continue;

    const numero = numeroDe(cellule('numero'));
    const repere = numero ? `Ligne ${numero}` : `Rangée ${numeroLigne}`;
    let quantite = nombreDe(cellule('quantite'));
    if (!quantite || quantite <= 0) {
      remarques.push(`${repere} : quantité absente, comptée pour 1.`);
      quantite = 1;
    }
    const puAchat = nombreDe(cellule('puAchat'));
    const puVente = nombreDe(cellule('puVente'));

    // Un total tapé à la main qui ne tombe pas juste : on le signale, on ne le reprend pas.
    const ptTape = nombreDe(cellule('ptAchat'));
    const ptCalcule = total(puAchat, quantite);
    if (ptTape !== null && ptCalcule !== null && Math.abs(ptTape - ptCalcule) > 1) {
      remarques.push(`${repere} : le total d’achat du fichier (${ptTape.toLocaleString('fr-FR')}) ne vaut pas ${quantite} × ${puAchat.toLocaleString('fr-FR')} ; l’application retient ${ptCalcule.toLocaleString('fr-FR')}.`);
    }
    const m = marge(puAchat, puVente);
    if (m !== null && m < 0) remarques.push(`${repere} : vendue moins cher qu’achetée (marge de ${pourcent(m)}).`);

    let commentaire = null;
    let etd = dateDe(cellule('etd'));
    if (!etd) commentaire = texteDe(cellule('etd'));
    let referenceAchat = texteDe(cellule('referenceAchat'));
    if (referenceAchat && SANS_VALEUR.has(plat(referenceAchat))) {
      commentaire = [`Référence d’achat : ${referenceAchat.toLowerCase()}.`, commentaire].filter(Boolean).join(' ');
      referenceAchat = null;
    }

    const statutLu = texteDe(cellule('statut'));
    const statut = statutLu ? STATUTS[plat(statutLu).replace(/\./g, '')] : 'en_attente';
    if (statutLu && !statut) remarques.push(`${repere} : statut « ${statutLu} » inconnu, mis « En attente ».`);

    const fournisseur = texteDe(cellule('fournisseur'));
    lus.push({
      numero,
      categorie: texteDe(cellule('categorie')) ?? 'Sans catégorie',
      designation: designation.slice(0, 255),
      quantite,
      puBudget: nombreDe(cellule('puBudget')),
      puAchat,
      puVente,
      marque: texteDe(cellule('marque')),
      referenceOffre: texteDe(cellule('referenceOffre')),
      referenceAchat,
      fournisseur: fournisseur && !SANS_VALEUR.has(plat(fournisseur)) ? fournisseur : null,
      conditionsPaiement: texteDe(cellule('conditionsPaiement'))?.slice(0, 160) ?? null,
      delaiLivraison: texteDe(cellule('delaiLivraison'))?.slice(0, 120) ?? null,
      statut: statut ?? 'en_attente',
      etd,
      commentaire,
    });
  }
  if (!lus.length) throw new ErreurClasseur('La feuille des achats ne contient aucune ligne de matériel.');

  // La feuille des paiements : la dernière dont le nom commence par « Paiement ».
  const paiements = [...feuilles]
    .reverse()
    .filter((f) => plat(f.nom).startsWith('PAIEMENT'))
    .map((f) => ({ feuille: f, lignes: parLigne(f) }))
    .map((c) => ({ ...c, entete: trouverEntete(c.lignes, COLONNES_PAIEMENTS, ['fournisseur', 'montant']) }))
    .find((c) => c.entete);

  const rapport = {
    feuilles: { achats: achats.feuille.nom, paiements: paiements?.feuille.nom ?? null },
    lignes: { creees: 0, misesAJour: 0 },
    fournisseursCrees: [],
    commandes: { creees: 0, misesAJour: 0 },
    livrees: [],
    remarques,
  };

  await db.$transaction(
    async (tx) => {
      // Les fournisseurs : retrouvés par leur nom ou l'une de leurs autres
      // écritures (« MEDITEN / CYBIONET » est CYBIONET), sans tenir compte des
      // majuscules ni des accents ; créés sinon.
      const connus = await tx.fournisseur.findMany({ select: { id: true, nom: true, synonymes: true } });
      async function fournisseurId(nom) {
        if (!nom) return null;
        const trouve = fournisseurDuNom(nom, connus);
        if (trouve) return trouve.id;
        const cree = await tx.fournisseur.create({ data: { nom: nom.slice(0, 160) } });
        connus.push({ id: cree.id, nom: cree.nom, synonymes: [] });
        rapport.fournisseursCrees.push(cree.nom);
        return cree.id;
      }

      const existantes = new Map((await tx.ligneAchat.findMany({ where: { marcheId, numero: { not: null } } })).map((l) => [l.numero, l]));
      const idsParNumero = new Map();
      for (const [ordre, { fournisseur, etd, ...champs }] of lus.entries()) {
        const data = { ...champs, etd: etd ? new Date(`${etd}T00:00:00Z`) : null, fournisseurId: await fournisseurId(fournisseur), ordre: ordre + 1 };
        const existante = champs.numero ? existantes.get(champs.numero) : null;
        const statutChange = !existante || existante.statut !== data.statut;
        const suivi = statutChange ? { statutModifieLe: new Date(), statutModifieParId: utilisateurId } : {};
        const ligne = existante
          ? await tx.ligneAchat.update({ where: { id: existante.id }, data: { ...data, ...suivi } })
          : await tx.ligneAchat.create({ data: { ...data, ...suivi, marcheId } });
        rapport.lignes[existante ? 'misesAJour' : 'creees'] += 1;
        if (ligne.numero) idsParNumero.set(ligne.numero, ligne.id);
      }

      if (!paiements) return;
      const { colonnes: c } = paiements.entete;
      let partie = 'commandes';
      for (const [numeroLigne, cellules] of paiements.lignes) {
        if (numeroLigne <= paiements.entete.ligne) continue;
        const premiere = plat(texteDe([...cellules.values()][0]));
        if (premiere.startsWith('TOTAUX')) partie = 'apres';
        if (premiere.startsWith('EQUIPEMENTS LIVRES') || premiere.startsWith('EQUIPEMENT LIVRE')) partie = 'livres';

        const numero = numeroDe(cellules.get(c.numero));
        if (partie === 'livres') {
          if (numero && idsParNumero.has(numero)) {
            await tx.ligneAchat.update({ where: { id: idsParNumero.get(numero) }, data: { statut: 'livre', statutModifieLe: new Date(), statutModifieParId: utilisateurId } });
            rapport.livrees.push(numero);
          }
          continue;
        }
        if (partie !== 'commandes') continue;

        const nomFournisseur = texteDe(cellules.get(c.fournisseur));
        const montant = nombreDe(cellules.get(c.montant));
        if (!nomFournisseur || !montant || montant <= 0 || SANS_VALEUR.has(plat(nomFournisseur))) continue;

        // Le bloc d'un fournisseur : la plage fusionnée de sa cellule.
        const [debut, fin] = lignesCouvertes(paiements.feuille, c.fournisseur, numeroLigne);
        const numeros = [];
        for (let r = debut; r <= fin; r++) {
          const n = numeroDe(paiements.lignes.get(r)?.get(c.numero));
          if (n && idsParNumero.has(n)) numeros.push(n);
        }
        const dateFacture = c.dateFacture ? dateDe(cellules.get(c.dateFacture)) : null;
        const texteModalite = c.modalite ? texteDe(cellules.get(c.modalite)) : null;
        const { modalite, echeance, reconnue } = lireModalite(texteModalite, dateFacture);
        if (texteModalite && !reconnue) remarques.push(`Paiement ${nomFournisseur} : modalité « ${texteModalite} » non reconnue, mise « ${modalite === 'virement' ? 'Virement' : 'Effet à 60 jours'} ».`);
        const avance = c.avance ? nombreDe(cellules.get(c.avance)) : null;
        const avancePourcent = avance ? Math.round((avance / montant) * 10_000) / 100 : 0;

        const idFournisseur = await fournisseurId(nomFournisseur);
        const data = {
          marcheId,
          fournisseurId: idFournisseur,
          montantTtc: montant,
          avancePourcent,
          modalite,
          dateFacture: dateFacture ? new Date(`${dateFacture}T00:00:00Z`) : null,
          echeance: echeance ? new Date(`${echeance}T00:00:00Z`) : null,
        };
        const existante = await tx.commandeFournisseur.findFirst({ where: { marcheId, fournisseurId: idFournisseur, montantTtc: montant } });
        const commande = existante
          ? await tx.commandeFournisseur.update({ where: { id: existante.id }, data })
          : await tx.commandeFournisseur.create({ data });
        rapport.commandes[existante ? 'misesAJour' : 'creees'] += 1;
        if (numeros.length) {
          await tx.ligneAchat.updateMany({ where: { id: { in: numeros.map((n) => idsParNumero.get(n)) } }, data: { commandeId: commande.id } });
        } else {
          remarques.push(`Paiement ${nomFournisseur} : aucune ligne de matériel reconnue dans son bloc.`);
        }
      }
    },
    { timeout: 60_000 },
  );

  if (rapport.livrees.length) remarques.push(`Marquées « Livré » d’après la partie « Équipements livrés » : lignes ${rapport.livrees.join(', ')}.`);
  return rapport;
}
