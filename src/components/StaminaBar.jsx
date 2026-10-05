import React from 'react';
import { Icon } from './Icons.jsx';
import { FATIGUE_STAMINA_THRESHOLD, staminaReadinessFactor } from '../utils/xpEngine.js';

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
  OTTIMALE: { label: 'Ottimale', tone: 'text-emerald-300', bar: 'bg-emerald-400' },
  ATTENZIONE: { label: 'Attenzione', tone: 'text-accent', bar: 'bg-accent' },
  CRITICO: { label: 'Critico', tone: 'text-primary', bar: 'bg-primary' }
};

export default function StaminaBar({ stamina, readinessScore = null, readinessBand = null, compact = false }) {
  const safeStamina = Math.max(0, Math.min(100, Number(stamina) || 0));
  const fatigued = safeStamina < FATIGUE_STAMINA_THRESHOLD;
  const barColor = fatigued ? 'bg-primary' : safeStamina > 60 ? 'bg-secondary' : 'bg-accent';

  const showReadiness = readinessScore != null && readinessScore !== '' && Number.isFinite(Number(readinessScore));
  const rMeta = READINESS_META[readinessBand] || READINESS_META.OTTIMALE;
  const rScore = Math.max(0, Math.min(100, Number(readinessScore) || 0));
  // V43 — la Readiness di oggi regola quanto consuma il Focus.
  const fattore = showReadiness ? staminaReadinessFactor(rScore) : 1;
  const effettoPct = Math.round((fattore - 1) * 100);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2.5 gap-2">
          <span className="flex items-center gap-2.5">
            <span className={`ds-icon-tile ${fatigued ? 'text-primary' : 'text-secondary'}`}>
              <Icon name="drop" className="w-[18px] h-[18px]" />
            </span>
            <span>
              <span className="block ds-eyebrow">Stamina mentale</span>
              <span className={`block text-sm font-semibold ${fatigued ? 'text-primary' : 'text-slate-100'}`}>
                {fatigued ? 'Fatigue attiva' : safeStamina > 60 ? 'In forma' : 'In calo'}
              </span>
            </span>
          </span>
          <span className="text-2xl font-bold ds-num text-white">{Math.round(safeStamina)}%</span>
        </div>
        <div className={`ds-progress ${compact ? '' : '!h-2'}`}>
          <span className={barColor} style={{ width: `${safeStamina}%` }} />
        </div>
        {fatigued ? (
          <p className="text-xs text-primary mt-2 leading-relaxed">
            XP dimezzati finché la Stamina resta sotto il {FATIGUE_STAMINA_THRESHOLD}%. Una pausa vera o un Daily Protocol la ricaricano.
          </p>
        ) : (
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Scende con le sessioni di Focus (in proporzione alla tua giornata), risale con le pause, i Daily Protocol e alle 03:00. Sotto il{' '}
            {FATIGUE_STAMINA_THRESHOLD}% gli XP vengono dimezzati.
            {!showReadiness && ' Con la Readiness di oggi (Suit Telemetry) il consumo si adatta a come hai dormito e a come stai.'}
          </p>
        )}
      </div>

      {showReadiness && (
        <div className="pt-4 border-t border-line">
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${rMeta.tone}`}>
              <Icon name="heart" className="w-4 h-4" />
              Readiness biometrica
            </span>
            <span className="text-sm ds-num text-slate-200">
              {Math.round(rScore)} <span className="text-slate-500">· {rMeta.label}</span>
            </span>
          </div>
          <div className="ds-progress">
            <span className={rMeta.bar} style={{ width: `${rScore}%` }} />
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Sonno, cuore e Recovery Survey di oggi. Regola quanto ti stanca il Focus:{' '}
            <span className={effettoPct > 0 ? 'text-accent' : effettoPct < 0 ? 'text-emerald-300' : 'text-slate-300'}>
              {effettoPct === 0 ? 'consumo di Stamina normale' : `consumo di Stamina ${effettoPct > 0 ? '+' : ''}${effettoPct}%`}
            </span>
            . Guida anche i consigli di K.A.R.E.N. e il preset del timer.
          </p>
        </div>
      )}
    </div>
  );
}
