/**
 * Les gestes de l'équipe sur les sources et les offres : importer un CSV,
 * importer une annonce par son adresse, actualiser une offre, verser un de
 * ses documents publics dans la GED.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../../db.js';
import { verserFichier } from '../stockage.js';
import { analyserCsv } from './connecteurs/csv.js';
import { clesConsultation } from './connecteurs/pmmp.js';
import { connecteurDe, connecteurPourAdresse } from './connecteurs/index.js';
import { alerterNouvellesOffres, assurerInitialisation, enregistrerOffres, sourceManuelle } from './offres.js';
import { recupererPour } from './synchronisation.js';
import { verifierUrl } from './recuperation.js';

/**
 * Importe un fichier CSV dans une source.
 *
 * @returns {Promise<{ recues: number, nouvelles: number, misesAJour: number, erreurs: object[] }>}
 */
export async function importerCsv(source, texte, { utilisateurId = null, maintenant = new Date() } = {}) {
  const { offres, erreurs } = analyserCsv(texte);
  const sync = await db.synchronisationSource.create({ data: { sourceId: source.id, declenchement: 'import', declencheParId: utilisateurId, debut: maintenant } });
  const { nouvelles, misesAJour, ignorees } = await enregistrerOffres(source, offres, { maintenant });
  await alerterNouvellesOffres(nouvelles, { maintenant });
  const etat = erreurs.length ? 'partielle' : 'ok';
  const resume = `Import CSV : ${offres.length} ligne(s), ${nouvelles.length} nouvelle(s), ${misesAJour} mise(s) à jour${erreurs.length ? `, ${erreurs.length} refusée(s)` : ''}`;
  await db.synchronisationSource.update({ where: { id: sync.id }, data: { fin: new Date(), etat, recues: offres.length, nouvelles: nouvelles.length, misesAJour, erreur: erreurs.length ? erreurs.slice(0, 20).map((e) => `ligne ${e.ligne} : ${e.message}`).join(' ; ') : null } });
  await db.sourceMarches.update({ where: { id: source.id }, data: { derniereSyncLe: maintenant, derniereSyncEtat: etat, derniereSyncResume: resume.slice(0, 255) } });
  return { recues: offres.length, nouvelles: nouvelles.length, misesAJour, ignorees, erreurs };
}

/** La source qui « possède » une adresse d'annonce : celle de son connecteur, sinon l'import manuel. */
async function sourcePourAdresse(adresse) {
  await assurerInitialisation();
  const connecteur = connecteurPourAdresse(adresse);
  if (connecteur) {
    const source = await db.sourceMarches.findFirst({ where: { connecteur: connecteur.code }, orderBy: { id: 'asc' } });
    if (source) return { source, connecteur };
  }
  return { source: await sourceManuelle(), connecteur: null };
}

/**
 * Pré-remplir une offre depuis l'adresse de son annonce : une seule page
 * lue, à la demande de l'utilisateur, seulement si un connecteur sait la lire.
 * Sinon on rend l'adresse : l'utilisateur complète lui-même.
 */
export async function apercuAdresse(adresse) {
  verifierUrl(adresse);
  const { source, connecteur } = await sourcePourAdresse(adresse);
  if (!connecteur?.detail) return { reconnue: false, offre: { urlOfficielle: adresse } };
  const brute = await connecteur.detail({ adresse, recuperer: recupererPour(source) });
  return { reconnue: true, offre: brute };
}

/**
 * Crée (ou complète) une offre saisie à la main. Une adresse du portail garde
 * l'identifiant du portail : la future synchronisation ne la doublera pas.
 */
export async function creerOffreManuelle(donnees, { maintenant = new Date() } = {}) {
  const { source } = await sourcePourAdresse(donnees.urlOfficielle);
  const cles = clesConsultation(donnees.urlOfficielle);
  const brute = { ...donnees, idExterne: cles ? `pmmp-${cles.org}-${cles.ref}` : null };
  const { nouvelles } = await enregistrerOffres(source, [brute], { maintenant });
  await alerterNouvellesOffres(nouvelles, { maintenant });
  const offre = nouvelles[0] ?? (await db.offrePotentielle.findFirst({ where: { sourceId: source.id, urlOfficielle: donnees.urlOfficielle }, orderBy: { id: 'desc' } }));
  return { offre, creee: Boolean(nouvelles[0]) };
}

/** Relit l'annonce officielle d'une offre et met à jour ses informations. */
export async function actualiserOffre(offre, { maintenant = new Date() } = {}) {
  const source = await db.sourceMarches.findUnique({ where: { id: offre.sourceId } });
  const connecteur = connecteurDe(source.connecteur)?.detail ? connecteurDe(source.connecteur) : connecteurPourAdresse(offre.urlOfficielle ?? '');
  if (!connecteur?.detail || !offre.urlOfficielle) throw new Error('Cette offre ne peut pas être relue automatiquement : ouvrez l’annonce officielle.');
  const brute = await connecteur.detail({ adresse: offre.urlOfficielle, recuperer: recupererPour(source) });
  await enregistrerOffres(source, [{ ...brute, idExterne: offre.idExterne }], { maintenant });
  return db.offrePotentielle.findUnique({ where: { id: offre.id } });
}

/**
 * Verse dans la GED un document public annoncé par l'offre, à la demande
 * explicite de l'utilisateur : le lien doit être l'un de ceux de l'offre, et
 * mener directement à un fichier (PDF…). Provenance et empreinte conservées ;
 * un doublon exact n'est jamais versé deux fois.
 */
export async function importerDocument(offre, adresse, { utilisateurId }) {
  const annonce = (offre.documents ?? []).find((d) => d.url === adresse);
  if (!annonce) throw new Error('Ce lien ne fait pas partie des documents de l’offre.');
  const source = await db.sourceMarches.findUnique({ where: { id: offre.sourceId } });
  const { octets, type } = await recupererPour(source)(adresse, { binaire: true, tailleMax: 50 * 1024 * 1024, accepte: 'application/pdf,application/octet-stream;q=0.8,*/*;q=0.1' });
  const estPdf = /pdf/i.test(type ?? '') || octets.subarray(0, 5).toString('latin1') === '%PDF-';
  if (!estPdf) throw new Error('Ce lien ne mène pas directement à un document public (le portail demande sans doute un formulaire ou une identification) : téléchargez-le depuis l’annonce officielle.');
  const nom = `${(annonce.nom || 'document').replace(/[^\p{L}\p{N} ._-]+/gu, ' ').trim().slice(0, 120) || 'document'}.pdf`;
  const provisoire = path.join(os.tmpdir(), `icity-veille-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(provisoire, octets);
  try {
    return await verserFichier(provisoire, { nomOrigine: nom, marcheId: offre.marcheId ?? null, source: 'veille', verseParId: utilisateurId, urlProvenance: adresse });
  } finally {
    await fs.rm(provisoire, { force: true });
  }
}
