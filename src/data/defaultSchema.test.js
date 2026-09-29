// =====================================================================
// ArachnoForge — src/data/defaultSchema.test.js (V41, V42)
// hydrateState davanti a dati sporchi (backup modificati a mano, import).
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateState, createDefaultState, sanitizeSettings, normalizeTomorrowPlan, SCHEMA_VERSION } from './defaultSchema.js';
import { xpRequiredForLevelV1, computeTotalBankedXp, XP_CURVE_VERSION } from '../utils/xpEngine.js';

describe('hydrateState — robustezza', () => {
  test('voci null o non oggetti nelle materie e negli argomenti non fermano l’avvio', () => {
    const h = hydrateState({
      materie: [null, 'x', [1], { id: 'm1', nome: 'Aerodinamica', sfide: [null, 5, { id: 's1', nome: 'Strato limite', parentId: null }] }]
    });
    assert.equal(h.materie.length, 1);
    assert.equal(h.materie[0].sfide.length, 1);
    assert.equal(h.materie[0].sfide[0].id, 's1');
  });
  test('id mancanti e doppi diventano unici, in modo deterministico', () => {
    const raw = {
      materie: [
        { id: 'm1', nome: 'A', sfide: [{ id: 'x', nome: 'X', parentId: null }, { id: 'x', nome: 'Y', parentId: null }, { nome: 'Z', parentId: null }] },
        { id: 'm1', nome: 'B', sfide: [] },
        { nome: 'C', sfide: [] }
      ]
    };
    const a = hydrateState(raw);
    const b = hydrateState(raw);
    assert.deepEqual(a.materie.map((m) => m.id), b.materie.map((m) => m.id));
    assert.equal(new Set(a.materie.map((m) => m.id)).size, 3);
    assert.equal(new Set(a.materie[0].sfide.map((s) => s.id)).size, 3);
    assert.equal(a.materie[0].sfide[0].id, 'x', 'il primo resta com’era');
  });
  test('un id generato non ruba mai quello valido di un’altra voce', () => {
    const h = hydrateState({ materie: [{ nome: 'Senza id', sfide: [] }, { id: 'materia-0', nome: 'Vera', sfide: [] }] });
    assert.equal(h.materie[1].id, 'materia-0');
    assert.notEqual(h.materie[0].id, 'materia-0');
  });
  test('un id valido resta identico, anche nel tipo', () => {
    const h = hydrateState({ materie: [{ id: 1234, nome: 'Legacy', sfide: [] }] });
    assert.equal(h.materie[0].id, 1234);
  });
  test('nomi vuoti ricevono un segnaposto leggibile', () => {
    const h = hydrateState({ materie: [{ id: 'm', nome: '  ', sfide: [{ id: 's', nome: '', parentId: null }] }] });
    assert.equal(h.materie[0].nome, 'Materia senza nome');
    assert.equal(h.materie[0].sfide[0].nome, 'Argomento senza nome');
  });
  test('le lezioni seguono le materie davvero caricate', () => {
    const base = createDefaultState();
    const h = hydrateState({
      ...base,
      materie: [{ id: 'm1', nome: 'A', sfide: [] }],
      campus: {
        ...base.campus,
        semestri: [
          {
            id: 'sem1',
            nome: 'Primo',
            inizio: '2026-09-21',
            fine: '2026-12-20',
            sospensioni: [],
            lezioni: [
              { id: 'l1', materiaId: 'm1', giorno: 1, inizio: '09:00', fine: '11:00' },
              { id: 'l2', materiaId: 'fantasma', giorno: 2, inizio: '09:00', fine: '11:00' }
            ]
          }
        ]
      }
    });
    const lezioni = h.campus.semestri[0].lezioni.map((l) => l.id);
    assert.deepEqual(lezioni, ['l1']);
  });
  test('stato assente: default', () => {
    assert.deepEqual(Object.keys(hydrateState(null)).sort(), Object.keys(createDefaultState()).sort());
  });
});

