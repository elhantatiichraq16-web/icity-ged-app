/**
 * Un petit outil pour les formulaires : valeurs, erreurs par champ, envoi.
 *
 * La validation se fait d'abord ici avec le même schéma Zod que le serveur
 * (commun/schemas.js) : l'erreur s'affiche sous le champ sans aller-retour.
 * Si le serveur refuse quand même, ses messages prennent la même place.
 */
import { useState } from 'react';
import { erreursParChamp } from '@icity/commun/schemas';
import { ErreurApi } from './api.js';

export function useFormulaire(valeursInitiales) {
  const [valeurs, setValeurs] = useState(valeursInitiales);
  const [erreurs, setErreurs] = useState({});
  const [erreurGenerale, setErreurGenerale] = useState('');
  const [envoi, setEnvoi] = useState(false);

  /** Les propriétés à poser sur un champ : valeur, changement, erreur. */
  function champ(nom, { type } = {}) {
    const estCase = type === 'checkbox';
    return {
      name: nom,
      ...(estCase ? { checked: Boolean(valeurs[nom]) } : { value: valeurs[nom] ?? '' }),
      erreur: erreurs[nom],
      onChange: (e) => {
        const v = estCase ? e.target.checked : e.target.value;
        setValeurs((prec) => ({ ...prec, [nom]: v }));
        // Dès que la saisie reprend, l'erreur n'a plus lieu d'être.
        if (erreurs[nom]) setErreurs(({ [nom]: _, ...reste }) => reste);
        if (erreurGenerale) setErreurGenerale('');
      },
    };
  }

  /**
   * Valide puis appelle `action(donnees)`.
   * @param {import('zod').ZodType | null} schema
   * @param {(donnees: any) => Promise<void>} action
   */
  function soumettre(schema, action) {
    return async (e) => {
      e?.preventDefault();
      setErreurGenerale('');
      let donnees = valeurs;
      if (schema) {
        const r = schema.safeParse(valeurs);
        if (!r.success) {
          setErreurs(erreursParChamp(r.error));
          focaliserPremiereErreur(e?.target);
          return;
        }
        donnees = r.data;
      }
      setErreurs({});
      setEnvoi(true);
      try {
        await action(donnees);
      } catch (erreur) {
        if (erreur instanceof ErreurApi && Object.keys(erreur.erreurs).length) {
          setErreurs(erreur.erreurs);
          focaliserPremiereErreur(e?.target);
        } else {
          setErreurGenerale(erreur.message || 'Une erreur est survenue.');
        }
      } finally {
        setEnvoi(false);
      }
    };
  }

  return { valeurs, setValeurs, erreurs, erreurGenerale, setErreurGenerale, envoi, champ, soumettre };
}

/** Place le curseur sur le premier champ en erreur (utile au clavier). */
function focaliserPremiereErreur(formulaire) {
  requestAnimationFrame(() => formulaire?.querySelector?.('[aria-invalid="true"]')?.focus());
}
