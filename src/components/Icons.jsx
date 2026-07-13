import React, { memo } from 'react';

/**
 * Set di icone SVG inline, purissime (nessuna libreria esterna).
 * Ogni icona eredita `currentColor` e anima stroke/scale on hover
 * tramite le classi del contenitore (transition-all duration-300).
 */
const PATHS = {
  radar: ['M12 2a10 10 0 1 0 10 10', 'M12 2v10l7 4', 'M12 6a6 6 0 1 1-6 6'],
  grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  crosshair: ['M12 2v4', 'M12 18v4', 'M2 12h4', 'M18 12h4', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'],
  chartBar: ['M4 20V10', 'M11 20V4', 'M18 20v-7'],
  shield: ['M12 2 4 6v6c0 5 3.8 9.5 8 10 4.2-.5 8-5 8-10V6l-8-4Z'],
  gear: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M19.4 13a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 17.4a1.7 1.7 0 0 0-1 1.55V19a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 17.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 13a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 2.6a1.7 1.7 0 0 0 1-1.55V1a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 2.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 7a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z'
  ],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  play: ['M6 4l14 8-14 8V4Z'],
  pause: ['M7 4h4v16H7z', 'M13 4h4v16h-4z'],
  stop: ['M5 5h14v14H5z'],
  bolt: ['M13 2 3 14h7l-1 8 11-14h-7l1-6Z'],
  flame: ['M12 2c1 4-3 5-3 9a5 5 0 0 0 10 0c0-2-1-3-1-3s0 2-2 2c-2 0-1.5-2-1.5-4C14.5 3 12 2 12 2Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  check: ['M4 12l6 6L20 6'],
  alertTriangle: ['M12 3 2 20h20L12 3Z', 'M12 10v4', 'M12 17h.01'],
  trophy: [
    'M7 4h10v4a5 5 0 0 1-10 0V4Z',
    'M7 5H4a3 3 0 0 0 3 5',
    'M17 5h3a3 3 0 0 1-3 5',
    'M10 16v3H8v2h8v-2h-2v-3'
  ],
  book: ['M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4Z', 'M4 17a3 3 0 0 1 3-3h11'],
  edit: ['M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.1l-1.9-1.9a1.5 1.5 0 0 0-2.1 0L4 16v4Z'],
  skull: [
    'M12 3a7 7 0 0 0-7 7c0 2.6 1.4 4.2 2.5 5.4.4.4.5 1 .5 1.6v2h8v-2c0-.6.1-1.2.5-1.6C17.6 14.2 19 12.6 19 10a7 7 0 0 0-7-7Z',
    'M9 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    'M15 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    'M10 17h4'
  ],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  heart: ['M12 21s-7-5-7-11a4.5 4.5 0 0 1 7-3.5A4.5 4.5 0 0 1 19 10c0 6-7 11-7 11Z'],
  drop: ['M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13Z'],
  moon: ['M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  upload: ['M12 21V9', 'M7 14l5-5 5 5', 'M5 3h14'],
  archive: ['M3 4h18v4H3z', 'M5 8v12h14V8', 'M10 12h4'],
  target: ['M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z', 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'],
  speaker: ['M4 9v6h4l5 4V5L8 9H4Z', 'M17 8a5 5 0 0 1 0 8', 'M19.5 5.5a9 9 0 0 1 0 13'],
  flag: ['M5 21V4', 'M5 4h13l-3 4 3 4H5'],
  chevronDown: ['M6 9l6 6 6-6'],
  // V17.0 — "Insomniac Overhaul": iconografia più aggressiva/tech per la
  // nuova identità Stark-Web Terminal / Web-Matrix / Karen OS.
  web: [
    'M12 2v20', 'M2 12h20', 'M4.5 4.5l15 15', 'M19.5 4.5l-15 15',
    'M12 2a10 10 0 0 1 8 16', 'M12 2a10 10 0 0 0-8 16',
    'M7 7a7 7 0 0 0 5 12 7 7 0 0 0 5-12'
  ],
  terminal: ['M3 4h18v16H3z', 'M6 9l4 3-4 3', 'M12 15h6'],
  chip: [
    'M8 3v3', 'M12 3v3', 'M16 3v3', 'M8 18v3', 'M12 18v3', 'M16 18v3',
    'M3 8h3', 'M3 12h3', 'M3 16h3', 'M18 8h3', 'M18 12h3', 'M18 16h3',
    'M7 7h10v10H7z', 'M10.5 10.5h3v3h-3z'
  ],
  newspaper: [
    'M4 4h12v16H6a2 2 0 0 1-2-2V4Z', 'M16 8h4v10a2 2 0 0 1-2 2h-2V8Z',
    'M7 7h6', 'M7 10.5h6', 'M7 14h4'
  ],
  flask: [
    'M9 2h6', 'M10 2v6.5L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8.5V2',
    'M7.5 15h9'
  ],
  satellite: [
    'M4 4l4 4-3 3-4-4Z', 'M14 12l4 4-3 3-4-4Z', 'M8 8l6 6',
    'M17 3l2 2-2 2-2-2Z', 'M2 15l3 3'
  ],
  // V18.0 — "The Multiverse Projection": portali multiversali concentrici per il Multiverse Simulator.
  multiverse: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
    'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
    'M8 3c-2 3-2 15 0 18', 'M16 3c2 3 2 15 0 18',
    'M3 8c3-2 15-2 18 0', 'M3 16c3 2 15 2 18 0'
  ],
  // V26.0 — "The Nexus Gate": iconografia per autenticazione + Cloud State Sync.
  cloud: ['M7 18a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17 9.5a3.5 3.5 0 0 1-.8 6.9', 'M7 18h9.2'],
  cloudCheck: ['M7 17a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17 8.5a3.5 3.5 0 0 1-.8 6.9', 'M7 17h9.2', 'M9.5 12.5l2 2 3.5-4'],
  cloudOff: ['M3 3l18 18', 'M9.5 6.6A5.5 5.5 0 0 1 17 9.5a3.5 3.5 0 0 1-.5 6.9H7.2', 'M6.1 8.6A4.5 4.5 0 0 0 7 17h.5'],
  lock: ['M6 11V8a6 6 0 0 1 12 0v3', 'M5 11h14v10H5z', 'M12 15v3'],
  mail: ['M4 5h16v14H4z', 'M4 6.5l8 6.5 8-6.5'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21c1.4-4.6 5-6.5 8-6.5s6.6 1.9 8 6.5'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  // V33.0 — "Aesthetic Level-Up": due icone dedicate che mancavano, prima
  // riusate da icone tematicamente vicine ma imprecise (flag/chartBar).
  calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
  trendUp: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  // V34.4 — freccia "rotate-ccw" per il bottone "Riporta a da completare"
  // (undo di un Nodo completato per errore): arco + punta di freccia,
  // stesso linguaggio stroke-only delle altre icone di questo set.
  undo: ['M4 9a9 9 0 1 1 2.6 8.4', 'M4 4v5h5']
};

function IconBase({ name, className = 'w-5 h-5', strokeWidth = 1.8 }) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-all duration-300 ${className}`}
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

// Memoizzata: renderizzata decine di volte per pagina (righe di Skill Tree,
// pillole di stato, nav della Sidebar...) e non dipende mai da props che
// cambiano rapidamente — evita di ridisegnare l'SVG ad ogni render del
// genitore quando `name`/`className`/`strokeWidth` restano identici.
export const Icon = memo(IconBase);

export default Icon;
