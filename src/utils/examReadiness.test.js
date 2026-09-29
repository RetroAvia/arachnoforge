// =====================================================================
// ArachnoForge — src/utils/examReadiness.test.js (V36.0 → V42)
// Il verdetto "sostieni / rimanda". Ciò che conta verificare non è il
// numero esatto (i pesi sono una scelta editoriale, non una legge) ma
// che il verdetto si muova nella direzione giusta e che l'app dichiari
// onestamente quando NON ha abbastanza dati per pronunciarsi.
//
// V42 — i quattro pilastri si misurano sui dati veri: Copertura (solo
// ore di STUDIO), Memoria (ricordo FSRS dei nodi completati), Pratica
// (esercizi, simulazioni, interrogazioni) e Fattibilità (il piano
// globale). Ogni test fissa `todayKey`: niente dipende dall'orologio.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeExamReadiness, computePractice, VERDICT, READY_MIN_COVERAGE, PRACTICE_WINDOW_DAYS } from './examReadiness.js';
import { addDaysToDateOnly } from './dateUtils.js';

const OGGI = '2026-10-05';
const giorno = (n) => addDaysToDateOnly(OGGI, n);
const opts = (extra = {}) => ({ todayKey: OGGI, ...extra });

/** Ricordo solido (ripassato l'altro ieri, stabilità 60 giorni) o fragile (un mese fa, 2 giorni). */
const STABILE = { srsStability: 60, srsDifficulty: 5, lastReviewedAt: `${giorno(-2)}T10:00:00.000Z` };
const FRAGILE = { srsStability: 2, srsDifficulty: 8, lastReviewedAt: `${giorno(-30)}T10:00:00.000Z` };

/** Il piano globale che chiude tutto in tempo (nessuna ora scoperta). */
const IN_TEMPO = { hoursRemaining: 0, finalReviewHours: 0, lateHours: 0 };

/** n nodi da 2h, i primi `done` completati con la memoria indicata. */
function materia({ totale = 10, done = 0, giorniAllEsame = 30, memoria = STABILE, formatoEsame = 'SOLO_ORALE', extra = {} } = {}) {
  const sfide = Array.from({ length: totale }, (_, i) => ({
    id: `s${i}`,
    oreStimate: 2,
    focusMinutes: 0,
    status: i < done ? 'COMPLETED' : 'PENDING',
    ...(i < done ? memoria : {})
  }));
  return {
    id: 'm1',
    nome: 'Analisi 1',
    cfu: 12,
    formatoEsame,
    examDate: giorniAllEsame == null ? null : giorno(giorniAllEsame),
    examPassed: false,
    perceivedDifficulty: 3,
    sfide,
    ...extra
  };
}

