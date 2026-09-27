/**
 * V27.0 — Pillar 2: "AI Index Matrix" (Skill Tree Generator).
 *
 * Motore puro di parsing/validazione per l'importazione bulk di un indice
 * di libro/materia generato via prompt esterno a partire da una foto
 * dell'indice. Accetta una struttura JSON ragionevolmente libera (più
 * chiavi alternative per ogni campo, così qualunque prompt "ragionevole"
 * dato a un'IA esterna produca un output compatibile) e la normalizza
 * nello schema interno di `sfida` (vedi skillTree.js/createSfida), con
 * stima automatica di difficoltà e giorni quando non forniti.
 *
 * Formato atteso (esempio minimo):
 *   [
 *     { "nome": "Meccanica Razionale", "sottoargomenti": [
 *       "Cinematica del punto", { "nome": "Dinamica del corpo rigido", "difficolta": "HARD" }
 *     ]},
 *     ...
 *   ]
 * Oppure un oggetto wrapper: { "nodes": [...] } / { "capitoli": [...] }.
 * Ogni nodo Figlio può a sua volta avere propri sottoargomenti (nessun
 * limite di profondità — stesso motore ricorsivo del Web-Matrix).
 *
 * V34.2 — "Ore Previste": il campo di stima è passato da "giorni" (intero)
 * a "ore" (decimale, unità nativa del nodo — vedi skillTree.js/createSfida
 * e materiaMeta.js). Questo parser è puramente transiente (interpreta un
 * JSON incollato al momento, non dati persistiti), quindi qui non serve
 * alcuna migrazione: si riconoscono direttamente le chiavi "ore".
 */
import { PERSISTED_STATUS } from './skillTree.js';
import { DEFAULT_EASE } from './spiderSense.js';
import { DIFFICULTY } from './xpEngine.js';

/** Tetto di sicurezza sul numero totale di nodi importabili in un colpo
 * solo — "senza appesantire il rendering del componente principale": un
 * indice mostruoso viene rifiutato con un messaggio chiaro invece di
 * rischiare centinaia di card renderizzate in un colpo solo. */
export const MAX_AI_INDEX_NODES = 250;

const NAME_KEYS = ['nome', 'capitolo', 'titolo', 'title', 'name'];
const OBJ_KEYS = ['obiettivo', 'descrizione', 'description', 'summary', 'note'];
const DIFF_KEYS = ['difficolta', 'difficoltà', 'difficulty', 'livello'];
const HOURS_KEYS = ['ore', 'oreStimate', 'ore_stimate', 'hours', 'durataOre'];
const CHILDREN_KEYS = ['sottoargomenti', 'figli', 'children', 'subitems', 'argomenti', 'nodi', 'sottocapitoli'];
const ROOT_KEYS = ['nodes', 'capitoli', 'indice', 'index', 'argomenti', 'materie', 'chapters'];

const DEFAULT_HOURS_BY_DIFFICULTY = { EASY: 2, MEDIUM: 4, HARD: 8 };

/** Esempio pronto per il pulsante "Carica Esempio" della modale. */
export const AI_INDEX_EXAMPLE = JSON.stringify(
  [
    {
      nome: 'Meccanica Razionale',
      sottoargomenti: [
        'Cinematica del punto materiale',
        { nome: 'Dinamica del corpo rigido', difficolta: 'HARD', ore: 8 },
        { nome: 'Equazioni di Lagrange', difficolta: 'HARD' }
      ]
    },
    {
      nome: 'Termodinamica Applicata',
      obiettivo: 'Cicli termodinamici e trasmissione del calore',
      sottoargomenti: ['Primo principio', 'Secondo principio', 'Scambiatori di calore']
    }
  ],
  null,
  2
);

/**
 * V41 — Prompt pronto da copiare nell'IA esterna insieme alla foto
 * dell'indice. Chiede esattamente il formato che questo parser legge.
 */
export function buildAiIndexPrompt(materiaNome = '') {
  const oggetto = materiaNome ? `di ${materiaNome}` : 'universitario';
  return [
    `Ti allego la foto dell'indice di un libro ${oggetto}. Trascrivilo in JSON, senza testo prima o dopo.`,
    'Formato: un array di capitoli. Ogni capitolo è {"nome": "...", "sottoargomenti": [...]}; ogni sottoargomento è una stringa, oppure un oggetto {"nome": "...", "sottoargomenti": [...]} se ha a sua volta dei sottoparagrafi.',
    'Regole:',
    "- usa i titoli come sono scritti nell'indice, senza i numeri di pagina;",
    "- non aggiungere argomenti che nell'indice non ci sono;",
    '- solo se riesci a stimarlo, aggiungi ai sottoargomenti più impegnativi "difficolta": "EASY", "MEDIUM" o "HARD" e "ore" (ore di studio previste).'
  ].join('\n');
}

