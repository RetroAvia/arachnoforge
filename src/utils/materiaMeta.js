import { daysUntilDateOnly, addDaysToDateOnly, todayDateOnlyKey } from './dateUtils.js';
import { nodeWorkBreakdown } from './sintesiEngine.js';
import { HOURS_PER_NODE_DAY, HOURS_PER_CFU } from './planningConstants.js';

// V38.0 — le due costanti vivono ora in un modulo foglia condiviso
// (planningConstants.js) perché servono anche a sintesiEngine.js, che
// questo file importa: erano finite duplicate a mano. Ri-esportate da
// qui perché mezzo progetto le importa già da questo percorso.
export { HOURS_PER_NODE_DAY, HOURS_PER_CFU };

export const GOBLIN_THRESHOLD_DAYS = 3;

/**
 * V36.0 — "Karen impara da te": HOURS_PER_NODE_DAY resta il FALLBACK
 * (profilo nuovo, storico insufficiente), non più l'unico valore
 * possibile. Quando `utils/calibration.js` ha abbastanza storico, la
 * capacità reale misurata sulle tue sessioni lo sostituisce, e con essa
 * il fattore di calibrazione che corregge le ore dichiarate di ogni nodo.
 * Nessun chiamante è obbligato a passarla: omettendola, il comportamento
 * è identico a quello pre-V36.0.
 */
function resolveCalibration(calibration) {
  const hoursPerDay = Number(calibration?.hoursPerDay);
  const biasFactor = Number(calibration?.biasFactor);
  const pagesPerHour = Number(calibration?.pagesPerHour);
  return {
    hoursPerDay: Number.isFinite(hoursPerDay) && hoursPerDay > 0 ? hoursPerDay : HOURS_PER_NODE_DAY,
    biasFactor: Number.isFinite(biasFactor) && biasFactor > 0 ? biasFactor : 1,
    // V37.0 — `null` quando non ancora affidabile: in quel caso i nodi
    // con le pagine dichiarate ricadono sulle ore stimate, senza che un
    // ritmo inventato entri nelle proiezioni.
    pagesPerHour: Number.isFinite(pagesPerHour) && pagesPerHour > 0 ? pagesPerHour : null
  };
}

/**
 * V37.0 — Costo in ore di UN nodo, in un solo posto per tutta l'app.
 *
 * Prima ogni motore rifaceva a mano `max(0.5, oreStimate) * biasFactor`,
 * e aggiungere le pagine avrebbe significato toccarli tutti (Quota
 * Odierna, Fine Prevista, Spider-Score, Exam Readiness, budget
 * giornaliero) con il rischio che uno restasse indietro e producesse
 * numeri diversi dagli altri. Ora esiste una sola funzione: chi cambia
 * qui, cambia ovunque.
 *
 * Due strade, in ordine di affidabilità:
 *   1. il nodo dichiara le PAGINE e l'app ha misurato un ritmo
 *      affidabile -> le ore si CALCOLANO (pagine / pagine-all'ora).
 *      Nessuna stima soggettiva entra nel conto;
 *   2. altrimenti -> le ore dichiarate, corrette dal bias storico.
 *
 * Vive qui e non in calibration.js per non creare un ciclo di import:
 * calibration.js dipende già da questo modulo (HOURS_PER_NODE_DAY), e
 * quella dipendenza deve restare a senso unico.
 *
 * V38.0 — "La Forgia degli Appunti": il costo di un nodo non è più una
 * cosa sola. Un argomento di cui devi ancora RICAVARE gli appunti da
 * libro e slide costa due lavori distinti — la sintesi e lo studio — e
 * il calcolo vero vive ora in `sintesiEngine.nodeWorkBreakdown`. Questa
 * funzione resta la porta d'ingresso di tutta l'app proprio perché non
 * doveva cambiare niente a valle: Quota Odierna, Fine Prevista,
 * Spider-Score, Exam Readiness, budget giornaliero e stima di laurea
 * hanno ereditato le fonti senza che una sola riga di quei motori sia
 * stata toccata. Un nodo senza fonti e senza pagine si comporta
 * esattamente come in V37.
 */
