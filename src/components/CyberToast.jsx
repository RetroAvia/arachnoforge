import React, { useEffect } from 'react';
import { Icon } from './Icons.jsx';

const TYPE_META = {
  info: { icon: 'radar', border: 'border-secondary/40', bg: 'bg-secondary/10', text: 'text-secondary', glow: 'shadow-secondary-glow' },
  success: { icon: 'check', border: 'border-emerald-400/40', bg: 'bg-emerald-400/10', text: 'text-emerald-400', glow: 'shadow-[0_0_16px_rgba(52,211,153,0.4)]' },
  danger: { icon: 'alertTriangle', border: 'border-primary/40', bg: 'bg-primary/10', text: 'text-primary', glow: 'shadow-primary-glow' },
  levelup: { icon: 'bolt', border: 'border-accent/40', bg: 'bg-accent/10', text: 'text-accent', glow: 'shadow-accent-glow' },
  trophy: { icon: 'trophy', border: 'border-fuchsia-400/40', bg: 'bg-fuchsia-400/10', text: 'text-fuchsia-400', glow: 'shadow-[0_0_16px_rgba(232,121,249,0.4)]' }
};

const AUTO_DISMISS_MS = 4500;

function ToastCard({ toast, onDismiss }) {
  const meta = TYPE_META[toast.type] || TYPE_META.info;

  useEffect(() => {
    const id = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`relative w-72 bg-surface/90 backdrop-blur-2xl rounded-2xl px-4 py-3.5 flex items-start gap-3 font-mono border ${meta.border} shadow-[0_8px_28px_rgba(0,0,0,0.5)] ${meta.glow} animate-[toastIn_0.35s_ease-out] overflow-hidden`}
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

export default function CyberToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2.5 items-end pointer-events-none">
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(24px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
