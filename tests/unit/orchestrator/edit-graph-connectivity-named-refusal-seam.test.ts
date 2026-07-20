/**
 * POC-BOARD #5c — connectivity NAMED-refusal FLAG-SEAM proof.
 *
 * Drives the REAL edit-graph.ts structural-rejection conditional end-to-end
 * (dispatchEditGraph → handleEditGraph → final-state structural validation →
 * flag conditional → buildPatchRejectionEnvelope), with the LLM adapter mocked
 * to propose a patch whose FINAL post-batch state genuinely fails connectivity.
 *
 * Reproduces the live Step-0 s1-05 shape: a structural compound edit where one
 * op orphans a new risk. On staging (build 6fd24d9) the whole batch was rejected
 * with copy that named "the new risk" GENERICALLY (never the label) and framed
 * the whole request as failed — a dead-end that told the user nothing about
 * WHICH item to fix.
 *
 * Proves at the seam:
 *   - flag ON  → the wire assistant_text NAMES the specific offending item(s)
 *                (single source of truth: renderConnectivityNamedRefusal);
 *   - flag OFF → BYTE-IDENTICAL to today's copy (the Lane-22 vetted catalogue
 *                reason) — no behaviour change with the flag dark;
 *   - within-turn atomicity preserved — the rejection commits nothing (this is
 *                the reject path; no GraphPatchBlock, wasRejected);
 *   - flag ON + a NON-connectivity rejection (cycle) → BYTE-IDENTICAL to the
 *                flag-OFF copy (helper defers; no broadening);
 *   - chips unchanged between flag states.
 *
 * Harness mirrors edit-graph-add-risk-flag-seam.test.ts (same mocks/fixtures),
 * lives under tests/unit/ so it runs inside the required CI gate, and uses the
 * same config save/restore pattern.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER } from '../../../src/orchestrator/add-risk-rejection-guidance.js';
import type { FastifyRequest } from 'fastify';

// ────────────────────────────────────────────────────────────────────
// Mocks (mirroring the add-risk flag-seam harness)
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
  loadMostRecentPendingActions: vi.fn(async () => []),
  loadPersistedGraphStrict: vi.fn(async () => null),
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
import { config, _resetConfigCache } from '../../../src/config/index.js';
import { renderConnectivityNamedRefusal } from '../../../src/orchestrator/connectivity-named-refusal.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import {
  ADD_RISK_SCENARIO_ID as SCENARIO_ID,
  PRICING_GRAPH,
  TARGETED_ADD_RISK_OPS,
  makeEditProposalResponse,
} from '../../../src/orchestrator-v5/__tests__/coaching-fixtures.js';
import { makeMessagePayload } from '../../../src/orchestrator-v5/__tests__/fixtures.js';

const STUB_REQUEST = {} as FastifyRequest;

/**
 * Lane-22 vetted catalogue copy — the byte-identical flag-OFF baseline for the
 * two rejection shapes below.
 */
const OFF_NO_PATH =
  "I wasn't able to apply that change. This change would leave a node that cannot reach the goal. You could describe the change differently, or I can rebuild the model from an updated brief.";
const OFF_ORPHAN =
  "I wasn't able to apply that change. This change would leave a node with no connections. You could describe the change differently, or I can rebuild the model from an updated brief.";
const OFF_CYCLE =
  "I wasn't able to apply that change. This change would create a circular dependency in the model. You could describe the change differently, or I can rebuild the model from an updated brief.";

/** Expected flag-ON named refusals (single source of truth). */
const ON_TEAM_DYNAMICS = renderConnectivityNamedRefusal(['Team dynamics']);
const ON_COMPETITOR = renderConnectivityNamedRefusal(['Competitor Response']);

/**
 * s1-05-shaped compound structural edit: rename an existing factor (valid) AND
 * add a risk with NO connecting edge (ORPHAN). The final post-batch state has
 * exactly one new ORPHAN_NODE. "add a risk" makes classifyEditIntent →
 * structural; the compound form bypasses the bare-add-risk clarification route.
 */
