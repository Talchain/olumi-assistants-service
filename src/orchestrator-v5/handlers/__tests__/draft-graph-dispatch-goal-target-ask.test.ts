/**
 * The goal-target candidate becomes an ARMED QUESTION on the draft commit.
 *
 * ⭐ THIS IS THE ARRIVAL LINK THE CONTRACT TURNS ON. The producer's own test
 * proves the candidate reaches `ctx` and then `DraftGraphResult`. Neither
 * proves a QUESTION is ever put. This does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({ handleDraftGraph: vi.fn() }));
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));
vi.mock('../../build-turn-context.js', () => ({
  buildTurnContext: vi.fn(),
  loadMostRecentPendingActions: vi.fn().mockResolvedValue([]),
  loadPersistedGraphStrict: vi.fn(),
  loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
}));

import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import type { PendingAction } from '../../session/pending-action.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

const GRAPH = {
  nodes: [
    { id: 'goal_mrr', kind: 'goal', label: 'Reach £20k MRR' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 49 } },
    { id: 'opt_raise', kind: 'option', label: 'Raise to 59' },
  ],
  edges: [
    { from: 'fac_price', to: 'goal_mrr', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

const makePayload = () => ({
  scenario_id: SCENARIO_ID,
  turn_id: TURN_ID,
  message: 'Given our goal of reaching £20k MRR, should we raise the Pro price?',
  stage: 'frame',
}) as never;

/**
 * ⭐ THE READINESS ASK'S OWN PRECONDITIONS, derived at its source rather than
 * guessed: `projectReadinessRecovery` needs `status === 'needs_user_input'` and
 * a head blocker of type `missing_value` carrying option/factor id AND label;
 * `buildReadinessEffectPending` then requires EXACTLY ONE node of each kind
 * whose id and trimmed label both match. Anything less returns null silently.
 */
const READINESS_THAT_ASKS = {
  status: 'needs_user_input',
  blockers: [
    {
      blocker_type: 'missing_value',
      option_id: 'opt_raise',
      option_label: 'Raise to 59',
      factor_id: 'fac_price',
      factor_label: 'Price',
    },
  ],
};

const makeDraftResult = (goalTargetCandidate?: unknown, analysisReady?: unknown) => ({
  blocks: [],
  assistantText: 'Drafted a decision graph.',
  latencyMs: 1000,
  strengthenItems: [],
  coachingSummary: null,
  coachingWideningLog: null,
  coachingBiasSignals: null,
  draftWarnings: [],
  graphOutput: JSON.parse(JSON.stringify(GRAPH)),
  ...(goalTargetCandidate !== undefined ? { goalTargetCandidate } : {}),
  ...(analysisReady !== undefined ? { analysisReady } : {}),
});

const candidate = (over: Record<string, unknown> = {}) => ({
  goal_node_id: 'goal_mrr',
  value_user_units: 20000,
  unit: '£',
  label_span: 'Reach £20k MRR',
  brief_span: '£20k MRR',
  binding: 'governed',
  reason: 'governed',
  ...over,
});

function committedPendings(): readonly PendingAction[] {
  const calls = vi.mocked(commitDirectAnswer).mock.calls;
  expect(calls.length).toBe(1);
  const meta = calls[0]![1] as { pending_actions?: readonly PendingAction[] };
  return meta.pending_actions ?? [];
}
/** The provisional response handed to the DURABLE commit — the conversation record. */
function committedAssistantText(): string {
  const calls = vi.mocked(commitDirectAnswer).mock.calls;
  expect(calls.length).toBe(1);
  return ((calls[0]![0] as { assistant_text?: string }).assistant_text) ?? '';
}
const THE_QUESTION = 'What target should this goal be scored against? Reply with an amount.';
const goalAsks = () => committedPendings().filter((p) => p.action.kind === 'elicit_goal_target');

beforeEach(() => {
  vi.clearAllMocks();
  setTestSink(() => {});
  vi.mocked(commitDirectAnswer).mockImplementation(async (resp) => ({
    response: resp,
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted: true,
    persistedAnalysisGraphHash: null,
    persistedGraph: null,
    modelVersionReceipt: null,
    pendingLifecycle: {
      priorCount: 0, consumedCount: 0, supersededCount: 0, expiredWallCount: 0,
      expiredTurnsCount: 0, hashInvalidatedCount: 0, capDroppedCount: 0, survivedCount: 0,
    },
  }) as never);
});
afterEach(() => setTestSink(null));

