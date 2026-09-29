// =====================================================================
// ArachnoForge — src/utils/nowTarget.js (V42)
// "COSA FACCIO ADESSO", DAL PIANO.
//
// Fino alla V41 la card "ADESSO" nasceva da tre fonti che non si
// parlavano: la coda delle lezioni del Campus, l'argomento scelto da
// K.A.R.E.N. (anche su una materia che il planner oggi NON aveva messo)
// e il Primary Target. Risultato misurato: la card poteva proporre una
// materia fuori dal piano di oggi, e la frase "Poi …" ignorava i ripassi.
//
// Ora la giornata è UNA sequenza, ricavata dal piano globale:
//   1. il primo blocco deciso ieri sera ("Chiudi la giornata"), finché
//      non lo avvii;
//   2. la lezione appena finita, solo se il piano dice che viene prima
//      (nessun esame a rischio);
//   3. i ripassi dovuti oggi (brevi, tengono in piedi tutto il resto);
//   4. le materie di oggi, nell'ordine delle scadenze, ognuna col lavoro
//      giusto (sintesi -> studio -> ripasso finale) sull'argomento giusto;
//   5. la lezione da sistemare col tempo che gli esami lasciano libero.
// K.A.R.E.N. sceglie l'argomento e il metodo SOLO dentro le materie che il
// planner ha messo oggi. Tutto qui è puro: nessun React, nessuna data
// letta di nascosto se non come default.
// =====================================================================
import { WORK_MODE, nodeSources } from './sintesiEngine.js';
import { nodoInSintesi } from './campusEngine.js';
import { deriveNodeStatus, NODE_STATUS } from './skillTree.js';
import { nodeRetrievability, reviewedToday } from './spiderSense.js';
import { haProvaScritta } from './appelli.js';
import { formatHoursMinutes, todayDateOnlyKey, addDaysToDateOnly } from './dateUtils.js';

/** Sotto questa soglia (ore) un lavoro di oggi è considerato fatto. */
const EPS_H = 5 / 60;

/**
 * Metodi di studio da proporre quando K.A.R.E.N. non ne ha dato uno per
 * quell'argomento: nomi veri di tecniche, con l'istruzione pratica.
 */
export const METODO = {
  SINTESI:
    'Metodo Feynman sulle fonti: leggi un blocco, chiudi il libro e riscrivilo con parole tue. Dalle slide tieni solo ciò che il libro non ha: figure, formule, esempi del docente.',
  STUDIO:
    'Studio attivo sui tuoi appunti: a metà blocco chiudi tutto e ripeti lo schema a voce (active recall), poi riapri e segna solo ciò che non ti è uscito.',
  STUDIO_SCRITTO:
    'Studio attivo sui tuoi appunti, poi 2–3 esercizi sull’argomento senza guardare le soluzioni: lo scritto si prepara risolvendo, non rileggendo.',
  RIPASSO:
    'Richiamo attivo: prima scrivi a memoria lo schema dell’argomento, solo dopo apri gli appunti e correggi. Alla fine dai un voto onesto a quanto ricordavi.',
  FINALE:
    'Ripasso finale: simula l’esame. Domande a voce alta come all’orale, oppure una traccia a tempo; gli argomenti più deboli per primi.',
  ESERCIZI:
    'Pratica deliberata: esercizi a tempo senza soluzioni, poi correzione e quaderno degli errori (cosa hai sbagliato e perché).',
  LEZIONE:
    'Modalità Sintesi: dal libro, dalle slide e da ciò che hai scritto in aula ai tuoi appunti definitivi, finché la lezione è fresca.'
};

/* ------------------------------------------------------------------ *
 * GLI ARGOMENTI GIUSTI
 * ------------------------------------------------------------------ */

/** I nodi di una materia nell'ordine dell'albero (ogni padre seguito dai suoi figli). */
export function nodesInTreeOrder(materia) {
  const sfide = (Array.isArray(materia?.sfide) ? materia.sfide : []).filter((s) => s && s.id);
  const ids = new Set(sfide.map((s) => s.id));
  const figliDi = new Map();
  sfide.forEach((s) => {
    const padre = s.parentId && ids.has(s.parentId) && s.parentId !== s.id ? s.parentId : null;
    if (!figliDi.has(padre)) figliDi.set(padre, []);
    figliDi.get(padre).push(s);
  });
  const out = [];
  const visti = new Set();
  const visita = (s) => {
    if (visti.has(s.id)) return;
    visti.add(s.id);
    out.push(s);
    (figliDi.get(s.id) || []).forEach(visita);
  };
  (figliDi.get(null) || []).forEach(visita);
  sfide.forEach(visita);
  return out;
}

