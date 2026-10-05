// =====================================================================
// ArachnoForge — src/utils/studyPlanner.js (V42)
// IL PIANO DI STUDIO GLOBALE.
//
// Fino alla V41 il piano del giorno ragionava materia per materia:
// "ore residue / giorni all'esame" per ciascuna, poi un controllo di
// carico cumulativo a parte e un budget ripartito in proporzione. Difetti
// verificati con i numeri:
//
//  - la capacità si SPRECAVA: in monotask una materia con 2 ore residue
//    teneva tutta la giornata e l'avanzo andava solo a materie senza data
//    ("Oggi 24m, margine libero 4h06" con un esame critico fra 20 giorni);
//  - "Oggi" non finiva mai: la quota era residuo/giorni, e dopo 4h30 di
//    studio mostrava ancora "Oggi 4h03m";
//  - la Fine Prevista di ogni materia supponeva l'INTERA capacità per sé:
//    due esami da 40 ore a 12 e 14 giorni risultavano entrambi finiti il
//    6 ottobre;
//  - in sovraccarico il riparto era proporzionale (il contrario di
//    "prima la scadenza più vicina") e i ripassi non esistevano nei conti.
//
// Ora c'è UN solo modello per tutte le materie insieme, costruito sui
// giorni veri (capacità del singolo giorno: riposo, lezioni, fase, giorno
// della settimana — vedi calibration.capacityForDate).
//
// Il lavoro di ogni materia è fatto di "lavori" con una scadenza:
//   S — sintesi degli appunti (ore residue di fonti da snellire)
//   T — studio (sui tuoi appunti; senza nodi, la stima dai CFU)
//   F — ripasso finale: un passaggio su ogni argomento in ciascuna delle
//       tre finestre prima dell'esame (vedi spiderSense.CHECKPOINT_WINDOWS)
// Scadenza: il giorno prima della prossima prova (scritto, poi orale).
// I ripassi già in calendario occupano il loro giorno.
//
// Due passate:
//  1. ALL'INDIETRO (ALAP): dall'ultima scadenza verso domani, ogni
//     lavoro il più TARDI possibile. Quello che non ci sta da domani in
//     poi va fatto OGGI: è il MINIMO di oggi, materia per materia. La
//     stessa passata dà l'ultimo giorno utile per iniziare e per chiudere
//     gli appunti, tenendo conto di tutte le materie insieme.
//  2. IN AVANTI (EDF, prima la scadenza più vicina): simula i giorni a
//     venire seguendo il piano consigliato e dà la Fine Prevista vera, i
//     ritardi e lo stato di ogni materia.
//
// La giornata di oggi = ripassi dovuti + minimo + riserva per le lezioni
// da sistemare + ANTICIPO sulla scadenza più vicina fino a riempire la
// capacità (al massimo due materie, salvo sovraccarico).
//
// Il piano è calcolato "da inizio giornata" (residuo di adesso + quanto
// già fatto oggi): gli obiettivi di oggi restano fermi mentre studi e
// quello che fai li consuma — "fatto 2h10 di 4h30".
//
// Modulo PURO: nessun React, nessun orologio letto di nascosto (todayKey
// entra come parametro), nessuna mutazione degli input.
// =====================================================================
import { addDaysToDateOnly, daysBetweenDateKeys, todayDateOnlyKey, isValidDateKey, localDateKeyOf } from './dateUtils.js';
import { nodeWorkBreakdown } from './sintesiEngine.js';
import { capacityForDate, DEFAULT_REVIEW_MINUTES } from './calibration.js';
import { CHECKPOINT_WINDOWS } from './spiderSense.js';
import { getPrerequisiteStatus } from '../data/vanvitelliCourseMap.js';
import { HOURS_PER_CFU, HOURS_PER_NODE_DAY } from './planningConstants.js';

export const PLAN_RATIO_OK = 0.9;
export const PLAN_RATIO_LIMITE = 1.15;
export const MAX_SUBJECTS_PER_DAY = 2;
export const MONOTASK_DAYS = 10;
export const LESSON_RESERVE_SHARE = 0.4;
export const HORIZON_MAX_DAYS = 365;
/** Quota massima della giornata che i ripassi arretrati possono occupare. */
export const REVIEW_SHARE_MAX = 0.5;
/**
 * Lontano dagli esami (la scadenza più vicina oltre 21 giorni) l'anticipo
 * si divide fra le due materie più vicine, in proporzione al lavoro che
 * resta: due materie in parallelo, come durante il semestre. Dentro le
 * tre settimane vale la regola secca: prima la scadenza più vicina.
 */
export const PARALLEL_BEYOND_DAYS = 21;
/** Sotto questo ritardo (ore) è arrotondamento, non un esame fuori tempo. */
export const LATE_TOLERANCE_HOURS = 0.25;
/** Tolleranza: mezzo minuto, in ore. */
const EPS = 1 / 120;

export const PLAN_STATUS = {
  OTTIMALE: 'OTTIMALE',
  ATTENZIONE: 'ATTENZIONE',
  CRITICO: 'CRITICO',
  CONGELATA: 'CONGELATA'
};

const SEVERITY = { CRITICO: 0, ATTENZIONE: 1, OTTIMALE: 2, CONGELATA: 3 };

