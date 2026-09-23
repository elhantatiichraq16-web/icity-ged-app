/**
 * Ce que la cloche annonce (§11) : les travaux en cours et ce qui attend
 * une décision. Une seule requête, légère, appelée toutes les 30 secondes.
 */
import { db } from '../db.js';
import { exigerConnexion } from '../plugins/authentification.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function routesNotifications(app) {
  app.get('/api/notifications', { preHandler: exigerConnexion }, async (requete) => {
    const peutClasser = requete.droits.can('modifier', 'Document');
    const peutVerifier = requete.droits.can('gerer', 'AVerifier');

    const [ocrEnAttente, ocrEnCours, suggestions, doublons, aRattacher, releveEnCours, arrivees] = await Promise.all([
      db.document.count({ where: { supprimeLe: null, statutOcr: 'en_attente' } }),
      db.document.count({ where: { supprimeLe: null, statutOcr: 'en_cours' } }),
      peutClasser ? db.suggestion.count({ where: { statut: 'en_attente' } }) : 0,
      peutVerifier ? db.doublon.count({ where: { decision: 'en_attente' } }) : 0,
      requete.droits.can('rattacher', 'Mail') ? db.mail.count({ where: { statutRattachement: 'a_rattacher' } }) : 0,
      db.compteMail.count({ where: { releveEnCoursDepuis: { not: null } } }),
      db.document.count({ where: { supprimeLe: null, creeLe: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);

    const taches = [];
    if (ocrEnCours) taches.push({ cle: 'ocr_en_cours', libelle: `${ocrEnCours} document(s) en cours de lecture`, ton: 'cyan', vers: '/documents?statutOcr=en_cours' });
    if (ocrEnAttente) taches.push({ cle: 'ocr_attente', libelle: `${ocrEnAttente} document(s) en attente de lecture`, ton: 'attente', vers: '/documents?statutOcr=en_attente' });
    if (releveEnCours) taches.push({ cle: 'releve', libelle: 'Relève du courriel en cours', ton: 'cyan', vers: '/courriel' });
    if (suggestions) taches.push({ cle: 'suggestions', libelle: `${suggestions} proposition(s) de classement`, ton: 'cyan', vers: '/a-classer' });
    if (doublons) taches.push({ cle: 'doublons', libelle: `${doublons} paire(s) de doublons à arbitrer`, ton: 'attente', vers: '/a-verifier' });
    if (aRattacher) taches.push({ cle: 'mails', libelle: `${aRattacher} message(s) à rattacher`, ton: 'attente', vers: '/courriel?statut=a_rattacher' });

    return { taches, arrivees, total: taches.length };
  });
}
