import React, { useState, useEffect, useId, useMemo, useRef } from 'react';
import Modal from './Modal.jsx';
import Dropdown from './Dropdown.jsx';
import { Icon } from './Icons.jsx';
import { FOCUS_QUALITY, FOCUS_QUALITY_META } from '../utils/xpEngine.js';
import { WORK_MODE, WORK_MODE_META, FONTE_TIPO_META, nodeSources, suggestPagesForSession } from '../utils/sintesiEngine.js';
import { argomentiSintesi } from '../utils/campusEngine.js';
import { deriveNodeStatus, NODE_STATUS } from '../utils/skillTree.js';
import { pagineLabel } from '../utils/format.js';
import { INPUT_SM } from '../utils/designSystem.js';

const RATING_ORDER = [FOCUS_QUALITY.FLOW, FOCUS_QUALITY.NORMAL, FOCUS_QUALITY.DISTRACTED];

/** Intero ≥ 0 da un campo di testo (vuoto = 0). */
const intero = (v) => Math.max(0, Math.round(Number(v) || 0));

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
 *  - i campi numerici compaiono SOLO in modo Sintesi, e sono
 *    facoltativi: si può continuare a chiudere la sessione con un
 *    click solo, come in V37;
 *  - i placeholder mostrano cosa ci si aspetterebbe al ritmo corrente,
 *    ma non precompilano nulla. Un numero scritto dall'app e poi
 *    rimisurato dall'app come se fosse un dato reale congelerebbe il
 *    ritmo sul suo stesso valore di partenza: la calibrazione
 *    smetterebbe di imparare proprio mentre sembra funzionare.
 *
 * V40.2 —
 *  - pagine snellite FONTE PER FONTE: un nodo può avere libro e slide, e
 *    un totale unico distribuito in ordine finiva sulla fonte sbagliata;
 *  - una sessione avviata da una lezione da sistemare (`intent`
 *    'SINTESI') parte in modo Sintesi e ti lascia dire su quale argomento
 *    della materia hai lavorato davvero;
 *  - dopo una sessione di Studio puoi segnare l'argomento come terminato
 *    (l'hai studiato tutto): è l'unico modo, insieme al Web-Matrix, in
 *    cui un nodo diventa Completato. La sola sintesi non lo chiude mai.
 */
export default function DebriefModal({
  open,
  onClose,
  onSubmit,
  minutes = 0,
  overdrive = false,
  sfida = null,
  materia = null,
  intent = null,
  calibration = null
}) {
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState(WORK_MODE.STUDIO);
  const [nodoId, setNodoId] = useState('');
  const [pagineFonte, setPagineFonte] = useState({});
  const [pagineAppunti, setPagineAppunti] = useState('');
  const [completaNodo, setCompletaNodo] = useState(false);
  const appuntiId = useId();
  const baseId = useId();

  const sintesiDichiarata = intent === WORK_MODE.SINTESI;
  const nodoIniziale = sfida?.id || '';
  const sfideMateria = useMemo(() => (Array.isArray(materia?.sfide) ? materia.sfide : []), [materia]);
  const nodo = useMemo(() => {
    if (!nodoId) return null;
    return sfideMateria.find((s) => s.id === nodoId) || (sfida && sfida.id === nodoId ? sfida : null);
  }, [nodoId, sfideMateria, sfida]);

  const src = useMemo(() => (nodo ? nodeSources(nodo) : null), [nodo]);
  const fontiAperte = useMemo(
    () =>
      (src?.fonti || []).filter(
        (f) => f && f.id && Math.max(0, Number(f.pagine) || 0) > Math.max(0, Number(f.pagineFatte) || 0)
      ),
    [src]
  );
  const haFontiAperte = !!src && src.totali > 0 && !src.conclusa && fontiAperte.length > 0;
  // Il blocco ha senso quando c'è davvero una sintesi in ballo su
  // questo nodo, o quando la sessione è nata come Sintesi (lezione).
  const mostraForgia = sintesiDichiarata || haFontiAperte;

  const argomenti = useMemo(() => (sintesiDichiarata && materia ? argomentiSintesi(materia) : []), [sintesiDichiarata, materia]);
  const opzioniNodo = useMemo(() => {
    const voci = argomenti.map((a) => ({
      value: a.id,
      label: a.nome,
      depth: a.profondita,
      hint:
        a.totali === 0
          ? 'senza fonti'
          : a.residue > 0 && !a.conclusa
          ? `${pagineLabel(a.residue)} da snellire`
          : 'sintesi chiusa'
    }));
    if (nodoIniziale && !voci.some((v) => v.value === nodoIniziale) && sfida) {
      voci.unshift({ value: nodoIniziale, label: sfida.nome || 'Argomento', hint: 'argomento della sessione' });
    }
    voci.push({ value: '', label: 'Nessun argomento preciso', hint: 'conta per la lezione, non aggiorna nessun nodo' });
    return voci;
  }, [argomenti, nodoIniziale, sfida]);

  const statoNodo = useMemo(() => (nodo ? deriveNodeStatus(nodo, sfideMateria.length ? sfideMateria : [nodo]) : null), [nodo, sfideMateria]);
  const completabile = statoNodo === NODE_STATUS.AVAILABLE || statoNodo === NODE_STATUS.IN_PROGRESS;
  const mostraTermina = !!nodo && completabile && mode === WORK_MODE.STUDIO;

  const suggerite = useMemo(
    () => suggestPagesForSession(minutes, calibration, WORK_MODE.SINTESI),
    [minutes, calibration]
  );

  // Reset SOLO all'apertura: cambiare argomento dentro il modal non deve
  // rimettere il modo che hai appena scelto.
  const eraAperto = useRef(false);
  useEffect(() => {
    if (open && !eraAperto.current) {
      const srcIniziale = sfida ? nodeSources(sfida) : null;
      const aperteIniziali = !!srcIniziale && srcIniziale.totali > 0 && !srcIniziale.conclusa;
      setSubmitting(false);
      setNodoId(nodoIniziale);
      setPagineFonte({});
      setPagineAppunti('');
      setCompletaNodo(false);
      setMode(sintesiDichiarata || aperteIniziali ? WORK_MODE.SINTESI : WORK_MODE.STUDIO);
    }
    eraAperto.current = open;
  }, [open, sfida, nodoIniziale, sintesiDichiarata]);

  const cambiaNodo = (id) => {
    setNodoId(id);
    setPagineFonte({});
    setCompletaNodo(false);
  };

  const handlePick = (quality) => {
    if (submitting) return;
    setSubmitting(true);
    const sintesi = mode === WORK_MODE.SINTESI;
    const perFonte = {};
    let somma = 0;
    if (sintesi) {
      fontiAperte.forEach((f) => {
        const n = intero(pagineFonte[f.id]);
        if (n > 0) {
          perFonte[f.id] = n;
          somma += n;
        }
      });
    }
    onSubmit(quality, {
      workMode: mode,
      pagineFonte: sintesi ? somma : 0,
      pagineFontePer: sintesi && somma > 0 ? perFonte : null,
      pagineAppuntiProdotte: sintesi && nodo ? intero(pagineAppunti) : 0,
      // Solo se l'hai cambiato: altrimenti vale quello della sessione.
      ...(nodoId !== nodoIniziale ? { sfidaId: nodoId || null } : {}),
      completaNodo: mostraTermina && completaNodo
    });
  };

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title="Sessione Completata" maxWidth="max-w-lg">
      <div className="space-y-5">
        <div className="text-center space-y-1.5">
          <div className="w-14 h-14 mx-auto rounded-full border border-af-refuel/50 bg-af-refuel/10 flex items-center justify-center text-af-refuel shadow-refuel-glow">
            <Icon name="target" className="w-7 h-7" />
          </div>
          <p className="text-lg font-semibold text-slate-100">Valuta il tuo Focus</p>
          <p className="font-mono text-sm text-slate-500 af-mono-nums">
            {minutes} minuti registrati{overdrive ? ' · Overdrive incluso' : ''}
            {nodo ? ` · ${nodo.nome}` : materia && sintesiDichiarata ? ` · ${materia.nome}` : ''}
          </p>
        </div>

        {mostraForgia && (
          <div className="rounded-xl border border-accent/25 bg-accent/[0.05] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-semibold tracking-widest text-accent flex items-center gap-1.5">
                <Icon name="flask" className="w-3.5 h-3.5" />
                COME L'HAI SPESA
              </p>
              {haFontiAperte && (
                <span className="text-[11px] font-mono text-slate-500">
                  {pagineLabel(src.residue)} di fonte ancora da snellire
                </span>
              )}
            </div>

            {sintesiDichiarata && materia && opzioniNodo.length > 1 && (
              <div>
                <p className="text-[11px] text-slate-400 mb-1">Argomento su cui hai lavorato</p>
                <Dropdown
                  compact
                  value={nodoId}
                  onChange={cambiaNodo}
                  options={opzioniNodo}
                  disabled={submitting}
                  ariaLabel="Argomento su cui hai lavorato"
                />
              </div>
            )}

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
              <div className="space-y-2.5">
                {!nodo ? (
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Senza un argomento la sessione conta per la lezione, ma non aggiorna le pagine di nessun nodo.
                  </p>
                ) : fontiAperte.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-400">Pagine snellite oggi, fonte per fonte</p>
                    {fontiAperte.map((f) => {
                      const meta = FONTE_TIPO_META[f.tipo] || FONTE_TIPO_META.ALTRO;
                      const totali = Math.max(0, Math.round(Number(f.pagine) || 0));
                      const fatte = Math.min(totali, Math.max(0, Math.round(Number(f.pagineFatte) || 0)));
                      const restano = totali - fatte;
                      const inputId = `${baseId}-${f.id}`;
                      const valore = pagineFonte[f.id] ?? '';
                      const oltre = intero(valore) > restano;
                      return (
                        <div key={f.id} className="flex items-center gap-2.5">
                          <label htmlFor={inputId} className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm text-slate-200 min-w-0">
                              <Icon name={meta.icon} className="w-3.5 h-3.5 shrink-0 text-accent" />
                              <span className="break-words">{f.etichetta ? `${meta.short} · ${f.etichetta}` : meta.label}</span>
                            </span>
                            <span className={`block text-[11px] font-mono mt-0.5 ${oltre ? 'text-accent' : 'text-slate-500'}`}>
                              {oltre ? `ne restano solo ${restano}: conto quelle` : `${fatte} di ${totali} già snellite`}
                            </span>
                          </label>
                          <input
                            id={inputId}
                            type="number"
                            min={0}
                            max={restano}
                            step={1}
                            inputMode="numeric"
                            value={valore}
                            onChange={(e) => setPagineFonte((prev) => ({ ...prev, [f.id]: e.target.value }))}
                            placeholder={fontiAperte.length === 1 && suggerite ? `~${Math.min(suggerite, restano)}` : '0'}
                            disabled={submitting}
                            className={`${INPUT_SM} !w-24 shrink-0 text-right`}
                            aria-label={`Pagine snellite oggi: ${meta.label}${f.etichetta ? ` ${f.etichetta}` : ''}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {src && src.totali > 0
                      ? 'Le fonti di questo argomento sono già tutte snellite.'
                      : 'Questo argomento non ha fonti: aggiungile nel Web-Matrix (Forgia degli Appunti) per tenere il conto delle pagine snellite.'}
                  </p>
                )}

                {nodo && (
                  <div className="flex items-center gap-2.5">
                    <label htmlFor={appuntiId} className="min-w-0 flex-1 text-sm text-slate-200">
                      Pagine tue prodotte
                      <span className="block text-[11px] text-slate-500 mt-0.5">i tuoi appunti definitivi</span>
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
                      className={`${INPUT_SM} !w-24 shrink-0 text-right`}
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 leading-relaxed">{WORK_MODE_META.STUDIO.hint}</p>
            )}

            {mode === WORK_MODE.SINTESI && nodo && (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Facoltativi: lasciandoli vuoti si registra solo il tempo. Le pagine vanno dritte sul nodo (già snellite) e
                sono i numeri con cui K.A.R.E.N. impara il tuo ritmo di sintesi.
              </p>
            )}
          </div>
        )}

        {mostraTermina && (
          <button
            type="button"
            role="switch"
            aria-checked={completaNodo}
            disabled={submitting}
            onClick={() => setCompletaNodo((v) => !v)}
            className={`w-full flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all duration-300 disabled:opacity-40 ${
              completaNodo ? 'border-emerald-400/50 bg-emerald-500/[0.08]' : 'border-white/10 bg-surface/60 hover:border-white/25'
            }`}
          >
            <span
              className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${
                completaNodo ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' : 'border-white/25 text-transparent'
              }`}
            >
              <Icon name="check" className="w-3.5 h-3.5" />
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${completaNodo ? 'text-emerald-300' : 'text-slate-200'}`}>
                Argomento terminato: l'ho studiato tutto
              </span>
              <span className="block text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                "{nodo.nome}" passa a Completato e parte il primo ripasso Spider-Sense. Lascialo spento se devi ancora
                finirlo.
              </span>
            </span>
          </button>
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
