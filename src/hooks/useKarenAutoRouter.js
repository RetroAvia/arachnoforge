import { useMemo, useState, useEffect } from 'react';
import { daysUntilDateOnly, todayDateOnlyKey, dateOnlyToUtcMs } from '../utils/dateUtils.js';
import { computeEstimatedCompletion } from '../utils/materiaMeta.js';

/**
 * K.A.R.E.N. AUTO-ROUTER — V23.0 "The Quantum Router" (Modulo 1).
 *
 * PROBLEMA RISOLTO: nella build precedente, la Quota Odierna assumeva
 * SEMPRE "Monte Ore = CFU * 10", anche quando l'utente aveva già spezzato
 * l'esame in Nodi con una propria stima di giorni (`sfida.giorni`). I due
 * motori (K.A.R.E.N. e la "Fine Prevista" dello Skill Tree) calcolavano il
 * carico di lavoro con unità di misura diverse e arrivavano a conclusioni
 * contraddittorie: la card poteva lampeggiare DEFCON 1 anche quando la
 * "Fine Prevista" mostrata nel Web-Matrix cadeva TRANQUILLAMENTE prima
 * dell'esame. Falso allarme.
 *
 * DYNAMIC FALLBACK LOGIC (fix chirurgico):
 *   - SE la Materia ha Nodi (sfide.length > 0): il Monte Ore Residuo si
 *     costruisce dal BASSO, nodo per nodo — `giorni` di ciascun nodo
 *     ANCORA incompleto convertito in ore (HOURS_PER_NODE_DAY), meno le
 *     ore di Focus già tracciate su quello specifico nodo. Karen ragiona
 *     con gli stessi identici dati dello Skill Tree, mai un doppio
 *     standard.
 *   - SE la Materia ha 0 Nodi creati: fallback puro sul monte-ore
 *     accademico standard (CFU * 10) — l'unica stima disponibile quando
 *     non esiste ancora una scomposizione in nodi.
 *
 * OVERRIDE DEFCON 1 (Direttiva Suprema): quando esistono Nodi, la "Data
 * Fine Prevista" è calcolata dalla STESSA funzione `computeEstimatedCompletion`
 * già usata in QuadrantHub (single source of truth — mai due calcoli che
 * possano disallinearsi). Se `Data Fine Prevista <= Data Esame`, lo stato
 * è FORZATAMENTE "Ottimale": nessun allarme, indipendentemente da quanto
 * "alta" possa sembrare la quota oraria grezza. Altrimenti la severità è
 * decisa dal rapporto fra giorni-di-lavoro-stimati e giorni-rimasti
 * (`paceRatio`): è la stessa matematica della Fine Prevista, non un
 * secondo giudizio arbitrario basato sulle ore.
 */
export const HOURS_PER_CFU = 10;
export const HOURS_PER_NODE_DAY = 2; // 1 "giorno stimato" di un nodo ~= 2 ore reali di Focus dedicato.
export const EVENT_HORIZON_THRESHOLD_HOURS = 8;

export const QUOTA_STATUS = {
  OTTIMALE: 'OTTIMALE',
  ATTENZIONE: 'ATTENZIONE',
  CRITICO: 'CRITICO'
};

export const QUOTA_STATUS_META = {
  OTTIMALE: {
    label: 'Ottimale',
    badgeClass: 'bg-emerald-900/40 text-emerald-300 border-emerald-400/40',
    dotClass: 'bg-emerald-400',
    cardClass: '',
    glowStyle: { filter: 'drop-shadow(0 0 6px rgba(52,211,153,0.7))' }
  },
  ATTENZIONE: {
    label: 'Attenzione',
    badgeClass: 'bg-accent/15 text-accent border-accent/40',
    dotClass: 'bg-accent',
    cardClass: 'af-attenzione-pulse border-accent/60 bg-accent/10',
    glowStyle: {}
  },
  CRITICO: {
    label: 'Critico',
    badgeClass: 'bg-primary/15 text-primary border-primary/60',
    dotClass: 'bg-primary',
    cardClass: 'af-event-horizon border-primary/70 bg-primary/10',
    glowStyle: {}
  }
};

/** Ramo Nodi: Ore Residue = Σ (giorni_nodo * HOURS_PER_NODE_DAY - ore già tracciate su quel nodo), solo sui nodi NON completati. */
function computeNodeBasedLoad(materia) {
  const sfide = Array.isArray(materia.sfide) ? materia.sfide : [];
  const incomplete = sfide.filter((s) => s.status !== 'COMPLETED');
  const hoursRemaining = incomplete.reduce((sum, s) => {
    const budgetHours = Math.max(1, Number(s.giorni) || 1) * HOURS_PER_NODE_DAY;
    const trackedHours = (Number(s.focusMinutes) || 0) / 60;
    return sum + Math.max(0, budgetHours - trackedHours);
  }, 0);
  return { hoursRemaining, remainingNodeCount: incomplete.length };
}

