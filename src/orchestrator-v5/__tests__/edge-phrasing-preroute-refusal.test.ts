/**
 * ROADMAP 2.389a WIRING PIN — the edge-phrasing gate must be CONNECTED.
 *
 * The unit tests in `routing/__tests__/deterministic-value-update-edge-phrasing.test.ts`
 * prove the GATE works. They cannot prove it is REACHED: the production call
 * site lives in `turn-executor.ts`, and a gate that is skipped, short-
 * circuited by an earlier branch, or fed a different message would leave
 * every unit test green while the live defect survives.
 *
 * THE DEFECT THIS FILE MEASURES END-TO-END (L56, live on `672b634`):
 *   "Make the link from Ad-Supported Model to Ad Revenue 2"
 *     → `graph_patch { operation: set_factor_value, target_id: fac_ads_model,
 *        status: applied, after: { value: 2 } }`
 * The user named an EDGE; a FACTOR was mutated, out of range, with a receipt
 * whose every field is true.
 *
 * Harness mirrors `degraded-extraction-preroute-refusal.test.ts`: the routing
 * adapter THROWS if called, so "pre-route claimed it" and "fell through to the
 * LLM" are distinguishable without inspecting internals.
 *
 * ⚠ ASSERTIONS BIND BY IDENTITY (trap 19): the positive control asserts the
 * applied `target_id` is `fac_ads_model`, and the refusal asserts NO applied
 * `graph_patch` exists at all — never "the value is not 2", which a different
 * object could satisfy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

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

const { runTurnExecutor } = await import('../turn-executor.js');

const SCENARIO_ID = 'dddddddd-2389-4ddd-8ddd-dddddddddddd';
const TURN_ID = 'cccccccc-2389-4ccc-8ccc-cccccccccccc';

const ADS_FACTOR_ID = 'fac_ads_model';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({ turn_id: TURN_ID, scenario_id: SCENARIO_ID, message });
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when the pre-route claims the turn');
      }),
  };
}

/**
 * L56's MEASURED graph shape: a factor at one end of the edge and a
 * NON-factor (outcome) at the other. That asymmetry is the whole mechanism —
 * `factorIdSet` removes `Ad Revenue` from the candidate pool, so a
 * two-endpoint sentence collapses to a single unambiguous factor match.
 */
function buildAdsGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Grow Revenue' },
      {
        id: ADS_FACTOR_ID,
        kind: 'factor',
        label: 'Ad-Supported Model',
        observed_state: { value: 0, raw_value: 0 },
      },
      { id: 'out_ad_revenue', kind: 'outcome', label: 'Ad Revenue' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

beforeEach(() => {
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.clearAllMocks();
});

describe('edge-phrasing gate — WIRED through runTurnExecutor', () => {
  it('POSITIVE CONTROL: a plain factor update still auto-applies deterministically, by id, with no LLM call', async () => {
    // Without this arm, a gate widened until it swallows the fast path would
    // leave every refusal below green. It is also the branch discriminator:
    // it proves this fixture CAN reach a deterministic apply, so the refusal
    // is a refusal and not an incidental miss.
    const routingAdapter = throwingRoutingAdapter();

    const { response, telemetry } = await runTurnExecutor(
      payload('Set Ad-Supported Model to 0.6'),
      'req-edge-gate-control',
      { routingAdapter, graphState: buildAdsGraph() },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.llm_calls_used).toBe(0);
    expect(response.blocks.find((b) => b.type === 'graph_patch')).toMatchObject({
      operation: 'set_factor_value',
      target_id: ADS_FACTOR_ID,
      status: 'applied',
    });
  });

  it('THE PIN: the measured edge sentence falls through to the routing LLM', async () => {
    const routingAdapter = throwingRoutingAdapter();

    // Identical graph, identical factor, identical number to the control's
    // shape — the ONLY difference is that the sentence names a LINK between
    // two endpoints. If the gate is severed, the pre-route claims this and
    // the adapter is never called.
    await runTurnExecutor(
      payload('Make the link from Ad-Supported Model to Ad Revenue 2'),
      'req-edge-gate-refuse',
      { routingAdapter, graphState: buildAdsGraph() },
    ).catch(() => undefined);

    expect(routingAdapter.chatWithTools).toHaveBeenCalled();
  });

  it('NOTHING is applied to `fac_ads_model` from an edge sentence', async () => {
    // A permissive adapter so the turn completes down the LLM path; the
    // assertion is that no deterministic write to the factor the user never
    // named happened on the way.
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValue({
          content: [{ type: 'text', text: 'Which link did you mean?' }],
          stop_reason: 'end_turn',
        } as unknown as ChatWithToolsResult),
    };

    const { response } = await runTurnExecutor(
      payload('Make the link from Ad-Supported Model to Ad Revenue 2'),
      'req-edge-gate-nopatch',
      { routingAdapter, graphState: buildAdsGraph() },
    );

    const appliedToTheFactor = response.blocks.filter(
      (b) =>
        b.type === 'graph_patch' &&
        (b as { status?: string }).status === 'applied' &&
        (b as { target_id?: string }).target_id === ADS_FACTOR_ID,
    );
    expect(
      appliedToTheFactor,
      'the object the user never named must not be mutated — this is the fails-unsafe arm',
    ).toHaveLength(0);
  });
});
