-- Le planning d'un marché : ses étapes, comme le module Projet d'Odoo.

-- CreateTable
CREATE TABLE "taches_marches" (
    "id" SERIAL NOT NULL,
    "marche_id" INTEGER NOT NULL,
    "titre" VARCHAR(160) NOT NULL,
    "debut" DATE NOT NULL,
    "fin" DATE NOT NULL,
    "responsable_id" INTEGER,
    "avancement" INTEGER NOT NULL DEFAULT 0,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taches_marches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "taches_marches_marche_id_idx" ON "taches_marches"("marche_id");

-- AddForeignKey
ALTER TABLE "taches_marches" ADD CONSTRAINT "taches_marches_marche_id_fkey" FOREIGN KEY ("marche_id") REFERENCES "marches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taches_marches" ADD CONSTRAINT "taches_marches_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

