/**
 * `CommitResult.thisAttemptWrote` — did THIS call's append write anything?
 *
 * ⛔ THE OBJECTION THIS ANSWERS (Codex, #63 5821693599, on #1856 @ 4f38219a).
 *    On a replay or a reused-id conflict the store writes NOTHING for this
 *    attempt, yet `commitDirectAnswer` still returned `performed: true` and
 *    `graphPersisted: writesGraph` (commit.ts:2092,2132-2134 at that head).
 *    `graphPersisted` has always meant "a graph was PROVIDED", not "a graph
 *    LANDED". F3 then made `persistedGraph` / `persistedAnalysisGraphHash` the
 *    AUTHORITATIVE REREAD on that branch, which is right for DISPLAY but makes
 *    things worse for ATTESTATION: a consumer that tests "graphPersisted AND the
 *    snapshot contains my change" (the structural-add consumer does exactly this,
 *    dispatch.ts:2876-2880) can be satisfied by ANOTHER writer's change.
 *
 *    So the snapshot and the write-truth must be SEPARATE fields that are
 *    allowed to disagree. These cases pin that: on a replay / conflict the
 *    snapshot is still the reread (F3, unchanged) while `thisAttemptWrote` is
 *    false — including when the snapshot happens to hold exactly the value this
 *    request asked for.
 *
 * WHERE THE SIGNAL COMES FROM. `thisAttemptWrote` is derived only from the
 * store's `SessionAppendOutcome` flags (`replayedPriorTurn` /
 * `priorTurnConflict`, session/store.ts:119/131). It is no stronger than those
 * flags: the Supabase store classifies only GRAPH-bearing writes
 * (supabase-store.ts:292) and its classification can miss a row inserted
 * between its read and the RPC (supabase-store.ts:281-285). Case (e) pins the
 * no-graph arm for what the outcome actually says; it does not claim more.
 *
 * NO PROVIDER. The rolling-summary maintainer is mocked out, the LLM router is
 * mocked and asserted uncalled, and `fetch` is stubbed to throw and asserted
 * uncalled.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const { maintainSpy, llmChatMock } = vi.hoisted(() => ({
  maintainSpy: vi.fn(async (_arg: Record<string, unknown>) => undefined),
  llmChatMock: vi.fn(),
}));

vi.mock('../rolling-summary/capture.js', () => ({
  maintainRollingSummaryForCommit: maintainSpy,
}));

vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { checkPersistedGraphInvariants } from '../persisted-graph-invariants.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionAppendOutcome, SessionStore, SessionTurnWrite } from '../session/store.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TARGET = 'fac_cycle';

/** A structurally sound graph whose one factor holds `raw` months. */
function graphAt(raw: number): Record<string, unknown> {
  return {
    goal_node_id: 'goal',
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Revenue' },
      {
        id: TARGET,
        kind: 'factor',
        label: 'Sales Cycle Length',
        display_value: `${raw} months`,
        observed_state: { unit: 'months', value: raw / 20, raw_value: raw },
      },
    ],
    edges: [{ from: TARGET, to: 'goal', edge_type: 'causal' }],
  };
}

/** THIS request asks for 25; the store holds 14 unless a case says otherwise. */
const REQUESTED = 25;
const STORED = 14;

function composed() {
  const base = composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: `Updated Sales Cycle Length from ${STORED} months to ${REQUESTED} months.`,
    stage: 'analyse',
  });
  return {
    ...base,
    blocks: [
      {
        type: 'graph_patch',
        status: 'applied',
        operation: 'set_factor_value',
        target_id: TARGET,
        before: { value: STORED, unit: 'months' },
        after: { value: REQUESTED, unit: 'months' },
      },
    ],
  } as typeof base;
}

const meta = (graph?: unknown) => ({
  scenario_id: SCENARIO_ID,
  turn_id: TURN_ID,
  turn_class: 'direct_answer' as const,
  handler_id: null,
  request_hash: 'sha256:test',
  llm_calls_used: 0,
  duration_ms: 1,
  handler_facts: [],
  ...(graph === undefined ? {} : { graph }),
});

type Verdict = 'landed' | 'replay' | 'conflict';

/**
 * A store whose append outcome is set per case, recording what it returned so
 * each case can assert its PREMISE (the outcome the commit actually saw), and
 * whose `loadGraph` is the authoritative reread.
 */
/**
 * On a replay or a reused-id conflict the real `append_turn_atomic_v5` hands back
 * the ORIGINAL operation's receipt (the deterministic mutation id is derived from
 * scenario + turn, which a reused id shares). The fake does the same, so the
 * "a conflict hands back no receipt" check below can actually fail.
 */
