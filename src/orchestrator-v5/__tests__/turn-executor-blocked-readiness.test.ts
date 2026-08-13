/**
 * ROADMAP 2.1091 / golden-journey EXT-2 — the ROUTED half of "every analyse
 * path emits a typed readiness state".
 *
 * The chip-click half shipped NOTHING (see
 * `handlers/__tests__/chip-click-dispatch-blocked-readiness.test.ts`). This
 * half is the mirror defect, and it is the more dangerous of the two: the
 * routed (Sonnet-orientated) analyse turn takes the SAME recoverable-handler
 * branch, but `analysisReadyForTurn` was computed from the PRE-DISPATCH graph
 * and is never revised, so the wire ships
 *
 *     analysis_ready.status === 'ready'
 *
 * on a turn where CEE REFUSED to run the analysis. Present-but-false is worse
 * than absent: a consumer reading it concludes the run was admitted.
 *
 * CLAUDE.md trap 21 — a harm closed by one PR and re-opened by its neighbour
 * will not show up in either PR's tests. Both exits are pinned here, in one
 * change, against ONE authority.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';

import { log, setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { HandlerInvocationFailedError } from '../tools/handler-errors.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';

let appendShouldThrow: Error | null = null;
const appendCalls: Array<unknown> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      if (appendShouldThrow) throw appendShouldThrow;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

const PROPOSAL_RUN_ANALYSIS = {
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
    cited_context_fields: [],
  },
};

/**
 * A graph whose STRUCTURAL readiness is `ready` — both options carry encoded
 * numeric interventions on the node. This is the shape that makes the routed
 * defect visible: without the fix the refused turn ships `status: 'ready'`.
 */
const READY_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'fac_licence', kind: 'factor', label: 'Annual CRM Licence Cost' },
    { id: 'opt_a', kind: 'option', label: 'A', interventions: { fac_licence: 0.7 } },
    { id: 'opt_b', kind: 'option', label: 'B', interventions: { fac_licence: 0.3 } },
  ],
  edges: [],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { fac_licence: { value: 0.7 } } },
    { id: 'opt_b', status: 'ready', interventions: { fac_licence: { value: 0.3 } } },
  ],
} as unknown as GraphStateIngress;

function mkToolUseResult(input: unknown, textBefore?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (textBefore) content.push({ type: 'text', text: textBefore });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

type ChatWithToolsMock = (
  args: ChatWithToolsArgs,
  opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ChatWithToolsResult>;

function mockRoutingAdapter(impl: ChatWithToolsMock) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

/** The mixed-scale gate's exact throw (run-analysis.ts:533). */
function mixedScaleRegistry(): HandlerRegistry {
  const handler: HandlerFn = async () => {
    throw new HandlerInvocationFailedError(
      'Outbound analysis payload carries value scales CEE cannot safely resolve',
      {
        cause_kind: 'analysis_not_ready',
        retryable: false,
        details: {
          handler_id: 'run_analysis',
          scenario_id: SCENARIO_ID,
          reason_code: 'mixed_scale_unresolved',
          next_step: "I can't run this analysis safely.",
        },
      },
    );
  };
  return new Map([['run_analysis', handler]]);
}

/** A successful handler — the CONTROL arm. */
function okRegistry(): HandlerRegistry {
  const handler: HandlerFn = async () => ({
    assistant_text: 'Ran the analysis.',
    handler_facts: [],
    llm_calls_used: 0,
  });
  return new Map([['run_analysis', handler]]) as unknown as HandlerRegistry;
}

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  appendCalls.length = 0;
  appendShouldThrow = null;
  setTestSink(() => {});
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setTestSink(null);
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('EXT-2 / 2.1091 — the routed analyse arm must not report READY on a refused run', () => {
  it('RED-R1: a mixed-scale refusal is typed BLOCKED with a specific reason (pristine: ships `ready`)', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…'),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-ext2-routed-red', {
      routingAdapter,
      handlerRegistry: mixedScaleRegistry(),
      graphState: READY_GRAPH,
    });

    // Precondition PINNED IN-TEST (CLAUDE.md trap 13b): this really is the
    // recoverable branch, and the readiness payload really is present — so a
    // failure below is about the VALUE, never about the fixture.
    expect(result.telemetry.failure_type).toBeNull();
    expect(result.telemetry.turn_class).toBe('direct_answer');
    expect(result.analysisReady).toBeDefined();

    expect(result.analysisReady!.status).toBe('blocked');
    expect((result.analysisReady as { blocked_reason?: string }).blocked_reason).toBe(
      'mixed_scale_unresolved',
    );
  });

  // ⚠ HONEST LABEL: this one is NOT a RED — it passed at pristine `dbd012eb`
  // too, because the pristine payload also carried these options untouched.
  // It is a NON-RECONCILIATION FENCE: it exists to RED if a future change
  // "tidies up" by pushing the payload-level refusal down onto the per-option
  // statuses, which is the trade ROADMAP 2.1134(a) refused. Recorded as a
  // fence rather than dressed up as a RED (CLAUDE.md trap 13b — a guard that
  // agrees with itself is not evidence, and mislabelling one is how the next
  // reader stops checking).
  it('FENCE: the refused turn keeps the real options and does NOT reconcile the per-option statuses (ROADMAP 2.1134(a))', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…'),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-ext2-routed-red2', {
      routingAdapter,
      handlerRegistry: mixedScaleRegistry(),
      graphState: READY_GRAPH,
    });

    const ar = result.analysisReady!;
    expect(ar.goal_node_id).toBe('goal_1');
    expect(ar.options.map((o) => o.option_id).sort()).toEqual(['opt_a', 'opt_b']);
    // The per-option question ("do we have user-warranted values?") is
    // answered independently and stays `ready`. Only the payload-level status
    // carries this turn's refusal.
    expect(ar.options.every((o) => o.status === 'ready')).toBe(true);
  });

  it('CONTROL: an ADMITTED routed analyse turn still reports the structural status, never blocked', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…'),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-ext2-routed-control', {
      routingAdapter,
      handlerRegistry: okRegistry(),
      graphState: READY_GRAPH,
    });

    expect(result.analysisReady).toBeDefined();
    expect(result.analysisReady!.status).toBe('ready');
    expect((result.analysisReady as { blocked_reason?: string }).blocked_reason).toBeUndefined();
  });
});
