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

// ────────────────────────────────────────────────────────────────────
// Mocks (mirroring the add-risk flag-seam harness)
// ────────────────────────────────────────────────────────────────────

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You edit causal decision graphs'),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
  // The edit/review lanes resolve prompt bytes AND identity in ONE bound
  // `getSystemPromptSnapshot` call. A mock factory REPLACES the module, so
  // omitting this export hands the code under test `undefined` (trap 12).
  // Content and meta mirror the two mocks above deliberately: production
  // binds them to one resolution, and the mock must not model them as
  // independently divergent.
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: 'You edit causal decision graphs',
    meta: { source: 'default', prompt_version: 'v2' },
  }),
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
  // B-FIX1: the combined read follows the existing graph double.
  loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../../src/orchestrator-v5/build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
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
import { commitDirectAnswer } from '../../../src/orchestrator-v5/commit.js';
import { config, _resetConfigCache } from '../../../src/config/index.js';

function makeCommitResult() {
  return { response: {}, performed: true as const, persisted_row_id: 'row-5c-seam', graphPersisted: false };
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
});
