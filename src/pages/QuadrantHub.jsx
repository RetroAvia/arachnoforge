import React, { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';
import AiIndexMatrixModal from '../components/AiIndexMatrixModal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Dropdown from '../components/Dropdown.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { deriveNodeStatus, NODE_STATUS, isDescendant, directChildrenOf } from '../utils/skillTree.js';
import { formatDateOnlyHuman } from '../utils/dateUtils.js';
import { DIFFICULTY, DIFFICULTY_META } from '../utils/xpEngine.js';
import { REVIEW_RATING, REVIEW_RATING_META } from '../utils/spiderSense.js';
import { isGoblinProtocol, computeEstimatedCompletion } from '../utils/materiaMeta.js';
import {
  CUSTOM_COURSE_ID,
  getCourseDropdownOptions,
  getCourseById,
  getMissingPrerequisites,
  computeSpiderScore,
  DIFFICULTY_SLIDER_LABELS
} from '../data/vanvitelliCourseMap.js';
import { MIN_VOTO, MAX_VOTO, LODE_VALUE } from '../utils/gpaEngine.js';
import { CARD, CARD_ALERT, BTN_PRIMARY, BTN_SECONDARY, BTN_SUCCESS, BTN_GHOST, INPUT, H1, H2, BADGE, RADIAL_GLOW } from '../utils/designSystem.js';

/**
 * Karen's Tactical Suggestor (V18.0, Pillar 2) — pannello HUD in cima al
 * Web-Matrix, sempre visibile: l'IA scansiona le Materie non ancora
 * superate e decreta il "Primary Target" secondo lo Spider-Score. Bordi
 * neon pulsanti + glow, mai un pannello piatto: è la card che deve
 * dimostrare che l'app "pensa" per l'utente.
 */
function KarenSuggestorPanel({ primaryTarget, onSelect }) {
  return (
    <div className="relative bg-surface/80 backdrop-blur-2xl border-2 border-secondary/50 rounded-2xl shadow-secondary-glow-lg p-6 overflow-hidden">
      <div className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-secondary/20 blur-3xl pointer-events-none animate-pulse-slow" />
      <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="relative flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-secondary/15 border border-secondary/50 flex items-center justify-center text-secondary shrink-0 shadow-secondary-glow">
          <Icon name="chip" className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs tracking-[0.25em] text-secondary font-mono">KAREN OS</p>
          <h2 className="text-lg font-extrabold text-white tracking-tight">Analisi Traiettoria Accademica</h2>
        </div>
      </div>

      {!primaryTarget ? (
        <div className="relative flex items-center gap-3 bg-emerald-900/20 border border-emerald-400/30 rounded-xl px-4 py-3.5">
          <Icon name="check" className="w-5 h-5 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300">
            Karen: nessun esame in sospeso rilevato. Traiettoria pulita — apri un nuovo nodo dal piano di studi quando sei pronto.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(primaryTarget.materia.id)}
          className="relative w-full text-left bg-primary/10 border border-primary/40 rounded-xl px-5 py-4 flex items-start gap-4 hover:border-primary/70 hover:bg-primary/15 transition-all duration-300"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/50 flex items-center justify-center text-primary shrink-0">
            <Icon name="crosshair" className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono tracking-widest text-primary">PRIMARY TARGET</span>
              <span className={BADGE.amber}>
                <Icon name="bolt" className="w-3.5 h-3.5" />
                Spider-Score {primaryTarget.spiderScore}
              </span>
            </div>
            <p className="text-lg font-bold text-white mt-1 truncate">{primaryTarget.materia.nome}</p>
            <p className="text-sm text-slate-300 mt-1 leading-relaxed">{primaryTarget.reason}</p>
          </div>
          <Icon name="chevronDown" className="w-5 h-5 text-primary -rotate-90 shrink-0 mt-2" />
        </button>
      )}
    </div>
  );
}

/**
 * V31.3 — Bounty Board (Friction Analytics): riattiva `utils/friction.js`,
 * finora scaffoldato ma mai esposto in nessuna UI. Mostra i nodi con più
 * "attrito" (ripassi giudicati Difficile) tra quelli con almeno 3
 * tentativi registrati (guardia contro il rumore statistico su campioni
 * piccoli, applicata a monte in `derived.bountyTargets`). Ogni riga salta
 * direttamente al nodo riusando lo stesso meccanismo di quick-jump dello
 * Spider-Sense Schedule (`openNodeFromSchedule`).
 */
