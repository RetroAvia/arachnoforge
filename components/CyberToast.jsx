import React, { useEffect, useRef, useCallback } from 'react';
import { Icon } from './Icons.jsx';

/**
 * V41 — Notifiche in stile "premium": pannello pulito, barra di colore a
 * sinistra per il tipo, icona in un tondino tinto. Restano le regole
 * delle versioni precedenti: pausa del timer di chiusura sotto il
 * mouse, tetto alle notifiche visibili, contatore di quelle nascoste.
 * Novità: un'azione opzionale (per esempio "Annulla") e una durata su
 * misura, passate come terzo argomento di `pushToast`.
 */
const TYPE_META = {
  info: { icon: 'info', bar: 'bg-secondary', tile: 'bg-secondary/12 text-secondary' },
  success: { icon: 'check', bar: 'bg-emerald-400', tile: 'bg-emerald-400/12 text-emerald-300' },
  danger: { icon: 'alertTriangle', bar: 'bg-primary', tile: 'bg-primary/12 text-primary' },
  // V41 — avviso che non è un errore (es. "salvato qui, il Cloud ritenta").
  warning: { icon: 'cloudOff', bar: 'bg-accent', tile: 'bg-accent/12 text-accent' },
  levelup: { icon: 'star', bar: 'bg-accent', tile: 'bg-accent/12 text-accent' },
  trophy: { icon: 'trophy', bar: 'bg-fuchsia-400', tile: 'bg-fuchsia-400/12 text-fuchsia-300' }
};

const AUTO_DISMISS_MS = 5000;

function ToastCard({ toast, onDismiss }) {
  const meta = TYPE_META[toast.type] || TYPE_META.info;
  const timeoutRef = useRef(null);
  const duration = Number.isFinite(toast.duration) && toast.duration > 0 ? toast.duration : AUTO_DISMISS_MS;

  const scheduleDismiss = useCallback(
    (ms) => {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => onDismiss(toast.id), ms);
    },
    [onDismiss, toast.id]
  );

  useEffect(() => {
    scheduleDismiss(duration);
    return () => clearTimeout(timeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <div
      onMouseEnter={() => clearTimeout(timeoutRef.current)}
      onMouseLeave={() => scheduleDismiss(duration)}
      className="relative w-full sm:w-[360px] overflow-hidden rounded-xl border border-line-strong bg-panel/95 backdrop-blur-xl shadow-pop animate-[toastIn_0.28s_ease-out]"
    >
      <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${meta.bar}`} aria-hidden="true" />
      <div className="flex items-start gap-3 pl-4 pr-2.5 py-3">
        <span className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${meta.tile}`}>
          <Icon name={meta.icon} className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[13.5px] leading-snug text-slate-100 break-words">{toast.message}</p>
          {toast.action && typeof toast.action.onClick === 'function' && (
            <button
              type="button"
              onClick={() => {
                toast.action.onClick();
                onDismiss(toast.id);
              }}
              className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-secondary hover:text-white transition-colors"
            >
              {toast.action.label || 'Annulla'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="ds-icon-btn !w-7 !h-7 shrink-0"
          aria-label="Chiudi notifica"
        >
          <Icon name="close" className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

const MAX_VISIBLE_TOASTS = 4;

export default function CyberToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  const visibili = toasts.slice(-MAX_VISIBLE_TOASTS);
  const nascosti = toasts.length - visibili.length;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:bottom-5 z-[90] flex flex-col gap-2 items-stretch sm:items-end pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {nascosti > 0 && (
        <div className="pointer-events-none self-stretch sm:self-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-panel/95 border border-line px-3 py-1 text-[11px] text-slate-400">
            +{nascosti} {nascosti === 1 ? 'altra notifica' : 'altre notifiche'}
          </span>
        </div>
      )}
      {visibili.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
