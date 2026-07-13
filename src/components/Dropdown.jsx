import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Icon } from './Icons.jsx';
import { INPUT } from '../utils/designSystem.js';

/**
 * Dropdown — select custom in stile HUD "Stark Tech", sostituto drop-in del
 * <select> nativo del browser (bandito dal Design System: mai stili
 * nativi). Il trigger riusa esattamente la ricetta Form Input/Select del
 * Design System; il menu a comparsa è un pannello in vetro tecnologico con
 * bordo Blu Elettrico, mai un riquadro piatto.
 *
 * Totalmente accessibile da tastiera (Frecce/Home/End/Invio/Esc), si
 * chiude al click esterno o su Escape.
 */
function Dropdown({ value, onChange, options, placeholder = 'Seleziona...', className = '', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;

  useEffect(() => {
    if (!open) return undefined;
    const onDocPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && listRef.current) listRef.current.focus();
  }, [open]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const idx = options.findIndex((o) => o.value === value);
    setHighlighted(idx >= 0 ? idx : 0);
    setOpen(true);
  }, [disabled, options, value]);

  const commit = useCallback((val) => {
    onChange(val);
    setOpen(false);
  }, [onChange]);

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
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${INPUT} flex items-center justify-between gap-2 text-left ${open ? 'border-primary ring-1 ring-primary' : ''}`}
      >
        <span className={`truncate ${selected ? 'text-slate-100' : 'text-slate-500'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon
          name="crosshair"
          className={`w-4 h-4 shrink-0 text-slate-500 transition-transform duration-300 ${open ? 'rotate-45 text-primary' : ''}`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          className="absolute z-30 mt-2 w-full max-h-64 overflow-y-auto af-scroll bg-surface/90 backdrop-blur-2xl border border-secondary/25 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.55)] p-1.5 space-y-0.5 af-dropdown-in focus:outline-none"
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
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-base cursor-pointer transition-all duration-150 ${
                  active
                    ? 'bg-gradient-to-r from-secondary/25 to-secondary/5 text-white'
                    : hl
                    ? 'bg-white/5 text-white'
                    : 'text-slate-400'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {active && <Icon name="check" className="w-4 h-4 shrink-0 text-secondary" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default memo(Dropdown);
