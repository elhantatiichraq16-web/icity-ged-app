/**
 * Rendre comparables les offres de toutes les sources : du texte propre (sans
 * HTML), des dates, des montants, et une identité stable.
 *
 * Ce qui vient d'un site externe n'est jamais rendu tel quel : tout passe en
 * texte brut, et les liens sont limités au web (http/https).
 */
import sanitizeHtml from 'sanitize-html';
import { empreinteOffre } from '@icity/commun/marches-potentiels';

/** Du HTML (ou du texte) → du texte sur une ligne, sans balise ni entité. */
export function texte(valeur, max = 4000) {
  if (valeur === null || valeur === undefined) return null;
  const brut = sanitizeHtml(String(valeur), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
  if (!brut || brut === '-') return null;
  return brut.length > max ? `${brut.slice(0, max - 1)}…` : brut;
}

/** « 1 399 999,99 », « 14 000,00 MAD », « 1200000.5 » → un nombre (ou null). */
export function montant(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null;
  let s = String(valeur).replace(/[^\d,.\s-]/g, '').replace(/\s+/g, '');
  if (!s) return null;
  // La virgule décimale des formats français ; le point des milliers éventuels.
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * L'heure légale du Maroc, celle qu'affichent les portails : UTC+1 jusqu'au
 * 20 septembre 2026, puis GMT (décret n° 2.26.530, BO n° 7521 du 29 juin 2026).
 * On l'écrit ici plutôt que de se fier au fuseau « Africa/Casablanca » du
 * système : les bases de fuseaux qui datent d'avant le décret se trompent
 * d'une heure. (Les retours ponctuels à GMT pendant le Ramadan, avant 2026,
 * ne sont pas pris en compte.)
 */
export const RETOUR_GMT = '2026-09-20';
export const decalageMaroc = (jourIso) => (jourIso >= RETOUR_GMT ? '+00:00' : '+01:00');
/** Le fuseau à donner à Intl pour écrire une date du Maroc. */
export const fuseauMaroc = (date) => (date && new Date(date).toISOString().slice(0, 10) >= RETOUR_GMT ? 'UTC' : 'Africa/Casablanca');

/**
 * « 25/11/2026 10:00 », « 25/11/2026 », « 2026-11-25T10:00 », une date RFC 822… → une Date.
 * Sans heure, une date limite vaut la fin de journée ; une date de publication, minuit.
 */
export function date(valeur, { finDeJournee = false } = {}) {
  if (!valeur) return null;
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;
  const s = String(valeur).trim();
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(?:à\s*)?(\d{1,2})[:h](\d{2}))?/.exec(s);
  if (fr) {
    const [, j, m, a, h, mi] = fr;
    const heure = h ? `${h.padStart(2, '0')}:${mi}` : finDeJournee ? '23:59' : '00:00';
    const jour = `${a}-${m.padStart(2, '0')}-${j.padStart(2, '0')}`;
    const d = new Date(`${jour}T${heure}:00${decalageMaroc(jour)}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (iso) {
    const [, j, h, zone] = iso;
    const d = new Date(`${j}T${h ?? (finDeJournee ? '23:59' : '00:00')}:00${zone ?? decalageMaroc(j)}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Une adresse web absolue, ou null (jamais de javascript:, data:, file:…). */
export function lien(valeur, base) {
  if (!valeur) return null;
  try {
    const u = new URL(String(valeur).replace(/&amp;/g, '&').trim(), base);
    return ['https:', 'http:'].includes(u.protocol) ? u.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

/**
 * L'offre telle qu'iCity la range, quelle que soit la source.
 *
 * @param {object} brute ce que le connecteur a lu
 * @returns {object|null} null si l'offre n'a même pas d'objet
 */
export function normaliserOffre(brute) {
  const objet = texte(brute.objet, 4000);
  if (!objet) return null;
  const offre = {
    urlOfficielle: lien(brute.urlOfficielle),
    reference: texte(brute.reference, 120),
    objet,
    resume: texte(brute.resume, 4000),
    acheteur: texte(brute.acheteur, 255),
    categorie: texte(brute.categorie, 120),
    domaines: (Array.isArray(brute.domaines) ? brute.domaines : brute.domaines ? [brute.domaines] : []).map((d) => texte(d, 255)).filter(Boolean),
    procedure: texte(brute.procedure, 160),
    lieu: texte(brute.lieu, 255),
    datePublication: date(brute.datePublication),
    dateLimite: date(brute.dateLimite, { finDeJournee: true }),
    estimation: montant(brute.estimation),
    caution: montant(brute.caution),
    lots: (Array.isArray(brute.lots) ? brute.lots : brute.lots ? [brute.lots] : []).map((l) => texte(l, 500)).filter(Boolean).slice(0, 50),
    reponseElectronique: texte(brute.reponseElectronique, 120),
    documents: (Array.isArray(brute.documents) ? brute.documents : []).map((d) => ({ nom: texte(d.nom, 255) ?? 'Document', url: lien(d.url) })).filter((d) => d.url),
    statutExterne: texte(brute.statutExterne, 60),
  };
  // Sans identifiant fourni par la source, une empreinte stable : la même annonce donne toujours la même.
  if (!offre.lots.length) offre.lots = null;
  offre.idExterne = texte(brute.idExterne, 191) ?? empreinteOffre(offre);
  return offre;
}
