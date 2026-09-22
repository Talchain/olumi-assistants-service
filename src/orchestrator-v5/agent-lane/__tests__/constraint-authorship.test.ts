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
  it('a model-proposed bound is NOT reported as the user’s', () => {
    const r = admitCandidateConstraints([modelBound], resolve);
    const reason = r.loss.find((l) => l.field_path.endsWith('.operator'))?.reason ?? '';
    expect(reason, 'must not claim the user stated it').not.toMatch(/user stated/i);
    expect(reason).toMatch(/this system proposed/i);
  });

  it('a user-stated bound IS reported as the user’s', () => {
    const r = admitCandidateConstraints([userBound], resolve);
    const reason = r.loss.find((l) => l.field_path.endsWith('.operator'))?.reason ?? '';
    expect(reason).toMatch(/you stated/i);
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