function BountyBoardPanel({ targets, onSelect }) {
  if (!targets || targets.length === 0) return null;
  return (
    <div className="relative bg-surface/80 backdrop-blur-2xl border-2 border-primary/40 rounded-2xl shadow-primary-glow p-6 overflow-hidden">
      <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
      <div className="relative flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/50 flex items-center justify-center text-primary shrink-0 shadow-primary-glow">
          <Icon name="crosshair" className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs tracking-[0.25em] text-primary font-mono">BOUNTY BOARD</p>
          <h2 className="text-lg font-extrabold text-white tracking-tight">Nodi ad Alta Frizione</h2>
        </div>
      </div>
      <div className="relative space-y-2">
        {targets.map((t) => (
          <button
            key={t.sfidaId}
            type="button"
            onClick={() => onSelect(t.materiaId, t.sfidaId)}
            className="w-full text-left bg-primary/5 border border-primary/25 rounded-xl px-4 py-3 flex items-center justify-between gap-3 hover:border-primary/60 hover:bg-primary/10 transition-all duration-300"
          >
            <div className="min-w-0">
              <p className="text-base font-semibold text-white truncate">{t.sfidaNome}</p>
              <p className="text-sm text-slate-500 truncate">{t.materiaNome}</p>
            </div>
            <span className={BADGE.red}>
              <Icon name="alertTriangle" className="w-3.5 h-3.5" />
              {t.friction}% frizione
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Classi Tailwind statiche (mai concatenate a runtime — bandito dal Design System) per le due varianti cromatiche dello slider. */
const TECH_SLIDER_ACCENT = {
  primary: { track: 'accent-primary', text: 'text-primary' },
  secondary: { track: 'accent-secondary', text: 'text-secondary' }
};

/** Slider "Stark-Tech" — riusa la grammatica cromatica reattiva al costume, mai uno slider nativo grigio. */
function TechSlider({ value, onChange, labels, accent = 'primary' }) {
  const accentCls = TECH_SLIDER_ACCENT[accent] || TECH_SLIDER_ACCENT.primary;
  return (
    <div>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full h-2 rounded-full appearance-none bg-surface/80 border border-white/10 cursor-pointer ${accentCls.track}`}
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-slate-500">{labels[0]}</span>
        <span className={`text-sm font-mono font-semibold ${accentCls.text}`}>{value}/5 — {labels[value - 1]}</span>
        <span className="text-xs text-slate-500">{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

/** Toggle Stark-Tech compatto — pillola in vetro con perno luminoso, per "Esame Superato". */
function ExamPassedToggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
        checked ? 'bg-emerald-900/25 border-emerald-400/50' : 'bg-surface/80 border-white/10'
      }`}
    >
      <span className={`text-sm font-semibold flex items-center gap-2 ${checked ? 'text-emerald-300' : 'text-slate-400'}`}>
        <Icon name={checked ? 'check' : 'gear'} className="w-4 h-4" />
        Esame Superato (propedeuticità soddisfatta per altri corsi)
      </span>
      <span
        className={`shrink-0 w-11 h-6 rounded-full border relative transition-all duration-300 ${
          checked ? 'bg-emerald-500/30 border-emerald-400/60' : 'bg-surface border-white/10'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-gradient-to-br transition-all duration-300 ${
            checked ? 'left-[22px] from-emerald-400 to-emerald-600' : 'left-0.5 from-slate-500 to-slate-600'
          }`}
        />
      </span>
    </button>
  );
}

/**
 * Stati del nodo — badge coerenti con la ricetta CFU/status del Design
 * System (`bg-COLORE-900/50 text-COLORE-300 rounded-full px-3 py-1 text-xs`).
 * COMPLETED riceve inoltre un bagliore radiale dietro l'icona di stato:
 * mai un box piatto, sempre un'aura atmosferica sui traguardi raggiunti.
 *
 * V16.0 (Pillar 1) — LOCKED non significa più "il padre non è completato":
 * i figli sono sempre liberamente completabili. LOCKED ora indica un nodo
 * "Boss" (con sotto-argomenti collegati) che non può ancora essere chiuso
 * perché non tutti i suoi figli diretti sono COMPLETED.
 */
const STATUS_META = {
  LOCKED: { label: 'In Attesa', text: 'text-slate-400', border: 'border-slate-500/30', badge: BADGE.slate, icon: 'gear', glow: null },
  AVAILABLE: { label: 'Disponibile', text: 'text-secondary', border: 'border-secondary/40', badge: BADGE.blue, icon: 'target', glow: RADIAL_GLOW.blue },
  COMPLETED: { label: 'Completato', text: 'text-emerald-400', border: 'border-emerald-400/40', badge: BADGE.green, icon: 'check', glow: RADIAL_GLOW.green },
  NEEDS_REVIEW: { label: 'Spider-Sense', text: 'text-accent', border: 'border-accent/40', badge: BADGE.amber, icon: 'alertTriangle', glow: RADIAL_GLOW.amber }
};

function ReviewButtons({ onReview, size = 'normal' }) {
  const pad = size === 'small' ? 'py-2 text-sm' : 'py-2.5 text-base';
  return (
    // V34.0 — "God-Tier Pass": su schermi molto stretti (<640px) tre
    // colonne con l'etichetta completa "Difficile (+1gg)" affiancavano il
    // testo a ridosso del bordo — una sola colonna sotto il breakpoint
    // standard Tailwind `sm` restituisce respiro al testo sui telefoni
    // più piccoli, senza toccare il layout a 3 colonne da tablet in su
    // (nessun breakpoint custom: `sm` è già definito di default).
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {Object.values(REVIEW_RATING).map((rating) => {
        const meta = REVIEW_RATING_META[rating];
        return (
          <button
            key={rating}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReview(rating);
            }}
            className={`${pad} rounded-xl border ${meta.border} ${meta.color} bg-white/[0.02] font-semibold hover:brightness-125 hover:-translate-y-0.5 transition-all duration-300`}
          >
            {meta.label} (+{meta.days}gg)
          </button>
        );
      })}
    </div>
  );
}

/** Icona di stato — nucleo del nodo, con bagliore radiale atmosferico dietro se completato/disponibile/in allerta. */
const StatusIcon = memo(function StatusIcon({ meta, size = 'md' }) {
  const dim = size === 'sm' ? 'w-9 h-9' : 'w-12 h-12';
  const iconDim = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className={`relative ${dim} shrink-0 flex items-center justify-center`}>
      {meta.glow && <div className={meta.glow} />}
      <div className={`relative ${dim} rounded-xl border ${meta.border} flex items-center justify-center ${meta.text} bg-surface/80`}>
        <Icon name={meta.icon} className={iconDim} />
      </div>
    </div>
  );
});

/** Riferimento stabile condiviso per il default prop `bountyIds` — mai un
 * `new Set()` inline nella firma della funzione, altrimenti ogni render
 * senza la prop esplicita romperebbe l'uguaglianza referenziale su cui
 * si basa `memo`. */
const EMPTY_SET = new Set();

// V34.6 — "Accordion Nodi Figlio": soglia oltre la quale la lista di nodi
// figlio di un Boss (ParentModuleCard o un Nodo Figlio che è a sua volta un
// Boss annidato) parte CHIUSA invece che aperta. Un Boss con pochi
// sotto-argomenti resta comodo da vedere a colpo d'occhio; un Boss con
// decine di nodi (vedi caso reale "Cinematica del corpo rigido", 14 nodi)
// non trasforma più l'intero Web-Matrix in una lista infinita.
const CHILD_LIST_AUTO_COLLAPSE_THRESHOLD = 6;

/**
 * Livello 3 — Nodo Figlio: riga compatta connessa visivamente al proprio
 * Nodo Padre tramite un vero e proprio "ramo" (linea verticale del
 * contenitore + tacca orizzontale dedicata), non solo un rientro generico.
 *
 * V16.0 (Pillar 1): un nodo figlio è SEMPRE liberamente completabile. Se
 * risulta comunque LOCKED è perché ha a sua volta dei sotto-argomenti
 * ("Boss" annidato): mostriamo quanti ne mancano, mai più "Richiede: Padre".
 */
const ChildNodeRow = memo(function ChildNodeRow({
  node,
  materia,
  onSelect,
  bountyIds = EMPTY_SET,
  selectionMode = false,
  selectedIds = EMPTY_SET,
  onToggleSelect,
  // V34.6 — "Accordion Nodi Figlio": presenti solo quando questo nodo
  // figlio è a sua volta un Boss annidato (ha propri sotto-argomenti).
  // Il toggle vive nel ChildTree genitore (unica fonte di verità per lo
  // stato aperto/chiuso di TUTTI i suoi figli diretti), qui arriva solo
  // in lettura + callback.
  hasChildren = false,
  isExpanded = false,
  onToggleExpand
}) {
  if (!node) return null;
  const siblingSfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const status = deriveNodeStatus(node, siblingSfide);
  const meta = STATUS_META[status] || STATUS_META.LOCKED;
  const diffMeta = DIFFICULTY_META[node.difficulty] || DIFFICULTY_META.MEDIUM;
  const ownChildren = directChildrenOf(node, siblingSfide);
  const pendingOwnChildren = ownChildren.filter((c) => c.status !== 'COMPLETED').length;
  const isBounty = bountyIds.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const handleActivate = () => (selectionMode ? onToggleSelect(node.id) : onSelect(node));

  return (
    <div className="relative">
      {/* Tacca di connessione ramo -> nodo, sempre visibile: rende palese il collegamento gerarchico. */}
      <span className="absolute -left-4 md:-left-5 top-8 w-4 md:w-5 h-0.5 bg-gradient-to-r from-secondary/50 to-transparent" />
      <span className="absolute -left-[18px] md:-left-[22px] top-[30px] w-1.5 h-1.5 rounded-full bg-secondary/60" />
      <div
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
        className={`group flex items-center gap-3 p-3 sm:p-4 rounded-2xl border backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 cursor-pointer ${
          isSelected ? 'border-primary/60 bg-primary/10' : `${meta.border} bg-surface/60 hover:bg-surface/85`
        }`}
      >
        {/* V34.2 — "Selezione Multipla Nodi": checkbox visiva pura — il
            toggle vero e proprio passa dal click sull'intera riga
            (handleActivate), mai un secondo handler separato che
            rischierebbe un doppio toggle per lo stesso click. */}
        {selectionMode && (
          <span
            className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-all duration-200 ${
              isSelected ? 'bg-primary border-primary text-white' : 'border-slate-500/40 bg-surface/80'
            }`}
          >
            {isSelected && <Icon name="check" className="w-3.5 h-3.5" />}
          </span>
        )}
        <StatusIcon meta={meta} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-base truncate text-slate-100">{node.nome}</p>
            <span className={`text-xs font-mono px-2 py-0.5 rounded-full border shrink-0 ${diffMeta.border} ${diffMeta.color}`}>
              {diffMeta.label}
            </span>
            {hasChildren && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand?.();
                }}
                onKeyDown={(e) => e.stopPropagation()}
                title={isExpanded ? 'Nascondi sotto-argomenti' : 'Mostra sotto-argomenti'}
                className="text-xs font-mono px-2 py-0.5 rounded-full border border-secondary/30 text-secondary shrink-0 flex items-center gap-1 hover:bg-secondary/10 hover:border-secondary/60 transition-all duration-200"
              >
                Boss · {ownChildren.length}
                <Icon name="chevronDown" className={`w-3 h-3 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
            {isBounty && (
              <span className={`${BADGE.red} shrink-0`} title="Bounty Target — alta frizione nei ripassi">
                <Icon name="crosshair" className="w-3.5 h-3.5" />
                Bounty
              </span>
            )}
          </div>
          {status === NODE_STATUS.LOCKED ? (
            <p className="text-sm text-slate-500 mt-0.5 truncate">Completa prima {pendingOwnChildren} sotto-argomento/i</p>
          ) : node.obiettivo ? (
            <p className="text-sm text-slate-500 mt-0.5 truncate">{node.obiettivo}</p>
          ) : null}
        </div>
        <div className="text-right shrink-0 flex items-center gap-2">
          {status === NODE_STATUS.NEEDS_REVIEW && node.nextReviewDate && (
            <span className={BADGE.amber}>
              <Icon name="alertTriangle" className="w-3.5 h-3.5" />
              ripassa
            </span>
          )}
          <span className={meta.badge}>{meta.label}</span>
          <Icon name="crosshair" className="w-4 h-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300 hidden md:block" />
        </div>
      </div>
    </div>
  );
});

/** Ricorsione dei Nodi Figli — tronco verticale reattivo al costume, mai un semplice rientro senza segno grafico.
 * V34.6 — "Accordion Nodi Figlio": questo componente è ora anche l'unica
 * fonte di verità per lo stato aperto/chiuso dei sotto-alberi dei propri
 * figli diretti (`expandedIds`, uno per livello di ricorsione — ogni
 * chiamata ricorsiva di ChildTree ha il proprio Set indipendente). Un
 * figlio che è a sua volta un Boss annidato parte aperto solo se ha
 * "poche" sotto-voci (CHILD_LIST_AUTO_COLLAPSE_THRESHOLD), altrimenti
 * chiuso di default — stessa euristica di ParentModuleCard. */
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
      if (grandchildCount > 0 && grandchildCount <= CHILD_LIST_AUTO_COLLAPSE_THRESHOLD) {
        initial.add(child.id);
      }
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
    <div className="ml-6 md:ml-7 pl-5 md:pl-6 border-l-2 border-secondary/25 space-y-3 relative">
      {children.map((child) => {
        const grandchildCount = safeSfide.filter((s) => s && s.parentId === child.id).length;
        const hasChildren = grandchildCount > 0;
        const isExpanded = expandedIds.has(child.id);
        return (
          <div key={child.id} className="space-y-3">
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
 * Livello 2 — Nodo Padre / Categoria: modulo autonomo in vetro tecnologico
 * con accento laterale colorato in base allo stato e bagliore radiale
 * dietro l'icona quando il nodo è completato — poi, subito sotto, l'intera
 * discendenza (Livello 3) collegata dal tronco verticale.
 *
 * V16.0 (Pillar 1): se ha figli collegati, questo nodo è un "Boss" — lo
 * segnaliamo esplicitamente quando è ancora LOCKED (sotto-argomenti da
 * completare prima di poterlo chiudere).
 */
const ParentModuleCard = memo(function ParentModuleCard({
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
  const diffMeta = DIFFICULTY_META[node.difficulty] || DIFFICULTY_META.MEDIUM;
  const daysUntil = node.nextReviewDate || null;
  const children = directChildrenOf(node, siblingSfide);
  const childCount = children.length;
  const pendingChildren = children.filter((c) => c.status !== 'COMPLETED').length;
  const isBounty = bountyIds.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const handleActivate = () => (selectionMode ? onToggleSelect(node.id) : onSelect(node));

  // V34.6 — "Accordion Nodi Figlio": un Boss con pochi figli resta comodo
  // da vedere subito aperto; oltre la soglia parte chiuso, cosi' una
  // Materia con molti Boss "densi" (14+ nodi ciascuno, vedi screenshot
  // utente) non produce più una pagina a scorrimento infinito.
  const [childrenOpen, setChildrenOpen] = useState(() => childCount <= CHILD_LIST_AUTO_COLLAPSE_THRESHOLD);

  return (
    <div className={`${CARD} space-y-4 border-l-4 ${isSelected ? 'border-primary ring-1 ring-primary/50' : meta.border}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
        className="relative flex items-center gap-4 cursor-pointer"
      >
        {selectionMode && (
          <span
            className={`shrink-0 w-6 h-6 rounded-md border flex items-center justify-center transition-all duration-200 ${
              isSelected ? 'bg-primary border-primary text-white' : 'border-slate-500/40 bg-surface/80'
            }`}
          >
            {isSelected && <Icon name="check" className="w-4 h-4" />}
          </span>
        )}
        <StatusIcon meta={meta} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={BADGE.blue}>{childCount > 0 ? 'Boss — Nodo Padre' : 'Nodo Padre'}</span>
            <p className="font-bold text-lg truncate text-white">{node.nome}</p>
            <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${diffMeta.border} ${diffMeta.color}`}>
              {diffMeta.label}
            </span>
            {isBounty && (
              <span className={BADGE.red} title="Bounty Target — alta frizione nei ripassi">
                <Icon name="crosshair" className="w-3.5 h-3.5" />
                Bounty
              </span>
            )}
          </div>
          {node.obiettivo && <p className="text-base text-slate-400 mt-1.5 truncate">{node.obiettivo}</p>}
          {childCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setChildrenOpen((v) => !v);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              title={childrenOpen ? 'Nascondi nodi figlio' : 'Mostra nodi figlio'}
              className="text-sm text-slate-500 hover:text-secondary mt-1 flex items-center gap-1.5 transition-colors duration-200"
            >
              <Icon name="grid" className="w-3.5 h-3.5 shrink-0" />
              <span>
                {childCount} nodo/i figlio collegato/i
                {status === NODE_STATUS.LOCKED && ` · ${pendingChildren} ancora da completare`}
              </span>
              <Icon name="chevronDown" className={`w-3.5 h-3.5 shrink-0 transition-transform duration-300 ${childrenOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
        <div className="text-right shrink-0 space-y-1.5">
          <span className={`${meta.badge} block`}>{meta.label}</span>
          {status === NODE_STATUS.NEEDS_REVIEW && daysUntil && (
            <span className="text-xs text-accent font-mono block">scaduto</span>
          )}
        </div>
      </div>

      {childCount > 0 && childrenOpen && (
        <div className="relative">
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
  );
});

export default function QuadrantHub() {
  const { state, actions, derived, pushToast } = useArachnoForge();
  // Guardia difensiva: se lo stato persistito è corrotto o non ancora
  // idratato, non far mai propagare un `undefined`/non-array al render
  // (causa nota di schermo nero da eccezione non gestita su .map()).
  const materie = Array.isArray(state.materie) ? state.materie : [];
  const [selectedMateriaId, setSelectedMateriaId] = useState(materie[0]?.id || '');
  const [materiaModalOpen, setMateriaModalOpen] = useState(false);
  const [editingMateria, setEditingMateria] = useState(null);
  const [deleteMateriaTarget, setDeleteMateriaTarget] = useState(null);
  const [sfidaModalOpen, setSfidaModalOpen] = useState(false);
  const [aiIndexModalOpen, setAiIndexModalOpen] = useState(false);
  const [nodeDetail, setNodeDetail] = useState(null);
  const [deleteNodeTarget, setDeleteNodeTarget] = useState(null);
  // V34.4 — "Riporta a da completare": undo per un nodo segnato COMPLETED
  // per errore. Stesso pattern di deleteNodeTarget: la modale di dettaglio
  // si chiude e la conferma vive nel proprio ConfirmDialog dedicato,
  // cosi' un click accidentale sul bottone non riapre subito il nodo.
  const [reopenNodeTarget, setReopenNodeTarget] = useState(null);
  const [spiderSenseDrawerOpen, setSpiderSenseDrawerOpen] = useState(false);

  // V34.2 — "Selezione Multipla Nodi": stato dedicato, isolato dal resto
  // dell'UI del Web-Matrix. `selectedNodeIds` è un Set (mai un array —
  // lookup O(1) per riga, essenziale su Skill Tree con decine di nodi
  // renderizzati). Uscire dalla modalità selezione azzera sempre il set,
  // cosi' rientrarci in seguito parte sempre pulito.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState(() => new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // Cambiare Materia mentre la selezione multipla è attiva lascerebbe id
  // selezionati "orfani" (appartenenti a un altro Skill Tree, invisibili
  // nella colonna corrente) — uscita automatica e pulita ad ogni cambio.
  useEffect(() => {
    setSelectionMode(false);
    setSelectedNodeIds(new Set());
  }, [selectedMateriaId]);

  // V31.2 — Pillar 1 (Ultimate Node Customization): stato dedicato
  // dell'editor olografico dentro la modale di dettaglio nodo. I campi
  // `edit*` sono uno STAGING locale — mai scritti nel Context finché
  // "Salva Modifiche" non viene premuto — cosi' "Annulla" può sempre
  // ripristinare i valori originali con un semplice reset dello stato,
  // senza toccare il nodo reale.
  const [nodeEditMode, setNodeEditMode] = useState(false);
  const [nodeSaveState, setNodeSaveState] = useState('idle'); // idle | saving | success | error
  const [editNome, setEditNome] = useState('');
  const [editObiettivo, setEditObiettivo] = useState('');
  const [editOreStimate, setEditOreStimate] = useState(2);
  const [editDifficulty, setEditDifficulty] = useState(DIFFICULTY.MEDIUM);
  const [editParentId, setEditParentId] = useState('');
  // V31.2.1 — guardia "modifiche non salvate": mostra un ConfirmDialog
  // invece di scartare silenziosamente lo staging quando si tenta di
  // chiudere la modale (backdrop/Esc/X) mentre l'Editor è aperto.
  const [nodeEditCloseConfirmOpen, setNodeEditCloseConfirmOpen] = useState(false);

  // Web-Path Planner — form di creazione/modifica Materia basato sul piano
  // di studi Vanvitelli (Ingegneria Aerospaziale): dropdown ufficiale con
  // autocompilazione CFU, oppure "Materia Libera" per corsi fuori mappa.
  const [formCourseId, setFormCourseId] = useState('');
  const [formCustomNome, setFormCustomNome] = useState('');
  const [formExamDate, setFormExamDate] = useState('');
  const [formCfu, setFormCfu] = useState(6);
  const [formDifficulty, setFormDifficulty] = useState(3);
  const [formExamPassed, setFormExamPassed] = useState(false);
  const [formVoto, setFormVoto] = useState('');
  const [formLode, setFormLode] = useState(false);
  const courseOptions = useMemo(() => getCourseDropdownOptions(), []);
  const selectedCourse = formCourseId && formCourseId !== CUSTOM_COURSE_ID ? getCourseById(formCourseId) : null;
  const missingPrereqs = useMemo(
    () => (selectedCourse ? getMissingPrerequisites(selectedCourse.id, materie, editingMateria?.id || null) : []),
    [selectedCourse, materie, editingMateria]
  );
  // Time-Weaver Formula (V20.0, Pillar 2): l'Urgenza manuale è sparita —
  // il fattore tempo ora arriva SOLO dalla Data Esame reale (1000/giorni
  // mancanti), quindi l'anteprima deve includere `examDate` per essere
  // coerente col punteggio finale che Karen userà davvero.
  const previewSpiderScore = useMemo(
    () => computeSpiderScore({ perceivedDifficulty: formDifficulty, courseId: selectedCourse?.id || null, examDate: formExamDate || null }),
    [formDifficulty, selectedCourse, formExamDate]
  );

  const [sfidaNome, setSfidaNome] = useState('');
  const [sfidaObiettivo, setSfidaObiettivo] = useState('');
  const [sfidaOreStimate, setSfidaOreStimate] = useState(4);
  const [sfidaParentId, setSfidaParentId] = useState('');
  const [sfidaDifficulty, setSfidaDifficulty] = useState(DIFFICULTY.MEDIUM);

  // Time-Weaver Formula del Web-Path Planner (V20.0, Pillar 2): Spider-Score
  // decrescente (Difficoltà + Esami Sbloccati + 1000/Giorni Mancanti) — il
  // corso da attaccare per primo è sempre in cima, con il tempo come
  // fattore dominante assoluto.
  const sortedMaterie = useMemo(
    () => [...materie].sort((a, b) => computeSpiderScore(b) - computeSpiderScore(a)),
    [materie]
  );

  // Karen's Tactical Suggestor — Primary Target calcolato una sola volta a
  // livello di Provider (ArachnoForgeContext) e riletto qui da `derived`,
  // così Mission Control e Web-Matrix vedono sempre lo stesso identico
  // suggerimento, mai due calcoli potenzialmente disallineati.
  const { primaryTarget } = derived;

  // Decluttering Accordion (V20.0, Pillar 2): le Materie della colonna a
  // sinistra sono raggruppate per Anno di corso (1°/2°/3°), con una quarta
  // sezione "Materie Libere" per i nodi fuori piano di studi (courseId
  // null/custom). Solo l'anno che contiene il Primary Target parte aperto.
  const materieByYear = useMemo(() => {
    const groups = new Map();
    sortedMaterie.forEach((m) => {
      const course = getCourseById(m.courseId);
      const key = course ? course.anno : 'libere';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    });
    return groups;
  }, [sortedMaterie]);

  const primaryTargetYearKey = useMemo(() => {
    if (!primaryTarget) return null;
    const course = getCourseById(primaryTarget.materia.courseId);
    return course ? course.anno : 'libere';
  }, [primaryTarget]);

  // Stato iniziale calcolato una sola volta al mount (lazy initializer):
  // è un DEFAULT, non un vincolo permanente — se l'utente chiude
  // manualmente la sezione, non deve riaprirsi da sola ad ogni render.
  const [openYears, setOpenYears] = useState(() => new Set([primaryTargetYearKey ?? 1]));

  const toggleYear = useCallback((key) => {
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const YEAR_SECTIONS = [
    { key: 1, label: '1° Anno' },
    { key: 2, label: '2° Anno' },
    { key: 3, label: '3° Anno' },
    { key: 'libere', label: 'Materie Libere' }
  ];

  const selectedMateria = useMemo(
    () => materie.find((m) => m.id === selectedMateriaId) || null,
    [materie, selectedMateriaId]
  );
  const selectedSfide = Array.isArray(selectedMateria?.sfide) ? selectedMateria.sfide : [];
  const rootNodes = useMemo(
    () => selectedSfide.filter((s) => !s.parentId),
    [selectedSfide]
  );

  // V31.3 — Bounty Board: Set stabile di sfidaId ad alta frizione, per il
  // badge inline su ParentModuleCard/ChildNodeRow senza ricalcolare nulla
  // lì dentro (derived.bountyTargets è già filtrato/ordinato dal Context).
  const bountySfidaIds = useMemo(
    () => new Set(derived.bountyTargets.map((t) => t.sfidaId)),
    [derived.bountyTargets]
  );

  const goblinActive = selectedMateria ? isGoblinProtocol(selectedMateria) : false;
  // V16.0 (Pillar 2): stima "Fine Prevista" millimetrica — somma esatta dei
  // giorni residui di ogni nodo incompleto, nessuna media generica.
  const estimate = useMemo(
    () => (selectedMateria ? computeEstimatedCompletion(selectedMateria) : null),
    [selectedMateria]
  );

  // Spider-Sense Schedule: tutti i nodi tracciati dal motore SRS, raggruppati
  // per materia — visibilità totale (non solo i ripassi già scaduti).
  const scheduleGroups = useMemo(() => {
    const byMateria = new Map();
    derived.allTrackedReviews.forEach((item) => {
      if (!byMateria.has(item.materiaId)) byMateria.set(item.materiaId, { materiaId: item.materiaId, materiaNome: item.materiaNome, items: [] });
      byMateria.get(item.materiaId).items.push(item);
    });
    return Array.from(byMateria.values());
  }, [derived.allTrackedReviews]);

  // NOTA: openNodeDetail deve essere dichiarata PRIMA di ogni useCallback
  // che la referenzia nel proprio array di dipendenze — un riferimento in
  // avanti a un'altra `const` nello stesso component body va in Temporal
  // Dead Zone e lancia un ReferenceError ad ogni render (causa nota di
  // schermo nero già riscontrata in passato). Ordine dichiarativo blindato.
  const openNodeDetail = useCallback((node) => {
    setNodeDetail(node);
    setNodeEditMode(false);
    setNodeSaveState('idle');
  }, []);

  // Chiusura della modale di dettaglio: reset esplicito anche dell'Editor
  // di Personalizzazione, cosi' una riapertura successiva (anche su un
  // nodo diverso) parte sempre pulita, mai in edit mode residuo.
  const closeNodeDetail = useCallback(() => {
    setNodeDetail(null);
    setNodeEditMode(false);
    setNodeSaveState('idle');
    setNodeEditCloseConfirmOpen(false);
  }, []);

  // Punto d'ingresso UNICO per la chiusura "utente" della modale (backdrop,
  // Esc, pulsante X — tutti passano dalla prop onClose di <Modal>): se
  // l'Editor è aperto con modifiche in staging non ancora salvate, chiede
  // conferma invece di scartarle silenziosamente. Un salvataggio in corso
  // blocca del tutto la chiusura, per non interrompere la sincronizzazione.
  const requestCloseNodeDetail = useCallback(() => {
    if (nodeSaveState === 'saving') return;
    if (nodeEditMode) {
      setNodeEditCloseConfirmOpen(true);
      return;
    }
    closeNodeDetail();
  }, [nodeEditMode, nodeSaveState, closeNodeDetail]);

  const openNodeFromSchedule = useCallback((materiaId, sfidaId) => {
    const materia = materie.find((m) => m.id === materiaId);
    const node = materia?.sfide.find((s) => s.id === sfidaId);
    if (materia && node) {
      setSelectedMateriaId(materiaId);
      openNodeDetail(node);
    }
  }, [materie, openNodeDetail]);

  const openAddMateria = () => {
    setEditingMateria(null);
    setFormCourseId('');
    setFormCustomNome('');
    setFormExamDate('');
    setFormCfu(6);
    setFormDifficulty(3);
    setFormExamPassed(false);
    setFormVoto('');
    setFormLode(false);
    setMateriaModalOpen(true);
  };

  const openEditMateria = (materia) => {
    setEditingMateria(materia);
    setFormCourseId(materia.courseId || CUSTOM_COURSE_ID);
    setFormCustomNome(materia.courseId ? '' : materia.nome);
    setFormExamDate(materia.examDate || '');
    setFormCfu(materia.cfu);
    setFormDifficulty(Number.isFinite(materia.perceivedDifficulty) ? materia.perceivedDifficulty : 3);
    setFormExamPassed(!!materia.examPassed);
    setFormVoto(Number.isFinite(materia.voto) ? String(materia.voto) : '');
    setFormLode(!!materia.lode);
    setMateriaModalOpen(true);
  };

  const handleCourseChange = (courseId) => {
    setFormCourseId(courseId);
    const course = courseId && courseId !== CUSTOM_COURSE_ID ? getCourseById(courseId) : null;
    if (course) setFormCfu(course.cfu);
  };

  const submitMateria = () => {
    const nome = selectedCourse ? selectedCourse.nome : formCustomNome.trim();
    if (!formCourseId || !nome) return;
    // Multiverse Simulator (V18.0): il Voto conta SOLO se l'Esame è
    // dichiarato Superato — se l'utente disattiva il toggle, il voto non
    // viene mai persistito (niente medie sporcate da esami non superati).
    const parsedVoto = Number(formVoto);
    const voto = formExamPassed && Number.isFinite(parsedVoto) && parsedVoto >= MIN_VOTO && parsedVoto <= MAX_VOTO ? parsedVoto : null;
    const payload = {
      nome,
      courseId: selectedCourse ? selectedCourse.id : null,
      examDate: formExamDate || null, // stringa "YYYY-MM-DD" pura: aritmetica sempre in UTC assoluto (fix timezone shift).
      cfu: selectedCourse ? selectedCourse.cfu : Math.max(1, Number(formCfu) || 6),
      perceivedDifficulty: formDifficulty,
      examPassed: formExamPassed,
      voto,
      lode: voto === LODE_VALUE && formLode
    };
    if (editingMateria) {
      actions.updateMateria(editingMateria.id, payload);
    } else {
      actions.addMateria(payload);
    }
    setMateriaModalOpen(false);
  };

  const openAddSfida = () => {
    setSfidaNome('');
    setSfidaObiettivo('');
    setSfidaOreStimate(4);
    setSfidaParentId('');
    setSfidaDifficulty(DIFFICULTY.MEDIUM);
    setSfidaModalOpen(true);
  };

  const submitSfida = () => {
    if (!selectedMateria || !sfidaNome.trim() || goblinActive) return;
    actions.addSfida(selectedMateria.id, {
      nome: sfidaNome.trim(),
      obiettivo: sfidaObiettivo.trim(),
      oreStimate: Math.max(0.5, Number(sfidaOreStimate) || 2),
      parentId: sfidaParentId || null,
      difficulty: sfidaDifficulty
    });
    setSfidaModalOpen(false);
  };

  // V31.2 — Pillar 1 (Ultimate Node Customization): ingresso in modalità
  // interattiva — copia i valori correnti del nodo nello staging locale
  // `edit*`, cosi' "Annulla" può sempre tornare indietro senza toccare il
  // nodo reale nel Context.
  const openNodeEditMode = useCallback((node) => {
    setEditNome(node.nome);
    setEditObiettivo(node.obiettivo || '');
    setEditOreStimate(node.oreStimate);
    setEditDifficulty(node.difficulty);
    setEditParentId(node.parentId || '');
    setNodeSaveState('idle');
    setNodeEditMode(true);
  }, []);

  const cancelNodeEdit = useCallback(() => {
    setNodeEditMode(false);
    setNodeSaveState('idle');
  }, []);

  // Pillar 2 — persistenza: dispatcha la patch al Context (istantaneo,
  // Pillar 2.1) e sincronizza su Supabase tramite l'azione dedicata
  // (Pillar 2.2/2.3). `nodeDetail` viene aggiornato in loco con la patch
  // già confermata, cosi' la modale mostra subito i nuovi valori senza
  // dover essere richiusa e riaperta.
  const saveNodeEdits = useCallback(async (node) => {
    if (!selectedMateria || !editNome.trim() || nodeSaveState === 'saving') return;
    setNodeSaveState('saving');
    const patch = {
      nome: editNome.trim(),
      obiettivo: editObiettivo.trim(),
      oreStimate: Math.max(0.5, Number(editOreStimate) || 2),
      difficulty: editDifficulty,
      parentId: editParentId || null
    };
    const result = await actions.updateSfidaAndSync(selectedMateria.id, node.id, patch);
    if (result.success) {
      setNodeDetail((prev) => (prev && prev.id === node.id ? { ...prev, ...patch } : prev));
      setNodeSaveState('success');
      pushToast('Nodo aggiornato — modifiche sincronizzate su Supabase.', 'success');
      setTimeout(() => {
        setNodeEditMode(false);
        setNodeSaveState('idle');
      }, 1000);
    } else {
      setNodeSaveState('error');
      pushToast('Karen: sincronizzazione Cloud fallita. Riprova a salvare.', 'danger');
    }
  }, [selectedMateria, editNome, editObiettivo, editOreStimate, editDifficulty, editParentId, nodeSaveState, actions, pushToast]);

  const handleReview = useCallback((node, rating) => {
    const materia = materie.find((m) => Array.isArray(m?.sfide) && m.sfide.some((s) => s.id === node.id));
    if (materia) actions.reviewSfida(materia.id, node.id, rating);
  }, [materie, actions]);

  // V16.0 (Pillar 1) — tentativo di completare un nodo "Boss" prima che
  // tutti i suoi figli diretti siano COMPLETED: nessuna azione distruttiva,
  // solo un alert elegante (toast) a spiegare cosa manca. Il reducer
  // (COMPLETE_SFIDA) resta comunque l'ultima linea di difesa idempotente.
  const handleAttemptComplete = useCallback((node) => {
    actions.completeSfida(selectedMateria.id, node.id);
    closeNodeDetail();
  }, [actions, selectedMateria, closeNodeDetail]);

  const handleBossLockedAttempt = useCallback(() => {
    pushToast('Completa prima tutti i sotto-argomenti', 'danger');
  }, [pushToast]);

  // V34.4 — Conferma effettiva del "Riporta a da completare": eseguita solo
  // dopo la conferma nel ConfirmDialog dedicato (mai un click diretto sul
  // bottone nella modale di dettaglio, per evitare un undo accidentale
  // tanto quanto lo era stato il "Completa Nodo" di partenza).
  const confirmReopenNode = useCallback(() => {
    if (!selectedMateria || !reopenNodeTarget) return;
    actions.reopenSfida(selectedMateria.id, reopenNodeTarget.id);
    setReopenNodeTarget(null);
  }, [actions, selectedMateria, reopenNodeTarget]);

  // V34.2 — "Selezione Multipla Nodi": toggle di un singolo id nel Set —
  // immutabile (nuovo Set ad ogni chiamata), coerente col resto dell'app.
  const toggleNodeSelection = useCallback((sfidaId) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(sfidaId)) next.delete(sfidaId);
      else next.add(sfidaId);
      return next;
    });
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) setSelectedNodeIds(new Set()); // uscita: selezione sempre azzerata.
      return !prev;
    });
  }, []);

  const confirmBulkDeleteNodes = useCallback(() => {
    if (!selectedMateria || selectedNodeIds.size === 0) return;
    actions.bulkDeleteSfide(selectedMateria.id, Array.from(selectedNodeIds));
    setSelectedNodeIds(new Set());
    setBulkDeleteConfirmOpen(false);
  }, [selectedMateria, selectedNodeIds, actions]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className={H1}>The Web-Matrix</h1>
          <p className="text-base text-slate-400 mt-1.5">
            Karen: Web-Path Planner attivo. Skill Tree ordinato per Spider-Score — sotto-argomenti sempre liberi, il Nodo Padre è un Boss da sconfiggere per ultimo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setSpiderSenseDrawerOpen(true)} className={`relative ${BTN_SECONDARY}`}>
            <Icon name="alertTriangle" className="w-5 h-5" />
            Attiva Spider-Sense
            {derived.upcomingReviews.length > 0 && (
              <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-white text-[11px] flex items-center justify-center font-mono shadow-primary-glow">
                {derived.upcomingReviews.length}
              </span>
            )}
          </button>
          <button type="button" onClick={openAddMateria} className={BTN_PRIMARY}>
            <Icon name="plus" className="w-5 h-5" />
            Nuovo Nodo Web-Matrix
          </button>
        </div>
      </div>

      <KarenSuggestorPanel primaryTarget={primaryTarget} onSelect={setSelectedMateriaId} />
      <BountyBoardPanel targets={derived.bountyTargets} onSelect={openNodeFromSchedule} />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Colonna materie — Decluttering Accordion per Anno (V20.0, Pillar
            2): raggruppate 1°/2°/3° Anno + Materie Libere, ordinate
            internamente per Spider-Score decrescente (Time-Weaver Formula:
            Difficoltà + Esami Sbloccati + 1000/Giorni Mancanti). Solo
            l'anno del Primary Target parte aperto di default. */}
        <div className="lg:col-span-1 space-y-3">
          {materie.length === 0 && (
            <div className={CARD}>
              <EmptyState
                variant="tree"
                compact
                title="Karen: nessun nodo del Web-Matrix rilevato."
                subtitle="Apri il tuo primo corso dal piano di studi per iniziare a tracciare lo Skill Tree."
              />
            </div>
          )}
          {YEAR_SECTIONS.filter((sec) => (materieByYear.get(sec.key) || []).length > 0).map((sec) => {
            const items = materieByYear.get(sec.key) || [];
            const isOpen = openYears.has(sec.key);
            const hasPrimaryTarget = sec.key === primaryTargetYearKey;
            return (
              <div key={sec.key} className="rounded-2xl border border-secondary/15 bg-surface/40 backdrop-blur-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleYear(sec.key)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface/60 transition-all duration-300"
                >
                  <span className="text-sm font-bold tracking-wide text-slate-200 flex items-center gap-2 flex-wrap">
                    {sec.label}
                    <span className={BADGE.slate}>{items.length}</span>
                    {hasPrimaryTarget && (
                      <span className={BADGE.amber}>
                        <Icon name="crosshair" className="w-3 h-3" />
                        target
                      </span>
                    )}
                  </span>
                  <Icon name="chevronDown" className={`w-4 h-4 text-slate-500 transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-3">
                    {items.map((m) => {
                      const spiderScore = computeSpiderScore(m);
                      const mSfide = Array.isArray(m?.sfide) ? m.sfide : [];
                      const total = mSfide.length;
                      const done = mSfide.filter((s) => s.status === 'COMPLETED').length;
                      const active = m.id === selectedMateriaId;
                      const goblin = isGoblinProtocol(m);
                      const quota = derived.karenQuotaByMateriaId.get(m.id);
                      // Quantum Router (V23.0, Modulo 1): 3 stati invece del
                      // vecchio booleano eventHorizon — Ottimale non riceve
                      // mai uno stile speciale (nessun falso allarme),
                      // Attenzione un respiro ambra morbido, Critico il
                      // lampeggio rosso di prima.
                      const status = quota?.status;
                      const critico = status === 'CRITICO';
                      const attenzione = status === 'ATTENZIONE';
                      // V29.0 — Pillar 2 (Automatic Precedence Engine): la
                      // Materia resta pienamente visibile/cliccabile (mai
                      // bloccata) ma segnalata come "congelata" per il
                      // planner automatico finché le propedeuticità
                      // ufficiali non sono soddisfatte.
                      const congelata = status === 'CONGELATA';
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedMateriaId(m.id)}
                          className={`relative w-full text-left p-3 sm:p-4 rounded-2xl border transition-all duration-300 backdrop-blur-2xl overflow-hidden ${
                            critico
                              ? 'af-event-horizon border-primary/70 bg-primary/10'
                              : goblin
                              ? 'af-goblin border-primary/60 bg-primary/10'
                              : attenzione
                              ? 'af-attenzione-pulse border-accent/60 bg-accent/10'
                              : congelata
                              ? 'bg-surface/40 border-slate-500/20 opacity-70'
                              : active
                              ? 'bg-surface/80 border-secondary/60 shadow-secondary-glow'
                              : 'bg-surface/60 border-secondary/15 hover:border-secondary/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-semibold text-base flex items-center gap-1.5 min-w-0 truncate text-slate-100">
                              {critico ? (
                                <Icon name="alertTriangle" className="w-4 h-4 text-primary shrink-0" />
                              ) : attenzione ? (
                                <Icon name="alertTriangle" className="w-4 h-4 text-accent shrink-0" />
                              ) : congelata ? (
                                <Icon name="lock" className="w-4 h-4 text-slate-500 shrink-0" />
                              ) : (
                                goblin && <Icon name="skull" className="w-4 h-4 text-primary shrink-0" />
                              )}
                              <span className="truncate">{m.nome}</span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0 flex-wrap">
                              {congelata && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/60 text-slate-400 border border-slate-500/30 px-2.5 py-0.5 text-[11px] font-mono">
                                  Congelata
                                </span>
                              )}
                              <span className={BADGE.blue}>{m.cfu} CFU</span>
                              <span className={BADGE.amber} title="Spider-Score — Time-Weaver Formula">
                                <Icon name="bolt" className="w-3.5 h-3.5" />
                                {spiderScore}
                              </span>
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {m.examDate && <p className="text-sm text-slate-500">Esame: {formatDateOnlyHuman(m.examDate)}</p>}
                            {m.examPassed && (
                              <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                                <Icon name="check" className="w-3.5 h-3.5" />
                                superato{Number.isFinite(m.voto) ? ` · ${m.voto}${m.lode ? ' e lode' : ''}/30` : ''}
                              </span>
                            )}
                          </div>
                          <div className="mt-3 h-2 af-web-bar bg-surface/80 rounded-full overflow-hidden border border-secondary/15">
                            <div
                              className="h-full bg-gradient-to-r from-secondary to-secondary-dark"
                              style={{ width: total > 0 ? `${(done / total) * 100}%` : '0%' }}
                            />
                          </div>
                          <p className="text-sm text-slate-500 mt-1.5">{done}/{total} nodi</p>
                          {critico && (
                            <p className="text-xs text-primary mt-2 font-semibold flex items-start gap-1.5">
                              <Icon name="alertTriangle" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              Karen: traiettoria insostenibile. Rischio esaurimento. Consigliato rinvio appello.
                            </p>
                          )}
                          {attenzione && (
                            <p className="text-xs text-accent mt-2 font-medium flex items-start gap-1.5">
                              <Icon name="alertTriangle" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              Karen: ritmo leggermente indietro rispetto alla Fine Prevista.
                            </p>
                          )}
                          {congelata && (
                            <p className="text-xs text-slate-500 mt-2 flex items-start gap-1.5">
                              <Icon name="lock" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              Propedeuticità mancante: {quota.missingPrereqNames.join(', ')}. Esclusa dal planner automatico, preparabile a mano.
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Colonna Skill Tree */}
        <div className="lg:col-span-3 space-y-5">
          {selectedMateria ? (
            <>
              {/* Livello 1 — Macro-Materia / Esame */}
              <div className={goblinActive ? `${CARD_ALERT} space-y-4 af-goblin` : `${CARD} space-y-4`}>
                {goblinActive && (
                  <div className="relative bg-primary/10 border border-primary/40 rounded-xl px-4 py-3.5 flex items-start gap-3">
                    <Icon name="skull" className="w-6 h-6 text-primary shrink-0" />
                    <div>
                      <p className="text-base font-semibold text-primary">Green Goblin Protocol Attivo</p>
                      <p className="text-sm text-slate-400 mt-0.5">
                        Esame imminente (≤3 giorni). Creazione di nuovi nodi bloccata: concentrati esclusivamente su ripasso e Sinister Six Simulator.
                      </p>
                    </div>
                  </div>
                )}
                <div className="relative flex items-start justify-between flex-wrap gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className={H2}>{selectedMateria.nome}</h2>
                      <span className={BADGE.blue}>{selectedMateria.cfu} CFU</span>
                    </div>
                    <div className="flex items-center gap-x-5 gap-y-1 flex-wrap mt-3">
                      {selectedMateria.examDate && (
                        <span className="text-sm text-slate-400 flex items-center gap-1.5">
                          <Icon name="radar" className="w-4 h-4 text-slate-500" />
                          Esame: <span className="font-mono text-slate-200">{formatDateOnlyHuman(selectedMateria.examDate)}</span>
                        </span>
                      )}
                      {estimate && !estimate.done && estimate.dateKey && (
                        <span className="text-sm text-secondary flex items-center gap-1.5" title={`${estimate.totalHoursNeeded} ore totali stimate sui ${estimate.remaining} nodi ancora incompleti (~${estimate.totalDaysNeeded}gg a ritmo sostenibile)`}>
                          <Icon name="bolt" className="w-4 h-4" />
                          Fine prevista: <span className="font-mono">{formatDateOnlyHuman(estimate.dateKey)}</span>
                          <span className="text-slate-500">· {estimate.totalHoursNeeded}h residue</span>
                        </span>
                      )}
                      {estimate && estimate.done && (
                        <span className="text-sm text-emerald-400 flex items-center gap-1.5">
                          <Icon name="check" className="w-4 h-4" />
                          Nodo Web-Matrix completato
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditMateria(selectedMateria)}
                      className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 hover:text-secondary hover:border-secondary/40 transition-all duration-300"
                      aria-label="Modifica nodo Web-Matrix"
                    >
                      <Icon name="edit" className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteMateriaTarget(selectedMateria)}
                      className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 hover:text-primary hover:border-primary/40 transition-all duration-300"
                      aria-label="Elimina nodo Web-Matrix"
                    >
                      <Icon name="trash" className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiIndexModalOpen(true)}
                      disabled={goblinActive}
                      title={goblinActive ? 'Goblin Protocol attivo: importazione nodi bloccata' : 'AI Index Matrix — importa un indice generato via IA'}
                      className={`hidden sm:inline-flex ${BTN_GHOST}`}
                    >
                      <Icon name="chip" className="w-5 h-5" />
                      AI Index Matrix
                    </button>
                    <button
                      type="button"
                      onClick={openAddSfida}
                      disabled={goblinActive}
                      title={goblinActive ? 'Goblin Protocol attivo: aggiunta nodi bloccata' : ''}
                      className={BTN_SECONDARY}
                    >
                      <Icon name="plus" className="w-5 h-5" />
                      Nodo
                    </button>
                    {/* V34.2 — "Selezione Multipla Nodi": disattivato senza
                        nodi da selezionare, mai un pulsante che entra in
                        una modalità vuota e inutile. */}
                    <button
                      type="button"
                      onClick={toggleSelectionMode}
                      disabled={rootNodes.length === 0}
                      title={rootNodes.length === 0 ? 'Nessun nodo da selezionare' : ''}
                      className={selectionMode ? BTN_SECONDARY : BTN_GHOST}
                    >
                      <Icon name={selectionMode ? 'close' : 'check'} className="w-5 h-5" />
                      {selectionMode ? 'Esci Selezione' : 'Seleziona Nodi'}
                    </button>
                  </div>
                </div>
                {/* AI Index Matrix — su mobile il pulsante ghost non entra
                    comodamente nella riga: riga dedicata a piena larghezza
                    sotto l'header, mai un'icona-only che nasconde il
                    significato dell'azione. */}
                <button
                  type="button"
                  onClick={() => setAiIndexModalOpen(true)}
                  disabled={goblinActive}
                  className={`sm:hidden w-full ${BTN_GHOST}`}
                >
                  <Icon name="chip" className="w-5 h-5" />
                  AI Index Matrix
                </button>
              </div>

              {/* V34.2 — "Selezione Multipla Nodi": barra azioni di gruppo,
                  sempre visibile mentre la modalità è attiva (0 o più nodi
                  selezionati) — mai nascosta finché l'utente non ne
                  seleziona almeno uno, cosi' resta chiaro come uscirne. */}
              {selectionMode && (
                <div className="relative flex items-center justify-between flex-wrap gap-3 bg-primary/10 border border-primary/40 rounded-2xl px-4 py-3.5 af-holo-alert-in">
                  <span className="text-sm font-semibold text-primary flex items-center gap-2">
                    <Icon name="check" className="w-4 h-4" />
                    {selectedNodeIds.size} nodo/i selezionato/i
                  </span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={toggleSelectionMode} className={BTN_GHOST}>
                      Annulla
                    </button>
                    <button
                      type="button"
                      disabled={selectedNodeIds.size === 0}
                      onClick={() => setBulkDeleteConfirmOpen(true)}
                      className={BTN_PRIMARY}
                    >
                      <Icon name="trash" className="w-5 h-5" />
                      Elimina Selezionati
                    </button>
                  </div>
                </div>
              )}

              {/* Livelli 2 + 3 — Nodi Padre e relativi Nodi Figli */}
              {rootNodes.length === 0 ? (
                <div className={CARD}>
                  <EmptyState
                    variant="tree"
                    title="Karen: nessun nodo in questo ramo del Web-Matrix."
                    subtitle="Aggiungi il primo Nodo Padre per cominciare a costruire lo Skill Tree."
                  />
                </div>
              ) : (
                <div className="space-y-5">
                  {rootNodes.map((node) => (
                    <ParentModuleCard
                      key={node.id}
                      node={node}
                      materia={selectedMateria}
                      onSelect={openNodeDetail}
                      bountyIds={bountySfidaIds}
                      selectionMode={selectionMode}
                      selectedIds={selectedNodeIds}
                      onToggleSelect={toggleNodeSelection}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className={CARD}>
              <EmptyState
                variant="tree"
                title="Karen: nessun nodo selezionato."
                subtitle="Seleziona un nodo del Web-Matrix dalla colonna a sinistra, o aprine uno nuovo dal piano di studi, per visualizzare lo Skill Tree."
              />
            </div>
          )}
        </div>
      </div>

      {/* Spider-Sense Schedule — visibilità totale sui ripassi tracciati, dovuti o futuri. */}
      <div className={`${CARD} space-y-5`}>
        <div className="relative flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-secondary/10 border border-secondary/30 flex items-center justify-center text-secondary shrink-0">
              <Icon name="radar" className="w-6 h-6" />
            </div>
            <div>
              <h2 className={H2}>Spider-Sense Schedule</h2>
              <p className="text-sm text-slate-500">Timeline completa dei ripassi tracciati, materia per materia.</p>
            </div>
          </div>
          <span className={BADGE.blue}>{derived.allTrackedReviews.length} nodi tracciati</span>
        </div>

        {scheduleGroups.length === 0 ? (
          <EmptyState
            variant="radar"
            compact
            title="Nessun nodo tracciato"
            subtitle="Completa il primo nodo di uno Skill Tree per iniziare a tracciare i ripassi con lo Spider-Sense."
          />
        ) : (
          <div className="relative space-y-5">
            {scheduleGroups.map((group) => (
              <div key={group.materiaId}>
                <p className="text-sm font-semibold text-slate-500 tracking-widest mb-2.5">{group.materiaNome.toUpperCase()}</p>
                <div className="flex flex-wrap gap-2">
                  {group.items.map((item) => {
                    const overdue = item.daysUntil < 0;
                    const dueToday = item.daysUntil === 0;
                    const urgent = overdue || dueToday;
                    return (
                      <button
                        key={item.sfidaId}
                        type="button"
                        onClick={() => openNodeFromSchedule(item.materiaId, item.sfidaId)}
                        className={urgent ? BADGE.red : BADGE.blue}
                      >
                        <Icon name={urgent ? 'alertTriangle' : 'check'} className="w-3.5 h-3.5" />
                        {item.sfidaNome}
                        <span className="opacity-70 font-normal">
                          {overdue ? `— scaduto da ${Math.abs(item.daysUntil)}gg` : dueToday ? '— ripassa ora' : `— tra ${item.daysUntil}gg`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Web-Path Planner — crea/modifica Materia dal piano di studi Vanvitelli */}
      <Modal
        open={materiaModalOpen}
        onClose={() => setMateriaModalOpen(false)}
        title={editingMateria ? 'Modifica Nodo Web-Matrix' : 'Web-Path Planner — Nuovo Nodo'}
        maxWidth="max-w-xl"
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-400 block mb-1.5">Corso (piano di studi Ingegneria Aerospaziale — Vanvitelli)</label>
            <Dropdown
              value={formCourseId}
              onChange={handleCourseChange}
              options={courseOptions}
              placeholder="Seleziona un corso ufficiale o una Materia Libera..."
            />
          </div>

          {formCourseId === CUSTOM_COURSE_ID && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-400 block mb-1.5">Nome materia</label>
                <input
                  type="text"
                  value={formCustomNome}
                  onChange={(e) => setFormCustomNome(e.target.value)}
                  className={INPUT}
                  placeholder="Es. Corso a scelta libera"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1.5">CFU</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={formCfu}
                  onChange={(e) => setFormCfu(e.target.value)}
                  className={INPUT}
                />
              </div>
            </div>
          )}

          {selectedCourse && (
            <div className="flex items-center gap-3 bg-surface/70 border border-secondary/20 rounded-xl px-4 py-3">
              <span className={BADGE.blue}>{selectedCourse.cfu} CFU — autocompilati</span>
              <span className={BADGE.slate}>{selectedCourse.anno}° anno</span>
            </div>
          )}

          {/* Soft-Lock Propedeuticità — Warning UI elegante, MAI bloccante:
              il nodo resta sempre creabile per studiare gli appunti in anticipo. */}
          {missingPrereqs.length > 0 && (
            <div className="relative bg-accent/10 border border-accent/40 rounded-xl px-4 py-3.5 flex items-start gap-3">
              <Icon name="alertTriangle" className="w-5 h-5 text-accent shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-accent">
                  Richiede {missingPrereqs.map((c) => c.nome).join(', ')} per l'esame ufficiale.
                </p>
                <p className="text-sm text-slate-400 mt-0.5">
                  Karen: permesso di studio simultaneo accordato — puoi comunque tracciare gli appunti in anticipo su questo nodo.
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-slate-400 block mb-1.5">Data esame</label>
            <input
              type="date"
              value={formExamDate}
              onChange={(e) => setFormExamDate(e.target.value)}
              className={INPUT}
            />
          </div>

          <div className="bg-surface/70 border border-secondary/15 rounded-xl px-4 py-4">
            <TechSlider value={formDifficulty} onChange={setFormDifficulty} labels={DIFFICULTY_SLIDER_LABELS} accent="primary" />
          </div>

          {/* Time-Weaver Formula (V20.0, Pillar 2): l'Urgenza manuale è
              stata rimossa — il fattore tempo ora arriva SOLO dalla Data
              Esame reale (1000/giorni mancanti), calcolato automaticamente
              da Karen. Nessuno slider soggettivo può più scavalcarlo. */}
          <div className="flex items-center justify-between gap-3 bg-surface/70 border border-secondary/15 rounded-xl px-4 py-3">
            <span className="text-sm text-slate-400">Spider-Score risultante (Time-Weaver Formula)</span>
            <span className={BADGE.amber}>
              <Icon name="bolt" className="w-3.5 h-3.5" />
              {previewSpiderScore}
            </span>
          </div>

          <ExamPassedToggle checked={formExamPassed} onChange={() => setFormExamPassed((v) => !v)} />

          {/* Multiverse Simulator (V18.0, Pillar 3) — il Voto ufficiale entra
              nella Media Ponderata Reale solo se l'Esame è Superato. */}
          {formExamPassed && (
            <div className="bg-surface/70 border border-accent/25 rounded-xl px-4 py-4 space-y-3">
              <p className="text-sm text-accent font-semibold flex items-center gap-1.5">
                <Icon name="chartBar" className="w-4 h-4" />
                Voto — alimenta il Multiverse Simulator (Media Ponderata / Proiezione di Laurea)
              </p>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="text-sm text-slate-400 block mb-1.5">Voto (18-30)</label>
                  <input
                    type="number"
                    min={MIN_VOTO}
                    max={MAX_VOTO}
                    value={formVoto}
                    onChange={(e) => setFormVoto(e.target.value)}
                    placeholder="Es. 27"
                    className={INPUT}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setFormLode((v) => !v)}
                  disabled={Number(formVoto) !== LODE_VALUE}
                  className={`h-[50px] rounded-xl border font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2 ${
                    formLode && Number(formVoto) === LODE_VALUE
                      ? 'bg-accent/20 border-accent/60 text-accent'
                      : 'bg-surface/80 border-white/10 text-slate-500'
                  } disabled:opacity-40 disabled:pointer-events-none`}
                >
                  <Icon name="trophy" className="w-4 h-4" />
                  e Lode
                </button>
              </div>
              <p className="text-xs text-slate-500">Lasciando il campo vuoto, questo esame non entrerà nel calcolo della media ponderata.</p>
            </div>
          )}

          <p className="text-sm text-slate-500">XP nodo = XP_Base × (1 + CFU × 0.05): più CFU, più XP per ogni traguardo.</p>
          <button
            type="button"
            disabled={!formCourseId || (formCourseId === CUSTOM_COURSE_ID && !formCustomNome.trim())}
            onClick={submitMateria}
            className={`w-full ${BTN_PRIMARY}`}
          >
            {editingMateria ? 'Salva Modifiche' : 'Apri Nodo nel Web-Matrix'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteMateriaTarget}
        onClose={() => setDeleteMateriaTarget(null)}
        onConfirm={() => {
          actions.deleteMateria(deleteMateriaTarget.id);
          if (selectedMateriaId === deleteMateriaTarget.id) setSelectedMateriaId('');
        }}
        title="Elimina Nodo Web-Matrix"
        message={`Eliminare "${deleteMateriaTarget?.nome}"? Tutti i nodi e i progressi collegati andranno persi.`}
        confirmLabel="Elimina"
      />

      {/* V27.0 — Pillar 2: AI Index Matrix — importazione bulk dello Skill Tree. */}
      <AiIndexMatrixModal
        open={aiIndexModalOpen}
        onClose={() => setAiIndexModalOpen(false)}
        materiaId={selectedMateria?.id || null}
        materiaNome={selectedMateria?.nome || ''}
      />

      {/* Modal: nuovo nodo */}
      <Modal open={sfidaModalOpen} onClose={() => setSfidaModalOpen(false)} title="Nuovo Nodo dello Skill Tree">
        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-400 block mb-1.5">Nome nodo</label>
            <input
              type="text"
              value={sfidaNome}
              onChange={(e) => setSfidaNome(e.target.value)}
              className={INPUT}
              placeholder="Es. Equazioni di Navier-Stokes"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 block mb-1.5">Obiettivo</label>
            <textarea
              value={sfidaObiettivo}
              onChange={(e) => setSfidaObiettivo(e.target.value)}
              rows={3}
              className={`${INPUT} resize-none`}
              placeholder="Cosa significa completare questo nodo?"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-400 block mb-1.5">Ore previste</label>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={sfidaOreStimate}
                onChange={(e) => setSfidaOreStimate(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label className="text-sm text-slate-400 block mb-1.5">Difficoltà</label>
              <Dropdown
                value={sfidaDifficulty}
                onChange={setSfidaDifficulty}
                options={Object.values(DIFFICULTY).map((d) => ({ value: d, label: DIFFICULTY_META[d].label }))}
              />
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-400 block mb-1.5">Nodo Padre (Categoria / prerequisito)</label>
            <Dropdown
              value={sfidaParentId}
              onChange={setSfidaParentId}
              placeholder="Nessuno (Nodo Padre — categoria di primo livello)"
              options={[
                { value: '', label: 'Nessuno (Nodo Padre — categoria di primo livello)' },
                ...selectedSfide.map((s) => ({ value: s.id, label: s.nome }))
              ]}
            />
            <p className="text-sm text-slate-500 mt-1.5">
              Questo nodo sarà sempre liberamente completabile. Se in futuro diventerà a sua volta un Nodo Padre
              (altri nodi lo useranno come prerequisito), potrà chiudersi solo a sotto-argomenti tutti completati.
            </p>
          </div>
          <button type="button" disabled={!sfidaNome.trim()} onClick={submitSfida} className={`w-full ${BTN_SECONDARY}`}>
            Aggiungi Nodo
          </button>
        </div>
      </Modal>

      {/* Modal / pannello di dettaglio nodo — qui vivono tutte le azioni
          rapide (Ripassa, Forza Ripasso, Editor di Personalizzazione),
          tenute fuori dalle righe dell'albero per non affollarle. */}
      <Modal open={!!nodeDetail} onClose={requestCloseNodeDetail} title={nodeDetail?.nome || ''}>
        {nodeDetail && selectedMateria && (() => {
          const status = deriveNodeStatus(nodeDetail, selectedSfide);
          const meta = STATUS_META[status];
          const diffMeta = DIFFICULTY_META[nodeDetail.difficulty];
          const ownChildren = directChildrenOf(nodeDetail, selectedSfide);
          const isBoss = ownChildren.length > 0;
          const pendingOwnChildren = ownChildren.filter((c) => c.status !== 'COMPLETED').length;
          const canComplete = status === NODE_STATUS.AVAILABLE;
          const bossLocked = isBoss && status === NODE_STATUS.LOCKED;
          const parentOptions = selectedSfide.filter(
            (s) => s.id !== nodeDetail.id && !isDescendant(selectedSfide, nodeDetail.id, s.id)
          );
          const currentParent = selectedSfide.find((s) => s.id === nodeDetail.parentId) || null;
          const isSaving = nodeSaveState === 'saving';

          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={meta.badge}>{meta.label}</span>
                {!nodeEditMode && (
                  <span className={`text-sm font-mono px-2.5 py-1 rounded-full border ${diffMeta.border} ${diffMeta.color}`}>
                    {diffMeta.label}{nodeDetail.difficulty === 'HARD' ? ' (+30% XP)' : ''}
                  </span>
                )}
                {isBoss && <span className="text-sm font-mono px-2.5 py-1 rounded-full border border-secondary/30 text-secondary">Boss — {ownChildren.length} figlio/i</span>}
                {bountySfidaIds.has(nodeDetail.id) && (
                  <span className={BADGE.red} title="Bounty Target — alta frizione nei ripassi">
                    <Icon name="crosshair" className="w-3.5 h-3.5" />
                    Bounty Target
                  </span>
                )}
              </div>

              {/* V31.2 — Pillar 1: pulsante olografico Karen OS. Design
                  adattivo — glow/etichetta cambiano col nodo, e sparisce
                  del tutto quando l'Editor è già aperto (mai due ingressi
                  contemporanei nella stessa modale). */}
              {!nodeEditMode && (
                <button
                  type="button"
                  onClick={() => openNodeEditMode(nodeDetail)}
                  className="group relative w-full flex items-center justify-between gap-3 bg-secondary/10 border border-secondary/40 rounded-xl px-4 py-3.5 overflow-hidden hover:border-secondary/70 hover:bg-secondary/15 hover:-translate-y-0.5 transition-all duration-300"
                >
                  <span className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-secondary/20 blur-2xl pointer-events-none group-hover:bg-secondary/30 transition-all duration-500" />
                  <span className="relative flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg bg-secondary/15 border border-secondary/50 flex items-center justify-center text-secondary shrink-0 shadow-secondary-glow">
                      <Icon name="chip" className="w-4.5 h-4.5" />
                    </span>
                    <span className="text-left min-w-0">
                      <span className="block text-[10px] tracking-[0.25em] text-secondary font-mono">KAREN OS</span>
                      <span className="block text-sm font-bold text-white truncate">Personalizza / Modifica</span>
                    </span>
                  </span>
                  <Icon name="edit" className="relative w-4 h-4 text-secondary shrink-0 group-hover:scale-110 transition-transform duration-300" />
                </button>
              )}

              {nodeEditMode ? (
                <div className="relative bg-secondary/5 border border-secondary/25 rounded-2xl p-4 sm:p-5 space-y-4 overflow-hidden af-edit-mode-in">
                  <div className="absolute -top-14 -left-14 w-48 h-48 rounded-full bg-secondary/10 blur-3xl pointer-events-none" />
                  <div className="relative flex items-center gap-2 text-secondary">
                    <Icon name="chip" className="w-4 h-4" />
                    <span className="text-xs font-mono tracking-[0.2em]">MODALITÀ PERSONALIZZAZIONE ATTIVA</span>
                  </div>

                  <div className="relative">
                    <label className="text-sm text-slate-400 block mb-1.5">Titolo del nodo</label>
                    <input
                      type="text"
                      value={editNome}
                      onChange={(e) => setEditNome(e.target.value)}
                      className={INPUT}
                      placeholder="Es. Equazioni di Navier-Stokes"
                      disabled={isSaving}
                    />
                  </div>

                  <div className="relative">
                    <label className="text-sm text-slate-400 block mb-1.5">Obiettivo</label>
                    <textarea
                      value={editObiettivo}
                      onChange={(e) => setEditObiettivo(e.target.value)}
                      rows={3}
                      className={`${INPUT} resize-none`}
                      placeholder="Cosa significa completare questo nodo?"
                      disabled={isSaving}
                    />
                  </div>

                  <div className="relative grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm text-slate-400 block mb-1.5">Ore previste</label>
                      <input
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={editOreStimate}
                        onChange={(e) => setEditOreStimate(e.target.value)}
                        className={INPUT}
                        disabled={isSaving}
                      />
                    </div>
                    <div>
                      <label className="text-sm text-slate-400 block mb-1.5">Difficoltà</label>
                      <Dropdown
                        value={editDifficulty}
                        onChange={setEditDifficulty}
                        options={Object.values(DIFFICULTY).map((d) => ({ value: d, label: DIFFICULTY_META[d].label }))}
                        disabled={isSaving}
                      />
                    </div>
                  </div>

                  <div className="relative">
                    <label className="text-sm text-slate-400 block mb-1.5">Nodo Padre (Categoria / prerequisito)</label>
                    <Dropdown
                      value={editParentId}
                      onChange={setEditParentId}
                      placeholder="Nessuno (Nodo Padre — categoria di primo livello)"
                      options={[
                        { value: '', label: 'Nessuno (Nodo Padre — categoria di primo livello)' },
                        ...parentOptions.map((s) => ({ value: s.id, label: s.nome }))
                      ]}
                      disabled={isSaving}
                    />
                  </div>

                  {nodeSaveState === 'error' && (
                    <div className="relative bg-primary/10 border border-primary/40 rounded-xl px-4 py-3 flex items-start gap-3 af-holo-alert-in">
                      <Icon name="cloudOff" className="w-5 h-5 text-primary af-sync-error shrink-0 mt-0.5" />
                      <p className="text-sm text-primary">Karen: sincronizzazione Cloud fallita. Le modifiche non sono ancora confermate — riprova a salvare.</p>
                    </div>
                  )}

                  {nodeSaveState === 'success' && (
                    <div className="relative bg-emerald-900/20 border border-emerald-400/40 rounded-xl px-4 py-3 flex items-center gap-3 af-holo-alert-in">
                      <Icon name="cloudCheck" className="w-5 h-5 text-emerald-400 shrink-0" />
                      <p className="text-sm text-emerald-300">Modifiche salvate e sincronizzate su Supabase.</p>
                    </div>
                  )}

                  <div className="relative flex items-center gap-3">
                    <button
                      type="button"
                      onClick={cancelNodeEdit}
                      disabled={isSaving}
                      className={`flex-1 ${BTN_GHOST}`}
                    >
                      Annulla
                    </button>
                    <button
                      type="button"
                      onClick={() => saveNodeEdits(nodeDetail)}
                      disabled={!editNome.trim() || isSaving}
                      className={`flex-[2] ${BTN_SUCCESS}`}
                    >
                      {isSaving ? (
                        <>
                          <Icon name="cloud" className="w-4 h-4 af-cloud-syncing" />
                          Salvataggio in corso...
                        </>
                      ) : (
                        <>
                          <Icon name="check" className="w-4 h-4" />
                          Salva Modifiche
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {nodeDetail.obiettivo && <p className="text-base text-slate-300">{nodeDetail.obiettivo}</p>}
                  <p className="text-sm text-slate-500">
                    Ore previste: {nodeDetail.oreStimate}h · {nodeDetail.focusMinutes} min di Focus accumulati
                    {currentParent && <> · Nodo Padre: <span className="text-slate-300">{currentParent.nome}</span></>}
                  </p>
                  {(status === NODE_STATUS.COMPLETED || status === NODE_STATUS.NEEDS_REVIEW) && nodeDetail.nextReviewDate && (
                    <p className="text-sm text-slate-500">
                      Prossimo ripasso: <span className="font-mono text-slate-300">{nodeDetail.nextReviewDate}</span>
                      {nodeDetail.lastReviewRating && ` · ultimo giudizio: ${REVIEW_RATING_META[nodeDetail.lastReviewRating].label}`}
                      {nodeDetail.reviewCount > 0 && ` · ${nodeDetail.reviewCount} ripassi totali`}
                    </p>
                  )}

                  {status === NODE_STATUS.NEEDS_REVIEW && (
                    <div className="space-y-2">
                      <p className="text-sm text-accent font-semibold flex items-center gap-1.5">
                        <Icon name="alertTriangle" className="w-4 h-4" />
                        Lo Spider-Sense formicola: è ora di ripassare.
                      </p>
                      <ReviewButtons onReview={(rating) => { handleReview(nodeDetail, rating); closeNodeDetail(); }} />
                    </div>
                  )}

                  {status === NODE_STATUS.COMPLETED && (
                    <div className="space-y-2 pt-3 border-t border-white/10">
                      <p className="text-sm text-secondary font-semibold flex items-center gap-1.5">
                        <Icon name="bolt" className="w-4 h-4" />
                        Forza Ripasso Manuale — rinforza subito la memoria, senza aspettare lo Spider-Sense.
                      </p>
                      <ReviewButtons onReview={(rating) => { handleReview(nodeDetail, rating); closeNodeDetail(); }} />
                    </div>
                  )}

                  {/* V34.4 — "Riporta a da completare": undo per un
                      "Completa Nodo" fatto per errore. Visibile su
                      qualunque nodo con stato persistito COMPLETED (sia
                      NEEDS_REVIEW che COMPLETED "puro"), sempre in coda
                      alle azioni di ripasso cosi' da non essere il primo
                      bottone cliccabile per sbaglio. */}
                  {(status === NODE_STATUS.COMPLETED || status === NODE_STATUS.NEEDS_REVIEW) && (
                    <button
                      type="button"
                      onClick={() => {
                        setReopenNodeTarget(nodeDetail);
                        closeNodeDetail();
                      }}
                      className={`w-full ${BTN_GHOST}`}
                    >
                      <Icon name="undo" className="w-4 h-4" />
                      Riporta a "da completare"
                    </button>
                  )}

                  {/* V16.0 (Pillar 1) — alert elegante "Boss non ancora sconfitto":
                      il pulsante resta visibile ma disattivato in stile, e un
                      click mostra il toast esplicativo invece di completare nulla. */}
                  {bossLocked && (
                    <>
                      <div className="relative bg-primary/10 border border-primary/40 rounded-xl px-4 py-3.5 flex items-start gap-3">
                        <Icon name="alertTriangle" className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                        <div>
                          <p className="text-base font-semibold text-primary">Completa prima tutti i sotto-argomenti</p>
                          <p className="text-sm text-slate-400 mt-0.5">
                            {pendingOwnChildren} sotto-argomento/i ancora incompleto/i su {ownChildren.length}: questo nodo è un Boss e si chiude solo a battaglia vinta.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleBossLockedAttempt}
                        className={`w-full ${BTN_SUCCESS} opacity-40 grayscale`}
                      >
                        Completa Nodo
                      </button>
                    </>
                  )}

                  {canComplete && (
                    <button
                      type="button"
                      onClick={() => handleAttemptComplete(nodeDetail)}
                      className={`w-full ${BTN_SUCCESS}`}
                    >
                      Completa Nodo
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setDeleteNodeTarget(nodeDetail);
                      closeNodeDetail();
                    }}
                    className={`w-full ${BTN_GHOST}`}
                  >
                    <Icon name="trash" className="w-4 h-4" />
                    Elimina Nodo
                  </button>
                </>
              )}
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        open={!!deleteNodeTarget}
        onClose={() => setDeleteNodeTarget(null)}
        onConfirm={() => actions.deleteSfida(selectedMateria.id, deleteNodeTarget.id)}
        title="Elimina Nodo"
        message={`Eliminare il nodo "${deleteNodeTarget?.nome}"? Eventuali nodi figli verranno promossi a Nodo Padre, non cancellati.`}
        confirmLabel="Elimina"
      />

      {/* V34.4 — "Riporta a da completare": conferma dedicata (mai danger=true,
          non è un'eliminazione) prima di rimettere il nodo tra i "da fare". */}
      <ConfirmDialog
        open={!!reopenNodeTarget}
        onClose={() => setReopenNodeTarget(null)}
        onConfirm={confirmReopenNode}
        title="Riporta a da completare"
        message={`Riportare il nodo "${reopenNodeTarget?.nome}" tra i nodi da completare? XP, Tech Token e streak già assegnati restano acquisiti — solo lo stato del nodo torna indietro.`}
        confirmLabel="Riporta indietro"
        danger={false}
      />

      {/* V34.2 — "Selezione Multipla Nodi": conferma unica per l'intero
          lotto selezionato, stessa semantica di orfanizzazione (mai
          cancellazione a cascata) del singolo "Elimina Nodo" sopra. */}
      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        onConfirm={confirmBulkDeleteNodes}
        title="Elimina Nodi Selezionati"
        message={`Eliminare ${selectedNodeIds.size} nodo/i selezionato/i? Eventuali nodi figli non selezionati verranno promossi a Nodo Padre, non cancellati.`}
        confirmLabel="Elimina Tutti"
      />

      {/* V31.2.1 — guardia "modifiche non salvate" sull'Editor di
          Personalizzazione: mai uno scarto silenzioso di dati non
          persistiti quando l'utente tenta di chiudere la modale. */}
      <ConfirmDialog
        open={nodeEditCloseConfirmOpen}
        onClose={() => setNodeEditCloseConfirmOpen(false)}
        onConfirm={closeNodeDetail}
        title="Modifiche non salvate"
        message="Hai modifiche non ancora salvate nell'Editor di Personalizzazione. Chiudendo ora andranno perse. Vuoi scartarle?"
        confirmLabel="Scarta modifiche"
      />

      {/* Drawer globale: Attiva Spider-Sense — pannello a scorrimento
          laterale per le azioni rapide di ripasso in blocco. */}
      {spiderSenseDrawerOpen && (
        <div className="fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-surface/75 backdrop-blur-sm" onClick={() => setSpiderSenseDrawerOpen(false)} />
          <div className="absolute top-0 right-0 h-full w-full max-w-md bg-surface/90 backdrop-blur-2xl border-l border-secondary/20 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-secondary/15">
              <div>
                <p className="text-sm text-accent tracking-widest">SPIDER-SENSE ENGINE</p>
                <p className="text-lg font-semibold mt-0.5 text-white">Ripassi in sospeso ({derived.upcomingReviews.length})</p>
              </div>
              <button
                type="button"
                onClick={() => setSpiderSenseDrawerOpen(false)}
                className="text-slate-500 hover:text-primary transition-all duration-300"
                aria-label="Chiudi drawer"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto af-scroll p-6 space-y-3">
              {derived.upcomingReviews.length === 0 ? (
                <EmptyState
                  variant="safe"
                  title="La città è sicura."
                  subtitle="Nessun ripasso in sospeso: lo Spider-Sense è tranquillo. Torna dopo aver completato nuovi nodi."
                />
              ) : (
                derived.upcomingReviews.map((r) => {
                  const diffMeta = DIFFICULTY_META[r.difficulty];
                  return (
                    <div key={r.sfidaId} className="bg-surface/70 border border-accent/30 rounded-2xl p-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-base font-medium truncate text-slate-100">{r.sfidaNome}</p>
                          <p className="text-sm text-slate-500">{r.materiaNome}</p>
                        </div>
                        <span className={`text-xs font-mono px-2 py-0.5 rounded-full border shrink-0 ${diffMeta.border} ${diffMeta.color}`}>
                          {diffMeta.label}
                        </span>
                      </div>
                      <ReviewButtons size="small" onReview={(rating) => actions.reviewSfida(r.materiaId, r.sfidaId, rating)} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
