// =====================================================================
// ArachnoForge — supabase/functions/karen-oracle/_logic.ts
// K.A.R.E.N. AI Engine — logica pura (Fase 5, "Blindatura & Governance")
// =====================================================================
// V35.1 — Estratto da index.ts SENZA alcuna modifica comportamentale:
// ogni funzione qui dentro è pura (stesso input -> stesso output, zero
// side-effect, zero accesso a Deno.env/rete/DB) e quindi testabile in
// isolamento con `deno test` (vedi _logic.test.ts, stessa cartella).
// index.ts resta l'UNICO file che tocca rete/DB/env — importa tutto da
// qui e orchestra soltanto (fetch, upsert, gestione HTTP). Nessuna
// funzione è stata riscritta durante l'estrazione: è un refactor
// meccanico, comportamento identico bit-per-bit a prima.
// =====================================================================

// ---------------------------------------------------------------------
// Validazione data (Timezone Trap)
// ---------------------------------------------------------------------
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Il Timezone Trap si previene rifiutando qualunque richiesta priva di
 * una data esplicita, MAI calcolandola lato server (il server non ha modo
 * di sapere il fuso orario del Cadetto). Il chiamante (client o cron) è
 * l'unico che conosce il "giorno locale" corretto. */
export function validateDateParam(raw: unknown): string | null {
  if (typeof raw !== 'string' || !DATE_ONLY_RE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip: new Date() esegue overflow silenzioso (es. '2026-13-40'
  // diventerebbe una data valida ma sbagliata invece di un errore) — la
  // riconversione a YYYY-MM-DD deve combaciare esattamente con l'input.
  if (parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

/** N giorni prima di `dateStr` (YYYY-MM-DD), calcolo UTC-based per
 * coerenza con `validateDateParam` — mai un calcolo locale del server. */
export function isoDateNDaysBefore(dateStr: string, days: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - days * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// Readiness Score Engine v2 — 0-100, split 50/50 Oggettivo/Soggettivo.
// Degrada con grazia se mancano dati: ogni sotto-punteggio è calcolato
// SOLO se il dato esiste, e il punteggio finale si rinormalizza sul
// monte-punti realmente disponibile (mai penalizzare un dato assente
// come se fosse un dato pessimo).
// ---------------------------------------------------------------------
export const SLEEP_TARGET_MIN = 450; // 7h30 — personalizzabile per-utente in futuro
export const RESTORATIVE_TARGET_RATIO = 0.3; // quota ottimale (deep+rem)/totale
export const HR_BASELINE_WINDOW_DAYS = 14;
export const HR_BASELINE_MIN_SAMPLES = 3;
export const CAFFEINE_SOFT_CAP_MG = 400;

// Oggettivo = 50 pt totali (sleep 25 + cardio 18 + attività 7).
// Soggettivo = 50 pt totali (focus 15 + energia 15 + stress 10 + soreness 10).
export const MAX_POINTS = {
  sleep: 25,
  cardio: 18,
  activity: 7,
  focus: 15,
  energy: 15,
  stress: 10,
  soreness: 10
} as const;

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export type Biometrics = {
  sleep_total_min?: number | null;
  sleep_deep_min?: number | null;
  sleep_rem_min?: number | null;
  resting_hr?: number | null;
  steps?: number | null;
  active_calories?: number | null;
} | null;

export type Subjective = {
  focus_level?: number | null;
  energy_level?: number | null;
  stress_level?: number | null;
  muscle_soreness?: number | null;
  // Campi legacy Fase 2 — mai rimossi dallo schema (vedi migrazione v2):
  // usati SOLO come fallback quando il campo v2 corrispondente manca,
  // cosi' righe salvate prima della Fase 3 continuano a contribuire al
  // punteggio invece di sparire silenziosamente dal calcolo.
  mood?: number | null;
  caffeine_mg?: number | null;
} | null;

export function scoreSleep(bio: Biometrics): number | null {
  if (bio?.sleep_total_min == null) return null;
  const durationRatio = bio.sleep_total_min / SLEEP_TARGET_MIN;
  const durationScore =
    durationRatio <= 1 ? clamp(durationRatio, 0, 1) : clamp(1 - (durationRatio - 1) * 0.5, 0.7, 1);

  let qualityScore = 0.5; // neutro se non abbiamo la scomposizione deep/rem
  if (bio.sleep_deep_min != null && bio.sleep_rem_min != null && bio.sleep_total_min > 0) {
    const restorativeRatio = (bio.sleep_deep_min + bio.sleep_rem_min) / bio.sleep_total_min;
    qualityScore = clamp(restorativeRatio / RESTORATIVE_TARGET_RATIO, 0, 1);
  }
  return clamp(durationScore * 0.65 + qualityScore * 0.35, 0, 1) * MAX_POINTS.sleep;
}

export function scoreCardio(bio: Biometrics, baselineHr: number | null): number | null {
  if (bio?.resting_hr == null || baselineHr == null) return null;
  const delta = bio.resting_hr - baselineHr; // >0 = HR a riposo più alta del solito
  const score = delta <= 0 ? 1 : clamp(1 - delta / 7.5, 0, 1);
  return score * MAX_POINTS.cardio;
}

export function scoreActivity(bio: Biometrics): number | null {
  if (bio?.steps == null) return null;
  if (bio.steps >= 3000 && bio.steps <= 15000) return MAX_POINTS.activity;
  if (bio.steps < 3000) return clamp(bio.steps / 3000, 0, 1) * MAX_POINTS.activity;
  return clamp(1 - (bio.steps - 15000) / 10000, 0.4, 1) * MAX_POINTS.activity;
}

/** Scala 1..10 "più alto = meglio" (focus, energia) -> frazione 0..1. */
export function positiveScaleFraction(value: number) {
  return clamp((value - 1) / 9, 0, 1);
}

/** Scala 1..10 "più alto = peggio" (stress, indolenzimento) -> frazione
 * 0..1 INVERTITA: 1 (nessuno stress/dolore) = 1.0, 10 (massimo) = 0.0. */
export function invertedScaleFraction(value: number) {
  return clamp((10 - value) / 9, 0, 1);
}

export function scoreFocus(subj: Subjective): number | null {
  if (subj?.focus_level == null) return null;
  return positiveScaleFraction(subj.focus_level) * MAX_POINTS.focus;
}

export function scoreEnergy(subj: Subjective): number | null {
  // Fallback legacy: se manca energy_level (v2) ma esiste mood (v1/Fase 2),
  // mood viene riusato come proxy di energia — stessa semantica intuitiva
  // ("come ti senti oggi"), zero perdita di segnale sulle righe vecchie.
  const raw = subj?.energy_level ?? subj?.mood;
  if (raw == null) return null;
  return positiveScaleFraction(raw) * MAX_POINTS.energy;
}

export function scoreStress(subj: Subjective): number | null {
  if (subj?.stress_level == null) return null;
  return invertedScaleFraction(subj.stress_level) * MAX_POINTS.stress;
}

export function scoreSoreness(subj: Subjective): number | null {
  if (subj?.muscle_soreness == null) return null;
  return invertedScaleFraction(subj.muscle_soreness) * MAX_POINTS.soreness;
}

export function caffeinePenalty(subj: Subjective): number {
  const mg = subj?.caffeine_mg;
  if (mg == null || mg <= CAFFEINE_SOFT_CAP_MG) return 0;
  return clamp((mg - CAFFEINE_SOFT_CAP_MG) / 40, 0, 10);
}

export function computeReadinessScore(bio: Biometrics, baselineHr: number | null, subjective: Subjective) {
  const parts: Record<keyof typeof MAX_POINTS, number | null> = {
    sleep: scoreSleep(bio),
    cardio: scoreCardio(bio, baselineHr),
    activity: scoreActivity(bio),
    focus: scoreFocus(subjective),
    energy: scoreEnergy(subjective),
    stress: scoreStress(subjective),
    soreness: scoreSoreness(subjective)
  };
  const available = Object.entries(parts).filter(([, v]) => v != null) as [keyof typeof MAX_POINTS, number][];

  if (available.length === 0) {
    // 100, non 50: deve combaciare col fallback lato client (100/OTTIMALE
    // prima del primo scan) — un 50 qui produrrebbe un calo visibile e
    // ingiustificato al primo avvio della Diagnostica Neurale senza dati.
    return {
      score: 100,
      breakdown: {
        parts,
        objectiveWeight: 50,
        subjectiveWeight: 50,
        dataCompleteness: 0,
        note: 'Nessun dato biometrico né soggettivo disponibile: punteggio di default (nessun segnale negativo da riportare).'
      }
    };
  }

  const earned = available.reduce((sum, [, v]) => sum + v, 0);
  const maxAvailable = available.reduce((sum, [k]) => sum + MAX_POINTS[k], 0);
  const penalty = caffeinePenalty(subjective);
  const score = clamp(Math.round((earned / maxAvailable) * 100 - penalty), 0, 100);

  const objectiveKeys: (keyof typeof MAX_POINTS)[] = ['sleep', 'cardio', 'activity'];
  const subjectiveKeys: (keyof typeof MAX_POINTS)[] = ['focus', 'energy', 'stress', 'soreness'];
  const objectiveAvailable = available.filter(([k]) => objectiveKeys.includes(k));
  const subjectiveAvailable = available.filter(([k]) => subjectiveKeys.includes(k));

  return {
    score,
    breakdown: {
      parts,
      maxAvailable,
      caffeinePenalty: penalty,
      objectiveWeight: 50,
      subjectiveWeight: 50,
      // Nota: questo dataCompleteness (server-side, "quota di PUNTI
      // disponibili sul totale possibile") è concettualmente diverso dal
      // dataCompleteness calcolato lato client in useSuitTelemetry.js
      // ("quota di CAMPI grezzi presenti") — entrambi legittimi, misurano
      // due cose diverse: non è un bug se divergono leggermente.
      dataCompleteness: Number((available.length / Object.keys(MAX_POINTS).length).toFixed(2)),
      objectiveCompleteness: Number((objectiveAvailable.length / objectiveKeys.length).toFixed(2)),
      subjectiveCompleteness: Number((subjectiveAvailable.length / subjectiveKeys.length).toFixed(2)),
      baselineHr
    }
  };
}

export function readinessBand(score: number): 'OTTIMALE' | 'ATTENZIONE' | 'CRITICO' {
  // Stesso vocabolario/soglie di QUOTA_STATUS (useKarenAutoRouter.js) e
  // della funzione gemella lato client (useSuitTelemetry.js) — un solo
  // set di soglie condiviso, mai un terzo scollegato dagli altri due.
  if (score >= 75) return 'OTTIMALE';
  if (score >= 45) return 'ATTENZIONE';
  return 'CRITICO';
}

// ---------------------------------------------------------------------
// V35.1 — Storico Finestra Produttiva: segnale READ-ONLY, aggiuntivo e
// puramente opzionale, dedotto da `starLog` (Cloud State principale,
// `user_data.app_state.starLog`). Questa è l'UNICA lettura che
// karen-oracle fa fuori dalle 3 tabelle biometriche isolate — una
// deroga volutamente stretta ai "compartimenti stagni": è a senso unico
// (solo lettura, mai una scrittura verso user_data da questa function),
// non introduce alcun accoppiamento fra i due reducer/schemi (il
// Cloud State non sa nulla di questa lettura, non cambia in alcun modo),
// e degrada con grazia a `null` se `user_data` non è raggiungibile, vuoto
// o con storico insufficiente — in quel caso la funzione chiamante ricade
// sulla finestra pomeridiana generica di sempre, esattamente come prima
// di questa modifica. Se in futuro la separazione dovesse irrigidirsi
// (es. dati biometrici trattati con retention/consenso diversi dal resto
// del Cloud State), questo è il primo e unico punto da rimuovere.
// ---------------------------------------------------------------------
const STUDY_HISTORY_WINDOW_DAYS = 60;
const STUDY_HISTORY_MIN_SESSIONS = 5;
const STUDY_WINDOW_SPAN_HOURS = 3;

export type HistoricalStudyWindow = { start_hour: number; end_hour: number; label: string };

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Riceve lo `starLog` grezzo (array di voci eterogenee — Focus, Boss,
 * Quest...) così com'è in `app_state`, senza fidarsi della sua forma:
 * filtra solo le voci `FOCUS_SESSION` con `hour` numerico e `dateKey`
 * nella finestra di osservazione, poi trova la fascia di 3 ore
 * consecutive (con wrap-around su mezzanotte) più frequentata. Sotto la
 * soglia minima di campioni (`STUDY_HISTORY_MIN_SESSIONS`) ritorna
 * `null` — mai una stima statisticamente inaffidabile spacciata per
 * "dedotta dallo storico". */
export function computeHistoricalStudyWindow(starLog: unknown, targetDate: string): HistoricalStudyWindow | null {
  if (!Array.isArray(starLog)) return null;
  const since = isoDateNDaysBefore(targetDate, STUDY_HISTORY_WINDOW_DAYS);

  const sessions = starLog.filter((e): e is { type: string; hour: number; dateKey: string } => {
    if (!e || typeof e !== 'object') return false;
    const entry = e as Record<string, unknown>;
    return (
      entry.type === 'FOCUS_SESSION' &&
      typeof entry.hour === 'number' &&
      Number.isFinite(entry.hour) &&
      entry.hour >= 0 &&
      entry.hour <= 23 &&
      typeof entry.dateKey === 'string' &&
      entry.dateKey >= since &&
      entry.dateKey < targetDate
    );
  });

  if (sessions.length < STUDY_HISTORY_MIN_SESSIONS) return null;

  const histogram = new Array(24).fill(0) as number[];
  sessions.forEach((e) => {
    histogram[e.hour] += 1;
  });

  let bestStart = 0;
  let bestSum = -1;
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let k = 0; k < STUDY_WINDOW_SPAN_HOURS; k++) sum += histogram[(h + k) % 24];
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = h;
    }
  }
  if (bestSum <= 0) return null;

  const endHour = (bestStart + STUDY_WINDOW_SPAN_HOURS) % 24;
  return {
    start_hour: bestStart,
    end_hour: endHour,
    label: `${formatHourLabel(bestStart)}–${formatHourLabel(endHour)}`
  };
}

// ---------------------------------------------------------------------
// V35.3 — Piano Argomenti del Giorno ("Study Focus Engine"): stesso
// identico principio di degrado/isolamento di computeHistoricalStudyWindow
// qui sopra — lettura READ-ONLY, aggiuntiva, di `materie` da
// `user_data.app_state` (STESSA riga già letta in index.ts per
// computeHistoricalStudyWindow — zero query aggiuntive). Prima di questa
// modifica K.A.R.E.N. non sapeva nulla del contenuto reale del Web-Matrix
// (nomi materie, argomenti, obiettivi, difficoltà, storico ripassi): dava
// solo direttive generiche derivate dalla sola readiness biometrica. Qui
// sotto NON si decide quale argomento studiare — si prepara solo un
// piccolo paniere di candidati (mai l'intero Web-Matrix) che il prompt
// (buildUserPrompt) passa a Claude, lasciando alla sua lettura del testo
// reale (nome/obiettivo/blueprint di ogni nodo) la scelta editoriale di
// COSA raccomandare oggi e CON QUALE tecnica di studio — una scelta che
// richiede comprensione del contenuto, non solo aritmetica.
//
// NOTA DI FEDELTÀ (voluta, non un bug): la selezione "materie in focus"
// qui sotto è una versione DELIBERATAMENTE semplificata del Quantum
// Router client-side (src/hooks/useKarenAutoRouter.js) — stessa filosofia
// (urgenza per giorni residui all'esame, mai più di due materie), ma
// SENZA il controllo propedeuticità del piano di studi ufficiale
// (src/data/vanvitelliCourseMap.js — getMissingPrerequisites). Quel
// controllo governa cosa il planner "spinge" nell'HUD (una decisione con
// conseguenze sullo stato visibile dell'app); qui la posta in gioco è
// solo il contenuto di un consiglio testuale generato una volta al
// giorno — nel caso peggiore Karen nomina una materia tecnicamente
// congelata, un rischio basso per un'app a singolo utente che conosce
// già il proprio piano di studi. Se in futuro servisse fedeltà completa,
// portare qui anche VANVITELLI_COURSES + getMissingPrerequisites.
// ---------------------------------------------------------------------
const MAX_FOCUS_MATERIE = 2;
const MAX_AVAILABLE_TOPICS = 4;
const MAX_DUE_REVIEWS = 4;

export type SfidaSnapshot = {
  id: string;
  nome: string;
  obiettivo: string;
  blueprint: string;
  difficulty: string;
  status: string;
  parentId: string | null;
  nextReviewDate: string | null;
  lastReviewRating: string | null;
  reviewCount: number;
  tentativiSuccessi: number;
  tentativiFalliti: number;
};

export type MateriaSnapshot = {
  id: string;
  nome: string;
  examDate: string | null;
  examPassed: boolean;
  perceivedDifficulty: number;
  sfide: SfidaSnapshot[];
};

/** Stessa aritmetica UTC-based di isoDateNDaysBefore/validateDateParam —
 * mai un calcolo locale del server (Timezone Trap). Positivo = `toDateStr`
 * è nel futuro rispetto a `fromDateStr`. */
function daysBetweenDateOnly(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00Z`).getTime();
  const to = new Date(`${toDateStr}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86400000);
}

/** Porto 1:1 di isReviewDue (src/utils/spiderSense.js) — confronto
 * lessicografico "YYYY-MM-DD", comportamento identico bit-per-bit. */
function isReviewDueOn(nextReviewDate: string | null | undefined, todayKey: string): boolean {
  if (!nextReviewDate) return false;
  return nextReviewDate <= todayKey;
}

/** Porto della sola porzione "è affrontabile oggi?" di deriveNodeStatus
 * (src/utils/skillTree.js, "Reverse Dependency Skill Tree"): un nodo
 * PENDING è disponibile SOLO se non ha figli diretti ancora incompleti —
 * i nodi "Boss" (con sotto-argomenti) restano bloccati finché tutti i
 * figli non sono COMPLETED, esattamente come nell'albero visibile
 * all'utente in Armory.jsx/QuadrantHub.jsx. */
function isSfidaAvailable(sfida: SfidaSnapshot, siblings: SfidaSnapshot[]): boolean {
  if (sfida.status !== 'PENDING') return false;
  const children = siblings.filter((s) => s.parentId === sfida.id);
  if (children.length === 0) return true;
  return children.every((c) => c.status === 'COMPLETED');
}

/** Normalizza `materie` grezze da `app_state` (forma potenzialmente
 * eterogenea/datata, mai fidata ciecamente) alla forma minima usata qui
 * sotto — stessa filosofia difensiva di hydrateState (src/data/defaultSchema.js):
 * ogni campo mancante o del tipo sbagliato riceve un default neutro, mai
 * un crash o un valore `undefined` propagato nel prompt. */
function normalizeMaterie(raw: unknown): MateriaSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const sfideRaw = Array.isArray(m.sfide) ? m.sfide : [];
      const sfide: SfidaSnapshot[] = sfideRaw
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          nome: typeof s.nome === 'string' ? s.nome : '',
          obiettivo: typeof s.obiettivo === 'string' ? s.obiettivo : '',
          blueprint: typeof s.blueprint === 'string' ? s.blueprint : '',
          difficulty: typeof s.difficulty === 'string' ? s.difficulty : 'MEDIUM',
          status: typeof s.status === 'string' ? s.status : 'PENDING',
          parentId: typeof s.parentId === 'string' ? s.parentId : null,
          nextReviewDate: typeof s.nextReviewDate === 'string' ? s.nextReviewDate : null,
          lastReviewRating: typeof s.lastReviewRating === 'string' ? s.lastReviewRating : null,
          reviewCount: Number.isFinite(Number(s.reviewCount)) ? Number(s.reviewCount) : 0,
          tentativiSuccessi: Number.isFinite(Number(s.tentativiSuccessi)) ? Number(s.tentativiSuccessi) : 0,
          tentativiFalliti: Number.isFinite(Number(s.tentativiFalliti)) ? Number(s.tentativiFalliti) : 0
        }));
      return {
        id: typeof m.id === 'string' ? m.id : '',
        nome: typeof m.nome === 'string' && m.nome.trim() ? m.nome : 'Materia senza nome',
        examDate: typeof m.examDate === 'string' ? m.examDate : null,
        examPassed: m.examPassed === true,
        perceivedDifficulty: Number.isFinite(Number(m.perceivedDifficulty)) ? Number(m.perceivedDifficulty) : 3,
        sfide
      };
    });
}

