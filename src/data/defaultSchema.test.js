// =====================================================================
// ArachnoForge — src/data/defaultSchema.test.js (V41)
// hydrateState davanti a dati sporchi (backup modificati a mano, import).
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateState, createDefaultState } from './defaultSchema.js';

describe('hydrateState — robustezza', () => {
  test('voci null o non oggetti nelle materie e negli argomenti non fermano l’avvio', () => {
    const h = hydrateState({
      materie: [null, 'x', [1], { id: 'm1', nome: 'Aerodinamica', sfide: [null, 5, { id: 's1', nome: 'Strato limite', parentId: null }] }]
    });
    assert.equal(h.materie.length, 1);
    assert.equal(h.materie[0].sfide.length, 1);
    assert.equal(h.materie[0].sfide[0].id, 's1');
  });
  test('id mancanti e doppi diventano unici, in modo deterministico', () => {
    const raw = {
      materie: [
        { id: 'm1', nome: 'A', sfide: [{ id: 'x', nome: 'X', parentId: null }, { id: 'x', nome: 'Y', parentId: null }, { nome: 'Z', parentId: null }] },
        { id: 'm1', nome: 'B', sfide: [] },
        { nome: 'C', sfide: [] }
      ]
    };
    const a = hydrateState(raw);
    const b = hydrateState(raw);
    assert.deepEqual(a.materie.map((m) => m.id), b.materie.map((m) => m.id));
    assert.equal(new Set(a.materie.map((m) => m.id)).size, 3);
    assert.equal(new Set(a.materie[0].sfide.map((s) => s.id)).size, 3);
    assert.equal(a.materie[0].sfide[0].id, 'x', 'il primo resta com’era');
  });
  test('un id generato non ruba mai quello valido di un’altra voce', () => {
    const h = hydrateState({ materie: [{ nome: 'Senza id', sfide: [] }, { id: 'materia-0', nome: 'Vera', sfide: [] }] });
    assert.equal(h.materie[1].id, 'materia-0');
    assert.notEqual(h.materie[0].id, 'materia-0');
  });
  test('un id valido resta identico, anche nel tipo', () => {
    const h = hydrateState({ materie: [{ id: 1234, nome: 'Legacy', sfide: [] }] });
    assert.equal(h.materie[0].id, 1234);
  });
  test('nomi vuoti ricevono un segnaposto leggibile', () => {
    const h = hydrateState({ materie: [{ id: 'm', nome: '  ', sfide: [{ id: 's', nome: '', parentId: null }] }] });
    assert.equal(h.materie[0].nome, 'Materia senza nome');
    assert.equal(h.materie[0].sfide[0].nome, 'Argomento senza nome');
  });
  test('le lezioni seguono le materie davvero caricate', () => {
    const base = createDefaultState();
    const h = hydrateState({
      ...base,
      materie: [{ id: 'm1', nome: 'A', sfide: [] }],
      campus: {
        ...base.campus,
        semestri: [
          {
            id: 'sem1',
            nome: 'Primo',
            inizio: '2026-09-21',
            fine: '2026-12-20',
            sospensioni: [],
            lezioni: [
              { id: 'l1', materiaId: 'm1', giorno: 1, inizio: '09:00', fine: '11:00' },
              { id: 'l2', materiaId: 'fantasma', giorno: 2, inizio: '09:00', fine: '11:00' }
            ]
          }
        ]
      }
    });
    const lezioni = h.campus.semestri[0].lezioni.map((l) => l.id);
    assert.deepEqual(lezioni, ['l1']);
  });
  test('stato assente: default', () => {
    assert.deepEqual(Object.keys(hydrateState(null)).sort(), Object.keys(createDefaultState()).sort());
  });
});
