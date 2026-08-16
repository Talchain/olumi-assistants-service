/**
 * P0 WIRING PIN — the degraded-extraction guard must be CONNECTED, not
 * merely present.
 *
 * The unit tests in `routing/__tests__/deterministic-value-update.degraded.test.ts`
 * prove the GUARD works. They cannot prove it is WIRED: severing both
 * production call sites in `turn-executor.ts` compiles clean and passes
 * the entire suite. This test closes that gap by driving the real
 * `runTurnExecutor` lifecycle.
 *
 * WHY NOT "make the parameter required" INSTEAD:
 * a required parameter forces a caller to pass SOMETHING, so it catches
 * NON-wiring — but a severed site that passes a literal `false` still
 * compiles, so it does NOT catch MIS-wiring (the guard connected to the
 * wrong value). Only an end-to-end assertion distinguishes "passes the
 * real `cqeSummary.degraded`" from "passes a constant". That is the
 * failure mode worth pinning, so this is the mechanism chosen.
 *
 * Harness mirrors `d1-golden-path-closure.test.ts`: the routing adapter
 * THROWS if called, so "pre-route dispatched" and "fell through to the
 * LLM" are distinguishable without inspecting internals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { CqeExtractionOutput } from '../context/cqe/extract-quantities.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown }) => ({
      id: 'mock-row-id',
      ...(write.graph != null
        ? { graph_write_disposition: 'accepted_insert' as const }
        : {}),
    }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

/**
 * Wrap the REAL extractor and flip only `summary.degraded`. Results are
 * left untouched, so the two arms differ in exactly one bit — the bit the
 * guard is supposed to read. Uses `importOriginal` rather than a
 * hand-written module stub so the mock cannot drift from the real module
 * surface (the `vi.mock`-factory-replaces-the-module trap).
 */
const degradedFlag = { value: false };

vi.mock('../context/cqe/extract-quantities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/cqe/extract-quantities.js')>();
  return {
    ...actual,
    runExtraction: (raw: string): CqeExtractionOutput => {
      const out = actual.runExtraction(raw);
      return { ...out, summary: { ...out.summary, degraded: degradedFlag.value } };
    },
  };
});

const { runTurnExecutor } = await import('../turn-executor.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TURN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({ turn_id: TURN_ID, scenario_id: SCENARIO_ID, message });
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when pre-route matches');
      }),
  };
}

function buildChurnGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-churn',
        kind: 'factor',
        label: 'Churn',
        observed_state: { value: 0.04, raw_value: 4, unit: '%', cap: 100 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  };
}

beforeEach(() => {
  degradedFlag.value = false;
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.clearAllMocks();
});

describe('degraded extraction — pre-route refusal is WIRED through runTurnExecutor', () => {
  it('POSITIVE CONTROL: sound extraction → pre-route dispatches set_factor_value, LLM never called', async () => {
    degradedFlag.value = false;
    const routingAdapter = throwingRoutingAdapter();

    const { response, telemetry } = await runTurnExecutor(
      payload('Set churn to 5%'),
      'req-degraded-control',
      { routingAdapter, graphState: buildChurnGraph() },
    );

    // The deterministic path really does fire on this input — without
    // this, the refusal assertion below would be vacuous.
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.llm_calls_used).toBe(0);
    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({
      operation: 'set_factor_value',
      target_id: 'f-churn',
      status: 'applied',
    });
  });

  it('degraded extraction → pre-route REFUSES; the turn falls through to the LLM', async () => {
    degradedFlag.value = true;
    const routingAdapter = throwingRoutingAdapter();

    // The throwing adapter turns "fell through to the LLM" into an
    // observable event: the turn must NOT complete as a silent
    // deterministic apply. Identical inputs to the control above — the
    // ONLY difference is `summary.degraded`.
    await runTurnExecutor(payload('Set churn to 5%'), 'req-degraded-refuse', {
      routingAdapter,
      graphState: buildChurnGraph(),
    }).catch(() => undefined);

    // THE PIN: the guard is connected to the REAL summary flag. If either
    // production call site in turn-executor.ts is severed — or wired to a
    // constant `false` — the pre-route dispatches instead and this fails.
    expect(routingAdapter.chatWithTools).toHaveBeenCalled();
  });

  it('no graph_patch is applied from a degraded extraction', async () => {
    degradedFlag.value = true;
    // A permissive adapter so the turn can complete down the LLM path;
    // the assertion is that NO deterministic value write happened.
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValue({
          content: [{ type: 'text', text: 'Which factor did you mean?' }],
          stop_reason: 'end_turn',
        } as unknown as ChatWithToolsResult),
    };

    const { response } = await runTurnExecutor(
      payload('Set churn to 5%'),
      'req-degraded-nopatch',
      { routingAdapter, graphState: buildChurnGraph() },
    );

    const applied = response.blocks.filter(
      (b) => b.type === 'graph_patch' && (b as { status?: string }).status === 'applied',
    );
    expect(applied).toHaveLength(0);
  });
});
