import { computeSpiderScore, PIANO_CFU_TOTALI } from '../data/vanvitelliCourseMap.js';
import { computeRemainingHours, HOURS_PER_CFU } from './materiaMeta.js';
import { dateOnlyToUtcMs, todayDateOnlyKey, addDaysToDateOnly } from './dateUtils.js';

/**
 * GPA / Laurea Engine — V18.0 "The Multiverse Projection" (Pillar 3).
 *
 * Formule ufficiali del sistema universitario italiano, applicate senza
 * arrotondamenti nascosti:
 *  - Media Ponderata Reale = Somma(Voto × CFU) / Somma(CFU), sui soli
 *    esami con Esame Superato + un Voto (18-30) effettivamente registrato.
 *    "A scelta dello studente" e "Prova Finale" seguono la stessa regola:
 *    contano solo se e quando l'utente inserisce un voto per loro.
 *  - Proiezione di Laurea (voto di partenza, base 110) = Media Ponderata × 11 / 3.
 *    Nessun bonus tesi/attività extra: è il calcolo matematico puro
 *    richiesto, la commissione può sempre aggiungere punti a parte.
 */
export const MIN_VOTO = 18;
export const MAX_VOTO = 30;
export const LODE_VALUE = 30; // 30 e lode entra in media come 30 (convenzione standard italiana).
export const GRADUATION_MULTIPLIER = 11 / 3;
// V20.0 (Pillar 4): "due slider fittizi" — la Direttiva Suprema restringe
// esplicitamente lo scenario What-If ai 2 esami più prioritari secondo
// Karen, non più 3.
export const WHAT_IF_SLOT_COUNT = 2;
export const DEFAULT_WHAT_IF_VOTO = 27;

/** Una Materia "conta" per la media solo se l'esame è superato E ha un voto valido registrato. */
export function isGradedMateria(materia) {
  return !!materia && !!materia.examPassed && Number.isFinite(materia.voto) && materia.voto >= MIN_VOTO && materia.voto <= MAX_VOTO;
}

/**
 * Media Ponderata Reale sulle Materie già superate e votate.
 * @returns {{average:number|null, totalCfu:number, totalPoints:number, gradedCount:number}}
 */
export function computeWeightedAverage(materie) {
  const graded = (Array.isArray(materie) ? materie : []).filter(isGradedMateria);
  const totalCfu = graded.reduce((sum, m) => sum + (Number(m.cfu) || 0), 0);
  const totalPoints = graded.reduce((sum, m) => sum + (Number(m.cfu) || 0) * m.voto, 0);
  const average = totalCfu > 0 ? totalPoints / totalCfu : null;
  return { average, totalCfu, totalPoints, gradedCount: graded.length };
}

/** Proiezione di Laurea (voto di partenza su base 110) dalla Media Ponderata. Null se non c'è ancora nessun voto registrato. */
export function computeGraduationProjection(average) {
  if (average == null || !Number.isFinite(average)) return null;
  const raw = average * GRADUATION_MULTIPLIER;
  return Math.round(raw * 10) / 10;
}

/**
 * Combina la Media Ponderata reale con un set di esami "What-If" simulati
 * (non ancora superati davvero), per proiettare l'effetto di voti
 * ipotetici sul voto di laurea finale.
 * @param {Array} materie - stato reale
 * @param {Array<{cfu:number, voto:number}>} simulatedEntries - esami ipotizzati
 */