const ORPHAN_COMPOUND_OPS = [
  { op: 'update_node', path: 'fac_price', value: { label: 'Unit Price' } },
  { op: 'add_node', path: 'risk_competitor', value: { id: 'risk_competitor', kind: 'risk', label: 'Competitor Response' } },
];

/** Cycle proposal — a NON-connectivity structural violation (helper must defer). */
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

function makePayload(turnId: string, message: string) {
  return makeMessagePayload({ scenario_id: SCENARIO_ID, turn_id: turnId, stage: 'analyse', message });
}

function makeCommitResult() {
  return { response: {}, performed: true as const, persisted_row_id: 'row-5c-seam', graphPersisted: false };
}

async function runRejectionTurn(turnId: string, message: string, operations: readonly unknown[]) {
  llmChatMock.mockResolvedValue(makeEditProposalResponse(operations));
  return dispatchEditGraph({
    payload: makePayload(turnId, message),
    requestId: `req-${turnId}`,
    request: STUB_REQUEST,
    graphState: PRICING_GRAPH,
    analysisState: null,
  });
}

// Flag save/restore (config is a module singleton).
let originalFlag = false;
function setFlag(on: boolean): void {
  (config.cee as { editConnectivityNamedRefusalEnabled: boolean }).editConnectivityNamedRefusalEnabled = on;
}

