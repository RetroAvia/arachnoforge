// =====================================================================
// ArachnoForge — supabase/functions/karen-oracle/_logic.test.ts
// Test unitari (Deno.test, zero dipendenze esterne) per la logica pura
// estratta in _logic.ts.
// =====================================================================
// Esecuzione (ambiente con Deno CLI installato — locale o CI):
//   deno test supabase/functions/karen-oracle/_logic.test.ts
//
// NOTA: questi test sono stati scritti ma NON eseguiti dall'assistente
// in questa sessione — l'ambiente di lavoro remoto usato per generarli
// non ha il Deno CLI disponibile. Vanno eseguiti dall'utente/CI prima
// del deploy per avere una verifica reale.
// =====================================================================

import { assertEquals, assertAlmostEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  validateDateParam,
  isoDateNDaysBefore,
  clamp,
  scoreSleep,
  scoreCardio,
  scoreActivity,
  scoreFocus,
  scoreEnergy,
  scoreStress,
  scoreSoreness,
  caffeinePenalty,
  computeReadinessScore,
  readinessBand,
  sanitizeDirectives,
  defaultDirectivesForBand,
  computeHistoricalStudyWindow,
  selectStudyFocusCandidates,
  EMPTY_STUDY_FOCUS,
  MAX_FORCE_REGENERATIONS_PER_DAY,
  computeYesterdayOutcome,
  computePersonalSleepTarget,
  candidatePool,
  buildUserPrompt,
  SLEEP_TARGET_MIN,
  SLEEP_TARGET_FLOOR_MIN,
  SLEEP_TARGET_CEILING_MIN
} from './_logic.ts';

// ---------------------------------------------------------------------
// validateDateParam
// ---------------------------------------------------------------------
Deno.test('validateDateParam — accetta una data valida YYYY-MM-DD', () => {
  assertEquals(validateDateParam('2026-09-11'), '2026-09-11');
});

Deno.test('validateDateParam — rifiuta formati non conformi', () => {
  assertEquals(validateDateParam('11-09-2026'), null);
  assertEquals(validateDateParam('2026/09/11'), null);
  assertEquals(validateDateParam(''), null);
  assertEquals(validateDateParam(undefined), null);
  assertEquals(validateDateParam(20260911), null);
});

Deno.test('validateDateParam — rifiuta overflow silenzioso (es. mese 13)', () => {
  assertEquals(validateDateParam('2026-13-40'), null);
});

Deno.test('validateDateParam — rifiuta 31 Febbraio', () => {
  assertEquals(validateDateParam('2026-02-31'), null);
});

// ---------------------------------------------------------------------
// isoDateNDaysBefore
// ---------------------------------------------------------------------
Deno.test('isoDateNDaysBefore — calcola correttamente attraversando un cambio di mese', () => {
  assertEquals(isoDateNDaysBefore('2026-03-01', 1), '2026-02-28');
});

Deno.test('isoDateNDaysBefore — 60 giorni prima', () => {
  assertEquals(isoDateNDaysBefore('2026-09-11', 60), '2026-07-13');
});

// ---------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------
Deno.test('clamp — vincola correttamente sopra/sotto/dentro il range', () => {
  assertEquals(clamp(5, 0, 10), 5);
  assertEquals(clamp(-5, 0, 10), 0);
  assertEquals(clamp(15, 0, 10), 10);
});

// ---------------------------------------------------------------------
// Sotto-punteggi readiness — dato mancante -> null (mai penalizzato)
// ---------------------------------------------------------------------
Deno.test('scoreSleep — null se il dato manca', () => {
  assertEquals(scoreSleep(null), null);
  assertEquals(scoreSleep({}), null);
});

Deno.test('scoreSleep — punteggio massimo con sonno ottimale e scomposizione deep/rem ideale', () => {
  const score = scoreSleep({ sleep_total_min: 450, sleep_deep_min: 90, sleep_rem_min: 45 });
  // durationScore = 1 (450/450), restorativeRatio = 135/450 = 0.3 = target -> qualityScore = 1
  assertAlmostEquals(score!, 25, 0.01);
});

Deno.test('scoreSleep — punteggio neutro (qualityScore 0.5) se manca la scomposizione deep/rem', () => {
  const score = scoreSleep({ sleep_total_min: 450 });
  // durationScore = 1, qualityScore = 0.5 -> (1*0.65 + 0.5*0.35) * 25
  assertAlmostEquals(score!, (0.65 + 0.175) * 25, 0.01);
});

Deno.test('scoreCardio — null se manca resting_hr o baseline', () => {
  assertEquals(scoreCardio({ resting_hr: 60 }, null), null);
  assertEquals(scoreCardio({}, 60), null);
});

Deno.test('scoreCardio — punteggio pieno se HR odierna <= baseline', () => {
  assertEquals(scoreCardio({ resting_hr: 58 }, 60), 18);
});

Deno.test('scoreActivity — punteggio pieno nella fascia 3000-15000 passi', () => {
  assertEquals(scoreActivity({ steps: 8000 }), 7);
});

Deno.test('scoreActivity — punteggio ridotto sotto i 3000 passi', () => {
  assertAlmostEquals(scoreActivity({ steps: 1500 })!, 3.5, 0.01);
});

Deno.test('scoreFocus/scoreEnergy/scoreStress/scoreSoreness — null se il dato manca', () => {
  assertEquals(scoreFocus({}), null);
  assertEquals(scoreEnergy({}), null);
  assertEquals(scoreStress({}), null);
  assertEquals(scoreSoreness({}), null);
});

