/**
 * SELECTION-AWARE ANSWERING (hop 4b) — THE EXECUTOR WIRE, PROVEN END TO END.
 *
 * ⭐⭐ WHY THIS FILE EXISTS. `projectGroundedSelection` has its own unit suite
 * and it is fully green — and the capability is still DARK if the ONE line in
 * `turn-executor.ts` that captures `contextPack.focus` is missing, wrong, or
 * never reached. A defended pure function with a dark call site is this
 * estate's chronic failure #1: 42 roadmap items have been working code no user
 * could reach.
 *
 * So this file asserts the field through the REAL chain —
 *
 *     runTurnExecutor(payload, { selectedElements })
 *       → buildTurnContext        (resolves the selection against the graph)
 *       → assembleContextPackWithSummary (projects `focus`)
 *       → capturedFocus = contextPack.focus     ← THE WIRE, HALF ONE
 *       → finalizeRun             (projects it onto the run result)
 *
 * — and reads its evidence off `runTurnExecutor`'s RETURN VALUE, which is the
 * object route-v2 threads into `ctx.groundedSelection`. Nothing here inspects
 * an intermediate: cut the wire anywhere along it and these tests go red.
 *
 * The harness (persisted graph, store mocks, `textOnlyAdapter`) is the one from
 * `selection-focus-route-level.test.ts`, deliberately unchanged, so hop 4 and
 * hop 4b are observed on the SAME turn shape rather than on two private worlds.
 *
 * THE TWO CONTROLS ARE THE POINT (trap #13, at capability scale):
 *   · NO SELECTION       — the key must be ABSENT, not null, not empty. This is
 *     the byte-identity guarantee the sidecar is sold on.
 *   · A FAILED TURN      — error copy is not an answer about the selected
 *     element, so a consumer must not be told to highlight the canvas off one.
 *     Its precondition (`failure_type !== null`) is pinned IN-TEST, so it
 *     cannot pass by silently having run a successful turn.
 *
 * SCOPE, STATED HONESTLY (status ladder). This proves what the EXECUTOR
 * RETURNS. That the field then reaches the HTTP body is a separate claim,
 * proven separately in `tests/integration/orchestrator/route-v2-grounded-selection
 * .test.ts`. Rung reached here: TESTED.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

const SCENARIO_ID = randomUUID();

const FACTOR_ID = 'factor_salary';
const FACTOR_LABEL = 'Engineer salary in the local market';
const OPTION_ID = 'opt_local';
const OPTION_LABEL = 'Hire locally';

/**
 * The PERSISTED graph the session store returns — this is what
 * `resolveTurnSelection` resolves the selection against, so the ids on the wire
 * come from HERE and never from the client's claim.
 */
const PERSISTED_GRAPH = {
  nodes: [
    {
      id: FACTOR_ID,
      kind: 'factor',
      label: FACTOR_LABEL,
      description: 'What a senior engineer costs in this market.',
      category: 'external',
      observed_state: { value: 95000, unit: 'GBP', source: 'user_edited' },
    },
    {
      id: 'factor_ramp',
      kind: 'factor',
      label: 'Ramp-up time for a new joiner',
      observed_state: { value: 12, unit: 'weeks', source: 'cee_inference' },
    },
    { id: OPTION_ID, kind: 'option', label: OPTION_LABEL },
    { id: 'opt_offshore', kind: 'option', label: 'Offshore partner' },
    { id: 'goal_rev', kind: 'goal', label: 'Revenue growth over the next year' },
  ],
  edges: [{ from: FACTOR_ID, to: 'goal_rev', strength: { mean: 0.4, std: 0.1 } }],
};

vi.mock('../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
  resetRollingSummaryForTests: () => undefined,
}));

/** A PRIOR RUN_ANALYSIS on this scenario, so the focus join has something to link. */
const ANALYSIS_TURN_ROW_ID = 'cccccccc-7a15-4ccc-8ccc-cccccccccccc';
const ANALYSIS_TURN = {
  id: ANALYSIS_TURN_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
  user_message: 'Run the analysis',
  assistant_message: 'Analysis complete.',
};

