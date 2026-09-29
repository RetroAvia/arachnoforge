import React from 'react';
import { Icon } from '../Icons.jsx';
import { BADGE, BTN_PRIMARY, BTN_SM } from '../../utils/designSystem.js';
import { plurale } from '../../utils/format.js';
import { CRITICAL_ACTION_THRESHOLD, CARNAGE_HOUR_START, CARNAGE_HOUR_END, isCarnageHour } from '../../utils/maxCarnage.js';
import { STREAK_DAY_MIN_MINUTES } from '../../utils/streakEngine.js';

/**
 * V42 — LA SERIE e LA CARICA DEL SIMBIONTE, in una card.
 *
 * La serie conta i giorni di studio veri (almeno 25 minuti di Focus) e
 * concede giorni di riposo ogni settimana: la card dice se oggi conta
 * già, quanto manca, quanti riposi restano e se saltare oggi la
 * spezzerebbe. Sotto, Maximum Carnage: le azioni critiche di oggi verso
 * la prossima carica, o il pulsante per attivarla quando vuoi.
 */
export default function StreakCard({ streak, profile, todayKey, carnageActive = false, onActivateCarnage }) {
  if (!streak) return null;
  const cariche = Number(profile?.carnageCharges) || 0;
  const azioniOggi = profile?.criticalActionDateKey === todayKey ? Math.min(CRITICAL_ACTION_THRESHOLD, Number(profile?.criticalActionStreak) || 0) : 0;
  const giorno = isCarnageHour();
  const dots = Array.from({ length: streak.riposiSettimana }, (_, i) => i < streak.riposiUsati);

  return (
    <div className="ds-card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`ds-icon-tile ${streak.viva && streak.streak > 0 ? 'text-accent' : 'text-slate-500'}`}>
            <Icon name="flame" className="w-[18px] h-[18px]" />
          </span>
          <div>
            <p className="ds-eyebrow">Serie di studio</p>
            <p className="text-xl font-bold text-white ds-num leading-tight">
              {plurale(streak.streak, 'giorno', 'giorni')}
            </p>
          </div>
        </div>
        {streak.validaOggi ? (
          <span className={BADGE.green}>
            <Icon name="check" className="w-3 h-3" />
            Oggi conta
          </span>
        ) : (
          <span className={streak.aRischio ? BADGE.amber : BADGE.slate}>
            {streak.minutiMancanti} min a {STREAK_DAY_MIN_MINUTES}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-2">
          Riposi della settimana
          <span className="flex items-center gap-1" aria-label={`${streak.riposiUsati} riposi usati su ${streak.riposiSettimana}`}>
            {dots.map((usato, i) => (
              <span key={i} className={`w-2 h-2 rounded-full ${usato ? 'bg-slate-500' : 'bg-secondary/70'}`} />
            ))}
          </span>
        </span>
        <span className="ds-num">
          {streak.riposiRimasti}/{streak.riposiSettimana} liberi
          {streak.scudi > 0 ? ` · ${plurale(streak.scudi, 'scudo', 'scudi')}` : ''}
        </span>
      </div>

      {!streak.validaOggi && (
        <p className={`text-xs leading-relaxed ${streak.aRischio ? 'text-accent' : 'text-slate-500'}`}>
          {streak.aRischio
            ? `Riposi finiti: se oggi resta sotto i ${STREAK_DAY_MIN_MINUTES} minuti ${streak.coperturaScudo ? 'domani si consuma uno Streak Shield.' : 'la serie riparte da capo.'}`
            : `Se oggi resta vuoto vale come riposo: nessuna penalità, la serie non si spezza.`}
        </p>
      )}

      <div className="pt-3 border-t border-line">
        {carnageActive ? (
          <p className="text-xs text-primary flex items-center gap-2">
            <Icon name="skull" className="w-3.5 h-3.5" />
            Maximum Carnage attivo: XP ×2 fino allo scadere del timer.
          </p>
        ) : cariche > 0 ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-slate-300 leading-relaxed min-w-0">
              <span className="font-semibold text-primary">Carica del simbionte pronta.</span> Attivala per due ore di XP ×2
              {giorno ? ', quando hai davanti un blocco serio.' : `: di giorno, fra le ${CARNAGE_HOUR_START} e le ${CARNAGE_HOUR_END}.`}
            </p>
            <button type="button" onClick={onActivateCarnage} disabled={!giorno} className={`${BTN_PRIMARY} ${BTN_SM}`}>
              <Icon name="skull" className="w-3.5 h-3.5" />
              Attiva
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Icon name="skull" className="w-3.5 h-3.5 text-primary/70" />
                Azioni critiche di oggi
              </span>
              <span className="ds-num text-slate-300">
                {azioniOggi}/{CRITICAL_ACTION_THRESHOLD}
              </span>
            </div>
            <div className="ds-progress mt-2">
              <span className="bg-primary/70" style={{ width: `${Math.round((azioniOggi / CRITICAL_ACTION_THRESHOLD) * 100)}%` }} />
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
              Argomenti Hard completati, Overdrive da 20 minuti, simulazioni vinte: a {CRITICAL_ACTION_THRESHOLD} in un giorno guadagni una carica di Maximum Carnage.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
