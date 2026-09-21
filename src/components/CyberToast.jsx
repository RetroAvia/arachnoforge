import React, { useEffect, useRef, useCallback } from 'react';
import { Icon } from './Icons.jsx';

const TYPE_META = {
  info: { icon: 'radar', border: 'border-secondary/40', bg: 'bg-secondary/10', text: 'text-secondary', glow: 'shadow-secondary-glow' },
  success: { icon: 'check', border: 'border-emerald-400/40', bg: 'bg-emerald-400/10', text: 'text-emerald-400', glow: 'shadow-[0_0_16px_rgba(52,211,153,0.4)]' },
  danger: { icon: 'alertTriangle', border: 'border-primary/40', bg: 'bg-primary/10', text: 'text-primary', glow: 'shadow-primary-glow' },
  levelup: { icon: 'bolt', border: 'border-accent/40', bg: 'bg-accent/10', text: 'text-accent', glow: 'shadow-accent-glow' },
  trophy: { icon: 'trophy', border: 'border-fuchsia-400/40', bg: 'bg-fuchsia-400/10', text: 'text-fuchsia-400', glow: 'shadow-[0_0_16px_rgba(232,121,249,0.4)]' }
};

const AUTO_DISMISS_MS = 4500;

/**
 * V34.0 — "God-Tier Pass": auto-dismiss ora in PAUSA mentre il mouse è
 * sopra la card (e riparte da capo al mouseleave/blur) — prima un toast
 * lungo che l'utente si fermava a leggere spariva comunque sotto al
 * cursore, un difetto reale specialmente per i messaggi di Karen più
 * lunghi. Su touch (niente hover) il comportamento resta invariato.
 */
function ToastCard({ toast, onDismiss }) {
  const meta = TYPE_META[toast.type] || TYPE_META.info;
  const timeoutRef = useRef(null);

  const scheduleDismiss = useCallback((ms) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onDismiss(toast.id), ms);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    scheduleDismiss(AUTO_DISMISS_MS);
    return () => clearTimeout(timeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <div
      onMouseEnter={() => clearTimeout(timeoutRef.current)}
      onMouseLeave={() => scheduleDismiss(AUTO_DISMISS_MS)}
      className={`relative w-full sm:w-72 bg-surface/90 backdrop-blur-2xl rounded-2xl px-4 py-3.5 flex items-start gap-3 font-mono border ${meta.border} shadow-[0_8px_28px_rgba(0,0,0,0.5)] ${meta.glow} animate-[toastIn_0.35s_ease-out] overflow-hidden`}
    >
      <div className={`absolute inset-0 pointer-events-none ${meta.bg}`} />
      <Icon name={meta.icon} className={`relative w-6 h-6 shrink-0 mt-0.5 ${meta.text}`} />
      <p className="relative text-base leading-relaxed text-slate-200 flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="relative text-slate-500 hover:text-white transition-all duration-300 shrink-0"
        aria-label="Chiudi notifica"
      >
        <Icon name="close" className="w-5 h-5" />
      </button>
    </div>
  );
}

/**
 * V37.0 — Tetto ai toast visibili contemporaneamente.
 *
 * `pushToast` non aveva alcun limite: una raffica reale — più trofei
 * sbloccati insieme, un level-up con Daily Patrol completata e Spider-
 * Sense Surge nello stesso istante — impilava sei o sette card fino a
 * coprire mezzo schermo, proprio nel momento in cui c'è più da
 * festeggiare e meno da leggere. Si mostrano le più RECENTI (le altre
 * sono già state lette o stanno per scadere da sole) e si dichiara
 * quante ne restano, invece di nasconderle in silenzio.
 */
const MAX_VISIBLE_TOASTS = 4;

export default function CyberToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  const visibili = toasts.slice(-MAX_VISIBLE_TOASTS);
  const nascosti = toasts.length - visibili.length;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-[80] flex flex-col gap-2.5 items-stretch sm:items-end pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {nascosti > 0 && (
        <div className="pointer-events-none self-stretch sm:self-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/90 backdrop-blur-lg border border-white/15 px-3 py-1 text-[11px] font-mono text-slate-400">
            +{nascosti} altre notifiche
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