/**
 * V41 — Le IA rispondono quasi sempre con il JSON dentro un blocco di
 * codice (```json … ```), spesso con una frase prima o dopo; copiando da
 * certe app le virgolette diventano “tipografiche”. Prima tutto questo
 * andava ripulito a mano, altrimenti "JSON non valido". Qui si provano
 * più letture, dalla più fedele alla più tollerante: il testo così
 * com'è, il primo blocco di codice, il tratto fra la prima parentesi
 * aperta e l'ultima chiusa, poi le stesse con virgolette dritte e senza
 * virgole finali.
 */
export function jsonCandidates(text) {
  const base = String(text || '').trim();
  const out = [base];
  const fence = base.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fence && fence[1].trim()) out.push(fence[1].trim());
  const first = base.search(/[[{]/);
  const last = Math.max(base.lastIndexOf(']'), base.lastIndexOf('}'));
  if (first >= 0 && last > first) out.push(base.slice(first, last + 1));
  const tolerant = out.map((c) => c.replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"').replace(/,\s*([\]}])/g, '$1'));
  return [...new Set([...out, ...tolerant])];
}

function pickField(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/**
 * Euristica di difficoltà quando l'IA esterna non l'ha già assegnata:
 * accetta EASY/MEDIUM/HARD (qualunque case), Facile/Media/Difficile in
 * italiano, o una scala numerica 1-5. In assenza totale di indicazioni,
 * stima dalla lunghezza del nome+obiettivo (argomenti descritti in modo
 * più esteso tendono a essere più corposi da studiare) — mai un default
 * fisso identico per ogni nodo importato.
 */
function normalizeDifficulty(raw, fallbackText) {
  if (typeof raw === 'string') {
    const up = raw.trim().toUpperCase();
    if (['EASY', 'FACILE', 'BASSA', '1', '2'].includes(up)) return DIFFICULTY.EASY;
    if (['HARD', 'DIFFICILE', 'ALTA', '4', '5'].includes(up)) return DIFFICULTY.HARD;
    if (['MEDIUM', 'MEDIA', '3'].includes(up)) return DIFFICULTY.MEDIUM;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw <= 2) return DIFFICULTY.EASY;
    if (raw >= 4) return DIFFICULTY.HARD;
    return DIFFICULTY.MEDIUM;
  }
  const len = (fallbackText || '').trim().length;
  if (len <= 18) return DIFFICULTY.EASY;
  if (len <= 34) return DIFFICULTY.MEDIUM;
  return DIFFICULTY.HARD;
}

/** Normalizza ricorsivamente un nodo grezzo (stringa o oggetto) nello schema interno intermedio. */
function normalizeNode(raw) {
  if (typeof raw === 'string') {
    const nome = raw.trim();
    if (!nome) return null;
    return { nome, obiettivo: '', difficulty: normalizeDifficulty(undefined, nome), oreStimate: null, children: [] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const nomeRaw = pickField(raw, NAME_KEYS);
  const nome = typeof nomeRaw === 'string' ? nomeRaw.trim() : '';
  if (!nome) return null;

  const obiettivoRaw = pickField(raw, OBJ_KEYS);
  const obiettivo = typeof obiettivoRaw === 'string' ? obiettivoRaw.trim() : '';

  const difficultyRaw = pickField(raw, DIFF_KEYS);
  const difficulty = normalizeDifficulty(difficultyRaw, `${nome} ${obiettivo}`);

  const hoursRaw = pickField(raw, HOURS_KEYS);
  const hoursNum = Number(hoursRaw);
  const oreStimate = Number.isFinite(hoursNum) && hoursNum > 0 ? Math.round(hoursNum * 2) / 2 : null; // arrotonda a step di 0.5h

  const childrenRaw = pickField(raw, CHILDREN_KEYS);
  const children = Array.isArray(childrenRaw) ? childrenRaw.map(normalizeNode).filter(Boolean) : [];

  return { nome, obiettivo, difficulty, oreStimate, children };
}

function countNodes(tree) {
  return tree.reduce((sum, n) => sum + 1 + countNodes(n.children || []), 0);
}

/**
 * Fase 1 — parsing + validazione + normalizzazione in un ALBERO annidato
 * (usato dalla modale per l'anteprima live prima di confermare). Accetta
 * sia una stringa grezza (JSON.parse interno) sia un valore già
 * deserializzato (per riutilizzo interno).
 */
export function parseAiIndexTree(rawInput) {
  let data = rawInput;
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) return { valid: false, error: 'Incolla prima una struttura JSON valida (indice generato dall\'IA a partire dalla foto del libro).' };
    let parsedOk = false;
    let firstError = null;
    for (const candidate of jsonCandidates(trimmed)) {
      try {
        data = JSON.parse(candidate);
        parsedOk = true;
        break;
      } catch (err) {
        if (!firstError) firstError = err;
      }
    }
    if (!parsedOk) {
      return {
        valid: false,
        error: `Non riesco a leggere il JSON: controlla di aver incollato tutta la risposta, fino all'ultima parentesi. (${firstError?.message || 'formato non valido'})`
      };
    }
  }

  let list = data;
  if (!Array.isArray(list)) {
    if (list && typeof list === 'object') {
      const rootArr = ROOT_KEYS.map((k) => list[k]).find((v) => Array.isArray(v));
      list = rootArr || null;
    } else {
      list = null;
    }
  }
  if (!Array.isArray(list) || list.length === 0) {
    return {
      valid: false,
      error: 'Struttura non riconosciuta: attesa una lista di capitoli (array), oppure un oggetto con chiave "nodes"/"capitoli"/"indice".'
    };
  }

  const tree = list.map(normalizeNode).filter(Boolean);
  if (tree.length === 0) {
    return { valid: false, error: 'Nessun nodo valido trovato: ogni capitolo deve avere un nome/titolo non vuoto.' };
  }

  const totalCount = countNodes(tree);
  if (totalCount > MAX_AI_INDEX_NODES) {
    return {
      valid: false,
      error: `Struttura troppo grande (${totalCount} nodi, massimo ${MAX_AI_INDEX_NODES}) — dividi l'indice in più importazioni separate per non appesantire il rendering dello Skill Tree.`
    };
  }

  return { valid: true, tree, totalCount };
}

/**
 * Fase 2 — appiattisce l'albero normalizzato in un array piatto di
 * `sfida` pronte per il reducer (stesso identico shape di createSfida,
 * vedi skillTree.js), con `id`/`parentId` già risolti — mai un secondo
 * passaggio di risoluzione lato reducer.
 */
export function flattenAiIndexTree(tree) {
  const sfide = [];
  function visit(node, parentId) {
    const id = `sfida_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const oreStimate = node.oreStimate || DEFAULT_HOURS_BY_DIFFICULTY[node.difficulty] || DEFAULT_HOURS_BY_DIFFICULTY.MEDIUM;
    sfide.push({
      id,
      nome: node.nome,
      obiettivo: node.obiettivo || '',
      oreStimate,
      parentId: parentId || null,
      difficulty: node.difficulty,
      status: PERSISTED_STATUS.PENDING,
      completionTimestamp: null,
      nextReviewDate: null,
      lastReviewRating: null,
      reviewCount: 0,
      focusMinutes: 0,
      blueprint: '',
      // V36.0 — stessi campi di createSfida (skillTree.js): appunti del
      // nodo e stato della curva SM-2. Senza, un nodo importato dall'AI
      // Index Matrix resterebbe incompleto fino al primo reload (dove
      // hydrateState lo migrerebbe comunque) — meglio nascerlo completo.
      note: '',
      srsEase: DEFAULT_EASE,
      srsIntervalDays: 0,
      // V38.0 — "La Forgia degli Appunti" (utils/sintesiEngine.js). Un
      // indice generato dall'IA non conosce le TUE fonti né quante
      // pagine di appunti ne ricaverai: nasce vuoto su entrambi e il
      // nodo si comporta come un nodo senza fonti finché non li
      // compili. Il campo deve comunque esistere alla nascita, come i
      // due sopra, o il nodo resterebbe incompleto fino al primo
      // reload.
      fonti: [],
      pagineAppunti: 0,
      appuntiCompleti: false,
      focusMinutesSintesi: 0,
      focusMinutesStudio: 0,
      tentativiSuccessi: 0,
      tentativiFalliti: 0
    });
    (node.children || []).forEach((child) => visit(child, id));
  }
  tree.forEach((node) => visit(node, null));
  return sfide;
}

/**
 * Convenienza end-to-end consumata dall'action `bulkImportSkillTree`:
 * accetta sia testo grezzo sia un albero già normalizzato (riuso interno
 * dalla modale, che ha già validato in anteprima) e ritorna direttamente
 * l'array piatto di `sfida` pronto per il dispatch, o l'errore.
 */
export function createSfideTreeFromAiIndex(rawInputOrTree) {
  const isPreNormalizedTree = Array.isArray(rawInputOrTree) && rawInputOrTree.every((n) => n && typeof n === 'object' && 'children' in n && 'difficulty' in n);
  const parsed = isPreNormalizedTree ? { valid: true, tree: rawInputOrTree } : parseAiIndexTree(rawInputOrTree);
  if (!parsed.valid) return parsed;
  const sfide = flattenAiIndexTree(parsed.tree);
  if (sfide.length === 0) return { valid: false, error: 'Nessun nodo da importare.' };
  return { valid: true, sfide };
}

export default { parseAiIndexTree, flattenAiIndexTree, createSfideTreeFromAiIndex, MAX_AI_INDEX_NODES, AI_INDEX_EXAMPLE, buildAiIndexPrompt, jsonCandidates };
