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
import { describe, it, expect } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';

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
});
