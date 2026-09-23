/**
 * Lecture d'un dossier d'archives classées, de la forme
 * `client / année / marché / fichiers` (§6).
 *
 * Ce module ne lit que les NOMS : dossiers, fichiers, tailles. Le contenu des
 * documents n'est ouvert qu'au versement, par l'OCR. Il rend un plan — ce qui
 * serait créé — que l'on peut afficher avant de toucher à la base.
 *
 * Rien n'est deviné en silence : ce qui n'est pas reconnu est signalé et
 * rangé « à trier », jamais rattaché au hasard.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { extraireLot, normaliserReference } from '@icity/commun/marches';

/** Les notes de travail du dossier d'origine ne sont pas des pièces (§6). */
const EXTENSIONS_IGNOREES = new Set(['.txt', '.csv', '.db', '.ini']);

/** Le dossier des attestations détachées, rangées par client. */
const ATTESTATIONS = 'ATTESTATIONS_SEPAREES_OCR';

/**
 * Le type de pièce, lu dans le nom du fichier (repris de
 * corriger-classement.py). L'ordre compte : la première règle qui s'applique
 * gagne — « MARCHE_CPS_SIGNE » est un contrat avant que « CPS » ne l'envoie
 * ailleurs.
 */
const TYPES_PAR_NOM = [
  ['AV', ['AVENANT']],
  ['CAU', ['CAUTION']],
  ['MLV', ['MAINLEVEE']],
  ['OS', ['ORDRE_SERVICE']],
  ['BL', ['BON_LIVRAISON']],
  ['BC', ['BON_COMMANDE']],
  ['ATT', ['ATTESTATION']],
  ['PVD', ['RECEPTION_DEFINITIVE', 'PV_DEFINITIF']],
  ['PVP', ['RECEPTION_PROVISOIRE', 'PROCES_VERBAL_RECEPTION', 'PV_PROVISOIRE']],
  // Un « procès-verbal » sans plus de précision : l'OCR tranchera en phase 4.
  ['PVP', ['PROCES_VERBAL', 'DOSSIER_RECEPTIONS']],
  ['DAO', ['DOSSIER_APPEL_OFFRES', 'REGLEMENT_CONSULTATION', 'DOSSIER_TECHNIQUE_CONSULTATION', 'COMPLEMENT_DOSSIER_OFFRE', 'CONSULTATION']],
  ['CM', ['MARCHE_SIGNE', 'MARCHE_CPS_SIGNE', 'CAHIER_PRESCRIPTIONS_SPECIALES', 'COUVERTURE_MARCHE', 'LETTRE_COMMANDE']],
  ['FAC', ['FACTURE']],
  ['DEC', ['DECOMPTE']],
  ['RV', ['RECU_VERSEMENT', 'DOSSIER_PAIEMENT']],
  ['COU', ['CORRESPONDANCE', 'NOTIFICATION', 'DEMANDE_PIECES_ADMINISTRATIVES']],
  ['ETU', ['CAHIER_TECHNIQUE', 'CAHIER_DES_CHARGES', 'BORDEREAU_PRIX', 'DOSSIER_EXECUTION', 'ACHATS_FOURNISSEURS']],
];

/** L'objet technique du marché (§7), lu dans le nom du dossier. */
const OBJETS = [
  ["Contrôle d'accès", ['CONTROLE_ACCES', 'CONTROLE-ACCES', 'ACCES']],
  ['Vidéosurveillance', ['VIDEOSURVEILLANCE', 'VIDEO', 'CAMERA', 'CCTV']],
  ["Système d'alarme", ['ALARME', 'INTRUSION']],
  ['Détection incendie', ['INCENDIE', 'DETECTION_INCENDIE']],
  ['Maintenance', ['MAINTENANCE']],
];

/** Les villes rencontrées dans les noms de dossiers. */
const VILLES = ['RABAT', 'CASABLANCA', 'MARRAKECH', 'KENITRA', 'NADOR', 'TANGER', 'AGADIR', 'FES', 'OUJDA', 'TETOUAN', 'SAFI', 'ESSAOUIRA', 'SALE', 'TAGHAZOUT', 'JORF'];

const sansAccent = (t) =>
  t
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toUpperCase();

/** Le type de pièce d'après le nom du fichier, ou null. */
export function typeDepuisNom(nomFichier) {
  const n = sansAccent(nomFichier);
  for (const [code, motifs] of TYPES_PAR_NOM) {
    if (motifs.some((m) => n.includes(m))) return code;
  }
  return null;
}

