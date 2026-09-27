/**
 * V40.0 — Piccole regole di scrittura dei numeri, in un solo posto.
 * "1 pagine" e "0.5h" erano sparsi per l'interfaccia perché ogni
 * componente componeva le sue stringhe a mano.
 */
import { formatHoursMinutes } from './dateUtils.js';

/** "1 pagina", "12 pagine". */
export function pagineLabel(n) {
  const v = Math.round(Number(n) || 0);
  return `${v} ${v === 1 ? 'pagina' : 'pagine'}`;
}

/** Singolare / plurale per un conteggio intero. */
export function plurale(n, singolare, plurale_) {
  const v = Math.round(Number(n) || 0);
  return `${v} ${v === 1 ? singolare : plurale_}`;
}

/** Ore decimali in "2h 30m" / "30m" (mai "0.5h"). */
export function oreLabel(ore) {
  const v = Number(ore) || 0;
  if (v <= 0) return '0m';
  return formatHoursMinutes(v);
}

/* ------------------------------------------------------------------ *
 * V41 — Numeri all'italiana, in un solo posto.
 * Prima l'interfaccia mostrava "29525" minuti, "97.6/110" e "26.61":
 * separatore delle migliaia assente e punto al posto della virgola.
 * Intl è disponibile ovunque l'app gira (browser moderni e Node dei test).
 * ------------------------------------------------------------------ */
// `useGrouping: 'always'`: il separatore delle migliaia anche a 4 cifre
// ("1.830 / 25.000 XP", mai "1830 / 25.000"). Le versioni recenti dei dati
// di localizzazione italiani lo tolgono sotto le 5 cifre, e browser diversi
// avrebbero scritto lo stesso numero in due modi. I motori più vecchi che
// non conoscono 'always' lo leggono come `true`: comportamento standard.
const GROUPING = { useGrouping: 'always' };
const INT_FORMAT = new Intl.NumberFormat('it-IT', { ...GROUPING, maximumFractionDigits: 0 });
const DECIMAL_FORMATS = new Map();

function decimalFormat(digits) {
  if (!DECIMAL_FORMATS.has(digits)) {
    DECIMAL_FORMATS.set(
      digits,
      new Intl.NumberFormat('it-IT', { ...GROUPING, minimumFractionDigits: digits, maximumFractionDigits: digits })
    );
  }
  return DECIMAL_FORMATS.get(digits);
}

/** 29525 -> "29.525". Valori non numerici -> "0". */
export function formatInt(n) {
  const v = Number(n);
  return INT_FORMAT.format(Number.isFinite(v) ? Math.round(v) : 0);
}

/** 26.614 -> "26,61" (cifre decimali fisse). */
export function formatDecimal(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return decimalFormat(digits).format(v);
}

const COMPACT_FORMATS = new Map();

function compactFormat(digits) {
  if (!COMPACT_FORMATS.has(digits)) {
    COMPACT_FORMATS.set(digits, new Intl.NumberFormat('it-IT', { ...GROUPING, minimumFractionDigits: 0, maximumFractionDigits: digits }));
  }
  return COMPACT_FORMATS.get(digits);
}

/** 26.6 -> "26,6"; 27 -> "27"; 26.60 con 2 cifre -> "26,6" (decimali solo se servono, al massimo `digits`). */
export function formatNumber(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const factor = 10 ** digits;
  const rounded = Math.round(v * factor) / factor;
  // Mai "-0": un valore che arrotonda a zero è zero.
  if (rounded === 0) return '0';
  return compactFormat(digits).format(rounded);
}

/** +1106 -> "+1.106"; -50 -> "−50" (segno sempre esplicito). */
export function formatSigned(n) {
  const v = Math.round(Number(n) || 0);
  if (v > 0) return `+${INT_FORMAT.format(v)}`;
  if (v < 0) return `−${INT_FORMAT.format(Math.abs(v))}`;
  return '0';
}

/** Minuti in "2h 30m" / "45m" (mai "150 min" o decimali). */
export function minutiLabel(minuti) {
  const v = Math.max(0, Math.round(Number(minuti) || 0));
  if (v === 0) return '0m';
  return formatHoursMinutes(v / 60);
}
