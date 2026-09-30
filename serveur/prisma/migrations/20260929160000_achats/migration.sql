-- CreateTable
CREATE TABLE "fournisseurs" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(160) NOT NULL,
    "contact" VARCHAR(160),
    "telephone" VARCHAR(40),
    "email" VARCHAR(191),
    "conditions" VARCHAR(255),
    "notes" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fournisseurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lignes_achat" (
    "id" SERIAL NOT NULL,
    "marche_id" INTEGER NOT NULL,
    "numero" VARCHAR(20),
    "categorie" VARCHAR(80) NOT NULL,
    "designation" VARCHAR(255) NOT NULL,
    "quantite" DECIMAL(12,2) NOT NULL,
    "pu_budget" DECIMAL(14,2),
    "pu_achat" DECIMAL(14,2),
    "pu_vente" DECIMAL(14,2),
    "marque" VARCHAR(120),
    "reference_offre" VARCHAR(160),
    "reference_achat" VARCHAR(160),
    "fournisseur_id" INTEGER,
    "conditions_paiement" VARCHAR(160),
    "delai_livraison" VARCHAR(120),
    "statut" VARCHAR(30) NOT NULL DEFAULT 'en_attente',
    "etd" DATE,
    "commentaire" TEXT,
    "commande_id" INTEGER,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "statut_modifie_le" TIMESTAMP(3),
    "statut_modifie_par" INTEGER,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lignes_achat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commandes_fournisseur" (
    "id" SERIAL NOT NULL,
    "marche_id" INTEGER NOT NULL,
    "fournisseur_id" INTEGER NOT NULL,
    "montant_ttc" DECIMAL(14,2) NOT NULL,
    "avance_pourcent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "modalite" VARCHAR(20) NOT NULL,
    "date_facture" DATE,
    "echeance" DATE,
    "avance_payee_le" DATE,
    "solde_paye_le" DATE,
    "notes" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commandes_fournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fournisseurs_nom_key" ON "fournisseurs"("nom");

-- CreateIndex
CREATE INDEX "lignes_achat_marche_id_idx" ON "lignes_achat"("marche_id");

-- CreateIndex
CREATE INDEX "lignes_achat_fournisseur_id_idx" ON "lignes_achat"("fournisseur_id");

-- CreateIndex
CREATE INDEX "lignes_achat_statut_idx" ON "lignes_achat"("statut");

-- CreateIndex
CREATE INDEX "commandes_fournisseur_marche_id_idx" ON "commandes_fournisseur"("marche_id");

-- CreateIndex
CREATE INDEX "commandes_fournisseur_fournisseur_id_idx" ON "commandes_fournisseur"("fournisseur_id");

-- AddForeignKey
ALTER TABLE "lignes_achat" ADD CONSTRAINT "lignes_achat_marche_id_fkey" FOREIGN KEY ("marche_id") REFERENCES "marches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_achat" ADD CONSTRAINT "lignes_achat_fournisseur_id_fkey" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_achat" ADD CONSTRAINT "lignes_achat_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes_fournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_achat" ADD CONSTRAINT "lignes_achat_statut_modifie_par_fkey" FOREIGN KEY ("statut_modifie_par") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes_fournisseur" ADD CONSTRAINT "commandes_fournisseur_marche_id_fkey" FOREIGN KEY ("marche_id") REFERENCES "marches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes_fournisseur" ADD CONSTRAINT "commandes_fournisseur_fournisseur_id_fkey" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