const RUN_ANALYSIS_FACT: Record<string, unknown> = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    leading_option_id: OPTION_ID,
    summary: 'Prior analysis result',
    graph_hash_at_run: computeAnalysisAffectingGraphHash(PERSISTED_GRAPH as never),
    computed_at: new Date(Date.now() - 60_000).toISOString(),
    enrichment: {
      analysis_status: 'completed',
      option_comparison: [
        { option_id: OPTION_ID, option_label: OPTION_LABEL, win_probability: 0.62, outcome_mean: 0.5 },
        { option_id: 'opt_offshore', option_label: 'Offshore partner', win_probability: 0.38, outcome_mean: 0.3 },
      ],
    },
    win_probabilities: { [OPTION_ID]: 0.62, opt_offshore: 0.38 },
  },
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (_id: string, limit = 20) => [ANALYSIS_TURN].slice(0, limit),
    countTurns: async () => 1,
    readFactsFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.includes(ANALYSIS_TURN_ROW_ID) ? [RUN_ANALYSIS_FACT] : [],
    readFactsWithTurnFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.includes(ANALYSIS_TURN_ROW_ID)
        ? [
            {
              fact: RUN_ANALYSIS_FACT,
              turn_id: ANALYSIS_TURN_ROW_ID,
              fact_created_at: new Date(Date.now() - 60_000).toISOString(),
            },
          ]
        : [],
    readNewestAnalysisFactFor: async () => RUN_ANALYSIS_FACT,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => PERSISTED_GRAPH,
    loadGraphAndBriefText: async () => ({
      graph: PERSISTED_GRAPH,
      briefText: 'Hire locally or engage an offshore partner?',
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
type RunResult = Awaited<ReturnType<typeof runTurnExecutor>>;

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function textOnlyAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
  calls: ChatWithToolsArgs[];
} {
  const calls: ChatWithToolsArgs[] = [];
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        calls.push(args);
        return {
          content: [{ type: 'text', text: 'Here is what I would focus on.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 40 } as ChatWithToolsResult['usage'],
          model: 'claude-sonnet-4-6',
          latencyMs: 25,
        };
      },
    },
  };
}

/**
 * An adapter whose model output is EMPTY — the `empty_response` routing failure.
 * The pack (and therefore `capturedFocus`) is assembled BEFORE this call, so
 * this is precisely the state the `failureType === null` conjunct exists to
 * exclude: grounded prompt, failed turn.
 */
function failingAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
} {
  return {
    adapter: {
      chatWithTools: async () => ({
        content: [],
        stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 0 } as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 25,
      }),
    },
  };
}

async function runTurn(
  message: string,
  selectedElements?: { node_ids: readonly string[]; edge_ids: readonly string[] } | null,
  adapter = textOnlyAdapter().adapter,
): Promise<RunResult> {
  return runTurnExecutor(payload(message), `req-${randomUUID()}`, {
    routingAdapter: adapter,
    ...(selectedElements !== undefined ? { selectedElements } : {}),
  });
}

const QUESTION = 'why does this one matter?';

