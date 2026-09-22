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
  statoLezione,
  contestoSintesi,
  STATO_LEZIONE,
  ESITO_LEZIONE,
  esitoKey,
  nodoInSintesi,
  priorityMateriaIds,
  validateLezione,
  computeCampusSnapshot,
  createLezione,
  argomentiSintesi
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

// V40 — materie con una sintesi APERTA (fonti con pagine da snellire):
// solo così una lezione ha qualcosa di tracciato da sistemare.
const conFonti = (id, over = {}) => [
  { id: `${id}_n`, nome: `Nodo ${id}`, status: 'PENDING', fonti: [{ pagine: 100, pagineFatte: 10 }], ...over }
];
const analisi = { id: 'analisi', nome: 'Analisi 1', examPassed: false, sfide: conFonti('analisi') };
const fisica = { id: 'fisica', nome: 'Fisica 1', examPassed: false, sfide: conFonti('fisica') };
const superata = { id: 'chimica', nome: 'Chimica', examPassed: true, sfide: [] };
const materie = [analisi, fisica, superata];
const byId = new Map(materie.map((m) => [m.id, m]));

function campus(over = {}) {
  // Data di riferimento fissa per la potatura degli esiti: il test non
  // deve dipendere dal giorno in cui gira.
  return normalizeCampus(
    {
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
    },
    null,
    LUN
  );
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

test('priorityMateriaIds: solo in modalità lezioni, solo con lezioni da sistemare', () => {
  const ids = priorityMateriaIds(campus(), at(LUN, '12:00'), byId, []);
  assert.ok(ids.has('analisi') && ids.has('fisica'), 'analisi di oggi e fisica di venerdì, entrambe da sistemare');
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

/* ------------------------------------------------------------------ *
 * V40 — la coda chiede solo lavoro che esiste davvero
 * ------------------------------------------------------------------ */

test('V40 — materia seguita a lezione ma senza fonti: niente da sistemare', () => {
  const vuota = { id: 'analisi', nome: 'Analisi 1', examPassed: false, sfide: [] };
  const map = new Map([[vuota.id, vuota], [fisica.id, fisica]]);
  const q = postLectureQueue(campus(), at(LUN, '12:00'), map, []);
  assert.ok(!q.some((x) => x.materiaId === 'analisi'), 'nessun nodo, nessuna fonte: niente in coda');
  const snap = computeCampusSnapshot(campus(), at(LUN, '12:00'), [vuota, fisica], []);
  assert.ok(snap.nonTracciate.some((x) => x.materiaId === 'analisi'));
  const riga = snap.passo.find((r) => r.materiaId === 'analisi');
  assert.equal(riga.dovutoMin, 0);
  assert.equal(riga.stato, 'NON_TRACCIATA');
});

test('V40 — sintesi dei nodi già chiusa: niente da sistemare', () => {
  const chiusa = { ...analisi, sfide: conFonti('analisi', { fonti: [{ pagine: 16, pagineFatte: 16 }] }) };
  const map = new Map([[chiusa.id, chiusa], [fisica.id, fisica]]);
  const q = postLectureQueue(campus(), at(LUN, '12:00'), map, []);
  assert.ok(!q.some((x) => x.materiaId === 'analisi'));
});

test('V40 — sintesi fatta FUORI dall’app, registrata sul nodo dopo la lezione', () => {
  const aggiornata = { ...analisi, sfide: conFonti('analisi', { sintesiAggiornataAt: at(LUN, '11:40').toISOString() }) };
  const map = new Map([[aggiornata.id, aggiornata], [fisica.id, fisica]]);
  const q = postLectureQueue(campus(), at(LUN, '12:00'), map, []);
  assert.ok(!q.some((x) => x.materiaId === 'analisi'), 'aggiornare il nodo a mano sistema la lezione');
  const p = weekPace(campus(), at(LUN, '12:00'), map, []);
  const a = p.find((r) => r.materiaId === 'analisi');
  assert.equal(a.creditoMin, 120, 'il lavoro fatto fuori dall’app conta nel passo');
  assert.equal(a.stato, 'IN_PARI');
  // un aggiornamento PRIMA della lezione non la sistema
  const prima = { ...analisi, sfide: conFonti('analisi', { sintesiAggiornataAt: at(LUN, '08:00').toISOString() }) };
  const q2 = postLectureQueue(campus(), at(LUN, '12:00'), new Map([[prima.id, prima], [fisica.id, fisica]]), []);
  assert.ok(q2.some((x) => x.materiaId === 'analisi'));
});

test('V40 — esiti manuali: "Fatta" e "Niente da sistemare"', () => {
  const fatta = campus({ esiti: { [esitoKey('a1', LUN)]: ESITO_LEZIONE.FATTA } });
  const q1 = postLectureQueue(fatta, at(LUN, '12:00'), byId, []);
  assert.ok(!q1.some((x) => x.materiaId === 'analisi'));
  const p1 = weekPace(fatta, at(LUN, '12:00'), byId, []).find((r) => r.materiaId === 'analisi');
  assert.equal(p1.dovutoMin, 120);
  assert.equal(p1.sintesiFattaMin, 120, 'dichiarata fatta: credito pieno');
  assert.equal(p1.stato, 'IN_PARI');

  const saltata = campus({ esiti: { [esitoKey('a1', LUN)]: ESITO_LEZIONE.SALTATA } });
  const q2 = postLectureQueue(saltata, at(LUN, '12:00'), byId, []);
  assert.ok(!q2.some((x) => x.materiaId === 'analisi'));
  const p2 = weekPace(saltata, at(LUN, '12:00'), byId, []).find((r) => r.materiaId === 'analisi');
  assert.equal(p2.dovutoMin, 0, 'una lezione saltata non genera debito');
  assert.equal(p2.saltateMin, 120);
});

test('V40 — statoLezione copre tutti i casi', () => {
  const c = campus();
  const l = { id: 'a1', materiaId: 'analisi', dateKey: LUN, minuti: 120 };
  const fine = at(LUN, '11:00').getTime();
  assert.equal(statoLezione(l, fine, contestoSintesi(c, byId, [])), STATO_LEZIONE.DA_FARE);
  assert.equal(statoLezione(l, fine, contestoSintesi(c, byId, [sintesi('analisi', at(LUN, '15:00'))])), STATO_LEZIONE.FATTA_APP);
  assert.equal(statoLezione({ ...l, materiaId: 'ignota' }, fine, contestoSintesi(c, byId, [])), STATO_LEZIONE.NIENTE);
});

test('V40 — normalizeCampus pota esiti rotti, di lezioni inesistenti o troppo vecchi', () => {
  const oggi = getDateKey();
  const c = normalizeCampus({
    ...campus(),
    esiti: {
      [esitoKey('a1', oggi)]: 'FATTA',
      [esitoKey('inesistente', oggi)]: 'FATTA',
      [esitoKey('a1', '2020-01-01')]: 'SALTATA',
      'boh': 'FATTA',
      [esitoKey('f1', oggi)]: 'FORSE'
    }
  });
  assert.deepEqual(Object.keys(c.esiti), [esitoKey('a1', oggi)]);
});

test('V40 — snapshot: minuti di sintesi davvero dovuti per il planner', () => {
  const snap = computeCampusSnapshot(campus(), at(LUN, '12:00'), materie, [sintesi('fisica', at('2026-10-02', '18:00'))]);
  assert.equal(snap.sintesiDovutaMin, 120, 'solo analisi di oggi (2h × rapporto 1)');
  const fin = snap.lezioniOggi.find((x) => x.id === 'a1');
  assert.equal(fin.sintesi, STATO_LEZIONE.DA_FARE);
});

test('V40 — una sessione breve non sistema una lezione lunga (copertura minima 50%)', () => {
  const breve = postLectureQueue(campus(), at(LUN, '12:00'), byId, [sintesi('fisica', at('2026-10-02', '18:00'), 120), sintesi('analisi', at(LUN, '11:30'), 10)]);
  assert.ok(breve.some((x) => x.materiaId === 'analisi'), '10 minuti su 2 ore non bastano');
  const item = breve.find((x) => x.materiaId === 'analisi');
  assert.equal(item.sintesiMancanteMin, 110, 'restano 110 minuti di sintesi');
});

test('V40 — i minuti non contano due volte: "Già fatta" più una sessione successiva', () => {
  const c = campus({ esiti: { [esitoKey('a1', LUN)]: ESITO_LEZIONE.FATTA } });
  const p = weekPace(c, at(LUN, '17:00'), byId, [sintesi('analisi', at(LUN, '12:00'), 120)]);
  const a = p.find((r) => r.materiaId === 'analisi');
  assert.equal(a.sintesiFattaMin, 120, 'la sessione copre la lezione: nessun credito aggiuntivo');
  assert.equal(a.creditoMin, 0);
});

test('V40 — aggiungere le fonti non trasforma in debito le lezioni già passate', () => {
  const fonteNuova = { id: `fonte_${at(LUN, '12:00').getTime()}_abc`, pagine: 100, pagineFatte: 0 };
  const nuova = { ...analisi, sfide: [{ id: 'n', nome: 'n', status: 'PENDING', fonti: [fonteNuova] }] };
  const map = new Map([[nuova.id, nuova], [fisica.id, fisica]]);
  const q = postLectureQueue(campus(), at(LUN, '12:30'), map, [sintesi('fisica', at('2026-10-02', '18:00'), 120)]);
  assert.ok(!q.some((x) => x.materiaId === 'analisi'), 'la lezione delle 9-11 era finita prima della prima fonte');
});

test('V40 — "Già fatta" non si prende i minuti destinati a una lezione successiva', () => {
  // Lunedì 9-11 analisi segnata "già fatta"; mercoledì 11-13 analisi; sessione di 120' mercoledì alle 15.
  const c = campus({ esiti: { [esitoKey('a1', LUN)]: ESITO_LEZIONE.FATTA } });
  const MER = '2026-10-07';
  const log = [sintesi('fisica', at('2026-10-02', '18:00'), 120), sintesi('fisica', at(LUN, '17:00'), 120), sintesi('analisi', at(MER, '15:00'), 120)];
  const q = postLectureQueue(c, at(MER, '16:00'), byId, log);
  assert.ok(!q.some((x) => x.materiaId === 'analisi'), 'la sessione di mercoledì sistema la lezione di mercoledì');
  const p = weekPace(c, at(MER, '16:00'), byId, log).find((r) => r.materiaId === 'analisi');
  assert.equal(p.dovutoMin, 240);
  assert.equal(p.sintesiFattaMin, 240, '120 dalla sessione + 120 di credito per la lezione dichiarata');
  assert.equal(p.stato, 'IN_PARI');
});

test('V40 — una sessione va alla lezione più recente, non a una vecchia già uscita dalla coda', () => {
  // Venerdì 9: fisica venerdì 15-17 (f2). Lunedì precedente fisica 14-16 ignorata. Sessione venerdì 18:00.
  const log = [sintesi('fisica', at(VEN, '18:00'), 120)];
  const q = postLectureQueue(campus(), at(VEN, '19:00'), byId, log);
  assert.ok(!q.some((x) => x.materiaId === 'fisica'), 'la fisica di venerdì è sistemata');
});

/* V40.2 — scelta dell'argomento della sintesi. */
test('argomentiSintesi: ordine dell\'albero, niente completati, suggerito segnato', () => {
  const f = (pagine, fatte = 0) => [{ id: `fonte_1790000000000_${pagine}${fatte}`, tipo: 'LIBRO', pagine, pagineFatte: fatte }];
  const materia = {
    id: 'mv',
    nome: 'Meccanica del Volo',
    sfide: [
      { id: 'b', nome: 'Figlio di A', parentId: 'a', status: 'PENDING', fonti: f(10) },
      { id: 'a', nome: 'Modulo A', parentId: null, status: 'PENDING', fonti: [] },
      { id: 'c', nome: 'Modulo C', parentId: null, status: 'COMPLETED', fonti: [] },
      { id: 'd', nome: 'Figlio di C', parentId: 'c', status: 'PENDING', fonti: f(20, 5) },
      { id: 'e', nome: 'Orfano', parentId: 'inesistente', status: 'PENDING', fonti: [] }
    ]
  };
  const lista = argomentiSintesi(materia);
  assert.deepEqual(lista.map((x) => x.id), ['a', 'b', 'd', 'e']);
  assert.deepEqual(lista.map((x) => x.profondita), [0, 1, 0, 0], 'sotto un padre completato non si rientra');
  const d = lista.find((x) => x.id === 'd');
  assert.equal(d.residue, 15);
  assert.equal(d.avviato, true);
  assert.equal(d.consigliato, true, 'la sintesi già avviata è quella suggerita');
  assert.equal(lista.filter((x) => x.consigliato).length, 1);
});

test('argomentiSintesi: dati con un ciclo non vanno in loop', () => {
  const materia = { sfide: [{ id: 'x', nome: 'X', parentId: 'y' }, { id: 'y', nome: 'Y', parentId: 'x' }] };
  assert.deepEqual(argomentiSintesi(materia).map((a) => a.id).sort(), ['x', 'y']);
  assert.deepEqual(argomentiSintesi(null), []);
});
