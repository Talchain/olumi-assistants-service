/**
 * ROADMAP 2.1085 (root 2.1041) / golden-journey EXT-2 — the ROUTED half of "every analyse
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
import { isRecoverableHandlerCause } from '../compose/recoverable-handler-causes.js';
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
    { id: 'dec_1', kind: 'decision', label: 'Choose an option' },
    { id: 'fac_licence', kind: 'factor', label: 'Annual CRM Licence Cost' },
    { id: 'opt_a', kind: 'option', label: 'A', interventions: { fac_licence: 0.7 } },
    { id: 'opt_b', kind: 'option', label: 'B', interventions: { fac_licence: 0.3 } },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_1', to: 'opt_b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'fac_licence', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_b', to: 'fac_licence', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_licence', to: 'goal_1', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
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

/**
 * An `add_constraint` proposal that passes validation, so the handler is
 * actually INVOKED and gets the chance to throw. Shape copied from
 * `journey-3-and-6-envelope-contract.test.ts`, which drives the same handler
 * through the same executor.
 */
const PROPOSAL_ADD_CONSTRAINT = {
  intent_class: 'execute',
  action: {
    handler_id: 'add_constraint',
    entity: {
      id: 'fac_licence',
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
      { name: 'value', value: 50000, source: 'user_explicit' },
      { name: 'unit', value: '£', source: 'user_explicit' },
    ],
    cited_context_fields: ['graph.nodes'],
  },
};

/**
 * The twin's own payload. A graph-mutating handler executes only on an
 * affirmative MUTATION WARRANT (INV-1), so "run the analysis" would leave
 * `add_constraint` held for confirmation and the handler would never be
 * invoked — the test would then pass while asserting nothing. This message
 * carries the warrant, and `nonAnalyseHandlerInvoked` proves it worked.
 */
const CONSTRAINT_PAYLOAD = makeMessagePayload({
  turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  scenario_id: SCENARIO_ID,
  message: "We can't spend more than £50,000 on the Annual CRM Licence Cost.",
  turn_class: 'frame',
  stage: 'analyse',
});

/** Observability for the twin's precondition assertion. */
let nonAnalyseHandlerInvoked = false;

/**
 * A NON-analyse handler that throws a cause which IS on
 * `RECOVERABLE_HANDLER_CAUSES` — exactly what `d1-shared/error-boundary.ts`
 * produces for a `PARAMETER_INVALID` D1 error
 * (`CAUSE_BY_D1_CODE.PARAMETER_INVALID === 'parameter_invalid_at_execute'`).
 */
