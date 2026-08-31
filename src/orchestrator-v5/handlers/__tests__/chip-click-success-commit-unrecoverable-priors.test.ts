/**
 * ROADMAP 2.1353 r4 — "UNAVAILABLE" MUST NOT BE RENDERED AS "AUTHORITATIVELY EMPTY",
 * AND A RECOVERY THAT RECOVERED NOTHING MUST NOT REPORT ITSELF AS A RECOVERY.
 *
 * Independent-review finding on PR #1286 at head `63880ed1`:
 * "unavailable history still becomes authoritative empty."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MECHANISM — ONE CODE, TWO PRODUCERS, OPPOSITE RECOVERY BEHAVIOUR
 * ═══════════════════════════════════════════════════════════════════════════
 * `SupabaseSessionStore.readMostRecentPendingActions` throws the SAME
 * `pending_actions_corrupt` code from two places, and the tolerant loader
 * behaves completely differently at each:
 *
 *   PRODUCER A — `!Array.isArray(raw)` (supabase-store.ts :2307-2323).
 *     strict   -> throws `pending_actions_corrupt` (:2319)
 *     tolerant -> `return []` (:2322).  ZERO SURVIVORS, ALWAYS. There is
 *                 nothing here to recover and there never can be.
 *
 *   PRODUCER B — parse failures / scenario mismatches (:2343-2373).
 *     strict   -> throws `pending_actions_corrupt` (:2370)
 *     tolerant -> returns the SURVIVORS (:2374).  A genuine partial recovery
 *                 WHEN at least one entry parsed.
 *
 * The success-commit fallback keyed on the CODE alone. On producer A it called
 * the tolerant loader, got `[]`, ASSIGNED it, and threaded
 * `priorPendingActions: []` — which `commit.ts` resolves to a TOTAL WIPE,
 * identical to omitting the key, i.e. identical to the defect the PR exists to
 * stop — while logging `v5.pending_wipe_partial_recovery_on_success_commit`
 * with `recovered_count: 0` and the words "recovered the readable survivors".
 *
 * A TOTAL LOSS, REPORTED AS A RECOVERY. Worse than the original defect, because
 * the original was silent and this one is confidently wrong: a "recovered"
 * event is exactly what stops anyone investigating.
 *
 * It also contradicts the threading site's own comment, which promises the key
 * is "Omitted (not `[]`) when the read FAILED, so the wipe stays honestly
 * attributable to the read failure" — the fallback assigned `[]` and defeated it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE DISCRIMINATOR IS THE COUNT, NOT THE PRODUCER
 * ═══════════════════════════════════════════════════════════════════════════
 * Keying on "which producer threw" would fix only the branch the review named.
 * PRODUCER B ALSO YIELDS ZERO when EVERY entry fails to parse — a row of four
 * unreadable entries recovers nothing and would still have reported a recovery.
 * `recovered.length === 0` is true of both and is what the claim actually
 * depends on, so it is the honest discriminator. CASE 2 below is that
 * unnamed second path, and it fails at pristine exactly as CASE 1 does.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW THIS SUITE AVOIDS THE GUARD-AGREEING-WITH-ITSELF TRAP
 * ═══════════════════════════════════════════════════════════════════════════
 * The existing kit mocks the tolerant loader's RETURN VALUE, so it certifies
 * "if survivors come back we carry them" and can never observe "survivors come
 * back in the state that made strict throw". Both producers throw the identical
 * code, so nothing distinguishes them and a mutant kit scores 100%.
 *
 * This suite mocks NEITHER loader. It installs a REAL `SupabaseSessionStore`
 * over a fake Supabase client and sets the `pending_actions` COLUMN to each
 * triggering state, so the real strict read and the real tolerant read both run
 * against real bytes. Every case then PINS ITS OWN PRECONDITION by asserting
 * the store's own `PendingActionsReadDegraded` telemetry reason — `jsonb_not_array`
 * for producer A, `parse_failed` for producer B — so the test proves WHICH
 * producer it exercised rather than assuming it.
 *
 * CASES 3 and 4 are the mandatory opposite-direction twins: a partial corruption
 * with a real survivor must STILL carry that survivor, and a genuinely empty
 * history must STILL come through as an authoritative empty. Without them the
 * fix could be bought by treating every read as unrecoverable — the mirror lie.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { log } from '../../../utils/telemetry.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const {
  commitDirectAnswerMock,
  loadScenarioSnapshotForRunAnalysisMock,
  enrichRunAnalysisMock,
  handlerFnMock,
  createRegistryMock,
  pendingActionsColumn,
} = vi.hoisted(() => ({
  commitDirectAnswerMock: vi.fn(),
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  handlerFnMock: vi.fn(),
  createRegistryMock: vi.fn(),
  // The COLUMN each case sets. The real store reads this; nothing mocks a loader.
  pendingActionsColumn: { value: [] as unknown },
}));

vi.mock('../../commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../commit.js')>('../../commit.js');
  return { ...actual, commitDirectAnswer: commitDirectAnswerMock };
});

/**
 * ⭐ THE WHOLE POINT: `getSessionStore` returns a REAL `SupabaseSessionStore`
 * over a fake client. `build-turn-context`'s loaders are NOT mocked, so the
 * strict read and the tolerant fallback both execute the real producer logic.
 */