Deno.test('scoreEnergy — usa mood come fallback legacy quando energy_level manca', () => {
  const withEnergyLevel = scoreEnergy({ energy_level: 8 });
  const withMoodFallback = scoreEnergy({ mood: 8 });
  assertEquals(withEnergyLevel, withMoodFallback);
});

Deno.test('scoreStress — inverte correttamente la scala (stress basso = punteggio alto)', () => {
  const lowStress = scoreStress({ stress_level: 1 })!;
  const highStress = scoreStress({ stress_level: 10 })!;
  assertEquals(lowStress, 10);
  assertEquals(highStress, 0);
});

Deno.test('caffeinePenalty — zero sotto il soft cap, positiva sopra', () => {
  assertEquals(caffeinePenalty({ caffeine_mg: 200 }), 0);
  assertEquals(caffeinePenalty({ caffeine_mg: 400 }), 0);
  assertAlmostEquals(caffeinePenalty({ caffeine_mg: 440 }), 1, 0.01);
});

// ---------------------------------------------------------------------
// computeReadinessScore
// ---------------------------------------------------------------------
Deno.test('computeReadinessScore — 100/OTTIMALE quando non c\'è alcun dato (mai un default penalizzante)', () => {
  const result = computeReadinessScore(null, null, null);
  assertEquals(result.score, 100);
  assertEquals(readinessBand(result.score), 'OTTIMALE');
});

Deno.test('computeReadinessScore — si rinormalizza sul monte-punti disponibile', () => {
  // Solo il sonno disponibile, valore ottimale -> dovrebbe dare comunque
  // un punteggio alto (100), non un punteggio parziale basso.
  const result = computeReadinessScore({ sleep_total_min: 450, sleep_deep_min: 90, sleep_rem_min: 45 }, null, null);
  assertEquals(result.score, 100);
});

Deno.test('computeReadinessScore — punteggio basso con dati scarsi su tutti i fronti', () => {
  const result = computeReadinessScore(
    { sleep_total_min: 200, resting_hr: 80, steps: 500 },
    60,
    { focus_level: 1, energy_level: 1, stress_level: 10, muscle_soreness: 10 }
  );
  assertEquals(result.score < 45, true);
  assertEquals(readinessBand(result.score), 'CRITICO');
});

// ---------------------------------------------------------------------
// readinessBand
// ---------------------------------------------------------------------
Deno.test('readinessBand — soglie esatte', () => {
  assertEquals(readinessBand(75), 'OTTIMALE');
  assertEquals(readinessBand(74), 'ATTENZIONE');
  assertEquals(readinessBand(45), 'ATTENZIONE');
  assertEquals(readinessBand(44), 'CRITICO');
  assertEquals(readinessBand(0), 'CRITICO');
  assertEquals(readinessBand(100), 'OTTIMALE');
});

// ---------------------------------------------------------------------
// defaultDirectivesForBand
// ---------------------------------------------------------------------
Deno.test('defaultDirectivesForBand — CRITICO: -30%, 25/5', () => {
  const d = defaultDirectivesForBand('CRITICO');
  assertEquals(d.mission_control.load_adjustment_pct, -30);
  assertEquals(d.focus_timer.focus_minutes, 25);
  assertEquals(d.focus_timer.break_minutes, 5);
});

Deno.test('defaultDirectivesForBand — ATTENZIONE: -10%, 25/5', () => {
  const d = defaultDirectivesForBand('ATTENZIONE');
  assertEquals(d.mission_control.load_adjustment_pct, -10);
  assertEquals(d.focus_timer.focus_minutes, 25);
});

Deno.test('defaultDirectivesForBand — OTTIMALE: 0%, 50/10', () => {
  const d = defaultDirectivesForBand('OTTIMALE');
  assertEquals(d.mission_control.load_adjustment_pct, 0);
  assertEquals(d.focus_timer.focus_minutes, 50);
  assertEquals(d.focus_timer.break_minutes, 10);
});

Deno.test('defaultDirectivesForBand — senza storico usa la finestra pomeridiana generica', () => {
  const d = defaultDirectivesForBand('OTTIMALE', null);
  assertEquals(d.study_window.start_hour, 15);
  assertEquals(d.study_window.end_hour, 18);
});

Deno.test('defaultDirectivesForBand — con storico sostituisce la finestra anche nel fallback', () => {
  const d = defaultDirectivesForBand('OTTIMALE', { start_hour: 9, end_hour: 12, label: '09:00–12:00' });
  assertEquals(d.study_window.start_hour, 9);
  assertEquals(d.study_window.end_hour, 12);
  assertEquals(d.study_window.label, '09:00–12:00');
});

// ---------------------------------------------------------------------
// sanitizeDirectives
// ---------------------------------------------------------------------
Deno.test('sanitizeDirectives — passthrough con clamp su un payload valido', () => {
  const raw = {
    mission_control: { load_adjustment_pct: -999, rationale: 'test' },
    focus_timer: { focus_minutes: 30, break_minutes: 6, preset_label: 'X', rationale: 'test' },
    study_window: { start_hour: 10, end_hour: 13, label: '10:00–13:00', rationale: 'test' }
  };
  const d = sanitizeDirectives(raw, 'OTTIMALE');
  assertEquals(d.mission_control.load_adjustment_pct, -50); // clampato a -50
  assertEquals(d.focus_timer.focus_minutes, 30);
  assertEquals(d.study_window.start_hour, 10);
});

Deno.test('sanitizeDirectives — fallback completo su input non-oggetto', () => {
  const d = sanitizeDirectives(null, 'CRITICO');
  assertEquals(d, defaultDirectivesForBand('CRITICO'));
});

