// =====================================================================
// ArachnoForge — src/utils/sintesiEngine.js (V38.0)
// "La Forgia degli Appunti".
//
// PERCHÉ ESISTE QUESTO FILE
//
// Ogni app di studio parte da un presupposto: il materiale da studiare
// esiste già. Conti le pagine, le dividi per i giorni, hai il piano.
//
// Nella realtà di un semestre universitario metà del lavoro non è
// studiare: è FABBRICARE il materiale. Il prof dà 300 slide, consiglia
// un libro da 1000 pagine, e il lavoro vero è trasformarli in 40 pagine
// di appunti propri — che sono le uniche che verranno davvero studiate.
// Sono due attività con due ritmi diversi, due scadenze diverse e due
// modi diversi di stare indietro, e trattarle come una sola cosa produce
// piani sbagliati in entrambe le direzioni: se conti le 1000 pagine del
// libro come "da studiare" il piano è terrorizzante e inutile; se conti
// solo le 40 di appunti, il piano ignora il lavoro che serve a
// ottenerle e ti dice che sei in pari fino al giorno in cui scopri di
// non esserlo.
//
// Qui dentro vivono quindi DUE bilanci separati per ogni nodo:
//
//   SINTESI — pagine di FONTE (libro, slide, appunti del prof) ancora da
//             snellire, al ritmo con cui snellisci davvero;
//   STUDIO  — pagine dei TUOI appunti definitivi ancora da studiare, al
//             ritmo con cui studi davvero.
//
// E un terzo numero che lega i due e che nessuna app dà: la DATA DI
// CHIUSURA DEGLI APPUNTI. Gli appunti non vanno finiti per l'esame,
// vanno finiti abbastanza PRIMA dell'esame da lasciare il tempo di
// studiarli. Quella data si calcola, e sapere quanti giorni mancano
// cambia completamente cosa ha senso fare oggi.
//
// NOTA SULLA PROIEZIONE
// Le pagine finali di appunti non si conoscono in anticipo: si scoprono
// snellendo. Ma dopo qualche nodo il rapporto è misurabile ("da 100
// pagine di fonte ne escono 20 mie") e da lì il totale futuro si
// proietta. Finché il campione è troppo piccolo si usa un default
// dichiarato, e ogni risultato porta con sé `stimato: true` — la UI deve
// poter dire "non ancora calibrato" invece di mostrare un numero
// costruito sul nulla.
// =====================================================================
import { addDaysToDateOnly, daysUntilDateOnly } from './dateUtils.js';
import { PERSISTED_STATUS } from './skillTree.js';
import { HOURS_PER_NODE_DAY, DEFAULT_PAGES_PER_HOUR } from './planningConstants.js';

/** Tipi di fonte. `etichetta` libera resta comunque disponibile sul dato. */
export const FONTE_TIPO = {
  LIBRO: 'LIBRO',
  SLIDE: 'SLIDE',
  APPUNTI_PROF: 'APPUNTI_PROF',
  ALTRO: 'ALTRO'
};

export const FONTE_TIPO_META = {
  LIBRO: { label: 'Libro', icon: 'book', short: 'Libro' },
  SLIDE: { label: 'Slide del prof', icon: 'grid', short: 'Slide' },
  APPUNTI_PROF: { label: 'Appunti/dispense del prof', icon: 'newspaper', short: 'Dispense' },
  ALTRO: { label: 'Altra fonte', icon: 'archive', short: 'Altro' }
};

/**
 * I modi di lavorare su un nodo.
 * V42 — oltre a SINTESI e STUDIO: RIPASSO (richiamo di un argomento già
 * studiato: i suoi minuti non devono falsare il ritmo di primo studio) ed
 * ESERCIZI (problemi e temi d'esame: la parte che decide uno scritto).
 */
export const WORK_MODE = {
  SINTESI: 'SINTESI',
  STUDIO: 'STUDIO',
  RIPASSO: 'RIPASSO',
  ESERCIZI: 'ESERCIZI'
};

export const WORK_MODE_META = {
  SINTESI: {
    label: 'Sintesi',
    full: 'Sintesi — forgia degli appunti',
    hint: 'Trasformi libro, slide e dispense nei tuoi appunti definitivi.',
    icon: 'flask',
    color: 'text-accent',
    border: 'border-accent/40',
    bg: 'bg-accent/10'
  },
  STUDIO: {
    label: 'Studio',
    full: 'Studio — sui tuoi appunti',
    hint: 'Studi il materiale che hai già ridotto al tuo formato.',
    icon: 'target',
    color: 'text-secondary',
    border: 'border-secondary/40',
    bg: 'bg-secondary/10'
  },
  RIPASSO: {
    label: 'Ripasso',
    full: 'Ripasso — richiamo attivo',
    hint: 'Ricostruisci a memoria un argomento già studiato, poi controlli gli appunti.',
    icon: 'radar',
    color: 'text-emerald-300',
    border: 'border-emerald-400/40',
    bg: 'bg-emerald-500/10'
  },
  ESERCIZI: {
    label: 'Esercizi',
    full: 'Esercizi — problemi e temi d’esame',
    hint: 'Risolvi esercizi e tracce: è l’allenamento che decide lo scritto.',
    icon: 'grid',
    color: 'text-cyan-300',
    border: 'border-cyan-400/40',
    bg: 'bg-cyan-500/10'
  }
};

export function isWorkMode(v) {
  return typeof v === 'string' && !!WORK_MODE[v];
}

