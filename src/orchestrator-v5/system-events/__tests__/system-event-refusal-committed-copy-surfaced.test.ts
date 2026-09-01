/**
 * THE SYSTEM-EVENT REFUSAL EXITS SHIP THE COMPOSED ANSWER, NOT THE COMMITTED
 * ONE — so the F-HELD lapse copy is persisted into the turn row and never
 * spoken to the user.
 *
 * This is PR #1290's defect class, in two call sites #1290 never touched.
 * #1290 closed the two `chip-click-dispatch.ts` `run_analysis` exits; these two
 * were reported independently by the founder and by a reviewer that found them
 * while #1290 was still in scope and raised them rather than dropping them.
 *
 * MECHANISM, derived at the bytes on staging `c2e3804c`:
 *
 *   1. `commitDirectAnswer` (commit.ts) runs its carry-forward pass over
 *      `metadata.priorPendingActions`. When that pass turn-TTL-drops — or
 *      consent-priority-cap-evicts — a CONFIRMATION_EXPECTING pending, it
 *      appends ONE deterministic sentence (`buildHeldLapseNotice`, commit.ts
 *      `:754`) to the response it is about to persist and returns THAT amended
 *      object as `CommitResult.response` (commit.ts `:1313-1330`). The same
 *      return value also carries the steer-don't-bind suppression of competing
 *      `run_analysis` suggestion chips (commit.ts `:1225-1255`). BOTH seams
 *      fire off `metadata.priorPendingActions`.
 *   2. `commit.ts`'s own return-site docblock states the contract: callers that
 *      consume `CommitResult.response` surface it on the wire, so wire copy ==
 *      durable copy — and a caller that threads `priorPendingActions` but
 *      DISCARDS this value persists the notice without ever speaking it.
 *   3. BOTH system-event refusal exits below DID exactly that. Each threads
 *      `priorPendingActions` into commit metadata, `await`s the commit with NO
 *      assignment, and then returns its own local PRE-COMMIT `response`:
 *        - `dispatch.ts` `dispatchEdgeStrengthEdit`, `result.kind === 'refused'`
 *        - `dispatch.ts` `dispatchStructuralDelete`,  `result.kind === 'refused'`
 *
 * REACHABILITY, established rather than assumed: `dispatchSystemEvent` has
 * exactly one call site (`src/orchestrator/route-v2.ts:2662`) and its
 * `.response` flows to `sendFinalised200`. These returns are USER-FACING.
 *
 * ⚠ SCOPE, STATED EXACTLY (CLAUDE.md trap 20 — restate a finding's scope, never
 * its generalisation). A THIRD bare-`await` refusal exit exists at
 * `dispatchFactorValueEdit`, and it is deliberately NOT changed here: derived at
 * this HEAD, `priorPendingActions` occurs 10 times in `dispatch.ts` and EVERY
 * occurrence is above line 1497, which is `dispatchFactorValueEdit`'s own
 * declaration — so that site threads no priors, its carry-forward is inert, and
 * `commitDirectAnswer` can amend nothing there. `commit.ts`'s own
 * REMAINING-wipe-sharers docblock (`:740-753`) independently names it as a site
 * that still needs `threadHoldsThroughMutatingCommit`. Making it thread priors
 * is a deliberate separate change with its own acceptance, not a silent
 * widening of this one.
 *
 * ⭐ WHAT THIS SUITE BINDS TO, AND WHY IT IS NOT A STRUCTURAL ASSERTION.
 *
 * A mutation is successful only if the intended SEMANTIC transition landed —
 * not that some mutation occurred, a call returned, or a value was assigned.
 * So this suite does NOT assert "the commit result was assigned" or "the
 * returned object differs from the composed one": both would pass for a fix
 * that assigns and then still ships the wrong object. It asserts the
 * SEMANTIC OBJECT — that the exact lapse sentence a user would READ is present
 * in the shipped response when a hold lapses during the commit, and absent
 * when nothing lapses.
 *
 * The expectation is derived from the REAL producer `buildHeldLapseNotice`
 * against the REAL hold under test and never re-typed here, so a change to the
 * copy moves this suite with it instead of silently decoupling (trap 13c: a
 * mutant kit measures whether a test can DETECT a change, never whether the
 * EXPECTATION is right).
 *
 * ⭐ EVERY CASE PINS ITS OWN PRECONDITIONS IN-TEST (trap 13b — a guard whose
 * fixture quietly stops triggering the behaviour is a tautology that stays
 * green). Three preconditions are asserted, not assumed:
 *
 *   (a) the dispatcher actually reached the writer under test (its adapter mock
 *       was called) — `edge_strength_edit` silently DOWNGRADES to a
 *       `reader_only_refusal` whenever `config.features.graphCas.rpcEnforce`
 *       is not true (`dispatch.ts:563`), which is a completely different code
 *       path that would make a green result meaningless;
 *   (b) the commit was handed `priorPendingActions` CONTAINING the hold under
 *       test — this is the exact conjunct that lets `commitDirectAnswer` amend
 *       at all, so if a future change stops threading priors these cases must
 *       RED loudly rather than pass vacuously;
 *   (c) the refusal path was taken (`commitPerformed: true`, no graph write).
 *
 * ⭐ THE OPPOSITE-DIRECTION TWIN IS MANDATORY and is the half that makes the
 * positive cases mean anything. `commitDirectAnswer` returns the SAME OBJECT on
 * its untouched fast path (documented at commit.ts's return site). A dispatcher
 * that unconditionally emitted a notice would pass every positive case — an
 * always-on notice is no notice. Each twin asserts BOTH that no lapse copy
 * appears AND that the shipped object is REFERENTIALLY the composed one, so a
 * fix that swapped one unconditional for another is still visible.
 *
 * ⭐ THE TWO SITES ARE DISCRIMINATED: each site's cases drive only its own
 * event kind, so reverting one site's fix REDs only that site's cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import type { PendingAction } from '../../session/pending-action.js';

const mocks = vi.hoisted(() => ({
  loadPersistedGraphStrict: vi.fn(),
  loadMostRecentPendingActionsIntegrityStrict: vi.fn(),
  loadPriorFactsWithReadState: vi.fn(),
  commitDirectAnswer: vi.fn(),
  applyEdgeStrengthEdit: vi.fn(),
  applyStructuralDelete: vi.fn(),
}));

// `importOriginal`-spread on EVERY mock, deliberately (CLAUDE.md trap 12 — a
// `vi.mock` factory REPLACES the module, so a hand-listed export set silently
// loses every export added since it was written). It also gives this suite the
// REAL `buildHeldLapseNotice` and the REAL `computeRequestHash`.
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadPersistedGraphStrict: mocks.loadPersistedGraphStrict,
  loadMostRecentPendingActionsIntegrityStrict:
    mocks.loadMostRecentPendingActionsIntegrityStrict,
  loadPriorFactsWithReadState: mocks.loadPriorFactsWithReadState,
}));

vi.mock('../../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commit.js')>()),
  commitDirectAnswer: mocks.commitDirectAnswer,
}));

vi.mock('../edge-strength-edit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../edge-strength-edit.js')>()),
  applyEdgeStrengthEdit: mocks.applyEdgeStrengthEdit,
}));

vi.mock('../structural-delete.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../structural-delete.js')>()),
  applyStructuralDelete: mocks.applyStructuralDelete,
}));

import { dispatchSystemEvent } from '../dispatch.js';
import { buildHeldLapseNotice } from '../../commit.js';
import { config, _resetConfigCache } from '../../../config/index.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** A minimal graph that parses as GraphV3, so `contentGraph` is non-null. */
const PERSISTED_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Grow revenue' },
    { id: 'fac_demand', kind: 'factor', label: 'Demand' },
  ],
  edges: [
    {
      from: 'fac_demand',
      to: 'goal_growth',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

/**
 * The lapsing hold every positive case is written about.
 *
 * The conjunction is TIGHTER than it looks, and each clause below is load
 * bearing (derived from a live wire probe on deployed staging plus commit.ts):
 *   - `apply_proposed_change` because ONLY `apply_proposed_change` /
 *     `proposed_concept` are CONFIRMATION_EXPECTING. A recorded effect-value
 *     ask (`elicit_option_effect`, TTL 12) is NOT in the set and can never
 *     produce this notice.
 *   - `expires_at_turn_count: 1` because the carry-forward decrement takes it
 *     to zero at THIS commit — the turn-TTL arm is the ONLY arm of the drop
 *     ladder that emits a notice, and the ladder SHORT-CIRCUITS
 *     (consumed → superseded → wall → graph-hash → turn-TTL), so any earlier
 *     arm would kill the notice silently.
 *   - a far-future `expires_at_iso` so the 10-minute WALL arm cannot fire first.
 */
const LAPSING_HOLD: PendingAction = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  scenario_id: SCENARIO_ID,
  chip_id: 'prop_widen_depot_budget',
  action: {
    kind: 'apply_proposed_change',
    proposal_ref: 'prop_widen_depot_budget',
    inline_patch: {},
    public_label: 'Widen the depot budget',
    public_message: 'Widen the depot budget',
  },
  preconditions: {},
  expires_at_turn_count: 1,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-08-31T12:00:00.000Z',
} as unknown as PendingAction;

/**
 * THE IDENTITY BINDING. Derived from the REAL producer against the REAL hold,
 * never re-typed — so this suite cannot drift from the copy it claims to pin,
 * and a reviewer can see the expectation is the producer's semantics rather
 * than this author's reading of them.
 */
const EXPECTED_NOTICE = buildHeldLapseNotice(LAPSING_HOLD);

function edgeStrengthPayload(): SystemEventTurnPayload {
  return {
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event: {
      kind: 'edge_strength_edit',
      from: 'fac_demand',
      to: 'goal_growth',
      magnitude: 0.7,
      direction_intent: 'preserve',
      expected: { mean: 0.5, effect_direction: 'positive' },
      intent: 'set',
    },
  } as unknown as SystemEventTurnPayload;
}

function structuralDeletePayload(): SystemEventTurnPayload {
  return {
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event: {
      kind: 'structural_delete',
      removed_node_ids: ['fac_demand'],
      removed_edges: [],
      base_graph_hash: 'a'.repeat(64),
    },
  } as unknown as SystemEventTurnPayload;
}

/** The honest domain refusal both adapters return — no conflict descriptor. */
function refusedResult(assistantText: string) {
  return {
    kind: 'refused' as const,
    reason: 'test_domain_refusal',
    response: {
      response_version: 2,
      assistant_text: assistantText,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse',
    },
  };
}

const EDGE_REFUSAL_TEXT = 'That connection is not in your model, so nothing was changed.';
const DELETE_REFUSAL_TEXT = 'That item is not in your model, so nothing was removed.';

/**
 * Faithful stand-in for the commit chokepoint's DOCUMENTED contract, in both of
 * its two states:
 *
 *   - `lapse: true`  — the carry-forward retired a consent hold, so the seam
 *     appends the notice to the response it persists and returns THAT amended
 *     object (commit.ts `:1323-1330`, using the same blank-line join).
 *   - `lapse: false` — nothing fired, so the seam returns the SAME OBJECT it was
 *     handed (commit.ts's return-site docblock: "the SAME object as the input on
 *     the untouched fast path").
 *
 * It records the response object AND the metadata it was given, so the cases can
 * assert referential identity and pin the `priorPendingActions` precondition.
 */
function installCommitSeam(opts: { lapse: boolean }): {
  committedInput: () => unknown;
  committedMetadata: () => Record<string, unknown> | undefined;
} {
  let seenResponse: unknown = undefined;
  let seenMetadata: Record<string, unknown> | undefined = undefined;
  mocks.commitDirectAnswer.mockImplementation(
    async (response: Record<string, unknown>, metadata: Record<string, unknown>) => {
      seenResponse = response;
      seenMetadata = metadata;
      const base =
        typeof response.assistant_text === 'string' ? response.assistant_text : '';
      return {
        response: opts.lapse
          ? {
              ...response,
              assistant_text:
                base.trim().length > 0 ? `${base}\n\n${EXPECTED_NOTICE}` : EXPECTED_NOTICE,
            }
          : response,
        performed: true,
        persisted_row_id: 'row-system-event-refusal',
        graphPersisted: false,
        persistedAnalysisGraphHash: null,
        persistedGraph: null,
        modelVersionReceipt: null,
        pendingLifecycle: { priorCount: 1, survivedCount: 0, capDroppedCount: 0 },
      };
    },
  );
  return {
    committedInput: () => seenResponse,
    committedMetadata: () => seenMetadata,
  };
}

/**
 * PRECONDITION (b), factored so every case pins it identically: the commit that
 * ran was handed the hold under test as a PRIOR pending. Without this conjunct
 * `commitDirectAnswer` cannot amend anything, and every positive assertion below
 * would be observing a notice this suite injected rather than a notice the
 * production seam could ever produce.
 */
function expectPriorsThreaded(metadata: Record<string, unknown> | undefined): void {
  expect(metadata, 'the commit seam was never reached').toBeDefined();
  expect(
    metadata?.priorPendingActions,
    'this exit must thread the newest valid pending set into commit metadata — it is the ' +
      'ONLY conjunct that lets the commit carry-forward retire a hold and attach a lapse ' +
      'notice, so a case that passes without it proves nothing about production',
  ).toEqual([LAPSING_HOLD]);
}

let priorRpc: string | undefined;
let priorMode: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  setTestSink(() => {});

  // `edge_strength_edit` is downgraded to a `reader_only_refusal` — a wholly
  // different code path — unless the atomic CAS RPC is enforcing
  // (`dispatch.ts:563`). Mirror the DEPLOYED staging posture exactly
  // (MODE=observe + RPC=enforce), which is also the only combination
  // `assertGraphCasCapabilityValid` accepts.
  priorRpc = process.env.CEE_V5_GRAPH_CAS_RPC;
  priorMode = process.env.CEE_V5_GRAPH_CAS_MODE;
  process.env.CEE_V5_GRAPH_CAS_RPC = 'enforce';
  process.env.CEE_V5_GRAPH_CAS_MODE = 'observe';
  _resetConfigCache();

  mocks.loadPersistedGraphStrict.mockResolvedValue(PERSISTED_GRAPH);
  mocks.loadMostRecentPendingActionsIntegrityStrict.mockResolvedValue([LAPSING_HOLD]);
  mocks.loadPriorFactsWithReadState.mockResolvedValue({ status: 'ok', facts: [] });
  mocks.applyEdgeStrengthEdit.mockResolvedValue(refusedResult(EDGE_REFUSAL_TEXT));
  mocks.applyStructuralDelete.mockReturnValue(refusedResult(DELETE_REFUSAL_TEXT));
});

