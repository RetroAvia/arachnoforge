// =====================================================================
// ArachnoForge — src/utils/appelli.test.js (V42)
// Gli appelli di una materia: scritto e orale, più date, un obiettivo.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATO_ESAME,
  ESITO_APPELLO,
  GIORNI_ATTESA_ESITO,
  createAppello,
  normalizeAppelli,
  primaData,
  ultimaData,
  targetAppello,
  derivedExamFields,
  syncAppelli,
  planningExamDate,
  nextProvaTipo,
  withPlanningDates,
  nextAppelloAfter,
  appelloDaChiudere,
  appelloLabel,
  haProvaScritta,
  formatoMeta
} from './appelli.js';
import { addDaysToDateOnly } from './dateUtils.js';

const OGGI = '2026-10-05';
const fra = (n) => addDaysToDateOnly(OGGI, n);

describe('createAppello / normalizeAppelli', () => {
  test('l’orale non viene mai prima dello scritto: date invertite si scambiano', () => {
    const a = createAppello({ scritto: fra(10), orale: fra(3) });
    assert.equal(a.scritto, fra(3));
    assert.equal(a.orale, fra(10));
    assert.ok(a.id.startsWith('app_'));
    assert.equal(a.esito, null);
  });

  test('date non valide scartate, appelli senza date eliminati, lista in ordine di data, id unici', () => {
    const out = normalizeAppelli([
      { id: 'x', scritto: fra(30) },
      { id: 'x', scritto: fra(10), orale: fra(15), esito: 'SUPERATO' },
      { scritto: '2026-02-31' },
      { orale: 'boh' },
      null,
      { id: 'y', orale: fra(20), esito: 'FORSE' }
    ]);
    assert.deepEqual(out.map((a) => primaData(a)), [fra(10), fra(20), fra(30)]);
    assert.equal(new Set(out.map((a) => a.id)).size, 3);
    assert.equal(out[0].esito, ESITO_APPELLO.SUPERATO);
    assert.equal(out[1].esito, null, 'un esito sconosciuto non passa');
    assert.deepEqual(normalizeAppelli('boh'), []);
  });

  test('prima e ultima data di un appello', () => {
    assert.equal(primaData({ scritto: fra(1), orale: fra(5) }), fra(1));
    assert.equal(ultimaData({ scritto: fra(1), orale: fra(5) }), fra(5));
    assert.equal(primaData({ orale: fra(5) }), fra(5));
    assert.equal(ultimaData({ scritto: fra(1) }), fra(1));
    assert.equal(primaData(null), '');
  });
});

describe('l’appello obiettivo e le date derivate', () => {
  const materia = (over = {}) => ({
    id: 'm1',
    appelli: [
      { id: 'a1', scritto: fra(-10), orale: fra(-5), esito: ESITO_APPELLO.NON_SUPERATO },
      { id: 'a2', scritto: fra(10), orale: fra(17) },
      { id: 'a3', scritto: fra(40), orale: null }
    ],
    ...over
  });

  test('senza una scelta vale il primo appello ancora aperto (non uno già andato male)', () => {
    assert.equal(targetAppello(materia(), OGGI).id, 'a2');
    assert.equal(targetAppello(materia({ appelloTargetId: 'a3' }), OGGI).id, 'a3');
    assert.equal(targetAppello({ appelli: [] }, OGGI), null);
  });

  test('examDate è la prima prova dell’obiettivo, oralDate l’orale quando c’è anche lo scritto', () => {
    assert.deepEqual(derivedExamFields(materia(), OGGI), { examDate: fra(10), oralDate: fra(17), appelloTargetId: 'a2' });
    assert.deepEqual(derivedExamFields(materia({ appelloTargetId: 'a3' }), OGGI), { examDate: fra(40), oralDate: null, appelloTargetId: 'a3' });
  });

  test('una materia pre-V42 con la sola data d’esame riceve un appello equivalente', () => {
    const vecchia = syncAppelli({ id: 'm9', examDate: fra(20), oralDate: fra(25) }, OGGI);
    assert.equal(vecchia.appelli.length, 1);
    assert.equal(vecchia.appelli[0].id, 'app_legacy_m9');
    assert.equal(vecchia.examDate, fra(20));
    assert.equal(vecchia.oralDate, fra(25));
    const soloOrale = syncAppelli({ id: 'm8', examDate: fra(20), formatoEsame: FORMATO_ESAME.SOLO_ORALE }, OGGI);
    assert.equal(soloOrale.appelli[0].orale, fra(20));
    assert.equal(soloOrale.appelli[0].scritto, null);
  });

  test('si pianifica sulla prossima prova ancora davanti: passato lo scritto, l’orale', () => {
    const dopoScritto = { examDate: fra(-2), oralDate: fra(5), formatoEsame: FORMATO_ESAME.SCRITTO_ORALE };
    assert.equal(planningExamDate(dopoScritto, OGGI), fra(5));
    assert.equal(nextProvaTipo(dopoScritto, OGGI), 'ORALE');
    assert.equal(planningExamDate({ examDate: fra(3), oralDate: fra(9) }, OGGI), fra(3));
    assert.equal(nextProvaTipo({ examDate: fra(3), oralDate: fra(9) }, OGGI), 'SCRITTO');
    assert.equal(planningExamDate({ examDate: fra(-9), oralDate: fra(-2) }, OGGI), fra(-9), 'passate entrambe: la data resta, scaduta');
    assert.equal(nextProvaTipo({ examDate: fra(-9) }, OGGI), null);
  });

  test('withPlanningDates non muta le materie e lascia intatte quelle superate', () => {
    const m = { id: 'x', examDate: fra(-2), oralDate: fra(5) };
    const superata = { id: 'y', examDate: fra(-2), oralDate: fra(5), examPassed: true };
    const [vista, s] = withPlanningDates([m, superata], OGGI);
    assert.equal(vista.examDate, fra(5));
    assert.equal(vista.examDateScritto, fra(-2));
    assert.equal(m.examDate, fra(-2), 'l’originale non si tocca');
    assert.equal(s, superata);
  });

  test('il prossimo appello dopo uno andato male', () => {
    const m = materia();
    assert.equal(nextAppelloAfter(m, m.appelli[1], OGGI).id, 'a3');
    assert.equal(nextAppelloAfter(m, m.appelli[2], OGGI), null);
  });
});

