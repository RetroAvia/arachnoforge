// =====================================================================
// ArachnoForge — src/utils/spiderSense.test.js (V36.0 → V42)
// Test del motore di ripetizione dilazionata.
//
// V42 — il motore è FSRS-5 (stabilità, difficoltà, ricordo che scende
// col tempo). Ciò che conta verificare:
//  - il TEMPO passato conta: un ripasso puntuale fa crescere la memoria,
//    uno ripetuto nella stessa giornata no;
//  - i quattro giudizi sono ordinati: un voto più alto non dà mai una
//    data più vicina di uno più basso;
//  - l'esame: nelle ultime tre settimane ogni argomento passa dalle tre
//    finestre di ripasso finale, nel giorno meno carico, mai dopo l'esame.
// Ogni test fissa il giorno (`todayKey`): niente dipende dall'orologio.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_RATING,
  CHECKPOINT_WINDOWS,
  MAX_INTERVAL_DAYS,
  DESIRED_RETENTION,
  retrievability,
  intervalForRetention,
  memoryState,
  nodeRetrievability,
  retrievabilityAt,
  checkpointDates,
  placeReviewDate,
  computeInitialReview,
  scheduleNextReview,
  previewReviewIntervals,
  rescheduleForExam,
  reviewLoadByDate,
  rescheduleMateriaReviews,
  reviewedToday,
  migrateSrsFields
} from './spiderSense.js';
import { addDaysToDateOnly, daysBetweenDateKeys } from './dateUtils.js';

const OGGI = '2026-10-05';
const giorno = (n) => addDaysToDateOnly(OGGI, n);
const alle = (dateKey) => `${dateKey}T10:00:00.000Z`;
const distanza = (dateKey) => daysBetweenDateKeys(OGGI, dateKey);

/** Un nodo completato, con la memoria indicata, ripassato `giorniFa` giorni fa. */
function nodo({ stabilita = 10, difficolta = 5, giorniFa = 10, ...extra } = {}) {
  return {
    id: 'n1',
    status: 'COMPLETED',
    srsStability: stabilita,
    srsDifficulty: difficolta,
    lastReviewedAt: alle(giorno(-giorniFa)),
    nextReviewDate: giorno(stabilita - giorniFa),
    reviewCount: 3,
    ...extra
  };
}

describe('il modello FSRS', () => {
  test('dopo S giorni la probabilità di ricordo è il 90%: S è anche l\'intervallo naturale', () => {
    assert.ok(Math.abs(retrievability(12, 12) - DESIRED_RETENTION) < 1e-9);
    assert.ok(Math.abs(intervalForRetention(12) - 12) < 1e-9);
    assert.equal(retrievability(0, 12), 1);
    assert.ok(retrievability(30, 12) < retrievability(10, 12), 'il ricordo scende col tempo');
    assert.equal(retrievability(5, 0), 0, 'senza stabilità nessun ricordo');
  });

  test('il ricordo di oggi dipende da quando hai ripassato l\'ultima volta', () => {
    const recente = nodo({ stabilita: 10, giorniFa: 1 });
    const vecchio = nodo({ stabilita: 10, giorniFa: 40 });
    assert.ok(nodeRetrievability(recente, OGGI) > 0.95);
    assert.ok(nodeRetrievability(vecchio, OGGI) < 0.75);
    assert.equal(nodeRetrievability({ ...recente, status: 'PENDING' }, OGGI), null, 'solo i nodi completati hanno memoria');
    // Senza altri ripassi, all'esame fra 30 giorni il ricordo sarà più basso.
    assert.ok(retrievabilityAt(recente, giorno(30)) < nodeRetrievability(recente, OGGI));
  });

  test('un nodo salvato prima della V42 ottiene una memoria equivalente dal vecchio intervallo', () => {
    const m = memoryState({ status: 'COMPLETED', srsIntervalDays: 16, srsEase: 2.3, completionTimestamp: alle(giorno(-5)) });
    assert.equal(m.known, false);
    assert.equal(m.stability, 16);
    assert.equal(m.lastKey, giorno(-5));
    assert.ok(m.difficulty >= 1 && m.difficulty <= 10);
  });
});

