// =====================================================================
// ArachnoForge — src/utils/techniqueMemory.js (V43)
// LA MEMORIA DELLE TECNICHE: quale tecnica funziona per TE, e dove.
//
// Ogni sessione di Focus può dichiarare la tecnica usata (Debriefing):
// finisce sul nodo, in `sfida.tecniche` ({ at, tecnica, minuti, modo }).
// Il risultato si legge dopo, su quello stesso argomento:
//   - ripassi: "Facile"/"Bene" = esito buono, "Fatica"/"Non ricordavo" =
//     esito difficile;
//   - interrogazioni di K.A.R.E.N. (quiz, orale): buono da 60% in su
//     (sapute + metà delle parziali);
//   - esercizi col conto dei corretti: buono da 60% di corretti in su.
// Ogni esito va alla tecnica PREVALENTE sull'argomento fino a quel giorno
// (quella con più minuti): è la tecnica con cui l'hai imparato o ripassato.
//
// Il riassunto va a K.A.R.E.N. nel contesto del piano (karenEngine/
// planContext.js): consiglia ciò che con te ha funzionato, materia per
// materia, e smette di riproporre ciò che non funziona.
//
// Modulo PURO: niente React, niente orologio letto di nascosto.
// =====================================================================
import { STUDY_TECHNIQUE_META, STUDY_TECHNIQUE_ORDER, isStudyTechnique } from '../data/studyTechniques.js';
import { localDateKeyOf } from './dateUtils.js';

/** Quante voci di tecnica tiene ogni nodo (le più recenti). */
export const MAX_TECNICHE_PER_NODO = 30;
/** Sotto questi esiti il tasso di successo non si mostra (troppo pochi). */
export const TECHNIQUE_MIN_OUTCOMES = 3;
/** Soglia del quiz: (sapute + metà parziali) / totale. */
export const QUIZ_GOOD_RATIO = 0.6;

const VOTI_BUONI = new Set(['MEDIUM', 'EASY']);
const VOTI_DIFFICILI = new Set(['AGAIN', 'HARD']);

/** Normalizza una voce di `sfida.tecniche` (import, migrazione). */
export function normalizeTechniqueEntry(e) {
  if (!e || typeof e !== 'object' || !isStudyTechnique(e.tecnica)) return null;
  const at = localDateKeyOf(e.at);
  if (!at) return null;
  return {
    at,
    tecnica: e.tecnica,
    minuti: Math.max(0, Math.min(1440, Math.round(Number(e.minuti) || 0))),
    modo: typeof e.modo === 'string' ? e.modo.slice(0, 16) : null
  };
}

export function normalizeTechniqueList(raw) {
  return (Array.isArray(raw) ? raw : []).map(normalizeTechniqueEntry).filter(Boolean).slice(-MAX_TECNICHE_PER_NODO);
}

/** La tecnica con più minuti sull'argomento fino al giorno `dateKey` compreso. */
export function dominantTechniqueAt(tecniche, dateKey) {
  const minuti = new Map();
  (Array.isArray(tecniche) ? tecniche : []).forEach((t) => {
    if (!t || !isStudyTechnique(t.tecnica) || !(t.at <= dateKey)) return;
    // Anche una sessione da 0 minuti dichiarati conta come scelta (peso minimo).
    minuti.set(t.tecnica, (minuti.get(t.tecnica) || 0) + Math.max(1, Number(t.minuti) || 0));
  });
  let best = null;
  let bestMin = 0;
  minuti.forEach((m, id) => {
    if (m > bestMin) {
      best = id;
      bestMin = m;
    }
  });
  return best;
}

function vuoto(id) {
  return { id, label: STUDY_TECHNIQUE_META[id].label, sessioni: 0, minuti: 0, buoni: 0, difficili: 0, perMateria: new Map() };
}

function perMateriaDi(acc, materia) {
  let x = acc.perMateria.get(materia.id);
  if (!x) {
    x = { materiaId: materia.id, nome: materia.nome || 'Materia', sessioni: 0, minuti: 0, buoni: 0, difficili: 0 };
    acc.perMateria.set(materia.id, x);
  }
  return x;
}

/** Tasso di esiti buoni (0..1), o null con meno di TECHNIQUE_MIN_OUTCOMES esiti. */
export function successRate(x) {
  const n = (Number(x?.buoni) || 0) + (Number(x?.difficili) || 0);
  return n >= TECHNIQUE_MIN_OUTCOMES ? Math.round((x.buoni / n) * 100) / 100 : null;
}

/**
 * @param {Array} materie `state.materie`
 * @returns {{ tecniche: Array<{id,label,sessioni,minuti,buoni,difficili,tasso,perMateria:Array}>, sessioni:number, esiti:number, haDati:boolean }}
 */
