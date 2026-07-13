import { daysUntilDateOnly } from '../utils/dateUtils.js';

/**
 * WEB-PATH PLANNER — Piano di Studi UFFICIALE "Ingegneria Aerospaziale"
 * (Università degli Studi della Campania "Luigi Vanvitelli").
 *
 * V18.0 — "The Multiverse Projection": database ESATTO fornito dall'utente
 * (CFU, semestre, propedeuticità reali), a sostituzione integrale della
 * mappa precedente (che conteneva corsi/CFU rappresentativi ma non
 * ufficiali). Nessun valore qui sotto è inventato: se un corso non ha
 * propedeuticità dichiarate, `prereq` resta `[]`.
 *
 * Karen: "Ho ricostruito la mappa dei tuoi corsi. Analisi in corso."
 */
export const CUSTOM_COURSE_ID = '__custom__';

export const VANVITELLI_COURSES = [
  // --- 1° Anno ---
  { id: 'analisi1', nome: 'Analisi Matematica 1', cfu: 12, anno: 1, semestre: '1-2', prereq: [] },
  { id: 'fisica', nome: 'Fisica', cfu: 12, anno: 1, semestre: '1-2', prereq: [] },
  { id: 'algebra', nome: 'Algebra Lineare e Geometria Analitica', cfu: 6, anno: 1, semestre: '2', prereq: [] },
  { id: 'chimica', nome: 'Chimica', cfu: 6, anno: 1, semestre: '1', prereq: [] },
  { id: 'programmazione', nome: 'Elementi di Programmazione', cfu: 6, anno: 1, semestre: '2', prereq: [] },
  { id: 'disegno', nome: 'Disegno Industriale', cfu: 6, anno: 1, semestre: '2', prereq: [] },
  { id: 'economia', nome: 'Economia e Organizzazione Aziendale', cfu: 6, anno: 1, semestre: '1', prereq: [] },

  // --- 2° Anno ---
  { id: 'analisi2', nome: 'Analisi Matematica 2', cfu: 9, anno: 2, semestre: '1', prereq: ['analisi1'] },
  { id: 'meccanica', nome: 'Elementi di Meccanica', cfu: 6, anno: 2, semestre: '1', prereq: ['analisi1', 'algebra'] },
  { id: 'elettrotecnica', nome: 'Elettrotecnica', cfu: 6, anno: 2, semestre: '1', prereq: ['analisi1', 'algebra', 'fisica', 'chimica'] },
  { id: 'inglese', nome: 'Inglese', cfu: 3, anno: 2, semestre: '1', prereq: [] },
  { id: 'aerodinamica', nome: 'Aerodinamica', cfu: 15, anno: 2, semestre: '1-2', prereq: ['analisi1', 'algebra'] },
  { id: 'materiali', nome: "Materiali per l'Aeronautica e lo Spazio", cfu: 6, anno: 2, semestre: '2', prereq: ['analisi1', 'fisica', 'chimica'] },
  { id: 'calcoloNumerico', nome: 'Calcolo Numerico', cfu: 6, anno: 2, semestre: '2', prereq: [] },
  { id: 'scienzaCostruzioni', nome: 'Scienza delle Costruzioni', cfu: 9, anno: 2, semestre: '2', prereq: ['meccanica'] },

  // --- 3° Anno ---
  { id: 'costruzioniAero', nome: 'Costruzioni Aeronautiche', cfu: 9, anno: 3, semestre: '1', prereq: ['scienzaCostruzioni'] },
  { id: 'meccanicaVolo', nome: 'Meccanica del Volo', cfu: 9, anno: 3, semestre: '1', prereq: ['aerodinamica'] },
  { id: 'sistemiAvionici', nome: 'Sistemi Avionici di Navigazione Aerospaziale', cfu: 6, anno: 3, semestre: '1', prereq: ['meccanica', 'analisi2'] },
  { id: 'propulsione', nome: 'Propulsione Aerospaziale', cfu: 6, anno: 3, semestre: '2', prereq: ['aerodinamica', 'fisica'] },
  { id: 'trasmissioneCalore', nome: 'Trasmissione del Calore', cfu: 6, anno: 3, semestre: '2', prereq: ['analisi2', 'fisica'] },
  { id: 'sceltaLibera', nome: 'A scelta dello studente', cfu: 18, anno: 3, semestre: '-', prereq: [], ungraded: false },
  { id: 'altreAttivita', nome: 'Altre attività', cfu: 9, anno: 3, semestre: '-', prereq: [], ungraded: true },
  { id: 'provaFinale', nome: 'Prova Finale', cfu: 3, anno: 3, semestre: '-', prereq: [], ungraded: true }
];

const COURSE_BY_ID = new Map(VANVITELLI_COURSES.map((c) => [c.id, c]));

export function getCourseById(id) {
  if (!id) return null;
  return COURSE_BY_ID.get(id) || null;
}

/** Opzioni pronte per la Dropdown del Web-Path Planner, ordinate per Anno + Nome, con la voce "Materia Libera" in coda. */
export function getCourseDropdownOptions() {
  const sorted = [...VANVITELLI_COURSES].sort((a, b) => (a.anno - b.anno) || a.nome.localeCompare(b.nome));
  return [
    ...sorted.map((c) => ({ value: c.id, label: `[${c.anno}° anno] ${c.nome} · ${c.cfu} CFU` })),
    { value: CUSTOM_COURSE_ID, label: '+ Materia Libera (fuori piano di studi)' }
  ];
}

