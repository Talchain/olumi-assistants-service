// ============================================================================
// The PUBLIC route for `option_intervention_edit` (0.54.0).
//
// The writer is already proven by `option-intervention-transaction.test.ts`
// against a real serialized store. This file proves the ARM: that the dispatch
// hands it the right things, refuses to invent the things it is not entitled
// to, and reports its four outcomes honestly.
//
// So the writer is MOCKED here on purpose. Re-running the transaction through
// this seam would re-prove someone else's property and tell us nothing about
// the arm; what matters here is the boundary between the two.
//
// Written in twins: for every "the arm passes X through" there is a case where
// X is something the client tried to supply and the arm ignores it.
// ============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

const mocks = vi.hoisted(() => ({
  executeOptionInterventionEdit: vi.fn(),
  loadPriorFactsWithReadState: vi.fn(),
  getSessionStore: vi.fn(() => ({ marker: 'AUTHORISED_STORE' })),
}));

vi.mock('../option-intervention-edit.js', () => ({
  executeOptionInterventionEdit: mocks.executeOptionInterventionEdit,
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadPriorFactsWithReadState: mocks.loadPriorFactsWithReadState,
}));

vi.mock('../../session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session/index.js')>()),
  getSessionStore: mocks.getSessionStore,
}));

vi.mock('../../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commit.js')>()),
  computeRequestHash: vi.fn(() => 'sha256:server-derived-request-hash'),
}));

import { dispatchSystemEvent, SYSTEM_EVENT_HANDLING } from '../dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HASH = '9f2c1b0ae4d37c5a';

function payload(): SystemEventTurnPayload {
  return {
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    kind: 'system_event',
    event: {
      kind: 'option_intervention_edit',
      option_id: 'option_open_leeds',
      factor_id: 'factor_capex',
      value: 0.6,
      base_graph_hash: HASH,
    },
  } as unknown as SystemEventTurnPayload;
}

/** A prior-fact read that succeeded and carries no analysis at all. */
function freshRead() {
  return { status: 'ok' as const, facts: [] as never[] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadPriorFactsWithReadState.mockResolvedValue(freshRead());
  mocks.getSessionStore.mockReturnValue({ marker: 'AUTHORISED_STORE' });
  mocks.executeOptionInterventionEdit.mockResolvedValue({ kind: 'refused', reason: 'test_default' });
});

describe('A — the kind is declared MUTATING and reaches the writer', () => {
  it('is classified `mutating`, not an acknowledgement', () => {
    // An `ack_and_commit` here would write a turn row and NO graph — the value
    // would vanish on the next reload. This is the classification that stops it.
    expect(SYSTEM_EVENT_HANDLING.option_intervention_edit).toBe('mutating');
  });

  it('calls the writer exactly once, with the authorised store', async () => {
    await dispatchSystemEvent({ payload: payload(), requestId: 'req-1' });
    expect(mocks.executeOptionInterventionEdit).toHaveBeenCalledTimes(1);
    expect(mocks.executeOptionInterventionEdit.mock.calls[0]?.[1]).toEqual({
      marker: 'AUTHORISED_STORE',
    });
  });
});

describe('B — what the client supplies, and what the SERVER supplies', () => {
  it('passes the event’s identity, value and asserted base hash through unchanged', async () => {
    await dispatchSystemEvent({ payload: payload(), requestId: 'req-2' });
    expect(mocks.executeOptionInterventionEdit.mock.calls[0]?.[0]).toMatchObject({
      optionId: 'option_open_leeds',
      factorId: 'factor_capex',
      modelValue: 0.6,
      expectedGraphHash: HASH,
    });
  });

  it('takes the turn ids and request hash from the TURN, never from the event', async () => {
    // The wire member is `.strict()` and carries none of these, so a client
    // cannot assert them — this pins that the arm does not start accepting them.
    const input = await (async () => {
      await dispatchSystemEvent({ payload: payload(), requestId: 'req-3' });
      return mocks.executeOptionInterventionEdit.mock.calls[0]?.[0];
    })();
    expect(input).toMatchObject({
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: 'req-3',
      requestHash: 'sha256:server-derived-request-hash',
      stage: 'analyse',
    });
  });
});

describe('C — freshness is server-derived and FAILS CLOSED', () => {
  it('derives `none` from a healthy read with no analysis facts', async () => {
    await dispatchSystemEvent({ payload: payload(), requestId: 'req-4' });
    expect(mocks.executeOptionInterventionEdit.mock.calls[0]?.[0]?.freshness).toBe('none');
    expect(mocks.executeOptionInterventionEdit.mock.calls[0]?.[0]?.hasExistingAnalysis).toBe(false);
  });

  it('⚠ falls to `unknown` — never `none` — when the fact read DEGRADES', async () => {
    // The twin of the case above, and the load-bearing one. `none` means "we
    // looked and there is no analysis"; `unknown` means "we could not look".
    // Defaulting a degraded read to `none` would hand the referee a permission
    // the history never granted, and the writer refuses `unknown` for exactly
    // that reason.
    mocks.loadPriorFactsWithReadState.mockResolvedValue({ status: 'degraded', facts: [] });
    await dispatchSystemEvent({ payload: payload(), requestId: 'req-5' });
    expect(mocks.executeOptionInterventionEdit.mock.calls[0]?.[0]?.freshness).toBe('unknown');
    expect(mocks.executeOptionInterventionEdit.mock.calls[0]?.[0]?.hasExistingAnalysis).toBe(false);
  });

  it('refuses to append at all when the fact read THROWS', async () => {
    mocks.loadPriorFactsWithReadState.mockRejectedValue(new Error('history unavailable'));
    const result = await dispatchSystemEvent({ payload: payload(), requestId: 'req-6' });
    expect(mocks.executeOptionInterventionEdit).not.toHaveBeenCalled();
    expect(result.commitPerformed).toBe(false);
    expect(result.graph).toBeNull();
  });
});

