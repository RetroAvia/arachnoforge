import React, { useState, useEffect } from 'react';
import { Icon } from './Icons.jsx';
import { formatCountdown, formatDateOnlyHuman, msUntilDateOnlyMidnight } from '../utils/dateUtils.js';
import { CARD, CARD_ALERT } from '../utils/designSystem.js';

const TRAJECTORY_META = {
  GREEN: { label: 'IN TRAIETTORIA', color: 'text-emerald-400', chipBg: 'bg-emerald-900/40', glow: 'shadow-[0_0_16px_rgba(52,211,153,0.35)]' },
  YELLOW: { label: 'DERIVA RILEVATA', color: 'text-accent', chipBg: 'bg-accent/15', glow: 'shadow-accent-glow' },
  RED: { label: 'COLLISIONE IMMINENTE', color: 'text-primary', chipBg: 'bg-primary/15', glow: 'shadow-primary-glow' }
};

export default function DoomsdayClock({ nextExam, trajectory }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const meta = TRAJECTORY_META[trajectory] || TRAJECTORY_META.GREEN;

  if (!nextExam) {
    return (
      <div className={`${CARD} flex flex-col items-center justify-center text-center`}>
        <div className="w-14 h-14 rounded-xl bg-secondary/10 flex items-center justify-center text-secondary mb-3">
          <Icon name="target" className="w-7 h-7" />
        </div>
        <p className="text-base text-slate-400">Nessun esame pianificato. Apri un nodo nel Web-Matrix.</p>
      </div>
    );
  }

  const remaining = msUntilDateOnlyMidnight(nextExam.examDate);
  const cd = formatCountdown(remaining);
  const wrapperClass = trajectory === 'RED' ? CARD_ALERT : CARD;

  return (
    <div className={wrapperClass}>
      <div className="absolute inset-0 opacity-[0.05] pointer-events-none animate-scanline bg-gradient-to-b from-transparent via-white to-transparent h-1/3" />
      <div className="relative flex items-center justify-between mb-5 flex-wrap gap-2">
        <div>
          <p className="text-base text-slate-500 tracking-widest">DOOMSDAY CLOCK</p>
          <p className="text-lg font-semibold mt-0.5 text-white">{nextExam.nome}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{formatDateOnlyHuman(nextExam.examDate)}</p>
        </div>
        <span className={`text-[10px] font-mono px-3 py-1.5 rounded-full ${meta.color} ${meta.chipBg} ${meta.glow}`}>
          {meta.label}
        </span>
      </div>

      {cd.expired ? (
        <p className="relative text-3xl font-bold text-primary font-mono">T-0 — ESAME IN CORSO</p>
      ) : (
        <div className="relative grid grid-cols-4 gap-2.5 af-mono-nums">
          {[
            { v: cd.days, l: 'GG' },
            { v: cd.hours, l: 'HH' },
            { v: cd.minutes, l: 'MM' },
            { v: cd.seconds, l: 'SS' }
          ].map((u) => (
            <div key={u.l} className="bg-surface/80 border border-secondary/20 rounded-xl py-3.5 text-center">
              <p className={`text-3xl font-bold font-mono ${meta.color}`}>{String(u.v).padStart(2, '0')}</p>
              <p className="text-[10px] text-slate-500 mt-1 tracking-widest">{u.l}</p>
            </div>
          ))}
        </div>
        )}
    </div>
  );
}
