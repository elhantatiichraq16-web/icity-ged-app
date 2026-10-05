/**
 * Les entrées de la barre latérale (§11), rangées par groupe : ce qu'on
 * pilote, les affaires, les documents, le tri, le rangement.
 * `groupe` : le titre sous lequel l'entrée apparaît (les entrées d'un même
 * groupe se suivent).
 * `phase` : la phase de livraison où l'écran sera construit.
 * `droit` : l'entrée n'apparaît que si l'utilisateur a ce droit.
 */
import { Archive, Briefcase, Building2, CalendarDays, ClipboardCheck, FileText, Files, FolderInput, FolderKanban, Inbox, LayoutDashboard, ListChecks, Mail, Package, Settings, ShoppingCart, Trash2, Upload } from 'lucide-react';

export const NAVIGATION = [
  { chemin: '/', libelle: 'Tableau de bord', icone: LayoutDashboard, phase: 6, groupe: 'Pilotage' },
  // Échéances, activités, livraisons et paiements sur un mois, comme Odoo.
  { chemin: '/calendrier', libelle: 'Calendrier', icone: CalendarDays, phase: 6, groupe: 'Pilotage' },
  { chemin: '/marches', libelle: 'Marchés', icone: FolderKanban, phase: 2, groupe: 'Affaires' },
  // Le matériel de chaque marché : sa commande, sa livraison, son paiement.
  { chemin: '/achats', libelle: 'Achats', icone: ShoppingCart, phase: 10, droit: ['lire', 'Achat'], groupe: 'Affaires' },
  { chemin: '/clients', libelle: 'Clients', icone: Building2, phase: 2, groupe: 'Affaires' },
  { chemin: '/documents', libelle: 'Documents', icone: FileText, phase: 3, groupe: 'Documents' },
  { chemin: '/verser', libelle: 'Verser', icone: Upload, phase: 3, droit: ['verser', 'Document'], groupe: 'Documents' },
  { chemin: '/courriel', libelle: 'Courriel', icone: Mail, phase: 1, droit: ['lire', 'Mail'], groupe: 'Documents' },
  // Les deux files du tri : ce que le classement automatique a laissé.
  { chemin: '/a-classer', libelle: 'À classer', icone: FolderInput, phase: 9, droit: ['gerer', 'AVerifier'], groupe: 'Tri' },
  { chemin: '/a-verifier', libelle: 'À vérifier', icone: ClipboardCheck, phase: 9, droit: ['gerer', 'AVerifier'], groupe: 'Tri' },
  // Les marchés et les pièces rangés : tout le monde les consulte, la
  // direction les range.
  { chemin: '/archives', libelle: 'Archives', icone: Archive, phase: 7, groupe: 'Rangement' },
  { chemin: '/corbeille', libelle: 'Corbeille', icone: Trash2, phase: 7, droit: ['gerer', 'AVerifier'], groupe: 'Rangement' },
  { chemin: '/parametres', libelle: 'Paramètres', icone: Settings, phase: 1, droit: ['gerer', 'Utilisateur'], groupe: 'Administration' },
];

export const ARRIVEES = { chemin: '/arrivees', libelle: 'Arrivées', icone: Inbox, phase: 8 };

/** L'icône d'un groupe : sur son titre, qu'on clique pour l'ouvrir. */
export const ICONES_GROUPES = { Pilotage: LayoutDashboard, Affaires: Briefcase, Documents: Files, Tri: ListChecks, Rangement: Package };

/** Les entrées visibles pour ces droits. */
export function entreesVisibles(droits) {
  return NAVIGATION.filter((e) => !e.droit || droits.can(...e.droit));
}

/**
 * Les entrées visibles, groupées : `[{ groupe, entrees }]`. Un groupe dont
 * aucune entrée n'est permise disparaît avec son titre.
 */
export function groupesVisibles(droits) {
  const groupes = [];
  for (const e of entreesVisibles(droits)) {
    const dernier = groupes.at(-1);
    if (dernier?.groupe === e.groupe) dernier.entrees.push(e);
    else groupes.push({ groupe: e.groupe, entrees: [e] });
  }
  return groupes;
}
