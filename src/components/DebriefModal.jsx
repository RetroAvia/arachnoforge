import React, { useState, useEffect, useId, useMemo, useRef } from 'react';
import Modal from './Modal.jsx';
import Dropdown from './Dropdown.jsx';
import { Icon } from './Icons.jsx';
import { FOCUS_QUALITY, FOCUS_QUALITY_META } from '../utils/xpEngine.js';
import { WORK_MODE, WORK_MODE_META, FONTE_TIPO_META, nodeSources, suggestPagesForSession } from '../utils/sintesiEngine.js';
import { argomentiSintesi } from '../utils/campusEngine.js';
import { deriveNodeStatus, NODE_STATUS } from '../utils/skillTree.js';
import { REVIEW_RATING, REVIEW_RATING_META, previewReviewIntervals, reviewLoadByDate } from '../utils/spiderSense.js';
import { planningExamDate } from '../utils/appelli.js';
import { todayDateOnlyKey } from '../utils/dateUtils.js';
import { pagineLabel } from '../utils/format.js';
import { INPUT_SM, LABEL, BADGE } from '../utils/designSystem.js';
import { STUDY_TECHNIQUE_ORDER, STUDY_TECHNIQUE_META, isStudyTechnique } from '../data/studyTechniques.js';

const RATING_ORDER = [FOCUS_QUALITY.FLOW, FOCUS_QUALITY.NORMAL, FOCUS_QUALITY.DISTRACTED];
const RECALL_ORDER = [REVIEW_RATING.AGAIN, REVIEW_RATING.HARD, REVIEW_RATING.MEDIUM, REVIEW_RATING.EASY];

/** Colori della valutazione (V42: un dato per te, non più un moltiplicatore di XP). */
const RATING_TONE = {
  [FOCUS_QUALITY.FLOW]: { tile: 'bg-primary/10 text-primary', badge: BADGE.red },
  [FOCUS_QUALITY.NORMAL]: { tile: 'bg-secondary/10 text-secondary', badge: BADGE.blue },
  [FOCUS_QUALITY.DISTRACTED]: { tile: 'bg-accent/10 text-accent', badge: BADGE.amber }
};

/** Intero ≥ 0 da un campo di testo (vuoto = 0). */
const intero = (v) => Math.max(0, Math.round(Number(v) || 0));

const giorniLabel = (n) => (n <= 1 ? 'domani' : `fra ${n}\u00a0g`);

/**
 * Post-Session Debriefing Modal — "Sessione completata". Compare quando
 * l'utente chiude volontariamente la sessione (Termina e salva / Pausa).
 *
 * Il costo in attrito resta il vincolo di progetto: questo modal si apre
 * dopo ogni blocco, quindi nel caso normale basta UN click (la
 * concentrazione) e tutto il resto è preselezionato o facoltativo.
 *
 * V38.0 — "La Forgia degli Appunti": COME è stata spesa la sessione, con le
 * pagine di fonte snellite (fonte per fonte, V40.2) e gli appunti prodotti.
 * V42 — i quattro modi di lavoro:
 *  - Sintesi / Studio come prima;
 *  - Ripasso: su un argomento completato chiede QUANTO RICORDAVI (quattro
 *    voti, con la data del prossimo ripasso per ciascuno) e aggiorna la
 *    memoria stimata. È l'unico dato davvero necessario, quindi è
 *    obbligatorio: senza, il ripasso non entrerebbe nello Spider-Sense;
 *  - Esercizi: quanti ne hai svolti e quanti corretti (facoltativo), la
 *    base del pilastro "Esercizi" della prontezza d'esame.
 * La valutazione della concentrazione non cambia più gli XP (conveniva
 * dichiararsi sempre in Flow): serve a te e a K.A.R.E.N.
 */
