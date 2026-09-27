import React, { useEffect, useState } from 'react';
import { Icon } from './Icons.jsx';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { useKarenBrain } from '../context/KarenBrainContext.jsx';
import { ROUTES } from '../hooks/useArachnoForgeRouter.js';
import { SCHEMA_VERSION } from '../data/defaultSchema.js';
import { APP_VERSION } from '../utils/appVersion.js';
import { formatInt } from '../utils/format.js';
import { openCommandPalette, shortcutLabel } from './CommandPalette.jsx';

/**
 * V41 — Sidebar "premium": tre blocchi con un compito ciascuno.
 *  1. Marchio + ricerca rapida (Ctrl K).
 *  2. Il profilo di gioco, sempre in vista: livello, rango, XP, streak,
 *     Stamina, Tech Token e scudi — la gamification resta in primo piano.
 *  3. La navigazione, una riga per voce, con i contatori che contano.
 * In fondo lo stato del sistema (Cloud, fase di studio, traiettoria) in
 * una sola riga compatta, invece di quattro chip impilati sotto al logo.
 */
const NAV_ITEMS = [
  { route: ROUTES.MISSION_CONTROL, label: 'Stark-Web Terminal', icon: 'terminal', key: '1' },
  { route: ROUTES.QUADRANT_HUB, label: 'The Web-Matrix', icon: 'web', key: '2' },
  { route: ROUTES.CAMPUS, label: 'Empire State University', icon: 'calendar', key: '3' },
  { route: ROUTES.BOSS_FIGHT, label: 'Sinister Six Simulator', icon: 'crosshair', key: '4' },
  { route: ROUTES.STAR_LOG, label: 'Daily Bugle Archives', icon: 'newspaper', key: '5' },
  { route: ROUTES.ARMORY, label: 'Suit Lab & Trophies', icon: 'flask', key: '6' },
  { route: ROUTES.MULTIVERSE_SIMULATOR, label: 'Multiverse Simulator', icon: 'multiverse', key: '7' },
  { route: ROUTES.SUIT_TELEMETRY, label: 'Suit Telemetry', icon: 'heart', key: '8' },
  { route: ROUTES.CORE_CONFIG, label: 'Karen OS Settings', icon: 'chip', key: '9' }
];

export { NAV_ITEMS };