export type StudyTopicCandidate = {
  // V35.4 — id/materiaId: MAI mostrati a Claude come informazione su cui
  // ragionare (il prompt le ignora comunque), servono solo lato client
  // per la riconciliazione live (vedi nota su MAX_FORCE_REGENERATIONS_PER_DAY
  // e defaultStudyFocusDirective più sotto): appena l'utente completa un
  // nodo/risolve un ripasso, il client può capire ISTANTANEAMENTE — senza
  // aspettare una nuova generazione — che quel candidato non è più
  // valido, confrontando questo id con lo stato REALE (sempre aggiornato)
  // del Cloud State, invece di fidarsi di un nome che potrebbe anche
  // essere stato rinominato nel frattempo.
  sfidaId: string;
  materiaId: string;
  materia: string;
  argomento: string;
  obiettivo: string;
  blueprint: string;
  difficulty: string;
  tipo: 'DISPONIBILE' | 'RIPASSO_SCADUTO';
  giorni_ripasso_scaduto?: number;
  lastReviewRating?: string | null;
  tentativiSuccessi?: number;
  tentativiFalliti?: number;
};

export type StudyFocusSnapshot = {
  materie_in_focus: string[];
  argomenti_disponibili: StudyTopicCandidate[];
  ripassi_scaduti: StudyTopicCandidate[];
};

