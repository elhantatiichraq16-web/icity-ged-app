/**
 * Ce que la cloche annonce (§11) : les travaux en cours et ce qui attend
 * une décision. Une seule requête, légère, appelée toutes les 30 secondes.
 */
import { db } from '../db.js';
import { exigerConnexion } from '../plugins/authentification.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function routesNotifications(app) {
  app.get('/api/notifications', { preHandler: exigerConnexion }, async (requete) => {
    const [ocrEnAttente, ocrEnCours, aRattacher, releveEnCours, arrivees] = await Promise.all([
      db.document.count({ where: { supprimeLe: null, statutOcr: 'en_attente' } }),
      db.document.count({ where: { supprimeLe: null, statutOcr: 'en_cours' } }),
      requete.droits.can('rattacher', 'Mail') ? db.mail.count({ where: { statutRattachement: 'a_rattacher' } }) : 0,
      db.compteMail.count({ where: { releveEnCoursDepuis: { not: null } } }),
      db.document.count({ where: { supprimeLe: null, creeLe: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);

    const taches = [];
    if (ocrEnCours) taches.push({ cle: 'ocr_en_cours', libelle: `${ocrEnCours} document(s) en cours de lecture`, ton: 'cyan', vers: '/documents?statutOcr=en_cours' });
    if (ocrEnAttente) taches.push({ cle: 'ocr_attente', libelle: `${ocrEnAttente} document(s) en attente de lecture`, ton: 'attente', vers: '/documents?statutOcr=en_attente' });
    if (releveEnCours) taches.push({ cle: 'releve', libelle: 'Relève du courriel en cours', ton: 'cyan', vers: '/courriel' });
    if (aRattacher) taches.push({ cle: 'mails', libelle: `${aRattacher} message(s) à rattacher`, ton: 'attente', vers: '/courriel?statut=a_rattacher' });

    return { taches, arrivees, total: taches.length };
  });
}
