/**
 * P0 — THE ANALYSE REFUSAL MUST SURVIVE ITS OWN COMMIT.
 *
 * Witnessed on deployed staging 2026-08-29 (CEE build `fc08ac6`, guest
 * scenario `cc591488-…`): three consecutive composer `stage: "analyse"` turns
 * returned HTTP 500 `turn_commit` / `state_commit_failed_or_turn_runtime_failure`
 * with `stages_completed` ending at `handler_recovery` — the honest, specific
 * refusal was COMPOSED and then discarded, and the user saw only
 * "Something went wrong on our side."
 *
 * Root cause, read at the live Render log rather than inferred from the error
 * string (which names two different failures under one code):
 *
 *   append_turn_atomic_v2 RPC failed: new row for relation
 *   "v5_conversation_turns" violates check constraint
 *   "v5_conversation_turns_handler_id_biconditional"
 *
 * That constraint (supabase/migrations/20260417160000_v5_session_store.sql) is
 *
 *   CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL))
 *
 * a strict BICONDITIONAL. The recovery arm in `turn-executor.ts` committed
 * `turn_class: 'direct_answer'` together with `handler_id: 'run_analysis'`
 * whenever it persisted an analysis-refusal continuity fact — a pair the
 * database rejects. The chip_click arm
 * (`handlers/chip-click-dispatch.ts`) commits `turn_class: 'handler'` with the
 * same `handler_id`, which is why the deployed Rerun control refused CLEANLY
 * on the identical graph in the same minute. The two arms disagreed about the
 * same event (CLAUDE.md trap 21).
 *
 * WHY EVERY EXISTING TEST WAS GREEN: the executor specs mock
 * `getSessionStore().append`, and a mock accepts any (turn_class, handler_id)
 * pair. The only enforcer of this invariant lived in Postgres, so no unit test
 * in the estate could observe the violation. These tests move the invariant to
 * where the specs can see it, by asserting the SHAPE OF THE WRITE that reaches
 * the store.
 *
 * The invariant below is written against the SPEC (the constraint), not
 * against the failure mode — so it also REDs on the opposite violation
 * (`turn_class: 'handler'` with a null `handler_id`).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';

import { log, setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import {
  HandlerInvocationFailedError,
  type HandlerInvocationFailedCause,
} from '../tools/handler-errors.js';
import type { HandlerFn, HandlerOutcome, HandlerRegistry } from '../tools/registry.js';

type HandlerOutcomeFacts = HandlerOutcome['handler_facts'];

interface CapturedWrite {
  readonly turn_class?: unknown;
  readonly handler_id?: unknown;
  readonly handler_facts?: readonly unknown[];
}

const appendCalls: CapturedWrite[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write as CapturedWrite);
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

const GRAPH_WITH_OPTIONS: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } },
    { id: 'opt_b', status: 'ready', interventions: { f1: { value: 0 } } },
  ],
} as GraphStateIngress;

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

function mockRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation((async () =>
        mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…')) as never),
  };
}

function makeThrowingRegistry(cause_kind: HandlerInvocationFailedCause): HandlerRegistry {
  const handler: HandlerFn = async () => {
    throw new HandlerInvocationFailedError('test-induced failure', {
      cause_kind,
      retryable: false,
      details: { handler_id: 'run_analysis', specific_issue: 'simulated' },
    });
  };
  return new Map([['run_analysis', handler]]);
}

// A value no other fact in this file carries, so the success twin binds to
// THIS handler's own output by identity rather than to composer copy that a
// different turn could also produce (CLAUDE.md trap 19).
const SUCCESS_SUMMARY = 'biconditional-success-twin-leading-option';

function makeSucceedingRegistry(): HandlerRegistry {
  const handler: HandlerFn = async () => ({
    assistant_text: 'Leeds leads on the current model.',
    handler_facts: [
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_a',
          summary: SUCCESS_SUMMARY,
          computed_at: new Date().toISOString(),
        },
      },
    ] as unknown as HandlerOutcomeFacts,
    llm_calls_used: 0,
  });
  return new Map([['run_analysis', handler]]);
}

/**
 * THE SPEC, restated from the migration rather than from the symptom.
 * `v5_conversation_turns_handler_id_biconditional`:
 *   CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL))
 */
function assertBiconditional(write: CapturedWrite, label: string): void {
  const isHandlerClass = write.turn_class === 'handler';
  const hasHandlerId = write.handler_id !== null && write.handler_id !== undefined;
  expect(
    isHandlerClass,
    `${label}: turn_class=${String(write.turn_class)} handler_id=${String(
      write.handler_id,
    )} violates v5_conversation_turns_handler_id_biconditional`,
  ).toBe(hasHandlerId);
}

