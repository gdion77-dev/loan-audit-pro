/**
 * Tests: single-period payment allocation engine (Step 4-A).
 * Covers the 20 required scenarios.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  allocateSinglePayment,
  PAYMENT_ALLOCATION_AUDIT_CODES as PA,
  type PaymentAllocationInput,
} from '../src/engines/paymentAllocationEngine';

const alloc = (input: Partial<PaymentAllocationInput>) =>
  allocateSinglePayment({
    openingBalanceCents: 1_000_000, // €10,000
    accruedInterestCents: 5_000, // €50
    paymentAmountCents: 50_000, // €500
    feesAndPremiumsCents: 0,
    allocationOrder: 'fees_interest_principal',
    ...input,
  });

/* ------------------------------------------------------------------ */
/* waterfall basics                                                    */
/* ------------------------------------------------------------------ */

describe('paymentAllocationEngine: waterfall basics', () => {
  it('normal allocation: €10,000 / interest €50 / fees €0 / payment €500 (test 1)', () => {
    const r = alloc({});
    assert.equal(r.status, 'success');
    assert.equal(r.allocatedToFeesCents, 0);
    assert.equal(r.allocatedToInterestCents, 5_000); // €50
    assert.equal(r.allocatedToPrincipalCents, 45_000); // €450
    assert.equal(r.unpaidFeesCents, 0);
    assert.equal(r.unpaidInterestCents, 0);
    assert.equal(r.overpaymentCents, 0);
    assert.equal(r.closingBalanceCents, 955_000); // €9,550
  });

  it('fees first: fees €20 / interest €50 / payment €500 (test 2)', () => {
    const r = alloc({ feesAndPremiumsCents: 2_000 });
    assert.equal(r.status, 'success');
    assert.equal(r.allocatedToFeesCents, 2_000); // €20
    assert.equal(r.allocatedToInterestCents, 5_000); // €50
    assert.equal(r.allocatedToPrincipalCents, 43_000); // €430
    assert.equal(r.closingBalanceCents, 957_000); // €9,570
  });

  it('payment less than fees: all to fees, interest fully unpaid, balance unchanged (test 3)', () => {
    const r = alloc({ feesAndPremiumsCents: 2_000, paymentAmountCents: 1_200 });
    assert.equal(r.status, 'success');
    assert.equal(r.allocatedToFeesCents, 1_200);
    assert.equal(r.allocatedToInterestCents, 0);
    assert.equal(r.allocatedToPrincipalCents, 0);
    assert.equal(r.unpaidFeesCents, 800);
    assert.equal(r.unpaidInterestCents, 5_000); // full interest unpaid
    assert.equal(r.closingBalanceCents, 1_000_000); // opening unchanged
  });

  it('payment covers fees but not full interest (test 4)', () => {
    const r = alloc({ feesAndPremiumsCents: 2_000, paymentAmountCents: 4_500 });
    assert.equal(r.status, 'success');
    assert.equal(r.allocatedToFeesCents, 2_000);
    assert.equal(r.allocatedToInterestCents, 2_500);
    assert.equal(r.allocatedToPrincipalCents, 0);
    assert.equal(r.unpaidFeesCents, 0);
    assert.equal(r.unpaidInterestCents, 2_500);
    assert.equal(r.closingBalanceCents, 1_000_000);
  });

  it('payment covers fees and interest exactly, no principal (test 5)', () => {
    const r = alloc({ feesAndPremiumsCents: 2_000, paymentAmountCents: 7_000 });
    assert.equal(r.status, 'success');
    assert.equal(r.allocatedToFeesCents, 2_000);
    assert.equal(r.allocatedToInterestCents, 5_000);
    assert.equal(r.allocatedToPrincipalCents, 0);
    assert.equal(r.unpaidInterestCents, 0);
    assert.equal(r.overpaymentCents, 0);
    assert.equal(r.closingBalanceCents, 1_000_000);
  });

  it('payment fully repays principal with exact amount (test 6)', () => {
    // fees 20 + interest 50 + principal 10,000 = €10,070 exactly
    const r = alloc({ feesAndPremiumsCents: 2_000, paymentAmountCents: 1_007_000 });
    assert.equal(r.status, 'success');
    assert.equal(r.allocatedToPrincipalCents, 1_000_000);
    assert.equal(r.closingBalanceCents, 0);
    assert.equal(r.overpaymentCents, 0);
    assert.equal(
      r.auditEntries.some((e) => e.code === PA.OVERPAYMENT_AFTER_FULL_PRINCIPAL),
      false,
    );
  });

  it('payment exceeds full payoff: overpayment, never negative balance (test 7)', () => {
    // €10,070 payoff, payment €10,100 -> overpayment €30
    const r = alloc({ feesAndPremiumsCents: 2_000, paymentAmountCents: 1_010_000 });
    assert.equal(r.status, 'success');
    assert.equal(r.allocatedToPrincipalCents, 1_000_000); // capped at opening
    assert.equal(r.closingBalanceCents, 0); // never negative
    assert.equal(r.overpaymentCents, 3_000); // €30
    const e = r.auditEntries.find((x) => x.code === PA.OVERPAYMENT_AFTER_FULL_PRINCIPAL);
    assert.ok(e);
    assert.equal(e.severity, 'info');
  });

  it('explicit zero payment is valid: full unpaid fees/interest, balance unchanged (test 8)', () => {
    const r = alloc({ feesAndPremiumsCents: 2_000, paymentAmountCents: 0 });
    assert.equal(r.status, 'success'); // zero is data, not missing
    assert.equal(r.allocatedToFeesCents, 0);
    assert.equal(r.allocatedToInterestCents, 0);
    assert.equal(r.allocatedToPrincipalCents, 0);
    assert.equal(r.unpaidFeesCents, 2_000);
    assert.equal(r.unpaidInterestCents, 5_000);
    assert.equal(r.closingBalanceCents, 1_000_000);
    assert.equal(
      r.auditEntries.some((e) => e.code === PA.PAYMENT_AMOUNT_MISSING),
      false,
    );
  });
});

