import React, { useState } from 'react';
import { Icon } from './Icons.jsx';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { ROUTES } from '../hooks/useArachnoForgeRouter.js';
import { BADGE } from '../utils/designSystem.js';

const NAV_ITEMS = [
  { route: ROUTES.MISSION_CONTROL, label: 'Stark-Web Terminal', icon: 'terminal' },
  { route: ROUTES.QUADRANT_HUB, label: 'The Web-Matrix', icon: 'web' },
  { route: ROUTES.BOSS_FIGHT, label: 'Sinister Six Simulator', icon: 'crosshair' },
  { route: ROUTES.STAR_LOG, label: 'Daily Bugle Archives', icon: 'newspaper' },
  { route: ROUTES.ARMORY, label: 'Suit Lab & Trophies', icon: 'flask' },
  { route: ROUTES.MULTIVERSE_SIMULATOR, label: 'Multiverse Simulator', icon: 'multiverse' },
  { route: ROUTES.CORE_CONFIG, label: 'Karen OS Settings', icon: 'chip' }
];

const TRAJECTORY_BADGE = {
  GREEN: BADGE.green,
  YELLOW: BADGE.amber,
  RED: BADGE.red
};

/** V26.0 — Pillar 4 (Cloud Sync UI): micro-HUD di stato, 3 varianti — mai un semplice testo nudo.
 * V28.1 — Pillar 2: la variante "synced" ora si adatta al `storageMode`
 * (Cloud reale / Guest locale / Sandbox Admin locale) — mai un "Connesso
 * al Nexus" fuorviante quando i dati non stanno affatto raggiungendo il
 * Cloud. `loading`/`syncing`/`error` restano invarianti sul backend. */
const SYNC_META_BASE = {
  loading: { icon: 'cloud', label: 'Sincronizzazione...', className: 'text-accent border-accent/30 bg-accent/10', spin: true },
  syncing: { icon: 'cloud', label: 'Sincronizzazione...', className: 'text-accent border-accent/30 bg-accent/10', spin: true },
  error: { icon: 'cloudOff', label: 'Nexus disconnesso', className: 'text-primary border-primary/40 bg-primary/10', spin: false, blink: true }
};
const SYNCED_META_BY_MODE = {
  cloud: { icon: 'cloudCheck', label: 'Connesso al Nexus', className: 'text-emerald-400 border-emerald-400/30 bg-emerald-900/20' },
  guest: { icon: 'user', label: 'Modalità Ospite (Locale)', className: 'text-slate-300 border-white/20 bg-white/[0.04]' },
  sandbox: { icon: 'chip', label: 'Sandbox Admin (Locale)', className: 'text-fuchsia-300 border-fuchsia-400/40 bg-fuchsia-500/10' }
};

function getSyncMeta(syncStatus, storageMode) {
  if (syncStatus === 'synced') return { ...SYNCED_META_BY_MODE[storageMode] || SYNCED_META_BY_MODE.cloud, spin: false, blink: false };
  return SYNC_META_BASE[syncStatus] || SYNC_META_BASE.loading;
}

