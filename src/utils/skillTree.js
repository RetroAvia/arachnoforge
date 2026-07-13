import { isReviewDue, computeInitialReviewDate } from './spiderSense.js';
import { DIFFICULTY } from './xpEngine.js';

export const NODE_STATUS = {
  LOCKED: 'LOCKED',
  AVAILABLE: 'AVAILABLE',
  COMPLETED: 'COMPLETED',
  NEEDS_REVIEW: 'NEEDS_REVIEW'
};

/** Stato persistito: solo questi due valori vivono su disco. Tutto il resto
 * (LOCKED / AVAILABLE / NEEDS_REVIEW) è derivato al volo da deriveNodeStatus
 * in base alla catena di prerequisiti e alla data di prossima revisione —
 * niente sincronizzazione manuale da mantenere. */
export const PERSISTED_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED'
};

/** Restituisce i figli DIRETTI di un nodo (non l'intera discendenza). */
export function directChildrenOf(sfida, siblings) {
  return siblings.filter((s) => s && s.parentId === sfida.id);
}

/**
 * V16.0 — Reverse Dependency Skill Tree ("Boss Fight" logic).
 *
 * I nodi Figli ("argomenti") sono SEMPRE liberamente completabili: non
 * dipendono più dallo stato del proprio nodo Padre. Il nodo Padre
 * ("Modulo/Macro-argomento") si comporta invece come un vero e proprio
 * "Boss": può essere marcato Completato solo quando TUTTI i suoi nodi
 * figli diretti risultano già COMPLETED. Un nodo senza figli (foglia, o
 * Nodo Padre ancora senza discendenza) è sempre libero — nessun "Boss"
 * da abbattere prima. Un nodo COMPLETED torna NEEDS_REVIEW ("Spider-Sense")
 * quando la sua nextReviewDate è scaduta, indipendentemente da tutto il
 * resto (retroattivo: un Boss già sconfitto resta sconfitto anche se in
 * seguito gli si aggiungono nuovi sotto-argomenti).
 */
export function deriveNodeStatus(sfida, siblings = []) {
  if (sfida.status === PERSISTED_STATUS.COMPLETED) {
    return isReviewDue(sfida.nextReviewDate) ? NODE_STATUS.NEEDS_REVIEW : NODE_STATUS.COMPLETED;
  }

  const children = directChildrenOf(sfida, siblings);
  if (children.length > 0) {
    const allChildrenDone = children.every((c) => c.status === PERSISTED_STATUS.COMPLETED);
    return allChildrenDone ? NODE_STATUS.AVAILABLE : NODE_STATUS.LOCKED;
  }

  return NODE_STATUS.AVAILABLE;
}

/**
 * Alla cancellazione di un nodo, i figli diretti vengono "orfanizzati"
 * (parentId azzerato, promossi a radice) invece di essere cancellati a
 * cascata: nessuna perdita distruttiva di progressi già registrati.
 */
export function orphanChildren(sfide, deletedId) {
  return sfide.map((s) => (s.parentId === deletedId ? { ...s, parentId: null } : s));
}

/** Restituisce true se `candidateParentId` è un discendente di `nodeId` (previene cicli nel form). */
export function isDescendant(sfide, nodeId, candidateParentId) {
  let current = sfide.find((s) => s.id === candidateParentId);
  const visited = new Set();
  while (current && current.parentId) {
    if (current.parentId === nodeId) return true;
    if (visited.has(current.id)) break; // guardia anti-loop difensiva
    visited.add(current.id);
    current = sfide.find((s) => s.id === current.parentId);
  }
  return false;
}

export function createSfida({ nome, obiettivo, oreStimate, parentId = null, difficulty = DIFFICULTY.MEDIUM }) {
  const parsedOre = Number(oreStimate);
  return {
    id: `sfida_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    nome,
    obiettivo: obiettivo || '',
    // V34.2 — "Ore Previste": il nodo stima direttamente le ore di studio
    // necessarie (non più i "giorni previsti") — unità più precisa sia per
    // la proiezione di Karen (Fine Prevista, Quota Odierna) sia per
    // l'utente stesso, che ragiona naturalmente in ore di sessione.
    oreStimate: Number.isFinite(parsedOre) && parsedOre > 0 ? parsedOre : 2,
    parentId: parentId || null,
    difficulty,
    status: PERSISTED_STATUS.PENDING,
    completionTimestamp: null,
    nextReviewDate: null,
    lastReviewRating: null,
    reviewCount: 0,
    focusMinutes: 0,
    blueprint: '',
    // V31.3 — Bounty Board (Friction Analytics), vedi utils/friction.js.
    tentativiSuccessi: 0,
    tentativiFalliti: 0
  };
}

/** Marca un nodo come completato per la prima volta: prima nextReviewDate a +7gg. */
export function markFirstCompletion(sfida) {
  return {
    ...sfida,
    status: PERSISTED_STATUS.COMPLETED,
    completionTimestamp: new Date().toISOString(),
    nextReviewDate: computeInitialReviewDate()
  };
}

/** Ordina i nodi in ordine di visita ad albero (radici poi figli, ricorsivo) per una resa gerarchica stabile. */
export function toHierarchicalOrder(sfide) {
  const byParent = new Map();
  sfide.forEach((s) => {
    const key = s.parentId || 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(s);
  });
  const result = [];
  const visit = (parentKey, depth) => {
    const children = byParent.get(parentKey) || [];
    children.forEach((child) => {
      result.push({ node: child, depth });
      visit(child.id, depth + 1);
    });
  };
  visit('root', 0);
  return result;
}
