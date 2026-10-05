/**
 * Point d'entrée des écrans : fournisseurs (données, session, toasts) et routes.
 */
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FournisseurSession, useSession } from './auth/session.jsx';
import { Coquille } from './coquille/Coquille.jsx';
import { PageChoisirMotDePasse, PageConnexion, PageDeuxFacteurs, PageMotDePasseOublie } from './pages/auth/PagesAuth.jsx';
import { PageClients, PageFicheClient } from './pages/Clients.jsx';
import { PageArchives } from './pages/Archives.jsx';
import { PageAnalyses } from './pages/Analyses.jsx';
import { PageCalendrier } from './pages/Calendrier.jsx';
import { PageFicheCommande } from './pages/FicheCommande.jsx';
import { PageFicheFournisseur } from './pages/FicheFournisseur.jsx';
import { PageCorbeille } from './pages/Corbeille.jsx';
import { PageArrivees, PageCourriel } from './pages/Courriel.jsx';
import { PageFicheMarche } from './pages/FicheMarche.jsx';
import { PageMarches } from './pages/Marches.jsx';
import { PageNouveauMarche } from './pages/NouveauMarche.jsx';
import { PageParametres } from './pages/Parametres.jsx';
import { PageProfil } from './pages/Profil.jsx';
import { PageRecherche } from './pages/Recherche.jsx';
import { PageVerser } from './pages/Verser.jsx';
import { PageIntrouvable } from './pages/Simples.jsx';
import { PageAClasser, PageAVerifier } from './pages/Tri.jsx';
import { Pictogramme } from './ui/Logo.jsx';
import { Rattrapage } from './ui/Rattrapage.jsx';
import { FournisseurToasts } from './ui/Toasts.jsx';
import './styles.css';

/**
 * Les deux écrans lourds, chargés seulement quand on y va.
 *
 * La fiche document embarque PDF.js et le tableau de bord Chart.js : à eux
 * deux, près d'un mégaoctet qui pesait sur la première ouverture de chaque
 * écran, y compris ceux qui n'en ont pas besoin. Sur un PC de 3,7 Go (§2),
 * cela se voit.
 */
const PageTableauDeBord = lazy(() => import('./pages/TableauDeBord.jsx').then((m) => ({ default: m.PageTableauDeBord })));
const PageDocuments = lazy(() => import('./pages/Documents.jsx').then((m) => ({ default: m.PageDocuments })));
const PageFicheDocument = lazy(() => import('./pages/Documents.jsx').then((m) => ({ default: m.PageFicheDocument })));
const PageAchats = lazy(() => import('./pages/Achats.jsx').then((m) => ({ default: m.PageAchats })));

const clientRequetes = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: (n, e) => n < 1 && ![401, 403, 404, 419].includes(e?.statut) },
  },
});

/** L'écran d'attente, le temps de savoir qui est connecté. */
function Demarrage() {
  return (
    <div className="grid min-h-screen place-items-center" role="status" aria-label="Chargement d’iCity GED">
      <Pictogramme className="size-12 animate-miroitement" />
    </div>
  );
}

/** Réservé aux personnes connectées ; sinon, direction la connexion. */
function Protege() {
  const { chargement, utilisateur, deuxFacteursEnAttente } = useSession();
  const lieu = useLocation();
  if (chargement) return <Demarrage />;
  if (deuxFacteursEnAttente) return <Navigate to="/deux-facteurs" replace state={{ depuis: lieu.pathname }} />;
  if (!utilisateur) return <Navigate to="/connexion" replace state={{ depuis: lieu.pathname }} />;
  return <Outlet />;
}

