-- L'archivage des marchés : un marché archivé sort de la vue courante mais
-- reste consultable, en lecture seule. On garde qui l'a archivé, et quand.

-- AlterTable
ALTER TABLE "marches" ADD COLUMN     "archive_le" TIMESTAMP(3),
ADD COLUMN     "archive_par" INTEGER;

-- CreateIndex
CREATE INDEX "marches_archive_le_idx" ON "marches"("archive_le");

-- AddForeignKey
ALTER TABLE "marches" ADD CONSTRAINT "marches_archive_par_fkey" FOREIGN KEY ("archive_par") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
