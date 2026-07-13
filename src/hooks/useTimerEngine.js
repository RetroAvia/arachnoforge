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

  const endTimestampRef = useRef(null);
  const pausedRemainingMsRef = useRef(null);
  const intervalRef = useRef(null);
  const statusRef = useRef(status);
  const modeRef = useRef(null);
  const onFocusCompleteRef = useRef(onFocusComplete);
  const onBreakCompleteRef = useRef(onBreakComplete);

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
      const wasOverdrive = isOverdriveActive;
      endTimestampRef.current = null;
      modeRef.current = null;
      setStatus(TIMER_STATUS.IDLE);
      setIsOverdriveActive(false);
      if (finishedMode === 'FOCUS' && onFocusCompleteRef.current) {
        onFocusCompleteRef.current({ wasOverdrive });
      } else if (finishedMode === 'BREAK' && onBreakCompleteRef.current) {
        onBreakCompleteRef.current();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTick, isOverdriveActive]);

  const startTick = useCallback(() => {
    clearTick();
    intervalRef.current = setInterval(tick, 250);
  }, [clearTick, tick]);

  const start = useCallback((mode, durationMinutes, { overdrive = false } = {}) => {
    const durationSeconds = Math.max(1, Math.round(durationMinutes * 60));
    endTimestampRef.current = Date.now() + durationSeconds * 1000;
    pausedRemainingMsRef.current = null;
    modeRef.current = mode;
    setTotalSeconds(durationSeconds);
    setRemainingSeconds(durationSeconds);
    setIsOverdriveActive(mode === 'FOCUS' ? overdrive : false);
    setStatus(mode === 'FOCUS' ? TIMER_STATUS.FOCUS : TIMER_STATUS.BREAK);
    startTick();
  }, [startTick]);

  const pause = useCallback(() => {
    if (statusRef.current !== TIMER_STATUS.FOCUS && statusRef.current !== TIMER_STATUS.BREAK) return;
    clearTick();
    pausedRemainingMsRef.current = endTimestampRef.current ? endTimestampRef.current - Date.now() : 0;
    endTimestampRef.current = null;
    setStatus(TIMER_STATUS.PAUSED);
  }, [clearTick]);

  const resume = useCallback(() => {
    if (statusRef.current !== TIMER_STATUS.PAUSED || pausedRemainingMsRef.current == null) return;
    endTimestampRef.current = Date.now() + pausedRemainingMsRef.current;
    pausedRemainingMsRef.current = null;
    setStatus(modeRef.current === 'FOCUS' ? TIMER_STATUS.FOCUS : TIMER_STATUS.BREAK);
    startTick();
  }, [startTick]);

  /** Interrompe la sessione corrente. Ritorna la modalità interrotta (per il Blood Pact). */
  const stop = useCallback(() => {
    clearTick();
    const finishedMode = modeRef.current;
    endTimestampRef.current = null;
    pausedRemainingMsRef.current = null;
    modeRef.current = null;
    setRemainingSeconds(0);
    setTotalSeconds(0);
    setIsOverdriveActive(false);
    setStatus(TIMER_STATUS.IDLE);
    return finishedMode;
  }, [clearTick]);

  useEffect(() => () => clearTick(), [clearTick]);

  return { status, remainingSeconds, totalSeconds, isOverdriveActive, start, pause, resume, stop };
}
