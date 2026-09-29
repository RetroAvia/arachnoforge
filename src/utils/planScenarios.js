// =====================================================================
// ArachnoForge — src/utils/planScenarios.js (V42)
// "E SE…?": GLI SCENARI DEL PIANO DELLA SESSIONE.
//
// Quando il piano non sta nei tempi, dirlo non basta: bisogna far vedere
// quale scelta lo rimette in piedi. Qui si ricalcola il piano VERO (stessi
// ingressi, stesso motore) cambiando una cosa sola alla volta:
//   - spostare una materia in ritardo al suo appello successivo;
//   - toglierla da questa sessione;
//   - un'ora di studio in più al giorno.
// Per ogni scenario: ore scoperte agli esami e materie critiche, prima e
// dopo. Puro: nessun React, nessuno stato.
// =====================================================================
import { computeDailyPlan } from './quotaEngine.js';
import { nextAppelloAfter, targetAppello, planningExamDate } from './appelli.js';
import { todayDateOnlyKey } from './dateUtils.js';

const MAX_SCENARI_MATERIA = 3;

/** Ore scoperte agli esami e materie critiche di un piano (come plan.today.lateHours). */
export function planPressure(plan) {
  const quotas = Array.isArray(plan?.quotas) ? plan.quotas : [];
  const attive = quotas.filter((q) => q && !q.frozen && q.daysRemaining != null);
  const late = attive.reduce((sum, q) => sum + Math.max(0, Number(q.lateHours) || 0), 0);
  return {
    lateHours: Math.round(late * 100) / 100,
    critiche: attive.filter((q) => q.status === 'CRITICO').length,
    deficitHours: Number(plan?.today?.deficitHours) || 0
  };
}

function ricalcola(materie, inputs) {
  return computeDailyPlan(materie, { ...inputs, timelineDays: 0 });
}

/**
 * @param {Array}  materiePiano  materie con la data di pianificazione
 * @param {object} inputs        derived.planInputs
 * @param {object} basePlan      il piano attuale (per non ricalcolarlo)
 * @returns {Array<{id:string, kind:string, materiaId?:string, titolo:string, dettaglio:string, prima:object, dopo:object, applica?:object}>}
 */
export function computePlanScenarios(materiePiano, inputs, basePlan, { todayKey = todayDateOnlyKey() } = {}) {
  if (!Array.isArray(materiePiano) || !inputs || !basePlan) return [];
  const prima = planPressure(basePlan);
  if (prima.critiche === 0 && prima.lateHours < 0.5) return [];
  const out = [];
  const critiche = (basePlan.quotas || [])
    .filter((q) => q && !q.frozen && q.status === 'CRITICO' && q.daysRemaining != null)
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
    .slice(0, MAX_SCENARI_MATERIA);

  critiche.forEach((q) => {
    const m = materiePiano.find((x) => x.id === q.materiaId);
    if (!m) return;
    const attuale = targetAppello(m, todayKey);
    const prossimo = attuale ? nextAppelloAfter(m, attuale, todayKey) : null;
    if (prossimo) {
      const spostata = {
        ...m,
        appelloTargetId: prossimo.id,
        examDate: prossimo.scritto || prossimo.orale || null,
        oralDate: prossimo.scritto && prossimo.orale ? prossimo.orale : null
      };
      const conData = { ...spostata, examDate: planningExamDate(spostata, todayKey) };
      const plan = ricalcola(
        materiePiano.map((x) => (x.id === m.id ? conData : x)),
        inputs
      );
      out.push({
        id: `sposta-${m.id}`,
        kind: 'SPOSTA',
        materiaId: m.id,
        titolo: `${m.nome} all’appello successivo`,
        dettaglio: `Obiettivo spostato al ${prossimo.scritto || prossimo.orale}.`,
        prima,
        dopo: planPressure(plan),
        applica: { materiaId: m.id, appelloTargetId: prossimo.id, data: prossimo.scritto || prossimo.orale }
      });
    }
    const senza = ricalcola(
      materiePiano.map((x) => (x.id === m.id ? { ...x, examDate: null, oralDate: null } : x)),
      inputs
    );
    out.push({
      id: `rinuncia-${m.id}`,
      kind: 'RINUNCIA',
      materiaId: m.id,
      titolo: `${m.nome} fuori da questa sessione`,
      dettaglio: 'Nessun appello per ora: il tempo va alle altre materie.',
      prima,
      dopo: planPressure(senza)
    });
  });

  // Un'ora in più al giorno (stessi giorni di riposo).
  const cal = inputs.calibration || {};
  const ore = (Number(cal.manualHours) > 0 ? Number(cal.manualHours) : Number(cal.hoursPerDay) || 4.5) + 1;
  const piuOre = ricalcola(materiePiano, { ...inputs, calibration: { ...cal, manualHours: ore, hoursPerDay: ore } });
  out.push({
    id: 'ora-in-piu',
    kind: 'ORA_IN_PIU',
    titolo: 'Un’ora di studio in più al giorno',
    dettaglio: `Da ${Math.round((ore - 1) * 10) / 10} a ${Math.round(ore * 10) / 10} ore al giorno, se è davvero sostenibile.`,
    prima,
    dopo: planPressure(piuOre)
  });

  return out;
}
