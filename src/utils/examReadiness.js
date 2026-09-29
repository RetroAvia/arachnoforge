// =====================================================================
// ArachnoForge — src/utils/examReadiness.js (V42)
// EXAM READINESS INDEX — "mi presento o rimando?"
//
// V42 — riscritto sulle misure vere. La V41 misurava lo sforzo e i click,
// non la preparazione (verificato con i numeri):
//  - sole sintesi, niente studio: 78 "SOSTIENI" (le ore di sintesi
//    contavano come copertura);
//  - 8 argomenti su 10 spuntati "completati" e mai ripassati: 75;
//  - 150 giorni senza toccare la materia: ancora 66 "al limite";
//  - una confidenza bassa non cambiava mai il verdetto.
//
// Ora quattro pilastri, ciascuno su un dato che l'app misura davvero:
//
//   Copertura   40%  quanto programma hai STUDIATO (solo ore di studio,
//                    pesate per ore: la sintesi prepara il materiale, non
//                    lo mette in testa);
//   Memoria     30%  quanto ne RICORDI oggi: la probabilità di ricordo
//                    stimata dal modello FSRS (utils/spiderSense.js) sui
//                    nodi completati. Scende da sola col tempo;
//   Pratica     15%  esercizi, simulazioni d'esame e interrogazioni: la
//                    parte che decide uno scritto;
//   Fattibilità 15%  il piano globale (utils/studyPlanner.js) chiude il
//                    lavoro prima dell'esame, contando le altre materie?
//
// Un pilastro senza dati è IGNOTO: esce dal punteggio e abbassa la
// confidenza. SOSTIENI solo con copertura ≥ 90%, memoria ≥ 75%,
// confidenza ≥ 75% e — se c'è uno scritto — pratica misurata.
// =====================================================================
import { daysBetweenDateKeys, todayDateOnlyKey, addDaysToDateOnly } from './dateUtils.js';
import { nodeWorkBreakdown } from './sintesiEngine.js';
import { nodeRetrievability, retrievabilityAt } from './spiderSense.js';
import { haProvaScritta, formatoMeta } from './appelli.js';

