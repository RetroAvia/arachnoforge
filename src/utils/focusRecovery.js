/**
 * V35.0 — "Sessione Blindata" (Focus Timer Durability Fix).
 *
 * Un blocco Focus che arriva naturalmente a zero NON viene dispatchato
 * subito al reducer: si accumula in `pendingFocus` (stato effimero di
 * useFocusTimer.js) finché l'utente non chiude volontariamente la
 * sessione dal Tactical Debriefing. Questo è per design (permette la
 * concatenazione Overdrive senza toccare il reducer ad ogni blocco), ma
 * finché quei minuti restano SOLO in memoria React non sopravvivono a
 * una chiusura scheda/refresh/crash del browser — persi per sempre.
 *
 * Questo modulo aggiunge un secondo, indipendente livello di durabilità
 * SENZA toccare la pipeline di persistenza Cloud esistente: un
 * checkpoint sincrono su LocalStorage, namespace per utente (stesso
 * pattern try/catch "mai un crash" già usato in utils/adminOverride.js),
 * scritto ad ogni variazione di `pendingFocus` e cancellato non appena
 * la sessione viene chiusa (debrief o Blood Pact). Al boot successivo,
 * se un checkpoint orfano viene trovato (la scheda precedente non ha mai
 * chiuso la sessione), viene recuperato e fatto confluire nella STESSA
 * action FOCUS_COMPLETED già collaudata — zero nuovo canale di scrittura
 * remota, il recupero converge sull'autosave Cloud esistente.
 */

const CHECKPOINT_PREFIX = 'arachnoforge_v35_focus_checkpoint_';

/**
 * V37.0 — Scadenza del checkpoint. `savedAt` veniva scritto ma non letto
 * da nessuno: un checkpoint abbandonato settimane prima veniva
 * accreditato al boot successivo come una sessione appena conclusa, con
 * XP, minuti e voce nello Star Log pieni. Oltre questa finestra il
 * checkpoint viene considerato "non più recuperabile" e scartato: una
 * sessione dimenticata da ieri sera si recupera, una di tre settimane fa
 * no — non è mai davvero avvenuta in quella forma.
 */
export const CHECKPOINT_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 ore

/** True se il checkpoint è troppo vecchio per essere accreditato. */
export function isCheckpointStale(parsed, nowMs = Date.now()) {
  if (!parsed) return true;
  const savedAt = Number(parsed.savedAt);
  // Un checkpoint senza timestamp viene da una versione precedente:
  // lo si accetta una sola volta invece di buttarlo (nessuna perdita
  // retroattiva di minuti già guadagnati).
  if (!Number.isFinite(savedAt) || savedAt <= 0) return false;
  return nowMs - savedAt > CHECKPOINT_MAX_AGE_MS;
}

export function focusCheckpointKey(userId) {
  return `${CHECKPOINT_PREFIX}${userId || 'anon'}`;
}

/** Scrittura sicura — mai un crash se LocalStorage è pieno, in modalità
 * privata, o disabilitato dal browser dell'utente (stesso contratto di
 * saveLocalState in adminOverride.js). */
export function saveFocusCheckpoint(userId, payload) {
  try {
    window.localStorage.setItem(focusCheckpointKey(userId), JSON.stringify({ ...payload, savedAt: Date.now() }));
    return true;
  } catch (err) {
    console.error('[ArachnoForge] Scrittura checkpoint Focus fallita.', err);
    return false;
  }
}

export function loadFocusCheckpoint(userId) {
  try {
    const raw = window.localStorage.getItem(focusCheckpointKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Number.isFinite(parsed.totalMinutes) || parsed.totalMinutes <= 0) return null;
    if (isCheckpointStale(parsed)) {
      // Pulizia immediata: un checkpoint scaduto non deve restare lì a
      // farsi ritrovare ad ogni boot successivo.
      clearFocusCheckpoint(userId);
      return null;
    }
    return parsed;
  } catch (err) {
    console.error('[ArachnoForge] Lettura checkpoint Focus fallita.', err);
    return null;
  }
}

export function clearFocusCheckpoint(userId) {
  try {
    window.localStorage.removeItem(focusCheckpointKey(userId));
  } catch {
    // Silenzioso per costruzione — stesso contratto "best effort" di
    // clearLocalState in adminOverride.js: mai un punto di fallimento
    // critico per il resto del flusso (debrief, logout, boot).
  }
}

/* ------------------------------------------------------------------ *
 * V41 — IL BLOCCO IN CORSO
 * ------------------------------------------------------------------ *
 * Il checkpoint qui sopra protegge i blocchi GIÀ finiti. Quello che stava
 * correndo, invece, spariva: un F5 per sbaglio, il browser che si chiude,
 * il telefono che uccide la PWA in secondo piano mentre studi dai tuoi
 * appunti di carta — e i minuti del blocco non esistevano più, con il
 * timer di nuovo a zero. Ora anche il blocco in corso ha il suo piccolo
 * record (istante di fine, oppure tempo residuo se in pausa), scritto a
 * ogni cambio di stato del timer e cancellato quando torna fermo.
 */
const RUNNING_PREFIX = 'arachnoforge_v41_running_block_';

export function runningBlockKey(userId) {
  return `${RUNNING_PREFIX}${userId || 'anon'}`;
}

