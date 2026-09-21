import React, { useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';
import { CARD_NOPAD } from '../utils/designSystem.js';

/** Selettore degli elementi realisticamente "raggiungibili da Tab" dentro la modale — stesso set usato dal focus trap qui sotto. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * V39.0 — Pila delle modali aperte, a livello di modulo.
 *
 * Due modali possono essere aperte insieme (per esempio "Modifiche non
 * salvate" sopra l'editor di un nodo). Prima ascoltavano ENTRAMBE Tab
 * ed Esc su `window`: la modale sotto intercettava il Tab della modale
 * sopra e lo riportava su "Chiudi", quindi da tastiera "Annulla" e
 * "Scarta modifiche" erano irraggiungibili, e un solo Esc le chiudeva
 * tutte e due. Ora ogni modale si registra qui all'apertura e risponde
 * ai tasti solo se è in cima.
 */
const modalStack = [];

/** Livello in cima: priorità più alta, a parità il più recente. Il
 * dialogo di conflitto Cloud (priorità alta, z-[95]) resta in cima anche
 * se un altro livello si apre dopo di lui — l'ordine della tastiera
 * coincide con quello che si vede. */
function topOfStack() {
  let top = null;
  for (let i = modalStack.length - 1; i >= 0; i -= 1) {
    const t = modalStack[i];
    if (!top || t.priority > top.priority) top = t;
  }
  return top;
}

/**
 * Finestra modale dell'app.
 *
 * V39.0 — Due difetti strutturali corretti, entrambi segnalati dall'uso
 * reale:
 *
 *  1. PORTAL. La modale veniva disegnata DENTRO la pagina che la apriva.
 *     `position: fixed` è relativo al viewport solo se nessun antenato ha
 *     `transform`, `filter` o `backdrop-filter`: basta uno di questi (e
 *     l'app ne ha parecchi, fra card in vetro, animazioni d'ingresso e il
 *     segnale di fatica) perché l'overlay diventi relativo a quell'antenato
 *     invece che allo schermo. Il sintomo era una striscia di pagina
 *     nitida sopra la sfocatura. Ora la modale vive direttamente in
 *     `document.body`, dove nessun antenato può catturarla.
 *
 *  2. HEADER FUORI DALLO SCROLL. L'header era `sticky` dentro lo stesso
 *     contenitore che scorreva, e senza z-index: gli elementi posizionati
 *     del contenuto, venendo dopo nel DOM, gli venivano disegnati SOPRA.
 *     Scorrendo, "Nome nodo" e "Obiettivo" si sovrapponevano al titolo e
 *     la X restava visibile in trasparenza ma il click finiva sul campo
 *     sotto. Ora il pannello è una colonna: header fisso in alto, e solo
 *     il corpo scorre. Il titolo non può più essere coperto perché non è
 *     più nello stesso spazio del contenuto.
 *
 * Invariati: focus trap (WAI-ARIA Dialog), focus restituito all'elemento
 * che ha aperto la modale, `role`/`aria-modal`/`aria-labelledby`.
 */
/**
 * V39.0 — Comportamento condiviso da ogni livello sovrapposto dell'app
 * (Modal, Drawer, overlay a schermo intero): registrazione nella pila,
 * Esc solo per il livello in cima, focus trap su Tab, focus iniziale e
 * focus restituito all'elemento che aveva aperto il livello.
 *
 * `onClose` può essere null (overlay che non si chiudono con Esc, come
 * Last Stand o una sessione Sensory Zero): il livello resta comunque in
 * pila, così Esc non arriva alle modali sotto.
 */
export function useOverlayLayer({ open, onClose, panelRef, initialFocusRef, priority = 0 }) {
  const tokenRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const token = { priority };
    tokenRef.current = token;
    modalStack.push(token);
    return () => {
      const i = modalStack.indexOf(token);
      if (i >= 0) modalStack.splice(i, 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (topOfStack() !== tokenRef.current) return;
      if (e.key === 'Escape') {
        if (typeof onCloseRef.current === 'function') {
          e.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      const panel = panelRef?.current;
      if (e.key !== 'Tab' || !panel) return;
      const focusables = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, panelRef]);

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    const raf = requestAnimationFrame(() => {
      // Un livello che si apre SOTTO uno di priorità più alta (per
      // esempio mentre è aperto il dialogo di conflitto Cloud) non si
      // prende il focus: resterebbe nascosto dietro l'altro.
      if (topOfStack() !== tokenRef.current) return;
      const target = initialFocusRef?.current || panelRef?.current?.querySelector(FOCUSABLE_SELECTOR);
      target?.focus?.({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus({ preventScroll: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export default function Modal({ open, onClose, title, children, maxWidth = 'max-w-md', role = 'dialog' }) {
  const closeBtnRef = useRef(null);
  const panelRef = useRef(null);
  const titleId = useId();

  useOverlayLayer({ open, onClose, panelRef, initialFocusRef: closeBtnRef });

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="absolute inset-0 bg-surface/80 backdrop-blur-md" onClick={onClose} />
      <div
        ref={panelRef}
        className={`relative w-full ${maxWidth} ${CARD_NOPAD} shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[88vh]`}
      >
        {/* Bagliore atmosferico d'ambiente dietro l'header. */}
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-secondary/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-secondary/20 bg-surface/95">
          <h3
            id={titleId}
            className="font-bold tracking-wide text-base leading-snug bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 line-clamp-2 break-words min-w-0"
          >
            {title}
          </h3>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="-mr-2 w-10 h-10 flex items-center justify-center rounded-xl text-slate-500 hover:text-primary hover:bg-white/[0.04] transition-all duration-300 shrink-0"
            aria-label="Chiudi"
          >
            <Icon name="close" className="w-6 h-6" />
          </button>
        </div>
        <div className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain af-scroll p-4 sm:p-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}
