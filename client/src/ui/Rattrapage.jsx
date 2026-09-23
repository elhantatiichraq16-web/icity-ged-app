/**
 * Le filet des écrans : ce qui s'affiche quand un composant plante.
 *
 * Sans lui, une erreur React démonte tout l'arbre et laisse une page
 * blanche — sans message, sans moyen de revenir. L'utilisateur croit que
 * l'application est morte alors qu'un seul écran a échoué.
 *
 * React n'attrape ces erreurs que par un composant à classe : `componentDidCatch`
 * n'a pas d'équivalent en hook. C'est le seul endroit du projet où la forme
 * ancienne est nécessaire.
 */
import { Component } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Bouton } from './Bouton.jsx';
import { Carte } from './Elements.jsx';

export class Rattrapage extends Component {
  constructor(props) {
    super(props);
    this.state = { erreur: null };
  }

  static getDerivedStateFromError(erreur) {
    return { erreur };
  }

  componentDidCatch(erreur, infos) {
    // La console garde la trace complète : c'est là qu'on la cherchera pour
    // comprendre, l'écran ne montrant qu'un message lisible.
    console.error('Écran en échec :', erreur, infos?.componentStack);
  }

  render() {
    const { erreur } = this.state;
    if (!erreur) return this.props.children;

    return (
      <div className="grid min-h-[60vh] place-items-center p-6">
        <Carte className="max-w-lg p-6 text-center">
          <TriangleAlert className="mx-auto mb-4 size-10 text-attente" aria-hidden />
          <h1 className="font-titre mb-2 text-xl font-semibold">Cet écran n’a pas pu s’afficher</h1>
          <p className="mb-5 text-sm text-encre-2">
            Le reste de l’application fonctionne toujours. Rechargez la page : si le problème revient, notez ce que vous
            faisiez, cela aidera à le corriger.
          </p>

          {/* Le message technique reste accessible sans encombrer : replié. */}
          <details className="mb-5 text-left">
            <summary className="cursor-pointer text-[13px] text-encre-3 hover:text-encre-2">Détail technique</summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-2 p-3 text-[12px] whitespace-pre-wrap text-encre-2">
              {String(erreur?.message ?? erreur)}
            </pre>
          </details>

          <div className="flex flex-wrap justify-center gap-2">
            <Bouton icone={RefreshCw} onClick={() => window.location.reload()}>
              Recharger
            </Bouton>
            {/* Une navigation complète, pas le routeur : si c'est lui qui a
                échoué, seul un rechargement remet l'application d'aplomb. */}
            <Bouton
              variante="secondaire"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              Revenir au tableau de bord
            </Bouton>
          </div>
        </Carte>
      </div>
    );
  }
}
