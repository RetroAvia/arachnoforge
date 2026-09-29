// =====================================================================
// ArachnoForge — src/utils/streakEngine.js (V42)
// LA SERIE DI STUDIO, con i giorni di riposo.
//
// Fino alla V41 la streak contava i giorni di CALENDARIO consecutivi con
// una qualsiasi attività: un minuto di Focus la teneva viva, una domenica
// di riposo la azzerava (scudi: uno al mese). Simulazione di 8 settimane
// con le domeniche libere: 5 azzeramenti, il bonus ×1.2 attivo solo 2
// settimane, i traguardi da 14/30/60/100 giorni irraggiungibili. Premiava
// l'attività finta e puniva il riposo, cioè il contrario di ciò che serve
// a chi deve reggere una sessione d'esami.
//
// Ora:
//  - un giorno conta solo se ha almeno STREAK_DAY_MIN_MINUTES minuti di
//    Focus (25: un blocco vero);
//  - ogni settimana (lun-dom) concede fino a N giorni di riposo (default
//    2, impostabile) che NON spezzano la serie: "5 giorni su 7";
//  - la serie conta i GIORNI DI STUDIO della catena (i riposi non la
//    allungano, non la azzerano);
//  - gli Streak Shield coprono solo i giorni saltati OLTRE il riposo
//    concesso.
// =====================================================================
import { addDaysToDateOnly, daysBetweenDateKeys, mondayOfDateKey, todayDateOnlyKey, getDateKey } from './dateUtils.js';

export const STREAK_DAY_MIN_MINUTES = 25;
export const DEFAULT_REST_DAYS_PER_WEEK = 2;
export const MAX_REST_DAYS_PER_WEEK = 3;

export function restAllowance(settings) {
  const n = Number(settings?.streakRiposiSettimana);
  return Number.isInteger(n) && n >= 0 && n <= MAX_REST_DAYS_PER_WEEK ? n : DEFAULT_REST_DAYS_PER_WEEK;
}

function keyOf(iso) {
  if (typeof iso !== 'string' || iso.length < 10) return null;
  // `lastActiveDate` è un istante ISO: la chiave del giorno è quella LOCALE.
  const k = iso.length === 10 ? iso : getDateKey(iso);
  return /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null;
}

/** Giorni saltati fra `fromKey` (escluso) e `toKey` (escluso), divisi per settimana. */
function missesByWeek(fromKey, toKey) {
  const out = new Map();
  for (let d = addDaysToDateOnly(fromKey, 1); d < toKey; d = addDaysToDateOnly(d, 1)) {
    const w = mondayOfDateKey(d);
    out.set(w, (out.get(w) || 0) + 1);
  }
  return out;
}

/**
 * Oggi è diventato un giorno valido: aggiorna la serie.
 * @returns {{patch:object, event:'PRIMO'|'CONTINUA'|'RIPOSO'|'SCUDO'|'RESET'|'GIA'|'OROLOGIO', shieldsUsed:number, missed:number}}
 */
