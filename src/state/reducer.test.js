import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reducer, MAX_COMBAT_LOG } from './reducer.js';
import { createDefaultState, hydrateState } from '../data/defaultSchema.js';
import { PERSISTED_STATUS } from '../utils/skillTree.js';
import { DIFFICULTY } from '../utils/xpEngine.js';
import { getDateKey } from '../utils/dateUtils.js';

/**
 * V37.0 — I PRIMI TEST SUL REDUCER.
 *
 * Fino alla V36 la suite copriva benissimo i motori puri (xpEngine,
 * spiderSense, calibration...) ma NON la macchina a stati: cioè l'unico
 * posto dove XP, streak, Stamina, scudi e quest vengono davvero
 * assegnati. Era anche la parte più intrecciata, quella in cui una
 * modifica a un `case` può rompere in silenzio un `case` lontano.
 *
 * Questi test coprono le transizioni che costano di più se si rompono:
 * quelle che assegnano o tolgono qualcosa in modo irreversibile.
 */

function statoBase(patch = {}) {
  const s = createDefaultState();
  return { ...s, ...patch };
}

function conMateria(materia = {}, sfide = []) {
  const s = statoBase();
  s.materie = [
    {
      id: 'm1',
      nome: 'Analisi 1',
      examDate: null,
      cfu: 12,
      createdAt: new Date().toISOString(),
      sfide,
      courseId: 'analisi1',
      perceivedDifficulty: 4,
      urgency: 3,
      examPassed: false,
      examPassedDate: null,
      voto: null,
      lode: false,
      ...materia
    }
  ];
  return s;
}

function nodo(patch = {}) {
  return {
    id: 'n1',
    nome: 'Limiti',
    obiettivo: '',
    oreStimate: 4,
    pagineAppunti: 0,
    fonti: [],
    appuntiCompleti: false,
    focusMinutesSintesi: 0,
    focusMinutesStudio: 0,
    parentId: null,
    difficulty: DIFFICULTY.MEDIUM,
    status: PERSISTED_STATUS.PENDING,
    completionTimestamp: null,
    nextReviewDate: null,
    lastReviewRating: null,
    reviewCount: 0,
    focusMinutes: 0,
    blueprint: '',
    note: '',
    srsEase: 2.3,
    srsIntervalDays: 0,
    quiz: null,
    tentativiSuccessi: 0,
    tentativiFalliti: 0,
    ...patch
  };
}

describe('reducer — purezza e blindature', () => {
  test('non muta mai lo stato in ingresso', () => {
    const s = conMateria({}, [nodo()]);
    const copia = JSON.parse(JSON.stringify(s));
    reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    assert.deepEqual(s, copia, 'il reducer ha modificato lo stato originale');
  });

  test("un'azione sconosciuta restituisce esattamente lo stesso oggetto", () => {
    const s = statoBase();
    assert.equal(reducer(s, { type: 'NON_ESISTE' }), s);
  });

  test('il Combat Log non supera mai il proprio cap', () => {
    let s = statoBase();
    for (let i = 0; i < MAX_COMBAT_LOG + 25; i += 1) {
      s = reducer(s, { type: 'LOG_EVENT', payload: { message: `riga ${i}`, tag: 'INFO' } });
    }
    assert.equal(s.combatLog.length, MAX_COMBAT_LOG);
    // Il cap taglia in testa: l'ultima riga scritta deve essere l'ultima presente.
    assert.equal(s.combatLog[s.combatLog.length - 1].message, `riga ${MAX_COMBAT_LOG + 24}`);
  });
});