function appuntiPronti(s) {
  const src = nodeSources(s);
  return src.totali === 0 || src.conclusa || src.residue <= 0 || s.appuntiCompleti === true;
}

/**
 * L'argomento su cui lavorare per un modo di lavoro:
 *  - SINTESI: la sintesi già avviata, altrimenti il primo con fonti da snellire;
 *  - STUDIO: un argomento già iniziato con gli appunti pronti, altrimenti il
 *    primo libero (con gli appunti pronti) nell'ordine dell'albero;
 *  - RIPASSO: fra i completati non ripassati oggi, quello che ricordi meno.
 * Ritorna `null` se la materia non ha argomenti adatti (sessione sulla materia).
 */
export function pickNode(materia, modo, todayKey = todayDateOnlyKey()) {
  const sfide = nodesInTreeOrder(materia);
  if (sfide.length === 0) return null;
  if (modo === WORK_MODE.SINTESI) return nodoInSintesi(materia);
  if (modo === WORK_MODE.RIPASSO) {
    const fatti = sfide
      .filter((s) => s.status === 'COMPLETED' && !reviewedToday(s, todayKey))
      .map((s) => ({ s, r: nodeRetrievability(s, todayKey) }))
      .sort((a, b) => (a.r ?? 1) - (b.r ?? 1));
    return fatti[0]?.s || null;
  }
  const liberi = sfide.filter((s) => {
    const st = deriveNodeStatus(s, materia.sfide);
    return st === NODE_STATUS.AVAILABLE || st === NODE_STATUS.IN_PROGRESS;
  });
  const pronti = liberi.filter(appuntiPronti);
  const avviato = pronti.find((s) => Number(s.focusMinutesStudio) > 0 || (Number(s.focusMinutes) > 0 && !(Number(s.focusMinutesSintesi) > 0)));
  return avviato || pronti[0] || liberi[0] || null;
}

/** Un argomento indicato da K.A.R.E.N. è ancora lavorabile in quel modo? */
function nodoValido(materia, sfidaId, modo) {
  if (!materia || !sfidaId) return null;
  const s = (materia.sfide || []).find((x) => x && x.id === sfidaId);
  if (!s) return null;
  if (modo === WORK_MODE.RIPASSO) return s.status === 'COMPLETED' ? s : null;
  if (s.status === 'COMPLETED') return null;
  const st = deriveNodeStatus(s, materia.sfide);
  return st === NODE_STATUS.AVAILABLE || st === NODE_STATUS.IN_PROGRESS ? s : null;
}

/* ------------------------------------------------------------------ *
 * LA SEQUENZA DELLA GIORNATA
 * ------------------------------------------------------------------ */

function giorniEsame(p) {
  if (p?.daysRemaining == null) return '';
  if (p.daysRemaining === 0) return 'Esame oggi.';
  if (p.daysRemaining === 1) return 'Esame domani.';
  return `Esame fra ${p.daysRemaining} giorni.`;
}

/** Il lavoro che resta OGGI su una materia del piano, nell'ordine sintesi -> studio -> finale. */
export function subjectWorkNow(p) {
  if (!p) return null;
  const sintesi = Math.max(0, (p.todaySintesiHours || 0) - (p.doneTodaySintesiHours || 0));
  const studio = Math.max(0, (p.todayStudioHours || 0) - (p.doneTodayStudioHours || 0));
  const finale = Math.max(0, (p.todayFinalReviewHours || 0) - (p.doneTodayRipassoHours || 0));
  if (sintesi > EPS_H) return { modo: WORK_MODE.SINTESI, ore: sintesi, kind: 'S' };
  if (studio > EPS_H) return { modo: WORK_MODE.STUDIO, ore: studio, kind: 'T' };
  if (finale > EPS_H) return { modo: WORK_MODE.RIPASSO, ore: finale, kind: 'F' };
  return null;
}

function metodoPer(modo, kind, materia) {
  if (kind === 'F') return METODO.FINALE;
  if (modo === WORK_MODE.STUDIO) return haProvaScritta(materia) ? METODO.STUDIO_SCRITTO : METODO.STUDIO;
  return METODO[modo] || null;
}

