/**
 * Capability 2A — add-risk rejection guidance, UNCONDITIONAL seam proof.
 *
 * CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED was deleted 2026-07-20 (O-7
 * wave 2 — Appendix A1, live-true on staging): the structural next-step
 * guidance for the targeted add-risk/reachability rejection class now runs
 * unconditionally in src/orchestrator/tools/edit-graph.ts. This suite
 * drives the REAL branch end-to-end through `dispatchEditGraph` →
 * `handleEditGraph` → structural rejection → guidance classifier →
 * `buildPatchRejectionEnvelope`, with the LLM adapter mocked to propose a
 * patch that fails structural validation with a reachability-class violation
 * (new risk wired only to an option).
 *
 * Proves at the seam (these are the make-unconditional MUTATION CHECKS —
 * re-gate the block behind a default-false config read and they go RED):
 *   - targeted add-risk reachability rejection → the placeholder guidance is
 *     the wire assistant_text (the classifier + substitution executed);
 *   - non-targeted structural rejection (cycle) → honest catalogue copy
 *     (classifier returns null; no broadening);
 *   - chips and wire-schema validity unchanged.
 *
 * Harness mirrors tests/integration/orchestrator/edit-graph-dispatch-add-risk-e2e.test.ts
 * (prompt-loader / LLM-router / commit / build-turn-context mocks) but lives
 * under tests/unit/ so it runs inside the required CI gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

// ────────────────────────────────────────────────────────────────────
// Mocks (mirroring the add-risk e2e harness)
// ────────────────────────────────────────────────────────────────────

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

vi.mock('../../../src/orchestrator-v5/commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../src/orchestrator-v5/build-turn-context.js', () => ({
  // No pending proposal from a prior turn — the resume intercept stands down
  // and the edit proceeds to the LLM path. Contract shape is an ARRAY ([] =
  // none), and the module's third export is stubbed too so a future
  // applied-mutation test cannot hit an undefined import (review fix).
  loadMostRecentPendingActions: vi.fn(async () => []),
  loadPersistedGraphStrict: vi.fn(async () => null),
  // ROADMAP 1.33: dispatchEditGraph reads this for the conversation-slice
  // feed. Empty — this suite exercises the add-risk flag seam, not
  // conversation history.
  loadRecentConversationTurns: vi.fn(async () => []),
  buildTurnContext: vi.fn(async () => ({
    goal_node_id: 'goal_growth',
    prior_facts: [],
    framing: { stage: 'analyse' },
    analysis_inputs: null,
    handler_row_ids: [],
    request_id: 'req-stub',
    scenario_id: 'sc-stub',
    turn_id: 'turn-stub',
    user_id: null,
    handler_id: null,
    received_at: new Date().toISOString(),
  })),
}));

// ────────────────────────────────────────────────────────────────────
// Imports after mocks
// ────────────────────────────────────────────────────────────────────

import { dispatchEditGraph } from '../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import { commitDirectAnswer } from '../../../src/orchestrator-v5/commit.js';
import { config } from '../../../src/config/index.js';
import { ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER } from '../../../src/orchestrator/add-risk-rejection-guidance.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import {
  ADD_RISK_SCENARIO_ID as SCENARIO_ID,
  PRICING_GRAPH,
  TARGETED_ADD_RISK_OPS,
  makeEditProposalResponse,
} from '../../../src/orchestrator-v5/__tests__/coaching-fixtures.js';
import { makeMessagePayload } from '../../../src/orchestrator-v5/__tests__/fixtures.js';

// ────────────────────────────────────────────────────────────────────
// Fixtures (PRICING_GRAPH / TARGETED_ADD_RISK_OPS shared via coaching-fixtures.ts)
// ────────────────────────────────────────────────────────────────────

const STUB_REQUEST = {} as FastifyRequest;

/** The exact pre-change generic structural-violation copy (patch-rejection-helper.ts). */
const GENERIC =
  "I wasn't able to apply that change — it would create an inconsistency in the model structure. You could try describing the change differently, or I can rebuild the model from an updated brief.";

/**
 * Lane 22 — the non-guidance structural-rejection copy is no longer the
 * vague GENERIC line: the caller now vets the translated violation
 * catalogue entries into `user_safe_reasons`, and the helper surfaces the
 * first two. These are the exact expected renderings for the two fixtures
 * below (NO_PATH_TO_GOAL for the targeted add-risk patch; CYCLE_DETECTED
 * for the cycle patch).
 */
const HONEST_CYCLE =
  "I wasn't able to apply that change. This change would create a circular dependency in the model. You could describe the change differently, or I can rebuild the model from an updated brief.";

