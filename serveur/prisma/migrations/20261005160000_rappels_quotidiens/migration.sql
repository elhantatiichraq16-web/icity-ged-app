-- Le rappel du matin : les activités en retard et du jour, par mail.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "rappel_envoye_le" DATE,
ADD COLUMN     "rappel_quotidien" BOOLEAN NOT NULL DEFAULT true;

