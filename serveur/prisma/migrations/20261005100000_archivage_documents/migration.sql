-- L'archivage des pièces : une pièce archivée sort de la vue courante mais
-- reste consultable et modifiable. On garde qui l'a archivée, et quand.

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "archive_le" TIMESTAMP(3),
ADD COLUMN     "archive_par" INTEGER;

-- CreateIndex
CREATE INDEX "documents_archive_le_idx" ON "documents"("archive_le");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_archive_par_fkey" FOREIGN KEY ("archive_par") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
