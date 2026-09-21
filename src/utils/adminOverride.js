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

/**
 * Passphrase di override — confronto sempre case-sensitive ed esatto.
 *
 * V37.0 — Non è più compilata nel sorgente. La vecchia costante era una
 * password reale, scritta in chiaro nel repository e leggibile in
 * DevTools da chiunque aprisse l'app: un valore del genere non deve
 * esistere in un file versionato, indipendentemente da quanto poco
 * protegga. Ora arriva da `VITE_ADMIN_PASSPHRASE` (vedi `.env.example`).
 *
 * Resta comunque un interruttore di comodo, MAI un controllo di
 * sicurezza: qualunque variabile `VITE_*` finisce nel bundle servito al
 * browser. Per questo esiste anche la via d'uscita senza passphrase
 * (`?sandbox=1` nell'URL): se la variabile non è impostata, la Sandbox
 * non diventa irraggiungibile.
 */
const ADMIN_PASSPHRASE = import.meta.env?.VITE_ADMIN_PASSPHRASE || '';

/** True se la Sandbox è raggiungibile senza passphrase, perché non ne è
 * stata configurata nessuna. Letto dalla UI per spiegarlo apertamente
 * invece di mostrare un campo che non accetterà mai niente. */
export function isAdminPassphraseConfigured() {
  return typeof ADMIN_PASSPHRASE === 'string' && ADMIN_PASSPHRASE.length > 0;
}

/** Via d'uscita esplicita: `?sandbox=1` apre la Sandbox anche senza
 * passphrase configurata. È locale, isolata dal Cloud e reversibile —
 * non dà accesso a nulla che l'utente non abbia già. */
export function sandboxRequestedByUrl() {
  try {
    return new URLSearchParams(window.location.search).get('sandbox') === '1';
  } catch {
    return false;
  }
}

export function validateAdminPassphrase(input) {
  // `.trim()` assorbe spazi accidentali (autocorrect/autofill mobile)
  // prima del confronto ESATTO e case-sensitive — nessuna
  // normalizzazione ulteriore che possa alterare silenziosamente il match.
  if (!isAdminPassphraseConfigured()) return sandboxRequestedByUrl();
  if (typeof input !== 'string') return false;
  return input.trim() === ADMIN_PASSPHRASE;
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
  isAdminPassphraseConfigured,
  sandboxRequestedByUrl,
  sandboxStorageKey,
  guestStorageKey,
  loadLocalState,
  saveLocalState,
  clearLocalState
};
