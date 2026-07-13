/**
 * ArachnoForge Design System — "Iron-Spider HUD / Stark Tech".
 *
 * Ricette Tailwind CANONICHE, centralizzate in un solo posto per evitare
 * duplicazione (e drift) delle stesse, lunghissime, stringhe di utility
 * ripetute in ogni pagina. Ogni valore qui sotto è ESATTAMENTE la classe
 * richiesta dal nuovo Design System — nessuna astrazione via @apply,
 * nessuna classe custom che nasconda le utility: quello che viene
 * importato è quello che finisce, lettera per lettera, nell'attributo
 * `className` renderizzato nel DOM.
 *
 * Bandito ovunque: sfondi piatti (`bg-black`, `bg-slate-900`), bordi
 * semplici a singolo colore, <select>/<input> con stile nativo.
 *
 * V16.0 — True Theme Engine (Pillar 3): NESSUN hex statico da qui in
 * avanti. Ogni colore "di ruolo" (attacco/primario, refuel/secondario,
 * decay/accento, superficie) passa dai token dinamici `primary` /
 * `secondary` / `accent` / `surface` definiti in tailwind.config.js, a
 * loro volta legati alle CSS custom properties `--af-*-rgb` di
 * index.css, reattive all'attributo `[data-theme]` su <body>. Cambiare
 * costume (Classic / Symbiote / 2099) ritinteggia quindi OGNI card,
 * pulsante, hover, ombra e bordo dell'app, istantaneamente. I soli
 * colori rimasti "fissi" sono quelli puramente semantici e universali
 * (emerald per il successo/positivo), che non fanno parte dell'identità
 * del costume e restano leggibili in ogni tema.
 */

/** Sfondo globale App — nebulosa radiale Stark Tech reattiva al costume, mai un nero piatto. */
export const APP_BG =
  'bg-surface bg-[radial-gradient(ellipse_at_top,rgb(var(--af-attack-rgb)/0.10),transparent_45%),radial-gradient(ellipse_at_bottom,rgb(var(--af-refuel-rgb)/0.08),transparent_45%)] text-slate-200';

/** Card/Contenitore standard — vetro tecnologico profondo, bordo Secondario al 20%, ombra a doppio strato. */
export const CARD =
  'bg-surface/70 backdrop-blur-2xl border border-secondary/20 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-4 sm:p-6 relative overflow-hidden';

/** Variante senza padding, per contenitori che gestiscono da soli lo spazio interno (header + body separati). */
export const CARD_NOPAD =
  'bg-surface/70 backdrop-blur-2xl border border-secondary/20 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] relative overflow-hidden';

/** Variante con bordo Primario (stati critici / attenzione / Enrage / Goblin Protocol). */
export const CARD_ALERT =
  'bg-surface/70 backdrop-blur-2xl border border-primary/35 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-4 sm:p-6 relative overflow-hidden';

/** Pulsante Primario — "Spider-Strike": gradiente Primario a due toni, glow acceso, lift on hover. */
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-primary-dark text-white font-bold tracking-widest uppercase text-sm px-6 py-3 rounded-xl shadow-primary-glow hover:shadow-primary-glow-lg hover:-translate-y-1 active:translate-y-0 transition-all duration-300 border-t border-white/20 disabled:opacity-40 disabled:pointer-events-none disabled:hover:translate-y-0 disabled:hover:shadow-primary-glow';

/** Pulsante Secondario — "Tech-Blue": stessa logica del primario, gradiente Secondario a due toni. */
export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-2 bg-gradient-to-r from-secondary to-secondary-dark text-white font-bold tracking-widest uppercase text-sm px-6 py-3 rounded-xl shadow-secondary-glow hover:shadow-secondary-glow-lg hover:-translate-y-1 active:translate-y-0 transition-all duration-300 border-t border-white/20 disabled:opacity-40 disabled:pointer-events-none disabled:hover:translate-y-0 disabled:hover:shadow-secondary-glow';

/** Pulsante di Successo — stessa grammatica (gradiente + glow + uppercase), tinta Smeraldo semantica e universale (esito positivo, non legata al costume). */
export const BTN_SUCCESS =
  'inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-700 text-white font-bold tracking-widest uppercase text-sm px-6 py-3 rounded-xl shadow-[0_0_15px_rgba(52,211,153,0.4)] hover:shadow-[0_0_25px_rgba(52,211,153,0.7)] hover:-translate-y-1 active:translate-y-0 transition-all duration-300 border-t border-white/20 disabled:opacity-40 disabled:pointer-events-none';

/** Pulsante d'Ambra — stessa grammatica, tinta Accento/Decay (reattiva al costume) per azioni di recupero/warning positivo. */
export const BTN_AMBER =
  'inline-flex items-center justify-center gap-2 bg-gradient-to-r from-accent to-accent/70 text-black font-bold tracking-widest uppercase text-sm px-6 py-3 rounded-xl shadow-accent-glow hover:shadow-accent-glow-lg hover:-translate-y-1 active:translate-y-0 transition-all duration-300 border-t border-white/30 disabled:opacity-40 disabled:pointer-events-none';

/** Pulsante Ghost — per azioni terziarie (Annulla, Chiudi): vetro tecnologico, mai un bordo piatto. */
export const BTN_GHOST =
  'inline-flex items-center justify-center gap-2 bg-white/[0.03] backdrop-blur-md border border-white/10 text-slate-300 font-semibold tracking-wide text-sm px-5 py-2.5 rounded-xl hover:bg-white/[0.07] hover:border-secondary/40 hover:text-white transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none';

/** Form Inputs & custom Select trigger — nessuno stile nativo, mai. */
export const INPUT =
  'w-full bg-surface/80 border border-secondary/30 rounded-xl px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors appearance-none';

/** Titolo di pagina — grande, pulito, sfumato bianco -> grigio (neutro, non legato al costume). */
export const H1 = 'text-3xl md:text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-500 tracking-tight';

/** Sottotitolo di sezione — stessa grammatica dell'H1, scala ridotta. */
export const H2 = 'text-xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 tracking-tight';

/** Badge/Pillola generica — stessa "recipe" richiesta per i badge CFU/status, disponibile in 4 tinte semantiche + reattive al costume. */
export const BADGE = {
  blue: 'inline-flex items-center gap-1 bg-secondary/15 text-secondary rounded-full px-3 py-1 text-xs font-mono',
  red: 'inline-flex items-center gap-1 bg-primary/15 text-primary rounded-full px-3 py-1 text-xs font-mono',
  green: 'inline-flex items-center gap-1 bg-emerald-900/50 text-emerald-300 rounded-full px-3 py-1 text-xs font-mono',
  amber: 'inline-flex items-center gap-1 bg-accent/15 text-accent rounded-full px-3 py-1 text-xs font-mono',
  slate: 'inline-flex items-center gap-1 bg-slate-800/60 text-slate-300 rounded-full px-3 py-1 text-xs font-mono'
};

/** Glow radiale dietro un nodo/riquadro completato — mai un box piatto, sempre un bagliore atmosferico. */
export const RADIAL_GLOW = {
  green: 'absolute -inset-3 rounded-full bg-emerald-500/25 blur-2xl pointer-events-none',
  blue: 'absolute -inset-3 rounded-full bg-secondary/25 blur-2xl pointer-events-none',
  red: 'absolute -inset-3 rounded-full bg-primary/25 blur-2xl pointer-events-none',
  amber: 'absolute -inset-3 rounded-full bg-accent/25 blur-2xl pointer-events-none'
};
