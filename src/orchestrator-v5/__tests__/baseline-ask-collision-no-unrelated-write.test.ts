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
const { formatBaselineAskCollision } = await import(
  '../tools/handlers/d1-shared/format-confirmation.js'
);
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

/**
 * ⭐⭐ THE OTHER DIRECTION, AT THE SAME TURN BOUNDARY.
 *
 * The block above proves an ELLIPTICAL answer is stopped. This one proves the
 * stop is not indiscriminate: a reply that names its own subject must still
 * reach the lane that binds it, with the very same competing ask live.
 *
 * It matters because the two live in one predicate, and the first version of
 * this transition failed exactly here — it refused the product's OWN offered
 * disambiguating answer, so the user was told what to say and then rejected for
 * saying it. The elliptical block alone cannot see that: every one of its cases
 * points in the same direction.
 *
 * The assertion is the INVERSE of the elliptical case's mechanism, and it is
 * structural for the same reason: being intercepted means the model is never
 * consulted, so `chatWithTools` HAVING been called is the fall-through itself.
 */
describe('a reply that names its own subject is not the collision case', () => {
  /** The product's own offered example, taken from the copy it actually emits. */
  const offeredExample = (() => {
    const copy = formatBaselineAskCollision({
      targetLabel: TARGET_LABEL,
      competing: [effectPending()],
    });
    const m = /for example "([^"]+)"/.exec(copy);
    if (m === null) throw new Error(`collision copy no longer offers an example:\n${copy}`);
    return m[1]!;
  })();

  it("offers an example that is itself subject-bearing — the promise it must keep", () => {
    expect(offeredExample).toBe(`${TARGET_LABEL} is 30%`);
  });

  it('the OFFERED example reaches the model with the competing ask live', async () => {
    pendingActionsForRead = [baselinePending(), effectPending()];
    const adapter = writesOntoTheOtherFactorAdapter();

    const { response } = await runTurnExecutor(
      payload(offeredExample),
      'req-offered-example-routes',
      { routingAdapter: adapter, graphState: buildGraph() },
    );

    // Not intercepted: it resolves its own subject, so it continues to the lane
    // whose handler records the baseline (proven at the handler in
    // add-constraint-collision-subject-authority.test.ts).
    expect(adapter.chatWithTools).toHaveBeenCalled();
    // And it is NOT answered with the collision warning it was offered by.
    expect(response.assistant_text).not.toContain('Two of my questions are open at once');
  });

  it('the pre-existing corpus sentence "Churn is about 12%." reaches the model too', async () => {
    pendingActionsForRead = [baselinePending(), effectPending()];
    const adapter = writesOntoTheOtherFactorAdapter();

    const { response } = await runTurnExecutor(
      payload('Churn is about 12%.'),
      'req-corpus-sentence-routes',
      { routingAdapter: adapter, graphState: buildGraph() },
    );

    expect(adapter.chatWithTools).toHaveBeenCalled();
    expect(response.assistant_text).not.toContain('Two of my questions are open at once');
  });

  it('DISCRIMINATING TWIN — the bare answer on the SAME turn is still stopped', async () => {
    // Same harness, same pendings, same graph; only the reply differs. Without
    // this, the two cases above would pass just as well if the collision branch
    // had been deleted outright.
    pendingActionsForRead = [baselinePending(), effectPending()];
    const adapter = writesOntoTheOtherFactorAdapter();

    const { response } = await runTurnExecutor(payload(ANSWER), 'req-twin-bare-stopped', {
      routingAdapter: adapter,
      graphState: buildGraph(),
    });

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(graphWrites()).toHaveLength(0);
    expect(response.assistant_text).toContain('Two of my questions are open at once');
  });
});