describe('computeExamReadiness — verdetto', () => {
  test('senza argomenti tracciati non si pronuncia: UNKNOWN, non un falso "rimanda"', () => {
    const r = computeExamReadiness(materia({ totale: 0 }), null, null, opts());
    assert.equal(r.verdict, VERDICT.UNKNOWN);
    assert.ok(r.rationale.includes('Nessun argomento'));
  });

  test('programma tutto studiato, memoria solida, piano in tempo -> SOSTIENI', () => {
    const r = computeExamReadiness(materia({ totale: 10, done: 10, giorniAllEsame: 20 }), null, null, opts({ planQuota: IN_TEMPO }));
    assert.equal(r.verdict, VERDICT.READY);
    assert.ok(r.score >= 75);
    assert.equal(r.confidence, 1);
    assert.deepEqual(r.gates, []);
  });

  test('programma appena iniziato a ridosso dell\'esame -> RIMANDA', () => {
    const r = computeExamReadiness(materia({ totale: 10, done: 1, giorniAllEsame: 2, memoria: FRAGILE }), null, null, opts());
    assert.equal(r.verdict, VERDICT.POSTPONE);
  });

  test('a parità di copertura, una memoria fragile abbassa il punteggio', () => {
    const stabile = computeExamReadiness(materia({ totale: 10, done: 8, memoria: STABILE }), null, null, opts());
    const fragile = computeExamReadiness(materia({ totale: 10, done: 8, memoria: FRAGILE }), null, null, opts());
    assert.ok(fragile.score < stabile.score);
    assert.ok(fragile.parts.memory < 0.6);
    assert.ok(fragile.unstableNodes > 0);
  });

  test('V42: la memoria scende da sola col tempo — lo stesso programma, mesi dopo, non è più pronto', () => {
    const m = materia({ totale: 10, done: 10, giorniAllEsame: 200, memoria: { srsStability: 10, srsDifficulty: 5, lastReviewedAt: `${giorno(-2)}T10:00:00.000Z` } });
    const oggi = computeExamReadiness(m, null, null, opts({ planQuota: IN_TEMPO }));
    const fraCentoGiorni = computeExamReadiness(m, null, null, { planQuota: IN_TEMPO, todayKey: giorno(100) });
    assert.ok(fraCentoGiorni.parts.memory < oggi.parts.memory);
    assert.notEqual(fraCentoGiorni.verdict, VERDICT.READY);
    assert.ok(fraCentoGiorni.gates.includes('memory'));
  });

  test('la copertura è pesata per ORE, non per numero di nodi', () => {
    const pesante = {
      ...materia({ totale: 0 }),
      sfide: [
        { id: 'a', oreStimate: 1, focusMinutes: 0, status: 'COMPLETED', ...STABILE },
        { id: 'b', oreStimate: 1, focusMinutes: 0, status: 'COMPLETED', ...STABILE },
        { id: 'c', oreStimate: 1, focusMinutes: 0, status: 'COMPLETED', ...STABILE },
        { id: 'd', oreStimate: 27, focusMinutes: 0, status: 'PENDING' }
      ]
    };
    const r = computeExamReadiness(pesante, null, null, opts());
    // 3 nodi su 4 chiusi (75% "a conteggio") ma solo 3h su 30 (10% a ore).
    assert.ok(r.parts.coverage < 0.2, `copertura ${r.parts.coverage} calcolata a conteggio invece che a ore`);
  });

  test('V42: le sole ore di sintesi non sono copertura (preparano il materiale, non lo mettono in testa)', () => {
    const m = materia({ totale: 1, done: 0 });
    m.sfide[0] = { ...m.sfide[0], focusMinutes: 600, focusMinutesSintesi: 600, focusMinutesStudio: 0, fonti: [{ id: 'f', tipo: 'LIBRO', pagine: 100, pagineFatte: 100 }] };
    assert.equal(computeExamReadiness(m, null, null, opts()).parts.coverage, 0);
  });

  test('V42: un argomento aperto non vale mai come chiuso, per quanto lo studi', () => {
    const m = materia({ totale: 1, done: 0 });
    m.sfide[0] = { ...m.sfide[0], focusMinutes: 900, focusMinutesStudio: 900 };
    const r = computeExamReadiness(m, null, null, opts());
    assert.equal(r.parts.coverage, 0.8);
    assert.ok(r.parts.coverage < READY_MIN_COVERAGE);
  });

  test('V42: con uno scritto, SOSTIENI solo con esercizi o simulazioni registrati', () => {
    const teoria = computeExamReadiness(materia({ totale: 10, done: 10, formatoEsame: 'SCRITTO_ORALE' }), null, null, opts({ planQuota: IN_TEMPO }));
    assert.notEqual(teoria.verdict, VERDICT.READY);
    assert.ok(teoria.gates.includes('practice'));
    assert.ok(teoria.rationale.toLowerCase().includes('esercizi'));
    const conPratica = materia({ totale: 10, done: 10, formatoEsame: 'SCRITTO_ORALE' });
    conPratica.simulazioni = [{ at: `${giorno(-3)}T09:00:00.000Z`, punteggioPct: 85 }];
    const r = computeExamReadiness(conPratica, null, null, opts({ planQuota: IN_TEMPO }));
    assert.equal(r.verdict, VERDICT.READY);
  });

  test('V42: la fattibilità viene dal piano globale — ore scoperte all\'esame abbassano il verdetto', () => {
    const m = materia({ totale: 10, done: 10 });
    const scoperto = computeExamReadiness(m, null, null, opts({ planQuota: { hoursRemaining: 20, finalReviewHours: 0, lateHours: 10 } }));
    assert.equal(scoperto.parts.feasibility, 0.5);
    const inTempo = computeExamReadiness(m, null, null, opts({ planQuota: IN_TEMPO }));
    assert.equal(inTempo.parts.feasibility, 1);
    assert.ok(scoperto.score < inTempo.score);
  });

  test('V42: un appello già passato non produce un verdetto ma chiede l\'esito', () => {
    const r = computeExamReadiness(materia({ totale: 10, done: 10, giorniAllEsame: -3 }), null, null, opts({ planQuota: IN_TEMPO }));
    assert.equal(r.verdict, VERDICT.UNKNOWN);
    assert.equal(r.dataScaduta, true);
    assert.equal(r.daysRemaining, null);
    assert.ok(r.rationale.includes('esito'));
  });
});

