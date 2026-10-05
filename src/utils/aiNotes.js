// =====================================================================
// ArachnoForge — src/utils/aiNotes.js (V44)
// APPUNTI CON L'IA ESTERNA: il prompt da copiare e la lettura della risposta.
//
// Scrivere a mano pagine di appunti con le formule è impossibile. Qui si
// prepara un prompt per un'IA esterna (ChatGPT, Claude, Gemini) a cui
// alleghi il tuo materiale (slide, libro, dispense, foto degli appunti):
// risponde con gli appunti di ogni argomento in un formato fisso, che
// l'app riconosce e salva sui nodi.
//
// Il formato è pensato per DUE lettori: tu (ripasso) e K.A.R.E.N., che
// dagli appunti costruisce quiz, interrogazioni orali e correzioni. Le
// sezioni fisse ("## Formule", "## Errori tipici", ...) le dicono dove
// trovare cosa (vedi karen-oracle/_logic.ts, NOTE_STRUCTURE_HINT).
//
// Perché non JSON (come l'AI Index Matrix): appunti lunghi, a capo e
// formule con barre rovesciate rendono il JSON fragile; un blocco di testo
// con una riga d'intestazione per argomento si incolla e si legge sempre.
//
//   @@ARGOMENTO [k2p9x7] Equazioni di Lagrange
//   ## In breve
//   ...
//   @@FINE
//
// Il codice fra parentesi quadre è la coda dell'id del nodo: stabile
// (non cambia se aggiungi o togli altri argomenti), così puoi incollare la
// risposta anche dopo, o in un'altra sessione.
//
// Modulo PURO: niente React, niente stato.
// =====================================================================

/** Quanto degli appunti di un argomento legge K.A.R.E.N. (quiz, orale, correzione). */
export const AI_NOTES_KAREN_CHARS = 6000;
/** Lunghezza che il prompt chiede per argomento (sta comoda sotto il limite). */
export const AI_NOTES_TARGET_CHARS = 4500;
/** Oltre questi argomenti per volta l'IA tende a tagliare la risposta. */
export const AI_NOTES_BATCH_SUGGESTED = 6;
export const AI_NOTES_BATCH_WARN = 8;
/** Quanto dei tuoi appunti attuali entra nel prompt ("migliora"). */
export const AI_NOTES_CURRENT_CHARS = 3000;

export const NOTE_MODE = { SOSTITUISCI: 'SOSTITUISCI', AGGIUNGI: 'AGGIUNGI' };

/** Le sezioni degli appunti, nell'ordine. */
export const NOTE_SECTIONS = [
  { titolo: 'In breve', regola: '2-3 righe: di cosa si tratta e perché conta.' },
  { titolo: 'Concetti chiave', regola: 'elenco puntato, una idea per punto.' },
  { titolo: 'Definizioni', regola: '"Termine: definizione precisa", come la si direbbe all’esame.' },
  {
    titolo: 'Formule',
    regola: 'una per riga; subito dopo "dove:" con significato e unità di misura di ogni simbolo; poi ipotesi e quando si usa.'
  },
  { titolo: 'Procedimento', regola: 'passaggi numerati di dimostrazioni, derivazioni o metodi di risoluzione.' },
  { titolo: 'Esempio svolto', regola: 'uno breve e tipico, con i passaggi e il risultato.' },
  { titolo: 'Errori tipici', regola: 'gli sbagli più comuni e come evitarli.' },
  { titolo: 'Domande d’esame', regola: '4-6 domande probabili, ognuna con la risposta attesa in una riga dopo "→".' },
  { titolo: 'Collegamenti', regola: 'con gli altri argomenti del corso.' }
];

/* ------------------------------------------------------------------ *
 * CODICI E ALBERO
 * ------------------------------------------------------------------ */

function codiceGrezzo(id, len) {
  const s = String(id || '').replace(/[^A-Za-z0-9]/g, '');
  if (s.length <= 10) return s.toLowerCase();
  return s.slice(-len).toLowerCase();
}

