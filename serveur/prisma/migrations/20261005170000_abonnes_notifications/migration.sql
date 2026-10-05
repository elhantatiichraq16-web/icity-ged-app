-- Abonnés et notifications, sur le modèle d'Odoo : suivre une fiche, être
-- mentionné dans une note.

-- CreateTable
CREATE TABLE "abonnements" (
    "id" SERIAL NOT NULL,
    "utilisateur_id" INTEGER NOT NULL,
    "objet_type" VARCHAR(30) NOT NULL,
    "objet_id" INTEGER NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abonnements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "utilisateur_id" INTEGER NOT NULL,
    "par_id" INTEGER,
    "genre" VARCHAR(20) NOT NULL,
    "texte" VARCHAR(255) NOT NULL,
    "lien" VARCHAR(255) NOT NULL,
    "lue_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "abonnements_objet_type_objet_id_idx" ON "abonnements"("objet_type", "objet_id");

-- CreateIndex
CREATE UNIQUE INDEX "abonnements_utilisateur_id_objet_type_objet_id_key" ON "abonnements"("utilisateur_id", "objet_type", "objet_id");

-- CreateIndex
CREATE INDEX "notifications_utilisateur_id_lue_le_idx" ON "notifications"("utilisateur_id", "lue_le");

-- AddForeignKey
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_par_id_fkey" FOREIGN KEY ("par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

