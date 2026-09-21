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
  computeMateriaQuota,
  applyCumulativeLoad,
  compareByUrgency,
  selectDailyFocus,
  allocateDailyBudget,
  computeDailyPlan
} from '../utils/quotaEngine.js';

/**
 * @param {Array} materie state.materie corrente
 * @param {{calibration?:object, loadAdjustmentPct?:number, priorityIds?:Set<string>|null}} options
 */
export function useKarenAutoRouter(materie, options = {}) {
  const { calibration = null, loadAdjustmentPct = 0, priorityIds = null } = options;
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

  // `priorityIds` è un Set: lo si confronta per contenuto, non per
  // identità, così un Set ricreato con gli stessi id non invalida il piano.
  const priorityKey = priorityIds && priorityIds.size ? [...priorityIds].sort().join('|') : '';

  return useMemo(
    () => computeDailyPlan(materie, { calibration, loadAdjustmentPct, priorityIds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [materie, calibration, loadAdjustmentPct, priorityKey, dayKey]
  );
}

export default useKarenAutoRouter;