Deno.test('sanitizeDirectives — fallback per-blocco su un singolo campo invalido', () => {
  const raw = {
    mission_control: { load_adjustment_pct: -10, rationale: 'ok' },
    focus_timer: { focus_minutes: 999, break_minutes: 5, preset_label: 'X', rationale: 'ok' }, // invalido: fuori range
    study_window: { start_hour: 10, end_hour: 13, label: '10:00–13:00', rationale: 'ok' }
  };
  const d = sanitizeDirectives(raw, 'ATTENZIONE');
  // mission_control e study_window passano, focus_timer ricade sul default di banda
  assertEquals(d.mission_control.load_adjustment_pct, -10);
  assertEquals(d.focus_timer, defaultDirectivesForBand('ATTENZIONE').focus_timer);
  assertEquals(d.study_window.start_hour, 10);
});

// ---------------------------------------------------------------------
// computeHistoricalStudyWindow
// ---------------------------------------------------------------------
Deno.test('computeHistoricalStudyWindow — null se starLog non è un array', () => {
  assertEquals(computeHistoricalStudyWindow(undefined, '2026-09-11'), null);
  assertEquals(computeHistoricalStudyWindow({}, '2026-09-11'), null);
});

Deno.test('computeHistoricalStudyWindow — null se ci sono meno di 5 sessioni valide', () => {
  const starLog = [
    { type: 'FOCUS_SESSION', hour: 16, dateKey: '2026-09-01' },
    { type: 'FOCUS_SESSION', hour: 16, dateKey: '2026-09-02' }
  ];
  assertEquals(computeHistoricalStudyWindow(starLog, '2026-09-11'), null);
});

Deno.test('computeHistoricalStudyWindow — ignora voci non-FOCUS_SESSION e fuori finestra/data', () => {
  const starLog = [
    { type: 'BOSS_DEFEATED', hour: 16, dateKey: '2026-09-01' },
    { type: 'FOCUS_SESSION', hour: 16, dateKey: '2026-01-01' }, // troppo vecchia (oltre 60gg)
    { type: 'FOCUS_SESSION', hour: 16, dateKey: '2026-09-11' }, // == targetDate, escluso (non "prima" di oggi)
    { type: 'FOCUS_SESSION', hour: 'diciassette', dateKey: '2026-09-05' } // hour non numerico
  ];
  assertEquals(computeHistoricalStudyWindow(starLog, '2026-09-11'), null);
});

Deno.test('computeHistoricalStudyWindow — individua correttamente la fascia più frequentata', () => {
  const mk = (hour: number, day: string) => ({ type: 'FOCUS_SESSION', hour, dateKey: day });
  const starLog = [
    mk(16, '2026-08-01'),
    mk(16, '2026-08-05'),
    mk(17, '2026-08-10'),
    mk(17, '2026-08-15'),
    mk(15, '2026-08-20'),
    // rumore isolato altrove, non abbastanza per spostare la finestra
    mk(6, '2026-08-02')
  ];
  const result = computeHistoricalStudyWindow(starLog, '2026-09-11');
  assertEquals(result !== null, true);
  // La fascia 15-18 (span di 3 ore a partire da 15 o 16) dovrebbe vincere
  assertEquals(result!.start_hour >= 14 && result!.start_hour <= 16, true);
});

Deno.test('computeHistoricalStudyWindow — gestisce correttamente il wrap-around su mezzanotte', () => {
  const mk = (hour: number, day: string) => ({ type: 'FOCUS_SESSION', hour, dateKey: day });
  const starLog = [
    mk(23, '2026-08-01'),
    mk(23, '2026-08-05'),
    mk(0, '2026-08-10'),
    mk(0, '2026-08-15'),
    mk(1, '2026-08-20')
  ];
  const result = computeHistoricalStudyWindow(starLog, '2026-09-11');
  assertEquals(result !== null, true);
  // La fascia migliore attraversa la mezzanotte: start_hour dovrebbe essere 23
  assertEquals(result!.start_hour, 23);
  assertEquals(result!.end_hour, 2);
});

// ---------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------
Deno.test('MAX_FORCE_REGENERATIONS_PER_DAY — è un intero positivo ragionevole', () => {
  assertEquals(Number.isInteger(MAX_FORCE_REGENERATIONS_PER_DAY), true);
  assertEquals(MAX_FORCE_REGENERATIONS_PER_DAY > 0, true);
  assertEquals(MAX_FORCE_REGENERATIONS_PER_DAY <= 20, true);
});

// ---------------------------------------------------------------------
// selectStudyFocusCandidates (Study Focus Engine, V35.3)
// ---------------------------------------------------------------------
function mkSfida(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sf1',
    nome: 'Argomento',
    obiettivo: 'Obiettivo',
    blueprint: '',
    difficulty: 'MEDIUM',
    status: 'PENDING',
    parentId: null,
    nextReviewDate: null,
    lastReviewRating: null,
    reviewCount: 0,
    tentativiSuccessi: 0,
    tentativiFalliti: 0,
    ...overrides
  };
}

function mkMateria(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm1',
    nome: 'Materia',
    examDate: null,
    examPassed: false,
    perceivedDifficulty: 3,
    sfide: [],
    ...overrides
  };
}

Deno.test('selectStudyFocusCandidates — materie non-array o vuoto -> EMPTY_STUDY_FOCUS', () => {
  assertEquals(selectStudyFocusCandidates(undefined, '2026-09-11'), EMPTY_STUDY_FOCUS);
  assertEquals(selectStudyFocusCandidates(null, '2026-09-11'), EMPTY_STUDY_FOCUS);
  assertEquals(selectStudyFocusCandidates([], '2026-09-11'), EMPTY_STUDY_FOCUS);
});

