/**
 * ⭐⭐ A FACTOR DECLARES ITS UNIT AS A SYMBOL, A CONSTRAINT AS A CODE — and
 * comparing them raw made the whole native-quantity path unreachable.
 *
 * Found by asking what MANUAL TEST STEPS a user could actually follow, then
 * checking real captured graphs instead of assuming. Drafts declare monetary
 * factors like this, verbatim from user debug bundles:
 *
 *   ('Hiring and Salary Cost', '£', 200000)
 *   ('Total Hiring Cost',      '£', 120000)
 *   ('Pro Plan Monthly Price', '£', 59)
 *   ('Resourcing Cost',        '£', 100000)
 *
 * …while Paul's ratified constraint declares `unit: "GBP"`. So the LEGITIMATE
 * case is `£` against `GBP`, and the shipped equality check refused it. Every
 * unit test passed; the feature would simply never have fired for a real user.
 * The guard was correct and pointed at the wrong bytes (trap 22).
 *
 * ⛔ THIS IS NOT A CONVERSION. `£` and `GBP` are one unit spelled two ways.
 * A genuine currency difference still refuses and no rate is ever applied —
 * asserted below, because a fix that widened into conversion would be far
 * worse than the bug.
 */
import { describe, expect, it } from 'vitest';

import { buildNativeQuantityOperation, sameUnit } from '../native-quantity-operation.js';
import { decideNativeQuantityAnswer } from '../native-quantity-answer.js';
import { decideOptionCostAsk } from '../../coaching/decide-option-cost-ask.js';
import type { PendingAction } from '../../session/pending-action.js';

const CELL = { value: 0.7, source: 'user_specified' };
const WRITE = {
  optionId: 'opt_a', optionLabel: 'Hire a Tech Lead',
  factorId: 'fac_cost', factorLabel: 'Hiring and Salary Cost',
  nativeValue: 150000, unit: 'GBP',
};

describe('sameUnit — one unit, two spellings', () => {
  it.each([['£', 'GBP'], ['GBP', '£'], ['$', 'USD'], ['gbp', 'GBP'], [' £ ', 'GBP']])(
    'treats %s and %s as the same unit', (a, b) => {
      expect(sameUnit(a, b)).toBe(true);
    },
  );

  it('⛔ still separates GENUINELY different currencies', () => {
    expect(sameUnit('£', 'USD')).toBe(false);
    expect(sameUnit('GBP', '$')).toBe(false);
  });

  it('does not widen non-currency units', () => {
    // 'months', 'FTE', 'developers' all appear on real captured factors.
    expect(sameUnit('months', 'FTE')).toBe(false);
    expect(sameUnit('developers', 'developers')).toBe(true);
  });

  it.each([['mW', 'MW'], ['ms', 'Ms'], ['kW', 'KW']])(
    '⛔ %s and %s are DIFFERENT — case carries meaning outside currency',
    (a, b) => {
      // Codex CX-114, executed: my first cut uppercased unconditionally and
      // collapsed these. Megawatts are not milliwatts.
      // ⚠ The test above could not see it: it varies LETTERS, not CASE. A
      // corpus that varies the wrong dimension cannot observe the defect.
      expect(sameUnit(a, b)).toBe(false);
    },
  );

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    '⛔ %s is a unit string, not an inherited property — it must not throw',
    (key) => {
      // The currency map is a plain object, so bracket access returns
      // INHERITED functions for these and `.toUpperCase()` threw a TypeError.
      // A unit comes from stored data, so such a key is reachable, not
      // theoretical.
      expect(() => sameUnit(key, 'GBP')).not.toThrow();
      expect(sameUnit(key, 'GBP')).toBe(false);
      expect(sameUnit(key, key)).toBe(true);
    },
  );

  it('an unrecognised code is NOT uppercased into a match', () => {
    // 'xyz' is not a currency, so it keeps its own spelling.
    expect(sameUnit('xyz', 'XYZ')).toBe(false);
  });
});

describe('the write accepts the REAL captured shape', () => {
  it('⭐ factor declared in £, constraint in GBP — writes', () => {
    // The exact pairing from captured graphs. Before the fix this returned null.
    expect(buildNativeQuantityOperation(WRITE, CELL, { cap: 200000, unit: '£' })).not.toBeNull();
  });

  it('⛔ a genuinely different factor currency still refuses', () => {
    expect(buildNativeQuantityOperation(WRITE, CELL, { cap: 200000, unit: 'USD' })).toBeNull();
  });
});

describe('the reader and the ask agree with the writer', () => {
  const HASH = 'gh-1';
  const pending = (unit: string): PendingAction =>
    ({
      id: 'pa', scenario_id: 's', chip_id: 'c',
      action: {
        kind: 'elicit_option_native_quantity', option_id: 'opt_a', option_label: 'A',
        factor_id: 'fac_cost', factor_label: 'Hiring and Salary Cost', unit,
      },
      preconditions: { graph_hash: HASH },
      expires_at_turn_count: 2,
      expires_at_iso: new Date(Date.now() + 600_000).toISOString(),
      emitted_at_iso: new Date().toISOString(),
    }) as PendingAction;

  const graph = { nodes: [
    { id: 'fac_cost', kind: 'factor' },
    { id: 'opt_a', kind: 'option' },
  ] };

  it('⭐ a £ reply answers a question asked in GBP', () => {
    const out = decideNativeQuantityAnswer({
      message: '£150,000', pendings: [pending('GBP')], graph,
      currentGraphHash: HASH, nowMs: Date.now(),
    });
    expect(out.kind).toBe('bind');
  });

  it('⛔ a $ reply still does NOT answer a GBP question', () => {
    const out = decideNativeQuantityAnswer({
      message: '$150,000', pendings: [pending('GBP')], graph,
      currentGraphHash: HASH, nowMs: Date.now(),
    });
    expect(out).toEqual({ kind: 'ask', reason: 'unit_mismatch' });
  });

  it('⭐ a cell stored under £ reads as ANSWERED for a GBP constraint', () => {
    // Otherwise the product re-asks a question it already holds the answer to.
    const ask = decideOptionCostAsk({
      notDecisionGrade: true,
      ratified: [{ node_id: 'fac_cost', unit: 'GBP', label: 'Budget limit' }],
      nodes: [{ id: 'fac_cost', kind: 'factor', label: 'Hiring and Salary Cost' }],
      options: [{ id: 'opt_a', label: 'A', interventions: { fac_cost: { value: 0.7, raw_value: 150000, unit: '£' } } }],
    });
    expect(ask).toBeNull();
  });
});
