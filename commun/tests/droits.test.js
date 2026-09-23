import { describe, expect, it } from 'vitest';
import { droitsPour, subject, confidentialitesVisibles } from '../src/droits.js';

const doc = (champs) => subject('Document', { versePar: 99, etatCircuit: 'brouillon', confidentialite: 'interne', ...champs });

describe('droits par rôle', () => {
  it('sans utilisateur, rien n’est permis', () => {
    const d = droitsPour(null);
    expect(d.can('lire', 'Marche')).toBe(false);
  });

  it("l'administrateur peut tout, y compris le confidentiel et les comptes", () => {
    const d = droitsPour({ id: 1, role: 'administrateur' });
    expect(d.can('gerer', 'Utilisateur')).toBe(true);
    expect(d.can('lire', doc({ confidentialite: 'confidentiel' }))).toBe(true);
  });

  it('le lecteur consulte mais ne verse ni ne modifie', () => {
    const d = droitsPour({ id: 2, role: 'lecteur' });
    expect(d.can('lire', 'Marche')).toBe(true);
    expect(d.can('verser', 'Document')).toBe(false);
    expect(d.can('modifier', doc())).toBe(false);
    expect(d.can('gerer', 'Utilisateur')).toBe(false);
  });

  it('le lecteur ne voit ni « Restreint » ni « Confidentiel » (§8)', () => {
    const d = droitsPour({ id: 2, role: 'lecteur' });
    expect(d.can('lire', doc({ confidentialite: 'public' }))).toBe(true);
    expect(d.can('lire', doc({ confidentialite: 'interne' }))).toBe(true);
    expect(d.can('lire', doc({ confidentialite: 'restreint' }))).toBe(false);
    expect(d.can('lire', doc({ confidentialite: 'confidentiel' }))).toBe(false);
  });

  it('seuls directeur et administrateur voient le confidentiel', () => {
    const confidentiel = doc({ confidentialite: 'confidentiel' });
    expect(droitsPour({ id: 3, role: 'directeur' }).can('lire', confidentiel)).toBe(true);
    for (const role of ['responsable_documentaire', 'chef_projet', 'commercial_ao', 'achats']) {
      expect(droitsPour({ id: 3, role }).can('lire', confidentiel), role).toBe(false);
    }
  });

  it('celui qui a versé une pièce confidentielle la voit toujours', () => {
    const d = droitsPour({ id: 7, role: 'chef_projet' });
    expect(d.can('lire', doc({ confidentialite: 'confidentiel', versePar: 7 }))).toBe(true);
  });

  it('le chef de projet modifie sa pièce en brouillon, pas celle des autres ni après soumission', () => {
    const d = droitsPour({ id: 7, role: 'chef_projet' });
    expect(d.can('modifier', doc({ versePar: 7 }))).toBe(true);
    expect(d.can('modifier', doc({ versePar: 7, etatCircuit: 'soumis_controle' }))).toBe(false);
    expect(d.can('modifier', doc({ versePar: 8 }))).toBe(false);
    expect(d.can('valider', doc({ versePar: 7 }))).toBe(false);
  });

  it('le responsable documentaire contrôle, le directeur valide', () => {
    const rd = droitsPour({ id: 4, role: 'responsable_documentaire' });
    const dir = droitsPour({ id: 5, role: 'directeur' });
    expect(rd.can('controler', doc())).toBe(true);
    expect(rd.can('valider', doc())).toBe(false);
    expect(dir.can('valider', doc())).toBe(true);
  });

  it('seul l’administrateur gère comptes, référentiels et sauvegardes', () => {
    for (const role of ['directeur', 'responsable_documentaire', 'chef_projet', 'commercial_ao', 'achats', 'lecteur']) {
      const d = droitsPour({ id: 6, role });
      expect(d.can('gerer', 'Utilisateur'), role).toBe(false);
      expect(d.can('gerer', 'Referentiel'), role).toBe(false);
      expect(d.can('gerer', 'Sauvegarde'), role).toBe(false);
    }
  });

  it('le responsable documentaire ne modifie pas un document confidentiel qu’il ne voit pas', () => {
    const d = droitsPour({ id: 4, role: 'responsable_documentaire' });
    expect(d.can('modifier', doc({ confidentialite: 'confidentiel' }))).toBe(false);
    expect(d.can('modifier', doc({ confidentialite: 'restreint' }))).toBe(true);
  });

  it('confidentialitesVisibles donne la liste utilisable en SQL', () => {
    expect(confidentialitesVisibles('lecteur')).toEqual(['public', 'interne']);
    expect(confidentialitesVisibles('directeur')).toEqual(['public', 'interne', 'restreint', 'confidentiel']);
  });
});
