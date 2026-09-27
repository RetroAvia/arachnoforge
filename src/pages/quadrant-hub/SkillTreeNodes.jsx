import React, { useState, memo } from 'react';
import { Icon } from '../../components/Icons.jsx';
import { deriveNodeStatus, NODE_STATUS, directChildrenOf } from '../../utils/skillTree.js';
import { DIFFICULTY_META } from '../../utils/xpEngine.js';
import { REVIEW_RATING, REVIEW_RATING_META, previewReviewIntervals } from '../../utils/spiderSense.js';
import { BADGE } from '../../utils/designSystem.js';

// =====================================================================
// Skill Tree del Web-Matrix — Nodo Padre ("Boss") e Nodi Figlio.
// Componenti presentazionali puri: ricevono `materia`/`sfide` come props
// e chiamano `onSelect`/`onToggleSelect` verso l'alto, senza leggere lo
// stato della pagina (QuadrantHub).
//
// V41 — ridisegno "premium": niente più vetro sfocato, aloni e righe che
// saltano al passaggio del mouse. Lo stato di ogni argomento si legge da
// una barra di colore a sinistra e da un'etichetta con parole normali
// ("Da studiare", "Da ripassare"...), la gerarchia da un ramo sottile.
// =====================================================================

/**
 * Stati del nodo. V16.0 (Pillar 1) — LOCKED non significa "il padre non è
 * completato": i figli sono sempre liberi. LOCKED indica un nodo "Boss"
 * (con sotto-argomenti) che non si può ancora chiudere perché non tutti i
 * suoi figli diretti sono COMPLETED.
 *
 * `bar` colora la barra laterale della card, `tile` il riquadro
 * dell'icona: classi statiche, mai composte a runtime.
 */
export const STATUS_META = {
  LOCKED: {
    label: 'In attesa',
    text: 'text-slate-400',
    badge: BADGE.slate,
    icon: 'lock',
    bar: 'bg-slate-600',
    tile: 'text-slate-400'
  },
  AVAILABLE: {
    label: 'Da studiare',
    text: 'text-secondary',
    badge: BADGE.blue,
    icon: 'target',
    bar: 'bg-secondary',
    tile: 'text-secondary'
  },
  // V35.5 — "In corso": ciano fisso, distinto sia da "Da studiare" (blu)
  // sia da "Completato" (verde): c'è già tempo investito, ma non è chiuso.
  IN_PROGRESS: {
    label: 'In corso',
    text: 'text-cyan-300',
    badge: BADGE.cyan,
    icon: 'bolt',
    bar: 'bg-cyan-400',
    tile: 'text-cyan-300'
  },
  COMPLETED: {
    label: 'Completato',
    text: 'text-emerald-300',
    badge: BADGE.green,
    icon: 'check',
    bar: 'bg-emerald-400',
    tile: 'text-emerald-300'
  },
  NEEDS_REVIEW: {
    label: 'Da ripassare',
    text: 'text-accent',
    badge: BADGE.amber,
    icon: 'radar',
    bar: 'bg-accent',
    tile: 'text-accent'
  }
};

/** Pallino colorato della difficoltà: un dettaglio, non un secondo semaforo accanto allo stato. */
const DIFFICULTY_DOT = { EASY: 'bg-emerald-400', MEDIUM: 'bg-secondary', HARD: 'bg-primary' };

