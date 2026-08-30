/**
 * ⭐⭐ AN ANSWER TO THE BASELINE QUESTION MUST NOT WRITE ANYWHERE ELSE.
 *
 * WIRE-WITNESSED on the deployed build. The product asked "Roughly what
 * percentage is <target> at right now?" while a second bare-number ask about an
 * option/factor cell was still live. The user answered, and the receipt said:
 *
 *   "'introduce annual contracts with a discount to lock customers in' now has
 *    an effect value of 0.3 on 'Annual Contract Adoption Rate'."
 *
 * confirmed by SERVER READ-BACK, not by the receipt: the graph identity hash
 * moved and a new intervention appeared. The user answered one question and got
 * a number written onto something they were never asked about.
 *
 * ── WHY THIS FILE EXISTS ALONGSIDE THE ROUTING SPEC ───────────────────────
 * `routing/__tests__/baseline-ask-collision-precedence.test.ts` proves the
 * VERDICT. This proves the CONSEQUENCE, at the persistence boundary: it asserts
 * on `append`'s `graph` and reads values back OUT OF THE PERSISTED GRAPH BOUND
 * BY NODE ID, never on response wording. The witnessed build's receipt was the
 * honest part; the write was the defect, so a spec that reads the receipt is
 * measuring the wrong object.
 *
 * ── TRAP 13: EVERY "NOTHING WAS WRITTEN" CASE HAS A POSITIVE CONTROL ──────
 * Each refusal case is paired with a control running the SAME harness, the SAME
 * adapter and the SAME graph with the collision absent, proving this harness can
 * see that exact write land. An absence assertion whose harness cannot observe a
 * presence is vacuous.
 *
 * ── WHAT THE ADAPTER IS FOR, and what it is NOT evidence of ───────────────
 * The mutating adapter reproduces a routing decision of the class the deployed
 * model made. It is deliberately "wrong": the guarantee must hold regardless of
 * what the model decides, because on the witnessed turn the model decided to
 * write. The strongest case here needs no adapter behaviour at all — it uses a
 * THROWING adapter, so "the model was never consulted" is asserted structurally
 * rather than inferred from an outcome. A self-authored adapter is not evidence
 * about the live wire (trap 16-inverse), and no claim here rests on one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { PendingAction } from '../session/pending-action.js';

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  pending_actions?: unknown;
}
const appendCalls: AppendWrite[] = [];
let persistedGraph: unknown = null;
let servedGraph: unknown = null;
let pendingActionsForRead: readonly PendingAction[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) persistedGraph = write.graph;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    countTurns: async () => 0,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readRecentAppliedMutationFactsFor: async () => [],
    readMostRecentPendingActions: async () => pendingActionsForRead,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraph ?? servedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph ?? servedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** The baseline question's target. */
const TARGET_ID = 'f-churn';
const TARGET_LABEL = 'Churn rate';
/** The competing ask's cell — the pair the witnessed turn wrote onto. */
const OPTION_ID = 'o-annual';
const OPTION_LABEL = 'introduce annual contracts with a discount to lock customers in';
const FACTOR_ID = 'f-acar';
const FACTOR_LABEL = 'Annual Contract Adoption Rate';

/** The witnessed answer. Any answer-shaped reply reproduces this; see the routing spec. */
const ANSWER = '30%';

function buildGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-mrr', kind: 'goal', label: 'Reach 250,000 MRR' },
      {
        id: TARGET_ID,
        kind: 'factor',
        label: TARGET_LABEL,
        observed_state: { value: 0.05, raw_value: 5, unit: '%', cap: 100 },
      },
      { id: FACTOR_ID, kind: 'factor', label: FACTOR_LABEL },
      { id: OPTION_ID, kind: 'option', label: OPTION_LABEL },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

const LIVE_UNTIL = '2099-12-31T23:59:59.000Z';
const EMITTED = '2026-08-30T11:00:00.000Z';