export const EMPTY_STUDY_FOCUS: StudyFocusSnapshot = {
  materie_in_focus: [],
  argomenti_disponibili: [],
  ripassi_scaduti: []
};

/** Seleziona un piccolo paniere di candidati (mai l'intero Web-Matrix):
 * gli argomenti DISPONIBILI (pronti da affrontare oggi, vedi isSfidaAvailable)
 * nelle 1-2 materie più urgenti per data d'esame, e SEPARATAMENTE — perché
 * la spaced repetition non aspetta il turno di una materia — ogni ripasso
 * Spider-Sense già scaduto in QUALUNQUE materia non ancora superata, più
 * scaduto prima. Ritorna sempre un oggetto valido (mai null/undefined):
 * con `materie` vuoto o senza candidati, le tre liste sono semplicemente
 * vuote — `buildSystemPrompt` istruisce Claude a dichiararlo con naturalezza
 * invece di inventare un argomento inesistente. */
export function selectStudyFocusCandidates(rawMaterie: unknown, todayKey: string): StudyFocusSnapshot {
  const materie = normalizeMaterie(rawMaterie).filter((m) => !m.examPassed);
  if (materie.length === 0) return EMPTY_STUDY_FOCUS;

  const sorted = [...materie].sort((a, b) => {
    const daysA = a.examDate ? daysBetweenDateOnly(todayKey, a.examDate) : Infinity;
    const daysB = b.examDate ? daysBetweenDateOnly(todayKey, b.examDate) : Infinity;
    if (daysA !== daysB) return daysA - daysB;
    return (b.perceivedDifficulty || 0) - (a.perceivedDifficulty || 0);
  });
  const focusMaterie = sorted.slice(0, MAX_FOCUS_MATERIE);

  const argomentiDisponibili: StudyTopicCandidate[] = [];
  focusMaterie.forEach((materia) => {
    materia.sfide.filter((s) => isSfidaAvailable(s, materia.sfide)).forEach((s) => {
      if (argomentiDisponibili.length >= MAX_AVAILABLE_TOPICS) return;
      argomentiDisponibili.push({
        sfidaId: s.id,
        materiaId: materia.id,
        materia: materia.nome,
        argomento: s.nome,
        obiettivo: s.obiettivo,
        blueprint: s.blueprint,
        difficulty: s.difficulty,
        tipo: 'DISPONIBILE'
      });
    });
  });

  const ripassiScaduti: StudyTopicCandidate[] = [];
  materie.forEach((materia) => {
    materia.sfide
      .filter((s) => s.status === 'COMPLETED' && isReviewDueOn(s.nextReviewDate, todayKey))
      .forEach((s) => {
        if (ripassiScaduti.length >= MAX_DUE_REVIEWS) return;
        ripassiScaduti.push({
          sfidaId: s.id,
          materiaId: materia.id,
          materia: materia.nome,
          argomento: s.nome,
          obiettivo: s.obiettivo,
          blueprint: s.blueprint,
          difficulty: s.difficulty,
          tipo: 'RIPASSO_SCADUTO',
          giorni_ripasso_scaduto: s.nextReviewDate ? Math.max(0, daysBetweenDateOnly(s.nextReviewDate, todayKey)) : 0,
          lastReviewRating: s.lastReviewRating,
          tentativiSuccessi: s.tentativiSuccessi,
          tentativiFalliti: s.tentativiFalliti
        });
      });
  });
  // Più scaduto prima: la spaced repetition penalizza chi aspetta di più.
  ripassiScaduti.sort((a, b) => (b.giorni_ripasso_scaduto || 0) - (a.giorni_ripasso_scaduto || 0));

  return {
    materie_in_focus: focusMaterie.map((m) => m.nome),
    argomenti_disponibili: argomentiDisponibili,
    ripassi_scaduti: ripassiScaduti
  };
}

