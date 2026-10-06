-- AlterTable
ALTER TABLE "activites" ADD COLUMN     "duree_minutes" INTEGER,
ADD COLUMN     "heure" VARCHAR(5),
ADD COLUMN     "rappel_jours" INTEGER,
ADD COLUMN     "rappel_notifie_le" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "participants_activites" (
    "activite_id" INTEGER NOT NULL,
    "utilisateur_id" INTEGER NOT NULL,

    CONSTRAINT "participants_activites_pkey" PRIMARY KEY ("activite_id","utilisateur_id")
);

-- CreateIndex
CREATE INDEX "participants_activites_utilisateur_id_idx" ON "participants_activites"("utilisateur_id");

-- AddForeignKey
ALTER TABLE "participants_activites" ADD CONSTRAINT "participants_activites_activite_id_fkey" FOREIGN KEY ("activite_id") REFERENCES "activites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants_activites" ADD CONSTRAINT "participants_activites_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

