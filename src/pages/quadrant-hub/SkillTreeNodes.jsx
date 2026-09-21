import React, { useState, memo } from 'react';
import { Icon } from '../../components/Icons.jsx';
import { deriveNodeStatus, NODE_STATUS, directChildrenOf } from '../../utils/skillTree.js';
import { DIFFICULTY_META } from '../../utils/xpEngine.js';
import { REVIEW_RATING, REVIEW_RATING_META, previewReviewIntervals } from '../../utils/spiderSense.js';
import { CARD_BARE, BADGE, RADIAL_GLOW } from '../../utils/designSystem.js';

// =====================================================================
// V35.2 — "Disaccoppiamento Meccanico QuadrantHub". Estratto VERBATIM da
// QuadrantHub.jsx: la gerarchia di rendering dello Skill Tree (Nodo
// Padre -> Nodi Figlio ricorsivi) è interamente presentazionale — riceve
// `materia`/`sfide` come props e chiama `onSelect`/`onToggleSelect`
// verso l'alto, senza mai leggere lo stato del componente pagina
// (QuadrantHub) direttamente. Zero modifica comportamentale: stesso
// identico codice, solo file diverso. Vedi PHASE5_REFACTOR.md.
// =====================================================================

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
export const STATUS_META = {
  LOCKED: { label: 'In Attesa', text: 'text-slate-400', border: 'border-slate-500/30', badge: BADGE.slate, icon: 'gear', glow: null },
  AVAILABLE: { label: 'Disponibile', text: 'text-secondary', border: 'border-secondary/40', badge: BADGE.blue, icon: 'target', glow: RADIAL_GLOW.blue },
  // V35.5 — "In Corso": tinta Ciano fissa (vedi designSystem.js) — mai
  // AVAILABLE (blu/Secondario) né COMPLETED (verde), uno stato visivamente
  // distinto a colpo d'occhio per un nodo su cui è già stato investito
  // tempo di Focus reale ma non ancora chiuso.
  IN_PROGRESS: { label: 'In Corso', text: 'text-cyan-400', border: 'border-cyan-400/40', badge: BADGE.cyan, icon: 'bolt', glow: RADIAL_GLOW.cyan },
  COMPLETED: { label: 'Completato', text: 'text-emerald-400', border: 'border-emerald-400/40', badge: BADGE.green, icon: 'check', glow: RADIAL_GLOW.green },
  NEEDS_REVIEW: { label: 'Spider-Sense', text: 'text-accent', border: 'border-accent/40', badge: BADGE.amber, icon: 'alertTriangle', glow: RADIAL_GLOW.amber }
};

/**
 * V36.0 — le etichette mostrano l'intervallo REALE di QUESTO nodo, non
 * più i vecchi 4/2/1 giorni fissi uguali per tutti. Su un nodo che
 * conosci bene da mesi il pulsante dirà "Facile (+39gg)", su uno appena
 * imparato "Facile (+16gg)": è il feedback che rende visibile — e quindi
 * credibile — la ripetizione dilazionata, e l'unico modo per capire a
 * colpo d'occhio che i ripassi si stanno diradando come devono.
 */
export function ReviewButtons({ onReview, size = 'normal', sfida = null, examDate = null }) {
  const pad = size === 'small' ? 'py-2 text-sm' : 'py-2.5 text-base';
  const previews = previewReviewIntervals(sfida || {}, examDate);
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
            {meta.label} (+{previews[rating]}gg)
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
      <span className="absolute -left-3 sm:-left-4 md:-left-5 top-8 w-3 sm:w-4 md:w-5 h-0.5 bg-gradient-to-r from-secondary/50 to-transparent" />
      <span className="absolute -left-[10px] sm:-left-[18px] md:-left-[22px] top-[30px] w-1.5 h-1.5 rounded-full bg-secondary/60" />
      <div
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={(e) => {
          // V35.2 — Accessibilita': un role="button" nativo risponde sia a
          // Enter che a Spazio (WAI-ARIA APG); questo era rimasto legato al
          // solo Enter — mai due standard di attivazione diversi fra
          // ChildNodeRow/ParentModuleCard e i <button> reali dell'app.
          // preventDefault su Spazio evita anche lo scroll di pagina.
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            handleActivate();
          }
        }}
        className={`group flex items-start sm:items-center gap-3 p-3 sm:p-4 rounded-2xl border backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 cursor-pointer ${
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
            {/* V39 — su telefono il nome prende tutta la riga (fino a 2
                righe) e i badge vanno sotto: prima nome e badge di stato
                si contendevano ~150 px e il nome diventava "Teo…". */}
            <p className="font-medium text-base leading-snug text-slate-100 break-words line-clamp-2 min-w-0 w-full sm:w-auto">{node.nome}</p>
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
                className="text-xs font-mono px-2.5 py-1 min-h-[28px] rounded-full border border-secondary/30 text-secondary shrink-0 flex items-center gap-1 hover:bg-secondary/10 hover:border-secondary/60 transition-all duration-200"
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
            {status === NODE_STATUS.NEEDS_REVIEW && node.nextReviewDate && (
              <span className={`${BADGE.amber} sm:hidden`}>
                <Icon name="alertTriangle" className="w-3.5 h-3.5" />
                ripassa
              </span>
            )}
            <span className={`${meta.badge} sm:hidden`}>{meta.label}</span>
          </div>
          {status === NODE_STATUS.LOCKED ? (
            <p className="text-sm text-slate-500 mt-1 break-words">Completa prima {pendingOwnChildren} sotto-argomento/i</p>
          ) : node.obiettivo ? (
            <p className="text-sm text-slate-500 mt-1 break-words line-clamp-2">{node.obiettivo}</p>
          ) : null}
        </div>
        <div className="text-right shrink-0 hidden sm:flex items-center gap-2">
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
    <div className="ml-3 pl-3 sm:ml-6 sm:pl-5 md:ml-7 md:pl-6 border-l-2 border-secondary/25 space-y-3 relative">
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
    <div className={`${CARD_BARE} space-y-4 border-l-4 ${isSelected ? 'border-primary ring-1 ring-primary/50' : meta.border}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={(e) => {
          // V35.2 — Accessibilita': vedi commento gemello in ChildNodeRow —
          // Enter e Spazio devono attivare allo stesso modo un role="button".
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            handleActivate();
          }
        }}
        className="relative flex items-start sm:items-center gap-3 sm:gap-4 cursor-pointer"
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
            <p className="font-bold text-lg leading-snug text-white break-words line-clamp-2 min-w-0 w-full sm:w-auto">{node.nome}</p>
            <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${diffMeta.border} ${diffMeta.color}`}>
              {diffMeta.label}
            </span>
            {isBounty && (
              <span className={BADGE.red} title="Bounty Target — alta frizione nei ripassi">
                <Icon name="crosshair" className="w-3.5 h-3.5" />
                Bounty
              </span>
            )}
            <span className={`${meta.badge} sm:hidden`}>{meta.label}</span>
          </div>
          {node.obiettivo && <p className="text-base text-slate-400 mt-1.5 break-words line-clamp-2">{node.obiettivo}</p>}
          {childCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setChildrenOpen((v) => !v);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              title={childrenOpen ? 'Nascondi nodi figlio' : 'Mostra nodi figlio'}
              className="text-sm text-slate-500 hover:text-secondary mt-1 -ml-1 px-1 py-1.5 min-h-[32px] rounded-lg flex items-center gap-1.5 text-left transition-colors duration-200"
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
        <div className="text-right shrink-0 space-y-1.5 hidden sm:block">
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