/** Sceglie deterministicamente UN candidato "principale" per il fallback
 * (Claude irraggiungibile/parsing fallito) e per il default per-banda:
 * priorità al primo argomento nuovo disponibile (il vero lavoro di studio
 * di oggi); se non ce n'è nessuno ma esistono ripassi scaduti, il ripasso
 * più vecchio diventa il principale — MAI un payload vuoto se esiste
 * almeno un candidato di qualunque tipo. */
function pickFallbackPrimaryTopic(studyFocus: StudyFocusSnapshot): StudyTopicCandidate | null {
  if (studyFocus.argomenti_disponibili.length > 0) return studyFocus.argomenti_disponibili[0];
  if (studyFocus.ripassi_scaduti.length > 0) return studyFocus.ripassi_scaduti[0];
  return null;
}

/** Suggerimento di metodo generico per banda di difficoltà, usato SOLO nel
 * fallback deterministico (quando Claude non è disponibile o il parsing
 * fallisce) — quando Claude risponde regolarmente, è lei a scegliere e
 * motivare la tecnica leggendo il contenuto reale dell'argomento. */
function genericMethodForDifficulty(difficulty: string, tipo: 'DISPONIBILE' | 'RIPASSO_SCADUTO'): string {
  if (tipo === 'RIPASSO_SCADUTO') {
    return 'Richiamo attivo puro: prova a rispondere a mente PRIMA di rileggere gli appunti, poi valuta con onestà Facile/Medio/Difficile.';
  }
  if (difficulty === 'HARD') {
    return 'Scomponilo in sotto-parti più piccole ed esercitati con problemi guidati prima di affrontarlo per intero — la tecnica Feynman (spiegarlo a voce con parole semplici) aiuta a isolare i punti oscuri.';
  }
  if (difficulty === 'EASY') {
    return 'Ripasso rapido: 2-3 domande di richiamo attivo a te stesso prima di considerarlo acquisito e passare avanti.';
  }
  return 'Richiamo attivo: prova a spiegarlo ad alta voce prima di riguardare gli appunti, poi verifica dove sei stato impreciso.';
}