/**
 * Compound add-risk message: bypasses the deterministic bare-add-risk
 * clarification pre-route (proven by the e2e suite) AND classifies as
 * `structural` intent, so a non-repairable structural violation rejects
 * immediately instead of entering the narrow-intent repair loop.
 */
function makePayload(turnId: string) {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: turnId,
    stage: 'analyse',
    message: 'Add team dynamics as a risk and connect it to churn',
  });
}

/**
 * LLM proposal creating a cycle (factor → goal already exists; goal → factor
 * added) — a NEW structural violation that is NOT reachability-class, so the
 * Cap-2A classifier must return null and the generic copy must survive even
 * with the flag ON.
 */
const CYCLE_OPS = [
  {
    op: 'add_edge',
    path: 'goal_growth->fac_price',
    value: {
      from: 'goal_growth',
      to: 'fac_price',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.8,
      effect_direction: 'positive',
    },
  },
];

function mockLlmProposal(operations: readonly unknown[]): void {
  llmChatMock.mockResolvedValue(makeEditProposalResponse(operations));
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-flag-seam',
    graphPersisted: false,
  };
}

async function runRejectionTurn(turnId: string, operations: readonly unknown[]) {
  mockLlmProposal(operations);
  const result = await dispatchEditGraph({
    payload: makePayload(turnId),
    requestId: `req-${turnId}`,
    request: STUB_REQUEST,
    graphState: PRICING_GRAPH,
    analysisState: null,
  });
  return result;
}

// CEE_EDIT_CONNECTIVITY_NAMED_REFUSAL went DEFAULT-ON 18 Jul (Paul-ratified). The
// named-refusal is a STRICTLY-MORE-SPECIFIC superseding layer that runs AFTER —
// and overrides — the Cap-2A add-risk placeholder guidance this suite isolates.
// Pin it OFF for these tests so the Cap-2A seam is what's exercised; the
// named-refusal default-ON behaviour is covered by
// edit-graph-connectivity-named-refusal-seam.test.ts.
let originalNamedRefusalFlag = false;
function setNamedRefusalFlag(on: boolean): void {
  (config.cee as { editConnectivityNamedRefusalEnabled: boolean }).editConnectivityNamedRefusalEnabled = on;
}

beforeEach(() => {
  llmChatMock.mockReset();
  originalNamedRefusalFlag = config.cee.editConnectivityNamedRefusalEnabled === true;
  setNamedRefusalFlag(false); // isolate the Cap-2A layer from the superseding named refusal
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
    .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

afterEach(() => {
  setNamedRefusalFlag(originalNamedRefusalFlag);
});

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('Cap-2A seam — unconditional add-risk guidance in edit-graph.ts', () => {
  it('targeted add-risk reachability rejection → placeholder guidance on the wire (unconditional)', async () => {
    const result = await runRejectionTurn('aaaaaaa1-0000-4000-8000-000000000001', TARGETED_ADD_RISK_OPS);

    expect(llmChatMock).toHaveBeenCalled(); // went through the LLM path, not a pre-route

    // RED-proven: this assertion was first committed in its inverted form
    // (`toBe(GENERIC)`) and FAILED with the placeholder as the received value,
    // proving the turn genuinely executes the flag conditional (transcript in
    // the component-4 evidence pack). The branch swaps the generic suppression
    // for the placeholder guidance.
    expect(result.response.assistant_text).toBe(ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER);
    expect(result.response.assistant_text).not.toBe(GENERIC);

    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  // (former "flag OFF → no placeholder" pin removed 2026-07-20 with the
  // flag: the OFF branch no longer exists.)

  it('non-targeted structural rejection (cycle) → honest actionable-reason copy (no broadening)', async () => {
    const result = await runRejectionTurn('aaaaaaa3-0000-4000-8000-000000000003', CYCLE_OPS);

    expect(llmChatMock).toHaveBeenCalled();
    // Classifier still returns null (no guidance broadening); Lane 22 copy
    // carries the CYCLE_DETECTED catalogue reason instead of GENERIC.
    expect(result.response.assistant_text).toBe(HONEST_CYCLE);
    expect(result.response.assistant_text).not.toBe(ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER);
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('chips are stable and the wire shape valid on the targeted rejection', async () => {
    const first = await runRejectionTurn('aaaaaaa4-0000-4000-8000-000000000004', TARGETED_ADD_RISK_OPS);
    const second = await runRejectionTurn('aaaaaaa5-0000-4000-8000-000000000005', TARGETED_ADD_RISK_OPS);

    expect(second.response.suggested_actions).toEqual(first.response.suggested_actions);
    expect(() => OlumiResponseSchema.parse(first.response)).not.toThrow();
    expect(() => OlumiResponseSchema.parse(second.response)).not.toThrow();
  });
});
