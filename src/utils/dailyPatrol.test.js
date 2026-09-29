// =====================================================================
// ArachnoForge — src/utils/dailyPatrol.test.js (V42)
// Le missioni del giorno seguono il metodo di studio e la fase del
// semestre, contano solo blocchi veri e non premiano lo studio notturno.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateDailyQuests, applyQuestEvent, QUEST_TYPE, QUEST_EVENTS, QUEST_DIFFICULTY, QUEST_SESSION_MIN_MINUTES, DEEP_WORK_MINUTES } from './dailyPatrol.js';

const GIORNI = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 1 + i));
  return d.toISOString().slice(0, 10);
});
const CTX_PIENO = {
  upcomingReviewsCount: 4,
  reviewTargetCount: 3,
  hasLessonsToProcess: true,
  hasSintesiWork: true,
  hasWrittenExam: true,
  hasUpcomingExam: true,
  hasPrimaryTarget: true,
  todayTargetMinutes: 200
};

describe('generateDailyQuests', () => {
  test('tre missioni, una per difficoltà, identiche per tutta la giornata', () => {
    const a = generateDailyQuests('2026-10-05', { ...CTX_PIENO, fase: 'LEZIONI' });
    const b = generateDailyQuests('2026-10-05', { ...CTX_PIENO, fase: 'LEZIONI' });
    assert.deepEqual(a, b);
    assert.deepEqual(a.map((q) => q.difficulty), [QUEST_DIFFICULTY.EASY, QUEST_DIFFICULTY.MEDIUM, QUEST_DIFFICULTY.HARD]);
    a.forEach((q) => {
      assert.equal(q.currentProgress, 0);
      assert.equal(q.isCompleted, false);
      assert.ok(q.id.startsWith('dq_2026-10-05_'));
    });
  });

  test('niente più premi per lo studio notturno né per l’Overdrive in sé', () => {
    GIORNI.forEach((d) => {
      ['LEZIONI', 'SESSIONE'].forEach((fase) => {
        generateDailyQuests(d, { ...CTX_PIENO, fase }).forEach((q) => {
          assert.notEqual(q.type, QUEST_TYPE.NIGHT_OWL_FOCUS);
          assert.notEqual(q.type, QUEST_TYPE.OVERDRIVE_STRIKES);
        });
      });
    });
  });

  test('le missioni seguono la fase: esercizi e simulazioni in sessione, lezioni e appunti durante i corsi', () => {
    const tipi = (fase) => new Set(GIORNI.flatMap((d) => generateDailyQuests(d, { ...CTX_PIENO, fase }).map((q) => q.type)));
    const lezioni = tipi('LEZIONI');
    const sessione = tipi('SESSIONE');
    assert.ok(lezioni.has(QUEST_TYPE.LESSON_SINTESI) || lezioni.has(QUEST_TYPE.NOTES_PAGES));
    assert.ok(!lezioni.has(QUEST_TYPE.EXERCISES));
    assert.ok(!sessione.has(QUEST_TYPE.LESSON_SINTESI));
    assert.ok(sessione.has(QUEST_TYPE.EXERCISES) || sessione.has(QUEST_TYPE.SINISTER_SIX_WINS));
  });

  test('una missione impossibile oggi non viene pescata', () => {
    const ctx = { fase: 'LEZIONI', upcomingReviewsCount: 0, hasLessonsToProcess: false, hasSintesiWork: false, hasPrimaryTarget: false, todayTargetMinutes: 0 };
    GIORNI.forEach((d) => {
      generateDailyQuests(d, ctx).forEach((q) => {
        assert.notEqual(q.type, QUEST_TYPE.REVIEWS_CLEARED, 'nessun ripasso in scadenza');
        assert.notEqual(q.type, QUEST_TYPE.LESSON_SINTESI, 'nessuna lezione da sistemare');
        assert.notEqual(q.type, QUEST_TYPE.NOTES_PAGES);
        assert.notEqual(q.type, QUEST_TYPE.PRIMARY_TARGET_SESSION);
        assert.notEqual(q.type, QUEST_TYPE.DAY_TARGET);
      });
    });
  });

  test('i ripassi chiesti sono quelli di oggi, non l’intero arretrato; l’obiettivo del giorno è quello del piano', () => {
    const tutte = GIORNI.flatMap((d) => generateDailyQuests(d, { ...CTX_PIENO, fase: 'SESSIONE', upcomingReviewsCount: 30, reviewTargetCount: 6 }));
    tutte.filter((q) => q.type === QUEST_TYPE.REVIEWS_CLEARED).forEach((q) => assert.equal(q.targetAmount, 6));
    tutte.filter((q) => q.type === QUEST_TYPE.DAY_TARGET).forEach((q) => assert.equal(q.targetAmount, 195, 'arrotondato al quarto d’ora'));
  });
});