describe('COMPLETE_SFIDA', () => {
  test('assegna XP e programma il primo ripasso', () => {
    const s = conMateria({}, [nodo()]);
    const next = reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    const n = next.materie[0].sfide[0];
    assert.equal(n.status, PERSISTED_STATUS.COMPLETED);
    assert.ok(n.nextReviewDate, 'nessuna data di ripasso programmata');
    assert.ok(next.profile.currentXp > 0 || next.profile.level > 1, 'nessun XP assegnato');
  });

  test('un doppio click non paga due volte', () => {
    const s = conMateria({}, [nodo()]);
    const uno = reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    const due = reducer(uno, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    assert.equal(due, uno, 'il secondo completamento ha prodotto un nuovo stato');
  });

  test('un nodo Boss con figli aperti non è completabile', () => {
    const s = conMateria({}, [nodo({ id: 'boss' }), nodo({ id: 'figlio', parentId: 'boss' })]);
    const next = reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'boss' } });
    assert.equal(next, s, 'un Boss bloccato è stato completato lo stesso');
  });

  test('un nodo già avviato (IN_PROGRESS) resta completabile', () => {
    // Regressione nota: la blindatura anti doppio-click aveva bloccato
    // anche il primo click legittimo su un nodo con Focus già investito.
    const s = conMateria({}, [nodo({ focusMinutes: 50 })]);
    const next = reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    assert.equal(next.materie[0].sfide[0].status, PERSISTED_STATUS.COMPLETED);
  });
});

describe('Economia — nessun saldo può andare sotto zero', () => {
  test('una ricompensa troppo cara non viene riscattata', () => {
    const s = statoBase();
    s.shopRewards = [{ id: 'r1', nome: 'Cinema', costoXp: 999999 }];
    const next = reducer(s, { type: 'REDEEM_SHOP_REWARD', payload: { id: 'r1' } });
    assert.equal(next, s);
    assert.equal(next.inventory.length, 0);
  });

  test('una skill senza Tech Token non viene sbloccata', () => {
    const s = statoBase();
    s.profile.techTokens = 0;
    const next = reducer(s, { type: 'UNLOCK_SKILL', payload: { skillId: 'focusBoost' } });
    assert.equal(next.profile.techTokens, 0);
    assert.deepEqual(next.profile.unlockedSkills, []);
  });

  test('un Daily Protocol non si può incassare due volte nello stesso giorno', () => {
    const s = statoBase();
    s.profile.stamina = 10;
    const primo = reducer(s, { type: 'APPLY_QUICK_QUEST', payload: { questId: 'qq_pasto' } });
    assert.ok(primo.profile.stamina > 10, 'la prima attivazione non ha dato Stamina');
    const secondo = reducer(primo, { type: 'APPLY_QUICK_QUEST', payload: { questId: 'qq_pasto' } });
    assert.equal(secondo, primo, 'il protocollo è stato incassato due volte');
  });

  test('la Stamina non supera mai 100', () => {
    const s = statoBase();
    s.profile.stamina = 95;
    const next = reducer(s, { type: 'APPLY_QUICK_QUEST', payload: { questId: 'qq_sonno' } });
    assert.equal(next.profile.stamina, 100);
  });
});