const TRAJECTORY_META = {
  GREEN: { label: 'In linea', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  YELLOW: { label: 'Attenzione', dot: 'bg-accent', text: 'text-accent' },
  RED: { label: 'Critica', dot: 'bg-primary', text: 'text-primary' }
};

const SYNC_META = {
  loading: { icon: 'cloud', label: 'Sincronizzazione…', tone: 'text-slate-400', spin: true },
  syncing: { icon: 'cloud', label: 'Salvataggio…', tone: 'text-slate-400', spin: true },
  error: { icon: 'cloudOff', label: 'Non salvato — nuovo tentativo a breve', tone: 'text-primary', blink: true },
  offline: { icon: 'wifiOff', label: 'Offline — salvato su questo dispositivo', tone: 'text-accent' },
  conflict: { icon: 'alertTriangle', label: 'Conflitto da risolvere', tone: 'text-accent', blink: true }
};
const SYNCED_META = {
  cloud: { icon: 'cloudCheck', label: 'Sincronizzato col Nexus', tone: 'text-emerald-300' },
  guest: { icon: 'user', label: 'Modalità Ospite · solo locale', tone: 'text-slate-400' },
  sandbox: { icon: 'chip', label: 'Sandbox Admin · solo locale', tone: 'text-fuchsia-300' }
};

function getSyncMeta(syncStatus, storageMode) {
  if (syncStatus === 'synced') return SYNCED_META[storageMode] || SYNCED_META.cloud;
  return SYNC_META[syncStatus] || SYNC_META.loading;
}

const READINESS_META = {
  OTTIMALE: { label: 'Readiness ottimale', tone: 'text-emerald-300', dot: 'bg-emerald-400' },
  ATTENZIONE: { label: 'Readiness in attenzione', tone: 'text-accent', dot: 'bg-accent' },
  CRITICO: { label: 'Readiness critico', tone: 'text-primary', dot: 'bg-primary' }
};

function ProfileCard({ profile, derived }) {
  const rankMeta = derived.rankMeta || { textClass: 'text-slate-300' };
  const xpPct = derived.xpPct ?? 0;
  const initial = (profile.username || 'C').trim().charAt(0).toUpperCase() || 'C';
  const stamina = Math.max(0, Math.min(100, Math.round(Number(profile.stamina) || 0)));
  const staminaTone = stamina < 20 ? 'bg-primary' : stamina < 50 ? 'bg-accent' : 'bg-secondary';
  // Anello del livello attorno all'iniziale: la percentuale di XP del
  // livello corrente, in un colpo d'occhio.
  const ring = `conic-gradient(rgb(var(--af-refuel-rgb)) ${xpPct * 3.6}deg, rgb(255 255 255 / 0.08) 0deg)`;
  return (
    <div className="mx-3 rounded-xl border border-line bg-panel/70 p-3.5">
      <div className="flex items-center gap-3">
        <div className="relative w-11 h-11 shrink-0 rounded-full p-[2px]" style={{ background: ring }} aria-hidden="true">
          <div className="w-full h-full rounded-full bg-panel-2 flex items-center justify-center text-[15px] font-bold text-white">
            {initial}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white truncate">{profile.username || 'Cadetto'}</p>
            <span className="shrink-0 rounded-md bg-secondary/15 border border-secondary/25 px-1.5 py-0.5 text-[11px] font-bold text-secondary ds-num">
              Lv {profile.level}
            </span>
          </div>
          <p className={`text-xs font-semibold truncate mt-0.5 ${rankMeta.textClass}`}>{derived.rankTitle}</p>
        </div>
      </div>

      <div className="mt-3">
        <div className="ds-progress" role="progressbar" aria-valuenow={xpPct} aria-valuemin={0} aria-valuemax={100} aria-label="Avanzamento del livello">
          <span className="bg-secondary" style={{ width: `${xpPct}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 ds-num">
          <span>
            {formatInt(profile.currentXp)} / {formatInt(derived.xpNeeded)} XP
          </span>
          <span>{xpPct}%</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <div className="rounded-lg bg-surface border border-line px-2 py-1.5" title="Streak: giorni consecutivi di attività">
          <p className="flex items-center gap-1 text-[13px] font-bold text-accent ds-num">
            <Icon name="flame" className="w-3.5 h-3.5" />
            {profile.streak}
          </p>
          <p className="text-[10px] text-slate-500 leading-tight">streak</p>
        </div>
        <div className="rounded-lg bg-surface border border-line px-2 py-1.5" title="Tech Token: si spendono nello Skill Tree della Suit Lab">
          <p className="flex items-center gap-1 text-[13px] font-bold text-amber-200 ds-num">
            <Icon name="chip" className="w-3.5 h-3.5" />
            {profile.techTokens || 0}
          </p>
          <p className="text-[10px] text-slate-500 leading-tight">token</p>
        </div>
        <div className="rounded-lg bg-surface border border-line px-2 py-1.5" title="Stamina mentale: sotto il 20% gli XP vengono dimezzati">
          <p className="flex items-center gap-1 text-[13px] font-bold text-slate-100 ds-num">
            <Icon name="drop" className="w-3.5 h-3.5 text-secondary" />
            {stamina}%
          </p>
          <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full ${staminaTone}`} style={{ width: `${stamina}%` }} />
          </div>
        </div>
      </div>

      {profile.streakShields > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-cyan-300/90" title="Gli scudi coprono da soli un giorno saltato, senza spezzare la streak.">
          <Icon name="shield" className="w-3.5 h-3.5" />
          {profile.streakShields === 1 ? '1 Streak Shield pronto' : `${profile.streakShields} Streak Shield pronti`}
        </p>
      )}
    </div>
  );
}

/**
 * V41 — La barra laterale resta fissa solo da 1024 px in su. Prima si
 * agganciava già a 768: su tablet e finestre strette del PC i suoi 272 px
 * lasciavano al contenuto meno spazio che su un telefono, e le pagine
 * pensate per "schermo largo" si schiacciavano. Sotto i 1024 px è un
 * pannello che si apre dal pulsante in alto a sinistra.
 */
const DOCKED_QUERY = '(min-width: 1024px)';

function useDocked() {
  const [docked, setDocked] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DOCKED_QUERY).matches : true
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(DOCKED_QUERY);
    const update = () => setDocked(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener('change', update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else mq.removeListener(update);
    };
  }, []);
  return docked;
}