/**
 * Il codice di ogni argomento della materia: la coda dell'id (6 caratteri),
 * allungata solo se due argomenti la condividono. Map sfidaId -> codice.
 */
export function nodeCodes(sfide) {
  const lista = (Array.isArray(sfide) ? sfide : []).filter((s) => s && s.id);
  for (let len = 6; len <= 16; len += 2) {
    const codici = new Map(lista.map((s) => [s.id, codiceGrezzo(s.id, len)]));
    if (new Set(codici.values()).size === codici.size) return codici;
  }
  return new Map(lista.map((s) => [s.id, codiceGrezzo(s.id, 64)]));
}

/** Gli argomenti in ordine d'albero (padre, poi i suoi figli), con la profondità. */
export function treeOrder(sfide) {
  const lista = (Array.isArray(sfide) ? sfide : []).filter((s) => s && s.id);
  const ids = new Set(lista.map((s) => s.id));
  const figli = new Map();
  lista.forEach((s) => {
    const p = s.parentId && ids.has(s.parentId) ? s.parentId : null;
    if (!figli.has(p)) figli.set(p, []);
    figli.get(p).push(s);
  });
  const out = [];
  const visti = new Set();
  const visita = (s, depth) => {
    if (visti.has(s.id)) return;
    visti.add(s.id);
    out.push({ sfida: s, depth });
    (figli.get(s.id) || []).forEach((c) => visita(c, depth + 1));
  };
  (figli.get(null) || []).forEach((s) => visita(s, 0));
  lista.forEach((s) => visita(s, 0)); // cicli o padri spariti: mai perdere un nodo
  return out;
}

