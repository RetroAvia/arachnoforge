/**
 * V41 — Punti di ripristino automatici, salvati su questo dispositivo.
 *
 * Tutto il profilo vive in UNA riga del Cloud: un import sbagliato, un
 * reset premuto per errore o un conflitto risolto dalla parte sbagliata
 * cancellavano mesi di lavoro senza ritorno, e l'unica difesa era
 * ricordarsi di esportare il backup a mano.
 *
 * Qui, senza che tu debba fare niente:
 *   - una copia al giorno (al primo avvio della giornata), tenute le
 *     ultime AUTO_KEEP;
 *   - una copia subito PRIMA di ogni operazione che sostituisce il
 *     profilo (import, reset, scelta in un conflitto) o che elimina
 *     un'intera materia, tenute le ultime SAFETY_KEEP.
 * Si ripristinano da Karen OS Settings → Backup, con un clic.
 *
 * IndexedDB e non LocalStorage: le copie sono decine di volte più grandi
 * del limite pratico di LocalStorage. Se IndexedDB non c'è (navigazione
 * privata su alcuni browser) la funzione si spegne da sola e la UI lo dice.
 */

const DB_NAME = 'arachnoforge-backups';
const DB_VERSION = 1;
const STORE = 'snapshots';

export const AUTO_KEEP = 14;
export const SAFETY_KEEP = 10;

export const SNAPSHOT_REASON = {
  AUTO: 'auto',
  PRE_IMPORT: 'pre-import',
  PRE_RESET: 'pre-reset',
  PRE_CONFLICT: 'pre-conflict',
  PRE_RESTORE: 'pre-restore',
  PRE_DELETE: 'pre-delete',
  MANUAL: 'manual'
};

export const SNAPSHOT_REASON_LABEL = {
  auto: 'Copia automatica del giorno',
  'pre-import': 'Prima di un import',
  'pre-reset': 'Prima del reset totale',
  'pre-conflict': 'Prima di risolvere un conflitto',
  'pre-restore': 'Prima di un ripristino',
  'pre-delete': 'Prima di un’eliminazione',
  manual: 'Copia manuale'
};

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Riepilogo leggibile di uno stato: serve alla lista, senza aprire la copia. */
export function summarizeState(state) {
  const materie = Array.isArray(state?.materie) ? state.materie : [];
  const nodi = materie.reduce((sum, m) => sum + (Array.isArray(m?.sfide) ? m.sfide.length : 0), 0);
  const starLog = Array.isArray(state?.starLog) ? state.starLog : [];
  const minuti = starLog
    .filter((e) => e && e.type === 'FOCUS_MINUTES')
    .reduce((sum, e) => sum + (Number(e.minutes) || 0), 0);
  return {
    username: typeof state?.profile?.username === 'string' ? state.profile.username : '',
    level: Number(state?.profile?.level) || 1,
    materie: materie.length,
    nodi,
    minutiFocus: Math.round(minuti)
  };
}

/** Quali copie eliminare dato l'elenco (più recenti per prime). Pura, testata. */
export function snapshotsToPrune(snapshots, autoKeep = AUTO_KEEP, safetyKeep = SAFETY_KEEP) {
  const sorted = [...(Array.isArray(snapshots) ? snapshots : [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const auto = sorted.filter((s) => s.reason === SNAPSHOT_REASON.AUTO);
  const others = sorted.filter((s) => s.reason !== SNAPSHOT_REASON.AUTO);
  return [...auto.slice(autoKeep), ...others.slice(safetyKeep)].map((s) => s.id);
}

/** Evento emesso quando l'elenco delle copie cambia (la UI si aggiorna da sola). */
export const SNAPSHOTS_CHANGED_EVENT = 'af:snapshots-changed';

function notifyChanged() {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(SNAPSHOTS_CHANGED_EVENT));
    }
  } catch {
    /* ambiente senza DOM (test): niente da avvisare */
  }
}

let dbPromise = null;

export function backupsSupported() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb() {
  if (!backupsSupported()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byUser', 'userId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      Promise.resolve(fn(store, (r) => (result = r))).catch(() => undefined);
      t.oncomplete = () => resolve(result);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

function reqToPromise(req) {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function allForUser(db, userId) {
  const rows = await tx(db, 'readonly', async (store, set) => {
    const index = store.index('byUser');
    set(await reqToPromise(index.getAll(userId)));
  });
  return Array.isArray(rows) ? rows : [];
}

/** Metadati delle copie di un utente, dalla più recente. */
export async function listSnapshots(userId) {
  const db = await openDb();
  if (!db) return [];
  const rows = await allForUser(db, userId);
  return rows
    .map(({ data, ...meta }) => ({ ...meta, bytes: meta.bytes || (typeof data === 'string' ? data.length : 0) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Stato completo di una copia (oggetto già parsato) oppure null. */
export async function readSnapshot(id) {
  const db = await openDb();
  if (!db) return null;
  const row = await tx(db, 'readonly', async (store, set) => {
    set(await reqToPromise(store.get(id)));
  });
  if (!row || typeof row.data !== 'string') return null;
  try {
    return { ...row, state: JSON.parse(row.data) };
  } catch {
    return null;
  }
}

export async function deleteSnapshot(id) {
  const db = await openDb();
  if (!db) return false;
  await tx(db, 'readwrite', (store) => {
    store.delete(id);
  });
  notifyChanged();
  return true;
}

/** Salva una copia. Ritorna i metadati salvati oppure null. */
export async function saveSnapshot(userId, state, { reason = SNAPSHOT_REASON.MANUAL, label = '' } = {}) {
  if (!state || typeof state !== 'object') return null;
  const db = await openDb();
  if (!db) return null;
  let data;
  try {
    const { _sync, ...clean } = state;
    data = JSON.stringify(clean);
  } catch {
    return null;
  }
  const now = Date.now();
  const record = {
    id: `snap_${now}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    createdAt: now,
    dateKey: localDateKey(new Date(now)),
    reason,
    label: typeof label === 'string' ? label.slice(0, 80) : '',
    summary: summarizeState(state),
    bytes: data.length,
    data
  };
  await tx(db, 'readwrite', (store) => {
    store.put(record);
  });
  // Pulizia delle copie in eccesso.
  const rows = await allForUser(db, userId);
  const toDelete = snapshotsToPrune(rows);
  if (toDelete.length > 0) {
    await tx(db, 'readwrite', (store) => {
      toDelete.forEach((id) => store.delete(id));
    });
  }
  notifyChanged();
  const { data: _data, ...meta } = record;
  return meta;
}

/** Una copia automatica al giorno: se oggi c'è già, non fa nulla. */
export async function maybeDailySnapshot(userId, state) {
  const db = await openDb();
  if (!db) return null;
  const today = localDateKey();
  const rows = await allForUser(db, userId);
  if (rows.some((r) => r.reason === SNAPSHOT_REASON.AUTO && r.dateKey === today)) return null;
  return saveSnapshot(userId, state, { reason: SNAPSHOT_REASON.AUTO });
}
