import React, { useState, useEffect } from 'react';
import { Icon } from './Icons.jsx';
import { formatCountdown, formatDateOnlyHuman, msUntilDateOnlyMidnight } from '../utils/dateUtils.js';
import { CARD, CARD_ALERT } from '../utils/designSystem.js';

/**
 * Doomsday Clock — conto alla rovescia al prossimo esame. V41: stesso
 * dato, disegno pulito (quattro caselle numeriche, stato della
 * traiettoria in un badge) e un tick al secondo solo mentre la card è
 * sullo schermo.
 */
const TRAJECTORY_META = {
  GREEN: { label: 'In traiettoria', badge: 'ds-badge ds-badge-green', num: 'text-white' },
  YELLOW: { label: 'Deriva rilevata', badge: 'ds-badge ds-badge-amber', num: 'text-accent' },
  RED: { label: 'Collisione imminente', badge: 'ds-badge ds-badge-red', num: 'text-primary' }
};

export default function DoomsdayClock({ nextExam, trajectory }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!nextExam) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [nextExam]);

  const meta = TRAJECTORY_META[trajectory] || TRAJECTORY_META.GREEN;

  if (!nextExam) {
    return (
      <div className={`${CARD} flex items-center gap-3`}>
        <span className="ds-icon-tile text-slate-400">
          <Icon name="target" className="w-[18px] h-[18px]" />
        </span>
        <div>
          <p className="ds-eyebrow">Doomsday Clock</p>
          <p className="text-sm text-slate-400 mt-0.5">Nessun esame in calendario. Dai una data a una materia nel Web-Matrix.</p>
        </div>
      </div>
    );
  }

  const remaining = msUntilDateOnlyMidnight(nextExam.examDate);
  const cd = formatCountdown(remaining);
  const wrapperClass = trajectory === 'RED' ? CARD_ALERT : CARD;

  return (
    <div className={wrapperClass}>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`ds-icon-tile ${trajectory === 'RED' ? 'text-primary' : 'text-slate-300'}`}>
            <Icon name="clock" className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="ds-eyebrow">Doomsday Clock · prossimo esame</p>
            <p className="text-[15px] font-semibold text-white truncate mt-0.5">{nextExam.nome}</p>
            <p className="text-xs text-slate-500">{formatDateOnlyHuman(nextExam.examDate)}</p>
          </div>
        </div>
        <span className={meta.badge}>{meta.label}</span>
      </div>

      {cd.expired ? (
        <p className="text-2xl font-bold text-primary">Esame in corso</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 ds-num">
          {[
            { v: cd.days, l: 'giorni' },
            { v: cd.hours, l: 'ore' },
            { v: cd.minutes, l: 'minuti' },
            { v: cd.seconds, l: 'secondi' }
          ].map((u) => (
            <div key={u.l} className="ds-well py-2.5 text-center">
              <p className={`text-2xl sm:text-[28px] leading-none font-bold font-mono ${meta.num}`}>{String(u.v).padStart(2, '0')}</p>
              <p className="text-[11px] text-slate-500 mt-1.5">{u.l}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
