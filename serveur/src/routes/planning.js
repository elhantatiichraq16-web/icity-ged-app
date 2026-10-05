/**
 * Le planning d'un marché, comme le module Projet d'Odoo : les étapes du
 * chantier (installation, formation, réception…), avec leurs dates, leur
 * responsable et leur avancement, pour un diagramme de Gantt.
 *
 * Chaque geste s'inscrit au journal du marché : il se lit dans son fil, et
 * prévient ses abonnés.
 */
import { z } from 'zod';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';

const date = (v) => new Date(`${v}T00:00:00Z`);
const jour = (d) => d.toISOString().slice(0, 10);

const schemaTache = z
  .object({
    titre: z.string({ error: 'Nommez l’étape.' }).trim().min(2, { error: 'Nommez l’étape.' }).max(160, { error: '160 caractères au plus.' }),
    debut: z.iso.date({ error: 'Indiquez le début.' }),
    fin: z.iso.date({ error: 'Indiquez la fin.' }),
    responsableId: z.coerce.number().int().positive().nullish().or(z.literal('').transform(() => null)),
    avancement: z.coerce.number().int().min(0).max(100).default(0),
    notes: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => v || null)
      .nullish(),
  })
  .refine((t) => t.fin >= t.debut, { path: ['fin'], error: 'La fin ne peut pas précéder le début.' });

function vueTache(t) {
  return {
    id: t.id,
    titre: t.titre,
    debut: jour(t.debut),
    fin: jour(t.fin),
    responsable: t.responsable ? { id: t.responsable.id, nom: t.responsable.nom } : null,
    avancement: t.avancement,
    ordre: t.ordre,
    notes: t.notes,
  };
}

const AVEC = { responsable: { select: { id: true, nom: true } } };

/** @param {import('fastify').FastifyInstance} app */
export default async function routesPlanning(app) {
  app.addHook('preHandler', exigerConnexion);
  const modifier = { preHandler: exiger('modifier', 'Marche') };

  app.get('/api/marches/:id/taches', async (requete) => {
    const marcheId = Number(requete.params.id) || 0;
    if (!(await db.marche.findUnique({ where: { id: marcheId } }))) throw introuvable('Marché');
    const taches = await db.tacheMarche.findMany({ where: { marcheId }, include: AVEC, orderBy: [{ debut: 'asc' }, { ordre: 'asc' }, { id: 'asc' }] });
    return taches.map(vueTache);
  });

  app.post('/api/marches/:id/taches', modifier, async (requete, reponse) => {
    const marcheId = Number(requete.params.id) || 0;
    if (!(await db.marche.findUnique({ where: { id: marcheId } }))) throw introuvable('Marché');
    const d = valider(schemaTache, requete.body);
    if (d.responsableId && !(await db.utilisateur.findUnique({ where: { id: d.responsableId } }))) {
      throw new ErreurHttp(422, 'Certains champs sont à corriger.', { erreurs: { responsableId: 'Ce compte n’existe pas.' } });
    }
    const dernier = await db.tacheMarche.aggregate({ where: { marcheId }, _max: { ordre: true } });
    const cree = await db.tacheMarche.create({
      data: { ...d, marcheId, debut: date(d.debut), fin: date(d.fin), ordre: (dernier._max.ordre ?? 0) + 1 },
      include: AVEC,
    });
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'tache.creee', objetType: 'Marche', objetId: marcheId, commentaire: `${cree.titre} — du ${d.debut} au ${d.fin}`, ip: requete.ip },
      requete.log,
    );
    return reponse.code(201).send(vueTache(cree));
  });

  app.patch('/api/taches/:id', modifier, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const avant = await db.tacheMarche.findUnique({ where: { id } });
    if (!avant) throw introuvable('Étape');
    const d = valider(schemaTache, requete.body);
    const apres = await db.tacheMarche.update({ where: { id }, data: { ...d, debut: date(d.debut), fin: date(d.fin) }, include: AVEC });
    const terminee = avant.avancement < 100 && apres.avancement === 100;
    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: terminee ? 'tache.terminee' : 'tache.modifiee',
        objetType: 'Marche',
        objetId: avant.marcheId,
        commentaire: terminee ? apres.titre : `${apres.titre} — ${apres.avancement} %, du ${d.debut} au ${d.fin}`,
        ip: requete.ip,
      },
      requete.log,
    );
    return vueTache(apres);
  });

  app.delete('/api/taches/:id', modifier, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const tache = await db.tacheMarche.findUnique({ where: { id } });
    if (!tache) throw introuvable('Étape');
    await db.tacheMarche.delete({ where: { id } });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'tache.supprimee', objetType: 'Marche', objetId: tache.marcheId, commentaire: tache.titre, ip: requete.ip }, requete.log);
    return { ok: true };
  });
}
