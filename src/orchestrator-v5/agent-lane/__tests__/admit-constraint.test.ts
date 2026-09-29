/**
 * Constraint admission — a strict bound is held as stated beside the engine's
 * non-strict operator (A2, `operator_as_stated`), and the user's own number is
 * never adjusted to compensate for it.
 *
 * The constraint under test is the captured one from the live 22 Sep builder
 * run: `monthly churn < 4 %`, provenance explicit.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  admitCandidateConstraints,
  isStrictnessLost,
  type CandidateConstraint,
} from '../admit-constraint.js';

const faithful = JSON.parse(
  readFileSync(new URL('./fixtures/faithful.json', import.meta.url), 'utf8'),
);
const captured: CandidateConstraint[] = faithful.constraints;
const nodeIdFor = (metric: string) => (metric === 'monthly churn' ? 'monthly_churn' : undefined);

describe('admitCandidateConstraints', () => {
  it('the capture really is the strict case (control on the fixture)', () => {
    expect(captured).toHaveLength(1);
    expect(captured[0].operator).toBe('<');
    expect(captured[0].value).toBe(4);
    expect(captured[0].provenance).toBe('explicit');
  });

  it("preserves the user's number verbatim — no epsilon is invented", () => {
    const r = admitCandidateConstraints(captured, nodeIdFor);
    expect(r.constraints).toHaveLength(1);
    expect(r.constraints[0].value).toBe(4);
  });

  it('A2: holds the strict bound AS STATED beside the engine\'s "<=" — and records no widening loss (DL #72 5861407189)', () => {
    const r = admitCandidateConstraints(captured, nodeIdFor);
    expect(r.constraints[0]).toMatchObject({ operator: '<=', operator_as_stated: '<', value: 4 });
    expect(r.loss.filter((l) => l.field_path.endsWith('.operator')), 'strictness is held, not lost').toHaveLength(0);
  });

  it('CONTRAST CONTROL: a non-strict bound is admitted with NO widening recorded', () => {
    const nonStrict: CandidateConstraint[] = [
      { metric: 'monthly churn', operator: '<=', value: 4, unit: '%', provenance: 'explicit' },
    ];
    const r = admitCandidateConstraints(nonStrict, nodeIdFor);
    expect(r.constraints[0].operator).toBe('<=');
    expect(r.constraints[0]).not.toHaveProperty('operator_as_stated');
    expect(r.loss.filter((l) => l.field_path.endsWith('.operator'))).toHaveLength(0);
    expect(isStrictnessLost('<=')).toBe(false);
    expect(isStrictnessLost('<')).toBe(true);
  });

  it('withholds a constraint whose metric has no node, rather than guessing a target', () => {
    const r = admitCandidateConstraints(captured, () => undefined);
    expect(r.constraints).toHaveLength(0);
    expect(r.loss.some((l) => l.field_path.endsWith('.node_id'))).toBe(true);
  });
});
