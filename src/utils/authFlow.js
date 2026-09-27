/**
 * V41 — Logica pura dell'accesso (nessun React, nessun Supabase): testi
 * degli errori, lettura dei link email di ritorno, regole della password.
 * Vive a parte per poter essere verificata con `node --test`.
 */

/** Lunghezza minima di una password NUOVA (registrazione, cambio, recupero). */
export const NEW_PASSWORD_MIN_LENGTH = 10;

/**
 * Lunghezza minima accettata al LOGIN: resta 6 (il minimo storico di
 * Supabase) per non chiudere fuori un account creato prima della V37 con
 * una password più corta.
 */
export const LOGIN_PASSWORD_MIN_LENGTH = 6;

/**
 * Parametri di un link di ritorno di Supabase Auth, presi da hash e query
 * string: `recovery` quando si arriva dal link "password dimenticata",
 * `error` quando il link non era più valido (scaduto, già usato).
 * Gli hash del router (`#/mission-control`) non contengono `=` e passano
 * indenni.
 */
export function parseAuthRedirect(hash = '', search = '') {
  try {
    const params = new URLSearchParams(`${String(search).replace(/^\?/, '')}&${String(hash).replace(/^#\/?/, '')}`);
    const code = params.get('error_code') || params.get('error') || '';
    const description = params.get('error_description') || '';
    return {
      recovery: params.get('type') === 'recovery' && !code && !description,
      error: code || description ? { code, description } : null
    };
  } catch {
    return { recovery: false, error: null };
  }
}

/** Testo per un link email che Supabase ha rifiutato. */
export function describeRedirectError(error) {
  if (!error) return null;
  const code = String(error.code || '').toLowerCase();
  const text = String(error.description || '').toLowerCase();
  if (code === 'otp_expired' || text.includes('expired')) {
    return 'Il link dell’email è scaduto o è già stato usato. Richiedine uno nuovo da qui.';
  }
  return 'Il link dell’email non è valido. Richiedine uno nuovo da qui.';
}

/**
 * Traduce i messaggi grezzi di Supabase Auth in frasi chiare. Supabase
 * non garantisce codici stabili fra le versioni, ma i testi in inglese
 * sono abbastanza prevedibili per un confronto per sottostringa.
 * L'ordine conta: "should be different from the old password" contiene
 * anche "password", e va riconosciuto prima dei controlli sulla lunghezza.
 */
export function translateAuthError(rawMessage, { minLength = NEW_PASSWORD_MIN_LENGTH } = {}) {
  const msg = String(rawMessage || '').toLowerCase();
  if (!msg) return 'Operazione non riuscita. Riprova.';
  if (msg.includes('invalid login credentials')) return 'Email o password non corrette.';
  if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already'))
    return 'Esiste già un account con questa email: usa «Accedi».';
  if (msg.includes('should be different') || msg.includes('same password') || msg.includes('same as'))
    return 'La nuova password deve essere diversa da quella attuale.';
  if (msg.includes('reauthenticat')) return 'Per sicurezza serve un accesso recente: esci, rientra e riprova.';
  if (msg.includes('weak') || msg.includes('pwned') || msg.includes('leaked') || msg.includes('easy to guess'))
    return 'Password troppo debole o già comparsa in una fuga di dati: scegline un’altra.';
  if (msg.includes('password') && (msg.includes('characters') || msg.includes('at least') || msg.includes('short')))
    return `Password troppo corta: servono almeno ${minLength} caratteri.`;
  if (msg.includes('unable to validate email') || msg.includes('invalid email') || msg.includes('invalid format'))
    return 'Indirizzo email non valido.';
  if (msg.includes('email not confirmed')) return 'Email non ancora confermata: apri il link che ti è arrivato per posta, poi accedi.';
  if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('security purposes'))
    return 'Troppi tentativi ravvicinati: attendi un minuto e riprova.';
  if (msg.includes('signups not allowed') || msg.includes('signup is disabled') || msg.includes('signups are disabled'))
    return 'Le nuove registrazioni sono disattivate per questo progetto.';
  if (msg.includes('session missing') || msg.includes('session not found') || msg.includes('jwt expired'))
    return 'La sessione è scaduta: esci e accedi di nuovo.';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('load failed') || msg.includes('timeout'))
    return 'Nessuna connessione con il server: controlla la rete e riprova.';
  return `Operazione non riuscita: ${rawMessage}`;
}

/**
 * Controlli locali su una password nuova, prima di disturbare il server.
 * Restituisce il messaggio d'errore oppure `null`.
 */
export function validateNewPassword(password, confirm) {
  const value = String(password || '');
  if (value.length < NEW_PASSWORD_MIN_LENGTH) return `La password deve avere almeno ${NEW_PASSWORD_MIN_LENGTH} caratteri.`;
  if (!value.trim()) return 'La password non può essere fatta solo di spazi.';
  if (confirm !== undefined && value !== confirm) return 'Le due password non coincidono.';
  return null;
}

/** Controllo minimo di forma di un indirizzo email (il resto lo verifica Supabase). */
export function isPlausibleEmail(email) {
  const value = String(email || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
