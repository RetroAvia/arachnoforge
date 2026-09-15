import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { reportClientError } from './utils/errorReporter.js';
import './index.css';

// V35.2 — "Blindatura & Governance": rete di sicurezza globale, a monte
// di qualunque Error Boundary React. PageErrorBoundary intercetta solo
// gli errori di RENDER di una pagina — un errore lanciato fuori dal ciclo
// di render (un event handler, un setTimeout, una Promise non gestita)
// non passa mai da un Error Boundary e finiva finora SOLO nella console
// del browser dell'utente, invisibile a chi manutiene l'app. Nessuna
// delle due righe seguenti altera il comportamento di default del
// browser (nessun preventDefault) — sono osservatori puri, aggiuntivi.
window.addEventListener('error', (event) => {
  // Gli errori di caricamento risorsa (es. un'immagine 404) arrivano qui
  // con `event.error` assente — non sono errori applicativi, si ignorano.
  if (!event?.error) return;
  reportClientError({
    message: event.error.message || event.message,
    stack: event.error.stack,
    source: 'window-onerror'
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  reportClientError({
    message: (reason && reason.message) || String(reason),
    stack: reason?.stack,
    source: 'unhandledrejection'
  });
});

// V36.0 — PWA: registrazione del Service Worker (public/sw.js). Solo in
// produzione — in `vite dev` un SW attivo serve asset in cache e rompe
// l'hot reload, sintomo classico "ho salvato ma non cambia niente".
// Registrazione dopo il `load` per non competere con il primo render, e
// interamente best-effort: un fallimento qui non deve mai impedire
// all'app di partire (browser senza SW, contesto non sicuro, permessi).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[ArachnoForge] Service Worker non registrato:', err);
    });
  });
}

// V26.0 — "The Nexus Gate": AuthProvider vive alla radice, FUORI da
// ArachnoForgeProvider — governa la sessione Supabase indipendentemente
// dal fatto che l'utente sia autenticato o meno (App.jsx decide poi se
// mostrare il NexusGate o l'hub principale in base a `session`).
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
