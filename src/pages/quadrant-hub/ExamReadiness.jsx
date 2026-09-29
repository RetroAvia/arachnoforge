import React from 'react';
import { CARD_NOPAD } from '../../utils/designSystem.js';
import { VERDICT_META, READY_MIN_COVERAGE, READY_MIN_MEMORY } from '../../utils/examReadiness.js';
import { formatHoursMinutes, formatDateShort, daysBetweenDateKeys, todayDateOnlyKey } from '../../utils/dateUtils.js';
import { formatoMeta, haProvaScritta } from '../../utils/appelli.js';

// =====================================================================
// V36.0/V42 — IL VERDETTO SULL'ESAME.
//
// V42: quattro pilastri veri — Copertura (programma STUDIATO, non solo
// riassunto), Memoria (ricordo stimato oggi degli argomenti completati),
// Esercizi (esercizi, simulazioni, interrogazioni: obbligatori se c'è uno
// scritto), Fattibilità (il piano GLOBALE con tutte le materie). "Sostieni"
// arriva solo oltre soglie minime oneste, elencate qui sotto quando
// mancano; il riquadro finale dice se il lavoro chiude prima dell'esame.
// =====================================================================

function sentenceCase(s) {
  const str = String(s || '');
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/** Pilastro dell'indice: si vede QUALE trascina giù il verdetto; senza dati è "n/d". */
function ReadinessPillar({ label, value, known, hint, optional = false }) {
  const pctValue = Math.round((Number(value) || 0) * 100);
  const tone = pctValue >= 75 ? 'bg-emerald-400' : pctValue >= 50 ? 'bg-accent' : 'bg-primary';
  return (
    <div title={hint}>
      <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
        <span className="text-slate-400">{label}</span>
        <span className={`ds-num font-semibold ${known ? 'text-slate-200' : 'text-slate-500'}`}>{known ? `${pctValue}%` : optional ? 'facoltativo' : 'n/d'}</span>
      </div>
      <div className="ds-progress">
        <span className={known ? tone : 'bg-slate-600'} style={{ width: `${Math.max(2, known ? pctValue : 2)}%`, opacity: known ? 1 : 0.4 }} />
      </div>
    </div>
  );
}

/** Anello del punteggio (0–100). */
function ScoreRing({ score, className = '' }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Number(score) || 0));
  return (
    <div className={`relative w-16 h-16 shrink-0 ${className}`}>
      <svg viewBox="0 0 56 56" className="w-16 h-16 -rotate-90" aria-hidden="true">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="5" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold leading-none ds-num">{Math.round(v)}</span>
        <span className="text-[9px] text-slate-500 mt-0.5">su 100</span>
      </div>
    </div>
  );
}

const GATE_LABEL = {
  coverage: `programma studiato almeno al ${Math.round(READY_MIN_COVERAGE * 100)}%`,
  memory: `ricordo stimato almeno al ${Math.round(READY_MIN_MEMORY * 100)}%`,
  practice: 'esercizi o una simulazione registrati',
  confidence: 'abbastanza dati misurati (ripassi, esercizi)'
};

function giorniLabel(n) {
  return n === 1 ? '1 giorno' : `${n} giorni`;
}

/**
 * @param {object} props
 * @param {object} props.readiness  computeExamReadiness(...)
 * @param {object} props.materia    materia (con la data di pianificazione)
 * @param {object} [props.quota]    voce del piano globale per la materia
 */
