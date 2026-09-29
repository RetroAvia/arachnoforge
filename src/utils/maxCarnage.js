/**
 * V27.0 — Pillar 3: "MAXIMUM CARNAGE MODE" (Symbiote Dopamine Surge).
 *
 * Motore puro. Maximum Carnage è uno stato GLOBALE del profilo che dura
 * 2 ore reali: XP raddoppiati.
 *
 * V42 — "Il simbionte lo scegli tu". Tre problemi misurati:
 *  - il contatore delle azioni critiche non scadeva mai (cinque Overdrive
 *    da due minuti, anche in giorni diversi, bastavano);
 *  - la finestra partiva da sola, a qualunque ora, notte compresa;
 *  - per due ore la Stamina era gratis: un invito a studiare oltre il limite.
 * Ora le azioni critiche (argomento Hard completato con studio tracciato,
 * Focus in Overdrive da almeno 20 minuti, simulazione d'esame vinta)
 * contano solo nella stessa giornata; alla quinta si guadagna una CARICA
 * (massimo una), che attivi tu quando vuoi, fra le 6:00 e le 23:00. La
 * Stamina si consuma normalmente.
 */

/** Durata della finestra Maximum Carnage: 2 ore esatte. */
export const MAX_CARNAGE_DURATION_MS = 2 * 60 * 60 * 1000;

/** Azioni critiche nella stessa giornata necessarie per una carica. */
export const CRITICAL_ACTION_THRESHOLD = 5;

/** Cariche conservabili contemporaneamente. */
export const MAX_CARNAGE_CHARGES = 1;

/** Fascia oraria in cui si può attivare (ora locale, [inizio, fine)). */
export const CARNAGE_HOUR_START = 6;
export const CARNAGE_HOUR_END = 23;

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

function localDateKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** L'ora locale permette l'attivazione? */
export function isCarnageHour(now = Date.now()) {
  const h = new Date(now).getHours();
  return h >= CARNAGE_HOUR_START && h < CARNAGE_HOUR_END;
}

/**
 * Registra `amount` azioni critiche di oggi. Alla soglia accredita una
 * carica (se non se ne ha già una e la finestra non è attiva) e azzera il
 * contatore. Ritorna la patch del profilo e `chargeEarned`.
 */
export function bumpCriticalActionStreak(profile, amount = 1, now = Date.now()) {
  const oggi = localDateKey(now);
  const stessoGiorno = profile?.criticalActionDateKey === oggi;
  const current = stessoGiorno && Number.isFinite(profile?.criticalActionStreak) ? profile.criticalActionStreak : 0;
  const charges = Number.isFinite(profile?.carnageCharges) ? profile.carnageCharges : 0;
  const next = current + Math.max(0, amount);
  if (next >= CRITICAL_ACTION_THRESHOLD && charges < MAX_CARNAGE_CHARGES && !isMaxCarnageActive(profile)) {
    return { criticalActionStreak: 0, criticalActionDateKey: oggi, carnageCharges: charges + 1, chargeEarned: true, justActivated: false };
  }
  return {
    criticalActionStreak: Math.min(next, CRITICAL_ACTION_THRESHOLD),
    criticalActionDateKey: oggi,
    chargeEarned: false,
    justActivated: false
  };
}

/**
 * Attivazione volontaria: consuma una carica e apre la finestra di 2 ore.
 * @returns {{ok:boolean, reason?:'NO_CHARGE'|'ALREADY_ACTIVE'|'NIGHT', patch?:object}}
 */
export function activateMaxCarnage(profile, now = Date.now()) {
  if (isMaxCarnageActive(profile)) return { ok: false, reason: 'ALREADY_ACTIVE' };
  const charges = Number.isFinite(profile?.carnageCharges) ? profile.carnageCharges : 0;
  if (charges < 1) return { ok: false, reason: 'NO_CHARGE' };
  if (!isCarnageHour(now)) return { ok: false, reason: 'NIGHT' };
  return {
    ok: true,
    patch: {
      carnageCharges: charges - 1,
      maxCarnageActive: true,
      maxCarnageExpiresAt: new Date(now + MAX_CARNAGE_DURATION_MS).toISOString(),
      carnageActivations: (Number(profile?.carnageActivations) || 0) + 1
    }
  };
}

/** Disattiva esplicitamente la modalità (scadenza naturale o Reset Profilo). */
export function deactivateMaxCarnage() {
  return { maxCarnageActive: false, maxCarnageExpiresAt: null };
}

/** Formattazione compatta "01:42:05" per l'HUD countdown (Sidebar / banner). */
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
  activateMaxCarnage,
  deactivateMaxCarnage,
  formatMsRemaining
};
