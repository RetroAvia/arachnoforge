// =====================================================================
// ArachnoForge — src/utils/format.test.js (V41)
// Numeri all'italiana: separatore delle migliaia sempre, virgola decimale.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatInt, formatDecimal, formatNumber, formatSigned, minutiLabel, pagineLabel, plurale } from './format.js';

describe('formatInt', () => {
  test('migliaia anche a quattro cifre', () => {
    assert.equal(formatInt(1830), '1.830');
    assert.equal(formatInt(25000), '25.000');
    assert.equal(formatInt(1234567), '1.234.567');
  });
  test('arrotonda e non esplode sui valori sporchi', () => {
    assert.equal(formatInt(12.6), '13');
    assert.equal(formatInt('abc'), '0');
    assert.equal(formatInt(null), '0');
  });
});

describe('formatDecimal', () => {
  test('virgola e cifre fisse', () => {
    assert.equal(formatDecimal(26.614, 2), '26,61');
    assert.equal(formatDecimal(27, 1), '27,0');
    assert.equal(formatDecimal(1234.5, 1), '1.234,5');
  });
  test('valore non numerico', () => {
    assert.equal(formatDecimal(undefined), '—');
  });
});

describe('formatNumber', () => {
  test('decimali solo se servono', () => {
    assert.equal(formatNumber(26.6), '26,6');
    assert.equal(formatNumber(27), '27');
    assert.equal(formatNumber(26.6, 2), '26,6');
    assert.equal(formatNumber(1830.25, 1), '1.830,3');
  });
  test('mai "-0"', () => {
    assert.equal(formatNumber(-0.01, 1), '0');
    assert.equal(formatNumber(0), '0');
  });
});

describe('formatSigned', () => {
  test('segno sempre esplicito', () => {
    assert.equal(formatSigned(1106), '+1.106');
    assert.equal(formatSigned(-50), '−50');
    assert.equal(formatSigned(0), '0');
  });
});

describe('etichette', () => {
  test('minuti, pagine, plurali', () => {
    assert.equal(minutiLabel(0), '0m');
    assert.equal(minutiLabel(45), '45m');
    assert.equal(minutiLabel(150), '2h 30m');
    assert.equal(pagineLabel(1), '1 pagina');
    assert.equal(pagineLabel(12), '12 pagine');
    assert.equal(plurale(1, 'argomento', 'argomenti'), '1 argomento');
    assert.equal(plurale(3, 'argomento', 'argomenti'), '3 argomenti');
  });
});
