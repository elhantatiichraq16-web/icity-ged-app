-- AlterTable
ALTER TABLE "activites" ADD COLUMN     "offre_id" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "alerte_offres" VARCHAR(10) NOT NULL DEFAULT 'cloche',
ADD COLUMN     "alerte_offres_score" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "resume_offres_envoye_le" DATE;

-- CreateTable
CREATE TABLE "sources_marches" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "site_web" VARCHAR(255) NOT NULL,
    "connecteur" VARCHAR(20) NOT NULL,
    "adresse" VARCHAR(500),
    "frequence_minutes" INTEGER NOT NULL DEFAULT 60,
    "pages_max" INTEGER NOT NULL DEFAULT 1,
    "delai_requetes_ms" INTEGER NOT NULL DEFAULT 3000,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "autoriser_http" BOOLEAN NOT NULL DEFAULT false,
    "parametres" JSONB,
    "secrets" TEXT,
    "derniere_sync_le" TIMESTAMP(3),
    "derniere_sync_etat" VARCHAR(20),
    "derniere_sync_resume" VARCHAR(255),
    "derniere_erreur" TEXT,
    "echecs_consecutifs" INTEGER NOT NULL DEFAULT 0,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_marches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "synchronisations_sources" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "declenchement" VARCHAR(20) NOT NULL,
    "declenche_par" INTEGER,
    "debut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),
    "etat" VARCHAR(20) NOT NULL DEFAULT 'en_cours',
    "pages_lues" INTEGER NOT NULL DEFAULT 0,
    "recues" INTEGER NOT NULL DEFAULT 0,
    "nouvelles" INTEGER NOT NULL DEFAULT 0,
    "mises_a_jour" INTEGER NOT NULL DEFAULT 0,
    "erreur" TEXT,

    CONSTRAINT "synchronisations_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offres_potentielles" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "id_externe" VARCHAR(191) NOT NULL,
    "url_officielle" VARCHAR(1000),
    "reference" VARCHAR(120),
    "objet" TEXT NOT NULL,
    "resume" TEXT,
    "acheteur" VARCHAR(255),
    "categorie" VARCHAR(120),
    "domaines" JSONB,
    "procedure" VARCHAR(160),
    "lieu" VARCHAR(255),
    "date_publication" DATE,
    "date_limite" TIMESTAMP(3),
    "estimation" DECIMAL(16,2),
    "caution" DECIMAL(16,2),
    "lots" JSONB,
    "reponse_electronique" VARCHAR(120),
    "documents" JSONB,
    "premiere_detection" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "derniere_verification" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disparue_le" TIMESTAMP(3),
    "statut_externe" VARCHAR(60),
    "statut" VARCHAR(20) NOT NULL DEFAULT 'nouvelle',
    "score" INTEGER NOT NULL DEFAULT 0,
    "raisons_score" JSONB,
    "mots_cles" JSONB,
    "responsable_id" INTEGER,
    "notes" TEXT,
    "archive_le" TIMESTAMP(3),
    "marche_id" INTEGER,
    "convertie_le" TIMESTAMP(3),
    "alertee_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offres_potentielles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favoris_offres" (
    "utilisateur_id" INTEGER NOT NULL,
    "offre_id" INTEGER NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favoris_offres_pkey" PRIMARY KEY ("utilisateur_id","offre_id")
);

-- CreateTable
CREATE TABLE "criteres_marches" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "criteres" JSONB NOT NULL,
    "modifie_par" INTEGER,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "criteres_marches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sources_marches_nom_key" ON "sources_marches"("nom");

-- CreateIndex
CREATE INDEX "synchronisations_sources_source_id_debut_idx" ON "synchronisations_sources"("source_id", "debut");

-- CreateIndex
CREATE UNIQUE INDEX "offres_potentielles_marche_id_key" ON "offres_potentielles"("marche_id");

-- CreateIndex
CREATE INDEX "offres_potentielles_statut_idx" ON "offres_potentielles"("statut");

-- CreateIndex
CREATE INDEX "offres_potentielles_date_limite_idx" ON "offres_potentielles"("date_limite");

-- CreateIndex
CREATE INDEX "offres_potentielles_score_idx" ON "offres_potentielles"("score");

-- CreateIndex
CREATE UNIQUE INDEX "offres_potentielles_source_id_id_externe_key" ON "offres_potentielles"("source_id", "id_externe");

-- CreateIndex
CREATE INDEX "activites_offre_id_idx" ON "activites"("offre_id");

-- AddForeignKey
ALTER TABLE "activites" ADD CONSTRAINT "activites_offre_id_fkey" FOREIGN KEY ("offre_id") REFERENCES "offres_potentielles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "synchronisations_sources" ADD CONSTRAINT "synchronisations_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources_marches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offres_potentielles" ADD CONSTRAINT "offres_potentielles_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources_marches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offres_potentielles" ADD CONSTRAINT "offres_potentielles_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offres_potentielles" ADD CONSTRAINT "offres_potentielles_marche_id_fkey" FOREIGN KEY ("marche_id") REFERENCES "marches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favoris_offres" ADD CONSTRAINT "favoris_offres_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favoris_offres" ADD CONSTRAINT "favoris_offres_offre_id_fkey" FOREIGN KEY ("offre_id") REFERENCES "offres_potentielles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

