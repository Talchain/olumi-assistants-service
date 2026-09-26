/**
 * A RATE IS NOT A COST — the option-cost ask never fires on a percent-class limit, however it is spelled.
 *
 * ⚠ WHY: `isMonetaryish` excluded the non-native units by EXACT token (`% percent fraction ratio probability`). The
 * drafter writes churn limits as `"percent per month"` (WIRE, #69 5840961137; `configB.json:111`), so when such a limit
 * goes `unevaluated` — and a clamped, not-decision-grade limit now does (`constraint-verdict-decision-grade.test.ts`) —
 * the ask armed "what does <option> cost, in percent per month?". The classifier that reads every percent / point /
 * basis-point spelling already exists (`classifyUnitScaleClass`); this binds the ask to it.
 */
import { describe, expect, it } from 'vitest';

import { decideOptionCostAsk } from '../decide-option-cost-ask.js';

const NODES = [{ id: 'fac_limit', kind: 'factor', label: 'Monthly churn rate' }] as const;
const OPTIONS = [
  { id: 'opt_raise', label: 'Raise the price', interventions: { fac_limit: { value: 0.6 } } },
  { id: 'opt_hold', label: 'Hold the price', interventions: { fac_limit: { value: 0.2 } } },
] as const;

const askFor = (unit: string) =>
  decideOptionCostAsk({
    notDecisionGrade: true,
    ratified: [{ node_id: 'fac_limit', unit, label: 'The limit' }],
    nodes: NODES,
    options: OPTIONS,
  });

describe('the option-cost ask ignores a limit whose unit is a rate', () => {
  for (const unit of ['percent per month', '% per month', 'per cent a year', '% p.a.', 'percentage points', 'pp', 'bps', 'basis points', "% change vs this year's costs"]) {
    it(`"${unit}" arms no ask`, () => {
      expect(askFor(unit)).toBeNull();
    });
  }

  // ── CONTROLS: a native unit still gets its ask, bound to the first participating option ──
  for (const unit of ['GBP', '£', 'customers']) {
    it(`CONTROL: "${unit}" still asks opt_raise for its value`, () => {
      expect(askFor(unit)).toMatchObject({ option_id: 'opt_raise', factor_id: 'fac_limit', unit });
    });
  }
});
