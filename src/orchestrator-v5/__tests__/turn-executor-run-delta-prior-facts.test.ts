/**
 * THE EXECUTOR HALF OF THE `run_delta` HAND-OFF — what `finalizeRun` puts on
 * `TurnExecutorRunResult.priorFacts`, and when it puts nothing there.
 *
 * ⭐⭐ WHY THIS FILE EXISTS. `route-v2-run-delta-threading.test.ts` proves the
 * ROUTE hop: given a run result carrying `priorFacts`, `run_delta` reaches the
 * wire. It cannot prove anything about the EXECUTOR, because it MOCKS
 * `runTurnExecutor` and supplies `priorFacts` itself — so deleting the
 * executor's assignment entirely leaves it 3/3 GREEN. That is the same
 * "half the change is unpinned" property that let the producer merge dark in
 * the first place, reproduced one layer up. This file is the other half: it
 * runs the REAL executor, through the REAL run_analysis handler, and asserts
 * what the exit actually emits.
 *
 * ⚠ THE TWO PROPERTIES IT PINS ARE THE TWO THINGS AN EARLIER VERSION GOT WRONG,
 * and both were MEASURED on this branch before the fix:
 *
 *   1. THE WINDOW. The assignment used to be `context.prior_facts` — the
 *      turn-ENTRY window, which this file's subject never reassigns. So on a
 *      rerun the `run_analysis` fact the turn had just produced was ABSENT from
 *      it, and the emitted pair was (A′, A): the run that just completed did
 *      not appear in its own consequence block. `compare-runs.ts` states the
 *      invariant this violates in as many words — `pair.current` IS the fact
 *      the turn's freshness verdict was derived from.
 *
 *   2. THE GATE. The assignment used to be UNCONDITIONAL, on an exit with 46
 *      return sites. Measured consequence: a coach-shaped turn with
 *      `analysis_ready: null` shipped `run_delta` with `leader.changed: true`,
 *      against a contract that emits ONE block per COMPLETED RERUN.
 *
 * ⚠ EVERY ARM PINS ITS OWN PRECONDITION IN-TEST. The negative arm seeds a
 * window that genuinely YIELDS A PAIR and asserts so before asserting absence —
 * otherwise "no `priorFacts`" would pass just as happily on a fixture that
 * silently stopped producing runs, and the guard would be agreeing with itself
 * (CLAUDE.md trap 13b). The positive arm binds `pair.current` to the committed
 * fact BY OBJECT IDENTITY, never by a value predicate another fact could
 * satisfy (trap 19).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

// Session store mock — `appendCalls` gives us the AUTHORITATIVE record of what
// this turn committed, which is what the positive arm binds identity against.
const appendCalls: Array<unknown> = [];
const priorTurnRows: Array<unknown> = [];
const priorFactRows: Array<HandlerFact> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => priorTurnRows,
    readFactsFor: async () => priorFactRows,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
}));

import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../tools/handlers/run-analysis.js';

const { runTurnExecutor } = await import('../turn-executor.js');
const { createRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
// The PRODUCER's own pair selector — called, never re-implemented, so this test
// asks exactly the question `build-run-delta.ts` asks.
const { selectTwoNewestRunAnalysisFacts } = await import('../coaching/compare-runs.js');

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

const RUN_ANALYSIS_TOOL_CALL_INPUT = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

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

/** A CONVERSE turn: routing dispatches no handler, so the turn completes no run. */
const CONVERSE_TOOL_CALL_INPUT = { intent_class: 'converse' };

function makeGoldenResponse(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    results: [
      { option_id: 'opt_a', option_label: 'A', win_probability: 0.6 },
      { option_id: 'opt_b', option_label: 'B', win_probability: 0.4 },
    ],
    response_hash: 'h-top',
    analysis_status: 'completed',
  } as V2RunResponseEnvelope;
}

function makeScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { f: 1 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { f: 0 } },
    ],
    goal_node_id: 'g',
  };
}

function makeMockPlotClient(): PLoTClient {
  return {
    run: vi.fn(async () => makeGoldenResponse()),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

function mockRoutingAdapter(input: unknown) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation((async () => mkToolUseResult(input)) as never),
  };
}

/**
 * A persisted prior run. `graphHash` is a SENTINEL: it is how each seeded fact
 * is identified below, so no assertion has to lean on a value (a win
 * probability, a timestamp) that a different fact could also carry.
 */
function priorRunFact(graphHash: string, computedAt: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: TEST_SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'prior run',
      enrichment: makeGoldenResponse(),
      computed_at: computedAt,
      graph_hash_at_run: graphHash,
    },
  } as unknown as HandlerFact;
}

function seedPriorTurn(rowId: string, turnId: string, createdAt: string): void {
  priorTurnRows.push({
    id: rowId,
    scenario_id: TEST_SCENARIO_ID,
    turn_id: turnId,
    turn_class: 'handler',
    handler_id: 'run_analysis',
    created_at: createdAt,
    response_emitted: true,
  });
}

