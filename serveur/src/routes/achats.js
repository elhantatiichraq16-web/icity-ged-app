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
} from '@icity/commun/achats';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger } from '../plugins/authentification.js';
import { importerClasseurAchats } from '../services/import-achats.js';
import { journaliser } from '../services/journal.js';
import { ErreurClasseur } from '../services/lecture-xlsx.js';
import { nomFichier, versCsv } from '../services/export-csv.js';

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
    lignes: (c.lignes ?? []).map((l) => ({ id: l.id, numero: l.numero, designation: l.designation })),
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
  const existant = await db.fournisseur.findFirst({ where: { nom: { equals: nom, mode: 'insensitive' } } });
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
  app.get('/api/achats/export.csv', { preHandler: exiger('lire', 'Achat') }, async (requete, reponse) => {
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
    const csv = versCsv({
      colonnes,
      lignes: lignes.map((l) => ({
        ...l,
        marche: l.marche?.reference ?? '',
        fournisseurNom: l.fournisseur?.nom ?? '',
        statutNom: statutAchat(l.statut).nom,
        margePct: l.marge === null || l.marge === undefined ? '' : Math.round(l.marge * 1000) / 10,
      })),
    });
    return reponse.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${nomFichier('achats')}"`).send(csv);
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

  // ── Les commandes et leur paiement ────────────────────────────
  const INCLURE_COMMANDE = {
    marche: { select: { id: true, reference: true, objet: true } },
    fournisseur: { select: { id: true, nom: true } },
    lignes: { select: { id: true, numero: true, designation: true }, orderBy: { ordre: 'asc' } },
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
