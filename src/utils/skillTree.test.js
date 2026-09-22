// =====================================================================
// ArachnoForge — src/utils/skillTree.test.js
// Test unitari (node:test built-in, zero dipendenze npm) per il motore
// derivato dello Skill Tree, con enfasi sul nuovo stato IN_PROGRESS
// (V35.5 — "In Corso"). Eseguibile con: node --test src/utils/skillTree.test.js
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveNodeStatus, NODE_STATUS, PERSISTED_STATUS, createSfida } from './skillTree.js';

function leafNode(overrides = {}) {
  return { ...createSfida({ nome: 'Nodo Test', obiettivo: '', oreStimate: 2 }), ...overrides };
}

describe('deriveNodeStatus — comportamento pre-esistente (nessuna regressione)', () => {
  test('nodo foglia nuovo, zero focusMinutes -> AVAILABLE', () => {
    const node = leafNode();
    assert.equal(deriveNodeStatus(node, [node]), NODE_STATUS.AVAILABLE);
  });

  test('nodo COMPLETED con revisione non ancora scaduta -> COMPLETED', () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    const node = leafNode({ status: PERSISTED_STATUS.COMPLETED, nextReviewDate: future });
    assert.equal(deriveNodeStatus(node, [node]), NODE_STATUS.COMPLETED);
  });

  test('nodo COMPLETED con revisione scaduta -> NEEDS_REVIEW', () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    const node = leafNode({ status: PERSISTED_STATUS.COMPLETED, nextReviewDate: past });
    assert.equal(deriveNodeStatus(node, [node]), NODE_STATUS.NEEDS_REVIEW);
  });

  test('Boss con figli non tutti completati -> LOCKED (a prescindere da focusMinutes propri)', () => {
    const parent = leafNode({ id: 'p1', focusMinutes: 15 });
    const child = leafNode({ id: 'c1', parentId: 'p1', status: PERSISTED_STATUS.PENDING });
    assert.equal(deriveNodeStatus(parent, [parent, child]), NODE_STATUS.LOCKED);
  });

  test('Boss con tutti i figli completati, zero focusMinutes propri -> AVAILABLE', () => {
    const parent = leafNode({ id: 'p2', focusMinutes: 0 });
    const child = leafNode({ id: 'c2', parentId: 'p2', status: PERSISTED_STATUS.COMPLETED });
    assert.equal(deriveNodeStatus(parent, [parent, child]), NODE_STATUS.AVAILABLE);
  });
});

describe('deriveNodeStatus — V35.5 "In Corso" (nuovo)', () => {
  test('nodo foglia con focusMinutes > 0 e status PENDING -> IN_PROGRESS', () => {
    const node = leafNode({ focusMinutes: 25 });
    assert.equal(deriveNodeStatus(node, [node]), NODE_STATUS.IN_PROGRESS);
  });

  test('Boss sbloccato (figli tutti completati) con focusMinutes propri > 0 -> IN_PROGRESS', () => {
    const parent = leafNode({ id: 'p3', focusMinutes: 10 });
    const child = leafNode({ id: 'c3', parentId: 'p3', status: PERSISTED_STATUS.COMPLETED });
    assert.equal(deriveNodeStatus(parent, [parent, child]), NODE_STATUS.IN_PROGRESS);
  });

  test('nodo COMPLETED con focusMinutes > 0 resta COMPLETED (IN_PROGRESS non scavalca mai uno stato persistito)', () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    const node = leafNode({ focusMinutes: 40, status: PERSISTED_STATUS.COMPLETED, nextReviewDate: future });
    assert.equal(deriveNodeStatus(node, [node]), NODE_STATUS.COMPLETED);
  });

  test('nodo con focusMinutes azzerato torna automaticamente ad AVAILABLE (nessun flag manuale da resettare)', () => {
    const node = leafNode({ focusMinutes: 0 });
    assert.equal(deriveNodeStatus(node, [node]), NODE_STATUS.AVAILABLE);
  });
});

describe('V40.2 — "In corso" anche per la sintesi fatta a mano', () => {
  test('pagine di fonte già snellite -> IN_PROGRESS', () => {
    const node = leafNode({ fonti: [{ id: 'f', tipo: 'LIBRO', pagine: 16, pagineFatte: 4 }] });
    assert.equal(deriveNodeStatus(node, [node]), NODE_STATUS.IN_PROGRESS);
  });
  test('pagine dei tuoi appunti o sintesi chiusa -> IN_PROGRESS', () => {
    const a = leafNode({ pagineAppunti: 3 });
    const b = leafNode({ appuntiCompleti: true });
    assert.equal(deriveNodeStatus(a, [a]), NODE_STATUS.IN_PROGRESS);
    assert.equal(deriveNodeStatus(b, [b]), NODE_STATUS.IN_PROGRESS);
  });
  test('fonti senza pagine fatte: resta AVAILABLE', () => {
    const node = leafNode({ fonti: [{ id: 'f', tipo: 'LIBRO', pagine: 16, pagineFatte: 0 }] });
    assert.equal(deriveNodeStatus(node, [node]), NODE_STATUS.AVAILABLE);
  });
  test('la sintesi non completa mai il nodo, e non sblocca un Boss', () => {
    const chiusa = leafNode({ fonti: [{ id: 'f', tipo: 'LIBRO', pagine: 16, pagineFatte: 16 }], appuntiCompleti: true });
    assert.equal(deriveNodeStatus(chiusa, [chiusa]), NODE_STATUS.IN_PROGRESS);
    const boss = leafNode({ id: 'boss', pagineAppunti: 5 });
    const figlio = leafNode({ id: 'figlio', parentId: 'boss' });
    assert.equal(deriveNodeStatus(boss, [boss, figlio]), NODE_STATUS.LOCKED);
  });
});