Deno.test('selectStudyFocusCandidates — ignora le materie con esame già superato', () => {
  const materie = [mkMateria({ id: 'm1', nome: 'Superata', examPassed: true, sfide: [mkSfida()] })];
  const result = selectStudyFocusCandidates(materie, '2026-09-11');
  assertEquals(result, EMPTY_STUDY_FOCUS);
});

Deno.test('selectStudyFocusCandidates — sceglie le 2 materie più urgenti per data esame, ignora le altre', () => {
  const materie = [
    mkMateria({ id: 'm1', nome: 'Lontana', examDate: '2026-12-01', sfide: [mkSfida({ id: 's1', nome: 'A' })] }),
    mkMateria({ id: 'm2', nome: 'Vicina', examDate: '2026-09-15', sfide: [mkSfida({ id: 's2', nome: 'B' })] }),
    mkMateria({ id: 'm3', nome: 'Media', examDate: '2026-10-01', sfide: [mkSfida({ id: 's3', nome: 'C' })] })
  ];
  const result = selectStudyFocusCandidates(materie, '2026-09-11');
  assertEquals(result.materie_in_focus, ['Vicina', 'Media']);
  assertEquals(result.argomenti_disponibili.map((c) => c.materia), ['Vicina', 'Media']);
});

Deno.test('selectStudyFocusCandidates — un nodo PENDING con figli incompleti NON è disponibile (Boss bloccato)', () => {
  const materie = [
    mkMateria({
      examDate: '2026-09-15',
      sfide: [
        mkSfida({ id: 'boss', nome: 'Modulo', status: 'PENDING' }),
        mkSfida({ id: 'figlio1', nome: 'Sotto-argomento', parentId: 'boss', status: 'PENDING' })
      ]
    })
  ];
  const result = selectStudyFocusCandidates(materie, '2026-09-11');
  // Solo il figlio (foglia, nessun sotto-figlio) è disponibile — il Boss resta bloccato.
  assertEquals(result.argomenti_disponibili.length, 1);
  assertEquals(result.argomenti_disponibili[0].argomento, 'Sotto-argomento');
});

Deno.test('selectStudyFocusCandidates — un nodo PENDING con TUTTI i figli COMPLETED è disponibile (Boss sbloccato)', () => {
  const materie = [
    mkMateria({
      examDate: '2026-09-15',
      sfide: [
        mkSfida({ id: 'boss', nome: 'Modulo', status: 'PENDING' }),
        mkSfida({ id: 'figlio1', nome: 'Sotto-argomento', parentId: 'boss', status: 'COMPLETED', nextReviewDate: '2099-01-01' })
      ]
    })
  ];
  const result = selectStudyFocusCandidates(materie, '2026-09-11');
  assertEquals(result.argomenti_disponibili.map((c) => c.argomento), ['Modulo']);
});

Deno.test('selectStudyFocusCandidates — un nodo COMPLETED non è mai fra i disponibili', () => {
  const materie = [
    mkMateria({ examDate: '2026-09-15', sfide: [mkSfida({ status: 'COMPLETED', nextReviewDate: '2099-01-01' })] })
  ];
  const result = selectStudyFocusCandidates(materie, '2026-09-11');
  assertEquals(result.argomenti_disponibili.length, 0);
});

Deno.test('selectStudyFocusCandidates — ripasso scaduto (nextReviewDate <= oggi) incluso, futuro escluso', () => {
  const materie = [
    mkMateria({
      examDate: '2026-09-15',
      sfide: [
        mkSfida({ id: 's1', nome: 'Scaduto', status: 'COMPLETED', nextReviewDate: '2026-09-01' }),
        mkSfida({ id: 's2', nome: 'Futuro', status: 'COMPLETED', nextReviewDate: '2026-12-01' }),
        mkSfida({ id: 's3', nome: 'OggiStesso', status: 'COMPLETED', nextReviewDate: '2026-09-11' })
      ]
    })
  ];
  const result = selectStudyFocusCandidates(materie, '2026-09-11');
  const nomi = result.ripassi_scaduti.map((r) => r.argomento);
  assertEquals(nomi.includes('Scaduto'), true);
  assertEquals(nomi.includes('OggiStesso'), true);
  assertEquals(nomi.includes('Futuro'), false);
});

Deno.test('selectStudyFocusCandidates — i ripassi scaduti sono raccolti da TUTTE le materie, anche quelle non in focus', () => {
  const materie = [
    mkMateria({ id: 'm1', nome: 'Vicina', examDate: '2026-09-15', sfide: [mkSfida({ id: 's1' })] }),
    mkMateria({ id: 'm2', nome: 'Media', examDate: '2026-10-01', sfide: [mkSfida({ id: 's2' })] }),
    // Terza materia, esclusa da materie_in_focus (solo le prime 2 più urgenti lo sono)...
    mkMateria({
      id: 'm3',
      nome: 'Lontana',
      examDate: '2026-12-01',
      sfide: [mkSfida({ id: 's3', nome: 'RipassoLontano', status: 'COMPLETED', nextReviewDate: '2026-09-01' })]
    })
  ];
  const result = selectStudyFocusCandidates(materie, '2026-09-11');
  assertEquals(result.materie_in_focus.includes('Lontana'), false);
  // ...ma il suo ripasso scaduto compare comunque nella lista globale.
  assertEquals(result.ripassi_scaduti.some((r) => r.argomento === 'RipassoLontano'), true);
});

