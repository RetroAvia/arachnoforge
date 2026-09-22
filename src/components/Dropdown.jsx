import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';
import { INPUT, INPUT_SM } from '../utils/designSystem.js';

/** Margine minimo dal bordo del viewport. */
const EDGE = 8;
/** Altezza massima del menu. */
const MAX_LIST_H = 288;
/** Larghezza massima del menu quando le opzioni sono più lunghe del trigger. */
const MAX_LIST_W = 360;

/**
 * Dropdown — select custom in stile HUD "Stark Tech", sostituto drop-in del
 * <select> nativo del browser. Accessibile da tastiera (Frecce, Home, End,
 * Invio, Esc), si chiude al click esterno.
 *
 * V39.0 — Riscritto il posizionamento del menu, che aveva tre difetti
 * verificati nel browser:
 *
 *  1. TAGLIATO. Il menu era `absolute` dentro il suo contenitore, e metà
 *     dei contenitori dell'app sono card con `overflow-hidden`: il timer
 *     di Mission Control e l'editor del nodo lo tagliavano. Ora vive in un
 *     portal su `document.body` con posizione calcolata dal trigger, e si
 *     apre verso l'ALTO quando sotto non c'è spazio.
 *  2. TRONCATO. Il menu era largo esattamente quanto il trigger: in un
 *     trigger stretto le opzioni diventavano "L..", "Sli...". Ora è largo
 *     almeno quanto il trigger e al massimo quanto serve alle opzioni
 *     (entro un tetto), e il testo lungo va a capo invece di sparire.
 *  3. INVADENTE. `focus()` sul menu faceva scorrere l'antenato scrollabile
 *     più vicino (il timer "saltava" di 89px); Esc era ascoltato su
 *     `window` e chiudeva insieme al menu anche la modale che lo conteneva,
 *     perdendo i campi già compilati; dopo la scelta il focus finiva sul
 *     `<body>`. Ora: `preventScroll`, Esc gestito sul menu e fermato lì,
 *     focus restituito al trigger.
 */
