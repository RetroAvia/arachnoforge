import React, { useEffect, useId, useMemo, useState } from 'react';
import { useArachnoForge, useFocusTimerContext } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Dropdown from '../components/Dropdown.jsx';
import { goTo, ROUTES } from '../hooks/useArachnoForgeRouter.js';
import { CARD, H1, H2, INPUT, BTN_PRIMARY, BTN_SECONDARY, BTN_GHOST, BADGE } from '../utils/designSystem.js';
import { formatDateOnlyHuman, formatHoursMinutes, getDateKey, addDaysToDateOnly } from '../utils/dateUtils.js';
import {
  FASE,
  FASE_META,
  TIPO_LEZIONE,
  TIPO_LEZIONE_META,
  GIORNI,
  GIORNI_BREVI,
  isoWeekday,
  startOfWeek,
  timeToMinutes,
  minutesOfDay,
  focusSemester,
  suggestSemestre,
  validateLezione,
  nodoInSintesi,
  isValidDateKey
} from '../utils/campusEngine.js';

/**
 * V39.0 — EMPIRE STATE UNIVERSITY.
 *
 * L'università di Peter Parker, e la pagina in cui l'app impara in che
 * fase dell'anno sei. Tre cose, in ordine di frequenza d'uso:
 *
 *  1. OGGI — le lezioni di oggi, la prossima, e soprattutto la CODA DA
 *     SISTEMARE: le lezioni già finite che non hai ancora trasformato in
 *     appunti. Un tocco su "Avvia sintesi" fa partire il timer in modo
 *     Sintesi sull'argomento giusto e ti porta a Mission Control.
 *  2. ORARIO — la settimana del semestre, con le materie prese dal
 *     Web-Matrix: nessuna materia esiste qui senza esistere là.
 *  3. STARE AL PASSO — per ogni materia, quanta sintesi le lezioni già
 *     fatte questa settimana richiedono, e quanta ne hai fatta.
 *
 * Tutti i numeri vengono da `derived.campus` (utils/campusEngine.js):
 * questa pagina non calcola niente, disegna.
 */

/* ------------------------------------------------------------------ *
 * COLORI DELLE MATERIE
 * Stabili per id (non per posizione in lista): aggiungere o togliere una
 * materia non ricolora le altre. Classi letterali, così Tailwind le
 * include nel CSS.
 * ------------------------------------------------------------------ */
const PALETTE = [
  { bar: 'bg-cyan-400', block: 'bg-cyan-500/15 border-cyan-400/50 hover:bg-cyan-500/25', text: 'text-cyan-100', dot: 'bg-cyan-400' },
  { bar: 'bg-violet-400', block: 'bg-violet-500/15 border-violet-400/50 hover:bg-violet-500/25', text: 'text-violet-100', dot: 'bg-violet-400' },
  { bar: 'bg-amber-400', block: 'bg-amber-500/15 border-amber-400/50 hover:bg-amber-500/25', text: 'text-amber-100', dot: 'bg-amber-400' },
  { bar: 'bg-emerald-400', block: 'bg-emerald-500/15 border-emerald-400/50 hover:bg-emerald-500/25', text: 'text-emerald-100', dot: 'bg-emerald-400' },
  { bar: 'bg-rose-400', block: 'bg-rose-500/15 border-rose-400/50 hover:bg-rose-500/25', text: 'text-rose-100', dot: 'bg-rose-400' },
  { bar: 'bg-sky-400', block: 'bg-sky-500/15 border-sky-400/50 hover:bg-sky-500/25', text: 'text-sky-100', dot: 'bg-sky-400' },
  { bar: 'bg-lime-400', block: 'bg-lime-500/15 border-lime-400/50 hover:bg-lime-500/25', text: 'text-lime-100', dot: 'bg-lime-400' },
  { bar: 'bg-fuchsia-400', block: 'bg-fuchsia-500/15 border-fuchsia-400/50 hover:bg-fuchsia-500/25', text: 'text-fuchsia-100', dot: 'bg-fuchsia-400' }
];

