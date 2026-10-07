/**
 * Le moteur de lecture des sources : chaque connecteur décrit par des RÈGLES,
 * écrites dans son fichier (voir connecteurs/pmmp.js), comment trouver chaque
 * information. Si le site change, on corrige une règle, sans réécrire la
 * logique de lecture.
 *
 *   {
 *     format: 'html' | 'json',
 *     liste: {
 *       decoupage: { repere: '_refCons"', debut: '<tr' }   // HTML : une annonce autour de chaque repère
 *               ou { css: 'article.annonce' }              // HTML : une annonce par élément
 *               ou { chemin: 'data.annonces' }             // JSON : le tableau des annonces
 *       champs: { objet: ['css:…', 'etiquette:Objet'], … } // pour chaque champ, des règles dans l'ordre
 *     },
 *     detail: { champs: { … } }                             // la page d'une annonce (facultatif)
 *   }
 *
 * Chaque champ a PLUSIEURS règles, essayées l'une après l'autre : si le site
 * renomme un identifiant, l'étiquette visible ou la forme d'une date prennent
 * le relais. Une règle s'écrit sur une ligne :
 *
 *   css:SÉLECTEUR             le texte de l'élément           css:span.ref
 *   css:SÉLECTEUR@attribut    un attribut de l'élément        css:input[id$="_refCons"]@value
 *   etiquette:LIBELLÉ         le texte qui suit « LIBELLÉ : » etiquette:Acheteur public
 *   regex:MOTIF               dans le HTML (groupes réunis)   regex:cloture-line">\s*(\d{2}/\d{2}/\d{4})
 *   texte:MOTIF               dans le texte sans balises      texte:Estimation[^:]*:\s*([\d .,]+)
 *   json:chemin.du.champ      dans une annonce JSON           json:acheteur.nom
 *   modele:… {champ} …        à partir d'autres champs        modele:pmmp-{_org}-{_ref}
 *   fixe:valeur               une valeur fixe                 fixe:En cours
 *   documents:MOTIF           les liens dont l'adresse correspond (liste de documents)
 *
 * et peut être suivie de filtres : « | sans:MOTIF » retire un morceau,
 * « | garder:MOTIF » ne garde que le premier groupe.
 * Un champ dont le nom commence par « _ » est une aide (pour un modèle), pas une information.
 *
 * Sécurité : les motifs sont limités en longueur et ne s'appliquent qu'à des
 * morceaux de page de taille bornée. Rien n'est jamais exécuté.
 */
import { parse } from 'node-html-parser';

export const CHAMPS_LUS = ['idExterne', 'urlOfficielle', 'reference', 'objet', 'resume', 'acheteur', 'categorie', 'domaines', 'procedure', 'lieu', 'datePublication', 'dateLimite', 'estimation', 'caution', 'lots', 'reponseElectronique', 'documents', 'statutExterne'];
const TYPES = ['css', 'etiquette', 'regex', 'texte', 'json', 'modele', 'fixe', 'documents'];
const MOTIF_MAX = 400;
const BLOC_MAX = 80_000;

/** Une erreur dans les règles, au message montrable. */
export class ErreurRegles extends Error {}

/** Une règle écrite → { type, valeur, attribut, filtres }. */
export function lireRegle(ecrite) {
  const [tete, ...suite] = String(ecrite).split(/\s+\|\s+/);
  const m = /^([a-z]+):([\s\S]*)$/.exec(tete.trim());
  if (!m || !TYPES.includes(m[1])) throw new ErreurRegles(`Règle inconnue : « ${String(ecrite).slice(0, 60)} » (attendu : ${TYPES.join(', ')}).`);
  let valeur = m[2].trim();
  let attribut = null;
  if (m[1] === 'css') {
    const a = /@([\w:-]+)$/.exec(valeur);
    if (a) {
      attribut = a[1];
      valeur = valeur.slice(0, a.index).trim();
    }
  }
  const filtres = suite.map((f) => {
    const fm = /^(sans|garder):([\s\S]+)$/.exec(f.trim());
    if (!fm) throw new ErreurRegles(`Filtre inconnu : « ${f.slice(0, 40)} » (attendu : sans:…, garder:…).`);
    return { type: fm[1], motif: motif(fm[2]) };
  });
  if (['regex', 'texte'].includes(m[1])) motif(valeur);
  if (m[1] === 'css') {
    try {
      parse('<div></div>').querySelector(valeur);
    } catch {
      throw new ErreurRegles(`Sélecteur CSS invalide : « ${valeur.slice(0, 60)} ».`);
    }
  }
  return { type: m[1], valeur, attribut, filtres };
}