export const WEIGHTS = {
  coverage: 0.4,
  memory: 0.3,
  practice: 0.15,
  feasibility: 0.15
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
export const READY_MIN_COVERAGE = 0.9;
export const READY_MIN_MEMORY = 0.75;
export const READY_MIN_CONFIDENCE = 0.75;
/** Finestra degli esercizi e delle interrogazioni che contano. */
export const PRACTICE_WINDOW_DAYS = 45;
/** Le simulazioni d'esame valgono più a lungo. */
export const SIMULATION_WINDOW_DAYS = 90;
/** Una copertura parziale su un argomento aperto non vale mai come chiuso. */
const OPEN_NODE_MAX_COVERAGE = 0.8;

function pct(n) {
  return Math.round(n * 100);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Pratica misurata su esercizi, simulazioni e interrogazioni recenti.
 * @returns {{value:number|null, esercizi:{fatti:number,corretti:number}|null, simulazioni:number[], quiz:{sapevo:number,totale:number}|null}}
 */
export function computePractice(materia, todayKey = todayDateOnlyKey()) {
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const limiteEs = addDaysToDateOnly(todayKey, -PRACTICE_WINDOW_DAYS);
  const limiteSim = addDaysToDateOnly(todayKey, -SIMULATION_WINDOW_DAYS);
  let fatti = 0;
  let corretti = 0;
  let sapevo = 0;
  let parziale = 0;
  let totaleQuiz = 0;
  sfide.forEach((s) => {
    (Array.isArray(s?.esercizi) ? s.esercizi : []).forEach((e) => {
      if (!e || String(e.at || '').slice(0, 10) < limiteEs) return;
      const f = Math.max(0, Number(e.fatti) || 0);
      fatti += f;
      corretti += Math.min(f, Math.max(0, Number(e.corretti) || 0));
    });
    (Array.isArray(s?.quizEsiti) ? s.quizEsiti : []).forEach((q) => {
      if (!q || String(q.at || '').slice(0, 10) < limiteEs) return;
      sapevo += Math.max(0, Number(q.sapevo) || 0);
      parziale += Math.max(0, Number(q.parziale) || 0);
      totaleQuiz += Math.max(0, Number(q.sapevo) || 0) + Math.max(0, Number(q.parziale) || 0) + Math.max(0, Number(q.no) || 0);
    });
  });
  const simulazioni = (Array.isArray(materia?.simulazioni) ? materia.simulazioni : [])
    .filter((x) => x && String(x.at || '').slice(0, 10) >= limiteSim && Number.isFinite(Number(x.punteggioPct)))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 3)
    .map((x) => clamp01(Number(x.punteggioPct) / 100));

  const parti = [];
  if (simulazioni.length > 0) parti.push({ w: 0.5, v: simulazioni.reduce((a, b) => a + b, 0) / simulazioni.length });
  if (fatti >= 3) parti.push({ w: 0.3, v: corretti / fatti });
  if (totaleQuiz >= 3) parti.push({ w: 0.2, v: (sapevo + parziale * 0.5) / totaleQuiz });
  const pesoTot = parti.reduce((a, p) => a + p.w, 0);
  return {
    value: pesoTot > 0 ? parti.reduce((a, p) => a + p.w * p.v, 0) / pesoTot : null,
    esercizi: fatti > 0 ? { fatti, corretti } : null,
    simulazioni,
    quiz: totaleQuiz > 0 ? { sapevo, parziale, totale: totaleQuiz } : null
  };
}

/**
 * @param {object} materia una voce di `state.materie` (con la data di pianificazione)
 * @param {object|null} _radar (non più usato: la memoria si calcola dai nodi)
 * @param {object|null} calibration pacchetto di utils/calibration.js
 * @param {{planQuota?:object|null, todayKey?:string}} [opts] la "quota" del planner globale
 */
export function computeExamReadiness(materia, _radar = null, calibration = null, { planQuota = null, todayKey = todayDateOnlyKey() } = {}) {
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide.filter(Boolean) : [];
  // Stesso `todayKey` di memoria e pratica: un solo "oggi" per tutto il verdetto.
  const rawDays = materia?.examDate ? daysBetweenDateKeys(todayKey, materia.examDate) : null;
  const dataScaduta = rawDays != null && rawDays < 0;
  const daysRemaining = dataScaduta ? null : rawDays;
  const examDateValida = !!materia?.examDate && !dataScaduta;
  const hasNodes = sfide.length > 0;
  const scritto = haProvaScritta(materia);

  // --- Copertura: solo studio, pesata per ore di studio ------------------
  let oreTot = 0;
  let oreFatte = 0;
  let completati = 0;
  const pesoNodo = new Map();
  sfide.forEach((s) => {
    const b = nodeWorkBreakdown(s, calibration);
    const peso = Math.max(0.5, b.oreStudioTotali);
    pesoNodo.set(s.id, peso);
    oreTot += peso;
    if (s.status === 'COMPLETED') {
      oreFatte += peso;
      completati += 1;
    } else {
      oreFatte += peso * Math.min(OPEN_NODE_MAX_COVERAGE, b.oreStudioTracciate / peso);
    }
  });
  const coverage = hasNodes && oreTot > 0 ? clamp01(oreFatte / oreTot) : 0;

  // --- Memoria: ricordo stimato oggi dei nodi completati ------------------
  let memPeso = 0;
  let memSomma = 0;
  let memEsameSomma = 0;
  let deboli = 0;
  sfide.forEach((s) => {
    if (s.status !== 'COMPLETED') return;
    const r = nodeRetrievability(s, todayKey);
    if (r == null) return;
    const w = pesoNodo.get(s.id) || 1;
    memPeso += w;
    memSomma += w * r;
    const re = examDateValida ? retrievabilityAt(s, materia.examDate) : r;
    memEsameSomma += w * (re ?? r);
    if (r < 0.7) deboli += 1;
  });
  const hasMemory = memPeso > 0;
  const memory = hasMemory ? clamp01(memSomma / memPeso) : null;
  const memoryAtExam = hasMemory ? clamp01(memEsameSomma / memPeso) : null;

  // --- Pratica -------------------------------------------------------------
  const practiceData = computePractice(materia, todayKey);
  const hasPractice = practiceData.value != null;
  const practice = hasPractice ? clamp01(practiceData.value) : null;

  // --- Fattibilità: il piano globale ----------------------------------------
  let feasibility = null;
  if (examDateValida && planQuota) {
    const tot = Math.max(0.5, (Number(planQuota.hoursRemaining) || 0) + (Number(planQuota.finalReviewHours) || 0));
    const late = Math.max(0, Number(planQuota.lateHours) || 0);
    feasibility = planQuota.hoursRemaining <= 0 ? 1 : clamp01(1 - late / tot);
  } else if (examDateValida && !planQuota) {
    feasibility = null;
  }
  const hasFeasibility = feasibility != null;

  // --- Punteggio sui pilastri noti ----------------------------------------
  const pillars = [
    { key: 'coverage', w: WEIGHTS.coverage, v: coverage, known: hasNodes },
    { key: 'memory', w: WEIGHTS.memory, v: memory, known: hasMemory },
    // Per un esame solo orale la pratica non è obbligatoria: se manca non
    // abbassa la confidenza (le interrogazioni contano solo se ci sono).
    { key: 'practice', w: WEIGHTS.practice, v: practice, known: hasPractice, optional: !scritto },
    { key: 'feasibility', w: WEIGHTS.feasibility, v: feasibility, known: hasFeasibility }
  ];
  const noti = pillars.filter((p) => p.known);
  const pesoNoti = noti.reduce((a, p) => a + p.w, 0);
  const score = pesoNoti > 0 ? Math.round((100 * noti.reduce((a, p) => a + p.w * p.v, 0)) / pesoNoti) : 0;
  const pesoApplicabile = pillars.filter((p) => !(p.optional && !p.known)).reduce((a, p) => a + p.w, 0);
  const confidence = pesoApplicabile > 0 ? Math.round((pesoNoti / pesoApplicabile) * 100) / 100 : 0;

  // --- Verdetto con le soglie oneste --------------------------------------
  let verdict;
  const gates = [];
  if (!hasNodes || dataScaduta) verdict = VERDICT.UNKNOWN;
  else {
    if (coverage < READY_MIN_COVERAGE) gates.push('coverage');
    if (!hasMemory || memory < READY_MIN_MEMORY) gates.push('memory');
    if (confidence < READY_MIN_CONFIDENCE) gates.push('confidence');
    if (scritto && !hasPractice) gates.push('practice');
    if (score >= READY_THRESHOLD && gates.length === 0) verdict = VERDICT.READY;
    else if (score >= BORDERLINE_THRESHOLD) verdict = VERDICT.BORDERLINE;
    else verdict = VERDICT.POSTPONE;
  }

  // --- Il motivo dominante, in una frase ---------------------------------
  const deficit = noti
    .map((p) => ({ key: p.key, d: (1 - p.v) * p.w }))
    .sort((a, b) => b.d - a.d);
  const dominantGap = deficit.length && deficit[0].d > 0.02 ? deficit[0].key : null;
  const oreDaStudiare = Math.round(Math.max(0, oreTot - oreFatte));
  const nonCompletati = sfide.length - completati;

  let rationale;
  if (dataScaduta) {
    rationale = "L'appello impostato è già passato: registra l'esito, oppure scegli il prossimo appello per riattivare il verdetto.";
  } else if (!hasNodes) {
    rationale = "Nessun argomento tracciato: senza programma mappato non c'è niente da misurare. Importa l'indice del corso per iniziare.";
  } else if (verdict === VERDICT.READY) {
    rationale = `Programma studiato al ${pct(coverage)}%, ricordo stimato al ${pct(memory)}%${hasPractice ? `, pratica al ${pct(practice)}%` : ''}: puoi presentarti.`;
  } else if (gates.includes('coverage') && (dominantGap === 'coverage' || coverage < 0.6)) {
    rationale = `Studiato il ${pct(coverage)}% del programma: ${nonCompletati} argomenti ancora aperti, circa ${oreDaStudiare}h di studio.`;
  } else if (dominantGap === 'memory' || (gates.includes('memory') && hasMemory)) {
    rationale = `Il programma c'è ma non tiene: ricordo stimato al ${pct(memory ?? 0)}%${deboli > 0 ? `, ${deboli} argomenti sotto il 70%` : ''}. Servono ripassi, non argomenti nuovi.`;
  } else if (gates.includes('practice')) {
    rationale = `Nessun esercizio o simulazione registrati: per uno ${formatoMeta(materia).haOrale ? 'scritto' : 'esame scritto'} la teoria non basta. Registra esercizi e fai almeno una simulazione.`;
  } else if (dominantGap === 'practice') {
    rationale = `Pratica al ${pct(practice)}%: gli esercizi ti costano ancora troppo. Allenati sulle tracce d'esame.`;
  } else if (dominantGap === 'feasibility') {
    rationale = `Col tuo ritmo e le altre materie in calendario il lavoro non chiude prima dell'esame (mancano ~${Math.round(planQuota?.lateHours || 0)}h).`;
  } else if (gates.includes('confidence')) {
    rationale = `Dati ancora parziali (confidenza ${pct(confidence)}%): il verdetto resta prudente finché non ci sono ripassi ed esercizi registrati.`;
  } else {
    rationale = `Programma studiato al ${pct(coverage)}% e ricordo al ${pct(memory ?? 0)}%.`;
  }

  return {
    score,
    verdict,
    confidence,
    rationale,
    daysRemaining,
    parts: {
      coverage,
      memory,
      practice,
      feasibility,
      // Compatibilità con chi leggeva i vecchi nomi.
      stability: memory,
      friction: practice
    },
    known: {
      hasNodes,
      hasMemory,
      hasPractice,
      hasFeasibility,
      practiceOptional: !scritto,
      hasStability: hasMemory,
      hasExamDate: examDateValida,
      hasFriction: hasPractice
    },
    gates,
    memoryAtExam,
    practiceData,
    dataScaduta,
    remainingHours: oreDaStudiare,
    unstableNodes: deboli
  };
}

export default computeExamReadiness;
