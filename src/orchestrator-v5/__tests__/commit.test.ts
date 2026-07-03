import { describe, it, expect, vi } from 'vitest';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import type { SuggestedAction } from '../compose/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { setTestSink } from '../../utils/telemetry.js';

const META = {
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  turn_class: 'direct_answer' as const,
  handler_id: null,
  request_hash: 'sha256:test',
  llm_calls_used: 2,
  duration_ms: 42,
  handler_facts: [],
};

describe('commitDirectAnswer (slice B — RPC-backed persistence)', () => {
  it('returns the composed response unchanged on RPC success', async () => {
    const composed = composeDirectAnswerResponse({
      assistant_text: 'hi',
      stage: 'frame',
    });
    const result = await commitDirectAnswer(
      composed,
      META,
      createNoopSessionStore({ appendId: 'row-abc' }),
    );
    expect(result.response).toBe(composed);
    expect(result.performed).toBe(true);
    expect(result.persisted_row_id).toBe('row-abc');
  });

  it('throws on falsy response (invariant guard)', async () => {
    await expect(
      // @ts-expect-error — deliberately invalid for invariant assertion
      commitDirectAnswer(null, META, createNoopSessionStore()),
    ).rejects.toThrow(/invariant/i);
  });

  it('propagates SessionStore.append errors so TurnExecutor catch can map them', async () => {
    const composed = composeDirectAnswerResponse({
      assistant_text: 'hi',
      stage: 'frame',
    });
    const boom = new Error('simulated RPC failure');
    await expect(
      commitDirectAnswer(
        composed,
        META,
        createNoopSessionStore({ throwOnAppend: boom }),
      ),
    ).rejects.toBe(boom);
  });

  // V5 Phase 1 brief persistence: briefText must thread from CommitMetadata
  // through commit.ts to SessionStore.append.
  describe('V5 Phase 1 brief persistence — briefText pass-through', () => {
    function makeSpyStore(): {
      readonly store: SessionStore;
      readonly appendCalls: Array<SessionTurnWrite>;
    } {
      const appendCalls: Array<SessionTurnWrite> = [];
      const noop = createNoopSessionStore({ appendId: 'row-spy' });
      const spy = vi.spyOn(noop, 'append').mockImplementation(async (write) => {
        appendCalls.push(write);
        return { id: 'row-spy' };
      });
      // Hold the spy alive so vitest does not auto-restore inside async ticks.
      void spy;
      return { store: noop, appendCalls };
    }

    it('threads briefText from CommitMetadata to SessionStore.append', async () => {
      const composed = composeDirectAnswerResponse({
        assistant_text: 'drafted',
        stage: 'frame',
      });
      const { store, appendCalls } = makeSpyStore();
      await commitDirectAnswer(
        composed,
        { ...META, briefText: 'My decision brief' },
        store,
      );
      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0].briefText).toBe('My decision brief');
    });

    it('omits briefText (undefined) when not present in metadata', async () => {
      const composed = composeDirectAnswerResponse({
        assistant_text: 'hi',
        stage: 'frame',
      });
      const { store, appendCalls } = makeSpyStore();
      await commitDirectAnswer(composed, META, store);
      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0].briefText).toBeUndefined();
    });

    it('threads both graph and briefText together (initial draft turn shape)', async () => {
      const composed = composeDirectAnswerResponse({
        assistant_text: 'drafted',
        stage: 'frame',
      });
      const graph = { nodes: [], edges: [] };
      const { store, appendCalls } = makeSpyStore();
      await commitDirectAnswer(
        composed,
        { ...META, graph, briefText: 'brief' },
        store,
      );
      expect(appendCalls[0].graph).toEqual(graph);
      expect(appendCalls[0].briefText).toBe('brief');
    });
  });

  // #239 review (finding 2): pendings must derive from the EGRESS-FINALISED
  // chip set, so a chip the finalizer drops cannot leave an orphaned resumable
  // pending that a later "yes" short-confirm could resume.
  describe('atomic-emit — pendings derive from the egress-finalised chip set', () => {
    it('does not persist a pending for a chip that egress finalization drops', async () => {
      const appendCalls: Array<SessionTurnWrite> = [];
      const store = createNoopSessionStore({ appendId: 'row-spy' });
      vi.spyOn(store, 'append').mockImplementation(async (write) => {
        appendCalls.push(write);
        return { id: 'row-spy' };
      });
      // A run_analysis chip with a blank label is dropped by the finalizer; a
      // sibling valid run_analysis chip survives. Only the survivor may yield a
      // resumable pending.
      const dropped: SuggestedAction = {
        id: 'chip_action_run_analysis_blank',
        label: '   ',
        message: 'Analyse the model now.',
        action_type: 'run_analysis',
      };
      const kept: SuggestedAction = {
        id: 'chip_action_run_analysis',
        label: 'Run analysis',
        message: 'Run analysis.',
        action_type: 'run_analysis',
      };
      const composed = composeDirectAnswerResponse({
        assistant_text: 'done',
        stage: 'analyse',
        suggested_actions: [dropped, kept],
      });
      await commitDirectAnswer(composed, META, store);
      expect(appendCalls).toHaveLength(1);
      const chipIds = (appendCalls[0].pending_actions ?? []).map((p) => p.chip_id);
      expect(chipIds).toContain('chip_action_run_analysis');
      expect(chipIds).not.toContain('chip_action_run_analysis_blank');
    });
  });

  // Track 2 (HV2): the lifecycle `survivedCount` must reflect what ACTUALLY
  // persisted after the per-turn cap, not pre-cap eligibility. When this turn's
  // own pendings fill PENDING_ACTIONS_PER_TURN_CAP (3), an eligible prior
  // survivor is evicted — and must be attributed to capDroppedCount, not
  // survivedCount, so Track 3 / harness checks cannot mistake it for persisted.
  describe('pendingLifecycle — cap-ordering correctness', () => {
    function makeSpyStore(): { store: SessionStore; appendCalls: Array<SessionTurnWrite> } {
      const appendCalls: Array<SessionTurnWrite> = [];
      const store = createNoopSessionStore({ appendId: 'row-cap' });
      vi.spyOn(store, 'append').mockImplementation(async (write) => {
        appendCalls.push(write);
        return { id: 'row-cap' };
      });
      return { store, appendCalls };
    }
    function makePreSupplied(ref: string): PendingAction {
      return {
        id: `pa-${ref}`,
        scenario_id: META.scenario_id,
        chip_id: ref,
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: ref,
          inline_patch: { handler_id: 'set_factor_value', params: {}, target_entity_ids: ['fac-1'] },
          public_label: 'Apply',
          public_message: 'Apply the change.',
        },
        preconditions: { graph_hash: 'gh-1' },
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T23:59:59.000Z',
        emitted_at_iso: '2026-06-10T11:59:00.000Z',
      } as PendingAction;
    }

    it('this-turn pendings fill the cap → the live prior survivor is cap-dropped, not counted as survived', async () => {
      const composed = composeDirectAnswerResponse({ assistant_text: 'ok', stage: 'analyse' });
      // Three pre-supplied pendings occupy the whole cap; one live prior proposal
      // is eligible to carry forward but cannot fit.
      const thisTurn = [makePreSupplied('t1'), makePreSupplied('t2'), makePreSupplied('t3')];
      const prior = [makePreSupplied('prior-live')];
      const { store, appendCalls } = makeSpyStore();
      const result = await commitDirectAnswer(
        composed,
        { ...META, graph_hash: 'gh-1', pending_actions: thisTurn, priorPendingActions: prior },
        store,
      );
      // Persisted set is exactly the three this-turn pendings (cap = 3).
      expect((appendCalls[0].pending_actions ?? []).map((p) => p.chip_id)).toEqual(['t1', 't2', 't3']);
      // Lifecycle reflects post-cap reality: the eligible prior survivor was cap-dropped.
      expect(result.pendingLifecycle).toMatchObject({
        priorCount: 1,
        survivedCount: 0,
        capDroppedCount: 1,
      });
    });

    it('no cap pressure → the live prior survivor persists and is counted as survived', async () => {
      const composed = composeDirectAnswerResponse({ assistant_text: 'ok', stage: 'analyse' });
      const prior = [makePreSupplied('prior-live')];
      const { store, appendCalls } = makeSpyStore();
      const result = await commitDirectAnswer(
        composed,
        { ...META, graph_hash: 'gh-1', pending_actions: [], priorPendingActions: prior },
        store,
      );
      expect((appendCalls[0].pending_actions ?? []).map((p) => p.chip_id)).toEqual(['prior-live']);
      expect(result.pendingLifecycle).toMatchObject({
        priorCount: 1,
        survivedCount: 1,
        capDroppedCount: 0,
      });
    });
  });
});

