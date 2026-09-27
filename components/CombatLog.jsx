import React, { useEffect, useRef } from 'react';
import { formatTimeHuman } from '../utils/dateUtils.js';

const TAG_COLORS = {
  INFO: 'text-slate-400',
  SUCCESS: 'text-emerald-300',
  DANGER: 'text-primary',
  FOCUS: 'text-secondary',
  OVERDRIVE: 'text-primary',
  REFUEL: 'text-secondary',
  BOUNTY: 'text-accent',
  TROPHY: 'text-accent',
  HUB: 'text-secondary',
  SHOP: 'text-accent',
  CONFIG: 'text-slate-400',
  SYSTEM: 'text-slate-400',
  CARNAGE: 'text-primary',
  SPIDERSENSE: 'text-secondary'
};

/** Registro degli eventi (Combat Log): gli ultimi 50, i più recenti in fondo. */
export default function CombatLog({ entries }) {
  const scrollRef = useRef(null);
  const list = Array.isArray(entries) ? entries : [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries]);

  return (
    <div className="ds-well overflow-hidden flex flex-col h-full">
      <div className="px-3.5 py-2 border-b border-line flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-slate-400">Combat Log</span>
        <span className="text-[11px] text-slate-500 ds-num">{list.length}/50</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto af-scroll px-3.5 py-2 space-y-1 font-mono text-[12px]">
        {list.length === 0 && <p className="text-slate-500 italic">Nessun evento ancora.</p>}
        {list.map((entry, i) => (
          <p key={entry.id || `${entry.timestamp}-${i}`} className="leading-relaxed">
            <span className="text-slate-600">[{formatTimeHuman(entry.timestamp)}]</span>{' '}
            <span className={TAG_COLORS[entry.tag] || 'text-slate-200'}>{entry.message}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