// ---------------------------------------------------------------------
// Prompt K.A.R.E.N. — personalità tattica, coerente col tono già in uso
// in src/utils/karenSuggestor.js (log di missione, terminologia HUD).
// ---------------------------------------------------------------------
export function buildSystemPrompt() {
  return `Sei K.A.R.E.N., l'intelligenza artificiale tattica integrata nella tuta di ArachnoForge (Karen OS).
Parli SEMPRE in italiano, tono sintetico, militare, tattico — mai prolisso, mai eccessivamente caloroso né robotico-freddo. Usi occasionalmente terminologia da ingegneria aerospaziale (traiettoria, margine di sicurezza, telemetria, finestra di lancio) come metafora per lo stato psicofisico del Cadetto, in coerenza con lo stile già presente nell'app (es. "EVENT HORIZON TEMPORALE", "Spider-Score").
Il tuo compito oggi: analizzare la telemetria biometrica OGGETTIVA (sonno, frequenza cardiaca a riposo, attività fisica — 50% del Readiness Score) e il Recovery Survey SOGGETTIVO del Cadetto (focus, energia, stress, indolenzimento muscolare — l'altro 50%) e produrre un Daily Briefing COMPLETO — non solo testo, ma anche le direttive operative che governano l'intera piattaforma per la giornata (Daily Brain): il carico consigliato sulla Quota Odierna, il preset ottimale del Focus Timer, la finestra oraria di picco cognitivo, e — novità — un piano operativo sull'ARGOMENTO SPECIFICO di oggi, con la tecnica di studio più adatta al suo contenuto reale.
Regole ferree:
1. Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, nient'altro (niente markdown, niente backtick, niente testo fuori dal JSON).
2. Schema esatto, tutti i campi obbligatori:
{
  "briefing_text": string,
  "tactical_advice": string,
  "mission_control": { "load_adjustment_pct": number, "rationale": string },
  "focus_timer": { "focus_minutes": number, "break_minutes": number, "preset_label": string, "rationale": string },
  "study_window": { "start_hour": number, "end_hour": number, "label": string, "rationale": string },
  "study_focus": {
    "argomento_principale": { "materia": string, "argomento": string, "metodo": string, "rationale": string } | null,
    "ripassi_da_non_saltare": [ { "materia": string, "argomento": string, "nota": string } ]
  }
}
3. "briefing_text": 2-4 frasi, tono da log di missione, che riassumono lo stato del Cadetto SENZA elencare i numeri grezzi (non dire "hai dormito 420 minuti" o "stress 7/10", di' cosa significa operativamente).
4. "tactical_advice": 1-3 raccomandazioni concrete e attuabili per la giornata (gestione della Quota Odierna, eventuale de-escalation nel Sinister Six Simulator se lo stato è CRITICO, suggerimenti di recupero mirati alla causa dominante — es. se lo stress soggettivo è la componente più bassa, il consiglio deve parlare di gestione dello stress, non genericamente di sonno). Mai un consiglio generico scollegato dal dato che lo giustifica.
5. "mission_control.load_adjustment_pct": intero fra -50 e 0 — quanto ridurre visivamente il carico di studio consigliato oggi rispetto al piano standard (0 = nessuna riduzione, banda OTTIMALE; fra -10 e -20 per ATTENZIONE; fra -25 e -40 per CRITICO). "rationale": una frase, il motivo dominante.
6. "focus_timer.focus_minutes"/"break_minutes": il preset Pomodoro più adatto allo stato odierno del Cadetto — intervalli realistici (focus 20-55 min, pausa 5-15 min): tipicamente 25/5 in banda CRITICO o ATTENZIONE (sessioni brevi, meno rischio di crollo a metà blocco), fino a 50/10 in banda OTTIMALE (deep work sostenuto). "preset_label": stringa breve tipo "25/5 — Recupero" o "50/10 — Deep Work". "rationale": una frase.
7. "study_window.start_hour"/"end_hour": interi 0-23 (ora locale, formato 24h) — la finestra di 2-4 ore in cui il Cadetto dovrebbe affrontare gli argomenti più ostici oggi. Se nel messaggio utente è presente "storico_finestra_produttiva_utente", trattalo come segnale FORTE (ma non vincolante) sull'orario in cui il Cadetto rende storicamente di più, e preferiscilo salvo che lo stato soggettivo odierno suggerisca chiaramente il contrario; altrimenti deducila dal suo stato di energia/focus soggettivo quando disponibile (es. energia bassa la mattina -> finestra pomeridiana), o infine una finestra pomeridiana ragionevole di default. "label": stringa tipo "15:00–18:00". "rationale": una frase — se hai usato lo storico, dillo esplicitamente.
8. "study_focus" — il cuore del piano operativo di oggi. Nel messaggio utente trovi "argomenti_e_materie_oggi": { materie_in_focus, argomenti_disponibili, ripassi_scaduti } — un piccolo paniere REALE di materie/argomenti del Web-Matrix del Cadetto, ognuno con nome, obiettivo, eventuali note (blueprint) e difficoltà percepita. Leggi il CONTENUTO di ogni candidato (non solo il nome) e scegli:
   - "argomento_principale": IL candidato più sensato da affrontare oggi come lavoro di studio vero e proprio (di norma un argomento "DISPONIBILE" nuovo, non un ripasso — i ripassi sono in genere rapidi e vanno nella lista separata). "metodo": 1-3 frasi che NOMINANO ESPLICITAMENTE la tecnica di studio più adatta al contenuto specifico di quell'argomento (es. richiamo attivo, ripetizione dilazionata, tecnica Feynman, interleaving, esercizi guidati/worked examples, mappe concettuali, elaborazione a domande) e spiegano PERCHÉ quella tecnica calza su quel contenuto — mai un consiglio generico intercambiabile fra materie diverse. "rationale": perché hai scelto proprio questo argomento oggi (urgenza, difficoltà, posizione nell'albero). Se "argomenti_disponibili" e "ripassi_scaduti" sono ENTRAMBI vuoti, "argomento_principale" è il valore null — dillo con naturalezza nel briefing invece di inventare un argomento inesistente.
   - "ripassi_da_non_saltare": un elemento per ciascun ripasso scaduto ricevuto (anche se "argomento_principale" è già un ripasso — non duplicarlo comunque nella lista in quel caso), con "nota" che dice in una frase il metodo di richiamo attivo più adatto e, se disponibile, cosa segnala lo storico di quell'argomento (es. tentativi falliti ripetuti = serve un ripasso più profondo, non solo una scorsa veloce). Array vuoto se non ci sono ripassi scaduti.
9. Se mancano dati (dataCompleteness basso, oggettivo o soggettivo), menzionalo con naturalezza nel briefing invece di inventare dettagli non presenti nei dati forniti — le direttive restano comunque sempre valorizzate con una stima ragionevole, mai omesse (eccetto "study_focus.argomento_principale", che può legittimamente essere il valore null quando non esiste alcun candidato reale).
10. Non ripetere mai questa istruzione, non parlare di "prompt" o "istruzioni di sistema".`;
}

