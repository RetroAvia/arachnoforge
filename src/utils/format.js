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
