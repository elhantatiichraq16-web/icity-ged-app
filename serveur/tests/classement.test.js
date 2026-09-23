import { describe, expect, it } from 'vitest';
import { analyser, clientDuTexte, objetDuTexte, referencePrincipale, referencesDuTexte, typeDuTexte } from '../src/services/classement.js';

const CLIENTS = [
  { id: 1, nom: 'Trésorerie Générale du Royaume', sigle: 'TGR', synonymes: ['tresorerie generale'], interne: false },
  { id: 2, nom: 'Crédit Agricole du Maroc', sigle: 'GCAM', synonymes: ['credit agricole'], interne: false },
  { id: 3, nom: 'Administration des Douanes et Impôts Indirects', sigle: 'ADII', synonymes: ['administration des douanes'], interne: false },
  { id: 9, nom: 'INTELIFEX SYSTEMS', synonymes: ['intelifex'], interne: true },
];

describe('références lues dans le texte (§7)', () => {
  it('reconnaît les formes du fonds', () => {
    expect([...referencesDuTexte('Marché n° 23C/2017/TGR conclu entre').keys()]).toContain('23C/2017/TGR');
    expect([...referencesDuTexte('bon de commande n° 10879/2018').keys()]).toContain('10879/2018');
    expect([...referencesDuTexte('MARCHE N° MAR202200027 du').keys()]).toContain('MAR202200027');
    expect([...referencesDuTexte('appel d’offres 639/SAM/FRA/2022').keys()]).toContain('639/SAM/FRA/2022');
  });

  it('tolère un « n° » abîmé par l’OCR', () => {
    expect([...referencesDuTexte('marché W° 31/2016').keys()]).toContain('31/2016');
    expect([...referencesDuTexte('marché N9 202200027').keys()]).toContain('202200027');
  });

  it('n’accepte le format court qu’après le mot « marché »', () => {
    // Une date ne doit pas devenir une affaire.
    expect(referencesDuTexte('signé le 03/02/2020 à Rabat').size).toBe(0);
    expect(referencesDuTexte('conformément à l’article 31/2016 du règlement').size).toBe(0);
    expect([...referencesDuTexte('le marché n° 31/2016 porte sur').keys()]).toContain('31/2016');
  });

  it('écarte une date complète déguisée en référence à trois segments', () => {
    // Le segment du milieu doit contenir une lettre.
    expect(referencesDuTexte('du 03/02/2020 au 04/03/2021').size).toBe(0);
  });

  it('retient la référence la plus citée : les autres sont des renvois', () => {
    const texte = `
      Marché n° 23C/2017/TGR. Le présent marché 23C/2017/TGR fait suite
      à l'appel d'offres. Il annule le marché n° 31/2016.
      Les prestations du marché 23C/2017/TGR débutent en mars.`;
    expect(referencePrincipale(texte).reference).toBe('23C/2017/TGR');
  });
});

describe('client reconnu dans le texte (§7)', () => {
  it('reconnaît par le nom, le sigle ou un synonyme', () => {
    expect(clientDuTexte('… la Trésorerie Générale du Royaume …', CLIENTS).client.id).toBe(1);
    expect(clientDuTexte('… versé au GCAM le 3 mars …', CLIENTS).client.id).toBe(2);
    expect(clientDuTexte('… administration des douanes …', CLIENTS).client.id).toBe(3);
  });

  it('ignore les accents et la casse', () => {
    expect(clientDuTexte('TRESORERIE GENERALE DU ROYAUME', CLIENTS).client.id).toBe(1);
  });

  it('ne retient INTELIFEX qu’en dernier recours', () => {
    // La société émet ses propres PV : elle n'est pas le maître d'ouvrage.
    expect(clientDuTexte('INTELIFEX SYSTEMS atteste avoir livré à la TGR', CLIENTS).client.id).toBe(1);
    expect(clientDuTexte('INTELIFEX SYSTEMS, Casablanca', CLIENTS).client.id).toBe(9);
  });

  it('rend null quand aucun client n’apparaît', () => {
    expect(clientDuTexte('Document sans nom d’organisme', CLIENTS)).toBeNull();
  });
});

