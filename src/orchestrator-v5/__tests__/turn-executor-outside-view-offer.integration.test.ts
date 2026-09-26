/**
 * THE WIRING, PROVEN THROUGH THE REAL TURN-EXECUTOR PATH.
 *
 * The eligibility gate and the offer builder are unit-tested to 25 mutants. What
 * those specs cannot show is that the offer REACHES A RESPONSE — and two pure
 * modules with no reachable caller would be the exact defect this lane diagnosed
 * in `compose/conversation-text-signals.ts` (computed, tested, attested, never
 * called).
 *
 * ⭐ THIS SUITE FOUND THE STAGE DEFECT. Written with the estate's own harness
 * payload (`stage: 'analyse'`), it showed the gate matching the PRODUCT stage
 * against the BUNDLE's `stage_applicability` — and since DSK-P-002 applies at
 * `['frame','evaluate']` while the product has no `evaluate`, half the protocol's
 * applicability was unreachable. Keep `analyse` in the positive case below.
 *
 * Mirrors the deterministic mocked-store pattern of
 * `turn-executor-brief-in-prompt.integration.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

const mockState: {
  persistedGraph: unknown | null;
  priorTurns: readonly unknown[];
  turnCount: number;
} = { persistedGraph: null, priorTurns: [], turnCount: 0 };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    // ⚠ WITHOUT THIS the context carries no `prior_turns_total`, `windowComplete`
    // is false, and every absence-based trigger correctly stands down — so the
    // offer would be dark for a reason that is the MOCK's, not the product's.
    countTurns: async () => mockState.turnCount,
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const {
  OUTSIDE_VIEW_DECLINE_MESSAGE,
  OUTSIDE_VIEW_ENGAGE_MESSAGE,
  OUTSIDE_VIEW_ENGAGE_CHIP_ID,
  OUTSIDE_VIEW_DECLINE_CHIP_ID,
} = await import('../coaching/outside-view-offer.js');

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const GRAPH = {
  schema_version: 'v3',
  nodes: [
    { id: 'goal_mrr', kind: 'goal', label: 'Reach target MRR' },
    { id: 'fac_price', kind: 'factor', label: 'Monthly price' },
    { id: 'opt_raise', kind: 'option', label: 'Raise the price' },
  ],
  edges: [{ from: 'fac_price', to: 'goal_mrr', strength: 0.5 }],
};

function mkPayload(message: string, stage = 'analyse'): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage,
  } as MessageTurnPayload;
}

function textAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

/**
 * ⛔⛔ A WELL-FORMED PRIOR TURN. The Canvas Completion review found that three
 * stand-down assertions here passed because `orient` threw
 * `conversation.recent_turns.0.turn_id: Required` and the turn FAILED — not
 * because the gate declined. A stand-down proven by a crash proves nothing.
 * Every prior-turn fixture now carries the fields ContextPack validation needs.
 */
function priorTurn(userMessage: string | null, assistantMessage = 'ok') {
  return {
    turn_id: `p-${randomUUID()}`,
    turn_class: 'frame',
    handler_id: 'conversational_reply',
    created_at: new Date().toISOString(),
    user_message: userMessage,
    assistant_message: assistantMessage,
  };
}

type Block = Record<string, unknown>;
const offerBlock = (resp: { blocks?: readonly unknown[] }): Block | undefined =>
  (resp.blocks ?? []).find(
    (b) => (b as Block)['source_handler'] === 'outside_view_offer',
  ) as Block | undefined;

async function run(message: string, stage?: string) {
  const adapter = textAdapter('Raising the price affects revenue and churn together.');
  const out = await runTurnExecutor(mkPayload(message, stage), `req-ov-${randomUUID()}`, {
    routingAdapter: adapter,
    graphState: GRAPH as never,
  });
  return out.response;
}