export function computeTechniqueMemory(materie) {
  const acc = new Map();
  const get = (id) => {
    if (!acc.has(id)) acc.set(id, vuoto(id));
    return acc.get(id);
  };
  let sessioni = 0;
  let esiti = 0;

  (Array.isArray(materie) ? materie : []).forEach((m) => {
    if (!m || typeof m !== 'object') return;
    (Array.isArray(m.sfide) ? m.sfide : []).forEach((s) => {
      const tecniche = normalizeTechniqueList(s?.tecniche);
      if (tecniche.length === 0) return;
      tecniche.forEach((t) => {
        const a = get(t.tecnica);
        a.sessioni += 1;
        a.minuti += t.minuti;
        const pm = perMateriaDi(a, m);
        pm.sessioni += 1;
        pm.minuti += t.minuti;
        sessioni += 1;
      });
      const esito = (dateKey, buono) => {
        const id = dominantTechniqueAt(tecniche, dateKey);
        if (!id) return;
        const a = get(id);
        const pm = perMateriaDi(a, m);
        if (buono) {
          a.buoni += 1;
          pm.buoni += 1;
        } else {
          a.difficili += 1;
          pm.difficili += 1;
        }
        esiti += 1;
      };
      // Ripassi. Quelli nati da un'interrogazione (fonte QUIZ/ORALE) si
      // contano una volta sola, dall'esito dell'interrogazione qui sotto.
      (Array.isArray(s.ripassi) ? s.ripassi : []).forEach((r) => {
        if (!r || r.fonte === 'QUIZ' || r.fonte === 'ORALE') return;
        const d = localDateKeyOf(r.at);
        if (!d) return;
        if (VOTI_BUONI.has(r.voto)) esito(d, true);
        else if (VOTI_DIFFICILI.has(r.voto)) esito(d, false);
      });
      // Esercizi con il conto dei corretti: buono da 60% di corretti in su.
      (Array.isArray(s.esercizi) ? s.esercizi : []).forEach((e) => {
        const d = localDateKeyOf(e?.at);
        const fatti = Math.max(0, Number(e?.fatti) || 0);
        if (!d || fatti <= 0) return;
        esito(d, Math.max(0, Number(e.corretti) || 0) / fatti >= QUIZ_GOOD_RATIO);
      });
      (Array.isArray(s.quizEsiti) ? s.quizEsiti : []).forEach((q) => {
        const d = localDateKeyOf(q?.at);
        if (!d) return;
        const sv = Math.max(0, Number(q.sapevo) || 0);
        const pz = Math.max(0, Number(q.parziale) || 0);
        const no = Math.max(0, Number(q.no) || 0);
        const tot = sv + pz + no;
        if (tot <= 0) return;
        esito(d, (sv + pz * 0.5) / tot >= QUIZ_GOOD_RATIO);
      });
    });
  });

  const tecniche = STUDY_TECHNIQUE_ORDER.filter((id) => acc.has(id))
    .map((id) => {
      const a = acc.get(id);
      const perMateria = [...a.perMateria.values()]
        .map((x) => ({ ...x, tasso: successRate(x) }))
        .sort((x, y) => y.minuti - x.minuti || y.sessioni - x.sessioni);
      return { id, label: a.label, sessioni: a.sessioni, minuti: a.minuti, buoni: a.buoni, difficili: a.difficili, tasso: successRate(a), perMateria };
    })
    .sort((x, y) => y.minuti - x.minuti || y.sessioni - x.sessioni);
  return { tecniche, sessioni, esiti, haDati: sessioni > 0 };
}

/** Limiti del riassunto per K.A.R.E.N. (il prompt resta corto). */
export const KAREN_TECHNIQUES_MAX = 8;
export const KAREN_TECHNIQUE_MATERIE_MAX = 5;

/**
 * Il riassunto compatto che viaggia verso K.A.R.E.N. (solo id e numeri:
 * i nomi delle materie li rimette il server dallo stato salvato).
 */
export function techniqueMemoryForKaren(memory) {
  const lista = Array.isArray(memory?.tecniche) ? memory.tecniche : [];
  if (lista.length === 0) return null;
  return lista.slice(0, KAREN_TECHNIQUES_MAX).map((t) => ({
    tecnica: t.id,
    sessioni: t.sessioni,
    minuti: t.minuti,
    esiti_buoni: t.buoni,
    esiti_difficili: t.difficili,
    per_materia: t.perMateria.slice(0, KAREN_TECHNIQUE_MATERIE_MAX).map((x) => ({
      materia_id: x.materiaId,
      minuti: x.minuti,
      esiti_buoni: x.buoni,
      esiti_difficili: x.difficili
    }))
  }));
}