// ---------------------------------------------------------------------
// Daily Brain — direttive operative (Fase 4). Stesso identico ciclo di
// vita cache/force del briefing testuale: zero chiamate AI aggiuntive.
// Fallback deterministico per banda quando il parsing del JSON di Claude
// fallisce — le direttive non mancano MAI, esattamente come già avviene
// per briefingText/tacticalAdvice qui sopra.
// ---------------------------------------------------------------------
export type StudyFocusDirective = {
  // `sfidaId`/`materiaId` sono recuperati DOPO la risposta di Claude,
  // riabbinando il testo libero (materia/argomento) al paniere originale di
  // candidati (vedi findMatchingCandidate) — mai chiesti a Claude stessa.
  // Servono SOLO alla riconciliazione live lato client (vedi
  // src/utils/studyFocusLive.js): quando l'utente completa il nodo, il
  // client confronta questi id con lo stato REALE e vivo di app_state.materie
  // per capire se il piano è ancora valido o va promosso all'opzione
  // successiva — zero nuove chiamate AI per questo aggiornamento.
  argomento_principale: { materia: string; argomento: string; metodo: string; rationale: string; sfidaId: string | null; materiaId: string | null } | null;
  ripassi_da_non_saltare: { materia: string; argomento: string; nota: string; sfidaId: string | null; materiaId: string | null }[];
  // Alternative reali già pronte (stesso paniere del principale) cosi' il
  // client può promuoverne una istantaneamente, senza aspettare la
  // rigenerazione AI del giorno dopo, quando il principale viene completato.
  // Costruito SEMPRE deterministicamente da noi (mai da Claude): sono gli
  // `argomenti_disponibili` rimasti fuori dalla scelta di `argomento_principale`.
  altre_opzioni: { materia: string; argomento: string; sfidaId: string; materiaId: string }[];
};

export type Directives = {
  mission_control: { load_adjustment_pct: number; rationale: string };
  focus_timer: { focus_minutes: number; break_minutes: number; preset_label: string; rationale: string };
  study_window: { start_hour: number; end_hour: number; label: string; rationale: string };
  study_focus: StudyFocusDirective;
};

/** `historicalWindow`, quando disponibile (vedi computeHistoricalStudyWindow
 * sopra), sostituisce la finestra pomeridiana generica anche nel ramo di
 * FALLBACK deterministico — non solo nel prompt inviato a Claude — cosi'
 * anche un utente il cui parsing JSON fallisce oggi riceve comunque una
 * finestra personalizzata invece del default statico, quando lo storico
 * lo consente. */
/** Costruisce il ramo `study_focus` del fallback deterministico da un
 * `StudyFocusSnapshot` già calcolato — mai una chiamata AI qui dentro,
 * solo trasformazione dei candidati già selezionati da
 * selectStudyFocusCandidates in una Directive valida. Con nessun
 * candidato disponibile, `argomento_principale` è onestamente `null`
 * (mai un argomento inventato) e l'elenco ripassi resta vuoto. */
function defaultStudyFocusDirective(studyFocus: StudyFocusSnapshot): StudyFocusDirective {
  const primary = pickFallbackPrimaryTopic(studyFocus);
  const ripassi = studyFocus.ripassi_scaduti
    // Se il ripasso scelto come principale è ANCHE nella lista ripassi,
    // non duplicarlo — stessa regola richiesta a Claude nel prompt.
    .filter((r) => !(primary && primary.tipo === 'RIPASSO_SCADUTO' && r.argomento === primary.argomento && r.materia === primary.materia))
    .map((r) => ({
      materia: r.materia,
      argomento: r.argomento,
      nota:
        (r.tentativiFalliti ?? 0) > (r.tentativiSuccessi ?? 0) && (r.tentativiFalliti ?? 0) > 0
          ? `Storico di ripassi difficili su questo argomento: dedica più tempo del solito, non solo una scorsa veloce. ${genericMethodForDifficulty(r.difficulty, 'RIPASSO_SCADUTO')}`
          : genericMethodForDifficulty(r.difficulty, 'RIPASSO_SCADUTO'),
      sfidaId: r.sfidaId,
      materiaId: r.materiaId
    }));

  // Tutti gli "argomenti_disponibili" non scelti come principale diventano
  // opzioni pronte per la promozione client-side istantanea (vedi commento
  // sul tipo StudyFocusDirective sopra) — mai un piano limitato a un solo
  // argomento senza alternative quando ne esistono di reali.
  const altreOpzioni = studyFocus.argomenti_disponibili
    .filter((c) => !primary || c.sfidaId !== primary.sfidaId)
    .map((c) => ({ materia: c.materia, argomento: c.argomento, sfidaId: c.sfidaId, materiaId: c.materiaId }));

  return {
    argomento_principale: primary
      ? {
          materia: primary.materia,
          argomento: primary.argomento,
          metodo: genericMethodForDifficulty(primary.difficulty, primary.tipo),
          rationale:
            primary.tipo === 'DISPONIBILE'
              ? `Prossimo argomento disponibile in ${primary.materia}, fra le materie più urgenti del piano di studi.`
              : `Nessun nuovo argomento disponibile nelle materie in focus: il ripasso più scaduto (${primary.materia}) diventa la priorità operativa di oggi.`,
          sfidaId: primary.sfidaId,
          materiaId: primary.materiaId
        }
      : null,
    ripassi_da_non_saltare: ripassi,
    altre_opzioni: altreOpzioni
  };
}

