import { daysUntilDateOnly } from '../utils/dateUtils.js';
import { computeRemainingHours } from '../utils/materiaMeta.js';

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
  { id: 'aerodinamica', nome: 'Aerodinamica', cfu: 15, anno: 2, semestre: '1-2', prereq: ['analisi1', 'algebra', 'fisica', 'chimica'] },
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
 * THE PRESSURE FORMULA — V36.0 (sostituisce la Time-Weaver Formula).
 *
 * La V20.0 calcolava `Difficoltà + Esami Sbloccati + 1000/Giorni`. Due
 * difetti strutturali:
 *
 *  1. Ignorava COMPLETAMENTE il lavoro residuo. Una materia a 20 giorni
 *     con 3 ore rimaste scavalcava una a 25 giorni con 80 ore da fare —
 *     cioè il contrario di quello che serve.
 *  2. Conviveva con un SECONDO motore di priorità (il paceRatio della
 *     Quota Odierna, useKarenAutoRouter.js) che usava criteri diversi:
 *     "Primary Target" e "In focus oggi" potevano quindi indicare due
 *     materie differenti nello stesso momento, senza che nulla nell'app
 *     spiegasse perché.
 *
 * La nuova formula misura UNA cosa sola, la stessa che guarda la Quota
 * Odierna — quanto sei in ritardo rispetto al tempo che ti resta:
 *
 *   pressione   = ore residue / (giorni mancanti × capacità giornaliera)
 *   importanza  = 1 + peso esami sbloccati/4 + (difficoltà-3)/10 + CFU/30
 *   SpiderScore = 10 × pressione × importanza + termine strutturale
 *
 * `pressione` > 1 significa letteralmente "al tuo ritmo reale non ci
 * arrivi". Il tempo resta il fattore dominante (è al denominatore) ma
 * ora domina PER UN MOTIVO misurabile, non per una iperbole 1/x. Il
 * termine strutturale (piccolo, 0-10) serve solo a ordinare in modo
 * sensato le materie SENZA data d'esame, dove la pressione è per
 * definizione nulla: Karen non inventa urgenza che non esiste, ma
 * nemmeno le tratta tutte come equivalenti.
 *
 * `computeUnlockWeight` (peso in CFU degli esami sbloccati) era già
 * scritto dalla V18.0 e non veniva usato da nessuno: qui rientra in
 * gioco al posto del conteggio grezzo, così superare uno snodo come
 * Analisi 1 pesa più che superare un esame terminale.
 */
export const PRESSURE_SCALE = 10;

/** Capacità giornaliera di fallback, identica a HOURS_PER_NODE_DAY: la
 * copia locale evita una dipendenza del data layer verso utils/ per un
 * solo numero. Il valore REALE arriva sempre da `calibration.hoursPerDay`
 * quando il chiamante lo passa (vedi utils/calibration.js). */
const FALLBACK_CAPACITY_HOURS = 4.5;

/** Quanto pesa strategicamente una materia, a prescindere dalla scadenza. */
export function computeImportanceFactor(materia) {
  const difficulty = Number(materia?.perceivedDifficulty) || 3;
  const cfu = Number(materia?.cfu) || 0;
  return 1 + computeUnlockWeight(materia?.courseId) / 4 + (difficulty - 3) / 10 + cfu / 30;
}

/**
 * Pressione temporale pura: ore residue su ore realmente disponibili
 * prima dell'esame. `null` quando non esiste una data d'esame — chi
 * chiama decide come trattarla (qui: termine azzerato).
 */
export function computePressure(remainingHours, examDate, capacityHours = FALLBACK_CAPACITY_HOURS) {
  if (!examDate || remainingHours <= 0) return 0;
  const daysRemaining = daysUntilDateOnly(examDate);
  if (daysRemaining == null) return 0;
  // V39.0 — Data nel passato: non è un esame "scaduto ieri" da preparare
  // a tutta velocità, è un appello già sostenuto in attesa di verbale (o
  // da riprogrammare). Trattarlo con mezza giornata di margine lo
  // faceva esplodere a Primary Target proprio quando non c'era più
  // niente da fare. Vale come "nessuna data" finché non lo aggiorni.
  if (daysRemaining < 0) return 0;
  // Esame OGGI con lavoro aperto: mezza giornata di margine, così la
  // pressione esplode invece di dividere per 0.
  const effectiveDays = Math.max(0.5, daysRemaining);
  const capacity = capacityHours > 0 ? capacityHours : FALLBACK_CAPACITY_HOURS;
  return remainingHours / (effectiveDays * capacity);
}

/**
 * @param {object} materia
 * @param {object|null} calibration pacchetto di utils/calibration.js.
 *        Omesso = comportamento neutro (capacità 4.5 h/g, bias 1.0).
 */
export function computeSpiderScore(materia, calibration = null) {
  if (!materia) return 0;
  const capacity = Number(calibration?.hoursPerDay) > 0 ? Number(calibration.hoursPerDay) : FALLBACK_CAPACITY_HOURS;
  const remainingHours = computeRemainingHours(materia, calibration);
  const pressure = computePressure(remainingHours, materia.examDate, capacity);
  const importance = computeImportanceFactor(materia);

  const difficulty = Number(materia.perceivedDifficulty) || 3;
  const structural = computeUnlockWeight(materia.courseId) + (difficulty - 3) * 0.5 + (Number(materia.cfu) || 0) / 6;

  return Math.round((PRESSURE_SCALE * pressure * importance + structural) * 10) / 10;
}

/**
 * V37.0 — CFU totali del piano di studi (180 per una laurea triennale,
 * ed è esattamente la somma dei corsi qui sopra). È il denominatore
 * della stima del tempo di laurea: senza un totale, "quanto manca" non
 * ha risposta. Calcolato dalla lista invece che scritto a mano, così
 * aggiungere o togliere un corso non lascia indietro una costante.
 */
export const PIANO_CFU_TOTALI = VANVITELLI_COURSES.reduce((sum, c) => sum + (Number(c.cfu) || 0), 0);

export const DIFFICULTY_SLIDER_LABELS = ['Banale', 'Gestibile', 'Media', 'Ostica', 'Incubo'];
// V36.0 — `URGENCY_SLIDER_LABELS` rimosso: lo slider manuale di Urgenza
// non esiste più dalla V20.0 (la pressione temporale si calcola dalla data
// d'esame reale) e le sue etichette erano rimaste qui senza un solo
// consumatore. Il campo `urgency` sopravvive nello schema dati solo per
// non rompere i profili salvati: non entra in nessun calcolo.
