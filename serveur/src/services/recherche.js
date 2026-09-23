/**
 * La recherche plein texte (§11, écran 5).
 *
 * PostgreSQL fait le gros du travail avec son index GIN sur un `tsvector` :
 * pas d'Elasticsearch à faire tourner sur un PC de 3,7 Go (§2). On lui
 * demande le score de pertinence, et on fabrique ici les extraits où les mots
 * trouvés sont surlignés.
 */
import { db } from '../db.js';

/** Sans accents ni casse : « référence » et « reference » doivent se trouver. */
const plat = (t) => (t ?? '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();

/**
 * Transforme ce que l'utilisateur tape en requête `tsquery` de PostgreSQL.
 *
 * - `"caution bancaire"` entre guillemets cherche l'expression exacte, mot
 *   suivant mot (opérateur `<->`) ;
 * - les autres mots sont tous exigés (`&`) et complétés à droite (`:*`), pour
 *   que la recherche se resserre à mesure qu'on tape.
 *
 * Les caractères que PostgreSQL interprète (& | ! : * ( ) < >) sont retirés
 * des mots : sans cela, taper « ! » ferait échouer la requête entière.
 */
export function expressionBooleenne(saisie) {
  /**
   * Ce que `tsquery` interprète, et qui n'a rien à faire dans un mot.
   *
   * Le `+` que certains tapent par habitude cherche le mot, pas un
   * opérateur. Le tiret, lui, reste — il appartient
   * aux références de marché (« M23A-2017-TGR »), que PostgreSQL garde
   * entières.
   */
  const nettoyer = (t) =>
    t
      .replace(/[&|!:*()<>'"\\+~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const morceaux = [];
  const reste = String(saisie ?? '').replace(/"([^"]+)"/g, (_, phrase) => {
    const propre = nettoyer(phrase);
    // `<->` exige les mots dans cet ordre, l'un après l'autre.
    if (propre) morceaux.push(propre.split(' ').join(' <-> '));
    return ' ';
  });

  for (const mot of reste.split(/[\s,;:!?]+/)) {
    const propre = nettoyer(mot);
    // Sous trois lettres, un mot ramène trop pour être utile.
    if (propre.length < 3) continue;
    /*
     * PostgreSQL garde « 23C/2017/TGR » en un seul élément — il reconnaît la
     * forme d'un chemin. On le cherche donc tel quel, sans le découper : le
     * découper produirait trois mots qui n'existent pas dans l'index.
     *
     * Pas de `:*` non plus sur ces références : la complétion à droite ne
     * s'applique qu'au dernier élément, et fausserait la correspondance.
     */
    if (propre.includes('/')) morceaux.push(`'${propre.replace(/'/g, '')}'`);
    else morceaux.push(`${propre}:*`);
  }

  return morceaux.join(' & ');
}

/** Les mots à surligner dans les extraits. */
export function motsDeLaRecherche(saisie) {
  return [...String(saisie ?? '').matchAll(/"([^"]+)"|([\p{L}\p{N}/._-]{3,})/gu)]
    .map((m) => plat(m[1] ?? m[2]))
    .filter(Boolean);
}

/**
 * Deux ou trois passages du texte autour des mots trouvés, avec les positions
 * à surligner. On rend les positions plutôt que du HTML : l'écran affiche du
 * texte échappé, jamais du HTML venu de l'OCR (§13).
 */
export function extraits(texte, mots, { largeur = 160, maximum = 3 } = {}) {
  if (!texte) return [];
  const source = String(texte).replace(/\s+/g, ' ');
  const cherchable = plat(source);
  const sortie = [];
  const dejaVues = [];

  for (const mot of mots) {
    if (sortie.length >= maximum) break;
    const position = cherchable.indexOf(mot);
    if (position === -1) continue;
    // Deux mots voisins tombent dans le même extrait : on ne le répète pas.
    if (dejaVues.some((p) => Math.abs(p - position) < largeur)) continue;
    dejaVues.push(position);

    const debut = Math.max(0, position - Math.floor(largeur / 2));
    const fin = Math.min(source.length, position + mot.length + Math.floor(largeur / 2));
    const passage = source.slice(debut, fin);
    const passagePlat = plat(passage);

    // Toutes les occurrences des mots cherchés dans ce passage.
    const marques = [];
    for (const m of mots) {
      let i = passagePlat.indexOf(m);
      while (i !== -1) {
        marques.push({ debut: i, fin: i + m.length });
        i = passagePlat.indexOf(m, i + m.length);
      }
    }
    marques.sort((a, b) => a.debut - b.debut);

    sortie.push({
      texte: (debut > 0 ? '…' : '') + passage + (fin < source.length ? '…' : ''),
      // Le « … » ajouté décale les positions d'un caractère.
      marques: marques.map((m) => ({ debut: m.debut + (debut > 0 ? 1 : 0), fin: m.fin + (debut > 0 ? 1 : 0) })),
    });
  }
  return sortie;
}

/**
 * Cherche dans les titres et le texte des documents.
 *
 * @param {object} options
 * @param {string} options.q            ce que l'utilisateur a tapé
 * @param {string[]} options.confidentialites ce que le demandeur a le droit de voir
 * @param {number} options.utilisateurId      il voit toujours ses propres dépôts
 */