describe('applyQuestEvent', () => {
  const quest = (type, targetAmount = 1, over = {}) => ({ id: type, type, targetAmount, currentProgress: 0, isCompleted: false, xpReward: 10, ...over });

  test(`le missioni "a sessioni" contano solo blocchi veri (almeno ${QUEST_SESSION_MIN_MINUTES} minuti)`, () => {
    const [flow] = applyQuestEvent([quest(QUEST_TYPE.FLOW_STATE_SESSIONS, 2)], QUEST_EVENTS.FOCUS_SESSION, { minutes: 5, quality: 'FLOW' });
    assert.equal(flow.currentProgress, 0);
    const [ok] = applyQuestEvent([quest(QUEST_TYPE.FLOW_STATE_SESSIONS, 2)], QUEST_EVENTS.FOCUS_SESSION, { minutes: 25, quality: 'FLOW' });
    assert.equal(ok.currentProgress, 1);
    const [early] = applyQuestEvent([quest(QUEST_TYPE.EARLY_BIRD_FOCUS)], QUEST_EVENTS.FOCUS_SESSION, { minutes: 10, hour: 7 });
    assert.equal(early.isCompleted, false);
  });

  test('Primary Target: un blocco da almeno 25 minuti sulla prima materia del piano', () => {
    const q = [quest(QUEST_TYPE.PRIMARY_TARGET_SESSION)];
    assert.equal(applyQuestEvent(q, QUEST_EVENTS.FOCUS_SESSION, { minutes: 1, materiaId: 'a', primaryTargetMateriaId: 'a' })[0].isCompleted, false);
    assert.equal(applyQuestEvent(q, QUEST_EVENTS.FOCUS_SESSION, { minutes: 30, materiaId: 'b', primaryTargetMateriaId: 'a' })[0].isCompleted, false);
    assert.equal(applyQuestEvent(q, QUEST_EVENTS.FOCUS_SESSION, { minutes: 30, materiaId: 'a', primaryTargetMateriaId: 'a' })[0].isCompleted, true);
  });

  test('minuti, blocco profondo, lezione del giorno e pagine di appunti', () => {
    const qs = [
      quest(QUEST_TYPE.FOCUS_MINUTES, 60),
      quest(QUEST_TYPE.DEEP_WORK),
      quest(QUEST_TYPE.LESSON_SINTESI),
      quest(QUEST_TYPE.NOTES_PAGES, 3)
    ];
    const out = applyQuestEvent(qs, QUEST_EVENTS.FOCUS_SESSION, { minutes: DEEP_WORK_MINUTES, workMode: 'SINTESI', materiaId: 'fisica', lessonMateriaIds: ['fisica'], pagineAppuntiProdotte: 2 });
    assert.equal(out[0].currentProgress, DEEP_WORK_MINUTES);
    assert.equal(out[1].isCompleted, true);
    assert.equal(out[2].isCompleted, true);
    assert.equal(out[3].currentProgress, 2);
    const troppoBreve = applyQuestEvent([quest(QUEST_TYPE.DEEP_WORK)], QUEST_EVENTS.FOCUS_SESSION, { minutes: DEEP_WORK_MINUTES - 1 });
    assert.equal(troppoBreve[0].isCompleted, false);
  });

  test('i ripassi contano solo se erano dovuti', () => {
    const q = [quest(QUEST_TYPE.REVIEWS_CLEARED, 2)];
    assert.equal(applyQuestEvent(q, QUEST_EVENTS.REVIEW_DONE, { wasDue: false })[0].currentProgress, 0);
    assert.equal(applyQuestEvent(q, QUEST_EVENTS.REVIEW_DONE, { wasDue: true })[0].currentProgress, 1);
  });

  test('argomenti completati senza studio tracciato non contano; il modulo conta per Boss Hunter', () => {
    const qs = [quest(QUEST_TYPE.NODES_COMPLETED, 2), quest(QUEST_TYPE.BOSS_DEFEATED)];
    assert.equal(applyQuestEvent(qs, QUEST_EVENTS.NODE_COMPLETED, { tracked: false })[0].currentProgress, 0);
    const out = applyQuestEvent(qs, QUEST_EVENTS.NODE_COMPLETED, { tracked: true, isBoss: true });
    assert.equal(out[0].currentProgress, 1);
    assert.equal(out[1].isCompleted, true);
  });

  test('simulazioni da almeno 20 minuti, esercizi registrati e giornata chiusa', () => {
    const qs = [quest(QUEST_TYPE.SINISTER_SIX_WINS), quest(QUEST_TYPE.EXERCISES, 8), quest(QUEST_TYPE.CLOSE_DAY)];
    assert.equal(applyQuestEvent(qs, QUEST_EVENTS.BOSS_FIGHT_WIN, { minutes: 10 })[0].isCompleted, false);
    assert.equal(applyQuestEvent(qs, QUEST_EVENTS.BOSS_FIGHT_WIN, { minutes: 45 })[0].isCompleted, true);
    assert.equal(applyQuestEvent(qs, QUEST_EVENTS.EXERCISES_LOGGED, { count: 5 })[1].currentProgress, 5);
    assert.equal(applyQuestEvent(qs, QUEST_EVENTS.DAY_CLOSED)[2].isCompleted, true);
  });

  test('il progresso non supera l’obiettivo e una missione completata non si muove più', () => {
    const [q] = applyQuestEvent([quest(QUEST_TYPE.FOCUS_MINUTES, 60)], QUEST_EVENTS.FOCUS_SESSION, { minutes: 500 });
    assert.equal(q.currentProgress, 60);
    assert.equal(q.isCompleted, true);
    assert.equal(applyQuestEvent([q], QUEST_EVENTS.FOCUS_SESSION, { minutes: 5 })[0], q);
    assert.deepEqual(applyQuestEvent([], QUEST_EVENTS.FOCUS_SESSION, {}), []);
  });
});
