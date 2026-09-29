import { describe, expect, it, vi } from 'vitest';

// Un faux ImapFlow qui n'accepte qu'un seul mot de passe, sans espaces,
// et qui répond à un refus comme Gmail.
vi.mock('imapflow', async () => {
  const clients = [];
  class FauxClient {
    constructor(options) {
      this.options = options;
      this.ferme = false;
      clients.push(this);
    }
    async connect() {
      if (this.options.auth.pass !== 'abcdefghijklmnop') {
        throw Object.assign(new Error('Command failed'), {
          authenticationFailed: true,
          serverResponseCode: 'AUTHENTICATIONFAILED',
          responseText: 'Invalid credentials (Failure)',
        });
      }
    }
    close() {
      this.ferme = true;
    }
    async logout() {}
  }
  return { ImapFlow: FauxClient, __clients: clients };
});
// Le « chiffré » est ici le mot de passe en clair : on teste la connexion, pas AES.
vi.mock('../src/securite/crypto.js', () => ({ dechiffrer: (paquet) => paquet }));

const { __clients: clients } = await import('imapflow');
const { connecter } = await import('../src/services/courriel-imap.js');

const gmail = { adresse: 'boite@gmail.com', serveur: 'imap.gmail.com', port: 993, securite: 'ssl' };

describe('connecter() et le mot de passe d’application', () => {
  it('accepte le mot de passe collé avec les espaces de Google', async () => {
    const client = await connecter({ ...gmail, motDePasse: 'abcd efgh ijkl mnop' });
    expect(client.options.auth.pass).toBe('abcdefghijklmnop');
  });

  it('dit en clair pourquoi Gmail refuse, au lieu de « Command failed »', async () => {
    await expect(connecter({ ...gmail, motDePasse: 'mauvais-mot-de-passe' })).rejects.toThrow(
      /Mot de passe refusé par le serveur \(« Invalid credentials \(Failure\) »\)\. .*16 lettres.*boite@gmail\.com/,
    );
  });

  it('ferme la connexion refusée, pour ne pas laisser le socket expirer seul', async () => {
    clients.length = 0;
    await connecter({ ...gmail, motDePasse: 'mauvais-mot-de-passe' }).catch(() => {});
    expect(clients[0].ferme).toBe(true);
  });
});
