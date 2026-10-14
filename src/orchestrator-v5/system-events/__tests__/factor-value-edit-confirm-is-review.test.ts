/**
 * Shared Data row 1 (Canonical #72 5881225605) — a canvas "confirm as-is" is REVIEW, not authorship (AIQ #72 5881277231:
 * R11 extends to nodes). The intent rule (AIQ 5881405845, DL 5881485082 — compare against the PERSISTED value), through
 * the REAL writer (`applyFactorValueEdit`) and the REAL analysis hash:
 *   · absent  + the same value → review: `source` kept, `reviewed_by_user` added, analysis hash IDENTICAL, no facts;
 *   · absent  + a different value → a set: `user_override`, the hash MOVES (the Run goes stale);
 *   · `set`   + the same value → authorship: `user_override`, the hash MOVES;
 *   · `confirm_current` + the same value → review; + a different value → REFUSED, never turned into a set.
 * Mutant (run by hand): the absent+same branch writing `user_override` turns the first row RED.
 * Served shape: journey A's churn (capless percent; value 0.032 / raw 3.2 %, `cee_inference`), live on 0938f068.
 */
import { describe, expect, it } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyFactorValueEdit } from '../factor-value-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';

const SCENARIO_ID = '0938f068-2b83-4a77-9b47-def252ac03f0';
const TARGET = 'monthly_churn';

function servedGraph(): Record<string, unknown> {
  return {
    goal_node_id: 'mrr',
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: TARGET, kind: 'factor', label: 'Monthly churn', provenance: 'ai_inferred',
        observed_state: { unit: '%', value: 0.032, source: 'cee_inference', raw_value: 3.2, extractionType: 'inferred' } },
      { id: 'o-hold', kind: 'option', label: 'Hold price' },
    ],
    edges: [
      { from: TARGET, to: 'mrr', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  };
}

function edit(event: Record<string, unknown>, persistedGraph: unknown) {
  const payload = { kind: 'system_event', scenario_id: SCENARIO_ID, turn_id: '77777777-7777-4777-8777-777777777777', stage: 'analyse',
    event: { kind: 'factor_value_edit', target_id: TARGET, field: 'value', ...event } } as unknown as SystemEventTurnPayload;
  return applyFactorValueEdit({ payload, event: payload.event as never, requestId: 'req-confirm', persistedGraph, priorFacts: [] } as never);
}

const nodeOf = (g: unknown) => (g as { nodes: Array<{ id: string; observed_state?: Record<string, unknown> }> }).nodes.find((n) => n.id === TARGET)!;
const hash = (g: unknown) => computeAnalysisAffectingGraphHash(g as never);

