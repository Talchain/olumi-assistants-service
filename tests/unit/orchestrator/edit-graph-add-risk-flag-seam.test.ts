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
import type { GraphStateIngress } from '../../../src/orchestrator-v5/boundary/request-extensions.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STUB_REQUEST = {} as FastifyRequest;

/** The exact pre-change generic structural-violation copy (patch-rejection-helper.ts). */
const GENERIC =
  "I wasn't able to apply that change — it would create an inconsistency in the model structure. You could try describing the change differently, or I can rebuild the model from an updated brief.";

/** Structurally clean baseline: decision → options → factor → goal. */
const PRICING_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Reach 1000 customers' },
    { id: 'dec_pricing', kind: 'decision', label: 'Pricing model' },
    { id: 'opt_subscription', kind: 'option', label: 'Subscription' },
    { id: 'opt_oneoff', kind: 'option', label: 'One-off' },
    { id: 'fac_price', kind: 'factor', label: 'Price' },
  ],
  edges: [
    { from: 'dec_pricing', to: 'opt_subscription', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_pricing', to: 'opt_oneoff', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_subscription', to: 'fac_price', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'opt_oneoff', to: 'fac_price', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'fac_price', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  ],
} as unknown as GraphStateIngress;

/**
 * Compound add-risk message: bypasses the deterministic bare-add-risk
 * clarification pre-route (proven by the e2e suite) AND classifies as
 * `structural` intent, so a non-repairable structural violation rejects
 * immediately instead of entering the narrow-intent repair loop.
 */
function makePayload(turnId: string) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: turnId,
    stage: 'analyse' as const,
    message: 'Add team dynamics as a risk and connect it to churn',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

/**
 * LLM proposal that adds a risk wired ONLY to an option — the candidate graph
 * fails structural validation with the reachability class (the risk has no
 * path through the model), which is exactly the Cap-2A target shape.
 */
const TARGETED_ADD_RISK_OPS = [
  {
    // patch-applier semantics: `path` is the authoritative node id.
    op: 'add_node',
    path: 'risk_team_dynamics',
    value: { id: 'risk_team_dynamics', kind: 'risk', label: 'Team dynamics' },
  },
  {
    op: 'add_edge',
    path: 'risk_team_dynamics->opt_subscription',
    value: {
      from: 'risk_team_dynamics',
      to: 'opt_subscription',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.8,
      effect_direction: 'negative',
    },
  },
];

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
  llmChatMock.mockResolvedValue({
    content: JSON.stringify({
      operations,
      removed_edges: [],
      warnings: [],
      coaching: { summary: 'Proposed change.' },
    }),
  });
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