export function nodeBudgetHours(sfida, calibration = null) {
  const cal = resolveCalibration(calibration);
  return nodeWorkBreakdown(sfida, {
    biasFactor: cal.biasFactor,
    pagesPerHour: cal.pagesPerHour,
    sintesiPagesPerHour: calibration?.sintesiPagesPerHour ?? null,
    resaSintesi: calibration?.resaSintesi ?? null
  }).oreTotali;
}

/**
 * Ore ancora DAVANTI su un nodo — diverso dal budget totale non appena
 * una parte della sintesi è già stata fatta.
 *
 * Distinzione necessaria da quando esistono le fonti: un nodo con 200
 * pagine di libro di cui 150 già snellite ha ancora il budget pieno
 * (il nodo, da zero, costa quello) ma un residuo molto più piccolo. È
 * il residuo che deve guidare le proiezioni, altrimenti il piano non si
 * accorcia mai mentre lavori.
 */
export function nodeRemainingBudgetHours(sfida, calibration = null) {
  const cal = resolveCalibration(calibration);
  return nodeWorkBreakdown(sfida, {
    biasFactor: cal.biasFactor,
    pagesPerHour: cal.pagesPerHour,
    sintesiPagesPerHour: calibration?.sintesiPagesPerHour ?? null,
    resaSintesi: calibration?.resaSintesi ?? null
  }).oreResidue;
}

/**
 * Ore di lavoro ancora davanti per una Materia, in UNA sola definizione
 * condivisa da tutti i motori (Spider-Score, Quota Odierna, Exam
 * Readiness) — prima ne esistevano due varianti leggermente diverse in
 * file diversi, ed è da lì che nascevano le classifiche discordanti fra
 * "Primary Target" e "In focus oggi".
 *
 *  - con nodi: Σ (ore stimate calibrate - ore di Focus già tracciate),
 *    sui soli nodi non completati;
 *  - senza nodi: fallback puro su CFU × HOURS_PER_CFU.
 */
export function computeRemainingHours(materia, calibration = null) {
  // V37.0 — una Materia con esame già verbalizzato non ha più ore
  // residue, punto: non deve più comparire in nessun calcolo di carico,
  // nemmeno se qualche nodo è rimasto formalmente aperto.
  if (materia?.examPassed) return 0;
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  if (sfide.length === 0) {
    return Math.max(0, (Number(materia?.cfu) || 0) * HOURS_PER_CFU);
  }
  // V38.0 — la sottrazione del tempo già tracciato vive ora dentro
  // `nodeRemainingBudgetHours`, che sa distinguere le ore di studio da
  // quelle di sintesi. Toglierle qui entrambe, come faceva la V37,
  // scontava due volte il lavoro di snellimento già fatto: le sue ore
  // sparivano dal piano pur essendo già contate in pagine.
  return sfide
    .filter((s) => s && s.status !== 'COMPLETED')
    .reduce((sum, s) => sum + nodeRemainingBudgetHours(s, calibration), 0);
}

/**
 * Green Goblin Protocol: la materia entra in stato d'emergenza quando
 * mancano 3 giorni o meno alla data d'esame (e l'esame non è già passato).
 */
export function isGoblinProtocol(materia) {
  if (!materia.examDate) return false;
  const daysLeft = daysUntilDateOnly(materia.examDate);
  return daysLeft !== null && daysLeft <= GOBLIN_THRESHOLD_DAYS && daysLeft >= 0;
}

