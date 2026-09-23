/**
 * Gestion des comptes (Paramètres → Utilisateurs), réservée à l'administrateur.
 * Seul l'administrateur crée les comptes, par invitation e-mail (§11).
 */
import { schemaInvitation, schemaModifierUtilisateur } from '@icity/commun/schemas';
import { db } from '../db.js';
import { ErreurHttp, introuvable, valider } from '../erreurs.js';
import { exiger } from '../plugins/authentification.js';
import { envoyerInvitation } from '../services/courriel.js';
import { creerJeton } from '../services/jetons.js';
import { journaliser } from '../services/journal.js';
import { fermerAutresSessions } from '../services/sessions.js';

function lignePublique(u) {
  return {
    id: u.id,
    nom: u.nom,
    email: u.email,
    role: u.role.code,
    roleNom: u.role.nom,
    actif: u.actif,
    // Un compte sans mot de passe n'a pas encore accepté son invitation.
    invitationEnAttente: !u.motDePasse,
    deuxFacteurs: Boolean(u.deuxFacteursActiveLe),
    derniereConnexion: u.derniereConnexion,
    avatar: u.avatar ? `/api/utilisateurs/${u.id}/avatar?v=${encodeURIComponent(u.avatar.slice(0, 8))}` : null,
    creeLe: u.creeLe,
  };
}

async function inviter(requete, utilisateur) {
  const lien = await creerJeton(utilisateur.id, 'invitation');
  try {
    await envoyerInvitation({ a: utilisateur.email, nom: utilisateur.nom, invitePar: requete.utilisateur.nom, lien });
    return true;
  } catch (erreur) {
    requete.log.error({ err: erreur }, "Envoi de l'invitation impossible");
    return false;
  }
}

/** @param {import('fastify').FastifyInstance} app */
export default async function routesUtilisateurs(app) {
  const reserve = { preHandler: exiger('gerer', 'Utilisateur') };

  app.get('/api/roles', { preHandler: exiger('gerer', 'Utilisateur') }, async () => {
    return db.role.findMany({ orderBy: { id: 'asc' }, select: { code: true, nom: true, description: true } });
  });

  app.get('/api/utilisateurs', reserve, async () => {
    const liste = await db.utilisateur.findMany({ include: { role: true }, orderBy: { nom: 'asc' } });
    return liste.map(lignePublique);
  });

  app.post('/api/utilisateurs', reserve, async (requete, reponse) => {
    const { nom, email, role } = valider(schemaInvitation, requete.body);
    if (await db.utilisateur.findUnique({ where: { email } })) {
      throw new ErreurHttp(409, 'Certains champs sont à corriger.', { erreurs: { email: 'Un compte existe déjà avec cette adresse.' } });
    }
    const roleTrouve = await db.role.findUniqueOrThrow({ where: { code: role } });
    const cree = await db.utilisateur.create({ data: { nom, email, roleId: roleTrouve.id }, include: { role: true } });

    const envoye = await inviter(requete, cree);
    await journaliser(
      { utilisateurId: requete.utilisateur.id, action: 'utilisateur.invite', objetType: 'Utilisateur', objetId: cree.id, apres: { nom, email, role }, ip: requete.ip },
      requete.log,
    );
    return reponse.code(201).send({ utilisateur: lignePublique(cree), emailEnvoye: envoye });
  });

  app.post('/api/utilisateurs/:id/invitation', reserve, async (requete) => {
    const u = await db.utilisateur.findUnique({ where: { id: Number(requete.params.id) || 0 }, include: { role: true } });
    if (!u) throw introuvable('Utilisateur');
    if (u.motDePasse) throw new ErreurHttp(409, 'Ce compte a déjà choisi son mot de passe.');
    const envoye = await inviter(requete, u);
    await journaliser({ utilisateurId: requete.utilisateur.id, action: 'utilisateur.invitation_renvoyee', objetType: 'Utilisateur', objetId: u.id, ip: requete.ip }, requete.log);
    return { emailEnvoye: envoye };
  });

  app.patch('/api/utilisateurs/:id', reserve, async (requete) => {
    const id = Number(requete.params.id) || 0;
    const changes = valider(schemaModifierUtilisateur, requete.body);
    const u = await db.utilisateur.findUnique({ where: { id }, include: { role: true } });
    if (!u) throw introuvable('Utilisateur');

    // Garde-fou : on ne se retire pas soi-même les droits d'administration,
    // sans quoi plus personne ne pourrait gérer les comptes.
    if (id === requete.utilisateur.id && ((changes.role && changes.role !== 'administrateur') || changes.actif === false)) {
      throw new ErreurHttp(422, 'Vous ne pouvez pas retirer vos propres droits d’administrateur ni désactiver votre compte.');
    }

    const data = {};
    if (changes.role) data.roleId = (await db.role.findUniqueOrThrow({ where: { code: changes.role } })).id;
    if (changes.actif !== undefined) data.actif = changes.actif;

    const modifie = await db.utilisateur.update({ where: { id }, data, include: { role: true } });
    // Un compte désactivé ou dont le rôle change est déconnecté partout :
    // ses droits doivent s'appliquer tout de suite, pas à sa prochaine visite.
    if (changes.actif === false || (changes.role && changes.role !== u.role.code)) await fermerAutresSessions(id);

    await journaliser(
      {
        utilisateurId: requete.utilisateur.id,
        action: 'utilisateur.modifie',
        objetType: 'Utilisateur',
        objetId: id,
        avant: { role: u.role.code, actif: u.actif },
        apres: { role: modifie.role.code, actif: modifie.actif },
        ip: requete.ip,
      },
      requete.log,
    );
    return { utilisateur: lignePublique(modifie) };
  });
}
