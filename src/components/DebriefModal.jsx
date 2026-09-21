import React, { useState, useEffect, useId, useMemo } from 'react';
import Modal from './Modal.jsx';
import { Icon } from './Icons.jsx';
import { FOCUS_QUALITY, FOCUS_QUALITY_META } from '../utils/xpEngine.js';
import { WORK_MODE, WORK_MODE_META, nodeSources, suggestPagesForSession } from '../utils/sintesiEngine.js';
import { INPUT_SM } from '../utils/designSystem.js';

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
 *
 * V38.0 — "La Forgia degli Appunti": se la sessione era agganciata a un
 * argomento, qui sopra compare anche COME è stata spesa.
 *
 * Il costo in attrito è stato il vincolo di progetto: questo modal si
 * apre dopo ogni singolo pomodoro, e una schermata che chiede tre cose
 * invece di una viene odiata entro la terza volta. Quindi:
 *  - il modo è preselezionato dallo stato reale del nodo (restano
 *    pagine di fonte da snellire? Sintesi. Altrimenti Studio) e nel caso
 *    normale non va toccato;
 *  - i due campi numerici compaiono SOLO in modo Sintesi, e sono
 *    facoltativi: si può continuare a chiudere la sessione con un
 *    click solo, come in V37;
 *  - i placeholder mostrano cosa ci si aspetterebbe al ritmo corrente,
 *    ma non precompilano nulla. Un numero scritto dall'app e poi
 *    rimisurato dall'app come se fosse un dato reale congelerebbe il
 *    ritmo sul suo stesso valore di partenza: la calibrazione
 *    smetterebbe di imparare proprio mentre sembra funzionare.
 */
export default function DebriefModal({
  open,
  onClose,
  onSubmit,
  minutes = 0,
  overdrive = false,
  sfida = null,
  calibration = null
}) {
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState(WORK_MODE.STUDIO);
  const fonteId = useId();
  const appuntiId = useId();
  const [pagineFonte, setPagineFonte] = useState('');
  const [pagineAppunti, setPagineAppunti] = useState('');

  const src = useMemo(() => (sfida ? nodeSources(sfida) : null), [sfida]);
  // Il blocco ha senso solo se c'è davvero una sintesi in ballo su
  // questo nodo: un argomento senza fonti non ha due modi fra cui
  // scegliere, e mostrargli un selettore sarebbe rumore puro.
  const mostraForgia = !!src && src.totali > 0 && !src.conclusa;
  const suggerite = useMemo(
    () => suggestPagesForSession(minutes, calibration, WORK_MODE.SINTESI),
    [minutes, calibration]
  );

  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    setPagineFonte('');
    setPagineAppunti('');
    setMode(mostraForgia ? WORK_MODE.SINTESI : WORK_MODE.STUDIO);
  }, [open, mostraForgia]);

  const handlePick = (quality) => {
    if (submitting) return;
    setSubmitting(true);
    onSubmit(quality, {
      workMode: mode,
      pagineFonte: mode === WORK_MODE.SINTESI ? Math.max(0, Number(pagineFonte) || 0) : 0,
      pagineAppuntiProdotte: mode === WORK_MODE.SINTESI ? Math.max(0, Number(pagineAppunti) || 0) : 0
    });
  };

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title="Sessione Completata" maxWidth="max-w-lg">
      <div className="space-y-5">
        <div className="text-center space-y-1.5">
          <div className="w-14 h-14 mx-auto rounded-full border border-af-refuel/50 bg-af-refuel/10 flex items-center justify-center text-af-refuel shadow-refuel-glow">
            <Icon name="target" className="w-7 h-7" />
          </div>
          <p className="text-lg font-semibold">Valuta il tuo Focus</p>
          <p className="font-mono text-sm text-slate-500 af-mono-nums">
            {minutes} minuti registrati{overdrive ? ' · Overdrive incluso' : ''}
            {sfida ? ` · ${sfida.nome}` : ''}
          </p>
        </div>

        {mostraForgia && (
          <div className="rounded-xl border border-accent/25 bg-accent/[0.05] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-semibold tracking-widest text-accent flex items-center gap-1.5">
                <Icon name="flask" className="w-3.5 h-3.5" />
                COME L'HAI SPESA
              </p>
              <span className="text-[11px] font-mono text-slate-500">
                {src.residue} pagine di fonte ancora da snellire
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Modo di lavoro della sessione">
              {[WORK_MODE.SINTESI, WORK_MODE.STUDIO].map((m) => {
                const meta = WORK_MODE_META[m];
                const attivo = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={attivo}
                    disabled={submitting}
                    onClick={() => setMode(m)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all duration-300 disabled:opacity-40 ${
                      attivo
                        ? `${meta.border} ${meta.bg} ${meta.color}`
                        : 'border-white/10 bg-surface/60 text-slate-400 hover:border-white/25'
                    }`}
                  >
                    <Icon name={meta.icon} className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-semibold">{meta.label}</span>
                  </button>
                );
              })}
            </div>

            {mode === WORK_MODE.SINTESI ? (
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor={fonteId} className="text-[11px] text-slate-400 block mb-1">
                    Pagine di fonte fatte
                  </label>
                  <input
                    id={fonteId}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={pagineFonte}
                    onChange={(e) => setPagineFonte(e.target.value)}
                    placeholder={suggerite ? `~${suggerite}` : '0'}
                    disabled={submitting}
                    className={INPUT_SM}
                  />
                </div>
                <div>
                  <label htmlFor={appuntiId} className="text-[11px] text-slate-400 block mb-1">
                    Pagine tue prodotte
                  </label>
                  <input
                    id={appuntiId}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={pagineAppunti}
                    onChange={(e) => setPagineAppunti(e.target.value)}
                    placeholder="0"
                    disabled={submitting}
                    className={INPUT_SM}
                  />
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 leading-relaxed">{WORK_MODE_META.STUDIO.hint}</p>
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Facoltativi: lasciandoli vuoti si registra solo il tempo. Ma sono i due numeri con cui K.A.R.E.N. impara
              il tuo ritmo di sintesi e quanto si restringe il materiale nelle tue mani.
            </p>
          </div>
        )}

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
