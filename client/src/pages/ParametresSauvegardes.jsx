/**
 * Les sauvegardes du fonds (§13).
 *
 * Une sauvegarde qui ne contient que la base ne sert à rien : les documents
 * vivent dans le stockage, pas dans la base. Chaque entrée dit donc les deux —
 * ce que pèse le dump et combien de fichiers l'accompagnent.
 *
 * Le worker en fait une chaque dimanche à 2 h, mais seulement s'il tourne à
 * ce moment-là. Sur un poste éteint le week-end, elle ne part jamais : d'où
 * le bouton, et l'avertissement quand la dernière date d'un moment.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, HardDriveDownload, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { dateHeure } from '../format.js';
import { Bouton } from '../ui/Bouton.jsx';
import { Alerte, Badge, Carte, EtatVide, SqueletteLignes } from '../ui/Elements.jsx';
import { useToasts } from '../ui/Toasts.jsx';

/** Au-delà, la dernière sauvegarde est trop vieille pour rassurer. */
const JOURS_ALERTE = 7;

const mo = (octets) => `${((octets ?? 0) / 1024 / 1024).toFixed(1)} Mo`;

export function ParametresSauvegardes() {
  const file = useQueryClient();
  const { notifier } = useToasts();

  const etat = useQuery({ queryKey: ['sauvegardes'], queryFn: () => api('/api/sauvegardes') });

  const lancer = useMutation({
    mutationFn: () => api('/api/sauvegardes', { methode: 'POST' }),
    onSuccess: (b) => {
      file.invalidateQueries({ queryKey: ['sauvegardes'] });
      notifier({
        titre: 'Sauvegarde terminée',
        message: `${b.documents} documents · ${b.fichiers} fichiers (${mo(b.octets)})`,
        ton: 'ok',
      });
    },
    onError: (e) => notifier({ titre: 'Sauvegarde impossible', message: e.message, ton: 'alerte' }),
  });

  if (etat.isPending) {
    return (
      <Carte className="p-5">
        <SqueletteLignes lignes={4} />
      </Carte>
    );
  }
  if (etat.isError) return <Alerte ton="alerte">{etat.error.message}</Alerte>;

  const { racine, sauvegardes } = etat.data;
  const derniere = sauvegardes.find((s) => s.complete && s.date);
  const jours = derniere ? Math.floor((Date.now() - new Date(derniere.date).getTime()) / 86_400_000) : null;

  return (
    <div className="grid gap-5">
      <Carte className="p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Archive className="size-5 text-encre-3" aria-hidden />
          <h2 className="font-titre flex-1 text-lg font-semibold">Sauvegarder maintenant</h2>
          <Bouton
            icone={HardDriveDownload}
            chargement={lancer.isPending}
            libelleChargement="Sauvegarde en cours…"
            onClick={() => lancer.mutate()}
          >
            Lancer une sauvegarde
          </Bouton>
        </div>

        <p className="text-sm text-encre-2">
          La base <strong>et</strong> les fichiers, dans un même dossier daté. Les quatre dernières sont conservées ; au-delà,
          la plus ancienne part.
        </p>
        <p className="mt-2 text-[12.5px] break-all text-encre-3">{racine}</p>

        {/* Le même disque que l'original ne protège pas d'une panne : c'est
            le genre de chose qu'on découvre trop tard. */}
        <Alerte ton="info" className="mt-4" titre="Copiez-les ailleurs">
          Ces sauvegardes vivent sur le même disque que le fonds. Contre une suppression accidentelle, elles suffisent ;
          contre une panne ou un vol, non. Pour un disque externe :{' '}
          <code className="chiffres">npm run sauvegarder -w serveur -- --vers "D:\sauvegardes"</code>
        </Alerte>
      </Carte>

      {jours !== null && jours > JOURS_ALERTE && (
        <Alerte ton="attente" titre="La dernière sauvegarde date">
          Elle remonte à {jours} jours. Le worker en lance une chaque dimanche à 2 h, mais seulement s’il tourne à ce
          moment-là.
        </Alerte>
      )}

      <Carte className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-trait p-5">
          <h2 className="font-titre flex-1 text-lg font-semibold">Sauvegardes présentes</h2>
          <Badge ton="cyan">{sauvegardes.length}</Badge>
        </div>

        {sauvegardes.length === 0 ? (
          <EtatVide titre="Aucune sauvegarde">
            Lancez-en une : c’est le seul filet si le disque lâche ou si une suppression tourne mal.
          </EtatVide>
        ) : (
          <ul className="divide-y divide-trait">
            {sauvegardes.map((s) => (
              <li key={s.nom} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="chiffres truncate text-[13.5px] font-medium">{s.nom}</p>
                  {s.complete ? (
                    <p className="mt-0.5 text-[12.5px] text-encre-3">
                      {dateHeure(s.date)} · {s.documents} documents · {s.marches} marchés · {s.fichiers} fichiers
                    </p>
                  ) : (
                    <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-attente">
                      <TriangleAlert className="size-3.5" aria-hidden />
                      Incomplète : le fichier de contrôle manque, la copie a dû être interrompue.
                    </p>
                  )}
                </div>
                {s.complete && (
                  <span className="chiffres text-[13px] text-encre-2">{mo((s.octets ?? 0) + (s.octetsSql ?? 0))}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte className="p-5">
        <h2 className="font-titre mb-2 text-lg font-semibold">Restaurer</h2>
        <p className="text-sm text-encre-2">
          La restauration écrase la base et le stockage : elle ne se fait pas d’un clic depuis un écran, mais à la main,
          en sachant ce qu’on remplace.
        </p>
        <p className="mt-3 text-[13px]">
          <code className="chiffres">npm run restaurer -w serveur -- "chemin\vers\la\sauvegarde"</code>
        </p>
      </Carte>
    </div>
  );
}
