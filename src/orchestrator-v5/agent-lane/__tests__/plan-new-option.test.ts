/**
 * ⭐ THE ACT RC NAMED: *"the Agent currently ideates an option but cannot execute
 * 'let's add that'."*
 *
 * These bind the PLANNING decision — what may be created, and what must be
 * refused before a user is ever asked to approve. The refusals matter more than
 * the happy path: every one of them is a case where applying would have left the
 * model worse than not trying.
 */

import { describe, it, expect } from 'vitest';
import { planNewOption, newOptionFollowUp } from '../propose-new-option.js';

const NODES = [
  { id: 'goal', kind: 'goal', label: 'Increase velocity' },
  { id: 'dev_headcount', kind: 'factor', label: 'Developer headcount' },
  { id: 'lead_time', kind: 'factor', label: 'Lead time' },
  { id: 'opt_hire_one', kind: 'option', label: 'Hire One Developer' },
];

describe('planning a new option', () => {
  it('⭐ plans the option the user picked, linked to the factors they named', () => {
    const p = planNewOption(NODES, { label: 'Hire a contractor', acts_on: [{ factor_label: 'Developer headcount', direction: 'positive' }, { factor_label: 'Lead time', direction: 'negative' }], rationale: 'r' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    if (!p.ok) return;
    expect(p.label).toBe('Hire a contractor');
    expect(p.actsOn.map((a) => a.id)).toEqual(['dev_headcount', 'lead_time']);
    // ⛔ the STATED direction is carried, never defaulted silently per factor
    expect(p.actsOn.map((a) => a.direction)).toEqual(['positive', 'negative']);
    // The id must be NEW — a collision is refused by `structural_add` AFTER the
    // user has approved, which is the failure mode this lane keeps hitting.
    expect(NODES.some((n) => n.id === p.optionId)).toBe(false);
  });

  it('⛔ refuses a duplicate label rather than creating a second indistinguishable option', () => {
    const p = planNewOption(NODES, { label: 'hire one developer', acts_on: [{ factor_label: 'Lead time', direction: 'positive' }], rationale: 'r' });
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.refusal).toBe('label_already_exists');
    // Names the existing one in ITS OWN casing, so the user can tell which it means.
    expect(p.detail).toContain('Hire One Developer');
  });

  it('⛔ refuses an option linked to nothing — it would block EVERY option', () => {
    const p = planNewOption(NODES, { label: 'Do something vague', acts_on: [], rationale: 'r' });
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.refusal).toBe('no_factors_named');
  });

  it('⛔ PARTIAL resolution is a REFUSAL, not a best effort', () => {
    const p = planNewOption(NODES, { label: 'Hire a contractor', acts_on: [{ factor_label: 'Developer headcount', direction: 'positive' }, { factor_label: 'Morale', direction: 'negative' }], rationale: 'r' });
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.refusal).toBe('no_such_factor');
    expect(p.unresolved_labels).toEqual(['Morale']);
  });

  it('CONTROL: a repeated factor is de-duplicated, not refused', () => {
    const p = planNewOption(NODES, { label: 'Hire a contractor', acts_on: [{ factor_label: 'Lead time', direction: 'positive' }, { factor_label: 'Lead time', direction: 'negative' }], rationale: 'r' });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.actsOn.map((a) => a.id)).toEqual(['lead_time']);
  });

  it('⛔ the follow-up says it CANNOT be compared yet — it must not read as done', () => {
    const p = planNewOption(NODES, { label: 'Hire a contractor', acts_on: [{ factor_label: 'Lead time', direction: 'positive' }], rationale: 'r' });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const text = newOptionFollowUp(p);
    expect(text).toContain('cannot be compared yet');
    expect(text).toContain('holds up the comparison for every option');
    // and it must NOT claim the model is ready
    expect(text).not.toMatch(/ready to (run|analyse|compare)/i);
  });
});
