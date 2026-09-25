/**
 * ⛔ A LIMIT READ BOTH WAYS IS NOT A LIMIT.
 *
 * Saved draw `cap-attach/L/B2/draw-4` (programme-docs `evidence/ai-quality-20260925`, review 5831251158): the brief
 * says "Budget is £900k either way", and the drafter emitted BOTH `GTM Spend >= 900000` and `GTM Spend <= 900000`,
 * each marked explicit. Once the metric named a real node (#1904) the pair attached, and the `>=` half turned a
 * ceiling into a floor: every option spending less than the whole budget read as breaking the user's limit, with
 * nothing said. The same pair appears on the shipped prompt (`A/B2/draw-3`), withheld there only by accident.
 *
 * So bounds on ONE node whose lower bound meets or exceeds the upper are withheld TOGETHER, and the loss is said in
 * words. Neither side is guessed. A genuine range (at least 60, at most 80) still attaches.
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateConstraints, type CandidateConstraint } from '../admit-constraint.js';

const ids: Record<string, string> = { 'GTM Spend': 'gtm_spend', 'Gross margin': 'gross_margin' };
const nodeIdFor = (m: string) => ids[m];
const bound = (metric: string, operator: CandidateConstraint['operator'], value: number, unit = 'GBP'): CandidateConstraint =>
  ({ metric, operator, value, unit, provenance: 'explicit' });
const directionLoss = (loss: readonly { field_path: string }[]) => loss.filter((l) => /\.bound_direction$/.test(l.field_path));

describe('opposite bounds on one limit are withheld together, and said', () => {
  it('B2 d4: "at least 900000" + "at most 900000" on GTM Spend → neither attaches; one loss names the limit in words', () => {
    const r = admitCandidateConstraints([bound('GTM Spend', '>=', 900000), bound('GTM Spend', '<=', 900000)], nodeIdFor);
    expect(r.constraints.filter((c) => c.node_id === 'gtm_spend')).toEqual([]);
    const lines = directionLoss(r.loss);
    expect(lines).toHaveLength(1);
    const reason = String((lines[0] as { reason?: string }).reason);
    expect(reason).toContain('GTM Spend');
    expect(reason).toContain('at least 900000');
    expect(reason).toContain('at most 900000');
    expect(reason, 'words, never a symbol, in text the user may read').not.toMatch(/[<>]=?/);
    expect(reason).toMatch(/not check/);
  });

  it('either order, and strict operators, are the same pair', () => {
    const r = admitCandidateConstraints([bound('GTM Spend', '<', 900000), bound('GTM Spend', '>', 900000)], nodeIdFor);
    expect(r.constraints).toEqual([]);
    expect(directionLoss(r.loss)).toHaveLength(1);
  });

  it('an impossible pair (at least 950000, at most 900000) is withheld too', () => {
    const r = admitCandidateConstraints([bound('GTM Spend', '>=', 950000), bound('GTM Spend', '<=', 900000)], nodeIdFor);
    expect(r.constraints).toEqual([]);
    expect(directionLoss(r.loss)).toHaveLength(1);
  });

  it('CONTROL: a genuine range (at least 60, at most 80) attaches both bounds', () => {
    const r = admitCandidateConstraints([bound('Gross margin', '>=', 60, '%'), bound('Gross margin', '<=', 80, '%')], nodeIdFor);
    expect(r.constraints.map((c) => `${c.operator}${c.value}`).sort()).toEqual(['<=80', '>=60']);
    expect(directionLoss(r.loss)).toEqual([]);
  });

  it('CONTROL: a single cap attaches, and a pair on one node leaves another node\'s limit alone', () => {
    const r = admitCandidateConstraints(
      [bound('GTM Spend', '>=', 900000), bound('GTM Spend', '<=', 900000), bound('Gross margin', '>=', 70, '%')], nodeIdFor);
    expect(r.constraints.map((c) => `${c.node_id}${c.operator}${c.value}`)).toEqual(['gross_margin>=70']);
  });
});