export function computeWhatIfProjection(materie, simulatedEntries) {
  const base = computeWeightedAverage(materie);
  const entries = Array.isArray(simulatedEntries) ? simulatedEntries.filter((e) => e && Number.isFinite(e.voto) && e.cfu > 0) : [];
  const extraCfu = entries.reduce((sum, e) => sum + e.cfu, 0);
  const extraPoints = entries.reduce((sum, e) => sum + e.cfu * e.voto, 0);
  const totalCfu = base.totalCfu + extraCfu;
  const totalPoints = base.totalPoints + extraPoints;
  const average = totalCfu > 0 ? totalPoints / totalCfu : null;
  return {
    average,
    totalCfu,
    projection: computeGraduationProjection(average)
  };
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * V39.0 — Data "effettiva" in cui un esame è stato superato.
 *
 * La data di verbalizzazione (`examPassedDate`) resta la fonte migliore.
 * Quando manca si usa la data dell'appello (`examDate`), purché sia già
 * passata: per chi ha segnato "Esame superato" lasciando vuoto il campo
 * della verbalizzazione (o ha inserito gli esami prima che esistesse),
 * l'appello è una stima di pochi giorni, molto migliore di "nessuna
 * data". Prima quegli esami sparivano dal ritmo di carriera e dallo
 * storico della media, come se non fossero collegati al Web-Matrix.
 *
 * @returns {{dateKey:string|null, fonte:'VERBALE'|'APPELLO'|null}}
 */
export function effectivePassedDate(materia, todayKey = todayDateOnlyKey()) {
  if (!materia || !materia.examPassed) return { dateKey: null, fonte: null };
  const verbale = typeof materia.examPassedDate === 'string' ? materia.examPassedDate.slice(0, 10) : '';
  if (DATE_ONLY_RE.test(verbale)) return { dateKey: verbale, fonte: 'VERBALE' };
  const appello = typeof materia.examDate === 'string' ? materia.examDate.slice(0, 10) : '';
  if (DATE_ONLY_RE.test(appello) && appello <= todayKey) return { dateKey: appello, fonte: 'APPELLO' };
  return { dateKey: null, fonte: null };
}

/**
 * V39.0 — Storico della Media Ponderata ricostruito dalle Materie.
 *
 * Prima era un registro a parte, alimentato SOLO quando un esame già
 * esistente riceveva il suo primo voto: un esame creato direttamente
 * come "superato con voto" (il caso normale quando si inserisce la
 * propria carriera) non lasciava alcun punto, e il grafico mostrava un
 * punto solo. Correggere una data non spostava niente. Ora la curva è
 * una funzione delle Materie stesse: un punto per ogni data d'esame,
 * con la media di tutti gli esami votati fino a quel giorno. Cambi un
 * voto o una data nel Web-Matrix e la curva si aggiorna da sola.
 *
 * Gli esami votati senza nessuna data utilizzabile non si possono
 * collocare nel tempo: entrano in un ultimo punto "oggi" con la media
 * complessiva, dichiarato come tale (`senzaData`).
 *
 * @returns {{points:Array<{dateKey:string, average:number, gradedCount:number, esami:string[], senzaData?:number}>, undatedCount:number, stimateDaAppello:number}}
 */
export function computeGradeHistory(materie, todayKey = todayDateOnlyKey()) {
  const graded = (Array.isArray(materie) ? materie : []).filter(isGradedMateria);
  const dated = [];
  const undated = [];
  let stimateDaAppello = 0;
  graded.forEach((m) => {
    const { dateKey, fonte } = effectivePassedDate(m, todayKey);
    if (dateKey) {
      dated.push({ m, dateKey });
      if (fonte === 'APPELLO') stimateDaAppello += 1;
    } else {
      undated.push(m);
    }
  });
  dated.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const points = [];
  let cfu = 0;
  let punti = 0;
  let count = 0;
  let i = 0;
  while (i < dated.length) {
    const day = dated[i].dateKey;
    const esami = [];
    while (i < dated.length && dated[i].dateKey === day) {
      const { m } = dated[i];
      const c = Number(m.cfu) || 0;
      cfu += c;
      punti += c * m.voto;
      count += 1;
      esami.push(m.nome);
      i += 1;
    }
    if (cfu > 0) points.push({ dateKey: day, average: punti / cfu, gradedCount: count, esami });
  }

  if (undated.length > 0) {
    const all = computeWeightedAverage(graded);
    if (all.average != null) {
      const lastKey = points.length > 0 ? points[points.length - 1].dateKey : null;
      points.push({
        dateKey: lastKey && lastKey > todayKey ? lastKey : todayKey,
        average: all.average,
        gradedCount: all.gradedCount,
        esami: undated.map((m) => m.nome),
        senzaData: undated.length
      });
    }
  }
  return { points, undatedCount: undated.length, stimateDaAppello };
}

/**
 * Selezione dei prossimi N esami da simulare nel What-If Scenario: le
 * Materie non ancora superate con lo Spider-Score più alto (coerente col
 * Karen's Tactical Suggestor — gli stessi esami che l'IA consiglierebbe
 * di affrontare per primi sono quelli più utile simulare).
 */
export function getTopIncompleteByScore(materie, n = WHAT_IF_SLOT_COUNT, calibration = null) {
  const pending = (Array.isArray(materie) ? materie : []).filter((m) => m && !m.examPassed && Number(m.cfu) > 0);
  // V39.0 — con la calibrazione personale, come ogni altro Spider-Score
  // dell'app: senza, il What-If ordinava le materie con capacità e
  // fattore neutri e poteva proporre esami diversi da quelli indicati
  // dal Web-Matrix.
  const score = new Map(pending.map((m) => [m.id, computeSpiderScore(m, calibration)]));
  return [...pending].sort((a, b) => score.get(b.id) - score.get(a.id)).slice(0, n);
}

/**
 * Effetto marginale di UN SOLO esame simulato sulla proiezione attuale
 * (baseline reale + questo esame soltanto) — alimenta la frase dinamica
 * "Karen: Se prendi 28 in Aerodinamica, il tuo voto di partenza salirà a 98.4."
 */
export function computeMarginalProjection(materie, cfu, voto) {
  return computeWhatIfProjection(materie, [{ cfu, voto }]);
}

/* ------------------------------------------------------------------ *
 * V37.0 — QUANDO MI LAUREO
 *
 * L'app sapeva già dire "con che voto" (Media Ponderata e Proiezione di
 * Laurea) ma non "quando": la domanda che conta di più quando decidi se
 * puoi permetterti di rimandare un appello.
 *
 * Due stime indipendenti, mostrate insieme perché misurano cose diverse
 * e sbagliano in modi diversi:
 *
 *  1. RITMO DI STUDIO — ore di lavoro ancora davanti diviso la capacità
 *     giornaliera reale misurata (utils/calibration.js). Dice quanto
 *     lavoro resta, ma ignora che gli esami si danno in appelli e che
 *     esistono le vacanze;
 *  2. RITMO DI CARRIERA — CFU verbalizzati al mese, misurati sulle date
 *     reali di verbalizzazione (`examPassedDate`, introdotta in questa
 *     stessa versione). Cattura la realtà per intero — sessioni,
 *     bocciature, pause — ma ha bisogno di qualche esame alle spalle.
 *
 * Nessuna delle due viene spacciata per la verità: entrambe dichiarano
 * la propria affidabilità, e quando divergono molto la distanza stessa è
 * l'informazione utile.
 * ------------------------------------------------------------------ */
/** Sotto questo numero di esami verbalizzati con data, il ritmo di
 * carriera è statistica su un campione troppo piccolo. */
export const CAREER_MIN_EXAMS = 3;
/** V39.0 — Giorni di preparazione che precedono il primo esame (un
 * semestre): la finestra del ritmo di carriera parte da lì. */
export const CAREER_PREP_DAYS = 120;
const DAY_MS = 86400000;

/** Una Materia conta come "superata" per il conteggio CFU anche senza
 * voto: idoneità, altre attività e prova finale danno crediti lo stesso. */
function isPassed(materia) {
  return !!materia && !!materia.examPassed;
}

/**
 * @param {Array} materie `state.materie`
 * @param {object|null} calibration pacchetto di utils/calibration.js
 * @param {number} [cfuTotali] override del totale del piano
 */
export function computeGraduationForecast(materie, calibration = null, cfuTotali = PIANO_CFU_TOTALI) {
  const safe = Array.isArray(materie) ? materie : [];
  const passed = safe.filter(isPassed);
  const pending = safe.filter((m) => m && !m.examPassed);

  const cfuAcquisiti = passed.reduce((sum, m) => sum + (Number(m.cfu) || 0), 0);
  const cfuRimanenti = Math.max(0, cfuTotali - cfuAcquisiti);
  const progressPct = cfuTotali > 0 ? Math.round((cfuAcquisiti / cfuTotali) * 100) : 0;

  if (cfuRimanenti === 0) {
    return {
      cfuTotali,
      cfuAcquisiti,
      cfuRimanenti: 0,
      progressPct: 100,
      done: true,
      byWorkload: null,
      byCareer: null,
      dateKey: null,
      confidence: 'ALTA'
    };
  }

  // --- Stima 1: ritmo di studio --------------------------------------
  // Ore residue delle materie già aperte nel Web-Matrix, più il monte
  // ore accademico standard per i CFU del piano non ancora tracciati da
  // nessuna Materia: senza quest'ultima parte la stima ignorerebbe tutto
  // ciò che non hai ancora nemmeno iniziato a mappare.
  const oreMaterieAperte = pending.reduce((sum, m) => sum + computeRemainingHours(m, calibration), 0);
  const cfuTracciati = pending.reduce((sum, m) => sum + (Number(m.cfu) || 0), 0);
  const cfuNonTracciati = Math.max(0, cfuRimanenti - cfuTracciati);
  const oreNonTracciate = cfuNonTracciati * HOURS_PER_CFU;
  const oreTotaliResidue = Math.round(oreMaterieAperte + oreNonTracciate);

  const capacita = Number(calibration?.hoursPerDay) > 0 ? Number(calibration.hoursPerDay) : 4.5;
  const giorniPerCarico = Math.ceil(oreTotaliResidue / capacita);

  const byWorkload = {
    oreResidue: oreTotaliResidue,
    oreNonTracciate: Math.round(oreNonTracciate),
    capacitaOreGiorno: Math.round(capacita * 10) / 10,
    giorni: giorniPerCarico,
    mesi: Math.round((giorniPerCarico / 30.44) * 10) / 10,
    dateKey: addDaysToDateOnly(todayDateOnlyKey(), giorniPerCarico),
    confident: !!calibration?.capacityConfident
  };

  // --- Stima 2: ritmo di carriera ------------------------------------
  // V39.0 — data effettiva: verbalizzazione, oppure l'appello già
  // passato quando la verbalizzazione non è stata compilata.
  const oggiKey = todayDateOnlyKey();
  const conData = passed
    .map((m) => ({ m, ...effectivePassedDate(m, oggiKey) }))
    .filter((x) => x.dateKey)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const stimateDaAppello = conData.filter((x) => x.fonte === 'APPELLO').length;

  let byCareer = null;
  if (conData.length >= CAREER_MIN_EXAMS) {
    const primoMs = dateOnlyToUtcMs(conData[0].dateKey);
    const oggiMs = dateOnlyToUtcMs(todayDateOnlyKey());
    // V39.0 — La finestra NON parte dal primo esame: parte un semestre
    // PRIMA, perché è lì che è cominciato il lavoro per darlo. Prima la
    // finestra cominciava il giorno del primo esame e ne escludeva i CFU:
    // cinque esami dati in tre settimane di una sessione facevano 35
    // CFU/mese e una laurea entro l'inverno, con affidabilità "alta". Con
    // il semestre di preparazione incluso diventano ~6.5 CFU/mese, cioè
    // il ritmo reale di uno studente che quella sessione l'ha preparata.
    const giorniOsservati = Math.max(1, Math.round((oggiMs - primoMs) / DAY_MS) + 1) + CAREER_PREP_DAYS;
    const cfuNellaFinestra = conData.reduce((sum, x) => sum + (Number(x.m.cfu) || 0), 0);
    const cfuAlMese = cfuNellaFinestra > 0 ? (cfuNellaFinestra / giorniOsservati) * 30.44 : 0;

    if (cfuAlMese > 0) {
      const mesiNecessari = cfuRimanenti / cfuAlMese;
      const giorni = Math.ceil(mesiNecessari * 30.44);
      byCareer = {
        cfuAlMese: Math.round(cfuAlMese * 10) / 10,
        esamiOsservati: conData.length,
        stimateDaAppello,
        giorniOsservati,
        giorni,
        mesi: Math.round(mesiNecessari * 10) / 10,
        dateKey: addDaysToDateOnly(todayDateOnlyKey(), giorni),
        // Affidabile solo con abbastanza esami E almeno un anno solare
        // osservato: una sola sessione non dice ancora che ritmo terrai.
        confident: conData.length >= 5 && giorniOsservati - CAREER_PREP_DAYS >= 365
      };
    }
  }

  // --- Sintesi -------------------------------------------------------
  // Si privilegia il ritmo di carriera quando c'è abbastanza storico:
  // misura la realtà completa, appelli e pause comprese, mentre il
  // carico di lavoro misura solo l'impegno teorico. Il vincolo finale è
  // che non ci si può laureare prima dell'ultimo esame già in calendario.
  const scelta = byCareer && byCareer.confident ? byCareer : byWorkload;
  const ultimoAppello = pending
    .map((m) => m.examDate)
    .filter((d) => typeof d === 'string' && d.length === 10)
    .sort()
    .pop();

  let dateKey = scelta.dateKey;
  let limitataDaAppello = false;
  if (ultimoAppello && dateOnlyToUtcMs(ultimoAppello) > dateOnlyToUtcMs(dateKey)) {
    dateKey = ultimoAppello;
    limitataDaAppello = true;
  }

  const confidence = byCareer?.confident && byWorkload.confident ? 'ALTA' : byCareer || byWorkload.confident ? 'MEDIA' : 'BASSA';

  return {
    cfuTotali,
    cfuAcquisiti,
    cfuRimanenti,
    progressPct,
    done: false,
    byWorkload,
    byCareer,
    dateKey,
    metodo: scelta === byCareer ? 'CARRIERA' : 'CARICO',
    limitataDaAppello,
    ultimoAppello: ultimoAppello || null,
    confidence,
    esamiConData: conData.length,
    esamiSuperati: passed.length
  };
}