/**
 * La référence d'un marché, lue dans le nom de son dossier.
 *
 * Les formes du fonds : M31-2016_DOUANES_RABAT, M23A-2017-TGR_LOT1,
 * MAR202200027_GCAM_CONTROLE_ACCES, BC26-2019_AURS, AO639-2022_…,
 * CONSULTATION_SOSIPO_NADOR.
 *
 * @returns {{ reference: string, lot: string|null, certaine: boolean }}
 */
export function referenceDepuisDossier(nomDossier) {
  const n = sansAccent(nomDossier);

  // MAR + chiffres : le Crédit Agricole. Le préfixe fait partie du numéro.
  const mar = /^MAR(\d{6,})/.exec(n);
  if (mar) return { reference: `MAR${mar[1]}`, lot: null, certaine: true };

  // M23A-2017-TGR_LOT1 → 23A/2017/TGR, lot 1
  //
  // Le code d'organisme n'est retenu que s'il est séparé par un tiret :
  // c'est la forme de ces marchés. Avec le tiret bas, « M31-2016_DOUANES_
  // RABAT », le troisième morceau est le nom du client, pas un code — le
  // prendre pour une référence créerait « 31/2016/DOUANE ».
  const troisSegments = /^(?:M|AO|BC)?(\d{1,5}[A-Z]?)-(\d{4})-([A-Z]{2,6})(?:[-_]LOT\s?(\d+))?/.exec(n);
  if (troisSegments) {
    const [, numero, annee, organisme, lotExplicite] = troisSegments;
    const reference = `${numero}/${annee}/${organisme}`;
    // Le lot retenu est la LETTRE de la référence (23A → A) quand elle existe :
    // c'est elle que portent les documents. « _LOT1 » du nom de dossier dit la
    // même chose autrement, et ne sert que si la lettre manque.
    return { reference, lot: extraireLot(reference) ?? lotExplicite ?? null, certaine: true };
  }

  // M31-2016_DOUANES_RABAT → 31/2016 ; BC26-2019_AURS → 26/2019
  const deuxSegments = /^(?:M|AO|BC)?(\d{1,5}[A-Z]?)[-_](\d{4})/.exec(n);
  if (deuxSegments) {
    const reference = `${deuxSegments[1]}/${deuxSegments[2]}`;
    return { reference, lot: extraireLot(reference), certaine: true };
  }

  // CONSULTATION_SOSIPO_NADOR : aucune numérotation. On garde le nom du
  // dossier comme référence provisoire, et on le signale.
  return { reference: nomDossier, lot: null, certaine: false };
}

/** L'objet technique deviné d'après le nom du dossier, ou null. */
export function objetTechniqueDepuisDossier(nomDossier) {
  const n = sansAccent(nomDossier);
  for (const [objet, motifs] of OBJETS) {
    if (motifs.some((m) => n.includes(m))) return objet;
  }
  return null;
}

/** La ville devinée d'après le nom du dossier, ou null. */
export function villeDepuisDossier(nomDossier) {
  const n = sansAccent(nomDossier).replace(/[_-]/g, ' ');
  const trouvee = VILLES.find((v) => n.includes(v));
  if (!trouvee) return null;
  return trouvee.charAt(0) + trouvee.slice(1).toLowerCase();
}

/** Le nom lisible d'un client, depuis son dossier : « Credit_Agricole_du_Maroc ». */
export function nomDepuisDossier(nomDossier) {
  return nomDossier.replace(/_/g, ' ').replace(/\s+-\s+/g, ' — ').trim();
}

/**
 * Parcourt le dossier et rend le plan de versement.
 *
 * @param {string} racine
 * @returns {Promise<{ marches: object[], attestations: object[], ignores: object[], fichiers: number, octets: number }>}
 */
