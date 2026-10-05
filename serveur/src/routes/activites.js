/**
 * Les activités, sur le modèle d'Odoo : planifier un rappel sur la fiche d'un
 * marché ou d'un client, le retrouver dans « Mes activités », le marquer fait.
 *
 * Chaque geste laisse une ligne au journal, sur la fiche concernée : il se lit
 * donc dans son fil d'activité (« a planifié… », « a fait… »).
 */
import { z } from 'zod';
import { etatActivite, jourCasablanca, nomTypeActivite, schemaActivite } from '@icity/commun/activites';
import { db } from '../db.js';
import { ErreurHttp, interdit, introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';

const date = (v) => new Date(`${v}T00:00:00Z`);
const jour = (d) => d.toISOString().slice(0, 10);

const AVEC = {
  assigne: { select: { id: true, nom: true } },
  creePar: { select: { id: true, nom: true } },
  marche: { select: { id: true, reference: true } },
  client: { select: { id: true, nom: true } },
  fournisseur: { select: { id: true, nom: true } },
};

/** Une activité, telle que les écrans l'attendent. */
function vueActivite(a, aujourdhui = jourCasablanca()) {
  const echeance = jour(a.echeance);
  return {
    id: a.id,
    type: a.type,
    typeNom: nomTypeActivite(a.type),
    resume: a.resume,
    note: a.note,
    echeance,
    etat: a.faiteLe ? 'faite' : etatActivite(echeance, aujourdhui),
    assigne: a.assigne,
    creePar: a.creePar,
    marche: a.marche,
    client: a.client,
    fournisseur: a.fournisseur,
    faiteLe: a.faiteLe,
    compteRendu: a.compteRendu,
  };
}

/** La fiche qui porte l'activité, pour le journal (et donc pour son fil). */
const ficheDe = (a) =>
  a.marcheId ? { objetType: 'Marche', objetId: a.marcheId } : a.clientId ? { objetType: 'Client', objetId: a.clientId } : { objetType: 'Fournisseur', objetId: a.fournisseurId };

/** Le résumé lisible d'une activité, pour le journal. */
const libelle = (a) => `${nomTypeActivite(a.type)} : ${a.resume}`;

/** @param {import('fastify').FastifyInstance} app */
export default async function routesActivites(app) {
  app.addHook('preHandler', exigerConnexion);
  const planifier = { preHandler: exiger('planifier', 'Activite') };

  /** On touche à une activité qu'on a créée, qu'on doit faire, ou si l'on dirige. */
  async function activiteModifiable(requete) {
    const a = await db.activite.findUnique({ where: { id: Number(requete.params.id) || 0 } });
    if (!a) throw introuvable('Activité');
    const moi = requete.utilisateur.id;
    if (a.assigneId !== moi && a.creeParId !== moi && !requete.droits.can('gerer', 'Activite')) throw interdit();
    return a;
  }

  /** La personne choisie doit être un compte actif. */
  async function assigneValide(assigneId) {
    const u = await db.utilisateur.findUnique({ where: { id: assigneId } });
    if (!u || !u.actif) throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { assigneId: 'Cette personne n’a pas de compte actif.' } });
    return u;
  }

  /**
   * Les comptes actifs, pour choisir à qui confier une activité. Les noms
   * seulement : la liste complète des utilisateurs reste à l'administration.
   */
  app.get('/api/equipe', async () => {
    return db.utilisateur.findMany({ where: { actif: true, motDePasse: { not: null } }, select: { id: true, nom: true }, orderBy: { nom: 'asc' } });
  });

  /**
   * Les activités à faire : celles d'une fiche (`marcheId` ou `clientId`), ou
   * les miennes (`miennes=1`), de la plus urgente à la plus lointaine.
   */
  app.get('/api/activites', async (requete) => {
    const { marcheId, clientId, fournisseurId, miennes } = requete.query;
    if (!marcheId && !clientId && !fournisseurId && !miennes) throw new ErreurHttp(422, 'Indiquez une fiche, ou « miennes ».');
    const activites = await db.activite.findMany({
      where: {
        faiteLe: null,
        ...(marcheId ? { marcheId: Number(marcheId) || 0 } : {}),
        ...(clientId ? { clientId: Number(clientId) || 0 } : {}),
        ...(fournisseurId ? { fournisseurId: Number(fournisseurId) || 0 } : {}),
        ...(miennes ? { assigneId: requete.utilisateur.id } : {}),
      },
      include: AVEC,
      orderBy: [{ echeance: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    const aujourdhui = jourCasablanca();
    return activites.map((a) => vueActivite(a, aujourdhui));
  });

  app.post('/api/activites', planifier, async (requete, reponse) => {
    const corps = requete.body ?? {};
    const donnees = valider(schemaActivite, corps);
    const { marcheId, clientId, fournisseurId } = valider(
      z.object({ marcheId: z.number().int().positive().nullish(), clientId: z.number().int().positive().nullish(), fournisseurId: z.number().int().positive().nullish() }),
      { marcheId: corps.marcheId, clientId: corps.clientId, fournisseurId: corps.fournisseurId },
    );
    if ([marcheId, clientId, fournisseurId].filter(Boolean).length !== 1) throw new ErreurHttp(422, 'Une activité se pose sur une seule fiche : un marché, un client ou un fournisseur.');
    if (marcheId && !(await db.marche.findUnique({ where: { id: marcheId } }))) throw introuvable('Marché');
    if (clientId && !(await db.client.findUnique({ where: { id: clientId } }))) throw introuvable('Client');
    if (fournisseurId && !(await db.fournisseur.findUnique({ where: { id: fournisseurId } }))) throw introuvable('Fournisseur');
    const assigne = await assigneValide(donnees.assigneId);

    const cree = await db.activite.create({
      data: { ...donnees, echeance: date(donnees.echeance), marcheId: marcheId ?? null, clientId: clientId ?? null, fournisseurId: fournisseurId ?? null, creeParId: requete.utilisateur.id },
      include: AVEC,
    });
    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'activite.planifiee',
        ...ficheDe(cree),
        commentaire: `${libelle(cree)} — pour ${assigne.nom}, le ${donnees.echeance}`,
        ip: requete.ip,
      },
      requete.log,
    );
    return reponse.code(201).send(vueActivite(cree));
  });

  app.patch('/api/activites/:id', async (requete) => {
    const avant = await activiteModifiable(requete);
    if (avant.faiteLe) throw new ErreurHttp(409, 'Cette activité est déjà faite.');
    const donnees = valider(schemaActivite, requete.body);
    await assigneValide(donnees.assigneId);
    const apres = await db.activite.update({ where: { id: avant.id }, data: { ...donnees, echeance: date(donnees.echeance) }, include: AVEC });
    return vueActivite(apres);
  });

  /** Marquer fait, avec un compte rendu facultatif (« Le client envoie le PV lundi »). */
  app.post('/api/activites/:id/fait', async (requete) => {
    const avant = await activiteModifiable(requete);
    if (avant.faiteLe) throw new ErreurHttp(409, 'Cette activité est déjà faite.');
    const { compteRendu } = valider(
      z.object({ compteRendu: z.string().trim().max(2000, { error: '2 000 caractères au plus.' }).transform((v) => v || null).nullish() }),
      requete.body ?? {},
    );
    const apres = await db.activite.update({ where: { id: avant.id }, data: { faiteLe: new Date(), compteRendu: compteRendu ?? null }, include: AVEC });
    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'activite.faite',
        ...ficheDe(avant),
        commentaire: compteRendu ? `${libelle(avant)} — ${compteRendu}` : libelle(avant),
        ip: requete.ip,
      },
      requete.log,
    );
    return vueActivite(apres);
  });

  /** Annuler une activité devenue inutile : elle disparaît, la trace reste au fil. */
  app.delete('/api/activites/:id', async (requete) => {
    const a = await activiteModifiable(requete);
    await db.activite.delete({ where: { id: a.id } });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'activite.annulee', ...ficheDe(a), commentaire: libelle(a), ip: requete.ip }, requete.log);
    return { ok: true };
  });
}