describe('computeExamReadiness — onestà sui dati mancanti', () => {
  test('la confidenza scende quando mancano pilastri misurabili', () => {
    const senzaTutto = computeExamReadiness(materia({ totale: 10, done: 0, giorniAllEsame: null, formatoEsame: 'SCRITTO_ORALE' }), null, null, opts());
    assert.ok(senzaTutto.confidence < 0.75);
    assert.equal(senzaTutto.known.hasStability, false);
    assert.equal(senzaTutto.known.hasExamDate, false);
  });

  test('con tutti e quattro i pilastri misurati la confidenza è piena', () => {
    const m = materia({ totale: 10, done: 5, formatoEsame: 'SCRITTO_ORALE' });
    m.sfide[0].esercizi = [{ at: giorno(-4), fatti: 10, corretti: 7 }];
    const r = computeExamReadiness(m, null, null, opts({ planQuota: IN_TEMPO }));
    assert.equal(r.known.hasPractice, true);
    assert.equal(r.known.hasFeasibility, true);
    assert.equal(r.confidence, 1);
  });

  test('per un esame solo orale la pratica mancante non abbassa la confidenza', () => {
    const r = computeExamReadiness(materia({ totale: 10, done: 5, formatoEsame: 'SOLO_ORALE' }), null, null, opts({ planQuota: IN_TEMPO }));
    assert.equal(r.known.practiceOptional, true);
    assert.equal(r.confidence, 1);
  });

  test('il motivo dominante indica il pilastro davvero più carente', () => {
    const r = computeExamReadiness(materia({ totale: 10, done: 2, giorniAllEsame: 60 }), null, null, opts());
    assert.ok(r.rationale.toLowerCase().includes('studiato'), r.rationale);
    assert.ok(r.rationale.includes('8 argomenti ancora aperti'), r.rationale);
  });
});

describe('computePractice (V42)', () => {
  test('esercizi recenti, simulazioni e interrogazioni pesano insieme; i vecchi esercizi no', () => {
    const m = {
      sfide: [
        {
          esercizi: [
            { at: giorno(-3), fatti: 10, corretti: 8 },
            { at: giorno(-(PRACTICE_WINDOW_DAYS + 5)), fatti: 50, corretti: 0 }
          ],
          quizEsiti: [{ at: giorno(-2), sapevo: 2, parziale: 2, no: 0 }]
        }
      ],
      simulazioni: [{ at: giorno(-10), punteggioPct: 60 }]
    };
    const p = computePractice(m, OGGI);
    assert.deepEqual(p.esercizi, { fatti: 10, corretti: 8 });
    // 0,5 × 0,60 (simulazioni) + 0,3 × 0,80 (esercizi) + 0,2 × 0,75 (quiz).
    assert.ok(Math.abs(p.value - (0.5 * 0.6 + 0.3 * 0.8 + 0.2 * 0.75)) < 1e-9);
  });

  test('sotto i 3 esercizi e senza altro, la pratica è ignota (non zero)', () => {
    const p = computePractice({ sfide: [{ esercizi: [{ at: giorno(-1), fatti: 2, corretti: 2 }] }] }, OGGI);
    assert.equal(p.value, null);
  });

  test('delle simulazioni contano le ultime tre', () => {
    // Dalla più recente: tre simulazioni perfette, poi una vecchia andata male.
    const simulazioni = [100, 100, 100, 0].map((punteggioPct, i) => ({ at: `${giorno(-(i + 1))}T09:00:00.000Z`, punteggioPct }));
    const p = computePractice({ sfide: [], simulazioni }, OGGI);
    assert.equal(p.simulazioni.length, 3);
    assert.equal(p.value, 1);
  });
});