beforeEach(() => {
  setTestSink(() => undefined);
});
afterEach(() => {
  setTestSink(null);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// THE WIRE — the grounded selection reaches the run result through the real chain
// ---------------------------------------------------------------------------

describe('hop 4b executor wire — the selection the answer was grounded on reaches the run result', () => {
  it('a selected FACTOR arrives on `run.groundedSelection` with its CANONICAL id', async () => {
    const run = await runTurn(QUESTION, { node_ids: [FACTOR_ID], edge_ids: [] });
    expect(
      run.groundedSelection,
      'no `groundedSelection` on the run result — the turn-executor capture is cut',
    ).toBeDefined();
    // Bound by IDENTITY, never by a predicate another node could satisfy.
    expect(run.groundedSelection!.element_ids).toEqual([FACTOR_ID]);
    expect(run.groundedSelection!.unresolved).toBe('none');
  });

  it('DISCRIMINATING PAIR — selecting the OPTION instead puts a DIFFERENT id on the wire', async () => {
    const a = await runTurn(QUESTION, { node_ids: [FACTOR_ID], edge_ids: [] });
    const b = await runTurn(QUESTION, { node_ids: [OPTION_ID], edge_ids: [] });
    // Both arms positively…
    expect(a.groundedSelection!.element_ids).toEqual([FACTOR_ID]);
    expect(b.groundedSelection!.element_ids).toEqual([OPTION_ID]);
    // …and the INEQUALITY, which is the half that proves the field tracks the
    // selection rather than emitting a constant.
    expect(a.groundedSelection!.element_ids).not.toEqual(b.groundedSelection!.element_ids);
  });

  it('an UNRESOLVED id alongside a resolved one carries only the RESOLVED id, and discloses why', async () => {
    const run = await runTurn(QUESTION, {
      node_ids: [FACTOR_ID, 'ghost_node'],
      edge_ids: [],
    });
    expect(run.groundedSelection).toBeDefined();
    // Nothing invented for the ghost, nothing silently dropped without a reason.
    expect(run.groundedSelection!.element_ids).toEqual([FACTOR_ID]);
    expect(run.groundedSelection!.unresolved).toBe('not_in_model');
  });

  it('an ALL-UNRESOLVED selection is honestly empty rather than absent — the turn was still grounded', async () => {
    const run = await runTurn(QUESTION, { node_ids: ['ghost_a', 'ghost_b'], edge_ids: [] });
    // Present, because the user DID point at something and the model was told
    // so; empty ids + `not_in_model` is the honest report of what came back.
    expect(run.groundedSelection).toBeDefined();
    expect(run.groundedSelection!.element_ids).toEqual([]);
    expect(run.groundedSelection!.unresolved).toBe('not_in_model');
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL 1 — no selection ⇒ the KEY IS ABSENT
// ---------------------------------------------------------------------------

describe('hop 4b executor wire — NEGATIVE CONTROL: the same question without a selection', () => {
  it('produces NO `groundedSelection` — the KEY is absent, not null and not empty', async () => {
    const run = await runTurn(QUESTION, null);
    expect(run.groundedSelection).toBeUndefined();
    // `in` is the assertion that distinguishes an absent key from a
    // present-but-undefined one, which is what the wire byte-identity claim
    // actually rests on.
    expect('groundedSelection' in run).toBe(false);
  });

  it('PAIR — the same question, same harness, differs ONLY by the selection', async () => {
    // Without this pair the control above could pass because the field never
    // appears at all (trap #13: an absence assertion needs a matching presence).
    const selected = await runTurn(QUESTION, { node_ids: [OPTION_ID], edge_ids: [] });
    const generic = await runTurn(QUESTION, null);
    expect(selected.groundedSelection).toBeDefined();
    expect(generic.groundedSelection).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL 2 — a FAILED turn is not an answer about the selection
// ---------------------------------------------------------------------------

/**
 * ⭐ THE `failureType === null` CONJUNCT, PINNED.
 *
 * `capturedFocus` is set when the ContextPack is assembled, which happens
 * BEFORE the routing call. So a turn can be fully grounded and then FAIL — and
 * on that turn the user reads error copy, not an answer about the element they
 * selected. A consumer highlighting the canvas off it would be told "this
 * answer is about that node" while the answer says the turn broke.
 *
 * Both preconditions are pinned IN-TEST (trap #13b), because without them this
 * test passes just as happily on a turn that never failed and never grounded:
 *   (a) the turn really FAILED  — `telemetry.failure_type !== null`;
 *   (b) the same selection really DOES ground a SUCCESSFUL turn — the twin.
 */
describe('hop 4b executor wire — NEGATIVE CONTROL: a FAILED turn carries no grounded selection', () => {
  it('PRECONDITION (b) — this selection DOES ground the same turn when it succeeds', async () => {
    const ok = await runTurn(QUESTION, { node_ids: [FACTOR_ID], edge_ids: [] });
    expect(ok.telemetry.failure_type).toBeNull();
    expect(ok.groundedSelection).toBeDefined();
  });

  it('a grounded turn that FAILS omits `groundedSelection` entirely', async () => {
    const run = await runTurn(
      QUESTION,
      { node_ids: [FACTOR_ID], edge_ids: [] },
      failingAdapter().adapter,
    );
    // PRECONDITION (a): this really is a failure turn. If the harness ever
    // stops failing, THIS assertion goes red rather than the test passing
    // vacuously against a successful run.
    expect(
      run.telemetry.failure_type,
      'the failing adapter no longer produces a failure — this control is vacuous',
    ).not.toBeNull();
    // THE CLAIM: no canvas highlight off error copy.
    expect(run.groundedSelection).toBeUndefined();
    expect('groundedSelection' in run).toBe(false);
  });
});