/** "Capitolo › Paragrafo › Argomento". */
export function nodePath(sfida, sfide) {
  const byId = new Map((Array.isArray(sfide) ? sfide : []).filter(Boolean).map((s) => [s.id, s]));
  const nomi = [];
  const visti = new Set();
  let cur = sfida;
  while (cur && !visti.has(cur.id)) {
    visti.add(cur.id);
    nomi.unshift(String(cur.nome || 'Argomento').trim());
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return nomi.join(' › ');
}

/* ------------------------------------------------------------------ *
 * IL PROMPT
 * ------------------------------------------------------------------ */

function riga(testo) {
  return String(testo || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {object} a
 * @param {object} a.materia
 * @param {Array}  a.sfide         gli argomenti scelti (in ordine)
 * @param {boolean} [a.migliora]   includi gli appunti attuali da migliorare
 * @param {{label:string, haScritto:boolean, haOrale:boolean}} [a.formato] formatoMeta della materia
 */
export function buildAiNotesPrompt({ materia, sfide, migliora = false, formato = null }) {
  const tutte = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const codici = nodeCodes(tutte);
  const scelti = (Array.isArray(sfide) ? sfide : []).filter((s) => s && codici.has(s.id));
  const nomeMateria = riga(materia?.nome) || 'la materia';

  let esame = '';
  if (formato) {
    const consigli = [];
    if (formato.haScritto) consigli.push('per lo scritto conta saper usare formule, procedimenti ed esempi svolti');
    if (formato.haOrale) consigli.push("per l'orale contano definizioni precise, dimostrazioni e collegamenti");
    esame = `Esame: ${formato.label}${consigli.length ? ` — ${consigli.join('; ')}.` : '.'}`;
  }

  const conAppunti = migliora ? scelti.filter((s) => typeof s.note === 'string' && s.note.trim()) : [];
  const elenco = scelti.map((s) => {
    const parti = [`- [${codici.get(s.id)}] ${riga(nodePath(s, tutte))}`];
    const obiettivo = riga(s.obiettivo);
    if (obiettivo) parti.push(`  Obiettivo: ${obiettivo}`);
    if (migliora && typeof s.note === 'string' && s.note.trim()) {
      const testo = s.note.trim();
      const tagliato = testo.length > AI_NOTES_CURRENT_CHARS ? `${testo.slice(0, AI_NOTES_CURRENT_CHARS)}\n[…]` : testo;
      parti.push(`  APPUNTI ATTUALI:\n${tagliato
        .split('\n')
        .map((l) => `  | ${l}`)
        .join('\n')}\n  FINE APPUNTI`);
    }
    return parti.join('\n');
  });

  const sezioni = NOTE_SECTIONS.map((x) => `   ## ${x.titolo} — ${x.regola}`).join('\n');

  return [
    `Sei un tutor universitario esperto. Ti allego il mio materiale di studio di ${nomeMateria} (slide, libro, dispense o appunti a mano). Da questo materiale prepara gli APPUNTI DI STUDIO di ciascuno degli argomenti elencati sotto.`,
    '',
    'A cosa servono: li studio e li ripasso io, e li legge la mia app di studio per farmi domande di richiamo attivo, interrogazioni orali simulate e per correggere le mie risposte. Devono essere completi su ciò che serve all’esame ma compatti: niente frasi di riempimento, niente introduzioni generiche.',
    '',
    esame,
    '',
    `ARGOMENTI (${scelti.length}) — copia il codice fra parentesi quadre esattamente com'è:`,
    ...elenco,
    '',
    conAppunti.length > 0
      ? `Per ${conAppunti.length === 1 ? 'un argomento' : 'alcuni argomenti'} trovi i miei APPUNTI ATTUALI (le righe con "|"): migliorali, correggi gli errori e completali con il materiale allegato, senza perdere niente di giusto.`
      : '',
    '',
    'FORMATO DELLA RISPOSTA — la risposta viene letta da un programma, rispetta queste regole alla lettera:',
    '1. Rispondi con un unico blocco di codice, senza testo prima o dopo.',
    "2. Per ogni argomento, una riga d'intestazione esattamente così: @@ARGOMENTO [codice] Titolo",
    "3. Sotto l'intestazione, queste sezioni con questi titoli e in quest'ordine, saltando solo quelle che per quell'argomento non hanno senso:",
    sezioni,
    "4. Dopo l'ultimo argomento, una riga con @@FINE",
    '5. Formule in testo leggibile, senza LaTeX: simboli Unicode (² ³ √ ∫ ∑ ∏ ∂ ∇ Δ ≤ ≥ ≠ ≈ → ∞ · × ±, lettere greche α β γ θ λ μ σ ω), frazioni come (a + b)/(c·d), pedici con _ (v_0, x_i). Solo se una formula resterebbe illeggibile, LaTeX fra $ e $.',
    `6. Al massimo circa ${AI_NOTES_TARGET_CHARS} caratteri per argomento: se il materiale è di più, tieni ciò che serve all’esame.`,
    '7. Usa SOLO il materiale allegato. Se per un argomento non basta, scrivi [DA COMPLETARE] in "In breve" con cosa manca, e non inventare formule, valori o definizioni.',
    '8. Italiano, con la notazione e i nomi usati dal docente.',
    '',
    'Esempio della forma (non del contenuto):',
    '@@ARGOMENTO [abc123] Secondo principio della dinamica',
    '## In breve',
    'Lega la forza risultante su un corpo alla sua accelerazione: è la base di ogni problema di dinamica.',
    '## Formule',
    '- F = m·a — dove: F forza risultante [N], m massa [kg], a accelerazione [m/s²]. Vale in un sistema inerziale.',
    '## Errori tipici',
    '- Dimenticare una forza nel diagramma di corpo libero.',
    '@@FINE'
  ]
    .filter((x) => x != null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ *
 * LA RISPOSTA
 * ------------------------------------------------------------------ */

const HEADER_RE = /^[\s>*#_`]*@@\s*ARGOMENTO\s*[:-]?\s*\[?\s*([A-Za-z0-9_-]{2,64})\s*\]?\s*(.*)$/i;
const FINE_RE = /^[\s>*#_`]*@@\s*FINE\b/i;

function normalizzaNome(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Pulisce il testo di un blocco: niente recinti di codice, niente righe vuote a valanga. */
export function cleanNoteText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*```/.test(l))
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Legge la risposta dell'IA.
 * @param {string} text
 * @param {Array}  sfide  tutti gli argomenti della materia
 * @returns {{ valid:boolean, error?:string, blocchi:Array<{sfidaId,nome,note,caratteri,troppoLungo,codice}>, sconosciuti:string[], ripetuti:string[] }}
 */
export function parseAiNotes(text, sfide) {
  const vuoto = { valid: false, blocchi: [], sconosciuti: [], ripetuti: [] };
  const src = String(text || '').replace(/\r\n?/g, '\n');
  if (!src.trim()) return { ...vuoto, error: 'Incolla qui la risposta dell’IA.' };
  const lista = (Array.isArray(sfide) ? sfide : []).filter((s) => s && s.id);
  const codici = nodeCodes(lista);
  const perCodice = new Map([...codici.entries()].map(([id, c]) => [c, id]));
  const perNome = new Map();
  lista.forEach((s) => {
    const k = normalizzaNome(s.nome);
    if (!k) return;
    perNome.set(k, perNome.has(k) ? null : s.id); // nome doppio: ambiguo
  });
  const byId = new Map(lista.map((s) => [s.id, s]));

  const grezzi = [];
  let cur = null;
  src.split('\n').forEach((line) => {
    if (FINE_RE.test(line)) {
      if (cur) grezzi.push(cur);
      cur = null;
      return;
    }
    const h = line.match(HEADER_RE);
    if (h) {
      if (cur) grezzi.push(cur);
      cur = { codice: h[1].toLowerCase(), titolo: h[2].replace(/[*_`]+/g, '').trim(), righe: [] };
      return;
    }
    if (cur) cur.righe.push(line);
  });
  if (cur) grezzi.push(cur);

  if (grezzi.length === 0) {
    return {
      ...vuoto,
      error: 'Non trovo nessuna riga "@@ARGOMENTO [codice] …": controlla di aver incollato tutta la risposta, generata con il prompt di questa finestra.'
    };
  }

  const sconosciuti = [];
  const ripetuti = [];
  const visti = new Map();
  grezzi.forEach((g) => {
    let id = perCodice.get(g.codice) || null;
    if (!id) {
      // Codice storpiato o mancante: proviamo col titolo (solo se univoco).
      const k = normalizzaNome(g.titolo.split('›').pop());
      id = (k && perNome.get(k)) || null;
    }
    if (!id) {
      sconosciuti.push(g.titolo ? `[${g.codice}] ${g.titolo}` : `[${g.codice}]`);
      return;
    }
    const note = cleanNoteText(g.righe.join('\n'));
    if (!note) return;
    if (visti.has(id)) {
      ripetuti.push(byId.get(id)?.nome || g.codice);
      visti.set(id, { ...visti.get(id), note: `${visti.get(id).note}\n\n${note}` });
      return;
    }
    visti.set(id, { sfidaId: id, nome: byId.get(id)?.nome || g.titolo, codice: codici.get(id), note });
  });

  const blocchi = [...visti.values()].map((b) => ({ ...b, caratteri: b.note.length, troppoLungo: b.note.length > AI_NOTES_KAREN_CHARS }));
  if (blocchi.length === 0) {
    return {
      ...vuoto,
      sconosciuti,
      error: 'Nessun argomento riconosciuto: i codici fra parentesi quadre non corrispondono agli argomenti di questa materia.'
    };
  }
  return { valid: true, blocchi, sconosciuti, ripetuti };
}

/** Il nuovo testo degli appunti di un argomento. */
export function mergeNote(attuale, nuovo, mode = NOTE_MODE.SOSTITUISCI) {
  const a = typeof attuale === 'string' ? attuale.trim() : '';
  const n = typeof nuovo === 'string' ? nuovo.trim() : '';
  if (!n) return a;
  if (mode === NOTE_MODE.AGGIUNGI && a) return `${a}\n\n${n}`;
  return n;
}
