// =====================================================================
// ArachnoForge — src/pages/SessionPlan.jsx (V42) · "Web-Swing Route"
// IL PIANO DELLA SESSIONE, GIORNO PER GIORNO.
//
// Mission Control risponde a "cosa faccio oggi". Qui si vede il percorso
// intero fino agli esami, calcolato dallo stesso planner:
//   - le scadenze di ogni materia: quando iniziare al più tardi, quando
//     chiudere gli appunti, quando finisci, le finestre di ripasso finale;
//   - le prossime settimane giorno per giorno, con le ore per materia, i
//     ripassi in scadenza, i giorni di riposo e gli esami;
//   - se il piano non sta nei tempi, gli scenari che lo rimettono in piedi
//     (appello successivo, rinuncia, un'ora in più), ricalcolati davvero.
// =====================================================================
import React, { useMemo, useState } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import PageHeader, { HeaderStat } from '../components/PageHeader.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { QUOTA_STATUS_META } from '../hooks/useKarenAutoRouter.js';
import { computePlanScenarios, planPressure } from '../utils/planScenarios.js';
import { timelineDayTotals } from '../utils/studyPlanner.js';
import { colorFor } from '../utils/materiaColors.js';
import { formatoMeta } from '../utils/appelli.js';
import { formatHoursMinutes, formatDateShort, formatDateRelative, addDaysToDateOnly, todayDateOnlyKey, isoWeekdayOfDateKey } from '../utils/dateUtils.js';
import { plurale } from '../utils/format.js';
import { CARD, CARD_NOPAD, BADGE, BTN_GHOST, BTN_SECONDARY, BTN_SM } from '../utils/designSystem.js';
import { goTo, ROUTES } from '../hooks/useArachnoForgeRouter.js';
import { INTENT, requestIntent } from '../utils/uiIntents.js';

const STATUS_BADGE = { OTTIMALE: BADGE.green, ATTENZIONE: BADGE.amber, CRITICO: BADGE.red, CONGELATA: BADGE.slate };
const GIORNI_VISTA = 21;
const GIORNO_BREVE = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