describe('V37.0 — Esame superato chiude davvero la Materia', () => {
  const patchSuperato = { examPassed: true, examPassedDate: '2026-06-15', voto: 28 };

  test('tutti i nodi passano a completati e escono dallo Spider-Sense', () => {
    const s = conMateria({}, [
      nodo({ id: 'a' }),
      nodo({ id: 'b', status: PERSISTED_STATUS.COMPLETED, nextReviewDate: '2026-01-01' }),
      nodo({ id: 'c' })
    ]);
    const next = reducer(s, { type: 'UPDATE_MATERIA', payload: { id: 'm1', patch: patchSuperato } });
    const sfide = next.materie[0].sfide;
    assert.ok(sfide.every((n) => n.status === PERSISTED_STATUS.COMPLETED), 'sono rimasti nodi aperti');
    assert.ok(
      sfide.every((n) => n.nextReviewDate === null),
      'un nodo continuerebbe a chiedere ripassi per un esame già dato'
    );
  });

  test('vale anche per una Materia senza alcun nodo', () => {
    const s = conMateria({}, []);
    const next = reducer(s, { type: 'UPDATE_MATERIA', payload: { id: 'm1', patch: patchSuperato } });
    assert.equal(next.materie[0].examPassed, true);
    assert.equal(next.materie[0].examPassedDate, '2026-06-15');
  });

  test('lo storico della media usa la data di verbalizzazione, non oggi', () => {
    const s = conMateria({}, []);
    const next = reducer(s, { type: 'UPDATE_MATERIA', payload: { id: 'm1', patch: patchSuperato } });
    assert.equal(next.gradeHistory.length, 1);
    assert.equal(next.gradeHistory[0].dateKey, '2026-06-15');
    assert.notEqual(next.gradeHistory[0].dateKey, getDateKey());
  });

  test('senza data di verbalizzazione si ricade su oggi', () => {
    const s = conMateria({}, []);
    const next = reducer(s, {
      type: 'UPDATE_MATERIA',
      payload: { id: 'm1', patch: { examPassed: true, voto: 30 } }
    });
    assert.equal(next.gradeHistory[0].dateKey, getDateKey());
  });

  test('lo storico resta ordinato anche inserendo un esame vecchio dopo uno recente', () => {
    let s = conMateria({}, []);
    s.materie.push({ ...s.materie[0], id: 'm2', nome: 'Fisica', courseId: 'fisica' });
    s = reducer(s, {
      type: 'UPDATE_MATERIA',
      payload: { id: 'm1', patch: { examPassed: true, examPassedDate: '2026-09-01', voto: 27 } }
    });
    s = reducer(s, {
      type: 'UPDATE_MATERIA',
      payload: { id: 'm2', patch: { examPassed: true, examPassedDate: '2026-02-10', voto: 30 } }
    });
    const date = s.gradeHistory.map((e) => e.dateKey);
    assert.deepEqual(date, [...date].sort(), 'il grafico tornerebbe indietro nel tempo');
  });

  test('togliere la spunta non riapre i nodi già chiusi', () => {
    // Scelta deliberata: non sapremmo quali erano davvero incompleti.
    const s = conMateria({}, [nodo({ id: 'a' })]);
    const superato = reducer(s, { type: 'UPDATE_MATERIA', payload: { id: 'm1', patch: patchSuperato } });
    const annullato = reducer(superato, {
      type: 'UPDATE_MATERIA',
      payload: { id: 'm1', patch: { examPassed: false } }
    });
    assert.equal(annullato.materie[0].sfide[0].status, PERSISTED_STATUS.COMPLETED);
  });
});

