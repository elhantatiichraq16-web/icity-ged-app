-- Une activité peut viser une commande fournisseur (« relancer pour la livraison »).

-- AlterTable
ALTER TABLE "activites" ADD COLUMN     "commande_id" INTEGER;

-- CreateIndex
CREATE INDEX "activites_commande_id_idx" ON "activites"("commande_id");

-- AddForeignKey
ALTER TABLE "activites" ADD CONSTRAINT "activites_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes_fournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

