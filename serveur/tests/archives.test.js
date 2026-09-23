import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lireArchives, nomDepuisDossier, objetTechniqueDepuisDossier, referenceDepuisDossier, typeDepuisNom, villeDepuisDossier } from '../src/services/archives.js';

describe('référence lue dans le nom du dossier', () => {
  it.each([
    ['M31-2016_DOUANES_RABAT', '31/2016', null],
    ['BC26-2019_AURS', '26/2019', null],
    ['M07-2019_CNSS_KENITRA', '07/2019', null],
    ['AO07-2023_GCAM_VIDEOSURVEILLANCE', '07/2023', null],
    ['AO639-2022_FORCES_ROYALES_AIR', '639/2022', null],
    ['MAR202200027_GCAM_CONTROLE_ACCES', 'MAR202200027', null],
    ['M23A-2017-TGR_LOT1', '23A/2017/TGR', 'A'],
    ['M23C-2017-TGR_LOT3', '23C/2017/TGR', 'C'],
  ])('%s → %s', (dossier, reference, lot) => {
    const lu = referenceDepuisDossier(dossier);
    expect(lu.reference).toBe(reference);
    expect(lu.lot).toBe(lot);
    expect(lu.certaine).toBe(true);
  });

  it('signale un dossier sans numérotation au lieu d’inventer', () => {
    const lu = referenceDepuisDossier('CONSULTATION_SOSIPO_NADOR');
    expect(lu.certaine).toBe(false);
    expect(lu.reference).toBe('CONSULTATION_SOSIPO_NADOR');
  });
});

describe('lecture des noms de fichiers', () => {
  it.each([
    ['MARCHE_SIGNE.pdf', 'CM'],
    ['MARCHE_CPS_SIGNE.pdf', 'CM'],
    ['CAHIER_PRESCRIPTIONS_SPECIALES.pdf', 'CM'],
    ['AVENANT_SIGNE_COPIE_1.pdf', 'AV'],
    ['ORDRE_SERVICE_COPIE_2.pdf', 'OS'],
    ['BON_LIVRAISON_COPIE_16.pdf', 'BL'],
    ['PROCES_VERBAL_RECEPTION_COPIE_1.pdf', 'PVP'],
    ['DOSSIER_APPEL_OFFRES.pdf', 'DAO'],
    ['RECU_VERSEMENT.pdf', 'RV'],
    ['CAUTION_COPIE_2.pdf', 'CAU'],
    ['DECOMPTE.pdf', 'DEC'],
    ['ATTESTATION-PRESUD-MARCHE-01-2017.pdf', 'ATT'],
    ['CORRESPONDANCE_EXECUTION.pdf', 'COU'],
  ])('%s → %s', (nom, code) => {
    expect(typeDepuisNom(nom)).toBe(code);
  });

  it('un avenant passe avant le marché qu’il modifie', () => {
    expect(typeDepuisNom('DOSSIER_AVENANT.pdf')).toBe('AV');
  });

  it('rend null quand le nom ne dit rien', () => {
    expect(typeDepuisNom('20260910140626873.pdf')).toBeNull();
  });
});

describe('objet technique et ville', () => {
  it('reconnaît l’objet dans le nom du dossier', () => {
    expect(objetTechniqueDepuisDossier('MAR202200027_GCAM_CONTROLE_ACCES')).toBe("Contrôle d'accès");
    expect(objetTechniqueDepuisDossier('AO07-2023_GCAM_VIDEOSURVEILLANCE')).toBe('Vidéosurveillance');
    expect(objetTechniqueDepuisDossier('M17-2022_MINISTERE_JUSTICE')).toBeNull();
  });

  it('reconnaît la ville', () => {
    expect(villeDepuisDossier('M31-2016_DOUANES_RABAT')).toBe('Rabat');
    expect(villeDepuisDossier('M07-2019_CNSS_KENITRA')).toBe('Kenitra');
    expect(villeDepuisDossier('BC26-2019_AURS')).toBeNull();
  });

  it('rend lisible un nom de dossier client', () => {
    expect(nomDepuisDossier('Credit_Agricole_du_Maroc')).toBe('Credit Agricole du Maroc');
    expect(nomDepuisDossier('CNSS_-_Polyclinique_Kenitra')).toBe('CNSS — Polyclinique Kenitra');
  });
});

