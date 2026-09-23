/** Écrans simples : les phases à venir, et la page introuvable. */
import { Link, useLocation } from 'react-router';
import { ARRIVEES, NAVIGATION } from '../coquille/navigation.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Carte, EnTetePage, EtatVide } from '../ui/Elements.jsx';

export function PageAVenir() {
  const { pathname } = useLocation();
  const entree = [...NAVIGATION, ARRIVEES].find((e) => e.chemin !== '/' && pathname.startsWith(e.chemin));
  return (
    <div className="animate-apparition">
      <EnTetePage titre={entree?.libelle ?? 'Écran à venir'} />
      <Carte>
        <EtatVide
          illustration="chantier"
          titre="Cet écran arrive bientôt"
          action={
            <Link to="/">
              <Bouton variante="secondaire">Retour à l’accueil</Bouton>
            </Link>
          }
        >
          {entree ? `Il sera construit à la phase ${entree.phase} du projet.` : 'Il sera construit dans une prochaine phase.'}
        </EtatVide>
      </Carte>
    </div>
  );
}

export function PageIntrouvable() {
  return (
    <Carte className="animate-apparition">
      <EtatVide
        titre="Page introuvable"
        action={
          <Link to="/">
            <Bouton>Retour à l’accueil</Bouton>
          </Link>
        }
      >
        L’adresse demandée n’existe pas, ou elle a changé.
      </EtatVide>
    </Carte>
  );
}