export function advanceStreak(profile, todayKey = todayDateOnlyKey(), { restDaysPerWeek = DEFAULT_REST_DAYS_PER_WEEK, nowIso = null } = {}) {
  const now = nowIso || new Date().toISOString();
  const prevKey = keyOf(profile?.lastActiveDate);
  const streak = Number.isFinite(profile?.streak) ? profile.streak : 0;
  const settimana = mondayOfDateKey(todayKey);
  const base = { lastActiveDate: now, streakWeekKey: settimana };

  if (prevKey === todayKey && streak > 0) return { patch: {}, event: 'GIA', shieldsUsed: 0, missed: 0 };
  if (!prevKey || streak <= 0) {
    return { patch: { ...base, streak: 1, streakWeekMisses: 0 }, event: 'PRIMO', shieldsUsed: 0, missed: 0 };
  }
  const gap = daysBetweenDateKeys(prevKey, todayKey);
  if (gap == null || gap <= 0) {
    // Orologio indietro o data illeggibile: non è colpa tua, non si tocca la serie.
    return { patch: { lastActiveDate: now }, event: 'OROLOGIO', shieldsUsed: 0, missed: 0 };
  }

  const perSettimana = missesByWeek(prevKey, todayKey);
  const settimanaPrec = mondayOfDateKey(prevKey);
  const giaUsati = profile?.streakWeekKey === settimanaPrec ? Math.max(0, Number(profile?.streakWeekMisses) || 0) : 0;
  let eccesso = 0;
  let missed = 0;
  perSettimana.forEach((n, w) => {
    missed += n;
    const usati = w === settimanaPrec ? giaUsati : 0;
    eccesso += Math.max(0, usati + n - restDaysPerWeek) - Math.max(0, usati - restDaysPerWeek);
  });
  const missQuestaSettimana = (perSettimana.get(settimana) || 0) + (settimana === settimanaPrec ? giaUsati : 0);

  if (eccesso === 0) {
    return {
      patch: { ...base, streak: streak + 1, streakWeekMisses: missQuestaSettimana },
      event: missed > 0 ? 'RIPOSO' : 'CONTINUA',
      shieldsUsed: 0,
      missed
    };
  }
  const scudi = Number.isFinite(profile?.streakShields) ? profile.streakShields : 0;
  if (scudi >= eccesso) {
    return {
      patch: {
        ...base,
        streak: streak + 1,
        streakWeekMisses: missQuestaSettimana,
        streakShields: scudi - eccesso,
        streakShieldsUsedTotal: (Number.isFinite(profile?.streakShieldsUsedTotal) ? profile.streakShieldsUsedTotal : 0) + eccesso
      },
      event: 'SCUDO',
      shieldsUsed: eccesso,
      missed
    };
  }
  return { patch: { ...base, streak: 1, streakWeekMisses: 0 }, event: 'RESET', shieldsUsed: 0, missed };
}

/**
 * Lo stato della serie OGGI, per la UI: se oggi conta già, quanti minuti
 * mancano, quanti riposi restano questa settimana e se saltare oggi la
 * spezzerebbe.
 */
export function streakStatus(profile, { todayKey = todayDateOnlyKey(), todayMinutes = 0, restDaysPerWeek = DEFAULT_REST_DAYS_PER_WEEK } = {}) {
  const streak = Number.isFinite(profile?.streak) ? profile.streak : 0;
  const prevKey = keyOf(profile?.lastActiveDate);
  const minuti = Math.max(0, Math.round(Number(todayMinutes) || 0));
  const valida = minuti >= STREAK_DAY_MIN_MINUTES || (prevKey === todayKey && streak > 0);
  const settimana = mondayOfDateKey(todayKey);
  const scudi = Number.isFinite(profile?.streakShields) ? profile.streakShields : 0;

  // Riposi già usati in questa settimana (giorni saltati da lunedì a ieri
  // dentro la catena).
  let usati = 0;
  let viva = streak > 0 && !!prevKey;
  if (viva && prevKey < todayKey) {
    const perSettimana = missesByWeek(prevKey, todayKey);
    const settimanaPrec = mondayOfDateKey(prevKey);
    const giaUsati = profile?.streakWeekKey === settimanaPrec ? Math.max(0, Number(profile?.streakWeekMisses) || 0) : 0;
    let eccesso = 0;
    perSettimana.forEach((n, w) => {
      const u = w === settimanaPrec ? giaUsati : 0;
      eccesso += Math.max(0, u + n - restDaysPerWeek) - Math.max(0, u - restDaysPerWeek);
    });
    usati = (perSettimana.get(settimana) || 0) + (settimana === settimanaPrec ? giaUsati : 0);
    if (eccesso > scudi) viva = false;
  } else if (viva && prevKey === todayKey) {
    usati = profile?.streakWeekKey === settimana ? Math.max(0, Number(profile?.streakWeekMisses) || 0) : 0;
  }
  const riposiRimasti = Math.max(0, restDaysPerWeek - usati);
  // Se oggi resta vuoto: basta un riposo avanzato (o uno scudo) a salvarla?
  const aRischio = viva && !valida && riposiRimasti === 0;
  return {
    streak: viva ? streak : 0,
    streakSalvata: streak,
    viva,
    validaOggi: valida,
    minutiOggi: minuti,
    minutiMancanti: valida ? 0 : Math.max(0, STREAK_DAY_MIN_MINUTES - minuti),
    riposiUsati: Math.min(usati, restDaysPerWeek),
    riposiRimasti,
    riposiSettimana: restDaysPerWeek,
    aRischio,
    scudi,
    // Da domani, se oggi resta vuoto e non avanzano riposi: consuma uno
    // scudo (se c'è) o la serie riparte.
    coperturaScudo: aRischio && scudi > 0
  };
}