function colorFor(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const HOUR_PX = 56;

function minutiLabel(min) {
  return formatHoursMinutes((Number(min) || 0) / 60);
}

/** "fra 40 min" oggi, "domani alle 09:00", "mercoledì alle 11:00". */
function quandoProssima(p) {
  if (!p) return '';
  if (p.giorniDistanza === 0) {
    const min = p.minutiAllInizio;
    if (min <= 0) return 'adesso';
    if (min < 60) return `fra ${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `fra ${h}h ${m}m` : `fra ${h}h`;
  }
  if (p.giorniDistanza === 1) return `domani alle ${p.inizio}`;
  return `${GIORNI[p.giorno].toLowerCase()} alle ${p.inizio}`;
}

/** Disposizione delle lezioni sovrapposte dello stesso giorno, affiancate. */
function layoutDay(lezioni) {
  const sorted = [...lezioni].sort((a, b) => timeToMinutes(a.inizio) - timeToMinutes(b.inizio));
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    cluster.forEach((l) => {
      const start = timeToMinutes(l.inizio);
      let idx = cols.findIndex((end) => end <= start);
      if (idx === -1) {
        idx = cols.length;
        cols.push(0);
      }
      cols[idx] = timeToMinutes(l.fine);
      out.push({ ...l, col: idx });
    });
    const n = cols.length;
    out.slice(out.length - cluster.length).forEach((l) => {
      l.cols = n;
    });
    cluster = [];
    clusterEnd = -1;
  };
  sorted.forEach((l) => {
    if (cluster.length && timeToMinutes(l.inizio) >= clusterEnd) flush();
    cluster.push(l);
    clusterEnd = Math.max(clusterEnd, timeToMinutes(l.fine));
  });
  if (cluster.length) flush();
  return out;
}

/* ================================================================== *
 * FASE
 * ================================================================== */

function PhaseCard({ snap, onSetOverride }) {
  const meta = FASE_META[snap.fase];
  const idFino = useId();
  const [finoA, setFinoA] = useState(() => addDaysToDateOnly(startOfWeek(snap.oggi), 6));
  const scelta = snap.automatica ? 'AUTO' : snap.fase;

  const imposta = (valore) => {
    if (valore === 'AUTO') onSetOverride(null);
    else onSetOverride(valore, isValidDateKey(finoA) && finoA >= snap.oggi ? finoA : addDaysToDateOnly(snap.oggi, 6));
  };

  let dettaglio;
  if (snap.semestre) {
    dettaglio = `${snap.semestre.nome} · settimana ${snap.settimana} di ${snap.settimaneTotali} · ${
      snap.giorniAllaFine > 0 ? `${snap.giorniAllaFine} giorni alla fine delle lezioni` : 'ultimo giorno di lezioni'
    }`;
  } else if (snap.prossimoSemestre) {
    dettaglio = `Nessun periodo di lezione in corso. ${snap.prossimoSemestre.nome} inizia ${
      snap.giorniAlProssimo === 1 ? 'domani' : `fra ${snap.giorniAlProssimo} giorni`
    }.`;
  } else {
    dettaglio = 'Nessun periodo di lezione in corso.';
  }

  return (
    <section className={`${CARD} space-y-5`}>
      <div className="flex items-start gap-4">
        <div
          className={`w-14 h-14 rounded-2xl border flex items-center justify-center shrink-0 ${meta.border} ${meta.bg} ${meta.tone}`}
        >
          <Icon name={meta.icon} className="w-7 h-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-mono tracking-widest text-slate-500">FASE DI STUDIO</p>
          <p className={`text-2xl font-extrabold tracking-tight ${meta.tone}`}>{meta.titolo}</p>
          <p className="text-sm text-slate-300 mt-1 leading-relaxed">{dettaglio}</p>
          {snap.sospeso && (
            <p className="text-sm text-accent mt-1">Oggi le lezioni sono sospese.</p>
          )}
        </div>
      </div>

      <p className="text-sm text-slate-400 leading-relaxed">{meta.descrizione}</p>

      <div className="space-y-2.5">
        <p className="text-xs font-semibold tracking-widest text-slate-400">MODALITÀ</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Modalità di studio">
          {[
            { v: 'AUTO', label: 'Automatica', icon: 'radar' },
            { v: FASE.LEZIONI, label: 'Lezioni', icon: FASE_META.LEZIONI.icon },
            { v: FASE.SESSIONE, label: 'Sessione', icon: FASE_META.SESSIONE.icon }
          ].map((o) => {
            const attivo = scelta === o.v;
            return (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={attivo}
                onClick={() => imposta(o.v)}
                className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors duration-200 ${
                  attivo
                    ? 'border-secondary/60 bg-secondary/15 text-white'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200 hover:border-white/25'
                }`}
              >
                <Icon name={o.icon} className="w-4 h-4 shrink-0" />
                {o.label}
              </button>
            );
          })}
        </div>
        {snap.automatica ? (
          <p className="text-xs text-slate-500 leading-relaxed">
            Karen decide da sola: Lezioni dentro i periodi dei semestri qui sotto, Sessione fuori.
          </p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
            <span>Forzata fino al</span>
            <label htmlFor={idFino} className="sr-only">
              Data di scadenza della forzatura
            </label>
            <input
              id={idFino}
              type="date"
              value={snap.override?.finoA || finoA}
              min={snap.oggi}
              onChange={(e) => {
                setFinoA(e.target.value);
                if (isValidDateKey(e.target.value) && e.target.value >= snap.oggi) onSetOverride(snap.fase, e.target.value);
              }}
              className="bg-surface/80 border border-secondary/30 rounded-lg px-2.5 py-1.5 text-slate-100 text-xs focus:outline-none focus:border-primary"
            />
            <span className="text-slate-500">— poi torna automatica da sola.</span>
          </div>
        )}
      </div>
    </section>
  );
}

/* ================================================================== *
 * OGGI
 * ================================================================== */

