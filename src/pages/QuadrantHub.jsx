// =====================================================================
// ArachnoForge — src/pages/QuadrantHub.jsx (The Web-Matrix)
//
// Le materie, il loro Skill Tree (argomenti e Boss), la prontezza
// d'esame, il piano appunti e i ripassi Spider-Sense. Questo file
// possiede lo stato e gli hook della pagina; i pezzi presentazionali
// vivono in src/pages/quadrant-hub/.
//
// V41 — ridisegno completo, stessa logica:
//   · Primary Target e Bounty Board in una riga compatta (prima
//     riempivano da soli il primo schermo);
//   · elenco materie a righe compatte, fisso a sinistra mentre scorri;
//   · testata della materia con i quattro numeri che contano e
//     l'avanzamento per stato;
//   · dettaglio argomento con le azioni in ordine d'uso, e il nuovo
//     "Avvia Focus su questo argomento" (un clic dal programma al timer);
//   · etichette in parole normali ("Nuova materia", "Argomento");
//   · messaggi di salvataggio corretti anche senza Cloud;
//   · raggiungibile dalla palette comandi (Ctrl K).
// =====================================================================
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useArachnoForge, useFocusTimerContext } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';
import AiIndexMatrixModal from '../components/AiIndexMatrixModal.jsx';
import AiNotesModal from '../components/AiNotesModal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Dropdown from '../components/Dropdown.jsx';
import Drawer from '../components/Drawer.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { deriveNodeStatus, NODE_STATUS, isDescendant, directChildrenOf } from '../utils/skillTree.js';
import { formatDateOnlyHuman, formatHoursMinutes, todayDateOnlyKey, daysUntilDateOnly } from '../utils/dateUtils.js';
import { weeklyMinutesByMateria } from '../utils/campusEngine.js';
import { DIFFICULTY, DIFFICULTY_META } from '../utils/xpEngine.js';
import { REVIEW_RATING_META, reviewLoadByDate, nodeRetrievability } from '../utils/spiderSense.js';
import { isGoblinProtocol, computeEstimatedCompletion } from '../utils/materiaMeta.js';
import {
  CUSTOM_COURSE_ID,
  getCourseDropdownOptions,
  getCourseById,
  getMissingPrerequisites,
  computeSpiderScore,
  DIFFICULTY_SLIDER_LABELS,
  isUngradedMateria,
  TIPO_PIANO,
  TIPO_PIANO_META
} from '../data/vanvitelliCourseMap.js';
import { FORMATO_ESAME, normalizeAppelli, planningExamDate, derivedExamFields } from '../utils/appelli.js';
import { MIN_VOTO, MAX_VOTO, LODE_VALUE } from '../utils/gpaEngine.js';
import { CARD, CARD_NOPAD, BTN_PRIMARY, BTN_SECONDARY, BTN_SUCCESS, BTN_GHOST, INPUT, LABEL, BADGE } from '../utils/designSystem.js';
import { KarenSuggestorPanel, BountyBoardPanel } from './quadrant-hub/KarenPanels.jsx';
import { FontiEditor, NodeWorkSummary, PianoAppuntiPanel } from './quadrant-hub/ForgiaAppunti.jsx';
import { normalizeFonti } from '../utils/sintesiEngine.js';
import { TechSlider, ExamPassedToggle } from './quadrant-hub/TacticalControls.jsx';
import { STATUS_META, ReviewButtons, ParentModuleCard } from './quadrant-hub/SkillTreeNodes.jsx';
import MateriaListPanel from './quadrant-hub/MateriaList.jsx';
import MateriaHeader from './quadrant-hub/MateriaHeader.jsx';
import { VERDICT_META } from '../utils/examReadiness.js';
import ExamReadinessCard from './quadrant-hub/ExamReadiness.jsx';
import AppelliEditor from './quadrant-hub/AppelliEditor.jsx';
import OralExamModal from './quadrant-hub/OralExamModal.jsx';
import { NodeQuizPanel, EserciziLogger, SimulazioneModal, RicostruisciModal } from './quadrant-hub/StudyTools.jsx';
import { formatNumber, minutiLabel } from '../utils/format.js';
import { INTENT, useIntent, requestIntent } from '../utils/uiIntents.js';
import { ROUTES, goTo } from '../hooks/useArachnoForgeRouter.js';
import { TIMER_STATUS } from '../hooks/useTimerEngine.js';

const YEAR_SECTIONS = [
  { key: 1, label: '1° anno' },
  { key: 2, label: '2° anno' },
  { key: 3, label: '3° anno' },
  { key: 'libere', label: 'Materie libere' }
];

const DIFFICULTY_OPTIONS = Object.values(DIFFICULTY).map((d) => ({ value: d, label: DIFFICULTY_META[d].label }));

/* ================================================================== *
 * AVVIA FOCUS SU UN ARGOMENTO
 * ================================================================== */

/**
 * V41 — Dal programma al timer con un clic. Legge lo stato del timer da
 * sé (il contesto del timer cambia ogni secondo: tenerlo qui dentro evita
 * di ridisegnare l'intera pagina a ogni tick).
 */
function StartFocusButton({ materiaId, sfidaId, onStart, label = 'Avvia Focus', variant = 'solid', className = '', intent = null }) {
  const timer = useFocusTimerContext();
  const busy = timer.status !== TIMER_STATUS.IDLE;
  const onThis = busy && timer.activeFocusSfidaId === sfidaId;

  if (onThis) {
    return (
      <button type="button" onClick={() => onStart(null)} className={`${BTN_GHOST} ${className}`}>
        <Icon name="clock" className="w-4 h-4 text-cyan-300" />
        Focus in corso · apri il timer
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onStart({ materiaId, sfidaId, ...(intent ? { intent } : {}) })}
      disabled={busy}
      title={
        busy
          ? "C'è già un blocco del timer in corso: chiudilo prima di iniziarne un altro."
          : 'Apre lo Stark-Web Terminal e fa partire il Focus su questo argomento'
      }
      className={`${variant === 'solid' ? BTN_SECONDARY : BTN_GHOST} ${className}`}
    >
      <Icon name="play" className="w-4 h-4" />
      {busy ? 'Timer già in uso' : label}
    </button>
  );
}

/* ================================================================== *
 * PAGINA
 * ================================================================== */

