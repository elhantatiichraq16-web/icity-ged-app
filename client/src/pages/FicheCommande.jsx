/**
 * La fiche d'une commande fournisseur, sur le modèle d'Odoo.
 *
 *  - en haut, la barre d'étapes : Préparée → Commandée → Livrée → Facturée →
 *    Payée (déduite des dates et des lignes, jamais saisie) ;
 *  - le bon de commande en PDF, et son envoi au fournisseur par mail ;
 *  - les lignes, les totaux HT, TVA, TTC, le paiement ;
 *  - les pièces du fournisseur, à verser ici : un bon de livraison réceptionne
 *    ses lignes, une facture donne son montant ;
 *  - le fil d'activité et les activités, comme sous toute fiche.
 *
 * Réservée, comme les prix, aux achats et à la direction.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FileDown, FileText, Package, Pencil, Send, Upload } from 'lucide-react';
import { ETAPES_COMMANDE, ETATS_PAIEMENT, modalitePaiement, statutAchat } from '@icity/commun/achats';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { dateCourte, montant } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection, ZoneTexte } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage, SqueletteLignes } from '../ui/Elements.jsx';
import { Modale } from '../ui/Modale.jsx';
import { cx } from '../ui/cx.js';
import { useToasts } from '../ui/Toasts.jsx';
import { ModaleCommande } from './Achats.jsx';
import { allerAuFil, BoutonRaccourci, FilActivite } from './FilActivite.jsx';

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Tout ce qui montre la commande est relu après un geste. */
function useRelire() {
  const file = useQueryClient();
  return () => {
    for (const cle of [['commande'], ['fil', 'commande'], ['commandes-fournisseur'], ['achats'], ['fournisseur'], ['documents']]) file.invalidateQueries({ queryKey: cle });
  };
}

/** La barre d'étapes d'Odoo : l'étape franchie en couleur, la courante soulignée. */
function BarreEtapes({ etape }) {
  const courante = ETAPES_COMMANDE.findIndex((e) => e.code === etape);
  return (
    <ol aria-label="Étapes de la commande" className="flex flex-wrap overflow-hidden rounded-[10px] border border-trait">
      {ETAPES_COMMANDE.map((e, i) => (
        <li
          key={e.code}
          aria-current={i === courante ? 'step' : undefined}
          title={e.description}
          className={cx(
            'flex-1 border-r border-trait px-3 py-2 text-center text-[13px] last:border-r-0',
            i < courante && 'bg-surface-2 text-encre-2',
            i === courante && 'bg-cyan-voile font-semibold text-cyan-texte',
            i > courante && 'text-encre-3',
          )}
        >
          {i < courante && <Check className="mr-1 inline size-3.5" aria-hidden />}
          {e.nom}
        </li>
      ))}
    </ol>
  );
}