/** Quanti corsi del piano hanno QUESTO corso come propedeuticità diretta — il numero "grezzo" mostrato da Karen ("sblocca N esami"). */
export function computeDirectUnlockCount(courseId) {
  if (!courseId) return 0;
  return VANVITELLI_COURSES.filter((c) => c.prereq.includes(courseId)).length;
}

/**
 * "Peso degli esami sbloccati": quanti (e quanto pesanti in CFU) sono i
 * corsi che hanno QUESTO corso come propedeuticità nel grafo ufficiale.
 * Superare un esame "snodo" (es. Analisi 1) sblocca molto più valore
 * strategico di uno terminale — il punteggio riflette questo.
 */
export function computeUnlockWeight(courseId) {
  if (!courseId) return 0;
  const dependents = VANVITELLI_COURSES.filter((c) => c.prereq.includes(courseId));
  if (dependents.length === 0) return 0;
  const raw = dependents.reduce((sum, c) => sum + 1 + c.cfu / 12, 0);
  return Math.round(raw * 10) / 10;
}

/** Un corso propedeutico si considera superato se esiste una Materia con quel courseId (o stesso nome, per voci Libere) marcata Esame Superato. */
function isPrereqSatisfied(prereqId, materie, excludeMateriaId) {
  const prereqCourse = getCourseById(prereqId);
  const prereqNome = prereqCourse ? prereqCourse.nome.trim().toLowerCase() : '';
  return materie.some((m) => {
    if (!m || !m.examPassed) return false;
    if (excludeMateriaId && m.id === excludeMateriaId) return false;
    if (m.courseId && m.courseId === prereqId) return true;
    if ((m.nome || '').trim().toLowerCase() === prereqNome) return true;
    return false;
  });
}

/** Elenco (nomi leggibili) delle propedeuticità ufficiali NON ancora superate per un dato corso, dato lo stato attuale delle Materie dell'utente. */
export function getMissingPrerequisites(courseId, materie, excludeMateriaId = null) {
  const course = getCourseById(courseId);
  if (!course || course.prereq.length === 0) return [];
  const safeMaterie = Array.isArray(materie) ? materie : [];
  return course.prereq
    .filter((pid) => !isPrereqSatisfied(pid, safeMaterie, excludeMateriaId))
    .map((pid) => getCourseById(pid))
    .filter(Boolean);
}

/**
 * THE TIME-WEAVER FORMULA — V20.0 "The Master Control" (Pillar 2).
 *
 * Il vecchio Spider-Score (Difficoltà + Urgenza manuale + Peso esami
 * sbloccati) sottostimava sistematicamente il fattore tempo: un esame a
 * 90 giorni con propedeuticità pesanti poteva scavalcare un esame a 10
 * giorni. Karen ora pesa il TEMPO come fattore dominante assoluto,
 * calcolato automaticamente dalla data d'esame reale (mai più uno slider
 * manuale soggettivo di "Urgenza" — la scadenza parla da sola):
 *
 *   SpiderScore = Difficoltà Percepita (1-5)
 *               + Esami Sbloccati (conteggio diretto dal grafo ufficiale)
 *               + 1000 / Giorni Mancanti all'esame
 *
 * A 30 giorni il termine tempo vale 33.3, a 90 giorni vale 11.1: un
 * esame vicino scavalca sempre uno lontano, anche se quest'ultimo
 * sblocca più propedeuticità — esattamente la Direttiva Suprema
 * richiesta ("il tempo scavalca ogni altra priorità"). Se l'esame non ha
 * ancora una data impostata, il termine tempo è 0 (Karen non inventa
 * pressione temporale che non esiste): il punteggio resta comunque
 * calcolabile da Difficoltà + Esami Sbloccati.
 */
const TIME_WEAVER_NUMERATOR = 1000;

/** Termine tempo puro della Time-Weaver Formula, isolato per riuso (HUD, Event Horizon, debug). */
export function computeTimeWeight(examDate) {
  if (!examDate) return 0;
  const daysRemaining = daysUntilDateOnly(examDate);
  if (daysRemaining == null) return 0;
  if (daysRemaining <= 0) return TIME_WEAVER_NUMERATOR; // esame oggi/scaduto: massima pressione temporale.
  return TIME_WEAVER_NUMERATOR / daysRemaining;
}

export function computeSpiderScore(materia) {
  if (!materia) return 0;
  const difficulty = Number(materia.perceivedDifficulty) || 3;
  const unlocksCount = computeDirectUnlockCount(materia.courseId);
  const timeWeight = computeTimeWeight(materia.examDate);
  return Math.round((difficulty + unlocksCount + timeWeight) * 10) / 10;
}

export const DIFFICULTY_SLIDER_LABELS = ['Banale', 'Gestibile', 'Media', 'Ostica', 'Incubo'];
export const URGENCY_SLIDER_LABELS = ['Nessuna Fretta', 'Bassa', 'Media', 'Alta', 'Critica'];
