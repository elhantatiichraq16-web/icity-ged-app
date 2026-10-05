/**
 * Le bon de commande d'un fournisseur, en PDF, comme celui qu'Odoo imprime.
 *
 * En tête : la société qui commande (une société interne du référentiel des
 * clients) et le fournisseur ; puis le marché, les lignes (quantité, prix
 * unitaire, total), les totaux HT, TVA et TTC, les conditions de paiement et
 * la place des signatures.
 *
 * pdf-lib, en pur JavaScript : ni navigateur ni mémoire supplémentaire. Ses
 * polices standard ne connaissent que l'alphabet latin courant : un caractère
 * qu'elles ne savent pas écrire est remplacé, plutôt que de faire échouer le
 * document.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { modalitePaiement, TVA } from '@icity/commun/achats';

const A4 = [595.28, 841.89];
const MARGE = 42;
const ENCRE = rgb(0.06, 0.09, 0.16);
const GRIS = rgb(0.39, 0.45, 0.55);
const TRAIT = rgb(0.85, 0.88, 0.92);
const CYAN = rgb(0.05, 0.51, 0.59);

/** Le numéro d'un bon de commande : BC-2026-0006. */
export const numeroBonCommande = (commande) => `BC-${(commande.dateCommande ?? commande.creeLe ?? new Date()).getFullYear()}-${String(commande.id).padStart(4, '0')}`;

/** Un montant en dirhams, avec des espaces simples (les polices standard n'ont pas l'espace fine). */
const dh = (n) =>
  `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0).replace(/[  ]/g, ' ')} DH`;
const qte = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n ?? 0).replace(/[  ]/g, ' ');
const dateFr = (d) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Africa/Casablanca' }).format(d);

/**
 * @param {object} p
 * @param {object} p.commande  la commande, avec `lignes`, `fournisseur` et `marche`
 * @param {object | null} p.emetteur  la société qui commande (client interne)
 * @param {Date} [p.date]
 * @returns {Promise<Uint8Array>}
 */
