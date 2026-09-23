/**
 * Le thème (clair, sombre ou système), mémorisé dans le navigateur.
 * Voir aussi public/theme.js, qui l'applique avant le premier affichage.
 */
import { useCallback, useEffect, useState } from 'react';

const CLE = 'icity.theme';

function lire() {
  try {
    return localStorage.getItem(CLE) || 'systeme';
  } catch {
    return 'systeme';
  }
}

function appliquer(choix) {
  const sombre = choix === 'sombre' || (choix === 'systeme' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = sombre ? 'dark' : 'light';
}

export function useTheme() {
  const [choix, setChoix] = useState(lire);

  useEffect(() => {
    appliquer(choix);
    if (choix !== 'systeme') return;
    // En mode « système », on suit Windows s'il change pendant la session.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const suivre = () => appliquer('systeme');
    media.addEventListener('change', suivre);
    return () => media.removeEventListener('change', suivre);
  }, [choix]);

  const definir = useCallback((nouveau) => {
    try {
      localStorage.setItem(CLE, nouveau);
    } catch {
      /* confort seulement */
    }
    setChoix(nouveau);
  }, []);

  return [choix, definir];
}