export function defaultDirectivesForBand(
  band: 'OTTIMALE' | 'ATTENZIONE' | 'CRITICO',
  historicalWindow: HistoricalStudyWindow | null = null,
  studyFocus: StudyFocusSnapshot = EMPTY_STUDY_FOCUS
): Directives {
  const studyWindow = historicalWindow
    ? {
        start_hour: historicalWindow.start_hour,
        end_hour: historicalWindow.end_hour,
        label: historicalWindow.label,
        rationale: 'Finestra dedotta dallo storico delle tue sessioni di Focus più frequenti negli ultimi 60 giorni.'
      }
    : {
        start_hour: 15,
        end_hour: 18,
        label: '15:00–18:00',
        rationale: 'Finestra pomeridiana di default — storico di Focus insufficiente per una stima più precisa.'
      };
  const studyFocusDirective = defaultStudyFocusDirective(studyFocus);

  if (band === 'CRITICO') {
    return {
      mission_control: { load_adjustment_pct: -30, rationale: 'Readiness biometrica in banda CRITICO: de-escalation del carico odierno.' },
      focus_timer: { focus_minutes: 25, break_minutes: 5, preset_label: '25/5 — Recupero', rationale: 'Sessioni brevi per limitare il rischio di crollo a metà blocco.' },
      study_window: studyWindow,
      study_focus: studyFocusDirective
    };
  }
  if (band === 'ATTENZIONE') {
    return {
      mission_control: { load_adjustment_pct: -10, rationale: 'Readiness biometrica in banda ATTENZIONE: margini ridotti, lieve contenimento del carico.' },
      focus_timer: { focus_minutes: 25, break_minutes: 5, preset_label: '25/5 — Standard', rationale: 'Preset prudente in attesa di un recupero più solido.' },
      study_window: studyWindow,
      study_focus: studyFocusDirective
    };
  }
  return {
    mission_control: { load_adjustment_pct: 0, rationale: 'Readiness biometrica in banda OTTIMALE: nessuna riduzione necessaria.' },
    focus_timer: { focus_minutes: 50, break_minutes: 10, preset_label: '50/10 — Deep Work', rationale: 'Recupero pieno: sessioni lunghe sostenibili senza cali di rendimento.' },
    study_window: studyWindow,
    study_focus: studyFocusDirective
  };
}

/** Valida/clampa una singola voce di "ripassi_da_non_saltare" — stringhe
 * non vuote per tutti e 3 i campi, altrimenti la voce viene scartata
 * (mai una riga a metà, con un campo mancante, propagata alla UI). */
function sanitizeRipassoEntry(raw: unknown): { materia: string; argomento: string; nota: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const materia = typeof r.materia === 'string' ? r.materia.trim() : '';
  const argomento = typeof r.argomento === 'string' ? r.argomento.trim() : '';
  const nota = typeof r.nota === 'string' ? r.nota.trim() : '';
  if (!materia || !argomento || !nota) return null;
  return { materia: materia.slice(0, 120), argomento: argomento.slice(0, 160), nota: nota.slice(0, 400) };
}

/** Riabbina un materia/argomento in testo libero (uscito dalla risposta di
 * Claude, quindi potenzialmente riformulato) al candidato originale del
 * paniere — confronto case-insensitive, spazi ai bordi ignorati. Nessun
 * abbinamento (Claude ha riformulato troppo, o ha "inventato" un nome
 * leggermente diverso) restituisce `null`: il testo scelto da Claude resta
 * comunque valido e visibile, semplicemente senza id per la riconciliazione
 * live lato client su quella singola voce. */
function findMatchingCandidate(materia: string, argomento: string, studyFocus: StudyFocusSnapshot): StudyTopicCandidate | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const wantMateria = norm(materia);
  const wantArgomento = norm(argomento);
  const pool = [...studyFocus.argomenti_disponibili, ...studyFocus.ripassi_scaduti];
  return pool.find((c) => norm(c.materia) === wantMateria && norm(c.argomento) === wantArgomento) ?? null;
}

/** Valida/clampa il ramo "study_focus" della risposta di Claude — come
 * ogni altro blocco di sanitizeDirectives, un'anomalia qualunque (campo
 * mancante, tipo sbagliato) fa ricadere SOLO questo blocco sul default
 * deterministico, mai l'intero payload. `argomento_principale: null` è un
 * valore legittimo (nessun candidato reale) e viene accettato come tale
 * SOLO se Claude non aveva candidati nel prompt — se il paniere inviato
 * aveva almeno un candidato, un `null` di Claude è trattato come anomalia
 * (si ricade sul fallback) per evitare che un argomento reale disponibile
 * venga silenziosamente ignorato. */
function sanitizeStudyFocus(raw: unknown, studyFocus: StudyFocusSnapshot, fallback: StudyFocusDirective): StudyFocusDirective {
  const hadCandidates = studyFocus.argomenti_disponibili.length > 0 || studyFocus.ripassi_scaduti.length > 0;
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;

  let argomentoPrincipale: StudyFocusDirective['argomento_principale'] = fallback.argomento_principale;
  if (r.argomento_principale === null) {
    argomentoPrincipale = hadCandidates ? fallback.argomento_principale : null;
  } else if (r.argomento_principale && typeof r.argomento_principale === 'object') {
    const ap = r.argomento_principale as Record<string, unknown>;
    const materia = typeof ap.materia === 'string' ? ap.materia.trim() : '';
    const argomento = typeof ap.argomento === 'string' ? ap.argomento.trim() : '';
    const metodo = typeof ap.metodo === 'string' ? ap.metodo.trim() : '';
    const rationale = typeof ap.rationale === 'string' ? ap.rationale.trim() : '';
    if (materia && argomento && metodo) {
      const matched = findMatchingCandidate(materia, argomento, studyFocus);
      argomentoPrincipale = {
        materia: materia.slice(0, 120),
        argomento: argomento.slice(0, 160),
        metodo: metodo.slice(0, 500),
        rationale: rationale.slice(0, 400) || fallback.argomento_principale?.rationale || '',
        sfidaId: matched ? matched.sfidaId : null,
        materiaId: matched ? matched.materiaId : null
      };
    } else {
      argomentoPrincipale = fallback.argomento_principale;
    }
  }

  const ripassiRaw = Array.isArray(r.ripassi_da_non_saltare) ? r.ripassi_da_non_saltare : null;
  const ripassiDaNonSaltare = ripassiRaw
    ? ripassiRaw
        .map(sanitizeRipassoEntry)
        .filter((e): e is { materia: string; argomento: string; nota: string } => e !== null)
        .slice(0, MAX_DUE_REVIEWS)
        .map((e) => {
          const matched = findMatchingCandidate(e.materia, e.argomento, studyFocus);
          return { ...e, sfidaId: matched ? matched.sfidaId : null, materiaId: matched ? matched.materiaId : null };
        })
    : fallback.ripassi_da_non_saltare;

  // "altre_opzioni" non viene mai chiesto a Claude: è ricostruito qui in modo
  // interamente deterministico, escludendo dal paniere originale l'argomento
  // scelto come principale (per id se recuperato, altrimenti per testo) —
  // cosi' il client ha sempre alternative pronte per la promozione live
  // anche quando Claude riformula leggermente il nome del principale.
  const chosenSfidaId = argomentoPrincipale?.sfidaId ?? null;
  const chosenKey = argomentoPrincipale ? `${argomentoPrincipale.materia.trim().toLowerCase()}|||${argomentoPrincipale.argomento.trim().toLowerCase()}` : null;
  const altreOpzioni = studyFocus.argomenti_disponibili
    .filter((c) => {
      if (chosenSfidaId) return c.sfidaId !== chosenSfidaId;
      if (chosenKey) return `${c.materia.trim().toLowerCase()}|||${c.argomento.trim().toLowerCase()}` !== chosenKey;
      return true;
    })
    .map((c) => ({ materia: c.materia, argomento: c.argomento, sfidaId: c.sfidaId, materiaId: c.materiaId }));

  return { argomento_principale: argomentoPrincipale, ripassi_da_non_saltare: ripassiDaNonSaltare, altre_opzioni: altreOpzioni };
}