/* ------------------------------------------------------------------ *
 * COSTANTI E FALLBACK DICHIARATI
 * ------------------------------------------------------------------ */

/**
 * Resa di sintesi: quante pagine di appunti TUOI escono da una pagina di
 * fonte. 0.04 = da 100 pagine di fonte ne escono 4 tue.
 *
 * È il valore NEUTRO (tipo "Altro") e il riferimento con cui si riscala
 * la resa per tipo quando la tua resa globale è misurata. Il valore
 * misurato sui tuoi argomenti chiusi lo sostituisce appena esiste.
 */
export const DEFAULT_RESA_SINTESI = 0.04;
export const RESA_MIN = 0.01;
export const RESA_MAX = 1;
/** Nodi con sintesi conclusa necessari prima di fidarsi della resa. */
export const RESA_MIN_SAMPLES = 3;

/**
 * V42 — La resa dipende dal TIPO di fonte. Il tuo metodo, dichiarato:
 * 300 slide + 1000 pagine di libro diventano 30-40 pagine tue. Slide e
 * libro raccontano gli stessi argomenti, quindi le rese sono basse e si
 * sommano: 1000 × 0,02 + 300 × 0,05 = 35 pagine. Con un'unica resa del
 * 18% la V41 ne proiettava 234 (sei volte tanto) e il piano di studio si
 * gonfiava di conseguenza. Le dispense del prof sono già un riassunto e
 * rendono di più. Sono default dichiarati: la resa misurata sui tuoi
 * argomenti chiusi li sostituisce appena esiste, e le "pagine previste"
 * scritte sul nodo vincono su qualunque stima.
 */
export const DEFAULT_RESA_PER_TIPO = { LIBRO: 0.02, SLIDE: 0.05, APPUNTI_PROF: 0.08, ALTRO: 0.04 };

/**
 * Ritmo di sintesi di fallback, in pagine di FONTE all'ora.
 *
 * È più alto del ritmo di studio e non è una contraddizione: snellire
 * significa anche scartare: molte pagine si attraversano per capire che
 * non aggiungono niente. Studiare le proprie 20 pagine è invece lento
 * per definizione.
 */
export const DEFAULT_SINTESI_PAGES_PER_HOUR = 12;
export const SINTESI_PAGES_MIN = 1;
export const SINTESI_PAGES_MAX = 120;
/** Nodi con pagine snellite E tempo di sintesi tracciato. */
export const SINTESI_MIN_SAMPLES = 3;

/**
 * V42 — Anche il RITMO dipende dal tipo: 40 slide si snelliscono nel tempo
 * di 8 pagine di libro. Con una mediana unica tre sessioni di slide
 * facevano pianificare 400 pagine di libro in 10 ore invece di 50.
 */
export const DEFAULT_SINTESI_RITMO_PER_TIPO = { LIBRO: 8, SLIDE: 30, APPUNTI_PROF: 15, ALTRO: 12 };

const TIPI = Object.keys(FONTE_TIPO);
function tipoValido(t) {
  return FONTE_TIPO[t] ? t : FONTE_TIPO.ALTRO;
}

/** Sotto questa soglia di ore residue di studio la materia non merita
 * una "data di chiusura appunti" separata: sintesi e studio coincidono. */
const CHIUSURA_MIN_ORE_STUDIO = 1;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * LETTURA DEL NODO
 * ------------------------------------------------------------------ */

