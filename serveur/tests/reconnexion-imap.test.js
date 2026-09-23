import { describe, expect, it, vi } from 'vitest';

// On remplace ImapFlow par un faux client qu'on peut casser a volonte.
// La liste vit dans la factory : vi.mock est hisse au-dessus des imports.
vi.mock('imapflow', async () => {
  const { EventEmitter } = await import('node:events');
  const clients = [];
  class FauxClient extends EventEmitter {
    constructor() {
      super();
      this.deconnecte = false;
      clients.push(this);
    }
    async connect() {}
    async getMailboxLock() {
      return { release() {} };
    }
    async logout() {
      this.deconnecte = true;
    }
  }
  return { ImapFlow: FauxClient, __clients: clients };
});
vi.mock('../src/securite/crypto.js', () => ({ dechiffrer: () => 'motdepasse' }));

const { __clients: clients } = await import('imapflow');
const { ecouter } = await import('../src/services/courriel-imap.js');

const compte = { id: 1, adresse: 'test@exemple.fr', serveur: 'imap.test', port: 993, securite: 'ssl', motDePasse: 'x', dossierSurveille: 'INBOX' };
const silence = { log() {}, error() {} };

describe('ecouter() face a une coupure IMAP', () => {
  it("n'explose pas quand la connexion emet une erreur", async () => {
    clients.length = 0;
    const veille = await ecouter(compte, { log: silence });
    expect(clients).toHaveLength(1);

    // La coupure reelle : sans ecouteur 'error', ceci tuait le worker.
    expect(() => clients[0].emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).not.toThrow();

    await veille.arreter();
  });

  it('se rebranche apres la coupure', async () => {
    vi.useFakeTimers();
    clients.length = 0;
    const veille = await ecouter(compte, { log: silence });

    clients[0].emit('error', new Error('read ECONNRESET'));
    await vi.advanceTimersByTimeAsync(6000);

    // Un second client a ete cree : la reconnexion a bien eu lieu.
    expect(clients.length).toBeGreaterThanOrEqual(2);

    await veille.arreter();
    vi.useRealTimers();
  });

  it('cesse de se rebrancher une fois arrete', async () => {
    vi.useFakeTimers();
    clients.length = 0;
    const veille = await ecouter(compte, { log: silence });
    await veille.arreter();

    const apresArret = clients.length;
    clients[0].emit('close');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clients).toHaveLength(apresArret);
    vi.useRealTimers();
  });
});
