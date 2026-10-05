import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { Icon } from './Icons.jsx';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import {
  buildAiNotesPrompt,
  parseAiNotes,
  treeOrder,
  mergeNote,
  NOTE_MODE,
  AI_NOTES_BATCH_SUGGESTED,
  AI_NOTES_BATCH_WARN,
  AI_NOTES_KAREN_CHARS
} from '../utils/aiNotes.js';
import { formatoMeta } from '../utils/appelli.js';
import { formatInt } from '../utils/format.js';
import { BTN_PRIMARY, BTN_GHOST, BADGE, LABEL } from '../utils/designSystem.js';

function Step({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-panel-3 border border-line-strong text-xs font-semibold text-slate-200 flex items-center justify-center shrink-0 ds-num">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-sm text-slate-300 leading-relaxed pt-0.5">{children}</div>
    </li>
  );
}

const haAppunti = (s) => typeof s?.note === 'string' && s.note.trim().length > 0;

/**
 * V44 — APPUNTI CON L'IA ESTERNA.
 *
 * Scegli gli argomenti, copia il prompt, lo dai a ChatGPT/Claude/Gemini
 * insieme al tuo materiale (slide, libro, dispense, foto degli appunti) e
 * incolli qui la risposta: anteprima argomento per argomento, poi gli
 * appunti finiscono sui nodi, nel formato che K.A.R.E.N. sa leggere per
 * quiz, orale e correzioni (vedi utils/aiNotes.js).
 *
 * Due modi:
 *  - dallo Skill Tree (più argomenti, si salva subito: `materia`);
 *  - dall'editor di un argomento (`sfidaFissa` + `onApply`): il testo va
 *    nel campo Appunti dell'editor, e lo salvi tu col resto.
 */
