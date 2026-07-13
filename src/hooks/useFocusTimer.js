import { useState, useRef, useCallback, useEffect } from 'react';
import { useTimerEngine, TIMER_STATUS } from './useTimerEngine.js';
import { BLOOD_PACT_PENALTY, FOCUS_QUALITY, DEFAULT_FOCUS_QUALITY } from '../utils/xpEngine.js';

/**
 * useFocusTimer — "Il Cervello" del Tactical Timer.
 *
 * Estratto dal ArachnoForgeContext (Fase 2 — Custom Hooks & State Split)
 * per isolare completamente la macchina a stati del Focus/Break dal resto
 * della logica applicativa (XP, Stamina, Skill Tree, Trofei...). Il
 * Context resta l'unico proprietario dello stato persistito: questo hook
 * gestisce solo lo stato EFFIMERO di sessione (countdown, materia/nodo
 * attivo, minuti "in sospeso" non ancora salvati) e comunica col resto
 * dell'app esclusivamente tramite `dispatch`, `audio` e `pushToast`
 * ricevuti come parametri — nessuna dipendenza diretta dal reducer.
 *
 * "Sessione in sospeso": ogni blocco Focus che arriva naturalmente a zero
 * NON viene salvato subito. Si accumula in `pendingFocus` finché l'utente
 * non chiude volontariamente la sessione con `endFocusSession(quality)`
 * (Termina Sessione / Avvia Pausa), passando per il Tactical Debriefing.
 * `overdrive()` concatena un nuovo blocco sullo stesso "conto" senza mai
 * toccare il reducer nel frattempo.
 */
