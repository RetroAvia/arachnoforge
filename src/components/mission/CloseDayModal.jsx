import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../Modal.jsx';
import Dropdown from '../Dropdown.jsx';
import { Icon } from '../Icons.jsx';
import { WORK_MODE, WORK_MODE_META } from '../../utils/sintesiEngine.js';
import { nodesInTreeOrder, pickNode } from '../../utils/nowTarget.js';
import { formatHoursMinutes, formatDateRelative } from '../../utils/dateUtils.js';
import { minutiLabel, plurale } from '../../utils/format.js';
import { BTN_PRIMARY, BTN_GHOST, INPUT, LABEL } from '../../utils/designSystem.js';

/**
 * V42 — "CHIUDI LA GIORNATA".
 *
 * Il momento che mancava contro la procrastinazione: la sera, in un
 * minuto, il bilancio di oggi (senza giudizi: il piano assorbe le
 * differenze) e il PRIMO BLOCCO di domani deciso adesso, con l'ora di
 * partenza. Domattina Mission Control lo propone per primo, avviabile con
 * un click: niente da decidere quando la voglia è al minimo.
 */

const ENERGIA = [
  { v: 1, label: 'Scarico' },
  { v: 2, label: 'Basso' },
  { v: 3, label: 'Normale' },
  { v: 4, label: 'Buono' },
  { v: 5, label: 'Al top' }
];

const MODI = [WORK_MODE.SINTESI, WORK_MODE.STUDIO, WORK_MODE.RIPASSO, WORK_MODE.ESERCIZI];

function verdetto(minuti, obiettivoMin) {
  if (obiettivoMin <= 0) return minuti > 0 ? 'Oggi il piano non chiedeva nulla: quello che hai fatto è tutto anticipo.' : 'Giornata libera dal piano.';
  const r = minuti / obiettivoMin;
  if (r >= 1) return 'Obiettivo centrato. Domani si riparte da qui.';
  if (r >= 0.7) return 'Quasi tutto: la differenza il piano la spalma sui prossimi giorni.';
  if (minuti > 0) return 'Giornata corta: capita. Il piano di domani è già ricalcolato su quello che manca.';
  return 'Oggi niente studio: nessun dramma. Conta ripartire domani, e il primo blocco lo decidi adesso.';
}