function DifficultyTag({ difficulty }) {
  const meta = DIFFICULTY_META[difficulty] || DIFFICULTY_META.MEDIUM;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 whitespace-nowrap" title="Difficoltà dell'argomento">
      <span className={`w-1.5 h-1.5 rounded-full ${DIFFICULTY_DOT[difficulty] || DIFFICULTY_DOT.MEDIUM}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/**
 * V36.0 — i pulsanti mostrano l'intervallo REALE di questo nodo, non i
 * vecchi 4/2/1 giorni fissi: su un argomento che conosci da mesi
 * "Facile" dice +39 gg, su uno appena imparato +16 gg. È ciò che rende
 * visibile — e quindi credibile — la ripetizione dilazionata.
 */
export function ReviewButtons({ onReview, size = 'normal', sfida = null, examDate = null }) {
  const previews = previewReviewIntervals(sfida || {}, examDate);
  const small = size === 'small';
  return (
    <div className="grid grid-cols-3 gap-2">
      {Object.values(REVIEW_RATING).map((rating) => {
        const meta = REVIEW_RATING_META[rating];
        const days = previews[rating];
        return (
          <button
            key={rating}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReview(rating);
            }}
            className={`ds-btn ds-btn-ghost flex-col !gap-0 ${small ? '!min-h-[44px] !py-1.5' : '!min-h-[52px] !py-2'}`}
          >
            <span className={`${meta.color} ${small ? 'text-[13px]' : 'text-sm'} font-semibold leading-tight`}>{meta.label}</span>
            <span className="text-[11px] font-normal text-slate-500 leading-tight mt-0.5 ds-num" title="Prossimo ripasso">
              tra {days} {days === 1 ? 'giorno' : 'gg'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Riquadro con l'icona di stato. */
const StatusIcon = memo(function StatusIcon({ meta, size = 'md' }) {
  const dim = size === 'sm' ? 'w-7 h-7 rounded-lg' : 'w-9 h-9 rounded-[10px]';
  const iconDim = size === 'sm' ? 'w-3.5 h-3.5' : 'w-[18px] h-[18px]';
  return (
    <span className={`${dim} shrink-0 flex items-center justify-center border border-line bg-panel-2 ${meta.tile}`}>
      <Icon name={meta.icon} className={iconDim} />
    </span>
  );
});

/** Casella della selezione multipla: solo visiva, il toggle passa dal click sull'intera riga. */
function SelectBox({ checked, size = 'md' }) {
  const dim = size === 'sm' ? 'w-[18px] h-[18px]' : 'w-5 h-5';
  return (
    <span
      className={`shrink-0 ${dim} rounded-md border flex items-center justify-center transition-colors duration-150 ${
        checked ? 'bg-primary border-primary text-white' : 'border-white/20 bg-surface'
      }`}
      aria-hidden="true"
    >
      {checked && <Icon name="check" className="w-3 h-3" />}
    </span>
  );
}

/** Riferimento stabile per i default dei Set: un `new Set()` inline romperebbe `memo`. */
const EMPTY_SET = new Set();

// V34.6 — oltre questa soglia la lista dei sotto-argomenti di un Boss parte
// CHIUSA: un Boss con 14 nodi non trasforma più la pagina in una lista infinita.
const CHILD_LIST_AUTO_COLLAPSE_THRESHOLD = 6;

/** Attivazione da tastiera coerente con un <button> vero: Invio e Spazio. */
function activateOnKey(e, handler) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    handler();
  }
}

/**
 * Livello 3 — Nodo Figlio: riga compatta agganciata al ramo del padre.
 * V16.0: un figlio è SEMPRE completabile; se risulta LOCKED è perché è a
 * sua volta un Boss con sotto-argomenti ancora aperti.
 */
const ChildNodeRow = memo(function ChildNodeRow({
  node,
  materia,
  onSelect,
  bountyIds = EMPTY_SET,
  selectionMode = false,
  selectedIds = EMPTY_SET,
  onToggleSelect,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand
}) {
  if (!node) return null;
  const siblingSfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const status = deriveNodeStatus(node, siblingSfide);
  const meta = STATUS_META[status] || STATUS_META.LOCKED;
  const ownChildren = directChildrenOf(node, siblingSfide);
  const pendingOwnChildren = ownChildren.filter((c) => c.status !== 'COMPLETED').length;
  const isBounty = bountyIds.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const handleActivate = () => (selectionMode ? onToggleSelect(node.id) : onSelect(node));

  return (
    <div className="relative">
      {/* Tacca del ramo: collega la riga al tronco verticale del padre. */}
      <span className="absolute -left-3 sm:-left-4 top-[22px] w-3 sm:w-4 h-px bg-white/15" aria-hidden="true" />
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selectionMode ? isSelected : undefined}
        onClick={handleActivate}
        onKeyDown={(e) => activateOnKey(e, handleActivate)}
        className={`group relative flex items-start gap-3 rounded-xl border pl-3.5 pr-3 py-2.5 cursor-pointer overflow-hidden transition-colors duration-150 ${
          isSelected
            ? 'border-primary/50 bg-primary/[0.07]'
            : 'border-line bg-surface/70 hover:bg-panel-2 hover:border-line-strong'
        }`}
      >
        <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${meta.bar}`} aria-hidden="true" />
        {selectionMode && (
          <span className="pt-1">
            <SelectBox checked={isSelected} size="sm" />
          </span>
        )}
        <StatusIcon meta={meta} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug text-slate-100 break-words line-clamp-2">{node.nome}</p>
          <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
            <span className={`text-[11px] font-medium ${meta.text}`}>{meta.label}</span>
            <DifficultyTag difficulty={node.difficulty} />
            {status === NODE_STATUS.LOCKED && pendingOwnChildren > 0 && (
              <span className="text-[11px] text-slate-500">
                {pendingOwnChildren === 1 ? 'manca 1 sotto-argomento' : `mancano ${pendingOwnChildren} sotto-argomenti`}
              </span>
            )}
            {status !== NODE_STATUS.LOCKED && node.obiettivo && (
              <span className="text-[11px] text-slate-500 min-w-0 truncate max-w-full">{node.obiettivo}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          {isBounty && (
            <span className={BADGE.red} title="Bounty: argomento ad alta frizione nei ripassi">
              <Icon name="crosshair" className="w-3 h-3" />
              Bounty
            </span>
          )}
          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              aria-expanded={isExpanded}
              title={isExpanded ? 'Nascondi sotto-argomenti' : 'Mostra sotto-argomenti'}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-panel-2 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:text-white hover:border-line-strong transition-colors"
            >
              Boss · {ownChildren.length}
              <Icon name="chevronDown" className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          <Icon
            name="chevronRight"
            className="w-4 h-4 text-slate-600 group-hover:text-slate-300 transition-colors hidden sm:block"
          />
        </div>
      </div>
    </div>
  );
});

