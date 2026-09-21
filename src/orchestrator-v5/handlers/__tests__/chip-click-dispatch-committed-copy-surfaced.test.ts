/**
 * ROADMAP 2.1353 follow-on — THE CHIP-CLICK DISPATCHER SHIPS THE COMPOSED
 * ANSWER, NOT THE COMMITTED ONE, SO THE F-HELD LAPSE COPY NEVER REACHES THE USER.
 *
 * Named by an independent Codex review of PR #1286 (exact-head verdict
 * `5483244874`, issue (b)): "actual commit lapse copy is missing from the
 * dispatcher-returned answer".
 *
 * MECHANISM, derived at the bytes on staging `d0544243`:
 *
 *   1. `commitDirectAnswer` (commit.ts) runs the carry-forward pass over
 *      `metadata.priorPendingActions`. When that pass turn-TTL-drops — or
 *      consent-priority-cap-evicts — a CONFIRMATION_EXPECTING pending, it
 *      appends ONE deterministic sentence (`buildHeldLapseNotice`) to the
 *      response it is about to persist, and RETURNS that amended response as
 *      `CommitResult.response`. Already pinned by commit.test.ts:357.
 *   2. `commit.ts`'s own return-site docblock states the contract:
 *      "Callers that consume `CommitResult.response` … surface it on the wire,
 *      so wire copy == durable copy."
 *   3. BOTH chip-click `run_analysis` exits DISCARD the return value. The
 *      recovery exit awaits the commit and then returns `recovered.response`;
 *      the success exit awaits it and returns `response`. Both are the
 *      PRE-COMMIT objects. route-v2 ships `cc.response` straight to
 *      `sendFinalised200`, so the notice is persisted into the turn row and
 *      never spoken.
 *
 * The user's live proposal lapses SILENTLY, and the turn row disagrees with
 * the wire about what the user was told.
 *
 * ⚠ SCOPE OF THE TWO EXITS, STATED PRECISELY (CLAUDE.md trap 20 — a row minted
 * from a finding must restate the finding's exact scope, never its
 * generalisation):
 *
 *   - The RECOVERY exit threads `priorPendingActions` ON STAGING TODAY
 *     (chip-click-dispatch.ts, `loadMostRecentPendingActionsIntegrityStrict`).
 *     Its carry-forward can therefore build a notice right now, so the defect
 *     is LIVE on staging and independent of PR #1286.
 *   - The SUCCESS exit threads no priors on staging; PR #1286 adds that. Its
 *     fix here is therefore INERT until #1286 lands and live the moment it
 *     does. It is fixed in the same change because the two exits are the same
 *     defect, and leaving one behind is how a closed harm gets re-opened by a
 *     neighbouring PR (CLAUDE.md trap 21).
 *
 * WHAT THIS SUITE BINDS TO, AND WHY IT IS NOT A PROSE SUBSTRING (trap 19):
 * every positive case asserts the EXACT string the real producer
 * `buildHeldLapseNotice` returns for the EXACT hold under test — the copy
 * constant is imported from commit.ts, never re-typed here, so a change to the
 * copy moves this suite with it instead of silently decoupling from it.
 *
 * THE DISCRIMINATING TWIN IS MANDATORY, and it is the half that makes the
 * positive cases mean anything: `commitDirectAnswer` returns the SAME OBJECT
 * on its untouched fast path (documented at commit.ts's return site). A
 * dispatcher that unconditionally emitted a notice would pass every positive
 * case above — an always-on notice is no notice. The twins assert BOTH that no
 * lapse copy appears AND that the returned object is REFERENTIALLY the composed
 * one, so a fix that rebuilt an equivalent object would still be visible.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { setTestSink, log } from '../../../utils/telemetry.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';

const {
  commitDirectAnswerMock,
  priorPendingsMock,
  loadScenarioSnapshotForRunAnalysisMock,
  enrichRunAnalysisMock,
  handlerFnMock,
  createRegistryMock,
} = vi.hoisted(() => ({
  commitDirectAnswerMock: vi.fn(),
  priorPendingsMock: vi.fn(),
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  handlerFnMock: vi.fn(),
  createRegistryMock: vi.fn(),
}));

// `importActual` spread deliberately (CLAUDE.md trap 12 — a `vi.mock` factory
// REPLACES the module, so a hand-listed export set silently loses every export
// added since it was written). It also gives this suite the REAL
// `buildHeldLapseNotice`, which is what the positive assertions bind to.
vi.mock('../../commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../commit.js')>('../../commit.js');
  return { ...actual, commitDirectAnswer: commitDirectAnswerMock };
});

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'Run analysis' }],
      session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      request_id: 'req-committed-copy',
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
    loadMostRecentPendingActionsIntegrityStrict: priorPendingsMock,
    loadMostRecentPendingActions: priorPendingsMock,
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
    // An INJECTED registry must win — the recovery cases pass their own
    // throwing registry, and a blanket `handlerFnMock` would silently route
    // them down the SUCCESS path instead (they would then fail on the
    // outcome, not on the copy, which is a probe defect rather than evidence).
    resolveHandler: (registry: unknown, id: string) =>
      registry instanceof Map && registry.has(id)
        ? (registry.get(id) as unknown)
        : id === 'run_analysis'
          ? handlerFnMock
          : undefined,
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';
import { buildHeldLapseNotice } from '../../commit.js';
import { type HandlerFn, type HandlerRegistry } from '../../tools/registry.js';
import { HandlerInvocationFailedError } from '../../tools/handler-errors.js';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

/**
 * The lapsing hold every positive case is written about. `expires_at_turn_count:
 * 1` is the state the carry-forward decrement takes to zero at THIS commit —
 * the only place a consent lapse is observable (commit.ts's own field doc).
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
 * and a reviewer can see that the expectation is the producer's semantics
 * rather than this author's reading of them (CLAUDE.md trap 13c).
 */