export function useFocusTimer({ focusTime, shortBreakTime, longBreakTime, dispatch, audio, pushToast }) {
  const [activeFocusMateriaId, setActiveFocusMateriaId] = useState(null);
  const [activeFocusSfidaId, setActiveFocusSfidaId] = useState(null);
  const [pendingFocus, setPendingFocus] = useState({
    totalMinutes: 0,
    overdriveOccurred: false,
    materiaId: null,
    sfidaId: null
  });

  const activeFocusRef = useRef({ materiaId: null, sfidaId: null });
  useEffect(() => {
    activeFocusRef.current = { materiaId: activeFocusMateriaId, sfidaId: activeFocusSfidaId };
  }, [activeFocusMateriaId, activeFocusSfidaId]);

  // Focus Reminder — "rintocco tibetano" ogni 30 minuti ESATTI di Focus
  // ininterrotto (accumulo su tutta la catena Focus + Overdrive concatenati,
  // non solo il blocco corrente). Un ref conta quante soglie da 1800s sono
  // già state annunciate in questo arco continuo di studio, per non
  // ri-suonare ad ogni tick da 250ms una volta superata la soglia.
  const REMINDER_INTERVAL_SECONDS = 1800;
  const reminderThresholdRef = useRef(0);

  // Letto tramite ref (non come dipendenza di useCallback) cosi' i timer
  // duration usano sempre il valore corrente delle impostazioni senza
  // costringere startFocus/startBreak a essere ricreate ad ogni modifica
  // di stato non correlata al timer stesso (zero re-render inutili).
  const focusTimeRef = useRef(focusTime);
  const shortBreakRef = useRef(shortBreakTime);
  const longBreakRef = useRef(longBreakTime);
  useEffect(() => { focusTimeRef.current = focusTime; }, [focusTime]);
  useEffect(() => { shortBreakRef.current = shortBreakTime; }, [shortBreakTime]);
  useEffect(() => { longBreakRef.current = longBreakTime; }, [longBreakTime]);

  const handleFocusComplete = useCallback(({ wasOverdrive }) => {
    const { materiaId, sfidaId } = activeFocusRef.current;
    setPendingFocus((prev) => ({
      totalMinutes: prev.totalMinutes + focusTimeRef.current,
      overdriveOccurred: prev.overdriveOccurred || wasOverdrive,
      materiaId: prev.materiaId || materiaId,
      sfidaId: prev.sfidaId || sfidaId
    }));
  }, []);

  const handleBreakComplete = useCallback(() => {
    pushToast('Pausa terminata — pronto per il prossimo blocco di Focus.', 'info');
  }, [pushToast]);

  const rawTimer = useTimerEngine({ onFocusComplete: handleFocusComplete, onBreakComplete: handleBreakComplete });
  const { start: timerStart, stop: timerStop, pause: timerPause, resume: timerResume } = rawTimer;

  useEffect(() => {
    if (rawTimer.status !== TIMER_STATUS.FOCUS) return;
    const elapsedInBlock = rawTimer.totalSeconds - rawTimer.remainingSeconds;
    const totalElapsedSeconds = pendingFocus.totalMinutes * 60 + elapsedInBlock;
    const reachedThresholds = Math.floor(totalElapsedSeconds / REMINDER_INTERVAL_SECONDS);
    if (reachedThresholds > reminderThresholdRef.current) {
      reminderThresholdRef.current = reachedThresholds;
      audio.playFocusReminder();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTimer.status, rawTimer.remainingSeconds, rawTimer.totalSeconds, pendingFocus.totalMinutes, audio]);

  const startFocus = useCallback((materiaId = null, sfidaId = null, overdrive = false) => {
    setActiveFocusMateriaId(materiaId);
    setActiveFocusSfidaId(sfidaId);
    timerStart('FOCUS', focusTimeRef.current, { overdrive });
  }, [timerStart]);

  const startBreak = useCallback((long = false) => {
    const minutes = long ? longBreakRef.current : shortBreakRef.current;
    timerStart('BREAK', minutes);
  }, [timerStart]);

  const interruptFocus = useCallback(() => {
    const finished = timerStop();
    if (finished === 'FOCUS') {
      // Blood Pact è un abbandono volontario dell'intera sessione: forfeit
      // anche di eventuali minuti già accumulati in blocchi Overdrive
      // precedenti non ancora salvati.
      setPendingFocus({ totalMinutes: 0, overdriveOccurred: false, materiaId: null, sfidaId: null });
      reminderThresholdRef.current = 0;
      dispatch({ type: 'BLOOD_PACT_INTERRUPT' });
      pushToast(`BLOOD PACT — -${BLOOD_PACT_PENALTY} XP`, 'danger');
    }
  }, [timerStop, dispatch, pushToast]);

  const overdrive = useCallback(() => {
    timerStop();
    const { materiaId, sfidaId } = activeFocusRef.current;
    startFocus(materiaId, sfidaId, true);
  }, [timerStop, startFocus]);

  /**
   * Chiude volontariamente la sessione Focus corrente applicando l'esito
   * del Tactical Debriefing ("Sessione Completata. Valuta il tuo Focus").
   * Blindato contro il doppio invio: se non c'è nulla in sospeso
   * (`totalMinutes` a 0, es. sessione già chiusa da un click precedente),
   * non fa nulla e ritorna `false` — sicuro anche se richiamato due volte
   * di seguito per un click ripetuto sul modal di rating.
   */
  const endFocusSession = useCallback((quality = DEFAULT_FOCUS_QUALITY) => {
    if (pendingFocus.totalMinutes > 0) {
      dispatch({
        type: 'FOCUS_COMPLETED',
        payload: {
          wasOverdrive: pendingFocus.overdriveOccurred,
          materiaId: pendingFocus.materiaId,
          sfidaId: pendingFocus.sfidaId,
          focusMinutes: pendingFocus.totalMinutes,
          quality
        }
      });
      audio.playSuccessChime();
      if (quality === FOCUS_QUALITY.DISTRACTED) {
        pushToast('Sessione faticosa registrata — attiva un Daily Protocol per recuperare Stamina.', 'info');
      }
      setPendingFocus({ totalMinutes: 0, overdriveOccurred: false, materiaId: null, sfidaId: null });
      reminderThresholdRef.current = 0;
      return true;
    }
    setPendingFocus({ totalMinutes: 0, overdriveOccurred: false, materiaId: null, sfidaId: null });
    reminderThresholdRef.current = 0;
    return false;
  }, [pendingFocus, dispatch, audio, pushToast]);

  return {
    status: rawTimer.status,
    remainingSeconds: rawTimer.remainingSeconds,
    totalSeconds: rawTimer.totalSeconds,
    isOverdriveActive: rawTimer.isOverdriveActive,
    startFocus,
    startBreak,
    pause: timerPause,
    resume: timerResume,
    interruptFocus,
    overdrive,
    endFocusSession,
    pendingFocusMinutes: pendingFocus.totalMinutes,
    pendingFocusOverdrive: pendingFocus.overdriveOccurred,
    activeFocusMateriaId,
    activeFocusSfidaId
  };
}

export { TIMER_STATUS };
export default useFocusTimer;