function TodayCard({ snap, materieById, onAvviaSintesi }) {
  const prossima = snap.prossima;
  return (
    <section className={`${CARD} space-y-5`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="clock" className="w-5 h-5 text-cyan-300" />
          OGGI · {GIORNI[isoWeekday(snap.oggi)].toUpperCase()}
        </h2>
        {prossima && !prossima.inCorso && (
          <span className={BADGE.cyan}>
            Prossima: {prossima.materia.nome} · {quandoProssima(prossima)}
          </span>
        )}
      </div>

      {snap.lezioniOggi.length === 0 ? (
        <p className="text-sm text-slate-400">
          {snap.sospeso ? 'Lezioni sospese.' : 'Nessuna lezione oggi.'}
          {prossima && ` La prossima è ${prossima.materia.nome}, ${quandoProssima(prossima)}.`}
        </p>
      ) : (
        <ol className="space-y-2">
          {snap.lezioniOggi.map((l) => {
            const c = colorFor(l.materiaId);
            return (
              <li
                key={l.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  l.stato === 'IN_CORSO' ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 bg-surface/60'
                }`}
              >
                <span className={`w-1.5 self-stretch rounded-full ${c.bar}`} />
                <span className="font-mono af-mono-nums text-sm text-slate-300 shrink-0 w-12 sm:w-24">
                  <span className="sm:hidden">
                    {l.inizio}
                    <span className="block text-xs text-slate-500">{l.fine}</span>
                  </span>
                  <span className="hidden sm:inline">
                    {l.inizio}–{l.fine}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-100 break-words leading-snug">{l.materia.nome}</span>
                  <span className="block text-xs text-slate-500">
                    {TIPO_LEZIONE_META[l.tipo].label}
                    {l.aula ? ` · ${l.aula}` : ''}
                  </span>
                </span>
                <span
                  className={`text-[11px] font-mono shrink-0 ${
                    l.stato === 'IN_CORSO' ? 'text-cyan-300' : l.stato === 'FINITA' ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  {l.stato === 'IN_CORSO' ? '● in corso' : l.stato === 'FINITA' ? 'finita' : 'più tardi'}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="pt-4 border-t border-white/10 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-bold tracking-widest text-accent flex items-center gap-2">
            <Icon name="flask" className="w-4 h-4" />
            DA SISTEMARE
          </p>
          {snap.coda.length > 0 && (
            <span className="text-xs text-slate-500">
              {snap.coda.length === 1 ? '1 lezione' : `${snap.coda.length} materie`} ancora da trasformare in appunti
            </span>
          )}
        </div>
        {snap.coda.length === 0 ? (
          <p className="text-sm text-slate-400 leading-relaxed">
            Tutto in pari: nessuna lezione delle ultime 72 ore aspetta di essere sistemata. Una lezione esce da qui quando
            chiudi una sessione in modo <span className="text-accent">Sintesi</span> su quella materia.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {snap.coda.map((l) => {
              const materia = materieById.get(l.materiaId);
              const nodo = nodoInSintesi(materia);
              const c = colorFor(l.materiaId);
              return (
                <li
                  key={`${l.materiaId}_${l.dateKey}`}
                  className="rounded-xl border border-accent/30 bg-accent/[0.06] p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span className={`w-2.5 h-2.5 mt-1.5 rounded-full shrink-0 ${c.dot}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100">{l.materia.nome}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {l.lezioniDaSistemare > 1
                          ? `${l.lezioniDaSistemare} lezioni (${minutiLabel(l.minutiDaSistemare)})`
                          : `Lezione delle ${l.inizio} di ${l.dateKey === snap.oggi ? 'oggi' : GIORNI[isoWeekday(l.dateKey)].toLowerCase()}`}
                        {' · '}
                        {l.oreFa < 1 ? 'appena finita' : `${l.oreFa}h fa`}
                      </p>
                      <p className="text-xs mt-1 text-slate-500">
                        {nodo ? (
                          <>
                            Argomento in sintesi: <span className="text-slate-300">{nodo.nome}</span>
                          </>
                        ) : (
                          'Nessun argomento con fonti aperte: la sessione verrà registrata sulla materia.'
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAvviaSintesi(l.materiaId, nodo?.id || null)}
                    className={`${BTN_PRIMARY} !px-4 !py-2.5 shrink-0 w-full sm:w-auto`}
                  >
                    <Icon name="play" className="w-4 h-4" />
                    Avvia sintesi
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ================================================================== *
 * ORARIO SETTIMANALE
 * ================================================================== */

function LessonBlock({ l, onClick, style }) {
  const c = colorFor(l.materiaId);
  const alto = (style?.height ?? 0) >= 64;
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={`absolute rounded-lg border text-left px-2 py-1.5 overflow-hidden transition-colors duration-200 ${c.block}`}
      title={`${l.materia?.nome ?? ''} · ${l.inizio}–${l.fine}${l.aula ? ` · ${l.aula}` : ''}`}
    >
      <span className={`block text-xs font-semibold leading-tight line-clamp-2 ${c.text}`}>{l.materia?.nome}</span>
      <span className="block text-[10px] font-mono text-slate-300/80 mt-0.5">
        {l.inizio}–{l.fine}
      </span>
      {alto && (l.aula || l.tipo !== TIPO_LEZIONE.LEZIONE) && (
        <span className="block text-[10px] text-slate-400 mt-0.5 truncate">
          {l.tipo !== TIPO_LEZIONE.LEZIONE ? TIPO_LEZIONE_META[l.tipo].short : ''}
          {l.aula && l.tipo !== TIPO_LEZIONE.LEZIONE ? ' · ' : ''}
          {l.aula}
        </span>
      )}
    </button>
  );
}

function Timetable({ semestre, materieById, oggi, adessoMin, inCorso, onAdd, onEdit }) {
  const lezioni = useMemo(
    () =>
      (semestre?.lezioni || [])
        .filter((l) => materieById.has(l.materiaId))
        .map((l) => ({ ...l, materia: materieById.get(l.materiaId) })),
    [semestre, materieById]
  );

  const giorni = useMemo(() => {
    const base = [1, 2, 3, 4, 5];
    if (lezioni.some((l) => l.giorno === 6)) base.push(6);
    if (lezioni.some((l) => l.giorno === 7)) base.push(7);
    return base;
  }, [lezioni]);

  const oggiG = isoWeekday(oggi);
  const [giornoMobile, setGiornoMobile] = useState(() => (oggiG <= 5 ? oggiG : 1));

  const { oraInizio, oraFine } = useMemo(() => {
    if (lezioni.length === 0) return { oraInizio: 8, oraFine: 18 };
    const minS = Math.min(...lezioni.map((l) => timeToMinutes(l.inizio)));
    const maxE = Math.max(...lezioni.map((l) => timeToMinutes(l.fine)));
    return { oraInizio: Math.min(8, Math.floor(minS / 60)), oraFine: Math.max(18, Math.ceil(maxE / 60)) };
  }, [lezioni]);

  const ore = [];
  for (let h = oraInizio; h < oraFine; h += 1) ore.push(h);
  const altezza = (oraFine - oraInizio) * HOUR_PX;
  const perGiorno = (g) => layoutDay(lezioni.filter((l) => l.giorno === g));
  const nowTop = ((adessoMin - oraInizio * 60) / 60) * HOUR_PX;
  const mostraNow = inCorso && giorni.includes(oggiG) && adessoMin >= oraInizio * 60 && adessoMin <= oraFine * 60;

  const listaMobile = perGiorno(giornoMobile);

  return (
    <>
      {/* ---- Desktop: griglia oraria ---- */}
      <div className="hidden lg:block">
        <div
          className="grid"
          style={{ gridTemplateColumns: `3rem repeat(${giorni.length}, minmax(0, 1fr))` }}
        >
          <div />
          {giorni.map((g) => (
            <div key={g} className="px-1.5 pb-2 flex items-center justify-between gap-1">
              <span
                className={`text-xs font-bold tracking-widest ${
                  inCorso && g === oggiG ? 'text-cyan-300' : 'text-slate-400'
                }`}
              >
                {GIORNI_BREVI[g].toUpperCase()}
              </span>
              <button
                type="button"
                onClick={() => onAdd(g)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-cyan-300 hover:bg-white/[0.05] transition-colors"
                aria-label={`Aggiungi una lezione il ${GIORNI[g].toLowerCase()}`}
              >
                <Icon name="plus" className="w-4 h-4" />
              </button>
            </div>
          ))}

          <div className="relative" style={{ height: altezza }}>
            {ore.map((h, i) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10px] font-mono text-slate-500"
                style={{ top: i * HOUR_PX }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {giorni.map((g) => (
            <div
              key={g}
              className={`relative border-l border-white/[0.06] ${inCorso && g === oggiG ? 'bg-cyan-500/[0.04]' : ''}`}
              style={{ height: altezza }}
            >
              {ore.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-white/[0.05]" style={{ top: i * HOUR_PX }} />
              ))}
              {perGiorno(g).map((l) => {
                const top = ((timeToMinutes(l.inizio) - oraInizio * 60) / 60) * HOUR_PX;
                const h = Math.max(26, ((timeToMinutes(l.fine) - timeToMinutes(l.inizio)) / 60) * HOUR_PX - 3);
                const w = 100 / l.cols;
                return (
                  <LessonBlock
                    key={l.id}
                    l={l}
                    onClick={() => onEdit(l)}
                    style={{ top: top + 1, height: h, left: `calc(${l.col * w}% + 3px)`, width: `calc(${w}% - 6px)` }}
                  />
                );
              })}
              {mostraNow && g === oggiG && (
                <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                  <div className="h-px bg-primary shadow-primary-glow" />
                  <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-primary" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ---- Mobile: un giorno alla volta ---- */}
      <div className="lg:hidden space-y-3">
        <div className="flex gap-1.5 overflow-x-auto af-scroll pb-1 -mx-1 px-1" role="tablist" aria-label="Giorno">
          {[1, 2, 3, 4, 5, 6, 7].map((g) => {
            const n = lezioni.filter((l) => l.giorno === g).length;
            const attivo = giornoMobile === g;
            return (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={attivo}
                onClick={() => setGiornoMobile(g)}
                className={`shrink-0 min-w-[3.25rem] rounded-xl border px-2.5 py-2 text-center transition-colors ${
                  attivo
                    ? 'border-cyan-400/60 bg-cyan-500/15 text-white'
                    : 'border-white/10 bg-white/[0.02] text-slate-400'
                }`}
              >
                <span className={`block text-xs font-bold ${inCorso && g === oggiG && !attivo ? 'text-cyan-300' : ''}`}>
                  {GIORNI_BREVI[g]}
                </span>
                <span className="block text-[10px] font-mono text-slate-500">{n || '—'}</span>
              </button>
            );
          })}
        </div>
        {listaMobile.length === 0 ? (
          <p className="text-sm text-slate-500 py-3">Nessuna lezione il {GIORNI[giornoMobile].toLowerCase()}.</p>
        ) : (
          <ul className="space-y-2">
            {listaMobile.map((l) => {
              const c = colorFor(l.materiaId);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => onEdit(l)}
                    className="w-full flex items-center gap-3 rounded-xl border border-white/10 bg-surface/60 px-3 py-3 text-left hover:border-white/25 transition-colors"
                  >
                    <span className={`w-1.5 self-stretch rounded-full ${c.bar}`} />
                    <span className="font-mono af-mono-nums text-sm text-slate-300 shrink-0">
                      {l.inizio}
                      <span className="block text-slate-500 text-xs">{l.fine}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-100 break-words">{l.materia.nome}</span>
                      <span className="block text-xs text-slate-500">
                        {TIPO_LEZIONE_META[l.tipo].label}
                        {l.aula ? ` · ${l.aula}` : ''}
                      </span>
                    </span>
                    <Icon name="edit" className="w-4 h-4 text-slate-500 shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" onClick={() => onAdd(giornoMobile)} className={`${BTN_GHOST} w-full`}>
          <Icon name="plus" className="w-4 h-4" />
          Aggiungi lezione il {GIORNI[giornoMobile].toLowerCase()}
        </button>
      </div>
    </>
  );
}

/* ================================================================== *
 * STARE AL PASSO
 * ================================================================== */

const PASSO_META = {
  IN_PARI: { label: 'In pari', cls: BADGE.green },
  QUASI: { label: 'Quasi', cls: BADGE.amber },
  INDIETRO: { label: 'Indietro', cls: BADGE.red },
  NESSUNA_LEZIONE: { label: 'Nessuna lezione ancora', cls: BADGE.slate }
};

function PaceCard({ snap, onSetRapporto }) {
  const rapporti = [0.5, 1, 1.5, 2];
  return (
    <section className={`${CARD} space-y-4`}>
      <div>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="gauge" className="w-5 h-5 text-cyan-300" />
          STARE AL PASSO · QUESTA SETTIMANA
        </h2>
        <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
          Per ogni ora di lezione già fatta, quanta sintesi le hai dedicato. Il dovuto cresce con le lezioni, non con
          il calendario: il martedì non devi ancora la sintesi della lezione del giovedì.
        </p>
      </div>

      <ul className="space-y-2.5">
        {snap.passo.map((r) => {
          const c = colorFor(r.materiaId);
          const pct = r.dovutoMin > 0 ? Math.min(100, Math.round((r.sintesiFattaMin / r.dovutoMin) * 100)) : r.sintesiFattaMin > 0 ? 100 : 0;
          const meta = PASSO_META[r.stato];
          return (
            <li key={r.materiaId} className="rounded-xl border border-white/10 bg-surface/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
                  <span className="text-sm font-semibold text-slate-100 break-words">{r.materia?.nome}</span>
                </span>
                <span className={meta.cls}>
                  {r.stato === 'INDIETRO' || r.stato === 'QUASI' ? `${meta.label} di ${minutiLabel(r.mancanoMin)}` : meta.label}
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface border border-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    r.stato === 'INDIETRO' ? 'bg-primary' : r.stato === 'QUASI' ? 'bg-accent' : 'bg-emerald-400'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[11px] font-mono af-mono-nums text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>{minutiLabel(r.lezioneSettMin)} di lezione a settimana</span>
                <span>dovute finora {minutiLabel(r.dovutoMin)}</span>
                <span className="text-slate-200">fatte {minutiLabel(r.sintesiFattaMin)}</span>
              </p>
            </li>
          );
        })}
      </ul>

      <div className="pt-3 border-t border-white/10 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-400">Ore di sintesi per ogni ora di lezione</span>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Rapporto sintesi su lezione">
          {rapporti.map((r) => {
            const attivo = Math.abs(snap.rapportoSintesi - r) < 0.01;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={attivo}
                onClick={() => onSetRapporto(r)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-mono transition-colors ${
                  attivo ? 'border-cyan-400/60 bg-cyan-500/15 text-white' : 'border-white/10 text-slate-400 hover:text-slate-200'
                }`}
              >
                {String(r).replace('.', ',')}×
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ================================================================== *
 * SEMESTRI
 * ================================================================== */

function statoSemestre(s, oggi) {
  if (s.inizio <= oggi && oggi <= s.fine) return { label: 'In corso', cls: BADGE.cyan };
  if (s.inizio > oggi) return { label: 'In arrivo', cls: BADGE.blue };
  return { label: 'Concluso', cls: BADGE.slate };
}

function SemestriCard({ semestri, oggi, selectedId, onSelect, onNew, onEdit }) {
  return (
    <section className={`${CARD} space-y-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="archive" className="w-5 h-5 text-secondary" />
          SEMESTRI
        </h2>
        <button type="button" onClick={onNew} className={`${BTN_GHOST} !py-2`}>
          <Icon name="plus" className="w-4 h-4" />
          Nuovo semestre
        </button>
      </div>
      <p className="text-sm text-slate-400 leading-relaxed">
        I periodi in cui segui le lezioni. Dentro questi periodi l'app è in modalità Lezioni, fuori in Sessione.
      </p>
      <ul className="space-y-2">
        {semestri.map((s) => {
          const st = statoSemestre(s, oggi);
          const attivo = s.id === selectedId;
          return (
            <li
              key={s.id}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                attivo ? 'border-secondary/50 bg-secondary/[0.07]' : 'border-white/10 bg-surface/60'
              }`}
            >
              <button type="button" onClick={() => onSelect(s.id)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-100">{s.nome}</span>
                  <span className={st.cls}>{st.label}</span>
                </span>
                <span className="block text-xs text-slate-500 mt-1">
                  {formatDateOnlyHuman(s.inizio)} → {formatDateOnlyHuman(s.fine)} · {s.lezioni.length}{' '}
                  {s.lezioni.length === 1 ? 'lezione' : 'lezioni'} a settimana
                  {s.sospensioni.length > 0 ? ` · ${s.sospensioni.length} giorni sospesi` : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onEdit(s)}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-500 hover:text-secondary hover:bg-white/[0.04] transition-colors shrink-0"
                aria-label={`Modifica ${s.nome}`}
              >
                <Icon name="edit" className="w-4 h-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SemestreModal({ open, iniziale, onClose, onSave, onDelete }) {
  const ids = { nome: useId(), inizio: useId(), fine: useId(), sosp: useId() };
  const [nome, setNome] = useState(iniziale?.nome || '');
  const [inizio, setInizio] = useState(iniziale?.inizio || '');
  const [fine, setFine] = useState(iniziale?.fine || '');
  const [sospensioni, setSospensioni] = useState(iniziale?.sospensioni || []);
  const [nuovaSosp, setNuovaSosp] = useState('');

  const errore = !nome.trim()
    ? 'Dai un nome al semestre.'
    : !isValidDateKey(inizio) || !isValidDateKey(fine)
    ? 'Imposta le date di inizio e fine delle lezioni.'
    : fine < inizio
    ? 'La fine deve venire dopo l’inizio.'
    : null;

  const aggiungiSosp = () => {
    if (!isValidDateKey(nuovaSosp) || sospensioni.includes(nuovaSosp)) return;
    setSospensioni([...sospensioni, nuovaSosp].sort());
    setNuovaSosp('');
  };

  return (
    <Modal open={open} onClose={onClose} title={iniziale?.id ? 'Modifica semestre' : 'Nuovo semestre'}>
      <div className="space-y-4">
        <div>
          <label htmlFor={ids.nome} className="text-sm text-slate-400 block mb-1.5">
            Nome
          </label>
          <input
            id={ids.nome}
            value={nome}
            maxLength={60}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Es. 1° semestre 2026/27"
            className={INPUT}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={ids.inizio} className="text-sm text-slate-400 block mb-1.5">
              Inizio lezioni
            </label>
            <input id={ids.inizio} type="date" value={inizio} onChange={(e) => setInizio(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label htmlFor={ids.fine} className="text-sm text-slate-400 block mb-1.5">
              Fine lezioni
            </label>
            <input id={ids.fine} type="date" value={fine} min={inizio || undefined} onChange={(e) => setFine(e.target.value)} className={INPUT} />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor={ids.sosp} className="text-sm text-slate-400 block">
            Giorni senza lezione <span className="text-slate-500">(festività, ponti, scioperi)</span>
          </label>
          <div className="flex gap-2">
            <input
              id={ids.sosp}
              type="date"
              value={nuovaSosp}
              min={inizio || undefined}
              max={fine || undefined}
              onChange={(e) => setNuovaSosp(e.target.value)}
              className={`${INPUT} flex-1`}
            />
            <button type="button" onClick={aggiungiSosp} disabled={!isValidDateKey(nuovaSosp)} className={BTN_GHOST}>
              Aggiungi
            </button>
          </div>
          {sospensioni.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {sospensioni.map((d) => (
                <li key={d}>
                  <button
                    type="button"
                    onClick={() => setSospensioni(sospensioni.filter((x) => x !== d))}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.03] px-2.5 py-1 text-xs text-slate-300 hover:border-primary/50 hover:text-primary transition-colors"
                    aria-label={`Rimuovi ${formatDateOnlyHuman(d)}`}
                  >
                    {formatDateOnlyHuman(d)}
                    <Icon name="close" className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {errore && <p className="text-sm text-accent">{errore}</p>}

        <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
          {iniziale?.id ? (
            <button type="button" onClick={onDelete} className={`${BTN_GHOST} !text-primary hover:!border-primary/50`}>
              <Icon name="trash" className="w-4 h-4" />
              Elimina
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              Annulla
            </button>
            <button
              type="button"
              disabled={!!errore}
              onClick={() => onSave({ nome: nome.trim(), inizio, fine, sospensioni })}
              className={BTN_SECONDARY}
            >
              Salva
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== *
 * LEZIONE
 * ================================================================== */

function LezioneModal({ open, iniziale, materie, altreLezioni, onClose, onSave, onDelete }) {
  const ids = { materia: useId(), inizio: useId(), fine: useId(), aula: useId() };
  const [materiaId, setMateriaId] = useState(iniziale?.materiaId || '');
  const [giorno, setGiorno] = useState(iniziale?.giorno || 1);
  const [inizio, setInizio] = useState(iniziale?.inizio || '09:00');
  const [fine, setFine] = useState(iniziale?.fine || '11:00');
  const [tipo, setTipo] = useState(iniziale?.tipo || TIPO_LEZIONE.LEZIONE);
  const [aula, setAula] = useState(iniziale?.aula || '');

  const bozza = { id: iniziale?.id, materiaId, giorno, inizio, fine, tipo, aula };
  const v = validateLezione(bozza, altreLezioni);
  const opzioni = materie.map((m) => ({ value: m.id, label: m.nome }));

  return (
    <Modal open={open} onClose={onClose} title={iniziale?.id ? 'Modifica lezione' : 'Nuova lezione'}>
      <div className="space-y-4">
        <div>
          <label htmlFor={ids.materia} className="text-sm text-slate-400 block mb-1.5">
            Materia
          </label>
          <Dropdown
            id={ids.materia}
            value={materiaId}
            onChange={setMateriaId}
            options={opzioni}
            placeholder="Scegli dal Web-Matrix…"
            ariaLabel="Materia della lezione"
          />
        </div>

        <div>
          <p className="text-sm text-slate-400 mb-1.5">Giorno</p>
          <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label="Giorno della settimana">
            {[1, 2, 3, 4, 5, 6, 7].map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={giorno === g}
                onClick={() => setGiorno(g)}
                className={`rounded-lg border py-2 text-xs font-bold transition-colors ${
                  giorno === g ? 'border-cyan-400/60 bg-cyan-500/15 text-white' : 'border-white/10 text-slate-400 hover:text-slate-200'
                }`}
              >
                {GIORNI_BREVI[g]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={ids.inizio} className="text-sm text-slate-400 block mb-1.5">
              Inizio
            </label>
            <input id={ids.inizio} type="time" step={300} value={inizio} onChange={(e) => setInizio(e.target.value)} className={`${INPUT} font-mono`} />
          </div>
          <div>
            <label htmlFor={ids.fine} className="text-sm text-slate-400 block mb-1.5">
              Fine
            </label>
            <input id={ids.fine} type="time" step={300} value={fine} onChange={(e) => setFine(e.target.value)} className={`${INPUT} font-mono`} />
          </div>
        </div>

        <div>
          <p className="text-sm text-slate-400 mb-1.5">Tipo</p>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Tipo di lezione">
            {Object.keys(TIPO_LEZIONE).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tipo === t}
                onClick={() => setTipo(t)}
                className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${
                  tipo === t ? 'border-cyan-400/60 bg-cyan-500/15 text-white' : 'border-white/10 text-slate-400 hover:text-slate-200'
                }`}
              >
                {TIPO_LEZIONE_META[t].label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor={ids.aula} className="text-sm text-slate-400 block mb-1.5">
            Aula <span className="text-slate-500">(facoltativa)</span>
          </label>
          <input id={ids.aula} value={aula} maxLength={40} onChange={(e) => setAula(e.target.value)} placeholder="Es. Aula A1" className={INPUT} />
        </div>

        {v.errori.length > 0 && materiaId && <p className="text-sm text-primary">{v.errori[0]}</p>}
        {v.valida && v.sovrapposte.length > 0 && (
          <p className="text-sm text-accent leading-relaxed">
            Si sovrappone con {v.sovrapposte.length === 1 ? 'un’altra lezione' : `${v.sovrapposte.length} lezioni`} dello
            stesso giorno. Si può salvare comunque: nella griglia compariranno affiancate.
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
          {iniziale?.id ? (
            <button type="button" onClick={onDelete} className={`${BTN_GHOST} !text-primary hover:!border-primary/50`}>
              <Icon name="trash" className="w-4 h-4" />
              Elimina
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              Annulla
            </button>
            <button type="button" disabled={!v.valida} onClick={() => onSave(bozza)} className={BTN_SECONDARY}>
              Salva
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== *
 * PAGINA
 * ================================================================== */

export default function Campus() {
  const { state, actions, derived, pushToast, TIMER_STATUS } = useArachnoForge();
  const timer = useFocusTimerContext();
  const snap = derived.campus;
  const campus = state.campus || { semestri: [] };

  const materieAttive = useMemo(() => state.materie.filter((m) => m && !m.examPassed), [state.materie]);
  const materieById = useMemo(() => new Map(state.materie.map((m) => [m.id, m])), [state.materie]);
  const materieAttiveById = useMemo(() => new Map(materieAttive.map((m) => [m.id, m])), [materieAttive]);

  const [selectedSemId, setSelectedSemId] = useState(() => focusSemester(campus, getDateKey())?.id || null);
  const semestre =
    campus.semestri.find((s) => s.id === selectedSemId) || focusSemester(campus, snap.oggi) || campus.semestri[0] || null;

  const [lezioneModal, setLezioneModal] = useState(null); // { iniziale }
  const [semModal, setSemModal] = useState(null); // { iniziale }
  const [confirm, setConfirm] = useState(null); // { title, message, onConfirm }

  const adessoMin = minutesOfDay(new Date());
  const semestreInCorso = !!(semestre && semestre.inizio <= snap.oggi && snap.oggi <= semestre.fine);

  const avviaSintesi = (materiaId, sfidaId) => {
    const materia = materieById.get(materiaId);
    if (timer.awaitingDebrief || timer.status !== TIMER_STATUS.IDLE) {
      pushToast('C’è già una sessione aperta: chiudila da Mission Control prima di avviarne un’altra.', 'info');
      goTo(ROUTES.MISSION_CONTROL);
      return;
    }
    timer.startFocus(materiaId, sfidaId, false);
    const nodo = sfidaId ? materia?.sfide?.find((s) => s.id === sfidaId) : null;
    pushToast(`Sintesi avviata: ${materia?.nome ?? ''}${nodo ? ` — ${nodo.nome}` : ''}.`, 'success');
    goTo(ROUTES.MISSION_CONTROL);
  };

  const creaSemestreSuggerito = () => {
    const s = suggestSemestre(snap.oggi);
    actions.campusAddSemestre(s);
    pushToast(`${s.nome} creato. Controlla le date e aggiungi le lezioni.`, 'success');
  };

  // Se il semestre selezionato non esiste più (cancellato) o non ce n'era
  // uno, si ripiega su quello più pertinente a oggi.
  const semIds = campus.semestri.map((s) => s.id).join('|');
  useEffect(() => {
    if (!campus.semestri.some((s) => s.id === selectedSemId)) {
      setSelectedSemId(focusSemester(campus, getDateKey())?.id || campus.semestri[campus.semestri.length - 1]?.id || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semIds]);

  const apriNuovaLezione = (giorno) => {
    if (!semestre) return;
    if (materieAttive.length === 0) {
      pushToast('Aggiungi prima le materie nel Web-Matrix: l’orario usa quelle.', 'info');
      return;
    }
    const nelGiorno = semestre.lezioni.filter((l) => l.giorno === giorno);
    const ultimaFine = nelGiorno.length ? Math.max(...nelGiorno.map((l) => timeToMinutes(l.fine))) : 9 * 60;
    const inizio = Math.min(ultimaFine, 20 * 60);
    const pad = (n) => String(n).padStart(2, '0');
    setLezioneModal({
      iniziale: {
        giorno,
        inizio: `${pad(Math.floor(inizio / 60))}:${pad(inizio % 60)}`,
        fine: `${pad(Math.floor((inizio + 120) / 60) % 24)}:${pad((inizio + 120) % 60)}`
      }
    });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className={H1}>Empire State University</h1>
        <p className="text-base text-slate-400 leading-relaxed max-w-3xl">
          Semestre, orario e fase di studio. Durante le lezioni, Karen sa quali materie hai seguito oggi e ti ricorda di
          trasformarle in appunti finché sono fresche; in sessione, lascia comandare le date d'esame.
        </p>
      </header>

      <PhaseCard snap={snap} onSetOverride={(fase, finoA) => actions.campusSetOverride(fase, finoA)} />

      {campus.semestri.length === 0 ? (
        <section className={`${CARD} space-y-4 text-center py-10`}>
          <div className="w-16 h-16 mx-auto rounded-2xl border border-cyan-400/40 bg-cyan-500/10 flex items-center justify-center text-cyan-300">
            <Icon name="calendar" className="w-8 h-8" />
          </div>
          <div className="space-y-2 max-w-md mx-auto">
            <p className="text-lg font-semibold text-slate-100">Configura il tuo semestre</p>
            <p className="text-sm text-slate-400 leading-relaxed">
              Imposta il periodo delle lezioni e il tuo orario settimanale. Da lì l'app capisce da sola quando sei a
              lezione e quando in sessione.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button type="button" onClick={creaSemestreSuggerito} className={BTN_SECONDARY}>
              <Icon name="plus" className="w-4 h-4" />
              Crea {suggestSemestre(snap.oggi).nome}
            </button>
            <button type="button" onClick={() => setSemModal({ iniziale: suggestSemestre(snap.oggi) })} className={BTN_GHOST}>
              Scegli le date
            </button>
          </div>
        </section>
      ) : (
        <>
          {snap.fase === FASE.LEZIONI && (
            <TodayCard snap={snap} materieById={materieById} onAvviaSintesi={avviaSintesi} />
          )}

          <section className={`${CARD} space-y-4`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className={`${H2} flex items-center gap-2`}>
                  <Icon name="grid" className="w-5 h-5 text-cyan-300" />
                  ORARIO SETTIMANALE
                </h2>
                {semestre && (
                  <p className="text-sm text-slate-400 mt-1">
                    {semestre.nome} · {formatDateOnlyHuman(semestre.inizio)} → {formatDateOnlyHuman(semestre.fine)}
                  </p>
                )}
              </div>
              {campus.semestri.length > 1 && (
                <div className="w-full sm:w-64">
                  <Dropdown
                    value={semestre?.id || ''}
                    onChange={setSelectedSemId}
                    options={campus.semestri.map((s) => ({ value: s.id, label: s.nome }))}
                    ariaLabel="Semestre da visualizzare"
                  />
                </div>
              )}
            </div>

            {materieAttive.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 p-5 text-center space-y-3">
                <p className="text-sm text-slate-300">
                  L'orario usa le materie del Web-Matrix, e non ce n'è ancora nessuna da seguire.
                </p>
                <button type="button" onClick={() => goTo(ROUTES.QUADRANT_HUB)} className={BTN_GHOST}>
                  <Icon name="web" className="w-4 h-4" />
                  Vai al Web-Matrix
                </button>
              </div>
            ) : (
              semestre && (
                <>
                  {semestre.lezioni.length === 0 && (
                    <p className="text-sm text-slate-400">
                      Nessuna lezione ancora. Aggiungile giorno per giorno con{' '}
                      <span className="text-cyan-300">+</span>: la materia si sceglie fra quelle del Web-Matrix.
                    </p>
                  )}
                  <Timetable
                    semestre={semestre}
                    materieById={materieAttiveById}
                    oggi={snap.oggi}
                    adessoMin={adessoMin}
                    inCorso={semestreInCorso}
                    onAdd={apriNuovaLezione}
                    onEdit={(l) => setLezioneModal({ iniziale: l })}
                  />
                </>
              )
            )}
          </section>

          {snap.fase === FASE.LEZIONI && snap.passo.length > 0 && (
            <PaceCard snap={snap} onSetRapporto={(v) => actions.campusSetRapporto(v)} />
          )}

          <SemestriCard
            semestri={campus.semestri}
            oggi={snap.oggi}
            selectedId={semestre?.id}
            onSelect={setSelectedSemId}
            onNew={() => {
              const ultimo = campus.semestri[campus.semestri.length - 1];
              const base = ultimo ? suggestSemestre(addDaysToDateOnly(ultimo.fine, 45)) : suggestSemestre(snap.oggi);
              setSemModal({ iniziale: base });
            }}
            onEdit={(s) => setSemModal({ iniziale: s })}
          />
        </>
      )}

      {lezioneModal && semestre && (
        <LezioneModal
          open
          iniziale={lezioneModal.iniziale}
          materie={materieAttive}
          altreLezioni={semestre.lezioni}
          onClose={() => setLezioneModal(null)}
          onSave={(bozza) => {
            actions.campusSaveLezione(semestre.id, bozza);
            setLezioneModal(null);
          }}
          onDelete={() => {
            const l = lezioneModal.iniziale;
            setConfirm({
              title: 'Eliminare la lezione?',
              message: `${materieById.get(l.materiaId)?.nome ?? 'Lezione'} · ${GIORNI[l.giorno]} ${l.inizio}–${l.fine}. Le sessioni già registrate restano nello Star Log.`,
              onConfirm: () => {
                actions.campusDeleteLezione(semestre.id, l.id);
                setLezioneModal(null);
              }
            });
          }}
        />
      )}

      {semModal && (
        <SemestreModal
          open
          iniziale={semModal.iniziale}
          onClose={() => setSemModal(null)}
          onSave={(dati) => {
            if (semModal.iniziale?.id) actions.campusUpdateSemestre(semModal.iniziale.id, dati);
            else actions.campusAddSemestre(dati);
            setSemModal(null);
          }}
          onDelete={() => {
            const s = semModal.iniziale;
            setConfirm({
              title: `Eliminare ${s.nome}?`,
              message: `Spariscono il periodo e le ${s.lezioni.length} lezioni del suo orario. Le sessioni di studio già registrate restano.`,
              onConfirm: () => {
                actions.campusDeleteSemestre(s.id);
                setSemModal(null);
                setSelectedSemId(null);
              }
            });
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel="Elimina"
      />
    </div>
  );
}
