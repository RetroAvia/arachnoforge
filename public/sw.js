// =====================================================================
// ArachnoForge — Service Worker (V36.0)
//
// Obiettivo dichiarato e volutamente RISTRETTO: rendere l'app apribile e
// usabile a rete assente (lo stato vive già local-first + Cloud Sync, il
// guscio dell'app era l'unica cosa che richiedeva la rete per partire) e
// permettere le notifiche di sistema quando l'app è installata.
//
// NON fa caching dei dati utente: ogni chiamata a Supabase passa dritta
// alla rete, sempre. Un briefing o un profilo serviti da cache sarebbero
// una fonte di dati stantii, ed è esattamente la classe di bug che una
// PWA scritta male introduce.
//
// Strategia:
//  - navigazioni (document): network-first con fallback alla shell in
//    cache — online vedi sempre l'ultimo deploy, offline entri lo stesso;
//  - asset con hash di build (/assets/*): cache-first, sono immutabili;
//  - tutto il resto (API, cross-origin): nessuna intercettazione.
// =====================================================================
const VERSION = 'af-v36-1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase & co: mai toccate.

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || SHELL_URLS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
            }
            return response;
          })
      )
    );
  }
});

// Tap su una notifica: riporta a fuoco la finestra già aperta invece di
// aprirne una seconda (e naviga alla rotta suggerita dalla notifica).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/#/mission-control';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});
