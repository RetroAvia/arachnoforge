import React, { useEffect, useRef } from 'react';
import { formatTimeHuman } from '../utils/dateUtils.js';

const TAG_COLORS = {
  INFO: 'text-slate-400',
  SUCCESS: 'text-emerald-400',
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

export default function CombatLog({ entries }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="bg-surface/85 backdrop-blur-xl border border-secondary/20 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col h-full relative">
      <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-secondary/10 blur-3xl pointer-events-none" />
      <div className="relative px-4 py-2.5 border-b border-secondary/15 flex items-center justify-between shrink-0">
        <span className="text-base font-mono tracking-widest text-slate-400">COMBAT LOG</span>
        <span className="text-[10px] font-mono text-slate-500">{entries.length}/50</span>
      </div>
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto af-scroll px-4 py-2 space-y-1 font-mono text-base">
        {entries.length === 0 && (
          <p className="text-slate-500 italic">In attesa di attività...</p>
        )}
        {entries.map((entry) => (
          <p key={entry.id} className="leading-relaxed">
            <span className="text-slate-500">[{formatTimeHuman(entry.timestamp)}]</span>{' '}
            <span className={TAG_COLORS[entry.tag] || 'text-slate-200'}>{entry.message}</span>
          </p>
        ))}
        <span className="af-cursor-blink text-secondary">▍</span>
      </div>
    </div>
  );
}
