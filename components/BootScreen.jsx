import React from 'react';
import { Icon } from './Icons.jsx';

/**
 * Schermata di avvio condivisa: controllo della sessione (App.jsx) e
 * caricamento dei dati del profilo (ArachnoForgeProvider).
 *
 * V41 — può anche raccontare un avvio NON riuscito (`error`), con i
 * pulsanti per riprovare o per proseguire con la copia salvata su questo
 * dispositivo. Prima un avvio fallito mostrava un profilo vuoto come se
 * fosse vero, e il lavoro fatto lì dentro non veniva salvato da nessuna
 * parte.
 */
export default function BootScreen({ message = 'Connessione ai satelliti Stark in corso…', error = null, onRetry = null, onOffline = null, offlineLabel = null }) {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center px-6 bg-app">
      <div className="absolute inset-0 bg-[radial-gradient(700px_380px_at_50%_35%,rgb(var(--af-refuel-rgb)/0.07),transparent_70%)] pointer-events-none" />
      <div className="relative flex flex-col items-center text-center max-w-md">
        <div className="w-12 h-12 rounded-xl bg-[rgb(var(--af-attack-solid-rgb))] flex items-center justify-center text-white shadow-primary-glow mb-6">
          <Icon name="web" className="w-6 h-6" strokeWidth={1.9} />
        </div>
        {error ? (
          <>
            <p className="text-lg font-semibold text-white">Non riesco a caricare il tuo profilo</p>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">{error}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              {onRetry && (
                <button type="button" onClick={onRetry} className="ds-btn ds-btn-primary">
                  <Icon name="refresh" className="w-4 h-4" />
                  Riprova
                </button>
              )}
              {onOffline && (
                <button type="button" onClick={onOffline} className="ds-btn ds-btn-ghost">
                  <Icon name="wifiOff" className="w-4 h-4" />
                  {offlineLabel || 'Continua offline'}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="w-40 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-secondary animate-[af-boot-bar_1.1s_ease-in-out_infinite]" />
            </div>
            <p className="text-sm text-slate-400 mt-4">{message}</p>
          </>
        )}
        <p className="text-[11px] tracking-wide text-slate-600 mt-8">ArachnoForge · K.A.R.E.N. OS</p>
      </div>
    </div>
  );
}