let events: Array<{ event: string; data: Record<string, unknown> }> = [];
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
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

describe('TurnExecutor — the analyse refusal survives its own commit', () => {
  // The premise this whole file rests on is DERIVED from the migration, not
  // mirrored by hand: if the constraint is ever changed, these tests are
  // asserting a rule the database no longer has, and that must fail loudly
  // rather than pass for a stale reason (CLAUDE.md trap 12).
  it('the biconditional this file enforces is still the deployed constraint', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migration = readFileSync(
      path.resolve(here, '../../../supabase/migrations/20260417160000_v5_session_store.sql'),
      'utf8',
    );
    expect(migration).toContain('v5_conversation_turns_handler_id_biconditional');
    expect(migration.replace(/\s+/g, ' ')).toContain(
      "CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL))",
    );
  });

  // THE DEFECT. Both continuity causes, so the guard is not pinned to one
  // string — a fix that special-cases `analysis_not_ready` alone still REDs.
  it.each(['analysis_not_ready', 'analysis_blocked'] as const)(
    'a refused analyse turn (%s) commits a write the database will accept',
    async (cause) => {
      const result = await runTurnExecutor(BASE_PAYLOAD, `req-bicond-${cause}`, {
        routingAdapter: mockRoutingAdapter(),
        handlerRegistry: makeThrowingRegistry(cause),
        graphState: GRAPH_WITH_OPTIONS,
      });

      expect(appendCalls.length, `${cause}: no commit was attempted`).toBeGreaterThan(0);
      const write = appendCalls[appendCalls.length - 1]!;

      // Bind by IDENTITY, not by a predicate another write could satisfy:
      // this is the analysis-refusal continuity write specifically.
      expect(write.handler_id, cause).toBe('run_analysis');
      expect(write.handler_facts?.length ?? 0, cause).toBeGreaterThan(0);

      assertBiconditional(write, `refused analyse turn (${cause})`);

      // And the user-facing consequence the P0 is actually about: the turn
      // commits, so route-v2 ships the composed refusal on a 200 instead of
      // replacing it with a generic apology on a 500.
      expect(result.telemetry.commit_performed, cause).toBe(true);
      expect(result.telemetry.failure_type, cause).toBeNull();
      expect(result.response.assistant_text.length, cause).toBeGreaterThan(0);
    },
  );

  // OPPOSITE-DIRECTION TWIN. The lazy fix — always commit `turn_class:
  // 'handler'` on the recovery arm — satisfies the database for the refusal
  // case and breaks it for every other recoverable cause, which persists no
  // handler fact and must keep `handler_id: null`. A recovery that is not an
  // analysis refusal must not acquire a handler identity.
  it.each(['args_validation_failed', 'entity_not_found_in_graph'] as const)(
    'a non-refusal recovery (%s) stays a handler-less direct_answer',
    async (cause) => {
      await runTurnExecutor(BASE_PAYLOAD, `req-bicond-twin-${cause}`, {
        routingAdapter: mockRoutingAdapter(),
        handlerRegistry: makeThrowingRegistry(cause),
        graphState: GRAPH_WITH_OPTIONS,
      });

      expect(appendCalls.length, `${cause}: no commit was attempted`).toBeGreaterThan(0);
      const write = appendCalls[appendCalls.length - 1]!;

      expect(write.handler_id, cause).toBeNull();
      expect(write.turn_class, cause).toBe('direct_answer');
      assertBiconditional(write, `non-refusal recovery (${cause})`);
    },
  );

  // THE SUCCESS TWIN. A fix that stops discarding refusals must not start
  // accepting states that are genuinely invalid, and must not disturb the
  // turn that legitimately succeeds: it still commits and still returns its
  // own result.
  it('an analyse turn that succeeds still commits and still returns its result', async () => {
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-bicond-success', {
      routingAdapter: mockRoutingAdapter(),
      handlerRegistry: makeSucceedingRegistry(),
      graphState: GRAPH_WITH_OPTIONS,
    });

    expect(appendCalls.length, 'no commit was attempted').toBeGreaterThan(0);
    const write = appendCalls[appendCalls.length - 1]!;

    assertBiconditional(write, 'successful analyse turn');
    expect(write.turn_class).toBe('handler');
    expect(write.handler_id).toBe('run_analysis');

    // The handler's OWN result survived the commit — bound by a value only
    // this handler emits, not by composed narrative copy.
    const summaries = (write.handler_facts ?? []).map(
      (f) => (f as { result?: { summary?: unknown } }).result?.summary,
    );
    expect(summaries).toContain(SUCCESS_SUMMARY);

    expect(result.telemetry.commit_performed).toBe(true);
    expect(result.telemetry.failure_type).toBeNull();
  });
});
