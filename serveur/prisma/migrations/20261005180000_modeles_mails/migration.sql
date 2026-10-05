-- Les modèles de mails, comme ceux d'Odoo, et quatre modèles de départ.

-- CreateTable
CREATE TABLE "modeles_mails" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "usage" VARCHAR(20) NOT NULL DEFAULT 'tous',
    "objet" VARCHAR(255) NOT NULL,
    "corps" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modeles_mails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modeles_mails_nom_key" ON "modeles_mails"("nom");


-- Les modèles de départ : à corriger dans Paramètres → Modèles de mails.
INSERT INTO "modeles_mails" ("nom", "usage", "objet", "corps", "modifie_le") VALUES
('Envoi du bon de commande', 'fournisseur', 'Bon de commande {numero_commande} — {marche}',
 E'Bonjour {contact},\n\nVeuillez trouver ci-joint notre bon de commande {numero_commande}, pour un montant de {montant}.\nMerci de nous confirmer sa bonne réception et le délai de livraison.\n\nCordialement,\n{mon_nom}', CURRENT_TIMESTAMP),
('Relance de livraison', 'fournisseur', 'Relance — livraison de la commande {numero_commande}',
 E'Bonjour {contact},\n\nSauf erreur de notre part, le matériel de notre commande {numero_commande} ({marche}) ne nous est pas encore parvenu.\nPouvez-vous nous indiquer la date de livraison prévue ?\n\nCordialement,\n{mon_nom}', CURRENT_TIMESTAMP),
('Demande de PV de réception', 'client', 'Marché {marche} — procès-verbal de réception',
 E'Madame, Monsieur,\n\nLes prestations du marché {marche} ({objet_marche}) étant achevées, nous vous prions de bien vouloir procéder à la réception et nous transmettre le procès-verbal correspondant.\n\nVeuillez agréer nos salutations distinguées.\n{mon_nom}', CURRENT_TIMESTAMP),
('Demande de mainlevée de caution', 'client', 'Marché {marche} — mainlevée de la caution',
 E'Madame, Monsieur,\n\nLa réception définitive du marché {marche} ayant été prononcée, nous vous prions de bien vouloir nous délivrer la mainlevée de la caution correspondante.\n\nVeuillez agréer nos salutations distinguées.\n{mon_nom}', CURRENT_TIMESTAMP);
