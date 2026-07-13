/**
 * V26.0 — "The Nexus Gate": la persistenza è passata interamente al Cloud
 * State Sync via Supabase (vedi ArachnoForgeContext.jsx — boot fetch +
 * autosave debounced su `user_data.app_state`). Questo modulo non gestisce
 * più LocalStorage (loadState/saveState/clearState sono stati rimossi):
 * resta solo la validazione di un profilo importato manualmente dal Data
 * Ledger (Import/Export JSON in Karen OS Settings), che è un flusso
 * indipendente dalla persistenza automatica.
 */

/**
 * Valida un profilo importato dal Data Ledger prima di sovrascrivere lo
 * stato in memoria (che verrà poi ri-sincronizzato sul Cloud dal normale
 * ciclo di autosave debounced). Controlla la presenza dei campi chiave
 * richiesti dallo schema.
 */
export function validateImportedProfile(obj) {
  if (!obj || typeof obj !== 'object') return { valid: false, reason: 'File non valido: JSON non riconosciuto.' };
  if (!obj.profile || typeof obj.profile.level !== 'number') {
    return { valid: false, reason: 'Campo "profile" mancante o corrotto.' };
  }
  if (!obj.settings || typeof obj.settings.focusTime !== 'number') {
    return { valid: false, reason: 'Campo "settings" mancante o corrotto.' };
  }
  if (!Array.isArray(obj.materie)) {
    return { valid: false, reason: 'Campo "materie" mancante o non è un array.' };
  }
  return { valid: true };
}
