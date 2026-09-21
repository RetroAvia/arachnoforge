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
// Web-Matrix: l'orario non ha materie proprie, usa quelle; il planner di
// Karen riceve le materie seguite oggi e dà loro il secondo slot; la
// coda post-lezione punta all'argomento che hai in sintesi in quella
// materia; lo Star Log dice quanta sintesi hai fatto davvero.
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
export function normalizeCampus(raw, materieIds = null) {
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

  return { semestri, override, rapportoSintesi };
}

export function createDefaultCampus() {
  return { semestri: [], override: null, rapportoSintesi: DEFAULT_RAPPORTO_SINTESI };
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

/**
 * Sessioni di sintesi su una materia, dallo Star Log. Solo le sessioni
 * dichiarate "Sintesi" nel Tactical Debriefing contano: sono l'unico dato
 * che dice davvero "ho lavorato sugli appunti di questa materia".
 */
function sessioniSintesi(starLog, materiaId) {
  return (Array.isArray(starLog) ? starLog : []).filter(
    (e) => e && e.type === 'FOCUS_SESSION' && e.workMode === 'SINTESI' && e.materiaId === materiaId
  );
}

/**
 * CODA POST-LEZIONE: le lezioni finite nelle ultime 72 ore che non sono
 * ancora state seguite da una sessione di sintesi sulla stessa materia.
 * È la lista più utile della modalità Lezioni: dice cosa sistemare
 * adesso, nell'ordine in cui è successo.
 *
 * Una lezione è "sistemata" se dopo la sua fine c'è almeno una sessione
 * di Sintesi sulla stessa materia. Due lezioni della stessa materia
 * nella finestra vengono unite in una sola voce (quella più recente):
 * una sessione di sintesi le copre entrambe.
 */
export function postLectureQueue(campus, now, materieById, starLog) {
  const finestraMs = CODA_FINESTRA_ORE * 3600000;
  const oggi = getDateKey(now);
  const perMateria = new Map();

  for (let i = 3; i >= 0; i -= 1) {
    const dk = addDaysToDateOnly(oggi, -i);
    lessonsOn(campus, dk, materieById).forEach((l) => {
      const fineMs = localDateTime(dk, l.fine).getTime();
      if (fineMs > now.getTime()) return; // non ancora finita
      if (now.getTime() - fineMs > finestraMs) return; // troppo vecchia
      const sistemata = sessioniSintesi(starLog, l.materiaId).some((e) => {
        const t = Date.parse(e.timestamp);
        return Number.isFinite(t) && t >= fineMs;
      });
      if (sistemata) {
        perMateria.delete(l.materiaId);
        return;
      }
      const prev = perMateria.get(l.materiaId);
      perMateria.set(l.materiaId, {
        ...l,
        fineMs,
        lezioniDaSistemare: (prev?.lezioniDaSistemare || 0) + 1,
        minutiDaSistemare: (prev?.minutiDaSistemare || 0) + l.minuti,
        oreFa: Math.max(0, Math.round((now.getTime() - fineMs) / 3600000))
      });
    });
  }
  return [...perMateria.values()].sort((a, b) => a.fineMs - b.fineMs);
}

/**
 * STARE AL PASSO: per ogni materia del semestre attivo, confronta la
 * sintesi che le lezioni di questa settimana (già fatte) richiedono con
 * quella fatta davvero.
 *
 * Il dovuto matura con le lezioni, non con il calendario: il martedì non
 * devi ancora la sintesi della lezione del giovedì. Così lo stato è
 * sempre giusto, in qualunque giorno lo guardi.
 */
export function weekPace(campus, now, materieById, starLog) {
  const oggi = getDateKey(now);
  const sem = activeSemester(campus, oggi);
  if (!sem) return [];
  const rapporto = Number(campus?.rapportoSintesi) > 0 ? Number(campus.rapportoSintesi) : DEFAULT_RAPPORTO_SINTESI;
  const lunedi = startOfWeek(oggi);
  const settimanali = weeklyMinutesByMateria(sem, materieById);
  const lunediMs = localDateTime(lunedi, '00:00').getTime();

  const righe = [];
  settimanali.forEach((minSett, materiaId) => {
    let lezioniFatteMin = 0;
    for (let i = 0; i < 7; i += 1) {
      const dk = addDaysToDateOnly(lunedi, i);
      if (dk > oggi) break;
      lessonsOn(campus, dk, materieById)
        .filter((l) => l.materiaId === materiaId)
        .forEach((l) => {
          if (localDateTime(dk, l.fine).getTime() <= now.getTime()) lezioniFatteMin += l.minuti;
        });
    }
    const sintesiFattaMin = sessioniSintesi(starLog, materiaId)
      .filter((e) => {
        const t = Date.parse(e.timestamp);
        return Number.isFinite(t) && t >= lunediMs && t <= now.getTime();
      })
      .reduce((sum, e) => sum + (Number(e.minutes) || 0), 0);
    const dovutoMin = Math.round(lezioniFatteMin * rapporto);
    const obiettivoSettMin = Math.round(minSett * rapporto);
    let stato = 'NESSUNA_LEZIONE';
    if (dovutoMin > 0) {
      if (sintesiFattaMin >= dovutoMin) stato = 'IN_PARI';
      else if (sintesiFattaMin >= dovutoMin * 0.6) stato = 'QUASI';
      else stato = 'INDIETRO';
    } else if (sintesiFattaMin > 0) {
      stato = 'IN_PARI';
    }
    righe.push({
      materiaId,
      materia: materieById.get(materiaId),
      lezioneSettMin: minSett,
      lezioniFatteMin,
      dovutoMin,
      obiettivoSettMin,
      sintesiFattaMin,
      mancanoMin: Math.max(0, dovutoMin - sintesiFattaMin),
      stato
    });
  });
  const ordine = { INDIETRO: 0, QUASI: 1, IN_PARI: 2, NESSUNA_LEZIONE: 3 };
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
 * Le materie da privilegiare OGGI nel planner di Karen: quelle con
 * lezione oggi e quelle con una lezione ancora da sistemare. Solo in
 * modalità Lezioni — in sessione le priorità le decidono le date.
 */
export function priorityMateriaIds(campus, now, materieById, starLog) {
  const oggi = getDateKey(now);
  const phase = detectPhase(campus, oggi);
  if (phase.fase !== FASE.LEZIONI) return new Set();
  const ids = new Set();
  postLectureQueue(campus, now, materieById, starLog).forEach((l) => ids.add(l.materiaId));
  lessonsOn(campus, oggi, materieById).forEach((l) => ids.add(l.materiaId));
  return ids;
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
 * Tutto ciò che serve alla UI, in una chiamata: fase, lezioni di oggi,
 * prossima lezione, coda post-lezione, passo settimanale.
 */
export function computeCampusSnapshot(campus, now, materie, starLog) {
  const materieById = new Map((Array.isArray(materie) ? materie : []).map((m) => [m.id, m]));
  const oggi = getDateKey(now);
  const phase = detectPhase(campus, oggi);
  const oggiLezioni = lessonsOn(campus, oggi, materieById);
  const adesso = minutesOfDay(now);
  return {
    ...phase,
    oggi,
    lezioniOggi: oggiLezioni.map((l) => ({
      ...l,
      stato: timeToMinutes(l.fine) <= adesso ? 'FINITA' : timeToMinutes(l.inizio) <= adesso ? 'IN_CORSO' : 'PROSSIMA'
    })),
    prossima: nextLesson(campus, now, materieById),
    coda: phase.fase === FASE.LEZIONI ? postLectureQueue(campus, now, materieById, starLog) : [],
    passo: phase.fase === FASE.LEZIONI ? weekPace(campus, now, materieById, starLog) : [],
    haOrario: (campus?.semestri || []).some((s) => s.lezioni.length > 0),
    rapportoSintesi: campus?.rapportoSintesi ?? DEFAULT_RAPPORTO_SINTESI
  };
}