/** Envoyer le bon de commande au fournisseur, avec un message prêt à corriger. */
function ModaleEnvoi({ ouverte, surChangement, c, emetteurId }) {
  const emetteur = c.internes.find((s) => s.id === emetteurId)?.nom ?? '';
  const [a, setA] = useState(c.fournisseur.email ?? '');
  const [objet, setObjet] = useState(`Bon de commande ${c.numero} — ${c.marche?.reference ?? ''}`.trim());
  const [texte, setTexte] = useState(
    `Bonjour${c.fournisseur.contact ? ` ${c.fournisseur.contact}` : ''},\n\nVeuillez trouver ci-joint notre bon de commande ${c.numero}. Merci de nous confirmer sa bonne réception et le délai de livraison.\n\nCordialement,\n${emetteur}`,
  );
  const relire = useRelire();
  const { notifier } = useToasts();

  const envoyer = useMutation({
    mutationFn: () =>
      api(`/api/commandes-fournisseur/${c.id}/envoyer`, {
        methode: 'POST',
        corps: { emetteurId, a: a.split(/[,;\s]+/).filter(Boolean), objet, texte },
      }),
    onSuccess: (r) => {
      relire();
      notifier({ titre: 'Bon de commande envoyé', message: `${r.envoyees} ligne(s) passée(s) en « Commande envoyée ».`, ton: 'ok' });
      surChangement(false);
    },
    onError: (e) => notifier({ titre: 'Envoi impossible', message: e.erreurs?.envoi ?? e.message, ton: 'alerte' }),
  });

  return (
    <Modale
      ouverte={ouverte}
      surChangement={surChangement}
      largeur="max-w-xl"
      titre={`Envoyer ${c.numero} à ${c.fournisseur.nom}`}
      description="Le bon de commande part en PDF, par le compte de messagerie de l’application. Le mail s’archive avec le marché, et la commande passe « Commandée »."
      pied={
        <>
          <Bouton variante="fantome" onClick={() => surChangement(false)} disabled={envoyer.isPending}>
            Annuler
          </Bouton>
          <Bouton icone={Send} chargement={envoyer.isPending} libelleChargement="Envoi…" disabled={!a.trim()} onClick={() => envoyer.mutate()}>
            Envoyer
          </Bouton>
        </>
      }
    >
      <div className="grid gap-4">
        <Champ libelle="À" type="email" value={a} onChange={(e) => setA(e.target.value)} aide={c.fournisseur.email ? undefined : 'Aucune adresse sur la fiche du fournisseur : saisissez-la, et pensez à compléter sa fiche.'} />
        <Champ libelle="Objet" value={objet} onChange={(e) => setObjet(e.target.value)} />
        <ZoneTexte libelle="Message" lignes={7} value={texte} onChange={(e) => setTexte(e.target.value)} />
        <p className="flex items-center gap-2 text-[13px] text-encre-2">
          <FileText className="size-4 text-encre-3" aria-hidden /> Pièce jointe : {c.numero}.pdf
        </p>
      </div>
    </Modale>
  );
}

