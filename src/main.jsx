import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';

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