/**
 * ⭐⭐ THE ANSWER MUST LAND, NOT MERELY REACH THE MODEL.
 *
 * Reaching the model was the previous link; this is the outcome. With the
 * reply through, the executor's mutation-warrant gate then DEMOTED the write
 * ("You did not ask me to edit the model"), so the stated baseline still never
 * landed. The gate's message signal is LEXICAL, and measured at this seam with
 * a live baseline question and a competing ask:
 *
 *     "Churn rate is at 30%"  → warrant granted  → the baseline commits
 *     "Churn rate is 30%"     → warrant ABSENT   → demoted, nothing lands
 *
 * One token apart; same question, same target, same value. And the second is
 * the sentence the product ITSELF offers. A user cannot be asked to guess which
 * spelling of their own answer will be accepted.
 *
 * ⚠ THIS WAS AN EXISTING DOWNSTREAM GAP, not a regression introduced upstream:
 * the warrant module is untouched by this branch. The routing repair made it
 * REACHABLE, which is what a correct fix does — and the repair is not finished
 * until the outcome it unblocks actually occurs.
 *
 * THE FIX is a fourth warrant source scoped to the named baseline object and
 * action: a live baseline question whose subject this reply resolved by
 * identity, the `add_constraint` action, and that question's own target node.
 *
 * BOTH DIRECTIONS IN THE SAME RUN, because a whole-turn warrant would be the
 * mirror harm — every numeric sentence licensing any edit. The three
 * `LICENSES NOTHING WIDER` cases are the ones that fail if that happens, and
 * each strips exactly one conjunct of the grant: the object, the authority, and
 * the live question.
 */
function proposesConstraintOnNodeAdapter(nodeId: string, label: string, value: number) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () =>
        mkToolUseResult({
          intent_class: 'execute',
          action: {
            handler_id: 'add_constraint',
            entity: {
              id: nodeId,
              kind: 'node',
              label,
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [
              { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
              { name: 'value', value, source: 'user_explicit' },
              { name: 'unit', value: '%', source: 'user_explicit' },
            ],
            cited_context_fields: [],
          },
        }),
      ),
  };
}

/**
 * The state-class the witnessed turn is actually in, derived from the handler's
 * OWN `mintEligible` conjunction rather than assumed: the target is an outcome
 * with an incoming edge and no baseline yet, and the level-framed constraint the
 * question was asked about is already persisted. `buildGraph()` alone carries no
 * edges, so the mint cell cannot fire on it and an assertion about the baseline
 * would have been measuring the fixture instead of the fix.
 */
