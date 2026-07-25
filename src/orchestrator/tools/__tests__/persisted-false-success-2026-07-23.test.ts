/**
 * REGRESSION PIN — the persisted false success of 2026-07-23.
 *
 * ── The incident, read out of the live staging database, not reconstructed ──
 *
 * Scenario `58b8610e-1009-4818-8773-9fdf155ed36a`, 2026-07-23T21:49:16Z.
 * User message, verbatim: **"Change the monthly cashflow factor to 0.42"**.
 *
 * `v5_handler_facts` recorded the turn as:
 *     { status: "applied", edit_kind: "parameter_update",
 *       safe_summary: "Updated Monthly Cash Flow Burden", operations_count: 1 }
 *
 * and the user was told, verbatim:
 *
 *   "Updated Monthly Cash Flow Burden factor value to 0.42. Rerun the analysis
 *    to reflect this change.
 *    Note: The current graph does not expose a stored numeric value field for
 *    Monthly Cash Flow Burden in the provided schema. The update has been
 *    applied to the expected data value path, but the old value could not be
 *    confirmed from the graph as provided."
 *
 * The node in `scenarios.graph` **today** still reads:
 *
 *   { id: "fac_monthly_cashflow", ..., "data/value": 0.42,
 *     observed_state: { value: 0.5, source: "cee_inference", ... } }
 *
 * `observed_state.value` is **0.5**. The 0.42 the user asked for is sitting on
 * the node as a dead root-level key that nothing reads. The edit was reported
 * applied and never happened — and the model's own note ("applied to the
 * expected data value path") is a verbatim narration of the defect.
 *
 * This was one of FOUR such false successes found by sweeping every persisted
 * graph for a root-level key containing "/". It is the freshest.
 *
 * ── What this file pins ─────────────────────────────────────────────────────
 *
 * The canonicalisation capability, shipped ON and unconditional, turns this
 * exact turn into a correct edit. RED before the change (`observed_state.value`
 * stayed 0.5 and `wasRejected` was false — a silent lie); GREEN after.
 *
 * ⚠ This is the acceptance test for the whole change. If it can pass with the
 * canonicaliser removed, the change has no justification — see the mutation
 * check recorded in CANONICALISATION-SHIP-ON-2026-07-25.md.
 */
import { describe, it, expect, vi } from 'vitest';

import { handleEditGraph } from '../edit-graph.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { ConversationContext } from '../../types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';

/**
 * The real node, copied from `scenarios.graph` for
 * `58b8610e-1009-4818-8773-9fdf155ed36a` — minus the `data/value` junk key,
 * which is what the graph looked like immediately BEFORE the defective turn.
 * Structural siblings (`category`, `provenance`, `display_value`) and the full
 * `observed_state` are kept verbatim so the merge behaviour is exercised on the
 * real shape rather than on a convenient one.
 */
function buildGraph() {
  return {
    nodes: [
      { id: 'dec_asset', kind: 'decision', label: 'Buy or lease the asset' },
      { id: 'opt_buy', kind: 'option', label: 'Buy Asset' },
      { id: 'opt_lease', kind: 'option', label: 'Lease Asset' },
      {
        id: 'fac_monthly_cashflow',
        kind: 'factor',
        label: 'Monthly Cash Flow Burden',
        category: 'controllable',
        provenance: 'ai_inferred',
        display_value: 'Moderate ongoing cash outflow',
        observed_state: {
          value: 0.5,
          source: 'cee_inference',
          factor_type: 'cost',
          extractionType: 'inferred',
          uncertainty_drivers: ['Not provided'],
        },
      },
      { id: 'out_net_profit', kind: 'goal', label: 'Net Profit Over Three Years' },
    ],
    // Real edge shapes from the same persisted graph.
    edges: [
      { from: 'dec_asset', to: 'opt_buy', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_asset', to: 'opt_lease', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_buy', to: 'fac_monthly_cashflow', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_lease', to: 'fac_monthly_cashflow', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_monthly_cashflow', to: 'out_net_profit', strength: { mean: -0.35, std: 0.1 }, exists_probability: 0.88, effect_direction: 'negative' },
    ],
  };
}

