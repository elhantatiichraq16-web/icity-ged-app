/**
 * Le worker : ce qui tourne en fond, à côté du serveur.
 *
 *  - relève du courriel toutes les 10 minutes (§10) ;
 *  - écoute IMAP IDLE quand c'est possible : Gmail prévient dès qu'un message
 *    arrive, et le document apparaît dans les secondes qui suivent (§10 bis) ;
 *  - vidage de la corbeille au-delà de 30 jours (§9), chaque nuit ;
 *  - le rappel du matin : les activités de chacun, par mail, à 8 h ;
 *  - les rappels « N jours avant », dans la cloche, chaque heure ;
 *  - l'alerte « dans 10 minutes » d'une réunion à heure fixe, chaque minute.
 *
 * Un seul processus, une tâche à la fois : ce PC a 3,7 Go de mémoire (§2).
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { db } from './db.js';
import { ecouter, relever, releverTout } from './services/courriel-imap.js';
import { detecterDoublons } from './services/arbitrage-doublons.js';
import { classerLeFonds } from './services/classement-auto.js';
import { purgerJournal, viderCorbeille } from './services/entretien.js';
import { resteALire, tesseractDisponible, traiterFile } from './services/ocr.js';
import { alerterAvantHeure, envoyerRappelsDuJour, notifierRappels } from './services/rappels.js';
import { lireFacturesApresOcr } from './services/suivi-achats.js';

const journal = console;

/** Met en place l'écoute IDLE des comptes actifs, avec reconnexion. */
async function ecouterLesComptes() {
  const comptes = await db.compteMail.findMany({ where: { actif: true } });
  for (const compte of comptes) {
    try {
      await ecouter(compte, {
        log: journal,
        surNouveau: (r) => journal.log(`Arrivée : ${r.mailsLus} message(s), ${r.piecesVersees} pièce(s) — ${compte.adresse}`),
      });
      journal.log(`Écoute IMAP active sur ${compte.adresse} (${compte.dossierSurveille}).`);
    } catch (erreur) {
      // IDLE indisponible : la relève périodique prend le relais (§10 bis).
      // Le message finit souvent par un point (raisonEchec) : on n'en ajoute pas un second.
      journal.error(`Écoute impossible sur ${compte.adresse} : ${erreur.message.replace(/\.$/, '')}. La relève toutes les 10 minutes suffira.`);
    }
  }
}

journal.log('Worker iCity GED démarré.');

// Dernier filet. Le worker doit survivre à un incident isolé : une coupure
// réseau ou une pièce jointe malformée ne doit pas l'arrêter, sinon
// « concurrently -k » emporte aussi le serveur et les écrans.
process.on('uncaughtException', (erreur) => {
  journal.error('Erreur non rattrapée (le worker continue) :', erreur?.stack ?? erreur);
});
process.on('unhandledRejection', (raison) => {
  journal.error('Promesse rejetée sans traitement (le worker continue) :', raison?.stack ?? raison);
});

// L'OCR : un document à la fois, en série. Deux passages ne doivent jamais se
// croiser — ce PC n'a pas la mémoire pour deux Tesseract (§2).
let ocrEnCours = false;
async function viderFileOcr() {
  if (ocrEnCours) return;
  ocrEnCours = true;
  try {
    const bilan = await traiterFile({ log: journal });
    if (bilan.ignoree) return; // Tesseract absent : déjà signalé au démarrage.
    if (bilan.traites) {
      journal.log(`OCR : ${bilan.traites} document(s) lu(s) — ${bilan.lus} avec texte, ${bilan.illisibles} illisible(s), ${bilan.echecs} en échec.`);
      const reste = await resteALire();
      if (reste) journal.log(`OCR : ${reste} document(s) encore en attente.`);

      // Un scan n'a pas de texte au versement : le classement n'avait alors
      // rien à lire. Maintenant qu'il en a, on le rattrape (§7).
      if (bilan.lus) await classerLeFonds({ log: journal }).catch((e) => journal.error('Classement après OCR :', e.message));

      // Une facture de fournisseur scannée : son montant et sa date vont
      // maintenant sur sa commande, d'où l'échéance du paiement.
      if (bilan.idsLus.length) {
        await lireFacturesApresOcr(bilan.idsLus, { log: journal })
          .then((n) => n && journal.log(`Achats : ${n} facture(s) de fournisseur lue(s) et reportée(s) sur leur commande.`))
          .catch((e) => journal.error('Lecture des factures après OCR :', e.message));
      }

      // Et maintenant qu'on peut le comparer : est-ce un rescan (§9) ?
      if (bilan.idsLus.length) {
        await detecterDoublons({ ids: bilan.idsLus, log: journal })
          .then((d) => {
            if (d.ecartees.length) journal.log(`Doublons : ${d.ecartees.length} rescan(s) mis en corbeille.`);
            if (d.aTrancher.length) journal.log(`Doublons : ${d.aTrancher.length} paire(s) probable(s) à trancher.`);
          })
          .catch((e) => journal.error('Recherche de doublons après OCR :', e.message));
      }
    }
  } catch (erreur) {
    journal.error('File OCR en échec :', erreur.message);
  } finally {
    ocrEnCours = false;
  }
}

