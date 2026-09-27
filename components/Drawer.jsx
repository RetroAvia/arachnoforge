import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';
import { useOverlayLayer } from './Modal.jsx';

const TRANSITION_MS = 300;

/**
 * V39.0 — Pannello laterale condiviso (Spider-Sense, Blueprint).
 *
 * I due drawer dell'app erano disegnati dentro la pagina: con un antenato
 * dotato di `backdrop-filter` o `transform` il `position: fixed` smetteva
 * di essere relativo allo schermo e il pannello scorreva via con la
 * pagina. Mancavano anche Esc, `role="dialog"` e la gestione del focus.
 * Qui tutto in un posto solo: portal su `document.body`, stessa pila di
 * Esc/Tab delle modali, focus sul tasto di chiusura e restituito alla
 * chiusura, e animazione d'ingresso/uscita reale (prima il pannello
 * compariva già aperto, senza scorrere).
 */
export default function Drawer({ open, onClose, eyebrow, title, subtitle, children, eyebrowClassName = 'text-accent' }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef(null);
  const closeBtnRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => clearTimeout(t);
  }, [open]);

  useOverlayLayer({ open: open && mounted, onClose, panelRef, initialFocusRef: closeBtnRef });

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        className={`absolute inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`absolute top-0 right-0 h-full w-full max-w-md bg-panel border-l border-line-strong shadow-pop flex flex-col transition-transform duration-300 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 pl-5 sm:pl-6 pr-3 py-4 border-b border-line">
          <div className="min-w-0">
            {eyebrow && <p className={`ds-eyebrow ${eyebrowClassName}`}>{eyebrow}</p>}
            <p id={titleId} className="ds-h2 mt-1 break-words">
              {title}
            </p>
            {subtitle && <p className="text-sm text-slate-400 mt-0.5 break-words">{subtitle}</p>}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="ds-icon-btn shrink-0"
            aria-label="Chiudi"
          >
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