export default function Sidebar({ currentPage, navigate }) {
  const { state, derived, sensoryZero, syncStatus, storageMode } = useArachnoForge();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (sensoryZero) return null;

  const { profile } = state;
  const xpPct = derived.xpPct ?? 0;
  const rankMeta = derived.rankMeta || { textClass: 'text-secondary', glowClass: '' };
  const syncMeta = getSyncMeta(syncStatus, storageMode);

  const handleNavigate = (route) => {
    navigate(route);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Hamburger mobile */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-40 p-2.5 rounded-xl bg-surface/80 backdrop-blur-2xl border border-secondary/25 text-slate-200 hover:border-secondary/60 hover:text-secondary transition-all duration-300 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        aria-label="Apri menu"
      >
        <Icon name="menu" className="w-7 h-7" />
      </button>

      {/* Overlay mobile */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-surface/80 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`
          fixed md:sticky top-0 left-0 h-[100dvh] w-[270px] shrink-0 z-50
          bg-surface/85 backdrop-blur-2xl border-r border-secondary/15 flex flex-col relative
          transition-transform duration-300
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        `}
      >
        {/* Bagliore d'ambiente in cima alla colonna — mai un pannello piatto. */}
        <div className="absolute -top-24 -left-16 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

        <div className="relative flex items-center justify-between px-5 py-5 border-b border-secondary/15">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white shadow-primary-glow border-t border-white/20">
              <Icon name="target" className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold tracking-widest text-base leading-none bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                ARACHNOFORGE
              </p>
              <p className="text-[10px] text-slate-500 tracking-wider mt-1">KAREN OS // WEB-PATH ENGINE v26.0</p>
              {/* Cloud Sync Status — micro-HUD (Pillar 4). */}
              <div className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-mono tracking-wide w-fit ${syncMeta.className} ${syncMeta.blink ? 'af-sync-error' : ''}`}>
                <Icon name={syncMeta.icon} className={`w-3 h-3 ${syncMeta.spin ? 'af-cloud-syncing' : ''}`} />
                {syncMeta.label}
              </div>
              {/* V27.0 — Pillar 3: chip Maximum Carnage, sempre visibile
                  (anche nel drawer mobile) mentre la finestra è attiva. */}
              {derived.isMaxCarnageActive && (
                <div className="af-carnage-pulse mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-primary/60 bg-primary/15 text-primary px-2 py-0.5 text-[9px] font-mono tracking-wide w-fit">
                  <Icon name="skull" className="w-3 h-3" />
                  CARNAGE ATTIVO
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-slate-500 hover:text-white transition-all duration-300"
            aria-label="Chiudi menu"
          >
            <Icon name="close" className="w-6 h-6" />
          </button>
        </div>

        <div className="relative px-5 py-4 border-b border-secondary/15">
          <div className="flex items-baseline justify-between">
            <span className="text-base text-slate-400">{profile.username}</span>
            <span className={BADGE.blue}>LV.{profile.level}</span>
          </div>
          {/* V25.0 — Dynamic Titles Engine: il titolo di rango cambia
              tinta/glow/animazione in base alla banda di livello (vedi
              RANK_TIERS in xpEngine.js). Il rango Lv.50+ usa un gradiente
              animato via CSS (animate-gradient-shift) — mai un testo
              statico per il traguardo più alto del gioco. */}
          <p
            className={`text-base font-bold tracking-wide mt-1.5 ${rankMeta.textClass} ${rankMeta.glowClass}`}
          >
            {derived.rankTitle}
          </p>
          <div className="mt-2.5 h-2 rounded-full bg-surface/80 border border-secondary/20 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-secondary to-secondary-dark shadow-secondary-glow transition-all duration-500"
              style={{ width: `${xpPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] font-mono text-slate-500 af-mono-nums">
              {profile.currentXp} / {derived.xpNeeded} XP
            </span>
            <span className="text-[10px] font-mono text-accent flex items-center gap-1">
              <Icon name="flame" className="w-4 h-4" />
              {profile.streak}
            </span>
          </div>
          {/* Tech Token counter (V25.0, Pillar 3) — sempre visibile, invita
              a controllare lo Skill Tree in Suit Lab & Trophies appena si
              accumula un token. */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-accent/10 border border-accent/25 px-2.5 py-1.5">
            <span className="text-[10px] tracking-widest text-accent/90 flex items-center gap-1.5">
              <Icon name="chip" className="w-3.5 h-3.5" />
              TECH TOKEN
            </span>
            <span className="text-sm font-mono font-bold text-accent af-mono-nums">{profile.techTokens || 0}</span>
          </div>
        </div>

        <nav className="relative flex-1 overflow-y-auto af-scroll px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = currentPage === item.route;
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => handleNavigate(item.route)}
                className={`
                  group w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-base
                  transition-all duration-300 border
                  ${active
                    ? 'bg-gradient-to-r from-primary/15 to-transparent border-primary/40 text-white shadow-primary-glow'
                    : 'border-transparent text-slate-400 hover:text-white hover:bg-white/[0.04]'}
                `}
              >
                <Icon
                  name={item.icon}
                  className={`w-6 h-6 group-hover:scale-110 transition-transform duration-300 ${active ? 'text-primary' : ''}`}
                />
                <span className="tracking-wide">{item.label}</span>
                {item.route === ROUTES.QUADRANT_HUB && derived.upcomingReviews.length > 0 && (
                  <span className="ml-auto w-2.5 h-2.5 rounded-full bg-accent shadow-accent-glow" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="relative px-5 py-4 border-t border-secondary/15">
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span className="tracking-widest">TRAIETTORIA</span>
            <span className={TRAJECTORY_BADGE[derived.trajectory] || BADGE.green}>{derived.trajectory}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
