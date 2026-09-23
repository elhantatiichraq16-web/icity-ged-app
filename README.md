# iCity GED

Logiciel de gestion des dossiers de marchés d'**iCity** (branche Smart City d'ABA
Technology) : le versement des pièces, leur lecture, leur classement, le suivi de
chaque affaire jusqu'à la mainlevée de caution, et les échanges par courriel.

Il remplace l'installation Paperless-ngx : une seule application, sans Docker,
qui tient sur un poste Windows de 3,7 Go de mémoire.

---

## Ce dont vous avez besoin

| Outil | Version | Où |
|---|---|---|
| **Node.js** | 22 ou plus | https://nodejs.org |
| **PostgreSQL** | 17 | [postgresql.org](https://www.postgresql.org/download/windows/) |
| **Poppler** | `pdftotext`, `pdfinfo`, `pdftoppm` | fourni par MiKTeX, ou https://github.com/oschwartz10612/poppler-windows |
| **Mailpit** | — | boîte mail de test (facultatif) |
| **Tesseract** | 5, langues **fra + ara + eng** | https://github.com/UB-Mannheim/tesseract/wiki |

**Tesseract n'est nécessaire que pour les scans muets.** Un PDF qui porte déjà
son texte — tous ceux venus de l'ancienne installation — est lu sans lui.

À l'installation de Tesseract, à l'écran *Choose Components*, dépliez
**Additional language data** et cochez **French** et **Arabic**. Puis vérifiez :

```bash
"C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs
```

---

## Installation, pas à pas

### 1. Démarrer PostgreSQL et Mailpit

Le service **postgresql-x64-17** démarre avec Windows. Pour la boîte de test,
lancez **Mailpit** si vous l'utilisez.

### 2. Récupérer le projet et ses bibliothèques

```bash
npm install
```

### 3. Créer la base et les fichiers de réglages

```bash
npm run installer -w serveur
```

Ce script crée un rôle PostgreSQL `icity` (pas `postgres`) avec un mot de passe
aléatoire, les bases `icity_ged`, `icity_ged_test` et `icity_ged_shadow`, puis
écrit `serveur/.env` et `serveur/.env.test`. **Ces deux fichiers ne partent
jamais dans Git : ils contiennent des secrets.**

Complétez ensuite dans `serveur/.env` :

```ini
ADMIN_NOM=Votre nom
ADMIN_EMAIL=vous@exemple.ma
POPPLER_BIN=C:\chemin\vers\poppler\bin
TESSERACT_BIN=C:\Program Files\Tesseract-OCR
```

### 4. Créer les tables et les données de départ

```bash
npm run db:migrer
npm run db:seed
```

Le seed installe les 7 rôles, les 21 types de pièces, les 22 étiquettes, les
clients du §4 — et votre compte administrateur, avec un **mot de passe
provisoire affiché une seule fois**. Changez-le dans Profil.

### 5. Lancer

```bash
npm run dev
```

Trois choses démarrent : l'API (`127.0.0.1:8080`), les écrans
(`127.0.0.1:5173`) et le worker (relève du courriel, corbeille, sauvegardes).

Ouvrez **http://127.0.0.1:5173**.

---

## Verser vos archives existantes

Si vous avez un dossier rangé en `client / année / marché / fichiers` :

```bash
npm run archives -w serveur -- "C:\chemin\du\dossier"
```

Sans option, c'est une **simulation** : rien n'est écrit, vous voyez seulement
ce qui serait créé. Pour appliquer :

```bash
npm run archives -w serveur -- "C:\chemin\du\dossier" --oui --documents
```

Vos fichiers d'origine ne sont ni déplacés ni modifiés : l'application en fait
une copie dans son propre stockage.

Ensuite, faites lire les documents et proposer un classement :

```bash
npm run classer -w serveur -- --oui     # remplit l'écran « À classer »
npm run doublons -w serveur -- --oui    # remplit « À vérifier »
```

---

## Brancher votre boîte Gmail

Dans **Paramètres → Comptes mail** :

1. Activez la **validation en deux étapes** sur votre compte Google.
2. Créez un **mot de passe d'application** (Compte Google → Sécurité) et
   collez-le : il est chiffré en base, et jamais réaffiché.
3. Créez le libellé **`iCity-Documents`** dans Gmail.
4. Pour que vos scans arrivent seuls, ajoutez un **filtre Gmail** :
   *De : adresse du copieur* → *Appliquer le libellé `iCity-Documents`*.
5. Cliquez **Tester la connexion**, puis **Relever maintenant**.

L'application ne lit que ce libellé. Après traitement, elle pose
`iCity-Verse` sur le message et mémorise son identifiant : rien n'est traité
deux fois, et elle ne se fie jamais au « non lu ».

---

## Sauvegarde et restauration

```bash
npm run sauvegarder -w serveur                      # base + fichiers, horodatée
npm run restaurer -w serveur -- "<dossier>"         # vérifie la sauvegarde
npm run restaurer -w serveur -- "<dossier>" --oui   # restaure pour de bon
```

Le worker en lance une **chaque dimanche à 2 h**, et garde les quatre
dernières. **Testez la restauration au moins une fois** : une sauvegarde qu'on
n'a jamais restaurée n'est pas une sauvegarde.

---

## Les commandes, en résumé

| Commande | Ce qu'elle fait |
|---|---|
| `npm run dev` | API + écrans + worker |
| `npm test` | Toute la suite de tests |
| `npm run build` | Construit les écrans pour la production |
| `npm run archives -w serveur` | Verse un dossier d'archives classées |
| `npm run classer -w serveur` | Lit les documents et propose un classement |
| `npm run doublons -w serveur` | Cherche les pièces scannées deux fois |
| `npm run sauvegarder -w serveur` | Sauvegarde complète |
| `npm run paperless -w serveur` | Importe l'ancienne installation Paperless |
| `npm run cle -w serveur` | Génère une clé de chiffrement |

---

## Comment le code est rangé

```
icity-ged/
├── commun/     les règles partagées : rôles, droits, marchés, circuit, formulaires
├── serveur/    l'API (Fastify), la base (Prisma/PostgreSQL), l'OCR, le courriel
│   ├── prisma/     le schéma et les migrations
│   ├── scripts/    les commandes ci-dessus
│   └── src/
│       ├── routes/     une route par écran
│       └── services/   les règles métier
└── client/     les écrans (React + Vite + Tailwind)
```

Le code métier est en français (`Marche`, `Document`, `Client`), et les
commentaires expliquent **pourquoi** une règle existe — pas ce que fait la
ligne suivante.

---

## Si quelque chose ne va pas

| Message | Cause | Geste |
|---|---|---|
| `PostgreSQL ne répond pas` | service arrêté | Services Windows → postgresql-x64-17 → Démarrer |
| `password authentication failed` | mot de passe changé | vérifiez `DATABASE_URL` dans `serveur/.env` |
| `Le port 8080 est déjà utilisé` | une autre application l'occupe | changez `PORT` dans `serveur/.env` |
| Les tests s'arrêtent (code 134) | mémoire saturée | fermez `npm run dev` avant `npm test` |
| L'aperçu PDF reste vide | le document n'a pas de fichier | vérifiez `serveur/stockage/` |

L'application n'écoute que **127.0.0.1** : elle n'est jamais visible depuis le
réseau.
