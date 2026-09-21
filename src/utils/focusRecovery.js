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

export default {
  focusCheckpointKey,
  saveFocusCheckpoint,
  loadFocusCheckpoint,
  clearFocusCheckpoint,
  isCheckpointStale,
  CHECKPOINT_MAX_AGE_MS
};
