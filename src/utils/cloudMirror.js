/**
 * V41 — Copia locale dell'ultimo stato CONFERMATO dal Cloud.
 *
 * Il checkpoint (utils/cloudCheckpoint.js) esiste solo finché c'è del
 * lavoro non ancora salvato, e sparisce appena il Cloud lo conferma.
 * Serviva anche l'opposto: la versione buona più recente, da usare quando
 * all'avvio il Cloud non risponde (sei offline, rete dell'università che
 * blocca, Supabase in manutenzione). Prima l'app, in quel caso, mostrava
 * un profilo VUOTO — livello 1, nessuna materia — e ciò che facevi lì
 * dentro non finiva da nessuna parte.
 *
 * Con questa copia l'avvio offline riparte dai tuoi dati veri, e il primo
 * salvataggio al ritorno della rete parte dal token di versione di allora:
 * se nel frattempo un altro dispositivo ha salvato, compare il normale
 * dialogo di conflitto invece di una sovrascrittura silenziosa.
 *
 * Stesso contratto "best effort" degli altri moduli di persistenza
 * locale: LocalStorage pieno o disabilitato non blocca mai l'app.
 */

const MIRROR_PREFIX = 'arachnoforge_v41_cloud_mirror_';

export function cloudMirrorKey(userId) {
  return `${MIRROR_PREFIX}${userId || 'anon'}`;
}

export function saveCloudMirror(userId, state, version = null, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || !state || typeof state !== 'object') return false;
  try {
    const record = { savedAt: Date.now(), state };
    if (typeof version === 'string' && version) record.version = version;
    storage.setItem(cloudMirrorKey(userId), JSON.stringify(record));
    return true;
  } catch (err) {
    console.warn('[ArachnoForge] Copia locale del profilo non scritta.', err);
    return false;
  }
}

/** `{ savedAt, state, version }` oppure `null`. */
export function loadCloudMirror(userId, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(cloudMirrorKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.state || typeof parsed.state !== 'object') return null;
    const savedAt = Number(parsed.savedAt);
    return {
      savedAt: Number.isFinite(savedAt) ? savedAt : null,
      state: parsed.state,
      version: typeof parsed.version === 'string' ? parsed.version : null
    };
  } catch (err) {
    console.warn('[ArachnoForge] Copia locale del profilo non leggibile.', err);
    return null;
  }
}

export function clearCloudMirror(userId, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return;
  try {
    storage.removeItem(cloudMirrorKey(userId));
  } catch {
    /* best effort */
  }
}
