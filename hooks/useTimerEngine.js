import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Macchina a stati del Tactical Timer.
 * Progettata attorno a Date.now() (endTimestamp assoluto) invece che a un
 * decremento per-tick, per non subire drift quando il tab passa in
 * background e i browser rallentano/throttlano i timer JS. Il tick a 250ms
 * serve solo per il refresh visivo: il valore reale è sempre ricalcolato
 * dalla differenza fra "adesso" e l'istante di fine assoluto.
 */
export const TIMER_STATUS = {
  IDLE: 'IDLE',
  FOCUS: 'FOCUS',
  BREAK: 'BREAK',
  PAUSED: 'PAUSED'
};

export function useTimerEngine({ onFocusComplete, onBreakComplete } = {}) {
  const [status, setStatus] = useState(TIMER_STATUS.IDLE);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [isOverdriveActive, setIsOverdriveActive] = useState(false);
  // V41 — cambia a ogni avvio, pausa, ripresa o arresto: chi salva il
  // blocco in corso (useFocusTimer) sa che deve riscriverlo anche quando
  // lo stato resta FOCUS → FOCUS, come in un Overdrive concatenato.
  const [runId, setRunId] = useState(0);
  // V41 — il TIPO di blocco ('FOCUS' | 'BREAK' | null). In pausa lo stato
  // è PAUSED per entrambi: senza questo, una pausa sospesa veniva
  // scambiata per un Focus sospeso (e i suoi minuti salvati come studio).
  const [mode, setMode] = useState(null);

  const endTimestampRef = useRef(null);
  const pausedRemainingMsRef = useRef(null);
  const intervalRef = useRef(null);
  const statusRef = useRef(status);
  const modeRef = useRef(null);
  const onFocusCompleteRef = useRef(onFocusComplete);
  const onBreakCompleteRef = useRef(onBreakComplete);
  // V37.0 — FIX CRITICO (Overdrive mai registrato). `tick` leggeva
  // `isOverdriveActive` dalla propria closure, ma l'intervallo viene
  // creato dentro `start()` con la closure del render CORRENTE — cioè
  // prima che `setIsOverdriveActive(true)` sia stato committato — e non
  // viene mai ricreato. Risultato: al termine naturale di un blocco
  // Overdrive arrivava sempre `wasOverdrive: false`, e con esso saltava
  // il moltiplicatore x1.5, il contatore `overdriveCount`, l'azione
  // critica verso Maximum Carnage e la quest "Overdrive Master".
  // Un ref è la sola fonte di verità leggibile dall'intervallo: viene
  // scritto in modo SINCRONO da start/stop, prima che React renderizzi.
  const isOverdriveRef = useRef(false);
  // V41 — durata REALE del blocco in corso, letta dall'intervallo come
  // isOverdriveRef. Serve a chi accredita i minuti: la durata impostata
  // può cambiare mentre il blocco corre (il timer adattivo di Karen arriva
  // dopo l'avvio, o la cambi dalle Impostazioni), e un blocco da 25
  // minuti non deve valerne 45.
  const totalSecondsRef = useRef(0);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { onFocusCompleteRef.current = onFocusComplete; }, [onFocusComplete]);
  useEffect(() => { onBreakCompleteRef.current = onBreakComplete; }, [onBreakComplete]);

  const clearTick = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    if (!endTimestampRef.current) return;
    const remainingMs = endTimestampRef.current - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    setRemainingSeconds(remaining);

    if (remainingMs <= 0) {
      clearTick();
      const finishedMode = modeRef.current;
      // Letto dal ref, mai dallo state: vedi il commento su isOverdriveRef.
      const wasOverdrive = isOverdriveRef.current;
      const durationSeconds = totalSecondsRef.current;
      endTimestampRef.current = null;
      modeRef.current = null;
      isOverdriveRef.current = false;
      setStatus(TIMER_STATUS.IDLE);
      setIsOverdriveActive(false);
      setMode(null);
      setRunId((n) => n + 1);
      if (finishedMode === 'FOCUS' && onFocusCompleteRef.current) {
        onFocusCompleteRef.current({ wasOverdrive, durationSeconds });
      } else if (finishedMode === 'BREAK' && onBreakCompleteRef.current) {
        onBreakCompleteRef.current();
      }
    }
  }, [clearTick]);

  const startTick = useCallback(() => {
    clearTick();
    intervalRef.current = setInterval(tick, 250);
  }, [clearTick, tick]);

  const start = useCallback((mode, durationMinutes, { overdrive = false } = {}) => {
    const durationSeconds = Math.max(1, Math.round(durationMinutes * 60));
    endTimestampRef.current = Date.now() + durationSeconds * 1000;
    pausedRemainingMsRef.current = null;
    modeRef.current = mode;
    // Scrittura sincrona PRIMA di startTick(): l'intervallo che sta per
    // nascere leggerà il valore giusto anche se React non ha ancora
    // committato lo state qui sotto.
    isOverdriveRef.current = mode === 'FOCUS' ? overdrive : false;
    totalSecondsRef.current = durationSeconds;
    setTotalSeconds(durationSeconds);
    setRemainingSeconds(durationSeconds);
    setIsOverdriveActive(mode === 'FOCUS' ? overdrive : false);
    setStatus(mode === 'FOCUS' ? TIMER_STATUS.FOCUS : TIMER_STATUS.BREAK);
    setMode(mode);
    setRunId((n) => n + 1);
    startTick();
  }, [startTick]);

  const pause = useCallback(() => {
    if (statusRef.current !== TIMER_STATUS.FOCUS && statusRef.current !== TIMER_STATUS.BREAK) return;
    clearTick();
    pausedRemainingMsRef.current = endTimestampRef.current ? endTimestampRef.current - Date.now() : 0;
    endTimestampRef.current = null;
    setStatus(TIMER_STATUS.PAUSED);
    setRunId((n) => n + 1);
  }, [clearTick]);

  const resume = useCallback(() => {
    if (statusRef.current !== TIMER_STATUS.PAUSED || pausedRemainingMsRef.current == null) return;
    endTimestampRef.current = Date.now() + pausedRemainingMsRef.current;
    pausedRemainingMsRef.current = null;
    setStatus(modeRef.current === 'FOCUS' ? TIMER_STATUS.FOCUS : TIMER_STATUS.BREAK);
    setRunId((n) => n + 1);
    startTick();
  }, [startTick]);

  /** Interrompe la sessione corrente. Ritorna la modalità interrotta (per il Blood Pact). */
  const stop = useCallback(() => {
    clearTick();
    const finishedMode = modeRef.current;
    endTimestampRef.current = null;
    pausedRemainingMsRef.current = null;
    modeRef.current = null;
    isOverdriveRef.current = false;
    totalSecondsRef.current = 0;
    setRemainingSeconds(0);
    setTotalSeconds(0);
    setIsOverdriveActive(false);
    setStatus(TIMER_STATUS.IDLE);
    setMode(null);
    setRunId((n) => n + 1);
    return finishedMode;
  }, [clearTick]);

  /**
   * V41 — Riprende un blocco salvato prima di un ricaricamento (vedi
   * utils/focusRecovery.js). `endsAt` è l'istante di fine ASSOLUTO, lo
   * stesso di prima: il tempo passato con l'app chiusa è già scalato.
   * Con `pausedRemainingMs` il blocco torna in pausa.
   */
  const restore = useCallback(
    ({ mode, endsAt = null, pausedRemainingMs = null, totalSeconds: total, overdrive = false }) => {
      if (mode !== 'FOCUS' && mode !== 'BREAK') return false;
      const safeTotal = Math.max(1, Math.round(Number(total) || 0));
      clearTick();
      modeRef.current = mode;
      isOverdriveRef.current = mode === 'FOCUS' ? !!overdrive : false;
      totalSecondsRef.current = safeTotal;
      setMode(mode);
      setTotalSeconds(safeTotal);
      setIsOverdriveActive(mode === 'FOCUS' ? !!overdrive : false);
      if (pausedRemainingMs != null) {
        endTimestampRef.current = null;
        pausedRemainingMsRef.current = Math.max(0, pausedRemainingMs);
        setRemainingSeconds(Math.max(0, Math.ceil(pausedRemainingMs / 1000)));
        setStatus(TIMER_STATUS.PAUSED);
        setRunId((n) => n + 1);
        return true;
      }
      if (!Number.isFinite(endsAt)) return false;
      endTimestampRef.current = endsAt;
      pausedRemainingMsRef.current = null;
      setRemainingSeconds(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
      setStatus(mode === 'FOCUS' ? TIMER_STATUS.FOCUS : TIMER_STATUS.BREAK);
      setRunId((n) => n + 1);
      startTick();
      return true;
    },
    [clearTick, startTick]
  );

  /** V41 — Fotografia del blocco corrente, per poterlo riprendere dopo un ricaricamento. */
  const snapshot = useCallback(
    () => ({
      mode: modeRef.current,
      endsAt: endTimestampRef.current,
      pausedRemainingMs: pausedRemainingMsRef.current,
      overdrive: isOverdriveRef.current
    }),
    []
  );

  // V41 — Il countdown si riaggancia da solo se lo stato dice "in corso"
  // ma l'intervallo non c'è (per esempio dopo lo smontaggio simulato di
  // React.StrictMode in sviluppo, che lo cancella mentre il blocco resta
  // attivo): mai un timer fermo su un numero.
  useEffect(() => {
    if ((status === TIMER_STATUS.FOCUS || status === TIMER_STATUS.BREAK) && endTimestampRef.current && !intervalRef.current) {
      startTick();
    }
  }, [status, startTick]);

  useEffect(() => () => clearTick(), [clearTick]);

  return { status, remainingSeconds, totalSeconds, isOverdriveActive, runId, mode, start, pause, resume, stop, restore, snapshot };
}
