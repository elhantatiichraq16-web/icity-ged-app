/**
 * Un flux RSS 2.0 ou Atom d'avis d'appels d'offres : le moyen le plus sûr de
 * suivre une source quand elle en publie un.
 *
 * Lu comme du XML (pas comme du HTML, où <link> serait une balise vide) ; le
 * contenu reste du texte, nettoyé ensuite par la normalisation.
 */

/** Le contenu d'une balise d'un élément, CDATA déballé. */
function balise(xml, nom) {
  const m = new RegExp(`<${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</${nom}>`, 'i').exec(xml);
  if (!m) return null;
  const v = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
  return v || null;
}

/**
 * @param {string} xml
 * @returns {object[]} des offres brutes
 */
export function analyserFlux(xml) {
  const elements = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return elements.slice(0, 500).map((e) => {
    // Atom : <link href="…"/> ; RSS : <link>…</link>.
    const lienAtom = /<link[^>]*\bhref="([^"]+)"/i.exec(e)?.[1];
    const lien = lienAtom ?? balise(e, 'link');
    return {
      idExterne: balise(e, 'guid') ?? balise(e, 'id') ?? lien,
      urlOfficielle: lien,
      objet: balise(e, 'title'),
      resume: balise(e, 'description') ?? balise(e, 'summary') ?? balise(e, 'content'),
      categorie: balise(e, 'category'),
      datePublication: balise(e, 'pubDate') ?? balise(e, 'published') ?? balise(e, 'updated'),
    };
  });
}

export const connecteurRss = {
  code: 'rss',
  automatique: true,
  async lister({ source, recuperer }) {
    if (!source.adresse) throw new Error('Indiquez l’adresse du flux.');
    const { texte } = await recuperer(source.adresse, { accepte: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8' });
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(texte)) throw new Error('Cette adresse ne renvoie pas un flux RSS ou Atom.');
    const offres = analyserFlux(texte);
    return { offres, pagesLues: 1, remarques: [], qualite: { blocs: offres.length, offres: offres.filter((o) => o.objet).length, parChamp: {}, secours: {} } };
  },
};