function Pietra({ label, data, oggi, tono = 'text-slate-200', nota }) {
  if (!data) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-sm font-semibold ds-num ${tono}`}>{formatDateRelative(data, oggi)}</p>
      {nota && <p className="text-[11px] text-slate-500">{nota}</p>}
    </div>
  );
}

/** Una materia con le sue date chiave. */
function ScadenzaCard({ q, materia, oggi }) {
  const meta = QUOTA_STATUS_META[q.status] || {};
  const c = colorFor(q.materiaId);
  const finestre = Array.isArray(q.finalReviewWindows) ? q.finalReviewWindows : [];
  const late = Number(q.lateHours) > 0.05;
  const inizioFuturo = q.inizioEntroDateKey && q.inizioEntroDateKey > oggi;
  return (
    <div className={`${CARD_NOPAD} p-4 space-y-3 ${q.status === 'CRITICO' ? '!border-primary/35' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${c.dot}`} />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => {
                goTo(ROUTES.QUADRANT_HUB);
                requestIntent(INTENT.WEBMATRIX_OPEN, { materiaId: q.materiaId });
              }}
              className="text-[15px] font-semibold text-white hover:underline text-left break-words"
            >
              {q.nome}
            </button>
            <p className="text-xs text-slate-500 mt-0.5">
              {q.examDate ? `${formatDateShort(q.examDate, oggi)} · ${q.daysRemaining === 0 ? 'oggi' : q.daysRemaining === 1 ? 'domani' : `fra ${q.daysRemaining} giorni`}` : 'Senza appello'}
              {materia ? ` · ${formatoMeta(materia).short}` : ''}
            </p>
          </div>
        </div>
        <span className={`${STATUS_BADGE[q.status] || BADGE.slate} shrink-0`}>{meta.label || q.status}</span>
      </div>

      {q.frozen ? (
        <p className="text-xs text-slate-400 leading-relaxed">
          Congelata: prima {q.prereqBloccanti?.map((b) => b.nome).join(', ') || q.missingPrereqNames?.join(', ')}.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {inizioFuturo ? (
              <Pietra label="Inizia entro" data={q.inizioEntroDateKey} oggi={oggi} tono="text-secondary" />
            ) : (
              <div>
                <p className="text-[11px] text-slate-500">Inizia entro</p>
                <p className={`text-sm font-semibold ${q.todayTargetHours > 0 ? 'text-secondary' : 'text-slate-400'}`}>{q.haLavoro ? 'già in corso' : '—'}</p>
              </div>
            )}
            <Pietra label="Appunti chiusi entro" data={q.sintesiHours > 0 ? q.chiusuraAppuntiDateKey : null} oggi={oggi} tono="text-accent" />
            <Pietra
              label={q.finePrevistaStimata ? 'Fine prevista (stima)' : 'Fine prevista'}
              data={q.finePrevistaDateKey}
              oggi={oggi}
              tono={late ? 'text-primary' : 'text-emerald-300'}
              nota={late ? `${formatHoursMinutes(q.lateHours)} scoperte all’esame` : q.pressioneDaAltri ? 'se gli esami prima non sforano' : null}
            />
            <div>
              <p className="text-[11px] text-slate-500">Lavoro</p>
              <p className="text-sm font-semibold text-slate-200 ds-num">{formatHoursMinutes(q.hoursRemaining + (q.finalReviewHours || 0))}</p>
              <p className="text-[11px] text-slate-500 ds-num">
                {[q.sintesiHours > 0 && `sintesi ${formatHoursMinutes(q.sintesiHours)}`, q.studioHours > 0 && `studio ${formatHoursMinutes(q.studioHours)}`, q.finalReviewHours > 0 && `ripasso ${formatHoursMinutes(q.finalReviewHours)}`]
                  .filter(Boolean)
                  .join(' · ') || 'solo ripassi'}
              </p>
            </div>
          </div>
          {finestre.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Ripasso finale:</span>
              {finestre.map((f) => (
                <span key={f.index} className="ds-badge ds-badge-slate !normal-case !tracking-normal ds-num" title={`${plurale(f.argomenti, 'argomento', 'argomenti')} da ripassare in questa finestra`}>
                  {formatDateShort(f.startKey, oggi)}–{formatDateShort(f.endKey, oggi)} · {formatHoursMinutes(f.hours)}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SessionPlan() {
  const { state, actions, derived, pushToast } = useArachnoForge();
  const oggi = todayDateOnlyKey();
  const plan = derived.planToday;
  const quotas = useMemo(() => (Array.isArray(derived.karenQuotas) ? derived.karenQuotas : []), [derived.karenQuotas]);
  const byId = useMemo(() => new Map((derived.materiePiano || []).map((m) => [m.id, m])), [derived.materiePiano]);
  const [confermaScenario, setConfermaScenario] = useState(null);

  // Il piano attuale nella forma che gli scenari confrontano.
  const basePlan = useMemo(() => ({ quotas, today: plan }), [quotas, plan]);
  const pressione = useMemo(() => planPressure(basePlan), [basePlan]);
  const scenari = useMemo(
    () => computePlanScenarios(derived.materiePiano, derived.planInputs, basePlan, { todayKey: oggi }),
    [derived.materiePiano, derived.planInputs, basePlan, oggi]
  );

  const conData = quotas.filter((q) => q.examDate && !q.dataScaduta).sort((a, b) => a.examDate.localeCompare(b.examDate));
  const senzaData = quotas.filter((q) => !q.examDate || q.dataScaduta);

  // Giorni: oggi (dal piano di oggi) + la timeline del planner.
  const giorni = useMemo(() => {
    const perData = new Map((derived.planTimeline || []).map((d) => [d.dateKey, d]));
    const esamiPerData = new Map();
    (derived.materiePiano || []).forEach((m) => {
      if (!m || m.examPassed) return;
      [m.examDate, m.oralDate].filter(Boolean).forEach((d) => {
        if (!esamiPerData.has(d)) esamiPerData.set(d, []);
        esamiPerData.get(d).push(m.nome);
      });
    });
    const ripassiPerData = new Map();
    (derived.allTrackedReviews || []).forEach((r) => {
      const d = r.nextReviewDate <= oggi ? oggi : r.nextReviewDate;
      ripassiPerData.set(d, (ripassiPerData.get(d) || 0) + 1);
    });
    const riposo = new Set(Array.isArray(state.settings.giorniRiposo) ? state.settings.giorniRiposo : []);
    return Array.from({ length: GIORNI_VISTA }, (_, i) => {
      const d = addDaysToDateOnly(oggi, i);
      let voci;
      let capacita;
      if (i === 0) {
        voci = (plan?.subjects || []).map((p) => ({ materiaId: p.materiaId, ore: p.todayTargetHours }));
        capacita = plan?.capacityHours || 0;
      } else {
        const g = perData.get(d);
        const tot = timelineDayTotals(g);
        voci = [...tot.entries()].map(([materiaId, x]) => ({ materiaId, ore: x.S + x.T + x.F }));
        capacita = g ? g.capacity : null;
      }
      return {
        dateKey: d,
        voci: voci.filter((v) => v.ore > 0.01),
        capacita,
        esami: esamiPerData.get(d) || [],
        ripassi: ripassiPerData.get(d) || 0,
        riposo: riposo.has(isoWeekdayOfDateKey(d))
      };
    });
  }, [derived.planTimeline, derived.materiePiano, derived.allTrackedReviews, plan, oggi, state.settings.giorniRiposo]);

  const scala = Math.max(1, ...giorni.map((g) => Math.max(g.capacita || 0, g.voci.reduce((a, v) => a + v.ore, 0))));
  const oreTotali = quotas.filter((q) => !q.frozen).reduce((a, q) => a + (q.hoursRemaining || 0) + (q.finalReviewHours || 0), 0);

  const applica = (sc) => {
    if (!sc?.applica) return;
    actions.updateMateria(sc.applica.materiaId, { appelloTargetId: sc.applica.appelloTargetId });
    pushToast(`${byId.get(sc.applica.materiaId)?.nome || 'Materia'}: obiettivo spostato al ${sc.applica.data}. Il piano è ricalcolato.`, 'success');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Piano della sessione"
        icon="calendar"
        title="Web-Swing Route"
        subtitle="Il percorso fino agli esami, giorno per giorno: quando iniziare, quando chiudere gli appunti, quando ripassare."
        actions={
          <>
            <HeaderStat icon="clock" label="in media al giorno" value={formatHoursMinutes(Number(derived.calibration?.hoursPerDay) || 0)} tone="text-secondary" />
            <HeaderStat icon="layers" label="di lavoro" value={formatHoursMinutes(oreTotali)} tone="text-slate-100" />
            <HeaderStat icon="flag" label="esami" value={String(conData.length)} tone="text-accent" />
          </>
        }
      />

      {quotas.length === 0 ? (
        <div className={CARD}>
          <EmptyState variant="radar" title="Nessuna materia in piano" subtitle="Aggiungi le materie nel Web-Matrix, con i loro appelli: il percorso si costruisce da solo." />
        </div>
      ) : (
        <>
          {/* Stato del piano e scenari. */}
          {pressione.critiche > 0 || pressione.lateHours >= 0.5 ? (
            <section className="ds-card ds-card-alert space-y-4" aria-label="Scenari">
              <div className="flex items-start gap-3">
                <Icon name="alertTriangle" className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-[15px] font-semibold text-primary">Il piano non sta nei tempi</p>
                  <p className="text-sm text-slate-300 mt-0.5 leading-relaxed">
                    Al tuo ritmo reale {formatHoursMinutes(pressione.lateHours)} di lavoro restano scoperte agli esami ({plurale(pressione.critiche, 'materia critica', 'materie critiche')}). Qui sotto
                    cosa cambierebbe con una scelta sola: il piano è ricalcolato davvero, con tutte le altre materie.
                  </p>
                </div>
              </div>
              {scenari.length > 0 && (
                <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                  {scenari.map((sc) => {
                    const meglio = sc.dopo.lateHours < sc.prima.lateHours - 0.5;
                    return (
                      <li key={sc.id} className="rounded-xl border border-line bg-surface px-4 py-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-white">{sc.titolo}</p>
                          {sc.applica && (
                            <button type="button" onClick={() => setConfermaScenario(sc)} className={`${BTN_SECONDARY} ${BTN_SM} shrink-0`}>
                              Punta al {formatDateShort(sc.applica.data, oggi)}
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">{sc.dettaglio}</p>
                        <p className={`text-xs ds-num ${meglio ? 'text-emerald-300' : 'text-slate-400'}`}>
                          Scoperte {formatHoursMinutes(sc.prima.lateHours)} → <span className="font-semibold">{formatHoursMinutes(sc.dopo.lateHours)}</span> · critiche {sc.prima.critiche} →{' '}
                          <span className="font-semibold">{sc.dopo.critiche}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-xs text-slate-500">
                Rinunciare a un appello non è un fallimento: è spostare il lavoro dove produce un voto. Decidi con i numeri, poi il piano segue.
              </p>
            </section>
          ) : (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/[0.06] px-4 py-3 flex items-start gap-3">
              <Icon name="check" className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-300 leading-relaxed">
                <span className="font-semibold text-emerald-300">Il piano sta nei tempi.</span> Seguendo le giornate proposte, ogni materia chiude prima del suo esame con il margine
                per i ripassi finali.
              </p>
            </div>
          )}

          {/* Le scadenze. */}
          <section className="space-y-3" aria-label="Scadenze">
            <h2 className="ds-h2">Le scadenze</h2>
            {conData.length === 0 ? (
              <p className="text-sm text-slate-500">Nessun appello in calendario: aggiungili nel Web-Matrix.</p>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {conData.map((q) => (
                  <ScadenzaCard key={q.materiaId} q={q} materia={byId.get(q.materiaId)} oggi={oggi} />
                ))}
              </div>
            )}
            {senzaData.length > 0 && (
              <p className="text-xs text-slate-500">
                Senza appello: {senzaData.map((q) => q.nome).join(', ')}. Restano studiabili quando avanza tempo, ma il piano non può metterle in calendario.
              </p>
            )}
          </section>

          {/* Giorno per giorno. */}
          <section className={`${CARD_NOPAD}`} aria-label="Giorno per giorno">
            <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3.5 border-b border-line">
              <div>
                <h2 className="text-[15px] font-semibold text-white">Le prossime tre settimane</h2>
                <p className="text-xs text-slate-500">Le ore che il piano mette ogni giorno, materia per materia. Si ricalcola da solo mentre studi.</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {conData.slice(0, 6).map((q) => (
                  <span key={q.materiaId} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className={`w-2 h-2 rounded-full ${colorFor(q.materiaId).dot}`} />
                    {q.nome}
                  </span>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-white/[0.05]">
              {giorni.map((g, i) => {
                const tot = g.voci.reduce((a, v) => a + v.ore, 0);
                return (
                  <li key={g.dateKey} className={`px-5 py-2.5 flex items-center gap-3 ${i === 0 ? 'bg-primary/[0.04]' : ''}`}>
                    <div className="w-20 shrink-0">
                      <p className={`text-xs font-semibold ${i === 0 ? 'text-primary' : 'text-slate-300'}`}>{i === 0 ? 'Oggi' : i === 1 ? 'Domani' : GIORNO_BREVE[isoWeekdayOfDateKey(g.dateKey)]}</p>
                      <p className="text-[11px] text-slate-500 ds-num">{formatDateShort(g.dateKey, oggi)}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      {g.esami.length > 0 ? (
                        <p className="text-xs font-semibold text-accent flex items-center gap-1.5">
                          <Icon name="flag" className="w-3.5 h-3.5" />
                          Esame: {g.esami.join(', ')}
                        </p>
                      ) : g.riposo || (g.capacita === 0 && tot === 0) ? (
                        <p className="text-xs text-slate-500">Riposo</p>
                      ) : tot === 0 ? (
                        <p className="text-xs text-slate-600">—</p>
                      ) : (
                        <div className="flex h-2.5 rounded-full overflow-hidden bg-white/[0.05]" style={{ width: `${Math.max(8, (tot / scala) * 100)}%` }}>
                          {g.voci.map((v) => (
                            <span
                              key={v.materiaId}
                              className={`h-full ${colorFor(v.materiaId).bar}`}
                              style={{ width: `${(v.ore / tot) * 100}%` }}
                              title={`${byId.get(v.materiaId)?.nome || ''}: ${formatHoursMinutes(v.ore)}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="w-28 shrink-0 text-right">
                      {tot > 0 && <p className="text-xs font-semibold text-slate-200 ds-num">{formatHoursMinutes(tot)}</p>}
                      {g.ripassi > 0 && <p className="text-[11px] text-emerald-300/80 ds-num">{plurale(g.ripassi, 'ripasso', 'ripassi')}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="px-5 py-3 border-t border-line flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-slate-500">
                Giorni di riposo, ore al giorno e orari si cambiano in Karen OS Settings › Piano di studio.
              </p>
              <button type="button" onClick={() => goTo(ROUTES.CORE_CONFIG)} className={`${BTN_GHOST} ${BTN_SM}`}>
                <Icon name="sliders" className="w-3.5 h-3.5" />
                Impostazioni del piano
              </button>
            </div>
          </section>
        </>
      )}

      <ConfirmDialog
        open={!!confermaScenario}
        onClose={() => setConfermaScenario(null)}
        onConfirm={() => {
          applica(confermaScenario);
          setConfermaScenario(null);
        }}
        title="Cambiare l’appello obiettivo?"
        message={
          confermaScenario
            ? `${byId.get(confermaScenario.applica?.materiaId)?.nome || ''}: il piano punterà all’appello del ${confermaScenario.applica?.data}. Puoi tornare indietro in ogni momento dal Web-Matrix.`
            : ''
        }
        confirmLabel="Sposta l’obiettivo"
        danger={false}
      />
    </div>
  );
}
