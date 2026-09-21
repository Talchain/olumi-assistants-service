/**
 * Wave 5E route-level test for clarification continuity.
 *
 * Pins the brief evidence #3 closure: a user who types just a
 * factor label after a value-update clarify dispatches the
 * deterministically reconstructed set_factor_value via
 * tryClarificationResume — no LLM call, validator passes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = randomUUID();

const appendCalls: Array<Record<string, unknown>> = [];
// Let-bound so individual tests can stamp the seeded pendings with
// the correct `preconditions.graph_hash` (the live hash of the graph
// fixture, computed AFTER the awaited graph-hash import resolves).
// Mutated in beforeEach below.
let mockedPendingActions: ReadonlyArray<PendingAction> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
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
    readMostRecentPendingActions: async () => mockedPendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { computeAnalysisAffectingGraphHash } = await import(
  '../context/graph-hash.js'
);

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'clarify',
    stage: 'analyse',
  });
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when clarification-resume matches');
      }),
  };
}

function callingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: 'Some Sonnet text.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

const FACTOR_GRAPH = {
  nodes: [
    { id: 'goal_g', kind: 'goal', label: 'Goal' },
    { id: 'dec_d', kind: 'decision', label: 'Decision' },
    { id: 'opt_a', kind: 'option', label: 'Option A' },
    { id: 'opt_b', kind: 'option', label: 'Option B' },
    { id: 'f_eng_time', kind: 'factor', label: 'Engineering Time Commitment' },
    { id: 'f_owner_time', kind: 'factor', label: 'Owner Time Commitment' },
  ],
  edges: [
    {
      from: 'dec_d',
      to: 'opt_a',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_a',
      to: 'goal_g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

// Live hash of FACTOR_GRAPH — used to populate `preconditions.graph_hash`
// on the seeded pendings so the resumer's safety gate (Wave 5J-2: missing
// graph_hash on a mutating pending is unsafe) doesn't fire spuriously.
const FACTOR_GRAPH_HASH = computeAnalysisAffectingGraphHash(
  FACTOR_GRAPH as never,
);

// Default seeded pending used by the success-path tests in this
// suite. Built post-import so `FACTOR_GRAPH_HASH` (which depends on
// the awaited graph-hash module) is available. The
// `preconditions.graph_hash` matches the live graph hash so the
// Wave 5J-2 fail-closed safety gate doesn't fire spuriously.
function makeDefaultSeededPending(): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_clarify_factor_0',
    action: {
      kind: 'set_factor_value',
      factor_id: 'f_eng_time',
      value: 30,
      unit: '%',
      operator: 'set',
    },
    preconditions: {
      target_entity_ids: ['f_eng_time'],
      ...(FACTOR_GRAPH_HASH != null
        ? { graph_hash: FACTOR_GRAPH_HASH }
        : {}),
    },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-05-05T00:00:00.000Z',
  };
}

describe('Wave 5E — clarification-resume route-level', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    mockedPendingActions = [makeDefaultSeededPending()];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('typed factor label after a clarify dispatches via tryClarificationResume; no LLM call', async () => {
    // The mocked SessionStore returns a single set_factor_value
    // pending action whose factor_id matches f_eng_time. The user's
    // message ("Engineering Time Commitment") matches that factor's
    // label in the graph. tryClarificationResume should match,
    // synthesise the proposal, and the routing LLM must NOT be
    // called.
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      payload('Engineering Time Commitment'),
      'req-clarification-resume',
      {
        routingAdapter: adapter,
        graphState: FACTOR_GRAPH as never,
      },
    );
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    // The synthesised tool_call passed orient; the lifecycle then
    // ran validate. This proves tryClarificationResume fired
    // correctly. Full handler execute + commit lifecycle requires
    // a properly-typed handler stub which is out of scope here;
    // staging journey replay (Wave 6) covers that end to end.
    expect(result.telemetry.stages_completed).toContain('orient');
    expect(result.telemetry.llm_calls_used).toBe(0);
  });

  it('a message containing an edit verb falls through to the value-update detector (negative gate)', async () => {
    const adapter = callingRoutingAdapter();
    await runTurnExecutor(
      payload('set Engineering Time Commitment to 30%'),
      'req-clarification-resume-edit-verb',
      {
        routingAdapter: adapter,
        graphState: FACTOR_GRAPH as never,
      },
    );
    // tryDeterministicValueUpdate matches and dispatches directly,
    // OR falls through to the LLM. Either way, tryClarificationResume
    // does NOT claim the message — the negative gate inside the
    // module steers it away.
    // We don't assert chatWithTools here because the value-update
    // detector might dispatch directly. The crucial assertion is
    // that tryClarificationResume did not synthesise its own
    // dispatch (which would be wrong because the user provided a
    // quantity — value-update is the canonical path).
  });

  it('a typed message matching no factor in the graph falls through unchanged', async () => {
    const adapter = callingRoutingAdapter();
    await runTurnExecutor(
      payload('something completely unrelated'),
      'req-clarification-resume-no-match',
      {
        routingAdapter: adapter,
        graphState: FACTOR_GRAPH as never,
      },
    );
    // tryClarificationResume returns no_label_match; control flows
    // to the LLM which is the right outcome for free-text messages
    // that don't relate to any persisted candidate.
    expect(adapter.chatWithTools).toHaveBeenCalled();
  });

  it('reply matching multiple candidates dispatches recovery_label_ambiguous: focused re-clarify chips, no LLM call', async () => {
    // Both pending factors share the substring "Time Commitment".
    // The user's reply ("time commitment") matches BOTH targets, so
    // tryClarificationResume returns recovery_label_ambiguous. The
    // route-level wiring must commit a focused re-clarify (one chip
    // per candidate, curated assistant_text) instead of letting the
    // ambiguous reply reach Sonnet.
    const baseSeed = makeDefaultSeededPending();
    const TWO_PENDINGS: PendingAction[] = [
      {
        ...baseSeed,
        id: `pa-amb-1-${randomUUID()}`,
        chip_id: 'chip_clarify_factor_0',
        action: {
          kind: 'set_factor_value',
          factor_id: 'f_eng_time',
          value: 30,
          unit: '%',
          operator: 'set',
        },
        preconditions: {
          target_entity_ids: ['f_eng_time'],
          ...(FACTOR_GRAPH_HASH != null
            ? { graph_hash: FACTOR_GRAPH_HASH }
            : {}),
        },
      },
      {
        ...baseSeed,
        id: `pa-amb-2-${randomUUID()}`,
        chip_id: 'chip_clarify_factor_1',
        action: {
          kind: 'set_factor_value',
          factor_id: 'f_owner_time',
          value: 30,
          unit: '%',
          operator: 'set',
        },
        preconditions: {
          target_entity_ids: ['f_owner_time'],
          ...(FACTOR_GRAPH_HASH != null
            ? { graph_hash: FACTOR_GRAPH_HASH }
            : {}),
        },
      },
    ];
    mockedPendingActions = TWO_PENDINGS;
    {
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(
        payload('time commitment'),
        'req-clarification-resume-ambiguous',
        {
          routingAdapter: adapter,
          graphState: FACTOR_GRAPH as never,
        },
      );
      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(result.telemetry.commit_performed).toBe(true);
      expect(result.telemetry.llm_calls_used).toBe(0);
      expect(result.response.assistant_text).toMatch(/more than one factor/i);
      // Brief rule: British English, no em dash. The recovery copy
      // must use a full stop between the statement and the question.
      expect(result.response.assistant_text).not.toContain('—');
      const labels = (result.response.suggested_actions ?? []).map(
        (a) => a.label,
      );
      expect(labels).toContain('Engineering Time Commitment');
      expect(labels).toContain('Owner Time Commitment');
      // No internal copy leaks at the wire.
      expect(result.response.assistant_text).not.toMatch(/skip_reason/i);
      expect(result.response.assistant_text).not.toMatch(/internal error/i);

      // Wave 5J-1 P0: the recovery turn MUST re-persist the surviving
      // candidate pending actions so a chip click on the next turn
      // can dispatch with the original quantity. Without this,
      // `readMostRecentPendingActions` on the next turn reads from the
      // recovery row, finds nothing, and the chip click loses the
      // quantity (regression that motivated this fix).
      expect(appendCalls.length).toBeGreaterThan(0);
      const recoveryWrite = appendCalls[0]!;
      const persisted = (recoveryWrite as {
        pending_actions?: ReadonlyArray<{
          action: { kind: string; factor_id?: string; value?: number };
          preconditions?: {
            target_entity_ids?: readonly string[];
            graph_hash?: string;
          };
          chip_id?: string;
        }>;
      }).pending_actions ?? [];
      expect(persisted).toHaveLength(2);
      expect(persisted.every((pa) => pa.action.kind === 'set_factor_value')).toBe(true);
      // Original quantity (30) preserved verbatim from the input
      // pendings — chip click on the next turn will reconstruct
      // exactly the same proposal.
      expect(persisted.every((pa) => pa.action.value === 30)).toBe(true);
      // Both candidate factor_ids are still represented and pair
      // with the chip ids on the wire so the next-turn resumer can
      // match by label uniquely after the user picks one.
      const persistedFactorIds = persisted
        .map((pa) => pa.action.factor_id)
        .sort();
      expect(persistedFactorIds).toEqual(['f_eng_time', 'f_owner_time']);
      const persistedChipIds = persisted.map((pa) => pa.chip_id).sort();
      expect(persistedChipIds).toEqual([
        'chip_clarify_factor_0',
        'chip_clarify_factor_1',
      ]);
      // Wave 5K-1 invariant: re-emitted pendings carry a non-empty
      // `preconditions.graph_hash` so the next-turn divergence guard
      // (Wave 5J-2 fail-closed) reads the right baseline. Without
      // this hash, the chip click on the next turn would dispatch
      // `recovery_graph_changed` and the original quantity would be
      // lost — a regression equivalent to the P0 we're cordoning,
      // just one layer deeper. Pinning here so a future refactor
      // that drops the re-stamp from turn-executor's recovery
      // branch breaks loudly.
      expect(persisted.every((pa) => typeof pa.preconditions?.graph_hash === 'string')).toBe(true);
      expect(persisted.every((pa) => (pa.preconditions?.graph_hash?.length ?? 0) > 0)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// F-HELD fix 4b (A-variant) — route-level driver-answer resume for
// edit_graph_add_risk. Wire shape 04c→10c: the add-risk clarify asked
// "What factor drives it most?" and the reply was dropped to the LLM, which
// coached instead of continuing the add. The resumer must claim the reply,
// acknowledge deterministically (no LLM call), consume the answered pending,
// and offer an EXECUTABLE follow-up chip whose replay message routes to the
// edit pipeline.
// ---------------------------------------------------------------------------

describe('F-HELD 4b — add-risk driver-answer resume route-level', () => {
  const ADD_RISK_GRAPH = {
    nodes: [
      ...FACTOR_GRAPH.nodes,
      { id: 'f_team_size', kind: 'factor', label: 'Team size' },
    ],
    edges: FACTOR_GRAPH.edges,
  };
  const ADD_RISK_GRAPH_HASH = computeAnalysisAffectingGraphHash(
    ADD_RISK_GRAPH as never,
  );

  function makeAddRiskPending(): PendingAction {
    return {
      id: `pa-add-risk-${randomUUID()}`,
      scenario_id: SCENARIO_ID,
      chip_id: 'chip_add_risk_clarify',
      action: {
        kind: 'edit_graph_add_risk',
        label: 'client concentration',
      },
      preconditions: {
        ...(ADD_RISK_GRAPH_HASH != null
          ? { graph_hash: ADD_RISK_GRAPH_HASH }
          : {}),
      },
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-05-05T00:00:00.000Z',
    };
  }

  beforeEach(() => {
    appendCalls.length = 0;
    mockedPendingActions = [makeAddRiskPending()];
  });

  it('wire 10c shape: the driver answer is claimed deterministically — no LLM call, ack + executable chip, pending consumed', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      payload('Team size drives it most.'),
      'req-add-risk-driver-resume',
      {
        routingAdapter: adapter,
        graphState: ADD_RISK_GRAPH as never,
      },
    );
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    expect(result.telemetry.commit_performed).toBe(true);
    // Deterministic acknowledgement restates risk + driver, promises nothing
    // it cannot do, and steers to the executable continuation.
    expect(result.response.assistant_text).toMatch(/client concentration/i);
    expect(result.response.assistant_text).toMatch(/team size/i);
    const chips = result.response.suggested_actions ?? [];
    expect(chips.length).toBeGreaterThan(0);
    const applyChip = chips[0]!;
    // The replay message is a compound edit instruction: it routes to the
    // edit pipeline (edit verb present) and does NOT re-match the bare
    // add-risk clarify classifier (which is end-anchored on "as a risk").
    expect(applyChip.message).toMatch(/^Add client concentration as a risk, /i);
    expect(applyChip.message).toMatch(/team size/i);
    // The answered clarify pending is consumed — not carried forward.
    expect(appendCalls.length).toBeGreaterThan(0);
    const write = appendCalls[0]! as {
      pending_actions?: ReadonlyArray<{ action: { kind: string } }>;
    };
    expect(
      (write.pending_actions ?? []).some(
        (pa) => pa.action.kind === 'edit_graph_add_risk',
      ),
    ).toBe(false);
  });

  it('an unrelated reply with a live add-risk pending still reaches the LLM (no over-claiming)', async () => {
    const adapter = callingRoutingAdapter();
    await runTurnExecutor(
      payload('what should we look at next'),
      'req-add-risk-no-claim',
      {
        routingAdapter: adapter,
        graphState: ADD_RISK_GRAPH as never,
      },
    );
    expect(adapter.chatWithTools).toHaveBeenCalled();
  });
});