function baselinePending(): PendingAction {
  return {
    id: `pa-baseline-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_elicit_target_baseline',
    action: {
      kind: 'elicit_target_baseline',
      target_id: TARGET_ID,
      target_label: TARGET_LABEL,
      constraint_type: 'at_most',
      value: 0.3,
    },
    preconditions: {},
    expires_at_turn_count: 3,
    expires_at_iso: LIVE_UNTIL,
    emitted_at_iso: EMITTED,
  } as unknown as PendingAction;
}

function effectPending(): PendingAction {
  return {
    id: `pa-effect-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_configure_option_clarify',
    action: {
      kind: 'elicit_option_effect',
      option_id: OPTION_ID,
      option_label: OPTION_LABEL,
      factor_id: FACTOR_ID,
      factor_label: FACTOR_LABEL,
    },
    preconditions: {},
    expires_at_turn_count: 3,
    expires_at_iso: LIVE_UNTIL,
    emitted_at_iso: EMITTED,
  } as unknown as PendingAction;
}

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
  });
}

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

/**
 * A routing decision of the witnessed class: the user's number is applied to
 * the COMPETING ask's factor, which they were never asked about.
 *
 * ⚠ THE HANDLER CHOICE IS LOAD-BEARING AND WAS CORRECTED BY THE POSITIVE
 * CONTROL, which is the entire reason the control exists. The first draft used
 * `set_factor_value`, and the control REDDED: that proposal trips the
 * validator's `OPTION_INTERVENTION_MISROUTE` on this graph, so the write never
 * landed and the graph was spared by a guard that has nothing to do with this
 * fix. Every absence assertion in this file would have passed at PRISTINE — a
 * whole spec agreeing with itself (trap 13b). `add_constraint` lands here, so
 * the absences below are now about the collision and nothing else.
 */
function writesOntoTheOtherFactorAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () =>
        mkToolUseResult({
          intent_class: 'execute',
          action: {
            handler_id: 'add_constraint',
            entity: {
              id: FACTOR_ID,
              kind: 'node',
              label: FACTOR_LABEL,
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [
              { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
              { name: 'value', value: 30, source: 'user_explicit' },
              { name: 'unit', value: '%', source: 'user_explicit' },
            ],
            cited_context_fields: [],
          },
        }),
      ),
  };
}

/** Asserts structurally that the model is never consulted on this turn. */
function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('THE MODEL WAS CONSULTED — the answer fell through the baseline path');
      }),
  };
}

/** Every graph write this turn made. Empty === the model is untouched. */
function graphWrites(): AppendWrite[] {
  return appendCalls.filter((c) => c.graph !== undefined && c.graph !== null);
}

/** The persisted graph, or — when the turn wrote nothing — the graph it started from. */
function stateAfterTurn(): unknown {
  return persistedGraph ?? servedGraph;
}

/**
 * TRAP 19 — rows for a node by IDENTITY (`node_id`), never "the row whose value
 * is 30". Read OUT OF THE PERSISTED GRAPH, never out of the receipt.
 */
function constraintsOn(graph: unknown, nodeId: string): Array<Record<string, unknown>> {
  const rows = (graph as { goal_constraints?: unknown }).goal_constraints;
  return Array.isArray(rows)
    ? (rows as Array<Record<string, unknown>>).filter((r) => r.node_id === nodeId)
    : [];
}

/** The factor by IDENTITY, never "the node whose value is 0.3". */
function observedStateOf(graph: unknown, nodeId: string): unknown {
  const nodes = (graph as { nodes?: Array<Record<string, unknown>> }).nodes ?? [];
  const node = nodes.find((n) => n.id === nodeId) as { observed_state?: unknown } | undefined;
  return node?.observed_state;
}

beforeEach(() => {
  appendCalls.length = 0;
  persistedGraph = null;
  servedGraph = buildGraph();
  pendingActionsForRead = [];
  setTestSink(() => undefined);
});

