import { hydrateState } from '../data/defaultSchema.js';

export const STORAGE_KEY = 'arachnoforge:v1';

/**
 * Legge lo stato da LocalStorage in modo sicuro (Safe Hydration).
 * Qualsiasi JSON malformato o campo mancante viene silenziosamente
 * riparato tramite hydrateState, prevenendo crash da 'undefined'
 * al primo avvio o dopo un aggiornamento dello schema.
 */
export function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return hydrateState(null);
    const parsed = JSON.parse(raw);
    return hydrateState(parsed);
  } catch (err) {
    console.error('[ArachnoForge] LocalStorage corrotto, ripristino schema di default.', err);
    return hydrateState(null);
  }
}

/**
 * Scrittura sincrona su LocalStorage. Lo stato React resta l'unica
 * fonte di verità in memoria; questa funzione persiste una copia
 * ad ogni variazione rilevante (chiamata da ArachnoForgeContext via useEffect).
 */
export function saveState(state) {
  try {
    const toSave = {
      ...state,
      metadata: {
        ...state.metadata,
        lastSaveTimestamp: new Date().toISOString()
      }
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    return true;
  } catch (err) {
    console.error('[ArachnoForge] Scrittura LocalStorage fallita (quota?).', err);
    return false;
  }
}

export function clearState() {
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Valida un profilo importato prima di sovrascrivere il LocalStorage.
 * Controlla la presenza dei campi chiave richiesti dallo schema 1.0.0.
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
