/**
 * FIRST-RUN FALLBACK — a plain typed instruction to run the analysis must run
 * the analysis, even when the router elects nothing.
 *
 * ⭐ THE WITNESS THIS PINS. Deployed staging, capture `5376e928`,
 * 2026-09-19T14:37:55Z, build `fd65f971`. The user typed "Run the analysis."
 * The turn took 10.5s, came back `turn_kind: null`, and NO ANALYSIS RAN — the
 * served reply was the egress guard's neutral fallback. Thirty-one seconds
 * later the same user clicked the Run chip and it worked in 26.8s. Two turns
 * earlier the product had itself written 'Say "run the analysis" or just say
 * yes, and I will.' The wire proves the router ran and declined: that turn
 * carries `prompt_identity routing@121` and no `decision_review`.
 *
 * ⚠ THE FIRST ATTEMPT AT THIS FIX WAS IN THE WRONG PLACE, and these tests are
 * shaped by that. Widening the imperative RE-RUN pre-route (which claims a
 * turn BEFORE the router) made 23 tests across 9 files red, because it
 * silently disabled every mechanism that needs an election to exist. So the
 * two things most worth pinning are not the happy path at all — they are
 * (a) that the ROUTER STILL RUNS, and (b) that an ELECTION IS NEVER
 * PRE-EMPTED. Both are asserted below by identity, not by outcome.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';
import { setTestSink } from '../../src/utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';
import type { GraphStateIngress } from '../../src/orchestrator-v5/boundary/request-extensions.js';

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: {}, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../src/orchestrator-v5/routing/tool-schema.js');

function textResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function toolUseResult(input: unknown): ChatWithToolsResult {
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

function mockAdapter(result: ChatWithToolsResult) {
  return {
    chatWithTools: vi.fn<
      (a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>
    >().mockResolvedValue(result),
  };
}

function payload(message: string) {
  return makeMessagePayload({
    turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    message,
  });
}

function configuredGraph(): GraphStateIngress {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'opt_a', kind: 'option', label: 'Expand' },
      { id: 'fac_1', kind: 'factor', label: 'Demand' },
    ],
    edges: [{ from: 'fac_1', to: 'goal_1', strength: { mean: 0.5, std: 0.1 } }],
    options: [{ id: 'opt_a', status: 'ready', interventions: { fac_1: { value: 1 } } }],
  } as unknown as GraphStateIngress;
}

describe('FIRST-RUN FALLBACK — a typed run instruction reaches run_analysis', () => {
  beforeEach(() => setTestSink(() => {}));
  afterEach(() => setTestSink(null));

  it('THE WITNESS: "Run the analysis." dispatches run_analysis when the router returns text', async () => {
    const routingAdapter = mockAdapter(textResult('Happy to help — what would you like to do?'));
    const { telemetry } = await runTurnExecutor(payload('Run the analysis.'), 'req-first-run', {
      routingAdapter,
      graphState: configuredGraph(),
    });
    // BOUND BY IDENTITY, not by "something happened": the handler named must be
    // run_analysis. Before this fix the turn class was a direct answer.
    // BOUND TO FIELDS THAT EXIST. An earlier draft of this spec asserted
    // `telemetry.handler_id`, which this executor does not publish — so every
    // negative case below read `undefined !== 'run_analysis'` and passed
    // vacuously. `turn_class` and `stages_completed` are on the published
    // telemetry contract (turn-executor.ts:853-866).
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.stages_completed).toContain('validate');
  });

  it('⭐ THE ROUTER STILL RUNS — the LLM call is made and counted, not bypassed', async () => {
    const routingAdapter = mockAdapter(textResult('Happy to help — what would you like to do?'));
    const { telemetry } = await runTurnExecutor(payload('Run the analysis.'), 'req-first-run-llm', {
      routingAdapter,
      graphState: configuredGraph(),
    });
    // This is the assertion the FIRST attempt at this fix would have failed.
    // A pre-route placement bypasses the router entirely, which silently
    // disabled the observability wiring and the target-repair path.
    expect(routingAdapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(telemetry.llm_calls_used).toBeGreaterThanOrEqual(1);
  });

  it('⭐ AN ELECTION IS NEVER PRE-EMPTED — a tool_call on the same sentence is left alone', async () => {
    // Same message, but the router DOES elect. The fallback must not fire, so
    // the elected handler survives rather than being replaced by a synthesised
    // run_analysis. This is the discriminating twin of the test above: same
    // input, different router behaviour, and the fallback must read them apart.
    const routingAdapter = mockAdapter(
      toolUseResult({
        intent_class: 'clarify',
        clarification: { ambiguity_type: 'entity', question: 'Which option?' },
      }),
    );
    const { telemetry } = await runTurnExecutor(payload('Run the analysis.'), 'req-first-run-elect', {
      routingAdapter,
      graphState: configuredGraph(),
    });
    expect(telemetry.turn_class).toBe('clarify');
  });

  it('⛔ THE DANGEROUS CASE: the product\'s own chip text does NOT run an analysis', async () => {
    // Verbatim from capture 5376e928 — the assumptions chip's replayed message.
    // It contains "run the analysis", and a naive widening of the pattern would
    // have made clicking that chip EXECUTE an analysis. It declines because its
    // left context is "… before I ", which is not a licensed imperative
    // position on the verb-position allowlist.
    const routingAdapter = mockAdapter(textResult('Three assumptions look load-bearing.'));
    const { telemetry } = await runTurnExecutor(
      payload('Which assumptions in this model matter most to check before I run the analysis?'),
      'req-first-run-chip',
      { routingAdapter, graphState: configuredGraph() },
    );
    expect(telemetry.turn_class).not.toBe('handler');
    expect(telemetry.stages_completed).not.toContain('validate');
  });

  it('⛔ AN EXPLICIT REFUSAL is honoured — "Do not run the analysis." runs nothing', async () => {
    const routingAdapter = mockAdapter(textResult('Understood.'));
    const { telemetry } = await runTurnExecutor(
      payload('Do not run the analysis.'),
      'req-first-run-negated',
      { routingAdapter, graphState: configuredGraph() },
    );
    expect(telemetry.turn_class).not.toBe('handler');
    expect(telemetry.stages_completed).not.toContain('validate');
  });

  it('a question ABOUT running is answered, not executed', async () => {
    const routingAdapter = mockAdapter(textResult('You could, but the model is still thin.'));
    const { telemetry } = await runTurnExecutor(
      payload('Should I run the analysis?'),
      'req-first-run-question',
      { routingAdapter, graphState: configuredGraph() },
    );
    expect(telemetry.turn_class).not.toBe('handler');
    expect(telemetry.stages_completed).not.toContain('validate');
  });

  it('⛔ A CONDITIONAL INSTRUCTION IS NOT AN INSTRUCTION TO ACT NOW', async () => {
    // Codex's source-derived counterexample on this change. The first-run
    // patterns match the prefix "Run the analysis" and the start-of-message
    // left context licenses it, so without the deferral veto the product would
    // EXECUTE on a sentence whose whole point is to wait. Strictly worse than
    // a miss: a declined instruction costs a clarification; an executed
    // deferral runs the analysis the user asked us to hold.
    const routingAdapter = mockAdapter(textResult('Understood — I will wait.'));
    const { telemetry } = await runTurnExecutor(
      payload('Run the analysis only after I confirm.'),
      'req-first-run-deferred',
      { routingAdapter, graphState: configuredGraph() },
    );
    expect(telemetry.turn_class).not.toBe('handler');
    expect(telemetry.stages_completed).not.toContain('validate');
  });

  it('⛔ "Run the analysis when I say so." is held too — the veto is not one phrasing', async () => {
    const routingAdapter = mockAdapter(textResult('Understood.'));
    const { telemetry } = await runTurnExecutor(
      payload('Run the analysis when I say so.'),
      'req-first-run-deferred-2',
      { routingAdapter, graphState: configuredGraph() },
    );
    expect(telemetry.turn_class).not.toBe('handler');
  });

  it('a graph with NO option node declines rather than synthesising an unservable proposal', async () => {
    const routingAdapter = mockAdapter(textResult('There is nothing to compare yet.'));
    const emptyGraph = {
      nodes: [{ id: 'goal_1', kind: 'goal', label: 'Profit' }],
      edges: [],
      options: [],
    } as unknown as GraphStateIngress;
    const { telemetry } = await runTurnExecutor(
      payload('Run the analysis.'),
      'req-first-run-no-option',
      { routingAdapter, graphState: emptyGraph },
    );
    expect(telemetry.turn_class).not.toBe('handler');
    expect(telemetry.stages_completed).not.toContain('validate');
  });
});
