// =====================================================================
// ArachnoForge — src/utils/materiaMeta.test.js (V41)
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isGoblinProtocol } from './materiaMeta.js';
import { getDateKey } from './dateUtils.js';

function traGiorni(n) {
  const d = new Date();
  return getDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

describe('isGoblinProtocol', () => {
  test('esame fra due giorni: emergenza', () => {
    assert.equal(isGoblinProtocol({ examDate: traGiorni(2), examPassed: false }), true);
  });
  test('esame già superato: mai emergenza, anche a data vicina', () => {
    assert.equal(isGoblinProtocol({ examDate: traGiorni(1), examPassed: true }), false);
  });
  test('senza data, o con la data passata', () => {
    assert.equal(isGoblinProtocol({ examDate: null }), false);
    assert.equal(isGoblinProtocol({ examDate: traGiorni(-1) }), false);
    assert.equal(isGoblinProtocol(null), false);
  });
  test('esame lontano', () => {
    assert.equal(isGoblinProtocol({ examDate: traGiorni(30) }), false);
  });
});