const PRIOR_OPERATION_RECEIPT = {
  mutation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  version_number: 2,
  graph_identity_hash: 'a'.repeat(64),
  analysis_affecting_hash: 'b'.repeat(64),
  hash_algorithm: 'sha256',
  identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1',
  graph_schema_version: 'graph_v3',
  actor_kind: 'unknown' as const,
  authored_by: null,
  creation_kind: 'committed_mutation' as const,
  source_version_id: null,
  source_turn_id: 'prior-operation-turn',
  parent_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  root_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  undo_version_id: null,
  graph: null,
  event_id: 'model_version_created_mutation_dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

function storeReporting(verdict: Verdict, stored: unknown = graphAt(STORED)) {
  const outcomes: SessionAppendOutcome[] = [];
  const writes: SessionTurnWrite[] = [];
  const loadGraph = vi.fn(async () => JSON.parse(JSON.stringify(stored)) as unknown);
  const base = createNoopSessionStore();
  const store = {
    ...base,
    append: async (write: SessionTurnWrite): Promise<SessionAppendOutcome> => {
      writes.push(write);
      const outcome: SessionAppendOutcome = {
        id: 'turn-row',
        ...(verdict === 'conflict' || verdict === 'replay'
          ? { modelVersionReceipt: PRIOR_OPERATION_RECEIPT as unknown as SessionAppendOutcome['modelVersionReceipt'] }
          : {}),
        ...(verdict === 'conflict' ? { priorTurnConflict: true as const } : {}),
        ...(verdict === 'replay' ? { replayedPriorTurn: true as const } : {}),
      };
      outcomes.push(outcome);
      return outcome;
    },
    loadGraph,
  } as SessionStore;
  return { store, outcomes, writes, loadGraph };
}

const rawOf = (graph: unknown): unknown =>
  ((graph as { nodes?: Array<{ id: string; observed_state?: { raw_value?: unknown } }> } | null)?.nodes ?? []).find(
    (n) => n.id === TARGET,
  )?.observed_state?.raw_value;

let fetchSpy: ReturnType<typeof vi.spyOn>;

describe('CommitResult.thisAttemptWrote — the write-truth, separate from the display snapshot', () => {
  beforeAll(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch attempted in a no-provider test');
    });
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  beforeEach(() => {
    llmChatMock.mockClear();
    fetchSpy.mockClear();
    maintainSpy.mockClear();
  });

  function expectNoProviderReached() {
    expect(llmChatMock, 'an LLM adapter was called on a deterministic path').not.toHaveBeenCalled();
    expect(fetchSpy, 'a network call was attempted on a no-provider path').not.toHaveBeenCalled();
  }

  it('(a) a FIRST attempt whose append lands (graph supplied) → thisAttemptWrote === true', async () => {
    const { store, outcomes, writes, loadGraph } = storeReporting('landed');
    const r = await commitDirectAnswer(composed(), meta(graphAt(REQUESTED)) as never, store);

    // Premise: the store reported neither a replay nor a conflict, and the
    // append carried the candidate.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.replayedPriorTurn).toBeUndefined();
    expect(outcomes[0]!.priorTurnConflict).toBeUndefined();
    expect(rawOf(writes[0]!.graph)).toBe(REQUESTED);

    expect(r.thisAttemptWrote).toBe(true);
    expect(r.graphPersisted).toBe(true);
    // Control: on a first attempt the snapshot is this commit's own projected
    // bytes, not a reread — the reread branch never ran.
    expect(loadGraph).not.toHaveBeenCalled();
    expect(r.persistedGraph).toBe(writes[0]!.graph);
    expectNoProviderReached();
  });

  it('(b) a genuine REPLAY (replayedPriorTurn) → thisAttemptWrote === false', async () => {
    const { store, outcomes } = storeReporting('replay');
    const r = await commitDirectAnswer(composed(), meta(graphAt(REQUESTED)) as never, store);

    expect(outcomes[0]!.replayedPriorTurn).toBe(true);
    expect(r.thisAttemptWrote, 'the store wrote nothing for this attempt').toBe(false);
    expectNoProviderReached();
  });

  it('(c) a reused-id CONFLICT (priorTurnConflict) → thisAttemptWrote === false', async () => {
    const { store, outcomes } = storeReporting('conflict');
    const r = await commitDirectAnswer(composed(), meta(graphAt(REQUESTED)) as never, store);

    expect(outcomes[0]!.priorTurnConflict).toBe(true);
    expect(r.thisAttemptWrote, 'the store wrote nothing for this attempt').toBe(false);
    expectNoProviderReached();
  });

  describe('(d) on a replay / conflict the SNAPSHOT is still the reread (F3) — the two fields disagree', () => {
    for (const verdict of ['replay', 'conflict'] as const) {
      it(`${verdict}: persistedGraph / persistedAnalysisGraphHash are the stored reread while thisAttemptWrote is false and graphPersisted keeps "a graph was provided"`, async () => {
        const stored = graphAt(STORED);
        const { store, loadGraph, writes } = storeReporting(verdict, stored);
        const r = await commitDirectAnswer(composed(), meta(graphAt(REQUESTED)) as never, store);

        // Premise: the candidate and the stored graph differ, so "snapshot is
        // the reread" discriminates from "snapshot is the candidate".
        expect(rawOf(writes[0]!.graph)).toBe(REQUESTED);
        expect(loadGraph).toHaveBeenCalledTimes(1);

        // F3, unchanged: the display snapshot is the authoritative reread.
        expect(r.persistedGraph).toEqual(stored);
        expect(rawOf(r.persistedGraph)).toBe(STORED);
        expect(r.persistedAnalysisGraphHash).toBe(checkPersistedGraphInvariants(stored).analysisGraphHash);
        expect(r.persistedAnalysisGraphHash).toEqual(expect.any(String));

        // The disagreement Codex asked for, made explicit: graphPersisted is
        // TRUE (a graph was provided), the snapshot is non-null, and yet this
        // attempt wrote nothing. Neither of the first two may attest success.
        expect(r.graphPersisted).toBe(true);
        expect(r.persistedGraph).not.toBeNull();
        expect(r.thisAttemptWrote).toBe(false);
        expectNoProviderReached();
      });
    }

    it('conflict: the snapshot can hold EXACTLY the value this request asked for (another writer set it) — and thisAttemptWrote is still false', async () => {
      // The interleaving Codex named: a later writer makes the target present.
      const storedAtRequested = graphAt(REQUESTED);
      const { store, outcomes, writes } = storeReporting('conflict', storedAtRequested);
      const r = await commitDirectAnswer(composed(), meta(graphAt(REQUESTED)) as never, store);

      // Premise: a conflict, and the stored value equals the requested value.
      expect(outcomes[0]!.priorTurnConflict).toBe(true);
      expect(rawOf(writes[0]!.graph)).toBe(REQUESTED);
      expect(rawOf(storedAtRequested)).toBe(REQUESTED);

      // A consumer testing "graphPersisted && snapshot contains my change"
      // would be satisfied here — for the wrong operation.
      expect(r.graphPersisted).toBe(true);
      expect(rawOf(r.persistedGraph)).toBe(REQUESTED);
      // The write-truth is not fooled.
      expect(r.thisAttemptWrote).toBe(false);
      // And the conflict still refuses on every other carrier (unchanged).
      expect(r.modelVersionReceipt).toBeNull();
      expect(r.response.assistant_text).toMatch(/did not make that change/i);
      expectNoProviderReached();
    });
  });

  describe('(e) a commit with NO graph (writesGraph false)', () => {
    it('whose append lands → thisAttemptWrote === true (the turn row landed); the outcome carries no replay/conflict flag', async () => {
      const { store, outcomes, writes } = storeReporting('landed');
      const r = await commitDirectAnswer(composed(), meta() as never, store);

      // What the append outcome actually says for a no-graph write that lands:
      // an id and NO flag. That absence is the whole basis of `true` here.
      expect(writes).toHaveLength(1);
      expect(writes[0]!.graph ?? null).toBeNull();
      expect(outcomes[0]).toEqual({ id: 'turn-row' });

      expect(r.thisAttemptWrote).toBe(true);
      expect(r.graphPersisted).toBe(false);
      expect(r.persistedGraph).toBeNull();
      expect(r.persistedAnalysisGraphHash).toBeNull();
      expectNoProviderReached();
    });

    it('CONTROL: a no-graph commit the store DOES flag (replay or conflict) → thisAttemptWrote === false — the flags decide, not writesGraph', async () => {
      for (const verdict of ['replay', 'conflict'] as const) {
        const { store, outcomes } = storeReporting(verdict);
        const r = await commitDirectAnswer(composed(), meta() as never, store);
        expect(
          outcomes[0]!.replayedPriorTurn === true || outcomes[0]!.priorTurnConflict === true,
          `premise: the store flagged the ${verdict}`,
        ).toBe(true);
        expect(r.graphPersisted).toBe(false);
        expect(r.thisAttemptWrote, `${verdict} on a no-graph commit`).toBe(false);
      }
      expectNoProviderReached();
    });
  });
});