vi.mock('../../session/index.js', async () => {
  const { SupabaseSessionStore } = await vi.importActual<
    typeof import('../../session/supabase-store.js')
  >('../../session/supabase-store.js');
  const { SessionLRUCache } = await vi.importActual<
    typeof import('../../session/cache.js')
  >('../../session/cache.js');

  const client = {
    rpc: vi.fn(async () => ({ data: 'row-id-123', error: null })),
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () =>
          Promise.resolve({
            data: [{ id: 'turn-row-pending-1', pending_actions: pendingActionsColumn.value }],
            error: null,
          }),
      });
      return chain;
    }),
  } as never;

  const store = new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }) as never,
    { defaultReadLimit: 20 } as never,
  );
  return { getSessionStore: () => store, resetSessionStoreForTests: () => {} };
});

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    // ⚠ REAL loaders — `loadMostRecentPendingActionsIntegrityStrict` and
    // `loadMostRecentPendingActions` are deliberately NOT overridden.
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'Run analysis' }],
      session_id: SCENARIO_ID,
      request_id: 'req-unrecoverable',
      budgets: {
        turn_ms: 30000,
        handler_ms: 20000,
        plot_ms: 15000,
        anthropic_ms: 15000,
        openai_ms: 15000,
      },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    })),
  };
});

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    createRegistry: createRegistryMock,
    getDefaultRegistry: () => new Map([['run_analysis', handlerFnMock]]),
    resolveHandler: (_r: unknown, id: string) => (id === 'run_analysis' ? handlerFnMock : undefined),
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

/** A pending the real `parsePendingAction` accepts. */
const VALID_PENDING: PendingAction = {
  id: 'pa-live-hold-1',
  scenario_id: SCENARIO_ID,
  chip_id: 'chip-live-hold-1',
  action: { kind: 'run_analysis' },
  preconditions: {},
  expires_at_turn_count: 3,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-08-31T10:00:00.000Z',
} as unknown as PendingAction;

/** An entry the real `parsePendingAction` REJECTS (turn count is not a number). */
const UNPARSEABLE = { ...VALID_PENDING, expires_at_turn_count: 'three' };

