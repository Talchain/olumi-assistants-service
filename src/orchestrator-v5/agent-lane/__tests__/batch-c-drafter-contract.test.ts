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
    // Batch C: ruling r1 item 5 — each condition is named for the retry; identity itself is enforced on adoption.
    expect(pinned.basis.properties.also_required.description).toBe('Exactly these conditions, each once: "code quality maintained".');
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

  it('AIE C drafter changeset (12 Oct): the three clauses are in the instruction VERBATIM, and the replaced wording is gone', () => {
    // 1. The additive hiring reading is a disclosed provisional assumption, never linear staffing as a fact.
    expect(BUILD_INSTRUCTIONS).toContain('For the provisional hiring calculation, use additive per-person effects at that horizon; '
      + 'this assumes no diminishing returns or additional onboarding interaction beyond the stated per-person estimate. '
      + 'Keep that assumption explicit rather than presenting linear scaling as a fact.');
    expect(BUILD_INSTRUCTIONS).not.toContain('two people are twice one person');
    // 2. Effect timing matches the target's period_kind (at the end vs over the period).
    expect(BUILD_INSTRUCTIONS).toContain('effects_at_period_end is true only when every incoming effect is sized for the selected '
      + 'period_kind: the effect at that month for at_end, or the cumulative count/period rate over the stated window for '
      + 'over_period, including relevant recruitment and ramp-up. Otherwise false. A deadline or period label alone does not '
      + 'establish the timing basis.');
    expect(BUILD_INSTRUCTIONS).not.toContain('effects_at_period_end true ONLY when every effect_amount into the goal is its size at the end');
    // 3. Each secondary target keeps its own frame, reference and period; an unsupported one is retained, never forced.
    expect(BUILD_INSTRUCTIONS).toContain('Give each its stated comparator and target frame by the same level/change rules; never force a '
      + 'change target into level. For the conversion/new-customer example both are level targets over the same first three '
      + 'months after launch, conversion>15% and new customers>=20. Preserve any distinct reference or period the user states; '
      + 'where this contract cannot represent or support it, retain the condition in also_required/unknowns with a focused '
      + 'clarification, rather than inventing a shared period or claiming the full conjunction.');
    expect(BUILD_INSTRUCTIONS).not.toContain('frame "level", the comparator exactly as written');
  });

  it('RED (AIE C handback 0149, lines 17–19): both percentage instructions distinguish a percentage LEVEL (points) from a % CHANGE goal, verbatim, in the first AND the retry request', () => {
    const LEVEL_VS_CHANGE = '(in percentage points when the target is a percentage level, so 4% to 3% is -1; for a goal measured as '
      + 'percentage change from today\'s level, use % of today\'s level as specified in CHANGE QUANTITIES, not percentage points)';
    const SCHEMA_WORDS = 'For a percentage-level target, use percentage points: 4% to 3% is -1. For a goal measured as percentage change '
      + 'from today\'s level, use % of today\'s level as specified in CHANGE QUANTITIES, not percentage points.';
    expect(BUILD_INSTRUCTIONS).toContain(`\`effect_amount\` is the signed change in the target’s own unit ${LEVEL_VS_CHANGE} caused by`);
    expect(BUILD_INSTRUCTIONS).not.toContain('(in points for a percentage, so 4% to 3% is -1)');
    // The controls stay: the percentage-level example, and the hiring percent-change clause it points to.
    expect(BUILD_INSTRUCTIONS).toContain('CHANGE QUANTITIES. When the goal is a percentage change of a quantity');
    const effectAmount = (schema: Rec): string => schema.properties.links.items.properties.effect_amount.description;
    const hiring = { metric: 'Productivity', operator: '>=', target_stated: true, value: 10, unit: '%', horizon_months: 3, provenance: 'explicit',
      frame: 'change_abs', quantity_frame: 'change', baseline_known: false, baseline_value: null, scope: null, basis: null } as unknown as CandidateModel['goal'];
    for (const [request, schema] of [['first', strictForTheDrafter(buildCandidateSchema())], ['retry', strictForTheDrafter(retrySchemaPinningGoal(hiring))]] as const) {
      expect(effectAmount(schema as Rec), request).toBe(`The signed change in the TARGET’s own unit that \`effect_per_source_change\` of the source causes. ${SCHEMA_WORDS} null when you cannot give a defensible size.`);
      expect(effectAmount(schema as Rec), request).not.toContain('For a percentage target, in points');
    }
  });

  it('RED (AIE request check): a pinned retry keeps an EVENT goal\'s kind and deliverable, and never adds them to a quantity goal', () => {
    const event = { metric: 'Platform completion', operator: '>=', target_stated: false, value: null, unit: '%', horizon_months: null,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
      kind: 'event_by_date', deliverable: 'new platform' } as unknown as CandidateModel['goal'];
    const pinned = goalOf(strictForTheDrafter(retrySchemaPinningGoal(event)) as Rec);
    expect(pinned.properties.kind).toEqual({ type: 'string', enum: ['event_by_date'] });
    expect(pinned.properties.deliverable).toEqual({ type: 'string', enum: ['new platform'] });
    expect(pinned.required).toEqual(expect.arrayContaining(['kind', 'deliverable']));
    const quantity = { ...event, kind: null, deliverable: null, metric: 'MRR', unit: 'GBP/month' } as unknown as CandidateModel['goal'];
    const q = goalOf(strictForTheDrafter(retrySchemaPinningGoal(quantity)) as Rec).properties;
    expect(q.kind).toEqual({ type: 'null' });
    expect(q.deliverable).toEqual({ type: 'null' });
  });
});