Deno.test('selectStudyFocusCandidates — i ripassi più scaduti vengono prima', () => {
  const materie = [
    mkMateria({
      examDate: '2026-09-15',
      sfide: [
        mkSfida({ id: 's1', nome: 'PocoScaduto', status: 'COMPLETED', nextReviewDate: '2026-09-10' }),
        mkSfida({ id: 's2', nome: 'MoltoScaduto', status: 'COMPLETED', nextReviewDate: '2026-08-01' })
      ]
    })
  ];
  const result = selectStudyFocusCandidates(materie, '2026-09-11');
  assertEquals(result.ripassi_scaduti[0].argomento, 'MoltoScaduto');
});

// ---------------------------------------------------------------------
// defaultDirectivesForBand — study_focus
// ---------------------------------------------------------------------
Deno.test('defaultDirectivesForBand — study_focus.argomento_principale null senza candidati', () => {
  const d = defaultDirectivesForBand('OTTIMALE', null, EMPTY_STUDY_FOCUS);
  assertEquals(d.study_focus.argomento_principale, null);
  assertEquals(d.study_focus.ripassi_da_non_saltare, []);
});

Deno.test('defaultDirectivesForBand — study_focus sceglie il primo argomento disponibile come principale', () => {
  const studyFocus = {
    materie_in_focus: ['Analisi 1'],
    argomenti_disponibili: [
      { sfidaId: 's1', materiaId: 'm1', materia: 'Analisi 1', argomento: 'Limiti', obiettivo: '', blueprint: '', difficulty: 'HARD', tipo: 'DISPONIBILE' as const }
    ],
    ripassi_scaduti: []
  };
  const d = defaultDirectivesForBand('OTTIMALE', null, studyFocus);
  assertEquals(d.study_focus.argomento_principale?.materia, 'Analisi 1');
  assertEquals(d.study_focus.argomento_principale?.argomento, 'Limiti');
  // Gli id del candidato scelto si propagano al principale — riconciliazione live lato client.
  assertEquals(d.study_focus.argomento_principale?.sfidaId, 's1');
  assertEquals(d.study_focus.argomento_principale?.materiaId, 'm1');
});

Deno.test('defaultDirectivesForBand — study_focus ricade sul ripasso più scaduto se non ci sono argomenti nuovi', () => {
  const studyFocus = {
    materie_in_focus: ['Fisica'],
    argomenti_disponibili: [],
    ripassi_scaduti: [
      { sfidaId: 'sR', materiaId: 'mF', materia: 'Fisica', argomento: 'Cinematica', obiettivo: '', blueprint: '', difficulty: 'MEDIUM', tipo: 'RIPASSO_SCADUTO' as const, giorni_ripasso_scaduto: 5 }
    ]
  };
  const d = defaultDirectivesForBand('OTTIMALE', null, studyFocus);
  assertEquals(d.study_focus.argomento_principale?.argomento, 'Cinematica');
  assertEquals(d.study_focus.argomento_principale?.sfidaId, 'sR');
  // Il ripasso scelto come principale non deve duplicarsi nella lista ripassi.
  assertEquals(d.study_focus.ripassi_da_non_saltare.length, 0);
});

Deno.test('defaultDirectivesForBand — study_focus.altre_opzioni contiene gli argomenti disponibili non scelti', () => {
  const studyFocus = {
    materie_in_focus: ['Analisi 1', 'Fisica'],
    argomenti_disponibili: [
      { sfidaId: 's1', materiaId: 'm1', materia: 'Analisi 1', argomento: 'Limiti', obiettivo: '', blueprint: '', difficulty: 'HARD', tipo: 'DISPONIBILE' as const },
      { sfidaId: 's2', materiaId: 'm2', materia: 'Fisica', argomento: 'Cinematica', obiettivo: '', blueprint: '', difficulty: 'MEDIUM', tipo: 'DISPONIBILE' as const }
    ],
    ripassi_scaduti: []
  };
  const d = defaultDirectivesForBand('OTTIMALE', null, studyFocus);
  // Il primo argomento disponibile ('Limiti') è il principale...
  assertEquals(d.study_focus.argomento_principale?.sfidaId, 's1');
  // ...e il secondo diventa un'alternativa pronta, non semplicemente scartato.
  assertEquals(d.study_focus.altre_opzioni.length, 1);
  assertEquals(d.study_focus.altre_opzioni[0].sfidaId, 's2');
  assertEquals(d.study_focus.altre_opzioni[0].argomento, 'Cinematica');
});

// ---------------------------------------------------------------------
// sanitizeDirectives — study_focus
// ---------------------------------------------------------------------
Deno.test('sanitizeDirectives — study_focus valido passa così com\'è (con clamp lunghezze)', () => {
  const raw = {
    mission_control: { load_adjustment_pct: -10, rationale: 'ok' },
    focus_timer: { focus_minutes: 30, break_minutes: 5, preset_label: 'X', rationale: 'ok' },
    study_window: { start_hour: 10, end_hour: 13, label: 'L', rationale: 'ok' },
    study_focus: {
      argomento_principale: { materia: 'Analisi 1', argomento: 'Limiti', metodo: 'Tecnica Feynman.', rationale: 'Urgente.' },
      ripassi_da_non_saltare: [{ materia: 'Fisica', argomento: 'Cinematica', nota: 'Richiamo attivo.' }]
    }
  };
  const d = sanitizeDirectives(raw, 'OTTIMALE');
  assertEquals(d.study_focus.argomento_principale?.argomento, 'Limiti');
  assertEquals(d.study_focus.ripassi_da_non_saltare.length, 1);
});

