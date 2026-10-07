# Marchés potentiels — veille des appels d'offres

La rubrique **Affaires → Marchés potentiels** (`/marches-potentiels`) réunit les appels d'offres
publiés par des sources externes, les note selon les **critères iCity** (score de 0 à 100, chaque
point expliqué), et permet de les trier, de les suivre et de les **convertir en marché**.

## Où est le code

| Rôle | Fichier |
|---|---|
| Règles partagées : statuts, score, empreinte, formulaires | `commun/src/marches-potentiels.js` |
| Droits (`lire`/`gerer`/`convertir` MarchePotentiel, `gerer` SourceMarche et CriteresMarches) | `commun/src/droits.js` |
| Modèles de données | `serveur/prisma/schema.prisma` (SourceMarches, OffrePotentielle, SynchronisationSource, FavoriOffre, CriteresMarches) |
| API | `serveur/src/routes/marches-potentiels.js` |
| Lecture sécurisée d'une adresse externe (HTTPS, anti-SSRF, délais, tailles) | `serveur/src/services/veille/recuperation.js` |
| Normalisation (texte sans HTML, dates du Maroc, montants, identité) | `serveur/src/services/veille/normalisation.js` |
| Enregistrement sans doublon, score, expiration, alertes, résumé | `serveur/src/services/veille/offres.js` |
| Synchronisation des sources (fréquence, reprise après erreur) | `serveur/src/services/veille/synchronisation.js` |
| Import CSV, import par adresse, actualisation, document vers la GED | `serveur/src/services/veille/actions.js` |
| Connecteurs | `serveur/src/services/veille/connecteurs/` (`pmmp.js`, `rss.js`, `csv.js`, `index.js`) |
| Tâches planifiées | `serveur/src/worker.js` (veille toutes les 10 min, résumé à 8 h 15) |
| Écrans | `client/src/pages/MarchesPotentiels.jsx`, `client/src/pages/ParametresVeille.jsx` |
| Tests (sur réponses enregistrées, jamais le site réel) | `serveur/tests/marches-potentiels.test.js`, `serveur/tests/fixtures/veille/`, `commun/tests/marches-potentiels.test.js` |

## Le Portail marocain des marchés publics (PMMP)

Étude faite le 6 octobre 2026 :

- **pas d'API officielle, pas de flux RSS, pas de jeu de données ouvert** sur les avis
  (data.gov.ma ne publie pas les consultations) ;
- **pas de `robots.txt`** (l'adresse renvoie vers l'accueil) ;
- les **conditions d'utilisation** ne parlent que des prérequis techniques : elles n'autorisent
  ni n'interdisent la collecte automatique ;
- la liste des consultations et leurs pages de détail sont **publiques**, sans compte ni CAPTCHA ;
  le téléchargement du dossier de consultation passe par un **formulaire de demande**.

Conséquence : la source « Portail marocain des marchés publics » est créée **désactivée**.
Le connecteur `pmmp` existe et est testé, mais la collecte automatique **ne doit être activée
qu'après l'accord écrit de l'éditeur du portail** (la Trésorerie Générale du Royaume, qui
l'administre). En attendant :

- **Importer une offre** (bouton de la rubrique) : coller l'adresse d'une annonce ; une annonce du
  portail se pré-remplit (une seule page lue, à la demande) ; sinon on complète à la main.
- **Importer un CSV** (Paramètres → Sources de marchés, sur la source « Import manuel »).

Limites voulues du connecteur PMMP : une seule page de liste par passage (les suivantes exigent
de rejouer le formulaire du site, ce qu'on ne fait pas) ; aucun téléchargement automatique de
dossier ; les heures affichées sont lues en heure du Maroc (UTC+1).

## Ajouter une source

**Paramètres → Sources de marchés → Ajouter une source** (direction et administrateur).

| Champ | Rôle |
|---|---|
| Nom, site web | Identité de la source (le site doit être en HTTPS) |
| Type de connecteur | `pmmp`, `rss` (automatiques) ; `api`, `html`, `csv`, `manuel` (import seulement) |
| Adresse | Page de liste, flux RSS/Atom ou API |
| Fréquence | 60 min par défaut (30 au moins) ; allongée ×2, ×4… après des échecs |
| Pages au plus | Nombre maximal de pages lues par passage (10 au plus) |
| Délai entre deux requêtes | 3 s par défaut (1 s au moins) |
| En-têtes ou identifiants | Objet JSON, **chiffré** en base, jamais réaffiché ni journalisé |
| Active | Seule une source active est synchronisée |
| Autoriser HTTP | Refusé par défaut |

Boutons : **Tester** (une requête, rien n'est enregistré), **Synchroniser** (source active),
**Importer un CSV**, **Activer / Désactiver**, **Supprimer** (refusé si une offre a été convertie).
Chaque ajout, modification, suppression, synchronisation et import est écrit au journal d'audit.

### Format CSV

Séparateur `;` ou `,`, encodage UTF-8 (ou Windows-1252), une ligne d'en-tête. Colonnes reconnues
(avec ou sans accents) : `reference`, `objet` (**obligatoire**), `acheteur`, `categorie`,
`procedure`, `lieu`, `date_publication`, `date_limite` (`25/11/2026 10:00` ou ISO), `estimation`,
`caution` (`1 399 999,99` accepté), `url`, `identifiant`, `domaines` (séparés par `|`).
Une ligne sans objet est refusée et signalée ; une ligne déjà connue met l'offre à jour.

## Écrire un nouveau connecteur

1. Créer `serveur/src/services/veille/connecteurs/<code>.js` qui exporte un objet :
   ```js
   export const connecteurExemple = {
     code: 'exemple',
     automatique: true,
     // Lire les offres récentes. `recuperer(url)` applique HTTPS, anti-SSRF, délais, pause entre requêtes.
     async lister({ source, recuperer }) {
       const { texte } = await recuperer(source.adresse);
       return { offres: [/* { idExterne, urlOfficielle, reference, objet, acheteur, categorie, lieu, datePublication, dateLimite, estimation, caution, documents: [{ nom, url }] } */], pagesLues: 1, remarques: [] };
     },
     // Facultatif : relire une annonce (bouton « Actualiser », import par adresse).
     async detail({ adresse, recuperer }) { /* … */ },
     reconnait: (adresse) => false,
   };
   ```
2. L'inscrire dans `CONNECTEURS` (`connecteurs/index.js`) et dans la liste `CONNECTEURS` de
   `commun/src/marches-potentiels.js` (libellé de l'écran).
3. Enregistrer une réponse **anonymisée** dans `serveur/tests/fixtures/veille/` et ajouter un test
   qui passe par un faux `recuperer` (voir `marches-potentiels.test.js`).

La normalisation, le score, le dédoublonnage, l'expiration, les alertes et le compte rendu de
synchronisation sont communs : un connecteur n'a qu'à rendre des offres « brutes ».

## Règles à respecter

- Toute collecte côté serveur, jamais depuis React ; jamais d'adresse du réseau local.
- Ne jamais contourner une authentification, un CAPTCHA ou une limitation ; ne jamais automatiser
  le dépôt d'une offre.
- Aucun secret dans Git : les identifiants d'une source se saisissent dans l'écran, chiffrés en base.
- Le score est déterministe (critères de **Paramètres → Critères iCity**) ; aucune IA externe.
