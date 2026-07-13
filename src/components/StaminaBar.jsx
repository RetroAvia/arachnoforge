import React from 'react';
import { Icon } from './Icons.jsx';
import { FATIGUE_STAMINA_THRESHOLD } from '../utils/xpEngine.js';

export default function StaminaBar({ stamina, compact = false }) {
  const fatigued = stamina < FATIGUE_STAMINA_THRESHOLD;
  const barGradient = fatigued
    ? 'bg-gradient-to-r from-accent to-primary'
    : stamina > 60
    ? 'bg-gradient-to-r from-secondary to-secondary-dark'
    : 'bg-gradient-to-r from-accent to-accent/70';

  return (
    <div className={fatigued ? 'saturate-50 opacity-90' : ''}>
      <div className="flex items-center justify-between mb-2">
        <span className={`flex items-center gap-1.5 text-base font-semibold tracking-wide ${fatigued ? 'text-accent' : 'text-secondary'}`}>
          <Icon name="drop" className="w-5 h-5" />
          STAMINA MENTALE
        </span>
        <span className="text-base font-mono af-mono-nums text-slate-100">{Math.round(stamina)}%</span>
      </div>
      <div
        className={`w-full rounded-full bg-surface/80 border border-secondary/20 overflow-hidden ${compact ? 'h-2.5' : 'h-3.5'}`}
      >
        <div
          className={`h-full ${barGradient} transition-all duration-500 ${fatigued ? 'shadow-accent-glow' : 'shadow-secondary-glow'}`}
          style={{ width: `${Math.max(0, Math.min(100, stamina))}%` }}
        />
      </div>
      {fatigued && (
        <p className="text-[10px] text-accent mt-1.5 tracking-wide">
          FATIGUE ATTIVA — XP dimezzati finché la Stamina resta sotto {FATIGUE_STAMINA_THRESHOLD}%.
        </p>
      )}
    </div>
  );
}
