/**
 * Deux connecteurs qui ne contiennent AUCUNE règle propre à un site : tout
 * vient des règles de lecture de la source (Paramètres → Sources de marchés).
 *
 *  - « html » : une page web publique, découpée et lue selon les règles ;
 *  - « api »  : une API qui rend du JSON ; chaque champ se lit par son chemin
 *    (« json:acheteur.nom »).
 *
 * Brancher une nouvelle source de ce genre = la décrire dans l'écran, sans code.
 */
import { lireListe } from '../lecture.js';

/** Un modèle de règles pour commencer, selon le format. */
export const MODELES_REGLES = {
  html: {
    format: 'html',
    liste: {
      decoupage: { css: 'article' },
      champs: {
        idExterne: ['css:a@href'],
        urlOfficielle: ['css:a@href'],
        reference: ['etiquette:Référence'],
        objet: ['css:h2', 'etiquette:Objet'],
        acheteur: ['etiquette:Acheteur'],
        lieu: ['etiquette:Lieu'],
        datePublication: ['etiquette:Publié le'],
        dateLimite: ['etiquette:Date limite'],
      },
    },
  },
  api: {
    format: 'json',
    liste: {
      decoupage: { chemin: 'data' },
      champs: {
        idExterne: ['json:id'],
        urlOfficielle: ['json:url'],
        reference: ['json:reference'],
        objet: ['json:objet', 'json:title'],
        acheteur: ['json:acheteur'],
        categorie: ['json:categorie'],
        lieu: ['json:lieu'],
        datePublication: ['json:date_publication'],
        dateLimite: ['json:date_limite'],
        estimation: ['json:estimation'],
      },
    },
  },
};

function connecteurSelonRegles(code, accepte) {
  return {
    code,
    automatique: true,
    async lister({ source, recuperer }) {
      const regles = source.parametres?.regles;
      if (!regles?.liste) throw new Error('Définissez d’abord les règles de lecture de cette source (Paramètres → Sources de marchés).');
      if (!source.adresse) throw new Error('Indiquez l’adresse de la page ou de l’API.');
      const { texte, url } = await recuperer(source.adresse, { accepte });
      const { offres, qualite } = lireListe(texte, regles, { base: url });
      return { offres, pagesLues: 1, remarques: [], qualite, regles };
    },
  };
}

export const connecteurHtml = connecteurSelonRegles('html', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
export const connecteurApi = connecteurSelonRegles('api', 'application/json,*/*;q=0.5');
