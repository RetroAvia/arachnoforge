/**
 * V27.0 — Pillar 3: "MAXIMUM CARNAGE MODE" (Symbiote Dopamine Surge).
 *
 * Motore puro (nessun side-effect, nessuna dipendenza da React) per il
 * sistema di Overdrive a lungo termine: a differenza dell'Overdrive del
 * Tactical Timer (concatenazione di un singolo blocco Focus), Maximum
 * Carnage è uno stato GLOBALE del profilo che dura 2 ore reali una volta
 * sbloccato, indipendentemente da cosa l'utente fa nel frattempo.
 *
 * Trigger: uno "Streak di Azioni Critiche" — nodi Hard completati,
 * sessioni di Focus concluse in Overdrive, e vittorie in Boss Fight
 * incrementano lo stesso contatore (`criticalActionStreak`). Al
 * raggiungimento della soglia, il simbionte prende il sopravvento.
 */

/** Durata della finestra Maximum Carnage: 2 ore esatte. */
export const MAX_CARNAGE_DURATION_MS = 2 * 60 * 60 * 1000;

/** Streak di azioni critiche necessario per sbloccare la modalità. */
export const CRITICAL_ACTION_THRESHOLD = 5;

/**
 * Determina se il profilo è ATTUALMENTE dentro una finestra Maximum
 * Carnage valida — sia il flag booleano sia il timestamp di scadenza
 * devono essere coerenti (blindatura contro stati corrotti/importati).
 */
export function isMaxCarnageActive(profile) {
  if (!profile || !profile.maxCarnageActive) return false;
  const expiresAt = profile.maxCarnageExpiresAt ? new Date(profile.maxCarnageExpiresAt).getTime() : 0;
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  return Date.now() < expiresAt;
}

/** Millisecondi residui alla scadenza (0 se non attivo/scaduto). */
export function maxCarnageMsRemaining(profile) {
  if (!isMaxCarnageActive(profile)) return 0;
  return Math.max(0, new Date(profile.maxCarnageExpiresAt).getTime() - Date.now());
}

/**
 * Incrementa lo streak di azioni critiche di `amount` (default 1). Se la
 * soglia viene raggiunta E la modalità non è già attiva, attiva Maximum
 * Carnage per 2 ore e azzera lo streak — un solo trigger per raffica,
 * mai un doppio-attivo che "resetta" il countdown a metà.
 */
export function bumpCriticalActionStreak(profile, amount = 1) {
  const alreadyActive = isMaxCarnageActive(profile);
  const currentStreak = Number.isFinite(profile.criticalActionStreak) ? profile.criticalActionStreak : 0;

  if (alreadyActive) {
    // Già in Maximum Carnage: le azioni critiche continuano a contare per
    // la prossima attivazione (nessun bonus di durata, nessun overflow),
    // ma non possono ri-triggerare una seconda finestra sovrapposta.
    return { criticalActionStreak: currentStreak, justActivated: false };
  }

  const nextStreak = currentStreak + amount;
  if (nextStreak >= CRITICAL_ACTION_THRESHOLD) {
    return {
      criticalActionStreak: 0,
      justActivated: true,
      maxCarnageActive: true,
      maxCarnageExpiresAt: new Date(Date.now() + MAX_CARNAGE_DURATION_MS).toISOString()
    };
  }
  return { criticalActionStreak: nextStreak, justActivated: false };
}

/** Disattiva esplicitamente la modalità (scadenza naturale o Reset Profilo). */
export function deactivateMaxCarnage() {
  return { maxCarnageActive: false, maxCarnageExpiresAt: null };
}

/** Formattazione compatta "1h 42m" per l'HUD countdown (Sidebar / banner). */
export function formatMsRemaining(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default {
  MAX_CARNAGE_DURATION_MS,
  CRITICAL_ACTION_THRESHOLD,
  isMaxCarnageActive,
  maxCarnageMsRemaining,
  bumpCriticalActionStreak,
  deactivateMaxCarnage,
  formatMsRemaining
};