const READY_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
  ],
  edges: [
    { from: 'dec_launch', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_launch', to: 'opt_status_quo', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_launch', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_status_quo', to: 'fac_marketing', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;

function snapshotFor(graph: GraphV3T): RunAnalysisScenarioSnapshot {
  return {
    graph,
    options: [
      { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
      { id: 'opt_status_quo', option_id: 'opt_status_quo', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
    ],
    goal_node_id: 'goal_revenue',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
}

function handlerOk() {
  return {
    assistant_text: 'Ran analysis on your current scenario.',
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_launch',
          win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
          summary: 'Ran analysis on your current scenario.',
          enrichment: {},
        },
      },
    ],
    llm_calls_used: 0,
  };
}

let events: Array<{ event: string; data: Record<string, unknown> }> = [];
let errorLogs: Array<Record<string, unknown>> = [];
/** Payload + the human sentence beside it — the pair CASE 6 checks for agreement. */
let errorLines: Array<{ payload: Record<string, unknown>; message: string }> = [];

/** The metadata the dispatcher actually handed the commit chokepoint. */
function commitMetadata(): Record<string, unknown> {
  expect(commitDirectAnswerMock.mock.calls.length, 'the commit never ran').toBeGreaterThan(0);
  return (commitDirectAnswerMock.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
}

/** The store's OWN degradation reason — proves WHICH producer this case exercised. */
function degradedReasons(): unknown[] {
  return events.filter(e => e.event === 'v5.pending_actions.read_degraded').map(e => e.data.reason);
}

function recoveryEventNames(): string[] {
  return errorLogs
    .map(l => l.event)
    .filter((e): e is string => typeof e === 'string' && e.includes('pending_wipe'));
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  errorLogs = [];
  errorLines = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  handlerFnMock.mockResolvedValue(handlerOk());
  enrichRunAnalysisMock.mockImplementation(
    async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
  );
  createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
  loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshotFor(READY_GRAPH));
  commitDirectAnswerMock.mockImplementation(async (r: unknown) => ({
    response: r,
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  }));
  vi.spyOn(log, 'warn').mockImplementation(() => {});
  vi.spyOn(log, 'error').mockImplementation((obj: unknown, msg?: unknown) => {
    const payload = (obj ?? {}) as Record<string, unknown>;
    errorLogs.push(payload);
    errorLines.push({ payload, message: typeof msg === 'string' ? msg : '' });
  });
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('chip-click run_analysis SUCCESS commit — a recovery that recovered nothing is a LOSS', () => {
  it('CASE 1 (PRODUCER A, the named defect): a non-array column recovers NOTHING, so no `[]` is threaded and nothing claims a recovery', async () => {
    pendingActionsColumn.value = { corrupt: 'not-an-array' };

    const out = await dispatchChipClickRunAnalysis({ payload: payload(), requestId: 'req-A' });
    expect(out.outcome).toBe('ok');

    // PRECONDITION PINNED IN-TEST: this case genuinely exercised producer A.
    // Without this the case could pass against a state that never reaches it.
    expect(
      degradedReasons(),
      'this case did not exercise the non-array producer — the assertions below are about nothing',
    ).toContain('jsonb_not_array');

    // ⭐ THE DEFECT. `[]` threaded IS the wipe: `commit.ts` resolves both `[]`
    // and an omitted key to a total carry-forward loss, so assigning `[]`
    // achieves exactly what the PR exists to prevent.
    expect(
      commitMetadata(),
      'threading `[]` from an UNAVAILABLE read is the wipe, and it disguises a read failure as ' +
        'an authoritative empty — the key must stay omitted so the loss is attributable',
    ).not.toHaveProperty('priorPendingActions');

    // ⭐ AND THE CLAIM MUST MATCH THE PAYLOAD. A "partial recovery" event with
    // recovered_count 0 is a telemetry string contradicting its own numbers.
    expect(
      recoveryEventNames(),
      'nothing was recovered, so nothing may report a recovery',
    ).not.toContain('v5.pending_wipe_partial_recovery_on_success_commit');
    expect(recoveryEventNames()).toContain('v5.pending_wipe_unrecoverable_on_success_commit');
  });

  it('CASE 2 (PRODUCER B, zero survivors — the path the review did NOT name): every entry unreadable is also a LOSS', async () => {
    pendingActionsColumn.value = [UNPARSEABLE, { ...UNPARSEABLE, id: 'pa-live-hold-2' }];

    const out = await dispatchChipClickRunAnalysis({ payload: payload(), requestId: 'req-B0' });
    expect(out.outcome).toBe('ok');

    // Precondition: this is the PARSE producer, not the non-array one.
    expect(degradedReasons()).toContain('parse_failed');
    expect(degradedReasons()).not.toContain('jsonb_not_array');

    expect(
      commitMetadata(),
      'a row whose every entry is unreadable recovers nothing — keying the claim on the ERROR ' +
        'CODE instead of the RECOVERED COUNT would have reported this as a recovery too',
    ).not.toHaveProperty('priorPendingActions');
    expect(recoveryEventNames()).not.toContain('v5.pending_wipe_partial_recovery_on_success_commit');
    expect(recoveryEventNames()).toContain('v5.pending_wipe_unrecoverable_on_success_commit');
  });

  it('CASE 3 (⭐ OPPOSITE-DIRECTION TWIN): a partial corruption with a real survivor STILL carries that survivor, and reports a genuine recovery', async () => {
    pendingActionsColumn.value = [VALID_PENDING, UNPARSEABLE];

    const out = await dispatchChipClickRunAnalysis({ payload: payload(), requestId: 'req-B1' });
    expect(out.outcome).toBe('ok');

    expect(degradedReasons()).toContain('parse_failed');

    const threaded = commitMetadata().priorPendingActions as readonly PendingAction[] | undefined;
    expect(
      threaded,
      'the survivor was dropped — a fix that treats every corrupt read as unrecoverable has ' +
        'traded the false-recovery lie for its mirror, and destroys a live proposal it could have kept',
    ).toBeDefined();
    // Bound by IDENTITY, not by length: another entry could satisfy a count.
    expect(threaded!.map(p => p.id)).toEqual(['pa-live-hold-1']);
    expect(recoveryEventNames()).toContain('v5.pending_wipe_partial_recovery_on_success_commit');
    expect(recoveryEventNames()).not.toContain('v5.pending_wipe_unrecoverable_on_success_commit');
  });

  it('CASE 4 (⭐ OPPOSITE-DIRECTION TWIN): a GENUINELY empty history still comes through as an authoritative empty', async () => {
    pendingActionsColumn.value = [];

    const out = await dispatchChipClickRunAnalysis({ payload: payload(), requestId: 'req-empty' });
    expect(out.outcome).toBe('ok');

    // Nothing was corrupt, so the store must not have reported ANY degradation:
    // this is a successful read that legitimately found nothing.
    expect(
      degradedReasons(),
      'a healthy empty row must not look like a degradation',
    ).toHaveLength(0);

    // A real empty IS authoritative and must be threaded as such — this is the
    // half a heavy-handed fix would break.
    expect(commitMetadata()).toHaveProperty('priorPendingActions');
    expect(commitMetadata().priorPendingActions).toEqual([]);
    expect(recoveryEventNames(), 'a healthy read must not report a wipe risk at all').toEqual([]);
  });

  it('CASE 6 (⭐ the claim must match the payload, over EVERY state): no event may describe a recovery it did not perform', async () => {
    // Written against the SPEC ("an event's words must be true of its own
    // numbers"), not against the failure mode in hand — so it holds for states
    // this suite has not enumerated and for producers not yet written. Round 3
    // emitted `recovered the readable survivors` beside `recovered_count: 0`;
    // this makes that combination structurally impossible rather than merely
    // absent today.
    const states: Array<{ name: string; column: unknown }> = [
      { name: 'non-array column (producer A)', column: { corrupt: 'not-an-array' } },
      { name: 'all entries unparseable (producer B, zero survivors)', column: [UNPARSEABLE] },
      { name: 'partial corruption with a survivor', column: [VALID_PENDING, UNPARSEABLE] },
      { name: 'genuinely empty history', column: [] },
    ];

    for (const { name, column } of states) {
      vi.clearAllMocks();
      events = [];
      errorLogs = [];
      errorLines = [];
      commitDirectAnswerMock.mockImplementation(async (r: unknown) => ({
        response: r,
        performed: true,
        persisted_row_id: 'row-1',
        graphPersisted: false,
      }));
      handlerFnMock.mockResolvedValue(handlerOk());
      createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
      loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshotFor(READY_GRAPH));

      pendingActionsColumn.value = column;
      await dispatchChipClickRunAnalysis({ payload: payload(), requestId: `req-sem-${name}` });

      for (const line of errorLines) {
        const event = line.payload.event;
        if (typeof event !== 'string' || !event.includes('pending_wipe')) continue;
        const count = line.payload.recovered_count;

        // (a) The EVENT NAME may only claim a recovery when one happened.
        if (event.includes('partial_recovery')) {
          expect(
            count,
            `[${name}] an event named a partial recovery while recovering nothing`,
          ).toBeGreaterThan(0);
        }
        // (b) And the SENTENCE may not claim one either. This is the exact
        // round-3 string, pinned so it cannot come back over an empty payload.
        if (typeof count === 'number' && count === 0) {
          expect(
            line.message,
            `[${name}] a zero-recovery event still tells the reader it recovered survivors`,
          ).not.toContain('recovered the readable survivors');
        }
      }
    }
  });

  it('CASE 5 (the discrimination is REAL): the unrecoverable and the recoverable states produce DIFFERENT observable outcomes', async () => {
    pendingActionsColumn.value = { corrupt: 'not-an-array' };
    await dispatchChipClickRunAnalysis({ payload: payload(), requestId: 'req-disc-A' });
    const unrecoverable = {
      threaded: Object.prototype.hasOwnProperty.call(commitMetadata(), 'priorPendingActions'),
      events: recoveryEventNames(),
    };

    vi.clearAllMocks();
    events = [];
    errorLogs = [];
    commitDirectAnswerMock.mockImplementation(async (r: unknown) => ({
      response: r,
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    }));
    handlerFnMock.mockResolvedValue(handlerOk());
    createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshotFor(READY_GRAPH));

    pendingActionsColumn.value = [VALID_PENDING, UNPARSEABLE];
    await dispatchChipClickRunAnalysis({ payload: payload(), requestId: 'req-disc-B' });
    const recoverable = {
      threaded: Object.prototype.hasOwnProperty.call(commitMetadata(), 'priorPendingActions'),
      events: recoveryEventNames(),
    };

    // Both states throw the IDENTICAL `pending_actions_corrupt` code. If these
    // two outcomes were equal, the consumer still could not tell them apart and
    // the fix would be a guard agreeing with itself.
    expect(
      unrecoverable,
      'the two states are indistinguishable at the consumer — the decision is still resting on ' +
        'the error code alone',
    ).not.toEqual(recoverable);
    expect(unrecoverable.threaded).toBe(false);
    expect(recoverable.threaded).toBe(true);
  });
});
