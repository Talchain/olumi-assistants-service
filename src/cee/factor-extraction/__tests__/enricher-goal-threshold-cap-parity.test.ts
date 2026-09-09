/**
 * ROADMAP 1.18 — cap-doctrine unification (CEE).
 *
 * Verified 7 Jul: the SAME raw goal-success target could produce a
 * different `goal_threshold` depending on which of the two registration
 * paths it travelled:
 *   - draft path: the factor-extraction enricher's goal-threshold
 *     redirection (`enrichGraphWithFactorsAsync`, this module's sibling
 *     `enricher.ts`) — historically used a unit-blind next-power-of-10
 *     rounding (`computeNormalisationCap`).
 *   - chat path: the `add_constraint` handler's goal-threshold join
 *     (orchestrator-v5/tools/handlers/add-constraint.ts) — used the %→/100
 *     else 25%-headroom doctrine (`resolveGoalThresholdCap`,
 *     utils/goal-threshold-cap.ts).
 *
 * This test pins parity directly: the same raw target, registered via
 * each path independently (fresh graph, no shared state), must produce
 * an IDENTICAL `goal_threshold`. No test previously exercised the draft
 * path's goal-threshold redirection at all, so this is the first fixture
 * proving (rather than asserting from code inspection) that both paths
 * delegate to the same doctrine.
 */
import { describe, expect, it } from 'vitest';

import { enrichGraphWithFactorsAsync } from '../enricher.js';
import type { GraphT } from '../../../schemas/graph.js';
import { pickGoalThresholdTrio } from '../../../utils/goal-threshold-trio.js';
import { createAddConstraintHandler } from '../../../orchestrator-v5/tools/handlers/add-constraint.js';
import { buildD1Fixture } from '../../../orchestrator-v5/tools/handlers/d1-shared/__tests__/fixtures.js';
import type { HandlerInvocation } from '../../../orchestrator-v5/tools/registry.js';
import type { ProposalAction } from '../../../orchestrator-v5/routing/types.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

