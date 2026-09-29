import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import { Icon } from '../../components/Icons.jsx';
import { useKarenBrain } from '../../context/KarenBrainContext.jsx';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, BTN_SM, BADGE } from '../../utils/designSystem.js';

// =====================================================================
// V42 — "INTERROGAZIONE ORALE" con K.A.R.E.N.
//
// Una domanda alla volta, come all'orale: rispondi per scritto e
// K.A.R.E.N. valuta cosa hai coperto e cosa manca, oppure rispondi a voce
// e ti giudichi sui punti chiave. Alla fine l'esito si registra argomento
// per argomento: sui completati vale come ripasso Spider-Sense, e conta
// nella prontezza d'esame. Le domande nascono dagli appunti che hai
// scritto nei nodi: più sono ricchi, più l'orale somiglia a quello vero.
// =====================================================================

const ESITO = {
  SAPEVO: { label: 'Sapevo', cls: BADGE.green },
  PARZIALE: { label: 'A metà', cls: BADGE.amber },
  NO: { label: 'Da rivedere', cls: BADGE.red }
};

export default function OralExamModal({ open, onClose, materia, sfide = [], onRegister }) {
  const karen = useKarenBrain();
  const [fase, setFase] = useState('carico'); // carico | errore | domande | fine
  const [oral, setOral] = useState(null);
  const [errore, setErrore] = useState(null);
  const [thin, setThin] = useState(false);
  const [i, setI] = useState(0);
  const [risposta, setRisposta] = useState('');
  const [aVoce, setAVoce] = useState(false);
  const [valutazioni, setValutazioni] = useState({}); // idx -> { esito, feedback, mancanti, coperti }
  const [valuto, setValuto] = useState(false);
  const [registrato, setRegistrato] = useState(false);
  const avviata = useRef(false);
  // Ogni apertura ha il suo numero: la risposta di un'interrogazione chiusa
  // (magari su un'altra materia) arriva tardi e viene ignorata.
  const richiesta = useRef(0);

  const sfidaIds = useMemo(() => sfide.map((s) => s.id), [sfide]);
  const nomeDi = useMemo(() => new Map(sfide.map((s) => [s.id, s.nome])), [sfide]);

  useEffect(() => {
    if (!open) {
      avviata.current = false;
      richiesta.current += 1;
      return;
    }
    if (avviata.current || !materia) return;
    avviata.current = true;
    const mia = ++richiesta.current;
    setFase('carico');
    setOral(null);
    setErrore(null);
    setI(0);
    setRisposta('');
    setAVoce(false);
    setValutazioni({});
    setRegistrato(false);
    (async () => {
      const res = await karen.generateOralExam(materia.id, sfidaIds);
      if (richiesta.current !== mia) return;
      if (res.error || !res.oral?.domande?.length) {
        setErrore(res.error || 'Nessuna domanda generata.');
        setFase('errore');
        return;
      }
      setOral(res.oral);
      setThin(!!res.thinContext);
      setFase('domande');
    })();
  }, [open, materia, sfidaIds, karen]);

  const domande = useMemo(() => (Array.isArray(oral?.domande) ? oral.domande : []), [oral]);
  const d = domande[i] || null;
  const v = valutazioni[i] || null;

  const valuta = async () => {
    if (!d || !risposta.trim() || valuto) return;
    setValuto(true);
    const res = await karen.evaluateOralAnswer({
      materiaId: materia.id,
      sfidaId: d.sfidaId || null,
      domanda: d.domanda,
      puntiChiave: d.punti_chiave || [],
      risposta: risposta.trim().slice(0, 4000)
    });
    setValuto(false);
    if (res.error || !res.valutazione) {
      setErrore(res.error || 'Valutazione non disponibile: giudicati sui punti chiave.');
      setAVoce(true);
      return;
    }
    setErrore(null);
    setValutazioni((prev) => ({ ...prev, [i]: res.valutazione }));
  };

  const segna = (esito) => setValutazioni((prev) => ({ ...prev, [i]: { esito, autovalutata: true } }));

  const avanti = () => {
    setRisposta('');
    setAVoce(false);
    setErrore(null);
    if (i + 1 < domande.length) setI(i + 1);
    else setFase('fine');
  };

  // Esito per argomento, per la registrazione.
  const perArgomento = useMemo(() => {
    const m = new Map();
    domande.forEach((q, idx) => {
      const val = valutazioni[idx];
      if (!val || !q.sfidaId || !nomeDi.has(q.sfidaId)) return;
      const x = m.get(q.sfidaId) || { sapevo: 0, parziale: 0, no: 0 };
      if (val.esito === 'SAPEVO') x.sapevo += 1;
      else if (val.esito === 'PARZIALE') x.parziale += 1;
      else x.no += 1;
      m.set(q.sfidaId, x);
    });
    return m;
  }, [domande, valutazioni, nomeDi]);

  const complete = Object.values(valutazioni).filter((x) => x.esito === 'SAPEVO').length;

  const registra = () => {
    if (registrato || perArgomento.size === 0) return;
    perArgomento.forEach((esito, sfidaId) => onRegister(sfidaId, { ...esito, modo: 'ORALE' }));
    setRegistrato(true);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Interrogazione orale${materia ? ` · ${materia.nome}` : ''}`} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {fase === 'carico' && (
          <p className="text-sm text-slate-400 flex items-center gap-2">
            <Icon name="refresh" className="w-4 h-4 animate-spin" />
            K.A.R.E.N. prepara le domande dai tuoi appunti…
          </p>
        )}

        {fase === 'errore' && (
          <div className="space-y-3">
            <p className="text-sm text-primary">{errore}</p>
            <p className="text-xs text-slate-500">Serve una connessione al Cloud (non funziona in Modalità Ospite) e un po’ di contenuto negli appunti dei nodi.</p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={BTN_GHOST}>
                Chiudi
              </button>
            </div>
          </div>
        )}

        {fase === 'domande' && d && (
          <>
            <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
              <span className="ds-num">
                Domanda {i + 1} di {domande.length}
                {d.sfidaId && nomeDi.has(d.sfidaId) ? ` · ${nomeDi.get(d.sfidaId)}` : ''}
              </span>
              {d.tipo && <span className={BADGE.slate}>{d.tipo}</span>}
            </div>
            {thin && i === 0 && <p className="text-xs text-accent">Poco materiale negli appunti di questi argomenti: le domande restano sui fondamenti.</p>}
            <p className="text-[17px] text-white leading-relaxed font-medium">{d.domanda}</p>

            {!v && !aVoce && (
              <div className="space-y-2.5">
                <textarea
                  value={risposta}
                  onChange={(e) => setRisposta(e.target.value)}
                  rows={6}
                  maxLength={4000}
                  className="ds-input !h-auto min-h-[140px] leading-relaxed"
                  placeholder="Rispondi come se fossi davanti al docente: definizioni, passaggi, collegamenti."
                />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button type="button" onClick={() => setAVoce(true)} className={`${BTN_GHOST} ${BTN_SM}`}>
                    <Icon name="speaker" className="w-3.5 h-3.5" />
                    Ho risposto a voce
                  </button>
                  <button type="button" onClick={valuta} disabled={!risposta.trim() || valuto} className={BTN_PRIMARY}>
                    <Icon name={valuto ? 'refresh' : 'sparkles'} className={`w-4 h-4 ${valuto ? 'animate-spin' : ''}`} />
                    {valuto ? 'Valuto…' : 'Valuta la risposta'}
                  </button>
                </div>
              </div>
            )}

            {!v && aVoce && (
              <div className="space-y-3">
                {errore && <p className="text-xs text-accent">{errore}</p>}
                {Array.isArray(d.punti_chiave) && d.punti_chiave.length > 0 && (
                  <div className="ds-well p-3.5">
                    <p className="ds-eyebrow mb-1.5">Punti chiave attesi</p>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-300">
                      {d.punti_chiave.map((p, k) => (
                        <li key={`${k}-${p}`}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400">Com’è andata?</span>
                  <button type="button" onClick={() => segna('SAPEVO')} className={`${BTN_SECONDARY} ${BTN_SM}`}>
                    Sapevo
                  </button>
                  <button type="button" onClick={() => segna('PARZIALE')} className={`${BTN_GHOST} ${BTN_SM}`}>
                    A metà
                  </button>
                  <button type="button" onClick={() => segna('NO')} className={`${BTN_GHOST} ${BTN_SM}`}>
                    Da rivedere
                  </button>
                </div>
              </div>
            )}

            {v && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={(ESITO[v.esito] || ESITO.NO).cls}>{(ESITO[v.esito] || ESITO.NO).label}</span>
                  {Number.isFinite(v.punteggio) && <span className="text-xs text-slate-500 ds-num">{v.punteggio}/10</span>}
                </div>
                {v.feedback && <p className="text-sm text-slate-300 leading-relaxed">{v.feedback}</p>}
                {!v.autovalutata && risposta.trim() && (
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-4">
                    <span className="text-slate-400 font-medium">La tua risposta: </span>
                    {risposta.trim()}
                  </p>
                )}
                {Array.isArray(v.punti_coperti) && v.punti_coperti.length > 0 && (
                  <p className="text-sm text-slate-300 leading-relaxed">
                    <span className="text-emerald-300 font-medium">Hai coperto: </span>
                    {v.punti_coperti.join(' · ')}
                  </p>
                )}
                {Array.isArray(v.punti_mancanti) && v.punti_mancanti.length > 0 && (
                  <div className="ds-well p-3.5">
                    <p className="ds-eyebrow mb-1.5">Da aggiungere</p>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-300">
                      {v.punti_mancanti.map((p, k) => (
                        <li key={`${k}-${p}`}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end">
                  <button type="button" onClick={avanti} className={BTN_PRIMARY}>
                    {i + 1 < domande.length ? 'Prossima domanda' : 'Fine interrogazione'}
                    <Icon name="arrowRight" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {fase === 'fine' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {complete} {complete === 1 ? 'risposta completa' : 'risposte complete'} su {domande.length}.
            </p>
            {perArgomento.size > 0 && (
              <ul className="space-y-1.5">
                {[...perArgomento.entries()].map(([id, x]) => (
                  <li key={id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-200 truncate">{nomeDi.get(id)}</span>
                    <span className="text-xs text-slate-500 ds-num shrink-0">
                      {x.sapevo} {x.sapevo === 1 ? 'saputa' : 'sapute'} · {x.parziale} a metà · {x.no} da rivedere
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className={BTN_GHOST}>
                Chiudi
              </button>
              <button type="button" onClick={registra} disabled={registrato || perArgomento.size === 0} className={BTN_PRIMARY}>
                <Icon name="check" className="w-4 h-4" />
                {registrato ? 'Registrato' : 'Registra l’esito'}
              </button>
            </div>
            <p className="text-xs text-slate-500">Sugli argomenti già completati l’esito vale come ripasso: lo Spider-Sense ricalcola quando ripresentarteli.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
