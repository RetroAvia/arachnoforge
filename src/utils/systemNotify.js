// =====================================================================
// ArachnoForge — src/utils/systemNotify.js (V36.0)
// Ponte verso le tre API di sistema che mancavano del tutto: notifiche,
// Wake Lock e vibrazione.
//
// Perché servono: il Tactical Timer viveva SOLO come countdown dentro
// una scheda visibile. Con lo schermo bloccato (il caso normale quando
// studi su carta con il telefono di fianco) la fine di un blocco Focus
// non ti raggiungeva in nessun modo — nessun suono, nessuna notifica,
// niente: tornavi a guardare e scoprivi che la pausa era finita venti
// minuti prima.
//
// Contratto identico a utils/focusRecovery.js e adminOverride.js: ogni
// funzione è "best effort", non lancia MAI, e ritorna un booleano onesto.
// Un browser senza una di queste API (o un permesso negato) degrada in
// silenzio, e il resto del timer continua a funzionare esattamente come
// prima.
// =====================================================================

export const NOTIFY_PERMISSION = {
  GRANTED: 'granted',
  DENIED: 'denied',
  DEFAULT: 'default',
  UNSUPPORTED: 'unsupported'
};

export function notificationSupport() {
  try {
    return typeof window !== 'undefined' && 'Notification' in window;
  } catch {
    return false;
  }
}

export function notificationPermission() {
  if (!notificationSupport()) return NOTIFY_PERMISSION.UNSUPPORTED;
  try {
    return window.Notification.permission;
  } catch {
    return NOTIFY_PERMISSION.UNSUPPORTED;
  }
}

/** Da chiamare SOLO da un gesto utente esplicito (un click su un
 * toggle): i browser rifiutano — e su Safari ricordano male — una
 * richiesta di permesso partita da sola al caricamento della pagina. */
export async function requestNotificationPermission() {
  if (!notificationSupport()) return NOTIFY_PERMISSION.UNSUPPORTED;
  try {
    return await window.Notification.requestPermission();
  } catch {
    return NOTIFY_PERMISSION.DENIED;
  }
}

/**
 * Notifica di sistema. Passa dal Service Worker quando è registrato
 * (unica via su Android/Chrome installato come PWA, dove il costruttore
 * `new Notification()` lancia), con fallback al costruttore classico.
 * `tag` fa sì che una nuova notifica dello stesso tipo SOSTITUISCA la
 * precedente invece di impilarsi.
 */
export async function notify(title, { body = '', tag = 'arachnoforge', silent = false } = {}) {
  if (notificationPermission() !== NOTIFY_PERMISSION.GRANTED) return false;
  const options = { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', silent, renotify: true };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, options);
        return true;
      }
    }
    new window.Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/** Vibrazione breve (ignorata su desktop e su iOS Safari — nessun errore). */
export function vibrate(pattern = [120, 60, 120]) {
  try {
    if (navigator.vibrate) return navigator.vibrate(pattern);
  } catch {
    /* best effort */
  }
  return false;
}

// ---------------------------------------------------------------------
// Wake Lock — tiene lo schermo acceso durante una sessione di Focus.
// Un solo sentinel vivo per volta, riacquisito da solo quando la scheda
// torna visibile (il browser lo rilascia SEMPRE al cambio di scheda o
// allo spegnimento manuale dello schermo: senza il riaggancio, uscire e
// rientrare dall'app lo perderebbe per il resto della sessione).
// ---------------------------------------------------------------------
let wakeLockSentinel = null;
let wakeLockWanted = false;
let visibilityHooked = false;

function wakeLockSupported() {
  try {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  } catch {
    return false;
  }
}

async function acquire() {
  if (!wakeLockSupported() || wakeLockSentinel) return false;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
    return true;
  } catch {
    wakeLockSentinel = null;
    return false;
  }
}

function hookVisibility() {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (wakeLockWanted && document.visibilityState === 'visible') acquire();
  });
}

export async function requestWakeLock() {
  wakeLockWanted = true;
  hookVisibility();
  return acquire();
}

export async function releaseWakeLock() {
  wakeLockWanted = false;
  try {
    if (wakeLockSentinel) await wakeLockSentinel.release();
  } catch {
    /* best effort */
  }
  wakeLockSentinel = null;
}
