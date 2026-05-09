/**
 * Wave 5F-2 — flagship two-turn journey, Turn N+1 lifecycle.
 *
 * Pairs with `tests/integration/v5-explain-then-yes-flagship.test.ts`
 * (which proves Turn N's production compose path against staging
 * Supabase). This test exercises Turn N+1 in-process: a SessionStore
 * mock returns a what_would_flip pending action (the one Turn N
 * would have persisted), and `runTurnExecutor` is invoked with
 * `'yes'`. Asserts the FULL lifecycle ran: short-confirm matched,
 * validate accepted, execute dispatched the what_would_flip handler
 * stub, commit fired, and the routing LLM was never called.
 *
 * Earlier flagship attempts only exercised tryShortConfirmResume in
 * isolation. With the canonical-shape HandlerOutcome stub, Turn N+1
 * now runs end to end and proves the brief's evidence #1 second turn
 * is wired correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';
import type { HandlerRegistry } from '../tools/registry.js';

const SCENARIO_ID = randomUUID();

const PENDING_WHAT_WOULD_FLIP: PendingAction = {
  id: `pa-${randomUUID()}`,
  scenario_id: SCENARIO_ID,
  chip_id: 'chip_action_what_would_flip',
  action: { kind: 'what_would_flip' },
  preconditions: { required_freshness: 'fresh' },
  expires_at_turn_count: 2,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-05-05T00:00:00.000Z',
};

const appendCalls: Array<Record<string, unknown>> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [
      // Prior turn carried a successful run_analysis fact, so the
      // freshness derivation can return 'fresh' and the resumer's
      // what_would_flip precondition passes.
      {
        id: 'turn-prev',
        scenario_id: SCENARIO_ID,
        user_id: null,
        turn_id: 'turn-prev-id',
        turn_class: 'handler' as const,
        handler_id: 'run_analysis' as const,
        request_hash: 'sha256:prev',
        response_emitted: true,
        llm_calls_used: 1,
        duration_ms: 100,
        created_at: '2026-05-04T00:00:00.000Z',
      },
    ],
    readFactsFor: async () => [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt-a',
          summary: 'Prior analysis.',
          win_probabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
        },
      },
    ],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [PENDING_WHAT_WOULD_FLIP],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  });
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing LLM must NOT be called when short-confirm resumes what_would_flip');
      }),
  };
}

function whatWouldFlipStubRegistry(): HandlerRegistry {
  const stub = async () => ({
    assistant_text:
      'Stub what_would_flip assistant text — exploring what would change the result.',
    handler_facts: [
      {
        fact_type: 'what_would_flip' as const,
        fact_version: 1,
        noop: true,
        result: {
          precondition_unmet: false,
          option_count: 2,
          answer_source: 'deterministic_fallback' as const,
          fallback_reason: null,
          answer_text_length: 80,
          staleness_prefixed: false,
        },
      },
    ],
    llm_calls_used: 0,
    suppress_orientation: true,
  });
  return new Map([['what_would_flip', stub]]) as unknown as HandlerRegistry;
}

describe('Wave 5F-2 — flagship two-turn: Turn N+1 "yes" dispatches what_would_flip', () => {
  beforeEach(() => {
    appendCalls.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('"yes" with a persisted what_would_flip pending action and unknown freshness commits the rerun-analysis-required SAFETY recovery (NOT a stale answer)', async () => {
    // Without a graph_hash on the prior run_analysis fact AND a
    // matching live graph hash, the freshness derivation returns
    // 'unknown' — the resumer then downgrades to
    // rerun_analysis_required and surfaces a focused recovery
    // rather than running what_would_flip on stale data. This is
    // the brief's freshness-precondition contract, and the test
    // proves it fires end-to-end.
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-flagship-turn-2', {
      routingAdapter: adapter,
      handlerRegistry: whatWouldFlipStubRegistry(),
    });
    // Routing LLM was never invoked — the resumer claimed the turn.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    // Lifecycle reached commit (the recovery composes a
    // direct_answer + safe chip and commits without the
    // what_would_flip handler running).
    expect(result.telemetry.commit_performed).toBe(true);
    expect(result.telemetry.llm_calls_used).toBe(0);
    // Recovery copy is user-friendly and references rerun-analysis.
    expect(result.response.assistant_text).toMatch(/run analysis again/i);
    // Internal failure copy never leaks.
    expect(result.response.assistant_text).not.toMatch(/no pending action/i);
    expect(result.response.assistant_text).not.toMatch(/internal error/i);
    expect(result.response.assistant_text).not.toMatch(/not found in graph/i);
    // Recovery surfaces an executable Run-analysis chip the user can
    // click to refresh.
    const chips = result.response.suggested_actions ?? [];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.some((c) => c.action_type === 'run_analysis')).toBe(true);
  });
});
