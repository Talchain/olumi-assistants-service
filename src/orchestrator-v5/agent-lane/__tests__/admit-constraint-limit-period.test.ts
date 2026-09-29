/**
 * ⛔⛔ A PERCENT LIMIT ON A DIFFERENT PERIOD IS NEVER RELABELLED ONTO THE FACTOR'S SCALE (rule1-limit-period, 28 Sep).
 *
 * WIRE, engine-direct on PLoT `22f3d94` (Canonical State lane, `canonical-state/rule1-limit-period/MEASURE.md`):
 *   · "annual churn under 10 %" on a `% per month` churn node (level 3 %/month, roughly 31 %/year) was relabelled to
 *     `"%"` at admission and scored as "monthly churn ≤ 10 %": P = 1 on every option, `decision_grade: true` (J-a-10).
 *     A WRONG PASS.
 *   · Sent in its own unit (`% per year`), PLoT refuses it and names the unit cause (J-yn-10): the honest outcome.
 *   · The SAME-period relabel (`4 "% per month"` → `"%"` on a `% per month` node) is correct and is the only
 *     decision-grade reading on the non-intervened path (J-a = J-c byte for byte). It must stay.
 *
 * The period is read from the two units' own spellings by the grammar that already admits a period
 * (`PERIOD_TAIL`): the limit's unit, and the unit of the node its `node_id` names. Never from the metric's words.
 * A spelling with no period on either side ("%", "percent") is not "different": today's behaviour is kept.
 *
 * Every row binds the admitted constraint BY IDENTITY (its constraint_id).
 */
import { describe, it, expect } from 'vitest';

import {
  admitCandidateConstraints,
  percentLevelFrame,
  type AdmittedConstraint,
  type LimitTargetScale,
} from '../admit-constraint.js';

const ID = 'agent-lane:fac_churn:<=';

/** Paul's churn node as admission writes it: `{value 0.03, raw_value 3}` on `scale_frame` 100, spelt `% per month`. */
const MONTHLY: LimitTargetScale = { unit: '% per month', value: 0.03, raw_value: 3, scale_frame: 100 };
/** The same level held per YEAR. */
const YEARLY: LimitTargetScale = { unit: '% per year', value: 0.3, raw_value: 30, scale_frame: 100 };

function admit1(value: number, unit: string, target: LimitTargetScale, frame: 'level' | 'delta' = 'level'): AdmittedConstraint {
  const { constraints } = admitCandidateConstraints(
    [{ metric: 'Monthly churn', operator: '<=', value, unit, provenance: 'explicit', frame }],
    (m) => (m === 'Monthly churn' ? 'fac_churn' : undefined),
    (id) => (id === 'fac_churn' ? target : undefined),
  );
  const hit = constraints.find((c) => c.constraint_id === ID);
  expect(hit, 'the admitted constraint is found by its id').toBeDefined();
  return hit as AdmittedConstraint;
}

const STAMPS = ['provenance_unit_relabelled', 'provenance_unit_normalised'] as const;
const stampKeys = (c: AdmittedConstraint): string[] => STAMPS.filter((k) => k in (c as unknown as Record<string, unknown>));

describe('row 1 (CONTROL): a limit in the node\'s OWN period is still relabelled to "%"', () => {
  it('4 "% per month" on the `% per month` node (level 3, value 0.03, frame 100) → "%" 4, stamped', () => {
    expect(admit1(4, '% per month', MONTHLY)).toMatchObject({
      unit: '%',
      value: 4,
      value_frame: 'level',
      provenance_unit_relabelled: { rule: 'agent_lane_limit_unit_v1', pre_normalisation_value: 4, pre_normalisation_unit: '% per month' },
    });
  });

  // The module's own period synonyms name ONE period: these are the same period, spelt differently.
  it.each([
    ['% monthly', { ...MONTHLY, unit: '% monthly' }], // journey A, served
    ['percent a month', MONTHLY],
    ['%/month', { ...MONTHLY, unit: 'percent per month' }],
    ['% p.a.', YEARLY],
    ['percent per annum', { ...YEARLY, unit: '% annually' }],
    ['% yearly', { ...YEARLY, unit: '% p.a.' }],
  ])('"%s" on a node in the same period → "%%"', (unit, target) => {
    expect(admit1(4, unit, target)).toMatchObject({ unit: '%', value: 4, provenance_unit_relabelled: { pre_normalisation_unit: unit } });
  });

  it('a level in percentage points in the node\'s own period → "%" (the PP rung is unchanged)', () => {
    expect(admit1(4, 'percentage points per month', MONTHLY)).toMatchObject({
      unit: '%',
      provenance_unit_relabelled: { rule: 'agent_lane_limit_pp_level_v1' },
    });
  });

  it('on a node "% of Pro subscribers per month" (served spelling), "% per month" → "%"', () => {
    expect(admit1(4, '% per month', { ...MONTHLY, unit: '% of Pro subscribers per month' })).toMatchObject({ unit: '%' });
  });
});

