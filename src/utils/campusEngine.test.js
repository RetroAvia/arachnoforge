import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FASE,
  isoWeekday,
  startOfWeek,
  timeToMinutes,
  minutesToTime,
  normalizeCampus,
  suggestSemestre,
  detectPhase,
  lessonsOn,
  nextLesson,
  postLectureQueue,
  weekPace,
  nodoInSintesi,
  priorityMateriaIds,
  validateLezione,
  computeCampusSnapshot,
  createLezione
} from './campusEngine.js';
import { getDateKey } from './dateUtils.js';

/* Date fisse: il 2026-10-05 è un lunedì. */
const LUN = '2026-10-05';
const MAR = '2026-10-06';
const VEN = '2026-10-09';
const at = (dateKey, hhmm) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi, 0, 0);
};

const analisi = { id: 'analisi', nome: 'Analisi 1', examPassed: false, sfide: [] };
const fisica = { id: 'fisica', nome: 'Fisica 1', examPassed: false, sfide: [] };
const superata = { id: 'chimica', nome: 'Chimica', examPassed: true, sfide: [] };
const materie = [analisi, fisica, superata];
const byId = new Map(materie.map((m) => [m.id, m]));

function campus(over = {}) {
  return normalizeCampus({
    semestri: [
      {
        id: 's1',
        nome: '1° semestre',
        inizio: '2026-09-22',
        fine: '2026-12-19',
        sospensioni: ['2026-11-02'],
        lezioni: [
          { id: 'a1', materiaId: 'analisi', giorno: 1, inizio: '09:00', fine: '11:00' },
          { id: 'f1', materiaId: 'fisica', giorno: 1, inizio: '14:00', fine: '16:00' },
          { id: 'a2', materiaId: 'analisi', giorno: 3, inizio: '11:00', fine: '13:00' },
          { id: 'c1', materiaId: 'chimica', giorno: 2, inizio: '09:00', fine: '11:00' },
          { id: 'f2', materiaId: 'fisica', giorno: 5, inizio: '15:00', fine: '17:00' }
        ]
      }
    ],
    rapportoSintesi: 1,
    ...over
  });
}

function sintesi(materiaId, when, minutes = 60) {
  return { type: 'FOCUS_SESSION', workMode: 'SINTESI', materiaId, minutes, timestamp: when.toISOString(), dateKey: getDateKey(when) };
}

/* ------------------------------------------------------------------ */

test('utilità di calendario', () => {
  assert.equal(isoWeekday(LUN), 1);
  assert.equal(isoWeekday('2026-10-11'), 7, 'domenica = 7');
  assert.equal(startOfWeek(VEN), LUN);
  assert.equal(startOfWeek(LUN), LUN);
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(timeToMinutes('24:00'), null);
  assert.equal(minutesToTime(570), '09:30');
});

test('normalizeCampus', async (t) => {
  await t.test('dati assenti -> struttura vuota valida', () => {
    const c = normalizeCampus(undefined);
    assert.deepEqual(c.semestri, []);
    assert.equal(c.override, null);
    assert.equal(c.rapportoSintesi, 1);
  });

  await t.test('rimuove le lezioni di materie che non esistono più', () => {
    const c = normalizeCampus(campus(), new Set(['analisi']));
    assert.ok(c.semestri[0].lezioni.every((l) => l.materiaId === 'analisi'));
  });

  await t.test('scarta lezioni con fine prima dell’inizio e semestri senza date', () => {
    const c = normalizeCampus({
      semestri: [
        { inizio: 'boh', fine: '2026-12-01' },
        { inizio: '2026-09-22', fine: '2026-12-19', lezioni: [{ materiaId: 'x', giorno: 1, inizio: '11:00', fine: '09:00' }] }
      ]
    });
    assert.equal(c.semestri.length, 1);
    assert.equal(c.semestri[0].lezioni.length, 0);
  });

  await t.test('date invertite vengono scambiate, non buttate', () => {
    const c = normalizeCampus({ semestri: [{ inizio: '2026-12-19', fine: '2026-09-22' }] });
    assert.equal(c.semestri[0].inizio, '2026-09-22');
  });

  await t.test('rapporto fuori scala viene riportato nei limiti', () => {
    assert.equal(normalizeCampus({ rapportoSintesi: 99 }).rapportoSintesi, 3);
    assert.equal(normalizeCampus({ rapportoSintesi: 0 }).rapportoSintesi, 0.25);
  });
});

test('suggestSemestre propone date plausibili', () => {
  assert.equal(suggestSemestre('2026-09-10').inizio, '2026-09-22');
  assert.match(suggestSemestre('2026-09-10').nome, /1° semestre 2026\/27/);
  assert.equal(suggestSemestre('2027-02-10').inizio, '2027-03-02');
  assert.match(suggestSemestre('2027-02-10').nome, /2° semestre 2026\/27/);
});

/* ------------------------------------------------------------------ */

