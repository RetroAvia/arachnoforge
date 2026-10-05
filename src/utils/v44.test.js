// =====================================================================
// ArachnoForge — src/utils/v44.test.js (V44)
// Appunti con l'IA esterna, bilancio settimanale più ricco, selezione.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nodeCodes,
  treeOrder,
  nodePath,
  buildAiNotesPrompt,
  parseAiNotes,
  mergeNote,
  cleanNoteText,
  NOTE_MODE,
  NOTE_SECTIONS,
  AI_NOTES_KAREN_CHARS
} from './aiNotes.js';
import { reducer } from '../state/reducer.js';
import { createDefaultState, hydrateState } from '../data/defaultSchema.js';
import { buildWeeklyContext } from '../services/karenEngine/weeklyContext.js';

const SFIDE = [
  { id: 'sfida_1727000000000_ab12cd', nome: 'Meccanica', parentId: null, note: '' },
  { id: 'sfida_1727000000001_xy98zq', nome: 'Equazioni di Lagrange', parentId: 'sfida_1727000000000_ab12cd', obiettivo: 'Ricavarle', note: 'L = T - V' },
  { id: 'sfida_1727000000002_qq11ww', nome: 'Principio di d’Alembert', parentId: 'sfida_1727000000000_ab12cd', note: '' }
];
const MATERIA = { id: 'm1', nome: 'Meccanica Razionale', sfide: SFIDE };

describe('V44 · appunti con l’IA: codici, albero, prompt', () => {
  test('codice = coda dell’id, unico; si allunga solo se serve', () => {
    const c = nodeCodes(SFIDE);
    assert.equal(c.get('sfida_1727000000001_xy98zq'), 'xy98zq');
    const doppi = nodeCodes([{ id: 'sfida_1_aaaaaaaabbbbbb' }, { id: 'sfida_2_ccccccccbbbbbb' }]);
    assert.notEqual(doppi.get('sfida_1_aaaaaaaabbbbbb'), doppi.get('sfida_2_ccccccccbbbbbb'));
    assert.equal(nodeCodes([{ id: 'n1' }]).get('n1'), 'n1');
  });

  test('albero in ordine e percorso del capitolo', () => {
    const t = treeOrder(SFIDE);
    assert.deepEqual(t.map((x) => [x.sfida.nome, x.depth]), [['Meccanica', 0], ['Equazioni di Lagrange', 1], ['Principio di d’Alembert', 1]]);
    assert.equal(nodePath(SFIDE[1], SFIDE), 'Meccanica › Equazioni di Lagrange');
  });

  test('il prompt elenca i codici, le sezioni, il formato d’esame e (se chiesto) gli appunti attuali', () => {
    const p = buildAiNotesPrompt({ materia: MATERIA, sfide: [SFIDE[1], SFIDE[2]], migliora: true, formato: { label: 'Scritto + orale', haScritto: true, haOrale: true } });
    assert.match(p, /\[xy98zq\] Meccanica › Equazioni di Lagrange/);
    assert.match(p, /\[qq11ww\]/);
    assert.doesNotMatch(p, /\[ab12cd\]/);
    NOTE_SECTIONS.forEach((s) => assert.ok(p.includes(`## ${s.titolo}`), s.titolo));
    assert.match(p, /@@ARGOMENTO \[codice\] Titolo/);
    assert.match(p, /Scritto \+ orale/);
    assert.match(p, /\| L = T - V/);
    const senza = buildAiNotesPrompt({ materia: MATERIA, sfide: [SFIDE[1]], migliora: false });
    assert.doesNotMatch(senza, /L = T - V/);
  });
});

