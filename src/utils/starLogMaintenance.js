/**
 * V37.0 — Manutenzione dello Star Log.
 *
 * `state.starLog` era l'unico array dello stato senza alcun tetto:
 * `combatLog` è capped a 50, i trofei sono finiti, le materie crescono
 * lentamente — lo Star Log invece accumula una voce `FOCUS_SESSION` per
 * OGNI sessione, per sempre. A due sessioni al giorno sono ~730 voci
 * l'anno, e ogni singolo salvataggio riscrive e ritrasmette l'INTERO
 * JSON: il costo cresce in modo monotono per tutta la vita del profilo.
 *
 * La potatura è deliberatamente conservativa e asimmetrica:
 *
 *  - gli aggregati giornalieri `FOCUS_MINUTES` NON vengono MAI toccati.
 *    Sono una riga per giorno (365 l'anno, poche decine di byte l'una) e
 *    sono ciò che alimenta la Heatmap, il totale minuti e la calibrazione
 *    della capacità giornaliera. Lo storico dei TOTALI resta quindi
 *    integro per sempre;
 *  - si potano solo le voci puntuali `FOCUS_SESSION` più vecchie della
 *    finestra, e solo quando superano il tetto. Sono quelle grasse (ora,
 *    timestamp, qualità, materiaId, surgeXp) e servono alla cronologia
 *    dettagliata, che oltre un anno e mezzo nessuno consulta più;
 *  - `BOSS_WIN` / `BOSS_LOSS` restano intatte: sono rare e raccontano
 *    eventi, non routine.
 *
 * Nessun numero mostrato altrove cambia: Heatmap, minuti totali e
 * calibrazione leggono `FOCUS_MINUTES`, che resta completo.
 */
import { monthKeyFromDateKey } from './dateUtils.js';

/** Oltre questa età una sessione puntuale è archivio, non cronologia. */
export const SESSION_RETENTION_DAYS = 548; // ~18 mesi
/** Tetto duro di sicurezza, indipendente dall'età. */
export const MAX_SESSION_ENTRIES = 2000;

const DAY_MS = 86400000;

/**
 * @param {Array} starLog lo `starLog` grezzo
 * @param {number} [nowMs] iniettabile per i test
 * @returns {{ starLog: Array, pruned: number, oldestKeptDateKey: string|null }}
 */
export function pruneStarLog(starLog, nowMs = Date.now()) {
  const entries = Array.isArray(starLog) ? starLog : [];
  const sessions = entries.filter((e) => e && e.type === 'FOCUS_SESSION');
  if (sessions.length === 0) {
    return { starLog: entries, pruned: 0, oldestKeptDateKey: null };
  }

  const cutoffMs = nowMs - SESSION_RETENTION_DAYS * DAY_MS;
  const cutoffKey = new Date(cutoffMs).toISOString().slice(0, 10);

  // Candidate alla potatura: vecchie di almeno SESSION_RETENTION_DAYS.
  const isOld = (e) => typeof e.dateKey === 'string' && e.dateKey < cutoffKey;
  const oldCount = sessions.filter(isOld).length;
  const keptAfterAge = sessions.length - oldCount;

  // Si pota SOLO se dopo la potatura si resta comunque sotto il tetto,
  // altrimenti si pota anche per anzianità dentro la finestra: un
  // profilo molto intenso non deve poter sfondare il tetto lo stesso.
  let toRemove = 0;
  if (oldCount > 0) toRemove = oldCount;
  if (keptAfterAge > MAX_SESSION_ENTRIES) toRemove += keptAfterAge - MAX_SESSION_ENTRIES;
  if (toRemove <= 0) {
    return { starLog: entries, pruned: 0, oldestKeptDateKey: null };
  }

  // Si rimuovono le `toRemove` sessioni PIÙ VECCHIE per DATA, non per
  // posizione nell'array. Lo Star Log è append-only e quindi in pratica
  // già ordinato, ma un profilo importato o fuso a mano può non esserlo:
  // affidarsi all'ordine significherebbe potare sessioni recenti e
  // conservare quelle vecchie, cioè l'esatto contrario.
  const daRimuovere = new Set(
    entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e && e.type === 'FOCUS_SESSION')
      .sort((a, b) => {
        const cmp = String(a.e.dateKey || '').localeCompare(String(b.e.dateKey || ''));
        return cmp !== 0 ? cmp : a.i - b.i;
      })
      .slice(0, toRemove)
      .map(({ i }) => i)
  );

  const next = entries.filter((_, i) => !daRimuovere.has(i));

  const firstKeptSession = next
    .filter((e) => e && e.type === 'FOCUS_SESSION')
    .sort((a, b) => String(a.dateKey || '').localeCompare(String(b.dateKey || '')))[0];
  return {
    starLog: next,
    pruned: toRemove,
    oldestKeptDateKey: firstKeptSession ? firstKeptSession.dateKey : null
  };
}

/** Etichetta leggibile del mese da cui la cronologia dettagliata è
 * completa — mostrata in Karen OS Settings per non far credere che le
 * sessioni più vecchie siano state perse per un guasto. */
export function oldestDetailedMonth(starLog) {
  // Per data, non per posizione: stesso motivo di pruneStarLog.
  const sessioni = (Array.isArray(starLog) ? starLog : [])
    .filter((e) => e && e.type === 'FOCUS_SESSION' && typeof e.dateKey === 'string')
    .map((e) => e.dateKey)
    .sort();
  return sessioni.length > 0 ? monthKeyFromDateKey(sessioni[0]) : null;
}

export default { pruneStarLog, oldestDetailedMonth, SESSION_RETENTION_DAYS, MAX_SESSION_ENTRIES };
