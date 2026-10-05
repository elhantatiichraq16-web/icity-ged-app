-- Les activités, sur le modèle d'Odoo : un rappel posé sur la fiche d'un
-- marché ou d'un client, pour une personne, à une date.

-- CreateTable
CREATE TABLE "activites" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'a_faire',
    "resume" VARCHAR(160) NOT NULL,
    "note" TEXT,
    "echeance" DATE NOT NULL,
    "assigne_id" INTEGER NOT NULL,
    "cree_par" INTEGER,
    "marche_id" INTEGER,
    "client_id" INTEGER,
    "faite_le" TIMESTAMP(3),
    "compte_rendu" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activites_assigne_id_faite_le_idx" ON "activites"("assigne_id", "faite_le");

-- CreateIndex
CREATE INDEX "activites_marche_id_idx" ON "activites"("marche_id");

-- CreateIndex
CREATE INDEX "activites_client_id_idx" ON "activites"("client_id");

-- AddForeignKey
ALTER TABLE "activites" ADD CONSTRAINT "activites_assigne_id_fkey" FOREIGN KEY ("assigne_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activites" ADD CONSTRAINT "activites_cree_par_fkey" FOREIGN KEY ("cree_par") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activites" ADD CONSTRAINT "activites_marche_id_fkey" FOREIGN KEY ("marche_id") REFERENCES "marches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activites" ADD CONSTRAINT "activites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