Deno.test('sanitizeDirectives — un argomento_principale nullo di Claude è un\'anomalia SE il paniere aveva candidati (ricade sul fallback)', () => {
  const studyFocus = {
    materie_in_focus: ['Analisi 1'],
    argomenti_disponibili: [
      { sfidaId: 's1', materiaId: 'm1', materia: 'Analisi 1', argomento: 'Limiti', obiettivo: '', blueprint: '', difficulty: 'HARD', tipo: 'DISPONIBILE' as const }
    ],
    ripassi_scaduti: []
  };
  const raw = {
    mission_control: { load_adjustment_pct: -10, rationale: 'ok' },
    focus_timer: { focus_minutes: 30, break_minutes: 5, preset_label: 'X', rationale: 'ok' },
    study_window: { start_hour: 10, end_hour: 13, label: 'L', rationale: 'ok' },
    study_focus: { argomento_principale: null, ripassi_da_non_saltare: [] }
  };
  const d = sanitizeDirectives(raw, 'OTTIMALE', null, studyFocus);
  // Il fallback per QUESTO studyFocus sceglie 'Limiti' come principale — mai null quando esisteva un candidato reale.
  assertEquals(d.study_focus.argomento_principale?.argomento, 'Limiti');
});

Deno.test('sanitizeDirectives — un argomento_principale nullo di Claude è ACCETTATO se il paniere era vuoto', () => {
  const raw = {
    mission_control: { load_adjustment_pct: -10, rationale: 'ok' },
    focus_timer: { focus_minutes: 30, break_minutes: 5, preset_label: 'X', rationale: 'ok' },
    study_window: { start_hour: 10, end_hour: 13, label: 'L', rationale: 'ok' },
    study_focus: { argomento_principale: null, ripassi_da_non_saltare: [] }
  };
  const d = sanitizeDirectives(raw, 'OTTIMALE', null, EMPTY_STUDY_FOCUS);
  assertEquals(d.study_focus.argomento_principale, null);
});

Deno.test('sanitizeDirectives — study_focus mancante/malformato ricade sul default della banda', () => {
  const raw = {
    mission_control: { load_adjustment_pct: -10, rationale: 'ok' },
    focus_timer: { focus_minutes: 30, break_minutes: 5, preset_label: 'X', rationale: 'ok' },
    study_window: { start_hour: 10, end_hour: 13, label: 'L', rationale: 'ok' }
    // study_focus assente
  };
  const d = sanitizeDirectives(raw, 'CRITICO');
  assertEquals(d.study_focus, defaultDirectivesForBand('CRITICO').study_focus);
});

// ---------------------------------------------------------------------
// sanitizeDirectives — study_focus: riconciliazione id (V35.4) + altre_opzioni
// ---------------------------------------------------------------------
Deno.test('sanitizeDirectives — study_focus recupera sfidaId/materiaId riabbinando il testo di Claude al paniere originale', () => {
  const studyFocus = {
    materie_in_focus: ['Analisi 1'],
    argomenti_disponibili: [
      { sfidaId: 's1', materiaId: 'm1', materia: 'Analisi 1', argomento: 'Limiti', obiettivo: '', blueprint: '', difficulty: 'HARD', tipo: 'DISPONIBILE' as const },
      { sfidaId: 's2', materiaId: 'm1', materia: 'Analisi 1', argomento: 'Derivate', obiettivo: '', blueprint: '', difficulty: 'MEDIUM', tipo: 'DISPONIBILE' as const }
    ],
    ripassi_scaduti: []
  };
  const raw = {
    mission_control: { load_adjustment_pct: -10, rationale: 'ok' },
    focus_timer: { focus_minutes: 30, break_minutes: 5, preset_label: 'X', rationale: 'ok' },
    study_window: { start_hour: 10, end_hour: 13, label: 'L', rationale: 'ok' },
    study_focus: {
      // Claude riformula leggermente spazi/maiuscole — il match è case/trim-insensitive.
      argomento_principale: { materia: '  analisi 1 ', argomento: 'LIMITI', metodo: 'Tecnica Feynman.', rationale: 'Urgente.' },
      ripassi_da_non_saltare: []
    }
  };
  const d = sanitizeDirectives(raw, 'OTTIMALE', null, studyFocus);
  assertEquals(d.study_focus.argomento_principale?.sfidaId, 's1');
  assertEquals(d.study_focus.argomento_principale?.materiaId, 'm1');
  // L'unico altro disponibile ('Derivate') diventa un'opzione alternativa pronta.
  assertEquals(d.study_focus.altre_opzioni.length, 1);
  assertEquals(d.study_focus.altre_opzioni[0].sfidaId, 's2');
});

