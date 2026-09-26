/**
 * Two more findings from the adversarial audit of this lane.
 *
 * (a) THE GOAL WAS BEING REDUCED TO A BARE NUMBER. Only `goal_threshold` was
 *     written: the unit, the operator and `horizon_months` were all dropped with
 *     no ledger entry. `goal_threshold: 20000` with no unit, no operator and no
 *     horizon is indistinguishable from a cost cap of 20000 with no deadline.
 *     Canonical homes exist for two of them — `goal_threshold_unit`
 *     (`cee-v3.ts:210`) and `goal_threshold_frame` (`cee-v3.ts:246`, whose
 *     contract says a consumer must produce NO goal probability when it is
 *     absent). `horizon_months` has no GraphV3 home at all, so the ledger is the
 *     only place it can survive.
 *
 * (b) `inferred` (the builder's inference from the brief) and `ai_proposed` (the
 *     widener's addition beyond it) collapsed to one value with no record. W3 is
 *     meant to score *unsupported inference*, which needs them distinguishable.
 *
 *     ⚠ They are NOT split across `source` values. `domain_knowledge` exists on
 *     `EdgeProvenanceV3` but `src/schemas/analysis-ready.ts:41` and the node and
 *     option provenance schemas (`cee-v3.ts:560`, `:590`) declare a NARROWER
 *     enum without it — so stamping it risks a cross-schema validation failure
 *     for a cosmetic gain. The distinction is carried in `reasoning`, which is on
 *     the same object and is passthrough-safe.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';

const d = new URL('./fixtures/', import.meta.url);
const faithful = JSON.parse(readFileSync(new URL('faithful.json', d), 'utf8')) as CandidateModel;
const widened = JSON.parse(readFileSync(new URL('widened.json', d), 'utf8'));
const admitted = () => admitCandidateModel(faithful, widened);

describe('goal fidelity', () => {
  it('the capture really carries all three (control on the fixture)', () => {
    expect(faithful.goal.value).toBe(20000);
    expect(faithful.goal.unit).toBe('£');
    expect(faithful.goal.operator).toBe('>=');
    expect(faithful.goal.horizon_months).toBe(12);
  });

  it('stamps the goal unit and the frame the contract calls load-bearing', () => {
    const goal = admitted().nodes.find((n) => n.kind === 'goal');
    // `goal_threshold` is NORMALISED (raw / cap); the stated number is `_raw`.
    expect(goal?.goal_threshold).toBeCloseTo(0.8, 10);
    // Declared fields, read directly — the cast disabled property-name checking.
    expect(goal?.goal_threshold_raw).toBe(20000);
    expect(goal?.goal_threshold_unit).toBe('£');
    expect(goal?.goal_threshold_frame).toBe('level');
  });

  it('records the horizon it cannot represent, rather than dropping it silently', () => {
    const loss = admitted().loss;
    const horizon = loss.find((l) => l.field_path.includes('horizon_months'));
    expect(horizon, 'a 12-month deadline has no GraphV3 home and must be ledgered').toBeDefined();
    expect(horizon!.before).toBe(12);
    expect(horizon!.severity).toBe('warn');
  });

  // The operator is never dropped silently: the USER'S goal carries its sense on the
  // node (`goal_direction`, forwarded to PLoT), and a goal that is not theirs, which is
  // not stamped, still records the operator as a loss. Both halves, one fixture.
  it('carries the sense of the user\'s goal operator on the goal node, and records no loss for it', () => {
    const m = admitted();
    const goal = m.nodes.find((n) => n.kind === 'goal');
    expect(faithful.goal.provenance, 'control: the fixture goal is the user\'s').toBe('explicit');
    expect(goal?.goal_direction).toBe('maximise');
    expect(m.loss.find((l) => l.field_path.includes('goal') && l.field_path.includes('operator'))).toBeUndefined();
  });

  it('records the goal operator it cannot represent when the goal is not the user\'s', () => {
    const inferred = { ...faithful, goal: { ...faithful.goal, provenance: 'inferred' } } as CandidateModel;
    const m = admitCandidateModel(inferred, widened);
    const op = m.loss.find((l) => l.field_path.includes('goal') && l.field_path.includes('operator'));
    expect(op, 'a goal with no operator is not a goal').toBeDefined();
    expect(op!.before).toBe('>=');
    expect(m.nodes.find((n) => n.kind === 'goal')).not.toHaveProperty('goal_direction');
  });
});

describe('inference class survives', () => {
  it('a widener addition is distinguishable from a builder inference', () => {
    const m = admitted();
    const wideneradded = widened.proposed_factors[0].label as string;
    const builderInferred = faithful.risks.find((r) => r.provenance === 'inferred')?.label
      ?? faithful.options.find((o) => o.provenance === 'inferred')!.label;
    // Labels may have been shortened to stay editable, so resolve on the full
    // text where one was kept.
    const nodeFor = (label: string) => m.nodes.find((n) => (n.description ?? n.label) === label)!;
    const idOf = (label: string) => nodeFor(label).id;

    // The node DISPLAY enum collapses both to 'ai_inferred' — it cannot carry this.
    expect(nodeFor(wideneradded).provenance).toBe('ai_inferred');
    expect(nodeFor(builderInferred).provenance).toBe('ai_inferred');

    // The class rides beside the graph instead, where W3 can score it.
    expect(m.inference_classes[idOf(wideneradded)]).toBe('model_proposed');
    expect(m.inference_classes[idOf(builderInferred)]).toBe('builder_inferred');
  });

  it('a brief-stated entity says so too', () => {
    const m = admitted();
    const price = m.nodes.find((n) => n.label === 'Pro plan price')!;
    expect(price.provenance).toBe('from_brief');
    expect(m.inference_classes[price.id]).toBe('brief_stated');
    // The DURABLE value authorship, which the money invariant reads.
    // `observed_state` declares `source`, so read it — the cast hid whether the
    // property name was even real, on the one assertion that distinguishes a
    // user-stated value from a machine-authored one.
    expect(price.observed_state?.source).toBe('brief_extraction');
  });
});
