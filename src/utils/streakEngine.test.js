// =====================================================================
// ArachnoForge — src/utils/streakEngine.test.js (V42)
// La serie di studio: giorni validi (≥ 25 minuti), giorni di riposo per
// settimana che non la spezzano, Streak Shield solo oltre il riposo.
// Date fisse: il 5 ottobre 2026 è un lunedì.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { advanceStreak, streakStatus, restAllowance, STREAK_DAY_MIN_MINUTES, DEFAULT_REST_DAYS_PER_WEEK, MAX_REST_DAYS_PER_WEEK } from './streakEngine.js';

const LUN = '2026-10-05';
const MAR = '2026-10-06';
const MER = '2026-10-07';
const GIO = '2026-10-08';
const VEN = '2026-10-09';
const DOM = '2026-10-11';
const LUN2 = '2026-10-12';
/** Un istante a mezzogiorno locale del giorno indicato (la chiave locale resta quella). */
const alle12 = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
};
const profilo = (over = {}) => ({ streak: 0, lastActiveDate: null, streakShields: 0, ...over });

describe('restAllowance', () => {
  test('default 2 giorni di riposo a settimana, impostabile fino a 3', () => {
    assert.equal(restAllowance({}), DEFAULT_REST_DAYS_PER_WEEK);
    assert.equal(restAllowance({ streakRiposiSettimana: 0 }), 0);
    assert.equal(restAllowance({ streakRiposiSettimana: 3 }), 3);
    assert.equal(restAllowance({ streakRiposiSettimana: MAX_REST_DAYS_PER_WEEK + 1 }), DEFAULT_REST_DAYS_PER_WEEK);
    assert.equal(restAllowance({ streakRiposiSettimana: 1.5 }), DEFAULT_REST_DAYS_PER_WEEK);
  });
});

describe('advanceStreak', () => {
  test('il primo giorno valido apre la serie', () => {
    const r = advanceStreak(profilo(), LUN, { nowIso: alle12(LUN) });
    assert.equal(r.event, 'PRIMO');
    assert.equal(r.patch.streak, 1);
    assert.equal(r.patch.streakWeekKey, LUN);
  });

  test('un giorno dopo l’altro: la serie cresce di uno', () => {
    const r = advanceStreak(profilo({ streak: 4, lastActiveDate: alle12(LUN) }), MAR, { nowIso: alle12(MAR) });
    assert.equal(r.event, 'CONTINUA');
    assert.equal(r.patch.streak, 5);
    assert.equal(r.missed, 0);
  });

  test('lo stesso giorno due volte non conta due volte', () => {
    const r = advanceStreak(profilo({ streak: 4, lastActiveDate: alle12(LUN) }), LUN);
    assert.equal(r.event, 'GIA');
    assert.deepEqual(r.patch, {});
  });

  test('i giorni saltati dentro il riposo della settimana non spezzano la serie e non la allungano', () => {
    // Lunedì, poi giovedì: martedì e mercoledì sono i due riposi della settimana.
    const r = advanceStreak(profilo({ streak: 3, lastActiveDate: alle12(LUN) }), GIO, { nowIso: alle12(GIO) });
    assert.equal(r.event, 'RIPOSO');
    assert.equal(r.patch.streak, 4, 'conta i giorni di STUDIO della catena');
    assert.equal(r.missed, 2);
    assert.equal(r.patch.streakWeekMisses, 2);
  });

  test('oltre il riposo concesso serve uno scudo per ogni giorno in più', () => {
    // Lunedì, poi venerdì: tre giorni saltati, due di riposo, uno scudo.
    const conScudo = advanceStreak(profilo({ streak: 3, lastActiveDate: alle12(LUN), streakShields: 1 }), VEN, { nowIso: alle12(VEN) });
    assert.equal(conScudo.event, 'SCUDO');
    assert.equal(conScudo.shieldsUsed, 1);
    assert.equal(conScudo.patch.streak, 4);
    assert.equal(conScudo.patch.streakShields, 0);
    assert.equal(conScudo.patch.streakShieldsUsedTotal, 1);
    const senza = advanceStreak(profilo({ streak: 3, lastActiveDate: alle12(LUN), streakShields: 0 }), VEN, { nowIso: alle12(VEN) });
    assert.equal(senza.event, 'RESET');
    assert.equal(senza.patch.streak, 1);
  });

  test('i riposi si contano per settimana: quelli già usati non si recuperano, la settimana nuova ne ha di nuovi', () => {
    // Settimana 1: saltati martedì e mercoledì (riposi finiti), studio giovedì.
    const gio = advanceStreak(profilo({ streak: 3, lastActiveDate: alle12(LUN) }), GIO, { nowIso: alle12(GIO) });
    const dopoGio = { streak: gio.patch.streak, lastActiveDate: gio.patch.lastActiveDate, streakWeekKey: gio.patch.streakWeekKey, streakWeekMisses: gio.patch.streakWeekMisses, streakShields: 0 };
    // Salto venerdì: sarebbe il terzo riposo della settimana -> senza scudi riparte.
    assert.equal(advanceStreak(dopoGio, '2026-10-10', { nowIso: alle12('2026-10-10') }).event, 'RESET');
    // Invece: studio sabato e domenica, poi salto lunedì 12 (settimana nuova), studio martedì 13.
    const dom = advanceStreak({ ...dopoGio, lastActiveDate: alle12(DOM), streak: 6 }, DOM);
    assert.equal(dom.event, 'GIA');
    const mar2 = advanceStreak({ ...dopoGio, lastActiveDate: alle12(DOM), streak: 6 }, '2026-10-13', { nowIso: alle12('2026-10-13') });
    assert.equal(mar2.event, 'RIPOSO');
    assert.equal(mar2.patch.streak, 7);
    assert.equal(mar2.patch.streakWeekKey, LUN2);
    assert.equal(mar2.patch.streakWeekMisses, 1);
  });

  test('con i riposi a zero ogni giorno saltato chiede uno scudo', () => {
    const r = advanceStreak(profilo({ streak: 10, lastActiveDate: alle12(LUN), streakShields: 2 }), MER, { restDaysPerWeek: 0, nowIso: alle12(MER) });
    assert.equal(r.event, 'SCUDO');
    assert.equal(r.shieldsUsed, 1);
  });

  test('un orologio che torna indietro non tocca la serie', () => {
    const r = advanceStreak(profilo({ streak: 40, lastActiveDate: alle12(VEN) }), MAR, { nowIso: alle12(MAR) });
    assert.equal(r.event, 'OROLOGIO');
    assert.equal(r.patch.streak, undefined);
  });
});

