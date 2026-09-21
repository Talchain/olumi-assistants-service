/**
 * Structural-restructure routing — the propose side of the four-turn-nothing
 * fix (LATENCY-RECAPTURE finding 3; probe 69a2f44f, build e7f312d).
 *
 * THE DEFECT (base): a free-text restructure request carries no
 * EDIT_GRAPH_POSITIVE_REGEX verb — "split the shared factor into per-option
 * links" contains none of change/update/edit/…/lower — so `editIntentDetected`
 * is false and the message falls through to the coach (turn_executor), which
 * DESCRIBES the change without seeding any apply action. A following
 * "Yes, apply it now" then has no held proposal to resume.
 *
 * THE FIX: `detectStructuralRestructureIntent` joins `editIntentDetected` as a
 * third edit-lane candidate (the `configureOptionIntent` precedent), so the
 * restructure request reaches `dispatchEditGraph` — the sole structural-
 * proposal producer (add_node/add_edge → STRUCTURAL_APPLY_HELD held proposal +
 * confirm chip). The bare consent then resumes through the already-wired
 * short-confirm → executeGmHeldResume path (proven by
 * route-v2-held-proposal-confirm.test.ts — the confirm side of the journey).
 *
 * This suite pins the PROPOSE side: a restructure request must REACH the edit
 * lane, and a plain conversational message must NOT. Mutation-check: revert the
 * `structuralRestructureIntent` addition to `editIntentDetected` → the two
 * restructure cases stop calling `dispatchEditGraph` (they reach the coach) —
 * RED, proving the routing (not a pre-existing path) carries the turn.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { GraphV3 } from '../../schemas/cee-v3.js';
import type { ChatWithToolsResult } from '../../adapters/llm/types.js';
import { _resetConfigCache } from '../../config/index.js';
import { TurnSource } from '@talchain/schemas/boundary';
import { detectStructuralRestructureIntent } from '../../orchestrator-v5/routing/structural-restructure-intent.js';
import {
  buildGmHeldPublicCopy,
  describeHeldOperationsSubject,
} from '../../orchestrator-v5/handlers/edit-graph-referee-gate.js';

const SCENARIO_ID = '88888888-8888-4888-8888-888888888888';

// Spy on the edit lane. A resolved `commitPerformed` result is enough — this
// suite asserts REACHABILITY (was the edit lane called?), not the lane's own
// held-proposal internals (covered by the edit-graph-dispatch suites).
const dispatchEditGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

// The coach path: a text-only routing result → interpreted as converse. Only
// the negative-control turn should reach it; the restructure turns must not.
const chatWithToolsMock = vi.fn(async (): Promise<ChatWithToolsResult> => ({
  content: [{ type: 'text', text: 'Here is a reflection on the shared factor.' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 20 },
  model: 'test-model',
  latencyMs: 10,
}));
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: {
      task: 'orchestrator',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => SHARED_FACTOR_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: SHARED_FACTOR_GRAPH, briefText: null }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

/**
 * A model with a SHARED factor ('Cost') linked to the goal, and two options —
 * the exact shape a "split the shared factor into per-option links" request
 * addresses. Passes GraphV3 + the ingress parse.
 */
const SHARED_FACTOR_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Build in-house' },
    { id: 'opt-b', kind: 'option', label: 'Outsource' },
    { id: 'goal-g', kind: 'goal', label: 'Ship the platform' },
    {
      id: 'fac-cost',
      kind: 'factor',
      label: 'Cost',
      observed_state: { value: 0.3, raw_value: 30, cap: 100 },
    },
  ],
  edges: [
    {
      from: 'fac-cost',
      to: 'goal-g',
      strength: { mean: -0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ],
};
{
  const parsed = GraphV3.safeParse(SHARED_FACTOR_GRAPH);
  if (!parsed.success) {
    throw new Error('Fixture failed GraphV3.safeParse: ' + JSON.stringify(parsed.error.issues));
  }
}

function payload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '99999999-9999-4999-8999-999999999999',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'placeholder',
    turn_class: 'decide',
    source: 'composer',
    graph_state: SHARED_FACTOR_GRAPH,
    ...overrides,
  };
}

