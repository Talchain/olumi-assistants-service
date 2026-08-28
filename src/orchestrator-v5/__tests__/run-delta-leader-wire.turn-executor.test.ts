/**
 * THE LEADER HALF OF THE `run_delta` WIRE, PINNED AT THE TURN-EXECUTOR HOP.
 *
 * ⛔ WHY THIS FILE EXISTS: THE GUARD THAT WAS CLAIMED DID NOT EXIST.
 * ---------------------------------------------------------------
 * `turn-executor.ts` threads the run's leader-claim entitlement into pack
 * assembly as `mayNameLeadingOption: mayNameLeadingOptionForRun`. A comment on
 * that line asserted that neutering it "MUST turn the leader arm of
 * context/__tests__/run-delta-wire.route-level.test.ts red".
 *
 * THAT CLAIM WAS FALSE, and it was measured false: that suite calls
 * `assembleContextPack` DIRECTLY, passing its own literal
 * `mayNameLeadingOption`, and never routes through `turn-executor` at all. It
 * is structurally incapable of observing whether the turn-executor threads
 * anything. Replacing the threaded value with `false` left it — and every other
 * seam suite reached for at the time — fully green.
 *
 * The failure mode that leaves is the quiet one. `mayNameLeadingOption` is
 * fail-closed (`=== true`) in the assembler, so dropping the argument does not
 * throw and does not remove the delta: it SILENTLY STRIPS THE LEADER IDS from a
 * comparison the model still receives, and the model is told what moved without
 * being told who now leads.
 *
 * ⭐ SCOPE OF THE ABSENCE CLAIM, STATED EXACTLY. The measurement above covered
 * the seven seam suites named in that lane's report, not the whole repository.
 * The honest claim is "unguarded across the suites reached for", never "no test
 * anywhere covered it". This file makes the question moot going forward.
 *
 * WHAT THIS SUITE PINS THAT THE ROUTE-LEVEL ONE CANNOT
 * ---------------------------------------------------
 * It drives the REAL `runTurnExecutor` and reads the serialised ContextPack out
 * of the message the routing adapter actually receives. The route-level suite
 * owns the assembler→prompt hop; this one owns the turn-executor→assembler hop.
 * Neither subsumes the other, and the defect lived precisely in the gap.
 *
 * ⭐ BOUND BY IDENTITY (trap 19): every assertion reads the `run_delta` subtree
 * of the serialised pack, never a substring of the whole prompt. `opt-a` also
 * appears in the `analysis` and `graph` slices, so a whole-prompt `toContain`
 * would pass with this wire deleted — which is the exact shortcut that let a
 * sibling slice ship two vacuous wire tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { observeSerialisedPack } from '../context/__tests__/observe-serialised-pack.js';
import { buildRunDelta } from '../coaching/build-run-delta.js';
import { PRESENT_PAIR } from '../context/__tests__/run-delta-fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';

const GRAPH = {
  schema_version: 'v3',
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    { id: 'fac_budget', kind: 'factor', label: 'Budget headroom' },
    { id: 'opt-a', kind: 'option', label: 'Offshore partner' },
    { id: 'opt-b', kind: 'option', label: 'Hire locally' },
  ],
  edges: [
    {
      from: 'fac_budget',
      to: 'goal_growth',
      edge_type: 'directed',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
  goal_node_id: 'goal_growth',
};

const CURRENT_GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH as never);
/**
 * The current fact must be the exact fresh fact selected for this canonical
 * graph. The shared pair deliberately uses illustrative hashes; this route
 * fixture replaces only the current echo with the real computed hash so a
 * stale response cannot accidentally satisfy the positive wire assertion.
 */
