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

  it('confirm_current + the same value is review', async () => {
    await expectReview({ intent: 'confirm_current', value: 3.2 });
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