/** Verser une pièce du fournisseur : bon de commande signé, bon de livraison, facture. */
function VerserPiece({ c }) {
  const [type, setType] = useState('BLF');
  const [date, setDate] = useState(aujourdhui());
  const [fichier, setFichier] = useState(null);
  const [recues, setRecues] = useState(() => new Set(c.lignes.filter((l) => l.statut !== 'livre').map((l) => l.id)));
  const [envoi, setEnvoi] = useState(false);
  const relire = useRelire();
  const { notifier } = useToasts();
  const aLivrer = c.lignes.filter((l) => l.statut !== 'livre');

  async function verser(e) {
    e.preventDefault();
    if (!fichier) return;
    setEnvoi(true);
    try {
      const formulaire = new FormData();
      formulaire.append('type', type);
      formulaire.append('date', date);
      if (type === 'BLF') formulaire.append('lignes', [...recues].join(','));
      formulaire.append('fichier', fichier);
      const r = await api(`/api/commandes-fournisseur/${c.id}/pieces`, { methode: 'POST', fichier: formulaire });
      relire();
      const effets = [r.livrees && `${r.livrees} ligne(s) livrée(s)`, r.envoyees && `${r.envoyees} ligne(s) envoyée(s)`, r.facture?.montantTtc && `montant lu : ${montant(r.facture.montantTtc)}`].filter(Boolean);
      notifier({ titre: 'Pièce versée', message: effets.join(' · ') || r.document.titre, ton: 'ok' });
      setFichier(null);
      e.target.reset();
    } catch (erreur) {
      notifier({ titre: erreur.statut === 409 ? 'Déjà au fonds' : 'Versement impossible', message: erreur.message, ton: erreur.statut === 409 ? 'attente' : 'alerte' });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={verser} className="grid gap-3 border-t border-trait px-5 py-4">
      <p className="font-sans text-[13px] font-semibold tracking-[0.06em] text-encre-3 uppercase">Verser une pièce</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Selection libelle="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="BLF">Bon de livraison (réception)</option>
          <option value="FACF">Facture</option>
          <option value="BCF">Bon de commande signé</option>
        </Selection>
        <Champ libelle="Date de la pièce" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {/* Une réception partielle : on coche ce qui est arrivé, comme dans Odoo. */}
      {type === 'BLF' && aLivrer.length > 0 && (
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-[13px] font-semibold text-encre-2">Lignes reçues avec ce bon</legend>
          {aLivrer.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-2 text-[14px]">
              <input
                type="checkbox"
                checked={recues.has(l.id)}
                onChange={() =>
                  setRecues((avant) => {
                    const apres = new Set(avant);
                    if (apres.has(l.id)) apres.delete(l.id);
                    else apres.add(l.id);
                    return apres;
                  })
                }
                className="size-4 accent-[var(--cyan)]"
              />
              <span className="min-w-0 truncate">
                {l.numero ? `${l.numero} · ` : ''}
                {l.designation}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" onChange={(e) => setFichier(e.target.files?.[0] ?? null)} aria-label="Fichier de la pièce" className="min-w-0 flex-1 text-[14px]" />
        <Bouton type="submit" taille="petit" icone={Upload} disabled={!fichier || (type === 'BLF' && aLivrer.length > 0 && recues.size === 0)} chargement={envoi} libelleChargement="Envoi…">
          Verser
        </Bouton>
      </div>
    </form>
  );
}

export function PageFicheCommande() {
  const { id } = useParams();
  const { droits } = useSession();
  const gerer = droits.can('gerer', 'Achat');
  const commande = useQuery({ queryKey: ['commande', id], queryFn: () => api(`/api/commandes-fournisseur/${id}`) });
  const [edition, setEdition] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [emetteurId, setEmetteurId] = useState(null);
  const relire = useRelire();
  const { notifier } = useToasts();

  /*
   * L'onglet s'ouvre tout de suite, au clic : ouvert après l'attente, le
   * navigateur le prendrait pour une fenêtre surgissante et le bloquerait.
   */
  const preparer = useMutation({
    mutationFn: async (onglet) => ({ onglet, r: await api(`/api/commandes-fournisseur/${id}/bon-de-commande`, { methode: 'POST', corps: { emetteurId: emetteurIdChoisi() } }) }),
    onSuccess: ({ onglet, r }) => {
      relire();
      if (onglet) onglet.location.href = `/api/documents/${r.document.id}/fichier`;
    },
    onError: (e, onglet) => {
      onglet?.close();
      notifier({ titre: 'Bon de commande impossible', message: e.message, ton: 'alerte' });
    },
  });
  const payer = useMutation({
    mutationFn: (champ) => api(`/api/commandes-fournisseur/${id}`, { methode: 'PATCH', corps: { [champ]: aujourdhui() } }),
    onSuccess: () => relire(),
    onError: (e) => notifier({ titre: 'Paiement non enregistré', message: e.message, ton: 'alerte' }),
  });

  if (commande.isPending) {
    return (
      <Carte className="p-6">
        <SqueletteLignes lignes={6} />
      </Carte>
    );
  }
  if (commande.isError) return <Alerte ton="alerte">{commande.error.message}</Alerte>;

  const c = commande.data;
  function emetteurIdChoisi() {
    return emetteurId ?? c.internes[0]?.id ?? null;
  }
  const bons = c.pieces.filter((p) => p.type === 'BCF');
  const aLivrer = c.lignes.some((l) => l.statut !== 'livre');

  return (
    <div className="animate-apparition">
      <Link to="/achats?onglet=paiements" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-cyan-texte hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Commandes et paiements
      </Link>

      <EnTetePage
        surtitre="Commande fournisseur"
        titre={c.numero}
        description={
          <>
            <Link to={`/achats/fournisseurs/${c.fournisseur.id}`} className="font-medium text-cyan-texte hover:underline">
              {c.fournisseur.nom}
            </Link>
            {' · '}
            {c.marche ? (
              <Link to={`/marches/${c.marche.id}`} className="chiffres text-cyan-texte hover:underline">
                {c.marche.reference}
              </Link>
            ) : (
              '—'
            )}
          </>
        }
        actions={
          gerer && (
            <div className="flex flex-wrap items-center gap-2">
              <Bouton variante="secondaire" taille="petit" icone={Pencil} onClick={() => setEdition(true)}>
                Modifier
              </Bouton>
              <Bouton variante="secondaire" taille="petit" icone={FileDown} chargement={preparer.isPending} libelleChargement="Préparation…" onClick={() => preparer.mutate(window.open('', '_blank'))}>
                Bon de commande PDF
              </Bouton>
              <Bouton taille="petit" icone={Send} onClick={() => setEnvoi(true)}>
                Envoyer au fournisseur
              </Bouton>
            </div>
          )
        }
      />

      <BarreEtapes etape={c.etape} />
      {['facturee', 'payee'].includes(c.etape) && aLivrer && (
        <Alerte ton="attente" className="mt-3">
          Cette commande est {c.etape === 'payee' ? 'payée' : 'facturée'}, mais tout le matériel n’est pas encore reçu : versez le bon de livraison quand il arrive.
        </Alerte>
      )}

      {/* Les boutons de raccourci d'Odoo. */}
      <div className="mt-4 mb-5 flex flex-wrap items-center gap-2">
        <BoutonRaccourci icone={Package} chiffre={c.lignes.length} libelle="Lignes" surClic={() => document.getElementById('lignes-commande')?.scrollIntoView({ behavior: 'smooth' })} />
        <BoutonRaccourci icone={FileText} chiffre={c.pieces.length} libelle="Pièces" surClic={() => document.getElementById('pieces-commande')?.scrollIntoView({ behavior: 'smooth' })} />
        <BoutonRaccourci icone={Send} chiffre={bons.length} libelle="Bons de commande" surClic={allerAuFil} />
        {gerer && c.internes.length > 1 && (
          <div className="ml-auto w-64">
            <Selection libelle="Société qui commande" value={String(emetteurIdChoisi() ?? '')} onChange={(e) => setEmetteurId(Number(e.target.value))}>
              {c.internes.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.nom}
                </option>
              ))}
            </Selection>
          </div>
        )}
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Carte id="lignes-commande" className="scroll-mt-20 overflow-x-auto">
          <table className="w-full text-[14px]">
            <caption className="sr-only">Lignes de la commande</caption>
            <thead>
              <tr className="border-b border-trait bg-surface-2 text-left text-[13px] font-semibold text-encre-3">
                <th className="px-3 py-2.5">N°</th>
                <th className="px-3 py-2.5">Désignation</th>
                <th className="px-3 py-2.5 text-right">Qté</th>
                <th className="px-3 py-2.5 text-right">PU HT</th>
                <th className="px-3 py-2.5 text-right">Total HT</th>
                <th className="px-3 py-2.5">Livraison</th>
              </tr>
            </thead>
            <tbody>
              {c.lignes.map((l) => {
                const s = statutAchat(l.statut);
                return (
                  <tr key={l.id} className="border-b border-trait last:border-b-0 align-top">
                    <td className="chiffres px-3 py-2.5 text-encre-3">{l.numero ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      {l.designation}
                      {(l.marque || l.referenceAchat) && <span className="block text-[13px] text-encre-3">{[l.marque, l.referenceAchat].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className="chiffres px-3 py-2.5 text-right">{l.quantite}</td>
                    <td className="chiffres px-3 py-2.5 text-right whitespace-nowrap">{l.puAchat === null ? '—' : montant(l.puAchat)}</td>
                    <td className="chiffres px-3 py-2.5 text-right whitespace-nowrap">{l.totalAchat === null ? '—' : montant(l.totalAchat)}</td>
                    <td className="px-3 py-2.5">
                      <Badge ton={s.ton}>{s.nom}</Badge>
                      {l.etd && l.statut !== 'livre' && <span className="mt-0.5 block text-[13px] text-encre-3">prévue le {dateCourte(l.etd)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <dl className="ml-auto grid w-72 gap-1 border-t border-trait px-3 py-3 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-encre-2">Total HT</dt>
              <dd className="chiffres">{montant(c.totaux.ht)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-encre-2">TVA</dt>
              <dd className="chiffres">{montant(c.totaux.tva)}</dd>
            </div>
            <div className="flex justify-between text-[15px] font-semibold">
              <dt>Total TTC</dt>
              <dd className="chiffres">{montant(c.totaux.ttc)}</dd>
            </div>
          </dl>
        </Carte>

        <div className="grid content-start gap-5">
          {/* Le contrôle de la facture à trois montants, comme Odoo. */}
          <Carte className="p-5">
            <h2 className="mb-3 font-semibold">Contrôle de la facture</h2>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Commandé', c.controle.commande],
                ['Reçu', c.controle.recu],
                ['Facturé', c.controle.facture],
              ].map(([libelle, valeur]) => (
                <div key={libelle} className="rounded-lg bg-surface-2 px-2 py-2">
                  <dt className="text-[13px] text-encre-3">{libelle}</dt>
                  <dd className="chiffres text-[14px] font-semibold">{valeur === null ? '—' : montant(valeur)}</dd>
                </div>
              ))}
            </dl>
            {c.controle.alertes.length === 0 ? (
              <p className="mt-2 text-[13px] text-encre-3">{c.controle.facture === null ? 'La facture n’est pas encore arrivée.' : 'La facture concorde avec la commande et la réception.'}</p>
            ) : (
              <ul className="mt-2 grid gap-1.5">
                {c.controle.alertes.map((a) => (
                  <li key={a.code}>
                    <Alerte ton={a.ton === 'alerte' ? 'alerte' : 'attente'}>{a.texte}</Alerte>
                  </li>
                ))}
              </ul>
            )}
          </Carte>

          <Carte className="p-5">
            <h2 className="mb-3 font-semibold">Paiement</h2>
            <dl className="grid gap-1.5 text-[14px]">
              <div className="flex justify-between gap-3">
                <dt className="text-encre-2">Modalité</dt>
                <dd>{modalitePaiement(c.modalite).nom}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-encre-2">Avance ({c.avancePourcent ?? 0} %)</dt>
                <dd className="chiffres">{montant(c.avance)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-encre-2">Reste</dt>
                <dd className="chiffres">{montant(c.reste)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-encre-2">Échéance</dt>
                <dd className={cx(c.echeance && c.echeance < aujourdhui() && c.etat !== 'soldee' && 'font-semibold text-alerte-texte')}>{c.echeance ? dateCourte(c.echeance) : '—'}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge ton={ETATS_PAIEMENT[c.etat].ton}>{ETATS_PAIEMENT[c.etat].nom}</Badge>
              {gerer && c.etat === 'avance_a_payer' && (
                <Bouton variante="secondaire" taille="petit" chargement={payer.isPending} onClick={() => payer.mutate('avancePayeeLe')}>
                  Avance payée aujourd’hui
                </Bouton>
              )}
              {gerer && c.etat === 'reste_a_payer' && (
                <Bouton variante="secondaire" taille="petit" chargement={payer.isPending} onClick={() => payer.mutate('soldePayeLe')}>
                  Solde payé aujourd’hui
                </Bouton>
              )}
            </div>
          </Carte>

          <Carte id="pieces-commande" className="scroll-mt-20">
            <h2 className="px-5 pt-4 pb-2 font-semibold">Pièces du fournisseur</h2>
            {c.pieces.length === 0 ? (
              <p className="px-5 pb-4 text-[14px] text-encre-3">Aucune pièce : préparez le bon de commande, puis versez ici le bon de livraison et la facture.</p>
            ) : (
              <ul className="divide-y divide-trait px-5 pb-2">
                {c.pieces.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-2 text-[14px]">
                    <FileText className="size-4 shrink-0 text-encre-3" aria-hidden />
                    <Link to={`/documents/${p.id}`} className="min-w-0 flex-1 truncate text-cyan-texte hover:underline">
                      {p.titre}
                    </Link>
                    <span className="text-[13px] text-encre-3">{dateCourte(p.creeLe)}</span>
                  </li>
                ))}
              </ul>
            )}
            {gerer && <VerserPiece key={c.lignes.map((l) => l.statut).join()} c={c} />}
          </Carte>
        </div>
      </div>

      {c.notes && (
        <Carte className="mb-5 p-5">
          <h2 className="mb-2 font-semibold">Notes</h2>
          <p className="text-[14px] whitespace-pre-line text-encre-2">{c.notes}</p>
        </Carte>
      )}

      <FilActivite type="commande" id={c.id} />

      {gerer && (
        <>
          <ModaleCommande ouverte={edition} commande={c} surChangement={() => { setEdition(false); relire(); }} />
          <ModaleEnvoi key={`${c.id}-${emetteurIdChoisi()}`} ouverte={envoi} surChangement={setEnvoi} c={c} emetteurId={emetteurIdChoisi()} />
        </>
      )}
    </div>
  );
}
