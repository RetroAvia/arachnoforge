// =====================================================================
// ArachnoForge — src/utils/examReadiness.js (V36.0)
// EXAM READINESS INDEX — il verdetto esplicito che mancava.
//
// Fino alla V35 l'app sapeva dire "sei in pari / in ritardo" (stato di
// passo della Quota Odierna) e "finirai il programma il giorno X" (Fine
// Prevista), ma non rispondeva MAI alla domanda che conta davvero il
// giorno in cui apri le prenotazioni: **mi presento o rimando?**
//
// L'indice combina le quattro cose che decidono l'esito, ognuna già
// tracciata dall'app e finora mai messa insieme:
//
//   Copertura   45%  quanto programma hai davvero chiuso, pesato per ORE
//                    (non per numero di nodi: 12 nodi da 30' non valgono
//                    3 nodi da 6 ore)
//   Stabilità   30%  quanto quel programma ti resta in testa — è il
//                    memoryRadar dello Spider-Sense, cioè la percentuale
//                    di nodi il cui ultimo giudizio non è "Difficile" e
//                    che non sono in allerta ripasso
//   Fattibilità 15%  la Fine Prevista calibrata arriva prima dell'esame?
//   Attrito     10%  quanto ti costano i nodi che rivedi (Friction
//                    Analytics: % di giudizi "Difficile" sul totale)
//
// Nessun numero inventato: se mancano i dati per un pilastro (zero nodi
// tracciati, nessun ripasso ancora fatto) quel pilastro vale un neutro
// dichiarato e `confidence` scende — l'indice dice apertamente che sta
// tirando a indovinare invece di mostrare un 82% autorevole e falso.
// =====================================================================
import { daysUntilDateOnly, dateOnlyToUtcMs } from './dateUtils.js';
import { computeEstimatedCompletion, nodeBudgetHours, nodeRemainingBudgetHours } from './materiaMeta.js';
import { PERSISTED_STATUS } from './skillTree.js';
import { computeFriction } from './friction.js';

export const WEIGHTS = {
  coverage: 0.45,
  stability: 0.3,
  feasibility: 0.15,
  friction: 0.1
};

export const VERDICT = {
  READY: 'READY',
  BORDERLINE: 'BORDERLINE',
  POSTPONE: 'POSTPONE',
  UNKNOWN: 'UNKNOWN'
};

export const VERDICT_META = {
  READY: {
    label: 'SOSTIENI',
    short: 'Pronto',
    tone: 'text-emerald-300',
    badge: 'bg-emerald-900/50 text-emerald-300 border-emerald-400/40'
  },
  BORDERLINE: {
    label: 'AL LIMITE',
    short: 'Al limite',
    tone: 'text-accent',
    badge: 'bg-accent/15 text-accent border-accent/40'
  },
  POSTPONE: {
    label: 'RIMANDA',
    short: 'Rimanda',
    tone: 'text-primary',
    badge: 'bg-primary/15 text-primary border-primary/50'
  },
  UNKNOWN: {
    label: 'DATI INSUFFICIENTI',
    short: 'Ignoto',
    tone: 'text-slate-400',
    badge: 'bg-slate-800/60 text-slate-300 border-slate-500/30'
  }
};

export const READY_THRESHOLD = 75;
export const BORDERLINE_THRESHOLD = 55;

/** Neutro dichiarato per un pilastro senza dati: né premio né condanna. */
const NEUTRAL = 0.6;

function pct(n) {
  return Math.round(n * 100);
}

/**
 * @param {object} materia una voce di `state.materie`
 * @param {object|null} radar `derived.memoryRadar.byMateria` della materia
 * @param {object|null} calibration pacchetto di utils/calibration.js
 */