function rationaleMateria(p, lavoro) {
  const pezzi = [];
  const oggi = formatHoursMinutes(p.todayTargetHours);
  const minimo = p.todayMinHours || 0;
  if (minimo > EPS_H && minimo < p.todayTargetHours - EPS_H) {
    pezzi.push(`Oggi ${oggi}: ${formatHoursMinutes(minimo)} per restare in tempo, il resto è anticipo.`);
  } else if (minimo > EPS_H) {
    pezzi.push(`Oggi ${oggi}, tutte necessarie per restare in tempo.`);
  } else {
    pezzi.push(`Oggi ${oggi} di anticipo: non sono obbligatorie, ma tolgono peso ai giorni prima dell’esame.`);
  }
  if (lavoro?.kind === 'S' && p.chiusuraAppuntiDateKey) pezzi.push(`Appunti da chiudere entro il ${p.chiusuraAppuntiDateKey.slice(8, 10)}/${p.chiusuraAppuntiDateKey.slice(5, 7)}.`);
  if (lavoro?.kind === 'F') pezzi.push('Finestra di ripasso finale: un passaggio su ogni argomento prima dell’esame.');
  if (p.status === 'CRITICO' && p.lateHours > 0) pezzi.push(`Al ritmo attuale ${formatHoursMinutes(p.lateHours)} non ci stanno prima dell’esame: parti da qui.`);
  const g = giorniEsame(p);
  if (g) pezzi.push(g);
  return pezzi.join(' ');
}

/**
 * La sequenza di oggi e la voce "ADESSO".
 *
 * @param {object} args
 * @param {Array}  args.materie        materie (con le date di pianificazione)
 * @param {object} args.planToday      derived.planToday (studyPlanner.today)
 * @param {Array}  args.dueReviews     derived.upcomingReviews (già per urgenza)
 * @param {object} [args.campus]       derived.campus
 * @param {object} [args.karen]        { primary, otherOpenOptions } da resolveLiveStudyFocus
 * @param {object} [args.tomorrowPlan] derived.tomorrowPlanToday
 * @param {number} [args.reviewMinutes]
 * @param {string} [args.todayKey]
 * @returns {{ current: object|null, next: object|null, items: Array, doneForToday: boolean, restDay: boolean }}
 */
