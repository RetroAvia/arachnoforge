// =====================================================================
// ArachnoForge — src/utils/spiderSense.test.js (V36.0)
// Test unitari del motore di Spaced Repetition SM-2 lite. Il punto che
// contava davvero verificare: gli intervalli CRESCONO (prima erano
// costanti a vita) e non superano mai la data d'esame.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleNextReview,
  computeInitialReview,
  previewReviewIntervals,
  capIntervalToExam,
  REVIEW_RATING,
  DEFAULT_EASE,
  MIN_EASE,
  MAX_EASE,
  INITIAL_REVIEW_INTERVAL_DAYS,
  MAX_INTERVAL_DAYS
} from './spiderSense.js';

function isoInDays(days) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('computeInitialReview', () => {
  test('primo completamento: 7 giorni ed ease di default', () => {
    const r = computeInitialReview();
    assert.equal(r.srsIntervalDays, INITIAL_REVIEW_INTERVAL_DAYS);
    assert.equal(r.srsEase, DEFAULT_EASE);
    assert.equal(r.nextReviewDate, isoInDays(INITIAL_REVIEW_INTERVAL_DAYS));
  });

  test("con esame fra 3 giorni il primo ripasso cade PRIMA dell'esame, non dopo", () => {
    const r = computeInitialReview(isoInDays(3));
    assert.equal(r.srsIntervalDays, 2);
    assert.equal(r.nextReviewDate, isoInDays(2));
  });
});

describe('scheduleNextReview — la crescita che prima non esisteva', () => {
  test('una catena di "Facile" allunga progressivamente gli intervalli', () => {
    let node = { srsEase: DEFAULT_EASE, srsIntervalDays: INITIAL_REVIEW_INTERVAL_DAYS };
    const sequenza = [];
    // Tre passaggi: al quarto si incontrerebbe MAX_INTERVAL_DAYS, che è
    // un tetto voluto e verificato dal test dedicato più sotto.
    for (let i = 0; i < 3; i++) {
      node = scheduleNextReview(node, REVIEW_RATING.EASY);
      sequenza.push(node.srsIntervalDays);
    }
    // Il comportamento pre-V36.0 sarebbe stato [4, 4, 4] a vita.
    for (let i = 1; i < sequenza.length; i++) {
      assert.ok(sequenza[i] > sequenza[i - 1], `intervallo ${i} (${sequenza[i]}) non è cresciuto rispetto a ${sequenza[i - 1]}`);
    }
    assert.ok(sequenza[0] > INITIAL_REVIEW_INTERVAL_DAYS);
  });

  test('"Medio" allunga seguendo l\'ease puro, senza toccarlo', () => {
    const r = scheduleNextReview({ srsEase: 2.0, srsIntervalDays: 10 }, REVIEW_RATING.MEDIUM);
    assert.equal(r.srsEase, 2.0);
    assert.equal(r.srsIntervalDays, 20);
  });

  test('"Difficile" riazzera l\'intervallo a 1 giorno e abbassa l\'ease', () => {
    const r = scheduleNextReview({ srsEase: 2.3, srsIntervalDays: 40 }, REVIEW_RATING.HARD);
    assert.equal(r.srsIntervalDays, 1);
    assert.equal(r.srsEase, 2.1);
    assert.equal(r.nextReviewDate, isoInDays(1));
  });

  test("l'ease resta sempre dentro i limiti, anche dopo molti giudizi estremi", () => {
    let node = { srsEase: DEFAULT_EASE, srsIntervalDays: 7 };
    for (let i = 0; i < 40; i++) node = scheduleNextReview(node, REVIEW_RATING.HARD);
    assert.equal(node.srsEase, MIN_EASE);
    for (let i = 0; i < 40; i++) node = scheduleNextReview(node, REVIEW_RATING.EASY);
    assert.equal(node.srsEase, MAX_EASE);
  });

  test("l'intervallo non supera mai il tetto di sicurezza", () => {
    const r = scheduleNextReview({ srsEase: MAX_EASE, srsIntervalDays: 1000 }, REVIEW_RATING.EASY);
    assert.equal(r.srsIntervalDays, MAX_INTERVAL_DAYS);
  });

  test('un nodo senza campi SRS (profilo pre-V36) riparte dai default invece di rompersi', () => {
    const r = scheduleNextReview({}, REVIEW_RATING.MEDIUM);
    assert.equal(r.srsEase, DEFAULT_EASE);
    assert.ok(r.srsIntervalDays > INITIAL_REVIEW_INTERVAL_DAYS);
  });

  test('un rating sconosciuto viene trattato come MEDIO, mai come un crash', () => {
    const r = scheduleNextReview({ srsEase: 2, srsIntervalDays: 10 }, 'BOH');
    assert.equal(r.srsIntervalDays, 20);
  });
});

describe("capIntervalToExam — nessun ripasso schedulato dopo l'esame", () => {
  test('un intervallo lungo viene compresso per cadere il giorno prima', () => {
    assert.equal(capIntervalToExam(90, isoInDays(10)), 9);
  });

  test('un intervallo già dentro il margine passa intatto', () => {
    assert.equal(capIntervalToExam(3, isoInDays(30)), 3);
  });

  test('senza data d\'esame non c\'è nulla da comprimere', () => {
    assert.equal(capIntervalToExam(90, null), 90);
  });

  test("a esame imminente (domani) o passato l'intervallo non viene forzato a zero", () => {
    assert.equal(capIntervalToExam(5, isoInDays(1)), 5);
    assert.equal(capIntervalToExam(5, isoInDays(-3)), 5);
  });

  test('la compressione vale anche sulla schedulazione completa', () => {
    const r = scheduleNextReview({ srsEase: 2.5, srsIntervalDays: 60 }, REVIEW_RATING.EASY, isoInDays(5));
    assert.equal(r.srsIntervalDays, 4);
  });
});

describe('previewReviewIntervals', () => {
  test('restituisce i tre intervalli reali del nodo, non più i vecchi 4/2/1 fissi', () => {
    const p = previewReviewIntervals({ srsEase: 2.3, srsIntervalDays: 16 });
    assert.equal(p.HARD, 1);
    assert.ok(p.MEDIUM > 16);
    assert.ok(p.EASY > p.MEDIUM);
  });
});
