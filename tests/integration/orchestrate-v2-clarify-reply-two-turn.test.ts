/**
 * Wave 5I-4 — HTTP two-turn proof: deterministic value-update clarify
 * followed by a typed factor-label reply applies the ORIGINAL quantity
 * to the matched factor, with no LLM call on either turn.
 *
 * Wave 5G review flagged that the existing single-turn deterministic
 * value-update HTTP test does not exercise the two-turn clarify→reply
 * flow that brief evidence #3 is about. The single-turn test proves the
 * unambiguous path; this test proves the multi-candidate clarify path
 * AND that Turn N's persisted pending action is consumed correctly on
 * Turn N+1, preserving the user-units quantity from Turn N.
 *
 * Coverage:
 *
 *   Turn 1 — POST "Set Cost and Revenue to 5" against a 2-factor graph
 *            ("Cost", "Revenue"). Both factors substring-match the
 *            message → multi-candidate clarify. Response carries chips
 *            + pending_actions persist to SessionStore on commit.
 *
 *   Turn 2 — POST "Cost" with the same graph. Resumer reads the
 *            persisted pending actions, matches "Cost" against the
 *            stored target_entity_ids, reconstructs the original
 *            quantity (5), and dispatches set_factor_value
 *            deterministically. No LLM call. The wire response carries
 *            a graph_patch block with the original quantity.
 *
 * Both turns are hit through `app.inject` against the real Fastify
 * route, proving the contract end-to-end at the HTTP boundary.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// Throwing routing adapter — any LLM call fails the test loudly.
const llmCallTracker = { count: 0 };

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-throwing-adapter',
    chat: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM should not be called when clarify-reply pre-route claims the turn');
    },
    chatWithTools: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM should not be called when clarify-reply pre-route claims the turn');
    },
  }),
  getAdapterWithResolution: (task?: string) => ({
    adapter: {
      name: 'test-throwing-adapter',
      chat: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM should not be called when clarify-reply pre-route claims the turn');
      },
      chatWithTools: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM should not be called when clarify-reply pre-route claims the turn');
      },
    },
    resolution: {
      task: task ?? 'orchestrator',
      resolved_model: 'test-throwing-adapter',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// In-memory session store. Turn 1 writes pending_actions; Turn 2 reads
// them via `readMostRecentPendingActions`. The test simulates session
// persistence across the two POSTs.
const appendCalls: Array<Record<string, unknown>> = [];
let mostRecentPendingActions: ReadonlyArray<unknown> = [];

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      // Mirror production semantics by ALWAYS overwriting
      // `mostRecentPendingActions` with the new write's value
      // (defaulting to []). A turn that writes empty pendings
      // CLEARS the prior list — production reads from the most
      // recent turn row, so a stale prior list would never be
      // visible there. The earlier "only update on non-empty"
      // logic could mask future regressions where a recovery turn
      // fails to re-persist pendings (the next turn would still
      // see the previous list and the test would silently pass).
      const pending = (write as { pending_actions?: ReadonlyArray<unknown> })
        .pending_actions;
      mostRecentPendingActions = pending ?? [];
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mostRecentPendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

let v5Enabled = true;
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return v5Enabled;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');
const { computeAnalysisAffectingGraphHash } = await import(
  '../../src/orchestrator-v5/context/graph-hash.js'
);

function buildAmbiguousGraph() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit', successThreshold: 100 },
      // Two factors that both substring-match "Cost and Revenue".
      {
        id: 'fac_cost',
        kind: 'factor',
        label: 'Cost',
        observed_state: { value: 0.5, raw_value: 50000, unit: '£', cap: 200000 },
      },
      {
        id: 'fac_revenue',
        kind: 'factor',
        label: 'Revenue',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
      { id: 'opt_a', kind: 'option', label: 'Plan A' },
      { id: 'opt_b', kind: 'option', label: 'Plan B' },
    ],
    edges: [],
    options: [
      { id: 'opt_a', status: 'ready', interventions: {} },
      { id: 'opt_b', status: 'ready', interventions: {} },
    ],
    goal_node_id: 'goal_1',
  };
}

function buildPayload(message: string) {
  return {
    kind: 'message' as const,
    turn_id: randomUUID(),
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide' as const,
    stage: 'analyse' as const,
    source: 'composer' as const,
    graph_state: buildAmbiguousGraph(),
    selected_elements: { node_ids: [], edge_ids: [] },
  };
}

describe('POST /orchestrate/v2/turn — two-turn clarify→reply HTTP boundary', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    v5Enabled = true;
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    appendCalls.length = 0;
    mostRecentPendingActions = [];
    llmCallTracker.count = 0;
  });

  it('Turn 1 emits clarify chips + persists pending_actions; Turn 2 typed factor label dispatches set_factor_value with the original quantity, no LLM call on either turn', async () => {
    // Turn 1 — multi-candidate clarify.
    const turn1 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildPayload('Set Cost and Revenue to 5'),
    });

    expect(turn1.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const t1Body = OlumiResponseSchema.parse(JSON.parse(turn1.body));

    // Acceptance Gate 1a: clarify response shape — no graph_patch
    // (nothing was applied), but chips for both candidate factors.
    const t1Patch = t1Body.blocks.find((b) => b.type === 'graph_patch');
    expect(t1Patch).toBeUndefined();
    const t1ChipLabels = (t1Body.suggested_actions ?? []).map((a) => a.label);
    expect(t1ChipLabels).toContain('Cost');
    expect(t1ChipLabels).toContain('Revenue');

    // Acceptance Gate 1b: pending_actions were persisted on Turn 1's
    // commit. Two pending actions, one per candidate, each carrying
    // the parsed quantity (5) AND graph_hash from Wave 5I-1.
    expect(appendCalls.length).toBeGreaterThan(0);
    const t1Write = appendCalls[0] as {
      pending_actions?: ReadonlyArray<{
        action: {
          kind: string;
          factor_id?: string;
          value?: number;
        };
        preconditions?: {
          target_entity_ids?: readonly string[];
          graph_hash?: string;
        };
      }>;
    };
    const t1Pendings = t1Write.pending_actions ?? [];
    expect(t1Pendings.length).toBe(2);
    expect(t1Pendings.every((pa) => pa.action.kind === 'set_factor_value')).toBe(true);
    expect(t1Pendings.every((pa) => pa.action.value === 5)).toBe(true);
    // Graph hash is persisted (Wave 5I-1 P0 fix).
    expect(t1Pendings.every((pa) => typeof pa.preconditions?.graph_hash === 'string')).toBe(true);
    // target_entity_ids cover both candidates.
    const targetIds = t1Pendings
      .flatMap((pa) => pa.preconditions?.target_entity_ids ?? [])
      .sort();
    expect(targetIds).toEqual(['fac_cost', 'fac_revenue']);

    // Turn 2 — typed factor label that matches one persisted candidate.
    // The clarification-resume pre-route reads `mostRecentPendingActions`
    // (populated above by the mocked store), matches "Cost" against the
    // persisted target's label in the live graph, reconstructs the
    // proposal, and dispatches set_factor_value deterministically.
    const turn2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildPayload('Cost'),
    });

    expect(turn2.statusCode).toBe(200);
    // Across BOTH turns, zero LLM calls.
    expect(llmCallTracker.count).toBe(0);
    const t2Body = OlumiResponseSchema.parse(JSON.parse(turn2.body));

    // Acceptance Gate 2a: Turn 2 dispatched set_factor_value (NOT
    // edit_graph). The graph_patch block is the wire signature of a
    // mutation handler having run.
    const t2Patch = t2Body.blocks.find((b) => b.type === 'graph_patch');
    expect(t2Patch).toBeDefined();
    expect((t2Patch as { operation?: string }).operation).toBe('set_factor_value');
    // The dispatch resolved to the user-typed factor (Cost), not Revenue.
    expect((t2Patch as { target_id?: string }).target_id).toBe('fac_cost');

    // Acceptance Gate 2b: the ORIGINAL quantity (5) from Turn 1's
    // message survived across the clarify→reply turn boundary. The
    // wire receipt mentions the human factor label (not the raw id)
    // and references "5" or the equivalent prose.
    expect(t2Body.assistant_text).toContain('Cost');
    expect(t2Body.assistant_text).not.toMatch(/\bfac_cost\b/);
    expect(t2Body.assistant_text).not.toMatch(/\bfac_revenue\b/);
    // The reply preserved the typed quantity from Turn 1 (5). It
    // surfaces somewhere in the receipt — we don't pin the exact
    // formatting because the upstream proposal-value mapper varies
    // between unit-bearing and unitless quantities.
    expect(t2Body.assistant_text).toMatch(/\b5\b/);

    // Acceptance Gate 2c: no internal copy at the wire.
    expect(t2Body.assistant_text).not.toMatch(/internal error/i);
    expect(t2Body.assistant_text).not.toMatch(/no pending action/i);
    expect(t2Body.assistant_text).not.toMatch(/skip_reason/i);

    // Acceptance Gate 2d: Turn 2 was committed (handler ran through
    // commit, not a recovery or error). Two appends total (Turn 1's
    // clarify + Turn 2's handler turn).
    expect(appendCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('SEEDED two-turn HTTP proof — ambiguous reply re-persists pendings; chip-equivalent reply applies the original quantity, no LLM call across both turns', async () => {
    // P0 regression cordon. The Wave 5I-2 ambiguous-recovery path
    // emitted chips but did NOT re-persist the surviving candidate
    // pending actions. A chip click on the next turn read
    // `readMostRecentPendingActions` against the recovery row, found
    // nothing, and silently lost the original quantity. Wave 5J-1
    // re-persists the candidates on the recovery commit; this test
    // proves the chip click then applies the original quantity end
    // to end through the HTTP route.
    //
    // SEEDED: this test pre-populates `mostRecentPendingActions` with
    // the two pendings the value-update clarify would have emitted on
    // a prior turn, then drives the recovery + apply turns through
    // `app.inject`. It does NOT exercise the original
    // `tryDeterministicValueUpdate` clarify dispatch — the canonical
    // clarify→reply HTTP flow lives in the test above ("Turn 1 emits
    // clarify chips + persists pending_actions; Turn 2 typed factor
    // label dispatches…"). The seeded form lets us isolate the
    // recovery-and-apply contract (the P0) without depending on the
    // value-update detector's multi-match tokenisation behaviour for
    // long factor labels.

    // Graph fixture: two factors sharing the substring "Time
    // Commitment" so a typed "Time Commitment" fuzzy-matches BOTH
    // (bigram-Dice ≥ 0.5) and triggers recovery_label_ambiguous.
    const ambiguousTimeGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit', successThreshold: 100 },
        {
          id: 'fac_eng_time',
          kind: 'factor',
          label: 'Engineering Time Commitment',
          observed_state: { value: 0.4, raw_value: 40, unit: '%', cap: 100 },
        },
        {
          id: 'fac_owner_time',
          kind: 'factor',
          label: 'Owner Time Commitment',
          observed_state: { value: 0.5, raw_value: 50, unit: '%', cap: 100 },
        },
        { id: 'opt_a', kind: 'option', label: 'Plan A' },
        { id: 'opt_b', kind: 'option', label: 'Plan B' },
      ],
      edges: [],
      options: [
        { id: 'opt_a', status: 'ready', interventions: {} },
        { id: 'opt_b', status: 'ready', interventions: {} },
      ],
      goal_node_id: 'goal_1',
    };
    function payloadOnAmbiguousTimeGraph(message: string) {
      return {
        kind: 'message' as const,
        turn_id: randomUUID(),
        scenario_id: SCENARIO_ID,
        message,
        turn_class: 'decide' as const,
        stage: 'analyse' as const,
        source: 'composer' as const,
        graph_state: ambiguousTimeGraph,
        selected_elements: { node_ids: [], edge_ids: [] },
      };
    }

    // Pre-seed the SessionStore mock with the two pendings the
    // value-update clarify would have emitted. Skipping that turn
    // makes the test focus on the P0 contract — re-persistence on
    // ambiguous recovery + apply on the next turn — without
    // depending on the value-update detector's multi-match
    // tokenisation behaviour for long factor labels. The
    // `preconditions.graph_hash` matches the live graph hash of
    // ambiguousTimeGraph so the Wave 5J-2 fail-closed safety gate
    // doesn't fire.
    const seededGraphHash = computeAnalysisAffectingGraphHash(
      ambiguousTimeGraph as never,
    );
    expect(seededGraphHash).not.toBeNull();
    mostRecentPendingActions = [
      {
        id: `pa-eng-${randomUUID()}`,
        scenario_id: SCENARIO_ID,
        chip_id: 'chip_clarify_factor_0',
        action: {
          kind: 'set_factor_value',
          factor_id: 'fac_eng_time',
          value: 5,
          unit: '%',
          operator: 'set',
        },
        preconditions: {
          target_entity_ids: ['fac_eng_time'],
          ...(seededGraphHash != null
            ? { graph_hash: seededGraphHash }
            : {}),
        },
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T23:59:59.000Z',
        emitted_at_iso: '2026-05-06T00:00:00.000Z',
      },
      {
        id: `pa-owner-${randomUUID()}`,
        scenario_id: SCENARIO_ID,
        chip_id: 'chip_clarify_factor_1',
        action: {
          kind: 'set_factor_value',
          factor_id: 'fac_owner_time',
          value: 5,
          unit: '%',
          operator: 'set',
        },
        preconditions: {
          target_entity_ids: ['fac_owner_time'],
          ...(seededGraphHash != null
            ? { graph_hash: seededGraphHash }
            : {}),
        },
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T23:59:59.000Z',
        emitted_at_iso: '2026-05-06T00:00:00.000Z',
      },
    ];

    // Turn 1 (of this test) — ambiguous reply against the seeded
    // pendings → recovery_label_ambiguous. The Wave 5J-1 fix
    // re-persists the surviving pendings on this turn's commit so
    // the next turn's chip-equivalent reply can find them.
    const turn1 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadOnAmbiguousTimeGraph('Time Commitment'),
    });
    expect(turn1.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const t1Body = OlumiResponseSchema.parse(JSON.parse(turn1.body));
    // Wire-level proof of the recovery branch.
    expect(t1Body.assistant_text).toMatch(/more than one factor/i);
    expect(t1Body.assistant_text).not.toContain('—');
    const turn1ChipLabels = (t1Body.suggested_actions ?? []).map((a) => a.label);
    expect(turn1ChipLabels).toContain('Engineering Time Commitment');
    expect(turn1ChipLabels).toContain('Owner Time Commitment');
    // P0 verification at the persistence layer: 2 pendings re-emitted
    // on the recovery turn. Without this, Turn 2 below would find no
    // pendings and either fall through to the LLM or surface a
    // no-pending recovery.
    expect(mostRecentPendingActions.length).toBe(2);
    expect(
      mostRecentPendingActions.every(
        (pa) =>
          (pa as { action: { kind: string; value?: number } }).action.kind ===
            'set_factor_value' &&
          (pa as { action: { value?: number } }).action.value === 5,
      ),
    ).toBe(true);

    // Turn 2 (of this test) — chip-equivalent reply (the user picked
    // "Engineering Time Commitment"). The resumer reads the
    // re-persisted pendings, matches the label uniquely against
    // f_eng_time, reconstructs the original quantity (5), and
    // dispatches set_factor_value deterministically.
    const turn2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadOnAmbiguousTimeGraph('Engineering Time Commitment'),
    });
    expect(turn2.statusCode).toBe(200);
    // Across BOTH turns, zero LLM calls.
    expect(llmCallTracker.count).toBe(0);
    const t2Body = OlumiResponseSchema.parse(JSON.parse(turn2.body));
    // Wire signature of a successful set_factor_value mutation.
    const t2Patch = t2Body.blocks.find((b) => b.type === 'graph_patch');
    expect(t2Patch).toBeDefined();
    expect((t2Patch as { operation?: string }).operation).toBe('set_factor_value');
    expect((t2Patch as { target_id?: string }).target_id).toBe('fac_eng_time');
    // Original quantity (5) survived through the ambiguous-recovery
    // turn boundary. This is the P0 contract this test cordons.
    expect(t2Body.assistant_text).toContain('Engineering Time Commitment');
    expect(t2Body.assistant_text).not.toMatch(/\bfac_eng_time\b/);
    expect(t2Body.assistant_text).toMatch(/\b5\b/);
    // No internal copy leaks at any point.
    expect(t2Body.assistant_text).not.toMatch(/no pending action/i);
    expect(t2Body.assistant_text).not.toMatch(/internal error/i);
  });

  it('Turn 2 typed message matching neither candidate falls through to LLM (negative gate)', async () => {
    // Turn 1 — same multi-candidate clarify as above.
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildPayload('Set Cost and Revenue to 5'),
    });
    expect(llmCallTracker.count).toBe(0);
    expect(mostRecentPendingActions.length).toBe(2);

    // Turn 2 — a free-text message unrelated to either candidate. The
    // resumer's no_label_match path correctly defers to the LLM. We
    // assert the LLM IS called (the throwing adapter surfaces the call
    // count). This proves the resumer's defer-to-LLM path is honest:
    // it doesn't aggressively claim turns it can't actually resolve.
    const turn2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildPayload('what is going on with the model'),
    });

    // The LLM was attempted (and the throwing mock surfaced an error,
    // which the route handler then reports as a 500 BoundaryError).
    // The contract being verified is "LLM was called when no
    // clarification candidate matched", which the count assertion
    // proves regardless of the error response shape.
    expect(llmCallTracker.count).toBeGreaterThan(0);
    expect([200, 500]).toContain(turn2.statusCode);
  });
});
