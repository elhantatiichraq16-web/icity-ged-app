/**
 * La fiche d'un fournisseur, sur le modèle d'Odoo : qui il est, où le joindre,
 * ses contacts, les marchés où il fournit, ses commandes, et son fil
 * d'activité (notes, modifications, activités à faire).
 *
 * Réservée, comme les prix, aux achats et à la direction.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FolderKanban, Package, Pencil, Receipt, Users } from 'lucide-react';
import { ETATS_PAIEMENT } from '@icity/commun/achats';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateCourte, montant } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Badge, Carte, EnTetePage, SqueletteLignes } from '../ui/Elements.jsx';
import { ModaleFournisseur } from './Achats.jsx';
import { CarteContacts } from './Clients.jsx';
import { BoutonRaccourci, FilActivite } from './FilActivite.jsx';

/** Une ligne de la fiche : libellé à gauche, valeur à droite. */
function Ligne({ libelle, children }) {
  return (
    <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-3 py-2">
      <dt className="text-[13px] text-encre-3">{libelle}</dt>
      <dd className="min-w-0 text-[14px] break-words">{children || <span className="text-encre-3">—</span>}</dd>
    </div>
  );
}

export function PageFicheFournisseur() {
  const { id } = useParams();
  const { droits } = useSession();
  const peutGerer = droits.can('gerer', 'Fournisseur');
  const [edition, setEdition] = useState(false);
  const fournisseur = useQuery({ queryKey: ['fournisseur', id], queryFn: () => api(`/api/fournisseurs/${id}`) });

  if (fournisseur.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={5} />
      </Carte>
    );
  }
  if (fournisseur.isError) return <Alerte ton="alerte">{fournisseur.error.message}</Alerte>;

  const f = fournisseur.data;
  const adresse = [f.adresse, [f.codePostal, f.ville].filter(Boolean).join(' '), f.pays].filter(Boolean).join(', ');
  const site = f.siteWeb ? (/^https?:\/\//i.test(f.siteWeb) ? f.siteWeb : `https://${f.siteWeb}`) : null;
  const allerA = (ancre) => () => document.getElementById(ancre)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="animate-apparition">
      <Link to="/achats?onglet=fournisseurs" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-cyan-texte hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Fournisseurs
      </Link>

      <EnTetePage
        surtitre="Fournisseur"
        titre={f.nom}
        description={f.synonymes.length ? `Aussi écrit : ${f.synonymes.join(', ')}` : undefined}
        actions={
          peutGerer && (
            <Bouton variante="secondaire" taille="petit" icone={Pencil} onClick={() => setEdition(true)}>
              Modifier la fiche
            </Bouton>
          )
        }
      />

      {/* Les boutons de raccourci d'Odoo : un chiffre, et on y va. */}
      <div className="mb-5 flex flex-wrap gap-2">
        <BoutonRaccourci icone={FolderKanban} chiffre={f.marches.length} libelle="Marchés" surClic={allerA('marches-fournisseur')} />
        <BoutonRaccourci icone={Package} chiffre={f.nbLignes} libelle="Lignes d’achat" vers="/achats" />
        {f.montantAchat !== null && <BoutonRaccourci icone={Receipt} chiffre={f.commandes.length} libelle="Commandes" surClic={allerA('commandes-fournisseur')} />}
        <BoutonRaccourci icone={Users} chiffre={f.contacts.length} libelle="Contacts" surClic={allerA('contacts-client')} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Carte className="p-5">
          <h2 className="mb-2 font-semibold">Coordonnées</h2>
          <dl className="divide-y divide-trait">
            <Ligne libelle="Contact principal">{f.contact}</Ligne>
            <Ligne libelle="Adresse">{adresse}</Ligne>
            <Ligne libelle="Téléphone">{f.telephone && <a href={`tel:${f.telephone.replace(/\s/g, '')}`} className="chiffres text-cyan-texte hover:underline">{f.telephone}</a>}</Ligne>
            <Ligne libelle="E-mail">{f.email && <a href={`mailto:${f.email}`} className="text-cyan-texte hover:underline">{f.email}</a>}</Ligne>
            <Ligne libelle="Site web">{site && <a href={site} target="_blank" rel="noreferrer" className="text-cyan-texte hover:underline">{f.siteWeb}</a>}</Ligne>
            <Ligne libelle="ICE">{f.ice && <span className="chiffres">{f.ice}</span>}</Ligne>
            <Ligne libelle="IF / RC">{[f.identifiantFiscal, f.registreCommerce].filter(Boolean).join(' · ')}</Ligne>
            <Ligne libelle="Conditions">{f.conditions}</Ligne>
            {f.montantAchat !== null && <Ligne libelle="Acheté (HT)">{f.montantAchat ? <span className="chiffres">{montant(f.montantAchat)}</span> : null}</Ligne>}
          </dl>
        </Carte>
        <CarteContacts c={f} peutGerer={peutGerer} cible="fournisseur" />
      </div>

      {f.notes && (
        <Carte className="mb-5 p-5">
          <h2 className="mb-2 font-semibold">Notes</h2>
          <p className="text-[14px] whitespace-pre-line text-encre-2">{f.notes}</p>
        </Carte>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Carte id="marches-fournisseur" className="scroll-mt-20">
          <h2 className="border-b border-trait px-5 py-3 font-semibold">Marchés où il fournit</h2>
          {f.marches.length === 0 ? (
            <p className="px-5 py-6 text-[14px] text-encre-3">Aucune ligne d’achat chez lui pour l’instant.</p>
          ) : (
            <ul className="divide-y divide-trait">
              {f.marches.map((m) => (
                <li key={m.id}>
                  <Link to={`/marches/${m.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                    <span className="chiffres min-w-0 flex-1 truncate font-medium text-cyan-texte">{m.reference}</span>
                    <span className="text-[13px] text-encre-3">
                      {m.nbLignes} ligne{m.nbLignes > 1 ? 's' : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Carte>

        {f.montantAchat !== null && (
          <Carte id="commandes-fournisseur" className="scroll-mt-20">
            <h2 className="border-b border-trait px-5 py-3 font-semibold">Commandes</h2>
            {f.commandes.length === 0 ? (
              <p className="px-5 py-6 text-[14px] text-encre-3">Aucune commande.</p>
            ) : (
              <ul className="divide-y divide-trait">
                {f.commandes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Link to={`/marches/${c.marche?.id}`} className="chiffres min-w-0 flex-1 truncate text-cyan-texte hover:underline">
                      {c.marche?.reference ?? '—'}
                    </Link>
                    <span className="chiffres text-[13px]">{c.montantTtc ? montant(c.montantTtc) : 'montant à venir'}</span>
                    {c.echeance && <span className="text-[13px] text-encre-3">échéance {dateCourte(c.echeance)}</span>}
                    {ETATS_PAIEMENT[c.etat] && <Badge ton={ETATS_PAIEMENT[c.etat].ton}>{ETATS_PAIEMENT[c.etat].nom}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Carte>
        )}
      </div>

      <FilActivite type="fournisseur" id={f.id} />

      {peutGerer && <ModaleFournisseur ouverte={edition} surChangement={setEdition} fournisseur={f} />}
    </div>
  );
}