const EXPECTED_NOTICE = buildHeldLapseNotice(LAPSING_HOLD);

/**
 * Faithful stand-in for the commit chokepoint's DOCUMENTED contract, in both
 * of its two states:
 *
 *   - `lapse: true`  — the carry-forward retired a consent hold, so the seam
 *     appends the notice to the response it persists and returns THAT amended
 *     object (commit.ts ~:1243-1250, using the same blank-line join).
 *   - `lapse: false` — nothing fired, so the seam returns the SAME OBJECT it
 *     was handed (commit.ts's return-site docblock: "the SAME object as the
 *     input on the untouched fast path").
 *
 * The mock records the object it was given so the twins can assert referential
 * identity rather than deep equality.
 */
function installCommitSeam(opts: { lapse: boolean }): { committedInput: () => unknown } {
  let seen: unknown = undefined;
  commitDirectAnswerMock.mockImplementation(async (response: Record<string, unknown>) => {
    seen = response;
    const base = typeof response.assistant_text === 'string' ? response.assistant_text : '';
    return {
      response: opts.lapse
        ? {
            ...response,
            assistant_text: base.trim().length > 0 ? `${base}\n\n${EXPECTED_NOTICE}` : EXPECTED_NOTICE,
          }
        : response,
      performed: true,
      persisted_row_id: 'row-committed-copy',
      graphPersisted: false,
      persistedAnalysisGraphHash: null,
      persistedGraph: null,
      modelVersionReceipt: null,
      pendingLifecycle: { priorCount: 1, survivedCount: 0, capDroppedCount: 0 },
    };
  });
  return { committedInput: () => seen };
}

// ─── SUCCESS-EXIT fixtures ────────────────────────────────────────────────
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

