// =====================================================================
// ArachnoForge — src/utils/appelli.js (V42)
// Gli APPELLI di una materia: scritto e orale, più date nella sessione.
//
// Fino alla V41 una materia aveva UNA data d'esame. Ma un esame di
// ingegneria è quasi sempre scritto + orale a distanza di giorni, e ogni
// sessione offre più appelli: il giorno dopo lo scritto la data risultava
// "passata", la prontezza diventava "dati insufficienti" e i ripassi
// perdevano la scadenza proprio mentre preparavi l'orale.
//
// Ora ogni materia ha una lista di appelli ({ scritto, orale }) e ne
// sceglie uno come obiettivo. `examDate` / `oralDate` restano sul dato,
// derivati dall'appello scelto, così tutto il resto dell'app continua a
// leggere gli stessi campi; per PIANIFICARE si usa la prossima prova
// ancora davanti (lo scritto, poi l'orale) — vedi `planningExamDate`.
// =====================================================================
import { isValidDateKey, todayDateOnlyKey, addDaysToDateOnly } from './dateUtils.js';

export const FORMATO_ESAME = {
  SCRITTO_ORALE: 'SCRITTO_ORALE',
  SOLO_SCRITTO: 'SOLO_SCRITTO',
  SOLO_ORALE: 'SOLO_ORALE',
  PROGETTO_ORALE: 'PROGETTO_ORALE',
  IDONEITA: 'IDONEITA'
};

export const FORMATO_ESAME_META = {
  SCRITTO_ORALE: { label: 'Scritto + orale', short: 'Scritto+orale', haScritto: true, haOrale: true, primaLabel: 'Scritto', secondaLabel: 'Orale' },
  SOLO_SCRITTO: { label: 'Solo scritto', short: 'Scritto', haScritto: true, haOrale: false, primaLabel: 'Scritto', secondaLabel: null },
  SOLO_ORALE: { label: 'Solo orale', short: 'Orale', haScritto: false, haOrale: true, primaLabel: null, secondaLabel: 'Orale' },
  PROGETTO_ORALE: { label: 'Progetto + orale', short: 'Progetto+orale', haScritto: true, haOrale: true, primaLabel: 'Consegna progetto', secondaLabel: 'Orale' },
  IDONEITA: { label: 'Idoneità (senza voto)', short: 'Idoneità', haScritto: true, haOrale: false, primaLabel: 'Prova', secondaLabel: null }
};

/** Esiti possibili di un appello, dichiarati dopo la data. */
export const ESITO_APPELLO = {
  SUPERATO: 'SUPERATO',
  NON_SUPERATO: 'NON_SUPERATO',
  IN_ATTESA: 'IN_ATTESA'
};

/** "Aspetto l'esito" sospende la domanda per questi giorni. */
export const GIORNI_ATTESA_ESITO = 10;

export function isFormatoEsame(v) {
  return typeof v === 'string' && !!FORMATO_ESAME[v];
}

export function formatoMeta(materia) {
  return FORMATO_ESAME_META[isFormatoEsame(materia?.formatoEsame) ? materia.formatoEsame : FORMATO_ESAME.SCRITTO_ORALE];
}

/** L'esame ha una parte scritta (esercizi, problemi)? */
export function haProvaScritta(materia) {
  const f = isFormatoEsame(materia?.formatoEsame) ? materia.formatoEsame : FORMATO_ESAME.SCRITTO_ORALE;
  return f === FORMATO_ESAME.SCRITTO_ORALE || f === FORMATO_ESAME.SOLO_SCRITTO;
}

function cleanDate(v) {
  if (typeof v !== 'string') return null;
  const d = v.slice(0, 10);
  return isValidDateKey(d) ? d : null;
}