describe('V44 · appunti con l’IA: lettura della risposta', () => {
  test('risposta tipica, con blocco di codice e testo intorno', () => {
    const risposta = [
      'Ecco gli appunti:',
      '```text',
      '@@ARGOMENTO [xy98zq] Equazioni di Lagrange',
      '## In breve',
      'Descrivono il moto con coordinate generalizzate.',
      '',
      '',
      '',
      '## Formule',
      '- d/dt(∂L/∂q̇) − ∂L/∂q = 0 — dove: L lagrangiana [J]',
      '**@@ARGOMENTO [qq11ww] Principio di d’Alembert**',
      '## In breve',
      'Forze d’inerzia.',
      '@@FINE',
      '```',
      'Fammi sapere se…'
    ].join('\n');
    const r = parseAiNotes(risposta, SFIDE);
    assert.equal(r.valid, true);
    assert.equal(r.blocchi.length, 2);
    const lag = r.blocchi.find((b) => b.sfidaId === 'sfida_1727000000001_xy98zq');
    assert.match(lag.note, /^## In breve\nDescrivono/);
    assert.ok(!lag.note.includes('\n\n\n'));
    assert.ok(!r.blocchi.some((b) => b.note.includes('```') || b.note.includes('Fammi sapere')));
  });

  test('codice storpiato: si riconosce dal titolo; codice estraneo: segnalato', () => {
    const r = parseAiNotes('@@ARGOMENTO [zzzzzz] Principio di d’Alembert\nTesto\n@@ARGOMENTO [999999] Altro\nX', SFIDE);
    assert.equal(r.valid, true);
    assert.equal(r.blocchi[0].sfidaId, 'sfida_1727000000002_qq11ww');
    assert.equal(r.sconosciuti.length, 1);
  });

  test('nessuna intestazione o nessun argomento riconosciuto: errore chiaro', () => {
    assert.equal(parseAiNotes('appunti a caso', SFIDE).valid, false);
    assert.equal(parseAiNotes('', SFIDE).valid, false);
    assert.equal(parseAiNotes('@@ARGOMENTO [nope00] Boh\ntesto', SFIDE).valid, false);
  });

  test('lunghezza oltre quella letta da K.A.R.E.N.: segnalata', () => {
    const r = parseAiNotes(`@@ARGOMENTO [xy98zq] X\n${'a'.repeat(AI_NOTES_KAREN_CHARS + 10)}`, SFIDE);
    assert.equal(r.blocchi[0].troppoLungo, true);
  });

  test('unione: sostituisci o aggiungi sotto', () => {
    assert.equal(mergeNote('vecchi', 'nuovi', NOTE_MODE.SOSTITUISCI), 'nuovi');
    assert.equal(mergeNote('vecchi', 'nuovi', NOTE_MODE.AGGIUNGI), 'vecchi\n\nnuovi');
    assert.equal(mergeNote('', 'nuovi', NOTE_MODE.AGGIUNGI), 'nuovi');
    assert.equal(mergeNote('vecchi', '  ', NOTE_MODE.SOSTITUISCI), 'vecchi');
    assert.equal(cleanNoteText('```\nA\r\n\n\n\nB\n```'), 'A\n\nB');
  });
});

describe('V44 · appunti: salvataggio, registro, annullamento', () => {
  const base = () => {
    const s = createDefaultState();
    s.materie = [{ id: 'm1', nome: 'Meccanica', examDate: null, cfu: 9, examPassed: false, sfide: SFIDE.map((x) => ({ ...x, status: 'PENDING', oreStimate: 4, fonti: [] })) }];
    return s;
  };

  test('import dall’IA: testo, registro con fonte IA, poi annullamento', () => {
    const s = base();
    const at = '2026-10-05T10:00:00.000Z';
    const dopo = reducer(s, { type: 'IMPORT_NOTE_IA', payload: { materiaId: 'm1', at, entries: [{ sfidaId: 'sfida_1727000000002_qq11ww', note: '## In breve\nX' }] } });
    const n = dopo.materie[0].sfide.find((x) => x.id === 'sfida_1727000000002_qq11ww');
    assert.equal(n.note, '## In breve\nX');
    assert.equal(n.noteLog.length, 1);
    assert.deepEqual(n.noteLog[0], { at, caratteri: 13, fonte: 'IA' });
    assert.equal(n.noteAggiornataAt, at);
    const indietro = reducer(dopo, { type: 'RESTORE_NOTE_IA', payload: { materiaId: 'm1', at, entries: [{ sfidaId: 'sfida_1727000000002_qq11ww', note: '', noteAggiornataAt: null }] } });
    const r = indietro.materie[0].sfide.find((x) => x.id === 'sfida_1727000000002_qq11ww');
    assert.equal(r.note, '');
    assert.equal(r.noteLog.length, 0);
    // Il registro sopravvive al caricamento.
    const ricaricato = hydrateState(JSON.parse(JSON.stringify(dopo)));
    assert.equal(ricaricato.materie[0].sfide.find((x) => x.id === 'sfida_1727000000002_qq11ww').noteLog[0].fonte, 'IA');
  });

  test('modifica a mano: voce MANUALE solo se il testo cambia davvero', () => {
    const s = base();
    const id = 'sfida_1727000000001_xy98zq';
    const uguale = reducer(s, { type: 'UPDATE_SFIDA', payload: { materiaId: 'm1', sfidaId: id, patch: { note: 'L = T - V  ' } } });
    assert.equal((uguale.materie[0].sfide.find((x) => x.id === id).noteLog || []).length, 0);
    const cambiato = reducer(s, { type: 'UPDATE_SFIDA', payload: { materiaId: 'm1', sfidaId: id, patch: { note: 'L = T − V, con T energia cinetica' } } });
    assert.equal(cambiato.materie[0].sfide.find((x) => x.id === id).noteLog[0].fonte, 'MANUALE');
    const ia = reducer(s, { type: 'UPDATE_SFIDA', payload: { materiaId: 'm1', sfidaId: id, patch: { note: 'Nuovi' }, noteFonte: 'IA' } });
    assert.equal(ia.materie[0].sfide.find((x) => x.id === id).noteLog[0].fonte, 'IA');
    // Un'altra modifica senza appunti non tocca il registro.
    const nome = reducer(s, { type: 'UPDATE_SFIDA', payload: { materiaId: 'm1', sfidaId: id, patch: { nome: 'Lagrange' } } });
    assert.equal(nome.materie[0].sfide.find((x) => x.id === id).noteLog, undefined);
  });
});

describe('V44 · bilancio settimanale: fase, sintesi, appunti, lezioni', () => {
  // Settimana dal lunedì 28 settembre 2026; "oggi" domenica 4 ottobre.
  const LUN = '2026-09-28';
  const OGGI = '2026-10-04';
  const materie = [
    {
      id: 'm1',
      nome: 'Analisi',
      examPassed: false,
      sfide: [
        {
          id: 's1',
          status: 'COMPLETED',
          completionTimestamp: '2026-09-30T15:00:00.000Z',
          noteLog: [
            { at: '2026-09-29T10:00:00.000Z', caratteri: 300, fonte: 'MANUALE' },
            { at: '2026-10-01T10:00:00.000Z', caratteri: 4200, fonte: 'IA' }
          ],
          sintesiManuale: [{ at: '2026-10-02T09:00:00.000Z', pagine: 6, appunti: 2 }],
          quizEsiti: [{ at: '2026-10-03T09:00:00.000Z', sapevo: 4, parziale: 1, no: 1 }]
        },
        { id: 's2', status: 'PENDING', noteLog: [{ at: '2026-09-20T10:00:00.000Z', caratteri: 10, fonte: 'MANUALE' }] }
      ]
    }
  ];
  const starLog = [
    { type: 'FOCUS_SESSION', dateKey: '2026-09-28', minutes: 50, materiaId: 'm1', sfidaId: 's1', workMode: 'SINTESI', pagineFonte: 12, pagineFontePerTipo: { SLIDE: 8, LIBRO: 4 }, pagineAppuntiProdotte: 3, quality: 'FLOW' },
    { type: 'FOCUS_SESSION', dateKey: '2026-09-29', minutes: 25, materiaId: 'm1', workMode: 'STUDIO', quality: 'DISTRACTED' }
  ];
  // Lezioni lunedì (2h) e mercoledì (1h30) per tutta la settimana.
  const campus = {
    semestri: [
      {
        id: 'sem1',
        nome: 'I semestre',
        inizio: '2026-09-21',
        fine: '2026-12-20',
        sospensioni: [],
        lezioni: [
          { id: 'l1', materiaId: 'm1', giorno: 1, inizio: '09:00', fine: '11:00', tipo: 'LEZIONE' },
          { id: 'l2', materiaId: 'm1', giorno: 3, inizio: '14:00', fine: '15:30', tipo: 'LEZIONE' }
        ]
      }
    ],
    override: null,
    rapportoSintesi: 1,
    esiti: { 'l2@2026-09-30': 'SALTATA' }
  };

  test('settimana di lezioni: sintesi (timer + a mano), appunti, lezioni seguite e saltate', () => {
    const c = buildWeeklyContext({ weekKey: LUN, starLog, materie, todayKey: OGGI, campus });
    assert.deepEqual(c.phase, { lezioni_days: 7, sessione_days: 0, campus: true });
    assert.equal(c.modes.SINTESI, 50);
    assert.equal(c.modes.STUDIO, 25);
    assert.deepEqual(c.quality, { FLOW: 1, NORMAL: 0, DISTRACTED: 1 });
    assert.equal(c.sintesi.pagine_fonte, 18);
    assert.equal(c.sintesi.per_tipo.SLIDE, 8);
    assert.equal(c.sintesi.per_tipo.LIBRO, 4);
    assert.equal(c.sintesi.pagine_appunti, 5);
    assert.equal(c.sintesi.argomenti, 1);
    assert.deepEqual(c.notes, { argomenti: 1, con_ia: 1, caratteri: 4200 });
    assert.deepEqual(c.lessons, { programmate: 2, minuti: 210, saltate: 1, minuti_saltati: 90, sintesi_attesa_min: 120 });
    assert.equal(c.topics_completed, 1);
    assert.deepEqual(c.quizzes, { count: 1, sapevo: 4, parziale: 1, no: 1 });
  });

  test('senza orario delle lezioni: tutto sessione, nessuna lezione', () => {
    const c = buildWeeklyContext({ weekKey: LUN, starLog, materie, todayKey: OGGI });
    assert.deepEqual(c.phase, { lezioni_days: 0, sessione_days: 7, campus: false });
    assert.equal(c.lessons, null);
  });
});
