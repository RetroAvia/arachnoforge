// =====================================================================
// ArachnoForge — src/services/karenEngine/planContext.test.js (V42)
// Il piano di oggi e la settimana, nella forma che karen-oracle riceve
// (e che il server poi valida: vedi supabase/functions/karen-oracle).
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildKarenPlanContext, PLAN_CONTEXT_VERSION } from './planContext.js';
import { buildWeeklyContext } from './weeklyContext.js';

const OGGI = '2026-10-07'; // mercoledì
const IERI = '2026-10-06';

const materie = [
  { id: 'analisi', nome: 'Analisi 1', formatoEsame: 'SCRITTO_ORALE', examDate: '2026-10-20', oralDate: '2026-10-27' },
  { id: 'fisica', nome: 'Fisica 1', formatoEsame: 'SOLO_ORALE', examDate: '2026-11-10' }
];

const planToday = {
  capacityHours: 4.5,
  targetHours: 4.25,
  doneHours: 1,
  overCapacity: false,
  deficitHours: 0,
  monotaskActive: false,
  subjects: [
    {
      materiaId: 'analisi',
      examDate: '2026-10-20',
      daysRemaining: 13,
      todayTargetHours: 3.333,
      todayMinHours: 1.2,
      doneTodayHours: 1,
      todaySintesiHours: 0,
      todayStudioHours: 3.333,
      todayFinalReviewHours: 0,
      status: 'ATTENZIONE',
      lateHours: 0,
      finePrevistaDateKey: '2026-10-18',
      chiusuraAppuntiDateKey: null
    }
  ],
  reviews: { due: 3, done: 1, targetCount: 2, rinviati: 1 },
  lessons: { riservateOre: 0.5, prima: true }
};

const quotas = [
  { materiaId: 'analisi', status: 'ATTENZIONE' },
  { materiaId: 'fisica', examDate: '2026-11-10', daysRemaining: 34, status: 'OTTIMALE', frozen: false, hoursRemaining: 40.456, inizioEntroDateKey: '2026-10-25' }
];

describe('buildKarenPlanContext', () => {
  test('il piano di oggi: capacità, obiettivo, materie di oggi e le altre', () => {
    const c = buildKarenPlanContext({ planToday, quotas, materie, campus: { fase: 'LEZIONI', coda: [{ materiaId: 'fisica', lezioniDaSistemare: 2 }] }, todayKey: OGGI });
    assert.equal(c.v, PLAN_CONTEXT_VERSION);
    assert.equal(c.date, OGGI);
    assert.equal(c.fase, 'LEZIONI');
    assert.equal(c.capacity_hours, 4.5);
    assert.equal(c.subjects_today.length, 1);
    const a = c.subjects_today[0];
    assert.equal(a.materia_id, 'analisi');
    assert.equal(a.target_hours, 3.33, 'ore arrotondate al centesimo');
    assert.equal(a.prova, 'SCRITTO');
    assert.equal(a.formato, 'Scritto + orale');
    assert.equal(a.fine_prevista, '2026-10-18');
    // Le altre materie: mai quelle già fra le materie di oggi.
    assert.deepEqual(c.other_subjects.map((o) => o.materia_id), ['fisica']);
    assert.equal(c.other_subjects[0].hours_remaining, 40.46);
    assert.deepEqual(c.reviews, { due: 3, done: 1, target: 2, postponed: 1 });
    assert.deepEqual(c.lessons, { reserved_hours: 0.5, first: true, queue: [{ materia_id: 'fisica', lessons: 2 }] });
  });

  test('ieri: minuti per materia, modi di lavoro e argomenti (solo id: i nomi li mette il server)', () => {
    const starLog = [
      { type: 'FOCUS_SESSION', dateKey: IERI, minutes: 50, materiaId: 'analisi', sfidaId: 's1', workMode: 'STUDIO' },
      { type: 'FOCUS_SESSION', dateKey: IERI, minutes: 25, materiaId: 'analisi', sfidaId: 's2', workMode: 'RIPASSO' },
      { type: 'FOCUS_SESSION', dateKey: IERI, minutes: 30, materiaId: null },
      { type: 'FOCUS_SESSION', dateKey: OGGI, minutes: 60, materiaId: 'fisica' },
      { type: 'FOCUS_MINUTES', dateKey: IERI, minutes: 105 }
    ];
    const c = buildKarenPlanContext({ planToday, quotas, materie, starLog, todayKey: OGGI });
    assert.equal(c.yesterday.minutes, 105);
    assert.deepEqual(c.yesterday.by_materia, [{ materia_id: 'analisi', minutes: 75, modes: ['STUDIO', 'RIPASSO'], sfida_ids: ['s1', 's2'] }]);
    assert.equal(JSON.stringify(c).includes('Analisi 1'), false, 'nessun nome nel contesto');
  });

  test('la serie di studio, e il periodo di sessione quando non ci sono lezioni', () => {
    const c = buildKarenPlanContext({ planToday, quotas, materie, streak: { streak: 12, validaOggi: true, riposiRimasti: 1 }, todayKey: OGGI });
    assert.deepEqual(c.streak, { days: 12, valid_today: true, rest_left: 1 });
    assert.equal(c.fase, 'SESSIONE');
  });

  test('senza piano o senza data: nessun contesto', () => {
    assert.equal(buildKarenPlanContext({ planToday: null, todayKey: OGGI }), null);
    assert.equal(buildKarenPlanContext({ planToday, todayKey: null }), null);
  });
});

