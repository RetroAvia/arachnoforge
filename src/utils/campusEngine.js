// =====================================================================
// ArachnoForge — src/utils/campusEngine.js (V39.0)
// "Empire State University": semestre, orario e fase di studio.
//
// PERCHÉ ESISTE
//
// Un anno universitario ha due modi di lavorare completamente diversi, e
// fino alla V38 l'app ne conosceva uno solo.
//
//  - LEZIONI (settembre-dicembre, marzo-giugno). Segui i corsi. Il lavoro
//    che rende di più è trasformare la lezione di oggi nei tuoi appunti
//    OGGI, finché è fresca: domani costa il doppio, fra un mese costa il
//    triplo e l'hai dimenticata. Gli esami sono lontani e il piano
//    "per scadenza" non ha niente di urgente da dirti — ma stai
//    accumulando, lezione dopo lezione, il materiale che studierai.
//  - SESSIONE. Niente lezioni: sei a casa, sistemi gli appunti e studi, e
//    comandano le date d'esame.
//
// Questo modulo decide in che fase sei (dai periodi di lezione del
// semestre, con una forzatura manuale che scade da sola), sa quali
// lezioni hai oggi e quali hai già "sistemato", e misura se stai al
// passo con le lezioni: per ogni ora di lezione già fatta, quante ore di
// sintesi le hai dedicato questa settimana.
//
// Tutto è collegato al resto dell'app attraverso gli ID delle materie del
// Web-Matrix: l'orario non ha materie proprie, usa quelle; la coda
// post-lezione punta all'argomento che hai in sintesi in quella materia;
// lo Star Log e i nodi dicono quanta sintesi hai fatto davvero; il
// planner di Karen riserva ogni giorno solo il tempo di sintesi davvero
// dovuto, senza mai scavalcare un esame a rischio (V40.0).
//
// Nessuna funzione qui dentro legge l'orologio da sola quando serve
// l'ora: `now` viene sempre passato, così ogni caso è testabile.
// =====================================================================
import { getDateKey, addDaysToDateOnly, dateOnlyToUtcMs, daysUntilDateOnly } from './dateUtils.js';
import { nodeSources } from './sintesiEngine.js';

export const FASE = {
  LEZIONI: 'LEZIONI',
  SESSIONE: 'SESSIONE'
};

export const FASE_META = {
  LEZIONI: {
    label: 'Lezioni',
    titolo: 'Modalità Lezioni',
    descrizione: 'Segui i corsi: la priorità è sistemare le lezioni di oggi finché sono fresche.',
    icon: 'calendar',
    tone: 'text-cyan-300',
    border: 'border-cyan-400/40',
    bg: 'bg-cyan-500/10'
  },
  SESSIONE: {
    label: 'Sessione',
    titolo: 'Modalità Sessione',
    descrizione: 'Niente lezioni: studio a casa, e comandano le date d’esame.',
    icon: 'target',
    tone: 'text-accent',
    border: 'border-accent/40',
    bg: 'bg-accent/10'
  }
};

export const TIPO_LEZIONE = {
  LEZIONE: 'LEZIONE',
  ESERCITAZIONE: 'ESERCITAZIONE',
  LABORATORIO: 'LABORATORIO'
};

export const TIPO_LEZIONE_META = {
  LEZIONE: { label: 'Lezione', short: 'Lez.' },
  ESERCITAZIONE: { label: 'Esercitazione', short: 'Eserc.' },
  LABORATORIO: { label: 'Laboratorio', short: 'Lab.' }
};

