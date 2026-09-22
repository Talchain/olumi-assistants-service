/**
 * Constraint admission — the strict-bound widening must be recorded, and the
 * user's own number must never be adjusted to compensate for it.
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

  it('records the strict-to-non-strict widening, naming the admitted boundary', () => {
    const r = admitCandidateConstraints(captured, nodeIdFor);
    const entry = r.loss.find((l) => l.field_path.endsWith('.operator'));
    expect(entry, 'a widening must be recorded').toBeDefined();
    expect(entry!.before).toBe('<');
    expect(entry!.after).toBe('<=');
    expect(entry!.severity).toBe('warn');
    expect(entry!.reason).toMatch(/exactly 4%/);
    expect(entry!.reason).toMatch(/no epsilon was invented/);
  });

  it('CONTRAST CONTROL: a non-strict bound is admitted with NO widening recorded', () => {
    const nonStrict: CandidateConstraint[] = [
      { metric: 'monthly churn', operator: '<=', value: 4, unit: '%', provenance: 'explicit' },
    ];
    const r = admitCandidateConstraints(nonStrict, nodeIdFor);
    expect(r.constraints[0].operator).toBe('<=');
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
