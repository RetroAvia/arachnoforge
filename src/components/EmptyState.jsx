import React, { memo } from 'react';

/**
 * EmptyState — schermate "vuote" curate: niente più liste spoglie con un
 * unico paragrafo grigio. Ogni variante porta un'illustrazione SVG
 * dedicata, coerente con la palette Rosso Cremisi / Blu Elettrico del
 * resto dell'app, invece dell'ennesima icona lineare generica.
 */
function EmptyState({ variant = 'safe', title, subtitle, action = null, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-3 ${compact ? 'py-8 px-4' : 'py-14 px-6'}`}>
      <div className={compact ? 'w-20 h-20' : 'w-28 h-28'}>
        {variant === 'safe' && <SafeCityIllustration />}
        {variant === 'radar' && <RadarScanIllustration />}
        {variant === 'tree' && <EmptyTreeIllustration />}
        {variant === 'log' && <EmptyLogIllustration />}
      </div>
      <div className="space-y-1.5 max-w-sm">
        <p className={`font-semibold text-af-text ${compact ? 'text-base' : 'text-lg'}`}>{title}</p>
        {subtitle && <p className="text-base text-af-text-secondary leading-relaxed">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** "La città è sicura" — skyline notturno quieto, web-shooter a riposo. */
function SafeCityIllustration() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      <defs>
        <radialGradient id="afSafeGlow" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="rgb(var(--af-refuel-rgb) / 0.35)" />
          <stop offset="100%" stopColor="rgb(var(--af-refuel-rgb) / 0)" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="55" r="50" fill="url(#afSafeGlow)" />
      <g stroke="rgb(var(--af-refuel-rgb) / 0.55)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="28" y="55" width="14" height="35" />
        <rect x="47" y="38" width="14" height="52" />
        <rect x="66" y="60" width="14" height="30" />
        <rect x="85" y="46" width="12" height="44" />
      </g>
      <g stroke="rgb(var(--af-attack-rgb) / 0.9)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M60 16v11M60 16l-6 6M60 16l6 6" />
        <circle cx="60" cy="33" r="4" fill="rgb(var(--af-attack-rgb) / 0.9)" stroke="none" />
      </g>
      <path d="M18 95h84" stroke="rgb(var(--af-border))" strokeWidth="2" />
    </svg>
  );
}

/** Nessun ripasso scaduto: radar Spider-Sense che scandisce, quieto. */
function RadarScanIllustration() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full af-radar-ring">
      <circle cx="60" cy="60" r="46" fill="none" stroke="rgb(var(--af-refuel-rgb) / 0.25)" strokeWidth="2" />
      <circle cx="60" cy="60" r="30" fill="none" stroke="rgb(var(--af-refuel-rgb) / 0.25)" strokeWidth="2" />
      <circle cx="60" cy="60" r="14" fill="none" stroke="rgb(var(--af-refuel-rgb) / 0.25)" strokeWidth="2" />
      <line x1="60" y1="14" x2="60" y2="106" stroke="rgb(var(--af-refuel-rgb) / 0.15)" strokeWidth="1.5" />
      <line x1="14" y1="60" x2="106" y2="60" stroke="rgb(var(--af-refuel-rgb) / 0.15)" strokeWidth="1.5" />
      <path d="M60 60 L60 14 A46 46 0 0 1 96 34 Z" fill="rgb(var(--af-refuel-rgb) / 0.22)" />
      <circle cx="60" cy="60" r="3.5" fill="rgb(var(--af-refuel-rgb))" />
    </svg>
  );
}

/** Nessun nodo nello Skill Tree: schema ad albero tratteggiato, ancora da tracciare. */
function EmptyTreeIllustration() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      <circle cx="60" cy="28" r="10" fill="none" stroke="rgb(var(--af-attack-rgb) / 0.7)" strokeWidth="2.5" strokeDasharray="4 3" />
      <path d="M60 38v14" stroke="rgb(var(--af-border))" strokeWidth="2" />
      <path d="M36 52h48" stroke="rgb(var(--af-border))" strokeWidth="2" />
      <path d="M36 52v10M84 52v10M60 52v10" stroke="rgb(var(--af-border))" strokeWidth="2" />
      <circle cx="36" cy="70" r="8" fill="none" stroke="rgb(var(--af-refuel-rgb) / 0.5)" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="60" cy="70" r="8" fill="none" stroke="rgb(var(--af-refuel-rgb) / 0.5)" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="84" cy="70" r="8" fill="none" stroke="rgb(var(--af-refuel-rgb) / 0.5)" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}

/** Nessuna voce nel log: pagina bianca in attesa della prima riga. */
function EmptyLogIllustration() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      <rect x="26" y="18" width="68" height="86" rx="6" fill="none" stroke="rgb(var(--af-border))" strokeWidth="2.5" />
      <line x1="38" y1="38" x2="82" y2="38" stroke="rgb(var(--af-refuel-rgb) / 0.4)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="38" y1="53" x2="82" y2="53" stroke="rgb(var(--af-refuel-rgb) / 0.25)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="38" y1="68" x2="66" y2="68" stroke="rgb(var(--af-refuel-rgb) / 0.25)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export default memo(EmptyState);