/** The single `run_analysis` fact this turn committed, off the commit write. */
function committedRunFact(): HandlerFact {
  expect(appendCalls).toHaveLength(1);
  const write = appendCalls[0] as { handler_facts: HandlerFact[] };
  const runFacts = write.handler_facts.filter((f) => f.fact_type === 'run_analysis');
  // PRECONDITION PIN: the turn genuinely completed exactly one run. Without
  // this, every assertion below could pass on a turn that ran nothing.
  expect(runFacts).toHaveLength(1);
  return runFacts[0]!;
}

function graphHashOf(fact: HandlerFact): unknown {
  return (fact as unknown as { result?: { graph_hash_at_run?: unknown } }).result?.graph_hash_at_run;
}

beforeEach(() => {
  appendCalls.length = 0;
  priorTurnRows.length = 0;
  priorFactRows.length = 0;
  setTestSink(() => {});
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('finalizeRun → TurnExecutorRunResult.priorFacts (the run_delta basis)', () => {
  it('RERUN → the basis CONTAINS the run this turn just completed, and that run is `pair.current`', async () => {
    seedPriorTurn('row-prior-1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2026-07-15T00:00:00.000Z');
    const seeded = priorRunFact('hash-prior', '2026-07-15T00:00:00.000Z');
    priorFactRows.push(seeded);

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-rd-rerun', {
      routingAdapter: mockRoutingAdapter(RUN_ANALYSIS_TOOL_CALL_INPUT),
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
    });

    const committed = committedRunFact();

    // ── PRECONDITION PIN ────────────────────────────────────────────────────
    // The entry window (what the first version of this field threaded) holds
    // exactly ONE run and therefore yields NO PAIR AT ALL. So if the assertions
    // below hold, they hold BECAUSE the exit widened the window — they cannot
    // be satisfied by the entry window, and this test cannot pass vacuously.
    expect(selectTwoNewestRunAnalysisFacts(priorFactRows)).toBeNull();
    // And the committed fact is genuinely not in that window.
    expect(priorFactRows).not.toContain(committed);

    // ── THE PIN ─────────────────────────────────────────────────────────────
    expect(result.priorFacts).toBeDefined();
    // Identity, not a value predicate: the very object the commit wrote.
    expect(result.priorFacts).toContain(committed);

    const pair = selectTwoNewestRunAnalysisFacts(result.priorFacts!);
    expect(pair).not.toBeNull();
    // ⭐ THE G1 ASSERTION. `pair.current` is THIS turn's run — the design of
    // record's "(prior fact A, NEW RUN B)" — not the newest fact that happened
    // to already be in the window.
    expect(pair!.current).toBe(committed);
    // …and the older side is the seeded run, bound by its sentinel hash.
    expect(graphHashOf(pair!.prior)).toBe('hash-prior');
  });

  it('CONVERSE (no run completed) → NO basis at all, even though the window HOLDS a comparable pair', async () => {
    seedPriorTurn('row-prior-1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2026-07-15T00:00:00.000Z');
    seedPriorTurn('row-prior-2', 'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-07-16T00:00:00.000Z');
    priorFactRows.push(priorRunFact('hash-older', '2026-07-15T00:00:00.000Z'));
    priorFactRows.push(priorRunFact('hash-newer', '2026-07-16T00:00:00.000Z'));

    // ── PRECONDITION PIN, AND IT IS THE WHOLE POINT OF THIS ARM ─────────────
    // The seeded window YIELDS A PAIR. So a `run_delta` is fully constructible
    // from it, and the absence asserted below is the GATE's doing rather than
    // the fixture quietly failing to produce runs. Without this line the test
    // would pass on an empty window and prove nothing (trap 13b).
    expect(selectTwoNewestRunAnalysisFacts(priorFactRows)).not.toBeNull();

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-rd-converse', {
      routingAdapter: mockRoutingAdapter(CONVERSE_TOOL_CALL_INPUT),
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
    });

    // PRECONDITION PIN: this really was a non-execute turn — no handler ran.
    expect(result.telemetry.turn_class).toBe('direct_answer');

    // ⭐ THE G2 ASSERTION. Absent, so the finaliser stamps nothing and the user
    // is not shown a run-over-run consequence for a turn that ran no run.
    expect(result.priorFacts).toBeUndefined();
  });

  it('FIRST run → basis PRESENT but no pair: the gate asks "did a run complete", not "is there a pair"', async () => {
    // The two questions live in different places on purpose. The exit answers
    // the first; `selectTwoNewestRunAnalysisFacts` answers the second and
    // refuses with `insufficient_runs`. Collapsing them into the exit would put
    // the producer's judgement in the executor.
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-rd-first', {
      routingAdapter: mockRoutingAdapter(RUN_ANALYSIS_TOOL_CALL_INPUT),
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
    });

    const committed = committedRunFact();
    expect(result.priorFacts).toBeDefined();
    expect(result.priorFacts).toContain(committed);
    // One run in the window ⇒ the producer declines. No delta, no fabrication.
    expect(selectTwoNewestRunAnalysisFacts(result.priorFacts!)).toBeNull();
  });
});