export default function DebriefModal({
  open,
  onClose,
  onSubmit,
  minutes = 0,
  overdrive = false,
  sfida = null,
  materia = null,
  intent = null,
  calibration = null,
  // V43 — la tecnica che K.A.R.E.N. ha consigliato per QUESTO argomento (o null).
  tecnicaConsigliata = null
}) {
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState(WORK_MODE.STUDIO);
  const [nodoId, setNodoId] = useState('');
  const [pagineFonte, setPagineFonte] = useState({});
  const [pagineAppunti, setPagineAppunti] = useState('');
  const [completaNodo, setCompletaNodo] = useState(false);
  const [recall, setRecall] = useState(null);
  const [eserciziFatti, setEserciziFatti] = useState('');
  const [eserciziCorretti, setEserciziCorretti] = useState('');
  // V43 — memoria delle tecniche: quale tecnica hai usato (facoltativo).
  const [tecnica, setTecnica] = useState(null);
  const consigliata = isStudyTechnique(tecnicaConsigliata) ? tecnicaConsigliata : null;
  const appuntiId = useId();
  const baseId = useId();

  const sintesiDichiarata = intent === WORK_MODE.SINTESI;
  const nodoIniziale = sfida?.id || '';
  const sfideMateria = useMemo(() => (Array.isArray(materia?.sfide) ? materia.sfide : []), [materia]);
  const nodo = useMemo(() => {
    if (!nodoId) return null;
    return sfideMateria.find((s) => s.id === nodoId) || (sfida && sfida.id === nodoId ? sfida : null);
  }, [nodoId, sfideMateria, sfida]);
  const nodoCompletato = nodo?.status === 'COMPLETED';

  const src = useMemo(() => (nodo ? nodeSources(nodo) : null), [nodo]);
  const fontiAperte = useMemo(
    () => (src?.fonti || []).filter((f) => f && f.id && Math.max(0, Number(f.pagine) || 0) > Math.max(0, Number(f.pagineFatte) || 0)),
    [src]
  );
  const haFontiAperte = !!src && src.totali > 0 && !src.conclusa && fontiAperte.length > 0;

  // I modi che hanno senso per questa sessione.
  const modi = useMemo(() => {
    if (!materia) return [];
    if (nodo && nodoCompletato) return [WORK_MODE.RIPASSO, WORK_MODE.ESERCIZI];
    if (nodo) return [WORK_MODE.SINTESI, WORK_MODE.STUDIO, WORK_MODE.ESERCIZI];
    return [WORK_MODE.SINTESI, WORK_MODE.STUDIO, WORK_MODE.RIPASSO, WORK_MODE.ESERCIZI];
  }, [materia, nodo, nodoCompletato]);

  const argomenti = useMemo(() => (sintesiDichiarata && materia ? argomentiSintesi(materia) : []), [sintesiDichiarata, materia]);
  const opzioniNodo = useMemo(() => {
    const voci = argomenti.map((a) => ({
      value: a.id,
      label: a.nome,
      depth: a.profondita,
      hint: a.totali === 0 ? 'senza fonti' : a.residue > 0 && !a.conclusa ? `${pagineLabel(a.residue)} da snellire` : 'sintesi chiusa'
    }));
    if (nodoIniziale && !voci.some((v) => v.value === nodoIniziale) && sfida) {
      voci.unshift({ value: nodoIniziale, label: sfida.nome || 'Argomento', hint: 'argomento della sessione' });
    }
    voci.push({ value: '', label: 'Nessun argomento preciso', hint: 'conta per la lezione, non aggiorna nessun nodo' });
    return voci;
  }, [argomenti, nodoIniziale, sfida]);

  const statoNodo = useMemo(() => (nodo ? deriveNodeStatus(nodo, sfideMateria.length ? sfideMateria : [nodo]) : null), [nodo, sfideMateria]);
  const completabile = statoNodo === NODE_STATUS.AVAILABLE || statoNodo === NODE_STATUS.IN_PROGRESS;
  const mostraTermina = !!nodo && completabile && (mode === WORK_MODE.STUDIO || mode === WORK_MODE.ESERCIZI);
  const chiediRicordo = mode === WORK_MODE.RIPASSO && !!nodo && nodoCompletato;

  const suggerite = useMemo(() => suggestPagesForSession(minutes, calibration, WORK_MODE.SINTESI), [minutes, calibration]);

  // Anteprima del prossimo ripasso per ciascun voto.
  const anteprima = useMemo(() => {
    if (!chiediRicordo) return null;
    try {
      return previewReviewIntervals(nodo, planningExamDate(materia), { todayKey: todayDateOnlyKey(), load: reviewLoadByDate(sfideMateria, nodo.id) });
    } catch {
      return null;
    }
  }, [chiediRicordo, nodo, materia, sfideMateria]);

  // Reset SOLO all'apertura: cambiare argomento dentro il modal non deve
  // rimettere il modo che hai appena scelto.
  const eraAperto = useRef(false);
  useEffect(() => {
    if (open && !eraAperto.current) {
      const srcIniziale = sfida ? nodeSources(sfida) : null;
      const aperteIniziali = !!srcIniziale && srcIniziale.totali > 0 && !srcIniziale.conclusa;
      const completatoIniziale = sfida?.status === 'COMPLETED';
      let iniziale;
      if (intent && WORK_MODE[intent]) iniziale = intent;
      else if (completatoIniziale) iniziale = WORK_MODE.RIPASSO;
      else if (sintesiDichiarata || aperteIniziali) iniziale = WORK_MODE.SINTESI;
      else iniziale = WORK_MODE.STUDIO;
      // Un intento incoerente col nodo (Ripasso su un argomento ancora da
      // studiare, Sintesi su uno completato) cede al modo sensato.
      if (sfida && completatoIniziale && (iniziale === WORK_MODE.SINTESI || iniziale === WORK_MODE.STUDIO)) iniziale = WORK_MODE.RIPASSO;
      if (sfida && !completatoIniziale && iniziale === WORK_MODE.RIPASSO) iniziale = aperteIniziali ? WORK_MODE.SINTESI : WORK_MODE.STUDIO;
      setSubmitting(false);
      setNodoId(nodoIniziale);
      setPagineFonte({});
      setPagineAppunti('');
      setCompletaNodo(false);
      setRecall(null);
      setEserciziFatti('');
      setEserciziCorretti('');
      setTecnica(consigliata);
      setMode(iniziale);
    }
    eraAperto.current = open;
  }, [open, sfida, nodoIniziale, sintesiDichiarata, intent, consigliata]);

  // Se cambia l'argomento e il modo non è più fra quelli possibili, si passa al primo.
  useEffect(() => {
    if (modi.length > 0 && !modi.includes(mode)) setMode(modi[0]);
  }, [modi, mode]);

  const cambiaNodo = (id) => {
    setNodoId(id);
    setPagineFonte({});
    setCompletaNodo(false);
    setRecall(null);
  };

  const bloccato = submitting || (chiediRicordo && !recall);

  const handlePick = (quality) => {
    if (bloccato) return;
    setSubmitting(true);
    const sintesi = mode === WORK_MODE.SINTESI;
    const perFonte = {};
    let somma = 0;
    if (sintesi) {
      fontiAperte.forEach((f) => {
        const n = intero(pagineFonte[f.id]);
        if (n > 0) {
          perFonte[f.id] = n;
          somma += n;
        }
      });
    }
    const fatti = mode === WORK_MODE.ESERCIZI ? Math.min(200, intero(eserciziFatti)) : 0;
    onSubmit(quality, {
      workMode: materia ? mode : null,
      pagineFonte: sintesi ? somma : 0,
      pagineFontePer: sintesi && somma > 0 ? perFonte : null,
      pagineAppuntiProdotte: sintesi && nodo ? intero(pagineAppunti) : 0,
      // Solo se l'hai cambiato: altrimenti vale quello della sessione.
      ...(nodoId !== nodoIniziale ? { sfidaId: nodoId || null } : {}),
      completaNodo: mostraTermina && completaNodo,
      eserciziFatti: fatti,
      eserciziCorretti: fatti > 0 ? Math.min(fatti, intero(eserciziCorretti)) : 0,
      reviewRating: chiediRicordo ? recall : null,
      // V43 — solo su un argomento preciso: è lì che se ne misura l'effetto.
      tecnica: nodo && tecnica ? tecnica : null,
      tecnicaConsigliata: consigliata
    });
  };

  // V41 — Da tastiera (PC): 1, 2, 3 scelgono la valutazione, quando il
  // cursore non è dentro un campo. Chiudere un blocco resta un gesto solo.
  const pickRef = useRef(handlePick);
  pickRef.current = handlePick;
  const bodyRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      const tag = (t && t.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      // Non mentre è aperta una tendina, né se sopra c'è un'altra finestra.
      if (t?.closest?.('[role="listbox"],[role="combobox"],[aria-expanded="true"]')) return;
      const dialog = bodyRef.current?.closest('[role="dialog"]');
      const active = document.activeElement;
      if (dialog && active && active !== document.body && !dialog.contains(active)) return;
      const idx = ['1', '2', '3'].indexOf(e.key);
      if (idx < 0) return;
      e.preventDefault();
      pickRef.current(RATING_ORDER[idx]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const oggetto = nodo ? nodo.nome : materia ? materia.nome : null;

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title="Sessione completata" maxWidth="max-w-lg">
      <div ref={bodyRef} className="space-y-5">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-400/25 text-emerald-300 flex items-center justify-center shrink-0">
            <Icon name="check" className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-white flex items-center gap-2 flex-wrap">
              <span>
                <span className="ds-num">{minutes} min</span> di focus registrati
              </span>
              {overdrive && <span className={BADGE.red}>Overdrive</span>}
            </p>
            {oggetto && <p className="text-[13px] text-slate-400 mt-0.5 break-words">{oggetto}</p>}
          </div>
        </div>

        {modi.length > 0 && (
          <div className="ds-well p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="ds-eyebrow flex items-center gap-1.5">
                <Icon name={WORK_MODE_META[mode]?.icon || 'flask'} className={`w-3.5 h-3.5 ${WORK_MODE_META[mode]?.color || 'text-accent'}`} />
                Come l’hai spesa
              </p>
              {mode === WORK_MODE.SINTESI && haFontiAperte && <span className="text-xs text-slate-500">{pagineLabel(src.residue)} di fonte ancora da snellire</span>}
            </div>

            {sintesiDichiarata && materia && opzioniNodo.length > 1 && (
              <div>
                <p className={LABEL}>Argomento su cui hai lavorato</p>
                <Dropdown compact value={nodoId} onChange={cambiaNodo} options={opzioniNodo} disabled={submitting} ariaLabel="Argomento su cui hai lavorato" />
              </div>
            )}

            <div className={`ds-segmented grid w-full ${modi.length === 2 ? 'grid-cols-2' : modi.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`} role="radiogroup" aria-label="Modo di lavoro della sessione">
              {modi.map((m) => {
                const meta = WORK_MODE_META[m];
                const attivo = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={attivo}
                    disabled={submitting}
                    onClick={() => setMode(m)}
                    className="justify-center !min-h-[2.25rem] disabled:opacity-40"
                  >
                    <Icon name={meta.icon} className={`w-4 h-4 shrink-0 ${attivo ? meta.color : ''}`} />
                    {meta.label}
                  </button>
                );
              })}
            </div>

            {mode === WORK_MODE.SINTESI && (
              <div className="space-y-3">
                {!nodo ? (
                  <p className="text-xs text-slate-500 leading-relaxed">Senza un argomento la sessione conta per la materia, ma non aggiorna le pagine di nessun nodo.</p>
                ) : fontiAperte.length > 0 ? (
                  <div className="space-y-2.5">
                    <p className="text-[13px] text-slate-400">Pagine snellite oggi, fonte per fonte</p>
                    {fontiAperte.map((f) => {
                      const meta = FONTE_TIPO_META[f.tipo] || FONTE_TIPO_META.ALTRO;
                      const totali = Math.max(0, Math.round(Number(f.pagine) || 0));
                      const fatte = Math.min(totali, Math.max(0, Math.round(Number(f.pagineFatte) || 0)));
                      const restano = totali - fatte;
                      const inputId = `${baseId}-${f.id}`;
                      const valore = pagineFonte[f.id] ?? '';
                      const oltre = intero(valore) > restano;
                      return (
                        <div key={f.id} className="flex items-center gap-3">
                          <label htmlFor={inputId} className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm text-slate-200 min-w-0">
                              <Icon name={meta.icon} className="w-3.5 h-3.5 shrink-0 text-accent" />
                              <span className="break-words">{f.etichetta ? `${meta.short} · ${f.etichetta}` : meta.label}</span>
                            </span>
                            <span className={`block text-xs ds-num mt-0.5 ${oltre ? 'text-accent' : 'text-slate-500'}`}>
                              {oltre ? `ne restano solo ${restano}: conto quelle` : `${fatte} di ${totali} già snellite`}
                            </span>
                          </label>
                          <input
                            id={inputId}
                            type="number"
                            min={0}
                            max={restano}
                            step={1}
                            inputMode="numeric"
                            value={valore}
                            onChange={(e) => setPagineFonte((prev) => ({ ...prev, [f.id]: e.target.value }))}
                            placeholder={fontiAperte.length === 1 && suggerite ? `~${Math.min(suggerite, restano)}` : '0'}
                            disabled={submitting}
                            className={`${INPUT_SM} !w-24 shrink-0 text-right ds-num`}
                            aria-label={`Pagine snellite oggi: ${meta.label}${f.etichetta ? ` ${f.etichetta}` : ''}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {src && src.totali > 0
                      ? 'Le fonti di questo argomento sono già tutte snellite.'
                      : 'Questo argomento non ha fonti: aggiungile nel Web-Matrix (Forgia degli Appunti) per tenere il conto delle pagine snellite.'}
                  </p>
                )}

                {nodo && (
                  <div className="flex items-center gap-3">
                    <label htmlFor={appuntiId} className="min-w-0 flex-1 text-sm text-slate-200">
                      Pagine tue prodotte
                      <span className="block text-xs text-slate-500 mt-0.5">i tuoi appunti definitivi</span>
                    </label>
                    <input
                      id={appuntiId}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={pagineAppunti}
                      onChange={(e) => setPagineAppunti(e.target.value)}
                      placeholder="0"
                      disabled={submitting}
                      className={`${INPUT_SM} !w-24 shrink-0 text-right ds-num`}
                    />
                  </div>
                )}

                {nodo && (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Facoltativi: lasciandoli vuoti si registra solo il tempo. Le pagine vanno dritte sul nodo e sono i numeri con cui K.A.R.E.N. impara il tuo
                    ritmo di sintesi.
                  </p>
                )}
              </div>
            )}

            {mode === WORK_MODE.STUDIO && <p className="text-xs text-slate-500 leading-relaxed">{WORK_MODE_META.STUDIO.hint}</p>}

            {mode === WORK_MODE.RIPASSO &&
              (chiediRicordo ? (
                <div className="space-y-2">
                  <p className="text-[13px] text-slate-300">Quanto ricordavi, prima di riaprire gli appunti?</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Quanto ricordavi">
                    {RECALL_ORDER.map((r) => {
                      const meta = REVIEW_RATING_META[r];
                      const attivo = recall === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          role="radio"
                          aria-checked={attivo}
                          disabled={submitting}
                          onClick={() => setRecall(r)}
                          title={meta.hint}
                          className={`rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-40 ${
                            attivo ? `${meta.border} bg-white/[0.05]` : 'border-line bg-surface hover:border-line-strong'
                          }`}
                        >
                          <span className={`block text-sm font-semibold ${attivo ? meta.color : 'text-slate-200'}`}>{meta.label}</span>
                          {anteprima?.[r] != null && <span className="block text-[11px] text-slate-500 mt-0.5 ds-num">ripasso {giorniLabel(anteprima[r])}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Sii onesto: è il voto con cui lo Spider-Sense decide quando ripresentarti l’argomento. «Non ricordavo» non toglie niente, lo rimette solo
                    vicino.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-500 leading-relaxed">
                  Ripasso libero sulla materia: si registra il tempo. Per aggiornare la memoria di un argomento, avvia il ripasso dal suo nodo o dai ripassi di oggi.
                </p>
              ))}

            {mode === WORK_MODE.ESERCIZI && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-[13px] text-slate-300 mb-1">Esercizi svolti</span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step={1}
                      inputMode="numeric"
                      value={eserciziFatti}
                      onChange={(e) => setEserciziFatti(e.target.value)}
                      placeholder="0"
                      disabled={submitting}
                      className={`${INPUT_SM} text-right ds-num`}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[13px] text-slate-300 mb-1">di cui corretti</span>
                    <input
                      type="number"
                      min={0}
                      max={intero(eserciziFatti) || 200}
                      step={1}
                      inputMode="numeric"
                      value={eserciziCorretti}
                      onChange={(e) => setEserciziCorretti(e.target.value)}
                      placeholder="0"
                      disabled={submitting || intero(eserciziFatti) === 0}
                      className={`${INPUT_SM} text-right ds-num`}
                    />
                  </label>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Facoltativi, ma sono il dato con cui si misura la tua pratica per lo scritto: corretti vuol dire senza guardare la soluzione.
                </p>
              </div>
            )}
          </div>
        )}

        {nodo && (
          <div className="ds-well p-4 space-y-2.5">
            <p className="ds-eyebrow flex items-center gap-1.5">
              <Icon name="sparkles" className="w-3.5 h-3.5 text-secondary" />
              Tecnica usata
              <span className="normal-case tracking-normal font-normal text-slate-500">· facoltativa</span>
            </p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tecnica di studio usata">
              {STUDY_TECHNIQUE_ORDER.map((id) => {
                const meta = STUDY_TECHNIQUE_META[id];
                const attiva = tecnica === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={attiva}
                    disabled={submitting}
                    title={meta.hint}
                    onClick={() => setTecnica((t) => (t === id ? null : id))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                      attiva ? 'border-secondary/60 bg-secondary/10 text-secondary font-semibold' : 'border-line bg-surface text-slate-300 hover:border-line-strong'
                    }`}
                  >
                    {meta.short}
                    {id === consigliata && <span className="ml-1 text-[10px] text-slate-500">· K.A.R.E.N.</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              {tecnica
                ? STUDY_TECHNIQUE_META[tecnica].hint
                : 'Dichiararla insegna a K.A.R.E.N. quale tecnica funziona per te: lo misura dai ripassi, dalle interrogazioni e dagli esercizi che seguono.'}
            </p>
          </div>
        )}

        {mostraTermina && (
          <button
            type="button"
            role="switch"
            aria-checked={completaNodo}
            disabled={submitting}
            onClick={() => setCompletaNodo((v) => !v)}
            className={`w-full flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:opacity-40 ${
              completaNodo ? 'border-emerald-400/40 bg-emerald-500/[0.07]' : 'border-line bg-surface hover:border-line-strong'
            }`}
          >
            <span
              className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                completaNodo ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' : 'border-white/25 text-transparent'
              }`}
            >
              <Icon name="check" className="w-3.5 h-3.5" />
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${completaNodo ? 'text-emerald-300' : 'text-slate-200'}`}>Argomento terminato: l’ho studiato tutto</span>
              <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
                «{nodo.nome}» passa a Completato e parte il primo ripasso Spider-Sense. Lascialo spento se devi ancora finirlo.
              </span>
            </span>
          </button>
        )}

        <div>
          <p className="text-sm font-semibold text-slate-100 mb-1">Com’è andata la concentrazione?</p>
          <p className="text-xs text-slate-500 mb-2.5">
            {chiediRicordo && !recall ? 'Prima dimmi quanto ricordavi, qui sopra.' : 'Non cambia gli XP: è un dato per te e per K.A.R.E.N.'}
          </p>
          <div className="grid grid-cols-1 gap-2">
            {RATING_ORDER.map((quality, idx) => {
              const meta = FOCUS_QUALITY_META[quality];
              const tone = RATING_TONE[quality];
              return (
                <button
                  key={quality}
                  type="button"
                  disabled={bloccato}
                  onClick={() => handlePick(quality)}
                  style={{ animationDelay: `${idx * 50}ms` }}
                  className="af-debrief-card group w-full flex items-center gap-3.5 rounded-xl border border-line bg-panel-2 px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-panel-3 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tone.tile}`}>
                    <Icon name={meta.icon} className="w-5 h-5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-100">{meta.label}</span>
                    <span className="block text-xs text-slate-400 mt-0.5">{meta.hint}</span>
                  </span>
                  <span className={`${tone.badge} shrink-0`}>{meta.badge}</span>
                  <span className="hidden sm:inline-flex ds-kbd shrink-0">{idx + 1}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
