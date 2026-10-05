/**
 * Les analyses, comme les vues Graphique et Tableau croisé d'Odoo : une
 * mesure (un nombre, un montant), regroupée en lignes et, au besoin, en
 * colonnes.
 *
 * Trois jeux de données : les marchés, les lignes d'achat, les commandes.
 * Les montants d'achat, de vente et de paiement restent aux achats et à la
 * direction : sans ce droit, seuls les comptages sont proposés.
 *
 * Les volumes sont ceux d'une PME (quelques centaines de lignes) : tout se
 * calcule ici, en JavaScript, à partir des lignes lues une fois.
 */
import { etapeCommande, ETAPES_COMMANDE, ETATS_PAIEMENT, paiementCommande, statutAchat, total } from '@icity/commun/achats';
import { estAppelOffres, PHASES, phaseDe } from '@icity/commun/marches';
import { db } from '../db.js';
import { ErreurHttp } from '../erreurs.js';
import { exigerConnexion } from '../plugins/authentification.js';
import { versXlsx } from '../services/ecriture-xlsx.js';
import { nomFichier } from '../services/export-csv.js';
import { codesParMarche, piecesParMarche } from '../services/phase-marche.js';

const nombre = (d) => (d === null || d === undefined ? null : Number(d));
const jour = (d) => (d ? d.toISOString().slice(0, 10) : null);
const mois = (d) => (d ? d.toISOString().slice(0, 7) : 'Sans date');
const annee = (d) => (d ? String(d.getUTCFullYear()) : 'Sans date');

/**
 * Les jeux de données : leurs regroupements (un libellé par ligne lue) et
 * leurs mesures (une valeur par ligne, additionnée). `prix` : réservée à qui
 * voit les prix d'achat.
 */