describe('computeInitialReview', () => {
  test('primo completamento: il ripasso torna fra 1, 2 o 3 giorni secondo la difficoltà dichiarata', () => {
    const giorni = (difficulty) => distanza(computeInitialReview(null, { sfida: { difficulty }, todayKey: OGGI }).nextReviewDate);
    assert.equal(giorni('HARD'), 1);
    assert.equal(giorni('MEDIUM'), 2);
    assert.equal(giorni('EASY'), 3);
    assert.equal(giorni(undefined), 2);
  });

  test('ricompletare un nodo riaperto non cancella la memoria che aveva', () => {
    const r = computeInitialReview(null, { sfida: { difficulty: 'HARD', srsStability: 40, srsDifficulty: 4 }, todayKey: OGGI });
    assert.equal(r.srsStability, 40);
    assert.equal(r.srsDifficulty, 4);
  });

  test("con l'esame fra 3 giorni: un argomento fragile ripassa prima; uno solido non viene forzato", () => {
    // Difficile: primo ripasso domani, prima dell'esame.
    const fragile = computeInitialReview(giorno(3), { sfida: { difficulty: 'HARD' }, todayKey: OGGI });
    assert.ok(fragile.nextReviewDate < giorno(3));
    // Facile: all'esame il ricordo resta sopra l'85% senza ripassi, quindi
    // il ripasso non viene anticipato alla vigilia (V42: niente più tutti i
    // ripassi ammucchiati il giorno prima).
    const solido = computeInitialReview(giorno(3), { sfida: { difficulty: 'EASY' }, todayKey: OGGI, nowIso: alle(OGGI) });
    assert.ok(retrievabilityAt({ ...solido, status: 'COMPLETED' }, giorno(3)) >= 0.85);
    assert.equal(solido.nextReviewDate, giorno(3));
  });
});

describe('scheduleNextReview — il tempo passato conta', () => {
  test('un ripasso puntuale riuscito fa crescere la stabilità di più volte', () => {
    const r = scheduleNextReview(nodo({ stabilita: 10, giorniFa: 10 }), REVIEW_RATING.MEDIUM, null, { todayKey: OGGI, nowIso: alle(OGGI) });
    assert.ok(r.srsStability > 20, `stabilità ${r.srsStability}`);
    assert.equal(r.elapsedDays, 10);
    assert.ok(Math.abs(r.retrievabilityAtReview - 0.9) < 0.01);
  });

  test('ripetere nella stessa giornata non gonfia la memoria (niente più "tre Facile = 180 giorni")', () => {
    let n = nodo({ stabilita: 10, giorniFa: 10 });
    n = { ...n, ...scheduleNextReview(n, REVIEW_RATING.EASY, null, { todayKey: OGGI, nowIso: alle(OGGI) }) };
    const dopoUno = n.srsStability;
    for (let i = 0; i < 2; i += 1) n = { ...n, ...scheduleNextReview(n, REVIEW_RATING.EASY, null, { todayKey: OGGI, nowIso: alle(OGGI) }) };
    assert.equal(n.srsStability, dopoUno);
  });

  test('un ripasso anticipato fa crescere la memoria molto meno di uno puntuale', () => {
    const anticipato = scheduleNextReview(nodo({ stabilita: 30, giorniFa: 2 }), REVIEW_RATING.MEDIUM, null, { todayKey: OGGI });
    const puntuale = scheduleNextReview(nodo({ stabilita: 30, giorniFa: 30 }), REVIEW_RATING.MEDIUM, null, { todayKey: OGGI });
    assert.ok(anticipato.srsStability / 30 < 1.5);
    assert.ok(puntuale.srsStability > anticipato.srsStability);
  });

  test('"Non ricordavo": domani, stabilità ridotta, un errore in più', () => {
    const r = scheduleNextReview(nodo({ stabilita: 40, giorniFa: 40 }), REVIEW_RATING.AGAIN, null, { todayKey: OGGI });
    assert.equal(r.nextReviewDate, giorno(1));
    assert.ok(r.srsStability < 40);
    assert.equal(r.srsLapses, 1);
  });

  test('"Difficile" non è "dimenticato": la memoria cresce, meno che con "Bene"', () => {
    const n = nodo({ stabilita: 10, giorniFa: 10 });
    const hard = scheduleNextReview(n, REVIEW_RATING.HARD, null, { todayKey: OGGI });
    const good = scheduleNextReview(n, REVIEW_RATING.MEDIUM, null, { todayKey: OGGI });
    assert.ok(hard.srsStability > 10);
    assert.ok(hard.srsStability < good.srsStability);
    assert.ok(hard.srsDifficulty > good.srsDifficulty, 'la difficoltà sale con i giudizi bassi');
  });

  test("l'intervallo non supera mai il tetto di sicurezza", () => {
    const r = scheduleNextReview(nodo({ stabilita: 3000, giorniFa: 3000 }), REVIEW_RATING.EASY, null, { todayKey: OGGI });
    assert.equal(r.srsIntervalDays, MAX_INTERVAL_DAYS);
  });

  test('un nodo senza campi SRS e un giudizio sconosciuto non rompono niente', () => {
    const r = scheduleNextReview({ status: 'COMPLETED' }, 'BOH', null, { todayKey: OGGI });
    assert.ok(r.nextReviewDate > OGGI);
    assert.ok(Number.isFinite(r.srsStability));
  });
});