// Toutes les 2 minutes : on vide la file. Un scan arrivé par mail devient
// ainsi cherchable dans les minutes qui suivent (§10 bis).
cron.schedule('*/2 * * * *', viderFileOcr);

// Toutes les 10 minutes : la relève de secours, même si IDLE fonctionne.
cron.schedule('*/10 * * * *', async () => {
  try {
    const bilan = await releverTout(journal);
    const total = bilan.reduce((n, b) => n + (b.mailsLus ?? 0), 0);
    if (total) journal.log(`Relève : ${total} nouveau(x) message(s).`);
  } catch (erreur) {
    journal.error('Relève périodique en échec :', erreur.message);
  }
});

// Chaque dimanche à 2 h : la sauvegarde complète, base et fichiers (§13).
// Elle tourne dans son propre processus : un dump de plusieurs centaines de
// mégaoctets ne doit pas faire gonfler le worker.
cron.schedule(
  '0 2 * * 0',
  () => {
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'sauvegarder.js');
    execFile(process.execPath, [script], { env: process.env }, (erreur, sortie) => {
      if (erreur) journal.error('Sauvegarde hebdomadaire en échec :', erreur.message);
      else journal.log('Sauvegarde hebdomadaire terminée.');
    });
  },
  { timezone: 'Africa/Casablanca' },
);

// Chaque nuit à 3 h (heure du Maroc) : la corbeille.
cron.schedule(
  '0 3 * * *',
  async () => {
    await viderCorbeille({ log: journal }).catch((e) => journal.error('Vidage de corbeille :', e.message));
    await purgerJournal({ log: journal }).catch((e) => journal.error('Purge du journal :', e.message));
  },
  { timezone: 'Africa/Casablanca' },
);

/** Le rappel du matin : une fois par jour et par personne, du lundi au vendredi. */
async function rappelsDuMatin() {
  try {
    const { envoyes } = await envoyerRappelsDuJour({ log: journal });
    if (envoyes) journal.log(`Rappels du jour : ${envoyes} envoyé(s).`);
  } catch (erreur) {
    journal.error('Rappels du jour en échec :', erreur.message);
  }
}
cron.schedule('0 8 * * 1-5', rappelsDuMatin, { timezone: 'Africa/Casablanca' });

/** Les rappels « la veille », « 2 jours avant »… dans la cloche : chaque heure, et au démarrage. */
async function rappelsDansLaCloche() {
  try {
    const { notifies } = await notifierRappels();
    if (notifies) journal.log(`Rappels dans la cloche : ${notifies}.`);
  } catch (erreur) {
    journal.error('Rappels dans la cloche en échec :', erreur.message);
  }
}
cron.schedule('5 * * * *', rappelsDansLaCloche, { timezone: 'Africa/Casablanca' });
await rappelsDansLaCloche();

/** L'alerte 10 minutes avant une activité à heure fixe : chaque minute. */
async function alertesAvantHeure() {
  try {
    const { alertes, mails } = await alerterAvantHeure({ log: journal });
    if (alertes) journal.log(`Alertes : ${alertes} dans la cloche, ${mails} mail(s).`);
  } catch (erreur) {
    journal.error('Alertes en échec :', erreur.message);
  }
}
cron.schedule('* * * * *', alertesAvantHeure, { timezone: 'Africa/Casablanca' });

await ecouterLesComptes();

// Le PC était éteint à 8 h : le rappel part au démarrage, s'il n'est pas déjà
// parti aujourd'hui (un jour ouvré, après 8 h, heure du Maroc).
{
  const maintenant = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Casablanca', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  const jour = maintenant.find((p) => p.type === 'weekday')?.value ?? '';
  const heure = Number(maintenant.find((p) => p.type === 'hour')?.value ?? 0);
  if (!/^(sam|dim)/i.test(jour) && heure >= 8) await rappelsDuMatin();
}

// L'état de l'OCR est dit une fois, au démarrage : sans Tesseract les scans
// resteront introuvables par la recherche, et il vaut mieux le savoir tout de
// suite que de chercher pourquoi plus tard.
const ocr = await tesseractDisponible();
if (ocr.ok) {
  journal.log(`OCR prêt (${ocr.version}).`);
  await viderFileOcr();
} else {
  const reste = await resteALire();
  journal.error(`OCR indisponible : ${ocr.motif}. ${reste} document(s) attendent une lecture ; installez Tesseract puis relancez.`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await db.$disconnect();
    process.exit(0);
  });
}

export { relever };