export default function Sidebar({ currentPage, navigate }) {
  const { state, derived, sensoryZero, syncStatus, storageMode } = useArachnoForge();
  const karen = useKarenBrain();
  const [mobileOpen, setMobileOpen] = useState(false);
  const docked = useDocked();

  // Allargando la finestra il pannello aperto diventa la barra fissa.
  useEffect(() => {
    if (docked) setMobileOpen(false);
  }, [docked]);

  // Esc chiude il menu su telefono.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  if (sensoryZero) return null;

  const { profile } = state;
  const syncMeta = getSyncMeta(syncStatus, storageMode);
  const readinessMeta = READINESS_META[karen.readinessBand] || READINESS_META.OTTIMALE;
  const showReadiness = karen.hasSession && !karen.loading;
  const trajectory = TRAJECTORY_META[derived.trajectory] || TRAJECTORY_META.GREEN;
  const campus = derived.campus;
  const reviewsDue = derived.upcomingReviews.length;

  const handleNavigate = (route) => {
    navigate(route);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Hamburger (telefono) */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 w-11 h-11 flex items-center justify-center rounded-xl bg-panel/95 backdrop-blur-xl border border-line text-slate-200 shadow-pop"
        aria-label="Apri menu"
      >
        <Icon name="menu" className="w-6 h-6" />
      </button>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-[2px] z-40" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`fixed lg:sticky top-0 left-0 h-[100dvh] w-[272px] shrink-0 z-50 bg-app/95 lg:bg-[rgb(var(--af-bg-rgb)/0.6)] backdrop-blur-xl border-r border-line flex flex-col transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
        aria-label="Navigazione principale"
        // Chiuso fuori schermo: non raggiungibile col Tab né dai lettori di schermo.
        inert={!docked && !mobileOpen ? '' : undefined}
        aria-hidden={!docked && !mobileOpen ? true : undefined}
      >
        {/* 1. Marchio */}
        <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[rgb(var(--af-attack-solid-rgb))] flex items-center justify-center text-white shadow-primary-glow shrink-0">
              <Icon name="web" className="w-[18px] h-[18px]" strokeWidth={1.9} />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-bold tracking-tight text-white leading-none">ArachnoForge</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-none">K.A.R.E.N. OS · v{APP_VERSION || SCHEMA_VERSION}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden ds-icon-btn"
            aria-label="Chiudi menu"
          >
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>

        {/* Ricerca rapida / palette comandi */}
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              openCommandPalette();
            }}
            className="w-full flex items-center gap-2.5 rounded-lg border border-line bg-panel/60 hover:bg-panel-2 hover:border-line-strong px-3 py-2 text-left text-[13px] text-slate-400 transition-colors"
          >
            <Icon name="search" className="w-4 h-4" />
            <span className="flex-1 truncate">Cerca o vai a…</span>
            <span className="ds-kbd">{shortcutLabel('K')}</span>
          </button>
        </div>

        {/* 2. Profilo di gioco */}
        <ProfileCard profile={profile} derived={derived} />

        {derived.isMaxCarnageActive && (
          <div className="af-carnage-pulse mx-3 mt-2 flex items-center gap-2 rounded-lg border border-primary/50 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
            <Icon name="skull" className="w-4 h-4" />
            Maximum Carnage attivo · XP ×2
          </div>
        )}

        {/* 3. Navigazione */}
        <nav className="flex-1 min-h-0 overflow-y-auto af-scroll px-3 pt-4 pb-3" aria-label="Sezioni">
          <p className="ds-eyebrow px-2.5 mb-1.5">Sezioni</p>
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const active = currentPage === item.route;
              let counter = null;
              if (item.route === ROUTES.CAMPUS && campus?.lezioniInCoda > 0) {
                counter = (
                  <span
                    className="ml-auto shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-md bg-accent/15 text-accent text-[11px] font-bold flex items-center justify-center ds-num"
                    aria-label={campus.lezioniInCoda === 1 ? '1 lezione da sistemare' : `${campus.lezioniInCoda} lezioni da sistemare`}
                    title="Lezioni da sistemare"
                  >
                    {campus.lezioniInCoda}
                  </span>
                );
              } else if (item.route === ROUTES.QUADRANT_HUB && reviewsDue > 0) {
                counter = (
                  <span
                    className="ml-auto shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-md bg-secondary/15 text-secondary text-[11px] font-bold flex items-center justify-center ds-num"
                    aria-label={reviewsDue === 1 ? '1 ripasso Spider-Sense in scadenza' : `${reviewsDue} ripassi Spider-Sense in scadenza`}
                    title="Ripassi Spider-Sense in scadenza"
                  >
                    {reviewsDue}
                  </span>
                );
              }
              return (
                <li key={item.route}>
                  <button
                    type="button"
                    onClick={() => handleNavigate(item.route)}
                    aria-current={active ? 'page' : undefined}
                    title={`${item.label} (Alt+${item.key})`}
                    className={`group relative w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium transition-colors ${
                      active ? 'bg-white/[0.07] text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                    }`}
                  >
                    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" aria-hidden="true" />}
                    <Icon
                      name={item.icon}
                      className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-primary' : 'text-slate-500 group-hover:text-slate-300'}`}
                    />
                    <span className="truncate">{item.label}</span>
                    {counter}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Stato del sistema */}
        <div className="border-t border-line px-4 py-3 space-y-1.5 text-[12px]">
          <div className={`flex items-center gap-2 ${syncMeta.tone} ${syncMeta.blink ? 'af-sync-error' : ''}`}>
            <Icon name={syncMeta.icon} className={`w-4 h-4 shrink-0 ${syncMeta.spin ? 'af-cloud-syncing' : ''}`} />
            <span className="truncate">{syncMeta.label}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-slate-500">
            {campus && (
              <span className="flex items-center gap-1.5 min-w-0">
                <Icon name={campus.fase === 'LEZIONI' ? 'calendar' : 'target'} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {campus.fase === 'LEZIONI' ? `Lezioni${campus.settimana ? ` · sett. ${campus.settimana}` : ''}` : 'Sessione d’esame'}
                  {!campus.automatica && ' (manuale)'}
                </span>
              </span>
            )}
            <span className={`flex items-center gap-1.5 shrink-0 ${trajectory.text}`} title="Traiettoria del prossimo esame">
              <span className={`w-1.5 h-1.5 rounded-full ${trajectory.dot}`} />
              {trajectory.label}
            </span>
          </div>
          {/* V41 — senza la diagnostica di oggi il Readiness non è
              "ottimale": è da calcolare (prima si vedeva il valore di
              default come se fosse misurato). */}
          {showReadiness && (
            <div className={`flex items-center gap-2 ${karen.briefing ? readinessMeta.tone : 'text-slate-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${karen.briefing ? readinessMeta.dot : 'bg-slate-600'}`} />
              {karen.briefing ? readinessMeta.label : 'Readiness da calcolare oggi'}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
