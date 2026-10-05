/**
 * Paramètres (administrateur). Phase 1 : utilisateurs et rôles.
 * Les autres onglets (référentiels, courriel, OCR, sauvegardes, journal)
 * arrivent avec leurs phases.
 */
import { useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus, Search, UserPlus } from 'lucide-react';
import { ROLES } from '@icity/commun/roles';
import { schemaInvitation } from '@icity/commun/schemas';
import { api } from '../api.js';
import { useSession } from '../auth/session.jsx';
import { depuis } from '../format.js';
import { useFormulaire } from '../formulaire.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Bouton } from '../ui/Bouton.jsx';
import { Champ, Selection } from '../ui/Champ.jsx';
import { Alerte, Badge, Carte, EnTetePage, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { cx } from '../ui/cx.js';
import { Modale } from '../ui/Modale.jsx';
import { useToasts } from '../ui/Toasts.jsx';
import { ParametresCourriel } from './ParametresCourriel.jsx';
import { ParametresJournal } from './ParametresJournal.jsx';
import { ParametresModeles } from './ModelesMails.jsx';
import { ParametresOcr } from './ParametresOcr.jsx';
import { ParametresReferentiels } from './ParametresReferentiels.jsx';
import { ParametresSauvegardes } from './ParametresSauvegardes.jsx';

const ONGLETS = [
  { chemin: 'utilisateurs', libelle: 'Utilisateurs et rôles', phase: 1 },
  { chemin: 'referentiels', libelle: 'Référentiels', phase: 1 },
  { chemin: 'courriel', libelle: 'Comptes mail', phase: 1 },
  { chemin: 'modeles', libelle: 'Modèles de mails', phase: 1 },
  { chemin: 'ocr', libelle: 'OCR', phase: 1 },
  { chemin: 'sauvegardes', libelle: 'Sauvegardes', phase: 1 },
  { chemin: 'journal', libelle: 'Journal d’audit', phase: 1 },
];

export function PageParametres() {
  return (
    <div className="animate-apparition">
      <EnTetePage titre="Paramètres" description="Comptes, référentiels et réglages de l’application." />
      <nav aria-label="Rubriques des paramètres" className="-mx-1 mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-trait px-1">
        {ONGLETS.map((o) => (
          <NavLink
            key={o.chemin}
            // Chemin absolu : un chemin relatif se résoudrait depuis l'onglet
            // courant (/parametres/utilisateurs/referentiels).
            to={`/parametres/${o.chemin}`}
            className={({ isActive }) =>
              cx('-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors', isActive ? 'border-cyan text-cyan-texte' : 'border-transparent text-encre-2 hover:text-encre')
            }
          >
            {o.libelle}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="utilisateurs" replace />} />
        <Route path="utilisateurs" element={<Utilisateurs />} />
        <Route path="courriel" element={<ParametresCourriel />} />
        <Route path="modeles" element={<ParametresModeles />} />
        <Route path="journal" element={<ParametresJournal />} />
        <Route path="ocr" element={<ParametresOcr />} />
        <Route path="referentiels" element={<ParametresReferentiels />} />
        <Route path="sauvegardes" element={<ParametresSauvegardes />} />
        {ONGLETS.filter((o) => o.phase > 1).map((o) => (
          <Route
            key={o.chemin}
            path={o.chemin}
            element={
              <Carte>
                <EtatVide illustration="chantier" titre={o.libelle}>
                  Cette rubrique sera construite à la phase {o.phase}.
                </EtatVide>
              </Carte>
            }
          />
        ))}
      </Routes>
    </div>
  );
}

const CLE_UTILISATEURS = ['utilisateurs'];
const plat = (t) => t.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();

function Utilisateurs() {
  const { utilisateur: moi } = useSession();
  const client = useQueryClient();
  const { notifier } = useToasts();
  const [filtre, setFiltre] = useState('');
  const [inviter, setInviter] = useState(false);

  const liste = useQuery({ queryKey: CLE_UTILISATEURS, queryFn: () => api('/api/utilisateurs') });

  const modifier = useMutation({
    mutationFn: ({ id, ...changes }) => api(`/api/utilisateurs/${id}`, { methode: 'PATCH', corps: changes }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: CLE_UTILISATEURS });
      notifier({ titre: 'Compte mis à jour', ton: 'ok' });
    },
    onError: (e) => notifier({ titre: 'Modification refusée', message: e.message, ton: 'alerte' }),
  });

  const renvoyer = useMutation({
    mutationFn: (id) => api(`/api/utilisateurs/${id}/invitation`, { methode: 'POST' }),
    onSuccess: (r) => notifier(r.emailEnvoye ? { titre: 'Invitation renvoyée', ton: 'ok' } : { titre: 'E-mail non envoyé', message: 'Vérifiez que Mailpit est démarré.', ton: 'attente' }),
    onError: (e) => notifier({ titre: 'Envoi impossible', message: e.message, ton: 'alerte' }),
  });

  const visibles = useMemo(
    () => (liste.data ?? []).filter((u) => plat(`${u.nom} ${u.email} ${u.roleNom}`).includes(plat(filtre.trim()))),
    [liste.data, filtre],
  );

  return (
    <Carte>
      <div className="flex flex-wrap items-center gap-3 border-b border-trait p-4">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-3" aria-hidden />
          <input
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            placeholder="Filtrer par nom, e-mail, rôle…"
            aria-label="Filtrer les utilisateurs"
            className="h-10 w-full rounded-[10px] border border-trait bg-surface-2 pr-3 pl-9 text-sm focus:border-cyan focus:outline-none"
          />
        </div>
        <Bouton icone={UserPlus} className="ml-auto" onClick={() => setInviter(true)}>
          Inviter un utilisateur
        </Bouton>
      </div>

      {liste.isPending ? (
        <div className="p-5">
          <SqueletteLignes lignes={4} />
        </div>
      ) : liste.isError ? (
        <div className="p-5">
          <Alerte ton="alerte">{liste.error.message}</Alerte>
        </div>
      ) : visibles.length === 0 ? (
        <EtatVide titre="Aucun utilisateur trouvé">Modifiez le filtre, ou invitez une nouvelle personne.</EtatVide>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Utilisateurs de l’application</caption>
            <thead>
              <tr className="border-b border-trait text-left text-[13px] tracking-wide text-encre-3 uppercase">
                <th scope="col" className="px-5 py-3 font-semibold">Utilisateur</th>
                <th scope="col" className="px-3 py-3 font-semibold">Rôle</th>
                <th scope="col" className="px-3 py-3 font-semibold">État</th>
                <th scope="col" className="px-3 py-3 font-semibold">Dernière connexion</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((u) => {
                const soiMeme = u.id === moi.id;
                return (
                  <tr key={u.id} className="border-b border-trait last:border-0 hover:bg-surface-2">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar utilisateur={u} taille="petit" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold">
                            {u.nom} {soiMeme && <span className="font-normal text-encre-3">(vous)</span>}
                          </p>
                          <p className="truncate text-[13px] text-encre-3">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={u.role}
                        disabled={soiMeme || modifier.isPending}
                        onChange={(e) => modifier.mutate({ id: u.id, role: e.target.value })}
                        aria-label={`Rôle de ${u.nom}`}
                        className="h-9 rounded-lg border border-trait bg-surface px-2 text-sm disabled:opacity-60"
                      >
                        {ROLES.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.nom}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {!u.actif ? <Badge ton="alerte">Désactivé</Badge> : u.invitationEnAttente ? <Badge ton="attente">Invitation envoyée</Badge> : <Badge ton="ok">Actif</Badge>}
                        {u.deuxFacteurs && <Badge ton="cyan">2FA</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-encre-2">{u.invitationEnAttente ? '—' : depuis(u.derniereConnexion)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {u.invitationEnAttente && u.actif && (
                          <Bouton variante="fantome" taille="petit" icone={MailPlus} onClick={() => renvoyer.mutate(u.id)}>
                            Renvoyer
                          </Bouton>
                        )}
                        {!soiMeme && (
                          <Bouton variante="secondaire" taille="petit" onClick={() => modifier.mutate({ id: u.id, actif: !u.actif })}>
                            {u.actif ? 'Désactiver' : 'Réactiver'}
                          </Bouton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ModaleInvitation ouverte={inviter} surChangement={setInviter} />
    </Carte>
  );
}

function ModaleInvitation({ ouverte, surChangement }) {
  const client = useQueryClient();
  const { notifier } = useToasts();
  const vide = { nom: '', email: '', role: 'lecteur' };
  const f = useFormulaire(vide);

  const envoyer = f.soumettre(schemaInvitation, async (donnees) => {
    const r = await api('/api/utilisateurs', { methode: 'POST', corps: donnees });
    client.invalidateQueries({ queryKey: CLE_UTILISATEURS });
    surChangement(false);
    f.setValeurs(vide);
    notifier(
      r.emailEnvoye
        ? { titre: 'Invitation envoyée', message: `${r.utilisateur.email} va recevoir un lien pour choisir son mot de passe.`, ton: 'ok' }
        : { titre: 'Compte créé, e-mail non envoyé', message: 'Vérifiez que Mailpit est démarré, puis cliquez sur « Renvoyer ».', ton: 'attente' },
    );
  });

  const roleChoisi = ROLES.find((r) => r.code === f.valeurs.role);

  return (
    <Modale ouverte={ouverte} surChangement={surChangement} titre="Inviter un utilisateur" description="La personne reçoit un e-mail pour choisir son mot de passe (lien valable 7 jours).">
      <form onSubmit={envoyer} noValidate className="grid gap-4">
        {f.erreurGenerale && <Alerte ton="alerte">{f.erreurGenerale}</Alerte>}
        <Champ libelle="Nom complet" autoFocus autoComplete="off" {...f.champ('nom')} />
        <Champ libelle="Adresse e-mail" type="email" autoComplete="off" {...f.champ('email')} />
        <Selection libelle="Rôle" aide={roleChoisi?.description} {...f.champ('role')}>
          {ROLES.map((r) => (
            <option key={r.code} value={r.code}>
              {r.nom}
            </option>
          ))}
        </Selection>
        <div className="mt-2 flex justify-end gap-2">
          <Bouton variante="fantome" onClick={() => surChangement(false)}>
            Annuler
          </Bouton>
          <Bouton type="submit" icone={MailPlus} chargement={f.envoi} libelleChargement="Envoi…">
            Envoyer l’invitation
          </Bouton>
        </div>
      </form>
    </Modale>
  );
}
