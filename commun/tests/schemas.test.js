import { describe, expect, it } from 'vitest';
import { erreursParChamp, motDePasse, schemaConnexion, schemaInvitation, schemaNouveauMotDePasse } from '../src/schemas.js';

describe('règle des mots de passe', () => {
  it('accepte un mot de passe correct', () => {
    expect(motDePasse.safeParse('Casablanca2026').success).toBe(true);
  });

  it.each([
    ['trop court', 'abc123'],
    ['sans chiffre', 'uniquementdeslettres'],
    ['sans lettre', '12345678901'],
    ['plus de 72 octets', 'a1'.repeat(40)],
  ])('refuse un mot de passe %s', (_, valeur) => {
    expect(motDePasse.safeParse(valeur).success).toBe(false);
  });

  it('compte les octets, pas les caractères (accents sur 2 octets)', () => {
    // 36 « é » = 72 octets, + « 1 » = 73 octets : refusé.
    expect(motDePasse.safeParse('é'.repeat(36) + '1').success).toBe(false);
  });
});

describe('formulaires', () => {
  it("normalise l'e-mail de connexion", () => {
    const r = schemaConnexion.parse({ email: '  Ichrak@Exemple.MA ', motDePasse: 'x' });
    expect(r.email).toBe('ichrak@exemple.ma');
    expect(r.seSouvenir).toBe(false);
  });

  it('exige deux mots de passe identiques', () => {
    const r = schemaNouveauMotDePasse.safeParse({ jeton: 'x'.repeat(40), motDePasse: 'Casablanca2026', confirmation: 'Autre2026xx' });
    expect(r.success).toBe(false);
    expect(erreursParChamp(r.error)).toHaveProperty('confirmation');
  });

  it("refuse un rôle qui n'existe pas", () => {
    const r = schemaInvitation.safeParse({ nom: 'Test', email: 'a@b.ma', role: 'super_admin' });
    expect(r.success).toBe(false);
  });
});
