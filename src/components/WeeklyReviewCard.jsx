import React, { useMemo, useState } from 'react';
import { Icon } from './Icons.jsx';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { useKarenBrain } from '../context/KarenBrainContext.jsx';
import { buildWeeklyContext } from '../services/karenEngine/weeklyContext.js';
import { addDaysToDateOnly, mondayOfDateKey, todayDateOnlyKey, formatDateShort, isoWeekdayOfDateKey } from '../utils/dateUtils.js';
import { minutiLabel } from '../utils/format.js';
import { BADGE, BTN_GHOST, BTN_SECONDARY, BTN_SM } from '../utils/designSystem.js';

// =====================================================================
// V42 — IL BILANCIO DELLA SETTIMANA con K.A.R.E.N.
//
// Una volta a settimana, sui numeri veri: minuti contro obiettivo giorno
// per giorno, materie e modi di lavoro, energia della sera, ripassi ed
// esercizi, esami in arrivo. K.A.R.E.N. risponde come una tutor: cosa ha
// funzionato, cosa cambiare, UNA tecnica di studio con il come, e le
// priorità della settimana dopo. Il lunedì e il martedì propone la
// settimana appena chiusa; negli altri giorni quella in corso.
// =====================================================================

function Lista({ titolo, voci, tono }) {
  if (!Array.isArray(voci) || voci.length === 0) return null;
  return (
    <div>
      <p className={`ds-eyebrow ${tono || ''}`}>{titolo}</p>
      <ul className="mt-1.5 space-y-1 list-disc pl-5 text-sm text-slate-300 leading-relaxed">
        {voci.map((v, i) => (
          <li key={i}>{typeof v === 'string' ? v : v?.testo || v?.azione || ''}</li>
        ))}
      </ul>
    </div>
  );
}