export default function CloseDayModal({
  open,
  onClose,
  onSave,
  todayKey,
  todayMinutes = 0,
  plan = null,
  draft = null,
  materie = [],
  streak = null,
  existingPlan = null,
  defaultFocusMinutes = 25,
  defaultOraInizio = '09:00',
  alreadyClosed = false
}) {
  const [energia, setEnergia] = useState(null);
  const [nota, setNota] = useState('');
  const [oraInizio, setOraInizio] = useState(defaultOraInizio);
  const [materiaId, setMateriaId] = useState('');
  const [modo, setModo] = useState(WORK_MODE.STUDIO);
  const [sfidaId, setSfidaId] = useState('');
  const [minuti, setMinuti] = useState(defaultFocusMinutes);

  const attive = useMemo(() => (Array.isArray(materie) ? materie : []).filter((m) => m && !m.examPassed), [materie]);

  // All'apertura: il piano già salvato per domani, altrimenti la prima voce
  // della bozza del planner.
  useEffect(() => {
    if (!open) return;
    const pb = existingPlan?.primoBlocco || null;
    const primo = draft?.items?.[0] || null;
    const mId = pb?.materiaId || primo?.materiaId || attive[0]?.id || '';
    const md = pb?.modo || primo?.modo || WORK_MODE.STUDIO;
    setMateriaId(mId);
    setModo(md);
    setSfidaId(pb?.sfidaId || primo?.sfidaId || '');
    setMinuti(pb?.minuti || Math.min(primo?.minuti || defaultFocusMinutes, Math.max(defaultFocusMinutes, 25)));
    setOraInizio(existingPlan?.oraInizio || defaultOraInizio);
    setNota(existingPlan?.nota || '');
    setEnergia(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const materia = attive.find((m) => m.id === materiaId) || null;

  const nodoOptions = useMemo(() => {
    if (!materia) return [];
    const nodi = nodesInTreeOrder(materia).filter((s) => (modo === WORK_MODE.RIPASSO ? s.status === 'COMPLETED' : s.status !== 'COMPLETED'));
    return [{ value: '', label: 'Tutta la materia' }, ...nodi.map((s) => ({ value: s.id, label: s.nome || 'Argomento senza nome' }))];
  }, [materia, modo]);

  // Cambiando materia o modo, l'argomento si riallinea al suggerito.
  const onMateria = (id) => {
    setMateriaId(id);
    const m = attive.find((x) => x.id === id);
    const voce = draft?.items?.find((i) => i.materiaId === id);
    const md = voce?.modo || modo;
    setModo(md);
    setSfidaId(pickNode(m, md, draft?.dateKey)?.id || '');
  };
  const onModo = (md) => {
    setModo(md);
    setSfidaId(pickNode(materia, md, draft?.dateKey)?.id || '');
  };

  const obiettivoMin = Math.round((plan?.targetHours || 0) * 60);
  const rev = plan?.reviews || {};

  const salva = () => {
    const min = Math.max(5, Math.min(120, Math.round(Number(minuti) || defaultFocusMinutes)));
    const items = (draft?.items || []).map((i) => ({ materiaId: i.materiaId, sfidaId: i.sfidaId || null, minuti: i.minuti, modo: i.modo }));
    onSave({
      dateKey: todayKey,
      minuti: todayMinutes,
      obiettivoMin,
      energia,
      nota,
      tomorrowPlan: materiaId
        ? {
            dateKey: draft?.dateKey,
            oraInizio: /^\d{2}:\d{2}$/.test(oraInizio) ? oraInizio : null,
            items,
            primoBlocco: { materiaId, sfidaId: sfidaId || null, minuti: min, modo },
            nota
          }
        : null
    });
  };

  const domaniLabel = draft?.dateKey ? formatDateRelative(draft.dateKey, todayKey) : 'domani';

  return (
    <Modal open={open} onClose={onClose} title={alreadyClosed ? 'Il piano di domani' : 'Chiudi la giornata'} maxWidth="max-w-2xl">
      <div className="space-y-6">
        {/* --- Bilancio di oggi ------------------------------------------ */}
        <section className="space-y-3">
          <p className="ds-eyebrow">Bilancio di oggi</p>
          <div className="ds-well px-4 py-3">
            <p className="text-sm text-slate-200">
              <span className="text-lg font-bold text-white ds-num">{minutiLabel(todayMinutes)}</span>
              {obiettivoMin > 0 ? <span className="text-slate-400"> di studio su {minutiLabel(obiettivoMin)} previsti</span> : <span className="text-slate-400"> di studio</span>}
            </p>
            <p className="text-sm text-slate-400 mt-1 leading-relaxed">{verdetto(todayMinutes, obiettivoMin)}</p>
            {(plan?.subjects || []).length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {plan.subjects.map((p) => (
                  <li key={p.materiaId} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-300 truncate">{p.nome}</span>
                    <span className="ds-num text-slate-400 shrink-0">
                      {formatHoursMinutes(Math.min(p.doneTodayHours || 0, p.todayTargetHours || 0))} / {formatHoursMinutes(p.todayTargetHours || 0)}
                    </span>
                  </li>
                ))}
                {(rev.total || 0) > 0 && (
                  <li className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-emerald-300/90">Ripassi</span>
                    <span className="ds-num text-slate-400">
                      {rev.done || 0} / {rev.targetCount || 0}
                    </span>
                  </li>
                )}
              </ul>
            )}
          </div>
          {streak && (
            <p className={`text-xs leading-relaxed flex items-start gap-2 ${streak.validaOggi ? 'text-emerald-300' : streak.aRischio ? 'text-accent' : 'text-slate-400'}`}>
              <Icon name="flame" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {streak.validaOggi
                ? `La serie è al sicuro: ${plurale(streak.streak, 'giorno', 'giorni')} di studio.`
                : streak.aRischio
                ? `Mancano ${streak.minutiMancanti} minuti perché oggi conti, e questa settimana non restano riposi${
                    streak.scudi > 0 ? ': domani userebbe uno Streak Shield.' : ': la serie ripartirebbe da capo.'
                  }`
                : `Oggi non conta per la serie (mancano ${streak.minutiMancanti} minuti): vale come giorno di riposo, te ne restano ${Math.max(0, streak.riposiRimasti - 1)} questa settimana.`}
            </p>
          )}
        </section>

        {/* --- Energia ---------------------------------------------------- */}
        <section className="space-y-2">
          <p className="ds-eyebrow">Com’era l’energia oggi? (facoltativo)</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Energia di oggi">
            {ENERGIA.map((e) => (
              <button
                key={e.v}
                type="button"
                role="radio"
                aria-checked={energia === e.v}
                onClick={() => setEnergia(energia === e.v ? null : e.v)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  energia === e.v ? 'border-secondary/60 bg-secondary/15 text-white' : 'border-line bg-surface text-slate-400 hover:text-slate-200 hover:border-line-strong'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </section>

        {/* --- Domani ------------------------------------------------------ */}
        <section className="space-y-3">
          <p className="ds-eyebrow">Il piano di {domaniLabel}</p>
          {draft && !draft.giornoLibero ? (
            <ul className="space-y-1.5">
              {draft.items.map((i) => (
                <li key={i.materiaId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-slate-200">
                    {i.nome}
                    <span className={`ml-2 text-xs ${WORK_MODE_META[i.modo]?.color || 'text-slate-400'}`}>{WORK_MODE_META[i.modo]?.label}</span>
                  </span>
                  <span className="ds-num text-slate-400 shrink-0">{formatHoursMinutes(i.minuti / 60)}</span>
                </li>
              ))}
              {draft.ripassiDomani > 0 && (
                <li className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-emerald-300/90">Ripassi in scadenza</span>
                  <span className="ds-num text-slate-400">{draft.ripassiDomani}</span>
                </li>
              )}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">
              {domaniLabel.charAt(0).toUpperCase() + domaniLabel.slice(1)} il piano non prevede studio
              {draft?.ripassiDomani > 0 ? `, solo ${plurale(draft.ripassiDomani, 'ripasso', 'ripassi')} in scadenza` : ''}. Se vuoi, fissa comunque un blocco.
            </p>
          )}

          <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-4 space-y-3">
            <p className="text-sm font-semibold text-white flex items-center gap-2">
              <Icon name="play" className="w-4 h-4 text-primary" />
              Il primo blocco, deciso adesso
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className={LABEL}>Materia</span>
                <Dropdown
                  value={materiaId}
                  onChange={onMateria}
                  options={[{ value: '', label: 'Nessun blocco fissato' }, ...attive.map((m) => ({ value: m.id, label: m.nome }))]}
                  ariaLabel="Materia del primo blocco"
                />
              </div>
              <div>
                <span className={LABEL}>Lavoro</span>
                <Dropdown
                  value={modo}
                  onChange={onModo}
                  options={MODI.map((md) => ({ value: md, label: WORK_MODE_META[md].label }))}
                  ariaLabel="Tipo di lavoro"
                />
              </div>
            </div>
            {materia && (
              <div>
                <span className={LABEL}>Argomento</span>
                <Dropdown value={sfidaId} onChange={setSfidaId} options={nodoOptions} ariaLabel="Argomento del primo blocco" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL} htmlFor="af-close-ora">
                  Si parte alle
                </label>
                <input id="af-close-ora" type="time" value={oraInizio} onChange={(e) => setOraInizio(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className={LABEL} htmlFor="af-close-min">
                  Minuti
                </label>
                <input
                  id="af-close-min"
                  type="number"
                  min={5}
                  max={120}
                  step={5}
                  value={minuti}
                  onChange={(e) => setMinuti(e.target.value)}
                  className={INPUT}
                />
              </div>
            </div>
            <div>
              <label className={LABEL} htmlFor="af-close-nota">
                Una riga per te, domattina (facoltativo)
              </label>
              <input
                id="af-close-nota"
                type="text"
                maxLength={200}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                className={INPUT}
                placeholder="Es. Inizia dagli esercizi sugli integrali, poi gli appunti del capitolo 4"
              />
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-2.5 flex-wrap">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Annulla
          </button>
          <button type="button" onClick={salva} className={BTN_PRIMARY}>
            <Icon name={alreadyClosed ? 'check' : 'moon'} className="w-4 h-4" />
            {alreadyClosed ? 'Aggiorna il piano di domani' : 'Chiudi la giornata'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
