-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "nom" VARCHAR(80) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "email" VARCHAR(191) NOT NULL,
    "mot_de_passe" VARCHAR(100),
    "role_id" INTEGER NOT NULL,
    "avatar" VARCHAR(255),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "derniere_connexion" TIMESTAMP(3),
    "deux_facteurs_secret" TEXT,
    "deux_facteurs_active_le" TIMESTAMP(3),
    "deux_facteurs_dernier_pas" INTEGER,
    "codes_secours" JSONB,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "jeton_csrf" VARCHAR(64) NOT NULL,
    "attente_deux_facteurs" BOOLEAN NOT NULL DEFAULT false,
    "se_souvenir" BOOLEAN NOT NULL DEFAULT false,
    "ip" VARCHAR(45),
    "agent" VARCHAR(255),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "derniere_activite" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expire_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jetons" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "empreinte" VARCHAR(64) NOT NULL,
    "expire_le" TIMESTAMP(3) NOT NULL,
    "utilise_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jetons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "action" VARCHAR(60) NOT NULL,
    "objet_type" VARCHAR(40),
    "objet_id" INTEGER,
    "avant" JSONB,
    "apres" JSONB,
    "commentaire" TEXT,
    "ip" VARCHAR(45),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(160) NOT NULL,
    "sigle" VARCHAR(40),
    "synonymes" JSONB,
    "domaines_email" JSONB,
    "interne" BOOLEAN NOT NULL DEFAULT false,
    "dossier_origine" VARCHAR(191),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "types_documents" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "ordre_cycle" INTEGER,
    "piece_attendue" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "types_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etiquettes" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(80) NOT NULL,
    "couleur" VARCHAR(9) NOT NULL,
    "famille" VARCHAR(20) NOT NULL,

    CONSTRAINT "etiquettes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marches" (
    "id" SERIAL NOT NULL,
    "reference" VARCHAR(80) NOT NULL,
    "reference_normalisee" VARCHAR(80) NOT NULL,
    "variantes" JSONB,
    "client_id" INTEGER,
    "objet" VARCHAR(255),
    "numero_ao" VARCHAR(60),
    "lot" VARCHAR(10),
    "montant_ht" DECIMAL(14,2),
    "montant_ttc" DECIMAL(14,2),
    "date_signature" DATE,
    "date_os" DATE,
    "delai_mois" INTEGER,
    "date_fin" DATE,
    "ville" VARCHAR(80),
    "responsable_id" INTEGER,
    "emplacement_papier" VARCHAR(160),
    "statut_affaire" VARCHAR(40),
    "conservation" VARCHAR(20),
    "signe" BOOLEAN NOT NULL DEFAULT false,
    "objet_technique" VARCHAR(40),
    "dossier_origine" VARCHAR(191),
    "phase" VARCHAR(20) NOT NULL DEFAULT 'attente',
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "titre" VARCHAR(255) NOT NULL,
    "marche_id" INTEGER,
    "client_id" INTEGER,
    "type_document_id" INTEGER,
    "date_document" DATE,
    "chemin_original" VARCHAR(255),
    "chemin_archive" VARCHAR(255),
    "chemin_vignette" VARCHAR(255),
    "nom_origine" VARCHAR(255),
    "sha256" VARCHAR(64),
    "taille" BIGINT,
    "pages" INTEGER,
    "texte_ocr" TEXT,
    "langue" VARCHAR(20),
    "statut_ocr" VARCHAR(20) NOT NULL DEFAULT 'en_attente',
    "ocr_page_courante" INTEGER,
    "ocr_confiance" INTEGER,
    "lot_scan" VARCHAR(40),
    "page_scan" INTEGER,
    "statut_classement" VARCHAR(20) NOT NULL DEFAULT 'en_attente',
    "objet_technique" VARCHAR(40),
    "champs_verrouilles" JSONB,
    "source" VARCHAR(20) NOT NULL DEFAULT 'versement',
    "etat_circuit" VARCHAR(30) NOT NULL DEFAULT 'brouillon',
    "confidentialite" VARCHAR(20) NOT NULL DEFAULT 'interne',
    "criticite" VARCHAR(20) NOT NULL DEFAULT 'courant',
    "verse_par" INTEGER,
    "supprime_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_etiquette" (
    "document_id" INTEGER NOT NULL,
    "etiquette_id" INTEGER NOT NULL,

    CONSTRAINT "document_etiquette_pkey" PRIMARY KEY ("document_id","etiquette_id")
);

-- CreateTable
CREATE TABLE "suggestions" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "champ" VARCHAR(30) NOT NULL,
    "valeur" VARCHAR(191) NOT NULL,
    "cible_id" INTEGER,
    "raison" TEXT,
    "confiance" INTEGER NOT NULL DEFAULT 50,
    "statut" VARCHAR(20) NOT NULL DEFAULT 'en_attente',
    "decidee_par" INTEGER,
    "decidee_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doublons" (
    "id" SERIAL NOT NULL,
    "document_a_id" INTEGER NOT NULL,
    "document_b_id" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "raisons" JSONB,
    "decision" VARCHAR(20) NOT NULL DEFAULT 'en_attente',
    "decide_par" INTEGER,
    "decide_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doublons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comptes_mail" (
    "id" SERIAL NOT NULL,
    "libelle" VARCHAR(120) NOT NULL,
    "adresse" VARCHAR(191) NOT NULL,
    "serveur" VARCHAR(120) NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 993,
    "securite" VARCHAR(10) NOT NULL DEFAULT 'ssl',
    "mot_de_passe" TEXT NOT NULL,
    "dossier_surveille" VARCHAR(120) NOT NULL DEFAULT 'iCity-Documents',
    "libelle_traitement" VARCHAR(120) NOT NULL DEFAULT 'iCity-Verse',
    "adresses_scanner" JSONB,
    "age_max_jours" INTEGER NOT NULL DEFAULT 30,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "derniere_releve" TIMESTAMP(3),
    "releve_en_cours_depuis" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comptes_mail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "releves" (
    "id" SERIAL NOT NULL,
    "compte_id" INTEGER NOT NULL,
    "debut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),
    "mails_lus" INTEGER NOT NULL DEFAULT 0,
    "pieces_versees" INTEGER NOT NULL DEFAULT 0,
    "erreur" TEXT,

    CONSTRAINT "releves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mails" (
    "id" SERIAL NOT NULL,
    "compte_id" INTEGER NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "message_id" VARCHAR(255) NOT NULL,
    "in_reply_to" VARCHAR(255),
    "references_mail" TEXT,
    "fil" VARCHAR(255) NOT NULL,
    "expediteur" VARCHAR(255) NOT NULL,
    "destinataires" JSONB,
    "date" TIMESTAMP(3) NOT NULL,
    "objet" VARCHAR(255) NOT NULL,
    "corps_texte" TEXT,
    "corps_html" TEXT,
    "client_id" INTEGER,
    "marche_id" INTEGER,
    "statut_rattachement" VARCHAR(20) NOT NULL DEFAULT 'a_rattacher',
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pieces_jointes_mail" (
    "id" SERIAL NOT NULL,
    "mail_id" INTEGER NOT NULL,
    "nom" VARCHAR(255) NOT NULL,
    "taille" BIGINT,
    "document_id" INTEGER,

    CONSTRAINT "pieces_jointes_mail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "chemin" VARCHAR(255) NOT NULL,
    "nom_origine" VARCHAR(255),
    "sha256" VARCHAR(64) NOT NULL,
    "taille" BIGINT,
    "pages" INTEGER,
    "auteur_id" INTEGER,
    "motif" VARCHAR(255),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "jetons_empreinte_key" ON "jetons"("empreinte");

-- CreateIndex
CREATE INDEX "jetons_user_id_type_idx" ON "jetons"("user_id", "type");

-- CreateIndex
CREATE INDEX "journal_objet_type_objet_id_idx" ON "journal"("objet_type", "objet_id");

-- CreateIndex
CREATE INDEX "journal_cree_le_idx" ON "journal"("cree_le");

-- CreateIndex
CREATE UNIQUE INDEX "clients_nom_key" ON "clients"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "types_documents_nom_key" ON "types_documents"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "types_documents_code_key" ON "types_documents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "etiquettes_nom_key" ON "etiquettes"("nom");

-- CreateIndex
CREATE INDEX "etiquettes_famille_idx" ON "etiquettes"("famille");

-- CreateIndex
CREATE UNIQUE INDEX "marches_reference_normalisee_key" ON "marches"("reference_normalisee");

-- CreateIndex
CREATE INDEX "marches_client_id_idx" ON "marches"("client_id");

-- CreateIndex
CREATE INDEX "marches_phase_idx" ON "marches"("phase");

-- CreateIndex
CREATE UNIQUE INDEX "documents_sha256_key" ON "documents"("sha256");

-- CreateIndex
CREATE INDEX "documents_marche_id_idx" ON "documents"("marche_id");

-- CreateIndex
CREATE INDEX "documents_client_id_idx" ON "documents"("client_id");

-- CreateIndex
CREATE INDEX "documents_type_document_id_idx" ON "documents"("type_document_id");

-- CreateIndex
CREATE INDEX "documents_supprime_le_idx" ON "documents"("supprime_le");

-- CreateIndex
CREATE INDEX "documents_statut_ocr_idx" ON "documents"("statut_ocr");

-- CreateIndex
CREATE INDEX "documents_lot_scan_idx" ON "documents"("lot_scan");

-- CreateIndex
CREATE INDEX "documents_titre_idx" ON "documents"("titre");

-- CreateIndex
CREATE INDEX "suggestions_statut_idx" ON "suggestions"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "suggestions_document_id_champ_key" ON "suggestions"("document_id", "champ");

-- CreateIndex
CREATE INDEX "doublons_decision_idx" ON "doublons"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "doublons_document_a_id_document_b_id_key" ON "doublons"("document_a_id", "document_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "comptes_mail_adresse_key" ON "comptes_mail"("adresse");

-- CreateIndex
CREATE INDEX "releves_compte_id_idx" ON "releves"("compte_id");

-- CreateIndex
CREATE UNIQUE INDEX "mails_message_id_key" ON "mails"("message_id");

-- CreateIndex
CREATE INDEX "mails_fil_idx" ON "mails"("fil");

-- CreateIndex
CREATE INDEX "mails_client_id_idx" ON "mails"("client_id");

-- CreateIndex
CREATE INDEX "mails_marche_id_idx" ON "mails"("marche_id");

-- CreateIndex
CREATE INDEX "mails_statut_rattachement_idx" ON "mails"("statut_rattachement");

-- CreateIndex
CREATE INDEX "pieces_jointes_mail_mail_id_idx" ON "pieces_jointes_mail"("mail_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_numero_key" ON "document_versions"("document_id", "numero");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jetons" ADD CONSTRAINT "jetons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal" ADD CONSTRAINT "journal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marches" ADD CONSTRAINT "marches_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marches" ADD CONSTRAINT "marches_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_marche_id_fkey" FOREIGN KEY ("marche_id") REFERENCES "marches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_document_id_fkey" FOREIGN KEY ("type_document_id") REFERENCES "types_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_verse_par_fkey" FOREIGN KEY ("verse_par") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_etiquette" ADD CONSTRAINT "document_etiquette_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_etiquette" ADD CONSTRAINT "document_etiquette_etiquette_id_fkey" FOREIGN KEY ("etiquette_id") REFERENCES "etiquettes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doublons" ADD CONSTRAINT "doublons_document_a_id_fkey" FOREIGN KEY ("document_a_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doublons" ADD CONSTRAINT "doublons_document_b_id_fkey" FOREIGN KEY ("document_b_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releves" ADD CONSTRAINT "releves_compte_id_fkey" FOREIGN KEY ("compte_id") REFERENCES "comptes_mail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mails" ADD CONSTRAINT "mails_compte_id_fkey" FOREIGN KEY ("compte_id") REFERENCES "comptes_mail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mails" ADD CONSTRAINT "mails_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mails" ADD CONSTRAINT "mails_marche_id_fkey" FOREIGN KEY ("marche_id") REFERENCES "marches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces_jointes_mail" ADD CONSTRAINT "pieces_jointes_mail_mail_id_fkey" FOREIGN KEY ("mail_id") REFERENCES "mails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces_jointes_mail" ADD CONSTRAINT "pieces_jointes_mail_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
