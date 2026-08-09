/**
 * ROADMAP 2.1033 — the SERVER half of "screen = commit".
 *
 * ── The defect, reproduced by EXECUTION at pristine 1ff2469d ───────────────
 * `canonicaliseValueOps` merges the node's existing `observed_state` under a
 * value write so `unit`/`cap` siblings survive. That merge also carried
 * `raw_value` forward — and `raw_value` is the field
 * `synthesiseDisplayValue` reads FIRST (display-value.ts: priorities 1–4 are
 * unreachable-past only when `raw_value` is absent). Editing a 20% factor to
 * 40% therefore committed:
 *
 *   applied observed_state = { value: 0.4, raw_value: 20, unit: '%' }
 *   synthesiseDisplayValue(...)             → "20%"   ← the OLD number
 *   reconcileDisplayAnchors(...) repaired[] → []      ← it AGREED with it
 *
 * The second line is the one that matters. #884's display-anchor
 * reconciliation is not bypassed here — it runs, recomputes the anchor from
 * the same stale `raw_value`, gets "20%" back, and concludes nothing needs
 * repair. A correct fix, fed a lie, reports success.
 *
 * `edit-graph-mutation-correctness-wiring.test.ts` (added by #884 itself)
 * records this defect in a fixture comment as a measured, out-of-scope
 * neighbour: "the value applier updates `observed_state.value` and leaves
 * `raw_value` STALE … That is an APPLIER defect, not a display-anchor
 * defect." This file is that applier defect, closed.
 *
 * ── The authority ruling this file pins ───────────────────────────────────
 * `observed_state.value` is AUTHORITATIVE on the edit path; `raw_value` is a
 * derived artefact that may never outlive it. Not a matter of taste — three
 * independent derivations:
 *   1. `ALLOWED_OBSERVED_SUBKEYS` omits `raw_value`, so an edit op
 *      STRUCTURALLY CANNOT author one (it is `invariant_coupled` in the
 *      editable-field table). A field the writer may not write cannot win.
 *   2. `graph-hash.ts` whitelists `observed_state.{value,baseline,cap}` as
 *      analysis-affecting and excludes `raw_value` as "cosmetic".
 *   3. `analysis-ready.ts` ships `observed_state.value` as the intervention
 *      number the compute path consumes.
 *
 * ── Why the assertions are POSITIVE ───────────────────────────────────────
 * The UI half of this defect was caught by a test asserting
 * `not.toBe('20%')`, which cannot tell "renders 40%" from "renders nothing".
 * Every assertion below names the number it expects.
 *
 * Every assertion binds to its node by ID (`fac_spend`), never by a value
 * predicate a sibling factor could satisfy — `fac_other` exists in the
 * fixture precisely so a value-predicate assertion would be ambiguous.
 */
import { describe, it, expect, vi } from 'vitest';