describe('streakStatus — la serie oggi, per l’interfaccia', () => {
  test(`oggi conta dai ${STREAK_DAY_MIN_MINUTES} minuti: prima dice quanti ne mancano`, () => {
    const s = streakStatus(profilo({ streak: 5, lastActiveDate: alle12(LUN) }), { todayKey: MAR, todayMinutes: 10 });
    assert.equal(s.validaOggi, false);
    assert.equal(s.minutiMancanti, STREAK_DAY_MIN_MINUTES - 10);
    assert.equal(s.viva, true);
    assert.equal(s.streak, 5);
    const piena = streakStatus(profilo({ streak: 5, lastActiveDate: alle12(LUN) }), { todayKey: MAR, todayMinutes: 30 });
    assert.equal(piena.validaOggi, true);
    assert.equal(piena.minutiMancanti, 0);
  });

  test('riposi rimasti nella settimana e rischio di spezzarla', () => {
    // Ultimo giorno valido lunedì; oggi giovedì: martedì e mercoledì già di riposo.
    const s = streakStatus(profilo({ streak: 5, lastActiveDate: alle12(LUN) }), { todayKey: GIO, todayMinutes: 0 });
    assert.equal(s.riposiUsati, 2);
    assert.equal(s.riposiRimasti, 0);
    assert.equal(s.aRischio, true, 'se oggi resta vuoto, la serie si spezza');
    assert.equal(s.coperturaScudo, false);
    const conScudo = streakStatus(profilo({ streak: 5, lastActiveDate: alle12(LUN), streakShields: 1 }), { todayKey: GIO, todayMinutes: 0 });
    assert.equal(conScudo.coperturaScudo, true);
  });

  test('una serie già spezzata si mostra a zero (ma resta salvata finché non riparte)', () => {
    const s = streakStatus(profilo({ streak: 12, lastActiveDate: alle12(LUN) }), { todayKey: '2026-10-10', todayMinutes: 0 });
    assert.equal(s.viva, false);
    assert.equal(s.streak, 0);
    assert.equal(s.streakSalvata, 12);
  });
});