describe('V42 — migrazione allo schema 13', () => {
  test('la versione dello schema viene aggiornata', () => {
    assert.equal(hydrateState({ metadata: { version: '12.0.0' } }).metadata.version, SCHEMA_VERSION);
  });

  test('curva dei livelli: conversione una tantum sugli XP totali, con un messaggio nel registro', () => {
    let totaleV1 = 500;
    for (let L = 1; L < 10; L += 1) totaleV1 += xpRequiredForLevelV1(L);
    const h = hydrateState({ profile: { level: 10, currentXp: 500, techTokens: 2 } });
    assert.equal(h.profile.xpCurveVersion, XP_CURVE_VERSION);
    assert.equal(computeTotalBankedXp(h.profile), totaleV1, 'nessun XP perso');
    assert.ok(h.profile.level >= 10);
    assert.ok(h.combatLog.some((e) => /Curva dei livelli ribilanciata/.test(e.message)));
    // Una seconda idratazione non converte di nuovo.
    const diNuovo = hydrateState(h);
    assert.equal(diNuovo.profile.level, h.profile.level);
    assert.equal(diNuovo.profile.techTokens, h.profile.techTokens);
  });

  test('una materia con la sola data d’esame riceve il suo appello', () => {
    const h = hydrateState({ materie: [{ id: 'm1', nome: 'Analisi 1', examDate: '2027-01-20', oralDate: '2027-01-27', sfide: [] }] });
    const m = h.materie[0];
    assert.equal(m.appelli.length, 1);
    assert.equal(m.appelli[0].scritto, '2027-01-20');
    assert.equal(m.appelli[0].orale, '2027-01-27');
    assert.equal(m.appelloTargetId, m.appelli[0].id);
    assert.equal(m.examDate, '2027-01-20');
  });

  test('un argomento completato pre-V42 riceve lo stato di memoria FSRS', () => {
    const h = hydrateState({
      materie: [{ id: 'm1', nome: 'A', sfide: [{ id: 's1', nome: 'X', parentId: null, status: 'COMPLETED', srsIntervalDays: 14, srsEase: 2.3, nextReviewDate: '2026-10-20' }] }]
    });
    const s = h.materie[0].sfide[0];
    assert.equal(s.srsStability, 14);
    assert.ok(s.srsDifficulty >= 1 && s.srsDifficulty <= 10);
    assert.equal(s.lastReviewedAt.slice(0, 10), '2026-10-06');
  });

  test('i minuti su una materia senza argomenti si ricostruiscono dallo Star Log, una volta', () => {
    const h = hydrateState({
      materie: [{ id: 'm1', nome: 'Inglese', sfide: [] }],
      starLog: [
        { type: 'FOCUS_SESSION', materiaId: 'm1', minutes: 40, dateKey: '2026-10-01' },
        { type: 'FOCUS_SESSION', materiaId: 'm1', minutes: 25, dateKey: '2026-10-02' },
        { type: 'FOCUS_SESSION', materiaId: 'altra', minutes: 90, dateKey: '2026-10-02' }
      ]
    });
    assert.equal(h.materie[0].focusMinutesLibere, 65);
  });

  test('impostazioni del piano sempre sensate', () => {
    const s = sanitizeSettings({ giorniRiposo: [7, 7, '6', 9, 1, 2], capacitaManuale: 3.3, streakRiposiSettimana: 5, annoImmatricolazione: 1850, chiusuraOra: 3, erasmus: 'sì' });
    assert.deepEqual(s.giorniRiposo, [7, 6, 1]);
    assert.equal(s.capacitaManuale, 3.25, 'al quarto d’ora');
    assert.equal(s.streakRiposiSettimana, 2);
    assert.equal(s.annoImmatricolazione, null);
    assert.equal(s.chiusuraOra, 19);
    assert.equal(s.erasmus, false);
    assert.equal(sanitizeSettings({ capacitaManuale: 40 }).capacitaManuale, null);
    assert.equal(hydrateState({ settings: { capacitaManuale: 5 } }).settings.capacitaManuale, 5);
  });

  test('il piano di domani e le giornate chiuse arrivano puliti', () => {
    assert.equal(normalizeTomorrowPlan({ dateKey: 'boh' }), null);
    const p = normalizeTomorrowPlan({
      dateKey: '2026-10-06',
      oraInizio: '9:00',
      items: [{ materiaId: 'm1', minuti: 9999 }, { nope: true }],
      primoBlocco: { materiaId: 'm1', minuti: 1, modo: 'STUDIO' },
      nota: 'x'.repeat(500)
    });
    assert.equal(p.oraInizio, null, 'orario non valido');
    assert.deepEqual(p.items, [{ materiaId: 'm1', sfidaId: null, minuti: 600, modo: null }]);
    assert.equal(p.primoBlocco.minuti, 5);
    assert.equal(p.nota.length, 280);
    const h = hydrateState({ dayClosures: [{ dateKey: '2026-10-05', minuti: 120, obiettivoMin: 240, energia: 9 }, { dateKey: 'x' }] });
    assert.deepEqual(h.dayClosures, [{ dateKey: '2026-10-05', minuti: 120, obiettivoMin: 240, energia: null, nota: '' }]);
    assert.equal(hydrateState({ karenWeekly: { payload: {} } }).karenWeekly, null, 'senza settimana non vale');
  });
});

describe('V42 — contatori del profilo e liste davanti a dati corrotti', () => {
  test('un contatore non numerico, negativo o infinito torna al default; un numero scritto come testo vale', () => {
    const h = hydrateState({
      profile: { level: null, currentXp: 'boh', streak: -3, stamina: 250, overdriveCount: '4', reviewsCompleted: Infinity, xpCurveVersion: 2 }
    });
    assert.equal(h.profile.level, 1);
    assert.equal(h.profile.currentXp, 0);
    assert.equal(h.profile.streak, 0);
    assert.equal(h.profile.stamina, 100, 'la Stamina non supera 100');
    assert.equal(h.profile.overdriveCount, 4);
    assert.equal(h.profile.reviewsCompleted, 0);
    Object.entries(h.profile).forEach(([k, v]) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} non finito`);
    });
  });

  test('voci nulle nelle liste (premi, inventario, trofei, missioni) spariscono', () => {
    const h = hydrateState({
      shopRewards: [null, { id: 'r1', nome: 'Pizza', costoXp: 100 }],
      inventory: ['x', { id: 'i1', rewardId: 'r1', nome: 'Pizza', quantity: 1 }],
      trophies: [null, { id: 't1' }],
      quickQuests: [null],
      dailyPatrols: { dateKey: '2026-09-29', quests: [null, { id: 'q1' }, { id: 'q2', type: 'FOCUS_MINUTES', targetAmount: 60, currentProgress: 0 }] }
    });
    assert.deepEqual(h.shopRewards.map((r) => r.id), ['r1']);
    assert.deepEqual(h.inventory.map((r) => r.id), ['i1']);
    assert.deepEqual(h.trophies.map((r) => r.id), ['t1']);
    assert.ok(h.quickQuests.length > 0, 'senza voci valide tornano quelle di default');
    assert.deepEqual(h.dailyPatrols.quests.map((q) => q.id), ['q2']);
  });
});
