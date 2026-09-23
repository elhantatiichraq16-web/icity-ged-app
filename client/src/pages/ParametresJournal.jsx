/**
 * Paramètres → Journal d'audit (§13).
 *
 * Tout ce qui touche à la sécurité et à la valeur probatoire du fonds :
 * connexions, validations, suppressions, exports. On n'y efface jamais rien.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import { api } from '../api.js';
import { dateHeure } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Badge, Carte, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';

/** Les actions dites en français, plutôt que par leur code interne. */
const LIBELLES = {
  connexion: 'Connexion',
  'connexion.echec': 'Connexion refusée',
  deconnexion: 'Déconnexion',
  'mot_de_passe.change': 'Mot de passe changé',
  'mot_de_passe.demande': 'Réinitialisation demandée',
  'mot_de_passe.reinitialise': 'Mot de passe réinitialisé',
  'deux_facteurs.active': 'Double authentification activée',
  'deux_facteurs.desactive': 'Double authentification désactivée',
  'utilisateur.invite': 'Utilisateur invité',
  'utilisateur.modifie': 'Compte modifié',
  'marche.modifie': 'Marché modifié',
  'document.verse': 'Document versé',
  'document.telecharge': 'Document téléchargé',
  'document.corbeille': 'Mis en corbeille',
  'document.restaure': 'Restauré',
  'document.nouvelle_version': 'Nouvelle version',
  'doublon.ecarte': 'Doublon écarté',
  'doublon.gardes': 'Doublon : les deux gardés',
  'classement.accepte': 'Classement accepté',
  'classement.refuse': 'Classement écarté',
  'classement.accepte_lot': 'Classement accepté en lot',
  'classement.relance': 'Classement relancé',
  'courriel.releve': 'Courriel relevé',
  'mail.rattache': 'Message rattaché',
  'compte_mail.cree': 'Compte mail créé',
  'compte_mail.modifie': 'Compte mail modifié',
  'circuit.soumettre': 'Soumis au contrôle',
  'circuit.controler': 'Contrôlé',
  'circuit.soumettre_validation': 'Soumis à validation',
  'circuit.valider': 'Validé',
  'circuit.officialiser': 'Rendu officiel',
  'circuit.archiver': 'Archivé',
  'circuit.renvoyer': 'Renvoyé pour correction',
  'sauvegarde.creee': 'Sauvegarde créée',
};

const libelle = (action) => LIBELLES[action] ?? action.replace(/[._]/g, ' ');

/** Les actions sensibles, mises en avant. */
const TONS = {
  'connexion.echec': 'alerte',
  'document.corbeille': 'attente',
  'doublon.ecarte': 'attente',
  'circuit.valider': 'ok',
  'circuit.officialiser': 'ok',
  'circuit.renvoyer': 'alerte',
  'utilisateur.modifie': 'attente',
};

export function ParametresJournal() {
  const [parametres, setParametres] = useSearchParams();
  const action = parametres.get('action') ?? '';
  const page = Number(parametres.get('page') ?? 1);
  const [ouverte, setOuverte] = useState(null);

  const requete = new URLSearchParams({ page: String(page) });
  if (action) requete.set('action', action);

  const journal = useQuery({
    queryKey: ['journal', requete.toString()],
    queryFn: () => api(`/api/journal?${requete}`),
    placeholderData: keepPreviousData,
  });

  function filtrer(cle, valeur) {
    const suivant = new URLSearchParams(parametres);
    if (valeur) suivant.set(cle, String(valeur));
    else suivant.delete(cle);
    if (cle !== 'page') suivant.delete('page');
    setParametres(suivant);
  }

  if (journal.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={8} />
      </Carte>
    );
  }
  if (journal.isError) return <Alerte ton="alerte">{journal.error.message}</Alerte>;

  const d = journal.data;

  return (
    <div className="grid gap-4">
      <Carte className="flex flex-wrap items-center gap-2 p-4">
        <button
          type="button"
          onClick={() => filtrer('action', null)}
          className={cx('rounded-lg px-3 py-1.5 text-[13px] font-medium', !action ? 'bg-cyan-voile text-cyan-texte' : 'text-encre-2 hover:bg-surface-2')}
        >
          Tout <span className="ml-1 text-encre-3">{d.total}</span>
        </button>
        {d.actions.slice(0, 10).map((a) => (
          <button
            key={a.action}
            type="button"
            onClick={() => filtrer('action', a.action)}
            className={cx('rounded-lg px-3 py-1.5 text-[13px] font-medium', action === a.action ? 'bg-cyan-voile text-cyan-texte' : 'text-encre-2 hover:bg-surface-2')}
          >
            {libelle(a.action)} <span className="ml-1 text-encre-3">{a.n}</span>
          </button>
        ))}
      </Carte>

      <Carte>
        {d.lignes.length === 0 ? (
          <EtatVide titre="Aucune trace">Rien ne correspond à ce filtre.</EtatVide>
        ) : (
          <ul className="divide-y divide-trait">
            {d.lignes.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setOuverte(ouverte === l.id ? null : l.id)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-surface-2">
                  <Badge ton={TONS[l.action] ?? 'neutre'}>{libelle(l.action)}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-encre-2">
                    {l.par ? l.par.nom : 'système'}
                    {l.objetType && l.objetId ? ` · ${l.objetType} #${l.objetId}` : ''}
                    {l.commentaire ? ` · ${l.commentaire}` : ''}
                  </span>
                  <span className="text-[12.5px] text-encre-3">{dateHeure(l.creeLe)}</span>
                </button>

                {ouverte === l.id && (l.avant || l.apres) && (
                  <div className="grid gap-3 border-t border-trait bg-surface-2 px-5 py-3 text-[12.5px] sm:grid-cols-2">
                    <div>
                      <p className="mb-1 font-semibold text-encre-3">Avant</p>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(l.avant, null, 1) ?? '—'}</pre>
                    </div>
                    <div>
                      <p className="mb-1 font-semibold text-encre-3">Après</p>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(l.apres, null, 1) ?? '—'}</pre>
                    </div>
                    {l.objetType === 'Document' && l.objetId && (
                      <Link to={`/documents/${l.objetId}`} className="font-medium text-cyan-texte hover:underline sm:col-span-2">
                        Ouvrir le document
                      </Link>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Carte>

      {d.pages > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="Pages du journal">
          <Bouton variante="secondaire" taille="petit" disabled={page <= 1} onClick={() => filtrer('page', page - 1)}>
            Précédent
          </Bouton>
          <span className="text-[13px] text-encre-2">
            Page {d.page} sur {d.pages}
          </span>
          <Bouton variante="secondaire" taille="petit" disabled={page >= d.pages} onClick={() => filtrer('page', page + 1)}>
            Suivant
          </Bouton>
        </nav>
      )}
    </div>
  );
}