export function computeExamReadiness(materia, radar = null, calibration = null) {
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const rawDays = materia?.examDate ? daysUntilDateOnly(materia.examDate) : null;
  // V39.0 — appello nel passato: la domanda "posso presentarmi?" non ha
  // più senso finché non imposti il prossimo. Si valuta come se la data
  // non ci fosse, e lo si dice nel motivo.
  const dataScaduta = rawDays != null && rawDays < 0;
  const daysRemaining = dataScaduta ? null : rawDays;
  const examDateValida = !!materia?.examDate && !dataScaduta;

  // --- Copertura, pesata per ore ---------------------------------------
  // V39.0 — Pesata sulle STESSE ore di tutto il resto dell'app
  // (nodeBudgetHours: bias personale, pagine, ore di sintesi). Prima
  // sommava le "Ore previste" grezze: un nodo con 300 pagine di libro da
  // snellire pesava come uno da 2 ore, e la copertura risultava 67%
  // quando era il 13% — il verdetto diceva "al limite" su una materia da
  // rimandare. E conta anche il lavoro GIÀ fatto dentro i nodi non
  // ancora chiusi (sintesi fatta, ore di studio spese): è copertura vera.
  const totalHours = sfide.reduce((sum, s) => sum + nodeBudgetHours(s, calibration), 0);
  const doneHours = sfide.reduce((sum, s) => {
    const budget = nodeBudgetHours(s, calibration);
    if (s.status === PERSISTED_STATUS.COMPLETED) return sum + budget;
    return sum + Math.max(0, budget - nodeRemainingBudgetHours(s, calibration));
  }, 0);
  const hasNodes = sfide.length > 0;
  const coverage = hasNodes && totalHours > 0 ? Math.min(1, doneHours / totalHours) : 0;

  // --- Stabilità mnemonica (Spider-Sense) --------------------------------
  const hasStability = !!radar && radar.stabilityPct != null;
  const stability = hasStability ? radar.stabilityPct / 100 : NEUTRAL;

  // --- Fattibilità temporale --------------------------------------------
  const estimate = computeEstimatedCompletion(materia, calibration);
  let feasibility;
  if (!examDateValida) {
    feasibility = NEUTRAL;
  } else if (estimate.done) {
    feasibility = 1;
  } else {
    const finishMs = dateOnlyToUtcMs(estimate.dateKey);
    const examMs = dateOnlyToUtcMs(materia.examDate);
    if (finishMs <= examMs) {
      feasibility = 1;
    } else {
      // Quanta parte del lavoro residuo ci sta comunque nel tempo rimasto.
      const daysAvailable = Math.max(0, daysRemaining ?? 0);
      feasibility = estimate.totalDaysNeeded > 0 ? Math.max(0, Math.min(1, daysAvailable / estimate.totalDaysNeeded)) : 0;
    }
  }

  // --- Attrito (Friction Analytics) --------------------------------------
  const attempted = sfide.filter((s) => (s.tentativiSuccessi || 0) + (s.tentativiFalliti || 0) > 0);
  const hasFriction = attempted.length > 0;
  const avgFriction = hasFriction
    ? attempted.reduce((sum, s) => sum + computeFriction(s.tentativiSuccessi, s.tentativiFalliti), 0) / attempted.length
    : null;
  const frictionScore = hasFriction ? Math.max(0, 1 - avgFriction / 100) : NEUTRAL;

  const score = Math.round(
    100 *
      (WEIGHTS.coverage * coverage +
        WEIGHTS.stability * stability +
        WEIGHTS.feasibility * feasibility +
        WEIGHTS.friction * frictionScore)
  );

  // --- Confidenza: su quanti pilastri abbiamo dati veri? -----------------
  const known = [hasNodes, hasStability, examDateValida, hasFriction].filter(Boolean).length;
  const confidence = known / 4;

  let verdict;
  if (!hasNodes || dataScaduta) {
    verdict = VERDICT.UNKNOWN;
  } else if (score >= READY_THRESHOLD) {
    verdict = VERDICT.READY;
  } else if (score >= BORDERLINE_THRESHOLD) {
    verdict = VERDICT.BORDERLINE;
  } else {
    verdict = VERDICT.POSTPONE;
  }

  // --- Il motivo dominante, in una frase ---------------------------------
  const gaps = [
    { key: 'coverage', deficit: (1 - coverage) * WEIGHTS.coverage, enabled: hasNodes },
    { key: 'stability', deficit: (1 - stability) * WEIGHTS.stability, enabled: hasStability },
    { key: 'feasibility', deficit: (1 - feasibility) * WEIGHTS.feasibility, enabled: examDateValida },
    { key: 'friction', deficit: (1 - frictionScore) * WEIGHTS.friction, enabled: hasFriction }
  ]
    .filter((g) => g.enabled)
    .sort((a, b) => b.deficit - a.deficit);
  const dominantGap = gaps.length && gaps[0].deficit > 0.02 ? gaps[0].key : null;

  const remainingHoursLabel = Math.round(estimate.totalHoursNeeded || 0);
  const unstableNodes = radar ? radar.attention || 0 : 0;

  let rationale;
  if (dataScaduta) {
    rationale =
      'L\u2019appello impostato è già passato: se l\u2019hai sostenuto, segna l\u2019esito; altrimenti imposta il prossimo appello per riattivare il verdetto.';
  } else if (!hasNodes) {
    rationale = 'Nessun nodo tracciato per questa materia: senza programma mappato non c\'è niente da misurare.';
  } else if (dominantGap === 'coverage') {
    rationale = `Programma coperto al ${pct(coverage)}%: restano circa ${remainingHoursLabel}h di lavoro mai affrontato.`;
  } else if (dominantGap === 'stability') {
    rationale = `Il programma c'è (${pct(coverage)}% coperto) ma non tiene: ${unstableNodes} nodi in allerta Spider-Sense o giudicati Difficili all'ultimo ripasso.`;
  } else if (dominantGap === 'feasibility') {
    rationale = `Al tuo ritmo reale servono ancora ${estimate.totalDaysNeeded} giorni, ne restano ${daysRemaining ?? '—'}: la traiettoria non chiude in tempo.`;
  } else if (dominantGap === 'friction') {
    rationale = `Attrito alto (${Math.round(avgFriction)}% di ripassi giudicati Difficili): il programma è coperto ma ti costa ancora troppo.`;
  } else {
    rationale = `Programma coperto al ${pct(coverage)}% e stabile al ${pct(stability)}%: la traiettoria chiude in tempo.`;
  }

  return {
    score,
    verdict,
    confidence,
    rationale,
    daysRemaining,
    parts: {
      coverage,
      stability,
      feasibility,
      friction: frictionScore
    },
    known: { hasNodes, hasStability, hasExamDate: examDateValida, hasFriction },
    dataScaduta,
    remainingHours: remainingHoursLabel,
    unstableNodes
  };
}

export default computeExamReadiness;
