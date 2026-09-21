import React from 'react';
import { Icon } from './Icons.jsx';
import { FATIGUE_STAMINA_THRESHOLD } from '../utils/xpEngine.js';

/**
 * V37.0 — DUE NUMERI DIVERSI, DUE BARRE DIVERSE.
 *
 * Fino alla V36 questa barra si chiamava "Stamina Mentale" ma mostrava
 * il Readiness Score biometrico di K.A.R.E.N. Sono due cose distinte, e
 * la confusione aveva una conseguenza concreta: è `profile.stamina` — non
 * il readiness — a decidere `derived.fatigued` e il moltiplicatore
 * `FATIGUE_MULTIPLIER = 0.5` che DIMEZZA gli XP sotto quota 20. Si poteva
 * quindi leggere "100%" sullo schermo e prendere metà XP, senza niente
 * che lo spiegasse.
 *
 * Ora la Stamina reale è la barra principale (è quella che ha effetti
 * meccanici) e il Readiness compare accanto come indicatore biometrico
 * separato, con il proprio nome. Nessuno dei due finge di essere l'altro.
 */

const READINESS_META = {
  OTTIMALE: { label: 'Ottimale', tone: 'text-emerald-300', bar: 'from-emerald-400 to-emerald-600' },
  ATTENZIONE: { label: 'Attenzione', tone: 'text-accent', bar: 'from-accent to-accent/70' },
  CRITICO: { label: 'Critico', tone: 'text-primary', bar: 'from-primary to-primary-dark' }
};

export default function StaminaBar({ stamina, readinessScore = null, readinessBand = null, compact = false }) {
  const safeStamina = Math.max(0, Math.min(100, Number(stamina) || 0));
  const fatigued = safeStamina < FATIGUE_STAMINA_THRESHOLD;
  const barGradient = fatigued
    ? 'bg-gradient-to-r from-accent to-primary'
    : safeStamina > 60
    ? 'bg-gradient-to-r from-secondary to-secondary-dark'
    : 'bg-gradient-to-r from-accent to-accent/70';

  const showReadiness = readinessScore != null && readinessScore !== '' && Number.isFinite(Number(readinessScore));
  const rMeta = READINESS_META[readinessBand] || READINESS_META.OTTIMALE;
  const rScore = Math.max(0, Math.min(100, Number(readinessScore) || 0));

  return (
    <div className="space-y-3.5">
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <span
            className={`flex items-center gap-1.5 text-base font-semibold tracking-wide ${
              fatigued ? 'text-accent' : 'text-secondary'
            }`}
          >
            <Icon name="drop" className="w-5 h-5" />
            STAMINA MENTALE
          </span>
          <span className="text-base font-mono af-mono-nums text-slate-100">{Math.round(safeStamina)}%</span>
        </div>
        <div
          className={`w-full rounded-full bg-surface/80 border border-secondary/20 overflow-hidden ${
            compact ? 'h-2.5' : 'h-3.5'
          }`}
        >
          <div
            className={`h-full ${barGradient} transition-all duration-500 ${
              fatigued ? 'shadow-accent-glow' : 'shadow-secondary-glow'
            }`}
            style={{ width: `${safeStamina}%` }}
          />
        </div>
        {fatigued ? (
          <p className="text-[11px] text-accent mt-1.5 tracking-wide leading-relaxed">
            FATIGUE ATTIVA — XP dimezzati finché la Stamina resta sotto {FATIGUE_STAMINA_THRESHOLD}%. Attiva un Daily
            Protocol per recuperarla.
          </p>
        ) : (
          <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            Si consuma con le sessioni di Focus e si ricarica alle 03:00 e con i Daily Protocol. Sotto{' '}
            {FATIGUE_STAMINA_THRESHOLD}% gli XP vengono dimezzati.
          </p>
        )}
      </div>

      {showReadiness && (
        <div className="pt-3 border-t border-white/10">
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className={`flex items-center gap-1.5 text-sm font-semibold tracking-wide ${rMeta.tone}`}>
              <Icon name="heart" className="w-4 h-4" />
              READINESS BIOMETRICA
            </span>
            <span className="text-sm font-mono af-mono-nums text-slate-300">
              {Math.round(rScore)} <span className="text-slate-500">· {rMeta.label}</span>
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-surface/80 border border-white/10 overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${rMeta.bar} transition-all duration-500`}
              style={{ width: `${rScore}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            Sonno, cardio e Recovery Survey di oggi. Non tocca gli XP: guida i consigli di K.A.R.E.N. e il preset del
            timer.
          </p>
        </div>
      )}
    </div>
  );
}