let seq = 0;
function newId() {
  seq = (seq + 1) % 1000;
  return `app_${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createAppello({ scritto = null, orale = null, nota = '' } = {}) {
  let s = cleanDate(scritto);
  let o = cleanDate(orale);
  // L'orale non viene mai prima dello scritto: date invertite si scambiano.
  if (s && o && o < s) [s, o] = [o, s];
  return {
    id: newId(),
    scritto: s,
    orale: o,
    nota: typeof nota === 'string' ? nota.slice(0, 80) : '',
    esito: null,
    esitoAt: null
  };
}

/** Normalizza la lista (import, migrazione, form): scarta gli appelli senza date. */
export function normalizeAppelli(raw) {
  if (!Array.isArray(raw)) return [];
  const visti = new Set();
  return raw
    .filter((a) => a && typeof a === 'object')
    .map((a) => {
      const base = createAppello(a);
      const id = typeof a.id === 'string' && a.id && !visti.has(a.id) ? a.id : base.id;
      visti.add(id);
      return {
        ...base,
        id,
        esito: ESITO_APPELLO[a.esito] ? a.esito : null,
        esitoAt: typeof a.esitoAt === 'string' ? a.esitoAt : null
      };
    })
    .filter((a) => a.scritto || a.orale)
    .sort((a, b) => primaData(a).localeCompare(primaData(b)));
}

/** La prima prova di un appello (scritto, o l'orale se non c'è scritto). */
export function primaData(appello) {
  return appello?.scritto || appello?.orale || '';
}

/** L'ultima prova di un appello (l'orale, se c'è). */
export function ultimaData(appello) {
  return appello?.orale || appello?.scritto || '';
}

/** L'appello scelto come obiettivo (o, se l'id non torna, il primo ancora aperto). */
export function targetAppello(materia, todayKey = todayDateOnlyKey()) {
  const lista = Array.isArray(materia?.appelli) ? materia.appelli : [];
  if (lista.length === 0) return null;
  const scelto = lista.find((a) => a.id === materia.appelloTargetId);
  if (scelto) return scelto;
  return lista.find((a) => ultimaData(a) >= todayKey && a.esito !== ESITO_APPELLO.NON_SUPERATO) || null;
}

/**
 * I campi derivati da scrivere sulla materia: `examDate` = prima prova
 * dell'appello obiettivo, `oralDate` = l'orale quando c'è anche lo scritto.
 */
export function derivedExamFields(materia, todayKey = todayDateOnlyKey()) {
  const t = targetAppello(materia, todayKey);
  if (!t) return { examDate: null, oralDate: null, appelloTargetId: null };
  return {
    examDate: primaData(t) || null,
    oralDate: t.scritto && t.orale ? t.orale : null,
    appelloTargetId: t.id
  };
}

/**
 * Riallinea una materia: lista normalizzata + campi derivati. Una materia
 * pre-V42 con la sola `examDate` riceve un appello equivalente, così
 * niente si perde e il form mostra subito la data che conosci.
 */
export function syncAppelli(materia, todayKey = todayDateOnlyKey()) {
  if (!materia || typeof materia !== 'object') return materia;
  let appelli = normalizeAppelli(materia.appelli);
  let appelloTargetId = typeof materia.appelloTargetId === 'string' ? materia.appelloTargetId : null;
  const legacy = cleanDate(materia.examDate);
  if (appelli.length === 0 && legacy) {
    const formato = isFormatoEsame(materia.formatoEsame) ? materia.formatoEsame : FORMATO_ESAME.SCRITTO_ORALE;
    const soloOrale = formato === FORMATO_ESAME.SOLO_ORALE;
    const a = createAppello({ scritto: soloOrale ? null : legacy, orale: soloOrale ? legacy : cleanDate(materia.oralDate) });
    a.id = `app_legacy_${materia.id || 'm'}`;
    appelli = [a];
    appelloTargetId = a.id;
  }
  const withList = { ...materia, appelli, appelloTargetId };
  return { ...withList, ...derivedExamFields(withList, todayKey) };
}

/**
 * La data da usare per PIANIFICARE oggi: la prossima prova ancora davanti
 * dell'appello obiettivo (lo scritto; passato lo scritto, l'orale). Se
 * sono passate entrambe resta la prima, e i motori la trattano come data
 * scaduta (appello sostenuto, in attesa di esito).
 */
export function planningExamDate(materia, todayKey = todayDateOnlyKey()) {
  const exam = cleanDate(materia?.examDate);
  const oral = cleanDate(materia?.oralDate);
  if (exam && exam >= todayKey) return exam;
  if (oral && oral >= todayKey) return oral;
  return exam || oral || null;
}

/** Quale prova è la prossima: 'SCRITTO' | 'ORALE' | null. */
export function nextProvaTipo(materia, todayKey = todayDateOnlyKey()) {
  const exam = cleanDate(materia?.examDate);
  const oral = cleanDate(materia?.oralDate);
  const meta = formatoMeta(materia);
  if (exam && exam >= todayKey) return meta.haScritto && oral ? 'SCRITTO' : meta.haScritto ? 'SCRITTO' : 'ORALE';
  if (oral && oral >= todayKey) return 'ORALE';
  return null;
}

/**
 * Le materie con la data di pianificazione al posto di `examDate`: è la
 * vista che i motori del piano ricevono. Copie superficiali, mai mutate.
 */
export function withPlanningDates(materie, todayKey = todayDateOnlyKey()) {
  return (Array.isArray(materie) ? materie : []).map((m) => {
    if (!m || m.examPassed) return m;
    const d = planningExamDate(m, todayKey);
    return d === (m.examDate || null) ? m : { ...m, examDate: d, examDateScritto: m.examDate || null };
  });
}

/** Il prossimo appello dopo `appello` (per data), per proporlo dopo un esito negativo. */
export function nextAppelloAfter(materia, appello, todayKey = todayDateOnlyKey()) {
  const lista = Array.isArray(materia?.appelli) ? materia.appelli : [];
  const dopo = primaData(appello) || todayKey;
  return lista.find((a) => a.id !== appello?.id && primaData(a) > dopo && ultimaData(a) >= todayKey) || null;
}

/**
 * Serve chiedere com'è andata? Sì quando l'ultima prova dell'appello
 * obiettivo è passata, l'esame non è registrato come superato e non hai
 * detto "aspetto l'esito" negli ultimi giorni.
 * @returns {null|{appello, materia, tipo:'FINALE'|'SCRITTO', giorniFa:number}}
 */
export function appelloDaChiudere(materia, todayKey = todayDateOnlyKey()) {
  if (!materia || materia.examPassed) return null;
  const t = targetAppello(materia, todayKey);
  if (!t) return null;
  const fine = ultimaData(t);
  if (!fine || fine >= todayKey) {
    // Scritto passato e orale ancora davanti: nessuna domanda (si prepara
    // l'orale); l'esito dello scritto si dichiara solo se è andato male.
    return null;
  }
  if (t.esito === ESITO_APPELLO.NON_SUPERATO || t.esito === ESITO_APPELLO.SUPERATO) return null;
  if (t.esito === ESITO_APPELLO.IN_ATTESA && t.esitoAt) {
    const fino = addDaysToDateOnly(String(t.esitoAt).slice(0, 10), GIORNI_ATTESA_ESITO);
    if (fino >= todayKey) return null;
  }
  const giorniFa = Math.max(0, Math.round((Date.parse(todayKey) - Date.parse(fine)) / 86400000));
  return { appello: t, materia, tipo: 'FINALE', giorniFa };
}

/** Etichetta breve di un appello: "12 gen · orale 19 gen". */
export function appelloLabel(appello, fmt) {
  const f = typeof fmt === 'function' ? fmt : (d) => d;
  if (!appello) return '';
  if (appello.scritto && appello.orale) return `${f(appello.scritto)} · orale ${f(appello.orale)}`;
  return f(appello.scritto || appello.orale || '');
}
