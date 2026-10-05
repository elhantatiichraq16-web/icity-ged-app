/**
 * Les achats : les lignes de matériel de chaque marché, les fournisseurs,
 * les commandes et leur paiement, l'import du classeur Excel et l'export.
 *
 * Chacun voit le matériel et où en est sa commande. Les prix, les marges,
 * les conditions de paiement et les commandes ne sortent d'ici que pour qui
 * peut « lire PrixAchat » — les achats et la direction. Le filtre est fait
 * au serveur : un prix seulement masqué à l'écran resterait lisible dans le
 * navigateur.
 */
import {
  alertesLigne,
  CODES_STATUT_ACHAT,
  controleFacture,
  etapeCommande,
  fournisseurDuNom,
  marge,
  modalitePaiement,
  paiementCommande,
  resumeAchats,
  schemaCommande,
  schemaFournisseur,
  schemaLigneAchat,
  schemaModificationCommande,
  schemaModificationLigneAchat,
  statutAchat,
  total,
  TVA,
} from '@icity/commun/achats';
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { schemaContactClient } from '@icity/commun/schemas';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger } from '../plugins/authentification.js';
import { genererBonCommande, numeroBonCommande } from '../services/bon-commande.js';
import { envoyerMail } from '../services/courriel-sortant.js';
import { importerClasseurAchats } from '../services/import-achats.js';
import { journaliser } from '../services/journal.js';
import { ErreurClasseur } from '../services/lecture-xlsx.js';
import { enregistrerExport } from '../services/export-csv.js';
import { FORMATS, TAILLE_MAX, verserFichier } from '../services/stockage.js';
import { appliquerPiece } from '../services/suivi-achats.js';

const TAILLE_MAX_CLASSEUR = 10 * 1024 * 1024;
const INCLURE = {
  marche: { select: { id: true, reference: true, objet: true } },
  fournisseur: { select: { id: true, nom: true } },
  statutModifiePar: { select: { id: true, nom: true } },
};