Deno.test('sanitizeDirectives — study_focus: nessun match per argomento_principale -> id null, testo comunque valido', () => {
  const studyFocus = {
    materie_in_focus: ['Analisi 1'],
    argomenti_disponibili: [
      { sfidaId: 's1', materiaId: 'm1', materia: 'Analisi 1', argomento: 'Limiti', obiettivo: '', blueprint: '', difficulty: 'HARD', tipo: 'DISPONIBILE' as const }
    ],
    ripassi_scaduti: []
  };
  const raw = {
    mission_control: { load_adjustment_pct: -10, rationale: 'ok' },
    focus_timer: { focus_minutes: 30, break_minutes: 5, preset_label: 'X', rationale: 'ok' },
    study_window: { start_hour: 10, end_hour: 13, label: 'L', rationale: 'ok' },
    study_focus: {
      // Claude ha riformulato il nome dell'argomento in modo irriconoscibile.
      argomento_principale: { materia: 'Analisi 1', argomento: 'Concetto di limite (riformulato)', metodo: 'Tecnica Feynman.', rationale: 'Urgente.' },
      ripassi_da_non_saltare: []
    }
  };
  const d = sanitizeDirectives(raw, 'OTTIMALE', null, studyFocus);
  assertEquals(d.study_focus.argomento_principale?.argomento, 'Concetto di limite (riformulato)');
  assertEquals(d.study_focus.argomento_principale?.sfidaId, null);
  // Senza un id da escludere per match, l'originale 'Limiti' resta comunque disponibile come opzione.
  assertEquals(d.study_focus.altre_opzioni.length, 1);
  assertEquals(d.study_focus.altre_opzioni[0].sfidaId, 's1');
});

Deno.test('sanitizeDirectives — study_focus: ripassi_da_non_saltare recupera anch\'esso sfidaId/materiaId per riconciliazione', () => {
  const studyFocus = {
    materie_in_focus: ['Fisica'],
    argomenti_disponibili: [],
    ripassi_scaduti: [
      { sfidaId: 'sR', materiaId: 'mF', materia: 'Fisica', argomento: 'Cinematica', obiettivo: '', blueprint: '', difficulty: 'MEDIUM', tipo: 'RIPASSO_SCADUTO' as const, giorni_ripasso_scaduto: 5 }
    ]
  };
  const raw = {
    mission_control: { load_adjustment_pct: -10, rationale: 'ok' },
    focus_timer: { focus_minutes: 30, break_minutes: 5, preset_label: 'X', rationale: 'ok' },
    study_window: { start_hour: 10, end_hour: 13, label: 'L', rationale: 'ok' },
    study_focus: {
      argomento_principale: null,
      ripassi_da_non_saltare: [{ materia: 'Fisica', argomento: 'Cinematica', nota: 'Richiamo attivo.' }]
    }
  };
  const d = sanitizeDirectives(raw, 'OTTIMALE', null, studyFocus);
  assertEquals(d.study_focus.ripassi_da_non_saltare.length, 1);
  assertEquals(d.study_focus.ripassi_da_non_saltare[0].sfidaId, 'sR');
  assertEquals(d.study_focus.ripassi_da_non_saltare[0].materiaId, 'mF');
});


// =====================================================================
// V36.0 — computePersonalSleepTarget
// =====================================================================
Deno.test('computePersonalSleepTarget — sotto la soglia di campioni resta il target universale', () => {
  const r = computePersonalSleepTarget([420, 430, 400]);
  assertEquals(r.personalized, false);
  assertEquals(r.target, SLEEP_TARGET_MIN);
});

Deno.test('computePersonalSleepTarget — con abbastanza notti usa la mediana reale', () => {
  const notti = [400, 410, 420, 420, 430, 430, 440, 450, 460, 470];
  const r = computePersonalSleepTarget(notti);
  assertEquals(r.personalized, true);
  assertEquals(r.target, 430);
});

Deno.test('computePersonalSleepTarget — un sonno cronicamente scarso NON abbassa il target sotto il pavimento fisiologico', () => {
  // Il difetto classico di questa calibrazione: se il target seguisse la
  // mediana senza limiti, dormire 4h per un mese "normalizzerebbe" le 4h
  // e il punteggio smetterebbe di segnalare il problema.
  const r = computePersonalSleepTarget(new Array(20).fill(240));
  assertEquals(r.target, SLEEP_TARGET_FLOOR_MIN);
});

Deno.test('computePersonalSleepTarget — e non lo alza oltre il tetto', () => {
  const r = computePersonalSleepTarget(new Array(20).fill(700));
  assertEquals(r.target, SLEEP_TARGET_CEILING_MIN);
});

Deno.test('scoreSleep — con target personale più basso, la stessa notte vale di più', () => {
  const notte = { sleep_total_min: 400, sleep_deep_min: 60, sleep_rem_min: 60 };
  const conTargetStandard = scoreSleep(notte, SLEEP_TARGET_MIN)!;
  const conTargetPersonale = scoreSleep(notte, 400)!;
  assertEquals(conTargetPersonale > conTargetStandard, true);
});

// =====================================================================
// V36.0 — computeYesterdayOutcome (chiusura del ciclo)
// =====================================================================
const DIRETTIVE_IERI = {
  mission_control: { load_adjustment_pct: -10, rationale: '' },
  study_window: { start_hour: 15, end_hour: 18, label: '15:00–18:00', rationale: '' }
};

Deno.test('computeYesterdayOutcome — nessuna sessione ieri: null, mai un oggetto vuoto e fuorviante', () => {
  const log = [{ type: 'FOCUS_SESSION', dateKey: '2026-09-01', minutes: 50, hour: 16, quality: 'FLOW' }];
  assertEquals(computeYesterdayOutcome(log, '2026-09-11', DIRETTIVE_IERI), null);
});

Deno.test('computeYesterdayOutcome — somma i minuti e conta le sessioni del solo giorno precedente', () => {
  const log = [
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 50, hour: 16, quality: 'FLOW' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 25, hour: 21, quality: 'DISTRACTED' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-09', minutes: 90, hour: 16, quality: 'FLOW' }
  ];
  const r = computeYesterdayOutcome(log, '2026-09-11', DIRETTIVE_IERI)!;
  assertEquals(r.data, '2026-09-10');
  assertEquals(r.minuti_studiati, 75);
  assertEquals(r.sessioni, 2);
});