export function computeTodaySequence({
  materie = [],
  planToday = null,
  dueReviews = [],
  campus = null,
  karen = null,
  tomorrowPlan = null,
  reviewMinutes = 10,
  todayKey = todayDateOnlyKey()
} = {}) {
  const byId = new Map((Array.isArray(materie) ? materie : []).filter(Boolean).map((m) => [m.id, m]));
  const items = [];
  const t = planToday || null;

  // --- 1. il primo blocco deciso ieri sera ------------------------------
  const pb = tomorrowPlan && !tomorrowPlan.avviatoAt ? tomorrowPlan.primoBlocco : null;
  const mPb = pb ? byId.get(pb.materiaId) : null;
  if (pb && mPb && !mPb.examPassed) {
    const modo = pb.modo && WORK_MODE[pb.modo] ? pb.modo : WORK_MODE.STUDIO;
    const nodo = nodoValido(mPb, pb.sfidaId, modo) || pickNode(mPb, modo, todayKey);
    items.push({
      kind: 'PIANO_IERI',
      materiaId: mPb.id,
      sfidaId: nodo?.id || null,
      intent: modo,
      minutes: pb.minuti || null,
      argomento: nodo ? nodo.nome : mPb.nome,
      materia: nodo ? mPb.nome : 'Tutta la materia',
      badge: tomorrowPlan.oraInizio ? `Deciso ieri sera · alle ${tomorrowPlan.oraInizio}` : 'Deciso ieri sera',
      rationale: tomorrowPlan.nota
        ? `L’hai deciso ieri sera: “${tomorrowPlan.nota}”. Parti da qui, il resto della giornata viene da sé.`
        : 'L’hai deciso ieri sera, a mente fresca: parti da qui e il resto della giornata viene da sé.',
      metodo: metodoPer(modo, null, mPb),
      breve: `${mPb.nome}${nodo ? ` · ${nodo.nome}` : ''}`,
      oreOggi: (pb.minuti || 0) / 60,
      fromTomorrowPlan: true
    });
  }

  // --- lezione da sistemare (coda del Campus) ---------------------------
  let lezione = null;
  const l = campus?.fase === 'LEZIONI' && Array.isArray(campus.coda) && campus.coda.length > 0 ? campus.coda[0] : null;
  if (l) {
    const m = byId.get(l.materiaId);
    const nodo = nodoInSintesi(m);
    const riservate = t?.lessons?.riservateOre || 0;
    lezione = {
      kind: 'LEZIONE',
      materiaId: l.materiaId,
      sfidaId: nodo?.id || null,
      intent: WORK_MODE.SINTESI,
      minutes: null,
      argomento: nodo ? nodo.nome : `Appunti di ${l.materia?.nome || m?.nome || 'lezione'}`,
      materia: `${l.materia?.nome || m?.nome || ''} · sistema la lezione ${l.lezioniDaSistemare > 1 ? `(${l.lezioniDaSistemare} lezioni)` : `delle ${l.inizio}`}`,
      badge: 'Lezione da sistemare',
      rationale:
        l.oreFa < 1
          ? 'La lezione è appena finita: trasformarla nei tuoi appunti adesso costa una frazione di quanto costerà fra una settimana.'
          : `Finita ${l.oreFa}h fa. Sistemarla oggi, finché la ricordi, è il lavoro di sintesi che rende di più.`,
      metodo: METODO.LEZIONE,
      breve: `Sistema la lezione di ${l.materia?.nome || m?.nome || ''}`,
      oreOggi: riservate,
      daLezione: true
    };
  }
  if (lezione && t?.lessons?.prima) items.push(lezione);

  // --- 3. ripassi dovuti ------------------------------------------------
  const rev = t?.reviews || null;
  const ripassiDaFare = rev ? Math.max(0, (rev.targetCount || 0) - (rev.done || 0)) : 0;
  const dovuti = (Array.isArray(dueReviews) ? dueReviews : []).filter((r) => r && r.isDue && byId.has(r.materiaId));
  if (ripassiDaFare > 0 && dovuti.length > 0) {
    const r = dovuti[0];
    const recall = Number.isFinite(r.recall) ? Math.round(r.recall * 100) : null;
    const totale = Math.min(ripassiDaFare, dovuti.length);
    items.push({
      kind: 'RIPASSI',
      materiaId: r.materiaId,
      sfidaId: r.sfidaId,
      intent: WORK_MODE.RIPASSO,
      minutes: Math.max(5, Math.min(30, Math.round(Number(reviewMinutes) || 10))),
      argomento: r.sfidaNome,
      materia: `${r.materiaNome} · ${totale === 1 ? 'l’unico ripasso di oggi' : `ripasso 1 di ${totale} di oggi`}`,
      badge: totale === 1 ? '1 ripasso dovuto' : `${totale} ripassi dovuti`,
      rationale: `${recall != null ? `Il ricordo stimato di questo argomento è al ${recall}%. ` : ''}${
        r.daysUntil < 0 ? `Il ripasso è scaduto da ${Math.abs(r.daysUntil)} ${Math.abs(r.daysUntil) === 1 ? 'giorno' : 'giorni'}. ` : ''
      }I ripassi sono brevi e tengono in piedi tutto quello che hai già studiato: falli prima, a mente fresca.`,
      metodo: METODO.RIPASSO,
      breve: totale === 1 ? `Ripasso: ${r.sfidaNome}` : `${totale} ripassi (${r.sfidaNome} e altri)`,
      oreOggi: (totale * (Number(reviewMinutes) || 10)) / 60,
      ripassiTotali: totale
    });
  }

  // --- 4. le materie di oggi --------------------------------------------
  const soggetti = (t?.subjects || []).map((p) => ({ p, lavoro: subjectWorkNow(p), materia: byId.get(p.materiaId) })).filter((x) => x.lavoro && x.materia);
  // K.A.R.E.N. sceglie DENTRO il piano: la sua materia passa avanti solo se
  // è fra quelle di oggi con lavoro rimasto.
  const kp = karen?.primary || null;
  if (kp?.materiaId) {
    const i = soggetti.findIndex((x) => x.p.materiaId === kp.materiaId);
    if (i > 0) soggetti.unshift(soggetti.splice(i, 1)[0]);
  }
  soggetti.forEach(({ p, lavoro, materia }) => {
    let nodo = null;
    let daKaren = false;
    if (kp && kp.materiaId === p.materiaId && kp.sfidaId) {
      nodo = nodoValido(materia, kp.sfidaId, lavoro.modo);
      daKaren = !!nodo;
    }
    if (!nodo) nodo = pickNode(materia, lavoro.modo, todayKey);
    // Studio richiesto ma nessun argomento ha gli appunti pronti: si fa
    // prima la sintesi che manca.
    let modo = lavoro.modo;
    if (modo === WORK_MODE.STUDIO && nodo && !appuntiPronti(nodo)) modo = WORK_MODE.SINTESI;
    const label = lavoro.kind === 'F' ? 'Ripasso finale' : modo === WORK_MODE.SINTESI ? 'Sintesi' : 'Studio';
    items.push({
      kind: lavoro.kind === 'F' ? 'FINALE' : modo === WORK_MODE.SINTESI ? 'SINTESI' : 'STUDIO',
      materiaId: p.materiaId,
      sfidaId: nodo?.id || null,
      intent: modo,
      minutes: null,
      argomento: nodo ? nodo.nome : materia.nome,
      materia: nodo ? `${materia.nome} · ${label}` : `${label} · tutta la materia`,
      badge: p.status === 'CRITICO' ? 'In ritardo sul piano' : p.status === 'ATTENZIONE' ? 'Da spingere' : null,
      badgeTone: p.status === 'CRITICO' ? 'red' : p.status === 'ATTENZIONE' ? 'amber' : null,
      rationale: daKaren && kp.rationale ? kp.rationale : rationaleMateria(p, lavoro),
      metodo: daKaren && kp.metodo ? kp.metodo : metodoPer(modo, lavoro.kind, materia),
      daKaren,
      breve: nodo ? `${materia.nome} · ${nodo.nome}` : materia.nome,
      oreOggi: lavoro.ore,
      etichettaOre: lavoro.kind === 'F' ? 'di ripasso finale' : modo === WORK_MODE.SINTESI ? 'di sintesi oggi' : 'di studio oggi',
      status: p.status
    });
  });

  // --- 5. la lezione col tempo libero -----------------------------------
  if (lezione && !t?.lessons?.prima) items.push({ ...lezione, dopoGliEsami: true });

  // Una stessa materia/argomento non compare due volte di fila (es. piano
  // di ieri sera e la stessa materia nel piano di oggi).
  const dedup = [];
  items.forEach((it) => {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.materiaId === it.materiaId && prev.sfidaId === it.sfidaId && prev.intent === it.intent) return;
    dedup.push(it);
  });

  const restDay = !!t && (t.capacityHours || 0) <= EPS_H && dedup.length === 0;
  const haPiano = !!t && ((t.subjects || []).length > 0 || (rev?.total || 0) > 0);
  const doneForToday = dedup.length === 0 && haPiano && (t.targetHours || 0) > 0;
  return {
    current: dedup[0] || null,
    next: dedup[1] || null,
    items: dedup,
    doneForToday,
    restDay
  };
}