/** Crea una fonte nuova, già normalizzata. */
export function createFonte({ tipo = FONTE_TIPO.LIBRO, etichetta = '', pagine = 0, pagineFatte = 0 } = {}) {
  const totali = toPositiveInt(pagine);
  return {
    id: `fonte_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tipo: FONTE_TIPO[tipo] ? tipo : FONTE_TIPO.ALTRO,
    etichetta: typeof etichetta === 'string' ? etichetta.slice(0, 60) : '',
    pagine: totali,
    // Non può mai superare il totale: un dato incoerente arrivato da un
    // import o da una modifica del totale al ribasso viene ricondotto
    // qui, una volta sola, invece di propagarsi in ogni calcolo.
    pagineFatte: clamp(toPositiveInt(pagineFatte), 0, totali)
  };
}

/** Normalizza l'array `fonti` di un nodo (import, migrazione, form). */
export function normalizeFonti(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      ...createFonte(f),
      // L'id esistente va conservato: è la chiave con cui la UI e il
      // reducer ritrovano la fonte fra un render e l'altro.
      // V40.0 — a una fonte senza id (import, dati vecchi) se ne dà uno
      // SENZA data: l'id con la data dice alla coda delle lezioni da
      // quando la materia è tracciata, e una data inventata a ogni
      // caricamento spostava in avanti quel momento.
      id: typeof f.id === 'string' && f.id ? f.id : `fonte_legacy_${Math.random().toString(36).slice(2, 10)}`
    }))
    .filter((f) => f.pagine > 0);
}

/** Bilancio delle fonti di un nodo: quante pagine ci sono, quante ne hai già snellite. */
export function nodeSources(sfida) {
  const fonti = Array.isArray(sfida?.fonti) ? sfida.fonti : [];
  let totali = 0;
  let fatte = 0;
  // V42 — lo stesso bilancio, diviso per tipo di fonte.
  const perTipo = {};
  fonti.forEach((f) => {
    const p = toPositiveInt(f?.pagine);
    const done = clamp(toPositiveInt(f?.pagineFatte), 0, p);
    totali += p;
    fatte += done;
    const t = tipoValido(f?.tipo);
    if (!perTipo[t]) perTipo[t] = { totali: 0, fatte: 0, residue: 0 };
    perTipo[t].totali += p;
    perTipo[t].fatte += done;
    perTipo[t].residue += Math.max(0, p - done);
  });
  const residue = Math.max(0, totali - fatte);
  return {
    fonti,
    totali,
    fatte,
    residue,
    perTipo,
    pct: totali > 0 ? Math.round((fatte / totali) * 100) : 0,
    // "Sintesi conclusa" è vero sia per spunta esplicita sia quando non
    // è rimasta una pagina: l'utente non deve ricordarsi di spuntare una
    // casella perché l'app capisca una cosa che già sa.
    conclusa: !!sfida?.appuntiCompleti || (totali > 0 && residue === 0)
  };
}

/**
 * Pagine dei TUOI appunti per questo nodo: quelle che esistono già e
 * quelle che esisteranno quando la sintesi sarà chiusa.
 *
 * `pagine` è il campo V37 (che significava già "pagine dei miei
 * appunti"): viene letto come sinonimo così i dati salvati prima della
 * migrazione non valgono zero nemmeno per un istante.
 *
 * V42 — tre correzioni:
 *  - resa per TIPO di fonte (vedi DEFAULT_RESA_PER_TIPO);
 *  - pagine di fonte segnate come fatte SENZA pagine di appunti
 *    dichiarate: gli appunti si stimano dalla resa. Prima valevano zero, e
 *    snellire metà libro ACCORCIAVA il piano di studio (18h -> 10h);
 *  - `pagineAppuntiPreviste`: se sai già quante pagine scriverai (il tuo
 *    formato è 30-40 pagine), quel numero vince su qualunque stima.
 *
 * @param {object} sfida
 * @param {number|object} [resa] resa globale (numero) oppure la
 *        calibrazione risolta (vedi `resolveSintesiCalibration`).
 */
export function nodeNotes(sfida, resa = DEFAULT_RESA_SINTESI) {
  const cal = resa && typeof resa === 'object' ? resa : resolveSintesiCalibration({ resaSintesi: Number(resa) > 0 ? Number(resa) : null });
  const attuali = toPositiveInt(sfida?.pagineAppunti) || toPositiveInt(sfida?.pagine);
  const previste = toPositiveInt(sfida?.pagineAppuntiPreviste);
  const src = nodeSources(sfida);
  let daProdurre;
  let proiettate;
  let stimaAttuali = false;
  if (previste > 0) {
    proiettate = src.conclusa ? (attuali > 0 ? attuali : previste) : Math.max(attuali, previste);
    daProdurre = Math.max(0, proiettate - attuali);
  } else {
    let base = attuali;
    if (base === 0 && src.fatte > 0) {
      base = Math.round(Object.entries(src.perTipo).reduce((sum, [t, v]) => sum + v.fatte * resaPerTipo(t, cal), 0));
      stimaAttuali = base > 0;
    }
    daProdurre = src.conclusa
      ? 0
      : Math.round(Object.entries(src.perTipo).reduce((sum, [t, v]) => sum + v.residue * resaPerTipo(t, cal), 0));
    proiettate = base + daProdurre;
  }
  return {
    attuali,
    daProdurre,
    proiettate,
    stimaAttuali,
    previste,
    // Nessuna pagina dichiarata e nessuna fonte: il nodo non sa niente
    // di pagine e deve ricadere sulle ore stimate.
    dichiarate: attuali > 0 || src.totali > 0 || previste > 0
  };
}

/* ------------------------------------------------------------------ *
 * MISURA DEI DUE RITMI E DELLA RESA
 * ------------------------------------------------------------------ */

function misura(values, min, max, minSamples, fallback, digits = 100) {
  if (values.length < minSamples) return { value: fallback, confident: false, sampleSize: values.length };
  return { value: clamp(Math.round(median(values) * digits) / digits, min, max), confident: true, sampleSize: values.length };
}

/**
 * Resa di sintesi misurata: mediana di (pagine di appunti prodotte /
 * pagine di fonte snellite) sui nodi la cui sintesi è conclusa.
 *
 * Solo nodi CONCLUSI: su un nodo a metà il rapporto è sistematicamente
 * falsato dal fatto che le pagine di appunti si scrivono spesso alla
 * fine, dopo aver letto tutto.
 *
 * V42 — anche per TIPO di fonte: un nodo le cui fonti sono tutte dello
 * stesso tipo misura la resa di quel tipo.
 */
export function computeResaSintesi(materie) {
  const rese = [];
  const perTipoValori = {};
  (Array.isArray(materie) ? materie : []).forEach((m) => {
    (Array.isArray(m?.sfide) ? m.sfide : []).forEach((s) => {
      if (!s || s.chiusoDaVerbale === true) return;
      const src = nodeSources(s);
      if (!src.conclusa || src.fatte <= 0) return;
      const appunti = toPositiveInt(s.pagineAppunti) || toPositiveInt(s.pagine);
      if (appunti <= 0) return;
      const r = appunti / src.fatte;
      rese.push(r);
      const tipi = Object.keys(src.perTipo).filter((t) => src.perTipo[t].fatte > 0);
      if (tipi.length === 1) (perTipoValori[tipi[0]] = perTipoValori[tipi[0]] || []).push(r);
    });
  });

  const g = misura(rese, RESA_MIN, RESA_MAX, RESA_MIN_SAMPLES, DEFAULT_RESA_SINTESI);
  const perTipo = {};
  TIPI.forEach((t) => {
    const v = misura(perTipoValori[t] || [], RESA_MIN, RESA_MAX, RESA_MIN_SAMPLES, DEFAULT_RESA_PER_TIPO[t]);
    perTipo[t] = { resa: v.value, confident: v.confident, sampleSize: v.sampleSize };
  });
  return { resa: g.value, confident: g.confident, sampleSize: g.sampleSize, perTipo };
}

/**
 * Ritmo di sintesi: pagine di FONTE snellite per ora, misurato SULLE
 * SINGOLE SESSIONI dello Star Log.
 *
 * Non sui contatori del nodo, ed è una distinzione che cambia il
 * risultato di un ordine di grandezza. `fonti[].pagineFatte` è un totale
 * di sempre: comprende le pagine che hai dichiarato a mano compilando il
 * campo "fatte" e tutto ciò che avevi già snellito prima di misurare
 * qualunque cosa. `focusMinutesSintesi` invece parte da zero. Dividere
 * il primo per il secondo significa attribuire mesi di lavoro alla prima
 * mezz'ora tracciata. Le voci FOCUS_SESSION portano invece minuti e
 * pagine della STESSA sessione, sulla stessa riga: le due grandezze sono
 * omogenee per costruzione. Mediana, non media: una sessione anomala non
 * deve spostare la percezione di tutto il resto.
 *
 * V42 — per TIPO: le sessioni che hanno lavorato un solo tipo di fonte
 * (`pagineFontePerTipo`) misurano il ritmo di quel tipo.
 */
export function computeSintesiPagesPerHour(starLog) {
  const rates = [];
  const perTipoValori = {};
  (Array.isArray(starLog) ? starLog : []).forEach((e) => {
    if (!e || e.type !== 'FOCUS_SESSION' || e.workMode !== WORK_MODE.SINTESI) return;
    const minuti = Number(e.minutes);
    const pagine = Number(e.pagineFonte);
    if (!Number.isFinite(minuti) || minuti <= 0) return;
    if (!Number.isFinite(pagine) || pagine <= 0) return;
    const r = pagine / (minuti / 60);
    rates.push(r);
    const pt = e.pagineFontePerTipo && typeof e.pagineFontePerTipo === 'object' ? e.pagineFontePerTipo : null;
    if (pt) {
      const tipi = Object.keys(pt).filter((t) => FONTE_TIPO[t] && Number(pt[t]) > 0);
      if (tipi.length === 1) (perTipoValori[tipi[0]] = perTipoValori[tipi[0]] || []).push(r);
    }
  });

  const g = misura(rates, SINTESI_PAGES_MIN, SINTESI_PAGES_MAX, SINTESI_MIN_SAMPLES, DEFAULT_SINTESI_PAGES_PER_HOUR, 10);
  const perTipo = {};
  TIPI.forEach((t) => {
    const v = misura(perTipoValori[t] || [], SINTESI_PAGES_MIN, SINTESI_PAGES_MAX, SINTESI_MIN_SAMPLES, DEFAULT_SINTESI_RITMO_PER_TIPO[t], 10);
    perTipo[t] = { pagesPerHour: v.value, confident: v.confident, sampleSize: v.sampleSize };
  });
  return { pagesPerHour: g.value, confident: g.confident, sampleSize: g.sampleSize, perTipo };
}

/* ------------------------------------------------------------------ *
 * IL BILANCIO DI UN NODO
 * ------------------------------------------------------------------ */

function positiveOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * La calibrazione ridotta a ciò che serve a questo modulo. Accetta sia il
 * pacchetto completo di utils/calibration.js sia uno parziale (test,
 * chiamanti storici che passano solo `biasFactor` o `resaSintesi`).
 */
export function resolveSintesiCalibration(calibration) {
  const biasFactor = positiveOrNull(calibration?.biasFactor) || 1;
  const sintesiGlobale = positiveOrNull(calibration?.sintesiPagesPerHour);
  const resaGlobale = positiveOrNull(calibration?.resaSintesi);
  const ritmoTipo = {};
  const resaTipo = {};
  TIPI.forEach((t) => {
    ritmoTipo[t] = positiveOrNull(calibration?.sintesiRitmoPerTipo?.[t]);
    resaTipo[t] = positiveOrNull(calibration?.resaPerTipo?.[t]);
  });
  return {
    biasFactor,
    // `null` = non misurato: vedi il caso 3 della metà studio in
    // nodeWorkBreakdown per come viene trattato.
    studioPerOra: positiveOrNull(calibration?.pagesPerHour),
    sintesiPerOra: sintesiGlobale || DEFAULT_SINTESI_PAGES_PER_HOUR,
    sintesiMisurato: !!sintesiGlobale,
    resa: resaGlobale ? clamp(resaGlobale, RESA_MIN, RESA_MAX) : DEFAULT_RESA_SINTESI,
    resaMisurata: !!resaGlobale,
    ritmoTipo,
    resaTipo,
    _risolta: true
  };
}

function risolta(calibration) {
  return calibration && calibration._risolta ? calibration : resolveSintesiCalibration(calibration);
}

/**
 * Ritmo di sintesi per un tipo di fonte: misurato per quel tipo, oppure il
 * default del tipo riscalato sul tuo ritmo globale misurato, oppure il
 * default puro.
 */
export function ritmoPerTipo(tipo, calibration) {
  const cal = risolta(calibration);
  const t = tipoValido(tipo);
  if (cal.ritmoTipo[t]) return cal.ritmoTipo[t];
  const base = DEFAULT_SINTESI_RITMO_PER_TIPO[t];
  if (cal.sintesiMisurato) return clamp(base * (cal.sintesiPerOra / DEFAULT_SINTESI_PAGES_PER_HOUR), SINTESI_PAGES_MIN, SINTESI_PAGES_MAX);
  return base;
}

/** Resa per un tipo di fonte, con la stessa logica del ritmo. */
export function resaPerTipo(tipo, calibration) {
  const cal = risolta(calibration);
  const t = tipoValido(tipo);
  if (cal.resaTipo[t]) return clamp(cal.resaTipo[t], RESA_MIN, RESA_MAX);
  const base = DEFAULT_RESA_PER_TIPO[t];
  if (cal.resaMisurata) return clamp(base * (cal.resa / DEFAULT_RESA_SINTESI), RESA_MIN, RESA_MAX);
  return base;
}

/**
 * V42 — Un argomento aperto non costa mai zero. Chi ha già speso più ore
 * della stima e non l'ha chiuso ha ancora qualcosa da fare: prima quel
 * nodo valeva 0 ore, usciva dal piano e la Fine Prevista diventava
 * "domani" con quattro argomenti ancora aperti.
 */
export const RESIDUO_MINIMO_ORE = 0.5;
export const RESIDUO_MINIMO_QUOTA = 0.25;

/**
 * Il bilancio completo di UN nodo: le due metà del lavoro, quanto ne
 * resta di ciascuna, e quale delle due ha senso fare adesso.
 *
 * Regola di composizione — il punto delicato di tutto il file:
 *
 *   ore totali = ore di SINTESI + ore di STUDIO
 *
 * dove la parte di studio, quando le pagine di appunti non sono note e
 * nessun ritmo è stato misurato, ricade sulle "Ore previste" dichiarate
 * del nodo. Questo NON doppia il conto: `oreStimate` ha sempre
 * significato "ore per studiare questo argomento", mai "ore per
 * produrre il materiale". Le ore di sintesi sono lavoro che prima
 * semplicemente non veniva contato da nessuna parte.
 */
export function nodeWorkBreakdown(sfida, calibration = null) {
  const cal = risolta(calibration);
  const src = nodeSources(sfida);
  const notes = nodeNotes(sfida, cal);
  const completato = sfida?.status === PERSISTED_STATUS.COMPLETED;

  // --- metà SINTESI (V42: per tipo di fonte) -------------------------
  let oreSintesiTotali = 0;
  let oreSintesiResidue = 0;
  Object.entries(src.perTipo).forEach(([t, v]) => {
    const ritmo = ritmoPerTipo(t, cal);
    oreSintesiTotali += v.totali / ritmo;
    if (!src.conclusa) oreSintesiResidue += v.residue / ritmo;
  });
  oreSintesiTotali = round2(oreSintesiTotali);
  oreSintesiResidue = round2(oreSintesiResidue);

  // --- metà STUDIO --------------------------------------------------
  //
  // Tre casi:
  //  1. ritmo di studio MISURATO e pagine note -> pagine / ritmo;
  //  2. nessuna pagina -> le "Ore previste" dichiarate, corrette dal bias;
  //  3. pagine note ma ritmo NON ancora misurato: la stima più PRUDENTE
  //     fra le ore dichiarate e le pagine a un ritmo standard
  //     (DEFAULT_PAGES_PER_HOUR). Il risultato si marca `studioStimato`.
  const oreDichiarate = round2(Math.max(0.5, Number(sfida?.oreStimate) || 0) * cal.biasFactor);
  let oreStudioTotali;
  let studioDaPagine = false;
  let studioStimato = false;
  if (notes.proiettate > 0 && cal.studioPerOra) {
    oreStudioTotali = Math.max(0.5, round2(notes.proiettate / cal.studioPerOra));
    studioDaPagine = true;
  } else if (notes.proiettate > 0) {
    const oreDaPagine = round2(notes.proiettate / DEFAULT_PAGES_PER_HOUR);
    oreStudioTotali = Math.max(0.5, oreDichiarate, oreDaPagine);
    studioDaPagine = oreDaPagine > oreDichiarate;
    studioStimato = true;
  } else {
    oreStudioTotali = oreDichiarate;
  }
  const oreStudioResidue = completato ? 0 : oreStudioTotali;

  // Ore di studio GIÀ fatte su questo nodo: solo il tempo speso
  // studiando, mai quello speso a snellire (già contato in pagine) né a
  // ripassare (V42: `minutiRipasso` vive a parte). I nodi salvati prima
  // della separazione non hanno il campo: se dichiarano fonti non si può
  // sapere come quelle ore siano state spese e non si sottrae niente
  // (prudente); se non ne dichiarano, tutte le loro ore sono di studio.
  const minutiStudio = Number.isFinite(Number(sfida?.focusMinutesStudio))
    ? Math.max(0, Number(sfida.focusMinutesStudio))
    : src.totali > 0
    ? 0
    : Math.max(0, Number(sfida?.focusMinutes) || 0);
  const oreStudioTracciate = round2(minutiStudio / 60);
  const residuoMinimo = Math.max(RESIDUO_MINIMO_ORE, round2(oreStudioTotali * RESIDUO_MINIMO_QUOTA));
  const oreStudioResidueNette = completato
    ? 0
    : Math.max(Math.min(oreStudioResidue, residuoMinimo), round2(oreStudioResidue - oreStudioTracciate));
  const oltreStima = !completato && oreStudioTracciate >= oreStudioResidue;

  const oreTotali = round2(oreSintesiTotali + oreStudioTotali);
  const oreResidue = round2(oreSintesiResidue + oreStudioResidueNette);

  // Quale dei due lavori ha senso fare su questo nodo, adesso.
  //  - resta fonte da snellire e gli appunti non bastano ancora a
  //    riempire una sessione -> SINTESI (non puoi studiare ciò che non
  //    hai ancora scritto);
  //  - altrimenti STUDIO.
  const modo = !completato && src.residue > 0 && !src.conclusa ? WORK_MODE.SINTESI : WORK_MODE.STUDIO;

  return {
    // fonti
    fontiTotali: src.totali,
    fontiFatte: src.fatte,
    fontiResidue: src.residue,
    fontiPct: src.pct,
    fontiPerTipo: src.perTipo,
    sintesiConclusa: src.conclusa,
    haFonti: src.totali > 0,
    // appunti
    pagineAppunti: notes.attuali,
    pagineAppuntiDaProdurre: notes.daProdurre,
    pagineAppuntiProiettate: notes.proiettate,
    pagineAppuntiStimate: notes.stimaAttuali,
    pagineAppuntiPreviste: notes.previste,
    pagineDichiarate: notes.dichiarate,
    // ore
    oreSintesiTotali,
    oreSintesiResidue,
    oreStudioTotali,
    oreStudioResidue,
    oreStudioTracciate,
    oreStudioResidueNette,
    oreTotali,
    oreResidue,
    oltreStima,
    // provenienza dei numeri, per una UI che non finge precisione
    studioDaPagine,
    studioStimato,
    sintesiStimata: src.totali > 0 && !cal.sintesiMisurato && !Object.keys(src.perTipo).every((t) => cal.ritmoTipo[t]),
    proiezioneStimata: notes.daProdurre > 0 && !cal.resaMisurata && notes.previste <= 0,
    modo,
    completato
  };
}

/**
 * Costo TOTALE di un nodo da zero, in ore — la somma delle due metà.
 * È il numero che `materiaMeta.nodeBudgetHours` restituisce a tutta
 * l'app, e quindi il punto in cui le fonti entrano automaticamente in
 * Quota Odierna, Fine Prevista, Spider-Score, Exam Readiness, budget
 * giornaliero e stima di laurea senza che nessuno di quei motori sappia
 * che esistono.
 */
export function nodeTotalHours(sfida, calibration = null) {
  return nodeWorkBreakdown(sfida, calibration).oreTotali;
}

/** Ore ancora davanti su un nodo (tiene conto della sintesi già fatta). */
export function nodeRemainingHours(sfida, calibration = null) {
  return nodeWorkBreakdown(sfida, calibration).oreResidue;
}

/* ------------------------------------------------------------------ *
 * IL PIANO DI UNA MATERIA
 * ------------------------------------------------------------------ */

export const RACCOMANDAZIONE = {
  SINTESI: 'SINTESI',
  STUDIO: 'STUDIO',
  MISTO: 'MISTO',
  NESSUNA: 'NESSUNA'
};

/**
 * Il piano di una Materia: i due bilanci sommati, la data entro cui gli
 * appunti vanno chiusi, la quota di pagine da snellire oggi e il
 * consiglio su cosa fare.
 *
 * LA DATA DI CHIUSURA APPUNTI è il numero che rende utile tutto il
 * resto. Gli appunti non servono "per l'esame": servono abbastanza
 * prima dell'esame da lasciare il tempo di studiarli. Quel margine si
 * calcola — ore di studio proiettate diviso la tua capacità reale
 * giornaliera — e sottratto dalla data d'esame dà una scadenza vera,
 * sempre più vicina di quella che uno si immagina.
 *
 * Senza data d'esame (materia recuperata in autonomia, il caso "parto
 * da zero in sessione") non c'è scadenza: resta il bilancio delle ore e
 * il consiglio, che è comunque ciò che serve per decidere oggi.
 */
export function materiaSintesiPlan(materia, calibration = null, { chiusuraAppunti = undefined } = {}) {
  const vuoto = {
    attiva: false,
    haFonti: false,
    fontiTotali: 0,
    fontiFatte: 0,
    fontiResidue: 0,
    fontiPct: 0,
    pagineAppunti: 0,
    pagineAppuntiProiettate: 0,
    oreSintesiResidue: 0,
    oreStudioResidue: 0,
    oreResidue: 0,
    nodiDaSnellire: 0,
    nodiPronti: 0,
    dataChiusuraAppunti: null,
    giorniAllaChiusura: null,
    giorniPerStudio: 0,
    quotaSintesiOggi: 0,
    inRitardo: false,
    raccomandazione: RACCOMANDAZIONE.NESSUNA,
    motivo: '',
    stimato: false
  };

  if (!materia || materia.examPassed) return vuoto;
  const sfide = Array.isArray(materia.sfide) ? materia.sfide : [];
  if (sfide.length === 0) return vuoto;

  const cal = risolta(calibration);
  const hoursPerDay = Number(calibration?.hoursPerDay) > 0 ? Number(calibration.hoursPerDay) : HOURS_PER_NODE_DAY;

  let fontiTotali = 0;
  let fontiFatte = 0;
  let fontiResidue = 0;
  let pagineAppunti = 0;
  let pagineAppuntiProiettate = 0;
  let oreSintesiResidue = 0;
  let oreStudioResidue = 0;
  let nodiDaSnellire = 0;
  let nodiPronti = 0;
  let sintesiStimata = false;

  sfide.forEach((s) => {
    const b = nodeWorkBreakdown(s, calibration);
    fontiTotali += b.fontiTotali;
    fontiFatte += b.fontiFatte;
    pagineAppunti += b.pagineAppunti;
    // Le pagine di appunti PROIETTATE sono il totale che esisterà a
    // fine corsa, quindi comprendono anche quelle dei nodi già chiusi:
    // escluderle faceva leggere "FONTI 200/200 · APPUNTI FINALI 0" su
    // una materia completata, cioè un numero palesemente falso proprio
    // dove il pannello dovrebbe dare soddisfazione.
    pagineAppuntiProiettate += b.completato ? b.pagineAppunti : b.pagineAppuntiProiettate;
    if (b.completato) return;
    // V39.0 — le pagine di un nodo con la sintesi dichiarata chiusa NON
    // sono "da snellire": la spunta esiste proprio per dire che quelle
    // pagine non le lavorerai. Contarle produceva una quota giornaliera
    // e una data di chiusura per un lavoro già dichiarato finito.
    if (!b.sintesiConclusa) fontiResidue += b.fontiResidue;
    oreSintesiResidue += b.oreSintesiResidue;
    oreStudioResidue += b.oreStudioResidueNette;
    if (b.oreSintesiResidue > 0) nodiDaSnellire += 1;
    // "Pronto" = materiale TUO già utilizzabile e non ancora studiato.
    // V39.0 — anche un nodo SENZA fonti è pronto se ha appunti propri:
    // prima contavano solo i nodi con sintesi chiusa, e cinque argomenti
    // con 20 pagine di appunti ciascuno davano "non c'è ancora materiale
    // tuo pronto".
    if ((!b.haFonti || b.sintesiConclusa) && b.pagineAppunti > 0 && b.oreStudioResidueNette > 0) nodiPronti += 1;
    if (b.sintesiStimata) sintesiStimata = true;
  });

  if (fontiTotali === 0 && pagineAppunti === 0) {
    // Nessuna fonte e nessun appunto dichiarato: la materia sta
    // lavorando col modello V37 (sole ore stimate) e questo pannello
    // non ha niente da dire. Meglio tacere che riempire lo schermo.
    return { ...vuoto, oreStudioResidue: round2(oreStudioResidue), oreResidue: round2(oreStudioResidue) };
  }

  oreSintesiResidue = round2(oreSintesiResidue);
  oreStudioResidue = round2(oreStudioResidue);

  // --- la scadenza interna degli appunti ----------------------------
  const giorniPerStudio =
    oreStudioResidue >= CHIUSURA_MIN_ORE_STUDIO ? Math.max(1, Math.ceil(oreStudioResidue / hoursPerDay)) : 0;
  // V42 — con il piano globale (utils/studyPlanner.js) la data arriva da
  // fuori: è l'ultimo giorno utile TENENDO CONTO di tutte le materie che
  // si contendono le stesse giornate. Tre esami a gennaio con 40 ore di
  // studio ciascuno chiudono gli appunti a fine dicembre, non ognuno
  // "dieci giorni prima del suo esame" come se fosse l'unico.
  const chiusuraGlobale = typeof chiusuraAppunti === 'string' && chiusuraAppunti.length === 10 ? chiusuraAppunti : null;
  const dataChiusuraAppunti =
    fontiResidue > 0
      ? chiusuraGlobale || (materia.examDate ? addDaysToDateOnly(materia.examDate, -giorniPerStudio) : null)
      : null;
  const giorniAllaChiusura = dataChiusuraAppunti ? daysUntilDateOnly(dataChiusuraAppunti) : null;
  // V39.0 — "in ritardo" anche quando la scadenza non è ancora passata ma
  // la sintesi che resta NON CI STA nei giorni che mancano: 600 pagine in
  // 10 giorni sono 10h/giorno di sola sintesi contro una capacità di 4.5,
  // e prima l'avviso restava spento fino al giorno della scadenza.
  const sintesiNonCiSta =
    giorniAllaChiusura != null && giorniAllaChiusura > 0 && oreSintesiResidue / giorniAllaChiusura > hoursPerDay;
  const inRitardo = fontiResidue > 0 && giorniAllaChiusura != null && (giorniAllaChiusura <= 0 || sintesiNonCiSta);

  // Quota di pagine di fonte da snellire oggi per arrivare in tempo.
  // Con la scadenza già passata la quota è tutto il residuo: il numero
  // resta onesto e dice da solo che il piano va rinegoziato.
  let quotaSintesiOggi = 0;
  if (fontiResidue > 0) {
    if (giorniAllaChiusura == null) {
      quotaSintesiOggi = Math.ceil(fontiResidue / 7); // nessuna scadenza: ritmo settimanale
    } else if (giorniAllaChiusura > 0) {
      quotaSintesiOggi = Math.ceil(fontiResidue / giorniAllaChiusura);
    } else {
      quotaSintesiOggi = fontiResidue;
    }
  }

  // --- il consiglio -------------------------------------------------
  let raccomandazione = RACCOMANDAZIONE.NESSUNA;
  let motivo = '';
  if (fontiResidue === 0 && oreStudioResidue > 0) {
    raccomandazione = RACCOMANDAZIONE.STUDIO;
    motivo = 'Gli appunti sono chiusi: da qui in avanti è tutto studio.';
  } else if (fontiResidue > 0 && inRitardo) {
    raccomandazione = RACCOMANDAZIONE.SINTESI;
    motivo = sintesiNonCiSta
      ? `La sintesi che resta non ci sta: ${Math.round(oreSintesiResidue)}h di lavoro in ${giorniAllaChiusura} giorni, più della tua capacità giornaliera. Sposta l'appello o taglia le fonti meno utili.`
      : `Sei oltre la data di chiusura appunti: restano ${fontiResidue} pagine di fonte e servono ${giorniPerStudio} giorni per studiare quello che ne uscirà.`;
  } else if (fontiResidue > 0 && nodiPronti === 0) {
    raccomandazione = RACCOMANDAZIONE.SINTESI;
    motivo = 'Non c’è ancora materiale tuo pronto: non puoi studiare quello che non hai ancora scritto.';
  } else if (fontiResidue > 0) {
    raccomandazione = RACCOMANDAZIONE.MISTO;
    motivo = `${quotaSintesiOggi} pagine di fonte oggi per restare in linea, il resto della giornata sugli argomenti già pronti.`;
  } else if (oreStudioResidue > 0) {
    raccomandazione = RACCOMANDAZIONE.STUDIO;
    motivo = 'Tutto il materiale è pronto.';
  }

  return {
    attiva: true,
    haFonti: fontiTotali > 0,
    fontiTotali,
    fontiFatte,
    fontiResidue,
    fontiPct: fontiTotali > 0 ? Math.round((fontiFatte / fontiTotali) * 100) : 0,
    pagineAppunti,
    pagineAppuntiProiettate: Math.round(pagineAppuntiProiettate),
    oreSintesiResidue,
    oreStudioResidue,
    oreResidue: round2(oreSintesiResidue + oreStudioResidue),
    nodiDaSnellire,
    nodiPronti,
    dataChiusuraAppunti,
    giorniAllaChiusura,
    giorniPerStudio,
    quotaSintesiOggi,
    inRitardo,
    sintesiNonCiSta,
    raccomandazione,
    motivo,
    // `true` = almeno un numero di questo piano poggia su un default e
    // non su una misura. La UI lo dichiara invece di far finta.
    stimato: sintesiStimata || (fontiResidue > 0 && !cal.resaMisurata)
  };
}