describe('the proactive outside-view offer reaches a substantive turn', () => {
  beforeEach(() => {
    mockState.persistedGraph = GRAPH;
    mockState.priorTurns = [];
    mockState.turnCount = 0;
    setTestSink(() => undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it('emits the cited card and BOTH chips on a bare point estimate at stage analyse', async () => {
    const resp = await run('moving to £59 will lose us 40 customers');
    const block = offerBlock(resp);
    expect(block, 'no outside-view coaching block on the response').toBeDefined();
    expect(block!['type']).toBe('coaching');
    expect(block!['action_intent']).toBe('run_outside_view');
    const prov = block!['dsk_claim_provenance'] as Block;
    // Bound by IDENTITY, and every value is the bundle's bytes.
    expect(prov['claim_id']).toBe('DSK-T-002');
    expect(prov['protocol_id']).toBe('DSK-P-002');
    expect(prov['evidence_strength']).toBe('strong');
    const ids = (resp.suggested_actions ?? []).map((a) => (a as Block)['id']);
    expect(ids).toContain(OUTSIDE_VIEW_ENGAGE_CHIP_ID);
    expect(ids).toContain(OUTSIDE_VIEW_DECLINE_CHIP_ID);
  });

  it('the model’s own answer survives — the offer is ADDITIVE, never a hijack', async () => {
    const resp = await run('moving to £59 will lose us 40 customers');
    expect(resp.assistant_text).toContain('Raising the price');
    expect(offerBlock(resp)).toBeDefined();
  });

  it('stands down when the conversation already used reference-class vocabulary', async () => {
    mockState.priorTurns = [
      priorTurn('typically these price rises cost us a few points of churn', 'noted'),
    ];
    mockState.turnCount = 1;
    expect(offerBlock(await run('moving to £59 will lose us 40 customers'))).toBeUndefined();
  });

  it('stands down after an explicit decline in durable history', async () => {
    mockState.priorTurns = [priorTurn(OUTSIDE_VIEW_DECLINE_MESSAGE)];
    mockState.turnCount = 1;
    expect(offerBlock(await run('moving to £59 will lose us 40 customers'))).toBeUndefined();
  });

  it('stands down on a framed quantity (a constraint, not an estimate)', async () => {
    expect(offerBlock(await run('we need to keep churn under 4%'))).toBeUndefined();
  });

  it('stands down on a narrow arithmetic request (CTL-11, through the real path)', async () => {
    expect(
      offerBlock(await run('Quick one — what’s £59 × 3,200 subscribers, just the raw monthly total?')),
    ).toBeUndefined();
  });

  it('reads the AUTHORITATIVE stage, not the client\u2019s echo', async () => {
    // Corrected from a wrong expectation this suite caught. `context.stage` is
    // `deriveAuthoritativeStage({requestedStage, freshness, optionCount, hasGraph})`
    // (`context/derive-stage.ts:258`), not `payload.stage`. A requested `decide`
    // over a graph with no fresh analysis is rewritten to `analyse`
    // (`:270` — "a stale `decide` echo must not outlive the analysis that earned
    // it"), which maps to DSK `evaluate`, where P-002 DOES apply.
    //
    // ⭐ That is the property worth having: a client cannot select the stage that
    // decides whether a science method is offered. The per-stage refusals are
    // exercised directly in `coaching/__tests__/outside-view-eligibility.test.ts`,
    // which can set the stage; an integration test cannot, by design.
    expect(offerBlock(await run('moving to £59 will lose us 40 customers', 'decide'))).toBeDefined();
  });

  it('stands down when the window cannot be proven complete', async () => {
    // A truncated window cannot support "you never considered a reference class".
    mockState.priorTurns = [priorTurn('hello', 'hi')];
    mockState.turnCount = 9999;
    expect(offerBlock(await run('moving to £59 will lose us 40 customers'))).toBeUndefined();
  });

  it('never proposes a write', async () => {
    const resp = await run('moving to £59 will lose us 40 customers');
    const block = offerBlock(resp);
    expect(JSON.stringify(block)).not.toMatch(/graph_patch|set_factor|mutat|observed_state/i);
  });
});

/**
 * ⛔⛔⛔ THE CALL-SITE BINDING. My own mutants showed the fix was unpinned exactly
 * where it mattered: dropping `userMessage` from
 * `deriveOutsideViewHistory(context.prior_turns, userMessage)` in
 * `turn-executor.ts` left 86 unit tests green. That is the same defect the Panel
 * lane found in a sibling PR — a spec that pins the mechanism and not the wiring.
 *
 * These drive the REAL `runTurnExecutor`, so a revert at the call site turns them
 * RED. Each carries a contrast control in the same describe, so "the offer never
 * appears" cannot pass them.
 */
describe('the CURRENT turn settles the offer, through the real executor', () => {
  beforeEach(() => {
    mockState.persistedGraph = GRAPH;
    mockState.priorTurns = [];
    mockState.turnCount = 0;
    setTestSink(() => undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  /**
   * ⛔ THE ARMING PRIOR TURN IS ESSENTIAL, and my first attempt at these tests
   * did not have it — they passed VACUOUSLY. Step 6 of the gate reads
   * `signals.numericEstimatePresent` over the whole prior corpus; with an empty
   * window and a decline message carrying no digits it returns `needs_input`, so
   * the offer stood down for a reason that had nothing to do with the fix. My own
   * mutant caught it: dropping `userMessage` at the call site left them green.
   *
   * With this prior turn the corpus IS armed, and — per the reviewer's note that
   * the current-message frame check only SUPPRESSES — a follow-up carrying no
   * number is eligible. That is the state in which the decline turn was re-offered.
   */
  const ARMING_TURN = () => [priorTurn('moving to £59 will lose us 40 customers', 'noted')];

  it('CONTROL: with the corpus armed, a number-free follow-up DOES offer', async () => {
    mockState.priorTurns = ARMING_TURN();
    mockState.turnCount = 1;
    expect(
      offerBlock(await run('so what should we weigh up here?')),
      'precondition: the armed corpus makes a number-free turn eligible — without this the two tests below are vacuous',
    ).toBeDefined();
  });

  it('does NOT re-offer on the turn the user DECLINES (review probe P1/P1b)', async () => {
    mockState.priorTurns = ARMING_TURN();
    mockState.turnCount = 1;
    expect(offerBlock(await run(OUTSIDE_VIEW_DECLINE_MESSAGE))).toBeUndefined();
  });

  it('does NOT re-offer on the turn the user ENGAGES (review probe P2)', async () => {
    mockState.priorTurns = ARMING_TURN();
    mockState.turnCount = 1;
    expect(offerBlock(await run(OUTSIDE_VIEW_ENGAGE_MESSAGE))).toBeUndefined();
  });

  it('the decline chip is emitted FIRST, so a chip budget trims the commitment not the refusal', async () => {
    const resp = await run('moving to £59 will lose us 40 customers');
    const ids = (resp.suggested_actions ?? []).map((a) => (a as Block)['id'] as string);
    const d = ids.indexOf(OUTSIDE_VIEW_DECLINE_CHIP_ID);
    const e = ids.indexOf(OUTSIDE_VIEW_ENGAGE_CHIP_ID);
    expect(d, 'the decline chip reaches the response').toBeGreaterThanOrEqual(0);
    expect(e, 'the engage chip reaches the response').toBeGreaterThanOrEqual(0);
    expect(d, 'decline precedes engage').toBeLessThan(e);
  });
});