// ─── RECOVERY-EXIT fixtures ───────────────────────────────────────────────
/** Injected registry whose run_analysis handler throws the recoverable cause. */
function registryThrowingOptionsNotConfigured(): HandlerRegistry {
  const fn: HandlerFn = () =>
    Promise.reject(
      new HandlerInvocationFailedError('forced options_not_configured', {
        cause_kind: 'options_not_configured',
        retryable: false,
        details: {
          handler_id: 'run_analysis',
          specific_issue: 'simulated',
          first_option_label: 'Aggressive In-House Build',
        },
      }),
    );
  return new Map<V5ActionType, HandlerFn>([['run_analysis', fn]]);
}

let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
let errorSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  setTestSink(() => {});
  priorPendingsMock.mockResolvedValue([LAPSING_HOLD]);
  handlerFnMock.mockResolvedValue(handlerOk());
  enrichRunAnalysisMock.mockImplementation(
    async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
  );
  createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
  loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshotFor(READY_GRAPH));
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setTestSink(null);
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('chip-click run_analysis — the SHIPPED answer is the COMMITTED answer', () => {
  // ─── THE RECOVERY EXIT — the defect that is LIVE ON STAGING ──────────────
  it('RECOVERY exit: a hold that lapsed during the commit is SPOKEN, not just persisted', async () => {
    installCommitSeam({ lapse: true });

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-recovered-lapse',
      handlerRegistry: registryThrowingOptionsNotConfigured(),
    });

    expect(out.outcome).toBe('handler_recovered');
    expect(out.commitPerformed).toBe(true);
    expect(
      out.response.assistant_text ?? '',
      'the commit appended the honest lapse notice to the response it PERSISTED; returning the ' +
        'pre-commit object makes the turn row and the wire disagree about what the user was told, ' +
        "and the user's live proposal dies without a word",
    ).toContain(EXPECTED_NOTICE);
  });

  // ─── THE SUCCESS EXIT — inert until #1286 threads priors, then live ──────
  it('SUCCESS exit: a hold that lapsed during the commit is SPOKEN, not just persisted', async () => {
    installCommitSeam({ lapse: true });

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ok-lapse',
    });

    expect(out.outcome).toBe('ok');
    expect(
      out.response.assistant_text ?? '',
      'the run_analysis SUCCESS exit ships the composed answer and discards the committed one, ' +
        'so the lapse copy the commit chokepoint attached never reaches the user',
    ).toContain(EXPECTED_NOTICE);
  });

  // ─── THE DISCRIMINATING TWINS — an always-on notice is no notice ─────────
  it('TWIN (recovery): nothing lapsed → no lapse copy, and the composed object itself is shipped', async () => {
    const seam = installCommitSeam({ lapse: false });

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-recovered-no-lapse',
      handlerRegistry: registryThrowingOptionsNotConfigured(),
    });

    expect(out.outcome).toBe('handler_recovered');
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

  it('TWIN (success): nothing lapsed → no lapse copy, and the composed object itself is shipped', async () => {
    const seam = installCommitSeam({ lapse: false });

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ok-no-lapse',
    });

    expect(out.outcome).toBe('ok');
    expect(out.response.assistant_text ?? '').not.toContain('has lapsed');
    expect(out.response.assistant_text ?? '').not.toContain(EXPECTED_NOTICE);
    expect(out.response).toBe(seam.committedInput());
  });

  // ─── THE MOCK-SHAPE GUARD ────────────────────────────────────────────────
  // ~100 suites in this repo mock `commitDirectAnswer`, and many return a bare
  // stub with no `response` key at all. A fix that read `committed.response`
  // unguarded would ship `undefined` as the wire body on every one of those
  // paths — a far worse defect than the one being repaired. This pins the
  // fallback so that class of regression cannot land silently.
  it('a commit that returns no response object at all leaves the composed answer intact', async () => {
    commitDirectAnswerMock.mockResolvedValue(undefined);

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ok-bare-stub',
    });

    expect(out.outcome).toBe('ok');
    expect(typeof out.response).toBe('object');
    expect(out.response).not.toBeUndefined();
    expect(out.response.assistant_text ?? '').toContain('Ran analysis');
  });
});
