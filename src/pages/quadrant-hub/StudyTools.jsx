import React, { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons.jsx';
import Modal from '../../components/Modal.jsx';
import { useKarenBrain } from '../../context/KarenBrainContext.jsx';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, BTN_SM, INPUT, INPUT_SM, LABEL, BADGE } from '../../utils/designSystem.js';
import { todayDateOnlyKey } from '../../utils/dateUtils.js';
import { haProvaScritta } from '../../utils/appelli.js';

// =====================================================================
// V42 — GLI STRUMENTI DI PRATICA di un argomento e di una materia.
//
//  - Interrogazione K.A.R.E.N.: ora ogni domanda si segna (sapevo / a
//    metà / no) e l'esito si REGISTRA: su un argomento completato vale
//    come ripasso Spider-Sense, e alimenta il pilastro Esercizi della
//    prontezza. Prima le domande si leggevano e basta.
//  - Esercizi fatti fuori dal timer (su carta, a ricevimento): due numeri.
//  - Simulazione d'esame: il punteggio di una prova completa a tempo.
//  - Ricomincia da zero: per le materie che ricostruisci in sessione.
// =====================================================================

const MARK = {
  S: { label: 'Sapevo', cls: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-300' },
  P: { label: 'A metà', cls: 'border-accent/50 bg-accent/10 text-accent' },
  N: { label: 'No', cls: 'border-primary/50 bg-primary/10 text-primary' }
};

/**
 * Interrogazione K.A.R.E.N. su un argomento: rispondi a mente, riveli la
 * traccia, segni come è andata, registri.
 */
export function NodeQuizPanel({ node, materiaId, onSaveQuiz, onRegister }) {
  const karen = useKarenBrain();
  const [revealed, setRevealed] = useState(() => new Set());
  const [marks, setMarks] = useState({});
  const [error, setError] = useState(null);
  const [thin, setThin] = useState(false);
  const [registrato, setRegistrato] = useState(false);
  const quiz = node.quiz && Array.isArray(node.quiz.domande) ? node.quiz : null;

  useEffect(() => {
    setMarks({});
    setRevealed(new Set());
    setRegistrato(false);
  }, [node.id, quiz?.generatedAt]);

  const toggleReveal = (idx) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const handleGenerate = async () => {
    setError(null);
    const result = await karen.generateNodeQuiz(materiaId, node.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setThin(!!result.thinContext);
    setRevealed(new Set());
    setMarks({});
    setRegistrato(false);
    onSaveQuiz(result.quiz);
  };

  const conteggio = Object.values(marks).reduce(
    (acc, m) => {
      if (m === 'S') acc.sapevo += 1;
      else if (m === 'P') acc.parziale += 1;
      else if (m === 'N') acc.no += 1;
      return acc;
    },
    { sapevo: 0, parziale: 0, no: 0 }
  );
  const segnate = conteggio.sapevo + conteggio.parziale + conteggio.no;

  const registra = () => {
    if (segnate === 0 || !onRegister) return;
    onRegister({ ...conteggio, modo: 'QUIZ' });
    setRegistrato(true);
  };

  return (
    <div className="rounded-xl border border-line bg-surface/70">
      <div className="flex items-center justify-between gap-2 flex-wrap px-3.5 py-3 border-b border-line">
        <p className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Icon name="chip" className="w-4 h-4 text-secondary" />
          Interrogazione K.A.R.E.N.
          {quiz && <span className="text-xs font-normal text-slate-500 ds-num">· {quiz.domande.length} domande</span>}
        </p>
        <button type="button" onClick={handleGenerate} disabled={karen.quizGenerating} className="ds-btn ds-btn-ghost ds-btn-sm">
          <Icon name={karen.quizGenerating ? 'refresh' : 'sparkles'} className={`w-3.5 h-3.5 ${karen.quizGenerating ? 'animate-spin' : ''}`} />
          {karen.quizGenerating ? 'In preparazione…' : quiz ? 'Rigenera' : 'Prepara le domande'}
        </button>
      </div>

      <div className="p-3.5 space-y-2.5">
        {error && <p className="text-xs text-primary leading-relaxed">{error}</p>}
        {thin && (
          <p className="text-xs text-accent leading-relaxed">
            Su questo argomento c’è poco materiale scritto: le domande restano sui fondamenti. Aggiungi due righe negli appunti e rigenerala per averle mirate sul tuo
            contenuto.
          </p>
        )}

        {!quiz ? (
          <p className="text-xs text-slate-400 leading-relaxed">
            Rispondere a mente prima di rileggere è ciò che fissa la memoria (active recall) — e rende onesto il giudizio del ripasso. Generata una volta, resta salvata
            sull’argomento.
          </p>
        ) : (
          <>
            <ol className="space-y-2">
              {quiz.domande.map((d, idx) => (
                <li key={`${d.domanda}-${idx}`} className="rounded-lg border border-line bg-panel px-3 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className="text-[11px] font-semibold text-secondary ds-num shrink-0 mt-0.5 w-5">{idx + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-100 leading-relaxed">{d.domanda}</p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {d.tipo && <span className="text-[11px] text-slate-500">{d.tipo}</span>}
                        {d.traccia && (
                          <button
                            type="button"
                            onClick={() => toggleReveal(idx)}
                            aria-expanded={revealed.has(idx)}
                            className="text-[11px] font-semibold text-slate-400 hover:text-secondary transition-colors"
                          >
                            {revealed.has(idx) ? 'Nascondi traccia' : 'Mostra traccia'}
                          </button>
                        )}
                      </div>
                      {revealed.has(idx) && d.traccia && (
                        <p className="text-xs text-slate-300 mt-2 leading-relaxed border-l-2 border-secondary/40 pl-2.5">{d.traccia}</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-2" role="radiogroup" aria-label={`Esito della domanda ${idx + 1}`}>
                        {Object.entries(MARK).map(([k, m]) => (
                          <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={marks[idx] === k}
                            disabled={registrato}
                            onClick={() => setMarks((prev) => ({ ...prev, [idx]: prev[idx] === k ? undefined : k }))}
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                              marks[idx] === k ? m.cls : 'border-line text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {onRegister && (
              <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                <p className="text-xs text-slate-500">
                  {registrato
                    ? 'Esito registrato.'
                    : segnate === 0
                    ? 'Segna come è andata ogni domanda, poi registra.'
                    : `${conteggio.sapevo} sapute · ${conteggio.parziale} a metà · ${conteggio.no} no${node.status === 'COMPLETED' ? ' — vale come ripasso' : ''}`}
                </p>
                <button type="button" onClick={registra} disabled={segnate === 0 || registrato} className={`${BTN_SECONDARY} ${BTN_SM}`}>
                  <Icon name="check" className="w-3.5 h-3.5" />
                  Registra l’esito
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Esercizi fatti fuori dal timer. */
export function EserciziLogger({ node, onLog }) {
  const [fatti, setFatti] = useState('');
  const [corretti, setCorretti] = useState('');
  const f = Math.max(0, Math.round(Number(fatti) || 0));
  const c = Math.max(0, Math.min(f, Math.round(Number(corretti) || 0)));
  const storico = (Array.isArray(node.esercizi) ? node.esercizi : []).slice(-5);
  const tot = storico.reduce((a, e) => ({ f: a.f + (Number(e.fatti) || 0), c: a.c + (Number(e.corretti) || 0) }), { f: 0, c: 0 });
  return (
    <div className="rounded-xl border border-line bg-surface/70 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Icon name="grid" className="w-4 h-4 text-cyan-300" />
          Esercizi
        </p>
        {tot.f > 0 && (
          <span className="text-xs text-slate-500 ds-num">
            ultimi: {tot.c}/{tot.f} corretti
          </span>
        )}
      </div>
      <div className="flex items-end gap-2.5 flex-wrap">
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">Svolti</span>
          <input type="number" min={0} max={100} value={fatti} onChange={(e) => setFatti(e.target.value)} className={`${INPUT_SM} !w-20 text-right ds-num`} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-slate-500 mb-1">Corretti</span>
          <input
            type="number"
            min={0}
            max={f || 100}
            value={corretti}
            onChange={(e) => setCorretti(e.target.value)}
            disabled={f === 0}
            className={`${INPUT_SM} !w-20 text-right ds-num`}
          />
        </label>
        <button
          type="button"
          disabled={f === 0}
          onClick={() => {
            onLog(f, c);
            setFatti('');
            setCorretti('');
          }}
          className={`${BTN_GHOST} ${BTN_SM}`}
        >
          <Icon name="plus" className="w-3.5 h-3.5" />
          Registra
        </button>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">Per quelli fatti fuori dal timer. Corretto = risolto senza guardare la soluzione.</p>
    </div>
  );
}

/** Registra una simulazione d'esame completa. */
export function SimulazioneModal({ open, onClose, materia, onSave }) {
  const [tipo, setTipo] = useState('SCRITTO');
  const [data, setData] = useState(todayDateOnlyKey());
  const [punti, setPunti] = useState('');
  const [su, setSu] = useState('30');
  const [durata, setDurata] = useState('');
  const [nota, setNota] = useState('');

  useEffect(() => {
    if (!open) return;
    setTipo(materia && !haProvaScritta(materia) ? 'ORALE' : 'SCRITTO');
    setData(todayDateOnlyKey());
    setPunti('');
    setSu('30');
    setDurata('');
    setNota('');
  }, [open, materia]);

  const p = Number(punti);
  const t = Number(su);
  const valido = Number.isFinite(p) && Number.isFinite(t) && t > 0 && p >= 0 && p <= t;
  const pct = valido ? Math.round((p / t) * 100) : null;

  return (
    <Modal open={open} onClose={onClose} title={`Simulazione d’esame${materia ? ` · ${materia.nome}` : ''}`} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-slate-400 leading-relaxed">
          Una prova completa a tempo, come all’esame (una traccia vecchia, un compito del docente, un orale simulato). È il dato più forte della prontezza d’esame.
        </p>
        <div className="ds-segmented grid grid-cols-2" role="radiogroup" aria-label="Tipo di prova">
          {[
            ['SCRITTO', 'Scritto'],
            ['ORALE', 'Orale']
          ].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={tipo === v} onClick={() => setTipo(v)} className="justify-center">
              {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block col-span-1">
            <span className={LABEL}>Punti</span>
            <input type="number" min={0} value={punti} onChange={(e) => setPunti(e.target.value)} className={`${INPUT} ds-num`} placeholder="24" />
          </label>
          <label className="block col-span-1">
            <span className={LABEL}>su</span>
            <input type="number" min={1} value={su} onChange={(e) => setSu(e.target.value)} className={`${INPUT} ds-num`} />
          </label>
          <label className="block col-span-1">
            <span className={LABEL}>Minuti</span>
            <input type="number" min={0} max={480} value={durata} onChange={(e) => setDurata(e.target.value)} className={`${INPUT} ds-num`} placeholder="120" />
          </label>
        </div>
        <label className="block">
          <span className={LABEL}>Data</span>
          <input type="date" value={data} max={todayDateOnlyKey()} onChange={(e) => setData(e.target.value)} className={INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>Nota (facoltativa)</span>
          <input type="text" maxLength={200} value={nota} onChange={(e) => setNota(e.target.value)} className={INPUT} placeholder="Es. traccia di gennaio 2025, esercizio 3 sbagliato" />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className={pct != null ? (pct >= 60 ? BADGE.green : BADGE.amber) : BADGE.slate}>{pct != null ? `${pct}%` : 'punteggio'}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              Annulla
            </button>
            <button
              type="button"
              disabled={!valido}
              onClick={() =>
                onSave({
                  tipo,
                  at: `${data || todayDateOnlyKey()}T12:00:00.000Z`,
                  punteggioPct: pct,
                  voto: t === 30 ? p : null,
                  durataMin: Math.round(Number(durata) || 0),
                  nota
                })
              }
              className={BTN_PRIMARY}
            >
              Registra
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** "Ricomincio da zero" su una materia. */
export function RicostruisciModal({ open, onClose, materia, onConfirm }) {
  return (
    <Modal open={open} onClose={onClose} title={`Ricomincia da zero${materia ? ` · ${materia.nome}` : ''}`} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-slate-300 leading-relaxed">
          Per quando ricostruisci una materia in sessione. Gli argomenti tornano da studiare e lo studio già tracciato non conta più nel residuo: il piano la ricalcola
          da capo.
        </p>
        <p className="text-xs text-slate-500 leading-relaxed">
          La memoria stimata resta (quello che sai non sparisce) e puoi annullare dalla notifica per qualche secondo.
        </p>
        <div className="grid grid-cols-1 gap-2">
          <button type="button" onClick={() => onConfirm({ rifaiAppunti: false })} className="rounded-xl border border-line bg-surface hover:border-line-strong px-4 py-3 text-left">
            <span className="block text-sm font-semibold text-white">Ristudio, gli appunti li tengo</span>
            <span className="block text-xs text-slate-500 mt-0.5">Le sintesi fatte restano: riparte solo lo studio sui tuoi appunti.</span>
          </button>
          <button type="button" onClick={() => onConfirm({ rifaiAppunti: true })} className="rounded-xl border border-line bg-surface hover:border-line-strong px-4 py-3 text-left">
            <span className="block text-sm font-semibold text-white">Rifaccio anche gli appunti</span>
            <span className="block text-xs text-slate-500 mt-0.5">Anche le fonti tornano da snellire: sintesi e studio da capo.</span>
          </button>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Annulla
          </button>
        </div>
      </div>
    </Modal>
  );
}
