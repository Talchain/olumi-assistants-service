/**
 * ROADMAP 2.1003 — THE WIRING, not the units.
 *
 * ⚠ WHY THIS FILE EXISTS, stated plainly: the unit suites for
 * `reconcileDisplayAnchors` and `evaluateEditModelChange` were fully green
 * AND a mutant that DELETED THE CALL SITE in `handleEditGraph` left them
 * 33/33 green. A perfect unit kit is not evidence that the product calls the
 * unit — that is this estate's single most-repeated failure ("we build more
 * than we plug in"). These tests bind to the SEAM: the real `handleEditGraph`
 * loop, its real applied graph, and its real returned result.
 *
 * Harness mirrors `user-edit-provenance-stamp.test.ts` — the real loop with a
 * mocked LLM adapter and no PLoT client (the local-apply branch).
 */
import { describe, it, expect, vi } from 'vitest';

import { handleEditGraph } from '../edit-graph.js';
import type { ConversationContext } from '../../types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';

const FACTOR_ID = 'fac_cs_coverage_depth';
const UNTOUCHED_ID = 'fac_onboarding';

function buildContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'dec_a', kind: 'decision', label: 'Decide' },
        {
          id: FACTOR_ID,
          kind: 'factor',
          label: 'Customer Success Coverage Depth',
          category: 'controllable',
          // THE MEASURED SHAPE: a denormalised human string beside the machine
          // value. On deployed staging the value moved to 40 and this string
          // stayed "20%", and the canvas preferred the string.
          display_value: '20%',
          // ⚠ NO `raw_value`. This is the shape the audit MEASURED on the
          // wire (`observed_state.value = 40, baseline = 20, source =
          // user_override, provenance = user_set`) — a fixture I invented
          // instead would not be evidence about the wire (trap 16-inverse).
          //
          // ⚠ A MEASURED, OUT-OF-SCOPE NEIGHBOUR, recorded so nobody later
          // believes it is covered: when a node DOES carry `raw_value`, the
          // value applier updates `observed_state.value` and leaves
          // `raw_value` STALE, and `synthesiseDisplayValue` then faithfully
          // renders the stale `raw_value` (probed at this tip:
          // value 20 -> 40 with raw_value 20 yields display "20%" again).
          // That is an APPLIER defect, not a display-anchor defect, and
          // repairing it means writing model data — a different change with a
          // different blast radius. Handed back, not fixed here.
          observed_state: {
            value: 20,
            unit: '%',
            source: 'cee_inference',
            extractionType: 'inferred',
          },
        },
        {
          id: UNTOUCHED_ID,
          kind: 'factor',
          label: 'Onboarding Quality',
          category: 'controllable',
          // A qualitative, producer-authored string on a node this edit never
          // touches. It must survive verbatim.
          display_value: 'Moderate',
          observed_state: { value: 0.42, source: 'cee_inference', extractionType: 'inferred' },
        },
        { id: 'out_nrr', kind: 'goal', label: 'Net Revenue Retention' },
      ],
      edges: [
        {
          from: FACTOR_ID,
          to: 'out_nrr',
          strength: { mean: 0.4, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
      ],
    },
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-21003-wiring',
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

function valueEditResponse(value: number) {
  return {
    operations: [
      {
        op: 'update_node',
        path: `/nodes/${FACTOR_ID}/data/value`,
        value,
        old_value: null,
        impact: 'moderate',
        rationale: 'Set as requested.',
      },
    ],
    removed_edges: [],
    warnings: [],
    coaching: { summary: 'Updated coverage depth.', rerun_recommended: true },
  };
}

describe('2.1003 wiring — the applied graph reaching the caller is display-consistent', () => {
  it('⭐ THE MEASURED CASE: the edited node does NOT keep the stale display string', async () => {
    const ctx = buildContext();
    // PRECONDITION PINNED IN-TEST: the pre-edit graph really does carry the
    // contradiction under test, on the node we name.
    const preNodes = (ctx as unknown as { graph: { nodes: Array<Record<string, unknown>> } }).graph.nodes;
    const preEdited = preNodes.find((n) => n.id === FACTOR_ID)!;
    expect(preEdited.display_value).toBe('20%');

    const result = await handleEditGraph(
      ctx,
      'Change Customer Success Coverage Depth to 40',
      makeAdapter(valueEditResponse(40)),
      'req-21003-a',
      'turn-21003-a',
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();

    const nodes = (result.appliedGraph as { nodes: Array<Record<string, unknown>> }).nodes;
    // IDENTITY BINDING: the edited node, by id — never by a value predicate
    // another node could satisfy.
    const edited = nodes.find((n) => n.id === FACTOR_ID)!;
    expect((edited.observed_state as Record<string, unknown>).value).toBe(40);
    expect(edited.display_value).not.toBe('20%');
    // Derived from the PRODUCER's declared priority order
    // (`synthesiseDisplayValue`: raw_value+% -> "N%"; value only -> "N"),
    // not from what the code happens to emit.
    expect(edited.display_value).toBe('40%');

    // GREEN HALF OF THE DISCRIMINATING PAIR: the untouched node keeps its
    // producer-authored qualitative string. A fix that rewrote every anchor
    // would fail here while the assertion above still passed.
    const untouched = nodes.find((n) => n.id === UNTOUCHED_ID)!;
    expect(untouched.display_value).toBe('Moderate');
  });

  it('⭐ the result carries a no-change verdict, and it is FALSE for a real change', async () => {
    const result = await handleEditGraph(
      buildContext(),
      'Change Customer Success Coverage Depth to 40',
      makeAdapter(valueEditResponse(40)),
      'req-21003-b',
      'turn-21003-b',
    );
    // `undefined` here would mean the verdict never reached the caller — i.e.
    // the wiring is absent — and the composer would silently fall back to the
    // count sentence forever.
    expect(result.modelUnchanged).toBe(false);
  });

  it('⭐ a value edit to the value it ALREADY HAS reports modelUnchanged === true', async () => {
    // The identical-replay shape, at the seam: the operation is proposed and
    // applied (operations.length === 1, not rejected, appliedGraph present —
    // all three of `isSuccessfulAppliedMutation`'s questions answer yes), and
    // the model did not move.
    const result = await handleEditGraph(
      buildContext(),
      'Change Customer Success Coverage Depth to 20',
      makeAdapter(valueEditResponse(20)),
      'req-21003-c',
      'turn-21003-c',
    );
    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
    expect(result.operations?.length).toBeGreaterThan(0);
    expect(result.modelUnchanged).toBe(true);
  });
});
