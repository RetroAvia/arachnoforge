/**
 * V39.0 — Identità di sincronizzazione e confronto stabile degli stati.
 *
 * Ogni salvataggio sul Cloud porta con sé una piccola firma
 * (`app_state._sync`): chi l'ha scritto (la scheda aperta in questo
 * momento), da quale dispositivo (il browser) e quando. Serve a una cosa
 * sola: quando una scrittura condizionale fallisce, capire se la riga è
 * stata cambiata DA NOI (una nostra scrittura precedente, un doppio
 * salvataggio, una risposta di rete persa) — nel qual caso non c'è nessun
 * conflitto da mostrare — oppure da un altro dispositivo o da un'altra
 * scheda, e solo allora chiedere quale versione tenere.
 *
 * Modulo puro, senza React: testabile da Node.
 */

const DEVICE_ID_KEY = 'arachnoforge-device-id';

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Id della scheda/sessione corrente: nuovo a ogni montaggio del Provider. */
export function createSessionId() {
  return randomId('s');
}

/** Id stabile del browser (localStorage). Mai lancia: in navigazione privata o con storage bloccato torna un id volatile. */
export function getDeviceId(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    if (!storage) return randomId('d_volatile');
    let id = storage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = randomId('d');
      storage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return randomId('d_volatile');
  }
}

/** Copia superficiale dello stato senza la firma di sincronizzazione. */
export function stripSync(appState) {
  if (!appState || typeof appState !== 'object') return appState;
  if (!Object.prototype.hasOwnProperty.call(appState, '_sync')) return appState;
  const { _sync, ...rest } = appState;
  return rest;
}

/**
 * JSON con chiavi ordinate a ogni livello. Postgres (`jsonb`) riordina le
 * chiavi degli oggetti: due stati identici letti da lì e dalla memoria
 * producono stringhe diverse con un semplice JSON.stringify. Qui no.
 * `undefined` sparisce come in JSON.stringify.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined || typeof v === 'function' ? 'null' : stableStringify(v))).join(',')}]`;
  }
  if (typeof value.toJSON === 'function') return stableStringify(value.toJSON());
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined && typeof value[k] !== 'function')
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** Due `app_state` hanno lo stesso contenuto, firma di sincronizzazione esclusa? */
export function sameAppState(a, b) {
  if (!a || !b) return false;
  try {
    return stableStringify(stripSync(a)) === stableStringify(stripSync(b));
  } catch {
    return false;
  }
}

/**
 * Classifica una versione remota trovata al posto di quella attesa.
 *   'own'        — l'abbiamo scritta noi (questa scheda) o ha lo stesso
 *                  contenuto di una versione che conoscevamo già: nessun
 *                  conflitto reale, si adotta il nuovo token e si riprova.
 *   'sameDevice' — scritta da un'altra scheda/finestra di questo browser.
 *   'foreign'    — scritta da un altro dispositivo.
 */
export function classifyRemoteWrite(remoteAppState, { sessionId, deviceId, knownStates = [] } = {}) {
  if (!remoteAppState || typeof remoteAppState !== 'object') return 'foreign';
  const sig = remoteAppState._sync;
  // `sessionId` può essere un elenco: la sessione corrente più quella che
  // aveva scritto un checkpoint recuperato al boot (stesso lavoro, pagina
  // ricaricata).
  const own = (Array.isArray(sessionId) ? sessionId : [sessionId]).filter(Boolean);
  if (sig && own.includes(sig.writer)) return 'own';
  if (knownStates.some((known) => known && sameAppState(remoteAppState, known))) return 'own';
  if (sig && deviceId && sig.device === deviceId) return 'sameDevice';
  return 'foreign';
}