test('detectPhase', async (t) => {
  await t.test('dentro il periodo di lezioni: LEZIONI, con settimana corrente', () => {
    const p = detectPhase(campus(), LUN);
    assert.equal(p.fase, FASE.LEZIONI);
    assert.equal(p.automatica, true);
    assert.equal(p.semestre.id, 's1');
    assert.ok(p.settimana >= 2 && p.settimana <= p.settimaneTotali);
  });

  await t.test('fuori dal periodo: SESSIONE', () => {
    assert.equal(detectPhase(campus(), '2027-01-20').fase, FASE.SESSIONE);
  });

  await t.test('la forzatura vale fino alla sua scadenza, poi torna automatica', () => {
    const c = campus({ override: { fase: FASE.SESSIONE, finoA: VEN } });
    assert.equal(detectPhase(c, MAR).fase, FASE.SESSIONE);
    assert.equal(detectPhase(c, MAR).automatica, false);
    assert.equal(detectPhase(c, '2026-10-10').fase, FASE.LEZIONI, 'il giorno dopo la scadenza torna da sola');
  });

  await t.test('senza semestri è sempre sessione', () => {
    assert.equal(detectPhase(normalizeCampus({}), LUN).fase, FASE.SESSIONE);
  });
});

test('lessonsOn', async (t) => {
  await t.test('le lezioni del giorno in ordine, con la materia allegata', () => {
    const l = lessonsOn(campus(), LUN, byId);
    assert.deepEqual(l.map((x) => x.materiaId), ['analisi', 'fisica']);
    assert.equal(l[0].materia.nome, 'Analisi 1');
    assert.equal(l[0].minuti, 120);
  });

  await t.test('niente lezioni per materie già superate', () => {
    assert.equal(lessonsOn(campus(), MAR, byId).length, 0);
  });

  await t.test('niente lezioni nei giorni di sospensione', () => {
    assert.equal(lessonsOn(campus(), '2026-11-02', byId).length, 0, '2 novembre, lunedì sospeso');
  });

  await t.test('niente lezioni fuori dal semestre', () => {
    assert.equal(lessonsOn(campus(), '2027-01-11', byId).length, 0);
  });
});

test('nextLesson', async (t) => {
  await t.test('prima della lezione: quella di oggi, con i minuti all’inizio', () => {
    const n = nextLesson(campus(), at(LUN, '08:00'), byId);
    assert.equal(n.materiaId, 'analisi');
    assert.equal(n.minutiAllInizio, 60);
    assert.equal(n.inCorso, false);
  });

  await t.test('durante la lezione: in corso', () => {
    const n = nextLesson(campus(), at(LUN, '10:00'), byId);
    assert.equal(n.materiaId, 'analisi');
    assert.equal(n.inCorso, true);
  });

  await t.test('dopo l’ultima di oggi: la prima del prossimo giorno utile', () => {
    const n = nextLesson(campus(), at(LUN, '18:00'), byId);
    assert.equal(n.materiaId, 'analisi', 'il martedì c’è solo chimica, già superata: salta a mercoledì');
    assert.equal(n.giorniDistanza, 2);
  });
});

/* ------------------------------------------------------------------ */

test('postLectureQueue', async (t) => {
  // La fisica del venerdì 2 ottobre (15-17) è già stata sistemata la sera
  // stessa in questi casi, così si isola il comportamento del lunedì.
  const fisicaVenerdiSistemata = sintesi('fisica', at('2026-10-02', '18:00'));

  await t.test('una lezione finita e non sistemata entra in coda', () => {
    const q = postLectureQueue(campus(), at(LUN, '12:00'), byId, [fisicaVenerdiSistemata]);
    assert.deepEqual(q.map((x) => x.materiaId), ['analisi']);
  });

  await t.test('in ordine di fine lezione, più vecchie prima', () => {
    const q = postLectureQueue(campus(), at(LUN, '12:00'), byId, []);
    assert.deepEqual(q.map((x) => x.materiaId), ['fisica', 'analisi'], 'la fisica del venerdì viene prima');
  });

  await t.test('una sessione di sintesi DOPO la lezione la toglie dalla coda', () => {
    const q = postLectureQueue(campus(), at(LUN, '17:00'), byId, [fisicaVenerdiSistemata, sintesi('analisi', at(LUN, '11:30'))]);
    assert.deepEqual(q.map((x) => x.materiaId), ['fisica'], 'resta solo la fisica di oggi pomeriggio');
  });

  await t.test('due lezioni non sistemate della stessa materia diventano una voce sola', () => {
    const q = postLectureQueue(campus(), at(LUN, '17:00'), byId, []);
    const f = q.find((x) => x.materiaId === 'fisica');
    assert.equal(f.lezioniDaSistemare, 2, 'venerdì + lunedì');
    assert.equal(f.minutiDaSistemare, 240);
  });

  await t.test('una sessione di sintesi PRIMA della lezione non la sistema', () => {
    const q = postLectureQueue(campus(), at(LUN, '12:00'), byId, [fisicaVenerdiSistemata, sintesi('analisi', at(LUN, '08:00'))]);
    assert.deepEqual(q.map((x) => x.materiaId), ['analisi']);
  });

  await t.test('una sessione di STUDIO non conta come sintesi', () => {
    const studio = { ...sintesi('analisi', at(LUN, '11:30')), workMode: 'STUDIO' };
    const q = postLectureQueue(campus(), at(LUN, '12:00'), byId, [fisicaVenerdiSistemata, studio]);
    assert.deepEqual(q.map((x) => x.materiaId), ['analisi']);
  });

  await t.test('la lezione del venerdì pomeriggio è ancora in coda il lunedì mattina', () => {
    const q = postLectureQueue(campus(), at('2026-10-12', '08:30'), byId, []);
    assert.ok(q.some((x) => x.materiaId === 'fisica'));
  });

  await t.test('in modalità sessione la coda è vuota', () => {
    const c = campus({ override: { fase: FASE.SESSIONE, finoA: VEN } });
    const snap = computeCampusSnapshot(c, at(LUN, '12:00'), materie, []);
    assert.equal(snap.coda.length, 0);
  });
});

