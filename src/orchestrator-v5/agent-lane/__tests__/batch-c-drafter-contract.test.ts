/**
 * Recovery Batch C — the drafter STATES the target's semantics (ruling 11; amendments 2, 3, 5): the contract carries
 * `goal.quantity_frame`, `goal.basis` and `constraints[].role`; the strict provider schema requires them; a compaction
 * retry pins them (else a retried draft would silently lose the basis and the change target would be refused); and the
 * one Batch C instruction asks the "+10%" question rather than picking a reading. The prompt WORDS are for science
 * sign-off; this pins only that they are present and isolated.
 */
import { describe, expect, it } from 'vitest';

import { BUILD_INSTRUCTIONS, buildCandidateSchema, retrySchemaPinningGoal, strictForTheDrafter } from '../runtime/build-model.js';
import type { CandidateModel } from '../admit-model.js';

type Rec = Record<string, any>;
const goalOf = (schema: Rec): Rec => schema.properties.goal;
const constraintItemOf = (schema: Rec): Rec => schema.properties.constraints.items;

describe('the Batch C drafter contract', () => {
  it('the candidate contract declares quantity_frame, basis and role, and older candidates (without them) still validate', () => {
    const s = buildCandidateSchema() as Rec;
    expect(Object.keys(goalOf(s).properties)).toEqual(expect.arrayContaining(['quantity_frame', 'basis']));
    expect(goalOf(s).required).not.toContain('basis');
    expect(goalOf(s).required).not.toContain('quantity_frame');
    expect(constraintItemOf(s).properties.role.enum).toEqual(['limit', 'target']);
    expect(constraintItemOf(s).required).not.toContain('role');
  });

  it('what is SENT requires every member (strict output must say "none" rather than omit it)', () => {
    const s = strictForTheDrafter(buildCandidateSchema()) as Rec;
    expect(goalOf(s).required).toEqual(expect.arrayContaining(['quantity_frame', 'basis']));
    expect(constraintItemOf(s).required).toContain('role');
    const basis = (goalOf(s).properties.basis.anyOf as Rec[]).find((b) => b.type === 'object')!;
    expect(basis.required).toEqual(['reference', 'denominator', 'period_months', 'period_kind', 'effect_unit',
      'effects_at_period_end', 'also_required', 'open_question']);
  });

  it('a compaction retry pins the basis value by value, and pins "none" for a goal with no basis', () => {
    const goal = { metric: 'Productivity', operator: '>=', target_stated: true, value: 10, unit: '%', horizon_months: 3, provenance: 'explicit',
      frame: 'change_abs', quantity_frame: 'change', baseline_known: false, baseline_value: null, scope: null,
      basis: { reference: 'today', denominator: 'today’s productivity', period_months: 3, period_kind: 'at_end', effect_unit: '% per person',
        effects_at_period_end: true, also_required: ['code quality maintained'], open_question: null } } as unknown as CandidateModel['goal'];
    const pinned = goalOf(retrySchemaPinningGoal(goal) as Rec).properties;
    expect(pinned.quantity_frame.enum).toEqual(['change']);
    expect(pinned.basis.properties.denominator.enum).toEqual(['today’s productivity']);
    expect(pinned.basis.properties.period_months.enum).toEqual([3]);
    expect(pinned.basis.properties.effects_at_period_end.enum).toEqual([true]);
    expect(pinned.basis.properties.also_required).toMatchObject({ minItems: 1, maxItems: 1, items: { enum: ['code quality maintained'] } });
    expect(pinned.basis.properties.open_question).toEqual({ type: 'null' });
    const none = goalOf(retrySchemaPinningGoal({ ...goal, basis: undefined, quantity_frame: undefined } as never) as Rec).properties;
    expect(none.basis).toEqual({ type: 'null' });
    expect(none.quantity_frame.enum).toEqual(['level']);
  });

  it('the one Batch C instruction is present: change quantities, target semantics (ask, never pick), several targets', () => {
    expect(BUILD_INSTRUCTIONS).toContain('CHANGE QUANTITIES.');
    expect(BUILD_INSTRUCTIONS).toContain('TARGET SEMANTICS.');
    expect(BUILD_INSTRUCTIONS).toContain('SEVERAL TARGETS.');
    expect(BUILD_INSTRUCTIONS).toContain('never pick a reading');
    expect(BUILD_INSTRUCTIONS).toContain('including recruitment, notice and ramp-up');
    expect(BUILD_INSTRUCTIONS).toContain('never a month-end snapshot');
  });
});
