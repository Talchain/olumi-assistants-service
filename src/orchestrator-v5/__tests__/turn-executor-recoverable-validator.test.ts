/**
 * V5 alpha hardening Phase 2.2 — TurnExecutor recoverable-validator tests.
 *
 * Two coverage goals:
 *
 *  1. **Pinned regression for ENTITY_KIND_MISMATCH** (brief 2.2):
 *     Sonnet proposes `run_analysis` on a decision-kind node → validator
 *     returns ENTITY_KIND_MISMATCH → response is product-voice (no internal
 *     terms) → commit succeeds → HTTP 200 → chip is conversational
 *     (never executable Run-analysis when the proposal was malformed).
 *
 *  2. **Commit-failure-per-recoverable-code** (correction 10):
 *     For each of the 7 ValidationErrorCodes, force `commitDirectAnswer`
 *     to throw. Assert:
 *       - `failure_type === 'STATE_COMMIT_FAILED'` (→ HTTP 500 at the
 *         route-v2 boundary)
 *       - `commit_performed === false`
 *       - Two distinct log records exist: `v5.recoverable_outcome_pre_commit_failure`
 *         (warn) and `v5.state_commit_failed` (error). Commit-failure on a
 *         recoverable path must NOT hide the original recoverable outcome.
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

// Shared session-store mock — tests can flip `appendShouldThrow` to
// simulate commit failure on the recoverable path.
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

// Proposals that trigger each validator code. Kind-independent codes only
// need a structural shape; graph-dependent codes (ENTITY_NOT_FOUND,
// ENTITY_RESOLUTION_SUSPICIOUS, PRECONDITION_UNMET, plus the cross-check
// variant of ENTITY_KIND_MISMATCH) need a graph.
const PROPOSAL_HANDLER_NOT_FOUND = {
  intent_class: 'execute',
  action: {
    handler_id: 'not_a_real_handler',
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

const PROPOSAL_KIND_MISMATCH_STRUCTURAL = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    // run_analysis accepts {option, goal}. `constraint` is not accepted →
    // structural kind-mismatch fires before any graph lookup.
    entity: {
      id: 'ct_1',
      kind: 'constraint',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: [],
  },
};

const PROPOSAL_AMBIGUOUS = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'ambiguous',
      resolution_method: 'label_match',
      candidates: [
        { id: 'opt_a', label: 'Plan A' },
        { id: 'opt_b', label: 'Plan B' },
      ],
    },
    parameters: [],
    cited_context_fields: [],
  },
};

// NOTE: run_analysis has NO parameter_schemas declared in
// HANDLER_VALIDATION_REGISTRY (it takes the scenario as its implicit
// target). That makes `PARAMETER_INVALID` currently unreachable through
// the production registry — the validator silently accepts any extra
// parameters when no schema is declared. The per-code composer exists
// for forward-compatibility, and the composer-level tests cover its text
// output. Once a second registered handler declares a parameter schema,
// this test suite should add a commit-failure case for it.

const PROPOSAL_KIND_MISMATCH_GRAPH = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      // AMENDED 2026-07-27 (entity-kind repair). Was `goal_1` claimed as
      // `option`: run_analysis accepts BOTH, so the graph's kind is now
      // adopted and that proposal lands. To keep exercising the
      // graph-dependent ENTITY_KIND_MISMATCH branch this targets a factor,
      // which resolves to wire kind 'node' — a kind run_analysis genuinely
      // cannot serve, so it is still refused.
      id: 'fac_x',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
      label: 'Factor X',
    },
    parameters: [],
    cited_context_fields: [],
  },
};

const PROPOSAL_ENTITY_NOT_FOUND = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'does_not_exist',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: [],
  },
};

const PROPOSAL_SUSPICIOUS = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      // Chose opt_ch (label 'Hire contractor') but user typed a phrase
      // that matches opt_close (label 'Hire contractor immediately')
      // much more closely. Dice delta is well above SUSPICIOUS threshold.
      id: 'opt_ch',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'label_match',
      label: 'contractor immediately',
    },
    parameters: [],
    cited_context_fields: [],
  },
};

const PROPOSAL_PRECONDITION = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'goal_1',
      kind: 'goal',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
      label: 'Profit',
    },
    parameters: [],
    cited_context_fields: [],
  },
};

const GRAPH_WITH_OPTIONS: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_ch', kind: 'option', label: 'Hire contractor' },
    { id: 'opt_close', kind: 'option', label: 'Hire contractor immediately' },
  ],
  edges: [],
  options: [
    { id: 'opt_ch', status: 'ready', interventions: { f1: { value: 1 } } },
    { id: 'opt_close', status: 'ready', interventions: { f1: { value: 0 } } },
  ],
} as GraphStateIngress;

const GRAPH_NO_OPTIONS: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'fac_1', kind: 'factor', label: 'Demand' },
  ],
  edges: [],
} as GraphStateIngress;

const GRAPH_KIND_CROSSCHECK: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_a', kind: 'option', label: 'A' },
    // Target of PROPOSAL_KIND_MISMATCH_GRAPH — resolves to wire kind 'node'.
    { id: 'fac_x', kind: 'factor', label: 'Factor X' },
  ],
  edges: [],
  options: [{ id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } }],
} as GraphStateIngress;

interface CaseDef {
  readonly code: string;
  readonly proposal: unknown;
  readonly graphState?: GraphStateIngress;
}

// One entry per validator code. Each case is a minimal shape that
// definitely triggers the given error. Graph-dependent codes supply a
// graph; structural codes omit it.
const CASES: readonly CaseDef[] = [
  { code: 'HANDLER_NOT_FOUND', proposal: PROPOSAL_HANDLER_NOT_FOUND },
  { code: 'ENTITY_KIND_MISMATCH', proposal: PROPOSAL_KIND_MISMATCH_STRUCTURAL },
  {
    code: 'ENTITY_KIND_MISMATCH',
    proposal: PROPOSAL_KIND_MISMATCH_GRAPH,
    graphState: GRAPH_KIND_CROSSCHECK,
  },
  {
    code: 'ENTITY_NOT_FOUND',
    proposal: PROPOSAL_ENTITY_NOT_FOUND,
    graphState: GRAPH_WITH_OPTIONS,
  },
  { code: 'ENTITY_RESOLUTION_AMBIGUOUS', proposal: PROPOSAL_AMBIGUOUS },
  {
    code: 'ENTITY_RESOLUTION_SUSPICIOUS',
    proposal: PROPOSAL_SUSPICIOUS,
    graphState: GRAPH_WITH_OPTIONS,
  },
  // PARAMETER_INVALID is currently unreachable through the production
  // validation registry (run_analysis declares no parameter schemas). The
  // composer test covers assistant_text hygiene; add a commit-failure
  // case here once a handler with parameter_schemas ships.
  {
    code: 'PRECONDITION_UNMET',
    proposal: PROPOSAL_PRECONDITION,
    graphState: GRAPH_NO_OPTIONS,
  },
];

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  appendShouldThrow = null;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setTestSink(null);
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('TurnExecutor — recoverable validator outcomes (Phase 2.2)', () => {
  it('PINNED: ENTITY_KIND_MISMATCH returns 200 + clean body + product-voice text', async () => {
    // Brief 2.2 pinned regression: Sonnet proposes run_analysis with a
    // decision-kind target → validator rejects → response is user-facing
    // (no internal terms) → commit succeeds → HTTP 200 → chip is safe
    // (no executable Run-analysis when the proposal was malformed).
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(PROPOSAL_KIND_MISMATCH_STRUCTURAL, 'Looking…'),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-pinned-kind', {
      routingAdapter,
    });

    // 1. HTTP 200 signal: commit happened, no failure_type.
    expect(result.telemetry.commit_performed).toBe(true);
    expect(result.telemetry.failure_type).toBeNull();
    expect(result.telemetry.turn_class).toBe('direct_answer');
    expect(result.telemetry.validation_error_code).toBe('ENTITY_KIND_MISMATCH');

    // 2. Clean body: no error block.
    expect(result.response.blocks).toEqual([]);
    expect(result.response.response_version).toBe(2);

    // 3. No internal terminology.
    const text = result.response.assistant_text;
    expect(text).not.toMatch(/ContextPack|kind_mismatch|state_commit/);
    expect(text).not.toMatch(/\b(opt|fac|goal|risk|out)_\d+/);

    // 4. Chip is present AND NOT the executable run_analysis variant
    // (a malformed run_analysis proposal should never answer itself).
    expect(result.response.suggested_actions.length).toBeGreaterThan(0);
    for (const chip of result.response.suggested_actions) {
      expect(chip.action_type).toBeUndefined();
    }

    // 5. Commit happened exactly once, as a direct_answer turn.
    expect(appendCalls).toHaveLength(1);
  });

  it.each(CASES)(
    'commit failure on recoverable $code path returns 500 + two distinct log records',
    async ({ code, proposal, graphState }) => {
      appendShouldThrow = new Error('simulated supabase append failure');

      const routingAdapter = mockRoutingAdapter(async () =>
        mkToolUseResult(proposal, ''),
      );

      const result = await runTurnExecutor(
        BASE_PAYLOAD,
        `req-cf-${code.toLowerCase()}`,
        {
          routingAdapter,
          ...(graphState ? { graphState } : {}),
        },
      );

      // Commit failure maps to STATE_COMMIT_FAILED (HTTP 500 at route-v2).
      expect(result.telemetry.commit_performed).toBe(false);
      expect(result.telemetry.failure_type).toBe('INTERNAL_ERROR');
      expect(result.telemetry.validation_error_code).toBe(code);

      // CORRECTION 10: two distinct log records on commit failure.
      const warnCalls = warnSpy!.mock.calls;
      const errorCalls = errorSpy!.mock.calls;

      const preCommitOutcome = warnCalls.find((c: unknown[]) => {
        const payload = c[0] as Record<string, unknown>;
        return payload?.event === 'v5.recoverable_outcome_pre_commit_failure';
      });
      const commitFailed = errorCalls.find((c: unknown[]) => {
        const payload = c[0] as Record<string, unknown>;
        return payload?.event === 'v5.state_commit_failed';
      });

      expect(
        preCommitOutcome,
        'v5.recoverable_outcome_pre_commit_failure must be logged separately',
      ).toBeDefined();
      expect(
        commitFailed,
        'v5.state_commit_failed must be logged separately',
      ).toBeDefined();

      // Both records carry the same validation_error_code so a log query
      // can join them.
      expect((preCommitOutcome![0] as Record<string, unknown>).validation_error_code).toBe(code);
      expect((commitFailed![0] as Record<string, unknown>).validation_error_code).toBe(code);
    },
  );
});