export function statusFromPlanRatio(ratio) {
  if (!Number.isFinite(ratio)) return PLAN_STATUS.CRITICO;
  if (ratio <= PLAN_RATIO_OK) return PLAN_STATUS.OTTIMALE;
  if (ratio <= PLAN_RATIO_LIMITE) return PLAN_STATUS.ATTENZIONE;
  return PLAN_STATUS.CRITICO;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function dateKey(v) {
  if (typeof v !== 'string') return null;
  const k = v.slice(0, 10);
  return isValidDateKey(k) ? k : null;
}

/* ------------------------------------------------------------------ *
 * IL LAVORO DI UNA MATERIA
 * ------------------------------------------------------------------ */

/**
 * Ore residue di una materia, divise per tipo di lavoro, adesso.
 * @returns {{sintesi:number, studio:number, hasNodes:boolean, stimaDaCfu:boolean, apertiIds:string[]}}
 */
export function materiaWorkNow(materia, calibration) {
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide.filter(Boolean) : [];
  if (materia?.examPassed) return { sintesi: 0, studio: 0, hasNodes: sfide.length > 0, stimaDaCfu: false, apertiIds: [] };
  if (sfide.length === 0) {
    const libere = Math.max(0, Number(materia?.focusMinutesLibere) || 0) / 60;
    const studio = Math.max(0, (Number(materia?.cfu) || 0) * HOURS_PER_CFU - libere);
    return { sintesi: 0, studio: round2(studio), hasNodes: false, stimaDaCfu: true, apertiIds: [] };
  }
  let sintesi = 0;
  let studio = 0;
  const apertiIds = [];
  sfide.forEach((s) => {
    if (s.status === 'COMPLETED') return;
    const b = nodeWorkBreakdown(s, calibration);
    sintesi += b.oreSintesiResidue;
    studio += b.oreStudioResidueNette;
    apertiIds.push(s.id);
  });
  return { sintesi: round2(sintesi), studio: round2(studio), hasNodes: true, stimaDaCfu: false, apertiIds };
}

/**
 * Ore di ripasso finale ancora da programmare, finestra per finestra:
 * un passaggio per argomento in ogni finestra non ancora chiusa, salvo
 * che il suo ripasso sia già in calendario dentro quella finestra.
 */
export function finalReviewJobs(materia, examKey, todayKey, reviewMinutes) {
  const exam = dateKey(examKey);
  if (!exam || exam <= todayKey) return [];
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide.filter(Boolean) : [];
  if (sfide.length === 0) return [];
  const min = Number(reviewMinutes) > 0 ? Number(reviewMinutes) : DEFAULT_REVIEW_MINUTES;
  return CHECKPOINT_WINDOWS.map((w, index) => {
    const start = addDaysToDateOnly(exam, -w.from);
    const end = addDaysToDateOnly(exam, -w.to);
    if (end < todayKey) return null;
    // Coperto: il suo ripasso cade già nella finestra (lo porta il blocco
    // dei ripassi del giorno) oppure l'hai già ripassato dentro la finestra
    // (dopo il ripasso la prossima data esce dalla finestra, ma il
    // passaggio c'è stato: prima il lavoro "ricresceva").
    const coperti = sfide.filter((s) => {
      if (s.status !== 'COMPLETED') return false;
      if (s.nextReviewDate && s.nextReviewDate >= start && s.nextReviewDate <= end) return true;
      const ultimo = localDateKeyOf(s.lastReviewedAt) || '';
      return !!ultimo && ultimo >= start && ultimo <= end;
    }).length;
    const argomenti = Math.max(0, sfide.length - coperti);
    const hours = round2((argomenti * min) / 60);
    if (hours <= EPS) return null;
    return { index, startKey: start < todayKey ? todayKey : start, endKey: end, hours, argomenti };
  }).filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * COSTRUZIONE DEL MODELLO
 * ------------------------------------------------------------------ */

function doneFor(doneToday, id) {
  const d = doneToday && typeof doneToday.get === 'function' ? doneToday.get(id) : doneToday?.[id];
  return {
    sintesi: Math.max(0, Number(d?.sintesi) || 0),
    studio: Math.max(0, Number(d?.studio) || 0) + Math.max(0, Number(d?.esercizi) || 0),
    ripasso: Math.max(0, Number(d?.ripasso) || 0),
    altro: Math.max(0, Number(d?.altro) || 0)
  };
}

function buildSubjects(materie, { calibration, todayKey, doneToday, reviewMinutes }) {
  const attive = (Array.isArray(materie) ? materie : []).filter((m) => m && !m.examPassed);
  return attive.map((m, index) => {
    const examKey = dateKey(m.examDate);
    const rawDays = examKey ? daysBetweenDateKeys(todayKey, examKey) : null;
    const dataScaduta = rawDays != null && rawDays < 0;
    const daysRemaining = dataScaduta ? null : rawDays;
    // L'ultimo giorno utile è la vigilia; con l'esame OGGI, oggi stesso.
    const deadlineDay = daysRemaining == null ? Infinity : Math.max(0, daysRemaining - 1);

    const prereq = m.courseId
      ? getPrerequisiteStatus(m.courseId, materie, { excludeMateriaId: m.id, dependentExamDate: examKey, todayKey })
      : { missing: [], pianificate: [], bloccanti: [] };
    const frozen = prereq.bloccanti.length > 0;

    const now = materiaWorkNow(m, calibration);
    const done = doneFor(doneToday, m.id);
    // "Da inizio giornata": il lavoro fatto oggi torna nel residuo, così
    // gli obiettivi di oggi non si rimpiccioliscono mentre studi.
    const sintesiStart = round2(now.sintesi + done.sintesi);
    const studioStart = round2(now.studio + done.studio);
    const finali = examKey && !dataScaduta ? finalReviewJobs(m, examKey, todayKey, reviewMinutes) : [];

    // Senza nodi e senza una data valida le ore sono solo la stima dai
    // CFU di un programma mai mappato: non sono lavoro da fare oggi.
    const haLavoro = !(now.stimaDaCfu && daysRemaining == null) && now.sintesi + now.studio > EPS;

    return {
      index,
      materia: m,
      id: m.id,
      nome: m.nome,
      examKey,
      daysRemaining,
      dataScaduta,
      deadlineDay,
      frozen,
      prereq,
      hasNodes: now.hasNodes,
      stimaDaCfu: now.stimaDaCfu,
      sintesiNow: now.sintesi,
      studioNow: now.studio,
      sintesiStart,
      studioStart,
      finali,
      done,
      haLavoro
    };
  });
}

function makeJobs(subjects, todayKey) {
  const jobs = [];
  subjects.forEach((s, si) => {
    if (s.frozen) return;
    const plannable = s.haLavoro || s.finali.length > 0;
    if (!plannable) return;
    const dl = s.deadlineDay;
    if (s.haLavoro && s.sintesiStart > EPS) jobs.push({ si, kind: 'S', release: 0, deadline: dl, hours: s.sintesiStart, order: 0 });
    if (s.haLavoro && s.studioStart > EPS) jobs.push({ si, kind: 'T', release: 0, deadline: dl, hours: s.studioStart, order: 1 });
    s.finali.forEach((f) => {
      const release = Math.max(0, daysBetweenDateKeys(todayKey, f.startKey));
      const deadline = Math.max(0, daysBetweenDateKeys(todayKey, f.endKey));
      jobs.push({ si, kind: 'F', release, deadline, hours: f.hours, order: 2, window: f.index });
    });
  });
  return jobs;
}

/* ------------------------------------------------------------------ *
 * CAPACITÀ GIORNO PER GIORNO
 * ------------------------------------------------------------------ */

function routineReviewLoad(materie, todayKey, horizonKey, reviewMinutes) {
  const min = Number(reviewMinutes) > 0 ? Number(reviewMinutes) : DEFAULT_REVIEW_MINUTES;
  const load = new Map();
  (Array.isArray(materie) ? materie : []).forEach((m) => {
    if (!m || m.examPassed) return;
    (Array.isArray(m.sfide) ? m.sfide : []).forEach((s) => {
      if (!s || s.status !== 'COMPLETED' || !s.nextReviewDate) return;
      const d = s.nextReviewDate;
      if (d <= todayKey || d > horizonKey) return;
      load.set(d, (load.get(d) || 0) + min / 60);
    });
  });
  return load;
}

/** Ripassi dovuti oggi (scaduti compresi) e quelli già fatti oggi, per materia. */
export function reviewsToday(materie, todayKey, reviewMinutes) {
  const min = Number(reviewMinutes) > 0 ? Number(reviewMinutes) : DEFAULT_REVIEW_MINUTES;
  const perMateria = new Map();
  let due = 0;
  let doneCount = 0;
  (Array.isArray(materie) ? materie : []).forEach((m) => {
    if (!m || m.examPassed) return;
    let d = 0;
    let f = 0;
    const ids = [];
    (Array.isArray(m.sfide) ? m.sfide : []).forEach((s) => {
      if (!s || s.status !== 'COMPLETED') return;
      if (s.nextReviewDate && s.nextReviewDate <= todayKey) {
        d += 1;
        ids.push(s.id);
      } else if (localDateKeyOf(s.lastReviewedAt) === todayKey && Number(s.reviewCount) > 0) {
        f += 1;
      }
    });
    if (d + f > 0) perMateria.set(m.id, { due: d, done: f, hours: round2((d * min) / 60), sfidaIds: ids });
    due += d;
    doneCount += f;
  });
  return { due, done: doneCount, total: due + doneCount, hours: round2((due * min) / 60), perMateria, minutes: min };
}

/* ------------------------------------------------------------------ *
 * LE DUE PASSATE
 * ------------------------------------------------------------------ */

/**
 * ALAP: ogni lavoro il più tardi possibile, da `lastDay` a domani (giorno
 * 1). Ritorna i residui non collocabili (da fare OGGI) e, per ogni
 * materia, il primo giorno in cui la passata ha dovuto metterla (l'ultimo
 * giorno utile per iniziare) e il primo giorno di studio (chiusura
 * appunti = il giorno prima).
 *
 * V42 — "inizia entro" si legge sul lavoro VERO (sintesi e studio): un
 * passaggio di ripasso finale in una finestra lontana non è l'inizio
 * della materia. Solo per una materia già tutta studiata vale il primo
 * ripasso finale.
 */
function alapPass(jobs, subjects, avail, lastDay) {
  const rem = jobs.map((j) => j.hours);
  const firstDay = subjects.map(() => null);
  const firstReviewDay = subjects.map(() => null);
  const studioFirstDay = subjects.map(() => null);
  for (let d = lastDay; d >= 1; d -= 1) {
    let cap = avail[d] || 0;
    if (cap <= EPS) continue;
    const disponibili = jobs
      .map((j, k) => k)
      .filter((k) => rem[k] > EPS && Number.isFinite(jobs[k].deadline) && jobs[k].deadline >= d && jobs[k].release <= d)
      // Il più tardi possibile: prima i lavori con la scadenza più lontana,
      // e dentro una materia prima il ripasso finale, poi lo studio, poi
      // la sintesi (all'indietro l'ordine si inverte).
      .sort((a, b) => jobs[b].deadline - jobs[a].deadline || jobs[b].order - jobs[a].order || jobs[a].si - jobs[b].si);
    for (const k of disponibili) {
      if (cap <= EPS) break;
      const j = jobs[k];
      // Precedenza: la sintesi di una materia si colloca solo prima dello
      // studio della stessa materia (all'indietro: quando lo studio è tutto collocato).
      if (j.kind === 'S') {
        const studio = jobs.findIndex((x) => x.si === j.si && x.kind === 'T');
        if (studio >= 0 && rem[studio] > EPS) continue;
      }
      const x = Math.min(cap, rem[k]);
      rem[k] -= x;
      cap -= x;
      if (j.kind === 'F') firstReviewDay[j.si] = d;
      else firstDay[j.si] = d;
      if (j.kind === 'T') studioFirstDay[j.si] = d;
    }
  }
  return { rem, firstDay: firstDay.map((d, si) => d ?? firstReviewDay[si]), studioFirstDay };
}

/**
 * V42 — Il parallelo non deve costare l'esame più vicino. Con la
 * scadenza più vicina `D`, dividere il tempo fino a `D - 22` (poi scatta
 * l'EDF secco) lascia alla sua materia circa `quota` della capacità di
 * quei giorni più tutta quella delle ultime tre settimane. Il parallelo è
 * ammesso solo se così il suo lavoro chiude con margine (≤ 90%); se no si
 * lavora per scadenza da subito. Prima due esami da 150 ore a 40 e 50
 * giorni si dividevano la giornata per 17 giorni e il PRIMO, che da solo
 * ci stava, finiva 10 ore in ritardo.
 */
function parallelSafe(cap, d, D, quota, domanda, avail) {
  const confine = D - PARALLEL_BEYOND_DAYS - 1;
  let c1 = cap;
  let c2 = 0;
  for (let x = d + 1; x <= D; x += 1) {
    const c = Math.max(0, Number(avail?.[x]) || 0);
    if (x <= confine) c1 += c;
    else c2 += c;
  }
  return domanda <= PLAN_RATIO_OK * (quota * c1 + c2) + EPS;
}

/**
 * Riempie `cap` ore del giorno `d` coi lavori disponibili. Regola:
 *  - lavori con scadenza entro PARALLEL_BEYOND_DAYS, o sovraccarico:
 *    prima la scadenza più vicina (EDF secco);
 *  - altrimenti le due materie più vicine si dividono il tempo in
 *    proporzione al loro lavoro residuo, purché la più vicina resti in
 *    tempo con margine (vedi parallelSafe);
 *  - le materie senza data prendono solo quello che avanza.
 * `onAlloc(k, ore)` riceve ogni assegnazione. Ritorna le ore non usate.
 */
function fillDay(cap, d, jobs, rem, subjects, { maxSubjects = MAX_SUBJECTS_PER_DAY, chosen = null, onAlloc, avail = null }) {
  let left = cap;
  const scelte = chosen || new Set();
  const disponibili = jobs
    .map((j, k) => k)
    .filter((k) => rem[k] > EPS && jobs[k].release <= d)
    .sort((a, b) => jobs[a].deadline - jobs[b].deadline || jobs[a].si - jobs[b].si || jobs[a].order - jobs[b].order);
  if (disponibili.length === 0 || left <= EPS) return left;

  const take = (k, max) => {
    const x = Math.min(left, rem[k], max);
    if (x <= EPS) return 0;
    rem[k] -= x;
    left -= x;
    scelte.add(jobs[k].si);
    onAlloc(k, x);
    return x;
  };
  const conScadenza = disponibili.filter((k) => Number.isFinite(jobs[k].deadline));
  const primo = conScadenza.length ? jobs[conScadenza[0]].deadline - d : Infinity;

  // Due materie in parallelo, pesate sul lavoro residuo (sintesi+studio).
  const materie = [];
  conScadenza.forEach((k) => {
    const si = jobs[k].si;
    if (!materie.includes(si) && (materie.length < maxSubjects || scelte.has(si))) materie.push(si);
  });
  const residuo = (si) => jobs.reduce((sum, j, k) => sum + (j.si === si && j.release <= d ? rem[k] : 0), 0);
  const pesi = materie.map((si) => residuo(si));
  const totale = pesi.reduce((a, b) => a + b, 0);
  let parallelo = Number.isFinite(primo) && primo > PARALLEL_BEYOND_DAYS && scelte.size <= 1 && materie.length > 1;
  if (parallelo) {
    // La scadenza d'ESAME più vicina (una finestra di ripasso finale può
    // chiudersi prima, ma è l'esame che il parallelo non deve compromettere).
    const D = Math.min(...conScadenza.map((k) => subjects[jobs[k].si].deadlineDay));
    const vicine = materie.filter((si) => subjects[si].deadlineDay === D);
    const quotaVicine = totale > EPS ? vicine.reduce((sum, si) => sum + pesi[materie.indexOf(si)], 0) / totale : 1;
    const domanda = jobs.reduce((sum, j, k) => sum + (Number.isFinite(j.deadline) && j.deadline <= D ? rem[k] : 0), 0);
    parallelo = parallelSafe(cap, d, D, quotaVicine, domanda, avail);
  }
  if (parallelo) {
    const quota = materie.map((si, i) => (totale > EPS ? (cap * pesi[i]) / totale : 0));
    materie.forEach((si, i) => {
      let q = quota[i];
      disponibili
        .filter((k) => jobs[k].si === si)
        .forEach((k) => {
          if (q <= EPS) return;
          q -= take(k, q);
        });
    });
  }
  // EDF secco su quello che resta (o su tutto, vicino agli esami).
  for (const k of disponibili) {
    if (left <= EPS) break;
    const si = jobs[k].si;
    if (!scelte.has(si) && scelte.size >= maxSubjects && Number.isFinite(jobs[k].deadline)) continue;
    take(k, Infinity);
  }
  // Avanza ancora tempo: meglio un'altra materia che una giornata sprecata.
  for (const k of disponibili) {
    if (left <= EPS) break;
    take(k, Infinity);
  }
  return left;
}

/**
 * EDF in avanti dal giorno 1, a partire dai residui `rem` dopo la
 * giornata di oggi. Riempie ogni giorno con i lavori a scadenza più
 * vicina (precedenza sintesi -> studio dentro la materia).
 *
 * V42 — il lavoro che alla vigilia dell'esame non è stato fatto NON si
 * programma dopo l'esame: si misura come ritardo e si toglie dal
 * calendario. Prima continuava a occupare i giorni successivi, rubando
 * tempo alle materie dopo (il ritardo di una si propagava a tutte) e
 * mostrando studio per un esame già passato. La fine prevista di una
 * materia in ritardo si proietta al ritmo che aveva nell'ultima
 * settimana prima dell'esame (`finishEstimated`). Lo stesso per i
 * passaggi di ripasso finale: una finestra chiusa non si recupera dopo.
 *
 * @param {number[]} todayStudy ore di sintesi+studio date OGGI a ogni materia
 */
function edfPass(jobs, subjects, avail, remStart, horizon, todayKey, keepTimelineDays, todayStudy = []) {
  const rem = [...remStart];
  const finishStudy = subjects.map(() => null);
  const finishEstimated = subjects.map(() => false);
  const lateStudy = subjects.map(() => 0);
  const lateFinal = subjects.map(() => 0);
  const timeline = [];
  // Ore di sintesi+studio per materia e giorno (solo le ultime, per il ritmo).
  const recenti = subjects.map(() => []);
  const studioLeft = (si) => jobs.reduce((sum, j, k) => sum + (j.si === si && j.kind !== 'F' ? rem[k] : 0), 0);
  const capMedia = (() => {
    const giorni = avail.slice(1, Math.max(2, Math.min(avail.length, horizon + 1)));
    const pos = giorni.filter((x) => x > EPS);
    return pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : HOURS_PER_NODE_DAY;
  })();
  /** Ritmo della materia nella settimana che finisce il giorno d (ore/giorno). */
  const ritmo = (si, d) => {
    const tot = recenti[si].filter((r) => r.d > d - 7).reduce((a, r) => a + r.x, 0) + (d < 7 ? Number(todayStudy[si]) || 0 : 0);
    const giorni = Math.min(7, d + 1);
    const v = tot / giorni;
    return v > 0.1 ? v : Math.max(0.25, capMedia / 2);
  };
  const chiudiScadenza = (si, d) => {
    const left = studioLeft(si);
    lateStudy[si] = round2(left);
    if (left <= EPS) return;
    // Un avanzo da arrotondamento (sotto la tolleranza) è "finito in tempo".
    const sub = subjects[si];
    const tolleranza = Math.max(LATE_TOLERANCE_HOURS, 0.02 * ((sub?.sintesiStart || 0) + (sub?.studioStart || 0)));
    if (left <= tolleranza) finishStudy[si] = d;
    else {
      finishStudy[si] = d + Math.max(1, Math.ceil(left / ritmo(si, d)));
      finishEstimated[si] = true;
    }
    jobs.forEach((j, k) => {
      if (j.si === si && j.kind !== 'F') rem[k] = 0;
    });
  };
  const chiudiFinestre = (d) => {
    jobs.forEach((j, k) => {
      if (j.kind === 'F' && j.deadline === d && rem[k] > EPS) {
        lateFinal[j.si] += rem[k];
        rem[k] = 0;
      }
    });
  };

  subjects.forEach((s, si) => {
    if (studioLeft(si) <= EPS && (s.haLavoro || s.finali.length)) finishStudy[si] = 0;
    // Scadenza OGGI (esame domani): il ritardo si misura già a fine giornata.
    if (s.deadlineDay === 0) chiudiScadenza(si, 0);
  });
  chiudiFinestre(0);

  for (let d = 1; d <= horizon; d += 1) {
    const cap = avail[d] || 0;
    const giorno = keepTimelineDays > 0 && d <= keepTimelineDays ? { day: d, dateKey: addDaysToDateOnly(todayKey, d), capacity: round2(cap), items: [] } : null;
    if (cap > EPS) {
      fillDay(cap, d, jobs, rem, subjects, {
        avail,
        onAlloc: (k, x) => {
          if (jobs[k].kind !== 'F') recenti[jobs[k].si].push({ d, x });
          if (giorno) giorno.items.push({ materiaId: subjects[jobs[k].si].id, kind: jobs[k].kind, hours: round2(x) });
        }
      });
    }
    // Chiusure e ritardi alla fine del giorno d: prima le scadenze (che
    // tolgono il non fatto), poi chi ha finito davvero.
    subjects.forEach((s, si) => {
      if (Number.isFinite(s.deadlineDay) && s.deadlineDay === d && finishStudy[si] == null) chiudiScadenza(si, d);
      if (finishStudy[si] == null && studioLeft(si) <= EPS) finishStudy[si] = d;
    });
    chiudiFinestre(d);
    if (giorno && giorno.items.length > 0) timeline.push(giorno);
    if (rem.every((r) => r <= EPS)) break;
  }
  return { rem, finishStudy, finishEstimated, lateStudy, lateFinal: lateFinal.map(round2), timeline };
}

/* ------------------------------------------------------------------ *
 * IL PIANO
 * ------------------------------------------------------------------ */

/**
 * @param {Array} materie materie del Web-Matrix, con `examDate` già alla
 *        data di pianificazione (vedi appelli.withPlanningDates)
 * @param {object} opts
 * @param {object} [opts.calibration] pacchetto di computeCalibration
 * @param {object} [opts.calendar] buildCampusCalendar (fase e ore di lezione per data)
 * @param {string} [opts.todayKey]
 * @param {Map|object} [opts.doneToday] materiaId -> { sintesi, studio, esercizi, ripasso, altro } ore fatte oggi
 * @param {number} [opts.loadAdjustmentPct] riduzione del carico di oggi (K.A.R.E.N.), -50..0
 * @param {Array<{materiaId:string, ore:number}>} [opts.lessonQueue] sintesi delle lezioni da sistemare
 * @param {boolean} [opts.lessonPhase] siamo in periodo di lezioni
 * @param {number} [opts.timelineDays] giorni di calendario da restituire (piano della sessione)
 */
export function computeStudyPlan(
  materie,
  {
    calibration = null,
    calendar = null,
    todayKey = todayDateOnlyKey(),
    doneToday = null,
    loadAdjustmentPct = 0,
    lessonQueue = null,
    lessonPhase = false,
    maxSubjects = MAX_SUBJECTS_PER_DAY,
    timelineDays = 120
  } = {}
) {
  const reviewMinutes = Number(calibration?.reviewMinutes) > 0 ? Number(calibration.reviewMinutes) : DEFAULT_REVIEW_MINUTES;
  const subjects = buildSubjects(materie, { calibration, todayKey, doneToday, reviewMinutes });
  const jobs = makeJobs(subjects, todayKey);

  const deadlines = jobs.map((j) => j.deadline).filter(Number.isFinite);
  const lastDeadline = deadlines.length ? Math.max(...deadlines) : 0;
  const horizon = Math.min(HORIZON_MAX_DAYS, Math.max(lastDeadline + 1, 60));
  const horizonKey = addDaysToDateOnly(todayKey, horizon);

  // --- capacità giorno per giorno -------------------------------------
  const ctxCal = { phaseOf: calendar?.phaseOf || null, lectureHoursOf: calendar?.lectureHoursOf || null };
  const safePct = Number.isFinite(Number(loadAdjustmentPct)) ? Math.max(-50, Math.min(0, Number(loadAdjustmentPct))) : 0;
  const routine = routineReviewLoad(materie, todayKey, horizonKey, reviewMinutes);
  const capacity = [];
  const avail = [];
  for (let d = 0; d <= horizon; d += 1) {
    const k = addDaysToDateOnly(todayKey, d);
    let c = capacityForDate(k, calibration, ctxCal);
    if (d === 0) c = c * (1 + safePct / 100);
    capacity.push(round2(c));
    avail.push(Math.max(0, c - (d === 0 ? 0 : routine.get(k) || 0)));
  }
  const capToday = capacity[0];
  const baseToday = safePct !== 0 ? round2(capToday / (1 + safePct / 100)) : capToday;

  // --- ripassi dovuti oggi ---------------------------------------------
  const rev = reviewsToday(materie, todayKey, reviewMinutes);
  // Un arretrato di ripassi (dopo una pausa) non si mangia la giornata:
  // al massimo metà della capacità di oggi, il resto scivola ai prossimi giorni.
  const reviewCapHours = capToday * REVIEW_SHARE_MAX;
  const reviewTargetHours = round2(Math.min((rev.total * reviewMinutes) / 60, Math.max(reviewCapHours, (rev.done * reviewMinutes) / 60)));
  const reviewTargetCount = Math.min(rev.total, Math.max(rev.done, Math.floor((reviewTargetHours * 60) / reviewMinutes + 1e-9)));
  const reviewDoneHours = round2((rev.done * reviewMinutes) / 60);
  avail[0] = Math.max(0, capToday - reviewTargetHours);

  // V43 — L'ARRETRATO RINVIATO OCCUPA DAVVERO I GIORNI DOPO. Fino alla
  // V42 i ripassi oltre la metà di oggi "scivolavano ai prossimi giorni"
  // solo a parole: domani riceveva comunque tutta la capacità di studio
  // nuovo, e il piano (fine prevista, stato) era più ottimista del vero.
  // Ora l'arretrato si spalma da domani, al massimo metà di ogni giornata,
  // finché non è smaltito.
  const reviewBacklogCount = Math.max(0, rev.total - reviewTargetCount);
  let backlogLeft = (reviewBacklogCount * reviewMinutes) / 60;
  const backlogByDay = [];
  for (let d = 1; d <= horizon && backlogLeft > EPS; d += 1) {
    const quota = Math.min(backlogLeft, capacity[d] * REVIEW_SHARE_MAX, avail[d]);
    if (quota <= EPS) continue;
    avail[d] = Math.max(0, avail[d] - quota);
    backlogLeft -= quota;
    backlogByDay.push({ dateKey: addDaysToDateOnly(todayKey, d), hours: round2(quota) });
  }

  // --- 1. ALAP: il minimo di oggi ------------------------------------------
  const alap = alapPass(jobs, subjects, avail, lastDeadline);
  const todayAlloc = jobs.map(() => 0);
  let libero = avail[0];
  const mandatoryBySubject = subjects.map(() => 0);
  jobs.forEach((j, k) => {
    const overflow = alap.rem[k];
    if (overflow <= EPS || !Number.isFinite(j.deadline) || j.release > 0) return;
    mandatoryBySubject[j.si] += overflow;
  });
  const totalMandatory = mandatoryBySubject.reduce((a, b) => a + b, 0);
  const overCapacity = totalMandatory > libero + EPS;
  // In sovraccarico il minimo va assegnato per scadenza (EDF), non in proporzione.
  jobs
    .map((j, k) => k)
    .filter((k) => alap.rem[k] > EPS && Number.isFinite(jobs[k].deadline) && jobs[k].release <= 0)
    .sort((a, b) => jobs[a].deadline - jobs[b].deadline || jobs[a].order - jobs[b].order || jobs[a].si - jobs[b].si)
    .forEach((k) => {
      const x = Math.min(libero, alap.rem[k]);
      todayAlloc[k] += x;
      libero -= x;
    });

  // --- rapporto di carico cumulativo per scadenza ----------------------
  // Domanda di tutti i lavori con scadenza entro quel giorno, contro la
  // capacità di tutti i giorni fino a lì (ripassi già in calendario esclusi).
  const capPrefix = [];
  avail.reduce((acc, c, i) => {
    capPrefix[i] = acc + c;
    return capPrefix[i];
  }, 0);
  const ratioAt = (day) => {
    const demand = jobs.reduce((sum, j) => sum + (Number.isFinite(j.deadline) && j.deadline <= day ? j.hours : 0), 0);
    const cap = capPrefix[Math.min(day, capPrefix.length - 1)] || 0;
    if (demand <= EPS) return 0;
    return cap > EPS ? demand / cap : Infinity;
  };
  const ratioBySubject = subjects.map((s) => (Number.isFinite(s.deadlineDay) && !s.frozen && (s.haLavoro || s.finali.length) ? ratioAt(s.deadlineDay) : null));

  // --- 2. riserva per le lezioni da sistemare -------------------------
  const voci = (Array.isArray(lessonQueue) ? lessonQueue : [])
    .filter((v) => v && v.materiaId && Number(v.ore) > 0)
    .map((v) => ({ materiaId: v.materiaId, ore: Number(v.ore) }));
  const richiestaOre = voci.reduce((sum, v) => sum + v.ore, 0);
  // Un esame "a rischio" (non OTTIMALE) toglie alle lezioni il diritto di
  // passare per prime: la riserva resta, ma dopo il minimo degli esami.
  const esameARischio = subjects.some((s) => ratioBySubject[s.index] != null && statusFromPlanRatio(ratioBySubject[s.index]) !== PLAN_STATUS.OTTIMALE);
  const edfFirst = subjects
    .filter((s) => !s.frozen && Number.isFinite(s.deadlineDay) && (s.haLavoro || s.finali.length))
    .sort((a, b) => a.deadlineDay - b.deadlineDay)[0];
  const monotaskCandidate = !!edfFirst && edfFirst.deadlineDay <= MONOTASK_DAYS;
  const quotaMax = monotaskCandidate ? 0 : Math.min(avail[0] * LESSON_RESERVE_SHARE, libero);
  let riservateOre = 0;
  const lessonBySubject = new Map();
  if (lessonPhase && richiestaOre > 0 && quotaMax > EPS) {
    let spazio = Math.min(richiestaOre, quotaMax);
    voci.forEach((v) => {
      if (spazio <= EPS) return;
      const s = subjects.find((x) => x.id === v.materiaId);
      const k = s ? jobs.findIndex((j) => j.si === s.index && j.kind === 'S') : -1;
      // Le lezioni si sistemano con la sintesi della loro materia: la
      // riserva È lavoro di sintesi di quella materia, non un blocco a parte.
      if (k < 0) return;
      const residuo = jobs[k].hours - todayAlloc[k];
      const x = Math.max(0, Math.min(spazio, v.ore, residuo));
      if (x <= EPS) return;
      todayAlloc[k] += x;
      spazio -= x;
      riservateOre += x;
      lessonBySubject.set(v.materiaId, (lessonBySubject.get(v.materiaId) || 0) + x);
    });
    libero = Math.max(0, libero - riservateOre);
  }
  riservateOre = round2(riservateOre);

  // --- 3. anticipo fino a riempire la giornata ----------------------------
  const scelte = new Set(subjects.filter((s) => mandatoryBySubject[s.index] > EPS).map((s) => s.index));
  const remAfterToday = jobs.map((j, k) => Math.max(0, j.hours - todayAlloc[k]));
  libero = fillDay(libero, 0, jobs, remAfterToday, subjects, {
    maxSubjects,
    chosen: scelte,
    avail,
    onAlloc: (k, x) => {
      todayAlloc[k] += x;
    }
  });

  // --- 4. EDF in avanti dai residui di fine giornata ----------------------
  const todayStudy = subjects.map((s) => jobs.reduce((sum, j, k) => sum + (j.si === s.index && j.kind !== 'F' ? todayAlloc[k] : 0), 0));
  const edf = edfPass(jobs, subjects, avail, remAfterToday, horizon, todayKey, timelineDays, todayStudy);

  // --- 6. risultato per materia ----------------------------------------
  const pressioneDaAltri = subjects.map(() => false);
  const perSubject = subjects.map((s) => {
    const mine = jobs.map((j, k) => ({ j, k })).filter(({ j }) => j.si === s.index);
    const oggi = { sintesi: 0, studio: 0, finale: 0 };
    mine.forEach(({ j, k }) => {
      if (j.kind === 'S') oggi.sintesi += todayAlloc[k];
      else if (j.kind === 'T') oggi.studio += todayAlloc[k];
      else oggi.finale += todayAlloc[k];
    });
    const lessonToday = lessonBySubject.get(s.id) || 0;
    const target = oggi.sintesi + oggi.studio + oggi.finale;
    const doneStudio = s.done.sintesi + s.done.studio;
    const ratio = ratioBySubject[s.index];
    let status;
    if (s.frozen) status = PLAN_STATUS.CONGELATA;
    else if (!s.haLavoro && s.finali.length === 0) status = PLAN_STATUS.OTTIMALE;
    else if (!Number.isFinite(s.deadlineDay)) status = PLAN_STATUS.ATTENZIONE;
    else {
      status = statusFromPlanRatio(ratio);
      const tolleranza = Math.max(LATE_TOLERANCE_HOURS, 0.02 * (s.sintesiStart + s.studioStart));
      if (edf.lateStudy[s.index] > tolleranza) status = PLAN_STATUS.CRITICO;
      else {
        // V42 — il SUO lavoro chiude in tempo seguendo il piano: il carico
        // cumulativo alto viene dagli esami prima (che non si recuperano
        // dopo la loro data). Attenzione, non critica.
        if (status === PLAN_STATUS.CRITICO) {
          status = PLAN_STATUS.ATTENZIONE;
          pressioneDaAltri[s.index] = true;
        }
        if ((edf.lateStudy[s.index] > EPS || edf.lateFinal[s.index] > tolleranza) && status === PLAN_STATUS.OTTIMALE) {
          status = PLAN_STATUS.ATTENZIONE;
        }
      }
    }
    const fs = edf.finishStudy[s.index];
    const latest = alap.firstDay[s.index];
    const studioDay = alap.studioFirstDay[s.index];
    const inizioEntro = mandatoryBySubject[s.index] > EPS ? 0 : latest;
    const chiusuraAppuntiDay =
      s.sintesiStart > EPS && Number.isFinite(s.deadlineDay)
        ? mine.some(({ j, k }) => j.kind === 'S' && alap.rem[k] > EPS)
          ? 0
          : studioDay != null
          ? Math.max(0, studioDay - 1)
          : s.deadlineDay
        : null;
    return {
      materiaId: s.id,
      nome: s.nome,
      examDate: s.examKey,
      daysRemaining: s.daysRemaining,
      dataScaduta: s.dataScaduta,
      deadlineDateKey: Number.isFinite(s.deadlineDay) ? addDaysToDateOnly(todayKey, s.deadlineDay) : null,
      hasNodes: s.hasNodes,
      stimaDaCfu: s.stimaDaCfu,
      senzaData: !Number.isFinite(s.deadlineDay),
      haLavoro: s.haLavoro,
      frozen: s.frozen,
      prereqBloccanti: s.prereq.bloccanti.map((b) => ({ nome: b.course.nome, dataKey: b.dataKey, materiaId: b.materia?.id || null })),
      prereqPianificate: s.prereq.pianificate.map((b) => ({ nome: b.course.nome, dataKey: b.dataKey, materiaId: b.materia?.id || null, inAttesaEsito: !!b.inAttesaEsito })),
      missingPrereqNames: s.prereq.bloccanti.map((b) => b.course.nome),
      hoursRemaining: round2(s.sintesiNow + s.studioNow),
      sintesiHours: s.sintesiNow,
      studioHours: s.studioNow,
      finalReviewHours: round2(s.finali.reduce((sum, f) => sum + f.hours, 0)),
      finalReviewWindows: s.finali,
      // In sovraccarico il "minimo per restare in tempo" supera la giornata:
      // si mostra quanto oggi ci sta davvero, e l'eccesso a parte.
      todayMinHours: round2(Math.min(mandatoryBySubject[s.index], target)),
      todayMinOverflowHours: round2(Math.max(0, mandatoryBySubject[s.index] - target)),
      todayTargetHours: round2(target),
      todaySintesiHours: round2(oggi.sintesi),
      todayStudioHours: round2(oggi.studio),
      todayFinalReviewHours: round2(oggi.finale),
      todayLessonHours: round2(lessonToday),
      doneTodayHours: round2(doneStudio + Math.min(s.done.ripasso, oggi.finale)),
      doneTodaySintesiHours: round2(s.done.sintesi),
      doneTodayStudioHours: round2(s.done.studio),
      doneTodayRipassoHours: round2(s.done.ripasso),
      remainingTodayHours: round2(Math.max(0, target - doneStudio - Math.min(s.done.ripasso, oggi.finale))),
      finePrevistaDateKey: fs != null && (s.haLavoro || s.finali.length) ? addDaysToDateOnly(todayKey, fs) : null,
      // V42 — oltre l'esame la fine è una proiezione al ritmo dell'ultima settimana.
      finePrevistaStimata: !!edf.finishEstimated[s.index],
      finePrevistaOltreOrizzonte: fs == null && s.haLavoro,
      inizioEntroDateKey: inizioEntro != null ? addDaysToDateOnly(todayKey, inizioEntro) : null,
      chiusuraAppuntiDateKey: chiusuraAppuntiDay != null ? addDaysToDateOnly(todayKey, chiusuraAppuntiDay) : null,
      lateHours: edf.lateStudy[s.index],
      lateFinalHours: edf.lateFinal[s.index],
      ratio: ratio != null && Number.isFinite(ratio) ? round2(ratio) : ratio,
      pressioneDaAltri: pressioneDaAltri[s.index],
      status,
      severity: SEVERITY[status] ?? 9
    };
  });

  // --- 7. la giornata ----------------------------------------------------
  const oggiMaterie = perSubject
    .filter((p) => p.todayTargetHours > EPS)
    .sort((a, b) => {
      const sa = subjects.find((x) => x.id === a.materiaId);
      const sb = subjects.find((x) => x.id === b.materiaId);
      return sa.deadlineDay - sb.deadlineDay || b.todayMinHours - a.todayMinHours || b.todayTargetHours - a.todayTargetHours;
    });
  const studyTarget = oggiMaterie.reduce((sum, p) => sum + p.todayTargetHours, 0);
  const doneTotal = subjects.reduce((sum, s) => sum + s.done.sintesi + s.done.studio + s.done.ripasso + s.done.altro, 0);
  const top = oggiMaterie[0] || null;
  const monotaskActive = !!top && monotaskCandidate && top.materiaId === edfFirst?.id && top.todayTargetHours >= 0.8 * Math.max(EPS, studyTarget);

  return {
    todayKey,
    subjects: perSubject,
    byMateriaId: new Map(perSubject.map((p) => [p.materiaId, p])),
    today: {
      capacityHours: capToday,
      baseCapacityHours: baseToday,
      loadAdjustmentPct: safePct,
      reviews: { ...rev, targetHours: reviewTargetHours, doneHours: reviewDoneHours, targetCount: reviewTargetCount, rinviati: reviewBacklogCount, rinviatiPerGiorno: backlogByDay },
      lessons: {
        voci,
        richiestaOre: round2(richiestaOre),
        riservateOre,
        tettoOre: round2(quotaMax),
        esameARischio,
        prima: riservateOre > EPS && !esameARischio && !monotaskCandidate
      },
      subjects: oggiMaterie,
      mandatoryHours: round2(totalMandatory),
      studyTargetHours: round2(studyTarget),
      targetHours: round2(studyTarget + reviewTargetHours),
      doneHours: round2(doneTotal),
      remainingHours: round2(Math.max(0, studyTarget + reviewTargetHours - doneTotal)),
      freeHours: round2(Math.max(0, libero)),
      overCapacity,
      deficitHours: round2(Math.max(0, totalMandatory - avail[0])),
      // V42 — ore di sintesi+studio che il piano lascia scoperte agli esami
      // (materie attive con una data): lo stesso numero del Piano della
      // sessione e della somma delle "scoperte all'esame" di ogni materia.
      // `deficitHours` resta il minimo di oggi che non ci sta nella giornata.
      lateHours: round2(perSubject.reduce((sum, p) => sum + (!p.frozen && p.daysRemaining != null ? p.lateHours : 0), 0)),
      criticalCount: perSubject.filter((p) => !p.frozen && p.daysRemaining != null && p.status === PLAN_STATUS.CRITICO).length,
      monotaskActive
    },
    timeline: edf.timeline,
    horizonDays: horizon
  };
}

/** Somma delle ore per materia di una giornata della timeline, per tipo. */
export function timelineDayTotals(day) {
  const out = new Map();
  (day?.items || []).forEach((it) => {
    const prev = out.get(it.materiaId) || { S: 0, T: 0, F: 0 };
    prev[it.kind] = round2(prev[it.kind] + it.hours);
    out.set(it.materiaId, prev);
  });
  return out;
}

export { HOURS_PER_NODE_DAY };