const JEUX = {
  marches: {
    nom: 'Marchés',
    droit: null,
    async lire({ archives }) {
      const marches = await db.marche.findMany({
        where: archives ? {} : { archiveLe: null },
        include: { client: { select: { nom: true } }, responsable: { select: { nom: true } } },
      });
      const ids = marches.map((m) => m.id);
      const [pieces, codes] = await Promise.all([piecesParMarche(ids), codesParMarche(ids)]);
      return marches.map((m) => ({ ...m, phaseCalculee: phaseDe(pieces.get(m.id) ?? {}), appelOffres: estAppelOffres(codes.get(m.id) ?? [], m.statutAffaire) }));
    },
    regroupements: {
      client: { nom: 'Client', valeur: (m) => m.client?.nom ?? 'Sans client' },
      phase: { nom: 'Phase', valeur: (m) => (m.appelOffres ? 'Appel d’offres' : (PHASES[m.phaseCalculee]?.nom ?? m.phaseCalculee)) },
      statut: { nom: 'Statut', valeur: (m) => m.statutAffaire ?? 'Sans statut' },
      ville: { nom: 'Ville', valeur: (m) => m.ville ?? 'Sans ville' },
      objetTechnique: { nom: 'Objet technique', valeur: (m) => m.objetTechnique ?? 'Non précisé' },
      responsable: { nom: 'Responsable', valeur: (m) => m.responsable?.nom ?? 'Sans responsable' },
      anneeSignature: { nom: 'Année de signature', valeur: (m) => annee(m.dateSignature) },
      anneeCreation: { nom: 'Année de création', valeur: (m) => annee(m.creeLe) },
      archive: { nom: 'En cours ou archivé', valeur: (m) => (m.archiveLe ? 'Archivé' : 'En cours') },
    },
    mesures: {
      nombre: { nom: 'Nombre de marchés', valeur: () => 1 },
      montantTtc: { nom: 'Montant TTC', valeur: (m) => nombre(m.montantTtc) ?? 0, monnaie: true },
      montantHt: { nom: 'Montant HT', valeur: (m) => nombre(m.montantHt) ?? 0, monnaie: true },
    },
  },

  achats: {
    nom: 'Achats (lignes)',
    droit: ['lire', 'Achat'],
    async lire({ archives }) {
      return db.ligneAchat.findMany({
        where: archives ? {} : { marche: { archiveLe: null } },
        include: { fournisseur: { select: { nom: true } }, marche: { select: { reference: true } } },
      });
    },
    regroupements: {
      fournisseur: { nom: 'Fournisseur', valeur: (l) => l.fournisseur?.nom ?? 'Sans fournisseur' },
      marche: { nom: 'Marché', valeur: (l) => l.marche?.reference ?? '—' },
      categorie: { nom: 'Catégorie', valeur: (l) => l.categorie ?? 'Sans catégorie' },
      statut: { nom: 'Statut', valeur: (l) => statutAchat(l.statut).nom },
      moisLivraison: { nom: 'Mois de livraison prévue', valeur: (l) => mois(l.etd) },
    },
    mesures: {
      nombre: { nom: 'Nombre de lignes', valeur: () => 1 },
      quantite: { nom: 'Quantité', valeur: (l) => nombre(l.quantite) ?? 0 },
      achat: { nom: 'Achat HT', valeur: (l) => total(nombre(l.puAchat), nombre(l.quantite)) ?? 0, monnaie: true, prix: true },
      vente: { nom: 'Vente HT', valeur: (l) => total(nombre(l.puVente), nombre(l.quantite)) ?? 0, monnaie: true, prix: true },
      marge: {
        nom: 'Marge HT',
        valeur: (l) => {
          const a = total(nombre(l.puAchat), nombre(l.quantite));
          const v = total(nombre(l.puVente), nombre(l.quantite));
          return a === null || v === null ? 0 : v - a;
        },
        monnaie: true,
        prix: true,
      },
    },
  },

  commandes: {
    nom: 'Commandes',
    droit: ['lire', 'PrixAchat'],
    async lire({ archives }) {
      const commandes = await db.commandeFournisseur.findMany({
        where: archives ? {} : { marche: { archiveLe: null } },
        include: { fournisseur: { select: { nom: true } }, marche: { select: { reference: true } }, lignes: { select: { statut: true } } },
      });
      return commandes.map((c) => {
        const p = paiementCommande({
          montantTtc: nombre(c.montantTtc),
          avancePourcent: nombre(c.avancePourcent),
          modalite: c.modalite,
          dateFacture: jour(c.dateFacture),
          echeance: jour(c.echeance),
          avancePayeeLe: jour(c.avancePayeeLe),
          soldePayeLe: jour(c.soldePayeLe),
        });
        const etape = etapeCommande({ soldePayeLe: jour(c.soldePayeLe), dateFacture: jour(c.dateFacture), dateCommande: jour(c.dateCommande), lignes: c.lignes });
        return { ...c, paiement: p, etape };
      });
    },
    regroupements: {
      fournisseur: { nom: 'Fournisseur', valeur: (c) => c.fournisseur?.nom ?? '—' },
      marche: { nom: 'Marché', valeur: (c) => c.marche?.reference ?? '—' },
      etape: { nom: 'Étape', valeur: (c) => ETAPES_COMMANDE.find((e) => e.code === c.etape)?.nom ?? c.etape },
      paiement: { nom: 'Paiement', valeur: (c) => ETATS_PAIEMENT[c.paiement.etat]?.nom ?? c.paiement.etat },
      moisCommande: { nom: 'Mois de commande', valeur: (c) => mois(c.dateCommande) },
      moisEcheance: { nom: 'Mois d’échéance', valeur: (c) => (c.paiement.echeance ? c.paiement.echeance.slice(0, 7) : 'Sans échéance') },
    },
    mesures: {
      nombre: { nom: 'Nombre de commandes', valeur: () => 1 },
      montantTtc: { nom: 'Montant TTC', valeur: (c) => nombre(c.montantTtc) ?? 0, monnaie: true },
      reste: { nom: 'Reste à payer', valeur: (c) => (c.paiement.etat === 'soldee' ? 0 : c.paiement.etat === 'avance_a_payer' ? c.paiement.avance + c.paiement.reste : c.paiement.reste), monnaie: true },
    },
  },
};

/** Le jeu, ses regroupements et mesures permis à cet utilisateur. */
function jeuPermis(requete) {
  const jeu = JEUX[requete.params.jeu];
  if (!jeu || (jeu.droit && !requete.droits.can(...jeu.droit))) throw new ErreurHttp(404, 'Ces données n’existent pas, ou vous n’y avez pas accès.');
  const prix = requete.droits.can('lire', 'PrixAchat');
  const mesures = Object.fromEntries(Object.entries(jeu.mesures).filter(([, m]) => !m.prix || prix));
  return { jeu, mesures };
}