describe('POST /orchestrate/v2/turn — free-text structural restructure routes to the edit lane', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('ENABLE_V5_ORCHESTRATOR', 'true');
    vi.stubEnv('CEE_PIPELINE_V4_ENABLED', 'false');
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });
  beforeEach(() => {
    dispatchEditGraphMock.mockReset();
    dispatchEditGraphMock.mockResolvedValue({
      response: {
        response_version: 2 as const,
        assistant_text: "I'll split 'Cost' into a per-option link for each option. Confirm to apply.",
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'analyse' as const,
      },
      commitPerformed: true,
    });
    chatWithToolsMock.mockClear();
    appendMock.mockClear();
  });

  it('the probe message "split the shared factor into per-option links" reaches dispatchEditGraph (per_option_term)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'split the shared factor into per-option links' }),
    });
    expect(res.statusCode).toBe(200);
    // Routed to the structural-proposal producer, NOT the coach.
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('the "each option its own X" framing reaches dispatchEditGraph (each_option_own)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'give each option its own cost factor' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it.each([
    'Rename factor "Engineer interruption rate" to "Unplanned engineer interruptions".',
    'Please rename the factor "Cost" to "Delivery effort".',
    "Relabel option 'Outsource' to 'Partner delivery'",
  ])('explicit rename reaches the existing edit dispatcher: %s', async (message) => {
    const res = await app.inject({
      method: 'POST', url: '/orchestrate/v2/turn',
      payload: payload({ message, stage: 'frame', turn_class: 'frame' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it.each([
    'Should we rename factor "Cost" to "Budget"?',
    'Should we rename factor "Cost" to "Budget"',
    'Do not rename factor "Cost" to "Budget".',
    'Please do not rename factor "Cost" to "Budget".',
    'We discussed renaming factor "Cost" to "Budget".',
    'Rename factor "Cost" to "Budget" only if I confirm.',
    'Rename factor "Cost" to "Budget", but do not apply it yet.',
  ])('rename discussion or withheld consent does not enter mutation: %s', async (message) => {
    const res = await app.inject({
      method: 'POST', url: '/orchestrate/v2/turn',
      payload: payload({ message, stage: 'frame', turn_class: 'frame' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });

  it('the mounted rename shape reaches edit dispatch without caller graph_state', async () => {
    const request = payload({
      message: 'Rename factor "Engineer interruption rate" to "Unplanned engineer interruptions".',
      stage: 'frame', turn_class: 'frame',
    });
    delete request.graph_state;
    const res = await app.inject({
      method: 'POST', url: '/orchestrate/v2/turn', payload: request,
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('a plain conversational message does NOT reach the edit lane (reaches the coach)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'tell me about the shared factor across my options' }),
    });
    expect(res.statusCode).toBe(200);
    // The negative control: no restructure phrasing → the coach owns it, the
    // edit lane is never touched. This is what the two positives discriminate
    // against — the fix routes ONLY restructure requests to the edit lane.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).toHaveBeenCalled();
  });

  /**
   * #644 adversarial P2-1 — the precision boundary (through the REAL route).
   *
   * The review reproduced five FALSE POSITIVES: genuine QUESTIONS that the base
   * detector matched, routing a coaching question into the edit lane (held
   * proposal + confirm chip) instead of a coach discussion. Each passes the
   * shared route negative gates (analytical-question / state-query) — that is
   * WHY they leaked — so the interrogative gate must live in the detector.
   *
   * MUTATION PIN (route level): remove the interrogative gate from
   * detectStructuralRestructureIntent → all five reach dispatchEditGraph — RED.
   * This proves (a) the gate carries the turn and (b) the route's own negative
   * gates do NOT independently catch these five.
   */
  describe('interrogative/state QUESTIONS reach the coach, NOT the edit lane (#644 P2-1)', () => {
    const questionFalsePositives: ReadonlyArray<string> = [
      'should I make the cost factor per-option?',
      'should I split the cost into per-option links?',
      'would it be better to give each option its own cost factor?',
      'do you think each option should have its own driver?',
      'does each option have its own cost factor?',
    ];
    it.each(questionFalsePositives)('%s → coach (dispatchEditGraph NOT called)', async (message) => {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload({ message }),
      });
      expect(res.statusCode).toBe(200);
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();
      expect(chatWithToolsMock).toHaveBeenCalled();
    });
  });

  /**
   * #644 acceptance regression (do NOT over-correct): an IMPERATIVE restructure
   * — including the polite-imperative "can you split …" form — must STILL reach
   * the edit lane. These are still-RED-on-revert positives for the precision
   * boundary: they stay GREEN with the gate, and go RED if the gate over-reaches
   * (e.g. suppresses on a bare "can" or any question word).
   */
  describe('IMPERATIVE restructures still reach the edit lane (#644 acceptance)', () => {
    const imperativePositives: ReadonlyArray<string> = [
      'split the cost into per-option links',
      'give each option its own driver',
      'can you split the shared cost driver into per option links',
    ];
    it.each(imperativePositives)('%s → dispatchEditGraph called', async (message) => {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload({ message }),
      });
      expect(res.statusCode).toBe(200);
      expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
      expect(chatWithToolsMock).not.toHaveBeenCalled();
    });
  });

  /**
   * ⭐⭐ #1231 IDENTITY TWIN — the product's own confirm-chip copy must never
   * re-enter the lane that PRODUCED it.
   *
   * THE DEFECT this pins (introduced by this PR's `quoted_rename_command`
   * arm, blocker verified at head e30e078d): a rename-only held batch's
   * public copy is minted by `describe-changeset.ts` as
   * `rename 'X' to 'Y'`, capitalised by `buildGmHeldPublicCopy` into the
   * confirm chip's LABEL — "Rename 'Cost' to 'Delivery effort'". That string
   * carries NO `EDIT_GRAPH_POSITIVE_REGEX` verb (rename/relabel are absent
   * from it — derived at edit-graph-intent-regex.ts:20), so before this PR a
   * chip replay could never be claimed as an edit-lane intent. The new arm
   * makes the product's own label match the structural detector, so the
   * replay becomes an edit-lane intent — and when the hold it confirms is no
   * longer in the pending set (already consumed, or swept), the route-level
   * exact-copy resolver returns `replay_no_match` and the turn DISPATCHES THE
   * EDIT LANE, which drafts a SECOND hold and renders ANOTHER confirm chip.
   * Confirm-click-returns-another-confirm — the loop this feature exists to
   * kill. `readMostRecentPendingActions` returns [] in this suite, which is
   * exactly that state.
   *
   * THE FIX is IDENTITY-BOUND, not textual: the quoted-rename arm is not
   * honoured for a `chip_click` ingress — the product's own affordance being
   * replayed — while every typed rename is untouched. A user cannot type an
   * ingress source, so nothing a user can write is excluded by it.
   *
   * ⭐ THE TWIN IS THE POINT, and both halves run here in the SAME run on the
   * SAME string, differing ONLY in `source`. A test that only proved the
   * chip does not re-enter would pass equally if the whole arm were deleted;
   * a test that only proved the typed rename routes would pass equally at the
   * unfixed head. Only the PAIR discriminates the identity gate from both.
   */
  describe("the product's own rename chip is not a fresh rename command (#1231)", () => {
    // Derived from the PRODUCERS the runtime uses — never a test-authored
    // alias (trap 16-inverse: a fixture you wrote yourself is not evidence
    // about the wire). `describeHeldOperationsSubject` + `buildGmHeldPublicCopy`
    // are the same two calls edit-graph-referee-gate makes when it HOLDS a
    // rename batch against this graph.
    const RENAME_OPERATIONS = [
      { op: 'update_node', path: 'fac-cost', value: { label: 'Delivery effort' } },
    ];
    const PRODUCT_CHIP = buildGmHeldPublicCopy(
      describeHeldOperationsSubject(RENAME_OPERATIONS, SHARED_FACTOR_GRAPH),
    );

    // PRECONDITION PIN (trap 13b): this suite's conclusion is only about the
    // identity gate if the string under test genuinely triggers the new arm.
    // If the producer's copy ever stops matching `quoted_rename_command`, the
    // twin below would pass by testing nothing — so assert it here and RED.
    it('precondition: the producer mints the quoted-rename shape the new arm claims', () => {
      expect(PRODUCT_CHIP.label).toBe("Rename 'Cost' to 'Delivery effort'");
      expect(detectStructuralRestructureIntent(PRODUCT_CHIP.label)).toEqual({
        matched: true,
        trigger: 'quoted_rename_command',
      });
    });

    it('(a) TYPED by the user, that exact string still reaches the structural edit dispatcher', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload({ message: PRODUCT_CHIP.label, source: 'composer' }),
      });
      expect(res.statusCode).toBe(200);
      expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
      expect(chatWithToolsMock).not.toHaveBeenCalled();
    });

    /**
     * ⚠⚠ THIS TEST USED TO DRIVE `chip_click` ALONE, AND THAT IS EXACTLY HOW
     * THE GUARD SHIPPED DARK. The wire union has FOUR members and the deployed
     * UI sends a held-confirm chip as `'chip'` (buildPayload.ts promotes to
     * `chip_click` only for a chip carrying a published, CEE-accepted
     * `action_type`; the held-confirm chip carries none). A single-member twin
     * cannot see a guard bound to the wrong member — it agrees with itself on
     * the one value it was written for. The `it.each` below drives EVERY
     * replayed member on the SAME string, and the exhaustiveness assertion
     * makes a contract widening RED here rather than silently untested.
     */
    const REPLAYED_SOURCES = ['chip', 'chip_click', 'retry'] as const;
    const FRESHLY_AUTHORED_SOURCES = ['composer'] as const;

    it('precondition: the twin below covers the WHOLE contract source union', () => {
      // Not derived from the routing code under test — from the CONTRACT. If a
      // fifth member lands, this REDs until it is adjudicated into one arm.
      expect([...REPLAYED_SOURCES, ...FRESHLY_AUTHORED_SOURCES].sort())
        .toEqual([...TurnSource.options].sort());
    });

    it.each(REPLAYED_SOURCES)(
      "(b) REPLAYED as the product's own chip via source=%s, that exact string does NOT re-enter the edit lane",
      async (source) => {
        const res = await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: payload({ message: PRODUCT_CHIP.label, source }),
        });
        expect(res.statusCode).toBe(200);
        // No second hold is drafted: the edit lane — the sole structural-proposal
        // producer — is never called, so no new confirm chip can be minted.
        expect(dispatchEditGraphMock).not.toHaveBeenCalled();
        expect(chatWithToolsMock).toHaveBeenCalled();
      },
    );

    // The chip's MESSAGE variant ("Yes, rename 'Cost' to 'Delivery effort'.")
    // is affirmative-prefixed, so it never matched the anchored rename arm in
    // the first place; pinned so a future widening of the anchor cannot
    // silently reopen the same door through the other replayed string.
    // SCOPE PIN — the guard is bound to the RENAME ARM, not to chip_click at
    // large. Without this, widening the exclusion to every structural trigger
    // would look identical to the fix, and #644 P2-2's genuine future case (a
    // chip rendering restructure-phrased copy) would be silently switched off.
    it.each(REPLAYED_SOURCES)(
      '(d) a per-option replay via source=%s is untouched by the guard and still reaches the edit lane',
      async (source) => {
        const res = await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: payload({
            message: 'split the shared factor into per-option links',
            source,
          }),
        });
        expect(res.statusCode).toBe(200);
        expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
        expect(chatWithToolsMock).not.toHaveBeenCalled();
      },
    );

    it("(c) the chip's MESSAGE variant likewise does not re-enter the edit lane", async () => {
      expect(PRODUCT_CHIP.message).toBe("Yes, rename 'Cost' to 'Delivery effort'.");
      for (const source of REPLAYED_SOURCES) {
        dispatchEditGraphMock.mockClear();
        const res = await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: payload({ message: PRODUCT_CHIP.message, source }),
        });
        expect(res.statusCode).toBe(200);
        expect(dispatchEditGraphMock).not.toHaveBeenCalled();
      }
    });
  });
});