describe('factor_value_edit — a confirm is review, a typed figure is authorship', () => {
  // A review is written by the SINGLE writer of observed_state (set_factor_value's R11 `reviewOnly`): whose it is stays,
  // `reviewed_by_user` is recorded, the analysis hash is identical, and the receipt is the ordinary "already set" no-op.
  async function expectReview(event: Record<string, unknown>) {
    const base = servedGraph();
    const r = await edit(event, base);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const os = nodeOf(r.mutatedGraph).observed_state!;
    expect(os.source).toBe('cee_inference');
    expect(os.value).toBe(0.032);
    expect(os.raw_value).toBe(3.2);
    expect((os.reviewed_by_user as { intent: string }).intent).toBe('confirm');
    expect(Number.isNaN(Date.parse((os.reviewed_by_user as { at: string }).at))).toBe(false);
    expect(hash(r.mutatedGraph)).toBe(hash(base));
    expect(r.handlerFacts.map((f) => (f as { noop?: boolean }).noop)).toEqual([true]);
    expect(r.response.assistant_text).toMatch(/already set to 3\.2%/);
  }

  async function expectAuthorship(event: Record<string, unknown>) {
    const base = servedGraph();
    const r = await edit(event, base);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(nodeOf(r.mutatedGraph).observed_state!.source).toBe('user_override');
    expect(nodeOf(r.mutatedGraph).observed_state!.reviewed_by_user).toBeUndefined();
    expect(hash(r.mutatedGraph)).not.toBe(hash(base));
  }

  it('absent intent + the SAME persisted value (today\'s canvas confirm) is review: source kept, hash IDENTICAL', async () => {
    await expectReview({ value: 3.2 });
  });

  // RE-PINNED (SD-1, Codex #2617 r1): this row sent the bare user-unit figure (`value: 3.2`, no raw, no unit) — the
  // alias that also let `{value:.1}` ratify a stored `{.2, raw .1}`. It now sends what DGAI's Confirm sends for this
  // stored shape (the set builder on the shown 3.2 %); the bare alias is refused below.
  it('confirm_current + the same value is review', async () => {
    await expectReview({ intent: 'confirm_current', value: 3.2, raw_value: 3.2, unit: '%' });
  });

  it('absent intent + a DIFFERENT value is a set: user_override, and the hash MOVES', async () => {
    await expectAuthorship({ value: 3.5 });
  });

  it('explicit set + the SAME value is authorship: user_override, and the hash MOVES', async () => {
    await expectAuthorship({ intent: 'set', value: 3.2 });
  });

  it('confirm_current that would MOVE the value is refused, never turned into a set', async () => {
    const r = await edit({ intent: 'confirm_current', value: 3.5 }, servedGraph());
    expect(r.kind).toBe('refused');
    if (r.kind === 'refused') expect(r.reason).toBe('confirm_value_moved');
  });

  it('confirm_current with a £1 move on £1,234,565,000 is REFUSED (near-exact, never the scale tolerance)', async () => {
    const base = servedGraph() as { nodes: Array<Record<string, unknown>> };
    base.nodes[1]!.observed_state = { unit: '£', value: 1234564999, source: 'cee_inference' };
    const r = await edit({ intent: 'confirm_current', value: 1234565000, unit: '£' }, base);
    expect(r.kind).toBe('refused');
    if (r.kind === 'refused') expect(r.reason).toBe('confirm_value_moved');
  });

  it('the same value that is ALREADY the user\'s stays the user\'s: hash identical, no-op receipt', async () => {
    const base = servedGraph() as { nodes: Array<Record<string, unknown>> };
    (base.nodes[1]!.observed_state as Record<string, unknown>).source = 'user_override';
    const r = await edit({ value: 3.2 }, base);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(nodeOf(r.mutatedGraph).observed_state!.source).toBe('user_override');
    expect(hash(r.mutatedGraph)).toBe(hash(base));
    expect(r.response.assistant_text).toMatch(/already set to 3\.2%/);
  });

  it('a collaborator\'s £1 move on £1,234,565,000 is an EDIT, never swallowed as a review', async () => {
    const base = servedGraph() as { nodes: Array<Record<string, unknown>> };
    base.nodes[1]!.observed_state = { unit: '£', value: 1234564999, source: 'cee_inference' };
    const r = await edit({ value: 1234565000, unit: '£' }, base);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(nodeOf(r.mutatedGraph).observed_state!.value).toBe(1234565000);
    expect(nodeOf(r.mutatedGraph).observed_state!.source).toBe('user_override');
    expect(nodeOf(r.mutatedGraph).observed_state!.reviewed_by_user).toBeUndefined();
  });
});

/**
 * ⭐⭐ SD-1 (domain 2, github-07; DL 0df0e1 6 Oct, conditions 1-3; Codex buddy on DGAI #2543 r1): A CONFIRM IS A REVIEW OF
 * THE PERSISTED FIGURE, NEVER A SET. Each row is the event DGAI's Confirm sends for that stored shape (the SET builder on
 * the shown number: `raw_value` when stored, else `value`). Before the fix the first three fell through to a SET
 * (`user_override`) or were refused. Mutant (run by hand): the early `confirm_current` branch skipped → rows 1-3 RED.
 */
