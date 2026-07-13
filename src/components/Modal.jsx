import React, { useEffect, useRef, useId } from 'react';
import { Icon } from './Icons.jsx';
import { CARD_NOPAD } from '../utils/designSystem.js';

/**
 * V34.0 — "God-Tier Pass" (Accessibilita' + Mobile Hardening).
 *
 * Tre correzioni mirate, nessun cambio di comportamento visibile per chi
 * non ne ha bisogno:
 *  1. Scroll-lock del `<body>` finche' la modale e' aperta — su mobile lo
 *     sfondo poteva continuare a scorrere "sotto" l'overlay al touch.
 *  2. Focus spostato sul pulsante di chiusura all'apertura e restituito
 *     all'elemento che l'aveva innescata alla chiusura (Escape, click
 *     esterno o "X") — essenziale per la navigazione da tastiera/screen
 *     reader, che altrimenti perdeva il focus nel vuoto del documento.
 *  3. `role="dialog"` + `aria-modal` + `aria-labelledby` reale, cosi' uno
 *     screen reader annuncia correttamente titolo e natura modale invece
 *     di un generico `<div>`.
 */
export default function Modal({ open, onClose, title, children, maxWidth = 'max-w-md' }) {
  const closeBtnRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Scroll-lock: applica la classe SOLO mentre questa specifica modale e'
  // montata/aperta, e la rimuove alla chiusura/unmount — sicuro anche se
  // piu' modali si susseguono nello stesso punto della UI.
  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('af-modal-open');
    return () => {
      document.body.classList.remove('af-modal-open');
    };
  }, [open]);

  // Gestione del focus: alla comparsa, memorizza l'elemento attivo (il
  // bottone che ha aperto la modale) e sposta il focus sul tasto di
  // chiusura; alla scomparsa, lo restituisce — mai un focus perso nel
  // documento dopo la chiusura di una modale.
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    const raf = requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="absolute inset-0 bg-surface/80 backdrop-blur-md" onClick={onClose} />
      <div className={`relative w-full ${maxWidth} ${CARD_NOPAD} shadow-2xl af-scroll max-h-[85vh] overflow-y-auto`}>
        {/* Bagliore atmosferico d'ambiente dietro l'header, mai uno sfondo piatto. */}
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-secondary/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-secondary/20 sticky top-0 bg-surface/90 backdrop-blur-2xl">
          <h3 id={titleId} className="font-bold tracking-wide text-base bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 truncate min-w-0">
            {title}
          </h3>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-primary transition-all duration-300 hover:rotate-90 shrink-0"
            aria-label="Chiudi"
          >
            <Icon name="close" className="w-6 h-6" />
          </button>
        </div>
        <div className="relative p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