describe('D — the four outcomes, reported honestly', () => {
  it('committed: reports the commit, stamps the persisted hash, hands over the applied graph', async () => {
    const graph = { nodes: [], edges: [] };
    mocks.executeOptionInterventionEdit.mockResolvedValue({
      kind: 'committed',
      response: { response_version: 2, assistant_text: 'ok', blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse' },
      graph,
      analysisGraphHash: 'committed-hash',
      persistedRowId: 'row-1',
    });
    const result = await dispatchSystemEvent({ payload: payload(), requestId: 'req-7' });
    expect(result.commitPerformed).toBe(true);
    expect(result.graph).toBe(graph);
    // The hash is the COMMITTED one, not the client's asserted base.
    expect((result.response as { graph_hash?: string }).graph_hash).toBe('committed-hash');
    expect((result.response as { graph_hash?: string }).graph_hash).not.toBe(HASH);
  });

  it.each([
    ['unchanged', { kind: 'unchanged' }],
    ['refused', { kind: 'refused', reason: 'unresolved_effect_relationship' }],
    ['stale base', { kind: 'refused', reason: 'stale_graph' }],
    ['unverified', { kind: 'unverified', reason: 'committed_graph_mismatch', commitAttempted: true }],
  ] as Array<[string, Record<string, unknown>]>)(
    '%s: claims no commit and hands over no graph',
    async (_name, outcome) => {
      mocks.executeOptionInterventionEdit.mockResolvedValue(outcome);
      const result = await dispatchSystemEvent({ payload: payload(), requestId: 'req-8' });
      expect(result.commitPerformed).toBe(false);
      expect(result.graph).toBeNull();
    },
  );

  /**
   * ⭐ AND THEY ARE THREE DIFFERENT ANSWERS, NOT ONE.
   *
   * `commitPerformed: false` alone routes to HTTP 500 `retryable: true`. That
   * is right for "we could not confirm" and wrong for both of the others: a
   * same-value edit is a success with nothing to do, and a permanently stale
   * base cannot be fixed by repeating the request. The route branches on these
   * exact tokens, so asserting them here is asserting the wire behaviour's
   * input — the wire behaviour ITSELF is asserted over the real route in
   * `tests/integration/orchestrator/route-v2-option-intervention-edit.test.ts`.
   */
  it('a verified no-op is a recognised skip, not an unexplained non-commit', async () => {
    mocks.executeOptionInterventionEdit.mockResolvedValue({ kind: 'unchanged' });
    const result = await dispatchSystemEvent({ payload: payload(), requestId: 'req-8a' });
    expect(result.commitSkippedReason).toBe('verified_no_op');
    expect(result.graphConflict).toBeUndefined();
  });

  it('a permanent refusal is a recognised skip — repeating it cannot succeed', async () => {
    mocks.executeOptionInterventionEdit.mockResolvedValue({
      kind: 'refused', reason: 'unresolved_effect_relationship',
    });
    const result = await dispatchSystemEvent({ payload: payload(), requestId: 'req-8b' });
    expect(result.commitSkippedReason).toBe('refused_no_write');
    expect(result.graphConflict).toBeUndefined();
  });

  it('a stale base is a CONFLICT with a followable recovery, not a refusal or a failure', async () => {
    mocks.executeOptionInterventionEdit.mockResolvedValue({ kind: 'refused', reason: 'stale_graph' });
    const result = await dispatchSystemEvent({ payload: payload(), requestId: 'req-8c' });
    expect(result.graphConflict?.recovery_action).toBe('refresh_and_reconfirm');
    expect(result.graphConflict?.conflict_category).toBe('stale_base_graph_hash');
    // Not ALSO a skip: a conflict has its own route branch, and carrying both
    // would let whichever branch runs first decide the answer.
    expect(result.commitSkippedReason).toBeUndefined();
  });

  it('⚠ unverified takes NO skip reason — "we do not know" must not become "nothing happened"', async () => {
    mocks.executeOptionInterventionEdit.mockResolvedValue({
      kind: 'unverified', reason: 'commit_not_confirmed', commitAttempted: true,
    });
    const result = await dispatchSystemEvent({ payload: payload(), requestId: 'req-8d' });
    expect(result.commitSkippedReason).toBeUndefined();
    expect(result.graphConflict).toBeUndefined();
  });

  it('⚠ unverified does not become a SUCCESS just because a commit was attempted', async () => {
    // The writer reaches `unverified` because it could not prove what happened.
    // The failure this pins is the tempting one: treating `commitAttempted`
    // as evidence of a durable write. It is the opposite — it is the reason the
    // outcome has no `committed` in it.
    mocks.executeOptionInterventionEdit.mockResolvedValue({
      kind: 'unverified', reason: 'commit_not_confirmed', commitAttempted: true,
    });
    const result = await dispatchSystemEvent({ payload: payload(), requestId: 'req-9' });
    expect(result.commitPerformed).toBe(false);
    expect(result.graph).toBeNull();
    expect((result.response as { graph_hash?: string }).graph_hash).toBeUndefined();
  });
});