export async function lireArchives(racine) {
  const marches = new Map();
  const attestations = new Map();
  const ignores = [];
  let fichiers = 0;
  let octets = 0;

  async function contenu(dossier) {
    return fs.readdir(dossier, { withFileTypes: true });
  }

  /** Ajoute tous les fichiers d'un dossier à une entrée du plan. */
  async function ajouterFichiers(dossier, entree) {
    for (const f of await contenu(dossier)) {
      if (f.isDirectory()) {
        // Un sous-dossier inattendu : ses fichiers restent rattachés au marché.
        await ajouterFichiers(path.join(dossier, f.name), entree);
        continue;
      }
      const extension = path.extname(f.name).toLowerCase();
      const chemin = path.join(dossier, f.name);
      if (EXTENSIONS_IGNOREES.has(extension)) {
        ignores.push({ chemin, raison: 'note de travail, pas une pièce' });
        continue;
      }
      const { size } = await fs.stat(chemin);
      fichiers += 1;
      octets += size;
      entree.fichiers.push({ chemin, nom: f.name, taille: size, typeCode: typeDepuisNom(f.name) });
    }
  }

  for (const clientDir of await contenu(racine)) {
    if (!clientDir.isDirectory()) continue;

    // ── Cas 1 : les attestations détachées, rangées par client ──
    if (clientDir.name === 'Divers_clients') {
      for (const sous of await contenu(path.join(racine, clientDir.name))) {
        if (!sous.isDirectory()) continue;
        const cheminSous = path.join(racine, clientDir.name, sous.name);

        if (sous.name === ATTESTATIONS) {
          for (const clientAtt of await contenu(cheminSous)) {
            // _CONTROLES ne contient que les rapports de contrôle du tri.
            if (!clientAtt.isDirectory() || clientAtt.name.startsWith('_')) continue;
            const entree = { dossierClient: clientAtt.name, nomClient: nomDepuisDossier(clientAtt.name), fichiers: [] };
            await ajouterFichiers(path.join(cheminSous, clientAtt.name), entree);
            if (entree.fichiers.length) attestations.set(clientAtt.name, entree);
          }
          continue;
        }

        // Les autres dossiers « divers » : patrimoine hors marché. Quand ils
        // ont des sous-dossiers (Divers/ATTESTATIONS_REFERENCES), c'est le
        // sous-dossier qui nomme la famille.
        const sousDossiers = (await contenu(cheminSous)).filter((d) => d.isDirectory());
        const familles = sousDossiers.length ? sousDossiers.map((d) => ({ nom: d.name, chemin: path.join(cheminSous, d.name) })) : [{ nom: sous.name, chemin: cheminSous }];
        for (const famille of familles) {
          const entree = { dossierClient: null, nomClient: null, patrimoine: famille.nom, fichiers: [] };
          await ajouterFichiers(famille.chemin, entree);
          if (entree.fichiers.length) attestations.set(`divers:${famille.nom}`, entree);
        }
      }
      continue;
    }

    // ── Cas 2 : client / année / marché ──
    for (const anneeDir of await contenu(path.join(racine, clientDir.name))) {
      if (!anneeDir.isDirectory()) continue;
      const annee = /^\d{4}$/.test(anneeDir.name) ? Number(anneeDir.name) : null;

      for (const marcheDir of await contenu(path.join(racine, clientDir.name, anneeDir.name))) {
        if (!marcheDir.isDirectory()) continue;
        const { reference, lot, certaine } = referenceDepuisDossier(marcheDir.name);
        // La clé de regroupement porte le lot quand il est connu : les lots 1,
        // 2 et 3 d'un même appel d'offres sont trois marchés signés, avec
        // chacun leurs pièces et leur réception. Sans ce suffixe, la règle de
        // regroupement du §5 — faite pour rapprocher deux LECTURES d'une même
        // référence — les fondrait en un seul dossier.
        const cle = normaliserReference(reference) + (lot ? `#${lot}` : '');
        const entree = marches.get(cle) ?? {
          cle,
          reference,
          lot,
          certaine,
          annee,
          dossierClient: clientDir.name,
          nomClient: nomDepuisDossier(clientDir.name),
          dossiers: [],
          objetTechnique: objetTechniqueDepuisDossier(marcheDir.name),
          ville: villeDepuisDossier(marcheDir.name) ?? villeDepuisDossier(clientDir.name),
          fichiers: [],
        };
        entree.dossiers.push(marcheDir.name);
        // La référence affichée : la plus complète des variantes.
        if (marcheDir.name.length && reference.length > entree.reference.length) entree.reference = reference;
        entree.objetTechnique ??= objetTechniqueDepuisDossier(marcheDir.name);
        await ajouterFichiers(path.join(racine, clientDir.name, anneeDir.name, marcheDir.name), entree);
        marches.set(cle, entree);
      }
    }
  }

  return {
    marches: [...marches.values()].sort((a, b) => a.reference.localeCompare(b.reference, 'fr')),
    attestations: [...attestations.values()].sort((a, b) => (a.nomClient ?? '').localeCompare(b.nomClient ?? '', 'fr')),
    ignores,
    fichiers,
    octets,
  };
}
