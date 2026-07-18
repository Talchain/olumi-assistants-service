/**
 * Coaching activation readiness — BOTH-FLAGS-ON smoke (closes readiness gap B).
 *
 * Cap-1 (`CEE_POST_ANALYSIS_LOOP_ENABLED`) and Cap-2A
 * (`CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED`) were each proven flag-ON in
 * isolation; no test ran them together, so non-interference was asserted, not
 * proven. Their paths are disjoint by design (V5 post-analysis advice gate vs
 * edit-graph structural-rejection copy), and this suite proves it:
 *
 *   - with BOTH flags on, the Cap-1 turn produces the identical grounded
 *     answer and gate telemetry as with Cap-1 alone;
 *   - with BOTH flags on, the Cap-2A rejection produces the identical
 *     placeholder guidance and chips as with Cap-2A alone;
 *   - neutrality: neither path's user-facing copy carries held-science
 *     vocabulary or success claims (supplementary evidence beside the
 *     allowlist guards, not a guard of record).
 *
 * RED-proven reach (transcripts in the component-4 evidence pack): each leg
 * was first committed asserting the both-flags run does NOT activate its
 * capability (Cap-1 `matched === false`; Cap-2A text === generic copy) and
 * FAILED, proving both branches execute under the combined posture.
 *
 * Harness: session-store mock from the Cap-1 loop integration test (real
 * `buildTurnContext`, real commit against the mocked store) + LLM-router and
 * prompt-loader mocks for the edit path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { config } from '../../../src/config/index.js';
import { setTestSink } from '../../../src/utils/telemetry.js';
import {
  HELD_SCIENCE_VOCABULARY_PATTERN,
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';
import { ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER } from '../../../src/orchestrator/add-risk-rejection-guidance.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../../src/adapters/llm/types.js';
import {
  ADD_RISK_SCENARIO_ID as EDIT_SCENARIO_ID,
  CAP1_SCENARIO_ID as SCENARIO_ID,
  PARTIAL_GRAPH,
  PRICING_GRAPH,
  PRIOR_RA_TURN,
  TARGETED_ADD_RISK_OPS,
  makeBlankProjectionFreshFact,
  makeEditProposalResponse,
} from '../../../src/orchestrator-v5/__tests__/coaching-fixtures.js';
import { makeMessagePayload } from '../../../src/orchestrator-v5/__tests__/fixtures.js';

// ────────────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────────────

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = { priorTurns: [], priorFacts: [], persistedGraph: null };

// SCENARIO-KEYED store mock (review fix): the first version ignored
// scenario_id, so the Cap-2A leg ran real buildTurnContext against Cap-1's
// persisted graph and a foreign fresh run_analysis fact — an
// impossible-in-production cross-scenario state underneath the
// non-interference proof. Only the Cap-1 scenario sees Cap-1's state; every
// other scenario (the edit leg) gets a clean, empty session.
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (scenarioId: string) => (scenarioId === SCENARIO_ID ? mockState.priorTurns : []),
    // readFactsFor is keyed by prior-turn ROW ids (not scenario id): facts
    // exist only for Cap-1's prior run_analysis turn row.
    readFactsFor: async (rowIds: readonly string[]) =>
      Array.isArray(rowIds) && rowIds.includes(PRIOR_RA_TURN.id) ? mockState.priorFacts : [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async (scenarioId: string) => (scenarioId === SCENARIO_ID ? mockState.persistedGraph : null),
    loadGraphAndBriefText: async (scenarioId: string) =>
      scenarioId === SCENARIO_ID
        ? { graph: mockState.persistedGraph, briefText: null }
        : { graph: null, briefText: null },
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You edit causal decision graphs'),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
}));

const { llmChatMock } = vi.hoisted(() => ({ llmChatMock: vi.fn() }));
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'test',
    model: 'test-model',
    chat: llmChatMock,
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
}));

const { runTurnExecutor } = await import('../../../src/orchestrator-v5/turn-executor.js');
const { dispatchEditGraph } = await import('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js');

// ────────────────────────────────────────────────────────────────────
// Cap-1 fixtures (shared with turn-executor-post-analysis-loop.integration.test.ts
// via src/orchestrator-v5/__tests__/coaching-fixtures.ts)
// ────────────────────────────────────────────────────────────────────

function mkCap1Payload(): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message: 'How can we improve this?',
    stage: 'analyse',
  });
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('Routing adapter must NOT be called on the deterministic canonical_rich path');
      }),
  };
}

// ────────────────────────────────────────────────────────────────────
// Cap-2A fixtures (shared with edit-graph-add-risk-flag-seam.test.ts via
// src/orchestrator-v5/__tests__/coaching-fixtures.ts)
// ────────────────────────────────────────────────────────────────────

const STUB_REQUEST = {} as FastifyRequest;

async function runCap2aRejectionTurn(turnId: string) {
  llmChatMock.mockResolvedValue(makeEditProposalResponse(TARGETED_ADD_RISK_OPS));
  return dispatchEditGraph({
    payload: makeMessagePayload({
      scenario_id: EDIT_SCENARIO_ID,
      turn_id: turnId,
      stage: 'analyse',
      message: 'Add team dynamics as a risk and connect it to churn',
    }),
    requestId: `req-${turnId}`,
    request: STUB_REQUEST,
    graphState: PRICING_GRAPH,
    analysisState: null,
  });
}

// ────────────────────────────────────────────────────────────────────
// Flag save/restore
// ────────────────────────────────────────────────────────────────────

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];
let originalLoopFlag = false;
let originalGuidanceFlag = false;
let originalNamedRefusalFlag = false;

function setFlags(loop: boolean, guidance: boolean): void {
  (config.cee as { postAnalysisLoopEnabled: boolean }).postAnalysisLoopEnabled = loop;
  (config.cee as { addRiskRejectionGuidanceEnabled: boolean }).addRiskRejectionGuidanceEnabled = guidance;
}

// CEE_EDIT_CONNECTIVITY_NAMED_REFUSAL went DEFAULT-ON 18 Jul (Paul-ratified). It
// is a strictly-more-specific superseding layer over the Cap-2A add-risk
// placeholder guidance the Cap-2A leg asserts, so pin it OFF here to keep testing
// the Cap-2A guidance in isolation (named-refusal default-ON is covered by
// edit-graph-connectivity-named-refusal-seam.test.ts).
function setNamedRefusalFlag(on: boolean): void {
  (config.cee as { editConnectivityNamedRefusalEnabled: boolean }).editConnectivityNamedRefusalEnabled = on;
}

beforeEach(() => {
  events = [];
  llmChatMock.mockReset();
  mockState.priorTurns = [PRIOR_RA_TURN];
  mockState.priorFacts = [makeBlankProjectionFreshFact()];
  mockState.persistedGraph = PARTIAL_GRAPH;
  originalLoopFlag = config.cee.postAnalysisLoopEnabled === true;
  originalGuidanceFlag = config.cee.addRiskRejectionGuidanceEnabled === true;
  originalNamedRefusalFlag = config.cee.editConnectivityNamedRefusalEnabled === true;
  setNamedRefusalFlag(false);
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setFlags(originalLoopFlag, originalGuidanceFlag);
  setNamedRefusalFlag(originalNamedRefusalFlag);
  vi.clearAllMocks();
  setTestSink(null);
});

function adviceEvent(): Record<string, unknown> | undefined {
  return events.find((e) => e.event === 'v5.post_analysis_advice_gate')?.data;
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('coaching flags combined — non-interference proven, not asserted', () => {
  it('Cap-1 leg: both flags ON → identical grounded answer and gate telemetry as Cap-1 alone', async () => {
    // Cap-1 alone.
    setFlags(true, false);
    const alone = await runTurnExecutor(mkCap1Payload(), 'req-cap1-alone', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: PARTIAL_GRAPH as never,
    });
    const aloneEvent = adviceEvent();
    const aloneText = (alone.response as { assistant_text?: string }).assistant_text ?? '';

    // Both flags ON.
    events = [];
    setFlags(true, true);
    const both = await runTurnExecutor(mkCap1Payload(), 'req-cap1-both', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: PARTIAL_GRAPH as never,
    });
    const bothEvent = adviceEvent();
    const bothText = (both.response as { assistant_text?: string }).assistant_text ?? '';

    // RED-proven reach: first committed as `expect(bothEvent!.matched).toBe(false)`
    // and FAILED (matched=true), proving the gate activates under the combined
    // posture (transcript in the evidence pack).
    expect(bothEvent).toBeDefined();
    expect(bothEvent!.matched).toBe(true);
    expect(bothEvent!.copy_source).toBe('canonical_rich');
    expect(bothEvent!.loop_enabled).toBe(true);

    // Non-interference: byte-identical answer and identical gate outcome fields.
    expect(bothText).toBe(aloneText);
    expect(bothEvent!.matched).toBe(aloneEvent!.matched);
    expect(bothEvent!.copy_source).toBe(aloneEvent!.copy_source);
    expect(bothEvent!.routing_path).toBe(aloneEvent!.routing_path);
    expect(bothEvent!.deterministic).toBe(aloneEvent!.deterministic);
  });

  it('Cap-2A leg: both flags ON → identical placeholder guidance and chips as Cap-2A alone', async () => {
    // Cap-2A alone.
    setFlags(false, true);
    const alone = await runCap2aRejectionTurn('bbbbbbb1-0000-4000-8000-000000000001');

    // Both flags ON.
    setFlags(true, true);
    const both = await runCap2aRejectionTurn('bbbbbbb2-0000-4000-8000-000000000002');

    // RED-proven reach: first committed asserting the both-flags text equals the
    // generic suppression copy and FAILED with the placeholder as received,
    // proving the flag branch executes under the combined posture.
    expect(both.response.assistant_text).toBe(ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER);

    // Non-interference: byte-identical to the single-flag run.
    expect(both.response.assistant_text).toBe(alone.response.assistant_text);
    expect(both.response.suggested_actions).toEqual(alone.response.suggested_actions);
  });

  it('neutrality: both paths\' user-facing copy (prose AND chips) carries no held-science vocabulary and no success claims', async () => {
    setFlags(true, true);

    const cap1 = await runTurnExecutor(mkCap1Payload(), 'req-neutrality-cap1', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: PARTIAL_GRAPH as never,
    });
    const cap1Response = cap1.response as {
      assistant_text?: string;
      suggested_actions?: ReadonlyArray<{ label?: string; prompt?: string; message?: string }>;
    };
    const cap2a = await runCap2aRejectionTurn('bbbbbbb3-0000-4000-8000-000000000003');

    // Chips are user-facing copy too (review fix): scan their label/prompt/
    // message text alongside the prose, so a flag-gated chip cannot smuggle
    // held-science wording past the neutrality evidence.
    const chipTexts = [
      ...(cap1Response.suggested_actions ?? []),
      ...(cap2a.response.suggested_actions ?? []),
    ].flatMap((c) => {
      const chip = c as { label?: string; prompt?: string; message?: string };
      return [chip.label, chip.prompt, chip.message].filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      );
    });

    const proseTexts = [
      cap1Response.assistant_text ?? '',
      cap2a.response.assistant_text ?? '',
      ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER,
    ];
    for (const text of proseTexts) expect(text.length).toBeGreaterThan(0);

    for (const text of [...proseTexts, ...chipTexts]) {
      expect(findSuccessClaimHit(text)).toBeNull();
      expect(findForbiddenPhraseHit(text)).toBeNull();
      // Canonical superset pattern (the per-suite copies had diverged; one
      // dropped 'vulnerable', others lacked driver/causal/evpi/voi).
      expect(text).not.toMatch(HELD_SCIENCE_VOCABULARY_PATTERN);
      expect(text.toLowerCase()).not.toContain('must flow through');
    }
  });
});