/** Nomi dei giorni, indice ISO 1..7 (1 = lunedì). */
export const GIORNI = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const GIORNI_BREVI = ['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/** Ore di sintesi consigliate per ogni ora di lezione (default, modificabile). */
export const DEFAULT_RAPPORTO_SINTESI = 1;
export const RAPPORTO_MIN = 0.25;
export const RAPPORTO_MAX = 3;

/** Finestra della coda post-lezione: copre anche il fine settimana
 * (lezione del venerdì pomeriggio, sistemata il lunedì mattina). */
export const CODA_FINESTRA_ORE = 72;

/**
 * V40.0 — Esito di una singola lezione (un'occorrenza: lezione + giorno),
 * dichiarato a mano dalla coda "Da sistemare":
 *   FATTA   — l'ho già sistemata, anche fuori dall'app;
 *   SALTATA — non l'ho seguita, o non c'era niente da sistemare.
 */
export const ESITO_LEZIONE = { FATTA: 'FATTA', SALTATA: 'SALTATA' };
/** Gli esiti più vecchi di così non servono più a niente e vengono potati. */
export const ESITI_GIORNI_CONSERVATI = 35;

export function esitoKey(lezioneId, dateKey) {
  return `${lezioneId}@${dateKey}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/* ------------------------------------------------------------------ *
 * UTILITÀ DI TEMPO
 * ------------------------------------------------------------------ */

export function isValidDateKey(v) {
  return typeof v === 'string' && DATE_RE.test(v) && Number.isFinite(dateOnlyToUtcMs(v));
}

export function isValidTime(v) {
  return typeof v === 'string' && TIME_RE.test(v);
}

/** "09:30" -> 570. */
export function timeToMinutes(t) {
  if (!isValidTime(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** 570 -> "09:30". */
export function minutesToTime(min) {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(min) || 0)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** Giorno della settimana ISO (1 = lunedì … 7 = domenica) di una data-only. */
export function isoWeekday(dateKey) {
  const d = new Date(dateOnlyToUtcMs(dateKey)).getUTCDay(); // 0 = domenica
  return d === 0 ? 7 : d;
}

/** Il lunedì della settimana che contiene `dateKey`. */
export function startOfWeek(dateKey) {
  return addDaysToDateOnly(dateKey, -(isoWeekday(dateKey) - 1));
}

/** Minuti trascorsi dalla mezzanotte locale di `now`. */
export function minutesOfDay(now) {
  return now.getHours() * 60 + now.getMinutes();
}

/** Istante locale di una data-only + orario "HH:MM". */
function localDateTime(dateKey, time) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const min = timeToMinutes(time) ?? 0;
  return new Date(y, m - 1, d, Math.floor(min / 60), min % 60, 0, 0);
}

function durata(l) {
  const a = timeToMinutes(l.inizio);
  const b = timeToMinutes(l.fine);
  return a != null && b != null && b > a ? b - a : 0;
}

/* ------------------------------------------------------------------ *
 * NORMALIZZAZIONE (migrazione, import, integrità referenziale)
 * ------------------------------------------------------------------ */

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createLezione({ materiaId, giorno = 1, inizio = '09:00', fine = '11:00', tipo = TIPO_LEZIONE.LEZIONE, aula = '' } = {}) {
  return {
    id: newId('lez'),
    materiaId: typeof materiaId === 'string' ? materiaId : '',
    giorno: Math.min(7, Math.max(1, Math.round(Number(giorno) || 1))),
    inizio: isValidTime(inizio) ? inizio : '09:00',
    fine: isValidTime(fine) ? fine : '11:00',
    tipo: TIPO_LEZIONE[tipo] ? tipo : TIPO_LEZIONE.LEZIONE,
    aula: typeof aula === 'string' ? aula.slice(0, 40) : ''
  };
}

export function createSemestre({ nome = '', inizio, fine } = {}) {
  return {
    id: newId('sem'),
    nome: typeof nome === 'string' && nome.trim() ? nome.trim().slice(0, 60) : 'Semestre',
    inizio: isValidDateKey(inizio) ? inizio : getDateKey(),
    fine: isValidDateKey(fine) ? fine : addDaysToDateOnly(getDateKey(), 90),
    sospensioni: [],
    lezioni: []
  };
}

/**
 * Normalizza lo stato Campus: scarta ciò che è rotto, ripara ciò che si
 * può riparare, e rimuove le lezioni che puntano a materie che non
 * esistono più (se `materieIds` è dato). È il punto unico dove passano
 * migrazione, import e reidratazione: nessun consumatore deve difendersi
 * da dati incoerenti per conto proprio.
 */
export function normalizeCampus(raw, materieIds = null, oggi = getDateKey()) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const ids = materieIds instanceof Set ? materieIds : Array.isArray(materieIds) ? new Set(materieIds) : null;

  const semestri = (Array.isArray(src.semestri) ? src.semestri : [])
    .filter((s) => s && typeof s === 'object' && isValidDateKey(s.inizio) && isValidDateKey(s.fine))
    .map((s) => {
      // Date invertite: le si scambia invece di buttare il semestre.
      const [inizio, fine] = s.inizio <= s.fine ? [s.inizio, s.fine] : [s.fine, s.inizio];
      const lezioni = (Array.isArray(s.lezioni) ? s.lezioni : [])
        .filter((l) => l && typeof l === 'object' && typeof l.materiaId === 'string' && l.materiaId)
        .filter((l) => !ids || ids.has(l.materiaId))
        .map((l) => ({ ...createLezione(l), id: typeof l.id === 'string' && l.id ? l.id : newId('lez') }))
        .filter((l) => durata(l) > 0);
      const sospensioni = [...new Set((Array.isArray(s.sospensioni) ? s.sospensioni : []).filter(isValidDateKey))].sort();
      return {
        id: typeof s.id === 'string' && s.id ? s.id : newId('sem'),
        nome: typeof s.nome === 'string' && s.nome.trim() ? s.nome.trim().slice(0, 60) : 'Semestre',
        inizio,
        fine,
        sospensioni,
        lezioni
      };
    })
    .sort((a, b) => a.inizio.localeCompare(b.inizio));

  const o = src.override;
  const override =
    o && typeof o === 'object' && FASE[o.fase] && isValidDateKey(o.finoA) ? { fase: o.fase, finoA: o.finoA } : null;

  const r = Number(src.rapportoSintesi);
  const rapportoSintesi = Number.isFinite(r) ? Math.min(RAPPORTO_MAX, Math.max(RAPPORTO_MIN, r)) : DEFAULT_RAPPORTO_SINTESI;

  // V40.0 — esiti manuali: solo chiavi ben formate, di lezioni che
  // esistono ancora, e non più vecchi di ESITI_GIORNI_CONSERVATI.
  const lezioneIds = new Set(semestri.flatMap((sem) => sem.lezioni.map((l) => l.id)));
  const limite = addDaysToDateOnly(isValidDateKey(oggi) ? oggi : getDateKey(), -ESITI_GIORNI_CONSERVATI);
  const esiti = {};
  Object.entries(src.esiti && typeof src.esiti === 'object' ? src.esiti : {}).forEach(([k, v]) => {
    const m = /^(.+)@(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (!m || !ESITO_LEZIONE[v] || m[2] < limite || !lezioneIds.has(m[1])) return;
    esiti[k] = v;
  });

  return { semestri, override, rapportoSintesi, esiti };
}

export function createDefaultCampus() {
  return { semestri: [], override: null, rapportoSintesi: DEFAULT_RAPPORTO_SINTESI, esiti: {} };
}

/**
 * Date di default per un nuovo semestre, ricavate da oggi secondo il
 * calendario tipico di un ateneo italiano: lezioni del primo semestre
 * da fine settembre a metà dicembre, del secondo da inizio marzo a metà
 * giugno. Solo un punto di partenza: si modificano prima di salvare.
 */
export function suggestSemestre(dateKey = getDateKey()) {
  const [y, m] = dateKey.split('-').map(Number);
  if (m >= 7 || m <= 1) {
    const anno = m <= 1 ? y - 1 : y;
    return { nome: `1° semestre ${anno}/${String(anno + 1).slice(2)}`, inizio: `${anno}-09-22`, fine: `${anno}-12-19` };
  }
  const annoAcc = y - 1;
  return { nome: `2° semestre ${annoAcc}/${String(annoAcc + 1).slice(2)}`, inizio: `${y}-03-02`, fine: `${y}-06-12` };
}

/* ------------------------------------------------------------------ *
 * FASE
 * ------------------------------------------------------------------ */

/** Il semestre che contiene `dateKey`, se c'è. */
export function activeSemester(campus, dateKey) {
  return (campus?.semestri || []).find((s) => s.inizio <= dateKey && dateKey <= s.fine) || null;
}

/** Il semestre da mostrare di default: quello in corso, altrimenti il
 * prossimo, altrimenti l'ultimo concluso. */
export function focusSemester(campus, dateKey) {
  const list = campus?.semestri || [];
  return (
    activeSemester(campus, dateKey) ||
    list.find((s) => s.inizio > dateKey) ||
    [...list].reverse().find((s) => s.fine < dateKey) ||
    null
  );
}

/**
 * In che fase sei oggi.
 *
 * Regola: dentro un periodo di lezioni -> LEZIONI; fuori -> SESSIONE. La
 * forzatura manuale ha una SCADENZA: sciopero, settimana di pausa
 * didattica, corso finito in anticipo… Una forzatura senza scadenza
 * dimenticata terrebbe l'app nella modalità sbagliata per mesi; questa
 * torna automatica da sola il giorno dopo `finoA`.
 */
export function detectPhase(campus, dateKey) {
  const semestre = activeSemester(campus, dateKey);
  const auto = semestre ? FASE.LEZIONI : FASE.SESSIONE;
  const o = campus?.override;
  const overrideAttivo = !!(o && FASE[o.fase] && isValidDateKey(o.finoA) && dateKey <= o.finoA);
  const fase = overrideAttivo ? o.fase : auto;

  let settimana = null;
  let settimaneTotali = null;
  let giorniAllaFine = null;
  if (semestre) {
    const giorni = Math.round((dateOnlyToUtcMs(dateKey) - dateOnlyToUtcMs(startOfWeek(semestre.inizio))) / 86400000);
    settimana = Math.floor(giorni / 7) + 1;
    const tot = Math.round((dateOnlyToUtcMs(semestre.fine) - dateOnlyToUtcMs(startOfWeek(semestre.inizio))) / 86400000);
    settimaneTotali = Math.floor(tot / 7) + 1;
    giorniAllaFine = daysUntilDateOnly(semestre.fine);
  }
  const prossimo = (campus?.semestri || []).find((s) => s.inizio > dateKey) || null;

  return {
    fase,
    automatica: !overrideAttivo,
    faseAutomatica: auto,
    override: overrideAttivo ? { ...o } : null,
    semestre,
    settimana,
    settimaneTotali,
    giorniAllaFine,
    prossimoSemestre: prossimo,
    giorniAlProssimo: prossimo ? daysUntilDateOnly(prossimo.inizio) : null,
    sospeso: !!(semestre && semestre.sospensioni.includes(dateKey))
  };
}

/* ------------------------------------------------------------------ *
 * LEZIONI
 * ------------------------------------------------------------------ */

function materiaValida(materieById, id) {
  const m = materieById.get(id);
  return !!m && !m.examPassed;
}

/**
 * Le lezioni di un giorno, in ordine di orario, con la materia allegata.
 * Nessuna lezione fuori dal periodo del semestre, nei giorni di
 * sospensione o per materie cancellate/già superate.
 */
export function lessonsOn(campus, dateKey, materieById) {
  const sem = activeSemester(campus, dateKey);
  if (!sem || sem.sospensioni.includes(dateKey)) return [];
  const g = isoWeekday(dateKey);
  return sem.lezioni
    .filter((l) => l.giorno === g && materiaValida(materieById, l.materiaId))
    .map((l) => ({ ...l, dateKey, materia: materieById.get(l.materiaId), minuti: durata(l) }))
    .sort((a, b) => timeToMinutes(a.inizio) - timeToMinutes(b.inizio));
}

/** La prossima lezione a partire da `now` (entro 7 giorni), o null. */
export function nextLesson(campus, now, materieById) {
  const oggi = getDateKey(now);
  const adesso = minutesOfDay(now);
  for (let i = 0; i < 8; i += 1) {
    const dk = addDaysToDateOnly(oggi, i);
    const list = lessonsOn(campus, dk, materieById);
    const l = i === 0 ? list.find((x) => timeToMinutes(x.fine) > adesso) : list[0];
    if (l) {
      const inCorso = i === 0 && timeToMinutes(l.inizio) <= adesso;
      const minutiAllInizio = Math.round((localDateTime(dk, l.inizio) - now) / 60000);
      return { ...l, inCorso, minutiAllInizio, giorniDistanza: i };
    }
  }
  return null;
}

/** Minuti di lezione a settimana per ogni materia del semestre. */
export function weeklyMinutesByMateria(semestre, materieById) {
  const map = new Map();
  (semestre?.lezioni || []).forEach((l) => {
    if (!materiaValida(materieById, l.materiaId)) return;
    map.set(l.materiaId, (map.get(l.materiaId) || 0) + durata(l));
  });
  return map;
}

/* ------------------------------------------------------------------ *
 * SINTESI DELLE LEZIONI
 *
 * V40.0 — Una lezione chiede di essere sistemata SOLO se c'è davvero
 * qualcosa da sistemare che l'app conosce. Prima ogni lezione finita
 * finiva in coda e maturava ore di sintesi, anche per una materia senza
 * nodi né fonti (cose da sintetizzare che non esistevano), anche se
 * la sintesi era già stata fatta fuori dall'app aggiornando il nodo a
 * mano, anche se a quella lezione non eri andato. Ora ogni occorrenza
 * (lezione + giorno) ha uno stato:
 *
 *   SALTATA    — dichiarata a mano: non seguita / niente da sistemare;
 *   FATTA      — dichiarata a mano: sistemata, anche fuori dall'app;
 *   FATTA_APP  — dopo la sua fine c'è una sessione Sintesi sulla materia;
 *   FATTA_NODI — dopo la sua fine hai fatto avanzare a mano la sintesi di
 *                un nodo della materia (pagine snellite, sintesi chiusa,
 *                pagine dei tuoi appunti): vedi `sintesiAggiornataAt`;
 *   NIENTE     — la materia non ha fonti aperte da snellire: non c'è
 *                niente di tracciato da sistemare;
 *   DA_FARE    — tutto il resto: è l'unico stato che entra in coda.
 * ------------------------------------------------------------------ */

export const STATO_LEZIONE = {
  SALTATA: 'SALTATA',
  FATTA: 'FATTA',
  FATTA_APP: 'FATTA_APP',
  FATTA_NODI: 'FATTA_NODI',
  NIENTE: 'NIENTE',
  DA_FARE: 'DA_FARE'
};

/** Soglia oltre la quale le sessioni Sintesi dopo una lezione la "sistemano". */
export const COPERTURA_MINIMA = 0.5;

function msDaIdFonte(id) {
  const m = /^fonte_(\d{12,})_/.exec(String(id || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Stato della sintesi di una materia:
 *  - `aperta`: c'è almeno una fonte con pagine da snellire su un nodo
 *    non completato;
 *  - `haFonti`: la materia ha fonti, in generale;
 *  - `tracciataDalMs`: da quando esiste la prima fonte (dall'id della
 *    fonte; -Infinity se non si può sapere). Le lezioni finite PRIMA non
 *    diventano debito all'improvviso quando aggiungi le fonti;
 *  - `ultimoAggiornamentoMs`: l'ultimo avanzamento registrato a mano sui
 *    nodi (`sintesiAggiornataAt`).
 */
export function sintesiMateria(materia) {
  let aperta = false;
  let haFonti = false;
  let ultimoAggiornamentoMs = -Infinity;
  let tracciataDalMs = Infinity;
  (Array.isArray(materia?.sfide) ? materia.sfide : []).forEach((s) => {
    if (!s) return;
    const src = nodeSources(s);
    if (src.totali > 0) {
      haFonti = true;
      src.fonti.forEach((f) => {
        const t = msDaIdFonte(f?.id);
        tracciataDalMs = Math.min(tracciataDalMs, t == null ? -Infinity : t);
      });
    }
    if (s.status !== 'COMPLETED' && src.totali > 0 && src.residue > 0 && !src.conclusa) aperta = true;
    const t = Date.parse(s.sintesiAggiornataAt);
    if (Number.isFinite(t) && t > ultimoAggiornamentoMs) ultimoAggiornamentoMs = t;
  });
  if (!haFonti) tracciataDalMs = Infinity;
  return { aperta, haFonti, ultimoAggiornamentoMs, tracciataDalMs };
}

/**
 * Contesto calcolato UNA volta per snapshot: per ogni materia lo stato
 * della sua sintesi e le sue sessioni Sintesi (in ordine di tempo), più
 * i minuti di Sintesi da `daMs` in poi. Un solo passaggio sullo Star Log.
 */
export function contestoSintesi(campus, materieById, starLog, daMs = -Infinity) {
  const perMateria = new Map();
  materieById.forEach((m, id) => {
    perMateria.set(id, { ...sintesiMateria(m), sessioni: [], ultimaSessioneMs: -Infinity, minutiDa: 0 });
  });
  (Array.isArray(starLog) ? starLog : []).forEach((e) => {
    if (!e || e.type !== 'FOCUS_SESSION' || e.workMode !== 'SINTESI') return;
    const c = perMateria.get(e.materiaId);
    if (!c) return;
    const t = Date.parse(e.timestamp);
    if (!Number.isFinite(t)) return;
    const min = Number(e.minutes) || 0;
    c.sessioni.push({ t, min });
    if (t > c.ultimaSessioneMs) c.ultimaSessioneMs = t;
    if (t >= daMs) c.minutiDa += min;
  });
  perMateria.forEach((c) => c.sessioni.sort((x, y) => x.t - y.t));
  return { perMateria, esiti: campus?.esiti && typeof campus.esiti === 'object' ? campus.esiti : {}, daMs, starLog };
}

function rapportoDi(campus) {
  return Number(campus?.rapportoSintesi) > 0 ? Number(campus.rapportoSintesi) : DEFAULT_RAPPORTO_SINTESI;
}

/**
 * Valuta un insieme di lezioni finite (tutte le materie).
 *
 * I minuti delle sessioni Sintesi vengono "spesi" sulle lezioni della
 * stessa materia finite PRIMA della sessione, cominciando dalla più
 * recente: la sessione delle 15:00 sistema la lezione di stamattina, non
 * una di lunedì ormai uscita dalla coda. Le lezioni con una risposta
 * manuale non concorrono: "Niente da sistemare" non prende minuti, e
 * "Già fatta" prende solo quelli che avanzano (per non contarli due
 * volte), con credito per il resto. Così una sessione di un minuto non
 * sistema una lezione di due ore, e nessun minuto vale doppio.
 *
 * Ritorna una Map esitoKey → { stato, motivo, dovutoMin, copertiMin, creditoMin }:
 *   dovutoMin  — sintesi che la lezione chiede (minuti × rapporto), 0 se
 *                non c'è niente da sistemare;
 *   copertiMin — minuti di sessioni Sintesi spesi su questa lezione;
 *   creditoMin — sintesi fatta fuori dal timer (dichiarata o registrata
 *                sui nodi), solo per la parte non coperta;
 *   motivo     — per NIENTE: 'NESSUNA_FONTE' | 'PRIMA_DELLE_FONTI' | 'FONTI_CHIUSE'.
 */
export function valutaLezioni(occorrenze, ctx, rapporto = DEFAULT_RAPPORTO_SINTESI) {
  const out = new Map();
  const lista = [...occorrenze].sort((a, b) => a.fineMs - b.fineMs);
  const info = lista.map((l) => {
    const key = esitoKey(l.id, l.dateKey);
    const esito = ctx.esiti[key];
    const c = ctx.perMateria.get(l.materiaId);
    const tracciata = !!c && c.haFonti && l.fineMs >= c.tracciataDalMs;
    return { l, key, esito, c, tracciata, dovuto: tracciata ? Math.round(l.minuti * rapporto) : 0, coperti: 0 };
  });

  // Spesa dei minuti, materia per materia: prima le lezioni senza
  // risposta manuale, poi (con ciò che resta) quelle dichiarate fatte.
  const perMateria = new Map();
  info.forEach((x) => {
    if (!perMateria.has(x.l.materiaId)) perMateria.set(x.l.materiaId, []);
    perMateria.get(x.l.materiaId).push(x);
  });
  perMateria.forEach((voci, materiaId) => {
    const sessioni = (ctx.perMateria.get(materiaId)?.sessioni || []).map((x) => ({ t: x.t, restante: x.min }));
    const spendi = (candidate) => {
      sessioni.forEach((sess) => {
        candidate
          .filter((x) => x.l.fineMs <= sess.t && x.coperti < x.dovuto)
          .sort((p, q) => q.l.fineMs - p.l.fineMs)
          .forEach((x) => {
            if (sess.restante <= 0) return;
            const preso = Math.min(sess.restante, x.dovuto - x.coperti);
            sess.restante -= preso;
            x.coperti += preso;
          });
      });
    };
    spendi(voci.filter((x) => x.tracciata && !x.esito));
    spendi(voci.filter((x) => x.tracciata && x.esito === ESITO_LEZIONE.FATTA));
  });

  info.forEach((x) => {
    const { l, key, esito, c, tracciata, dovuto, coperti } = x;
    let stato;
    let motivo = null;
    let credito = 0;
    if (esito === ESITO_LEZIONE.SALTATA) stato = STATO_LEZIONE.SALTATA;
    else if (esito === ESITO_LEZIONE.FATTA) {
      stato = STATO_LEZIONE.FATTA;
      credito = dovuto - coperti;
    } else if (!tracciata) {
      stato = STATO_LEZIONE.NIENTE;
      motivo = c && c.haFonti ? 'PRIMA_DELLE_FONTI' : 'NESSUNA_FONTE';
    } else if (dovuto > 0 && coperti >= dovuto * COPERTURA_MINIMA) {
      stato = STATO_LEZIONE.FATTA_APP;
    } else if (c.ultimoAggiornamentoMs >= l.fineMs) {
      stato = STATO_LEZIONE.FATTA_NODI;
      credito = dovuto - coperti;
    } else if (!c.aperta) {
      stato = STATO_LEZIONE.NIENTE;
      motivo = 'FONTI_CHIUSE';
    } else {
      stato = STATO_LEZIONE.DA_FARE;
    }
    const nienteDaFare = stato === STATO_LEZIONE.NIENTE || stato === STATO_LEZIONE.SALTATA;
    out.set(key, {
      stato,
      motivo,
      dovutoMin: nienteDaFare ? 0 : dovuto,
      copertiMin: nienteDaFare ? 0 : coperti,
      creditoMin: Math.max(0, credito)
    });
  });
  return out;
}

/** Le lezioni finite fra `dalKey` e adesso, con la fine in millisecondi. */
function lezioniFinite(campus, materieById, dalKey, now) {
  const oggi = getDateKey(now);
  const nowMs = now.getTime();
  const out = [];
  for (let dk = dalKey; dk <= oggi; dk = addDaysToDateOnly(dk, 1)) {
    lessonsOn(campus, dk, materieById).forEach((l) => {
      const fineMs = localDateTime(dk, l.fine).getTime();
      if (fineMs <= nowMs) out.push({ ...l, fineMs });
    });
  }
  return out;
}

function ctxOrBuild(campus, materieById, ctxOrStarLog, daMs) {
  if (ctxOrStarLog && ctxOrStarLog.perMateria) {
    return daMs == null || ctxOrStarLog.daMs === daMs
      ? ctxOrStarLog
      : contestoSintesi(campus, materieById, ctxOrStarLog.starLog, daMs);
  }
  return contestoSintesi(campus, materieById, ctxOrStarLog, daMs ?? -Infinity);
}

/** Stato di UNA lezione finita alle `fineMs` (valutata da sola). */
export function statoLezione(l, fineMs, ctx, rapporto = DEFAULT_RAPPORTO_SINTESI) {
  return valutaLezioni([{ ...l, fineMs }], ctx, rapporto).get(esitoKey(l.id, l.dateKey)).stato;
}

/** La finestra comune a coda e passo: da lunedì (o da 3 giorni fa, se prima). */
function inizioFinestra(oggi) {
  const lunedi = startOfWeek(oggi);
  const treGiorniFa = addDaysToDateOnly(oggi, -3);
  return lunedi < treGiorniFa ? lunedi : treGiorniFa;
}

/**
 * CODA POST-LEZIONE: le lezioni finite nelle ultime 72 ore ancora DA_FARE,
 * unite per materia (con l'elenco delle occorrenze, così "Già fatta" /
 * "Niente da sistemare" le chiude tutte).
 *
 * L'ultimo argomento può essere lo Star Log o un contesto già calcolato
 * (`contestoSintesi`); `valutazioni` opzionale evita di rifare il conto.
 */
export function postLectureQueue(campus, now, materieById, ctxOrStarLog, valutazioni = null) {
  const oggi = getDateKey(now);
  const nowMs = now.getTime();
  const finestraMs = CODA_FINESTRA_ORE * 3600000;
  const rapporto = rapportoDi(campus);
  const occ = lezioniFinite(campus, materieById, inizioFinestra(oggi), now);
  const val = valutazioni || valutaLezioni(occ, ctxOrBuild(campus, materieById, ctxOrStarLog), rapporto);
  const perMateria = new Map();
  occ
    .filter((l) => nowMs - l.fineMs <= finestraMs)
    .forEach((l) => {
      const v = val.get(esitoKey(l.id, l.dateKey));
      if (!v || v.stato !== STATO_LEZIONE.DA_FARE) return;
      const prev = perMateria.get(l.materiaId);
      const occorrenza = { id: l.id, dateKey: l.dateKey, inizio: l.inizio, fine: l.fine, minuti: l.minuti };
      perMateria.set(l.materiaId, {
        ...l,
        lezioni: [...(prev?.lezioni || []), occorrenza],
        lezioniDaSistemare: (prev?.lezioniDaSistemare || 0) + 1,
        minutiDaSistemare: (prev?.minutiDaSistemare || 0) + l.minuti,
        // Sintesi che manca davvero: dovuto meno quanto già coperto.
        sintesiMancanteMin: (prev?.sintesiMancanteMin || 0) + Math.max(0, v.dovutoMin - v.copertiMin),
        oreFa: Math.max(0, Math.round((nowMs - l.fineMs) / 3600000))
      });
    });
  return [...perMateria.values()].sort((a, b) => a.fineMs - b.fineMs);
}

/**
 * STARE AL PASSO: per ogni materia del semestre attivo, la sintesi che le
 * lezioni di questa settimana (già finite e con qualcosa da sistemare)
 * chiedono, contro quella fatta: minuti di Sintesi nell'app da lunedì,
 * più il credito della sintesi fatta fuori dal timer.
 */
export function weekPace(campus, now, materieById, ctxOrStarLog, valutazioni = null) {
  const oggi = getDateKey(now);
  const sem = activeSemester(campus, oggi);
  if (!sem) return [];
  const rapporto = rapportoDi(campus);
  const lunedi = startOfWeek(oggi);
  const lunediMs = localDateTime(lunedi, '00:00').getTime();
  const ctx = ctxOrBuild(campus, materieById, ctxOrStarLog, lunediMs);
  const occ = lezioniFinite(campus, materieById, inizioFinestra(oggi), now);
  const val = valutazioni || valutaLezioni(occ, ctx, rapporto);
  const settimanali = weeklyMinutesByMateria(sem, materieById);

  const righe = [];
  settimanali.forEach((minSett, materiaId) => {
    const c = ctx.perMateria.get(materiaId) || { haFonti: false, minutiDa: 0 };
    let lezioniFatteMin = 0;
    let dovutoMin = 0;
    let creditoMin = 0;
    let saltateMin = 0;
    occ
      .filter((l) => l.materiaId === materiaId && l.dateKey >= lunedi)
      .forEach((l) => {
        const v = val.get(esitoKey(l.id, l.dateKey));
        lezioniFatteMin += l.minuti;
        if (!v) return;
        if (v.stato === STATO_LEZIONE.SALTATA) saltateMin += l.minuti;
        dovutoMin += v.dovutoMin;
        creditoMin += v.creditoMin;
      });
    const sintesiFattaMin = Math.round(c.minutiDa + creditoMin);
    let stato;
    if (!c.haFonti && dovutoMin === 0 && sintesiFattaMin === 0) stato = 'NON_TRACCIATA';
    else if (dovutoMin > 0) {
      if (sintesiFattaMin >= dovutoMin) stato = 'IN_PARI';
      else if (sintesiFattaMin >= dovutoMin * 0.6) stato = 'QUASI';
      else stato = 'INDIETRO';
    } else stato = sintesiFattaMin > 0 || lezioniFatteMin > 0 ? 'IN_PARI' : 'NESSUNA_LEZIONE';
    righe.push({
      materiaId,
      materia: materieById.get(materiaId),
      lezioneSettMin: minSett,
      lezioniFatteMin,
      saltateMin,
      dovutoMin,
      obiettivoSettMin: Math.round(minSett * rapporto),
      sintesiFattaMin,
      creditoMin,
      mancanoMin: Math.max(0, dovutoMin - sintesiFattaMin),
      tracciata: c.haFonti,
      stato
    });
  });
  const ordine = { INDIETRO: 0, QUASI: 1, IN_PARI: 2, NESSUNA_LEZIONE: 3, NON_TRACCIATA: 4 };
  return righe.sort((a, b) => ordine[a.stato] - ordine[b.stato] || b.mancanoMin - a.mancanoMin);
}

/**
 * L'argomento su cui ha senso fare sintesi in una materia: il nodo con
 * una sintesi già avviata (fonte a metà), altrimenti il primo con fonti
 * ancora da snellire, altrimenti nessuno (sessione sulla materia).
 */
export function nodoInSintesi(materia) {
  const sfide = (Array.isArray(materia?.sfide) ? materia.sfide : []).filter((s) => s && s.status !== 'COMPLETED');
  const aperti = sfide
    .map((s) => ({ s, src: nodeSources(s) }))
    .filter(({ src }) => src.totali > 0 && src.residue > 0 && !src.conclusa);
  const avviato = aperti.find(({ src }) => src.fatte > 0);
  return (avviato || aperti[0])?.s || null;
}

/**
 * Le materie con una lezione davvero da sistemare (in coda). Solo in
 * modalità Lezioni. V40.0 — non più "tutte le materie con lezione oggi":
 * una lezione seguita non è automaticamente lavoro da fare.
 */
export function priorityMateriaIds(campus, now, materieById, ctxOrStarLog) {
  const oggi = getDateKey(now);
  const phase = detectPhase(campus, oggi);
  if (phase.fase !== FASE.LEZIONI) return new Set();
  return new Set(postLectureQueue(campus, now, materieById, ctxOrStarLog).map((l) => l.materiaId));
}

/**
 * Validazione di una lezione prima del salvataggio: errori bloccanti e
 * sovrapposizioni (avviso, non errore — esistono davvero lezioni
 * sovrapposte fra cui scegliere).
 */
export function validateLezione(lezione, altre = []) {
  const errori = [];
  if (!lezione?.materiaId) errori.push('Scegli la materia.');
  const a = timeToMinutes(lezione?.inizio);
  const b = timeToMinutes(lezione?.fine);
  if (a == null || b == null) errori.push('Orario non valido.');
  else if (b <= a) errori.push('L’orario di fine deve venire dopo quello di inizio.');
  const sovrapposte =
    a != null && b != null
      ? altre.filter(
          (l) =>
            l.id !== lezione.id &&
            l.giorno === lezione.giorno &&
            timeToMinutes(l.inizio) < b &&
            a < timeToMinutes(l.fine)
        )
      : [];
  return { valida: errori.length === 0, errori, sovrapposte };
}

/**
 * Tutto ciò che serve alla UI, in una chiamata: fase, lezioni di oggi
 * (con lo stato di sintesi di quelle finite), prossima lezione, coda
 * post-lezione, passo settimanale, e i minuti di sintesi da riservare
 * oggi nel piano di Karen.
 */
export function computeCampusSnapshot(campus, now, materie, starLog) {
  const materieById = new Map((Array.isArray(materie) ? materie : []).map((m) => [m.id, m]));
  const oggi = getDateKey(now);
  const phase = detectPhase(campus, oggi);
  const oggiLezioni = lessonsOn(campus, oggi, materieById);
  const adesso = minutesOfDay(now);
  const lezioni = phase.fase === FASE.LEZIONI;
  const lunediMs = localDateTime(startOfWeek(oggi), '00:00').getTime();
  const rapporto = rapportoDi(campus);
  const ctx = contestoSintesi(campus, materieById, starLog, lunediMs);
  // Una sola valutazione per coda, passo e chip delle lezioni di oggi.
  const valutazioni = valutaLezioni(lezioniFinite(campus, materieById, inizioFinestra(oggi), now), ctx, rapporto);
  const coda = lezioni ? postLectureQueue(campus, now, materieById, ctx, valutazioni) : [];

  // Materie seguite a lezione nella finestra della coda ma senza fonti:
  // la UI lo dice, invece di inventare lavoro.
  const nonTracciate = [];
  if (lezioni) {
    const visti = new Set();
    for (let i = 3; i >= 0; i -= 1) {
      lessonsOn(campus, addDaysToDateOnly(oggi, -i), materieById).forEach((l) => {
        if (visti.has(l.materiaId)) return;
        const c = ctx.perMateria.get(l.materiaId);
        if (c && !c.haFonti) {
          visti.add(l.materiaId);
          nonTracciate.push({ materiaId: l.materiaId, materia: l.materia });
        }
      });
    }
  }

  return {
    ...phase,
    oggi,
    lezioniOggi: oggiLezioni.map((l) => {
      const stato = timeToMinutes(l.fine) <= adesso ? 'FINITA' : timeToMinutes(l.inizio) <= adesso ? 'IN_CORSO' : 'PROSSIMA';
      const v = valutazioni.get(esitoKey(l.id, oggi));
      return {
        ...l,
        stato,
        sintesi: stato === 'FINITA' && v ? v.stato : null,
        // Perché non c'è niente da sistemare (vedi valutaLezioni).
        motivo: stato === 'FINITA' && v ? v.motivo : null
      };
    }),
    prossima: nextLesson(campus, now, materieById),
    coda,
    nonTracciate,
    passo: lezioni ? weekPace(campus, now, materieById, ctx, valutazioni) : [],
    // Minuti di sintesi davvero mancanti per le lezioni in coda.
    sintesiDovutaMin: coda.reduce((sum, l) => sum + l.sintesiMancanteMin, 0),
    lezioniInCoda: coda.reduce((sum, l) => sum + l.lezioniDaSistemare, 0),
    haOrario: (campus?.semestri || []).some((s) => s.lezioni.length > 0),
    rapportoSintesi: campus?.rapportoSintesi ?? DEFAULT_RAPPORTO_SINTESI
  };
}