/** Blindatura: ogni campo numerico/stringa viene validato e clampato
 * PRIMA di lasciare la function — mai un valore fuori range o mancante
 * propagato al client (che a sua volta lo userebbe per impostare i minuti
 * REALI del Focus Timer). Qualsiasi anomalia nella risposta di Claude fa
 * ricadere il singolo blocco (mission_control/focus_timer/study_window/
 * study_focus) sul default deterministico della banda — mai l'intero
 * payload. */
export function sanitizeDirectives(
  raw: unknown,
  band: 'OTTIMALE' | 'ATTENZIONE' | 'CRITICO',
  historicalWindow: HistoricalStudyWindow | null = null,
  studyFocus: StudyFocusSnapshot = EMPTY_STUDY_FOCUS
): Directives {
  const fallback = defaultDirectivesForBand(band, historicalWindow, studyFocus);
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;

  const mc = r.mission_control as Record<string, unknown> | undefined;
  const missionControl =
    mc && typeof mc === 'object' && Number.isFinite(Number(mc.load_adjustment_pct))
      ? {
          load_adjustment_pct: clamp(Math.round(Number(mc.load_adjustment_pct)), -50, 0),
          rationale: typeof mc.rationale === 'string' && mc.rationale.trim() ? mc.rationale.trim().slice(0, 400) : fallback.mission_control.rationale
        }
      : fallback.mission_control;

  const ft = r.focus_timer as Record<string, unknown> | undefined;
  const focusMinutesOk = ft && Number.isFinite(Number(ft.focus_minutes)) && Number(ft.focus_minutes) >= 10 && Number(ft.focus_minutes) <= 90;
  const breakMinutesOk = ft && Number.isFinite(Number(ft.break_minutes)) && Number(ft.break_minutes) >= 2 && Number(ft.break_minutes) <= 30;
  const focusTimer =
    ft && typeof ft === 'object' && focusMinutesOk && breakMinutesOk
      ? {
          focus_minutes: Math.round(Number(ft.focus_minutes)),
          break_minutes: Math.round(Number(ft.break_minutes)),
          preset_label: typeof ft.preset_label === 'string' && ft.preset_label.trim() ? ft.preset_label.trim().slice(0, 60) : fallback.focus_timer.preset_label,
          rationale: typeof ft.rationale === 'string' && ft.rationale.trim() ? ft.rationale.trim().slice(0, 400) : fallback.focus_timer.rationale
        }
      : fallback.focus_timer;

  const sw = r.study_window as Record<string, unknown> | undefined;
  const startOk = sw && Number.isFinite(Number(sw.start_hour)) && Number(sw.start_hour) >= 0 && Number(sw.start_hour) <= 23;
  const endOk = sw && Number.isFinite(Number(sw.end_hour)) && Number(sw.end_hour) >= 0 && Number(sw.end_hour) <= 23;
  const studyWindow =
    sw && typeof sw === 'object' && startOk && endOk
      ? {
          start_hour: Math.round(Number(sw.start_hour)),
          end_hour: Math.round(Number(sw.end_hour)),
          label: typeof sw.label === 'string' && sw.label.trim() ? sw.label.trim().slice(0, 40) : fallback.study_window.label,
          rationale: typeof sw.rationale === 'string' && sw.rationale.trim() ? sw.rationale.trim().slice(0, 400) : fallback.study_window.rationale
        }
      : fallback.study_window;

  const studyFocusDirective = sanitizeStudyFocus(r.study_focus, studyFocus, fallback.study_focus);
  return { mission_control: missionControl, focus_timer: focusTimer, study_window: studyWindow, study_focus: studyFocusDirective };
}

export function buildUserPrompt(params: {
  date: string;
  readiness: ReturnType<typeof computeReadinessScore>;
  band: string;
  bio: Biometrics;
  subjective: Subjective;
  previousBriefing: string | null;
  historicalWindow?: HistoricalStudyWindow | null;
  studyFocus?: StudyFocusSnapshot;
}) {
  const { date, readiness, band, bio, subjective, previousBriefing, historicalWindow, studyFocus } = params;
  return JSON.stringify(
    {
      data: date,
      readiness_score: readiness.score,
      readiness_band: band,
      score_breakdown: readiness.breakdown,
      biometria_oggettiva_oggi: bio ?? 'non disponibile',
      recovery_survey_soggettivo_oggi: subjective
        ? {
            focus_level: subjective.focus_level ?? null,
            energy_level: subjective.energy_level ?? subjective.mood ?? null,
            stress_level: subjective.stress_level ?? null,
            muscle_soreness: subjective.muscle_soreness ?? null,
            caffeine_mg: subjective.caffeine_mg ?? null
          }
        : 'non disponibile',
      briefing_di_ieri: previousBriefing ?? null,
      // V35.1 — segnale opzionale, sola lettura, dallo storico Focus del
      // Cloud State — null quando lo storico è insufficiente (vedi
      // computeHistoricalStudyWindow): in quel caso Claude non riceve
      // alcuna indicazione fuorviante e ricade sulle regole generiche.
      storico_finestra_produttiva_utente: historicalWindow ?? null,
      // V35.3 — paniere di argomenti/materie reali (Study Focus Engine,
      // vedi selectStudyFocusCandidates) — mai l'intero Web-Matrix, solo
      // i candidati rilevanti per oggi. `null` di ogni singolo campo non
      // esiste qui: con nessun candidato, le liste sono semplicemente
      // vuote (EMPTY_STUDY_FOCUS).
      argomenti_e_materie_oggi: studyFocus ?? EMPTY_STUDY_FOCUS
    },
    null,
    2
  );
}

// ---------------------------------------------------------------------
// Governance dei costi — limite di rigenerazioni manuali/giorno
// ---------------------------------------------------------------------
/** Tetto alle rigenerazioni manuali (`force: true`) per utente/giorno —
 * la PRIMA generazione del giorno (automatica o manuale che sia) non
 * conta come "rigenerazione" e non è mai soggetta a questo limite: solo
 * le chiamate `force: true` SUCCESSIVE alla prima, quando esiste già un
 * briefing per quella data, vengono conteggiate e bloccate oltre soglia.
 * Con Haiku e max_tokens 700, anche nel caso peggiore (ogni utente attivo
 * esaurisce il tetto ogni giorno) il costo resta un multiplo piccolo e
 * prevedibile del costo di una singola chiamata/utente/giorno — mai più
 * un budget potenzialmente illimitato lasciato al solo buon senso del
 * client. */
// Single-user app (vedi CLAUDE.md): il costo di una rigenerazione manuale è
// trascurabile, quindi il limite serve solo a evitare loop accidentali
// (es. un bottone premuto ripetutamente per errore), non a contenere la
// spesa — alzato da 5 a 20/giorno.
export const MAX_FORCE_REGENERATIONS_PER_DAY = 20;
