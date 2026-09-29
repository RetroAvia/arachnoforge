import { useMemo, useState, useEffect } from 'react';
import { todayDateOnlyKey } from '../utils/dateUtils.js';
import { computeDailyPlan } from '../utils/quotaEngine.js';

/**
 * K.A.R.E.N. AUTO-ROUTER — l'hook.
 *
 * V39.0 — Tutta la logica vive ora in `utils/quotaEngine.js`, un modulo
 * puro senza React: questo file la memoizza e aggiunge l'unica cosa che
 * un modulo puro non può fare da solo, cioè accorgersi che è passata la
 * mezzanotte a stato applicativo fermo. Il motore è lo stesso che usa il
 * reducer per verificare la missione "Primary Target": UI e missione non
 * possono più indicare due materie diverse.
 *
 * Gli export qui sotto restano per compatibilità con chi importava le
 * costanti e le funzioni da questo percorso (test compresi).
 */
export {
  HOURS_PER_CFU,
  EVENT_HORIZON_THRESHOLD_HOURS,
  MAX_DAILY_FOCUS_MATERIE,
  CRITICAL_DISTANCE_DAYS,
  QUOTA_STATUS,
  QUOTA_STATUS_META,
  STATUS_RANK,
  RATIO_OK,
  RATIO_ATTENZIONE,
  statusFromRatio,
  compareByUrgency,
  computeDailyPlan
} from '../utils/quotaEngine.js';

/**
 * @param {Array} materie materie con la data di pianificazione
 * @param {object} options vedi quotaEngine.computeDailyPlan
 */
export function useKarenAutoRouter(materie, options = {}) {
  const { calibration = null, loadAdjustmentPct = 0, sintesiLezioni = null, lessonPhase = null, calendar = null, doneToday = null, doneKey = '' } = options;
  const [dayKey, setDayKey] = useState(todayDateOnlyKey);

  // Battito leggero: ricontrolla la chiave del giorno ogni minuto, così il
  // piano si ricalcola attraversando la mezzanotte anche a stato fermo.
  useEffect(() => {
    const check = () => {
      const key = todayDateOnlyKey();
      setDayKey((prev) => (prev !== key ? key : prev));
    };
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, []);

  // Confronto per contenuto: un elenco ricreato identico (ogni minuto,
  // col battito del Campus) non invalida il piano.
  const sintesiKey = Array.isArray(sintesiLezioni)
    ? sintesiLezioni.map((v) => `${v.materiaId}:${Math.round((Number(v.ore) || 0) * 100)}`).join('|')
    : '';

  return useMemo(
    () => computeDailyPlan(materie, { calibration, loadAdjustmentPct, sintesiLezioni, lessonPhase, calendar, doneToday, todayKey: dayKey }),
    // `doneKey`: il fatto di oggi per contenuto (cambia solo quando chiudi
    // una sessione), non per identità della Map ricreata a ogni render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [materie, calibration, loadAdjustmentPct, sintesiKey, dayKey, lessonPhase, calendar, doneKey]
  );
}

export default useKarenAutoRouter;