function draftPathGraph(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Revenue Goal' },
      { id: 'd1', kind: 'decision', label: 'Pricing decision' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

function buildChatInvocation(graph: GraphV3T, value: number): HandlerInvocation {
  const proposal: ProposalAction = {
    handler_id: 'add_constraint',
    entity: {
      id: 'g-revenue',
      kind: 'goal',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
      { name: 'value', value, source: 'user_explicit' },
    ],
    cited_context_fields: [],
  };
  return {
    context: {
      session_id: 'scn-parity',
      stage: 'frame',
      request_id: 'req-parity',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-parity',
      turn_id: 'turn-parity',
      stage: 'frame',
      message: `Set the success target to ${value}`,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-parity',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

describe('cap-doctrine unification (ROADMAP 1.18): draft vs chat goal_threshold parity', () => {
  it('identical unitless raw target produces identical goal_threshold via draft and chat paths', async () => {
    const draftResult = await enrichGraphWithFactorsAsync(
      draftPathGraph(),
      'Our target is 800.',
    );
    const draftGoal = draftResult.graph.nodes.find((n) => n.kind === 'goal');
    expect(draftGoal?.goal_threshold_raw).toBe(800);

    const handler = createAddConstraintHandler();
    const chatOutcome = await handler(buildChatInvocation(buildD1Fixture(), 800));
    const chatGoal = (chatOutcome.mutated_graph as GraphV3T).nodes.find(
      (n) => n.kind === 'goal',
    );
    expect(chatGoal?.goal_threshold_raw).toBe(800);

    // The parity claim: same raw target, same cap doctrine, same threshold —
    // regardless of which path registered it.
    expect(draftGoal?.goal_threshold_cap).toBe(chatGoal?.goal_threshold_cap);
    expect(draftGoal?.goal_threshold).toBeCloseTo(chatGoal?.goal_threshold as number, 10);
  });

  it('identical percentage raw target produces identical goal_threshold via draft and chat paths', async () => {
    const draftResult = await enrichGraphWithFactorsAsync(
      draftPathGraph(),
      'Our target is 15%.',
    );
    const draftGoal = draftResult.graph.nodes.find((n) => n.kind === 'goal');

    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    const proposal: ProposalAction = {
      handler_id: 'add_constraint',
      entity: {
        id: 'g-revenue',
        kind: 'goal',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
        { name: 'value', value: 15, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    };
    const invocation: HandlerInvocation = {
      context: {
        session_id: 'scn-parity-pct',
        stage: 'frame',
        request_id: 'req-parity-pct',
        prior_turns: [],
        prior_facts: [],
        scenarioBriefText: null,
        persistedGraph: null,
      } as unknown as HandlerInvocation['context'],
      payload: {
        kind: 'message',
        scenario_id: 'scn-parity-pct',
        turn_id: 'turn-parity-pct',
        stage: 'frame',
        message: 'Set the success target to 15%',
      } as unknown as HandlerInvocation['payload'],
      requestId: 'req-parity-pct',
      signal: new AbortController().signal,
      orientationText: '',
      proposal,
      graphForTurn: graph,
    };
    const chatOutcome = await handler(invocation);
    const chatGoal = (chatOutcome.mutated_graph as GraphV3T).nodes.find(
      (n) => n.kind === 'goal',
    );

    expect(draftGoal?.goal_threshold_cap).toBe(chatGoal?.goal_threshold_cap);
    expect(draftGoal?.goal_threshold).toBeCloseTo(chatGoal?.goal_threshold as number, 10);
  });
});

/**
 * THE PARTIAL QUAD — an upstream mint that resolved no cap is still deferred to.
 *
 * Extracted from CEE #1328 (author: `olumi-core-model-systems` lane), whose
 * round-4 work found and evidenced this defect. Its witnessed capture is the
 * evidence below and is cited as ITS finding, not re-presented as new. The rest
 * of #1328 — the ~1,400-line label-route mint — is BLOCKED on a separate,
 * unrelated review finding and remains its author's; only this guard is here,
 * because the defect it closes is live on `staging` today.
 *
 * THE DEFECT, at `d2e45e8b`:
 *   `projector.ts:1335` writes `goal_threshold_raw` UNCONDITIONALLY; it writes
 *   `goal_threshold`/`_cap`/`_frame` only `if (cap !== null)`. The resolver ends
 *   `if (raw > 0) return raw * 1.25; return null`, so a STATED TARGET OF ZERO
 *   resolves null and leaves raw written with no threshold — a PARTIAL QUAD.
 *   `applyGoalTargetRedirect` guarded on `goal_threshold` alone, missed it, and
 *   overwrote the user's stated zero with the extracted factor's value.
 *
 * #1328's witnessed log: goal label `"Cut Churn From 4% To Zero"` shipped
 * `goal_threshold_raw: 4`. The user asked for ZERO churn and the field recorded
 * the CURRENT LEVEL they were trying to move away from — not a mislabelled
 * value, but a contradiction of stated intent using the number they rejected.
 *
 * ⚠ Every case asserts its own precondition, so none can pass by the fixture
 * quietly failing to present a partial quad in the first place.
 */
describe('the partial quad: an upstream mint that resolved no cap is still deferred to', () => {
  function goalCarrying(threshold: Record<string, unknown>): GraphT {
    return {
      version: '1',
      default_seed: 17,
      nodes: [
        { id: 'g1', kind: 'goal', label: 'Cut Monthly Churn From 4% To Zero', ...threshold },
        { id: 'd1', kind: 'decision', label: 'Retention decision' },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
    } as unknown as GraphT;
  }

  const goalOf = (g: GraphT) => g.nodes.find((n) => n.kind === 'goal');

  it('⛔ THE HARM — a stated ZERO is not overwritten with the CURRENT level', async () => {
    const input = goalCarrying({ goal_threshold_raw: 0, goal_threshold_unit: '%' });

    // PRECONDITION, in-test: this really is a PARTIAL quad — raw present,
    // threshold absent. Without it the case could pass on a full quad, which
    // the pre-existing `goal_threshold` guard already handles.
    expect(goalOf(input)?.goal_threshold_raw).toBe(0);
    expect(goalOf(input)?.goal_threshold).toBeUndefined();

    const result = await enrichGraphWithFactorsAsync(input, 'Our target is 4%.');
    const goal = goalOf(result.graph);

    // The user's stated zero stands. At pristine this reads 4 — the current level.
    expect(goal?.goal_threshold_raw).toBe(0);
    // And no derived value is invented on top of it.
    expect(goal?.goal_threshold).toBeUndefined();
  });

  it('⭐ the deferred zero SURVIVES — explicit and recoverable, not discarded', async () => {
    // Deferring must not become dropping. `pickGoalThresholdTrio` is the
    // CONSUMER'S own anchor test for whether a raw value rides at all, and it
    // gates on `typeof === number && isFinite` — which 0 passes and null does
    // not. Asserted against that function rather than re-stating its rule.
    const result = await enrichGraphWithFactorsAsync(
      goalCarrying({ goal_threshold_raw: 0, goal_threshold_unit: '%' }),
      'Our target is 4%.',
    );
    const goal = goalOf(result.graph);

    expect(pickGoalThresholdTrio(goal as never)).toEqual({
      goal_threshold_raw: 0,
      goal_threshold_unit: '%',
    });
  });

  it('⭐ OPPOSITE CONTROL — with no upstream mint, a target still binds exactly as before', async () => {
    const input = goalCarrying({});
    expect(goalOf(input)?.goal_threshold_raw).toBeUndefined();

    const result = await enrichGraphWithFactorsAsync(input, 'Our target is 800.');
    const goal = goalOf(result.graph);

    // A deferral guard that swallowed valid targets would trade a lie for a
    // gap. This is the direction that would not show up in the harm case.
    expect(goal?.goal_threshold_raw).toBe(800);
    expect(goal?.goal_threshold).toBeDefined();
  });

  it('⭐ OPPOSITE CONTROL — a FULL upstream quad still defers (pre-existing, unchanged)', async () => {
    const input = goalCarrying({
      goal_threshold: 0.5,
      goal_threshold_raw: 500,
      goal_threshold_cap: 1000,
    });
    expect(goalOf(input)?.goal_threshold).toBe(0.5);

    const result = await enrichGraphWithFactorsAsync(input, 'Our target is 800.');
    expect(goalOf(result.graph)?.goal_threshold_raw).toBe(500);
  });

  it('⭐ THE NULL TWIN — a null raw does NOT block the mint', async () => {
    // `goal_threshold_raw` is `z.number().nullable().optional()`
    // (`schemas/graph.ts:344`), and `null !== undefined` is TRUE. A guard
    // written as `!== undefined` would DEFER TO A NULL and suppress a
    // legitimate mint — trading the lie above for a gap. This case is what
    // makes the consumer-matched `typeof`/`isFinite` predicate load-bearing
    // rather than a stylistic choice, and it fails against `!== undefined`.
    const input = goalCarrying({ goal_threshold_raw: null });
    expect(goalOf(input)?.goal_threshold_raw).toBeNull();

    const result = await enrichGraphWithFactorsAsync(input, 'Our target is 800.');
    expect(goalOf(result.graph)?.goal_threshold_raw).toBe(800);
  });
});