function computeMateriaQuota(materia) {
  const sfide = Array.isArray(materia.sfide) ? materia.sfide : [];
  const hasNodes = sfide.length > 0;
  const daysRemaining = materia.examDate ? daysUntilDateOnly(materia.examDate) : null;

  let hoursRemaining = 0;
  let finePrevistaDateKey = null;
  let totalDaysNeeded = 0;

  if (hasNodes) {
    const nodeLoad = computeNodeBasedLoad(materia);
    hoursRemaining = nodeLoad.hoursRemaining;
    // Single source of truth: la STESSA funzione che disegna "Fine
    // Prevista" nella card Skill Tree di QuadrantHub.jsx — zero drift
    // possibile fra i due motori.
    const estimate = computeEstimatedCompletion(materia);
    finePrevistaDateKey = estimate.done ? null : estimate.dateKey;
    totalDaysNeeded = estimate.totalDaysNeeded || 0;
  } else {
    hoursRemaining = Math.max(0, (Number(materia.cfu) || 0) * HOURS_PER_CFU);
  }

  let dailyQuotaHours = null;
  let overdue = false;
  if (hoursRemaining <= 0) {
    dailyQuotaHours = 0;
  } else if (daysRemaining == null) {
    dailyQuotaHours = null;
  } else if (daysRemaining <= 0) {
    dailyQuotaHours = hoursRemaining;
    overdue = true;
  } else {
    dailyQuotaHours = hoursRemaining / daysRemaining;
  }

  // --- QUANTUM ROUTER: risoluzione status a 3 livelli, MAI un conflitto. ---
  let status;
  let paceRatio = null;
  if (hoursRemaining <= 0) {
    status = QUOTA_STATUS.OTTIMALE;
  } else if (daysRemaining == null) {
    status = QUOTA_STATUS.ATTENZIONE; // nessuna data esame: Karen non può proiettare il rischio.
  } else if (overdue) {
    status = QUOTA_STATUS.CRITICO; // esame oggi/scaduto con lavoro ancora aperto: sempre critico.
  } else if (hasNodes) {
    paceRatio = totalDaysNeeded / daysRemaining;
    const finePrevistaOk =
      finePrevistaDateKey != null && dateOnlyToUtcMs(finePrevistaDateKey) <= dateOnlyToUtcMs(materia.examDate);
    if (finePrevistaOk) {
      status = QUOTA_STATUS.OTTIMALE; // OVERRIDE DEFCON 1: la traiettoria a nodi arriva in tempo, allarme disattivato per direttiva.
    } else if (paceRatio <= 1.5) {
      status = QUOTA_STATUS.ATTENZIONE;
    } else {
      status = QUOTA_STATUS.CRITICO;
    }
  } else {
    const ratio = dailyQuotaHours / EVENT_HORIZON_THRESHOLD_HOURS;
    if (ratio <= 0.5) status = QUOTA_STATUS.OTTIMALE;
    else if (ratio <= 1) status = QUOTA_STATUS.ATTENZIONE;
    else status = QUOTA_STATUS.CRITICO;
  }

  return {
    materiaId: materia.id,
    nome: materia.nome,
    hasNodes,
    hoursRemaining: Math.round(hoursRemaining * 100) / 100,
    daysRemaining,
    dailyQuotaHours,
    finePrevistaDateKey,
    paceRatio: paceRatio != null ? Math.round(paceRatio * 100) / 100 : null,
    overdue,
    status,
    // Alias di retro-compatibilità per l'HUD Rosso Lampeggiante già cablato altrove.
    eventHorizon: status === QUOTA_STATUS.CRITICO
  };
}

/**
 * @param {Array} materie - state.materie corrente
 * @returns {{quotas: Array, byMateriaId: Map, eventHorizonList: Array, criticalCount: number}}
 */
export function useKarenAutoRouter(materie) {
  const [dayKey, setDayKey] = useState(todayDateOnlyKey);

  // Heartbeat leggero: ricalcola la chiave del giorno ogni minuto, così il
  // memo sottostante si invalida esplicitamente attraversando la mezzanotte
  // (GPS che ricalcola il percorso), anche a stato applicativo fermo.
  useEffect(() => {
    const check = () => {
      const key = todayDateOnlyKey();
      setDayKey((prev) => (prev !== key ? key : prev));
    };
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, []);

  const quotas = useMemo(() => {
    const safe = Array.isArray(materie) ? materie : [];
    return safe
      .filter((m) => m && !m.examPassed)
      .map(computeMateriaQuota)
      .sort((a, b) => (b.dailyQuotaHours || 0) - (a.dailyQuotaHours || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materie, dayKey]);

  const byMateriaId = useMemo(() => {
    const map = new Map();
    quotas.forEach((q) => map.set(q.materiaId, q));
    return map;
  }, [quotas]);

  const eventHorizonList = useMemo(() => quotas.filter((q) => q.status === QUOTA_STATUS.CRITICO), [quotas]);

  return { quotas, byMateriaId, eventHorizonList, criticalCount: eventHorizonList.length };
}

export default useKarenAutoRouter;