export default function WeeklyReviewCard() {
  const { state, derived, actions } = useArachnoForge();
  const karen = useKarenBrain();
  const oggi = todayDateOnlyKey();
  const inizioSettimana = isoWeekdayOfDateKey(oggi) <= 2 ? addDaysToDateOnly(mondayOfDateKey(oggi), -7) : mondayOfDateKey(oggi);
  const [weekKey, setWeekKey] = useState(inizioSettimana);
  const [errore, setErrore] = useState(null);
  const salvato = state.karenWeekly && state.karenWeekly.weekKey === weekKey ? state.karenWeekly.payload : null;
  const nomeDi = useMemo(() => new Map((state.materie || []).map((m) => [m.id, m.nome])), [state.materie]);

  const contesto = useMemo(
    () =>
      buildWeeklyContext({
        weekKey,
        starLog: state.starLog,
        dayClosures: state.dayClosures,
        materie: state.materie,
        quotas: derived.karenQuotas,
        streak: derived.streak,
        todayKey: oggi
      }),
    [weekKey, state.starLog, state.dayClosures, state.materie, derived.karenQuotas, derived.streak, oggi]
  );

  const genera = async (force = false) => {
    setErrore(null);
    const res = await karen.generateWeeklyReview(weekKey, contesto, force);
    if (res.error || !res.weekly) {
      setErrore(res.error || 'Bilancio non disponibile.');
      return;
    }
    actions.saveKarenWeekly(weekKey, res.weekly, { generatedAt: res.generatedAt, weekClosed: res.weekClosed });
  };

  const inCorso = karen.aiBusy === 'weekly';
  const fine = addDaysToDateOnly(weekKey, 6);
  const settimanaCorrente = weekKey === mondayOfDateKey(oggi);
  // Un bilancio scritto a settimana in corso, per una settimana ora chiusa:
  // mancano gli ultimi giorni, va aggiornato (il server lo rifà).
  const savedAt = state.karenWeekly?.savedAt || '';
  const scrittoAChiusura = state.karenWeekly?.weekClosed === true || savedAt.slice(0, 10) > fine;
  const daAggiornare = !!salvato && weekKey < mondayOfDateKey(oggi) && !scrittoAChiusura;

  return (
    <section className="ds-card space-y-4" aria-label="Bilancio della settimana">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="ds-icon-tile text-secondary">
            <Icon name="chip" className="w-[18px] h-[18px]" />
          </span>
          <div>
            <p className="ds-eyebrow">K.A.R.E.N. · Bilancio della settimana</p>
            <h2 className="ds-h2">
              {formatDateShort(weekKey, oggi)} – {formatDateShort(fine, oggi)}
              {settimanaCorrente ? <span className="text-slate-500 font-normal text-sm"> · finora</span> : null}
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="ds-segmented" role="radiogroup" aria-label="Settimana">
            {[
              [addDaysToDateOnly(mondayOfDateKey(oggi), -7), 'Scorsa'],
              [mondayOfDateKey(oggi), 'Questa']
            ].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={weekKey === k} onClick={() => setWeekKey(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="ds-well px-3 py-2.5">
          <p className="text-[11px] text-slate-500">Studio</p>
          <p className="text-sm font-semibold text-white ds-num">{minutiLabel(contesto.total_minutes)}</p>
        </div>
        <div className="ds-well px-3 py-2.5">
          <p className="text-[11px] text-slate-500">Ripassi</p>
          <p className="text-sm font-semibold text-white ds-num">{contesto.reviews.count}</p>
        </div>
        <div className="ds-well px-3 py-2.5">
          <p className="text-[11px] text-slate-500">Esercizi corretti</p>
          <p className="text-sm font-semibold text-white ds-num">
            {contesto.exercises.correct}/{contesto.exercises.done}
          </p>
        </div>
        <div className="ds-well px-3 py-2.5">
          <p className="text-[11px] text-slate-500">Giornate chiuse</p>
          <p className="text-sm font-semibold text-white ds-num">
            {contesto.days.filter((d) => d.closed).length}/{contesto.days.length}
          </p>
        </div>
      </div>

      {salvato ? (
        <div className="space-y-3.5">
          {salvato.sintesi && <p className="text-[15px] text-slate-200 leading-relaxed">{salvato.sintesi}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Lista titolo="Ha funzionato" voci={salvato.bene} tono="!text-emerald-300" />
            <Lista titolo="Da cambiare" voci={salvato.migliorare} tono="!text-accent" />
          </div>
          {salvato.tecnica?.nome && (
            <div className="rounded-xl border border-secondary/30 bg-secondary/[0.05] px-4 py-3">
              <p className="text-sm font-semibold text-secondary">Tecnica della settimana: {salvato.tecnica.nome}</p>
              {salvato.tecnica.come && <p className="text-sm text-slate-300 mt-1 leading-relaxed">{salvato.tecnica.come}</p>}
            </div>
          )}
          {Array.isArray(salvato.prossima_settimana) && salvato.prossima_settimana.length > 0 && (
            <div>
              <p className="ds-eyebrow">Priorità della prossima settimana</p>
              <ol className="mt-1.5 space-y-1.5">
                {salvato.prossima_settimana.map((p, i) => (
                  <li key={i} className="text-sm text-slate-300 leading-relaxed flex gap-2">
                    <span className="text-secondary font-semibold ds-num">{i + 1}.</span>
                    <span>
                      {p.materia_id && nomeDi.get(p.materia_id) ? <span className="text-slate-100 font-medium">{nomeDi.get(p.materia_id)}: </span> : null}
                      {p.azione || p.testo || ''}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className={BADGE.slate}>Generato il {savedAt ? formatDateShort(savedAt.slice(0, 10), oggi) : '—'}</span>
            {daAggiornare ? (
              <button type="button" onClick={() => genera(false)} disabled={inCorso} className={`${BTN_SECONDARY} ${BTN_SM}`}>
                <Icon name="refresh" className={`w-3.5 h-3.5 ${inCorso ? 'animate-spin' : ''}`} />
                Aggiorna: la settimana è finita
              </button>
            ) : (
              <button type="button" onClick={() => genera(true)} disabled={inCorso} className={`${BTN_GHOST} ${BTN_SM}`}>
                <Icon name="refresh" className={`w-3.5 h-3.5 ${inCorso ? 'animate-spin' : ''}`} />
                Rigenera
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-slate-400 leading-relaxed max-w-xl">
            {contesto.total_minutes === 0
              ? 'Nessuna sessione registrata in questa settimana: il bilancio si prepara quando c’è qualcosa da guardare.'
              : 'K.A.R.E.N. legge i numeri della settimana e ti dice cosa ha funzionato, cosa cambiare e una tecnica di studio da provare, con le priorità per la prossima.'}
          </p>
          <button type="button" onClick={() => genera(false)} disabled={inCorso || contesto.total_minutes === 0} className={BTN_SECONDARY}>
            <Icon name={inCorso ? 'refresh' : 'sparkles'} className={`w-4 h-4 ${inCorso ? 'animate-spin' : ''}`} />
            {inCorso ? 'In preparazione…' : 'Prepara il bilancio'}
          </button>
        </div>
      )}
      {errore && <p className="text-xs text-primary">{errore}</p>}
    </section>
  );
}
