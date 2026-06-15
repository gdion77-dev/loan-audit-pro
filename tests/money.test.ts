/**
 * Tests: money cents conversion + null-vs-zero behavior.
 * Runner: node:test (vitest-compatible structure; to migrate, swap the
 * two imports below for `import { describe, it, expect } from 'vitest'`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  moneyFromCents,
  moneyFromDecimal,
  parseMoneyString,
  moneyToDecimalString,
  formatMoneyGreek,
  moneyEquals,
  isExplicitZero,
  isMissing,
  isMoney,
  MoneyError,
} from '../src/domain/money';

describe('money: integer cents conversion', () => {
  it('stores €647.08 as 64708 cents', () => {
    const m = moneyFromDecimal(647.08);
    assert.equal(m.cents, 64708);
    assert.equal(m.currency, 'EUR');
  });

  it('moneyFromCents accepts integers, including negatives', () => {
    assert.equal(moneyFromCents(0).cents, 0);
    assert.equal(moneyFromCents(-1250).cents, -1250);
  });

  it('moneyFromCents rejects non-integer cents', () => {
    assert.throws(() => moneyFromCents(64708.5), MoneyError);
    assert.throws(() => moneyFromCents(Number.NaN), MoneyError);
  });

  it('moneyFromDecimal rejects more than 2 decimal places', () => {
    assert.throws(() => moneyFromDecimal(1.005), MoneyError);
  });

  it('parses Greek format "1.234,56" to 123456 cents', () => {
    const m = parseMoneyString('1.234,56');
    assert.ok(m !== null);
    assert.equal(m.cents, 123456);
  });

  it('parses EN format "1,234.56" to 123456 cents', () => {
    const m = parseMoneyString('1,234.56');
    assert.ok(m !== null);
    assert.equal(m.cents, 123456);
  });

  it('parses "647,08" and "647.08" identically', () => {
    const a = parseMoneyString('647,08');
    const b = parseMoneyString('647.08');
    assert.ok(a !== null && b !== null);
    assert.ok(moneyEquals(a, b));
    assert.equal(a.cents, 64708);
  });

  it('treats "1.234" (Greek thousands grouping) as 123400 cents', () => {
    const m = parseMoneyString('1.234');
    assert.ok(m !== null);
    assert.equal(m.cents, 123400);
  });

  it('parses negative amounts "-12,50" as -1250 cents', () => {
    const m = parseMoneyString('-12,50');
    assert.ok(m !== null);
    assert.equal(m.cents, -1250);
  });

  it('round-trips through moneyToDecimalString', () => {
    assert.equal(moneyToDecimalString(moneyFromCents(64708)), '647.08');
    assert.equal(moneyToDecimalString(moneyFromCents(-305)), '-3.05');
  });

  it('formats Greek display "1.234,56 €"', () => {
    assert.equal(formatMoneyGreek(moneyFromCents(123456)), '1.234,56 €');
  });

  it('rejects unparseable strings', () => {
    assert.throws(() => parseMoneyString('abc'), MoneyError);
  });

  it('isMoney validates structure and integer cents', () => {
    assert.equal(isMoney({ cents: 100, currency: 'EUR' }), true);
    assert.equal(isMoney({ cents: 100.5, currency: 'EUR' }), false);
    assert.equal(isMoney({ cents: 100 }), false);
    assert.equal(isMoney(null), false);
  });
});

describe('money: null vs zero (missing is never zero)', () => {
  it('empty string parses to null (missing), not zero', () => {
    assert.equal(parseMoneyString(''), null);
    assert.equal(parseMoneyString('   '), null);
  });

  it('unknown markers ("-", "Άγνωστο", "N/A") parse to null', () => {
    assert.equal(parseMoneyString('-'), null);
    assert.equal(parseMoneyString('Άγνωστο'), null);
    assert.equal(parseMoneyString('N/A'), null);
  });

  it('explicit "0,00" parses to zero Money, not null', () => {
    const m = parseMoneyString('0,00');
    assert.ok(m !== null);
    assert.equal(m.cents, 0);
  });

  it('isExplicitZero is true only for explicit zero, never for null', () => {
    assert.equal(isExplicitZero(moneyFromCents(0)), true);
    assert.equal(isExplicitZero(null), false);
    assert.equal(isExplicitZero(moneyFromCents(1)), false);
  });

  it('isMissing distinguishes null from zero', () => {
    assert.equal(isMissing(null), true);
    assert.equal(isMissing(moneyFromCents(0)), false);
  });
});