function nonAnalyseRecoverableRegistry(): HandlerRegistry {
  const handler: HandlerFn = async () => {
    nonAnalyseHandlerInvoked = true;
    throw new HandlerInvocationFailedError('test-induced parameter failure', {
      cause_kind: 'parameter_invalid_at_execute',
      retryable: false,
      details: { handler_id: 'add_constraint', specific_issue: 'simulated' },
    });
  };
  return new Map([['add_constraint', handler]]) as unknown as HandlerRegistry;
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
  nonAnalyseHandlerInvoked = false;
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

describe('EXT-2 / 2.1085 (root 2.1041) — the routed analyse arm must not report READY on a refused run', () => {
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

  /**
   * ROADMAP 2.1134(a), derived at the register bytes: its ruling is "name them
   * apart; do not reconcile" — CEE's per-option readiness must never be forced
   * to agree with PLoT/ISL's `option_comparison`. The refusal payload honours
   * that in the strongest available form: it carries NO option rows, so there
   * is no per-option status for a later "tidy-up" to reconcile.
   *
   * ⚠ HONEST LABEL: this is a FENCE, not a RED — it also passed at pristine
   * `dbd012eb` (which carried no options either, because it emitted no block
   * at all). It exists to RED if a future change starts writing option rows
   * onto a refusal, which is the shape an adversarial review measured flipping
   * the deployed `DecisionOverviewCard` into a false "needs_input" state.
   */
  it('FENCE: the refused routed turn writes NO per-option status — present-but-empty carrier (ROADMAP 2.1134(a))', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…'),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-ext2-routed-red2', {
      routingAdapter,
      handlerRegistry: mixedScaleRegistry(),
      graphState: READY_GRAPH,
    });

    const ar = result.analysisReady!;
    expect(Object.keys(ar)).toContain('options');
    expect(Object.keys(ar)).toContain('goal_node_id');
    expect(ar.options).toEqual([]);
    expect(ar.goal_node_id).toBe('');
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

  /**
   * ⭐ R1 (routed arm) — the refusal must be ANALYSE-shaped, or the UI's
   * present-but-invalid path clears ten fields including the user's
   * goalConstraints / draftCoaching / preAnalysisSensitivity and the
   * sessionStorage keys. `composeRecoverableHandlerResponse` stamps the stage
   * from the REQUEST, and an analyse turn can legitimately arrive at
   * `stage: 'frame'` — measured on the witnessed run, where both the
   * successful analysis and the refusal came back `stage_indicator: 'frame'`.
   */
  it('R1: the routed refusal is ANALYSE-shaped even when the request stage is `frame`', async () => {
    const framePayload = makeMessagePayload({
      turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      scenario_id: SCENARIO_ID,
      message: 'run the analysis',
      turn_class: 'frame',
      stage: 'frame',
    });
    // PRECONDITION PINNED IN-TEST — the request really is frame-staged.
    expect(framePayload.stage).toBe('frame');

    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…'),
    );
    const result = await runTurnExecutor(framePayload, 'req-ext2-routed-r1', {
      routingAdapter,
      handlerRegistry: mixedScaleRegistry(),
      graphState: READY_GRAPH,
    });

    expect(result.response.stage_indicator).toBe('analyse');
    expect(result.response.blocks.some((b) => b.type === 'analysis_result')).toBe(false);
  });

  /**
   * ⭐ R1 OPPOSITE-DIRECTION TWIN — the stage override is scoped to the
   * ANALYSE handler exactly as the readiness marking is. A non-analyse
   * recovery must keep the REQUEST's own stage; claiming `'analyse'` on a
   * failed constraint edit would be the same class of falsehood D1 removed,
   * one field along.
   */
  it('R1 TWIN: a NON-analyse recovery keeps the request stage — the override is scoped, not global', async () => {
    const framePayload = makeMessagePayload({
      turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      scenario_id: SCENARIO_ID,
      message: "We can't spend more than £50,000 on the Annual CRM Licence Cost.",
      turn_class: 'frame',
      stage: 'frame',
    });
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(PROPOSAL_ADD_CONSTRAINT, 'Adding a limit…'),
    );
    const result = await runTurnExecutor(framePayload, 'req-ext2-routed-r1-twin', {
      routingAdapter,
      handlerRegistry: nonAnalyseRecoverableRegistry(),
      graphState: READY_GRAPH,
    });

    expect(nonAnalyseHandlerInvoked).toBe(true);
    expect(result.response.stage_indicator).toBe('frame');
  });

  /**
   * ⭐ R2/R3 (routed arm) — same SPEC invariant as the chip arm: a refusal
   * turn's freshness is in {stale, unknown} with a real reason. Never `none`
   * (clears a previously-good fact → orphaned-result banner), never `fresh`
   * (clears the local-edits dirty overlay).
   */
  it('R2/R3: the routed refusal freshness is in {stale, unknown} with a reason', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…'),
    );
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-ext2-routed-r2', {
      routingAdapter,
      handlerRegistry: mixedScaleRegistry(),
      graphState: READY_GRAPH,
    });

    expect(result.freshness).toBeDefined();
    expect(['stale', 'unknown']).toContain(result.freshness!.freshness);
    expect(typeof result.freshness!.reason).toBe('string');
    expect(result.freshness!.reason.length).toBeGreaterThan(0);
  });

  /**
   * ⭐ D1 — THE OPPOSITE-DIRECTION TWIN, and it is the reason this file exists
   * in its current form.
   *
   * TurnExecutor's recoverable-handler catch is GENERIC across every
   * registered handler. `d1-shared/error-boundary.ts` maps four D1 error codes
   * onto RECOVERABLE_HANDLER_CAUSES, so `set_factor_value`, `add_constraint`
   * and `adjust_edge_strength` all reach it. The first version of the 2.1085 (root 2.1041)
   * fix gated on `isRecoverableHandlerCause` ALONE and never consulted
   * `proposedHandlerId` — so a failed FACTOR EDIT emitted
   * `analysis_ready.status: 'blocked'` with
   * `blocked_reason: 'parameter_invalid_at_execute'`: the product claiming the
   * ANALYSIS was blocked because an EDIT failed. A defect manufactured by the
   * very change meant to stop it lying about analysis state. Reproduced by an
   * adversarial review against a base-vs-head contrast.
   *
   * Every corpus case gets its opposite-direction twin (CLAUDE.md trap 22b):
   * RED-R1 above proves the analyse handler's refusal IS marked; this proves a
   * NON-analyse handler's refusal is NOT. Together they bind the gate to the
   * named handler rather than to "any recoverable failure". The mutant that
   * removes the `proposedHandlerId === ANALYSE_HANDLER_ID` gate REDs this test
   * and leaves RED-R1 green — a discriminating pair on the handler axis.
   */
  it('D1: a NON-analyse handler failure on the same recoverable cause does NOT touch analysis_ready', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(PROPOSAL_ADD_CONSTRAINT, 'Adding a limit…'),
    );

    const result = await runTurnExecutor(CONSTRAINT_PAYLOAD, 'req-ext2-d1-twin', {
      routingAdapter,
      handlerRegistry: nonAnalyseRecoverableRegistry(),
      graphState: READY_GRAPH,
    });

    // PRECONDITIONS PINNED IN-TEST (CLAUDE.md trap 13b) — without these the
    // test could pass because the handler was never invoked, or because the
    // failure was fatal rather than recoverable, and would then be asserting
    // nothing about the gate.
    expect(nonAnalyseHandlerInvoked).toBe(true);
    expect(result.telemetry.failure_type).toBeNull();
    expect(result.telemetry.turn_class).toBe('direct_answer');
    expect(isRecoverableHandlerCause('parameter_invalid_at_execute')).toBe(true);

    // THE ASSERTION: an edit failure is not an analysis refusal.
    expect(result.analysisReady).toBeDefined();
    expect(result.analysisReady!.status).not.toBe('blocked');
    expect((result.analysisReady as { blocked_reason?: string }).blocked_reason).toBeUndefined();
  });
});
