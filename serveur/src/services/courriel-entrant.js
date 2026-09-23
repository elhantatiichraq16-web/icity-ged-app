/**
 * Ce qu'on fait d'un message qui arrive (§10 et §10 bis).
 *
 * Quatre décisions, dans cet ordre :
 *  1. **Direction** — l'expéditeur est-il nous (envoyé), le copieur (scan),
 *     ou quelqu'un d'autre (reçu) ?
 *  2. **Client** — d'après le domaine de l'adresse, sinon d'après le fil.
 *  3. **Marché** — d'après une référence citée dans l'objet.
 *  4. **Pièces jointes** — chacune devient un document du fonds.
 *
 * Le corps est conservé (texte + HTML nettoyé) : le dossier doit montrer la
 * démarche, pas seulement son résultat.
 */
import { normaliserReference } from '@icity/commun/marches';
import sanitizeHtml from 'sanitize-html';

/**
 * L'objet réduit à son fil de discussion : on retire les préfixes que les
 * messageries empilent en répondant, les accents et les espaces multiples.
 * « RE: TR: Transmission du PV » et « Transmission du PV » sont un seul fil.
 */
const PREFIXES = /^\s*(?:re|ré|tr|fw|fwd|réf|ref|rép|rep)\s*(?:\[\d+\])?\s*:\s*/i;

export function filDe(objet) {
  let t = String(objet ?? '');
  while (PREFIXES.test(t)) t = t.replace(PREFIXES, '');
  return t
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}

/** L'adresse seule, sans le nom qui la précède. */
export function adresseDe(valeur) {
  const brut = String(valeur ?? '');
  const entreChevrons = /<([^>]+)>/.exec(brut);
  return (entreChevrons ? entreChevrons[1] : brut).trim().toLowerCase();
}

export function domaineDe(adresse) {
  return adresseDe(adresse).split('@')[1] ?? '';
}

/**
 * Reçu, envoyé, ou venu du scanner (§10 bis) ?
 *
 * Un mail du copieur n'est ni l'un ni l'autre : c'est un simple transport,
 * dont on garde les pièces jointes mais pas la conversation.
 */
export function directionDe({ expediteur, compte }) {
  const de = adresseDe(expediteur);
  const scanners = (Array.isArray(compte.adressesScanner) ? compte.adressesScanner : []).map((a) => adresseDe(a));
  if (scanners.includes(de)) return 'scanner';
  if (de === adresseDe(compte.adresse)) return 'envoye';
  return 'recu';
}

/**
 * Le client d'un message.
 *
 * Reçu : d'après le domaine de l'expéditeur, sinon le nom affiché.
 * Envoyé : d'après les destinataires ; à défaut, c'est le fil qui le dira
 * (voir clientDuFil), car notre propre adresse ne dit rien du client.
 */
export function clientDuMessage({ direction, expediteur, destinataires = [], clients }) {
  const adresses = direction === 'envoye' ? destinataires.map(adresseDe) : [adresseDe(expediteur)];
  const domaines = adresses.map(domaineDe).filter(Boolean);

  for (const client of clients) {
    const declares = (Array.isArray(client.domainesEmail) ? client.domainesEmail : []).map((d) => String(d).toLowerCase().replace(/^@/, ''));
    if (declares.some((d) => domaines.includes(d))) return { client, raison: `domaine ${domaines.find((x) => declares.includes(x))}` };
  }

  // Rien dans les domaines : on tente le nom affiché de l'expéditeur, qui
  // porte souvent le nom de l'administration.
  const plat = String(expediteur ?? '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase();
  for (const client of clients) {
    if (client.interne) continue;
    const motifs = [client.nom, client.sigle, ...(Array.isArray(client.synonymes) ? client.synonymes : [])].filter(Boolean);
    for (const motif of motifs) {
      const m = String(motif)
        .normalize('NFD')
        .replace(/\p{Mn}/gu, '')
        .toLowerCase();
      if (m.length >= 4 && plat.includes(m)) return { client, raison: `« ${motif} » dans le nom de l'expéditeur` };
    }
  }
  return null;
}

/**
 * La référence de marché citée dans l'objet (§10 bis) : « Scan 10879/2018 »,
 * « M17-2022 ». Rattacher dès l'arrivée évite d'attendre la lecture du PDF.
 */
export function referenceDeLObjet(objet) {
  const t = String(objet ?? '').toUpperCase();
  const formes = [
    // Les formes à trois segments d'abord : « 23C/2017/TGR » ne doit pas être
    // tronqué en « 23C/2017 » par la forme courte, qui vient après.
    /\b(\d{1,5}[A-Z]?\/(?:19|20)\d\d\/[A-Z][A-Z0-9]{1,7})\b/,
    /\b(\d{1,5}[A-Z]?\/[A-Z][A-Z0-9]{1,7}\/(?:19|20)\d\d)\b/,
    /\b(MAR\s?\d{8,12})\b/,
    /\b(\d{1,5}[A-Z]?\/(?:19|20)\d\d)\b/,
    // Forme des dossiers : M17-2022, BC26-2019, AO639-2022.
    /\b(?:M|BC|AO)(\d{1,5}[A-Z]?)-((?:19|20)\d\d)\b/,
  ];
  for (const forme of formes) {
    const m = forme.exec(t);
    if (m) return m[2] ? `${m[1]}/${m[2]}` : m[1];
  }
  return null;
}

/** Le marché correspondant à une référence lue, ou null. */
export function marcheDeLaReference(reference, marches) {
  if (!reference) return null;
  const cle = normaliserReference(reference);
  return marches.find((m) => m.referenceNormalisee.split('#')[0] === cle || m.reference.toUpperCase() === reference.toUpperCase()) ?? null;
}

/**
 * Nettoie le HTML d'un message avant de le stocker.
 *
 * Un corps de mail est écrit par l'extérieur : il peut porter des scripts,
 * des images qui pistent, des liens déguisés. On ne garde que la mise en
 * forme, et l'écran l'affiche de toute façon dans une iframe `sandbox` (§13).
 */
export function nettoyerHtml(html) {
  if (!html) return null;
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'span', 'div', 'pre', 'hr'],
    allowedAttributes: { a: ['href', 'title'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    // Ni javascript:, ni data: — seulement de vrais liens.
    allowedSchemes: ['http', 'https', 'mailto'],
    // Les images distantes signalent à l'expéditeur que le mail a été ouvert.
    exclusiveFilter: (cadre) => cadre.tag === 'a' && !cadre.text.trim(),
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
  });
}

