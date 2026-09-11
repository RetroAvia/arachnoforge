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
  MAX_FORCE_REGENERATIONS_PER_DAY
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
