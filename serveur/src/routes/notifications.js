/**
 * Ce que la cloche annonce (§11) : les travaux en cours et ce qui attend
 * une décision. Une seule requête, légère, appelée toutes les 30 secondes.
 */
import { confidentialitesVisibles } from '@icity/commun/droits';
import { db } from '../db.js';
import { exigerConnexion } from '../plugins/authentification.js';
import { DOUBLONS_HORS_ARCHIVES } from '../services/archivage.js';
import { filtreAClasser } from './tri.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function routesNotifications(app) {
  app.get('/api/notifications', { preHandler: exigerConnexion }, async (requete) => {
    // Les files du tri ne regardent que ceux qui les traitent.
    const trieur = requete.droits.can('gerer', 'AVerifier');
    const vus = confidentialitesVisibles(requete.utilisateur.role.code);
    const cote = { supprimeLe: null, confidentialite: { in: vus } };

    const [ocrEnAttente, ocrEnCours, aRattacher, releveEnCours, arrivees, aClasser, doublons] = await Promise.all([
      db.document.count({ where: { supprimeLe: null, statutOcr: 'en_attente' } }),
      db.document.count({ where: { supprimeLe: null, statutOcr: 'en_cours' } }),
      requete.droits.can('rattacher', 'Mail') ? db.mail.count({ where: { statutRattachement: 'a_rattacher' } }) : 0,
      db.compteMail.count({ where: { releveEnCoursDepuis: { not: null } } }),
      db.document.count({ where: { supprimeLe: null, creeLe: { gte: new Date(Date.now() - 86_400_000) } } }),
      trieur ? db.document.count({ where: filtreAClasser(requete.utilisateur) }) : 0,
      trieur ? db.doublon.count({ where: { decision: 'en_attente', documentA: cote, documentB: cote, ...DOUBLONS_HORS_ARCHIVES } }) : 0,
    ]);

    const taches = [];
    if (ocrEnCours) taches.push({ cle: 'ocr_en_cours', libelle: `${ocrEnCours} document(s) en cours de lecture`, ton: 'cyan', vers: '/documents?statutOcr=en_cours' });
    if (ocrEnAttente) taches.push({ cle: 'ocr_attente', libelle: `${ocrEnAttente} document(s) en attente de lecture`, ton: 'attente', vers: '/documents?statutOcr=en_attente' });
    if (releveEnCours) taches.push({ cle: 'releve', libelle: 'Relève du courriel en cours', ton: 'cyan', vers: '/courriel' });
    if (aRattacher) taches.push({ cle: 'mails', libelle: `${aRattacher} message(s) à rattacher`, ton: 'attente', vers: '/courriel?statut=a_rattacher' });
    if (aClasser) taches.push({ cle: 'a_classer', libelle: `${aClasser} pièce(s) à classer`, ton: 'attente', vers: '/a-classer' });
    if (doublons) taches.push({ cle: 'doublons', libelle: `${doublons} doublon(s) probable(s) à trancher`, ton: 'attente', vers: '/a-verifier' });

    return { taches, arrivees, total: taches.length };
  });
}
