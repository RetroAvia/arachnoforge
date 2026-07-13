import React, { useEffect } from 'react';
import { Icon } from './Icons.jsx';
import { CARD_NOPAD } from '../utils/designSystem.js';

export default function Modal({ open, onClose, title, children, maxWidth = 'max-w-md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-surface/80 backdrop-blur-md" onClick={onClose} />
      <div className={`relative w-full ${maxWidth} ${CARD_NOPAD} shadow-2xl af-scroll max-h-[85vh] overflow-y-auto`}>
        {/* Bagliore atmosferico d'ambiente dietro l'header, mai uno sfondo piatto. */}
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-secondary/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-secondary/20 sticky top-0 bg-surface/90 backdrop-blur-2xl">
          <h3 className="font-bold tracking-wide text-base bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-primary transition-all duration-300 hover:rotate-90"
            aria-label="Chiudi"
          >
            <Icon name="close" className="w-6 h-6" />
          </button>
        </div>
        <div className="relative p-6">{children}</div>
      </div>
    </div>
  );
}