describe('Streak', () => {
  test('un giorno consecutivo incrementa la streak', () => {
    const s = conMateria({}, [nodo()]);
    const ieri = new Date(Date.now() - 86400000);
    s.profile.lastActiveDate = ieri.toISOString();
    s.profile.streak = 4;
    const next = reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    assert.equal(next.profile.streak, 5);
  });

  test('un orologio che torna indietro non azzera la streak', () => {
    // V37.0 — prima un fuso cambiato o una data sistemata a mano
    // mandava la streak a 1, senza alcun modo di recuperarla.
    const s = conMateria({}, [nodo()]);
    s.profile.lastActiveDate = new Date(Date.now() + 3 * 86400000).toISOString();
    s.profile.streak = 40;
    const next = reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    assert.equal(next.profile.streak, 40);
  });

  test('uno Streak Shield copre un giorno saltato', () => {
    const s = conMateria({}, [nodo()]);
    s.profile.lastActiveDate = new Date(Date.now() - 2 * 86400000).toISOString();
    s.profile.streak = 12;
    s.profile.streakShields = 1;
    // Il mese corrente risulta già premiato, altrimenti l'assegnazione
    // mensile automatica rimpiazzerebbe lo scudo appena consumato e il
    // test non misurerebbe più niente.
    s.profile.lastStreakShieldGrantMonthKey = getDateKey().slice(0, 7);
    const next = reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    assert.equal(next.profile.streak, 12, 'la streak andava preservata');
    assert.equal(next.profile.streakShields, 0, 'lo scudo non è stato consumato');
    assert.equal(next.profile.streakShieldsUsedTotal, 1);
  });

  test('il nuovo mese assegna uno scudo da solo', () => {
    const s = conMateria({}, [nodo()]);
    s.profile.lastActiveDate = new Date(Date.now() - 86400000).toISOString();
    s.profile.streakShields = 0;
    s.profile.lastStreakShieldGrantMonthKey = null;
    const next = reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    assert.equal(next.profile.streakShields, 1);
    assert.equal(next.profile.lastStreakShieldGrantMonthKey, getDateKey().slice(0, 7));
  });

  test('senza scudi a sufficienza la streak riparte da 1', () => {
    const s = conMateria({}, [nodo()]);
    s.profile.lastActiveDate = new Date(Date.now() - 5 * 86400000).toISOString();
    s.profile.streak = 12;
    s.profile.streakShields = 1;
    s.profile.lastStreakShieldGrantMonthKey = getDateKey().slice(0, 7);
    const next = reducer(s, { type: 'COMPLETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'n1' } });
    assert.equal(next.profile.streak, 1);
  });
});

describe('DELETE_SFIDA / BULK_DELETE_SFIDE', () => {
  test('i figli vengono promossi a radice, mai cancellati a cascata', () => {
    const s = conMateria({}, [nodo({ id: 'padre' }), nodo({ id: 'figlio', parentId: 'padre' })]);
    const next = reducer(s, { type: 'DELETE_SFIDA', payload: { materiaId: 'm1', sfidaId: 'padre' } });
    assert.equal(next.materie[0].sfide.length, 1);
    assert.equal(next.materie[0].sfide[0].id, 'figlio');
    assert.equal(next.materie[0].sfide[0].parentId, null);
  });

  test("l'eliminazione in blocco orfanizza correttamente anche padri dentro la selezione", () => {
    const s = conMateria({}, [
      nodo({ id: 'a' }),
      nodo({ id: 'b', parentId: 'a' }),
      nodo({ id: 'c', parentId: 'b' })
    ]);
    const next = reducer(s, { type: 'BULK_DELETE_SFIDE', payload: { materiaId: 'm1', sfidaIds: ['a', 'b'] } });
    assert.equal(next.materie[0].sfide.length, 1);
    assert.equal(next.materie[0].sfide[0].id, 'c');
    assert.equal(next.materie[0].sfide[0].parentId, null);
  });
});

describe('FOCUS_COMPLETED', () => {
  test('registra minuti, XP e costo Stamina', () => {
    const s = conMateria({}, [nodo()]);
    const prima = s.profile.stamina;
    const next = reducer(s, {
      type: 'FOCUS_COMPLETED',
      payload: { wasOverdrive: false, materiaId: 'm1', sfidaId: 'n1', focusMinutes: 50, quality: 'NORMAL' }
    });
    const giorno = next.starLog.find((e) => e.type === 'FOCUS_MINUTES');
    assert.equal(giorno.minutes, 50);
    assert.ok(next.starLog.some((e) => e.type === 'FOCUS_SESSION'));
    assert.ok(next.profile.stamina < prima, 'nessun costo di Stamina applicato');
    assert.equal(next.materie[0].sfide[0].focusMinutes, 50);
  });

  test('una sessione in Overdrive incrementa il contatore dedicato', () => {
    // È il contatore che la V36 non incrementava mai, per via del bug
    // sulla closure in useTimerEngine: qui si verifica il contratto.
    const s = conMateria({}, [nodo()]);
    const next = reducer(s, {
      type: 'FOCUS_COMPLETED',
      payload: { wasOverdrive: true, materiaId: 'm1', sfidaId: 'n1', focusMinutes: 25, quality: 'NORMAL' }
    });
    assert.equal(next.profile.overdriveCount, 1);
  });
});

/* ================================================================== *
 * V38.0 — LA FORGIA DEGLI APPUNTI
 *
 * Una sessione di Sintesi deve far avanzare le fonti e far crescere le
 * pagine di appunti: è l'unico modo in cui il piano di un semestre può
 * muoversi mentre il semestre va avanti. Questi test proteggono quella
 * catena — che passa da tre punti diversi (payload, fonti, ritmi) e può
 * rompersi in silenzio in ognuno.
 * ================================================================== */
describe('FOCUS_COMPLETED — sessioni di Sintesi', () => {
  const conFonti = (fonti, patch = {}) =>
    conMateria({}, [nodo({ fonti, ...patch })]);

  const sessione = (stato, payload) =>
    reducer(stato, {
      type: 'FOCUS_COMPLETED',
      payload: { materiaId: 'm1', sfidaId: 'n1', focusMinutes: 60, ...payload }
    });

  test('una sessione di Sintesi avanza le fonti e aggiunge pagine di appunti', () => {
    const s = conFonti([{ id: 'f1', tipo: 'LIBRO', pagine: 200, pagineFatte: 0 }]);
    const out = sessione(s, { workMode: 'SINTESI', pagineFonte: 40, pagineAppuntiProdotte: 8 });
    const n = out.materie[0].sfide[0];
    assert.equal(n.fonti[0].pagineFatte, 40);
    assert.equal(n.pagineAppunti, 8);
  });

  test('le pagine traboccano dalla fonte finita a quella successiva', () => {
    const s = conFonti([
      { id: 'f1', tipo: 'LIBRO', pagine: 100, pagineFatte: 90 },
      { id: 'f2', tipo: 'SLIDE', pagine: 200, pagineFatte: 0 }
    ]);
    const out = sessione(s, { workMode: 'SINTESI', pagineFonte: 50 });
    const n = out.materie[0].sfide[0];
    assert.equal(n.fonti[0].pagineFatte, 100);
    assert.equal(n.fonti[1].pagineFatte, 40);
  });

  test('i minuti finiscono nel contatore giusto, non in entrambi', () => {
    const s = conFonti([{ id: 'f1', tipo: 'LIBRO', pagine: 200, pagineFatte: 0 }]);
    const sint = sessione(s, { workMode: 'SINTESI', focusMinutes: 50 }).materie[0].sfide[0];
    assert.equal(sint.focusMinutesSintesi, 50);
    assert.equal(sint.focusMinutesStudio, 0);
    assert.equal(sint.focusMinutes, 50, 'il totale continua ad alimentare XP e bias');

    const stud = sessione(s, { workMode: 'STUDIO', focusMinutes: 50 }).materie[0].sfide[0];
    assert.equal(stud.focusMinutesStudio, 50);
    assert.equal(stud.focusMinutesSintesi, 0);
  });

  test('una sessione di Studio non tocca mai le fonti', () => {
    const s = conFonti([{ id: 'f1', tipo: 'LIBRO', pagine: 200, pagineFatte: 30 }], { pagineAppunti: 10 });
    const n = sessione(s, { workMode: 'STUDIO', pagineFonte: 999, pagineAppuntiProdotte: 999 }).materie[0].sfide[0];
    assert.equal(n.fonti[0].pagineFatte, 30, 'studiare non produce materiale');
    assert.equal(n.pagineAppunti, 10);
  });

  test('senza modo dichiarato i minuti restano solo nel totale', () => {
    // È il caso della sessione recuperata al boot dopo una chiusura
    // imprevista: nessuno ha risposto al Debriefing, quindi non si sa
    // come sia stata spesa. Attribuirla d'ufficio allo studio
    // inquinerebbe il ritmo misurato con ore che potevano essere di
    // sintesi.
    const s = conFonti([{ id: 'f1', tipo: 'LIBRO', pagine: 200, pagineFatte: 0 }]);
    const n = sessione(s, { focusMinutes: 25 }).materie[0].sfide[0];
    assert.equal(n.focusMinutes, 25, 'XP, streak e bias continuano a vedere la sessione');
    assert.equal(n.focusMinutesStudio, 0);
    assert.equal(n.focusMinutesSintesi, 0);
    assert.equal(n.fonti[0].pagineFatte, 0);
  });

  test('le pagine non superano mai il totale della fonte', () => {
    const s = conFonti([{ id: 'f1', tipo: 'LIBRO', pagine: 50, pagineFatte: 0 }]);
    const n = sessione(s, { workMode: 'SINTESI', pagineFonte: 9999 }).materie[0].sfide[0];
    assert.equal(n.fonti[0].pagineFatte, 50);
  });

  test('la sessione di Sintesi lascia una riga nel Combat Log', () => {
    const s = conFonti([{ id: 'f1', tipo: 'LIBRO', pagine: 200, pagineFatte: 0 }]);
    const out = sessione(s, { workMode: 'SINTESI', pagineFonte: 40, pagineAppuntiProdotte: 8 });
    const righe = out.combatLog.map((l) => l.message).join('\n');
    assert.match(righe, /Forgia degli Appunti/);
    assert.match(righe, /40 pagine di fonte/);
  });

  test('una sessione senza pagine dichiarate non scrive righe inutili', () => {
    const s = conFonti([{ id: 'f1', tipo: 'LIBRO', pagine: 200, pagineFatte: 0 }]);
    const out = sessione(s, { workMode: 'SINTESI' });
    const righe = out.combatLog.map((l) => l.message).join('\n');
    assert.doesNotMatch(righe, /Forgia degli Appunti/);
  });

  test('il modo e le pagine finiscono sulla voce dello Star Log', () => {
    const s = conFonti([{ id: 'f1', tipo: 'LIBRO', pagine: 200, pagineFatte: 0 }]);
    const out = sessione(s, { workMode: 'SINTESI', pagineFonte: 40, pagineAppuntiProdotte: 8 });
    const voce = out.starLog.filter((e) => e.type === 'FOCUS_SESSION').pop();
    assert.equal(voce.workMode, 'SINTESI');
    assert.equal(voce.pagineFonte, 40);
    assert.equal(voce.pagineAppuntiProdotte, 8);
  });

  test('una sessione senza nodo agganciato non esplode', () => {
    const s = conMateria({}, [nodo()]);
    const out = reducer(s, {
      type: 'FOCUS_COMPLETED',
      payload: { materiaId: null, sfidaId: null, focusMinutes: 25, workMode: 'SINTESI', pagineFonte: 10 }
    });
    assert.ok(out.starLog.some((e) => e.type === 'FOCUS_SESSION'));
  });
});

/* ================================================================== *
 * V39.0 — EMPIRE STATE UNIVERSITY
 * ================================================================== */
describe('Campus — semestri, orario, integrità', () => {
  const conCampus = () => {
    let s = conMateria({ id: 'm1', nome: 'Analisi 1' }, [nodo()]);
    s = { ...s, materie: [...s.materie, { ...s.materie[0], id: 'm2', nome: 'Fisica 1', sfide: [] }] };
    s = reducer(s, { type: 'CAMPUS_ADD_SEMESTRE', payload: { nome: '1° semestre', inizio: '2026-09-22', fine: '2026-12-19' } });
    const semId = s.campus.semestri[0].id;
    s = reducer(s, {
      type: 'CAMPUS_SAVE_LEZIONE',
      payload: { semestreId: semId, lezione: { materiaId: 'm1', giorno: 1, inizio: '09:00', fine: '11:00' } }
    });
    s = reducer(s, {
      type: 'CAMPUS_SAVE_LEZIONE',
      payload: { semestreId: semId, lezione: { materiaId: 'm2', giorno: 2, inizio: '14:00', fine: '16:00' } }
    });
    return { s, semId };
  };

  test('lo stato di default ha un campus vuoto e valido', () => {
    const s = statoBase();
    assert.deepEqual(s.campus.semestri, []);
    assert.equal(s.campus.override, null);
  });

  test('aggiunge semestre e lezioni', () => {
    const { s } = conCampus();
    assert.equal(s.campus.semestri.length, 1);
    assert.equal(s.campus.semestri[0].lezioni.length, 2);
  });

  test('salvare una lezione esistente la aggiorna invece di duplicarla', () => {
    const { s, semId } = conCampus();
    const l = s.campus.semestri[0].lezioni[0];
    const out = reducer(s, {
      type: 'CAMPUS_SAVE_LEZIONE',
      payload: { semestreId: semId, lezione: { ...l, inizio: '10:00', fine: '12:00' } }
    });
    assert.equal(out.campus.semestri[0].lezioni.length, 2);
    assert.equal(out.campus.semestri[0].lezioni.find((x) => x.id === l.id).inizio, '10:00');
  });

  test('una lezione con fine prima dell’inizio non entra nello stato', () => {
    const { s, semId } = conCampus();
    const out = reducer(s, {
      type: 'CAMPUS_SAVE_LEZIONE',
      payload: { semestreId: semId, lezione: { materiaId: 'm1', giorno: 3, inizio: '12:00', fine: '10:00' } }
    });
    assert.equal(out.campus.semestri[0].lezioni.length, 2);
  });

  test('una lezione per una materia inesistente non entra nello stato', () => {
    const { s, semId } = conCampus();
    const out = reducer(s, {
      type: 'CAMPUS_SAVE_LEZIONE',
      payload: { semestreId: semId, lezione: { materiaId: 'fantasma', giorno: 3, inizio: '10:00', fine: '12:00' } }
    });
    assert.equal(out.campus.semestri[0].lezioni.length, 2);
  });

  test('cancellare una materia cancella le sue lezioni dall’orario', () => {
    const { s } = conCampus();
    const out = reducer(s, { type: 'DELETE_MATERIA', payload: { id: 'm1' } });
    assert.deepEqual(out.campus.semestri[0].lezioni.map((l) => l.materiaId), ['m2']);
  });

  test('forzatura della fase con scadenza, e ritorno all’automatico', () => {
    const { s } = conCampus();
    const forzato = reducer(s, { type: 'CAMPUS_SET_OVERRIDE', payload: { fase: 'SESSIONE', finoA: '2026-10-11' } });
    assert.deepEqual(forzato.campus.override, { fase: 'SESSIONE', finoA: '2026-10-11' });
    const auto = reducer(forzato, { type: 'CAMPUS_SET_OVERRIDE', payload: null });
    assert.equal(auto.campus.override, null);
  });

  test('una forzatura senza data valida viene scartata', () => {
    const { s } = conCampus();
    const out = reducer(s, { type: 'CAMPUS_SET_OVERRIDE', payload: { fase: 'SESSIONE', finoA: 'mai' } });
    assert.equal(out.campus.override, null);
  });

  test('sospensioni: aggiunta e rimozione dello stesso giorno', () => {
    const { s, semId } = conCampus();
    const a = reducer(s, { type: 'CAMPUS_TOGGLE_SOSPENSIONE', payload: { semestreId: semId, dateKey: '2026-11-02' } });
    assert.deepEqual(a.campus.semestri[0].sospensioni, ['2026-11-02']);
    const b = reducer(a, { type: 'CAMPUS_TOGGLE_SOSPENSIONE', payload: { semestreId: semId, dateKey: '2026-11-02' } });
    assert.deepEqual(b.campus.semestri[0].sospensioni, []);
  });

  test('eliminare un semestre elimina anche il suo orario', () => {
    const { s, semId } = conCampus();
    const out = reducer(s, { type: 'CAMPUS_DELETE_SEMESTRE', payload: { id: semId } });
    assert.equal(out.campus.semestri.length, 0);
  });

  test('il rapporto di sintesi resta nei limiti', () => {
    const { s } = conCampus();
    assert.equal(reducer(s, { type: 'CAMPUS_SET_RAPPORTO', payload: { value: 1.5 } }).campus.rapportoSintesi, 1.5);
    assert.equal(reducer(s, { type: 'CAMPUS_SET_RAPPORTO', payload: { value: 40 } }).campus.rapportoSintesi, 3);
  });

  test('un profilo senza campus (pre-V39) si reidrata con un campus vuoto', () => {
    // Il Provider passa sempre da hydrateState prima di HYDRATE: è lì che
    // vive la migrazione.
    const vecchio = { ...statoBase() };
    delete vecchio.campus;
    assert.deepEqual(hydrateState(vecchio).campus.semestri, []);
  });

  test('alla reidratazione le lezioni di materie scomparse vengono rimosse', () => {
    const { s } = conCampus();
    const senzaFisica = { ...s, materie: s.materie.filter((m) => m.id !== 'm2') };
    const out = hydrateState(JSON.parse(JSON.stringify(senzaFisica)));
    assert.deepEqual(out.campus.semestri[0].lezioni.map((l) => l.materiaId), ['m1']);
  });
});

/* ---------------------------------------------------------------- *
 * V40 — sintesi registrata a mano sul nodo ed esiti delle lezioni
 * ---------------------------------------------------------------- */
test('V40 — UPDATE_SFIDA segna sintesiAggiornataAt solo se la sintesi avanza', () => {
  let s = createDefaultState();
  s = reducer(s, { type: 'ADD_MATERIA', payload: { nome: 'MdV', cfu: 9 } });
  const mid = s.materie[0].id;
  s = reducer(s, { type: 'ADD_SFIDA', payload: { materiaId: mid, nome: 'Atmosfera', oreStimate: 1 } });
  const sid = s.materie[0].sfide[0].id;
  s = reducer(s, { type: 'UPDATE_SFIDA', payload: { materiaId: mid, sfidaId: sid, patch: { nome: 'Atmosfera Standard' } } });
  assert.equal(s.materie[0].sfide[0].sintesiAggiornataAt, undefined, 'rinominare non è sintesi');
  s = reducer(s, { type: 'UPDATE_SFIDA', payload: { materiaId: mid, sfidaId: sid, patch: { fonti: [{ id: 'f', tipo: 'LIBRO', pagine: 16, pagineFatte: 0 }] } } });
  assert.equal(s.materie[0].sfide[0].sintesiAggiornataAt, undefined, 'aggiungere una fonte da snellire non è sintesi fatta');
  s = reducer(s, { type: 'UPDATE_SFIDA', payload: { materiaId: mid, sfidaId: sid, patch: { fonti: [{ id: 'f', tipo: 'LIBRO', pagine: 16, pagineFatte: 16 }] } } });
  assert.ok(typeof s.materie[0].sfide[0].sintesiAggiornataAt === 'string', 'pagine snellite: sintesi avanzata');
});

test('V40 — CAMPUS_SET_ESITO imposta e annulla', () => {
  let s = createDefaultState();
  s = reducer(s, { type: 'ADD_MATERIA', payload: { nome: 'MdV', cfu: 9 } });
  const mid = s.materie[0].id;
  s = reducer(s, { type: 'CAMPUS_ADD_SEMESTRE', payload: { nome: 'S', inizio: '2026-09-01', fine: '2026-12-20' } });
  const semId = s.campus.semestri[0].id;
  s = reducer(s, { type: 'CAMPUS_SAVE_LEZIONE', payload: { semestreId: semId, lezione: { materiaId: mid, giorno: 1, inizio: '09:00', fine: '11:00' } } });
  const lid = s.campus.semestri[0].lezioni[0].id;
  const oggi = new Date();
  const dk = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;
  s = reducer(s, { type: 'CAMPUS_SET_ESITO', payload: { lezioni: [{ id: lid, dateKey: dk }], esito: 'FATTA' } });
  assert.equal(s.campus.esiti[`${lid}@${dk}`], 'FATTA');
  s = reducer(s, { type: 'CAMPUS_SET_ESITO', payload: { lezioni: [{ id: lid, dateKey: dk }], esito: null } });
  assert.equal(s.campus.esiti[`${lid}@${dk}`], undefined);
  const prima = s;
  s = reducer(s, { type: 'CAMPUS_SET_ESITO', payload: { lezioni: [{ id: lid, dateKey: dk }], esito: 'BOH' } });
  assert.equal(s, prima, 'esito sconosciuto: stato invariato');
});

test('V40 — il caricamento (hydrate) non perde più chiusoDaVerbale e sintesiAggiornataAt', () => {
  let s = createDefaultState();
  s = reducer(s, { type: 'ADD_MATERIA', payload: { nome: 'X', cfu: 6 } });
  const mid = s.materie[0].id;
  s = reducer(s, { type: 'ADD_SFIDA', payload: { materiaId: mid, nome: 'n', oreStimate: 1 } });
  const sid = s.materie[0].sfide[0].id;
  s = reducer(s, { type: 'UPDATE_SFIDA', payload: { materiaId: mid, sfidaId: sid, patch: { pagineAppunti: 3 } } });
  s = reducer(s, { type: 'UPDATE_MATERIA', payload: { id: mid, patch: { examPassed: true } } });
  const h = hydrateState(JSON.parse(JSON.stringify(s)));
  assert.equal(h.materie[0].sfide[0].chiusoDaVerbale, true);
  assert.equal(typeof h.materie[0].sfide[0].sintesiAggiornataAt, 'string');
});