/* ------------------------------------------------------------------ *
 * IL PIANO DI DOMANI (per "Chiudi la giornata")
 * ------------------------------------------------------------------ */

const KIND_TO_MODE = { S: WORK_MODE.SINTESI, T: WORK_MODE.STUDIO, F: WORK_MODE.RIPASSO };

/**
 * Le voci del piano di domani dalla timeline del planner: per materia, il
 * tempo previsto e il lavoro prevalente, con l'argomento da cui partire.
 * `ripassiDomani` è il numero di ripassi che scadono entro domani.
 */
export function tomorrowPlanDraft({ timeline = [], materie = [], allTrackedReviews = [], todayKey = todayDateOnlyKey() } = {}) {
  const domani = addDaysToDateOnly(todayKey, 1);
  const byId = new Map((Array.isArray(materie) ? materie : []).filter(Boolean).map((m) => [m.id, m]));
  const giorno = (Array.isArray(timeline) ? timeline : []).find((d) => d && d.dateKey === domani) || null;
  const perMateria = new Map();
  (giorno?.items || []).forEach((it) => {
    const x = perMateria.get(it.materiaId) || { S: 0, T: 0, F: 0 };
    x[it.kind] = (x[it.kind] || 0) + (Number(it.hours) || 0);
    perMateria.set(it.materiaId, x);
  });
  const items = [];
  perMateria.forEach((ore, materiaId) => {
    const m = byId.get(materiaId);
    if (!m || m.examPassed) return;
    const totale = ore.S + ore.T + ore.F;
    if (totale <= EPS_H) return;
    // Il lavoro con cui si parte: la sintesi se c'è, poi lo studio, poi il finale.
    const kind = ore.S > EPS_H ? 'S' : ore.T > EPS_H ? 'T' : 'F';
    const modo = KIND_TO_MODE[kind];
    const nodo = pickNode(m, modo, domani);
    items.push({
      materiaId,
      nome: m.nome,
      minuti: Math.max(5, Math.round((totale * 60) / 5) * 5),
      ore: { sintesi: ore.S, studio: ore.T, finale: ore.F },
      modo,
      sfidaId: nodo?.id || null,
      sfidaNome: nodo?.nome || null
    });
  });
  items.sort((a, b) => b.minuti - a.minuti);
  const ripassiDomani = (Array.isArray(allTrackedReviews) ? allTrackedReviews : []).filter(
    (r) => r && r.nextReviewDate && r.nextReviewDate <= domani && byId.has(r.materiaId)
  ).length;
  return {
    dateKey: domani,
    capacityHours: giorno ? Number(giorno.capacity) || 0 : 0,
    items,
    ripassiDomani,
    giornoLibero: items.length === 0
  };
}
