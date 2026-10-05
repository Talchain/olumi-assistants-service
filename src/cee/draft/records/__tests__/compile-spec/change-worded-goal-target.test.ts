/**
 * ⛔ CHANGE-WORDED TARGET (DL, 5 Oct 2026; R1 S1).
 *
 * A v-next goal item cannot type a change (`setting: "change_by"` is option-only), and the records compile wrote every
 * goal target as a LEVEL (`goal_threshold_frame` is the code constant `'level'`). So "reduce costs by at most 10%" on a
 * £ cost quantity was stored as a held `<=` level threshold — and `canonicalQuantityUnits` re-units the item to its
 * quantity's unit first, so the stored target read "at most £10 a month" of cost. A reader that minimises a held
 * ceiling on a level frame would then minimise cost against a figure the user never gave.
 *
 * The rule: when the goal target's own `unit` is not `sameUnit` with the unit its quantity's declaring item states, the
 * compile writes NO level threshold, NO `goal_direction` and NO `goal_sense_reading`, and asks (change from today, or a
 * level?). No words are read: the evidence is the two typed units.
 *
 * (a) and (c) run the records compile chain the served constructor calls (`replayRecordSet`: seam → projector →
 * completion ask → repair); (b) runs the served constructor itself (`buildModelFromRecords`) on the sealed ideal.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { replayRecordSet } from '../../replay.js';
import { changeWordedGoalTargets } from '../../projector.js';
import type { DraftRecordSet } from '../../grammar.js';
import { buildModelFromRecords } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { strictRecordsWire } from '../../../../../orchestrator-v5/agent-lane/__tests__/records-wire-fixture.js';
import { BRIEF as SEALED_BRIEF, sealedRecordsVNextLinked } from './sealed-fixture-vnext.js';

type Json = Record<string, any>;
const FRAME_ASK = 'whether its target is a change from today or a level';

/** (a) a £ cost quantity; the goal's target is "10%". Hand-typed records, each literal located in its own quote. */
const COST_BRIEF = 'Our cloud costs are £45,000 a month. We want to reduce costs by at most 10%. We could move to Azure or stay on AWS.';
function costRecords(): DraftRecordSet {
  return { stated_items: [
    { kind: 'figure', source_quote: 'Our cloud costs are £45,000 a month', value: 45000, value_literal: '£45,000', unit: '£/month',
      unit_literals: ['a month'], role: 'baseline', quantity: 0 },
    { kind: 'goal', source_quote: 'We want to reduce costs by at most 10%', value: 10, value_literal: '10%', unit: '%',
      direction: 'ceiling', direction_literal: 'at most', role: 'target', quantity: 0, baseline_ref: 0 },
    { kind: 'option', source_quote: 'move to Azure' },
    { kind: 'option', source_quote: 'stay on AWS' },
  ], claims: [] } as DraftRecordSet;
}

/** (c) a % churn quantity; the goal's target is "3%": the same unit, so a level. */
const CHURN_BRIEF = 'Our monthly churn is 5%. We want to bring churn to at most 3%. We could add onboarding calls or keep things as they are.';
function churnRecords(): DraftRecordSet {
  return { stated_items: [
    { kind: 'figure', source_quote: 'Our monthly churn is 5%', value: 5, value_literal: '5%', unit: '%', role: 'baseline', quantity: 0 },
    { kind: 'goal', source_quote: 'We want to bring churn to at most 3%', value: 3, value_literal: '3%', unit: '%',
      direction: 'ceiling', direction_literal: 'at most', role: 'target', quantity: 0, baseline_ref: 0 },
    { kind: 'option', source_quote: 'add onboarding calls' },
    { kind: 'option', source_quote: 'keep things as they are' },
  ], claims: [] } as DraftRecordSet;
}

async function compiled(records: DraftRecordSet, brief: string) {
  const out = await replayRecordSet(records, { brief });
  if (!out.ok) throw new Error(`compile refused: ${out.reason} ${out.detail ?? ''}`);
  const goal = (out.projection.graph.nodes as unknown as Json[]).find(n => n.kind === 'goal')!;
  return { out, goal };
}