beforeEach(() => {
  llmChatMock.mockReset();
  originalFlag = config.cee.editConnectivityNamedRefusalEnabled === true;
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
    .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

afterEach(() => setFlag(originalFlag));

// ────────────────────────────────────────────────────────────────────
// DEFAULT-PATH PIN (P1, adversarial review of #511).
//
// Every test below force-sets the flag, so NONE of them can see the code
// default: reverting `editConnectivityNamedRefusalEnabled: booleanString
// .default(true)` back to `.default(false)` left the whole suite GREEN — the
// 18 Jul flip could have silently reverted under green CI (CLAUDE.md trap
// #11/#12: a guarantee that never executes, and a default with no reader).
// These two tests read the REAL config with no override, so a reverted default
// turns them RED.
// ────────────────────────────────────────────────────────────────────

describe('#5c connectivity named-refusal — the DEFAULT itself is pinned (no override)', () => {
  beforeEach(() => {
    delete process.env.CEE_EDIT_CONNECTIVITY_NAMED_REFUSAL;
    _resetConfigCache();
  });
  afterEach(() => {
    _resetConfigCache();
  });

  it('config default is ON (revert default(true)→default(false) turns this RED)', () => {
    expect(config.cee.editConnectivityNamedRefusalEnabled).toBe(true);
  });

  it('default path (no flag override): the dead-end turn produces the NAMED refusal, not the legacy generic copy', async () => {
    const result = await runRejectionTurn(
      'bbbbbbb9-0000-4000-8000-000000000009',
      'Add team dynamics as a risk and connect it to churn',
      TARGETED_ADD_RISK_OPS,
    );
    expect(llmChatMock).toHaveBeenCalled();
    // Behavioural proof the default drives the real edit-graph.ts conditional.
    expect(result.response.assistant_text).toBe(ON_TEAM_DYNAMICS);
    expect(result.response.assistant_text).toContain('"Team dynamics"');
    expect(result.response.assistant_text).not.toBe(OFF_NO_PATH);
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });
});

describe('#5c connectivity named-refusal flag seam — the real edit-graph.ts conditional', () => {
  it('flag ON + dead-end add-risk → wire copy NAMES the offending item', async () => {
    setFlag(true);
    const result = await runRejectionTurn(
      'bbbbbbb1-0000-4000-8000-000000000001',
      'Add team dynamics as a risk and connect it to churn',
      TARGETED_ADD_RISK_OPS,
    );
    expect(llmChatMock).toHaveBeenCalled();
    expect(result.response.assistant_text).toBe(ON_TEAM_DYNAMICS);
    expect(result.response.assistant_text).toContain('"Team dynamics"');
    expect(result.response.assistant_text).not.toBe(OFF_NO_PATH);
    // Reject path: no committed patch block.
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('flag ON + s1-05-shaped compound orphan → wire copy NAMES the orphaned item', async () => {
    setFlag(true);
    const result = await runRejectionTurn(
      'bbbbbb2-0000-4000-8000-000000000002',
      'Rename the price factor to Unit Price and add a risk called Competitor Response',
      ORPHAN_COMPOUND_OPS,
    );
    expect(llmChatMock).toHaveBeenCalled();
    expect(result.response.assistant_text).toBe(ON_COMPETITOR);
    expect(result.response.assistant_text).toContain('"Competitor Response"');
    expect(result.response.assistant_text).not.toBe(OFF_ORPHAN);
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  // FALLBACK PINS UPDATED 2026-07-20 (O-7 wave 2): with the named-refusal
  // kill-switch OFF, these add-risk-shaped turns now fall back to the
  // Cap-2A structural guidance, which became UNCONDITIONAL when
  // CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED was deleted (it was live-true on
  // staging). The former Lane-22 catalogue copy (OFF_NO_PATH / OFF_ORPHAN)
  // is no longer reachable for turns the add-risk classifier matches; it
  // remains the fallback for non-add-risk rejections (cycle case below).
  it('flag OFF, same dead-end turn → deterministic Cap-2A guidance (unconditional fallback)', async () => {
    setFlag(false);
    const result = await runRejectionTurn(
      'bbbbbb3-0000-4000-8000-000000000003',
      'Add team dynamics as a risk and connect it to churn',
      TARGETED_ADD_RISK_OPS,
    );
    expect(llmChatMock).toHaveBeenCalled();
    expect(result.response.assistant_text).toBe(ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER);
    expect(result.response.assistant_text).not.toBe(OFF_NO_PATH);
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('flag OFF, same compound-orphan turn → deterministic Cap-2A guidance (unconditional fallback)', async () => {
    setFlag(false);
    const result = await runRejectionTurn(
      'bbbbbb4-0000-4000-8000-000000000004',
      'Rename the price factor to Unit Price and add a risk called Competitor Response',
      ORPHAN_COMPOUND_OPS,
    );
    expect(llmChatMock).toHaveBeenCalled();
    expect(result.response.assistant_text).toBe(ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER);
    expect(result.response.assistant_text).not.toBe(OFF_ORPHAN);
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('flag ON + non-connectivity rejection (cycle) → BYTE-IDENTICAL to flag-OFF (no broadening)', async () => {
    setFlag(true);
    const result = await runRejectionTurn(
      'bbbbbb5-0000-4000-8000-000000000005',
      'Connect the goal back to price to close the loop',
      CYCLE_OPS,
    );
    expect(llmChatMock).toHaveBeenCalled();
    expect(result.response.assistant_text).toBe(OFF_CYCLE);
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('chips are unchanged between flag states on the dead-end rejection', async () => {
    setFlag(false);
    const off = await runRejectionTurn(
      'bbbbbb6-0000-4000-8000-000000000006',
      'Add team dynamics as a risk and connect it to churn',
      TARGETED_ADD_RISK_OPS,
    );
    setFlag(true);
    const on = await runRejectionTurn(
      'bbbbbb7-0000-4000-8000-000000000007',
      'Add team dynamics as a risk and connect it to churn',
      TARGETED_ADD_RISK_OPS,
    );
    expect(on.response.suggested_actions).toEqual(off.response.suggested_actions);
    expect(() => OlumiResponseSchema.parse(off.response)).not.toThrow();
    expect(() => OlumiResponseSchema.parse(on.response)).not.toThrow();
  });
});