/** Un motif d'expression régulière, vérifié (longueur, syntaxe). */
function motif(source) {
  if (source.length > MOTIF_MAX) throw new ErreurRegles(`Motif trop long (${MOTIF_MAX} caractères au plus).`);
  try {
    return new RegExp(source, 'i');
  } catch (e) {
    throw new ErreurRegles(`Motif invalide « ${source.slice(0, 60)} » : ${e.message}`);
  }
}

/** Vérifie un jeu de règles complet ; rend la liste des problèmes (vide si tout va bien). */
export function verifierRegles(regles) {
  const problemes = [];
  if (!regles || typeof regles !== 'object') return ['Règles absentes.'];
  if (!['html', 'json'].includes(regles.format)) problemes.push('Format attendu : html ou json.');
  for (const partie of ['liste', 'detail']) {
    const p = regles[partie];
    if (!p) continue;
    if (partie === 'liste') {
      const d = p.decoupage ?? {};
      if (regles.format === 'json' && typeof d.chemin !== 'string') problemes.push('JSON : indiquez le chemin du tableau des annonces (decoupage.chemin).');
      if (regles.format === 'html' && !d.repere && !d.css) problemes.push('HTML : indiquez un repère ou un sélecteur pour découper la page en annonces.');
      if (d.css) {
        try {
          parse('<div></div>').querySelector(d.css);
        } catch {
          problemes.push(`Sélecteur de découpage invalide : « ${d.css} ».`);
        }
      }
    }
    for (const [champ, liste] of Object.entries(p.champs ?? {})) {
      if (!/^_?[a-zA-Z][\w]*$/.test(champ)) problemes.push(`Nom de champ invalide : « ${champ} ».`);
      if (!champ.startsWith('_') && !CHAMPS_LUS.includes(champ)) problemes.push(`Champ inconnu : « ${champ} » (les aides commencent par « _ »).`);
      if (!Array.isArray(liste) || liste.length > 10) {
        problemes.push(`« ${champ} » : une liste de 10 règles au plus.`);
        continue;
      }
      for (const r of liste) {
        try {
          lireRegle(r);
        } catch (e) {
          problemes.push(`« ${champ} » : ${e.message}`);
        }
      }
    }
  }
  return problemes;
}

// ── Lire un morceau de page ──────────────────────────────────────────

/** Un bloc (une annonce) : son HTML, son arbre, son texte en lignes. */
function bloc(html) {
  const brut = html.length > BLOC_MAX ? html.slice(0, BLOC_MAX) : html;
  // Les <tr>/<td> mal fermés de certains portails perdent les analyseurs : on les lit comme des blocs simples.
  const racine = parse(`<div>${brut.replace(/<\/?(?:tr|tbody|thead|table)\b[^>]*>/gi, '').replace(/<(\/?)t[dh]\b/gi, '<$1div')}</div>`, { blockTextElements: { script: false, style: false, noscript: false } });
  return { brut, racine, json: null };
}