/**
 * Ricorsione dei Nodi Figli. V34.6: ogni livello tiene il proprio Set di
 * sotto-alberi aperti; un figlio Boss con poche sotto-voci parte aperto,
 * con molte parte chiuso (stessa soglia di ParentModuleCard).
 */
const ChildTree = memo(function ChildTree({
  parentId,
  sfide,
  depth,
  materia,
  onSelect,
  bountyIds = EMPTY_SET,
  selectionMode = false,
  selectedIds = EMPTY_SET,
  onToggleSelect
}) {
  const safeSfide = Array.isArray(sfide) ? sfide : [];
  const children = safeSfide.filter((s) => s && (s.parentId || null) === parentId);

  const [expandedIds, setExpandedIds] = useState(() => {
    const initial = new Set();
    children.forEach((child) => {
      const grandchildCount = safeSfide.filter((s) => s && s.parentId === child.id).length;
      if (grandchildCount > 0 && grandchildCount <= CHILD_LIST_AUTO_COLLAPSE_THRESHOLD) initial.add(child.id);
    });
    return initial;
  });

  if (children.length === 0) return null;

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="ml-4 pl-3 sm:ml-[17px] sm:pl-4 border-l border-white/10 space-y-2">
      {children.map((child) => {
        const grandchildCount = safeSfide.filter((s) => s && s.parentId === child.id).length;
        const hasChildren = grandchildCount > 0;
        const isExpanded = expandedIds.has(child.id);
        return (
          <div key={child.id} className="space-y-2">
            <ChildNodeRow
              node={child}
              materia={materia}
              onSelect={onSelect}
              bountyIds={bountyIds}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              hasChildren={hasChildren}
              isExpanded={isExpanded}
              onToggleExpand={hasChildren ? () => toggleExpand(child.id) : undefined}
            />
            {hasChildren && isExpanded && (
              <ChildTree
                parentId={child.id}
                sfide={safeSfide}
                depth={depth + 1}
                materia={materia}
                onSelect={onSelect}
                bountyIds={bountyIds}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});

/**
 * Livello 2 — Nodo Padre / categoria. Se ha figli è un "Boss": si chiude
 * solo quando tutti i sotto-argomenti diretti sono completati. Sotto,
 * l'intera discendenza agganciata a un ramo sottile.
 */
export const ParentModuleCard = memo(function ParentModuleCard({
  node,
  materia,
  onSelect,
  bountyIds = EMPTY_SET,
  selectionMode = false,
  selectedIds = EMPTY_SET,
  onToggleSelect
}) {
  const siblingSfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const status = deriveNodeStatus(node, siblingSfide);
  const meta = STATUS_META[status] || STATUS_META.LOCKED;
  const children = directChildrenOf(node, siblingSfide);
  const childCount = children.length;
  const doneChildren = children.filter((c) => c.status === 'COMPLETED').length;
  const pendingChildren = childCount - doneChildren;
  const isBounty = bountyIds.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const handleActivate = () => (selectionMode ? onToggleSelect(node.id) : onSelect(node));

  const [childrenOpen, setChildrenOpen] = useState(() => childCount <= CHILD_LIST_AUTO_COLLAPSE_THRESHOLD);

  return (
    <div
      className={`ds-card-nopad transition-colors duration-150 ${
        isSelected ? '!border-primary/50 ring-1 ring-primary/30' : ''
      }`}
    >
      <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${meta.bar}`} aria-hidden="true" />
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selectionMode ? isSelected : undefined}
        onClick={handleActivate}
        onKeyDown={(e) => activateOnKey(e, handleActivate)}
        className="group flex items-start gap-3 sm:gap-3.5 pl-4 pr-3 sm:pr-4 py-3.5 cursor-pointer hover:bg-white/[0.02] transition-colors duration-150"
      >
        {selectionMode && (
          <span className="pt-2">
            <SelectBox checked={isSelected} />
          </span>
        )}
        <StatusIcon meta={meta} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
            {childCount > 0 ? (
              <>
                <Icon name="skull" className="w-3 h-3" />
                Boss · {childCount} {childCount === 1 ? 'sotto-argomento' : 'sotto-argomenti'}
              </>
            ) : (
              'Argomento'
            )}
          </p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-white break-words line-clamp-2">{node.nome}</p>
          {node.obiettivo && <p className="text-[13px] text-slate-400 mt-1 break-words line-clamp-2">{node.obiettivo}</p>}
          <div className="mt-2 flex items-center gap-x-3 gap-y-1.5 flex-wrap">
            <span className={meta.badge}>
              <Icon name={meta.icon} className="w-3 h-3" />
              {meta.label}
            </span>
            <DifficultyTag difficulty={node.difficulty} />
            {isBounty && (
              <span className={BADGE.red} title="Bounty: argomento ad alta frizione nei ripassi">
                <Icon name="crosshair" className="w-3 h-3" />
                Bounty
              </span>
            )}
          </div>
        </div>
        <Icon
          name="chevronRight"
          className="w-4 h-4 mt-2.5 text-slate-600 group-hover:text-slate-300 transition-colors shrink-0 hidden sm:block"
        />
      </div>

      {childCount > 0 && (
        <div className="px-4 pb-3.5">
          <button
            type="button"
            onClick={() => setChildrenOpen((v) => !v)}
            aria-expanded={childrenOpen}
            className="w-full flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 text-left hover:bg-white/[0.03] transition-colors"
          >
            <span className="ds-progress flex-1 max-w-[220px] !h-1">
              <span
                className="bg-emerald-400"
                style={{ width: `${childCount > 0 ? Math.round((doneChildren / childCount) * 100) : 0}%` }}
              />
            </span>
            <span className="text-xs text-slate-400 ds-num whitespace-nowrap">
              {doneChildren}/{childCount} completati
              {status === NODE_STATUS.LOCKED && pendingChildren > 0 && <span className="text-slate-500"> · il Boss si sblocca a 0</span>}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-400">
              {childrenOpen ? 'Nascondi' : 'Mostra'}
              <Icon name="chevronDown" className={`w-3.5 h-3.5 transition-transform duration-200 ${childrenOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {childrenOpen && (
            <div className="mt-2">
              <ChildTree
                parentId={node.id}
                sfide={siblingSfide}
                depth={1}
                materia={materia}
                onSelect={onSelect}
                bountyIds={bountyIds}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
