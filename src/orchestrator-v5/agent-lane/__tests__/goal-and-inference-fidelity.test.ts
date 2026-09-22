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
    expect((goal as Record<string, unknown>).goal_threshold_raw).toBe(20000);
    expect((goal as Record<string, unknown>).goal_threshold_unit).toBe('£');
    expect((goal as Record<string, unknown>).goal_threshold_frame).toBe('level');
  });

  it('records the horizon it cannot represent, rather than dropping it silently', () => {
    const loss = admitted().loss;
    const horizon = loss.find((l) => l.field_path.includes('horizon_months'));
    expect(horizon, 'a 12-month deadline has no GraphV3 home and must be ledgered').toBeDefined();
    expect(horizon!.before).toBe(12);
    expect(horizon!.severity).toBe('warn');
  });

  it('records the goal operator it cannot represent', () => {
    const op = admitted().loss.find((l) => l.field_path.includes('goal') && l.field_path.includes('operator'));
    expect(op, 'a goal with no operator is not a goal').toBeDefined();
    expect(op!.before).toBe('>=');
  });
});

describe('inference class survives', () => {
  it('a widener addition is distinguishable from a builder inference', () => {
    const m = admitted();
    const wideneradded = widened.proposed_factors[0].label as string;
    const builderInferred = faithful.risks.find((r) => r.provenance === 'inferred')?.label
      ?? faithful.options.find((o) => o.provenance === 'inferred')!.label;
    const idOf = (label: string) => m.nodes.find((n) => n.label === label)!.id;

    // The node DISPLAY enum collapses both to 'ai_inferred' — it cannot carry this.
    expect(m.nodes.find((n) => n.label === wideneradded)!.provenance).toBe('ai_inferred');
    expect(m.nodes.find((n) => n.label === builderInferred)!.provenance).toBe('ai_inferred');

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
    expect((price.observed_state as Record<string, unknown>).source).toBe('brief_extraction');
  });
});
