// =====================================================================
// ArachnoForge — src/utils/gpaEngine.test.js (V42)
// Media ponderata, voto di partenza e voto di laurea con la formula del
// regolamento del corso: V = 11·m/3 + p1 (media) + p2 (anni) + p3 (tesi,
// 0-2) + p4 (estero), arrotondato all'intero.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGradedMateria,
  computeWeightedAverage,
  computeGraduationProjection,
  puntiMedia,
  puntiDurata,
  anniDiCorso,
  computeGraduationGrade,
  computeWhatIfProjection,
  getTopIncompleteByScore
} from './gpaEngine.js';

const superato = (cfu, voto, over = {}) => ({ id: `m_${cfu}_${voto}_${Math.random()}`, cfu, voto, examPassed: true, courseId: 'analisi1', ...over });

describe('la media ponderata', () => {
  test('pesata sui CFU; contano solo esami superati con un voto valido', () => {
    const r = computeWeightedAverage([superato(12, 30), superato(6, 24), { cfu: 9, voto: 28, examPassed: false }, superato(6, 17), superato(6, null)]);
    assert.equal(r.average, (12 * 30 + 6 * 24) / 18);
    assert.equal(r.totalCfu, 18);
    assert.equal(r.gradedCount, 2);
    assert.equal(computeWeightedAverage([]).average, null);
  });

  test('V42: idoneità e sovrannumerari restano fuori anche se per errore portano un voto', () => {
    assert.equal(isGradedMateria(superato(3, 18, { formatoEsame: 'IDONEITA' })), false);
    assert.equal(isGradedMateria(superato(3, 18, { ungraded: true })), false);
    assert.equal(isGradedMateria(superato(6, 30, { tipoPiano: 'EXTRA' })), false);
    assert.equal(isGradedMateria(superato(6, 30, { courseId: null, tipoPiano: 'SCELTA' })), true, 'gli esami a scelta hanno un voto');
    // Il caso segnalato: un 18 su Inglese abbassava la media.
    const conInglese = computeWeightedAverage([superato(9, 27), superato(9, 27), superato(3, 18, { formatoEsame: 'IDONEITA' })]);
    assert.equal(conInglese.average, 27);
  });
});

describe('voto di partenza (base 110)', () => {
  test('11·m/3 arrotondato al decimo, senza errori di virgola mobile', () => {
    assert.equal(computeGraduationProjection(27.45), 100.7, 'prima dava 100,6');
    assert.equal(computeGraduationProjection(30), 110);
    assert.equal(computeGraduationProjection(null), null);
    assert.equal(computeGraduationProjection(NaN), null);
  });
});

describe('i punti del regolamento', () => {
  test('p1: punti per la media', () => {
    assert.equal(puntiMedia(28.01), 5);
    assert.equal(puntiMedia(28), 4);
    assert.equal(puntiMedia(27.5), 4);
    assert.equal(puntiMedia(27), 3);
    assert.equal(puntiMedia(25.01), 3);
    assert.equal(puntiMedia(25), 2);
    assert.equal(puntiMedia(23.5), 2);
    assert.equal(puntiMedia(23), 0);
    assert.equal(puntiMedia(NaN), 0);
  });

  test('p2: punti per la durata degli studi', () => {
    assert.equal(puntiDurata(3), 2);
    assert.equal(puntiDurata(4), 1.5);
    assert.equal(puntiDurata(5), 1);
    assert.equal(puntiDurata(6), 0);
    assert.equal(puntiDurata(null), null);
  });

  test('anni di corso: dall’ottobre dell’immatricolazione; le sessioni fino ad aprile contano nell’anno prima', () => {
    assert.equal(anniDiCorso(2024, '2027-07-15'), 3);
    assert.equal(anniDiCorso(2024, '2028-03-20'), 3, 'sessione straordinaria: ancora in corso');
    assert.equal(anniDiCorso(2024, '2028-05-10'), 4);
    assert.equal(anniDiCorso(null, '2027-07-15'), null);
    assert.equal(anniDiCorso(2024, 'boh'), null);
  });
});

describe('computeGraduationGrade', () => {
  test('media 27,5 in corso, senza estero: da 108 a 110', () => {
    const materie = [superato(12, 28), superato(12, 27)];
    const g = computeGraduationGrade(materie, { annoImmatricolazione: 2024, laureaDateKey: '2027-07-15' });
    assert.equal(g.media, 27.5);
    assert.equal(g.base, 100.8);
    assert.equal(g.p1, 4);
    assert.equal(g.p2, 2);
    assert.equal(g.p4, 0);
    // 100,83 + 4 + 2 = 106,83 -> 107; con la tesi (fino a 2) 108,83 -> 109.
    assert.equal(g.minimo, 107);
    assert.equal(g.massimo, 109);
    assert.equal(g.durataStimata, false);
  });

  test('l’Erasmus vale un punto; il tetto è 110 e si segnala quando lo si supera', () => {
    const top = computeGraduationGrade([superato(12, 30), superato(12, 29)], { annoImmatricolazione: 2024, laureaDateKey: '2027-07-15', erasmus: true });
    assert.equal(top.p4, 1);
    assert.equal(top.massimo, 110);
    assert.equal(top.oltre110, true);
  });

  test('senza anno di immatricolazione la durata non si conta ed è dichiarata stimata', () => {
    const g = computeGraduationGrade([superato(12, 26)]);
    assert.equal(g.p2, null);
    assert.equal(g.durataStimata, true);
    assert.equal(computeGraduationGrade([]), null, 'nessun voto, nessun voto di laurea');
  });
});

describe('what-if', () => {
  test('gli esami simulati entrano nella media con i loro CFU', () => {
    const r = computeWhatIfProjection([superato(12, 24)], [{ cfu: 12, voto: 30 }, { cfu: 0, voto: 18 }, { cfu: 6, voto: NaN }]);
    assert.equal(r.average, 27);
    assert.equal(r.totalCfu, 24);
    assert.equal(r.projection, 99);
  });

  test('V42: il what-if propone solo esami con voto, del piano, non bloccati', () => {
    const materie = [
      // Propedeutiche di Aerodinamica, già superate.
      { id: 'an1', nome: 'Analisi 1', cfu: 12, courseId: 'analisi1', examPassed: true, voto: 27, sfide: [] },
      { id: 'alg', nome: 'Algebra', cfu: 6, courseId: 'algebra', examPassed: true, voto: 26, sfide: [] },
      { id: 'inglese', nome: 'Inglese', cfu: 3, examPassed: false, formatoEsame: 'IDONEITA', sfide: [] },
      { id: 'extra', nome: 'Extra', cfu: 6, examPassed: false, tipoPiano: 'EXTRA', sfide: [] },
      { id: 'volo', nome: 'Meccanica del Volo', cfu: 9, courseId: 'meccanicaVolo', examPassed: false, sfide: [] },
      { id: 'aero', nome: 'Aerodinamica', cfu: 15, courseId: 'aerodinamica', examPassed: false, sfide: [] }
    ];
    const ids = getTopIncompleteByScore(materie, 4).map((m) => m.id);
    assert.ok(!ids.includes('inglese'));
    assert.ok(!ids.includes('extra'));
    assert.ok(!ids.includes('volo'), 'Meccanica del Volo è bloccata da Aerodinamica');
    assert.ok(ids.includes('aero'));
  });
});