function mintEligibleGraph(): GraphV3T {
  const g = buildGraph() as unknown as {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    goal_constraints?: unknown;
  };
  const target = g.nodes.find((n) => n.id === TARGET_ID)!;
  delete target['observed_state'];
  target['kind'] = 'outcome';
  g.edges.push({
    from: FACTOR_ID,
    to: TARGET_ID,
    strength: { mean: 0.3, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
  });
  g.goal_constraints = [
    {
      constraint_id: 'gc-1',
      node_id: TARGET_ID,
      operator: '<=',
      value: 10,
      label: TARGET_LABEL,
      provenance: 'explicit',
      unit: '%',
      value_frame: 'level',
    },
  ];
  return g as unknown as GraphV3T;
}

/** The baseline recorded on a node, by IDENTITY, out of the PERSISTED graph. */
function baselineOn(graph: unknown, nodeId: string): unknown {
  return (observedStateOf(graph, nodeId) as { baseline?: unknown } | undefined)?.baseline;
}

describe("the product's offered answer commits, and licenses nothing else", () => {
  /** Extracted from the copy the product emits, never transcribed. */
  const offered = (() => {
    const copy = formatBaselineAskCollision({
      targetLabel: TARGET_LABEL,
      competing: [effectPending()],
    });
    const m = /for example "([^"]+)"/.exec(copy);
    if (m === null) throw new Error(`collision copy no longer offers an example:\n${copy}`);
    return m[1]!;
  })();

  it('THE OFFERED ANSWER commits the stated baseline on the node it names', async () => {
    pendingActionsForRead = [baselinePending(), effectPending()];

    const { response } = await runTurnExecutor(payload(offered), 'req-offered-commits', {
      routingAdapter: proposesConstraintOnNodeAdapter(TARGET_ID, TARGET_LABEL, 10),
      graphState: mintEligibleGraph(),
    });

    expect(baselineOn(stateAfterTurn(), TARGET_ID)).toBe(0.3);
    // Not the demotion the reviewer witnessed.
    expect(response.assistant_text).not.toContain('You did not ask me to edit the model');
    // And nothing else moved.
    expect(baselineOn(stateAfterTurn(), FACTOR_ID)).toBeUndefined();
    expect(constraintsOn(stateAfterTurn(), FACTOR_ID)).toHaveLength(0);
  });

  it('EXACT-INPUT CONTROL — the "is at 30%" spelling commits identically', async () => {
    // The reviewer's one-token pair. Same graph, same pendings, same adapter,
    // same target and value; ONLY the wording differs. This spelling already
    // worked, so it is the reference the offered spelling must match — if the
    // two ever diverge again, the lexical accident is back.
    pendingActionsForRead = [baselinePending(), effectPending()];

    await runTurnExecutor(payload(`${TARGET_LABEL} is at 30%`), 'req-at-spelling', {
      routingAdapter: proposesConstraintOnNodeAdapter(TARGET_ID, TARGET_LABEL, 10),
      graphState: mintEligibleGraph(),
    });

    expect(baselineOn(stateAfterTurn(), TARGET_ID)).toBe(0.3);
  });

  it('LICENSES NOTHING WIDER — strips the OBJECT: the same answer cannot write on another node', async () => {
    // Identical turn; only the proposal's entity differs. If this writes, the
    // fourth source has become a whole-turn warrant.
    pendingActionsForRead = [baselinePending(), effectPending()];

    const { response } = await runTurnExecutor(payload(offered), 'req-offered-other-node', {
      routingAdapter: proposesConstraintOnNodeAdapter(FACTOR_ID, FACTOR_LABEL, 30),
      graphState: mintEligibleGraph(),
    });

    expect(graphWrites()).toHaveLength(0);
    expect(constraintsOn(stateAfterTurn(), FACTOR_ID)).toHaveLength(0);
    expect(response.assistant_text).toContain('You did not ask me to edit the model');
  });

  it('LICENSES NOTHING WIDER — strips the AUTHORITY: an unrelated numeric sentence cannot write', async () => {
    // Answer-shaped, names a node, has a number — and no baseline question
    // resolved ITS subject, so no authority exists. This is what keeps "every
    // numeric sentence gets a warrant" out.
    pendingActionsForRead = [baselinePending(), effectPending()];

    const { response } = await runTurnExecutor(
      payload(`${FACTOR_LABEL} is 30%`),
      'req-unrelated-sentence',
      {
        routingAdapter: proposesConstraintOnNodeAdapter(FACTOR_ID, FACTOR_LABEL, 30),
        graphState: mintEligibleGraph(),
      },
    );

    expect(graphWrites()).toHaveLength(0);
    expect(response.assistant_text).toContain('You did not ask me to edit the model');
  });

  it('LICENSES NOTHING WIDER — strips the LIVE QUESTION: same wording, no baseline ask, no write', async () => {
    // Same message, same proposal, same node — only the live baseline question
    // is gone. Without this the cases above would pass just as well if the
    // grant ignored the pending set entirely.
    pendingActionsForRead = [effectPending()];

    const { response } = await runTurnExecutor(payload(offered), 'req-no-baseline-live', {
      routingAdapter: proposesConstraintOnNodeAdapter(TARGET_ID, TARGET_LABEL, 10),
      graphState: mintEligibleGraph(),
    });

    expect(graphWrites()).toHaveLength(0);
    expect(response.assistant_text).toContain('You did not ask me to edit the model');
  });

  it('the bare elliptical answer on the SAME turn is still stopped upstream', async () => {
    // The whole chain in one case: competition safety first, and the fourth
    // warrant source never reached, because the reply never resolved a subject.
    pendingActionsForRead = [baselinePending(), effectPending()];

    const { response } = await runTurnExecutor(payload(ANSWER), 'req-bare-still-stopped', {
      routingAdapter: proposesConstraintOnNodeAdapter(TARGET_ID, TARGET_LABEL, 10),
      graphState: mintEligibleGraph(),
    });

    expect(graphWrites()).toHaveLength(0);
    expect(response.assistant_text).toContain('Two of my questions are open at once');
  });
});