/* ------------------------------------------------------------------ */
/* null vs explicit zero                                               */
/* ------------------------------------------------------------------ */

describe('paymentAllocationEngine: null vs explicit zero', () => {
  it('null payment returns missing_data (test 9)', () => {
    const r = alloc({ paymentAmountCents: null });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.allocatedToInterestCents, null);
    assert.equal(r.allocatedToPrincipalCents, null);
    assert.equal(r.closingBalanceCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === PA.PAYMENT_AMOUNT_MISSING));
  });

  it('null opening balance returns missing_data + BALANCE_MISSING (test 10)', () => {
    const r = alloc({ openingBalanceCents: null });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.closingBalanceCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === PA.BALANCE_MISSING));
  });

  it('null interest returns missing_data + INTEREST_MISSING (test 11)', () => {
    const r = alloc({ accruedInterestCents: null });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.allocatedToInterestCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === PA.INTEREST_MISSING));
  });

  it('null fees -> assumed 0 with FEES_ASSUMED_ZERO assumption (test 12)', () => {
    const r = alloc({ feesAndPremiumsCents: null });
    assert.equal(r.status, 'success');
    assert.equal(r.feesAndPremiumsDueCents, 0);
    assert.equal(r.allocatedToFeesCents, 0);
    const e = r.auditEntries.find((x) => x.code === PA.FEES_ASSUMED_ZERO);
    assert.ok(e);
    assert.equal(e.severity, 'assumption');
    // omitted (undefined) behaves the same as null:
    const r2 = allocateSinglePayment({
      openingBalanceCents: 1_000_000,
      accruedInterestCents: 5_000,
      paymentAmountCents: 50_000,
      allocationOrder: 'fees_interest_principal',
    });
    assert.ok(r2.auditEntries.some((x) => x.code === PA.FEES_ASSUMED_ZERO));
  });

  it('explicit zero fees creates NO assumption and no missing entry (test 13)', () => {
    const r = alloc({ feesAndPremiumsCents: 0 });
    assert.equal(r.status, 'success');
    assert.equal(r.auditEntries.some((e) => e.code === PA.FEES_ASSUMED_ZERO), false);
    assert.equal(r.auditEntries.some((e) => e.code === PA.FEES_INVALID), false);
  });

  it('missing allocationOrder adds an explicit assumption entry', () => {
    const r = allocateSinglePayment({
      openingBalanceCents: 1_000_000,
      accruedInterestCents: 5_000,
      paymentAmountCents: 50_000,
      feesAndPremiumsCents: 0,
    });
    const e = r.auditEntries.find((x) => x.code === PA.ALLOCATION_ORDER_ASSUMED);
    assert.ok(e);
    assert.equal(e.severity, 'assumption');
    // explicitly provided order -> no assumption:
    const r2 = alloc({});
    assert.equal(
      r2.auditEntries.some((x) => x.code === PA.ALLOCATION_ORDER_ASSUMED),
      false,
    );
  });
});

/* ------------------------------------------------------------------ */
/* invalid inputs                                                      */
/* ------------------------------------------------------------------ */