/**
 * Prépare l'enregistrement d'un message analysé (mailparser) pour la base.
 *
 * @param {object} message   sortie de simpleParser
 * @param {object} contexte  { compte, clients, marches }
 */
export function preparerMail(message, { compte, clients, marches }) {
  const expediteur = message.from?.text ?? '';
  const destinataires = (message.to?.value ?? []).map((v) => v.address).filter(Boolean);
  const direction = directionDe({ expediteur, compte });
  const objet = (message.subject ?? '(sans objet)').slice(0, 255);

  const client = clientDuMessage({ direction, expediteur, destinataires, clients });
  const reference = referenceDeLObjet(objet);
  const marche = marcheDeLaReference(reference, marches);

  return {
    compteId: compte.id,
    direction,
    messageId: (message.messageId ?? `sans-id-${message.date?.getTime() ?? Date.now()}`).slice(0, 255),
    inReplyTo: message.inReplyTo?.slice(0, 255) ?? null,
    referencesMail: Array.isArray(message.references) ? message.references.join(' ') : (message.references ?? null),
    fil: filDe(objet),
    expediteur: expediteur.slice(0, 255),
    destinataires,
    date: message.date ?? new Date(),
    objet,
    // Un mail du copieur n'est pas une conversation : on ne garde pas son
    // corps comme échange (§10 bis), seulement ses pièces jointes.
    corpsTexte: direction === 'scanner' ? null : (message.text ?? null),
    corpsHtml: direction === 'scanner' ? null : nettoyerHtml(message.html || null),
    clientId: client?.client.id ?? null,
    marcheId: marche?.id ?? null,
    statutRattachement: client || marche ? 'rattache' : 'a_rattacher',
    _raisons: { client: client?.raison ?? null, marche: marche ? `« ${reference} » lu dans l'objet` : null },
  };
}

/**
 * Rattache les envois restés sans client, d'après le fil (§10).
 *
 * « RE: Transmission du PV » appartient au même échange que « Transmission du
 * PV », reçu du client. Un fil qu'aucun mail reçu ne porte, ou que plusieurs
 * clients emploient, reste à rattacher à la main : on ne devine pas.
 *
 * @param {Array} mails tous les mails du compte
 * @returns {Array<{ id: number, clientId: number }>} les rattachements sûrs
 */
export function rattacherParFil(mails) {
  const clientsParFil = new Map();
  for (const m of mails) {
    if (m.direction !== 'recu' || !m.clientId) continue;
    const vus = clientsParFil.get(m.fil) ?? new Set();
    vus.add(m.clientId);
    clientsParFil.set(m.fil, vus);
  }

  const sortie = [];
  for (const m of mails) {
    if (m.direction !== 'envoye' || m.clientId) continue;
    const candidats = clientsParFil.get(m.fil);
    // Un seul client sur ce fil : le rattachement est sûr. Plusieurs : on
    // laisse la file « À rattacher » (§10).
    if (candidats?.size === 1) sortie.push({ id: m.id, clientId: [...candidats][0] });
  }
  return sortie;
}