/**
 * Il modo di lavoro da proporre di default aprendo una sessione su un
 * nodo. Serve al Tactical Debriefing (che deve preselezionare qualcosa
 * di giusto nel 90% dei casi senza chiedere nulla) e a Mission Control.
 */
export function suggestedWorkMode(sfida, { dueReview = false } = {}) {
  if (!sfida) return WORK_MODE.STUDIO;
  // V42 — su un argomento già completato una sessione è un ripasso.
  if (dueReview || sfida.status === PERSISTED_STATUS.COMPLETED) return WORK_MODE.RIPASSO;
  const src = nodeSources(sfida);
  if (src.totali > 0 && src.residue > 0 && !src.conclusa) return WORK_MODE.SINTESI;
  return WORK_MODE.STUDIO;
}

/**
 * Distribuisce N pagine di fonte snellite sulle fonti del nodo, in
 * ordine: si riempie la prima non finita, l'eccedenza passa alla
 * successiva. Ordine e non proporzione perché è come si lavora davvero
 * — si finisce il capitolo del libro, poi si passa alle slide — e
 * perché un riparto proporzionale renderebbe impossibile vedere una
 * singola fonte arrivare al 100%.
 *
 * Restituisce sempre un array NUOVO (il reducer non muta mai lo stato).
 */
