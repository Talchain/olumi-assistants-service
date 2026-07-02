/**
 * Capability 2A — FLAG-SEAM proof (closes readiness gap A).
 *
 * The render test (add-risk-rejection-render.test.ts) proves the composition
 * BENEATH the flag by re-implementing the edit-graph.ts branch in-test. No
 * test executed the real conditional at src/orchestrator/tools/edit-graph.ts
 * (`if (config.cee.addRiskRejectionGuidanceEnabled) { ... }`) — before this
 * suite, the flag name had exactly three NON-COMMENT code references under
 * `src/` (config declaration, env mapping, consuming branch; doc mentions in
 * Docs/v5 and a config comment exist besides) and nothing flipped it. This
 * suite drives the REAL branch end-to-end through `dispatchEditGraph` →
 * `handleEditGraph` → structural rejection → flag conditional →
 * `buildPatchRejectionEnvelope`, with the LLM adapter mocked to propose a
 * patch that fails structural validation with a reachability-class violation
 * (new risk wired only to an option).
 *
 * Proves at the seam:
 *   - flag ON + targeted add-risk reachability rejection → the placeholder
 *     guidance is the wire assistant_text (the conditional executed);
 *   - flag OFF, same turn → BYTE-IDENTICAL generic suppression copy;
 *   - flag ON + non-targeted structural rejection (cycle) → BYTE-IDENTICAL
 *     generic copy (classifier returns null; no broadening);
 *   - chips unchanged between flag states.
 *
 * Harness mirrors tests/integration/orchestrator/edit-graph-dispatch-add-risk-e2e.test.ts
 * (prompt-loader / LLM-router / commit / build-turn-context mocks) but lives
 * under tests/unit/ so it runs inside the required CI gate. Flag mutation uses
 * the save/restore pattern from turn-executor-post-analysis-loop.integration.test.ts.
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

// Flag save/restore (established pattern; config is a module singleton).
let originalFlag = false;

function setGuidanceFlag(on: boolean): void {
  (config.cee as { addRiskRejectionGuidanceEnabled: boolean }).addRiskRejectionGuidanceEnabled = on;
}

beforeEach(() => {
  llmChatMock.mockReset();
  originalFlag = config.cee.addRiskRejectionGuidanceEnabled === true;
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
    .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

afterEach(() => {
  setGuidanceFlag(originalFlag);
});

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('Cap-2A flag seam — the real edit-graph.ts conditional', () => {
  it('flag ON + targeted add-risk reachability rejection → placeholder guidance on the wire', async () => {
    setGuidanceFlag(true);
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

  it('flag OFF, same turn → byte-identical generic suppression copy', async () => {
    setGuidanceFlag(false);
    const result = await runRejectionTurn('aaaaaaa2-0000-4000-8000-000000000002', TARGETED_ADD_RISK_OPS);

    expect(llmChatMock).toHaveBeenCalled();
    expect(result.response.assistant_text).toBe(GENERIC);
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('flag ON + non-targeted structural rejection (cycle) → byte-identical generic copy', async () => {
    setGuidanceFlag(true);
    const result = await runRejectionTurn('aaaaaaa3-0000-4000-8000-000000000003', CYCLE_OPS);

    expect(llmChatMock).toHaveBeenCalled();
    expect(result.response.assistant_text).toBe(GENERIC);
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('chips are unchanged between flag states on the targeted rejection', async () => {
    setGuidanceFlag(false);
    const off = await runRejectionTurn('aaaaaaa4-0000-4000-8000-000000000004', TARGETED_ADD_RISK_OPS);
    setGuidanceFlag(true);
    const on = await runRejectionTurn('aaaaaaa5-0000-4000-8000-000000000005', TARGETED_ADD_RISK_OPS);

    expect(on.response.suggested_actions).toEqual(off.response.suggested_actions);
    // Wire-shape validity in BOTH flag states (review fix: the evidence pack
    // claims schema re-validation in every case; this case was the exception).
    expect(() => OlumiResponseSchema.parse(off.response)).not.toThrow();
    expect(() => OlumiResponseSchema.parse(on.response)).not.toThrow();
  });
});