describe('the goal-target candidate becomes an armed question on the draft commit', () => {
  it('a GOVERNED candidate ⇒ an elicit_goal_target pending reaches the commit, asking for an AMOUNT', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(makeDraftResult(candidate()) as never);
    await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-1', request: STUB_REQUEST });

    const asks = goalAsks();
    expect(asks).toHaveLength(1);
    const a = asks[0]!.action as { kind: string; goal_node_id: string; question: string; unit?: string };
    expect(a.goal_node_id).toBe('goal_mrr');
    expect(a.question).toContain('Reply with an amount');
    expect(a.unit).toBe('£');
    // bound to a verifiable precondition, not asserted
    expect(asks[0]!.preconditions).toHaveProperty('graph_hash');
    expect(String((asks[0]!.preconditions as { graph_hash?: string }).graph_hash ?? '')).not.toBe('');
  });

  it('⭐ NEGATIVE TWIN: no candidate ⇒ NO goal-target pending (so the arm is not always-on)', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(makeDraftResult() as never);
    await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-2', request: STUB_REQUEST });
    expect(goalAsks()).toHaveLength(0);
  });

  /**
   * ⛔ THE REJECTED PROPOSAL, COMPOSED FROM WHAT THE PRODUCER ACTUALLY RETURNS.
   *
   * My earlier version FABRICATED `present_unbound / negated_target` for this
   * brief. The producer's own corpus (S18-S20) pins
   * "We rejected the proposal to reach £64k MRR." as **`governed`** — because
   * `governed` means *the round-5 governor would have minted it*, NOT *the user
   * established it*. So my test asserted against a fixture I invented, and the
   * real candidate would have been quoted. A fixture I wrote myself was never
   * evidence about the producer.
   */
  it('the REJECTED proposal (producer says `governed`) still never surfaces the figure', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(
      makeDraftResult(candidate({ binding: 'governed', reason: 'governed', brief_span: '£64k MRR', value_user_units: 64000 })) as never,
    );
    await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-3', request: STUB_REQUEST });
    const asks = goalAsks();
    expect(asks).toHaveLength(1);
    const q = (asks[0]!.action as { question: string }).question;
    expect(q).not.toContain('64');
    expect(q).toContain('Reply with an amount');
  });

  it('a candidate naming a goal the COMMITTED graph does not carry ⇒ no pending', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(
      makeDraftResult(candidate({ goal_node_id: 'goal_absent' })) as never,
    );
    await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-4', request: STUB_REQUEST });
    expect(goalAsks()).toHaveLength(0);
  });

  /**
   * ⛔⛔ ONE ACTIVE NUMBER-ASK AT A TIME — AND THIS INVERTS WHAT I ASSERTED BEFORE.
   *
   * My previous test proved BOTH pendings survive the commit. True, and the
   * state it documents is the one that BREAKS the feature: Codex measured that
   * with both live, `tryGoalTargetElicitationResume` on "£20k" returns
   * `matched: false / no_pending_question`. `findSoleLiveGoalTargetPending`
   * counts every live numeric claimant and is right to.
   *
   * ⭐ The property is ANSWER-HEARD. Array contents were never it.
   */
  it('a readiness ask already armed ⇒ the goal-target ask STANDS DOWN (sole numeric claimant)', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(
      makeDraftResult(candidate(), READINESS_THAT_ASKS) as never,
    );
    await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-5', request: STUB_REQUEST });
    const kinds = committedPendings().map((p) => p.action.kind);
    // PRECONDITION: the readiness ask really fired, or this passes vacuously.
    expect(kinds).toContain('elicit_option_effect');
    expect(kinds).not.toContain('elicit_goal_target');
    expect(committedPendings()).toHaveLength(1);
  });

  it('⭐ TWIN: with NO readiness ask, the goal-target ask is armed and is the only claimant', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(makeDraftResult(candidate()) as never);
    await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-6', request: STUB_REQUEST });
    expect(committedPendings().map((p) => p.action.kind)).toEqual(['elicit_goal_target']);
  });
});

describe('the question REACHES THE PERSON — armed is not asked', () => {
  it('the RETURNED response carries the question', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(makeDraftResult(candidate()) as never);
    const r = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-7', request: STUB_REQUEST });
    expect(r.response.assistant_text ?? '').toContain(THE_QUESTION);
  });

  it('the DURABLE conversation record carries the SAME bytes', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(makeDraftResult(candidate()) as never);
    await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-8', request: STUB_REQUEST });
    expect(committedAssistantText()).toContain(THE_QUESTION);
    // the pending, the record and the response are ONE decision, not three
    const asked = goalAsks()[0]!.action as { question: string };
    expect(committedAssistantText()).toContain(asked.question);
  });

  it('⭐ CONTROL — no candidate ⇒ neither surface mentions a target question', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(makeDraftResult() as never);
    const r = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-9', request: STUB_REQUEST });
    expect(r.response.assistant_text ?? '').not.toContain(THE_QUESTION);
    expect(committedAssistantText()).not.toContain(THE_QUESTION);
  });

  /**
   * ⭐ THE REAL PROPERTY: THE WIRE AND THE DURABLE RECORD CARRY THE SAME BYTES.
   *
   * The question is written ONCE, into the provisional response handed to the
   * commit that also stores the pending, and the estate's existing re-attach
   * carries it to the wire. **Pending and sentence are atomic**, so there is no
   * state where one exists without the other — which is what "no second write
   * after a failed commit" buys. A commit that never happened ships nothing
   * because it stored nothing.
   */
  it('⭐ the wire text and the committed text are the SAME bytes, not two compositions', async () => {
    vi.mocked(handleDraftGraph).mockResolvedValue(makeDraftResult(candidate()) as never);
    const r = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-10', request: STUB_REQUEST });
    const asked = (goalAsks()[0]!.action as { question: string }).question;
    expect(committedAssistantText()).toContain(asked);
    expect(r.response.assistant_text ?? '').toContain(asked);
  });
});