export function applySintesiProgress(fonti, pagine) {
  let restanti = toPositiveInt(pagine);
  if (restanti <= 0) return Array.isArray(fonti) ? fonti : [];
  return (Array.isArray(fonti) ? fonti : []).map((f) => {
    const totali = toPositiveInt(f?.pagine);
    const fatte = clamp(toPositiveInt(f?.pagineFatte), 0, totali);
    if (restanti <= 0 || fatte >= totali) return f;
    const spazio = totali - fatte;
    const quota = Math.min(spazio, restanti);
    restanti -= quota;
    return { ...f, pagineFatte: fatte + quota };
  });
}

/**
 * Suggerimento di pagine per il Debriefing: quante pagine ci si aspetta
 * che una sessione di N minuti abbia coperto, al ritmo corrente.
 * Serve come PLACEHOLDER, mai come valore precompilato — un numero
 * inserito dall'app e poi misurato dall'app come se fosse un dato reale
 * congelerebbe il ritmo sul suo stesso valore di partenza.
 */
export function suggestPagesForSession(minutes, calibration, mode = WORK_MODE.SINTESI) {
  const cal = risolta(calibration);
  const ore = Math.max(0, Number(minutes) || 0) / 60;
  if (ore <= 0) return 0;
  const ritmo = mode === WORK_MODE.SINTESI ? cal.sintesiPerOra : cal.studioPerOra;
  if (!ritmo) return 0;
  return Math.max(1, Math.round(ore * ritmo));
}