function buildContext(): ConversationContext {
  return {
    graph: buildGraph(),
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-58b8610e-repro',
  } as unknown as ConversationContext;
}

function makeAdapter(responseJson: unknown): LLMAdapter {
  return {
    name: 'fixtures',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(responseJson),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: 'test-model',
      latencyMs: 1,
      stopReason: 'end_turn',
    }),
  } as unknown as LLMAdapter;
}

/**
 * The op the SERVED edit prompt's PATH SYNTAX produces for this request.
 * `normalisePath` wraps `/nodes/<id>/data/value` into the LITERAL node-root key
 * `{ 'data/value': 0.42 }` — exactly the shape found persisted on the real node.
 */
const REAL_OP = {
  op: 'update_node',
  path: '/nodes/fac_monthly_cashflow/data/value',
  value: 0.42,
  old_value: null,
  impact: 'moderate',
  rationale: 'Set the monthly cashflow burden as requested.',
};

function nodeOf(graph: unknown): Record<string, unknown> {
  const nodes = (graph as { nodes: Array<Record<string, unknown>> }).nodes;
  return nodes.find((n) => n.id === 'fac_monthly_cashflow')!;
}

describe('persisted false success 2026-07-23 — "Change the monthly cashflow factor to 0.42"', () => {
  it('PREMISE — the pre-edit fixture is GraphV3-valid and reads 0.5 (guards against a vacuous test)', () => {
    const parsed = GraphV3.safeParse(buildGraph());
    expect(parsed.success).toBe(true);
    expect(nodeOf(buildGraph()).observed_state).toMatchObject({ value: 0.5 });
  });

  it('⭐ the persisted value MOVES to 0.42 (RED before this change: it stayed 0.5)', async () => {
    const result = await handleEditGraph(
      buildContext(),
      'Change the monthly cashflow factor to 0.42',
      makeAdapter({
        operations: [REAL_OP],
        removed_edges: [],
        warnings: [],
        coaching: { summary: 'Updated Monthly Cash Flow Burden.', rerun_recommended: true },
      }),
      'req-58b8610e',
      'turn-58b8610e',
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();

    const node = nodeOf(result.appliedGraph);
    const observed = node.observed_state as Record<string, unknown>;

    // THE ASSERTION THE LIVE PRODUCT FAILED ON 2026-07-23.
    expect(observed.value).toBe(0.42);

    // And the dead key that was persisted instead is gone.
    expect(node).not.toHaveProperty('data/value');
    expect(Object.keys(node).some((k) => k.includes('/'))).toBe(false);
  });

  it('the merge preserves every observed_state sibling the op never mentioned', async () => {
    const result = await handleEditGraph(
      buildContext(),
      'Change the monthly cashflow factor to 0.42',
      makeAdapter({
        operations: [REAL_OP],
        removed_edges: [],
        warnings: [],
        coaching: { summary: 'Updated Monthly Cash Flow Burden.', rerun_recommended: true },
      }),
      'req-58b8610e-sib',
      'turn-58b8610e-sib',
    );

    const observed = nodeOf(result.appliedGraph).observed_state as Record<string, unknown>;
    expect(observed.value).toBe(0.42);
    expect(observed.source).toBe('cee_inference');
    expect(observed.factor_type).toBe('cost');
    expect(observed.extractionType).toBe('inferred');
    expect(observed.uncertainty_drivers).toEqual(['Not provided']);
  });

  it('the node keeps its structural siblings (category / provenance / display_value)', async () => {
    const result = await handleEditGraph(
      buildContext(),
      'Change the monthly cashflow factor to 0.42',
      makeAdapter({
        operations: [REAL_OP],
        removed_edges: [],
        warnings: [],
        coaching: { summary: 'Updated Monthly Cash Flow Burden.', rerun_recommended: true },
      }),
      'req-58b8610e-struct',
      'turn-58b8610e-struct',
    );

    const node = nodeOf(result.appliedGraph);
    expect(node.category).toBe('controllable');
    expect(node.provenance).toBe('ai_inferred');
    expect(node.label).toBe('Monthly Cash Flow Burden');
  });
});
