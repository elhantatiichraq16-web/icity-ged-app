/**
 * Le calendrier, comme la vue Calendrier d'Odoo : tout ce qui tombe à une
 * date, réuni sur un mois.
 *
 *  - les échéances des marchés en cours ;
 *  - les activités à faire ;
 *  - les livraisons de matériel attendues (pour qui voit les achats) ;
 *  - les paiements de commandes à faire (pour qui voit les prix).
 *
 * Rien n'est stocké en plus : chaque date se lit là où elle vit déjà.
 */
import { z } from 'zod';
import { paiementCommande } from '@icity/commun/achats';
import { echeanceDe, etatEcheance, phaseDe } from '@icity/commun/marches';
import { db } from '../db.js';
import { valider } from '../erreurs.js';
import { exigerConnexion } from '../plugins/authentification.js';
import { EN_COURS } from '../services/archivage.js';
import { piecesParMarche } from '../services/phase-marche.js';

const jour = (d) => (d ? d.toISOString().slice(0, 10) : null);
const nombre = (d) => (d === null || d === undefined ? null : Number(d));

/** @param {import('fastify').FastifyInstance} app */
export default async function routesCalendrier(app) {
  app.addHook('preHandler', exigerConnexion);

  /**
   * Les événements entre deux dates (incluses).
   * `miennes=1` ne garde que les activités confiées à l'utilisateur.
   */
  app.get('/api/calendrier', async (requete) => {
    const { debut, fin, miennes } = valider(
      z.object({ debut: z.iso.date(), fin: z.iso.date(), miennes: z.string().optional() }),
      requete.query,
    );
    const dans = (iso) => iso && iso >= debut && iso <= fin;
    const entre = { gte: new Date(`${debut}T00:00:00Z`), lte: new Date(`${fin}T00:00:00Z`) };
    const evenements = [];

    // ── Les échéances des marchés en cours ──
    const marches = await db.marche.findMany({ where: EN_COURS, select: { id: true, reference: true, dateFin: true, dateOs: true, delaiMois: true, client: { select: { nom: true } } } });
    const pieces = await piecesParMarche(marches.map((m) => m.id));
    for (const m of marches) {
      const echeance = echeanceDe(m);
      if (!dans(echeance)) continue;
      const etat = etatEcheance(echeance, phaseDe(pieces.get(m.id) ?? {}));
      evenements.push({ id: `m${m.id}`, type: 'echeance', date: echeance, titre: `Échéance ${m.reference}`, detail: m.client?.nom ?? null, lien: `/marches/${m.id}`, alerte: etat === 'depassee' });
    }

    // ── Les activités à faire ──
    const activites = await db.activite.findMany({
      where: { faiteLe: null, echeance: entre, ...(miennes ? { assigneId: requete.utilisateur.id } : {}) },
      include: {
        assigne: { select: { id: true, nom: true } },
        marche: { select: { id: true, reference: true } },
        client: { select: { id: true, nom: true } },
        fournisseur: { select: { id: true, nom: true } },
        commande: { select: { id: true } },
      },
    });
    for (const a of activites) {
      const lien = a.marche ? `/marches/${a.marche.id}` : a.client ? `/clients/${a.client.id}` : a.commande ? `/achats/commandes/${a.commande.id}` : a.fournisseur ? `/achats/fournisseurs/${a.fournisseur.id}` : '/';
      evenements.push({
        id: `a${a.id}`,
        type: 'activite',
        date: jour(a.echeance),
        titre: a.resume,
        detail: a.assigne.id === requete.utilisateur.id ? 'pour moi' : `pour ${a.assigne.nom}`,
        lien,
        alerte: jour(a.echeance) < new Date().toISOString().slice(0, 10),
      });
    }

    // ── Les étapes du planning des marchés, à leur date de fin ──
    const taches = await db.tacheMarche.findMany({
      where: { fin: entre, avancement: { lt: 100 }, marche: EN_COURS },
      include: { marche: { select: { id: true, reference: true } }, responsable: { select: { nom: true } } },
    });
    for (const t of taches) {
      evenements.push({
        id: `t${t.id}`,
        type: 'tache',
        date: jour(t.fin),
        titre: `${t.marche.reference} : ${t.titre}`,
        detail: [t.responsable?.nom, `${t.avancement} %`].filter(Boolean).join(' · '),
        lien: `/marches/${t.marche.id}?onglet=planning`,
        alerte: jour(t.fin) < new Date().toISOString().slice(0, 10),
      });
    }

    // ── Les livraisons attendues ──
    if (requete.droits.can('lire', 'Achat')) {
      const prix = requete.droits.can('lire', 'PrixAchat');
      const lignes = await db.ligneAchat.findMany({
        where: { etd: entre, statut: { not: 'livre' }, marche: EN_COURS },
        select: { id: true, designation: true, etd: true, commandeId: true, marcheId: true, fournisseur: { select: { nom: true } } },
      });
      for (const l of lignes) {
        evenements.push({
          id: `l${l.id}`,
          type: 'livraison',
          date: jour(l.etd),
          titre: `Livraison : ${l.designation}`,
          detail: l.fournisseur?.nom ?? null,
          lien: prix && l.commandeId ? `/achats/commandes/${l.commandeId}` : `/achats?marcheId=${l.marcheId}&onglet=materiel`,
          alerte: jour(l.etd) < new Date().toISOString().slice(0, 10),
        });
      }
    }

    // ── Les paiements à faire ──
    if (requete.droits.can('lire', 'PrixAchat')) {
      const commandes = await db.commandeFournisseur.findMany({
        where: { soldePayeLe: null, marche: EN_COURS },
        include: { fournisseur: { select: { nom: true } }, lignes: { select: { quantite: true, puAchat: true } } },
      });
      for (const c of commandes) {
        const p = paiementCommande({
          montantTtc: nombre(c.montantTtc),
          avancePourcent: nombre(c.avancePourcent),
          modalite: c.modalite,
          dateFacture: jour(c.dateFacture),
          echeance: jour(c.echeance),
          avancePayeeLe: jour(c.avancePayeeLe),
          soldePayeLe: jour(c.soldePayeLe),
        });
        if (p.etat === 'soldee' || !dans(p.echeance)) continue;
        evenements.push({
          id: `c${c.id}`,
          type: 'paiement',
          date: p.echeance,
          titre: `Paiement ${c.fournisseur.nom}`,
          detail: p.etat === 'avance_a_payer' ? 'avance' : 'solde',
          montant: p.etat === 'avance_a_payer' ? p.avance : p.reste,
          lien: `/achats/commandes/${c.id}`,
          alerte: p.echeance < new Date().toISOString().slice(0, 10),
        });
      }
    }

    return evenements.sort((a, b) => a.date.localeCompare(b.date) || a.titre.localeCompare(b.titre, 'fr'));
  });
}
