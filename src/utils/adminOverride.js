/**
 * V28.1 — Pillar 2: "Secure Admin Override" (Password-Protected Sandbox).
 *
 * Un solo punto di verità per la passphrase e per la persistenza locale
 * (Guest / Sandbox Admin) — nessuna logica di confronto o di storage
 * duplicata altrove. La validazione è client-side per costruzione (non
 * esiste un backend di autorizzazione dedicato): questo è un interruttore
 * di comodo per isolare un profilo di test, NON un vero controllo di
 * sicurezza — coerente con quanto richiesto ("Sandbox" locale, non un
 * secondo livello di autenticazione reale).
 */

/** Passphrase di override — confronto sempre case-sensitive ed esatto. */
const ADMIN_PASSPHRASE = 'Spazioaereo10!';

export function validateAdminPassphrase(input) {
  return typeof input === 'string' && input === ADMIN_PASSPHRASE;
}

/** Prefissi delle chiavi LocalStorage — mai condivise fra Guest e Sandbox,
 * mai in collisione con la vecchia persistenza pre-V26 (namespace dedicato). */
const GUEST_STORAGE_KEY = 'arachnoforge_v28_guest_state';
const SANDBOX_STORAGE_PREFIX = 'arachnoforge_v28_sandbox_';

export function sandboxStorageKey(realUserId) {
  return `${SANDBOX_STORAGE_PREFIX}${realUserId}`;
}

export function guestStorageKey() {
  return GUEST_STORAGE_KEY;
}

/** Lettura/scrittura sicure — mai un crash se LocalStorage è pieno, in
 * modalità privata, o disabilitato dal browser dell'utente. */
export function loadLocalState(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('[ArachnoForge] Lettura storage locale fallita.', err);
    return null;
  }
}

export function saveLocalState(key, state) {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('[ArachnoForge] Scrittura storage locale fallita.', err);
    return false;
  }
}

export function clearLocalState(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Silenzioso per costruzione: la pulizia è "best effort", mai un
    // punto di fallimento critico per il resto del flusso di logout/reset.
  }
}

export default {
  validateAdminPassphrase,
  sandboxStorageKey,
  guestStorageKey,
  loadLocalState,
  saveLocalState,
  clearLocalState
};
