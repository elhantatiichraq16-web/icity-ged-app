/**
 * Les entrées de la barre latérale (§11), dans l'ordre du cahier des charges.
 * `phase` : la phase de livraison où l'écran sera construit.
 * `droit` : l'entrée n'apparaît que si l'utilisateur a ce droit.
 */
import { Building2, FileText, FolderKanban, Inbox, LayoutDashboard, ListChecks, Mail, Settings, ShieldCheck, Trash2, Upload } from 'lucide-react';

export const NAVIGATION = [
  { chemin: '/', libelle: 'Tableau de bord', icone: LayoutDashboard, phase: 6 },
  { chemin: '/marches', libelle: 'Marchés', icone: FolderKanban, phase: 2 },
  { chemin: '/documents', libelle: 'Documents', icone: FileText, phase: 3 },
  { chemin: '/verser', libelle: 'Verser', icone: Upload, phase: 3, droit: ['verser', 'Document'] },
  { chemin: '/a-classer', libelle: 'À classer', icone: ListChecks, phase: 4, droit: ['modifier', 'Document'] },
  { chemin: '/courriel', libelle: 'Courriel', icone: Mail, phase: 1, droit: ['lire', 'Mail'] },
  { chemin: '/a-verifier', libelle: 'À vérifier', icone: ShieldCheck, phase: 7, droit: ['gerer', 'AVerifier'] },
  // La corbeille est une file de « À vérifier », mais on la cherche pour
  // elle-même — après avoir supprimé une pièce, sans savoir où elle est
  // partie. Elle a donc son entrée, qui mène à cette file.
  { chemin: '/a-verifier?file=corbeille', libelle: 'Corbeille', icone: Trash2, phase: 7, droit: ['gerer', 'AVerifier'] },
  { chemin: '/clients', libelle: 'Clients', icone: Building2, phase: 2 },
  { chemin: '/parametres', libelle: 'Paramètres', icone: Settings, phase: 1, droit: ['gerer', 'Utilisateur'] },
];

export const ARRIVEES = { chemin: '/arrivees', libelle: 'Arrivées', icone: Inbox, phase: 8 };

/** Les entrées visibles pour ces droits. */
export function entreesVisibles(droits) {
  return NAVIGATION.filter((e) => !e.droit || droits.can(...e.droit));
}