describe("le finestre di ripasso finale dell'esame", () => {
  const ESAME = giorno(30);

  test('tre finestre: da 21 a 15 giorni prima, da 10 a 6, da 4 a 1', () => {
    const w = checkpointDates(ESAME);
    assert.deepEqual(
      w.map((x) => [x.start, x.end]),
      CHECKPOINT_WINDOWS.map((c) => [addDaysToDateOnly(ESAME, -c.from), addDaysToDateOnly(ESAME, -c.to)])
    );
    assert.deepEqual(checkpointDates(null), []);
  });

  test('un intervallo che salterebbe la prossima finestra finisce dentro, nel giorno meno carico (a parità il più tardi)', () => {
    const [prima] = checkpointDates(ESAME);
    const vuoto = placeReviewDate({ intervalDays: 40, todayKey: OGGI, examDate: ESAME });
    assert.equal(vuoto, prima.end);
    const carico = new Map([[prima.end, 3], [addDaysToDateOnly(prima.end, -1), 1]]);
    const spostato = placeReviewDate({ intervalDays: 40, todayKey: OGGI, examDate: ESAME, load: carico });
    assert.ok(spostato >= prima.start && spostato <= prima.end);
    assert.equal(carico.get(spostato) || 0, 0);
  });

  test('un intervallo breve resta la data naturale', () => {
    assert.equal(placeReviewDate({ intervalDays: 3, todayKey: OGGI, examDate: ESAME }), giorno(3));
  });

  test('senza esame, o a esame passato, vale la data naturale', () => {
    assert.equal(placeReviewDate({ intervalDays: 40, todayKey: OGGI }), giorno(40));
    assert.equal(placeReviewDate({ intervalDays: 40, todayKey: OGGI, examDate: giorno(-2) }), giorno(40));
  });

  test('i quattro giudizi sono ordinati: un voto più alto non torna mai prima di uno più basso', () => {
    // Il caso segnalato: "Bene" tornava domani e "Difficile" fra 10 giorni.
    for (const stabilita of [2, 5, 12, 30]) {
      for (const esame of [giorno(9), giorno(16), giorno(25), giorno(60), null]) {
        const p = previewReviewIntervals(nodo({ stabilita, giorniFa: stabilita }), esame, { todayKey: OGGI });
        assert.ok(p.AGAIN <= p.HARD && p.HARD <= p.MEDIUM && p.MEDIUM <= p.EASY, `S=${stabilita}, esame ${esame}: ${JSON.stringify(p)}`);
      }
    }
  });

  test("un ripasso non cade mai dopo l'esame mentre c'è ancora una finestra davanti", () => {
    for (const intervalDays of [1, 5, 12, 20, 29, 45, 90]) {
      const d = placeReviewDate({ intervalDays, todayKey: OGGI, examDate: ESAME });
      assert.ok(d < ESAME, `intervallo ${intervalDays}: ${d}`);
    }
  });

  test('negli ultimi giorni un ultimo passaggio la vigilia solo se il ricordo all\'esame scenderebbe sotto l\'85%', () => {
    const esame = giorno(3);
    assert.equal(placeReviewDate({ intervalDays: 10, todayKey: OGGI, examDate: esame, stability: 1 }), giorno(2));
    assert.equal(placeReviewDate({ intervalDays: 10, todayKey: OGGI, examDate: esame, stability: 200 }), giorno(10));
  });
});