export async function chercher({ q, confidentialites, utilisateurId, marcheId, clientId, typeId, annee, page = 1, parPage = 20 }) {
  const expression = expressionBooleenne(q);
  if (!expression) return { total: 0, resultats: [], facettes: { types: [], clients: [], annees: [] }, expression };

  /*
   * Les filtres se composent en SQL : Prisma ne sait pas écrire un
   * `to_tsquery`. PostgreSQL numérote ses paramètres ($1, $2…) — d'où ce
   * compteur.
   */
  let n = 0;
  const p = () => `$${(n += 1)}`;
  const valeurs = [];

  // Titre et OCR pèsent pareil. La configuration « fr » enchaîne unaccent et
  // la désuffixation : « videosurveillance » trouve « vidéosurveillance », et
  // « marchés » trouve « marché ». Elle doit être la même que celle de
  // l'index, sinon PostgreSQL l'ignore sans rien dire.
  const indexe = "to_tsvector('fr', coalesce(d.titre, '') || ' ' || coalesce(d.texte_ocr, ''))";
  const requete = `to_tsquery('fr', ${p()})`;
  valeurs.push(expression);

  const conditions = ['d.supprime_le IS NULL', `${indexe} @@ ${requete}`];

  const placesConfid = confidentialites.map(() => p()).join(',');
  conditions.push(`(d.confidentialite IN (${placesConfid}) OR d.verse_par = ${p()})`);
  valeurs.push(...confidentialites, utilisateurId);

  if (marcheId) {
    conditions.push(`d.marche_id = ${p()}`);
    valeurs.push(Number(marcheId));
  }
  if (clientId) {
    conditions.push(`d.client_id = ${p()}`);
    valeurs.push(Number(clientId));
  }
  if (typeId) {
    conditions.push(`d.type_document_id = ${p()}`);
    valeurs.push(Number(typeId));
  }
  if (annee) {
    conditions.push(`EXTRACT(YEAR FROM COALESCE(d.date_document, d.cree_le)) = ${p()}`);
    valeurs.push(Number(annee));
  }

  const ou = conditions.join(' AND ');
  const depart = (Math.max(1, page) - 1) * parPage;

  // Les deux derniers paramètres ne servent qu'à la page de résultats.
  const placeLimite = p();
  const placeDepart = p();

  const [lignes, total, facetteTypes, facetteClients, facetteAnnees] = await Promise.all([
    db.$queryRawUnsafe(
      `SELECT d.id, d.titre, d.texte_ocr AS texte, d.pages, d.statut_ocr AS "statutOcr", d.date_document AS "dateDocument",
              t.nom AS "typeNom", t.code AS "typeCode", m.id AS "marcheId", m.reference AS "marcheReference",
              c.id AS "clientId", c.nom AS "clientNom",
              ts_rank(${indexe}, ${requete}) AS score
         FROM documents d
         LEFT JOIN types_documents t ON t.id = d.type_document_id
         LEFT JOIN marches m ON m.id = d.marche_id
         LEFT JOIN clients c ON c.id = d.client_id
        WHERE ${ou}
        ORDER BY score DESC, d.id DESC
        LIMIT ${placeLimite} OFFSET ${placeDepart}`,
      ...valeurs,
      parPage,
      depart,
    ),
    db.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM documents d WHERE ${ou}`, ...valeurs),
    db.$queryRawUnsafe(
      `SELECT t.id, t.nom, COUNT(*) AS n FROM documents d JOIN types_documents t ON t.id = d.type_document_id WHERE ${ou} GROUP BY t.id, t.nom ORDER BY n DESC`,
      ...valeurs,
    ),
    db.$queryRawUnsafe(
      `SELECT c.id, c.nom, COUNT(*) AS n FROM documents d JOIN clients c ON c.id = d.client_id WHERE ${ou} GROUP BY c.id, c.nom ORDER BY n DESC LIMIT 12`,
      ...valeurs,
    ),
    db.$queryRawUnsafe(
      `SELECT EXTRACT(YEAR FROM COALESCE(d.date_document, d.cree_le)) AS annee, COUNT(*) AS n
         FROM documents d WHERE ${ou} GROUP BY annee ORDER BY annee DESC`,
      ...valeurs,
    ),
  ]);

  const mots = motsDeLaRecherche(q);
  const nombre = (v) => (typeof v === 'bigint' ? Number(v) : v);

  return {
    expression,
    total: nombre(total[0]?.n ?? 0),
    page: Math.max(1, page),
    parPage,
    resultats: lignes.map((l) => ({
      id: l.id,
      titre: l.titre,
      pages: l.pages,
      statutOcr: l.statutOcr,
      dateDocument: l.dateDocument ? new Date(l.dateDocument).toISOString().slice(0, 10) : null,
      type: l.typeNom ? { nom: l.typeNom, code: l.typeCode } : null,
      marche: l.marcheId ? { id: l.marcheId, reference: l.marcheReference } : null,
      client: l.clientId ? { id: l.clientId, nom: l.clientNom } : null,
      score: Number(l.score),
      extraits: extraits(l.texte, mots),
    })),
    facettes: {
      types: facetteTypes.map((f) => ({ id: f.id, nom: f.nom, n: nombre(f.n) })),
      clients: facetteClients.map((f) => ({ id: f.id, nom: f.nom, n: nombre(f.n) })),
      // PostgreSQL rend EXTRACT() en Decimal : sans conversion, la réponse JSON échoue.
      annees: facetteAnnees.filter((f) => f.annee).map((f) => ({ annee: Number(f.annee), n: nombre(f.n) })),
    },
  };
}