/**
 * V16.0 — Stima "Fine Prevista" millimetrica (Pillar 2).
 * V34.2 — "Ore Previste": la stima ora parte dalla somma ESATTA delle ORE
 * previste di ogni nodo ancora incompleto (unità più precisa e più utile
 * sia per Karen sia per l'utente stesso rispetto ai vecchi "giorni" a
 * numero intero), convertita in giorni di calendario tramite
 * HOURS_PER_NODE_DAY SOLO per proiettare la data "Fine Prevista" —
 * l'aritmetica del calendario resta in giorni (addDaysToDateOnly /
 * todayDateOnlyKey, stesso motore date-only usato per l'esame, zero drift
 * di fuso orario), ma il costo di ogni singolo nodo è ora granulare
 * (es. 1.5 ore), non più arrotondato per forza a un giorno intero.
 * Ogni nodo contribuisce almeno 0.5 ore (guardia anti dato corrotto/zero).
 */
export function computeEstimatedCompletion(materia, calibration = null) {
  const { hoursPerDay } = resolveCalibration(calibration);
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const total = sfide.length;
  const incomplete = sfide.filter((s) => s.status !== 'COMPLETED');
  const remaining = incomplete.length;

  if (remaining <= 0 && total > 0) {
    return { done: true, remaining: 0, dateKey: null, totalDaysNeeded: 0, totalHoursNeeded: 0, rawHoursNeeded: 0 };
  }
  if (materia?.examPassed) {
    return { done: true, remaining: 0, dateKey: null, totalDaysNeeded: 0, totalHoursNeeded: 0, rawHoursNeeded: 0 };
  }
  // V39.0 — Una materia SENZA nodi non è "completata": è una materia di
  // cui non hai ancora mappato il programma. Prima risultava `done` e il
  // Web-Matrix scriveva "Nodo Web-Matrix completato" su un esame da 9 CFU
  // mai iniziato, mentre Quota Odierna, Spider-Score e stima di laurea
  // gli attribuivano 90 ore. Ora usa la stessa stima da CFU degli altri
  // motori, e lo dichiara con `senzaNodi`.
  if (total === 0) {
    const ore = Math.round(computeRemainingHours(materia, calibration) * 100) / 100;
    if (ore <= 0) {
      return { done: true, remaining: 0, dateKey: null, totalDaysNeeded: 0, totalHoursNeeded: 0, rawHoursNeeded: 0 };
    }
    const giorni = Math.max(1, Math.ceil(ore / hoursPerDay));
    return {
      done: false,
      senzaNodi: true,
      remaining: 0,
      dateKey: addDaysToDateOnly(todayDateOnlyKey(), giorni),
      totalDaysNeeded: giorni,
      totalHoursNeeded: ore,
      rawHoursNeeded: ore
    };
  }

  const rawHoursNeeded = incomplete.reduce((sum, s) => sum + Math.max(0.5, Number(s.oreStimate) || 0), 0);
  // V36.0 — le ore residue sono quelle DICHIARATE corrette dal tuo bias
  // storico: se finora ogni nodo ti è costato il 40% in più di quanto
  // avevi stimato, la proiezione lo sa e smette di essere ottimistica.
  // V37.0 — e dove le pagine sono dichiarate, non si corregge più una
  // stima: si calcolano le ore dal ritmo reale (vedi nodeBudgetHours).
  // V38.0 — residuo e non budget pieno: un nodo con 150 delle sue 200
  // pagine di libro già snellite deve accorciare la Fine Prevista
  // mentre ci lavori, non solo quando lo chiudi.
  const totalHoursNeeded =
    Math.round(incomplete.reduce((sum, s) => sum + nodeRemainingBudgetHours(s, calibration), 0) * 100) / 100;
  const totalDaysNeeded = Math.max(1, Math.ceil(totalHoursNeeded / hoursPerDay));
  const dateKey = addDaysToDateOnly(todayDateOnlyKey(), totalDaysNeeded);
  return { done: false, remaining, dateKey, totalDaysNeeded, totalHoursNeeded, rawHoursNeeded };
}
