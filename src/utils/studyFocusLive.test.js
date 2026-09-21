// =====================================================================
// ArachnoForge — src/utils/studyFocusLive.test.js
// Test unitari (node:test built-in) per la riconciliazione live del
// piano "study_focus" di K.A.R.E.N. con lo stato vivo di app_state.materie.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLiveStudyFocus } from './studyFocusLive.js';

function mkSfida(overrides = {}) {
  return {
    id: 'sf1',
    nome: 'Argomento',
    obiettivo: '',
    blueprint: '',
    oreStimate: 2,
    parentId: null,
    difficulty: 'MEDIUM',
    status: 'PENDING',
    completionTimestamp: null,
    nextReviewDate: null,
    lastReviewRating: null,
    reviewCount: 0,
    focusMinutes: 0,
    tentativiSuccessi: 0,
    tentativiFalliti: 0,
    ...overrides
  };
}

function mkMateria(overrides = {}) {
  return { id: 'm1', nome: 'Materia', examDate: null, cfu: 6, courseId: null, perceivedDifficulty: 3, examPassed: false, voto: null, sfide: [], ...overrides };
}

describe('resolveLiveStudyFocus', () => {
  test('directive assente -> struttura vuota, mai un errore', () => {
    const result = resolveLiveStudyFocus(null, []);
    assert.equal(result.primary, null);
    assert.equal(result.exhausted, false);
    assert.deepEqual(result.ripassiDaNonSaltare, []);
    assert.deepEqual(result.otherOpenOptions, []);
  });

  test('argomento principale ancora PENDING nel vivo -> resta il principale, nessuna promozione', () => {
    const materie = [mkMateria({ sfide: [mkSfida({ id: 's1', status: 'PENDING' })] })];
    const directive = {
      argomento_principale: { materia: 'Materia', argomento: 'Argomento', metodo: 'X', rationale: 'Y', sfidaId: 's1', materiaId: 'm1' },
      ripassi_da_non_saltare: [],
      altre_opzioni: []
    };
    const result = resolveLiveStudyFocus(directive, materie);
    assert.equal(result.promoted, false);
    assert.equal(result.primary.sfidaId, 's1');
    assert.equal(result.exhausted, false);
  });

  test('argomento principale completato -> promuove la prima altra_opzione ancora aperta', () => {
    const materie = [
      mkMateria({
        sfide: [
          mkSfida({ id: 's1', status: 'COMPLETED', completionTimestamp: new Date().toISOString(), nextReviewDate: '2099-01-01' }),
          mkSfida({ id: 's2', status: 'PENDING' })
        ]
      })
    ];
    const directive = {
      argomento_principale: { materia: 'Materia', argomento: 'Primo', metodo: 'X', rationale: 'Y', sfidaId: 's1', materiaId: 'm1' },
      ripassi_da_non_saltare: [],
      altre_opzioni: [{ materia: 'Materia', argomento: 'Secondo', sfidaId: 's2', materiaId: 'm1' }]
    };
    const result = resolveLiveStudyFocus(directive, materie);
    assert.equal(result.promoted, true);
    assert.equal(result.primary.sfidaId, 's2');
    assert.equal(result.primary.argomento, 'Secondo');
    // La promossa non deve ricomparire anche fra le "altre opzioni ancora aperte".
    assert.equal(result.otherOpenOptions.length, 0);
  });

  test('principale e tutte le altre_opzioni completate, ma esiste un ripasso ancora scaduto -> lo promuove', () => {
    const materie = [
      mkMateria({
        sfide: [
          mkSfida({ id: 's1', status: 'COMPLETED', nextReviewDate: '2099-01-01' }),
          mkSfida({ id: 'sR', status: 'COMPLETED', nextReviewDate: '2020-01-01' }) // scaduto -> NEEDS_REVIEW dal vivo
        ]
      })
    ];
    const directive = {
      argomento_principale: { materia: 'Materia', argomento: 'Primo', metodo: 'X', rationale: 'Y', sfidaId: 's1', materiaId: 'm1' },
      ripassi_da_non_saltare: [{ materia: 'Materia', argomento: 'Ripasso', nota: 'Richiamo attivo.', sfidaId: 'sR', materiaId: 'm1' }],
      altre_opzioni: []
    };
    const result = resolveLiveStudyFocus(directive, materie);
    assert.equal(result.promoted, true);
    assert.equal(result.primary.sfidaId, 'sR');
    assert.equal(result.primary.metodo, 'Richiamo attivo.');
    // Il ripasso appena promosso a principale non va duplicato nella lista.
    assert.equal(result.ripassiDaNonSaltare.length, 0);
  });

  test('tutto risolto (nessun argomento aperto, nessun ripasso scaduto) -> exhausted true', () => {
    const materie = [
      mkMateria({
        sfide: [
          mkSfida({ id: 's1', status: 'COMPLETED', nextReviewDate: '2099-01-01' }),
          mkSfida({ id: 'sR', status: 'COMPLETED', nextReviewDate: '2099-01-01' })
        ]
      })
    ];
    const directive = {
      argomento_principale: { materia: 'Materia', argomento: 'Primo', metodo: 'X', rationale: 'Y', sfidaId: 's1', materiaId: 'm1' },
      ripassi_da_non_saltare: [{ materia: 'Materia', argomento: 'Ripasso', nota: 'X', sfidaId: 'sR', materiaId: 'm1' }],
      altre_opzioni: []
    };
    const result = resolveLiveStudyFocus(directive, materie);
    assert.equal(result.primary, null);
    assert.equal(result.exhausted, true);
  });

  test('nessun candidato mai esistito (argomento_principale già null in origine) -> exhausted resta false', () => {
    const directive = { argomento_principale: null, ripassi_da_non_saltare: [], altre_opzioni: [] };
    const result = resolveLiveStudyFocus(directive, []);
    assert.equal(result.primary, null);
    assert.equal(result.exhausted, false);
  });

  test('id non risolvibili (nodo non trovato) -> fail-open, il principale resta visibile', () => {
    const directive = {
      argomento_principale: { materia: 'Materia', argomento: 'Argomento', metodo: 'X', rationale: 'Y', sfidaId: 'inesistente', materiaId: 'm1' },
      ripassi_da_non_saltare: [],
      altre_opzioni: []
    };
    const result = resolveLiveStudyFocus(directive, []);
    assert.equal(result.promoted, false);
    assert.equal(result.primary.sfidaId, 'inesistente');
  });

  test('il principale è un Boss con figli non completati (ribloccato) -> promuove la prossima opzione', () => {
    const materie = [
      mkMateria({
        sfide: [
          mkSfida({ id: 'boss', status: 'PENDING' }),
          mkSfida({ id: 'figlio', parentId: 'boss', status: 'PENDING' }),
          mkSfida({ id: 's2', status: 'PENDING' })
        ]
      })
    ];
    const directive = {
      // Il Boss era disponibile quando il piano è stato generato (tutti i figli erano COMPLETED allora),
      // ma nel frattempo è stato aggiunto/riaperto un figlio ancora PENDING -> ora è LOCKED dal vivo.
      argomento_principale: { materia: 'Materia', argomento: 'Boss', metodo: 'X', rationale: 'Y', sfidaId: 'boss', materiaId: 'm1' },
      ripassi_da_non_saltare: [],
      altre_opzioni: [{ materia: 'Materia', argomento: 'Secondo', sfidaId: 's2', materiaId: 'm1' }]
    };
    const result = resolveLiveStudyFocus(directive, materie);
    assert.equal(result.promoted, true);
    assert.equal(result.primary.sfidaId, 's2');
  });
});
