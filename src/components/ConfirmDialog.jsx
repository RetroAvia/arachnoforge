import React from 'react';
import Modal from './Modal.jsx';
import { Icon } from './Icons.jsx';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_GHOST } from '../utils/designSystem.js';

export default function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Conferma', danger = true }) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-sm">
      <div className="flex items-start gap-3 mb-6">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'}`}>
          <Icon name="alertTriangle" className="w-6 h-6" />
        </div>
        <p className="text-base text-slate-300 leading-relaxed pt-1.5">{message}</p>
      </div>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_GHOST}>
          Annulla
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={danger ? BTN_PRIMARY : BTN_SECONDARY}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