describe('CHANGE-WORDED TARGET (a): a % target on a £ quantity is asked about, never written as a level', () => {
  it('the rule names exactly the goal item (typed units only)', () => {
    expect([...changeWordedGoalTargets(costRecords())]).toEqual([1]);
  });
  it('no level threshold, no comparator, no sense on the goal node', async () => {
    const { goal } = await compiled(costRecords(), COST_BRIEF);
    for (const key of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_unit', 'goal_threshold_cap', 'goal_threshold_frame',
      'threshold_source', 'goal_direction', 'goal_sense_reading']) expect(goal, key).not.toHaveProperty(key);
  });
  it('an ask is present: a typed disclosure, an asked receipt row and one question naming the goal by its own words', async () => {
    const { out } = await compiled(costRecords(), COST_BRIEF);
    const quote = costRecords().stated_items[1]!.source_quote;
    expect(out.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 1, reason: 'goal_target_frame_unresolved', label: quote }));
    expect(out.projection.stated_dispositions?.find(d => d.stated_index === 1))
      .toMatchObject({ disposition: 'asked', reason: 'goal_target_frame_unresolved', stated_item: { value: 10, unit: '%', direction: 'ceiling' } });
    const questions = out.ask.items.filter(i => i.kind === 'stated_link_unresolved')
      .map(i => i.detail).filter(d => d.includes(`"${quote}"`));
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain(FRAME_ASK);
  });
});

describe('CHANGE-WORDED TARGET (b) CONTRAST: the sealed "reach at least £150,000" on £ MRR is untouched', () => {
  it('the rule names nothing in the sealed ideal', () => {
    expect(changeWordedGoalTargets(sealedRecordsVNextLinked()).size).toBe(0);
  });
  it('through the served constructor: its level threshold and held ">=" are kept; no frame ask; registered graph pinned', async () => {
    let body: Json | undefined;
    const result: Json = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', SEALED_BRIEF,
      async (path, b) => { if (path.endsWith('/register')) { body = b as Json; return { status: 200, json: { model_version: 1 } }; } return { status: 200, json: { graph: { nodes: [], edges: [] } } }; },
      async () => ({ text: JSON.stringify(strictRecordsWire(sealedRecordsVNextLinked())), status: 'completed' }));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const goal = (body!.graph.nodes as Json[]).find(n => n.kind === 'goal')!;
    expect(goal).toMatchObject({ goal_threshold_raw: 150000, goal_threshold_unit: '£/month', goal_threshold_frame: 'level', goal_direction: '>=' });
    expect((result.not_represented as Json[]).some(d => d.reason === 'goal_target_frame_unresolved')).toBe(false);
    // Byte-identical to the head before this rule (1647abd8): pinned at GO, and the rule-off mutant must keep it.
    expect(createHash('sha256').update(JSON.stringify(body!.graph)).digest('hex')).toBe('093cc9ecbe48a7b3783fe7ad5205c7df4d3f8f46f526947021a455f4f74c49b6');
  });
});

describe('CHANGE-WORDED TARGET (c) CONTRAST: a % quantity with a % target stays a level', () => {
  it('the rule names nothing; the goal keeps its level threshold, its held "<=" and its typed sense; no frame ask', async () => {
    expect(changeWordedGoalTargets(churnRecords()).size).toBe(0);
    const { out, goal } = await compiled(churnRecords(), CHURN_BRIEF);
    expect(goal).toMatchObject({ goal_threshold_raw: 3, goal_threshold_unit: '%', goal_threshold_frame: 'level', goal_direction: '<=',
      goal_sense_reading: { sense: 'minimise', basis: 'typed_comparator' } });
    expect(out.projection.dropped.some(d => d.reason === 'goal_target_frame_unresolved')).toBe(false);
  });
});