/** Le tableau croisé : les lignes, les colonnes, les valeurs et leurs totaux. */
async function calculer(requete) {
  const { jeu, mesures } = jeuPermis(requete);
  const { lignes: dimLignes, colonnes: dimColonnes, mesure: cleMesure, archives } = requete.query;
  const rl = jeu.regroupements[dimLignes] ?? Object.values(jeu.regroupements)[0];
  const rc = dimColonnes ? jeu.regroupements[dimColonnes] : null;
  const m = mesures[cleMesure] ?? Object.values(mesures)[0];

  const donnees = await jeu.lire({ archives: archives === '1' || archives === 'true' });
  const valeurs = new Map();
  const totauxLignes = new Map();
  const totauxColonnes = new Map();
  let general = 0;
  for (const d of donnees) {
    const l = rl.valeur(d);
    const c = rc ? rc.valeur(d) : 'Total';
    const v = m.valeur(d);
    const ligne = valeurs.get(l) ?? new Map();
    ligne.set(c, (ligne.get(c) ?? 0) + v);
    valeurs.set(l, ligne);
    totauxLignes.set(l, (totauxLignes.get(l) ?? 0) + v);
    totauxColonnes.set(c, (totauxColonnes.get(c) ?? 0) + v);
    general += v;
  }
  // Les lignes de la plus grosse à la plus petite (comme Odoo trie un graphique) ;
  // les mois et les années, eux, dans l'ordre du temps.
  const temporel = (cle) => /^(mois|annee)/i.test(cle ?? '');
  const ordonner = (cles, totaux, dimension) =>
    [...cles].sort((a, b) => (temporel(dimension) ? String(a).localeCompare(String(b)) : totaux.get(b) - totaux.get(a) || String(a).localeCompare(String(b), 'fr')));
  const lignes = ordonner(valeurs.keys(), totauxLignes, dimLignes);
  const colonnes = rc ? ordonner(totauxColonnes.keys(), totauxColonnes, dimColonnes) : ['Total'];
  const arrondi = (n) => Math.round(n * 100) / 100;
  return {
    titre: `${m.nom} par ${rl.nom.toLowerCase()}${rc ? ` et par ${rc.nom.toLowerCase()}` : ''}`,
    mesure: { nom: m.nom, monnaie: Boolean(m.monnaie) },
    lignes,
    colonnes,
    valeurs: lignes.map((l) => colonnes.map((c) => arrondi(valeurs.get(l)?.get(c) ?? 0))),
    totauxLignes: lignes.map((l) => arrondi(totauxLignes.get(l))),
    totauxColonnes: colonnes.map((c) => arrondi(totauxColonnes.get(c))),
    total: arrondi(general),
  };
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesAnalyses(app) {
  app.addHook('preHandler', exigerConnexion);

  /** Les jeux de données permis, avec leurs regroupements et leurs mesures. */
  app.get('/api/analyses', async (requete) => {
    const prix = requete.droits.can('lire', 'PrixAchat');
    return Object.entries(JEUX)
      .filter(([, j]) => !j.droit || requete.droits.can(...j.droit))
      .map(([cle, j]) => ({
        cle,
        nom: j.nom,
        regroupements: Object.entries(j.regroupements).map(([c, r]) => ({ cle: c, nom: r.nom })),
        mesures: Object.entries(j.mesures)
          .filter(([, m]) => !m.prix || prix)
          .map(([c, m]) => ({ cle: c, nom: m.nom, monnaie: Boolean(m.monnaie) })),
      }));
  });

  app.get('/api/analyses/:jeu', calculer);

  /** Le tableau croisé en Excel, avec ses totaux. */
  app.get('/api/analyses/:jeu/export.xlsx', async (requete, reponse) => {
    const t = await calculer(requete);
    const colonnes = [{ cle: 'l', titre: t.titre.split(' par ')[1]?.split(' et ')[0] ?? '' }, ...t.colonnes.map((c, i) => ({ cle: `c${i}`, titre: c })), ...(t.colonnes.length > 1 ? [{ cle: 't', titre: 'Total' }] : [])];
    const lignes = [
      ...t.lignes.map((l, i) => ({ l, ...Object.fromEntries(t.valeurs[i].map((v, j) => [`c${j}`, v])), t: t.totauxLignes[i] })),
      { l: 'Total', ...Object.fromEntries(t.totauxColonnes.map((v, j) => [`c${j}`, v])), t: t.total },
    ];
    return reponse
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${nomFichier(`analyse-${requete.params.jeu}`, 'xlsx')}"`)
      .send(versXlsx({ colonnes, lignes, feuille: t.mesure.nom }));
  });
}
