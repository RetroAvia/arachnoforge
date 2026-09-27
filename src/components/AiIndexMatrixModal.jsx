import React, { useState, useMemo, useCallback } from 'react';
import Modal from './Modal.jsx';
import { Icon } from './Icons.jsx';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { parseAiIndexTree, AI_INDEX_EXAMPLE, buildAiIndexPrompt } from '../utils/aiIndexParser.js';
import { DIFFICULTY_META } from '../utils/xpEngine.js';
import { formatInt } from '../utils/format.js';
import { BTN_PRIMARY, BTN_GHOST, BADGE, LABEL } from '../utils/designSystem.js';

const DIFFICULTY_DOT = { EASY: 'bg-emerald-400', MEDIUM: 'bg-secondary', HARD: 'bg-primary' };

/** Anteprima ricorsiva dell'albero (i nodi sono già limitati dal parser). */
function PreviewNode({ node, depth }) {
  const diffMeta = DIFFICULTY_META[node.difficulty] || DIFFICULTY_META.MEDIUM;
  const root = depth === 0;
  return (
    <li className={root ? 'pt-2 first:pt-0' : 'pl-4 border-l border-line ml-1.5'}>
      <div className="flex items-center gap-2 py-1 min-w-0">
        {root && <Icon name="layers" className="w-3.5 h-3.5 shrink-0 text-secondary" />}
        <span className={`text-sm truncate ${root ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>{node.nome}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-500 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${DIFFICULTY_DOT[node.difficulty] || DIFFICULTY_DOT.MEDIUM}`} aria-hidden="true" />
          {diffMeta.label}
          {node.oreStimate ? <span className="ds-num">· {node.oreStimate} h</span> : null}
        </span>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, i) => (
            <PreviewNode key={i} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

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

/**
 * V27.0 — "AI Index Matrix": importazione in blocco dello Skill Tree.
 * Si fotografa l'indice del libro, lo si passa a un'IA esterna con il
 * prompt qui sotto e si incolla la risposta: validazione e anteprima dal
 * vivo, mai un import "alla cieca".
 *
 * V41 — prompt pronto da copiare, risposta accettata anche con testo o
 * blocchi di codice intorno al JSON, e l'import si può annullare dal
 * toast.
 */
export default function AiIndexMatrixModal({ open, onClose, materiaId, materiaNome }) {
  const { state, actions, pushToast } = useArachnoForge();
  const [rawText, setRawText] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);

  const prompt = useMemo(() => buildAiIndexPrompt(materiaNome), [materiaNome]);
  const parsed = useMemo(() => (rawText.trim() ? parseAiIndexTree(rawText) : null), [rawText]);
  const existingCount = useMemo(() => {
    const materie = Array.isArray(state.materie) ? state.materie : [];
    const m = materie.find((x) => x && x.id === materiaId);
    return Array.isArray(m?.sfide) ? m.sfide.length : 0;
  }, [state.materie, materiaId]);
  const parentCount = parsed && parsed.valid ? parsed.tree.length : 0;

  const handleClose = useCallback(() => {
    setRawText('');
    setShowPrompt(false);
    onClose();
  }, [onClose]);

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      pushToast('Prompt copiato: incollalo nell’IA insieme alla foto dell’indice.', 'success');
    } catch {
      setShowPrompt(true);
      pushToast('Copia automatica non riuscita: seleziona il prompt qui sotto e copialo a mano.', 'warning');
    }
  }, [prompt, pushToast]);

  const handleImport = useCallback(() => {
    if (!parsed || !parsed.valid || !materiaId) return;
    const result = actions.bulkImportSkillTree(materiaId, parsed.tree);
    if (result && result.valid) handleClose();
  }, [parsed, materiaId, actions, handleClose]);

  return (
    <Modal open={open} onClose={handleClose} title="AI Index Matrix" maxWidth="max-w-2xl">
      <div className="space-y-5">
        <p className="text-sm text-slate-400 leading-relaxed">
          Crea lo Skill Tree dall’indice del libro in un minuto
          {materiaNome ? (
            <>
              {' '}
              per <span className="text-slate-100 font-medium">{materiaNome}</span>
            </>
          ) : null}
          : capitoli come argomenti principali, paragrafi come sottoargomenti.
        </p>

        <ol className="space-y-3">
          <Step n={1}>Fotografa l’indice del libro (o delle dispense).</Step>
          <Step n={2}>
            <span>Carica la foto su ChatGPT, Claude o Gemini insieme a questo prompt.</span>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button type="button" onClick={copyPrompt} className={`${BTN_GHOST} ds-btn-sm`}>
                <Icon name="note" className="w-3.5 h-3.5" />
                Copia il prompt
              </button>
              <button
                type="button"
                onClick={() => setShowPrompt((v) => !v)}
                aria-expanded={showPrompt}
                className="ds-btn ds-btn-quiet ds-btn-sm"
              >
                <Icon name="chevronDown" className={`w-3.5 h-3.5 transition-transform ${showPrompt ? 'rotate-180' : ''}`} />
                {showPrompt ? 'Nascondi' : 'Leggi il prompt'}
              </button>
            </div>
            {showPrompt && (
              <pre className="mt-2 ds-well p-3 text-[12px] text-slate-400 whitespace-pre-wrap break-words leading-relaxed select-all font-mono">
                {prompt}
              </pre>
            )}
          </Step>
          <Step n={3}>Incolla qui sotto la risposta: va bene anche con il testo o il blocco di codice intorno al JSON.</Step>
        </ol>

        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="ai-index-json" className={LABEL}>
              Risposta dell’IA
            </label>
            <button type="button" onClick={() => setRawText(AI_INDEX_EXAMPLE)} className="text-xs text-slate-400 hover:text-white transition-colors mb-1.5">
              Carica un esempio
            </button>
          </div>
          <textarea
            id="ai-index-json"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={7}
            spellCheck={false}
            className="ds-input font-mono !text-xs resize-y min-h-[9rem]"
            placeholder='[ { "nome": "Capitolo 1", "sottoargomenti": ["Paragrafo A", "Paragrafo B"] } ]'
          />
        </div>

        {parsed && !parsed.valid && (
          <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/[0.07] px-3.5 py-3 text-[13px] text-primary leading-relaxed">
            <Icon name="alertTriangle" className="w-4 h-4 shrink-0 mt-0.5" />
            {parsed.error}
          </p>
        )}

        {parsed && parsed.valid && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={BADGE.green}>
                <Icon name="check" className="w-3.5 h-3.5" />
                Pronto da importare
              </span>
              <span className="text-xs text-slate-500">
                {formatInt(parentCount)} {parentCount === 1 ? 'capitolo' : 'capitoli'} · {formatInt(parsed.totalCount)}{' '}
                {parsed.totalCount === 1 ? 'argomento' : 'argomenti'} in tutto
                {existingCount > 0 ? ` · si aggiungono ai ${formatInt(existingCount)} già presenti` : ''}
              </span>
            </div>
            <ul className="max-h-64 overflow-y-auto af-scroll ds-well p-3.5">
              {parsed.tree.map((node, i) => (
                <PreviewNode key={i} node={node} depth={0} />
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <button type="button" onClick={handleClose} className={BTN_GHOST}>
            Annulla
          </button>
          <button type="button" disabled={!parsed || !parsed.valid || !materiaId} onClick={handleImport} className={BTN_PRIMARY}>
            <Icon name="download" className="w-4 h-4" />
            {parsed && parsed.valid ? `Importa ${formatInt(parsed.totalCount)} ${parsed.totalCount === 1 ? 'argomento' : 'argomenti'}` : 'Importa'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