import { handleEditGraph } from '../edit-graph.js';
import { reconcileObservedValuePair } from '../../canonicalise-value-ops.js';
import { synthesiseDisplayValue } from '../../../cee/factor-extraction/display-value.js';
import type { PatchOperation } from '../../types.js';
import type { ConversationContext } from '../../types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * TWO factors carrying the SAME observed value (0.2) and the SAME stale
 * raw_value shape. Identity binding is therefore load-bearing: an assertion
 * that found "the factor whose value is 0.4" could match either one after a
 * mutation, which is exactly the wrong-object trap (row 2.1003's neighbour).
 */
function buildGraph() {
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Budget' },
      { id: 'opt_a', kind: 'option', label: 'Increase spend' },
      {
        id: 'fac_spend',
        kind: 'factor',
        label: 'Marketing spend',
        display_value: '£20k',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
      {
        id: 'fac_other',
        kind: 'factor',
        label: 'Support spend',
        display_value: '£20k',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
      { id: 'goal_g', kind: 'goal', label: 'Total return' },
    ],
    edges: [
      { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_spend', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_other', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_spend', to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_other', to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
}

function buildContext(graph: unknown = buildGraph()): ConversationContext {
  return {
    graph,
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-2-1033',
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

function editResponse(operations: unknown[]) {
  return {
    operations,
    removed_edges: [],
    warnings: [],
    coaching: { summary: 'Updated.', rerun_recommended: true },
  };
}

/** The op spelling the SERVED edit prompt's PATH SYNTAX produces. */
function valueOp(nodeId: string, value: unknown, oldValue: unknown = 0.2) {
  return {
    op: 'update_node',
    path: `/nodes/${nodeId}/data/value`,
    value,
    old_value: oldValue,
    impact: 'moderate',
    rationale: 'User set the value.',
  };
}

async function runEdit(graph: unknown, operations: unknown[], message = 'Change marketing spend to £40k') {
  return handleEditGraph(
    buildContext(graph),
    message,
    makeAdapter(editResponse(operations)),
    'req-2-1033',
    'turn-2-1033',
  );
}

/** Bind by IDENTITY. Never "the node whose value is X". */
function nodeById(graph: unknown, id: string): Record<string, unknown> {
  const nodes = (graph as { nodes?: unknown[] })?.nodes ?? [];
  const found = (nodes as Record<string, unknown>[]).find((n) => n.id === id);
  if (found === undefined) throw new Error(`fixture drift: node ${id} not found`);
  return found;
}

function observedOf(graph: unknown, id: string): Record<string, unknown> {
  return (nodeById(graph, id).observed_state ?? {}) as Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────

describe('2.1033 — the committed pair, the receipt and the rendered value all agree', () => {
  it('THE ACCEPTANCE CASE: £20k -> £40k commits raw_value 40000 and renders "£40k"', async () => {
    const result = await runEdit(buildGraph(), [valueOp('fac_spend', 0.4)]);

    expect(result.wasRejected).toBe(false);

    const observed = observedOf(result.appliedGraph, 'fac_spend');
    // The authoritative field moved...
    expect(observed.value).toBe(0.4);
    // ...and the derived sibling moved WITH it (0.4 x 100000). Pristine: 20000.
    expect(observed.raw_value).toBe(40000);
    // Siblings the op never mentioned still survive.
    expect(observed.unit).toBe('£');
    expect(observed.cap).toBe(100000);

    // THE POSITIVE RENDERED OUTCOME — the number a user actually sees.
    // Pristine renders "£20k" here, which is the whole defect.
    expect(nodeById(result.appliedGraph, 'fac_spend').display_value).toBe('£40k');
    expect(
      synthesiseDisplayValue({
        value: observed.value as number,
        raw_value: observed.raw_value as number,
        unit: observed.unit as string,
        cap: observed.cap as number,
      }),
    ).toBe('£40k');
  });

  it('leaves the UNTOUCHED sibling factor exactly as it was (identity binding)', async () => {
    const result = await runEdit(buildGraph(), [valueOp('fac_spend', 0.4)]);

    const other = observedOf(result.appliedGraph, 'fac_other');
    expect(other.value).toBe(0.2);
    expect(other.raw_value).toBe(20000);
    expect(nodeById(result.appliedGraph, 'fac_other').display_value).toBe('£20k');
  });

  it('a PERCENTAGE factor: 20% -> 40% commits raw_value 40 and renders "40%"', async () => {
    const graph = buildGraph();
    (graph.nodes[2] as Record<string, unknown>).observed_state = {
      value: 0.2,
      raw_value: 20,
      unit: '%',
    };
    (graph.nodes[2] as Record<string, unknown>).display_value = '20%';

    const result = await runEdit(graph, [valueOp('fac_spend', 0.4)], 'Change it to 40%');

    const observed = observedOf(result.appliedGraph, 'fac_spend');
    expect(observed.value).toBe(0.4);
    expect(observed.raw_value).toBe(40);
    expect(nodeById(result.appliedGraph, 'fac_spend').display_value).toBe('40%');
  });

  it('CLEARS an unrecoverable raw_value rather than letting it lie, and still renders 40%', async () => {
    // A `%` factor whose new value is OUTSIDE [0,1]: the scale genuinely
    // cannot be recovered (5 -> 500% or legacy 5%?), so `resolveExistingRawValue`
    // returns `ambiguous`. The stale 20 must NOT survive; the formatter's own
    // `value` fallback then renders the honest number.
    const graph = buildGraph();
    (graph.nodes[2] as Record<string, unknown>).observed_state = {
      value: 20,
      raw_value: 20,
      unit: '%',
    };
    (graph.nodes[2] as Record<string, unknown>).display_value = '20%';

    const result = await runEdit(graph, [valueOp('fac_spend', 40, 20)], 'Change it to 40');

    const observed = observedOf(result.appliedGraph, 'fac_spend');
    expect(observed.value).toBe(40);
    expect(observed.raw_value).toBeUndefined();
    expect(nodeById(result.appliedGraph, 'fac_spend').display_value).toBe('40%');
  });

  it('THE #884 MEASURED SHAPE still works (control — no raw_value to begin with)', async () => {
    // The exact fixture `edit-graph-mutation-correctness-wiring.test.ts`
    // pins. This lane must not disturb it.
    const graph = buildGraph();
    (graph.nodes[2] as Record<string, unknown>).observed_state = {
      value: 20,
      unit: '%',
      source: 'cee_inference',
      extractionType: 'inferred',
    };
    (graph.nodes[2] as Record<string, unknown>).display_value = '20%';

    const result = await runEdit(graph, [valueOp('fac_spend', 40, 20)], 'Change it to 40');

    expect(observedOf(result.appliedGraph, 'fac_spend').value).toBe(40);
    expect(nodeById(result.appliedGraph, 'fac_spend').display_value).toBe('40%');
  });
});

describe('2.1033 — reconcileObservedValuePair: scope and by-reference contract', () => {
  const graph = {
    nodes: [
      {
        id: 'fac_spend',
        kind: 'factor',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
    ],
  };

  function run(ops: PatchOperation[]) {
    return reconcileObservedValuePair(ops, graph);
  }

  it('re-derives the stale sibling from the authoritative value', () => {
    const ops = [
      { op: 'update_node', path: 'fac_spend', value: { observed_state: { value: 0.4, raw_value: 20000, unit: '£', cap: 100000 } } },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect((out[0]!.value as Record<string, Record<string, unknown>>).observed_state.raw_value).toBe(40000);
  });

  it('returns the op BY REFERENCE when the pair already agrees (byte-identical batches)', () => {
    const ops = [
      { op: 'update_node', path: 'fac_spend', value: { observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 } } },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect(out[0]).toBe(ops[0]); // identity, not deep equality
  });

  it('THE BOUNDARY: a payload carrying no raw_value is returned BY REFERENCE', () => {
    // Nothing stale can survive a payload that never carried the field, so
    // this lane does not touch it. Recorded as a deliberate limit: a literal
    // nested `{observed_state:{value}}` op is never merged and the applier's
    // whole-object replace drops unit/cap/raw_value outright. That sibling
    // WIPE is a separate defect (see the module comment), not this one.
    const ops = [
      { op: 'update_node', path: 'fac_spend', value: { observed_state: { value: 0.4 } } },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect(out[0]).toBe(ops[0]);
  });

  it('IGNORES an op that writes no value (unit-only edit is returned by reference)', () => {
    const ops = [
      { op: 'update_node', path: 'fac_spend', value: { observed_state: { unit: '$' } } },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect(out[0]).toBe(ops[0]);
  });

  it('IGNORES the intervention subtree, whose own raw_value IS authoritative', () => {
    // plot-intervention-scale.ts reads an intervention-level `raw_value` as
    // the absolute truth (`rule: 'raw_value_used'`). This lane must not touch it.
    const ops = [
      {
        op: 'update_node',
        path: 'fac_spend',
        value: { 'data/interventions/fac_spend': { value: 0.8, raw_value: 80000, unit: '£', cap: 100000 } },
      },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect(out[0]).toBe(ops[0]);
  });

  it('IGNORES a structural op entirely', () => {
    const ops = [{ op: 'add_node', path: 'fac_new', value: { id: 'fac_new', kind: 'factor', label: 'New' } }] as unknown as PatchOperation[];
    const out = run(ops);
    expect(out[0]).toBe(ops[0]);
  });

  it('POSITIVE CONTROL — the stale pair really IS renderable as the OLD number', () => {
    // Guards this whole file against going vacuous: if the formatter ever
    // stopped preferring raw_value, every assertion above would pass for the
    // wrong reason. This asserts the defect mechanism is still real.
    expect(synthesiseDisplayValue({ value: 0.4, raw_value: 20000, unit: '£', cap: 100000 })).toBe('£20k');
  });
});
