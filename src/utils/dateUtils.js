export function nowIso() {
  return new Date().toISOString();
}

export function getDateKey(date = new Date()) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSameDay(isoA, isoB) {
  return getDateKey(isoA) === getDateKey(isoB);
}

/** Differenza in giorni fra due istanti ISO (timestamp reali, non date-only).
 * V37.0 — guardia esplicita: con un operando assente o non parsabile
 * (profilo importato a mano, campo azzerato) il calcolo produceva `NaN`,
 * che si propagava in silenzio nella logica di streak. Ora ritorna
 * `null`, che il chiamante può riconoscere. */
export function daysBetween(isoA, isoB) {
  const a = new Date(getDateKey(isoA)).getTime();
  const b = new Date(getDateKey(isoB)).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Ritorna true se, tra `lastResetIso` e adesso, è stata attraversata
 * la soglia delle 03:00 AM (reset giornaliero Stamina + Daily Protocols).
 */
export function crossedThreeAM(lastResetIso) {
  const last = new Date(lastResetIso);
  const now = new Date();
  const threshold = new Date(now);
  threshold.setHours(3, 0, 0, 0);
  if (now < threshold) {
    threshold.setDate(threshold.getDate() - 1);
  }
  // V37.0 — guardia: con `lastResetIso` nullo o corrotto `getTime()` dà
  // NaN, e `NaN < soglia` è sempre false — il reset giornaliero della
  // Stamina non sarebbe MAI scattato, senza alcun errore visibile.
  // Un timestamp illeggibile equivale a "mai fatto": si resetta.
  const lastMs = last.getTime();
  if (!Number.isFinite(lastMs)) return true;
  return lastMs < threshold.getTime();
}

export function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, expired: false };
}

