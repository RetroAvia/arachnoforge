// =====================================================================
// ArachnoForge — src/utils/aiIndexParser.test.js (V41)
// AI Index Matrix: la risposta dell'IA incollata così com'è.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAiIndexTree, createSfideTreeFromAiIndex, jsonCandidates, buildAiIndexPrompt, MAX_AI_INDEX_NODES } from './aiIndexParser.js';

const FENCED = 'Ecco l’indice:\n```json\n[{"nome":"Capitolo 1","sottoargomenti":["Paragrafo A",{"nome":"Paragrafo B","difficolta":"HARD","ore":6}]}]\n```\nFammi sapere!';

describe('parseAiIndexTree — risposte reali delle IA', () => {
  test('JSON dentro un blocco di codice, con testo intorno', () => {
    const r = parseAiIndexTree(FENCED);
    assert.equal(r.valid, true);
    assert.equal(r.totalCount, 3);
    assert.equal(r.tree[0].children[1].difficulty, 'HARD');
    assert.equal(r.tree[0].children[1].oreStimate, 6);
  });
  test('virgolette tipografiche e virgole finali', () => {
    const r = parseAiIndexTree('[{“nome”: “Cap 1”, “sottoargomenti”: [“A”, “B”,],},]');
    assert.equal(r.valid, true);
    assert.equal(r.totalCount, 3);
  });
  test('frase prima e dopo, senza blocco di codice', () => {
    assert.equal(parseAiIndexTree('Certo! [ {"nome":"X"} ] Spero sia utile.').valid, true);
  });
  test('l’apostrofo tipografico nei titoli resta com’è', () => {
    const r = parseAiIndexTree('[{"nome":"L’equazione dell’energia"}]');
    assert.equal(r.tree[0].nome, 'L’equazione dell’energia');
  });
  test('JSON troncato: errore chiaro, in italiano', () => {
    const r = parseAiIndexTree('[{"nome": "X"');
    assert.equal(r.valid, false);
    assert.match(r.error, /Non riesco a leggere il JSON/);
  });
  test('oggetto con chiave radice alternativa', () => {
    assert.equal(parseAiIndexTree('{"capitoli":[{"nome":"A"}]}').valid, true);
  });
  test('testo vuoto', () => {
    assert.equal(parseAiIndexTree('   ').valid, false);
  });
});

describe('jsonCandidates', () => {
  test('dal più fedele al più tollerante, senza doppioni', () => {
    const c = jsonCandidates(FENCED);
    assert.equal(c[0], FENCED.trim());
    assert.ok(c.some((x) => x.startsWith('[{"nome":"Capitolo 1"')));
    assert.equal(new Set(c).size, c.length);
  });
});

describe('createSfideTreeFromAiIndex', () => {
  test('albero piatto con i legami padre-figlio', () => {
    const r = createSfideTreeFromAiIndex(FENCED);
    assert.equal(r.valid, true);
    const [cap, a, b] = r.sfide;
    assert.equal(cap.parentId, null);
    assert.equal(a.parentId, cap.id);
    assert.equal(b.parentId, cap.id);
    assert.deepEqual(a.fonti, []);
  });
  test('tetto al numero di nodi', () => {
    const tanti = JSON.stringify(Array.from({ length: MAX_AI_INDEX_NODES + 1 }, (_, i) => ({ nome: `N${i}` })));
    assert.equal(parseAiIndexTree(tanti).valid, false);
  });
});

describe('buildAiIndexPrompt', () => {
  test('nomina la materia e chiede il formato letto dal parser', () => {
    const p = buildAiIndexPrompt('Aerodinamica');
    assert.match(p, /Aerodinamica/);
    assert.match(p, /"sottoargomenti"/);
    assert.match(p, /difficolta/);
  });
  test('senza materia resta una frase compiuta', () => {
    assert.match(buildAiIndexPrompt(''), /libro universitario/);
  });
});