describe('an answer to the baseline question never writes onto the competing ask', () => {
  it('POSITIVE CONTROL / DISCRIMINATING TWIN — without the baseline question, the SAME answer reaches the model', async () => {
    // Same message, same harness, same adapter, same graph. The ONLY difference
    // is that no baseline question is live. The model IS consulted, which is
    // the fall-through this fix removes — so the collision case below is
    // measuring the collision and not some other guard.
    //
    // It is also the over-application alarm: if this ever goes silent, the fix
    // has become "the baseline path swallows every number", which is the mirror
    // harm.
    pendingActionsForRead = [effectPending()];
    const adapter = writesOntoTheOtherFactorAdapter();

    await runTurnExecutor(payload(ANSWER), 'req-control-reaches-model', {
      routingAdapter: adapter,
      graphState: buildGraph(),
    });

    expect(adapter.chatWithTools).toHaveBeenCalled();
  });

  /**
   * ⚠ WHY THE WRITE ITSELF IS NOT ASSERTED ON THE LLM LANE, stated because the
   * measurement said so and inheriting the opposite would mislead the next
   * reader. A first draft asserted "no constraint row lands on the competing
   * factor", with a positive control proving the harness could see one land on
   * an ANSWER-shaped turn. THE CONTROL REDDED: on a bare "30%" the mutation
   * warrant demotes an LLM-routed mutating proposal before `execute`
   * (`stages_completed` stops at `validate`), so the graph was already spared
   * for a reason that has nothing to do with this fix, and the absence would
   * have passed at PRISTINE. A guard agreeing with itself (trap 13b).
   *
   * So the claim asserted here is the one that is actually the fix's doing:
   * the turn never reaches the model at all. That is the mechanism, it REDs at
   * pristine, and it does not overstate what this harness can see.
   */
  it('writes NOTHING when the baseline question is live alongside the competing ask', async () => {
    pendingActionsForRead = [baselinePending(), effectPending()];

    const { response } = await runTurnExecutor(payload(ANSWER), 'req-collision-no-write', {
      routingAdapter: writesOntoTheOtherFactorAdapter(),
      graphState: buildGraph(),
    });

    // THE INVARIANT, at the persistence boundary: this turn wrote nothing.
    expect(graphWrites()).toHaveLength(0);
    // Read back OUT OF THE PERSISTED GRAPH, bound by node id — the same read
    // that caught this on the server, never the receipt that disclosed it.
    expect(constraintsOn(stateAfterTurn(), FACTOR_ID)).toHaveLength(0);
    expect(observedStateOf(stateAfterTurn(), TARGET_ID)).toEqual({
      value: 0.05,
      raw_value: 5,
      unit: '%',
      cap: 100,
    });
    // The user is told, rather than left with a silent turn.
    expect(response.assistant_text).toContain(TARGET_LABEL);
    expect(response.assistant_text).toContain(FACTOR_LABEL);
  });

  it('never consults the model at all — the answer resolves deterministically', async () => {
    pendingActionsForRead = [baselinePending(), effectPending()];
    const adapter = throwingRoutingAdapter();

    const { response } = await runTurnExecutor(payload(ANSWER), 'req-collision-no-llm', {
      routingAdapter: adapter,
      graphState: buildGraph(),
    });

    // Structural, not inferred from an outcome: the fall-through to the lane
    // that writes IS a call to the model, so zero calls is the mechanism.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(graphWrites()).toHaveLength(0);
    expect(response.assistant_text).toContain('Nothing has changed.');
  });

  it('COUNTERPART HARM — a new instruction still reaches the lane that writes', async () => {
    // A user with a live baseline question may legitimately want an effect set.
    // If this ever goes green-by-refusal, the fix has become "baseline always
    // wins" and has traded one harm for its mirror.
    pendingActionsForRead = [baselinePending(), effectPending()];

    await runTurnExecutor(
      payload(`Set the effect of "${OPTION_LABEL}" on "${FACTOR_LABEL}" to 0.3.`),
      'req-instruction-still-routes',
      { routingAdapter: writesOntoTheOtherFactorAdapter(), graphState: buildGraph() },
    );

    expect(graphWrites().length).toBeGreaterThan(0);
    expect(constraintsOn(stateAfterTurn(), FACTOR_ID)).toHaveLength(1);
  });
});