test('weekPace: il dovuto matura con le lezioni fatte', async (t) => {
  await t.test('lunedì a mezzogiorno si devono 2h di sintesi di analisi, non di fisica', () => {
    const p = weekPace(campus(), at(LUN, '12:00'), byId, []);
    const a = p.find((r) => r.materiaId === 'analisi');
    const f = p.find((r) => r.materiaId === 'fisica');
    assert.equal(a.dovutoMin, 120);
    assert.equal(a.stato, 'INDIETRO');
    assert.equal(f.dovutoMin, 0, 'la lezione di fisica delle 14 non c’è ancora stata');
  });

  await t.test('con la sintesi fatta, in pari', () => {
    const p = weekPace(campus(), at(LUN, '17:00'), byId, [sintesi('analisi', at(LUN, '12:00'), 125)]);
    assert.equal(p.find((r) => r.materiaId === 'analisi').stato, 'IN_PARI');
  });

  await t.test('il rapporto di sintesi scala il dovuto', () => {
    const p = weekPace(campus({ rapportoSintesi: 1.5 }), at(LUN, '12:00'), byId, []);
    assert.equal(p.find((r) => r.materiaId === 'analisi').dovutoMin, 180);
  });

  await t.test('la sintesi della settimana scorsa non conta per questa', () => {
    const vecchia = sintesi('analisi', at('2026-09-30', '18:00'), 300);
    const p = weekPace(campus(), at(LUN, '12:00'), byId, [vecchia]);
    assert.equal(p.find((r) => r.materiaId === 'analisi').sintesiFattaMin, 0);
  });
});

/* ------------------------------------------------------------------ */

test('nodoInSintesi preferisce l’argomento già avviato', () => {
  const m = {
    sfide: [
      { id: 'x', status: 'PENDING', fonti: [{ pagine: 100, pagineFatte: 0 }] },
      { id: 'y', status: 'PENDING', fonti: [{ pagine: 100, pagineFatte: 30 }] },
      { id: 'z', status: 'COMPLETED', fonti: [{ pagine: 100, pagineFatte: 50 }] }
    ]
  };
  assert.equal(nodoInSintesi(m).id, 'y');
  assert.equal(nodoInSintesi({ sfide: [{ id: 'k', status: 'PENDING', fonti: [] }] }), null);
});

test('priorityMateriaIds: solo in modalità lezioni', () => {
  const ids = priorityMateriaIds(campus(), at(LUN, '12:00'), byId, []);
  assert.ok(ids.has('analisi') && ids.has('fisica'));
  const c = campus({ override: { fase: FASE.SESSIONE, finoA: VEN } });
  assert.equal(priorityMateriaIds(c, at(LUN, '12:00'), byId, []).size, 0);
});

test('validateLezione', () => {
  const altre = campus().semestri[0].lezioni;
  const ok = validateLezione(createLezione({ materiaId: 'analisi', giorno: 2, inizio: '14:00', fine: '16:00' }), altre);
  assert.equal(ok.valida, true);
  const rovescio = validateLezione({ materiaId: 'analisi', giorno: 1, inizio: '12:00', fine: '10:00' }, altre);
  assert.equal(rovescio.valida, false);
  const sovrapposta = validateLezione({ id: 'nuova', materiaId: 'fisica', giorno: 1, inizio: '10:00', fine: '12:00' }, altre);
  assert.equal(sovrapposta.valida, true, 'una sovrapposizione è un avviso, non un errore');
  assert.equal(sovrapposta.sovrapposte.length, 1);
});

test('computeCampusSnapshot mette insieme tutto', () => {
  const snap = computeCampusSnapshot(campus(), at(LUN, '10:00'), materie, []);
  assert.equal(snap.fase, FASE.LEZIONI);
  assert.deepEqual(snap.lezioniOggi.map((l) => l.stato), ['IN_CORSO', 'PROSSIMA']);
  assert.equal(snap.haOrario, true);
});
