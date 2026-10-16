/**
 * V5 routing — `display_graph.goals` must be projected, not passed through.
 *
 * ── THE DEFECT THIS PINS ───────────────────────────────────────────────────
 * `projectCompactGraph` built `ContextPackGraph.goals` as
 * `compact.nodes.filter(n => n.kind === 'goal')` — the WHOLE compact node,
 * unlike `options` two lines above, which is projected down to `{id, label}`.
 * `formatGraphForContext` then passed it straight through (`goals: raw.goals`)
 * and its own header said so: *"`options`, `goals`, `constraints`, `counts`:
 * pass through unchanged."* `projectNode` was never applied to `goals`.
 *
 * `buildUserMessage` substitutes `display_graph` for `graph` and serialises the
 * result with `JSON.stringify`, so EVERY key of those objects reached Sonnet.
 * Measured on the production path at pristine, one goal node arrived TWICE:
 *
 *   graph.nodes[1] → {id, label, kind, unit: "%", display_value: "42%"}   safe
 *   graph.goals[0] → {..., value: 0.42, raw_value: 42, cap: 100, ...}     LEAK
 *
 * The goals passthrough defeated the raw-value strip that `DisplaySafeNode`
 * exists to enforce (A3.1 Task 6: floats stay in `ContextPack.graph` for
 * handlers / freshness / edit_graph; Sonnet sees the formatted string only).
 *
 * ── WHY PROJECTING CANNOT STARVE THE PROMPT ────────────────────────────────
 * `goals` is a by-kind INDEX of `nodes`, not an independent collection — both
 * `ContextPackGraph` constructors derive it by filtering the very same node
 * array (`projectCompactGraph`, `projectGraph`). So every goal is ALREADY in
 * `display_graph.nodes` in projected form. Projecting `goals` removes a
 * duplicate that leaks; it removes no information the model had. It is in fact
 * a net GAIN: the raw compact node has no `display_value` field at all, so the
 * projected entry carries "42%" where the passthrough carried only the float.
 *
 * ── WHY THESE ASSERTIONS ARE ON THE SERIALISED PROMPT, NOT ON THE PACK ─────
 * The pack is not what the model sees. A sibling test in this area asserts on
 * `pack.graph.constraints` — a field `buildUserMessage` destructures away and
 * never serialises — so it could not observe a prompt-facing regression at all.
 * Everything below is parsed back out of the user-message string that the
 * adapter actually received.
 */

import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { setTestSink } from '../../src/utils/telemetry.js';


import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';
import type { ContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import { assembleContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { GraphV3Compact } from '../../src/orchestrator/context/graph-compact.js';

/** The goal node under test. Bound BY IDENTITY everywhere below (trap 19) —
 *  never by a value predicate another node could satisfy. */
const GOAL_ID = 'goal_churn';
const GOAL_LABEL = 'Reduce Churn';
/** Synthesised by `synthesiseDisplayValue` from value/raw_value/unit/cap.
 *  Measured on the production path, not assumed. */








beforeEach(() => {
  setTestSink(() => {});
});

afterEach(() => {
  setTestSink(null);
});

/**
 * A real pack through the production assembler — never a stub — so
 * `display_graph` is built by `projectCompactGraph` → `formatGraphForContext`
 * exactly as it is on a live turn.
 *
 * The goal node carries the full numeric quartet (`value`, `raw_value`, `unit`,
 * `cap`) plus both provenance fields, because that is what `compactGraph`
 * emits for a goal whose `observed_state` has been written (e.g. by
 * `add-constraint.ts`). A goal with no `observed_state` cannot exhibit the
 * defect — it has no float to leak — so a bare fixture would have made this
 * suite vacuous (trap 13: an absence assertion needs a presence it could see).
 */
function makePackWithValuedGoal(): ContextPack {
  const compactedGraph = {
    nodes: [
      { id: 'opt_a', kind: 'option', label: 'Aggressive Campaign' },
      {
        id: GOAL_ID,
        kind: 'goal',
        label: GOAL_LABEL,
        value: 0.42,
        raw_value: 42,
        unit: '%',
        cap: 100,
        provenance: 'ai_inferred',
        source: 'ai',
      },
    ],
    edges: [{ from: 'opt_a', to: GOAL_ID, strength: 0.5, exists: 0.9 }],
    _node_count: 2,
    _edge_count: 1,
  } as unknown as GraphV3Compact;

  return assembleContextPack({
    payload: makeMessagePayload({
      stage: 'analyse',
      message: 'run analysis',
      scenario_id: 'scen-goals-1',
      turn_id: 'turn-goals-1',
      turn_class: 'decide',
    }),
    priorTurns: [],
    compactedGraph,
  });
}





/**
 * Slice the ContextPack JSON out of the routing user message by brace-matching
 * (string-aware), then parse it. Structural, per-field assertions on the RESULT
 * cannot be fooled by a stray `"value":` appearing in coaching prose or a label
 * elsewhere in the prompt — which a bare `content.includes('0.42')` could be.
 */




/** Find the goal entry BY ID. Never `find(g => g.value === 0.42)` — a value
 *  predicate another node could satisfy is exactly how a test ends up passing
 *  on the wrong object (trap 19). */


describe('display_graph.goals is projected through projectNode, not passed through', () => {
  /**
   * PRECONDITION PIN (trap 13b). If the fixture ever stops producing a goal
   * that COULD leak, every absence assertion below would pass vacuously. This
   * asserts the raw pack still carries the float, so a green result downstream
   * is provably the projection's doing and not the fixture's failure.
   */
  it('precondition: the raw ContextPack.graph.goals still carries the float (handlers need it)', () => {
    const pack = makePackWithValuedGoal();
    const rawGoals = pack.graph.goals as ReadonlyArray<Record<string, unknown>>;
    const rawGoal = rawGoals.find((g) => g['id'] === GOAL_ID);
    expect(rawGoal).toBeDefined();
    // The raw pack is the handler/freshness/edit_graph channel and MUST keep
    // the float. This fix is scoped to the display projection only.
    expect(rawGoal!['value']).toBe(0.42);
    expect(rawGoal!['raw_value']).toBe(42);
  });










});
