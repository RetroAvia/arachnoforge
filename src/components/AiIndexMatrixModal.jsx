import React, { useState, useMemo, useCallback } from 'react';
import Modal from './Modal.jsx';
import { Icon } from './Icons.jsx';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { parseAiIndexTree, AI_INDEX_EXAMPLE } from '../utils/aiIndexParser.js';
import { DIFFICULTY_META } from '../utils/xpEngine.js';
import { BTN_PRIMARY, BTN_GHOST, BADGE } from '../utils/designSystem.js';

/** Renderizza ricorsivamente l'anteprima dell'albero — profondità limitata
 * visivamente via rientro, mai un render pesante (i nodi sono già
 * validati/limitati a MAX_AI_INDEX_NODES dal parser prima di arrivare qui). */
function PreviewNode({ node, depth }) {
  const diffMeta = DIFFICULTY_META[node.difficulty] || DIFFICULTY_META.MEDIUM;
  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }} className={depth > 0 ? 'border-l border-secondary/20 pl-3 mt-1.5' : 'mt-1.5'}>
      <div className="flex items-center gap-2 flex-wrap py-0.5">
        <Icon name={depth === 0 ? 'grid' : 'target'} className={`w-3.5 h-3.5 shrink-0 ${depth === 0 ? 'text-secondary' : 'text-slate-500'}`} />
        <span className={`text-sm truncate ${depth === 0 ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>{node.nome}</span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border shrink-0 ${diffMeta.border} ${diffMeta.color}`}>
          {diffMeta.label}
        </span>
      </div>
      {node.children.map((child, i) => (
        <PreviewNode key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

/**
 * V27.0 — Pillar 2: "AI Index Matrix" — modale di importazione bulk per lo
 * Skill Tree. Flusso: l'utente scatta una foto all'indice di un libro,
 * la incolla in un prompt esterno (ChatGPT/Claude/Gemini...) chiedendo
 * l'output JSON nel formato documentato qui sotto, poi incolla il
 * risultato in questo textarea. Validazione + anteprima live, mai un
 * import "alla cieca": l'utente vede ESATTAMENTE cosa sta per essere
 * scritto nel Web-Matrix prima di confermare.
 */
export default function AiIndexMatrixModal({ open, onClose, materiaId, materiaNome }) {
  const { actions } = useArachnoForge();
  const [rawText, setRawText] = useState('');
  const [showFormat, setShowFormat] = useState(false);

  const parsed = useMemo(() => (rawText.trim() ? parseAiIndexTree(rawText) : null), [rawText]);

  const handleClose = useCallback(() => {
    setRawText('');
    onClose();
  }, [onClose]);

  const handleLoadExample = useCallback(() => setRawText(AI_INDEX_EXAMPLE), []);

  const handleImport = useCallback(() => {
    if (!parsed || !parsed.valid || !materiaId) return;
    const result = actions.bulkImportSkillTree(materiaId, parsed.tree);
    if (result && result.valid) handleClose();
  }, [parsed, materiaId, actions, handleClose]);

  return (
    <Modal open={open} onClose={handleClose} title="AI Index Matrix — Importazione Skill Tree" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="flex items-start gap-3 bg-secondary/10 border border-secondary/30 rounded-xl px-4 py-3.5">
          <Icon name="chip" className="w-5 h-5 text-secondary shrink-0 mt-0.5" />
          <div className="text-sm text-slate-300 leading-relaxed">
            Scatta una foto all'indice di un libro/materia, incollala in un prompt IA esterno chiedendo l'output in JSON
            (Nodo Padre = capitolo, Nodi Figli = sottoargomenti), poi incolla qui il risultato.
            {materiaNome && (
              <>
                {' '}
                I nodi verranno aggiunti a <span className="font-semibold text-secondary">{materiaNome}</span>.
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowFormat((v) => !v)}
          className="text-xs text-slate-400 hover:text-secondary transition-all duration-300 flex items-center gap-1.5"
        >
          <Icon name="chevronDown" className={`w-3.5 h-3.5 transition-transform duration-300 ${showFormat ? 'rotate-180' : ''}`} />
          {showFormat ? 'Nascondi formato atteso' : 'Mostra formato atteso'}
        </button>
        {showFormat && (
          <pre className="text-[11px] font-mono text-slate-400 bg-surface/90 border border-white/10 rounded-xl p-3.5 overflow-x-auto af-scroll leading-relaxed">
{`[
  { "nome": "Capitolo 1", "sottoargomenti": [
    "Sottoargomento A",
    { "nome": "Sottoargomento B", "difficolta": "HARD", "ore": 8 }
  ]},
  { "nome": "Capitolo 2", "sottoargomenti": ["..."] }
]`}
          </pre>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm text-slate-400">Struttura JSON</label>
            <button type="button" onClick={handleLoadExample} className="text-xs text-secondary hover:text-white transition-all duration-300">
              Carica Esempio
            </button>
          </div>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={7}
            spellCheck={false}
            className="w-full bg-surface/80 border border-secondary/30 rounded-xl px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors font-mono text-xs resize-y"
            placeholder='[ { "nome": "Capitolo 1", "sottoargomenti": ["Argomento A", "Argomento B"] } ]'
          />
        </div>

        {parsed && !parsed.valid && (
          <div className="flex items-start gap-3 bg-primary/10 border border-primary/40 rounded-xl px-4 py-3.5">
            <Icon name="alertTriangle" className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-primary">{parsed.error}</p>
          </div>
        )}

        {parsed && parsed.valid && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={BADGE.green}>
                <Icon name="check" className="w-3.5 h-3.5" />
                Struttura valida
              </span>
              <span className={BADGE.slate}>{parsed.totalCount} nodi totali</span>
            </div>
            <div className="max-h-64 overflow-y-auto af-scroll bg-surface/60 border border-secondary/15 rounded-xl p-3.5">
              {parsed.tree.map((node, i) => (
                <PreviewNode key={i} node={node} depth={0} />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="button" onClick={handleClose} className={`flex-1 ${BTN_GHOST}`}>
            Annulla
          </button>
          <button
            type="button"
            disabled={!parsed || !parsed.valid || !materiaId}
            onClick={handleImport}
            className={`flex-1 ${BTN_PRIMARY}`}
          >
            <Icon name="download" className="w-5 h-5" />
            Importa {parsed && parsed.valid ? `${parsed.totalCount} Nodi` : 'Nodi'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
