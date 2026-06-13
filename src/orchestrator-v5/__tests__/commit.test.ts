import { describe, it, expect, vi } from 'vitest';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import type { SuggestedAction } from '../compose/types.js';
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
});