describe('appelloDaChiudere — "com’è andata?"', () => {
  const conAppello = (a, extra = {}) => ({ id: 'm', appelli: [{ id: 'a', ...a }], appelloTargetId: 'a', ...extra });

  test('si chiede solo dopo l’ULTIMA prova dell’appello', () => {
    assert.equal(appelloDaChiudere(conAppello({ scritto: fra(-3), orale: fra(4) }), OGGI), null, 'tra scritto e orale si prepara l’orale');
    const r = appelloDaChiudere(conAppello({ scritto: fra(-10), orale: fra(-3) }), OGGI);
    assert.equal(r.tipo, 'FINALE');
    assert.equal(r.giorniFa, 3);
  });

  test('non si chiede per un esame registrato, un esito già dato o un "aspetto l’esito" recente', () => {
    assert.equal(appelloDaChiudere(conAppello({ scritto: fra(-3) }, { examPassed: true }), OGGI), null);
    assert.equal(appelloDaChiudere(conAppello({ scritto: fra(-3), esito: ESITO_APPELLO.NON_SUPERATO }), OGGI), null);
    assert.equal(appelloDaChiudere(conAppello({ scritto: fra(-3), esito: ESITO_APPELLO.IN_ATTESA, esitoAt: fra(-1) }), OGGI), null);
    const scaduta = conAppello({ scritto: fra(-20), esito: ESITO_APPELLO.IN_ATTESA, esitoAt: fra(-(GIORNI_ATTESA_ESITO + 1)) });
    assert.ok(appelloDaChiudere(scaduta, OGGI), 'dopo i giorni di attesa si richiede');
  });
});

describe('formato e etichette', () => {
  test('la parte scritta conta per scritto+orale e solo scritto', () => {
    assert.equal(haProvaScritta({ formatoEsame: FORMATO_ESAME.SCRITTO_ORALE }), true);
    assert.equal(haProvaScritta({ formatoEsame: FORMATO_ESAME.SOLO_SCRITTO }), true);
    assert.equal(haProvaScritta({ formatoEsame: FORMATO_ESAME.SOLO_ORALE }), false);
    assert.equal(haProvaScritta({ formatoEsame: FORMATO_ESAME.PROGETTO_ORALE }), false);
    assert.equal(haProvaScritta({}), true, 'default: scritto + orale');
    assert.equal(formatoMeta({ formatoEsame: 'BOH' }).label, 'Scritto + orale');
  });

  test('appelloLabel', () => {
    assert.equal(appelloLabel({ scritto: '2027-01-12', orale: '2027-01-19' }), '2027-01-12 · orale 2027-01-19');
    assert.equal(appelloLabel({ orale: '2027-01-19' }, (d) => d.slice(5)), '01-19');
    assert.equal(appelloLabel(null), '');
  });
});
