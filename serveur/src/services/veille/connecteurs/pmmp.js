/**
 * Le connecteur du Portail marocain des marchés publics (PMMP).
 *
 * Le portail n'offre ni API, ni flux RSS, ni jeu de données ouvert (vérifié le
 * 6 octobre 2026). Ce connecteur lit donc deux pages PUBLIQUES, sans compte :
 *  - la liste des consultations en cours (100 annonces par page) ;
 *  - la page de détail d'une consultation.
 *
 * Limites voulues :
 *  - une seule page de liste par passage : les pages suivantes s'obtiennent en
 *    rejouant le formulaire du site, ce qu'on ne fait pas ;
 *  - aucun téléchargement de dossier de consultation (il passe par un
 *    formulaire de demande) : seuls les liens sont montrés ;
 *  - une source PMMP est créée DÉSACTIVÉE : la collecte automatique n'est ni
 *    autorisée ni interdite par les conditions du site, l'activer est une
 *    décision à prendre après accord de l'éditeur du portail.
 */
import { parse } from 'node-html-parser';

export const ADRESSE_LISTE = 'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch&AllCons';
const BASE = 'https://www.marchespublics.gov.ma/';
const PREFIXE_DETAIL = 'ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_';

/** Le texte d'un nœud, les <br> devenus des espaces. */
const lire = (noeud) => (noeud ? noeud.innerHTML.replace(/<br\s*\/?>/gi, ' ') : null);
const nettoyer = (html) =>
  html
    ? parse(`<div>${html}</div>`)
        .text.replace(/\s+/g, ' ')
        .trim()
    : null;

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

/**
 * La page de liste → les offres qu'elle montre.
 *
 * @param {string} html
 * @returns {object[]} des offres brutes (à normaliser)
 */
export function analyserListe(html) {
  const racine = parse(html);
  const offres = [];
  for (const ligne of racine.querySelectorAll('tr')) {
    const ref = ligne.querySelector('input[id$="_refCons"]')?.getAttribute('value');
    const org = ligne.querySelector('input[id$="_orgCons"]')?.getAttribute('value');
    if (!ref || !org) continue;
    const colonneRef = ligne.querySelector('td[headers="cons_ref"]');
    const publication = /(\d{2}\/\d{2}\/\d{4})/.exec(nettoyer(lire(colonneRef)) ?? '')?.[1] ?? null;
    const objet = nettoyer(lire(ligne.querySelector('div[id$="_infosBullesObjet"]'))) ?? nettoyer(lire(ligne.querySelector('div[id$="_panelBlocObjet"]')))?.replace(/^Objet\s*:\s*/, '');
    const acheteur = nettoyer(lire(ligne.querySelector('div[id$="_panelBlocDenomination"]')))?.replace(/^Acheteur public\s*:\s*/, '');
    const lieu = nettoyer(lire(ligne.querySelector('div[id$="_infosLieuExecution"]'))) ?? nettoyer(lire(ligne.querySelector('div[id$="_panelBlocLieuxExec"]')));
    const limite = nettoyer(lire(ligne.querySelector('td[headers="cons_dateEnd"] .cloture-line')));
    const reponse = ligne.querySelectorAll('img.certificat').find((i) => !/display:\s*none/i.test(i.getAttribute('style') ?? ''));
    offres.push({
      idExterne: `pmmp-${org}-${ref}`,
      urlOfficielle: adresseDetail({ ref, org }),
      reference: nettoyer(lire(ligne.querySelector('span.ref'))),
      objet,
      acheteur,
      procedure: nettoyer(lire(ligne.querySelector('div[id$="_type_procedure"]'))),
      categorie: nettoyer(lire(ligne.querySelector('div[id$="_panelBlocCategorie"]'))),
      lieu,
      datePublication: publication,
      dateLimite: limite,
      reponseElectronique: reponse?.getAttribute('alt') ?? null,
      statutExterne: 'En cours',
    });
  }
  return offres;
}

/** Le nombre total d'annonces annoncé par la page (pour le compte rendu). */
export function totalAnnonce(html) {
  const n = /nombreElement"[^>]*>\s*([\d\s]+)/.exec(html)?.[1];
  return n ? Number(n.replace(/\s/g, '')) : null;
}

/**
 * La page de détail d'une consultation → une offre complète.
 *
 * @param {string} html
 * @param {string} adresse l'adresse lue (pour l'identité et les liens)
 */
export function analyserDetail(html, adresse) {
  const racine = parse(html);
  const champ = (nom) => nettoyer(lire(racine.querySelector(`#${PREFIXE_DETAIL}${nom}`)));
  const plat = racine.text.replace(/\s+/g, ' ');
  const cles = clesConsultation(adresse);
  const lots = champ('linkDetailLots');
  const documents = [];
  for (const a of racine.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    if (!/EntrepriseDownloadAvis|EntrepriseDemandeTelechargementDce|EntrepriseDownloadReglement/i.test(href)) continue;
    const nom = nettoyer(lire(a)) || (/Avis/i.test(href) ? 'Avis de publicité' : 'Dossier de consultation');
    documents.push({ nom, url: new URL(href.replace(/&amp;/g, '&'), BASE).toString() });
  }
  return {
    idExterne: cles ? `pmmp-${cles.org}-${cles.ref}` : null,
    urlOfficielle: cles ? adresseDetail(cles) : adresse,
    reference: champ('reference'),
    objet: champ('objet'),
    acheteur: champ('entiteAchat'),
    procedure: [champ('typeProcedure'), champ('modePassation')?.replace(/^\|\s*/, '')].filter(Boolean).join(' — ') || null,
    categorie: champ('categoriePrincipale'),
    domaines: champ('domainesActivite') ? [champ('domainesActivite')] : [],
    lieu: champ('lieuxExecutions'),
    dateLimite: champ('dateHeureLimiteRemisePlis'),
    estimation: /Estimation[^:]*?:\s*([\d\s .,]+\d)/.exec(plat)?.[1] ?? null,
    caution: champ('cautionProvisoire'),
    lots: lots ? [lots] : null,
    reponseElectronique: /La réponse électronique (?:n’|n')?est[^.]*\./.exec(plat)?.[0] ?? null,
    documents,
    statutExterne: champ('annonce'),
  };
}

/** Le connecteur, tel que la synchronisation l'appelle. */
export const connecteurPmmp = {
  code: 'pmmp',
  automatique: true,
  reconnait: (adresse) => Boolean(clesConsultation(adresse)),

  /** Les annonces récentes : une page de liste, publique. */
  async lister({ source, recuperer }) {
    const { texte } = await recuperer(source.adresse || ADRESSE_LISTE);
    const offres = analyserListe(texte);
    if (!offres.length && !/table-results/.test(texte)) {
      throw new Error('La page reçue ne ressemble plus à la liste des consultations : le portail a peut-être changé.');
    }
    const remarques = [];
    if (source.pagesMax > 1) remarques.push('une seule page lue : le portail pagine par formulaire, que ce connecteur ne rejoue pas');
    return { offres, pagesLues: 1, total: totalAnnonce(texte), remarques };
  },

  /** Le détail d'une annonce, pour l'actualiser ou l'importer par son adresse. */
  async detail({ adresse, recuperer }) {
    const cles = clesConsultation(adresse);
    if (!cles) throw new Error('Ce n’est pas l’adresse d’une consultation du portail.');
    const { texte } = await recuperer(adresseDetail(cles));
    const offre = analyserDetail(texte, adresseDetail(cles));
    if (!offre.objet) throw new Error('Annonce introuvable ou page inattendue.');
    return offre;
  },
};