afterEach(() => {
  setTestSink(null);
  if (priorRpc === undefined) delete process.env.CEE_V5_GRAPH_CAS_RPC;
  else process.env.CEE_V5_GRAPH_CAS_RPC = priorRpc;
  if (priorMode === undefined) delete process.env.CEE_V5_GRAPH_CAS_MODE;
  else process.env.CEE_V5_GRAPH_CAS_MODE = priorMode;
  _resetConfigCache();
  vi.restoreAllMocks();
});

describe('system-event refusal exits — the SHIPPED answer is the COMMITTED answer', () => {
  // ── PRECONDITION (a) for the edge writer, pinned once and loudly ─────────
  it('PRECONDITION: the deployed-staging CAS posture routes edge_strength_edit to the WRITER, not the reader-only refusal', () => {
    expect(
      config.features.graphCas.rpcEnforce,
      'without an enforcing CAS RPC, dispatch.ts:563 rewrites edge_strength_edit to a ' +
        'reader_only_refusal and every edge case below would silently exercise a different ' +
        'code path while still passing',
    ).toBe(true);
  });

  // ── SITE 1 — dispatchEdgeStrengthEdit, result.kind === 'refused' ─────────
  describe('dispatchEdgeStrengthEdit (refused)', () => {
    it('a hold that lapsed during the refusal commit is SPOKEN, not just persisted', async () => {
      const seam = installCommitSeam({ lapse: true });

      const out = await dispatchSystemEvent({
        payload: edgeStrengthPayload(),
        requestId: 'req-edge-refused-lapse',
      });

      // (a) the writer was reached, (c) the refusal path was taken
      expect(mocks.applyEdgeStrengthEdit).toHaveBeenCalledTimes(1);
      expect(out.commitPerformed).toBe(true);
      // (b) the amendment's enabling conjunct really was supplied
      expectPriorsThreaded(seam.committedMetadata());

      expect(
        out.response.assistant_text ?? '',
        'the commit appended the honest lapse notice to the response it PERSISTED; returning the ' +
          'pre-commit object makes the turn row and the wire disagree about what the user was ' +
          "told, and the user's live proposal dies without a word",
      ).toContain(EXPECTED_NOTICE);
    });

    it('TWIN: nothing lapsed → no lapse copy, and the composed object itself is shipped', async () => {
      const seam = installCommitSeam({ lapse: false });

      const out = await dispatchSystemEvent({
        payload: edgeStrengthPayload(),
        requestId: 'req-edge-refused-no-lapse',
      });

      expect(mocks.applyEdgeStrengthEdit).toHaveBeenCalledTimes(1);
      expect(out.commitPerformed).toBe(true);
      expectPriorsThreaded(seam.committedMetadata());

      expect(out.response.assistant_text ?? '').toContain(EDGE_REFUSAL_TEXT);
      expect(out.response.assistant_text ?? '').not.toContain('has lapsed');
      expect(out.response.assistant_text ?? '').not.toContain(EXPECTED_NOTICE);
      // Referential, not deep: a fix that rebuilt an equivalent object would be
      // a different behaviour and must be visible here.
      expect(
        out.response,
        'on the untouched fast path the commit returns the SAME object it was handed, so the ' +
          'shipped answer must be exactly the composed one — not a reconstruction',
      ).toBe(seam.committedInput());
    });
  });

  // ── SITE 2 — dispatchStructuralDelete, result.kind === 'refused' ─────────
  describe('dispatchStructuralDelete (refused)', () => {
    it('a hold that lapsed during the refusal commit is SPOKEN, not just persisted', async () => {
      const seam = installCommitSeam({ lapse: true });

      const out = await dispatchSystemEvent({
        payload: structuralDeletePayload(),
        requestId: 'req-delete-refused-lapse',
      });

      expect(mocks.applyStructuralDelete).toHaveBeenCalledTimes(1);
      expect(out.commitPerformed).toBe(true);
      expectPriorsThreaded(seam.committedMetadata());

      expect(
        out.response.assistant_text ?? '',
        'the structural_delete refusal exit commits the amended response and then ships its own ' +
          'pre-commit object, so the lapse notice reaches the turn row and never the user',
      ).toContain(EXPECTED_NOTICE);
    });

    it('TWIN: nothing lapsed → no lapse copy, and the composed object itself is shipped', async () => {
      const seam = installCommitSeam({ lapse: false });

      const out = await dispatchSystemEvent({
        payload: structuralDeletePayload(),
        requestId: 'req-delete-refused-no-lapse',
      });

      expect(mocks.applyStructuralDelete).toHaveBeenCalledTimes(1);
      expect(out.commitPerformed).toBe(true);
      expectPriorsThreaded(seam.committedMetadata());

      expect(out.response.assistant_text ?? '').toContain(DELETE_REFUSAL_TEXT);
      expect(out.response.assistant_text ?? '').not.toContain('has lapsed');
      expect(out.response.assistant_text ?? '').not.toContain(EXPECTED_NOTICE);
      expect(
        out.response,
        'on the untouched fast path the commit returns the SAME object it was handed, so the ' +
          'shipped answer must be exactly the composed one — not a reconstruction',
      ).toBe(seam.committedInput());
    });
  });

  // ── THE MOCK-SHAPE GUARD ─────────────────────────────────────────────────
  // ~100 suites in this repo stub `commitDirectAnswer`, and a bare `vi.fn()`
  // resolves to `undefined`. A fix that read `committed.response` unguarded
  // would ship `undefined` as the wire body on every one of those paths — a far
  // worse defect than the one being repaired. `?? response` is therefore
  // load-bearing, not defensive noise, and this pins it for BOTH sites.
  it.each([
    ['edge_strength_edit', edgeStrengthPayload, EDGE_REFUSAL_TEXT],
    ['structural_delete', structuralDeletePayload, DELETE_REFUSAL_TEXT],
  ] as const)(
    '%s: a commit that returns no response object at all leaves the composed answer intact',
    async (_kind, payloadFor, refusalText) => {
      mocks.commitDirectAnswer.mockResolvedValue(undefined);

      const out = await dispatchSystemEvent({
        payload: payloadFor(),
        requestId: 'req-bare-stub',
      });

      expect(out.commitPerformed).toBe(true);
      expect(out.response).not.toBeUndefined();
      expect(typeof out.response).toBe('object');
      expect(out.response.assistant_text ?? '').toContain(refusalText);
    },
  );
});