describe('ripianificare quando cambia la data d\'esame', () => {
  test('rescheduleForExam sposta un ripasso futuro dentro le finestre; uno già scaduto resta dov\'è', () => {
    const esame = giorno(20);
    const futuro = nodo({ stabilita: 60, giorniFa: 1 });
    const nuovo = rescheduleForExam(futuro, esame, { todayKey: OGGI });
    assert.ok(nuovo && nuovo < esame);
    assert.equal(rescheduleForExam(nodo({ stabilita: 5, giorniFa: 10 }), esame, { todayKey: OGGI }), null, 'scaduto: non si sposta nel futuro');
    assert.equal(rescheduleForExam({ ...futuro, status: 'PENDING' }, esame, { todayKey: OGGI }), null);
  });

  test('rescheduleMateriaReviews spalma i ripassi nelle finestre invece di ammucchiarli sulla vigilia', () => {
    const esame = giorno(25);
    const sfide = Array.from({ length: 6 }, (_, i) => ({ ...nodo({ stabilita: 60, giorniFa: 1 }), id: `n${i}` }));
    const out = rescheduleMateriaReviews(sfide, esame, OGGI);
    const date = out.map((s) => s.nextReviewDate);
    assert.ok(date.every((d) => d < esame));
    assert.ok(new Set(date).size > 1, `tutti lo stesso giorno: ${date}`);
    const load = reviewLoadByDate(out);
    assert.equal([...load.values()].reduce((a, b) => a + b, 0), 6);
    assert.equal(sfide[0].nextReviewDate, nodo({ stabilita: 60, giorniFa: 1 }).nextReviewDate, 'nessuna mutazione in place');
  });

  test('reviewLoadByDate conta solo i nodi completati, escluso quello indicato', () => {
    const sfide = [
      { id: 'a', status: 'COMPLETED', nextReviewDate: giorno(3) },
      { id: 'b', status: 'COMPLETED', nextReviewDate: giorno(3) },
      { id: 'c', status: 'PENDING', nextReviewDate: giorno(3) }
    ];
    assert.equal(reviewLoadByDate(sfide).get(giorno(3)), 2);
    assert.equal(reviewLoadByDate(sfide, 'a').get(giorno(3)), 1);
  });
});

describe('utilità', () => {
  test('reviewedToday: un solo premio al giorno per nodo', () => {
    assert.equal(reviewedToday({ lastReviewedAt: alle(OGGI), reviewCount: 1 }, OGGI), true);
    assert.equal(reviewedToday({ lastReviewedAt: alle(giorno(-1)), reviewCount: 1 }, OGGI), false);
    assert.equal(reviewedToday({ lastReviewedAt: alle(OGGI), reviewCount: 0 }, OGGI), false, 'il completamento non è un ripasso');
  });

  test('migrateSrsFields: un nodo pre-V42 ottiene stabilità, difficoltà e data dell\'ultimo ripasso', () => {
    const m = migrateSrsFields({ status: 'COMPLETED', srsIntervalDays: 14, srsEase: 2.5, nextReviewDate: giorno(4) });
    assert.equal(m.srsStability, 14);
    assert.ok(m.srsDifficulty >= 1 && m.srsDifficulty <= 10);
    assert.equal(m.lastReviewedAt.slice(0, 10), giorno(-10));
    // Un nodo non completato conserva solo una memoria già FSRS, se c'era.
    assert.deepEqual(migrateSrsFields({ status: 'PENDING' }), {});
    assert.equal(migrateSrsFields({ status: 'PENDING', srsStability: 5, srsDifficulty: 4 }).srsStability, 5);
  });
});
