-- Le suivi des commandes par leurs pièces : un bon de commande, un bon de
-- livraison ou une facture du fournisseur se rattache à sa commande, et la
-- fait avancer (statut des lignes, date de livraison, montant à payer).

-- AlterTable
ALTER TABLE "commandes_fournisseur" ADD COLUMN     "date_commande" DATE,
ALTER COLUMN "montant_ttc" DROP NOT NULL;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "commande_fournisseur_id" INTEGER;

-- CreateIndex
CREATE INDEX "documents_commande_fournisseur_id_idx" ON "documents"("commande_fournisseur_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_commande_fournisseur_id_fkey" FOREIGN KEY ("commande_fournisseur_id") REFERENCES "commandes_fournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Les types des pièces de fournisseur : distincts du bon de livraison et de
-- la facture du client, qui font avancer la phase du marché.
INSERT INTO "types_documents" ("nom", "code", "piece_attendue") VALUES
  ('Bon de commande fournisseur', 'BCF', false),
  ('Bon de livraison fournisseur', 'BLF', false),
  ('Facture fournisseur', 'FACF', false)
ON CONFLICT DO NOTHING;
