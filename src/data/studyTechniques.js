// =====================================================================
// ArachnoForge — src/data/studyTechniques.js (V43)
// IL CATALOGO DELLE TECNICHE DI STUDIO.
//
// K.A.R.E.N. consiglia una tecnica per l'argomento del giorno; nel
// Debriefing dichiari quale hai usato davvero. Con un elenco CHIUSO di
// tecniche (id stabili) l'app può misurare quale funziona per te — e
// dirlo a K.A.R.E.N. (vedi utils/techniqueMemory.js).
//
// ATTENZIONE: gli id sono replicati in supabase/functions/karen-oracle/
// _logic.ts (STUDY_TECHNIQUE_IDS). Aggiungerne uno qui senza aggiungerlo
// là = il server lo scarta.
// =====================================================================

export const STUDY_TECHNIQUE = {
  RICHIAMO_ATTIVO: 'RICHIAMO_ATTIVO',
  FEYNMAN: 'FEYNMAN',
  ESEMPI_SVOLTI: 'ESEMPI_SVOLTI',
  ESERCIZI: 'ESERCIZI',
  INTERLEAVING: 'INTERLEAVING',
  ELABORAZIONE: 'ELABORAZIONE',
  SCHEMA_A_DOMANDE: 'SCHEMA_A_DOMANDE',
  CODIFICA_DUALE: 'CODIFICA_DUALE',
  MAPPA_CONCETTUALE: 'MAPPA_CONCETTUALE',
  RILETTURA: 'RILETTURA'
};

/**
 * `parole`: frammenti (minuscoli) con cui riconoscere la tecnica nel testo
 * libero del consiglio di K.A.R.E.N. ("metodo"), per i briefing salvati
 * prima della V43 o quando il modello non dà l'id.
 */
export const STUDY_TECHNIQUE_META = {
  RICHIAMO_ATTIVO: {
    label: 'Richiamo attivo',
    short: 'Richiamo',
    hint: 'Chiudi gli appunti e ricostruisci a memoria, poi controlla.',
    parole: ['richiamo attivo', 'active recall', 'retrieval practice', 'a libro chiuso', 'ricostruisci a memoria']
  },
  FEYNMAN: {
    label: 'Tecnica Feynman',
    short: 'Feynman',
    hint: 'Spiegalo con parole semplici, come a chi non lo conosce.',
    parole: ['feynman']
  },
  ESEMPI_SVOLTI: {
    label: 'Esempi svolti',
    short: 'Esempi svolti',
    hint: 'Studia un esempio risolto passo passo, poi rifallo da solo.',
    parole: ['esempi svolti', 'esempio svolto', 'worked example']
  },
  ESERCIZI: {
    label: 'Esercizi e problemi',
    short: 'Esercizi',
    hint: 'Problemi nuovi, senza guardare la soluzione.',
    parole: ['esercizi', 'esercizio', 'problemi d’esame', "problemi d'esame", 'problem solving']
  },
  INTERLEAVING: {
    label: 'Interleaving',
    short: 'Interleaving',
    hint: 'Alterna tipi di problemi o argomenti diversi nello stesso blocco.',
    parole: ['interleaving', 'pratica intercalata', 'alternando']
  },
  ELABORAZIONE: {
    label: 'Elaborazione',
    short: 'Elaborazione',
    hint: 'Chiediti perché e come funziona, collega a ciò che sai già.',
    parole: ['elaborazione', 'elaborativa', 'interrogazione elaborativa']
  },
  SCHEMA_A_DOMANDE: {
    label: 'Schema a domande',
    short: 'Domande',
    hint: 'Trasforma gli appunti in domande e rispondi a voce.',
    parole: ['schema a domande', 'metodo a domande', 'appunti a domande', 'flashcard', 'domande e risposte']
  },
  CODIFICA_DUALE: {
    label: 'Codifica duale',
    short: 'Codifica duale',
    hint: 'Affianca parole e disegni: schemi, grafici, diagrammi.',
    parole: ['codifica duale', 'dual coding', 'diagramma', 'disegna', 'schizzo']
  },
  MAPPA_CONCETTUALE: {
    label: 'Mappa concettuale',
    short: 'Mappa',
    hint: 'Concetti e collegamenti su una pagina sola.',
    parole: ['mappa concettuale', 'mappe concettuali', 'mind map', 'mappa mentale']
  },
  RILETTURA: {
    label: 'Rilettura e sottolineatura',
    short: 'Rilettura',
    hint: 'Rileggere ed evidenziare (utile per orientarsi, debole per ricordare).',
    parole: ['rilettura', 'rileggi', 'sottolinea', 'evidenzia']
  }
};

export const STUDY_TECHNIQUE_ORDER = Object.keys(STUDY_TECHNIQUE);

export function isStudyTechnique(v) {
  return typeof v === 'string' && !!STUDY_TECHNIQUE_META[v];
}

/**
 * La tecnica NOMINATA PER PRIMA in un testo libero (il "metodo" di
 * K.A.R.E.N.), o null. "Prima" = la più vicina all'inizio del testo: è
 * quella su cui il consiglio è costruito.
 */
export function detectStudyTechnique(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const t = text.toLowerCase();
  let best = null;
  let bestPos = Infinity;
  STUDY_TECHNIQUE_ORDER.forEach((id) => {
    STUDY_TECHNIQUE_META[id].parole.forEach((p) => {
      const pos = t.indexOf(p);
      if (pos >= 0 && pos < bestPos) {
        best = id;
        bestPos = pos;
      }
    });
  });
  return best;
}

/** La tecnica consigliata da un `argomento_principale` del briefing. */
export function techniqueOfAdvice(argomentoPrincipale) {
  if (!argomentoPrincipale || typeof argomentoPrincipale !== 'object') return null;
  if (isStudyTechnique(argomentoPrincipale.tecnica)) return argomentoPrincipale.tecnica;
  return detectStudyTechnique(argomentoPrincipale.metodo);
}