describe('parcours d’un dossier d’archives', () => {
  let racine;

  beforeAll(async () => {
    // Une arborescence de test, à la forme du fonds réel, avec des fichiers
    // vides : on ne lit que les noms.
    racine = await fs.mkdtemp(path.join(os.tmpdir(), 'icity-archives-'));
    const creer = async (relatif, contenu = 'x') => {
      const complet = path.join(racine, relatif);
      await fs.mkdir(path.dirname(complet), { recursive: true });
      await fs.writeFile(complet, contenu);
    };
    await creer('Tresorerie_Generale_du_Royaume/2017/M23A-2017-TGR_LOT1/MARCHE_SIGNE.pdf');
    await creer('Tresorerie_Generale_du_Royaume/2017/M23A-2017-TGR_LOT1/RECU_VERSEMENT.pdf');
    await creer('Tresorerie_Generale_du_Royaume/2017/M23A-2017-TGR_LOT1/REMARQUES_A_VALIDER_AVEC_ADMINISTRATION.txt');
    await creer('Tresorerie_Generale_du_Royaume/2017/M23B-2017-TGR_LOT2/MARCHE_SIGNE.pdf');
    await creer('Credit_Agricole_du_Maroc/2022/MAR202200027_GCAM_CONTROLE_ACCES/ORDRE_SERVICE_COPIE_1.pdf');
    await creer('Divers_clients/ATTESTATIONS_SEPAREES_OCR/PRESUD/ATTESTATION-PRESUD-MARCHE-01-2017-P18.pdf');
    await creer('Divers_clients/ATTESTATIONS_SEPAREES_OCR/_CONTROLES/rapport_controle.txt');
    await creer('Divers_clients/Divers/ATTESTATIONS_REFERENCES/DOSSIER_ATTESTATIONS_REFERENCE_COPIE_1.pdf');
  });

  afterAll(async () => {
    await fs.rm(racine, { recursive: true, force: true });
  });

  it('garde un marché par lot : ce sont des contrats distincts', async () => {
    const plan = await lireArchives(racine);
    const tgr = plan.marches.filter((m) => m.reference.includes('/2017/TGR'));
    expect(tgr).toHaveLength(2); // LOT1 et LOT2
    expect(tgr.map((m) => m.lot).sort()).toEqual(['A', 'B']);
    const lot1 = tgr.find((m) => m.lot === 'A');
    expect(lot1.fichiers).toHaveLength(2);
    expect(lot1.nomClient).toBe('Tresorerie Generale du Royaume');
    expect(lot1.annee).toBe(2017);
  });

  it('écarte les notes de travail, sans les perdre de vue', async () => {
    const plan = await lireArchives(racine);
    expect(plan.ignores).toHaveLength(1);
    expect(plan.ignores[0].chemin).toMatch(/REMARQUES_A_VALIDER/);
    expect(plan.fichiers).toBe(6); // 3 TGR + 1 GCAM + 1 attestation + 1 patrimoine
  });

  it('range les attestations détachées par client, sans marché', async () => {
    const plan = await lireArchives(racine);
    const presud = plan.attestations.find((a) => a.dossierClient === 'PRESUD');
    expect(presud.fichiers).toHaveLength(1);
    expect(presud.fichiers[0].typeCode).toBe('ATT');
    // Le dossier _CONTROLES ne contient que des rapports de tri.
    expect(plan.attestations.some((a) => a.dossierClient === '_CONTROLES')).toBe(false);
  });

  it('garde le patrimoine hors marché à part', async () => {
    const plan = await lireArchives(racine);
    const divers = plan.attestations.find((a) => a.patrimoine === 'ATTESTATIONS_REFERENCES');
    expect(divers.fichiers).toHaveLength(1);
  });
});