export function saveRunningBlock(userId, record) {
  try {
    window.localStorage.setItem(runningBlockKey(userId), JSON.stringify({ ...record, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function loadRunningBlock(userId) {
  try {
    const raw = window.localStorage.getItem(runningBlockKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearRunningBlock(userId) {
  try {
    window.localStorage.removeItem(runningBlockKey(userId));
  } catch {
    /* best effort */
  }
}

/**
 * Cosa fare, al riavvio, di un blocco che stava correndo:
 *  - `resume`   non è ancora finito: riparte con lo stesso istante di fine;
 *  - `paused`   era in pausa: torna in pausa con lo stesso tempo residuo;
 *  - `complete` un blocco di FOCUS è finito mentre l'app era chiusa: i
 *               suoi minuti vanno in sospeso e si salvano col Debriefing
 *               (con la possibilità di non contarli);
 *  - `discard`  niente da recuperare (pausa finita, record troppo vecchio
 *               o illeggibile).
 * Funzione pura: il tempo arriva da fuori.
 */
export function planRunningBlockRestore(record, nowMs = Date.now()) {
  const discard = { action: 'discard' };
  if (!record || (record.mode !== 'FOCUS' && record.mode !== 'BREAK')) return discard;
  const totalSeconds = Number(record.totalSeconds);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return discard;
  const savedAt = Number(record.savedAt);
  if (!Number.isFinite(savedAt) || savedAt <= 0 || nowMs - savedAt > CHECKPOINT_MAX_AGE_MS) return discard;
  const totalMs = totalSeconds * 1000;

  if (record.pausedRemainingMs != null) {
    const paused = Number(record.pausedRemainingMs);
    if (!Number.isFinite(paused) || paused <= 0) return discard;
    return { action: 'paused', remainingMs: Math.min(paused, totalMs) };
  }

  const endsAt = Number(record.endsAt);
  if (!Number.isFinite(endsAt) || endsAt <= 0) return discard;
  if (endsAt > nowMs) {
    // Un orologio di sistema spostato non può allungare il blocco.
    const safeEndsAt = Math.min(endsAt, nowMs + totalMs);
    return { action: 'resume', endsAt: safeEndsAt, remainingMs: safeEndsAt - nowMs };
  }
  if (record.mode === 'FOCUS' && nowMs - endsAt <= CHECKPOINT_MAX_AGE_MS) {
    return { action: 'complete', minutes: Math.max(1, Math.round(totalSeconds / 60)) };
  }
  return discard;
}

/* ------------------------------------------------------------------ *
 * V41 — UNA SOLA FINESTRA ALLA VOLTA
 * ------------------------------------------------------------------ *
 * Con l'app aperta in due finestre (la PWA installata e il browser, o due
 * schede) la seconda trovava il record del blocco in corso e lo
 * "riprendeva": lo stesso blocco finiva due volte e i minuti venivano
 * accreditati due volte. La regola la fa un lucchetto Web Locks (vedi
 * useFocusTimer.js); questo "possesso" rinnovato ogni pochi secondi è la
 * riserva per i browser che non lo supportano: un'altra finestra non
 * recupera niente finché è vivo, e uno non rinnovato da LEASE_TTL_MS
 * appartiene a una finestra chiusa.
 */
const LEASE_PREFIX = 'arachnoforge_v41_focus_lease_';
const TAB_ID_KEY = 'arachnoforge_v41_tab_id';
export const LEASE_BEAT_MS = 10 * 1000;
// Ben oltre il minuto: in secondo piano i browser rallentano i timer a un
// giro al minuto, e una finestra viva non deve sembrare chiusa.
export const LEASE_TTL_MS = 90 * 1000;

export function focusLeaseKey(userId) {
  return `${LEASE_PREFIX}${userId || 'anon'}`;
}

/**
 * Identità di QUESTA finestra. Vive in sessionStorage: sopravvive a un
 * ricaricamento e al ripristino dopo un crash della stessa scheda (che
 * quindi riprende il proprio blocco), ma è diversa in ogni altra scheda.
 */
export function getTabId() {
  const nuovo = () => `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    let id = window.sessionStorage.getItem(TAB_ID_KEY);
    if (!id) {
      id = nuovo();
      window.sessionStorage.setItem(TAB_ID_KEY, id);
    }
    return id;
  } catch {
    return nuovo();
  }
}

export function readFocusLease(userId) {
  try {
    const raw = window.localStorage.getItem(focusLeaseKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.tabId === 'string' && Number.isFinite(parsed.at) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeFocusLease(userId, tabId) {
  try {
    window.localStorage.setItem(focusLeaseKey(userId), JSON.stringify({ tabId, at: Date.now() }));
  } catch {
    /* best effort */
  }
}

/** Rilascia il possesso solo se è ancora di questa finestra. */
export function releaseFocusLease(userId, tabId) {
  try {
    const lease = readFocusLease(userId);
    if (lease && lease.tabId === tabId) window.localStorage.removeItem(focusLeaseKey(userId));
  } catch {
    /* best effort */
  }
}

/** True se un'ALTRA finestra, ancora viva, ha la sessione in mano. Pura. */
export function isForeignLeaseAlive(lease, tabId, nowMs = Date.now()) {
  if (!lease || lease.tabId === tabId) return false;
  const age = nowMs - Number(lease.at);
  // Anche un possesso "dal futuro" (orologio spostato indietro) conta come
  // vivo, entro la stessa finestra di tempo.
  return Number.isFinite(age) && Math.abs(age) < LEASE_TTL_MS;
}

export default {
  focusCheckpointKey,
  saveFocusCheckpoint,
  loadFocusCheckpoint,
  clearFocusCheckpoint,
  isCheckpointStale,
  CHECKPOINT_MAX_AGE_MS,
  runningBlockKey,
  saveRunningBlock,
  loadRunningBlock,
  clearRunningBlock,
  planRunningBlockRestore,
  getTabId,
  readFocusLease,
  writeFocusLease,
  releaseFocusLease,
  isForeignLeaseAlive,
  LEASE_BEAT_MS,
  LEASE_TTL_MS
};
