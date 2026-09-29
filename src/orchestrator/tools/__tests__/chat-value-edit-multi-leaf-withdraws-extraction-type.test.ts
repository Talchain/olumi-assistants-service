/**
 * #1740 (N3, mutant R3) — a MULTI-LEAF chat value edit withdraws the
 * producer's `extractionType`, WHICHEVER ORDER the leaves arrive in.
 *
 * ── Why the single-leaf spec cannot see this ─────────────────────────────
 * `canonicaliseValueOps` merges the node's STORED observed_state under every
 * translated leaf, so a `unit` or `std` leaf op carries the stored
 * `extractionType: 'inferred'` forward. The local applier REPLACES
 * `observed_state` wholesale on each `update_node`, so the LAST op on the
 * target decides what is stored.
 *
 *   value → unit → std : the value op is FIRST. The two later leaf ops are
 *                        stamped only because `userValueTargets` remembers the
 *                        value write — and they reach the store LAST. If the
 *                        withdrawal were keyed on `writesValue` (the op itself
 *                        authors the value) instead of on the stamp, those
 *                        later ops would put the marker straight back.
 *   std → unit → value : the value op is LAST, so it decides alone.
 *
 * Both orders go through the REAL `handleEditGraph` (canonicalise → stamp →
 * applier → GraphV3 parse), and the assertion is on the applied graph — the
 * graph that is persisted — not on an intermediate op.
 *
 * Rule: a user-authored value withdraws the producer's extraction marker
 * (23 Sep witness; #1740).
 */
import { describe, it, expect, vi } from 'vitest';

import { handleEditGraph } from '../edit-graph.js';
import type { ConversationContext } from '../../types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';

function buildGraph() {
  return {
    nodes: [
      { id: 'dec_asset', kind: 'decision', label: 'Buy or lease the asset' },
      { id: 'opt_buy', kind: 'option', label: 'Buy Asset' },
      {
        id: 'fac_monthly_cashflow',
        kind: 'factor',
        label: 'Monthly Cash Flow Burden',
        category: 'controllable',
        observed_state: {
          value: 0.5,
          source: 'cee_inference',
          factor_type: 'cost',
          extractionType: 'inferred',
        },
      },
      // Identity-bound control: an untouched sibling keeps its producer marker,
      // so the assertions below cannot pass by a sweep that strips every node.
      {
        id: 'fac_churn',
        kind: 'factor',
        label: 'Customer churn',
        category: 'external',
        observed_state: { value: 0.2, source: 'cee_inference', extractionType: 'inferred' },
      },
      { id: 'out_net_profit', kind: 'goal', label: 'Net Profit Over Three Years' },
    ],
    edges: [
      { from: 'dec_asset', to: 'opt_buy', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_buy', to: 'fac_monthly_cashflow', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_monthly_cashflow', to: 'out_net_profit', strength: { mean: -0.35, std: 0.1 }, exists_probability: 0.88, effect_direction: 'negative' },
      { from: 'fac_churn', to: 'out_net_profit', strength: { mean: -0.2, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
    ],
  };
}

function buildContext(): ConversationContext {
  return {
    graph: buildGraph(),
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-1740-multi-leaf',
  } as unknown as ConversationContext;
}

function makeAdapter(operations: unknown[]): LLMAdapter {
  return {
    name: 'fixtures',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        operations,
        removed_edges: [],
        warnings: [],
        coaching: { summary: 'Updated Monthly Cash Flow Burden.', rerun_recommended: true },
      }),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: 'test-model',
      latencyMs: 1,
      stopReason: 'end_turn',
    }),
  } as unknown as LLMAdapter;
}

const TARGET = 'fac_monthly_cashflow';
const VALUE_LEAF = { op: 'update_node', path: `/nodes/${TARGET}/data/value`, value: 0.42 };
const UNIT_LEAF = { op: 'update_node', path: `/nodes/${TARGET}/data/unit`, value: 'USD' };
const STD_LEAF = { op: 'update_node', path: `/nodes/${TARGET}/data/std`, value: 0.2 };

function nodeOf(graph: unknown, id: string): Record<string, unknown> {
  const node = (graph as { nodes: Array<Record<string, unknown>> }).nodes.find((n) => n.id === id);
  if (!node) throw new Error(`node ${id} missing from the applied graph`);
  return node;
}

describe('#1740 R3 — a multi-leaf chat value edit withdraws extractionType in either leaf order', () => {
  it.each([
    ['value → unit → std (value op FIRST; later leaf ops are stamped via the batch memory)', [VALUE_LEAF, UNIT_LEAF, STD_LEAF]],
    ['std → unit → value (value op LAST)', [STD_LEAF, UNIT_LEAF, VALUE_LEAF]],
  ])('%s', async (_label, operations) => {
    const result = await handleEditGraph(
      buildContext(),
      'Set the monthly cashflow factor to 0.42 USD with a spread of 0.2',
      makeAdapter(operations),
      'req-1740-multi-leaf',
      'turn-1740-multi-leaf',
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();

    const observed = nodeOf(result.appliedGraph, TARGET).observed_state as Record<string, unknown>;
    // PREMISE — every leaf landed, so this is the multi-leaf write, not a
    // partial one that happened to leave the value op last.
    expect(observed.value).toBe(0.42);
    expect(observed.unit).toBe('USD');
    expect(observed.std).toBe(0.2);
    expect(observed.source).toBe('user_override');

    // THE RULE — a user-authored value withdraws the producer's extraction
    // marker (23 Sep witness; #1740), whichever leaf reached the store last.
    expect('extractionType' in observed).toBe(false);
    // Siblings the ops never mentioned are still preserved.
    expect(observed.factor_type).toBe('cost');

    // CONTROL — the untouched sibling keeps the producer's marker.
    const sibling = nodeOf(result.appliedGraph, 'fac_churn').observed_state as Record<string, unknown>;
    expect(sibling.extractionType).toBe('inferred');
    expect(sibling.source).toBe('cee_inference');
  });
});