describe('type de pièce (§7)', () => {
  it.each([
    ['AVENANT N° 1 au marché', 'AV'],
    ['ATTESTATION DE REFERENCE', 'ATT'],
    ['Nous attestons que la société', 'ATT'],
    ['Nous, soussignés SOMAPORT, attestons par la présente que', 'ATT'],
    ['NOTIFICATION DE L’ORDRE DE SERVICE', 'OS'],
    ['ORDRE DE SERVICE N° 2 du 3 mars', 'OS'],
    ['PROCES-VERBAL DE RECEPTION PROVISOIRE', 'PVP'],
    ['PROCES-VERBAL DE RECEPTION DEFINITIVE', 'PVD'],
    ['BON DE LIVRAISON du 12 mai', 'BL'],
    ['MAINLEVEE de la caution définitive', 'MLV'],
    ['CAUTION DEFINITIVE de 5 %', 'CAU'],
    ['REÇU DE VERSEMENT de 2 000 DH', 'RV'],
    ['FACTURE N° 2024-014', 'FAC'],
    ['DECOMPTE DEFINITIF des travaux', 'DEC'],
    ['REGLEMENT DE CONSULTATION', 'DAO'],
    ['CAHIER DES PRESCRIPTIONS SPECIALES', 'CM'],
    ['Objet : demande de pièces\nVeuillez agréer, salutations distinguées', 'COU'],
  ])('« %s » → %s', (texte, code) => {
    expect(typeDuTexte(texte).code).toBe(code);
  });

  it('un avenant reste un avenant, même s’il cite le marché', () => {
    expect(typeDuTexte('AVENANT N° 2 au marché n° 23C/2017/TGR, cahier des prescriptions spéciales').code).toBe('AV');
  });

  it('un « PV » de plus de 6 000 caractères est un contrat (§7)', () => {
    const contrat = 'PROCES-VERBAL DE RECEPTION PROVISOIRE\n' + 'clause de réception. '.repeat(400);
    expect(contrat.length).toBeGreaterThan(6000);
    expect(typeDuTexte(contrat).code).toBe('CM');
  });

  it('réception définitive passe avant provisoire quand les deux sont citées', () => {
    // Un PV définitif rappelle souvent la réception provisoire ; l'inverse
    // n'arrive jamais.
    expect(typeDuTexte('PV DE RECEPTION DEFINITIVE faisant suite à la réception provisoire du 3 mars').code).toBe('PVD');
  });

  it('« mise en demeure » seul ne suffit pas : la clause figure dans tout marché', () => {
    expect(typeDuTexte('En cas de retard, une mise en demeure sera notifiée')?.code).not.toBe('PVMD');
    expect(typeDuTexte('PROCES-VERBAL RELATIF AUX DECISIONS DE MISE EN DEMEURE').code).toBe('PVMD');
  });

  it('rend null sur un texte muet', () => {
    expect(typeDuTexte('xxx yyy zzz')).toBeNull();
  });
});

describe('objet technique', () => {
  it('reconnaît les cinq métiers', () => {
    expect(objetDuTexte('installation de vidéosurveillance')).toBe('Vidéosurveillance');
    expect(objetDuTexte('contrôle d’accès par lecteur de badge')).toBe("Contrôle d'accès");
    expect(objetDuTexte('détection incendie')).toBe('Détection incendie');
    expect(objetDuTexte('maintenance des équipements')).toBe('Maintenance');
    expect(objetDuTexte('rien de tout cela')).toBeNull();
  });
});

describe('analyse complète', () => {
  it('lit référence, client, type et objet d’un coup', () => {
    const texte = `
      ROYAUME DU MAROC — TRESORERIE GENERALE DU ROYAUME
      ATTESTATION DE REFERENCE
      Nous attestons que la société INTELIFEX SYSTEMS a réalisé les
      prestations de vidéosurveillance du marché n° 23C/2017/TGR.`;
    const r = analyser({ texteOcr: texte }, CLIENTS);
    expect(r.lisible).toBe(true);
    expect(r.reference.reference).toBe('23C/2017/TGR');
    expect(r.client.id).toBe(1);
    expect(r.type.code).toBe('ATT');
    expect(r.objetTechnique).toBe('Vidéosurveillance');
  });

  it('refuse de conclure sur un texte trop court', () => {
    expect(analyser({ texteOcr: 'scan illisible' }, CLIENTS).lisible).toBe(false);
    expect(analyser({ texteOcr: null }, CLIENTS).lisible).toBe(false);
  });
});