export async function genererBonCommande({ commande, emetteur, date = new Date() }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Bon de commande ${numeroBonCommande(commande)}`);
  pdf.setAuthor(emetteur?.nom ?? '');
  pdf.setCreator(emetteur?.nom ?? '');
  pdf.setProducer(emetteur?.nom ?? '');
  // La date du jour, sans l'heure : le même bon, le même jour, donne le même
  // fichier, que le fonds ne range qu'une fois.
  const jour = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  pdf.setCreationDate(jour);
  pdf.setModificationDate(jour);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Ce que la police sait écrire ; le reste devient « ? » plutôt qu'une erreur.
  const sait = new Map();
  const propre = (texte) =>
    [...String(texte ?? '').replace(/[  \t]/g, ' ').replace(/\r?\n/g, ' ')]
      .map((c) => {
        if (!sait.has(c)) {
          try {
            normal.encodeText(c);
            sait.set(c, c);
          } catch {
            sait.set(c, '?');
          }
        }
        return sait.get(c);
      })
      .join('');

  let page = pdf.addPage(A4);
  const [largeur, hauteur] = A4;
  let y = hauteur - MARGE;

  const ecrire = (texte, x, yy, { taille = 9.5, police = normal, couleur = ENCRE } = {}) => page.drawText(propre(texte), { x, y: yy, size: taille, font: police, color: couleur });
  const aDroite = (texte, xDroite, yy, options = {}) => {
    const t = propre(texte);
    const l = (options.police ?? normal).widthOfTextAtSize(t, options.taille ?? 9.5);
    ecrire(t, xDroite - l, yy, options);
  };
  /** Coupe un texte en lignes qui tiennent dans `max` points. */
  const couper = (texte, max, taille = 9.5, police = normal) => {
    const mots = propre(texte).split(' ').filter(Boolean);
    const lignes = [];
    let courante = '';
    for (const mot of mots) {
      const essai = courante ? `${courante} ${mot}` : mot;
      if (police.widthOfTextAtSize(essai, taille) <= max) courante = essai;
      else {
        if (courante) lignes.push(courante);
        courante = mot;
      }
    }
    if (courante) lignes.push(courante);
    return lignes.length ? lignes : [''];
  };

  // ── En-tête : la société qui commande, et le titre ──
  ecrire(emetteur?.nom ?? 'Société', MARGE, y, { taille: 15, police: gras, couleur: CYAN });
  const coordonnees = [
    emetteur?.adresse,
    [emetteur?.codePostal, emetteur?.ville].filter(Boolean).join(' '),
    emetteur?.telephone && `Tél. ${emetteur.telephone}`,
    emetteur?.email,
    emetteur?.ice && `ICE ${emetteur.ice}`,
    [emetteur?.identifiantFiscal && `IF ${emetteur.identifiantFiscal}`, emetteur?.registreCommerce && `RC ${emetteur.registreCommerce}`].filter(Boolean).join(' · '),
  ].filter(Boolean);
  coordonnees.forEach((l, i) => ecrire(l, MARGE, y - 16 - i * 12, { taille: 9, couleur: GRIS }));

  aDroite('BON DE COMMANDE', largeur - MARGE, y, { taille: 16, police: gras });
  aDroite(numeroBonCommande(commande), largeur - MARGE, y - 18, { taille: 11, police: gras, couleur: CYAN });
  aDroite(`Date : ${dateFr(date)}`, largeur - MARGE, y - 32, { taille: 9.5, couleur: GRIS });

  y -= Math.max(16 + coordonnees.length * 12, 44) + 18;

  // ── Le fournisseur, dans un cadre, et le marché ──
  const f = commande.fournisseur;
  const blocFournisseur = [
    f?.adresse,
    [f?.codePostal, f?.ville, f?.pays].filter(Boolean).join(' '),
    f?.contact && `À l’attention de ${f.contact}`,
    [f?.telephone && `Tél. ${f.telephone}`, f?.email].filter(Boolean).join(' · '),
    f?.ice && `ICE ${f.ice}`,
  ].filter(Boolean);
  const hauteurCadre = 30 + blocFournisseur.length * 12;
  const xCadre = largeur / 2;
  page.drawRectangle({ x: xCadre, y: y - hauteurCadre, width: largeur - MARGE - xCadre, height: hauteurCadre, borderColor: TRAIT, borderWidth: 1 });
  ecrire('FOURNISSEUR', xCadre + 10, y - 14, { taille: 8, police: gras, couleur: GRIS });
  ecrire(f?.nom ?? '—', xCadre + 10, y - 27, { taille: 11, police: gras });
  blocFournisseur.forEach((l, i) => ecrire(l, xCadre + 10, y - 41 - i * 12, { taille: 9 }));

  ecrire('MARCHÉ', MARGE, y - 14, { taille: 8, police: gras, couleur: GRIS });
  ecrire(commande.marche?.reference ?? '—', MARGE, y - 27, { taille: 11, police: gras });
  const objet = commande.marche?.objet ? couper(commande.marche.objet, xCadre - MARGE - 16, 9).slice(0, 4) : [];
  objet.forEach((l, i) => ecrire(l, MARGE, y - 41 - i * 12, { taille: 9, couleur: GRIS }));

  // On descend sous le plus haut des deux blocs : le marché peut dépasser le cadre.
  y -= Math.max(hauteurCadre, 33 + objet.length * 12) + 26;

  // ── Les lignes ──
  const colonnes = [
    { titre: 'N°', x: MARGE, largeur: 24 },
    { titre: 'Désignation', x: MARGE + 24, largeur: 238 },
    { titre: 'Qté', x: MARGE + 262, largeur: 44, droite: true },
    { titre: 'PU HT', x: MARGE + 306, largeur: 100, droite: true },
    { titre: 'Total HT', x: MARGE + 406, largeur: largeur - 2 * MARGE - 406, droite: true },
  ];
  const enTete = () => {
    page.drawRectangle({ x: MARGE, y: y - 6, width: largeur - 2 * MARGE, height: 20, color: rgb(0.96, 0.97, 0.98) });
    for (const c of colonnes) {
      if (c.droite) aDroite(c.titre, c.x + c.largeur - 4, y, { taille: 8.5, police: gras, couleur: GRIS });
      else ecrire(c.titre, c.x + 4, y, { taille: 8.5, police: gras, couleur: GRIS });
    }
    y -= 22;
  };
  enTete();

  let totalHt = 0;
  for (const [i, l] of commande.lignes.entries()) {
    const pu = l.puAchat === null || l.puAchat === undefined ? null : Number(l.puAchat);
    const quantite = Number(l.quantite ?? 0);
    const ligneHt = pu === null ? null : pu * quantite;
    if (ligneHt !== null) totalHt += ligneHt;

    const precisions = [l.marque, l.referenceAchat ?? l.referenceOffre].filter(Boolean).join(' · ');
    const texte = couper(l.designation, colonnes[1].largeur - 8);
    const sous = precisions ? couper(precisions, colonnes[1].largeur - 8, 8.5) : [];
    const hauteurLigne = (texte.length + sous.length) * 11.5 + 8;

    // Une nouvelle page quand la ligne ne tient plus, avec l'en-tête du tableau.
    if (y - hauteurLigne < MARGE + 170) {
      page = pdf.addPage(A4);
      y = hauteur - MARGE;
      enTete();
    }
    ecrire(String(l.numero ?? i + 1), colonnes[0].x + 4, y, { taille: 9 });
    texte.forEach((t, k) => ecrire(t, colonnes[1].x + 4, y - k * 11.5, { taille: 9.5 }));
    sous.forEach((t, k) => ecrire(t, colonnes[1].x + 4, y - (texte.length + k) * 11.5, { taille: 8.5, couleur: GRIS }));
    aDroite(qte(quantite), colonnes[2].x + colonnes[2].largeur - 4, y, { taille: 9.5 });
    aDroite(pu === null ? 'à préciser' : dh(pu), colonnes[3].x + colonnes[3].largeur - 4, y, { taille: 9.5 });
    aDroite(ligneHt === null ? '—' : dh(ligneHt), colonnes[4].x + colonnes[4].largeur - 4, y, { taille: 9.5 });
    y -= hauteurLigne;
    // Le trait passe entre les jambages de la ligne et les capitales de la suivante.
    page.drawLine({ start: { x: MARGE, y: y + 12 }, end: { x: largeur - MARGE, y: y + 12 }, thickness: 0.5, color: TRAIT });
  }

  // ── Les totaux ──
  y -= 6;
  const tva = totalHt * TVA;
  for (const [libelle, valeur, fort] of [
    ['Total HT', totalHt, false],
    [`TVA ${Math.round(TVA * 100)} %`, tva, false],
    ['Total TTC', totalHt + tva, true],
  ]) {
    ecrire(libelle, largeur - MARGE - 210, y, { taille: fort ? 11 : 9.5, police: fort ? gras : normal });
    aDroite(dh(valeur), largeur - MARGE - 4, y, { taille: fort ? 11 : 9.5, police: fort ? gras : normal });
    y -= fort ? 18 : 14;
  }

  // ── Conditions et notes ──
  y -= 6;
  const avance = Number(commande.avancePourcent ?? 0);
  const conditions = [`Paiement : ${modalitePaiement(commande.modalite).nom}`, avance > 0 ? `avance de ${qte(avance)} % à la commande` : null].filter(Boolean).join(', ');
  ecrire('CONDITIONS', MARGE, y, { taille: 8, police: gras, couleur: GRIS });
  y -= 13;
  for (const l of couper(conditions, largeur - 2 * MARGE)) {
    ecrire(l, MARGE, y);
    y -= 12;
  }
  if (commande.notes) {
    for (const l of couper(commande.notes, largeur - 2 * MARGE).slice(0, 5)) {
      ecrire(l, MARGE, y, { couleur: GRIS });
      y -= 12;
    }
  }

  // ── Les signatures ──
  const ySignatures = Math.min(y - 20, MARGE + 90);
  for (const [i, titre] of ['Pour le fournisseur — bon pour accord', `Pour ${emetteur?.nom ?? 'la société'} — signature et cachet`].entries()) {
    const x = MARGE + i * ((largeur - 2 * MARGE) / 2 + 6);
    const l = (largeur - 2 * MARGE) / 2 - 6;
    page.drawRectangle({ x, y: ySignatures - 70, width: l, height: 70, borderColor: TRAIT, borderWidth: 1 });
    ecrire(titre, x + 8, ySignatures - 14, { taille: 8.5, couleur: GRIS });
  }

  // Le numéro de page en bas de chaque page.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = `${numeroBonCommande(commande)} — page ${i + 1} sur ${pages.length}`;
    p.drawText(t, { x: largeur - MARGE - normal.widthOfTextAtSize(t, 8), y: 22, size: 8, font: normal, color: GRIS });
  });

  return pdf.save();
}