/** Les pages de connexion n'ont pas de sens pour qui est déjà connecté. */
function Public() {
  const { chargement, utilisateur } = useSession();
  if (chargement) return <Demarrage />;
  if (utilisateur) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Réservé à un droit précis (ex. Paramètres → administrateur). */
function Exige({ action, sujet }) {
  const { droits } = useSession();
  return droits.can(action, sujet) ? <Outlet /> : <PageIntrouvable />;
}

function Racine() {
  return (
    <FournisseurSession>
      <FournisseurToasts>
        {/* Le filet entoure toute l'application : un écran qui plante ne doit
            jamais laisser une page blanche. */}
        <Rattrapage>
          {/* Le temps qu'un écran différé arrive, on garde le même écran
              d'attente qu'au démarrage : rien ne sautille. */}
          <Suspense fallback={<Demarrage />}>
            <Outlet />
          </Suspense>
        </Rattrapage>
      </FournisseurToasts>
    </FournisseurSession>
  );
}

const routeur = createBrowserRouter([
  {
    element: <Racine />,
    children: [
      {
        element: <Public />,
        children: [
          { path: '/connexion', element: <PageConnexion /> },
          { path: '/mot-de-passe-oublie', element: <PageMotDePasseOublie /> },
        ],
      },
      // Accessibles connecté ou non : un lien reçu par e-mail doit toujours s'ouvrir.
      { path: '/deux-facteurs', element: <PageDeuxFacteurs /> },
      { path: '/reinitialiser/:jeton', element: <PageChoisirMotDePasse type="reinitialisation" /> },
      { path: '/invitation/:jeton', element: <PageChoisirMotDePasse type="invitation" /> },
      {
        element: <Protege />,
        children: [
          {
            element: <Coquille />,
            children: [
              { path: '/', element: <PageTableauDeBord /> },
              { path: '/profil', element: <PageProfil /> },
              { path: '/marches', element: <PageMarches /> },
              { path: '/marches/:id', element: <PageFicheMarche /> },
              { path: '/documents', element: <PageDocuments /> },
              { path: '/recherche', element: <PageRecherche /> },
              { path: '/verser', element: <PageVerser /> },
              { path: '/corbeille', element: <PageCorbeille /> },
              { path: '/archives', element: <PageArchives /> },
              { path: '/calendrier', element: <PageCalendrier /> },
              { path: '/analyses', element: <PageAnalyses /> },
              { path: '/courriel', element: <PageCourriel /> },
              { path: '/arrivees', element: <PageArrivees /> },
              { path: '/documents/:id', element: <PageFicheDocument /> },
              { path: '/clients', element: <PageClients /> },
              { path: '/clients/:id', element: <PageFicheClient /> },
              {
                element: <Exige action="lire" sujet="Achat" />,
                children: [{ path: '/achats', element: <PageAchats /> }],
              },
              {
                // La fiche d'un fournisseur : réservée, comme ses prix, aux achats et à la direction.
                element: <Exige action="lire" sujet="Fournisseur" />,
                children: [{ path: '/achats/fournisseurs/:id', element: <PageFicheFournisseur /> }],
              },
              {
                // La fiche d'une commande : ses prix restent aux achats et à la direction.
                element: <Exige action="lire" sujet="PrixAchat" />,
                children: [{ path: '/achats/commandes/:id', element: <PageFicheCommande /> }],
              },
              {
                element: <Exige action="creer" sujet="Marche" />,
                children: [{ path: '/marches/nouveau', element: <PageNouveauMarche /> }],
              },
              {
                element: <Exige action="gerer" sujet="AVerifier" />,
                children: [
                  { path: '/a-classer', element: <PageAClasser /> },
                  { path: '/a-verifier', element: <PageAVerifier /> },
                ],
              },
              {
                element: <Exige action="gerer" sujet="Utilisateur" />,
                children: [{ path: '/parametres/*', element: <PageParametres /> }],
              },
              { path: '*', element: <PageIntrouvable /> },
            ],
          },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('racine')).render(
  <StrictMode>
    <QueryClientProvider client={clientRequetes}>
      <RouterProvider router={routeur} />
    </QueryClientProvider>
  </StrictMode>,
);
