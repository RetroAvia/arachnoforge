/**
 * V37.0 — "Rete di salvataggio" (Cloud Autosave Durability).
 *
 * L'autosave verso Supabase è debounced di 2,5 secondi: solo l'ultima
 * variazione di una raffica sopravvive abbastanza da scatenare l'upsert
 * reale. Ottimo per il numero di scritture, pessimo per la durabilità —
 * fino a quel momento la modifica vive SOLO in memoria React, e bastava
 * chiudere la scheda, fare logout o lasciare che il sistema operativo
 * uccidesse la PWA in background per perderla del tutto. Non c'era alcun
 * handler di uscita: il cleanup dell'effetto si limitava a cancellare il
 * timer pendente.
 *
 * Questo modulo aggiunge un secondo livello di durabilità, locale e
 * indipendente, con lo STESSO contratto di utils/focusRecovery.js:
 *
 *   1. ad ogni modifica lo stato viene scritto in modo sincrono su
 *      LocalStorage (namespace per utente e per backend);
 *   2. appena l'upsert Cloud riesce, il checkpoint viene cancellato —
 *      la sua sola presenza significa "c'è del lavoro non confermato";
 *   3. al boot successivo, se esiste un checkpoint PIÙ RECENTE di quanto
 *      il Cloud restituisce, viene usato al posto della riga remota e
 *      subito ri-salvato.
 *
 * Nessuna nuova tabella, nessun nuovo canale di scrittura remota: il
 * recupero converge sulla pipeline di autosave già collaudata.
 */

const CHECKPOINT_PREFIX = 'arachnoforge_v37_cloud_checkpoint_';

/** Oltre questa soglia un checkpoint non confermato è troppo vecchio per
 * essere considerato "lavoro appena fatto" — si preferisce la verità del
 * Cloud, che nel frattempo potrebbe venire da un altro dispositivo. */
export const CLOUD_CHECKPOINT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

export function cloudCheckpointKey(userId, storageMode = 'cloud') {
  return `${CHECKPOINT_PREFIX}${storageMode}_${userId || 'anon'}`;
}

/** Scrittura sincrona e best-effort: LocalStorage pieno, modalità privata
 * o disabilitato non devono mai impedire all'app di funzionare. */
/**
 * V39.0 — `meta` opzionale: `baseVersion` (il token `updated_at` su cui
 * la modifica è stata fatta) e `writer` (la sessione che l'ha fatta).
 * Al recupero servono a NON sovrascrivere in silenzio una versione più
 * recente salvata nel frattempo da un altro dispositivo: la scrittura
 * riparte dal token di allora e, se la riga è cambiata, passa dal
 * normale controllo dei conflitti.
 */
export function saveCloudCheckpoint(userId, storageMode, state, meta = null) {
  try {
    const record = { savedAt: Date.now(), state };
    if (meta && typeof meta === 'object') {
      if (typeof meta.baseVersion === 'string') record.baseVersion = meta.baseVersion;
      if (typeof meta.writer === 'string') record.writer = meta.writer;
    }
    window.localStorage.setItem(cloudCheckpointKey(userId, storageMode), JSON.stringify(record));
    return true;
  } catch (err) {
    // QuotaExceededError è il caso realistico con uno starLog molto
    // lungo: si rinuncia al checkpoint, mai al funzionamento dell'app.
    console.warn('[ArachnoForge] Checkpoint locale non scritto.', err);
    return false;
  }
}

/** Ritorna `{ savedAt, state, baseVersion, writer }` oppure `null` se assente, illeggibile o
 * troppo vecchio. Un checkpoint scaduto viene rimosso all'istante. */
export function loadCloudCheckpoint(userId, storageMode = 'cloud') {
  try {
    const raw = window.localStorage.getItem(cloudCheckpointKey(userId, storageMode));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.state) return null;
    const savedAt = Number(parsed.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > CLOUD_CHECKPOINT_MAX_AGE_MS) {
      clearCloudCheckpoint(userId, storageMode);
      return null;
    }
    return {
      savedAt,
      state: parsed.state,
      baseVersion: typeof parsed.baseVersion === 'string' ? parsed.baseVersion : null,
      writer: typeof parsed.writer === 'string' ? parsed.writer : null
    };
  } catch (err) {
    console.warn('[ArachnoForge] Checkpoint locale non leggibile.', err);
    return null;
  }
}

export function clearCloudCheckpoint(userId, storageMode = 'cloud') {
  try {
    window.localStorage.removeItem(cloudCheckpointKey(userId, storageMode));
  } catch {
    /* best effort per costruzione */
  }
}

export default {
  cloudCheckpointKey,
  saveCloudCheckpoint,
  loadCloudCheckpoint,
  clearCloudCheckpoint,
  CLOUD_CHECKPOINT_MAX_AGE_MS
};