function Dropdown({
  value,
  onChange,
  options,
  placeholder = 'Seleziona...',
  className = '',
  disabled = false,
  ariaLabel,
  id,
  // V40.2 — trigger compatto (stessa altezza dei campi INPUT_SM), per le
  // righe dense come la coda "Da sistemare" del Campus.
  compact = false
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPos(null);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  /** Calcola la posizione del menu rispetto al trigger e al viewport. */
  const place = useCallback(() => {
    const t = triggerRef.current;
    const l = listRef.current;
    if (!t || !l) return;
    const r = t.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Trigger uscito dallo schermo (scroll del contenitore): chiudere è
    // meglio che lasciare un menu sospeso nel vuoto.
    if (r.bottom < 0 || r.top > vh) {
      setOpen(false);
      setPos(null);
      return;
    }
    const maxW = Math.min(MAX_LIST_W, vw - EDGE * 2);
    const width = Math.min(Math.max(r.width, l.scrollWidth), Math.max(maxW, Math.min(r.width, vw - EDGE * 2)));
    const naturalH = Math.min(l.scrollHeight, MAX_LIST_H);
    const below = vh - r.bottom - EDGE;
    const above = r.top - EDGE;
    const openUp = below < Math.min(naturalH, 180) && above > below;
    const maxHeight = Math.max(120, Math.min(MAX_LIST_H, (openUp ? above : below) - 6));
    let left = r.left;
    if (left + width > vw - EDGE) left = Math.max(EDGE, vw - EDGE - width);
    setPos({
      left,
      width,
      maxHeight,
      top: openUp ? undefined : r.bottom + 6,
      bottom: openUp ? vh - r.top + 6 : undefined,
      openUp
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, options.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocPointerDown = (e) => {
      if (rootRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      close(false);
    };
    // `true` = fase di cattura: intercetta lo scroll di QUALUNQUE
    // contenitore, non solo della finestra — il <main> dell'app e il corpo
    // delle modali scorrono per conto proprio.
    const onScrollOrResize = () => place();
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('touchstart', onDocPointerDown, { passive: true });
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('touchstart', onDocPointerDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, place, close]);

  useEffect(() => {
    if (open && pos && listRef.current) listRef.current.focus({ preventScroll: true });
    // Solo alla prima posizione valida: rimettere il focus ad ogni scroll
    // interromperebbe la navigazione da tastiera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos !== null]);

  // L'opzione evidenziata resta visibile scorrendo con le frecce.
  useEffect(() => {
    if (!open || highlighted < 0 || !listRef.current) return;
    const el = listRef.current.children[highlighted];
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const idx = options.findIndex((o) => o.value === value);
    setHighlighted(idx >= 0 ? idx : 0);
    setOpen(true);
  }, [disabled, options, value]);

  const commit = useCallback(
    (val) => {
      onChange(val);
      close(true);
    },
    [onChange, close]
  );

  const handleTriggerKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) openMenu();
    }
  };

  const handleListKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlighted(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlighted(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (options[highlighted]) commit(options[highlighted].value);
    } else if (e.key === 'Escape') {
      // Fermato QUI: senza stopPropagation lo stesso Esc arriverebbe al
      // listener della modale su `window` e la chiuderebbe insieme al menu.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      // Il menu è in un portal in fondo al <body>: lasciare il Tab al
      // browser porterebbe il focus fuori dalla pagina. Si torna al
      // trigger, e il Tab successivo prosegue nell'ordine naturale.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };

  const list =
    open && typeof document !== 'undefined'
      ? createPortal(
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            onKeyDown={handleListKeyDown}
            style={
              pos
                ? { position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }
                : { position: 'fixed', left: -9999, top: 0, visibility: 'hidden', width: 'max-content', maxWidth: MAX_LIST_W }
            }
            className={`z-[70] overflow-y-auto overscroll-contain af-scroll bg-surface/95 backdrop-blur-2xl border border-secondary/30 rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] p-1.5 space-y-0.5 focus:outline-none ${
              pos ? 'af-dropdown-in' : ''
            } ${pos?.openUp ? 'origin-bottom' : 'origin-top'}`}
          >
            {options.length === 0 && (
              <li className="px-3 py-2 text-base text-slate-500 italic">Nessuna opzione disponibile.</li>
            )}
            {options.map((opt, i) => {
              const active = opt.value === value;
              const hl = i === highlighted;
              return (
                <li
                  key={opt.value === '' || opt.value == null ? `opt_${i}` : opt.value}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => commit(opt.value)}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-base cursor-pointer transition-colors duration-150 ${
                    active
                      ? 'bg-gradient-to-r from-secondary/25 to-secondary/5 text-white'
                      : hl
                      ? 'bg-white/5 text-white'
                      : 'text-slate-300'
                  }`}
                >
                  {/* V40.2 — `depth` rientra le voci di un albero (nodi
                      figli), `hint` aggiunge una riga secondaria. Entrambi
                      facoltativi: le opzioni esistenti non cambiano. */}
                  <span
                    className="min-w-0 break-words leading-snug"
                    style={opt.depth > 0 ? { paddingLeft: `${Math.min(opt.depth, 4) * 14}px` } : undefined}
                  >
                    {opt.label}
                    {opt.hint && <span className="block text-xs text-slate-500 mt-0.5">{opt.hint}</span>}
                  </span>
                  {active && <Icon name="check" className="w-4 h-4 shrink-0 text-secondary" />}
                </li>
              );
            })}
          </ul>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={selected ? String(selected.label) : undefined}
        className={`${compact ? INPUT_SM : INPUT} flex items-center justify-between gap-2 text-left disabled:opacity-50 disabled:cursor-not-allowed ${
          open ? 'border-primary ring-1 ring-primary' : ''
        }`}
      >
        <span className={`truncate ${selected ? 'text-slate-100' : 'text-slate-500'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon
          name="crosshair"
          className={`w-4 h-4 shrink-0 text-slate-500 transition-transform duration-300 ${open ? 'rotate-45 text-primary' : ''}`}
        />
      </button>
      {list}
    </div>
  );
}

export default memo(Dropdown);