const TURN_PRESENT_PAIR = [
  {
    ...PRESENT_PAIR[0]!,
    fact_version: 1,
    result: {
      ...PRESENT_PAIR[0]!.result,
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt-b',
      summary: 'Hire locally is ahead in the current run.',
      graph_hash_at_run: CURRENT_GRAPH_HASH,
    },
  },
  {
    ...PRESENT_PAIR[1]!,
    fact_version: 1,
    result: {
      ...PRESENT_PAIR[1]!.result,
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt-a',
      summary: 'Offshore partner was ahead in the prior run.',
    },
  },
] as const;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    // Production-shape `SessionTurn`. `buildTurnContext` keys the fact read on
    // the row ids returned here, so a mock with an EMPTY readRecent reads ZERO
    // facts however well-formed its readFactsFor is — the suite would then pass
    // its precondition and assert the wire over an empty chain.
    readRecent: async () => [
      {
        id: 'mock-prior-run-row',
        scenario_id: SCENARIO_ID,
        user_id: null,
        turn_id: 'prior-turn',
        turn_class: 'handler',
        handler_id: 'run_analysis',
        request_hash: 'sha256:mock-prior',
        response_emitted: true,
        llm_calls_used: 1,
        duration_ms: 100,
        created_at: '2026-06-07T00:00:00.000Z',
      },
    ],
    // THE ONE THING THIS SUITE VARIES: the persisted fact chain the turn's
    // leader-claim entitlement and the run_delta pair are both derived from.
    readFactsFor: async () => TURN_PRESENT_PAIR,
    readFactsWithTurnFor: async () =>
      TURN_PRESENT_PAIR.map((fact, index) => ({
        fact,
        fact_row_id: `run-fact-row-${index}`,
        turn_id: index === 0 ? 'mock-prior-run-row' : 'mock-older-run-row',
        fact_created_at:
          (fact.result as { computed_at?: string }).computed_at ??
          '2026-06-06T00:00:00.000Z',
      })),
    // The current production authority is the uncached scenario-wide page,
    // not the hot turn window. Supply the exact same ordered pair so the test
    // proves currentness through the real durable reconciliation path.
    readScenarioRunAnalysisFactsFor: async () => ({
      facts: TURN_PRESENT_PAIR.map((fact, index) => ({
        fact,
        fact_row_id: `run-fact-row-${index}`,
        fact_created_at:
          (fact.result as { computed_at?: string }).computed_at ??
          '2026-06-06T00:00:00.000Z',
      })),
      total_count: TURN_PRESENT_PAIR.length,
    }),
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => GRAPH,
    loadGraphAndBriefText: async () => ({ graph: GRAPH, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function mkPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

function capturingAdapter() {
  return {
    chatWithTools: vi
      .fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: 'Here is some guidance.' }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

function routedUserMessage(adapter: ReturnType<typeof capturingAdapter>): string {
  expect(adapter.chatWithTools).toHaveBeenCalled();
  const args = adapter.chatWithTools.mock.calls[0]![0];
  return String(args.messages[0]!.content);
}

async function renderThroughTurnExecutor(): Promise<Record<string, unknown>> {
  const adapter = capturingAdapter();
  // ⚠ NOT a "what changed?" phrasing: that trips `v5.state_query_guard`, which
  // answers deterministically and never calls the routing LLM — the adapter is
  // then never invoked and the suite fails for a reason unrelated to the wire.
  await runTurnExecutor(mkPayload('what is the most important factor here?'), `req-${randomUUID()}`, {
    routingAdapter: adapter,
    graphState: GRAPH as never,
  });
  return observeSerialisedPack(routedUserMessage(adapter));
}

describe('run_delta leader ids survive the turn-executor → assembler hop', () => {
  beforeEach(() => setTestSink(() => undefined));
  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  /**
   * PRECONDITION PINNED IN-TEST (trap 13b). If the producer refused this pair —
   * a fixture drift in the four echoes, say — the leader assertion below would
   * fail for a reason that has nothing to do with the wire under test, and a
   * future reader would "fix" the wrong thing. Prove the consequence is
   * derivable, and that it is a LEADER CHANGE, before asserting it arrives.
   */
  it('PRECONDITION — the fixture pair yields a derivable leader change', () => {
    const built = buildRunDelta({
      priorFacts: TURN_PRESENT_PAIR,
      mayNameLeadingOption: true,
      currentLeaderDesignationPermitted: true,
    });
    expect(built.kind, 'the pair must be derivable or this suite is vacuous').toBe('ok');
    if (built.kind !== 'ok') throw new Error('unreachable');
    expect(built.delta.leader.changed, 'the pair must carry a REAL leader change').toBe(true);
    expect(built.delta.leader.prior_leading_option_id).toBe('opt-a');
    expect(built.delta.leader.current_leading_option_id).toBe('opt-b');
  });

  /**
   * ⭐ THE GUARD. Neutering `mayNameLeadingOption: mayNameLeadingOptionForRun`
   * in turn-executor.ts MUST turn this red. Proven by a discriminating mutant
   * pair, not by assertion: neutering that named symbol REDs this test, while
   * mutating a DIFFERENT `mayNameLeadingOption` call site on the same path
   * leaves it GREEN. One biting mutant would only prove sensitivity to
   * something; the pair proves sensitivity to THIS call site.
   */
  it('WIRE — an entitled turn carries the leader ids into the pack the model receives', async () => {
    const serialised = await renderThroughTurnExecutor();

    const delta = serialised.run_delta as Record<string, unknown> | undefined;
    expect(delta, '`run_delta` never reached the serialised pack — the delta wire itself is broken').toBeDefined();

    const leader = delta!.leader as Record<string, unknown>;
    // The fail-closed strip presents as `changed: true` with the ids gone, so
    // assert the IDS, not merely that a leader object exists.
    expect(leader.changed).toBe(true);
    expect(
      leader.prior_leading_option_id,
      'leader ids stripped — turn-executor is not threading mayNameLeadingOptionForRun into pack assembly',
    ).toBe('opt-a');
    expect(leader.current_leading_option_id).toBe('opt-b');
  });
});