describe('row 2 (RED at base): "% per year" on a `% per month` node is kept VERBATIM', () => {
  it('10 "% per year" → "% per year" 10, no relabel stamp (base: "%" — "monthly churn ≤ 10 %", P = 1)', () => {
    const c = admit1(10, '% per year', MONTHLY);
    expect(c).toMatchObject({ unit: '% per year', value: 10, value_frame: 'level' });
    expect(stampKeys(c)).toEqual([]);
  });

  it.each(['% p.a.', 'percent per annum', '% annually', 'percent a year', '%/year', '% yearly'])(
    'the yearly spelling "%s" on the monthly node → verbatim, unstamped',
    (unit) => {
      const c = admit1(10, unit, MONTHLY);
      expect(c.unit).toBe(unit);
      expect(stampKeys(c)).toEqual([]);
    },
  );

  it('"% per week" on the monthly node → verbatim', () => {
    expect(admit1(2, '% per week', MONTHLY).unit).toBe('% per week');
  });

  it('a LEVEL in "percentage points per year" on the monthly node → verbatim (base: the PP rung relabelled it)', () => {
    const c = admit1(10, 'percentage points per year', MONTHLY);
    expect(c.unit).toBe('percentage points per year');
    expect(stampKeys(c)).toEqual([]);
  });

  it('on a CAPPED node spelt "percent per month" → verbatim, NOT the node\'s spelling (base: relabelled to it)', () => {
    const c = admit1(10, '% per year', { unit: 'percent per month', cap: 20, value: 0.15, raw_value: 3 });
    expect(c.unit).toBe('% per year');
    expect(stampKeys(c)).toEqual([]);
  });

  it('on a node "% of Pro subscribers per month" → verbatim (the node\'s trailing period is read)', () => {
    const c = admit1(10, '% per year', { ...MONTHLY, unit: '% of Pro subscribers per month' });
    expect(c.unit).toBe('% per year');
    expect(stampKeys(c)).toEqual([]);
  });
});

describe('row 3 (RED at base): "% per month" on a `% per year` node is kept VERBATIM', () => {
  it('4 "% per month" → "% per month" 4, no relabel stamp', () => {
    const c = admit1(4, '% per month', YEARLY);
    expect(c).toMatchObject({ unit: '% per month', value: 4 });
    expect(stampKeys(c)).toEqual([]);
  });

  it('"% monthly" on a node spelt "% p.a." → verbatim', () => {
    expect(admit1(4, '% monthly', { ...YEARLY, unit: '% p.a.' }).unit).toBe('% monthly');
  });
});

describe('row 4 (CONTROL): a spelling with NO period on either side is unchanged from today', () => {
  it.each([
    ['%', MONTHLY],
    ['%', YEARLY],
  ])('bare "%s" 4 on "%s" → "%%" 4, unstamped', (unit, target) => {
    const c = admit1(4, unit, target);
    expect(c).toMatchObject({ unit: '%', value: 4 });
    expect(stampKeys(c)).toEqual([]);
  });

  it('"percent" 4 on the monthly node → "%" (served 08bf9a1f: no period on the limit, so not "different")', () => {
    expect(admit1(4, 'percent', MONTHLY)).toMatchObject({ unit: '%', provenance_unit_relabelled: { pre_normalisation_unit: 'percent' } });
  });

  it('"% per year" on a node spelt bare "%" → "%" as today (the node states no period)', () => {
    expect(admit1(10, '% per year', { ...MONTHLY, unit: '%' })).toMatchObject({ unit: '%' });
  });

  it('"% per year" on a node with NO unit (a capless proportion) → "%" as today', () => {
    expect(admit1(10, '% per year', { value: 0.07 })).toMatchObject({ unit: '%' });
  });

  it('"% per year" on a node "% of Pro subscribers" (no period) → "%" as today', () => {
    expect(admit1(10, '% per year', { ...MONTHLY, unit: '% of Pro subscribers' })).toMatchObject({ unit: '%' });
  });
});

describe('CONTROL: the shared "is this limit a percentage LEVEL?" rule is not the node\'s period', () => {
  it('percentLevelFrame reads a "% per year" level as a percent level on 100 (it asks the limit against itself)', () => {
    expect(percentLevelFrame(10, '% per year', 'level')).toBe(100);
    expect(percentLevelFrame(4, '% per month', 'level')).toBe(100);
    expect(percentLevelFrame(4, 'percentage points per year', 'level')).toBe(100);
  });
});