export default function ExamReadinessCard({ readiness, materia, quota = null }) {
  const meta = VERDICT_META[readiness.verdict] || VERDICT_META.UNKNOWN;
  const today = todayDateOnlyKey();
  const scritto = haProvaScritta(materia);
  const pd = readiness.practiceData || {};
  const pratica = [
    pd.esercizi ? `esercizi ${pd.esercizi.corretti}/${pd.esercizi.fatti} corretti` : null,
    pd.simulazioni?.length ? `${pd.simulazioni.length === 1 ? '1 simulazione' : `${pd.simulazioni.length} simulazioni`} (ultima ${Math.round(pd.simulazioni[0] * 100)}%)` : null,
    pd.quiz ? `interrogazioni ${pd.quiz.sapevo}/${pd.quiz.totale} sapute` : null
  ].filter(Boolean);

  const fine = quota?.finePrevistaDateKey || null;
  const margine = fine && materia.examDate ? daysBetweenDateKeys(fine, materia.examDate) : null;
  const late = Number(quota?.lateHours) || 0;
  const showPiano = !!quota && !quota.frozen && (quota.hoursRemaining > 0 || quota.finalReviewHours > 0) && !!materia.examDate && !readiness.dataScaduta;

  return (
    <section className={CARD_NOPAD} aria-label="Prontezza d'esame">
      <div className="p-4 sm:p-5 flex flex-col lg:flex-row gap-5">
        <div className="flex items-center gap-4 lg:w-64 shrink-0">
          <ScoreRing score={readiness.score} className={meta.tone} />
          <div className="min-w-0">
            <p className="ds-eyebrow">Prontezza d'esame</p>
            <p className={`text-lg font-bold tracking-tight ${meta.tone}`}>{sentenceCase(meta.label)}</p>
            {(readiness.daysRemaining != null || readiness.dataScaduta) && (
              <p className={`text-xs mt-0.5 ${readiness.dataScaduta ? 'text-accent' : 'text-slate-500'}`}>
                {readiness.dataScaduta
                  ? 'Appello già passato'
                  : readiness.daysRemaining === 0
                  ? 'La prova è oggi'
                  : readiness.daysRemaining === 1
                  ? 'Un giorno alla prova'
                  : `${readiness.daysRemaining} giorni alla prova`}
                {' · '}
                {formatoMeta(materia).short}
              </p>
            )}
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 gap-x-5 gap-y-3.5 content-center">
          <ReadinessPillar label="Copertura" value={readiness.parts.coverage} known={readiness.known.hasNodes} hint="Quanta parte del programma hai STUDIATO (i riassunti da soli non bastano)" />
          <ReadinessPillar
            label="Memoria"
            value={readiness.parts.memory}
            known={readiness.known.hasMemory}
            hint="Ricordo stimato oggi degli argomenti completati (Spider-Sense)"
          />
          <ReadinessPillar
            label="Esercizi"
            value={readiness.parts.practice}
            known={readiness.known.hasPractice}
            optional={!scritto}
            hint={scritto ? 'Esercizi corretti, simulazioni e interrogazioni recenti' : 'Per un esame orale conta solo se c’è: interrogazioni e simulazioni'}
          />
          <ReadinessPillar
            label="Fattibilità"
            value={readiness.parts.feasibility}
            known={readiness.known.hasFeasibility}
            hint="Il lavoro che resta, dentro il piano con tutte le materie"
          />
        </div>
      </div>

      <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-3.5">
        <p className="text-sm text-slate-300 leading-relaxed">{readiness.rationale}</p>

        {readiness.memoryAtExam != null && readiness.parts.memory != null && readiness.memoryAtExam < readiness.parts.memory - 0.05 && (
          <p className="text-xs text-slate-400 leading-relaxed">
            Senza altri ripassi, il giorno della prova il ricordo scenderebbe al <span className="text-slate-200 ds-num">{Math.round(readiness.memoryAtExam * 100)}%</span>: i
            ripassi in calendario servono a tenerlo su.
          </p>
        )}

        {pratica.length > 0 && <p className="text-xs text-slate-500">Pratica recente: {pratica.join(' · ')}.</p>}

        {readiness.gates?.length > 0 && readiness.verdict !== 'UNKNOWN' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">Per il “Sostieni” manca:</span>
            {readiness.gates.map((g) => (
              <span key={g} className="ds-badge ds-badge-slate !normal-case !tracking-normal">
                {GATE_LABEL[g] || g}
              </span>
            ))}
          </div>
        )}

        {showPiano && (
          <div className="ds-well p-3.5 space-y-1.5">
            <p className="ds-eyebrow">Ci arrivi in tempo?</p>
            <p className={`text-sm ${late > 0.05 ? 'text-primary' : 'text-slate-300'}`}>
              {fine ? (
                <>
                  Fine prevista{' '}
                  <span className="font-semibold ds-num">
                    {quota.finePrevistaStimata ? '~' : ''}
                    {formatDateShort(fine, today)}
                  </span>
                  , prova il{' '}
                  <span className="font-semibold ds-num">{formatDateShort(materia.examDate, today)}</span>
                  {late > 0.05
                    ? ` — al tuo ritmo ${formatHoursMinutes(late)} restano scoperte.`
                    : margine != null && margine > 0
                    ? ` — ${giorniLabel(margine)} di margine per i ripassi finali.`
                    : ' — giusto in tempo.'}
                </>
              ) : quota.finePrevistaOltreOrizzonte ? (
                'Al ritmo attuale il lavoro non chiude nell’orizzonte del piano.'
              ) : (
                'Programma chiuso: restano i ripassi finali.'
              )}
            </p>
            <p className="text-xs text-slate-500">
              {formatHoursMinutes(quota.hoursRemaining)} di lavoro
              {quota.sintesiHours > 0 ? ` (di cui ${formatHoursMinutes(quota.sintesiHours)} di sintesi)` : ''}
              {quota.finalReviewHours > 0 ? ` + ${formatHoursMinutes(quota.finalReviewHours)} di ripasso finale` : ''}, calcolate sul tuo ritmo e sulle altre materie in calendario.
            </p>
          </div>
        )}

        {readiness.confidence < 0.75 && readiness.verdict !== 'UNKNOWN' && (
          <p className="text-xs text-slate-500">
            Confidenza parziale: alcuni pilastri non hanno ancora dati reali (n/d). Il verdetto si affina con ripassi, esercizi e simulazioni registrati.
          </p>
        )}
      </div>
    </section>
  );
}
