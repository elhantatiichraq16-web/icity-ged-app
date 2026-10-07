/**
 * Lire une page d'un site externe, sans ouvrir de brèche.
 *
 *  - HTTPS seulement, sauf si l'administrateur a autorisé HTTP pour la source ;
 *  - jamais d'adresse du réseau local (protection SSRF) : l'adresse IP est
 *    vérifiée au moment même de la connexion, ce qui déjoue aussi un nom de
 *    domaine qui changerait d'adresse entre la vérification et l'appel ;
 *  - pas d'identifiants dans l'URL, trois redirections au plus, chacune revérifiée ;
 *  - un délai d'expiration et une taille maximale ;
 *  - un User-Agent honnête : on dit qui lit.
 *
 * Rien ici n'exécute le contenu reçu : on rend du texte (ou des octets).
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const AGENT = 'iCityGED-veille/1.0 (veille des appels d’offres ; usage interne)';

/** Une erreur de récupération, au message montrable à l'écran (jamais de secret). */
export class ErreurRecuperation extends Error {}

/** Les plages d'adresses qui ne quittent pas la machine ou le réseau local. */
function adressePrivee(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('::ffff:')) return adressePrivee(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}
export const estAdressePrivee = adressePrivee;

/**
 * Vérifie une URL avant toute requête.
 *
 * @param {string} brute
 * @param {{ autoriserHttp?: boolean }} [options]
 * @returns {URL}
 */
export function verifierUrl(brute, { autoriserHttp = false } = {}) {
  let url;
  try {
    url = new URL(String(brute));
  } catch {
    throw new ErreurRecuperation('Adresse invalide.');
  }
  if (url.protocol !== 'https:' && !(autoriserHttp && url.protocol === 'http:')) {
    throw new ErreurRecuperation(url.protocol === 'http:' ? 'Seules les adresses HTTPS sont acceptées (HTTP n’est pas autorisé pour cette source).' : 'Seules les adresses web (https://) sont acceptées.');
  }
  if (url.username || url.password) throw new ErreurRecuperation('Une adresse ne doit pas contenir d’identifiants.');
  const hote = url.hostname.replace(/^\[|\]$/g, '');
  if (!hote.includes('.') || /^localhost$/i.test(hote) || /\.(local|internal|localhost|lan|home)$/i.test(hote)) {
    throw new ErreurRecuperation('Cette adresse désigne le réseau local : elle est refusée.');
  }
  if (net.isIP(hote) && adressePrivee(hote)) throw new ErreurRecuperation('Cette adresse désigne le réseau local : elle est refusée.');
  return url;
}

/** La résolution DNS, refusée si elle mène au réseau local (appelée au moment de la connexion). */
function resolutionSure(hote, options, rappel) {
  dns.lookup(hote, { ...options, all: true }, (erreur, adresses) => {
    if (erreur) return rappel(erreur);
    const privee = adresses.find((a) => adressePrivee(a.address));
    if (privee) return rappel(new ErreurRecuperation('Cette adresse mène au réseau local : elle est refusée.'));
    if (options.all) return rappel(null, adresses);
    return rappel(null, adresses[0].address, adresses[0].family);
  });
}

/**
 * Récupère une adresse.
 *
 * @param {string} brute
 * @param {{ autoriserHttp?: boolean, delaiMs?: number, tailleMax?: number, accepte?: string, binaire?: boolean, entetes?: Record<string,string> }} [options]
 * @returns {Promise<{ url: string, statut: number, type: string, texte?: string, octets?: Buffer }>}
 */
export async function recuperer(brute, { autoriserHttp = false, delaiMs = 20_000, tailleMax = 5 * 1024 * 1024, accepte = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5', binaire = false, entetes = {} } = {}) {
  let url = verifierUrl(brute, { autoriserHttp });
  for (let saut = 0; saut <= 3; saut++) {
    const reponse = await requete(url, { delaiMs, tailleMax, accepte, entetes });
    if ([301, 302, 303, 307, 308].includes(reponse.statut) && reponse.location) {
      if (saut === 3) throw new ErreurRecuperation('Trop de redirections.');
      url = verifierUrl(new URL(reponse.location, url).toString(), { autoriserHttp });
      continue;
    }
    if (reponse.statut >= 400) throw new ErreurRecuperation(`La source a répondu ${reponse.statut}.`);
    const type = reponse.type ?? '';
    if (binaire) return { url: url.toString(), statut: reponse.statut, type, octets: reponse.corps };
    const jeu = /charset=([\w-]+)/i.exec(type)?.[1]?.toLowerCase();
    const texte = new TextDecoder(jeu === 'iso-8859-1' || jeu === 'windows-1252' ? 'windows-1252' : 'utf-8').decode(reponse.corps);
    return { url: url.toString(), statut: reponse.statut, type, texte };
  }
  throw new ErreurRecuperation('Trop de redirections.');
}

function requete(url, { delaiMs, tailleMax, accepte, entetes }) {
  const module = url.protocol === 'https:' ? https : http;
  return new Promise((resoudre, rejeter) => {
    const req = module.request(
      url,
      {
        method: 'GET',
        lookup: resolutionSure,
        timeout: delaiMs,
        headers: { 'User-Agent': AGENT, Accept: accepte, 'Accept-Language': 'fr-FR,fr;q=0.9', ...entetes },
      },
      (rep) => {
        const morceaux = [];
        let taille = 0;
        rep.on('data', (m) => {
          taille += m.length;
          if (taille > tailleMax) {
            req.destroy(new ErreurRecuperation(`La réponse dépasse ${Math.round(tailleMax / 1024 / 1024)} Mo : arrêt.`));
            return;
          }
          morceaux.push(m);
        });
        rep.on('end', () => resoudre({ statut: rep.statusCode ?? 0, type: rep.headers['content-type'], location: rep.headers.location, corps: Buffer.concat(morceaux) }));
        rep.on('error', rejeter);
      },
    );
    // Le délai couvre aussi une réponse qui traîne : au-delà, on abandonne.
    const garde = setTimeout(() => req.destroy(new ErreurRecuperation('La source ne répond pas (délai dépassé).')), delaiMs);
    req.on('timeout', () => req.destroy(new ErreurRecuperation('La source ne répond pas (délai dépassé).')));
    req.on('error', (e) => {
      clearTimeout(garde);
      rejeter(e instanceof ErreurRecuperation ? e : new ErreurRecuperation(`Source injoignable (${e.code ?? e.message}).`));
    });
    req.on('close', () => clearTimeout(garde));
    req.end();
  });
}

/** Une pause entre deux requêtes vers une même source. */
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
