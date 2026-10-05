-- La fiche fournisseur sur le modèle d'Odoo : identité, coordonnées, autres
-- écritures du nom, contacts ; les activités peuvent viser un fournisseur.

-- AlterTable
ALTER TABLE "activites" ADD COLUMN     "fournisseur_id" INTEGER;

-- AlterTable
ALTER TABLE "fournisseurs" ADD COLUMN     "adresse" VARCHAR(255),
ADD COLUMN     "code_postal" VARCHAR(10),
ADD COLUMN     "ice" VARCHAR(15),
ADD COLUMN     "identifiant_fiscal" VARCHAR(20),
ADD COLUMN     "pays" VARCHAR(60),
ADD COLUMN     "registre_commerce" VARCHAR(40),
ADD COLUMN     "site_web" VARCHAR(191),
ADD COLUMN     "synonymes" JSONB,
ADD COLUMN     "ville" VARCHAR(80);

-- CreateTable
CREATE TABLE "contacts_fournisseurs" (
    "id" SERIAL NOT NULL,
    "fournisseur_id" INTEGER NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "fonction" VARCHAR(120),
    "telephone" VARCHAR(30),
    "mobile" VARCHAR(30),
    "email" VARCHAR(191),
    "notes" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_fournisseurs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_fournisseurs_fournisseur_id_idx" ON "contacts_fournisseurs"("fournisseur_id");

-- CreateIndex
CREATE INDEX "activites_fournisseur_id_idx" ON "activites"("fournisseur_id");

-- AddForeignKey
ALTER TABLE "contacts_fournisseurs" ADD CONSTRAINT "contacts_fournisseurs_fournisseur_id_fkey" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activites" ADD CONSTRAINT "activites_fournisseur_id_fkey" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