describe('factor_value_edit confirm_current: review of the persisted figure, by one rule, on every stored shape', () => {
  function withFactor(observed: Record<string, unknown>) {
    const base = servedGraph() as { nodes: Array<Record<string, unknown>> };
    base.nodes[1]!.observed_state = observed;
    return base;
  }
  async function expectKeptAndReviewed(observed: Record<string, unknown>, event: Record<string, unknown>) {
    const base = withFactor(observed);
    const r = await edit({ intent: 'confirm_current', ...event }, base);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const { reviewed_by_user: review, ...kept } = nodeOf(r.mutatedGraph).observed_state!;
    expect(kept).toEqual(observed);
    expect((review as { intent: string }).intent).toBe('confirm');
    // Condition 3: the Run stays current (analysis hash identical); identity moves (the review is persisted).
    expect(hash(r.mutatedGraph)).toBe(hash(base));
    expect(computeGraphIdentityHash(r.mutatedGraph as never)!.value).not.toBe(computeGraphIdentityHash(base as never)!.value);
    expect(r.handlerFacts.map((f) => (f as { noop?: boolean }).noop)).toEqual([true]);
  }

  it('1. value-only factor: no raw_value is added, source kept, reviewed', async () => {
    await expectKeptAndReviewed({ value: 0.1, source: 'cee_inference' }, { value: 0.1 });
  });

  it('2. capped float drift (.3 / 3 = .0999…): the stored .1 is kept byte for byte, reviewed', async () => {
    await expectKeptAndReviewed(
      { value: 0.1, raw_value: 0.3, cap: 3, unit: 'days', source: 'cee_inference' },
      { value: 0.3 / 3, raw_value: 0.3, unit: 'days' },
    );
  });

  it('r2: a stored BLANK unit is no unit — DGAI omits it, and the confirm is reviewed', async () => {
    await expectKeptAndReviewed({ value: 0.1, raw_value: 0.1, unit: '', source: 'cee_inference' }, { value: 0.1, raw_value: 0.1 });
  });

  it('3. equal-pair percent (3.2 / 3.2 / %): reviewed, not refused as a scale change', async () => {
    await expectKeptAndReviewed(
      { value: 3.2, raw_value: 3.2, unit: '%', source: 'cee_inference' },
      { value: 3.2, raw_value: 3.2, unit: '%' },
    );
  });

  it('the served churn shape in DGAI\'s own form (value 3.2, raw 3.2, %): reviewed', async () => {
    await expectKeptAndReviewed(
      { unit: '%', value: 0.032, source: 'cee_inference', raw_value: 3.2, extractionType: 'inferred' },
      { value: 3.2, raw_value: 3.2, unit: '%' },
    );
  });

  it.each([
    ['a moved value-only figure', { value: 0.1, source: 'cee_inference' }, { value: 0.2 }],
    ['a moved raw beside a matching value', { unit: '%', value: 0.032, source: 'cee_inference', raw_value: 3.2 }, { value: 0.032, raw_value: 3.5 }],
    ['another unit', { unit: '%', value: 0.032, source: 'cee_inference', raw_value: 3.2 }, { value: 3.2, raw_value: 3.2, unit: '£' }],
    ['r1: a bare value equal to the stored RAW of a different model value', { value: 0.2, raw_value: 0.1, cap: 0.5, source: 'cee_inference' }, { value: 0.1 }],
    ['r1: the user-unit form without the stored unit', { unit: '%', value: 0.032, source: 'cee_inference', raw_value: 3.2 }, { value: 3.2, raw_value: 3.2 }],
    ['the bare user-unit alias (no raw, no unit) on a stored percent', { unit: '%', value: 0.032, source: 'cee_inference', raw_value: 3.2 }, { value: 3.2 }],
  ])('REFUSED as confirm_value_moved, nothing written: %s', async (_name, observed, event) => {
    const r = await edit({ intent: 'confirm_current', ...event }, withFactor(observed));
    expect(r.kind).toBe('refused');
    if (r.kind === 'refused') expect(r.reason).toBe('confirm_value_moved');
  });

  it('r1: a GOAL node carrying an observed_state is never stamped by a confirm (factor-only)', async () => {
    const base = servedGraph() as { nodes: Array<Record<string, unknown>> };
    base.nodes[0]!.observed_state = { value: 0.5, source: 'cee_inference' };
    const r = await edit({ intent: 'confirm_current', value: 0.5, target_id: 'mrr' }, base);
    expect(r.kind).toBe('refused');
    if (r.kind === 'refused') expect(r.reason).toBe('confirm_not_a_factor');
  });

  it('CONTRAST: the user\'s own figure keeps its bytes and gains no review (reviewOnly\'s rule)', async () => {
    const observed = { value: 0.1, source: 'user_override' };
    const r = await edit({ intent: 'confirm_current', value: 0.1 }, withFactor(observed));
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(nodeOf(r.mutatedGraph).observed_state).toEqual(observed);
  });
});
