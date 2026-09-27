import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from './Icons.jsx';
import { CARD, BTN_PRIMARY, BADGE } from '../utils/designSystem.js';
import { msUntilNextLocalMidnight } from '../utils/dateUtils.js';
import { formatMsRemaining } from '../utils/maxCarnage.js';

/** Colore particellare per tier — classi Tailwind statiche (mai concatenate a runtime). */
const PARTICLE_CLASS = {
  STANDARD: 'bg-secondary',
  MEDIUM: 'bg-emerald-400',
  RARE: 'bg-accent',
  PARKER_CHEST: 'bg-primary'
};

const PHASE = {
  IDLE: 'idle',
  SHOOTING: 'shooting',
  CHEST: 'chest',
  OPENING: 'opening',
  RESULT: 'result'
};

/** Genera N particelle con direzione casuale (--tx/--ty inline), rigenerate ad ogni apertura. */
function useParticleBurst(active, count = 16) {
  return useMemo(() => {
    if (!active) return [];
    return Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const distance = 60 + Math.random() * 70;
      return {
        id: i,
        tx: Math.round(Math.cos(angle) * distance),
        ty: Math.round(Math.sin(angle) * distance),
        size: 4 + Math.round(Math.random() * 5),
        delay: Math.random() * 0.12
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/**
 * V27.0 — Pillar 4: "Daily Web-Sling" (Il Forziere di Parker) — widget
 * dedicato per la Home (Mission Control), pensato per essere elegante e
 * NON invadente: un singolo pulsante "Lancia la Ragnatela" orchestra
 * un'intera sequenza olografica (linea di ragnatela -> forziere che
 * fluttua -> apertura con burst di particelle -> reveal della ricompensa),
 * poi torna a mostrare il countdown per il giorno successivo — One-Day
 * Lock rigido, un solo riscatto reale al giorno (guardia lato Context).
 */
export default function WebSlingChest() {
  const { derived, actions, audio } = useArachnoForge();
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [reward, setReward] = useState(null);
  const [countdownMs, setCountdownMs] = useState(() => msUntilNextLocalMidnight());
  const timeoutsRef = useRef([]);

  const claimedToday = !derived.canClaimWebSling;

  // Countdown "torna domani" — tick ogni secondo, solo quando il forziere
  // di oggi è già stato riscattato (mai un timer attivo inutilmente).
  useEffect(() => {
    if (!claimedToday) return undefined;
    setCountdownMs(msUntilNextLocalMidnight());
    const id = setInterval(() => setCountdownMs(msUntilNextLocalMidnight()), 1000);
    return () => clearInterval(id);
  }, [claimedToday]);

  useEffect(() => () => {
    timeoutsRef.current.forEach((id) => clearTimeout(id));
  }, []);

  const scheduleTimeout = useCallback((fn, ms) => {
    const id = setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  const handleLaunch = useCallback(() => {
    if (claimedToday || phase !== PHASE.IDLE) return;
    setReward(null);
    setPhase(PHASE.SHOOTING);
    audio.playWebSlingReveal();

    scheduleTimeout(() => setPhase(PHASE.CHEST), 650);
    scheduleTimeout(() => {
      const tier = actions.claimWebSling();
      if (!tier) {
        // Race condition difensiva (es. doppia tab aperta, claim già
        // avvenuto altrove): niente crash, si torna semplicemente allo
        // stato "già riscattato oggi".
        setPhase(PHASE.IDLE);
        return;
      }
      setReward(tier);
      setPhase(PHASE.OPENING);
      scheduleTimeout(() => setPhase(PHASE.RESULT), 550);
      // V39 — dopo qualche secondo il widget torna al countdown di
      // domani, come promesso dal commento qui sopra: prima restava sulla
      // ricompensa per sempre (fino a un cambio pagina).
      scheduleTimeout(() => setPhase(PHASE.IDLE), 550 + 8000);
    }, 1500);
  }, [claimedToday, phase, actions, audio, scheduleTimeout]);

  const particles = useParticleBurst(phase === PHASE.OPENING || phase === PHASE.RESULT, 16);

  return (
    <div className={`${CARD} space-y-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="ds-icon-tile text-primary">
            <Icon name="web" className="w-[18px] h-[18px]" />
          </span>
          <div>
            <p className="ds-eyebrow">Daily Web-Sling</p>
            <h2 className="ds-h2">Il Forziere di Parker</h2>
          </div>
        </div>
        <span className={BADGE.slate}>1 al giorno</span>
      </div>

      <div className="relative min-h-[172px] flex flex-col items-center justify-center gap-3 py-1 ds-well">
        {phase === PHASE.IDLE && !claimedToday && (
          <>
            <div className="af-chest-float">
              <ChestGlyph tone="text-primary" />
            </div>
            <button type="button" onClick={handleLaunch} className={BTN_PRIMARY}>
              <Icon name="target" className="w-5 h-5" />
              Lancia la Ragnatela
            </button>
            <p className="text-[11px] text-slate-500 text-center max-w-xs px-3">
              75% Standard · 20% Medio · 4% Raro · 1% Forziere di Parker (Tech Token)
            </p>
          </>
        )}

        {phase === PHASE.SHOOTING && (
          <div className="relative w-full h-24 flex items-center">
            <div className="af-web-shoot-line absolute left-3 right-3 h-[2px] rounded-full bg-gradient-to-r from-transparent via-secondary to-primary" />
            <p className="relative mx-auto text-sm text-secondary font-medium animate-pulse">Web-Shooter attivo…</p>
          </div>
        )}

        {(phase === PHASE.CHEST || phase === PHASE.OPENING || phase === PHASE.RESULT) && (
          <div className="relative flex flex-col items-center gap-3">
            <div className="relative">
              <div className={phase === PHASE.OPENING ? 'af-chest-pop' : phase === PHASE.CHEST ? 'af-chest-float' : ''}>
                <ChestGlyph tone={reward ? reward.colorClass : 'text-accent'} open={phase === PHASE.OPENING || phase === PHASE.RESULT} />
              </div>
              {(phase === PHASE.OPENING || phase === PHASE.RESULT) && (
                <div className="absolute inset-0 pointer-events-none">
                  {particles.map((p) => (
                    <span
                      key={p.id}
                      className={`af-chest-particle ${PARTICLE_CLASS[reward?.id] || 'bg-accent'}`}
                      style={{
                        width: p.size,
                        height: p.size,
                        marginLeft: -p.size / 2,
                        marginTop: -p.size / 2,
                        '--tx': `${p.tx}px`,
                        '--ty': `${p.ty}px`,
                        animationDelay: `${p.delay}s`
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {phase === PHASE.RESULT && reward && (
              <div className={`af-reward-reveal text-center rounded-xl border ${reward.borderClass} bg-panel px-5 py-3.5 mb-2`}>
                <p className={`ds-eyebrow ${reward.colorClass}`}>{reward.rarity}</p>
                <p className="text-base font-bold text-white mt-0.5">{reward.label}</p>
                <p className="text-sm text-slate-300 mt-1 flex items-center justify-center gap-2 flex-wrap">
                  <span className={BADGE.amber}>+{reward.xp} XP</span>
                  {reward.restoreStamina && <span className={BADGE.blue}>Stamina piena</span>}
                  {reward.techTokens > 0 && (
                    <span className={BADGE.red}>
                      <Icon name="chip" className="w-3.5 h-3.5" />+{reward.techTokens} Tech Token
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setPhase(PHASE.IDLE)}
                  className="mt-2.5 ds-btn ds-btn-quiet ds-btn-sm"
                >
                  Ok
                </button>
              </div>
            )}
          </div>
        )}

        {phase === PHASE.IDLE && claimedToday && (
          <>
            <div className="opacity-40 grayscale">
              <ChestGlyph tone="text-slate-500" locked />
            </div>
            <p className="text-sm text-slate-400 flex items-center gap-1.5">
              <Icon name="lock" className="w-4 h-4" />
              Forziere già riscattato oggi
            </p>
            <span className="font-mono text-xl font-bold text-white ds-num">{formatMsRemaining(countdownMs)}</span>
            <p className="text-[11px] text-slate-500">al prossimo Web-Sling</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Glifo del forziere — SVG inline puro (nessun asset esterno), a tema Spider-Man (ragnatela incisa sul coperchio). */
function ChestGlyph({ tone = 'text-accent', open = false, locked = false }) {
  return (
    <svg viewBox="0 0 64 56" className={`w-16 h-14 ${tone}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="24" width="52" height="26" rx="4" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="2" />
      <path
        d={open ? 'M6 24 8 10a4 4 0 0 1 4-4h40a4 4 0 0 1 4 4l-2 8' : 'M6 24V16a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4v8'}
        stroke="currentColor"
        strokeWidth="2"
        fill="currentColor"
        fillOpacity="0.08"
        strokeLinejoin="round"
      />
      <path d="M6 32h52M22 24v26M42 24v26" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.4" />
      <path d="M14 40l6-6M50 40l-6-6M20 44l24-16" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx="32" cy="30" r="4.5" fill="currentColor" fillOpacity={locked ? '0.3' : '0.9'} />
      {locked && <path d="M32 27v3.5" stroke="black" strokeOpacity="0.3" strokeWidth="1.4" />}
    </svg>
  );
}
