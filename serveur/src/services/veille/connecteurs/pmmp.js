/**
 * Le connecteur du Portail marocain des marchés publics (PMMP).
 *
 * Le portail n'offre ni API, ni flux RSS, ni jeu de données ouvert (vérifié le
 * 6 octobre 2026). Ce connecteur lit donc deux pages PUBLIQUES, sans compte :
 *  - la liste des consultations en cours (10 annonces par page) ;
 *  - la page de détail d'une consultation.
 *
 * Il ne contient pas de code de lecture : seulement des RÈGLES (voir
 * ../lecture.js), avec plusieurs règles de secours par champ. Si le portail
 * change, on les corrige dans Paramètres → Sources de marchés, sans toucher au
 * code ; celles-ci restent les règles par défaut.
 *
 * Limites voulues :
 *  - une seule page de liste par passage : les pages suivantes s'obtiennent en
 *    rejouant le formulaire du site, ce qu'on ne fait pas ;
 *  - aucun téléchargement de dossier de consultation : seuls les liens ;
 *  - une source PMMP est créée DÉSACTIVÉE : la collecte automatique n'est ni
 *    autorisée ni interdite par les conditions du site, l'activer est une
 *    décision à prendre après accord de l'éditeur du portail.
 */
import { lireDetail, lireListe } from '../lecture.js';

export const ADRESSE_LISTE = 'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch&AllCons';
const BASE = 'https://www.marchespublics.gov.ma/';
const D = '#ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_';
const DATE = '(\\d{2}\\/\\d{2}\\/\\d{4})';

/** Les règles par défaut du portail (observées en octobre 2026). */
export const REGLES_PMMP = {
  format: 'html',
  liste: {
    decoupage: { repere: '_refCons"', debut: '<tr' },
    champs: {
      _ref: ['css:input[id$="_refCons"]@value', 'regex:refConsultation=(\\d+)'],
      _org: ['css:input[id$="_orgCons"]@value', 'regex:orgAcc?ronyme=(\\w+)'],
      idExterne: ['modele:pmmp-{_org}-{_ref}'],
      urlOfficielle: [`modele:${BASE}index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation={_ref}&orgAcronyme={_org}`],
      reference: ['css:span.ref', 'etiquette:Référence'],
      objet: ['css:div[id$="_infosBullesObjet"]', 'css:div[id$="_panelBlocObjet"] | sans:^Objet\\s*:\\s*', 'etiquette:Objet'],
      acheteur: ['css:div[id$="_panelBlocDenomination"] | sans:^Acheteur public\\s*:\\s*', 'etiquette:Acheteur public'],
      procedure: ['css:div[id$="_type_procedure"]', 'etiquette:Procédure'],
      categorie: ['css:div[id$="_panelBlocCategorie"]', 'etiquette:Catégorie'],
      lieu: ['css:div[id$="_infosLieuExecution"]', 'css:div[id$="_panelBlocLieuxExec"]', 'etiquette:Lieu d’exécution', "etiquette:Lieu d'exécution"],
      // La date de publication suit la catégorie ; à défaut, c'est la première date de la ligne.
      datePublication: [`regex:panelBlocCategorie"[^>]*>[\\s\\S]*?<\\/div>\\s*<div>\\s*${DATE}`, `regex:${DATE}`],
      // La date limite est dans « cloture-line » ; à défaut, la première date suivie d'une heure.
      dateLimite: [`regex:class="cloture-line">\\s*${DATE}\\s*(?:<br\\s*\\/?>)?\\s*(\\d{2}:\\d{2})?`, `regex:${DATE}\\s*(?:<br\\s*\\/?>)?\\s*(\\d{2}:\\d{2})`],
      reponseElectronique: ['regex:<img[^>]*alt="([^"]*)"[^>]*class="certificat"[^>]*style="display:\\s*;"', 'regex:<img[^>]*alt="([^"]*réponse électronique[^"]*)"'],
      statutExterne: ['fixe:En cours'],
    },
  },
  detail: {
    champs: {
      reference: [`css:${D}reference`, 'etiquette:Référence'],
      objet: [`css:${D}objet`, 'etiquette:Objet'],
      acheteur: [`css:${D}entiteAchat`, 'etiquette:Acheteur public'],
      _type: [`css:${D}typeProcedure`],
      _mode: [`css:${D}modePassation | sans:^\\|\\s*`],
      procedure: ['modele:{_type} — {_mode}', 'modele:{_type}', 'etiquette:Procédure'],
      categorie: [`css:${D}categoriePrincipale`, 'etiquette:Catégorie principale'],
      domaines: [`css:${D}domainesActivite`, 'etiquette:Domaines d’activité', "etiquette:Domaines d'activité"],
      lieu: [`css:${D}lieuxExecutions`, 'etiquette:Lieu d’exécution', "etiquette:Lieu d'exécution"],
      dateLimite: [`css:${D}dateHeureLimiteRemisePlis`, 'etiquette:Date et heure limite de remise des plis', `texte:limite[^0-9]{0,40}${DATE}\\s+(\\d{2}:\\d{2})`],
      estimation: ['texte:Estimation[^:]*?:\\s*([\\d\\s.,]+\\d)'],
      caution: [`css:${D}cautionProvisoire`, 'etiquette:Caution provisoire'],
      lots: [`css:${D}linkDetailLots`],
      reponseElectronique: ["texte:(La réponse électronique (?:n’|n')?est[^.]*\\.)"],
      documents: ['documents:EntrepriseDownloadAvis|EntrepriseDemandeTelechargementDce|EntrepriseDownloadReglement'],
      statutExterne: [`css:${D}annonce`],
    },
  },
};