const espaces = (t) => (t ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const texteDe = (noeud) => (noeud ? espaces(parse(`<div>${noeud.innerHTML.replace(/<br\s*\/?>/gi, ' ')}</div>`).text) : '');
const lignesDe = (b) => (b._lignes ??= b.racine.structuredText.split('\n').map(espaces).filter(Boolean));
const platDe = (b) => (b._plat ??= espaces(b.racine.text));

/** Une valeur dans un objet JSON, par son chemin (« a.b.0.c »). */
function valeurJson(objet, chemin) {
  return chemin.split('.').reduce((v, cle) => (v === null || v === undefined ? undefined : v[cle]), objet);
}

/** Applique une règle à un bloc ; rend la valeur trouvée ou null. */
function appliquer(regle, b, valeurs, base) {
  const { type, valeur, attribut, filtres } = regle;
  let resultat = null;
  try {
    if (type === 'css' && b.racine) {
      const n = b.racine.querySelector(valeur);
      resultat = n ? (attribut ? n.getAttribute(attribut) : texteDe(n)) : null;
      if (resultat && attribut === 'href') resultat = new URL(resultat.replace(/&amp;/g, '&'), base).toString();
    } else if (type === 'etiquette' && b.racine) {
      const libelle = espaces(valeur).toLowerCase();
      const lignes = lignesDe(b);
      for (let i = 0; i < lignes.length && !resultat; i++) {
        const l = lignes[i];
        if (!l.toLowerCase().startsWith(libelle)) continue;
        const reste = l.slice(libelle.length).replace(/^[\s*:]+/, '').trim();
        resultat = reste || (lignes[i + 1] && !/:\s*$/.test(lignes[i + 1]) ? lignes[i + 1] : null);
      }
    } else if (type === 'regex' || type === 'texte') {
      const m = motif(valeur).exec(type === 'regex' ? b.brut : platDe(b));
      resultat = m ? espaces(m.length > 1 ? m.slice(1).filter(Boolean).join(' ') : m[0]) : null;
    } else if (type === 'json' && b.json) {
      const v = valeurJson(b.json, valeur);
      resultat = v === null || v === undefined ? null : Array.isArray(v) ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
    } else if (type === 'modele') {
      let manque = false;
      resultat = valeur.replace(/\{(_?\w+)\}/g, (_, nom) => {
        const v = valeurs[nom];
        if (v === null || v === undefined || v === '') manque = true;
        return encodeURIComponentSiAdresse(valeur, v ?? '');
      });
      if (manque) resultat = null;
    } else if (type === 'fixe') {
      resultat = valeur;
    } else if (type === 'documents' && b.racine) {
      const m = motif(valeur);
      resultat = b.racine
        .querySelectorAll('a')
        .filter((a) => m.test(a.getAttribute('href') ?? ''))
        .map((a) => ({ nom: texteDe(a) || 'Document', url: new URL((a.getAttribute('href') ?? '').replace(/&amp;/g, '&'), base).toString() }));
      if (!resultat.length) resultat = null;
    }
  } catch {
    resultat = null; // une règle qui échoue laisse la place à la suivante
  }
  if (typeof resultat === 'string') {
    for (const f of filtres) {
      if (f.type === 'sans') resultat = resultat.replace(f.motif, '').trim();
      else resultat = f.motif.exec(resultat)?.[1]?.trim() ?? null;
      if (!resultat) break;
    }
    if (!resultat || resultat === '-') resultat = null;
  }
  return resultat;
}

/** Dans un modèle d'adresse, les valeurs insérées sont encodées. */
const encodeURIComponentSiAdresse = (modele, v) => (/^https?:\/\//.test(modele) ? encodeURIComponent(v) : v);

/**
 * Lit les champs d'un bloc : les aides et les champs ordinaires d'abord, les
 * modèles ensuite (ils utilisent les autres).
 *
 * @returns {{ offre: object, regles: Record<string, number> }} l'offre brute, et pour chaque champ le rang de la règle qui a marché (0 = la première)
 */
export function extraire(b, champs, { base } = {}) {
  const valeurs = {};
  const rangs = {};
  const ordre = Object.entries(champs).sort(([, a], [, z]) => Number(a.some((r) => r.startsWith('modele:'))) - Number(z.some((r) => r.startsWith('modele:'))));
  for (const [champ, ecrites] of ordre) {
    for (const [i, ecrite] of ecrites.entries()) {
      const v = appliquer(lireRegle(ecrite), b, valeurs, base);
      if (v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) {
        valeurs[champ] = v;
        rangs[champ] = i;
        break;
      }
    }
  }
  const offre = Object.fromEntries(Object.entries(valeurs).filter(([c]) => !c.startsWith('_')));
  return { offre, rangs };
}

/** Découpe une page (ou une réponse JSON) en blocs d'annonce. */
export function decouper(texte, regles) {
  const d = regles.liste?.decoupage ?? {};
  if (regles.format === 'json') {
    let donnees;
    try {
      donnees = JSON.parse(texte);
    } catch {
      throw new ErreurRegles('La réponse n’est pas du JSON valide.');
    }
    const tableau = d.chemin ? valeurJson(donnees, d.chemin) : donnees;
    if (!Array.isArray(tableau)) throw new ErreurRegles(`Aucun tableau d’annonces au chemin « ${d.chemin || '(racine)'} ».`);
    return tableau.slice(0, 1000).map((json) => ({ brut: '', racine: null, json }));
  }
  if (d.css) return parse(texte).querySelectorAll(d.css).slice(0, 1000).map((n) => bloc(n.outerHTML));
  if (d.repere) {
    const debuts = [];
    let i = texte.indexOf(d.repere);
    while (i >= 0 && debuts.length < 1000) {
      const debut = d.debut ? texte.lastIndexOf(d.debut, i) : i;
      if (debut >= 0 && debut !== debuts.at(-1)) debuts.push(debut);
      i = texte.indexOf(d.repere, i + d.repere.length);
    }
    return debuts.map((debut, k) => {
      const finTableau = texte.indexOf('</tbody>', debut);
      return bloc(texte.slice(debut, debuts[k + 1] ?? (finTableau > 0 ? finTableau : texte.length)));
    });
  }
  return [bloc(texte)];
}

/**
 * Lit une page de liste avec des règles.
 *
 * @returns {{ offres: object[], qualite: { blocs: number, offres: number, parChamp: Record<string, number>, secours: Record<string, number> } }}
 */
export function lireListe(texte, regles, { base } = {}) {
  const blocs = decouper(texte, regles);
  const offres = [];
  const parChamp = {};
  const secours = {};
  for (const b of blocs) {
    const { offre, rangs } = extraire(b, regles.liste.champs, { base });
    offres.push(offre);
    for (const [c, rang] of Object.entries(rangs)) {
      if (c.startsWith('_')) continue;
      parChamp[c] = (parChamp[c] ?? 0) + 1;
      if (rang > 0) secours[c] = (secours[c] ?? 0) + 1;
    }
  }
  return { offres, qualite: { blocs: blocs.length, offres: offres.filter((o) => o.objet).length, parChamp, secours } };
}

/** Lit une page de détail (une seule annonce) avec des règles. */
export function lireDetail(texte, regles, { base } = {}) {
  return extraire(bloc(texte), regles.detail?.champs ?? {}, { base }).offre;
}

/**
 * La santé d'une lecture : faut-il prévenir que la source est « à vérifier » ?
 *
 * @returns {string|null} la raison, ou null si tout va bien
 */
export function diagnostic(qualite, regles) {
  if (!qualite) return null;
  if (qualite.blocs === 0) return 'Aucune annonce trouvée sur la page : sa structure a peut-être changé. Vérifiez les règles de lecture.';
  if (qualite.offres < qualite.blocs / 2) return `${qualite.blocs - qualite.offres} annonce(s) sur ${qualite.blocs} sans objet : la règle « objet » ne trouve plus l’information.`;
  if (regles?.liste?.champs?.dateLimite && (qualite.parChamp.dateLimite ?? 0) < qualite.blocs / 2) {
    return `${qualite.blocs - (qualite.parChamp.dateLimite ?? 0)} annonce(s) sur ${qualite.blocs} sans date limite : la règle « dateLimite » ne trouve plus l’information.`;
  }
  return null;
}