describe('paymentAllocationEngine: invalid inputs', () => {
  it('negative interest -> requires_review, allocations null, no silent zero (test 14)', () => {
    const r = alloc({ accruedInterestCents: -1_250 });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.allocatedToInterestCents, null); // not zeroed, not allocated
    assert.equal(r.allocatedToPrincipalCents, null);
    assert.equal(r.closingBalanceCents, null);
    const e = r.auditEntries.find((x) => x.code === PA.NEGATIVE_INTEREST_REQUIRES_REVIEW);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
    // the negative fact stays visible in the echo:
    assert.equal(r.interestDueCents, -1_250);
  });

  it('negative payment is invalid -> requires_review (test 15)', () => {
    const r = alloc({ paymentAmountCents: -100 });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.allocatedToPrincipalCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === PA.PAYMENT_AMOUNT_INVALID));
  });

  it('negative fees are invalid -> requires_review', () => {
    const r = alloc({ feesAndPremiumsCents: -500 });
    assert.equal(r.status, 'requires_review');
    assert.ok(r.auditEntries.some((e) => e.code === PA.FEES_INVALID));
  });

  it('non-integer cents are rejected', () => {
    const r = alloc({ paymentAmountCents: 50_000.5 });
    assert.equal(r.status, 'requires_review');
    assert.ok(r.auditEntries.some((e) => e.code === PA.PAYMENT_AMOUNT_INVALID));
  });
});

/* ------------------------------------------------------------------ */
/* invariants                                                          */
/* ------------------------------------------------------------------ */

describe('paymentAllocationEngine: invariants', () => {
  it('allocatedToPrincipal never exceeds opening balance (test 16)', () => {
    const cases = [
      alloc({ paymentAmountCents: 5_000_000 }), // huge payment
      alloc({ openingBalanceCents: 100, paymentAmountCents: 1_000_000 }),
      alloc({ openingBalanceCents: 0, paymentAmountCents: 10_000 }),
    ];
    for (const r of cases) {
      assert.ok(
        (r.allocatedToPrincipalCents ?? 0) <= (r.openingBalanceCents ?? 0),
        'principal allocation exceeded opening balance',
      );
    }
  });

  it('closingBalance never below zero (test 17)', () => {
    const cases = [
      alloc({ paymentAmountCents: 5_000_000 }),
      alloc({ openingBalanceCents: 1, paymentAmountCents: 1_000_000 }),
      alloc({ openingBalanceCents: 0, paymentAmountCents: 0, accruedInterestCents: 0 }),
    ];
    for (const r of cases) {
      assert.ok((r.closingBalanceCents ?? 0) >= 0, 'closing balance went negative');
    }
  });

  it('conservation: fees + interest + principal + overpayment = payment (success paths)', () => {
    const cases = [
      alloc({}),
      alloc({ feesAndPremiumsCents: 2_000, paymentAmountCents: 1_200 }),
      alloc({ feesAndPremiumsCents: 2_000, paymentAmountCents: 1_010_000 }),
      alloc({ paymentAmountCents: 0, feesAndPremiumsCents: 2_000 }),
    ];
    for (const r of cases) {
      assert.equal(r.status, 'success');
      const sum =
        (r.allocatedToFeesCents ?? 0) +
        (r.allocatedToInterestCents ?? 0) +
        (r.allocatedToPrincipalCents ?? 0) +
        (r.overpaymentCents ?? 0);
      assert.equal(sum, r.paymentAmountCents);
    }
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('paymentAllocationEngine: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '../src/engines/paymentAllocationEngine.ts'),
    'utf8',
  );
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no rate / day-count / interest-accrual calculation here (test 18)', () => {
    // no imports from the locked engines, only from domain:
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const imp of imports) {
      assert.ok(imp!.startsWith('../domain/'), `unexpected import: ${imp}`);
    }
    // no rate or day-count arithmetic in code:
    assert.equal(/resolveRateForDate|calculateDayCount|calculateAccruedInterest/.test(codeOnly), false);
    assert.equal(/fractionOfYear|yearBasis|RatePercent\s*\/\s*100/.test(codeOnly), false);
  });

  it('no amortization / schedule generation / multi-period loops (test 19)', () => {
    assert.equal(/amortiz/i.test(codeOnly), false);
    assert.equal(/schedule/i.test(codeOnly.replace(/scheduled_installment|bank_schedule/g, '')), false);
    assert.equal(/dueDate|periods\b|RecalcRow/i.test(codeOnly), false);
    // no looping constructs over periods:
    assert.equal(/\bfor\s*\(|\bwhile\s*\(|\.map\(|\.forEach\(/.test(codeOnly), false);
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording/formula exists in code (test 20)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
  });
});
