/**
 * Les modèles de mails, comme ceux d'Odoo : chacun les utilise en écrivant ;
 * l'administrateur et la direction les gèrent.
 */
import { schemaModeleMail } from '@icity/commun/modeles';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger, exigerConnexion } from '../plugins/authentification.js';
import { journaliser } from '../services/journal.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function routesModeles(app) {
  app.addHook('preHandler', exigerConnexion);
  const gerer = { preHandler: exiger('gerer', 'ModeleMail') };

  /** Les modèles, éventuellement pour un usage (« client », « fournisseur ») : ceux-là et ceux « partout ». */
  app.get('/api/modeles-mails', async (requete) => {
    const { usage } = requete.query;
    return db.modeleMail.findMany({ where: usage ? { usage: { in: [String(usage), 'tous'] } } : {}, orderBy: { nom: 'asc' } });
  });

  async function nomLibre(nom, id = 0) {
    const homonyme = await db.modeleMail.findFirst({ where: { nom: { equals: nom, mode: 'insensitive' }, id: { not: id } } });
    if (homonyme) throw new ErreurHttp(409, 'Ce nom est déjà pris.', { erreurs: { nom: `« ${homonyme.nom} » existe déjà.` } });
  }

  app.post('/api/modeles-mails', gerer, async (requete, reponse) => {
    const donnees = valider(schemaModeleMail, requete.body);
    await nomLibre(donnees.nom);
    const cree = await db.modeleMail.create({ data: donnees });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'modele_mail.cree', objetType: 'ModeleMail', objetId: cree.id, commentaire: cree.nom, ip: requete.ip }, requete.log);
    return reponse.code(201).send(cree);
  });

  app.patch('/api/modeles-mails/:id', gerer, async (requete) => {
    const id = Number(requete.params.id) || 0;
    if (!(await db.modeleMail.findUnique({ where: { id } }))) throw introuvable('Modèle');
    const donnees = valider(schemaModeleMail, requete.body);
    await nomLibre(donnees.nom, id);
    const apres = await db.modeleMail.update({ where: { id }, data: donnees });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'modele_mail.modifie', objetType: 'ModeleMail', objetId: id, commentaire: apres.nom, ip: requete.ip }, requete.log);
    return apres;
  });

  app.delete('/api/modeles-mails/:id', gerer, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const modele = await db.modeleMail.findUnique({ where: { id } });
    if (!modele) throw introuvable('Modèle');
    await db.modeleMail.delete({ where: { id } });
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'modele_mail.supprime', objetType: 'ModeleMail', objetId: id, commentaire: modele.nom, ip: requete.ip }, requete.log);
    return { ok: true };
  });
}