describe('computeRequestHash', () => {
  // v0.7.0 schema: payload is a discriminated union on `kind`.
  // computeRequestHash switches on `payload.kind` so the `kind: 'message'`
  // discriminator must be present for the hash to include `message` as a
  // distinguishing field.
  const BASE_PAYLOAD = {
    kind: 'message' as const,
    turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    message: 'hello',
    turn_class: 'frame' as const,
    stage: 'frame' as const,
    source: 'composer' as const,
  };

  it('produces a non-empty sha256-prefixed string', () => {
    const h = computeRequestHash(BASE_PAYLOAD);
    expect(h).toMatch(/^sha256:[0-9a-f]{32}$/);
  });

  it('is stable for identical payloads', () => {
    expect(computeRequestHash(BASE_PAYLOAD)).toBe(computeRequestHash(BASE_PAYLOAD));
  });

  it('differs when the message differs', () => {
    const different = { ...BASE_PAYLOAD, message: 'different' };
    expect(computeRequestHash(BASE_PAYLOAD)).not.toBe(computeRequestHash(different));
  });

  it('differs when the scenario_id differs', () => {
    const different = { ...BASE_PAYLOAD, scenario_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
    expect(computeRequestHash(BASE_PAYLOAD)).not.toBe(computeRequestHash(different));
  });
});

// Track S 0.13c-4 — persist-site intercept repair at the commit chokepoint.
// commitDirectAnswer → store.append is the SOLE writer of scenarios.graph, so the
// repair here covers every graph-bearing V5 write and no-ops on graph-absent writes.
describe('commitDirectAnswer — persist-site intercept repair (Track S 0.13c-4)', () => {
  function makeSpyStore(): { store: SessionStore; appendCalls: Array<SessionTurnWrite> } {
    const appendCalls: Array<SessionTurnWrite> = [];
    const noop = createNoopSessionStore({ appendId: 'row-x' });
    const spy = vi.spyOn(noop, 'append').mockImplementation(async (write) => {
      appendCalls.push(write);
      return { id: 'row-x' };
    });
    void spy;
    return { store: noop, appendCalls };
  }
  const composed = () => composeDirectAnswerResponse({ assistant_text: 'ok', stage: 'analyse' });

  it('repairs the graph BEFORE persistence: a duplicate observed-root intercept is removed from what store.append receives', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => events.push({ event, data }));
    const dirtyGraph = {
      nodes: [
        { id: 'fac_dup', kind: 'factor', label: 'D', observed_state: { value: 0.5 }, intercept: 0.5 },
        { id: 'fac_keep', kind: 'factor', label: 'K', observed_state: { value: 0.9 }, intercept: 0.3 },
      ],
      edges: [],
      goal_node_id: 'goal_1',
      options: [{ id: 'opt_a' }],
    };
    const { store, appendCalls } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph: dirtyGraph, handler_id: 'set_factor_value' as never }, store);
    setTestSink(null);

    const persisted = appendCalls[0]!.graph as typeof dirtyGraph;
    expect('intercept' in persisted.nodes[0]!).toBe(false);   // fac_dup duplicate removed at persist
    expect((persisted.nodes[1] as Record<string, unknown>).intercept).toBe(0.3); // non-equal preserved
    expect(persisted.goal_node_id).toBe('goal_1');             // D1 shape preserved
    expect(persisted.options).toEqual([{ id: 'opt_a' }]);
    // input metadata graph not mutated
    expect((dirtyGraph.nodes[0] as Record<string, unknown>).intercept).toBe(0.5);
    // redacted telemetry emitted exactly once
    expect(events.filter((e) => e.event === 'v5.graph_persist.intercept_repair')).toHaveLength(1);
  });

  it('no-ops on graph-absent writes: store.append receives graph=undefined and no repair telemetry is emitted', async () => {
    const events: string[] = [];
    setTestSink((event) => events.push(event));
    const { store, appendCalls } = makeSpyStore();
    await commitDirectAnswer(composed(), META, store); // META has no graph
    setTestSink(null);
    expect(appendCalls[0]!.graph).toBeUndefined();
    expect(events.filter((e) => e === 'v5.graph_persist.intercept_repair')).toHaveLength(0);
  });

  it('passes a clean graph through unchanged (no repair, no telemetry)', async () => {
    const events: string[] = [];
    setTestSink((event) => events.push(event));
    const clean = { nodes: [{ id: 'fac_c', kind: 'factor', observed_state: { value: 0.2 } }], edges: [], goal_node_id: 'g' };
    const { store, appendCalls } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph: clean }, store);
    setTestSink(null);
    expect(appendCalls[0]!.graph).toEqual(clean);
    expect(events.filter((e) => e === 'v5.graph_persist.intercept_repair')).toHaveLength(0);
  });

  it('telemetry failure at the persist site does NOT discard the repair: store.append still receives the repaired graph', async () => {
    // Integration-level guarantee (not just the wrapper in isolation): a throwing sink
    // makes the summary emit() throw, yet the graph that reaches store.append must be the
    // repaired one — the dirty graph must never be persisted because telemetry failed.
    setTestSink(() => {
      throw new Error('sink boom');
    });
    const dirtyGraph = {
      nodes: [{ id: 'fac_dup', kind: 'factor', label: 'D', observed_state: { value: 0.5 }, intercept: 0.5 }],
      edges: [],
      goal_node_id: 'goal_1',
    };
    const { store, appendCalls } = makeSpyStore();
    try {
      await commitDirectAnswer(composed(), { ...META, graph: dirtyGraph, handler_id: 'set_factor_value' as never }, store);
    } finally {
      setTestSink(null);
    }
    const persisted = appendCalls[0]!.graph as typeof dirtyGraph;
    expect('intercept' in persisted.nodes[0]!).toBe(false);          // repaired graph persisted
    expect(persisted.goal_node_id).toBe('goal_1');                   // shape preserved
    expect((dirtyGraph.nodes[0] as Record<string, unknown>).intercept).toBe(0.5); // input untouched
  });
});
