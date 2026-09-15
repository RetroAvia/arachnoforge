// =====================================================================
// ArachnoForge — src/utils/examReadiness.test.js (V36.0)
// Il verdetto "sostieni / rimanda". Ciò che conta verificare non è il
// numero esatto (i pesi sono una scelta editoriale, non una legge) ma
// che il verdetto si muova nella direzione giusta e che l'app dichiari
// onestamente quando NON ha abbastanza dati per pronunciarsi.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeExamReadiness, VERDICT } from './examReadiness.js';

function isoInDays(days) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** n nodi da 2h, i primi `done` completati. */
function materia({ totale = 10, done = 0, giorniAllEsame = 30, tentativi = null } = {}) {
  const sfide = Array.from({ length: totale }, (_, i) => ({
    id: `s${i}`,
    oreStimate: 2,
    focusMinutes: 0,
    status: i < done ? 'COMPLETED' : 'PENDING',
    tentativiSuccessi: tentativi ? tentativi.ok : 0,
    tentativiFalliti: tentativi ? tentativi.ko : 0
  }));
  return {
    id: 'm1',
    nome: 'Analisi 1',
    cfu: 12,
    examDate: giorniAllEsame == null ? null : isoInDays(giorniAllEsame),
    examPassed: false,
    perceivedDifficulty: 3,
    sfide
  };
}

const radarStabile = { stabilityPct: 95, attention: 0 };
const radarFragile = { stabilityPct: 20, attention: 8 };

describe('computeExamReadiness — verdetto', () => {
  test('senza nodi tracciati non si pronuncia: UNKNOWN, non un falso "rimanda"', () => {
    const r = computeExamReadiness(materia({ totale: 0 }), null, null);
    assert.equal(r.verdict, VERDICT.UNKNOWN);
    assert.ok(r.rationale.includes('Nessun nodo'));
  });

  test('programma quasi tutto coperto, memoria stabile e tempo in avanzo -> SOSTIENI', () => {
    const r = computeExamReadiness(materia({ totale: 10, done: 10, giorniAllEsame: 20 }), radarStabile, null);
    assert.equal(r.verdict, VERDICT.READY);
    assert.ok(r.score >= 75);
  });

  test('programma appena iniziato a ridosso dell\'esame -> RIMANDA', () => {
    const r = computeExamReadiness(materia({ totale: 10, done: 1, giorniAllEsame: 2 }), radarFragile, null);
    assert.equal(r.verdict, VERDICT.POSTPONE);
  });

  test('a parità di copertura, una memoria fragile abbassa il punteggio', () => {
    const base = materia({ totale: 10, done: 8, giorniAllEsame: 30 });
    const stabile = computeExamReadiness(base, radarStabile, null);
    const fragile = computeExamReadiness(base, radarFragile, null);
    assert.ok(fragile.score < stabile.score);
  });

  test("la copertura è pesata per ORE, non per numero di nodi", () => {
    const pesante = {
      ...materia({ totale: 0 }),
      sfide: [
        { id: 'a', oreStimate: 1, focusMinutes: 0, status: 'COMPLETED' },
        { id: 'b', oreStimate: 1, focusMinutes: 0, status: 'COMPLETED' },
        { id: 'c', oreStimate: 1, focusMinutes: 0, status: 'COMPLETED' },
        { id: 'd', oreStimate: 27, focusMinutes: 0, status: 'PENDING' }
      ],
      examDate: isoInDays(30)
    };
    const r = computeExamReadiness(pesante, radarStabile, null);
    // 3 nodi su 4 chiusi (75% "a conteggio") ma solo 3h su 30 (10% a ore).
    assert.ok(r.parts.coverage < 0.2, `copertura ${r.parts.coverage} calcolata a conteggio invece che a ore`);
  });
});

describe('computeExamReadiness — onestà sui dati mancanti', () => {
  test('la confidenza scende quando mancano pilastri misurabili', () => {
    const senzaTutto = computeExamReadiness(materia({ totale: 10, done: 5, giorniAllEsame: null }), null, null);
    assert.ok(senzaTutto.confidence < 0.75);
    assert.equal(senzaTutto.known.hasStability, false);
    assert.equal(senzaTutto.known.hasExamDate, false);
  });

  test('con tutti e quattro i pilastri misurati la confidenza è piena', () => {
    const r = computeExamReadiness(
      materia({ totale: 10, done: 5, giorniAllEsame: 30, tentativi: { ok: 3, ko: 1 } }),
      radarStabile,
      null
    );
    assert.equal(r.confidence, 1);
  });

  test('il motivo dominante indica il pilastro davvero più carente', () => {
    const r = computeExamReadiness(materia({ totale: 10, done: 2, giorniAllEsame: 60 }), radarStabile, null);
    assert.ok(r.rationale.toLowerCase().includes('copert'));
  });
});