export default function QuadrantHub() {
  const { state, actions, derived, pushToast } = useArachnoForge();
  // Guardia difensiva: stato corrotto o non ancora idratato non deve mai
  // far arrivare un non-array ai .map() del render. Memoizzata: un `[]`
  // nuovo a ogni render rompeva tutte le useMemo che ne dipendono.
  const materie = useMemo(() => (Array.isArray(state.materie) ? state.materie : []), [state.materie]);
  // V40.0 — all'apertura si mostra la materia su cui Karen ti manda oggi
  // (Primary Target), altrimenti la prima non ancora superata.
  const [selectedMateriaId, setSelectedMateriaId] = useState(
    () => derived.primaryTarget?.materia?.id || materie.find((m) => m && !m.examPassed)?.id || materie[0]?.id || ''
  );
  const [materiaModalOpen, setMateriaModalOpen] = useState(false);
  const [editingMateria, setEditingMateria] = useState(null);
  // Id delle materie presenti quando se ne aggiunge una da qui (vedi l'effetto più sotto).
  const pendingNewMateriaRef = useRef(null);
  const [deleteMateriaTarget, setDeleteMateriaTarget] = useState(null);
  const [sfidaModalOpen, setSfidaModalOpen] = useState(false);
  const [aiIndexModalOpen, setAiIndexModalOpen] = useState(false);
  // V44 — Appunti con l'IA esterna: dallo Skill Tree (più argomenti) o dall'editor (uno).
  const [aiNotesOpen, setAiNotesOpen] = useState(false);
  const [aiNotesEditorOpen, setAiNotesEditorOpen] = useState(false);
  const [editNoteFonte, setEditNoteFonte] = useState(null);
  const [nodeDetail, setNodeDetail] = useState(null);
  const [deleteNodeTarget, setDeleteNodeTarget] = useState(null);
  // V34.4 — "Riporta a da completare": conferma dedicata, così un clic
  // accidentale non riapre subito il nodo.
  const [reopenNodeTarget, setReopenNodeTarget] = useState(null);
  const [spiderSenseDrawerOpen, setSpiderSenseDrawerOpen] = useState(false);
  // V42 — pratica e ricostruzione: simulazione, interrogazione orale, "ricomincio da zero".
  const [simulazioneOpen, setSimulazioneOpen] = useState(false);
  const [ricostruisciOpen, setRicostruisciOpen] = useState(false);
  const [oralTarget, setOralTarget] = useState(null); // { materia, sfide }

  // V34.2 — Selezione multipla: un Set (lookup O(1) per riga). Uscire
  // dalla modalità azzera sempre il set.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState(() => new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // Cambiare materia con la selezione attiva lascerebbe id "orfani".
  useEffect(() => {
    setSelectionMode(false);
    setSelectedNodeIds(new Set());
  }, [selectedMateriaId]);

  // V31.2 — Editor del nodo: i campi `edit*` sono uno STAGING locale,
  // scritto nel Context solo con "Salva": "Annulla" è un semplice reset.
  const [nodeEditMode, setNodeEditMode] = useState(false);
  const [nodeSaveState, setNodeSaveState] = useState('idle'); // idle | saving | success | error
  const [editNome, setEditNome] = useState('');
  const [editObiettivo, setEditObiettivo] = useState('');
  const [editOreStimate, setEditOreStimate] = useState(2);
  const [editPagine, setEditPagine] = useState('');
  const [editFonti, setEditFonti] = useState([]);
  const [editAppuntiCompleti, setEditAppuntiCompleti] = useState(false);
  const [editPreviste, setEditPreviste] = useState('');
  const [editDifficulty, setEditDifficulty] = useState(DIFFICULTY.MEDIUM);
  // V36.0 — Appunti del nodo (formule, passaggi, errori tipici...).
  const [editNote, setEditNote] = useState('');
  const [editParentId, setEditParentId] = useState('');
  // V31.2.1 — guardia "modifiche non salvate".
  const [nodeEditCloseConfirmOpen, setNodeEditCloseConfirmOpen] = useState(false);

  // Web-Path Planner — form materia sul piano di studi Vanvitelli
  // (Ingegneria Aerospaziale), oppure "Materia libera".
  const [formCourseId, setFormCourseId] = useState('');
  const [formCustomNome, setFormCustomNome] = useState('');
  // V42 — gli appelli (scritto/orale, più date) al posto della data unica.
  const [formAppelli, setFormAppelli] = useState([]);
  const [formTargetId, setFormTargetId] = useState(null);
  const [formFormato, setFormFormato] = useState(FORMATO_ESAME.SCRITTO_ORALE);
  const [formTipoPiano, setFormTipoPiano] = useState(TIPO_PIANO.SCELTA);
  const [formCfu, setFormCfu] = useState(6);
  const [formDifficulty, setFormDifficulty] = useState(3);
  const [formExamPassed, setFormExamPassed] = useState(false);
  // V37.0 — data reale di verbalizzazione (storico della media, ritmo di carriera).
  const [formExamPassedDate, setFormExamPassedDate] = useState('');
  const [formVoto, setFormVoto] = useState('');
  const [formLode, setFormLode] = useState(false);
  const courseOptions = useMemo(() => getCourseDropdownOptions(), []);
  const selectedCourse = formCourseId && formCourseId !== CUSTOM_COURSE_ID ? getCourseById(formCourseId) : null;
  // La prossima prova dell'appello scelto nel form (per l'anteprima).
  const formProssimaData = useMemo(() => {
    const appelli = normalizeAppelli(formAppelli);
    return planningExamDate({ ...derivedExamFields({ appelli, appelloTargetId: formTargetId }), formatoEsame: formFormato }) || null;
  }, [formAppelli, formTargetId, formFormato]);
  const formSenzaVoto = formFormato === FORMATO_ESAME.IDONEITA || selectedCourse?.ungraded === true;
  const missingPrereqs = useMemo(
    () => (selectedCourse ? getMissingPrerequisites(selectedCourse.id, materie, editingMateria?.id || null) : []),
    [selectedCourse, materie, editingMateria]
  );
  // Anteprima dello Spider-Score con gli stessi ingressi del calcolo vero
  // (data e CFU inclusi; senza argomenti vale il fallback CFU × 10 ore).
  const previewSpiderScore = useMemo(
    () =>
      computeSpiderScore(
        {
          perceivedDifficulty: formDifficulty,
          courseId: selectedCourse?.id || null,
          examDate: formProssimaData,
          cfu: selectedCourse?.cfu || Number(formCfu) || 0,
          // In modifica, gli argomenti veri: l'anteprima coincide col punteggio in testata.
          sfide: editingMateria?.sfide || []
        },
        derived.calibration
      ),
    [formDifficulty, selectedCourse, formProssimaData, formCfu, editingMateria, derived.calibration]
  );

  const [sfidaNome, setSfidaNome] = useState('');
  const [sfidaObiettivo, setSfidaObiettivo] = useState('');
  const [sfidaOreStimate, setSfidaOreStimate] = useState(4);
  // V38.0 — "La Forgia degli Appunti": le fonti da cui ricavare gli
  // appunti e le pagine degli appunti stessi (vedi utils/sintesiEngine.js).
  const [sfidaPagine, setSfidaPagine] = useState('');
  const [sfidaFonti, setSfidaFonti] = useState([]);
  const [sfidaAppuntiCompleti, setSfidaAppuntiCompleti] = useState(false);
  const [sfidaPreviste, setSfidaPreviste] = useState('');
  const [sfidaParentId, setSfidaParentId] = useState('');
  const [sfidaDifficulty, setSfidaDifficulty] = useState(DIFFICULTY.MEDIUM);

  // Spider-Score calcolato una volta per materia (V37.0: prima dentro il
  // comparatore del sort, O(n log n) volte).
  const spiderScoreById = useMemo(() => {
    const map = new Map();
    materie.forEach((m) => map.set(m.id, computeSpiderScore(m, derived.calibration)));
    return map;
  }, [materie, derived.calibration]);

  const sortedMaterie = useMemo(
    () => [...materie].sort((a, b) => (spiderScoreById.get(b.id) || 0) - (spiderScoreById.get(a.id) || 0)),
    [materie, spiderScoreById]
  );

  // Primary Target calcolato una sola volta nel Provider: Mission Control
  // e Web-Matrix vedono lo stesso identico suggerimento.
  const { primaryTarget } = derived;

  // V39.0 — minuti di lezione a settimana nel semestre in corso.
  const oreLezioneById = useMemo(() => {
    const sem = derived.campus?.semestre;
    if (!sem) return new Map();
    return weeklyMinutesByMateria(sem, new Map(materie.map((m) => [m.id, m])));
  }, [derived.campus?.semestre, materie]);

  // Raggruppamento per anno di corso (+ Materie libere), ordinato per
  // Spider-Score dentro ogni gruppo.
  const materieByYear = useMemo(() => {
    const groups = new Map();
    sortedMaterie.forEach((m) => {
      const course = getCourseById(m.courseId);
      const key = course ? course.anno : 'libere';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    });
    return groups;
  }, [sortedMaterie]);

  const yearKeyOf = useCallback((materia) => {
    const course = materia ? getCourseById(materia.courseId) : null;
    return course ? course.anno : 'libere';
  }, []);

  const primaryTargetYearKey = useMemo(
    () => (primaryTarget ? yearKeyOf(primaryTarget.materia) : null),
    [primaryTarget, yearKeyOf]
  );

  // Un DEFAULT calcolato al montaggio: si apre l'anno del Primary Target e
  // quello della materia aperta; poi decide l'utente.
  const [openYears, setOpenYears] = useState(() => {
    const initial = new Set([primaryTargetYearKey ?? 1]);
    const opened = materie.find((m) => m.id === selectedMateriaId);
    if (opened) initial.add(yearKeyOf(opened));
    return initial;
  });

  const toggleYear = useCallback((key) => {
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Apre una materia e, se serve, il suo gruppo nell'elenco. */
  const selectMateria = useCallback(
    (id) => {
      setSelectedMateriaId(id);
      const m = materie.find((x) => x.id === id);
      if (m) {
        const key = yearKeyOf(m);
        setOpenYears((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      }
    },
    [materie, yearKeyOf]
  );

  // V41 — Sotto i 1200 px elenco e dettaglio stanno uno sopra l'altro:
  // scegliere una materia porta al suo dettaglio, invece di lasciarti
  // sull'elenco a cercare dove sia cambiato qualcosa.
  const detailRef = useRef(null);
  const openMateria = useCallback(
    (id) => {
      selectMateria(id);
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      if (!window.matchMedia('(max-width: 1199.98px)').matches) return;
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
    },
    [selectMateria]
  );

  const selectedMateria = useMemo(() => materie.find((m) => m.id === selectedMateriaId) || null, [materie, selectedMateriaId]);
  const selectedSfide = useMemo(() => (Array.isArray(selectedMateria?.sfide) ? selectedMateria.sfide : []), [selectedMateria]);
  const rootNodes = useMemo(() => selectedSfide.filter((s) => !s.parentId), [selectedSfide]);

  // V41 — conteggio per stato, per la barra di avanzamento della testata.
  const statusCounts = useMemo(() => {
    const counts = {
      [NODE_STATUS.COMPLETED]: 0,
      [NODE_STATUS.NEEDS_REVIEW]: 0,
      [NODE_STATUS.IN_PROGRESS]: 0,
      [NODE_STATUS.AVAILABLE]: 0,
      [NODE_STATUS.LOCKED]: 0
    };
    selectedSfide.forEach((s) => {
      if (!s) return;
      const st = deriveNodeStatus(s, selectedSfide);
      if (counts[st] != null) counts[st] += 1;
    });
    return counts;
  }, [selectedSfide]);

  // V31.3 — Bounty Board: Set stabile degli argomenti ad alta frizione.
  const bountySfidaIds = useMemo(() => new Set(derived.bountyTargets.map((t) => t.sfidaId)), [derived.bountyTargets]);

  const goblinActive = selectedMateria ? isGoblinProtocol(selectedMateria) : false;
  // V36.0 — "Fine prevista" dalle ore DICHIARATE corrette dal bias reale e
  // dalla capacità giornaliera misurata.
  const estimate = useMemo(
    () => (selectedMateria ? computeEstimatedCompletion(selectedMateria, derived.calibration) : null),
    [selectedMateria, derived.calibration]
  );

  const readiness = selectedMateria ? derived.examReadinessByMateriaId.get(selectedMateria.id) || null : null;
  // V42 — la materia con la data di PIANIFICAZIONE (la prossima prova ancora davanti).
  const selectedMateriaPiano = useMemo(
    () => (selectedMateria ? derived.materiePiano.find((m) => m.id === selectedMateria.id) || selectedMateria : null),
    [selectedMateria, derived.materiePiano]
  );
  const planningDate = selectedMateriaPiano?.examDate || null;

  /** Interrogazione orale sulla materia: gli argomenti che ricordi meno (fino a 5), o quelli in corso. */
  const openOralForMateria = useCallback(() => {
    if (!selectedMateria) return;
    const fatti = selectedSfide
      .filter((s) => s.status === 'COMPLETED')
      .map((s) => ({ s, r: nodeRetrievability(s) ?? 1 }))
      .sort((a, b) => a.r - b.r)
      .slice(0, 5)
      .map((x) => x.s);
    const scelti = fatti.length > 0 ? fatti : selectedSfide.filter((s) => Number(s.focusMinutes) > 0).slice(0, 5);
    if (scelti.length === 0) {
      pushToast('Serve almeno un argomento studiato (o in corso) per l’interrogazione orale.', 'info');
      return;
    }
    setOralTarget({ materia: selectedMateria, sfide: scelti });
  }, [selectedMateria, selectedSfide, pushToast]);
  const selectedQuota = selectedMateria ? derived.karenQuotaByMateriaId.get(selectedMateria.id) : null;

  // Spider-Sense Schedule: tutti gli argomenti tracciati, per materia.
  const scheduleGroups = useMemo(() => {
    const byMateria = new Map();
    derived.allTrackedReviews.forEach((item) => {
      if (!byMateria.has(item.materiaId)) byMateria.set(item.materiaId, { materiaId: item.materiaId, materiaNome: item.materiaNome, items: [] });
      byMateria.get(item.materiaId).items.push(item);
    });
    return Array.from(byMateria.values());
  }, [derived.allTrackedReviews]);

  // NOTA: openNodeDetail va dichiarata PRIMA di ogni useCallback che la usa
  // (Temporal Dead Zone: causa nota di schermo nero in passato).
  const openNodeDetail = useCallback((node) => {
    setNodeDetail(node);
    setNodeEditMode(false);
    setNodeSaveState('idle');
  }, []);

  const closeNodeDetail = useCallback(() => {
    setNodeDetail(null);
    setNodeEditMode(false);
    setNodeSaveState('idle');
    setNodeEditCloseConfirmOpen(false);
  }, []);

  // Chiusura "utente" (sfondo, Esc, X): con modifiche in staging chiede
  // conferma; un salvataggio in corso blocca la chiusura.
  const requestCloseNodeDetail = useCallback(() => {
    if (nodeSaveState === 'saving') return;
    if (nodeEditMode) {
      setNodeEditCloseConfirmOpen(true);
      return;
    }
    closeNodeDetail();
  }, [nodeEditMode, nodeSaveState, closeNodeDetail]);

  const openNodeFromSchedule = useCallback(
    (materiaId, sfidaId) => {
      const materia = materie.find((m) => m.id === materiaId);
      const node = Array.isArray(materia?.sfide) ? materia.sfide.find((s) => s.id === sfidaId) : null;
      if (materia && node) {
        selectMateria(materiaId);
        openNodeDetail(node);
      }
    },
    [materie, openNodeDetail, selectMateria]
  );

  const openAddMateria = useCallback(() => {
    setEditingMateria(null);
    setFormCourseId('');
    setFormCustomNome('');
    setFormAppelli([]);
    setFormTargetId(null);
    setFormFormato(FORMATO_ESAME.SCRITTO_ORALE);
    setFormTipoPiano(TIPO_PIANO.SCELTA);
    setFormCfu(6);
    setFormDifficulty(3);
    setFormExamPassed(false);
    setFormExamPassedDate('');
    setFormVoto('');
    setFormLode(false);
    setMateriaModalOpen(true);
  }, []);

  // V41 — comandi dalla palette (Ctrl K) e da altre pagine.
  useIntent(INTENT.WEBMATRIX_OPEN, (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.materiaId) return;
    if (payload.sfidaId) openNodeFromSchedule(payload.materiaId, payload.sfidaId);
    else if (materie.some((m) => m.id === payload.materiaId)) selectMateria(payload.materiaId);
  });
  useIntent(INTENT.WEBMATRIX_NEW_MATERIA, () => openAddMateria());
  useIntent(INTENT.WEBMATRIX_SPIDER_SENSE, () => setSpiderSenseDrawerOpen(true));

  const openEditMateria = (materia) => {
    setEditingMateria(materia);
    setFormCourseId(materia.courseId || CUSTOM_COURSE_ID);
    setFormCustomNome(materia.courseId ? '' : materia.nome);
    setFormAppelli(normalizeAppelli(materia.appelli));
    setFormTargetId(materia.appelloTargetId || null);
    setFormFormato(materia.formatoEsame || (isUngradedMateria(materia) ? FORMATO_ESAME.IDONEITA : FORMATO_ESAME.SCRITTO_ORALE));
    setFormTipoPiano(materia.tipoPiano && TIPO_PIANO[materia.tipoPiano] ? materia.tipoPiano : materia.courseId ? TIPO_PIANO.PIANO : TIPO_PIANO.SCELTA);
    setFormCfu(materia.cfu);
    setFormDifficulty(Number.isFinite(materia.perceivedDifficulty) ? materia.perceivedDifficulty : 3);
    setFormExamPassed(!!materia.examPassed);
    setFormExamPassedDate(materia.examPassedDate || '');
    setFormVoto(Number.isFinite(materia.voto) ? String(materia.voto) : '');
    setFormLode(!!materia.lode);
    setMateriaModalOpen(true);
  };

  const handleCourseChange = (courseId) => {
    setFormCourseId(courseId);
    const course = courseId && courseId !== CUSTOM_COURSE_ID ? getCourseById(courseId) : null;
    if (course) setFormCfu(course.cfu);
    // Un'idoneità del piano (es. Inglese) non ha voto: il formato lo segue.
    if (course?.ungraded) setFormFormato(FORMATO_ESAME.IDONEITA);
    else if (formFormato === FORMATO_ESAME.IDONEITA && course) setFormFormato(FORMATO_ESAME.SCRITTO_ORALE);
  };

  const submitMateria = () => {
    const nome = selectedCourse ? selectedCourse.nome : formCustomNome.trim();
    if (!formCourseId || !nome) return;
    // Il voto conta SOLO se l'esame è superato: niente medie sporcate.
    const parsedVoto = Number(formVoto);
    const voto =
      formExamPassed && !formSenzaVoto && Number.isFinite(parsedVoto) && parsedVoto >= MIN_VOTO && parsedVoto <= MAX_VOTO ? parsedVoto : null;
    // V42 — gli appelli, normalizzati (date "YYYY-MM-DD" pure, orale mai
    // prima dello scritto); l'obiettivo resta quello scelto, se esiste.
    const appelli = normalizeAppelli(formAppelli);
    const appelloTargetId = appelli.some((a) => a.id === formTargetId) ? formTargetId : null;
    const payload = {
      nome,
      courseId: selectedCourse ? selectedCourse.id : null,
      appelli,
      appelloTargetId,
      formatoEsame: formFormato,
      tipoPiano: selectedCourse ? (selectedCourse.id === 'sceltaLibera' ? TIPO_PIANO.SCELTA : TIPO_PIANO.PIANO) : formTipoPiano === TIPO_PIANO.EXTRA ? TIPO_PIANO.EXTRA : TIPO_PIANO.SCELTA,
      cfu: selectedCourse ? selectedCourse.cfu : Math.max(1, Number(formCfu) || 6),
      perceivedDifficulty: formDifficulty,
      examPassed: formExamPassed,
      // Senza esame superato la data di verbalizzazione non ha senso.
      examPassedDate: formExamPassed ? formExamPassedDate || null : null,
      voto,
      lode: voto === LODE_VALUE && formLode
    };
    if (editingMateria) {
      actions.updateMateria(editingMateria.id, payload);
      pushToast(`${nome}: modifiche salvate.`, 'success');
    } else {
      pendingNewMateriaRef.current = new Set(materie.map((m) => m.id));
      actions.addMateria(payload);
      pushToast(`${nome} aggiunta al Web-Matrix.`, 'success');
    }
    setMateriaModalOpen(false);
  };

  // V41 — una materia appena creata DA QUI viene aperta subito (prima
  // restava selezionata quella di prima e la nuova andava cercata). Si
  // ricordano gli id presenti al momento dell'aggiunta: la prima materia
  // che compare fuori da quell'elenco è la nuova. Un aggiornamento da un
  // altro dispositivo non sposta mai la selezione.
  useEffect(() => {
    const before = pendingNewMateriaRef.current;
    if (!before) return;
    const created = materie.find((m) => m && !before.has(m.id));
    if (!created) return;
    pendingNewMateriaRef.current = null;
    selectMateria(created.id);
  }, [materie, selectMateria]);

  const openAddSfida = () => {
    setSfidaNome('');
    setSfidaObiettivo('');
    setSfidaOreStimate(4);
    setSfidaPagine('');
    setSfidaFonti([]);
    setSfidaAppuntiCompleti(false);
    setSfidaPreviste('');
    setSfidaParentId('');
    setSfidaDifficulty(DIFFICULTY.MEDIUM);
    setSfidaModalOpen(true);
  };

  const submitSfida = () => {
    if (!selectedMateria || !sfidaNome.trim() || goblinActive) return;
    actions.addSfida(selectedMateria.id, {
      nome: sfidaNome.trim(),
      obiettivo: sfidaObiettivo.trim(),
      oreStimate: Math.max(0.5, Number(sfidaOreStimate) || 2),
      pagineAppunti: Math.max(0, Number(sfidaPagine) || 0),
      fonti: normalizeFonti(sfidaFonti),
      appuntiCompleti: !!sfidaAppuntiCompleti,
      pagineAppuntiPreviste: Math.max(0, Math.round(Number(sfidaPreviste) || 0)),
      parentId: sfidaParentId || null,
      difficulty: sfidaDifficulty
    });
    setSfidaModalOpen(false);
  };

  /** Stesso argomento, pronto per il prossimo: il programma si mappa a raffica. */
  const submitSfidaAndContinue = () => {
    if (!selectedMateria || !sfidaNome.trim() || goblinActive) return;
    const nome = sfidaNome.trim();
    submitSfida();
    setSfidaNome('');
    setSfidaObiettivo('');
    setSfidaPagine('');
    setSfidaFonti([]);
    setSfidaAppuntiCompleti(false);
    setSfidaPreviste('');
    setSfidaModalOpen(true);
    pushToast(`"${nome}" aggiunto. Scrivi il prossimo.`, 'success', { duration: 2500 });
  };

  // V31.2 — ingresso nell'editor: copia i valori correnti nello staging.
  const openNodeEditMode = useCallback((node) => {
    setEditNome(node.nome);
    setEditObiettivo(node.obiettivo || '');
    setEditOreStimate(node.oreStimate);
    const appunti = Number(node.pagineAppunti) > 0 ? node.pagineAppunti : Number(node.pagine) || 0;
    setEditPagine(appunti > 0 ? String(appunti) : '');
    setEditFonti(Array.isArray(node.fonti) ? node.fonti : []);
    setEditAppuntiCompleti(node.appuntiCompleti === true);
    setEditPreviste(Number(node.pagineAppuntiPreviste) > 0 ? String(node.pagineAppuntiPreviste) : '');
    setEditDifficulty(node.difficulty);
    setEditNote(node.note || '');
    setEditNoteFonte(null);
    setEditParentId(node.parentId || '');
    setNodeSaveState('idle');
    setNodeEditMode(true);
  }, []);

  const cancelNodeEdit = useCallback(() => {
    setNodeEditMode(false);
    setNodeSaveState('idle');
  }, []);

  // Salvataggio: la patch va subito nello stato (e quindi sul
  // dispositivo); col Cloud attivo parte anche il salvataggio immediato.
  // V41 — se il Cloud non risponde le modifiche NON sono perse: restano
  // qui e l'autosave ritenta da solo. Prima il messaggio diceva "riprova
  // a salvare" e lasciava l'editor aperto come se niente fosse stato
  // registrato; e senza Cloud parlava comunque di Supabase.
  const saveNodeEdits = useCallback(
    async (node) => {
      if (!selectedMateria || !editNome.trim() || nodeSaveState === 'saving') return;
      setNodeSaveState('saving');
      const patch = {
        nome: editNome.trim(),
        obiettivo: editObiettivo.trim(),
        oreStimate: Math.max(0.5, Number(editOreStimate) || 2),
        pagineAppunti: Math.max(0, Number(editPagine) || 0),
        fonti: normalizeFonti(editFonti),
        appuntiCompleti: !!editAppuntiCompleti,
        pagineAppuntiPreviste: Math.max(0, Math.round(Number(editPreviste) || 0)),
        difficulty: editDifficulty,
        note: editNote,
        parentId: editParentId || null
      };
      const result = await actions.updateSfidaAndSync(selectedMateria.id, node.id, patch, { noteFonte: editNoteFonte });
      setNodeDetail((prev) => (prev && prev.id === node.id ? { ...prev, ...patch } : prev));
      setNodeEditMode(false);
      setNodeSaveState('idle');
      if (result.success) {
        pushToast('Argomento aggiornato.', 'success', { duration: 2500 });
      } else {
        pushToast('Modifiche salvate su questo dispositivo. Il Cloud non ha risposto: ritento in automatico.', 'warning');
      }
    },
    [
      selectedMateria,
      editNome,
      editObiettivo,
      editOreStimate,
      editPagine,
      editFonti,
      editAppuntiCompleti,
      editPreviste,
      editDifficulty,
      editNote,
      editNoteFonte,
      editParentId,
      nodeSaveState,
      actions,
      pushToast
    ]
  );

  /** V36.0 — l'interrogazione si salva DENTRO il nodo, con la stessa azione di ogni altra modifica. */
  const handleSaveQuiz = useCallback(
    async (quiz) => {
      if (!selectedMateria || !nodeDetail) return;
      setNodeDetail((prev) => (prev && prev.id === nodeDetail.id ? { ...prev, quiz } : prev));
      const result = await actions.updateSfidaAndSync(selectedMateria.id, nodeDetail.id, { quiz });
      if (!result.success) pushToast('Domande pronte e salvate qui. Il Cloud non ha risposto: ritento in automatico.', 'warning');
    },
    [selectedMateria, nodeDetail, actions, pushToast]
  );

  const handleReview = useCallback(
    (node, rating) => {
      const materia = materie.find((m) => Array.isArray(m?.sfide) && m.sfide.some((s) => s.id === node.id));
      if (materia) actions.reviewSfida(materia.id, node.id, rating);
    },
    [materie, actions]
  );

  // V16.0 — il reducer (COMPLETE_SFIDA) resta l'ultima linea di difesa
  // idempotente per un Boss chiuso troppo presto.
  const handleAttemptComplete = useCallback(
    (node) => {
      actions.completeSfida(selectedMateria.id, node.id);
      closeNodeDetail();
    },
    [actions, selectedMateria, closeNodeDetail]
  );

  const handleBossLockedAttempt = useCallback(() => {
    pushToast('Completa prima tutti i sotto-argomenti', 'danger');
  }, [pushToast]);

  const confirmReopenNode = useCallback(() => {
    if (!selectedMateria || !reopenNodeTarget) return;
    actions.reopenSfida(selectedMateria.id, reopenNodeTarget.id);
    setReopenNodeTarget(null);
  }, [actions, selectedMateria, reopenNodeTarget]);

  /** V41 — dal dettaglio di un argomento allo Stark-Web Terminal, con il Focus già avviato. */
  const startFocusFromNode = useCallback(
    (target) => {
      closeNodeDetail();
      if (target) requestIntent(INTENT.TIMER_FOCUS_ON, target);
      goTo(ROUTES.MISSION_CONTROL);
    },
    [closeNodeDetail]
  );

  // V34.2 — Selezione multipla.
  // V44 — selezionare un argomento con sotto-argomenti (un capitolo)
  // seleziona anche tutto quello che ha sotto; deselezionarlo li toglie.
  // Si può sempre togliere a mano un singolo sotto-argomento.
  const discendentiDi = useCallback(
    (sfidaId) => {
      const figli = new Map();
      selectedSfide.forEach((s) => {
        if (!s || !s.parentId) return;
        if (!figli.has(s.parentId)) figli.set(s.parentId, []);
        figli.get(s.parentId).push(s.id);
      });
      const out = [];
      const coda = [...(figli.get(sfidaId) || [])];
      const visti = new Set();
      while (coda.length > 0) {
        const id = coda.shift();
        if (visti.has(id)) continue;
        visti.add(id);
        out.push(id);
        coda.push(...(figli.get(id) || []));
      }
      return out;
    },
    [selectedSfide]
  );

  const toggleNodeSelection = useCallback(
    (sfidaId) => {
      setSelectedNodeIds((prev) => {
        const next = new Set(prev);
        const seleziona = !next.has(sfidaId);
        [sfidaId, ...discendentiDi(sfidaId)].forEach((id) => {
          if (seleziona) next.add(id);
          else next.delete(id);
        });
        return next;
      });
    },
    [discendentiDi]
  );

  const tuttiSelezionati = selectedSfide.length > 0 && selectedNodeIds.size >= selectedSfide.length;
  const toggleSelectAll = useCallback(() => {
    setSelectedNodeIds(tuttiSelezionati ? new Set() : new Set(selectedSfide.map((s) => s.id)));
  }, [tuttiSelezionati, selectedSfide]);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) setSelectedNodeIds(new Set());
      return !prev;
    });
  }, []);

  const confirmBulkDeleteNodes = useCallback(() => {
    if (!selectedMateria || selectedNodeIds.size === 0) return;
    const eliminaTutto = selectedNodeIds.size >= selectedSfide.length;
    actions.bulkDeleteSfide(selectedMateria.id, Array.from(selectedNodeIds));
    setSelectedNodeIds(new Set());
    setBulkDeleteConfirmOpen(false);
    // V44 — svuotato lo Skill Tree non resta niente da selezionare.
    if (eliminaTutto) setSelectionMode(false);
  }, [selectedMateria, selectedNodeIds, selectedSfide.length, actions]);

  const reviewsDue = derived.upcomingReviews.length;
  const selectedCourseOfMateria = selectedMateria ? getCourseById(selectedMateria.courseId) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Piano di studi"
        icon="web"
        title="The Web-Matrix"
        subtitle="Le tue materie in ordine di priorità. Per ognuna: l'albero degli argomenti, la prontezza d'esame e i ripassi."
        actions={
          <>
            <button type="button" onClick={() => setSpiderSenseDrawerOpen(true)} className={BTN_GHOST}>
              <Icon name="radar" className={`w-4 h-4 ${reviewsDue > 0 ? 'text-accent' : ''}`} />
              Spider-Sense
              {reviewsDue > 0 ? (
                <span className="ml-0.5 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-accent text-[11px] font-bold text-black/80 flex items-center justify-center ds-num">
                  {reviewsDue}
                </span>
              ) : (
                <span className="text-xs font-normal text-slate-500">· tutto ripassato</span>
              )}
            </button>
            <button type="button" onClick={openAddMateria} className={BTN_PRIMARY}>
              <Icon name="plus" className="w-4 h-4" />
              Nuova materia
            </button>
          </>
        }
      />

      {/* Karen: su cosa lavorare adesso, e dove fai più fatica. */}
      <div className={`grid grid-cols-1 gap-4 ${derived.bountyTargets.length > 0 ? 'xl:grid-cols-3' : ''}`}>
        <div className={derived.bountyTargets.length > 0 ? 'xl:col-span-2' : ''}>
          <KarenSuggestorPanel primaryTarget={primaryTarget} onSelect={openMateria} selectedId={selectedMateriaId} />
        </div>
        <BountyBoardPanel targets={derived.bountyTargets} onSelect={openNodeFromSchedule} />
      </div>

      {/* Due colonne da 1200 px: sotto, con la barra laterale dell'app, il
          dettaglio resterebbe largo come un telefono. */}
      <div className="grid grid-cols-1 min-[1200px]:grid-cols-[288px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">
        {/* Elenco materie: resta in vista mentre scorri l'albero. */}
        <div className="min-w-0 min-[1200px]:sticky min-[1200px]:top-4 min-[1200px]:max-h-[calc(100vh-2rem)] min-[1200px]:overflow-y-auto af-scroll rounded-[var(--af-radius-card)]">
          <MateriaListPanel
            sections={YEAR_SECTIONS}
            materieByYear={materieByYear}
            openYears={openYears}
            onToggleYear={toggleYear}
            primaryTargetYearKey={primaryTargetYearKey}
            selectedMateriaId={selectedMateriaId}
            onSelect={openMateria}
            onAdd={openAddMateria}
            spiderScoreById={spiderScoreById}
            readinessById={derived.examReadinessByMateriaId}
            quotaById={derived.karenQuotaByMateriaId}
            oreLezioneById={oreLezioneById}
            verdictMeta={VERDICT_META}
            totalCount={materie.length}
          />
        </div>

        {/* Materia aperta */}
        <div ref={detailRef} className="min-w-0 space-y-5 scroll-mt-16 lg:scroll-mt-4">
          {selectedMateria ? (
            <>
              <MateriaHeader
                materia={selectedMateria}
                planningDate={planningDate}
                course={selectedCourseOfMateria}
                quota={selectedQuota}
                estimate={estimate}
                onSimulazione={() => setSimulazioneOpen(true)}
                onOrale={openOralForMateria}
                onRicostruisci={() => setRicostruisciOpen(true)}
                readiness={readiness}
                verdictMeta={VERDICT_META}
                goblinActive={goblinActive}
                statusCounts={statusCounts}
                totalNodes={selectedSfide.length}
                oreLezioneMin={oreLezioneById.get(selectedMateria.id) || 0}
                onEdit={() => openEditMateria(selectedMateria)}
                onDelete={() => setDeleteMateriaTarget(selectedMateria)}
                onShowReadiness={() => {
                  const el = document.getElementById('wm-readiness');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              />

              {/* Skill Tree: il cuore della pagina, subito sotto la testata. */}
              <section aria-label="Skill Tree" className="space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="ds-h2 flex items-center gap-2">
                      Skill Tree
                      {selectedSfide.length > 0 && <span className={BADGE.slate}>{selectedSfide.length}</span>}
                    </h2>
                    <p className="text-[13px] text-slate-500 mt-0.5">Un argomento con sotto-argomenti è un Boss: si chiude per ultimo.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleSelectionMode}
                      disabled={rootNodes.length === 0}
                      title={rootNodes.length === 0 ? 'Nessun argomento da selezionare' : 'Seleziona più argomenti per eliminarli insieme'}
                      className={`ds-btn ds-btn-sm ${selectionMode ? 'ds-btn-secondary' : 'ds-btn-ghost'}`}
                    >
                      <Icon name={selectionMode ? 'close' : 'check'} className="w-3.5 h-3.5" />
                      {selectionMode ? 'Fine selezione' : 'Seleziona'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiIndexModalOpen(true)}
                      disabled={goblinActive}
                      title={goblinActive ? 'Goblin Protocol attivo: importazione bloccata' : "Importa l'indice del programma generato con l'IA"}
                      className="ds-btn ds-btn-ghost ds-btn-sm"
                    >
                      <Icon name="chip" className="w-3.5 h-3.5" />
                      AI Index Matrix
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiNotesOpen(true)}
                      disabled={selectedSfide.length === 0}
                      title={selectedSfide.length === 0 ? 'Prima crea gli argomenti' : 'Fai preparare gli appunti a un’IA esterna dal tuo materiale'}
                      className="ds-btn ds-btn-ghost ds-btn-sm"
                    >
                      <Icon name="sparkles" className="w-3.5 h-3.5" />
                      Appunti con l’IA
                    </button>
                    <button
                      type="button"
                      onClick={openAddSfida}
                      disabled={goblinActive}
                      title={goblinActive ? 'Goblin Protocol attivo: niente argomenti nuovi a ridosso dell’esame' : 'Aggiungi un argomento allo Skill Tree'}
                      className="ds-btn ds-btn-secondary ds-btn-sm"
                    >
                      <Icon name="plus" className="w-3.5 h-3.5" />
                      Argomento
                    </button>
                  </div>
                </div>

                {/* V34.2 — barra della selezione multipla, sempre visibile
                    mentre la modalità è attiva (così è chiaro come uscirne). */}
                {selectionMode && (
                  <div className="sticky top-3 z-20 flex items-center justify-between flex-wrap gap-3 rounded-xl border border-primary/35 bg-panel-2/95 backdrop-blur px-4 py-2.5 shadow-pop">
                    <span className="text-sm font-medium text-slate-100 flex items-center gap-2 ds-num">
                      <Icon name="check" className="w-4 h-4 text-primary" />
                      {selectedNodeIds.size === 0
                        ? 'Tocca gli argomenti da selezionare (un capitolo porta con sé i suoi sotto-argomenti)'
                        : selectedNodeIds.size === 1
                        ? '1 argomento selezionato'
                        : `${selectedNodeIds.size} argomenti selezionati`}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" onClick={toggleSelectAll} className="ds-btn ds-btn-ghost ds-btn-sm" aria-pressed={tuttiSelezionati}>
                        <Icon name={tuttiSelezionati ? 'close' : 'layers'} className="w-3.5 h-3.5" />
                        {tuttiSelezionati ? 'Deseleziona tutto' : `Seleziona tutto (${selectedSfide.length})`}
                      </button>
                      <button type="button" onClick={toggleSelectionMode} className="ds-btn ds-btn-ghost ds-btn-sm">
                        Annulla
                      </button>
                      <button
                        type="button"
                        disabled={selectedNodeIds.size === 0}
                        onClick={() => setBulkDeleteConfirmOpen(true)}
                        className="ds-btn ds-btn-danger ds-btn-sm"
                      >
                        <Icon name="trash" className="w-3.5 h-3.5" />
                        Elimina
                      </button>
                    </div>
                  </div>
                )}

                {rootNodes.length === 0 ? (
                  <div className={CARD}>
                    <EmptyState
                      variant="tree"
                      title="Nessun argomento ancora"
                      subtitle="Mappa il programma: aggiungi gli argomenti a mano oppure importa l'indice con l'AI Index Matrix."
                      action={
                        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                          <button type="button" onClick={openAddSfida} disabled={goblinActive} className={BTN_SECONDARY}>
                            <Icon name="plus" className="w-4 h-4" />
                            Primo argomento
                          </button>
                          <button type="button" onClick={() => setAiIndexModalOpen(true)} disabled={goblinActive} className={BTN_GHOST}>
                            <Icon name="chip" className="w-4 h-4" />
                            AI Index Matrix
                          </button>
                        </div>
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {rootNodes.map((node) => (
                      <ParentModuleCard
                        key={node.id}
                        node={node}
                        materia={selectedMateria}
                        onSelect={openNodeDetail}
                        bountyIds={bountySfidaIds}
                        selectionMode={selectionMode}
                        selectedIds={selectedNodeIds}
                        onToggleSelect={toggleNodeSelection}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Analisi della materia: verdetto d'esame (V36.0) e piano
                  appunti (V38.0). Una materia superata non ha più niente
                  da prevedere; il piano compare solo se la materia
                  dichiara fonti o pagine. */}
              {!selectedMateria.examPassed && (
                <div className="space-y-5">
                  {readiness && (
                    <div id="wm-readiness" className="scroll-mt-4">
                      <ExamReadinessCard readiness={readiness} materia={selectedMateriaPiano} quota={selectedQuota} />
                    </div>
                  )}
                  <PianoAppuntiPanel
                    plan={derived.sintesiPlanByMateriaId.get(selectedMateria.id)}
                    materiaNome={selectedMateria.nome}
                    passo={derived.campus?.passo?.find((r) => r.materiaId === selectedMateria.id) || null}
                  />
                </div>
              )}
            </>
          ) : (
            <div className={CARD}>
              <EmptyState
                variant="tree"
                title={materie.length === 0 ? 'Il Web-Matrix è vuoto' : 'Nessuna materia aperta'}
                subtitle={
                  materie.length === 0
                    ? 'Aggiungi la prima materia dal piano di studi: da lì costruirai l’albero degli argomenti.'
                    : 'Scegli una materia dall’elenco per vederne l’albero degli argomenti.'
                }
                action={
                  materie.length === 0 ? (
                    <button type="button" onClick={openAddMateria} className={`${BTN_PRIMARY} mt-1`}>
                      <Icon name="plus" className="w-4 h-4" />
                      Nuova materia
                    </button>
                  ) : null
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Spider-Sense Schedule — tutti i ripassi tracciati, dovuti o futuri. */}
      <section className={CARD_NOPAD} aria-label="Spider-Sense Schedule">
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 sm:px-5 py-3.5 border-b border-line">
          <div className="flex items-center gap-3 min-w-0">
            <span className="ds-icon-tile text-secondary">
              <Icon name="radar" className="w-[18px] h-[18px]" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-white">Spider-Sense Schedule</h2>
              <p className="text-xs text-slate-500">Quando torna ogni argomento già studiato, materia per materia.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {reviewsDue > 0 && <span className={BADGE.amber}>{reviewsDue} da ripassare ora</span>}
            <span className={BADGE.slate}>{derived.allTrackedReviews.length} tracciati</span>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {scheduleGroups.length === 0 ? (
            <EmptyState
              variant="radar"
              compact
              title="Nessun argomento tracciato"
              subtitle="Completa il primo argomento di uno Skill Tree: da lì lo Spider-Sense ti dirà quando ripassarlo."
            />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-5">
              {scheduleGroups.map((group) => (
                <div key={group.materiaId} className="min-w-0">
                  <p className="text-xs font-semibold text-slate-400 mb-2 truncate">{group.materiaNome}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((item) => {
                      const overdue = item.daysUntil < 0;
                      const dueToday = item.daysUntil === 0;
                      const urgent = overdue || dueToday;
                      return (
                        <button
                          key={item.sfidaId}
                          type="button"
                          onClick={() => openNodeFromSchedule(item.materiaId, item.sfidaId)}
                          className={`inline-flex items-center gap-1.5 max-w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                            urgent
                              ? 'border-accent/35 bg-accent/[0.08] text-slate-100 hover:border-accent/60'
                              : 'border-line bg-surface text-slate-300 hover:border-line-strong hover:text-white'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgent ? 'bg-accent' : 'bg-secondary/70'}`} aria-hidden="true" />
                          <span className="min-w-0 truncate">{item.sfidaNome}</span>
                          <span className={`shrink-0 ds-num ${urgent ? 'text-accent' : 'text-slate-500'}`}>
                            {overdue ? `scaduto da ${Math.abs(item.daysUntil)} gg` : dueToday ? 'oggi' : `tra ${item.daysUntil} gg`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Modale: nuova / modifica materia (Web-Path Planner) */}
      <Modal
        open={materiaModalOpen}
        onClose={() => setMateriaModalOpen(false)}
        title={editingMateria ? `Modifica ${editingMateria.nome}` : 'Nuova materia'}
        maxWidth="max-w-xl"
      >
        <div className="space-y-5">
          <div>
            <label className={LABEL}>Corso</label>
            <Dropdown
              value={formCourseId}
              onChange={handleCourseChange}
              options={courseOptions}
              placeholder="Scegli dal piano di studi o una materia libera…"
              ariaLabel="Corso"
            />
            <p className="text-xs text-slate-500 mt-1.5">Piano di studi di Ingegneria Aerospaziale (Vanvitelli): CFU e anno si compilano da soli.</p>
          </div>

          {formCourseId === CUSTOM_COURSE_ID && (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
              <div>
                <label className={LABEL} htmlFor="wm-materia-nome">
                  Nome della materia
                </label>
                <input
                  id="wm-materia-nome"
                  type="text"
                  value={formCustomNome}
                  onChange={(e) => setFormCustomNome(e.target.value)}
                  className={INPUT}
                  placeholder="Es. Corso a scelta libera"
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="wm-materia-cfu">
                  CFU
                </label>
                <input
                  id="wm-materia-cfu"
                  type="number"
                  min={1}
                  max={30}
                  value={formCfu}
                  onChange={(e) => setFormCfu(e.target.value)}
                  className={`${INPUT} ds-num`}
                />
              </div>
            </div>
          )}

          {selectedCourse && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={BADGE.blue}>{selectedCourse.cfu} CFU</span>
              <span className={BADGE.slate}>{selectedCourse.anno}° anno</span>
            </div>
          )}

          {/* Propedeuticità: avviso, MAI un blocco — si può studiare in anticipo. */}
          {missingPrereqs.length > 0 && (
            <div className="rounded-xl border border-accent/35 bg-accent/[0.06] px-4 py-3 flex items-start gap-3">
              <Icon name="alertTriangle" className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-accent">Per l'esame servono prima: {missingPrereqs.map((c) => c.nome).join(', ')}.</p>
                <p className="text-[13px] text-slate-400 mt-0.5">
                  Puoi comunque aggiungerla e prepararne gli appunti in anticipo: resta fuori dal planner automatico finché non le superi.
                </p>
              </div>
            </div>
          )}

          {formCourseId === CUSTOM_COURSE_ID && (
            <div>
              <span className={LABEL}>Nel piano di studi</span>
              <div className="ds-segmented grid grid-cols-2" role="radiogroup" aria-label="Tipo di esame nel piano">
                {[TIPO_PIANO.SCELTA, TIPO_PIANO.EXTRA].map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={formTipoPiano === t} onClick={() => setFormTipoPiano(t)} className="justify-center">
                    {TIPO_PIANO_META[t].label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Gli esami a scelta contano per la laurea fino a 18 CFU; i sovrannumerari restano fuori da media e CFU del piano.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface/40 p-4">
            <AppelliEditor
              appelli={formAppelli}
              targetId={formTargetId}
              formato={formFormato}
              formatoBloccato={selectedCourse?.ungraded === true}
              onFormato={setFormFormato}
              onChange={({ appelli, targetId }) => {
                setFormAppelli(appelli);
                setFormTargetId(targetId);
              }}
            />
          </div>

          <div className="ds-well px-4 py-3.5">
            <TechSlider value={formDifficulty} onChange={setFormDifficulty} labels={DIFFICULTY_SLIDER_LABELS} accent="primary" />
          </div>

          {/* Time-Weaver Formula (V20.0): la pressione temporale arriva
              solo dalla data d'esame reale, calcolata da Karen. */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
            <span className="text-sm text-slate-400">Spider-Score risultante</span>
            <span className={BADGE.amber}>
              <Icon name="bolt" className="w-3 h-3" />
              {formatNumber(previewSpiderScore, 1)}
            </span>
          </div>

          <ExamPassedToggle
            checked={formExamPassed}
            onChange={() => {
              // V39 — attivando "superato" con un appello già passato, la
              // data di verbalizzazione parte da quella.
              const next = !formExamPassed;
              setFormExamPassed(next);
              // Data di verbalizzazione di partenza: l'ultima prova passata dell'appello scelto.
              const target = formAppelli.find((a) => a.id === formTargetId) || null;
              const ultima = target ? target.orale || target.scritto : null;
              if (next && !formExamPassedDate && ultima && ultima <= todayDateOnlyKey()) {
                setFormExamPassedDate(ultima);
              }
            }}
          />

          {/* Il voto entra nella media ponderata (Multiverse Simulator) solo se l'esame è superato. */}
          {formExamPassed && (
            <div className="rounded-xl border border-line bg-surface/60 p-4 space-y-4">
              <p className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Icon name="chartBar" className="w-4 h-4 text-accent" />
                Voto e verbalizzazione
              </p>
              <div className={`grid grid-cols-1 gap-3 items-end ${formSenzaVoto ? '' : 'sm:grid-cols-[1fr_1fr_auto]'}`}>
                <div>
                  <label className={LABEL} htmlFor="wm-materia-verbale">
                    Data di verbalizzazione
                  </label>
                  <input
                    id="wm-materia-verbale"
                    type="date"
                    value={formExamPassedDate}
                    onChange={(e) => setFormExamPassedDate(e.target.value)}
                    max={todayDateOnlyKey()}
                    className={INPUT}
                  />
                </div>
                {!formSenzaVoto && (
                <div>
                  <label className={LABEL} htmlFor="wm-materia-voto">
                    Voto (18–30)
                  </label>
                  <input
                    id="wm-materia-voto"
                    type="number"
                    min={MIN_VOTO}
                    max={MAX_VOTO}
                    value={formVoto}
                    onChange={(e) => setFormVoto(e.target.value)}
                    placeholder="Es. 27"
                    className={`${INPUT} ds-num`}
                  />
                </div>
                )}
                {!formSenzaVoto && (
                <button
                  type="button"
                  onClick={() => setFormLode((v) => !v)}
                  disabled={Number(formVoto) !== LODE_VALUE}
                  aria-pressed={formLode && Number(formVoto) === LODE_VALUE}
                  className={`ds-btn h-[46px] ${formLode && Number(formVoto) === LODE_VALUE ? 'ds-btn-amber' : 'ds-btn-ghost'}`}
                  title={Number(formVoto) !== LODE_VALUE ? 'La lode si assegna solo con 30' : ''}
                >
                  <Icon name="trophy" className="w-4 h-4" />e lode
                </button>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {formSenzaVoto
                  ? 'Idoneità: nessun voto, i CFU contano per la laurea ma non per la media.'
                  : "La data è quella del verbale, non di oggi: alimenta lo storico della media e la stima del tempo di laurea. Senza voto l'esame resta fuori dalla media ponderata."}
              </p>
            </div>
          )}

          <p className="text-xs text-slate-500">Più CFU ha la materia, più XP vale ogni argomento che chiudi.</p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={() => setMateriaModalOpen(false)} className={BTN_GHOST}>
              Annulla
            </button>
            <button
              type="button"
              disabled={!formCourseId || (formCourseId === CUSTOM_COURSE_ID && !formCustomNome.trim())}
              onClick={submitMateria}
              className={BTN_PRIMARY}
            >
              {editingMateria ? 'Salva modifiche' : 'Aggiungi materia'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteMateriaTarget}
        onClose={() => setDeleteMateriaTarget(null)}
        onConfirm={() => {
          actions.deleteMateria(deleteMateriaTarget.id);
          // V37.0 — si passa alla materia successiva in ordine di priorità.
          if (selectedMateriaId === deleteMateriaTarget.id) {
            const prossima = sortedMaterie.find((m) => m.id !== deleteMateriaTarget.id);
            setSelectedMateriaId(prossima ? prossima.id : '');
          }
        }}
        title="Eliminare la materia?"
        message={`"${deleteMateriaTarget?.nome}" verrà eliminata con tutti i suoi argomenti e le sue lezioni in orario. Per qualche secondo potrai annullare dalla notifica; una copia di sicurezza resta comunque in Karen OS Settings → Backup.`}
        confirmLabel="Elimina materia"
      />

      {/* V27.0 — AI Index Matrix: importazione dell'indice del programma. */}
      <AiIndexMatrixModal
        open={aiIndexModalOpen}
        onClose={() => setAiIndexModalOpen(false)}
        materiaId={selectedMateria?.id || null}
        materiaNome={selectedMateria?.nome || ''}
      />

      {/* V44 — Appunti con l'IA esterna. */}
      <AiNotesModal open={aiNotesOpen} onClose={() => setAiNotesOpen(false)} materia={selectedMateria} />
      {nodeDetail && (
        <AiNotesModal
          open={aiNotesEditorOpen}
          onClose={() => setAiNotesEditorOpen(false)}
          materia={selectedMateria}
          sfidaFissa={nodeDetail}
          noteAttuali={editNote}
          onApply={(testo) => {
            setEditNote(testo);
            setEditNoteFonte('IA');
            pushToast('Appunti inseriti: controllali e premi Salva.', 'info');
          }}
        />
      )}

      {/* Modale: nuovo argomento */}
      <Modal
        open={sfidaModalOpen}
        onClose={() => setSfidaModalOpen(false)}
        title={selectedMateria ? `Nuovo argomento · ${selectedMateria.nome}` : 'Nuovo argomento'}
        maxWidth="max-w-lg"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitSfida();
          }}
        >
          <div>
            <label className={LABEL} htmlFor="wm-sfida-nome">
              Titolo
            </label>
            <input
              id="wm-sfida-nome"
              type="text"
              value={sfidaNome}
              onChange={(e) => setSfidaNome(e.target.value)}
              className={INPUT}
              placeholder="Es. Equazioni di Navier-Stokes"
              autoFocus
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="wm-sfida-obiettivo">
              Obiettivo <span className="text-slate-500 font-normal">(facoltativo)</span>
            </label>
            <textarea
              id="wm-sfida-obiettivo"
              value={sfidaObiettivo}
              onChange={(e) => setSfidaObiettivo(e.target.value)}
              rows={2}
              className={`${INPUT} resize-none`}
              placeholder="Cosa vuol dire averlo chiuso? Es. saper ricavare le equazioni e risolvere gli esercizi tipo"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="wm-sfida-ore">
                Ore previste
              </label>
              <input
                id="wm-sfida-ore"
                type="number"
                min={0.5}
                step={0.5}
                value={sfidaOreStimate}
                onChange={(e) => setSfidaOreStimate(e.target.value)}
                className={`${INPUT} ds-num`}
              />
            </div>
            <div>
              <label className={LABEL}>Difficoltà</label>
              <Dropdown value={sfidaDifficulty} onChange={setSfidaDifficulty} options={DIFFICULTY_OPTIONS} ariaLabel="Difficoltà" />
            </div>
          </div>

          <div>
            <label className={LABEL}>Dentro a</label>
            <Dropdown
              value={sfidaParentId}
              onChange={setSfidaParentId}
              placeholder="Nessuno: argomento principale"
              ariaLabel="Argomento padre"
              options={[
                { value: '', label: 'Nessuno: argomento principale' },
                ...selectedSfide.map((s) => ({ value: s.id, label: s.nome }))
              ]}
            />
            <p className="text-xs text-slate-500 mt-1.5">
              Scegli un argomento esistente per farne un sotto-argomento: quello diventa un Boss e si chiude per ultimo.
            </p>
          </div>

          {/* V38.0 — "La Forgia degli Appunti": le pagine da cui PARTI e
              quelle che ne RICAVI sono due numeri diversi. */}
          <FontiEditor
            fonti={sfidaFonti}
            onFontiChange={setSfidaFonti}
            pagineAppunti={sfidaPagine}
            onPagineAppuntiChange={setSfidaPagine}
            appuntiCompleti={sfidaAppuntiCompleti}
            onAppuntiCompletiChange={setSfidaAppuntiCompleti}
            pagineAppuntiPreviste={sfidaPreviste}
            onPagineAppuntiPrevisteChange={setSfidaPreviste}
            calibration={derived.calibration}
            oreStimate={sfidaOreStimate}
          />

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
            <button type="button" onClick={submitSfidaAndContinue} disabled={!sfidaNome.trim()} className={BTN_GHOST}>
              Aggiungi e scrivi il prossimo
            </button>
            <button type="submit" disabled={!sfidaNome.trim()} className={BTN_SECONDARY}>
              <Icon name="plus" className="w-4 h-4" />
              Aggiungi argomento
            </button>
          </div>
        </form>
      </Modal>

      {/* Modale: dettaglio argomento — qui vivono tutte le azioni, tenute
          fuori dalle righe dell'albero per non affollarle. */}
      <Modal open={!!nodeDetail} onClose={requestCloseNodeDetail} title={nodeDetail?.nome || ''} maxWidth="max-w-lg">
        {nodeDetail &&
          selectedMateria &&
          (() => {
            const status = deriveNodeStatus(nodeDetail, selectedSfide);
            // V35.5 — fallback robusto per stati futuri.
            const meta = STATUS_META[status] || STATUS_META.LOCKED;
            const diffMeta = DIFFICULTY_META[nodeDetail.difficulty] || DIFFICULTY_META.MEDIUM;
            const ownChildren = directChildrenOf(nodeDetail, selectedSfide);
            const isBoss = ownChildren.length > 0;
            const pendingOwnChildren = ownChildren.filter((c) => c.status !== 'COMPLETED').length;
            // V35.5 — "In corso" resta completabile come "Da studiare".
            const canComplete = status === NODE_STATUS.AVAILABLE || status === NODE_STATUS.IN_PROGRESS;
            const bossLocked = isBoss && status === NODE_STATUS.LOCKED;
            const isDone = status === NODE_STATUS.COMPLETED || status === NODE_STATUS.NEEDS_REVIEW;
            const parentOptions = selectedSfide.filter((s) => s.id !== nodeDetail.id && !isDescendant(selectedSfide, nodeDetail.id, s.id));
            const currentParent = selectedSfide.find((s) => s.id === nodeDetail.parentId) || null;
            const isSaving = nodeSaveState === 'saving';
            const canFocus = !selectedMateria.examPassed;
            const focusMin = Number(nodeDetail.focusMinutes) || 0;
            const focusSintesiMin = Number(nodeDetail.focusMinutesSintesi) || 0;

            if (nodeEditMode) {
              return (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveNodeEdits(nodeDetail);
                  }}
                >
                  <div>
                    <label className={LABEL} htmlFor="wm-edit-nome">
                      Titolo
                    </label>
                    <input
                      id="wm-edit-nome"
                      type="text"
                      value={editNome}
                      onChange={(e) => setEditNome(e.target.value)}
                      className={INPUT}
                      placeholder="Es. Equazioni di Navier-Stokes"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className={LABEL} htmlFor="wm-edit-obiettivo">
                      Obiettivo
                    </label>
                    <textarea
                      id="wm-edit-obiettivo"
                      value={editObiettivo}
                      onChange={(e) => setEditObiettivo(e.target.value)}
                      rows={2}
                      className={`${INPUT} resize-none`}
                      placeholder="Cosa vuol dire averlo chiuso?"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className={`${LABEL} flex items-center gap-1.5`} htmlFor="wm-edit-note">
                        <Icon name="note" className="w-3.5 h-3.5 text-secondary" />
                        Appunti
                        {editNote.trim() ? <span className="text-slate-500 font-normal ds-num">· {editNote.trim().length} car.</span> : null}
                      </label>
                      <button type="button" onClick={() => setAiNotesEditorOpen(true)} disabled={isSaving} className="ds-btn ds-btn-quiet ds-btn-sm mb-1.5">
                        <Icon name="sparkles" className="w-3.5 h-3.5 text-secondary" />
                        Con l’IA
                      </button>
                    </div>
                    <textarea
                      id="wm-edit-note"
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      rows={10}
                      className={`${INPUT} resize-y font-mono text-[13px] leading-relaxed`}
                      placeholder={'Formule, passaggi chiave, errori tipici, pagina della dispensa…\nQuello che serve per ripassare senza cercare altrove.'}
                      disabled={isSaving}
                    />
                    <p className="text-xs text-slate-500 mt-1.5">Li ritrovi aprendo l'argomento e a ogni ripasso Spider-Sense.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL} htmlFor="wm-edit-ore">
                        Ore previste
                      </label>
                      <input
                        id="wm-edit-ore"
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={editOreStimate}
                        onChange={(e) => setEditOreStimate(e.target.value)}
                        className={`${INPUT} ds-num`}
                        disabled={isSaving}
                      />
                    </div>
                    <div>
                      <label className={LABEL}>Difficoltà</label>
                      <Dropdown value={editDifficulty} onChange={setEditDifficulty} options={DIFFICULTY_OPTIONS} disabled={isSaving} ariaLabel="Difficoltà" />
                    </div>
                  </div>

                  <div>
                    <label className={LABEL}>Dentro a</label>
                    <Dropdown
                      value={editParentId}
                      onChange={setEditParentId}
                      placeholder="Nessuno: argomento principale"
                      ariaLabel="Argomento padre"
                      options={[{ value: '', label: 'Nessuno: argomento principale' }, ...parentOptions.map((s) => ({ value: s.id, label: s.nome }))]}
                      disabled={isSaving}
                    />
                  </div>

                  <FontiEditor
                    fonti={editFonti}
                    onFontiChange={setEditFonti}
                    pagineAppunti={editPagine}
                    onPagineAppuntiChange={setEditPagine}
                    appuntiCompleti={editAppuntiCompleti}
                    onAppuntiCompletiChange={setEditAppuntiCompleti}
                    pagineAppuntiPreviste={editPreviste}
                    onPagineAppuntiPrevisteChange={setEditPreviste}
                    calibration={derived.calibration}
                    oreStimate={editOreStimate}
                    compact
                  />

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button type="button" onClick={cancelNodeEdit} disabled={isSaving} className={BTN_GHOST}>
                      Annulla
                    </button>
                    <button type="submit" disabled={!editNome.trim() || isSaving} className={BTN_SUCCESS}>
                      {isSaving ? (
                        <>
                          <Icon name="cloud" className="w-4 h-4 af-cloud-syncing" />
                          Salvataggio…
                        </>
                      ) : (
                        <>
                          <Icon name="check" className="w-4 h-4" />
                          Salva modifiche
                        </>
                      )}
                    </button>
                  </div>
                </form>
              );
            }

            return (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className={meta.badge}>
                      <Icon name={meta.icon} className="w-3 h-3" />
                      {meta.label}
                    </span>
                    <span className={BADGE.slate}>
                      {diffMeta.label}
                      {nodeDetail.difficulty === 'HARD' ? ' · +30% XP' : ''}
                    </span>
                    {isBoss && (
                      <span className={BADGE.violet}>
                        <Icon name="skull" className="w-3 h-3" />
                        Boss · {ownChildren.length}
                      </span>
                    )}
                    {bountySfidaIds.has(nodeDetail.id) && (
                      <span className={BADGE.red} title="Bounty: alta frizione nei ripassi">
                        <Icon name="crosshair" className="w-3 h-3" />
                        Bounty
                      </span>
                    )}
                  </div>
                  <button type="button" onClick={() => openNodeEditMode(nodeDetail)} className="ds-btn ds-btn-ghost ds-btn-sm shrink-0">
                    <Icon name="edit" className="w-3.5 h-3.5" />
                    Modifica
                  </button>
                </div>

                {nodeDetail.obiettivo && <p className="text-[15px] text-slate-200 leading-relaxed">{nodeDetail.obiettivo}</p>}

                {/* Fatti essenziali dell'argomento. */}
                <dl className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface/60 p-3.5">
                  <div>
                    <dt className="text-[11px] text-slate-500">Ore previste</dt>
                    <dd className="text-sm font-semibold text-slate-100 ds-num mt-0.5">{formatHoursMinutes(Number(nodeDetail.oreStimate) || 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-slate-500">Focus accumulato</dt>
                    <dd className="text-sm font-semibold text-slate-100 ds-num mt-0.5">
                      {minutiLabel(focusMin)}
                      {focusSintesiMin > 0 && <span className="text-accent font-normal text-xs"> · {minutiLabel(focusSintesiMin)} di sintesi</span>}
                    </dd>
                  </div>
                  {currentParent && (
                    <div className="col-span-2">
                      <dt className="text-[11px] text-slate-500">Dentro a</dt>
                      <dd className="text-sm text-slate-200 mt-0.5 break-words">{currentParent.nome}</dd>
                    </div>
                  )}
                  {isDone && nodeDetail.nextReviewDate && (
                    <div className="col-span-2">
                      <dt className="text-[11px] text-slate-500">Prossimo ripasso</dt>
                      <dd className="text-sm text-slate-200 mt-0.5 ds-num">
                        {formatDateOnlyHuman(nodeDetail.nextReviewDate)}
                        {(() => {
                          const d = daysUntilDateOnly(nodeDetail.nextReviewDate);
                          if (d == null) return null;
                          if (d < 0) return <span className="text-accent"> · in ritardo di {d === -1 ? '1 giorno' : `${-d} giorni`}</span>;
                          if (d === 0) return <span className="text-accent"> · oggi</span>;
                          return null;
                        })()}
                        <span className="text-slate-500">
                          {nodeDetail.lastReviewRating && REVIEW_RATING_META[nodeDetail.lastReviewRating]
                            ? ` · ultimo giudizio ${REVIEW_RATING_META[nodeDetail.lastReviewRating].label.toLowerCase()}`
                            : ''}
                          {nodeDetail.reviewCount > 0 ? ` · ${nodeDetail.reviewCount} ripassi` : ''}
                          {nodeDetail.srsIntervalDays > 0 ? ` · intervallo ${nodeDetail.srsIntervalDays} gg` : ''}
                        </span>
                      </dd>
                    </div>
                  )}
                </dl>

                {/* V36.0 — Appunti in sola lettura: la prima cosa che
                    serve quando lo Spider-Sense chiede un ripasso. */}
                {nodeDetail.note && (
                  <div className="rounded-xl border border-line bg-surface/60 p-3.5">
                    <p className="ds-eyebrow flex items-center gap-1.5 mb-2">
                      <Icon name="note" className="w-3.5 h-3.5 text-secondary" />
                      Appunti
                    </p>
                    <p className="text-[13px] text-slate-200 whitespace-pre-wrap leading-relaxed font-mono">{nodeDetail.note}</p>
                  </div>
                )}

                {/* V38.0 — i due bilanci dell'argomento (fonti e appunti). */}
                <NodeWorkSummary sfida={nodeDetail} calibration={derived.calibration} />

                {/* Da studiare / in corso: Focus o completamento. */}
                {canComplete && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {canFocus ? (
                      <StartFocusButton materiaId={selectedMateria.id} sfidaId={nodeDetail.id} onStart={startFocusFromNode} />
                    ) : (
                      <span />
                    )}
                    <button type="button" onClick={() => handleAttemptComplete(nodeDetail)} className={BTN_SUCCESS}>
                      <Icon name="check" className="w-4 h-4" />
                      Completa argomento
                    </button>
                  </div>
                )}

                {/* V16.0 — Boss non ancora sconfitto: si spiega cosa manca. */}
                {bossLocked && (
                  <div className="space-y-2 pt-1">
                    <div className="rounded-xl border border-line bg-surface/60 px-4 py-3 flex items-start gap-3">
                      <Icon name="lock" className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      <p className="text-[13px] text-slate-300">
                        È un Boss: si chiude quando tutti i suoi sotto-argomenti sono completati.{' '}
                        <span className="text-slate-500 ds-num">
                          {pendingOwnChildren === 1 ? 'Ne manca 1' : `Ne mancano ${pendingOwnChildren}`} su {ownChildren.length}.
                        </span>
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {canFocus ? (
                        <StartFocusButton materiaId={selectedMateria.id} sfidaId={nodeDetail.id} onStart={startFocusFromNode} />
                      ) : (
                        <span />
                      )}
                      <button type="button" onClick={handleBossLockedAttempt} aria-disabled="true" className={`${BTN_SUCCESS} opacity-40`}>
                        <Icon name="lock" className="w-4 h-4" />
                        Completa argomento
                      </button>
                    </div>
                  </div>
                )}

                {/* Già studiato: interrogazione, poi il giudizio del ripasso
                    (V36.0: prima si tenta di richiamare, poi si giudica). */}
                {status === NODE_STATUS.IN_PROGRESS && (
                  <NodeQuizPanel
                    node={nodeDetail}
                    materiaId={selectedMateria.id}
                    onSaveQuiz={handleSaveQuiz}
                    onRegister={(esito) => actions.quizResult(selectedMateria.id, nodeDetail.id, esito)}
                  />
                )}

                {isDone && (
                  <>
                    <NodeQuizPanel
                      node={nodeDetail}
                      materiaId={selectedMateria.id}
                      onSaveQuiz={handleSaveQuiz}
                      onRegister={(esito) => actions.quizResult(selectedMateria.id, nodeDetail.id, esito)}
                    />
                    <div className="space-y-2">
                      <p className={`text-sm font-semibold flex items-center gap-2 ${status === NODE_STATUS.NEEDS_REVIEW ? 'text-accent' : 'text-slate-200'}`}>
                        <Icon name="radar" className="w-4 h-4" />
                        {status === NODE_STATUS.NEEDS_REVIEW ? 'Lo Spider-Sense formicola: com’è andato il ripasso?' : 'Ripasso anticipato: com’è andato?'}
                      </p>
                      <ReviewButtons
                        sfida={nodeDetail}
                        examDate={planningDate}
                        load={reviewLoadByDate(selectedSfide, nodeDetail.id)}
                        onReview={(rating) => {
                          handleReview(nodeDetail, rating);
                          closeNodeDetail();
                        }}
                      />
                    </div>
                    {canFocus && (
                      <StartFocusButton
                        materiaId={selectedMateria.id}
                        sfidaId={nodeDetail.id}
                        onStart={startFocusFromNode}
                        label="Ripassa con un blocco di Focus"
                        variant="ghost"
                        className="w-full"
                        intent="RIPASSO"
                      />
                    )}
                  </>
                )}

                {/* V42 — pratica sull'argomento: esercizi fuori dal timer e
                    interrogazione orale con K.A.R.E.N. */}
                {(canComplete || isDone) && !selectedMateria.examPassed && (
                  <div className="grid grid-cols-1 gap-2.5">
                    <EserciziLogger node={nodeDetail} onLog={(fatti, corretti) => actions.logEsercizi(selectedMateria.id, nodeDetail.id, fatti, corretti)} />
                    {(isDone || focusMin > 0) && (
                      <button
                        type="button"
                        onClick={() => setOralTarget({ materia: selectedMateria, sfide: [nodeDetail] })}
                        className={`${BTN_GHOST} w-full`}
                      >
                        <Icon name="speaker" className="w-4 h-4 text-secondary" />
                        Interrogazione orale su questo argomento
                      </button>
                    )}
                  </div>
                )}

                {/* Azioni secondarie, in fondo: mai il primo pulsante cliccabile per sbaglio. */}
                <div className="flex items-center justify-between gap-2 pt-3 border-t border-line flex-wrap">
                  {isDone ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReopenNodeTarget(nodeDetail);
                        closeNodeDetail();
                      }}
                      className="ds-btn ds-btn-quiet ds-btn-sm"
                    >
                      <Icon name="undo" className="w-3.5 h-3.5" />
                      Riporta a "da completare"
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteNodeTarget(nodeDetail);
                      closeNodeDetail();
                    }}
                    className="ds-btn ds-btn-quiet ds-btn-sm hover:!text-primary"
                  >
                    <Icon name="trash" className="w-3.5 h-3.5" />
                    Elimina argomento
                  </button>
                </div>
              </div>
            );
          })()}
      </Modal>

      <ConfirmDialog
        open={!!deleteNodeTarget}
        onClose={() => setDeleteNodeTarget(null)}
        onConfirm={() => actions.deleteSfida(selectedMateria.id, deleteNodeTarget.id)}
        title="Eliminare l'argomento?"
        message={`"${deleteNodeTarget?.nome}" verrà eliminato (potrai annullare dalla notifica). I suoi sotto-argomenti non si perdono: diventano argomenti principali.`}
        confirmLabel="Elimina"
      />

      <ConfirmDialog
        open={!!reopenNodeTarget}
        onClose={() => setReopenNodeTarget(null)}
        onConfirm={confirmReopenNode}
        title="Riportare a da completare?"
        message={`"${reopenNodeTarget?.nome}" torna fra gli argomenti da studiare.${
          Number(reopenNodeTarget?.xpAwarded) > 0 ? ` I ${reopenNodeTarget.xpAwarded} XP del completamento vengono ritirati: li riprendi quando lo richiudi.` : ''
        } Tempo di studio, appunti e memoria stimata restano.`}
        confirmLabel="Riporta indietro"
        danger={false}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        onConfirm={confirmBulkDeleteNodes}
        title={
          selectedNodeIds.size === 1
            ? "Eliminare l'argomento selezionato?"
            : selectedSfide.length > 0 && selectedNodeIds.size >= selectedSfide.length
            ? `Eliminare tutto lo Skill Tree (${selectedNodeIds.size} argomenti)?`
            : `Eliminare ${selectedNodeIds.size} argomenti?`
        }
        message={`I sotto-argomenti non selezionati non si perdono: diventano argomenti principali. Tempo di studio, appunti e ripassi degli argomenti eliminati spariscono${
          selectedNodeIds.size >= 5 ? ': prima viene salvato un punto di ripristino (Impostazioni → Backup)' : ''
        }; per qualche secondo puoi annullare dal messaggio in basso.`}
        confirmLabel="Elimina"
      />

      <ConfirmDialog
        open={nodeEditCloseConfirmOpen}
        onClose={() => setNodeEditCloseConfirmOpen(false)}
        onConfirm={closeNodeDetail}
        title="Modifiche non salvate"
        message="Chiudendo ora le modifiche all'argomento andranno perse. Vuoi scartarle?"
        confirmLabel="Scarta modifiche"
      />

      {/* V42 — simulazione d'esame, ricostruzione, interrogazione orale. */}
      <SimulazioneModal
        open={simulazioneOpen}
        onClose={() => setSimulazioneOpen(false)}
        materia={selectedMateria}
        onSave={(sim) => {
          if (selectedMateria) actions.addSimulazione(selectedMateria.id, sim);
          setSimulazioneOpen(false);
          pushToast('Simulazione registrata: entra nella prontezza d’esame.', 'success');
        }}
      />
      <RicostruisciModal
        open={ricostruisciOpen}
        onClose={() => setRicostruisciOpen(false)}
        materia={selectedMateria}
        onConfirm={(opzioni) => {
          if (selectedMateria) actions.ricostruisciMateria(selectedMateria.id, opzioni);
          setRicostruisciOpen(false);
        }}
      />
      <OralExamModal
        open={!!oralTarget}
        onClose={() => setOralTarget(null)}
        materia={oralTarget?.materia || null}
        sfide={oralTarget?.sfide || []}
        onRegister={(sfidaId, esito) => {
          if (oralTarget?.materia) actions.quizResult(oralTarget.materia.id, sfidaId, esito);
        }}
      />

      {/* Drawer: ripassi in sospeso, da fare in blocco. */}
      <Drawer
        open={spiderSenseDrawerOpen}
        onClose={() => setSpiderSenseDrawerOpen(false)}
        eyebrow="Spider-Sense"
        title={reviewsDue === 0 ? 'Nessun ripasso in sospeso' : reviewsDue === 1 ? '1 ripasso in sospeso' : `${reviewsDue} ripassi in sospeso`}
        subtitle={reviewsDue > 0 ? 'Rispondi a mente, poi giudica com’è andata: il prossimo ripasso si sposta di conseguenza.' : undefined}
      >
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain af-scroll p-4 sm:p-5 space-y-2.5">
          {reviewsDue === 0 ? (
            <EmptyState variant="safe" title="La città è sicura." subtitle="Nessun ripasso in sospeso. Torna dopo aver completato nuovi argomenti." />
          ) : (
            derived.upcomingReviews.map((r) => {
              const diffMeta = DIFFICULTY_META[r.difficulty] || DIFFICULTY_META.MEDIUM;
              return (
                <div key={r.sfidaId} className="rounded-xl border border-line bg-surface/70 p-3.5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSpiderSenseDrawerOpen(false);
                        openNodeFromSchedule(r.materiaId, r.sfidaId);
                      }}
                      className="min-w-0 text-left group"
                      title="Apri l'argomento (appunti e interrogazione)"
                    >
                      <p className="text-sm font-medium break-words text-slate-100 group-hover:text-white">{r.sfidaNome}</p>
                      <p className="text-xs text-slate-500">{r.materiaNome}</p>
                    </button>
                    <span className={`${BADGE.slate} shrink-0`}>{diffMeta.label}</span>
                  </div>
                  {(() => {
                    const m = derived.materiePiano.find((x) => x.id === r.materiaId);
                    const nodo = (m?.sfide || []).find((x) => x.id === r.sfidaId) || null;
                    return (
                      <ReviewButtons
                        size="small"
                        sfida={nodo || r}
                        examDate={m?.examDate || null}
                        load={m ? reviewLoadByDate(m.sfide, r.sfidaId) : null}
                        onReview={(rating) => actions.reviewSfida(r.materiaId, r.sfidaId, rating)}
                      />
                    );
                  })()}
                </div>
              );
            })
          )}
        </div>
      </Drawer>
    </div>
  );
}