export function formatClock(totalSeconds) {
  const m = Math.floor(Math.max(0, totalSeconds) / 60);
  const s = Math.max(0, totalSeconds) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Per istanti reali (timestamp completi con ora), es. unlockedAt, completionTimestamp. */
export function formatDateHuman(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTimeHuman(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ------------------------------------------------------------------ *
 * Date-only helpers — FIX Bug Timezone Shift (UTC assoluto).
 *
 * `materia.examDate` è un valore puramente calendariale ("YYYY-MM-DD",
 * lo stesso formato di <input type="date">), senza componente oraria.
 * Tutta l'aritmetica su questi valori avviene in UTC assoluto tramite
 * Date.UTC(): mai un new Date(stringa) ambiguo, mai un calcolo in
 * timezone locale che possa introdurre DST o shift di fuso. "Oggi" viene
 * letto in locale (è così che l'utente lo percepisce) ma poi la sua
 * chiave Y-M-D viene reinterpretata come UTC, esattamente come la data
 * esame salvata: stesso spazio di calcolo per entrambi gli operandi,
 * quindi zero drift, indipendentemente dal fuso orario del browser.
 * ------------------------------------------------------------------ */

export function dateOnlyToUtcMs(dateKey) {
  if (!dateKey) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

export function formatDateOnlyHuman(dateKey) {
  if (!dateKey) return '';
  const ms = dateOnlyToUtcMs(dateKey);
  return new Date(ms).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Giorni interi (arrotondati) fra "oggi" e una data-only target, calcolati interamente in UTC. */
export function daysUntilDateOnly(dateKey) {
  if (!dateKey) return null;
  const todayMs = dateOnlyToUtcMs(getDateKey(new Date()));
  const targetMs = dateOnlyToUtcMs(dateKey);
  return Math.round((targetMs - todayMs) / 86400000);
}

/**
 * Millisecondi mancanti all'inizio (mezzanotte LOCALE) del giorno
 * data-only target — per il countdown live del Doomsday Clock.
 *
 * V41 — prima contava fino alla mezzanotte UTC, cioè all'1:00 o alle 2:00
 * di notte in Italia: il conto alla rovescia sbagliava di una o due ore e
 * "Esame in corso" compariva nel cuore della notte. Qui, e solo qui,
 * serve l'ora locale: è un orologio da guardare, non un conteggio di
 * giorni (quelli restano in UTC assoluto, vedi sopra).
 */
export function msUntilDateOnlyMidnight(dateKey, now = Date.now()) {
  if (!dateKey) return null;
  const [y, m, d] = String(dateKey).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime() - now;
}

/** Somma N giorni (calendariali, UTC) a una data-only "YYYY-MM-DD", ritorna una nuova date-only key. */
export function addDaysToDateOnly(dateKey, days) {
  const ms = dateOnlyToUtcMs(dateKey) + days * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Data-only key di "oggi", nel senso di calendario UTC assoluto usato da questo modulo. */
export function todayDateOnlyKey() {
  return getDateKey(new Date());
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** V42 — "YYYY-MM-DD" ben formata e reale (niente 2026-02-31). */
export function isValidDateKey(v) {
  if (typeof v !== 'string' || !DATE_KEY_RE.test(v)) return false;
  const ms = dateOnlyToUtcMs(v);
  if (!Number.isFinite(ms)) return false;
  // Il round-trip scarta le date che Date.UTC "aggiusta" (31 febbraio -> 3 marzo).
  return addDaysToDateOnly(v, 0) === v;
}

/**
 * V43 — Il giorno LOCALE di un istante salvato come ISO (`toISOString`).
 * Tagliare i primi 10 caratteri dava il giorno UTC: un ripasso fatto alle
 * 00:30 in Italia finiva sul giorno prima. Una data-only "YYYY-MM-DD"
 * passa così com'è. Valore assente o illeggibile → null.
 */
export function localDateKeyOf(value) {
  if (typeof value !== 'string' || value.length < 10) return null;
  if (value.length === 10) return isValidDateKey(value) ? value : null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    const k = value.slice(0, 10);
    return isValidDateKey(k) ? k : null;
  }
  return getDateKey(new Date(ms));
}

/** V42 — Giorni interi da `fromKey` a `toKey` (positivo se `toKey` viene dopo). */
export function daysBetweenDateKeys(fromKey, toKey) {
  const a = dateOnlyToUtcMs(fromKey);
  const b = dateOnlyToUtcMs(toKey);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** V42 — Giorno della settimana ISO di una data-only: 1 = lunedì … 7 = domenica. */
export function isoWeekdayOfDateKey(dateKey) {
  const d = new Date(dateOnlyToUtcMs(dateKey)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** V42 — Il lunedì della settimana ISO che contiene `dateKey` (chiave della settimana). */
export function mondayOfDateKey(dateKey) {
  return addDaysToDateOnly(dateKey, -(isoWeekdayOfDateKey(dateKey) - 1));
}

/* ------------------------------------------------------------------ *
 * Star Log — Pagination temporale (V16.0, Pillar 5).
 * ------------------------------------------------------------------ */

/** Chiave "YYYY-MM" (mese solare, UTC) a partire da una date-only "YYYY-MM-DD" o un ISO timestamp completo. */
export function monthKeyFromDateKey(dateKey) {
  if (!dateKey) return null;
  return String(dateKey).slice(0, 7);
}

/** Chiave "YYYY-MM" del mese corrente, calendario UTC assoluto. */
export function currentMonthKey() {
  return monthKeyFromDateKey(todayDateOnlyKey());
}

/**
 * V20.0 — K.A.R.E.N. Auto-Router (Pillar 1): formatta un totale di ore
 * frazionarie (es. 2.25) in "2h 15m" leggibile per la Daily Quota HUD.
 * Arrotonda ai minuti interi, mai decimali sporchi mostrati all'utente.
 */
export function formatHoursMinutes(totalHours) {
  if (totalHours == null || !Number.isFinite(totalHours)) return '—';
  const safe = Math.max(0, totalHours);
  const totalMinutes = Math.round(safe * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * V27.0 — Pillar 4 (Daily Web-Sling): millisecondi residui alla mezzanotte
 * LOCALE del dispositivo (non UTC assoluto come le date-only degli esami:
 * il "giorno" del forziere è quello percepito dall'utente, coerente con
 * `getDateKey()` che usa già l'ora locale del browser).
 */
export function msUntilNextLocalMidnight(from = new Date()) {
  const now = new Date(from);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - now.getTime());
}

/** Etichetta umana "Luglio 2026" (capitalizzata) da una chiave "YYYY-MM". */
export function formatMonthYearHuman(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('it-IT', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * V42 — Data breve per il piano: "14 ott" (anno solo se diverso da quello
 * di `todayKey`). Calcolata in UTC come ogni data-only.
 */
export function formatDateShort(dateKey, todayKey = todayDateOnlyKey()) {
  if (!isValidDateKey(dateKey)) return '';
  const ms = dateOnlyToUtcMs(dateKey);
  const stessoAnno = typeof todayKey === 'string' && todayKey.slice(0, 4) === dateKey.slice(0, 4);
  return new Date(ms).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', ...(stessoAnno ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

/** V42 — "oggi", "domani", "dopodomani", altrimenti "mar 14 ott". */
export function formatDateRelative(dateKey, todayKey = todayDateOnlyKey()) {
  if (!isValidDateKey(dateKey)) return '';
  const diff = daysBetweenDateKeys(todayKey, dateKey);
  if (diff === 0) return 'oggi';
  if (diff === 1) return 'domani';
  if (diff === 2) return 'dopodomani';
  if (diff === -1) return 'ieri';
  const ms = dateOnlyToUtcMs(dateKey);
  const giorno = new Date(ms).toLocaleDateString('it-IT', { weekday: 'short', timeZone: 'UTC' });
  return `${giorno} ${formatDateShort(dateKey, todayKey)}`;
}
