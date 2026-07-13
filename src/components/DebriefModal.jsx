import React, { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import { Icon } from './Icons.jsx';
import { FOCUS_QUALITY, FOCUS_QUALITY_META } from '../utils/xpEngine.js';

const RATING_ORDER = [FOCUS_QUALITY.FLOW, FOCUS_QUALITY.NORMAL, FOCUS_QUALITY.DISTRACTED];

/**
 * Post-Session Debriefing Modal — "Sessione Completata. Valuta il tuo
 * Focus." Compare quando il Tactical Timer arriva a 00:00 e l'utente
 * chiude volontariamente la sessione (Termina Sessione / Avvia Pausa).
 * La scelta qualitativa alimenta direttamente il moltiplicatore XP
 * (utils/xpEngine.js#FOCUS_QUALITY_META) ed è tracciata nello Star Log.
 *
 * Blindato contro il doppio invio: dopo il primo click su una valutazione
 * i pulsanti vengono disabilitati finché il modal non si richiude, cosi'
 * un doppio tap accidentale non può registrare due volte la stessa sessione.
 */
export default function DebriefModal({ open, onClose, onSubmit, minutes = 0, overdrive = false }) {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setSubmitting(false);
  }, [open]);

  const handlePick = (quality) => {
    if (submitting) return;
    setSubmitting(true);
    onSubmit(quality);
  };

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title="Sessione Completata" maxWidth="max-w-lg">
      <div className="space-y-5">
        <div className="text-center space-y-1.5">
          <div className="w-14 h-14 mx-auto rounded-full border border-af-refuel/50 bg-af-refuel/10 flex items-center justify-center text-af-refuel shadow-refuel-glow">
            <Icon name="target" className="w-7 h-7" />
          </div>
          <p className="text-lg font-semibold">Valuta il tuo Focus</p>
          <p className="font-mono text-sm text-af-text-secondary af-mono-nums">
            {minutes} minuti registrati{overdrive ? ' · Overdrive incluso' : ''}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {RATING_ORDER.map((quality, idx) => {
            const meta = FOCUS_QUALITY_META[quality];
            return (
              <button
                key={quality}
                type="button"
                disabled={submitting}
                onClick={() => handlePick(quality)}
                style={{ animationDelay: `${idx * 60}ms` }}
                className={`af-debrief-card group flex items-center gap-4 p-4 rounded-xl border text-left ${meta.border} ${meta.bg} transition-all duration-300 hover:scale-[1.02] hover:brightness-125 active:scale-95 disabled:opacity-40 disabled:pointer-events-none`}
              >
                <div className={`w-11 h-11 rounded-xl border ${meta.border} flex items-center justify-center shrink-0 ${meta.color} bg-surface/70 ${meta.glow}`}>
                  <Icon name={meta.icon} className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-base ${meta.color}`}>{meta.label}</p>
                  <p className="text-sm text-slate-400 mt-0.5">{meta.hint}</p>
                </div>
                <span className={`shrink-0 font-mono text-sm px-2.5 py-1.5 rounded-full ${meta.color} bg-surface/70`}>
                  {meta.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