Deno.test('computeYesterdayOutcome — misura quante sessioni sono cadute nella finestra consigliata', () => {
  const log = [
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 50, hour: 16, quality: 'FLOW' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 50, hour: 23, quality: 'NORMAL' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 50, hour: 9, quality: 'NORMAL' }
  ];
  const r = computeYesterdayOutcome(log, '2026-09-11', DIRETTIVE_IERI)!;
  assertEquals(r.sessioni_in_finestra_consigliata, 1);
  assertEquals(r.finestra_consigliata, '15:00–18:00');
  assertEquals(r.carico_consigliato_pct, -10);
});

Deno.test('computeYesterdayOutcome — finestra a cavallo di mezzanotte gestita col wrap-around', () => {
  const direttive = { study_window: { start_hour: 22, end_hour: 2, label: '22:00–02:00' } };
  const log = [
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 50, hour: 23, quality: 'FLOW' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 50, hour: 1, quality: 'FLOW' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 50, hour: 12, quality: 'FLOW' }
  ];
  const r = computeYesterdayOutcome(log, '2026-09-11', direttive)!;
  assertEquals(r.sessioni_in_finestra_consigliata, 2);
});

Deno.test('computeYesterdayOutcome — qualità prevalente = la più frequente, non la prima', () => {
  const log = [
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 25, hour: 10, quality: 'FLOW' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 25, hour: 11, quality: 'DISTRACTED' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 25, hour: 12, quality: 'DISTRACTED' }
  ];
  const r = computeYesterdayOutcome(log, '2026-09-11', DIRETTIVE_IERI)!;
  assertEquals(r.qualita_prevalente, 'DISTRACTED');
});

Deno.test('computeYesterdayOutcome — senza direttive di ieri riporta comunque i minuti, con finestra null', () => {
  const log = [{ type: 'FOCUS_SESSION', dateKey: '2026-09-10', minutes: 40, hour: 16, quality: 'NORMAL' }];
  const r = computeYesterdayOutcome(log, '2026-09-11', null)!;
  assertEquals(r.minuti_studiati, 40);
  assertEquals(r.sessioni_in_finestra_consigliata, null);
  assertEquals(r.finestra_consigliata, null);
});

// =====================================================================
// V36.0 — Paniere numerato: l'aggancio per INDICE
// =====================================================================
const MATERIE_DEMO = [
  {
    id: 'm1',
    nome: 'Analisi 1',
    examDate: '2026-09-20',
    examPassed: false,
    perceivedDifficulty: 4,
    sfide: [
      { id: 's1', nome: 'Limiti', obiettivo: 'o', blueprint: '', difficulty: 'MEDIUM', status: 'PENDING', parentId: null },
      { id: 's2', nome: 'Derivate', obiettivo: 'o', blueprint: '', difficulty: 'HARD', status: 'PENDING', parentId: null }
    ]
  }
];

Deno.test('candidatePool — ordine stabile: prima i disponibili, poi i ripassi scaduti', () => {
  const focus = selectStudyFocusCandidates(MATERIE_DEMO, '2026-09-11');
  const pool = candidatePool(focus);
  assertEquals(pool.length, 2);
  assertEquals(pool[0].argomento, 'Limiti');
  assertEquals(pool[1].argomento, 'Derivate');
});

Deno.test('buildUserPrompt — i candidati arrivano a Claude NUMERATI e senza id interni', () => {
  const focus = selectStudyFocusCandidates(MATERIE_DEMO, '2026-09-11');
  const readiness = computeReadinessScore(null, null, null);
  const prompt = JSON.parse(
    buildUserPrompt({
      date: '2026-09-11',
      readiness,
      band: 'OTTIMALE',
      bio: null,
      subjective: null,
      previousBriefing: null,
      studyFocus: focus
    })
  );
  const candidati = prompt.argomenti_e_materie_oggi.candidati;
  assertEquals(candidati[0].id, 0);
  assertEquals(candidati[1].id, 1);
  // Gli id interni restano dati di servizio del client: mai nel prompt.
  assertEquals(candidati[0].sfidaId, undefined);
  assertEquals(candidati[0].materiaId, undefined);
});

Deno.test('sanitizeDirectives — un indice risolve il candidato esatto, anche se Claude non scrive il nome', () => {
  const focus = selectStudyFocusCandidates(MATERIE_DEMO, '2026-09-11');
  const raw = {
    briefing_text: 'x',
    tactical_advice: 'y',
    study_focus: {
      argomento_principale: { candidato: 1, metodo: 'Worked examples.', rationale: 'Più ostico.' },
      ripassi_da_non_saltare: []
    }
  };
  const d = sanitizeDirectives(raw, 'OTTIMALE', null, focus);
  assertEquals(d.study_focus.argomento_principale?.argomento, 'Derivate');
  assertEquals(d.study_focus.argomento_principale?.sfidaId, 's2');
  assertEquals(d.study_focus.argomento_principale?.materiaId, 'm1');
});

Deno.test('sanitizeDirectives — un indice fuori range non aggancia nulla e si ricade sul fallback', () => {
  const focus = selectStudyFocusCandidates(MATERIE_DEMO, '2026-09-11');
  const raw = {
    study_focus: {
      argomento_principale: { candidato: 99, metodo: 'Boh.', rationale: '' },
      ripassi_da_non_saltare: []
    }
  };
  const d = sanitizeDirectives(raw, 'OTTIMALE', null, focus);
  // Il fallback deterministico sceglie il primo disponibile.
  assertEquals(d.study_focus.argomento_principale?.argomento, 'Limiti');
});
