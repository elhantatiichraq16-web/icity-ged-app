/**
 * Le logo i·city, tracé en SVG (repris du portail de connexion actuel).
 * `couleur` : 'currentColor' par défaut, pour suivre la couleur du texte.
 */
export function Logo({ className, couleur = 'currentColor' }) {
  return (
    <svg viewBox="0 0 132 56" className={className} role="img" aria-label="iCity">
      <g fill="none" stroke={couleur} strokeLinecap="round">
        <path d="M72.5 12.5a7.5 7.5 0 0 1 11 0" strokeWidth="2.6" />
        <path d="M76.2 17.4a2.8 2.8 0 0 1 4.1 0" strokeWidth="2.6" />
      </g>
      <circle cx="78.2" cy="21.8" r="1.9" fill={couleur} />
      <circle cx="8.5" cy="18.5" r="4.4" fill={couleur} />
      <rect x="4.1" y="25.5" width="8.8" height="23" rx="4.4" fill={couleur} />
      <circle cx="21.5" cy="37.5" r="4" fill={couleur} />
      <path d="M48.5 31.2a9.6 9.6 0 1 0 0 13.4" fill="none" stroke={couleur} strokeWidth="8.6" strokeLinecap="round" />
      <circle cx="58.5" cy="22.4" r="4.2" fill={couleur} />
      <rect x="54.3" y="29.2" width="8.4" height="19.3" rx="4.2" fill={couleur} />
      <path d="M78.2 26.5v15.2a6.6 6.6 0 0 0 6.6 6.6" fill="none" stroke={couleur} strokeWidth="8" strokeLinecap="round" />
      <path d="M70.5 30.6h13" stroke={couleur} strokeWidth="6.4" strokeLinecap="round" />
      <path d="M95 29.5v7.8a7.6 7.6 0 0 0 15.2 0v-7.8" fill="none" stroke={couleur} strokeWidth="8.4" strokeLinecap="round" />
      <path d="M110.2 37.3v8.2a9.4 9.4 0 0 1-9.4 9.4" fill="none" stroke={couleur} strokeWidth="8.4" strokeLinecap="round" />
    </svg>
  );
}

/** Le pictogramme carré (favicon), pour la barre latérale repliée. */
export function Pictogramme({ className }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect width="40" height="40" rx="10" fill="var(--cyan)" />
      <g fill="#fff">
        <circle cx="15" cy="11" r="3.4" />
        <rect x="11.6" y="16.5" width="6.8" height="15" rx="3.4" />
        <circle cx="26" cy="28" r="3.2" />
      </g>
    </svg>
  );
}