const nombre = (d) => (d === null || d === undefined ? null : Number(d));
const jour = (d) => (d ? d.toISOString().slice(0, 10) : null);
const versDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`) : iso === null ? null : undefined);
/** Aujourd'hui, au Maroc. */
const aujourdhui = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());

/** Les champs numériques d'une ligne, pour les calculs de commun/achats.js. */
const pourCalcul = (l) => ({
  ...l,
  quantite: nombre(l.quantite),
  puBudget: nombre(l.puBudget),
  puAchat: nombre(l.puAchat),
  puVente: nombre(l.puVente),
  etd: jour(l.etd),
});

function vueLigne(l, prix) {
  const calcul = pourCalcul(l);
  const vue = {
    id: l.id,
    marche: l.marche ?? null,
    numero: l.numero,
    categorie: l.categorie,
    designation: l.designation,
    quantite: calcul.quantite,
    marque: l.marque,
    referenceOffre: l.referenceOffre,
    referenceAchat: l.referenceAchat,
    fournisseur: l.fournisseur ?? null,
    delaiLivraison: l.delaiLivraison,
    statut: l.statut,
    etd: calcul.etd,
    commentaire: l.commentaire,
    commandeId: l.commandeId,
    statutModifieLe: l.statutModifieLe,
    statutModifiePar: l.statutModifiePar ?? null,
    alertes: alertesLigne(calcul, { aujourdhui: aujourdhui(), prix }),
  };
  if (!prix) return vue;
  return {
    ...vue,
    puBudget: calcul.puBudget,
    puAchat: calcul.puAchat,
    puVente: calcul.puVente,
    totalBudget: total(calcul.puBudget, calcul.quantite),
    totalAchat: total(calcul.puAchat, calcul.quantite),
    totalVente: total(calcul.puVente, calcul.quantite),
    marge: marge(calcul.puAchat, calcul.puVente),
    conditionsPaiement: l.conditionsPaiement,
  };
}

function vueCommande(c) {
  const calcul = {
    montantTtc: nombre(c.montantTtc),
    avancePourcent: nombre(c.avancePourcent),
    modalite: c.modalite,
    dateFacture: jour(c.dateFacture),
    echeance: jour(c.echeance),
    avancePayeeLe: jour(c.avancePayeeLe),
    soldePayeLe: jour(c.soldePayeLe),
  };
  return {
    id: c.id,
    marche: c.marche ?? null,
    fournisseur: c.fournisseur ?? null,
    ...calcul,
    echeanceSaisie: calcul.echeance,
    notes: c.notes,
    dateCommande: jour(c.dateCommande),
    lignes: (c.lignes ?? []).map((l) => ({ id: l.id, numero: l.numero, designation: l.designation, statut: l.statut })),
    // Le contrôle de la facture : commandé, reçu, facturé (comme Odoo).
    controle: controleFacture({ montantTtc: calcul.montantTtc, dateFacture: calcul.dateFacture, lignes: (c.lignes ?? []).map((l) => ({ quantite: nombre(l.quantite), puAchat: nombre(l.puAchat), statut: l.statut })) }),
    // L'étape du Kanban : déduite des dates et des lignes, jamais saisie.
    etape: etapeCommande({ soldePayeLe: calcul.soldePayeLe, dateFacture: calcul.dateFacture, dateCommande: jour(c.dateCommande), lignes: c.lignes }),
    ...paiementCommande(calcul),
  };
}

/** Les champs d'une ligne tels que Prisma les attend. */
function champsLigne(d) {
  const { fournisseur: _nom, etd, ...reste } = d;
  const data = { ...reste };
  if (etd !== undefined) data.etd = versDate(etd);
  return data;
}

/** Un fournisseur retrouvé par son nom, sans tenir compte des majuscules, ou créé. */
async function fournisseurParNom(nom, requete) {
  if (!nom) return null;
  const existant = fournisseurDuNom(nom, await db.fournisseur.findMany({ select: { id: true, nom: true, synonymes: true } }));
  if (existant) return existant.id;
  const cree = await db.fournisseur.create({ data: { nom } });
  await journaliser({ utilisateurId: requete.utilisateur.id, action: 'fournisseur.cree', objetType: 'Fournisseur', objetId: cree.id, apres: { nom }, ip: requete.ip }, requete.log);
  return cree.id;
}

async function marcheExistant(marcheId) {
  if (!(await db.marche.findUnique({ where: { id: marcheId } }))) {
    throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { marcheId: 'Ce marché n’existe pas.' } });
  }
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesAchats(app) {
  // ── Les lignes ────────────────────────────────────────────────
  async function listerLignes(requete) {
    const prix = requete.droits.can('lire', 'PrixAchat');
    const { marcheId, statut, fournisseurId, q } = requete.query;
    const recherche = q ? String(q).trim() : '';
    const lignes = await db.ligneAchat.findMany({
      where: {
        ...(marcheId ? { marcheId: Number(marcheId) || 0 } : {}),
        ...(statut && CODES_STATUT_ACHAT.includes(statut) ? { statut } : {}),
        ...(fournisseurId ? { fournisseurId: Number(fournisseurId) || 0 } : {}),
        ...(recherche
          ? {
              OR: ['designation', 'categorie', 'marque', 'referenceOffre', 'referenceAchat', 'numero'].map((champ) => ({ [champ]: { contains: recherche, mode: 'insensitive' } })),
            }
          : {}),
      },
      include: INCLURE,
      orderBy: [{ marcheId: 'asc' }, { ordre: 'asc' }, { id: 'asc' }],
    });
    const resume = resumeAchats(lignes.map(pourCalcul), { aujourdhui: aujourdhui() });
    if (!prix) {
      for (const cle of ['budget', 'achat', 'vente', 'marge', 'lignesSansAchat']) delete resume[cle];
    }
    return { prix, lignes: lignes.map((l) => vueLigne(l, prix)), resume };
  }

  app.get('/api/achats', { preHandler: exiger('lire', 'Achat') }, listerLignes);

  /** Les marchés qui ont des achats, pour le filtre de l'écran. */
  app.get('/api/achats/marches', { preHandler: exiger('lire', 'Achat') }, async () => {
    const groupes = await db.ligneAchat.groupBy({ by: ['marcheId'], _count: { _all: true } });
    // Les achats d'un marché archivé ne sortent pas du filtre courant ; on
    // les retrouve depuis la fiche du marché.
    const marches = await db.marche.findMany({
      where: { id: { in: groupes.map((g) => g.marcheId) }, archiveLe: null },
      select: { id: true, reference: true, objet: true, client: { select: { nom: true } } },
      orderBy: { reference: 'asc' },
    });
    const nb = new Map(groupes.map((g) => [g.marcheId, g._count._all]));
    return marches.map((m) => ({ ...m, nbLignes: nb.get(m.id) ?? 0 }));
  });

  app.post('/api/achats', { preHandler: exiger('gerer', 'Achat') }, async (requete, reponse) => {
    const d = valider(schemaLigneAchat, requete.body);
    await marcheExistant(d.marcheId);
    const dernier = await db.ligneAchat.aggregate({ where: { marcheId: d.marcheId }, _max: { ordre: true } });
    const cree = await db.ligneAchat.create({
      data: {
        ...champsLigne(d),
        fournisseurId: await fournisseurParNom(d.fournisseur, requete),
        ordre: (dernier._max.ordre ?? 0) + 1,
        statutModifieLe: new Date(),
        statutModifieParId: requete.utilisateur.id,
      },
      include: INCLURE,
    });
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'achat.cree', objetType: 'LigneAchat', objetId: cree.id, apres: { designation: cree.designation, statut: cree.statut }, ip: requete.ip },
      requete.log,
    );
    return reponse.code(201).send(vueLigne(cree, true));
  });

  app.patch('/api/achats/:id', { preHandler: exiger('gerer', 'Achat') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const avant = await db.ligneAchat.findUnique({ where: { id } });
    if (!avant) throw introuvable('Ligne d’achat');
    const d = valider(schemaModificationLigneAchat, requete.body);
    if (d.marcheId) await marcheExistant(d.marcheId);

    const data = champsLigne(d);
    if ('fournisseur' in d) data.fournisseurId = await fournisseurParNom(d.fournisseur, requete);
    const changeStatut = d.statut && d.statut !== avant.statut;
    if (changeStatut) {
      data.statutModifieLe = new Date();
      data.statutModifieParId = requete.utilisateur.id;
    }
    const apres = await db.ligneAchat.update({ where: { id }, data, include: INCLURE });

    const modifies = Object.keys(d).filter((cle) => cle !== 'fournisseur');
    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: changeStatut ? 'achat.statut' : 'achat.modifie',
        objetType: 'LigneAchat',
        objetId: id,
        avant: Object.fromEntries(modifies.map((c) => [c, avant[c] ?? null])),
        apres: Object.fromEntries(modifies.map((c) => [c, d[c] ?? null])),
        commentaire: changeStatut ? `${statutAchat(avant.statut).nom} → ${statutAchat(d.statut).nom}` : undefined,
        ip: requete.ip,
      },
      requete.log,
    );
    return vueLigne(apres, true);
  });

  app.delete('/api/achats/:id', { preHandler: exiger('gerer', 'Achat') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const ligne = await db.ligneAchat.findUnique({ where: { id } });
    if (!ligne) throw introuvable('Ligne d’achat');
    await db.ligneAchat.delete({ where: { id } });
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'achat.supprime', objetType: 'LigneAchat', objetId: id, avant: { designation: ligne.designation, marcheId: ligne.marcheId }, ip: requete.ip },
      requete.log,
    );
    return { ok: true };
  });

  /** Les lignes en CSV, pour Excel : les prix seulement pour qui peut les voir. */
  enregistrerExport(app, {
    chemin: '/api/achats',
    options: { preHandler: exiger('lire', 'Achat') },
    base: 'achats',
    feuille: 'Achats',
    construire: async (requete) => {
      const { prix, lignes } = await listerLignes(requete);
      const colonnes = [
        { cle: 'marche', titre: 'Marché' },
        { cle: 'numero', titre: 'N°' },
        { cle: 'categorie', titre: 'Catégorie' },
        { cle: 'designation', titre: 'Matériel' },
        { cle: 'quantite', titre: 'Qté' },
        ...(prix
          ? [
              { cle: 'puBudget', titre: 'P.U. AO' },
              { cle: 'totalBudget', titre: 'P.T. AO' },
              { cle: 'puAchat', titre: 'P.U. achat' },
              { cle: 'totalAchat', titre: 'P.T. achat' },
              { cle: 'puVente', titre: 'P.U. vente' },
              { cle: 'totalVente', titre: 'P.T. vente' },
              { cle: 'margePct', titre: 'Marge %' },
            ]
          : []),
        { cle: 'marque', titre: 'Marque' },
        { cle: 'referenceOffre', titre: 'Réf. offre technique' },
        { cle: 'referenceAchat', titre: 'Réf. achat' },
        { cle: 'fournisseurNom', titre: 'Fournisseur' },
        ...(prix ? [{ cle: 'conditionsPaiement', titre: 'Conditions de paiement' }] : []),
        { cle: 'delaiLivraison', titre: 'Délai de livraison' },
        { cle: 'statutNom', titre: 'Statut' },
        { cle: 'etd', titre: 'Livraison prévue' },
        { cle: 'commentaire', titre: 'Commentaire' },
      ];
      return {
        colonnes,
        lignes: lignes.map((l) => ({
          ...l,
          marche: l.marche?.reference ?? '',
          fournisseurNom: l.fournisseur?.nom ?? '',
          statutNom: statutAchat(l.statut).nom,
          margePct: l.marge === null || l.marge === undefined ? '' : Math.round(l.marge * 1000) / 10,
        })),
      };
    },
  });

  // ── L'import du classeur ──────────────────────────────────────
  app.post('/api/achats/import', { preHandler: exiger('gerer', 'Achat') }, async (requete) => {
    const fichier = await requete.file({ limits: { fileSize: TAILLE_MAX_CLASSEUR } });
    if (!fichier) throw new ErreurHttp(422, 'Aucun fichier reçu.');
    const champ = fichier.fields?.marcheId;
    const marcheId = Number(Array.isArray(champ) ? champ[0]?.value : champ?.value) || 0;
    if (!/\.xlsx$/i.test(fichier.filename ?? '')) throw new ErreurHttp(422, 'Choisissez un classeur Excel (.xlsx).');
    const tampon = await fichier.toBuffer();
    if (fichier.file.truncated) throw new ErreurHttp(413, 'Classeur trop lourd : 10 Mo au plus.');
    await marcheExistant(marcheId);

    let rapport;
    try {
      rapport = await importerClasseurAchats(tampon, { marcheId, utilisateurId: requete.utilisateur.id });
    } catch (erreur) {
      if (erreur instanceof ErreurClasseur) throw new ErreurHttp(422, erreur.message);
      throw erreur;
    }
    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'achats.import',
        objetType: 'Marche',
        objetId: marcheId,
        apres: { lignes: rapport.lignes, commandes: rapport.commandes, fournisseursCrees: rapport.fournisseursCrees },
        commentaire: fichier.filename,
        ip: requete.ip,
      },
      requete.log,
    );
    return rapport;
  });

  // ── Les fournisseurs ──────────────────────────────────────────
  app.get('/api/fournisseurs', { preHandler: exiger('lire', 'Fournisseur') }, async () => {
    const [fournisseurs, lignes] = await Promise.all([
      db.fournisseur.findMany({ orderBy: { nom: 'asc' } }),
      db.ligneAchat.findMany({ where: { fournisseurId: { not: null } }, select: { fournisseurId: true, quantite: true, puAchat: true } }),
    ]);
    const parFournisseur = new Map();
    for (const l of lignes) {
      const f = parFournisseur.get(l.fournisseurId) ?? { nbLignes: 0, montantAchat: 0 };
      f.nbLignes += 1;
      f.montantAchat += total(nombre(l.puAchat), nombre(l.quantite)) ?? 0;
      parFournisseur.set(l.fournisseurId, f);
    }
    return fournisseurs.map((f) => ({ ...f, ...(parFournisseur.get(f.id) ?? { nbLignes: 0, montantAchat: 0 }) }));
  });

  app.post('/api/fournisseurs', { preHandler: exiger('gerer', 'Fournisseur') }, async (requete, reponse) => {
    const d = valider(schemaFournisseur, requete.body);
    const existant = await db.fournisseur.findFirst({ where: { nom: { equals: d.nom, mode: 'insensitive' } } });
    if (existant) throw new ErreurHttp(409, 'Ce fournisseur existe déjà.', { erreurs: { nom: `« ${existant.nom} » est déjà dans la liste.` } });
    const cree = await db.fournisseur.create({ data: d });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'fournisseur.cree', objetType: 'Fournisseur', objetId: cree.id, apres: { nom: cree.nom }, ip: requete.ip }, requete.log);
    return reponse.code(201).send({ ...cree, nbLignes: 0, montantAchat: 0 });
  });

  app.patch('/api/fournisseurs/:id', { preHandler: exiger('gerer', 'Fournisseur') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const avant = await db.fournisseur.findUnique({ where: { id } });
    if (!avant) throw introuvable('Fournisseur');
    const d = valider(schemaFournisseur.partial(), requete.body);
    if (d.nom) {
      const homonyme = await db.fournisseur.findFirst({ where: { nom: { equals: d.nom, mode: 'insensitive' }, id: { not: id } } });
      if (homonyme) throw new ErreurHttp(409, 'Ce fournisseur existe déjà.', { erreurs: { nom: `« ${homonyme.nom} » est déjà dans la liste.` } });
    }
    const apres = await db.fournisseur.update({ where: { id }, data: d });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'fournisseur.modifie', objetType: 'Fournisseur', objetId: id, avant: { nom: avant.nom }, apres: d, ip: requete.ip }, requete.log);
    return apres;
  });

  // ── La fiche d'un fournisseur, sur le modèle d'Odoo ───────────
  /** Une personne à joindre chez un fournisseur. */
  const vueContact = (p) => ({ id: p.id, nom: p.nom, fonction: p.fonction, telephone: p.telephone, mobile: p.mobile, email: p.email, notes: p.notes });

  app.get('/api/fournisseurs/:id', { preHandler: exiger('lire', 'Fournisseur') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const f = await db.fournisseur.findUnique({ where: { id }, include: { contacts: { orderBy: { nom: 'asc' } } } });
    if (!f) throw introuvable('Fournisseur');
    const prix = requete.droits.can('lire', 'PrixAchat');
    const [lignes, commandes] = await Promise.all([
      db.ligneAchat.findMany({ where: { fournisseurId: id }, select: { quantite: true, puAchat: true, marcheId: true, marche: { select: { id: true, reference: true } } } }),
      prix
        ? db.commandeFournisseur.findMany({ where: { fournisseurId: id }, include: INCLURE_COMMANDE, orderBy: { id: 'desc' } })
        : [],
    ]);
    // Les marchés où il fournit, avec le nombre de lignes : les boutons de raccourci.
    const marches = new Map();
    for (const l of lignes) {
      const m = marches.get(l.marcheId) ?? { ...l.marche, nbLignes: 0 };
      m.nbLignes += 1;
      marches.set(l.marcheId, m);
    }
    return {
      ...f,
      synonymes: f.synonymes ?? [],
      contacts: f.contacts.map(vueContact),
      nbLignes: lignes.length,
      montantAchat: prix ? lignes.reduce((t, l) => t + (total(nombre(l.puAchat), nombre(l.quantite)) ?? 0), 0) : null,
      marches: [...marches.values()],
      commandes: commandes.map(vueCommande),
    };
  });

  app.post('/api/fournisseurs/:id/contacts', { preHandler: exiger('gerer', 'Fournisseur') }, async (requete, reponse) => {
    const fournisseurId = Number(requete.params.id) || 0;
    if (!(await db.fournisseur.findUnique({ where: { id: fournisseurId } }))) throw introuvable('Fournisseur');
    const donnees = valider(schemaContactClient, requete.body);
    const cree = await db.contactFournisseur.create({ data: { ...donnees, fournisseurId } });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'fournisseur.contact_ajoute', objetType: 'Fournisseur', objetId: fournisseurId, apres: { nom: cree.nom, fonction: cree.fonction }, ip: requete.ip }, requete.log);
    return reponse.code(201).send(vueContact(cree));
  });

  app.patch('/api/contacts-fournisseurs/:id', { preHandler: exiger('gerer', 'Fournisseur') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const avant = await db.contactFournisseur.findUnique({ where: { id } });
    if (!avant) throw introuvable('Contact');
    const apres = await db.contactFournisseur.update({ where: { id }, data: valider(schemaContactClient, requete.body) });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'fournisseur.contact_modifie', objetType: 'Fournisseur', objetId: avant.fournisseurId, avant: vueContact(avant), apres: vueContact(apres), ip: requete.ip }, requete.log);
    return vueContact(apres);
  });

  app.delete('/api/contacts-fournisseurs/:id', { preHandler: exiger('gerer', 'Fournisseur') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const contact = await db.contactFournisseur.findUnique({ where: { id } });
    if (!contact) throw introuvable('Contact');
    await db.contactFournisseur.delete({ where: { id } });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'fournisseur.contact_retire', objetType: 'Fournisseur', objetId: contact.fournisseurId, avant: vueContact(contact), ip: requete.ip }, requete.log);
    return { ok: true };
  });

  /**
   * Fusionner deux fournisseurs : « MEDITEN / CYBIONET » dans « CYBIONET ».
   *
   * Tout ce que porte le doublon passe sur celui qu'on garde — lignes,
   * commandes, contacts, activités, et les champs que la fiche gardée n'a
   * pas. Son nom devient une « autre écriture » : le prochain import le
   * reconnaîtra au lieu de le recréer. Puis le doublon disparaît.
   */
  app.post('/api/fournisseurs/:id/fusionner', { preHandler: exiger('gerer', 'Fournisseur') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const { versId } = valider(z.object({ versId: z.number({ error: 'Choisissez le fournisseur à garder.' }).int().positive() }), requete.body);
    if (versId === id) throw new ErreurHttp(422, 'Choisissez un autre fournisseur que lui-même.');
    const [doublon, garde] = await Promise.all([db.fournisseur.findUnique({ where: { id } }), db.fournisseur.findUnique({ where: { id: versId } })]);
    if (!doublon || !garde) throw introuvable('Fournisseur');

    const CHAMPS = ['contact', 'telephone', 'email', 'conditions', 'ice', 'identifiantFiscal', 'registreCommerce', 'adresse', 'codePostal', 'ville', 'pays', 'siteWeb'];
    const complements = Object.fromEntries(CHAMPS.filter((c) => !garde[c] && doublon[c]).map((c) => [c, doublon[c]]));
    const notes = [garde.notes, doublon.notes].filter(Boolean).join('\n\n') || null;
    const synonymes = [...new Set([...(garde.synonymes ?? []), doublon.nom, ...(doublon.synonymes ?? [])])].filter((s) => s.toUpperCase() !== garde.nom.toUpperCase());

    const deplaces = await db.$transaction(async (tx) => {
      const lignes = await tx.ligneAchat.updateMany({ where: { fournisseurId: id }, data: { fournisseurId: versId } });
      const commandes = await tx.commandeFournisseur.updateMany({ where: { fournisseurId: id }, data: { fournisseurId: versId } });
      await tx.contactFournisseur.updateMany({ where: { fournisseurId: id }, data: { fournisseurId: versId } });
      await tx.activite.updateMany({ where: { fournisseurId: id }, data: { fournisseurId: versId } });
      await tx.fournisseur.update({ where: { id: versId }, data: { ...complements, notes, synonymes } });
      await tx.fournisseur.delete({ where: { id } });
      return { lignes: lignes.count, commandes: commandes.count };
    });

    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'fournisseur.fusionne',
        objetType: 'Fournisseur',
        objetId: versId,
        avant: { nom: doublon.nom },
        commentaire: `« ${doublon.nom} » fusionné dans « ${garde.nom} » (${deplaces.lignes} ligne(s), ${deplaces.commandes} commande(s))`,
        ip: requete.ip,
      },
      requete.log,
    );
    return { garde: { id: garde.id, nom: garde.nom }, ...deplaces };
  });

  // ── Les commandes et leur paiement ────────────────────────────
  const INCLURE_COMMANDE = {
    marche: { select: { id: true, reference: true, objet: true } },
    fournisseur: { select: { id: true, nom: true } },
    lignes: { select: { id: true, numero: true, designation: true, statut: true, quantite: true, puAchat: true }, orderBy: { ordre: 'asc' } },
  };

  app.get('/api/commandes-fournisseur', { preHandler: exiger('lire', 'PrixAchat') }, async (requete) => {
    const { marcheId } = requete.query;
    const commandes = await db.commandeFournisseur.findMany({
      where: marcheId ? { marcheId: Number(marcheId) || 0 } : {},
      include: INCLURE_COMMANDE,
      orderBy: [{ dateFacture: 'asc' }, { id: 'asc' }],
    });
    return commandes.map(vueCommande);
  });

  /** Les lignes d'une commande : du même marché, sinon refusées. */
  async function lignesDuMarche(ids, marcheId) {
    if (!ids.length) return [];
    const trouvees = await db.ligneAchat.findMany({ where: { id: { in: ids }, marcheId }, select: { id: true } });
    if (trouvees.length !== new Set(ids).size) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { lignes: 'Ces lignes n’appartiennent pas à ce marché.' } });
    }
    return trouvees.map((l) => l.id);
  }

  function champsCommande(d) {
    const { lignes: _l, dateFacture, echeance, avancePayeeLe, soldePayeLe, avancePourcent, ...reste } = d;
    const data = { ...reste };
    for (const [cle, valeur] of Object.entries({ dateFacture, echeance, avancePayeeLe, soldePayeLe })) {
      if (valeur !== undefined) data[cle] = versDate(valeur);
    }
    if (avancePourcent !== undefined) data.avancePourcent = avancePourcent ?? 0;
    return data;
  }

  app.post('/api/commandes-fournisseur', { preHandler: exiger('gerer', 'Achat') }, async (requete, reponse) => {
    const d = valider(schemaCommande, requete.body);
    await marcheExistant(d.marcheId);
    if (!(await db.fournisseur.findUnique({ where: { id: d.fournisseurId } }))) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { fournisseurId: 'Ce fournisseur n’existe pas.' } });
    }
    const ids = await lignesDuMarche(d.lignes, d.marcheId);
    const cree = await db.commandeFournisseur.create({ data: champsCommande(d) });
    if (ids.length) await db.ligneAchat.updateMany({ where: { id: { in: ids } }, data: { commandeId: cree.id } });
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'commande.creee', objetType: 'CommandeFournisseur', objetId: cree.id, apres: { montantTtc: d.montantTtc, modalite: modalitePaiement(d.modalite).nom }, ip: requete.ip },
      requete.log,
    );
    return reponse.code(201).send(vueCommande(await db.commandeFournisseur.findUnique({ where: { id: cree.id }, include: INCLURE_COMMANDE })));
  });

  app.patch('/api/commandes-fournisseur/:id', { preHandler: exiger('gerer', 'Achat') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const avant = await db.commandeFournisseur.findUnique({ where: { id } });
    if (!avant) throw introuvable('Commande');
    const d = valider(schemaModificationCommande, requete.body);
    const marcheId = d.marcheId ?? avant.marcheId;
    if (d.marcheId) await marcheExistant(d.marcheId);
    if (d.lignes) {
      const ids = await lignesDuMarche(d.lignes, marcheId);
      await db.ligneAchat.updateMany({ where: { commandeId: id, id: { notIn: ids } }, data: { commandeId: null } });
      if (ids.length) await db.ligneAchat.updateMany({ where: { id: { in: ids } }, data: { commandeId: id } });
    }
    await db.commandeFournisseur.update({ where: { id }, data: champsCommande(d) });
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'commande.modifiee', objetType: 'CommandeFournisseur', objetId: id, apres: Object.fromEntries(Object.entries(d).filter(([c]) => c !== 'lignes')), ip: requete.ip },
      requete.log,
    );
    return vueCommande(await db.commandeFournisseur.findUnique({ where: { id }, include: INCLURE_COMMANDE }));
  });

  // ── La fiche d'une commande, sur le modèle d'Odoo ─────────────
  /** Les pièces d'un fournisseur qu'on range sur sa commande. */
  const TYPES_PIECES = { BCF: 'Bon de commande', BLF: 'Bon de livraison', FACF: 'Facture' };

  /**
   * Les pièces d'une commande contiennent ses prix : elles sont rangées en
   * « Confidentiel » (direction et administrateur), et celui qui les verse
   * les voit toujours.
   */
  const CONFIDENTIALITE_PIECES = 'confidentiel';

  /** La commande complète, telle que la fiche la montre. */
  async function chargerCommande(id) {
    const c = await db.commandeFournisseur.findUnique({
      where: { id },
      include: {
        marche: { select: { id: true, reference: true, objet: true } },
        fournisseur: true,
        lignes: { orderBy: { ordre: 'asc' }, include: { fournisseur: { select: { id: true, nom: true } } } },
      },
    });
    if (!c) throw introuvable('Commande');
    return c;
  }

  app.get('/api/commandes-fournisseur/:id', { preHandler: exiger('lire', 'PrixAchat') }, async (requete) => {
    const c = await chargerCommande(Number(requete.params.id) || 0);
    const [pieces, internes] = await Promise.all([
      db.document.findMany({
        where: { commandeFournisseurId: c.id, supprimeLe: null },
        include: { typeDocument: true },
        orderBy: { creeLe: 'asc' },
      }),
      // Les sociétés qui peuvent commander : celles du groupe.
      db.client.findMany({ where: { interne: true }, select: { id: true, nom: true }, orderBy: { nom: 'asc' } }),
    ]);
    const ht = c.lignes.reduce((t, l) => t + (total(nombre(l.puAchat), nombre(l.quantite)) ?? 0), 0);
    return {
      ...vueCommande({ ...c, fournisseur: { id: c.fournisseur.id, nom: c.fournisseur.nom } }),
      numero: numeroBonCommande(c),
      fournisseur: { id: c.fournisseur.id, nom: c.fournisseur.nom, email: c.fournisseur.email, contact: c.fournisseur.contact },
      lignes: c.lignes.map((l) => vueLigne(l, true)),
      totaux: { ht, tva: ht * TVA, ttc: ht * (1 + TVA) },
      pieces: pieces.map((d) => ({ id: d.id, titre: d.titre, type: d.typeDocument?.code ?? null, typeNom: d.typeDocument?.nom ?? null, creeLe: d.creeLe })),
      internes,
    };
  });

  /**
   * Le bon de commande en PDF, rangé comme pièce de la commande (type BCF).
   * Le même contenu le même jour donne le même fichier : on ne le range
   * qu'une fois.
   */
  async function rangerBonCommande(c, emetteurId, requete) {
    const emetteur = emetteurId ? await db.client.findFirst({ where: { id: emetteurId, interne: true } }) : await db.client.findFirst({ where: { interne: true }, orderBy: { nom: 'asc' } });
    const octets = await genererBonCommande({ commande: c, emetteur });
    const numero = numeroBonCommande(c);
    const provisoire = path.join(os.tmpdir(), `icity-bc-${crypto.randomUUID()}.pdf`);
    try {
      await fs.writeFile(provisoire, octets);
      const type = await db.typeDocument.findUnique({ where: { code: 'BCF' } });
      const { document, cree } = await verserFichier(provisoire, {
        titre: `Bon de commande ${numero} — ${c.fournisseur.nom}`,
        nomOrigine: `${numero}.pdf`,
        marcheId: c.marcheId,
        typeDocumentId: type?.id ?? null,
        commandeFournisseurId: c.id,
        confidentialite: CONFIDENTIALITE_PIECES,
        source: 'versement',
        verseParId: requete.utilisateur.id,
      });
      if (cree) {
        await journaliser(
          { utilisateurId: requete.utilisateur.id, action: 'commande.bon_genere', objetType: 'CommandeFournisseur', objetId: c.id, commentaire: numero, ip: requete.ip },
          requete.log,
        );
      }
      return document;
    } finally {
      await fs.rm(provisoire, { force: true });
    }
  }

  app.post('/api/commandes-fournisseur/:id/bon-de-commande', { preHandler: exiger('gerer', 'Achat') }, async (requete, reponse) => {
    const { emetteurId } = valider(z.object({ emetteurId: z.number().int().positive().nullish() }), requete.body ?? {});
    const c = await chargerCommande(Number(requete.params.id) || 0);
    const document = await rangerBonCommande(c, emetteurId, requete);
    return reponse.code(201).send({ document: { id: document.id, titre: document.titre } });
  });

  /**
   * Envoyer le bon de commande au fournisseur, par le compte de messagerie de
   * l'application : le PDF part en pièce jointe, le mail s'archive avec le
   * marché, et la commande passe « Commandée » (ses lignes partent, leur
   * livraison se date d'après le délai du fournisseur).
   */
  app.post('/api/commandes-fournisseur/:id/envoyer', { preHandler: exiger('gerer', 'Achat') }, async (requete) => {
    const donnees = valider(
      z.object({
        emetteurId: z.number().int().positive().nullish(),
        a: z.array(z.email({ error: 'Adresse e-mail invalide.' })).min(1, { error: 'Indiquez l’adresse du fournisseur.' }).max(10),
        objet: z.string().trim().min(2, { error: 'Écrivez l’objet.' }).max(255),
        texte: z.string().trim().min(2, { error: 'Écrivez le message.' }).max(10_000),
      }),
      requete.body,
    );
    const compte = await db.compteMail.findFirst({ where: { actif: true }, orderBy: { id: 'asc' } });
    if (!compte) throw new ErreurHttp(422, 'Aucun compte d’envoi n’est configuré : voyez Paramètres → Comptes mail.');

    const c = await chargerCommande(Number(requete.params.id) || 0);
    const document = await rangerBonCommande(c, donnees.emetteurId, requete);
    let mail;
    try {
      mail = await envoyerMail({ compteId: compte.id, a: donnees.a, objet: donnees.objet, texte: donnees.texte, documentIds: [document.id], marcheId: c.marcheId, log: requete.log });
    } catch (erreur) {
      throw new ErreurHttp(502, 'L’envoi a échoué.', { erreurs: { envoi: erreur.message } });
    }

    const aujourdhuiIso = new Date().toISOString().slice(0, 10);
    const effets = await appliquerPiece({ commande: c, type: 'BCF', date: aujourdhuiIso, document, utilisateurId: requete.utilisateur.id });
    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'commande.envoyee',
        objetType: 'CommandeFournisseur',
        objetId: c.id,
        commentaire: `${numeroBonCommande(c)} envoyé à ${donnees.a.join(', ')}`,
        ip: requete.ip,
      },
      requete.log,
    );
    return { mailId: mail.id, document: { id: document.id, titre: document.titre }, ...effets };
  });

  /**
   * Verser une pièce du fournisseur sur sa commande : un bon de commande
   * signé, un bon de livraison (la réception, totale ou de certaines lignes),
   * une facture. La commande avance d'elle-même (services/suivi-achats.js).
   */
  app.post('/api/commandes-fournisseur/:id/pieces', { preHandler: exiger('gerer', 'Achat') }, async (requete, reponse) => {
    const c = await chargerCommande(Number(requete.params.id) || 0);
    const fichier = await requete.file({ limits: { fileSize: TAILLE_MAX } });
    if (!fichier) throw new ErreurHttp(422, 'Aucun fichier reçu.');
    const extension = path.extname(fichier.filename ?? '').toLowerCase();
    if (!FORMATS[extension]) throw new ErreurHttp(422, `Format refusé : ${extension || 'sans extension'}.`);

    const champ = (nom) => {
      const v = fichier.fields?.[nom];
      return (Array.isArray(v) ? v[0]?.value : v?.value) ?? '';
    };
    const { type, date, lignes } = valider(
      z.object({
        type: z.enum(Object.keys(TYPES_PIECES), { error: 'Choisissez le type de pièce.' }),
        date: z.iso.date({ error: 'Indiquez la date de la pièce.' }),
        lignes: z.array(z.coerce.number().int().positive()).max(500),
      }),
      { type: champ('type'), date: champ('date'), lignes: champ('lignes') ? String(champ('lignes')).split(',').filter(Boolean) : [] },
    );

    const provisoire = path.join(os.tmpdir(), `icity-piece-${crypto.randomUUID()}${extension}`);
    try {
      await pipeline(fichier.file, createWriteStream(provisoire));
      if (fichier.file.truncated) throw new ErreurHttp(413, 'Fichier trop lourd : 50 Mo au plus.');
      const typeDocument = await db.typeDocument.findUnique({ where: { code: type } });
      const { document, cree, doublon } = await verserFichier(provisoire, {
        titre: `${TYPES_PIECES[type]} — ${c.fournisseur.nom}`,
        nomOrigine: fichier.filename,
        marcheId: c.marcheId,
        typeDocumentId: typeDocument?.id ?? null,
        commandeFournisseurId: c.id,
        confidentialite: CONFIDENTIALITE_PIECES,
        source: 'versement',
        verseParId: requete.utilisateur.id,
      });
      if (!cree) {
        return reponse.code(409).send({ message: 'Ce fichier est déjà au fonds, au bit près.', doublon: { id: doublon.id, titre: doublon.titre } });
      }
      const effets = await appliquerPiece({ commande: c, type, date, lignes, document, utilisateurId: requete.utilisateur.id });
      await journaliser(
        {
          utilisateurId: requete.utilisateur.id,
          action: 'commande.piece_versee',
          objetType: 'CommandeFournisseur',
          objetId: c.id,
          commentaire: `${TYPES_PIECES[type]} du ${date}`,
          apres: effets,
          ip: requete.ip,
        },
        requete.log,
      );
      return reponse.code(201).send({ document: { id: document.id, titre: document.titre }, ...effets });
    } finally {
      await fs.rm(provisoire, { force: true });
    }
  });

  /**
   * Dupliquer une commande, comme dans Odoo : le même fournisseur, le même
   * marché, les mêmes conditions — mais ni dates, ni montant, ni lignes.
   */
  app.post('/api/commandes-fournisseur/:id/dupliquer', { preHandler: exiger('gerer', 'Achat') }, async (requete, reponse) => {
    const source = await db.commandeFournisseur.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!source) throw introuvable('Commande');
    const copie = await db.commandeFournisseur.create({
      data: { marcheId: source.marcheId, fournisseurId: source.fournisseurId, modalite: source.modalite, avancePourcent: source.avancePourcent, notes: source.notes },
    });
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'commande.creee', objetType: 'CommandeFournisseur', objetId: copie.id, commentaire: `copie de la commande n° ${source.id}`, ip: requete.ip },
      requete.log,
    );
    return reponse.code(201).send({ id: copie.id });
  });

  app.delete('/api/commandes-fournisseur/:id', { preHandler: exiger('gerer', 'Achat') }, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const commande = await db.commandeFournisseur.findUnique({ where: { id } });
    if (!commande) throw introuvable('Commande');
    await db.commandeFournisseur.delete({ where: { id } });
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'commande.supprimee', objetType: 'CommandeFournisseur', objetId: id, avant: { montantTtc: Number(commande.montantTtc) }, ip: requete.ip },
      requete.log,
    );
    return { ok: true };
  });
}
