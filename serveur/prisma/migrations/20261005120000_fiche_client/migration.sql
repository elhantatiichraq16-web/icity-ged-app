-- La fiche client sur le modèle d'Odoo : identité, coordonnées, notes, et les
-- personnes à joindre chez le client.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "adresse" VARCHAR(255),
ADD COLUMN     "code_postal" VARCHAR(10),
ADD COLUMN     "email" VARCHAR(191),
ADD COLUMN     "ice" VARCHAR(15),
ADD COLUMN     "identifiant_fiscal" VARCHAR(20),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "pays" VARCHAR(60),
ADD COLUMN     "registre_commerce" VARCHAR(40),
ADD COLUMN     "site_web" VARCHAR(191),
ADD COLUMN     "telephone" VARCHAR(30),
ADD COLUMN     "type_organisme" VARCHAR(30),
ADD COLUMN     "ville" VARCHAR(80);

-- CreateTable
CREATE TABLE "contacts_clients" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "fonction" VARCHAR(120),
    "telephone" VARCHAR(30),
    "mobile" VARCHAR(30),
    "email" VARCHAR(191),
    "notes" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_clients_client_id_idx" ON "contacts_clients"("client_id");

-- AddForeignKey
ALTER TABLE "contacts_clients" ADD CONSTRAINT "contacts_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