describe('buildWeeklyContext', () => {
  const LUNEDI = '2026-10-05';
  const starLog = [
    { type: 'FOCUS_SESSION', dateKey: LUNEDI, minutes: 60, materiaId: 'analisi', workMode: 'STUDIO' },
    { type: 'FOCUS_SESSION', dateKey: '2026-10-06', minutes: 30, materiaId: 'analisi', workMode: 'SINTESI' },
    { type: 'FOCUS_SESSION', dateKey: '2026-10-06', minutes: 45, materiaId: 'fisica', simulazione: true, workMode: 'ESERCIZI' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-30', minutes: 200, materiaId: 'fisica', workMode: 'STUDIO' },
    { type: 'FOCUS_SESSION', dateKey: '2026-10-08', minutes: 90, materiaId: 'fisica', workMode: 'STUDIO' }
  ];
  const materieConStorico = [
    {
      id: 'analisi',
      sfide: [
        {
          ripassi: [{ at: '2026-10-06T09:00:00.000Z', voto: 'MEDIUM' }, { at: '2026-10-06T10:00:00.000Z', voto: 'AGAIN' }, { at: '2026-09-29T10:00:00.000Z', voto: 'EASY' }],
          esercizi: [{ at: LUNEDI, fatti: 6, corretti: 4 }]
        }
      ]
    }
  ];

  test('solo i giorni della settimana fino a oggi, con minuti, obiettivi ed energia delle giornate chiuse', () => {
    const w = buildWeeklyContext({
      weekKey: LUNEDI,
      starLog,
      dayClosures: [{ dateKey: LUNEDI, obiettivoMin: 240, energia: 4 }, { dateKey: '2026-09-28', obiettivoMin: 999 }],
      materie: materieConStorico,
      todayKey: OGGI
    });
    assert.equal(w.week, LUNEDI);
    assert.deepEqual(w.days.map((d) => d.date), [LUNEDI, '2026-10-06', OGGI]);
    assert.deepEqual(w.days[0], { date: LUNEDI, minutes: 60, target_minutes: 240, energy: 4, closed: true });
    assert.equal(w.days[1].closed, false);
    assert.equal(w.total_minutes, 135, 'le sessioni fuori dalla settimana (o dopo oggi) non contano');
    assert.equal(w.target_minutes_closed_days, 240);
  });

  test('per materia, per modo di lavoro; simulazioni a parte; ripassi ed esercizi della settimana', () => {
    const w = buildWeeklyContext({ weekKey: LUNEDI, starLog, materie: materieConStorico, todayKey: OGGI });
    assert.deepEqual(w.by_materia, [
      { materia_id: 'analisi', minutes: 90, modes: { STUDIO: 60, SINTESI: 30 } },
      { materia_id: 'fisica', minutes: 45, modes: { SIMULAZIONE: 45 } }
    ]);
    assert.equal(w.simulations, 1);
    assert.deepEqual(w.reviews, { count: 2, ratings: { AGAIN: 1, HARD: 0, MEDIUM: 1, EASY: 0 } });
    assert.deepEqual(w.exercises, { done: 6, correct: 4 });
  });

  test('esami in arrivo (entro 45 giorni, non congelati) e serie', () => {
    const w = buildWeeklyContext({
      weekKey: LUNEDI,
      starLog,
      materie: materieConStorico,
      quotas: [
        { materiaId: 'analisi', daysRemaining: 13, status: 'ATTENZIONE', lateHours: 1.234 },
        { materiaId: 'fisica', daysRemaining: 90, status: 'OTTIMALE' },
        { materiaId: 'chimica', daysRemaining: 5, status: 'CONGELATA', frozen: true }
      ],
      streak: { streak: 9, riposiUsati: 1, riposiSettimana: 2 },
      todayKey: OGGI
    });
    assert.deepEqual(w.upcoming, [{ materia_id: 'analisi', days_to_exam: 13, status: 'ATTENZIONE', late_hours: 1.2 }]);
    assert.deepEqual(w.streak, { days: 9, rest_used: 1, rest_allowed: 2 });
  });
});
