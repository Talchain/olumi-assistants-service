/**
 * A constraint receipt must say who set the bound.
 *
 * ⛔ THE DEFECT THIS PINS, found by adversarial audit and confirmed by execution:
 * `CandidateConstraint.provenance` was declared and never read, so the widening
 * receipt asserted "**The user stated** a STRICT bound" for EVERY strict
 * operator — including one the model invented. Olumi then withheld that user's
 * analysis with the message "a limit **you** set could not be attached".
 *
 * A model could therefore manufacture a constraint, have Olumi certify it as the
 * user's in the audit record, and have Olumi restrict the user's own analysis on
 * the strength of it. That is the precise failure the module header exists to
 * prevent, arriving through the field it declared but never read.
 */

import { describe, it, expect } from 'vitest';
import { admitCandidateConstraints } from '../admit-constraint.js';

const resolve = () => 'monthly_churn';
const userBound = { metric: 'monthly churn', operator: '<' as const, value: 4, unit: '%', provenance: 'explicit' };
const modelBound = { ...userBound, provenance: 'ai_proposed' };

describe('constraint authorship', () => {
  // A2 (DL #72 5861407189): a strict bound is no longer a widening LOSS — it is held as stated
  // (`operator_as_stated`) — so its authorship lives on the admitted row alone (next row), never in a receipt.
  it('A2: a strict bound, the user\'s or the model\'s, leaves no widening receipt to misattribute', () => {
    for (const bound of [userBound, modelBound]) {
      const r = admitCandidateConstraints([bound], resolve);
      expect(r.loss.filter((l) => l.field_path.endsWith('.operator')), bound.provenance).toEqual([]);
      expect(r.constraints[0]).toMatchObject({ operator: '<=', operator_as_stated: '<' });
    }
  });

  it('the admitted constraint carries its canonical authorship', () => {
    const asUser = admitCandidateConstraints([userBound], resolve).constraints[0];
    const asModel = admitCandidateConstraints([modelBound], resolve).constraints[0];
    // GoalConstraintSchema (src/schemas/assist.ts:418) provenance: explicit | inferred | proxy
    expect(asUser.provenance).toBe('explicit');
    expect(asModel.provenance).toBe('inferred');
  });

  it('authorship reaches the withheld-constraint message too', () => {
    const r = admitCandidateConstraints([modelBound], () => undefined);
    const reason = r.loss.find((l) => l.field_path.endsWith('.node_id'))?.reason ?? '';
    expect(reason, 'an unattachable MODEL limit is not "a limit you set"').not.toMatch(/you set|user stated/i);
  });
});