export default function AiNotesModal({ open, onClose, materia, sfidaFissa = null, onApply = null, noteAttuali = null }) {
  const { actions, pushToast } = useArachnoForge();
  const sfide = useMemo(() => (Array.isArray(materia?.sfide) ? materia.sfide.filter(Boolean) : []), [materia]);
  const albero = useMemo(() => treeOrder(sfide), [sfide]);
  const singolo = !!sfidaFissa;

  // Nell'editor contano gli appunti che stai scrivendo, non quelli salvati.
  const sfideEffettive = useMemo(
    () => (singolo && typeof noteAttuali === 'string' ? sfide.map((s) => (s.id === sfidaFissa.id ? { ...s, note: noteAttuali } : s)) : sfide),
    [sfide, singolo, sfidaFissa, noteAttuali]
  );
  const byId = useMemo(() => new Map(sfideEffettive.map((s) => [s.id, s])), [sfideEffettive]);

  const [scelti, setScelti] = useState(() => new Set());
  const [migliora, setMigliora] = useState(false);
  const [rawText, setRawText] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [mode, setMode] = useState(NOTE_MODE.SOSTITUISCI);

  // Selezione iniziale a ogni apertura: l'argomento dell'editor, oppure i
  // primi senza appunti (un blocco che l'IA regge in una risposta).
  const eraAperto = useRef(false);
  useEffect(() => {
    if (open && !eraAperto.current) {
      if (singolo) {
        setScelti(new Set([sfidaFissa.id]));
        const conTesto = haAppunti(byId.get(sfidaFissa.id));
        setMigliora(conTesto);
        setMode(NOTE_MODE.SOSTITUISCI);
      } else {
        const vuoti = albero.filter(({ sfida }) => !haAppunti(sfida)).slice(0, AI_NOTES_BATCH_SUGGESTED);
        setScelti(new Set(vuoti.map(({ sfida }) => sfida.id)));
        setMigliora(false);
        setMode(NOTE_MODE.AGGIUNGI);
      }
      setRawText('');
      setShowPrompt(false);
    }
    eraAperto.current = open;
  }, [open, singolo, sfidaFissa, albero, byId]);

  // Migliorare = riscrivere: di norma si sostituisce; partendo da zero, si aggiunge.
  useEffect(() => {
    setMode(migliora ? NOTE_MODE.SOSTITUISCI : NOTE_MODE.AGGIUNGI);
  }, [migliora]);

  const sceltiOrdinati = useMemo(() => albero.filter(({ sfida }) => scelti.has(sfida.id)).map(({ sfida }) => byId.get(sfida.id)), [albero, scelti, byId]);
  const sceltiConAppunti = sceltiOrdinati.filter(haAppunti).length;
  const formato = useMemo(() => (materia ? formatoMeta(materia) : null), [materia]);

  const prompt = useMemo(
    () => (sceltiOrdinati.length > 0 ? buildAiNotesPrompt({ materia: { ...materia, sfide: sfideEffettive }, sfide: sceltiOrdinati, migliora, formato }) : ''),
    [materia, sfideEffettive, sceltiOrdinati, migliora, formato]
  );

  const parsed = useMemo(() => (rawText.trim() ? parseAiNotes(rawText, sfideEffettive) : null), [rawText, sfideEffettive]);
  // Nell'editor vale solo l'argomento aperto.
  const blocchi = useMemo(() => {
    if (!parsed?.valid) return [];
    return singolo ? parsed.blocchi.filter((b) => b.sfidaId === sfidaFissa.id) : parsed.blocchi;
  }, [parsed, singolo, sfidaFissa]);
  const mancanti = useMemo(() => {
    if (!parsed?.valid) return [];
    const arrivati = new Set(parsed.blocchi.map((b) => b.sfidaId));
    return sceltiOrdinati.filter((s) => !arrivati.has(s.id));
  }, [parsed, sceltiOrdinati]);
  const sovrascrivono = blocchi.filter((b) => haAppunti(byId.get(b.sfidaId))).length;

  const toggle = (id) =>
    setScelti((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleClose = useCallback(() => {
    setRawText('');
    setShowPrompt(false);
    onClose();
  }, [onClose]);

  const copyPrompt = useCallback(async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      pushToast('Prompt copiato: incollalo nell’IA e allega il tuo materiale (PDF, slide, foto).', 'success');
    } catch {
      setShowPrompt(true);
      pushToast('Copia automatica non riuscita: seleziona il prompt qui sotto e copialo a mano.', 'warning');
    }
  }, [prompt, pushToast]);

  const handleSave = useCallback(() => {
    if (blocchi.length === 0) return;
    if (singolo && typeof onApply === 'function') {
      const attuale = byId.get(sfidaFissa.id)?.note || '';
      onApply(mergeNote(attuale, blocchi[0].note, mode));
      handleClose();
      return;
    }
    if (!materia) return;
    const res = actions.importAiNotes(materia.id, blocchi, mode);
    if (res && res.count > 0) handleClose();
  }, [blocchi, singolo, onApply, byId, sfidaFissa, mode, materia, actions, handleClose]);

  const selezionaMancanti = () => {
    setScelti(new Set(mancanti.map((s) => s.id)));
    setRawText('');
    pushToast('Selezionati gli argomenti mancanti: copia di nuovo il prompt.', 'info');
  };

  const titolo = singolo ? `Appunti con l’IA · ${sfidaFissa.nome || 'argomento'}` : 'Appunti con l’IA';

  return (
    <Modal open={open} onClose={handleClose} title={titolo} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <p className="text-sm text-slate-400 leading-relaxed">
          Fai scrivere gli appunti a un’IA esterna a partire dal <span className="text-slate-200">tuo</span> materiale: definizioni, formule con il significato
          dei simboli, procedimenti, errori tipici e domande d’esame, nel formato che K.A.R.E.N. usa per interrogarti e correggerti.
        </p>

        <ol className="space-y-4">
          {!singolo && (
            <Step n={1}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span>
                  Scegli gli argomenti{' '}
                  <span className="text-slate-500">
                    · {formatInt(scelti.size)} di {formatInt(sfide.length)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="ds-btn ds-btn-quiet ds-btn-sm"
                    onClick={() => setScelti(new Set(albero.filter(({ sfida }) => !haAppunti(sfida)).slice(0, AI_NOTES_BATCH_SUGGESTED).map(({ sfida }) => sfida.id)))}
                  >
                    Prossimi senza appunti
                  </button>
                  <button type="button" className="ds-btn ds-btn-quiet ds-btn-sm" onClick={() => setScelti(new Set())}>
                    Nessuno
                  </button>
                </span>
              </div>
              <ul className="mt-2 max-h-56 overflow-y-auto af-scroll ds-well p-2 space-y-0.5" aria-label="Argomenti">
                {albero.map(({ sfida, depth }) => {
                  const s = byId.get(sfida.id) || sfida;
                  const on = scelti.has(s.id);
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(s.id)}
                        className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${on ? 'bg-secondary/10' : 'hover:bg-white/[0.03]'}`}
                        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
                      >
                        <span
                          className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                            on ? 'border-secondary bg-secondary/20 text-secondary' : 'border-white/25 text-transparent'
                          }`}
                        >
                          <Icon name="check" className="w-3 h-3" />
                        </span>
                        <span className={`text-sm truncate ${depth === 0 ? 'text-slate-100 font-medium' : 'text-slate-300'}`}>{s.nome}</span>
                        <span className="ml-auto text-[11px] shrink-0 ds-num text-slate-500">
                          {haAppunti(s) ? `${formatInt(s.note.trim().length)} car.` : 'senza appunti'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {scelti.size > AI_NOTES_BATCH_WARN && (
                <p className="text-xs text-accent mt-1.5">
                  {formatInt(scelti.size)} argomenti in una volta: l’IA rischia di tagliare la risposta. Meglio {AI_NOTES_BATCH_SUGGESTED} per volta (puoi
                  ripetere: gli argomenti già fatti si vedono dai caratteri).
                </p>
              )}
            </Step>
          )}

          <Step n={singolo ? 1 : 2}>
            <span>Copia il prompt e incollalo in ChatGPT, Claude o Gemini, allegando il materiale di questi argomenti (PDF, slide, pagine del libro, foto).</span>
            {sceltiConAppunti > 0 && (
              <button
                type="button"
                role="switch"
                aria-checked={migliora}
                onClick={() => setMigliora((v) => !v)}
                className={`mt-2 w-full flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                  migliora ? 'border-secondary/40 bg-secondary/[0.06]' : 'border-line bg-surface hover:border-line-strong'
                }`}
              >
                <span
                  className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                    migliora ? 'border-secondary bg-secondary/20 text-secondary' : 'border-white/25 text-transparent'
                  }`}
                >
                  <Icon name="check" className="w-3 h-3" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-slate-100 font-medium">Migliora i miei appunti attuali</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    {sceltiConAppunti === 1 ? 'Un argomento ha già appunti' : `${sceltiConAppunti} argomenti hanno già appunti`}: l’IA li riceve, li corregge e li
                    completa invece di ripartire da zero.
                  </span>
                </span>
              </button>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button type="button" onClick={copyPrompt} disabled={!prompt} className={`${BTN_GHOST} ds-btn-sm`}>
                <Icon name="note" className="w-3.5 h-3.5" />
                Copia il prompt
              </button>
              <button
                type="button"
                onClick={() => setShowPrompt((v) => !v)}
                aria-expanded={showPrompt}
                disabled={!prompt}
                className="ds-btn ds-btn-quiet ds-btn-sm"
              >
                <Icon name="chevronDown" className={`w-3.5 h-3.5 transition-transform ${showPrompt ? 'rotate-180' : ''}`} />
                {showPrompt ? 'Nascondi' : 'Leggi il prompt'}
              </button>
            </div>
            {!prompt && <p className="text-xs text-slate-500 mt-1.5">Scegli almeno un argomento.</p>}
            {showPrompt && prompt && (
              <pre className="mt-2 max-h-64 overflow-y-auto af-scroll ds-well p-3 text-[12px] text-slate-400 whitespace-pre-wrap break-words leading-relaxed select-all font-mono">
                {prompt}
              </pre>
            )}
          </Step>

          <Step n={singolo ? 2 : 3}>Incolla qui sotto tutta la risposta (va bene anche con il blocco di codice intorno).</Step>
        </ol>

        <div>
          <label htmlFor="ai-notes-text" className={LABEL}>
            Risposta dell’IA
          </label>
          <textarea
            id="ai-notes-text"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={7}
            spellCheck={false}
            className="ds-input font-mono !text-xs resize-y min-h-[9rem]"
            placeholder={'@@ARGOMENTO [abc123] Titolo\n## In breve\n…\n@@FINE'}
          />
        </div>

        {parsed && !parsed.valid && (
          <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/[0.07] px-3.5 py-3 text-[13px] text-primary leading-relaxed">
            <Icon name="alertTriangle" className="w-4 h-4 shrink-0 mt-0.5" />
            {parsed.error}
          </p>
        )}

        {parsed && parsed.valid && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              {blocchi.length > 0 ? (
                <span className={BADGE.green}>
                  <Icon name="check" className="w-3.5 h-3.5" />
                  {formatInt(blocchi.length)} {blocchi.length === 1 ? 'argomento riconosciuto' : 'argomenti riconosciuti'}
                </span>
              ) : (
                <span className={BADGE.amber}>Nella risposta non c’è questo argomento</span>
              )}
              {sovrascrivono > 0 && (
                <span className="text-xs text-slate-500">
                  {sovrascrivono === 1 ? '1 ha già appunti' : `${sovrascrivono} hanno già appunti`}
                </span>
              )}
            </div>

            {blocchi.length > 0 && (
              <ul className="max-h-60 overflow-y-auto af-scroll ds-well p-2.5 space-y-1.5">
                {blocchi.map((b) => (
                  <li key={b.sfidaId}>
                    <details className="group">
                      <summary className="flex items-center gap-2 cursor-pointer list-none rounded-lg px-1.5 py-1 hover:bg-white/[0.03]">
                        <Icon name="chevronRight" className="w-3.5 h-3.5 text-slate-500 transition-transform group-open:rotate-90 shrink-0" />
                        <span className="text-sm text-slate-200 truncate">{b.nome}</span>
                        <span className={`ml-auto text-[11px] ds-num shrink-0 ${b.troppoLungo ? 'text-accent' : 'text-slate-500'}`}>
                          {formatInt(b.caratteri)} car.{haAppunti(byId.get(b.sfidaId)) ? (mode === NOTE_MODE.AGGIUNGI ? ' · si aggiunge' : ' · sostituisce') : ' · nuovo'}
                        </span>
                      </summary>
                      <pre className="mt-1 ml-6 max-h-48 overflow-y-auto af-scroll text-[11px] text-slate-400 whitespace-pre-wrap break-words font-mono leading-relaxed">
                        {b.note}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}

            {blocchi.some((b) => b.troppoLungo) && (
              <p className="text-xs text-accent">
                Alcuni appunti superano {formatInt(AI_NOTES_KAREN_CHARS)} caratteri: li salvi interi, ma K.A.R.E.N. per le domande ne legge i primi{' '}
                {formatInt(AI_NOTES_KAREN_CHARS)}.
              </p>
            )}
            {!singolo && mancanti.length > 0 && (
              <div className="flex items-center justify-between gap-2 flex-wrap rounded-xl border border-accent/30 bg-accent/[0.06] px-3 py-2">
                <p className="text-xs text-accent">
                  {mancanti.length === 1 ? 'Manca' : `Mancano ${mancanti.length} argomenti`}: {mancanti.slice(0, 4).map((s) => s.nome).join(', ')}
                  {mancanti.length > 4 ? '…' : ''} (risposta tagliata?). Salva questi e poi rifai il prompt per i mancanti.
                </p>
                <button type="button" onClick={selezionaMancanti} className="ds-btn ds-btn-quiet ds-btn-sm">
                  Seleziona i mancanti
                </button>
              </div>
            )}
            {parsed.sconosciuti.length > 0 && (
              <p className="text-xs text-slate-500">
                Non riconosciuti (codice che non è di questa materia): {parsed.sconosciuti.slice(0, 4).join(', ')}
                {parsed.sconosciuti.length > 4 ? '…' : ''}
              </p>
            )}

            {sovrascrivono > 0 && blocchi.length > 0 && (
              <div className="ds-segmented grid grid-cols-2 w-full" role="radiogroup" aria-label="Appunti già presenti">
                {[
                  [NOTE_MODE.SOSTITUISCI, 'Sostituisci i miei appunti'],
                  [NOTE_MODE.AGGIUNGI, 'Aggiungi sotto ai miei']
                ].map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className="justify-center">
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <button type="button" onClick={handleClose} className={BTN_GHOST}>
            Annulla
          </button>
          <button type="button" disabled={blocchi.length === 0} onClick={handleSave} className={BTN_PRIMARY}>
            <Icon name="download" className="w-4 h-4" />
            {singolo
              ? 'Inserisci negli appunti'
              : blocchi.length > 0
              ? `Salva gli appunti in ${formatInt(blocchi.length)} ${blocchi.length === 1 ? 'argomento' : 'argomenti'}`
              : 'Salva gli appunti'}
          </button>
        </div>
        {!singolo && blocchi.length > 0 && (
          <p className="text-[11px] text-slate-500 text-right -mt-3">
            Se sostituisci appunti esistenti viene salvato prima un punto di ripristino; per qualche secondo puoi anche annullare.
          </p>
        )}
      </div>
    </Modal>
  );
}