/** Les règles d'une source : les siennes si elle en a, sinon celles par défaut. */
export const reglesDe = (source) => source?.parametres?.regles ?? REGLES_PMMP;

/** Une adresse de consultation du portail ? Rend ses deux clés, ou null. */
export function clesConsultation(adresse) {
  try {
    const u = new URL(adresse, BASE);
    if (!/(^|\.)marchespublics\.gov\.ma$/i.test(u.hostname)) return null;
    const ref = u.searchParams.get('refConsultation');
    const org = u.searchParams.get('orgAcronyme') ?? u.searchParams.get('orgAccronyme');
    return ref && org ? { ref, org } : null;
  } catch {
    return null;
  }
}

/** L'adresse publique et stable d'une consultation. */
export const adresseDetail = ({ ref, org }) => `${BASE}index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation=${encodeURIComponent(ref)}&orgAcronyme=${encodeURIComponent(org)}`;

/** La page de liste → les offres qu'elle montre (et la qualité de la lecture). */
export function lireListePmmp(html, regles = REGLES_PMMP) {
  const { offres, qualite } = lireListe(html, regles, { base: BASE });
  return { offres: offres.filter((o) => o.idExterne), qualite };
}

/** La page de liste → les offres (raccourci). */
export const analyserListe = (html, regles) => lireListePmmp(html, regles).offres;

/** Le nombre total d'annonces annoncé par la page (pour le compte rendu). */
export function totalAnnonce(html) {
  const n = /nombreElement"[^>]*>\s*([\d\s]+)/.exec(html)?.[1];
  return n ? Number(n.replace(/\s/g, '')) : null;
}

/** La page de détail d'une consultation → une offre complète. */
export function analyserDetail(html, adresse, regles = REGLES_PMMP) {
  const cles = clesConsultation(adresse);
  return {
    ...lireDetail(html, regles, { base: BASE }),
    idExterne: cles ? `pmmp-${cles.org}-${cles.ref}` : null,
    urlOfficielle: cles ? adresseDetail(cles) : adresse,
  };
}

/** Le connecteur, tel que la synchronisation l'appelle. */
export const connecteurPmmp = {
  code: 'pmmp',
  automatique: true,
  reconnait: (adresse) => Boolean(clesConsultation(adresse)),

  /** Les annonces récentes : une page de liste, publique. */
  async lister({ source, recuperer }) {
    const regles = reglesDe(source);
    const { texte } = await recuperer(source.adresse || ADRESSE_LISTE);
    const { offres, qualite } = lireListePmmp(texte, regles);
    const remarques = [];
    if (source.pagesMax > 1) remarques.push('une seule page lue : le portail pagine par formulaire, que ce connecteur ne rejoue pas');
    return { offres, pagesLues: 1, total: totalAnnonce(texte), remarques, qualite, regles };
  },

  /** Le détail d'une annonce, pour l'actualiser ou l'importer par son adresse. */
  async detail({ adresse, recuperer, source }) {
    const cles = clesConsultation(adresse);
    if (!cles) throw new Error('Ce n’est pas l’adresse d’une consultation du portail.');
    const { texte } = await recuperer(adresseDetail(cles));
    const offre = analyserDetail(texte, adresseDetail(cles), reglesDe(source));
    if (!offre.objet) throw new Error('Annonce introuvable, ou la page a changé : vérifiez les règles de lecture de la page de détail.');
    return offre;
  },
};
