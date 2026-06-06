/**
 * V5 P0.2 (Seam 1 / PR #236) — flip-proposal EMIT through the REAL
 * `runTurnExecutor`.
 *
 * WHAT THIS CLOSES (the "#236 emit-through-executor integration coverage
 * gap"): PR #236 wired a flip-proposal emit into `turn-executor.ts`
 * (~lines 4571-4615). It fires on a `what_would_flip` EXECUTE turn when:
 *   - the routing result is a `tool_call` with `intent_class === 'execute'`
 *     and the proposed `handler_id === 'what_would_flip'`;
 *   - `currentAnalysisGraphHashForTurn !== null`;
 *   - `context.prior_facts` carries a SUCCESSFUL `run_analysis` fact whose
 *     `result.enrichment.flip_thresholds[]` has an entry with a non-null
 *     `flip_value`.
 * On `status:'emitted'` it PREPENDS a `set_factor_value` proposal chip
 * (label "Test <factor> at <whole-user-scale-value>", `action_type:
 * 'set_factor_value'`, id `prop_<hex>`) to the response's
 * `suggested_actions` and merges a matching `apply_proposed_change` pending
 * into the committed metadata.
 *
 * Until now this emit-through-executor path had NO integration coverage:
 *   - `branch-a-flip-proposal.test.ts` only exercises the harness
 *     ASSERTIONS against SYNTHETIC responses (never the executor).
 *   - `proposed-change-route-level.test.ts` only RESUMEs pre-seeded
 *     `apply_proposed_change` pendings; it never drives a `what_would_flip`
 *     EXECUTE turn that PRODUCES the proposal.
 *
 * WHAT THIS TEST COVERS: it drives a `what_would_flip` EXECUTE turn through
 * the real `runTurnExecutor` (via the deterministic short-confirm resume of
 * a live `what_would_flip` pending — Approach B, the most faithful path to
 * the real HTTP route, which the route-v2 chip-click also takes), and
 * proves the emit fires: the `set_factor_value` "Test Marketing at 15"
 * proposal chip is prepended to `suggested_actions`, the user-scale value
 * is the whole "15", and a matching `apply_proposed_change` pending is
 * committed. The harness's own `assertFlipProposalPresent` confirms the
 * wire-shape contract.
 *
 * WHAT THIS TEST DOES NOT COVER (deliberately, already covered elsewhere):
 *   - The accept/resume side ("do it" → `set_factor_value` executes) is
 *     covered exhaustively by `proposed-change-route-level.test.ts`
 *     ("flip set_factor_value proposal: emit → resume → execute"). A
 *     bonus accept turn is included below as defence-in-depth, but the
 *     emit is the actual gap.
 *   - The pure inversion / round-trip math (flip 0.3 ↔ user-scale 15 at
 *     cap 50) is proven against the real normaliser in
 *     `src/orchestrator-v5/compose/__tests__/flip-proposal.test.ts`.
 *
 * DETERMINISM: no network, no real PLoT/LLM, no real DB. The session store
 * is mocked exactly as the route-level test mocks it; the routing adapter
 * is a throwing stub that MUST NOT be called (the resume is deterministic).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../src/adapters/llm/types.js';
import type { PendingAction } from '../../../src/orchestrator-v5/session/pending-action.js';
import type { HandlerRegistry } from '../../../src/orchestrator-v5/tools/registry.js';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { buildFlipProposalEmit } from '../../../src/orchestrator-v5/compose/flip-proposal.js';
import { getDefaultRegistry } from '../../../src/orchestrator-v5/tools/registry.js';

import {
  assertFlipProposalPresent,
  assertProposalAccepted,
} from '../../../tools/v5-journey-replay/assertions.js';
import { assertSetFactorValuePersisted } from '../../../tools/v5-journey-replay/db-readback.js';

const SCENARIO_ID = randomUUID();
const EMITTED_AT_ISO = '2026-05-07T11:00:00.000Z';

// Flip-fixture math (matches the route-level test's flip resume case):
// `fac-marketing` has cap 50. The flip producer computes
// `rawInput = flip_value * cap` for capped factors and only emits when the
// result is a WHOLE integer. flip_value 0.3 → 0.3 * 50 = 15 → renders as a
// whole "15". The emitted chip label is therefore "Test Marketing at 15".
const FLIP_FACTOR_ID = 'fac-marketing';
const FLIP_FACTOR_LABEL = 'Marketing';
const FLIP_VALUE = 0.3;
const FACTOR_CAP = 50;
const EXPECTED_USER_SCALE_VALUE = 15;

/**
 * Strict GraphV3 fixture (copied from `proposed-change-route-level.test.ts`):
 * one option, one goal, and a `fac-marketing` factor with
 * `observed_state: { value: 0.1, raw_value: 5, cap: 50 }` so the flip
 * producer's node lookup resolves cap 50 for the model→user inversion.
 */
const STRICT_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Option A' },
    { id: 'goal-g', kind: 'goal', label: 'Goal' },
    {
      id: FLIP_FACTOR_ID,
      kind: 'factor',
      label: FLIP_FACTOR_LABEL,
      observed_state: { value: 0.1, raw_value: 5, cap: FACTOR_CAP },
    },
  ],
  edges: [],
};
// Sanity-check at module load: the fixture MUST pass GraphV3 strict parsing
// — otherwise the test silently exercises the structural-fallback path.
{
  const parsed = GraphV3.safeParse(STRICT_GRAPH);
  if (!parsed.success) {
    throw new Error(
      'Emit-through-executor test fixture failed GraphV3.safeParse — fix STRICT_GRAPH. Issues: ' +
        JSON.stringify(parsed.error.issues),
    );
  }
}
const MINIMAL_GRAPH = STRICT_GRAPH as unknown as Parameters<
  typeof computeAnalysisAffectingGraphHash
>[0];
const GRAPH_HASH = computeAnalysisAffectingGraphHash(MINIMAL_GRAPH) ?? 'h_unset';

let pendingActionsForRead: readonly PendingAction[] = [];
let priorTurnsForRead: ReadonlyArray<Record<string, unknown>> = [];
let priorFactsForRead: ReadonlyArray<Record<string, unknown>> = [];
const appendCalls: Array<Record<string, unknown>> = [];
const setFactorCalls: Array<Record<string, unknown>> = [];

/**
 * A minimal prior `SessionTurn`. `buildTurnContext` only loads `prior_facts`
 * when `readRecent` returns at least one turn with a non-empty `id` — the
 * fact loader gates on `priorTurns.length === 0` / `priorTurnRowIds.length
 * === 0` (build-turn-context.ts:690-691) BEFORE calling `readFactsWithTurnFor`.
 * Without a prior turn the run_analysis fact never reaches `context.prior_facts`,
 * freshness derives `'none'`, and the what_would_flip resume downgrades to a
 * rerun-analysis recovery instead of dispatching the handler. Shape copied
 * from `build-turn-context.test.ts::makeSessionTurn`.
 */
function priorTurn(): Record<string, unknown> {
  return {
    id: `row-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    user_id: null,
    turn_id: `t-prior-${randomUUID()}`,
    turn_class: 'handler',
    handler_id: 'run_analysis',
    request_hash: 'sha256:prior',
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 123,
    created_at: '2026-05-07T10:00:00.000Z',
  };
}

/**
 * The `enrichment.flip_thresholds[]` payload both the prior run_analysis
 * fact and the bonus test's real producer call read. One single-factor
 * entry with a non-null `flip_value` — the producer's emit precondition.
 */
function flipEnrichment(): Record<string, unknown> {
  return {
    flip_thresholds: [
      {
        factor_id: FLIP_FACTOR_ID,
        factor_label: FLIP_FACTOR_LABEL,
        flip_value: FLIP_VALUE,
        direction: 'increase',
        unit: null,
      },
    ],
  };
}

/**
 * A SUCCESSFUL `run_analysis` fact, shaped per `viewRunAnalysisFact` /
 * `isSuccessfulRunAnalysisFact` (src/orchestrator-v5/context/freshness.ts:
 * 168-216): `fact_type:'run_analysis'`, `noop:false`, and a
 * `result.graph_hash_at_run` that equals the live turn hash so freshness
 * derives `'fresh'` (freshness.ts:420-429 graph_hash_match). The emit reads
 * `result.enrichment.flip_thresholds[]` (turn-executor.ts:4582-4595 via
 * `selectRunAnalysisFact`) for the single-factor flip entry.
 *
 * `analysis_status` is omitted ⇒ `readAnalysisStatus` returns null ⇒
 * treated as a legacy success (freshness.ts:214). `flip_thresholds` carries
 * the non-null `flip_value` the producer needs.
 */
function successfulRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      target_id: 'opt-a',
      status: 'applied',
      graph_hash_at_run: GRAPH_HASH,
      computed_at: '2026-05-07T10:00:00.000Z',
      enrichment: flipEnrichment(),
    },
  };
}

/**
 * A live, resumable `what_would_flip` pending action. The short-confirm
 * resumer (deterministic-short-confirm.ts) accepts `what_would_flip` as a
 * RESUMABLE_KIND and, when analysis freshness is `'fresh'`, dispatches it
 * via `tryShortConfirmResume`. The turn-executor then synthesises
 * `routingResult = { type:'tool_call', proposal:{ intent_class:'execute',
 * action:{ handler_id:'what_would_flip', ... } } }`
 * (turn-executor.ts:1311-1348), which reaches the emit block.
 */
function whatWouldFlipPending(): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_action_what_would_flip',
    action: { kind: 'what_would_flip' },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: EMITTED_AT_ISO,
  };
}

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => priorTurnsForRead,
    readFactsFor: async () => priorFactsForRead,
    readFactsWithTurnFor: async () =>
      priorFactsForRead.map((fact, idx) => ({
        fact,
        turn_id: `turn-${idx}`,
        fact_created_at: '2026-05-08T00:00:00.000Z',
      })),
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => MINIMAL_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: MINIMAL_GRAPH, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../../../src/orchestrator-v5/turn-executor.js');

/** Build a `MessageTurnPayload`-shaped payload for `runTurnExecutor`. */
function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

/** Routing adapter that MUST NOT be called — the resume is deterministic. */
function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when the flip resume matches');
      }),
  };
}

/**
 * Registry with a `what_would_flip` STUB (so the EXECUTE turn dispatches a
 * handler without real PLoT/LLM) and a `set_factor_value` recording stub
 * (used only by the bonus accept turn). The `what_would_flip` stub returns
 * the canonical no-op explanation fact shape
 * (src/orchestrator-v5/tools/handlers/what-would-flip.ts:117-131); the emit
 * reads the PRIOR run_analysis fact for the flip entry, not the handler's
 * own fact, so the stub's fact body is intentionally minimal.
 */
function stubbedRegistry(): HandlerRegistry {
  const whatWouldFlipStub = async () => ({
    assistant_text: 'Here is what would change the result.',
    handler_facts: [
      {
        fact_type: 'what_would_flip' as const,
        fact_version: 1,
        noop: true,
        result: {
          precondition_unmet: false,
          option_count: 1,
          answer_source: 'deterministic_fallback' as const,
          fallback_reason: null,
          answer_text_length: 41,
          staleness_prefixed: false,
        },
      },
    ],
    llm_calls_used: 0,
    suppress_orientation: true,
  });
  // Copied from `proposed-change-route-level.test.ts` — records the resumed
  // ProposalAction and returns a canonical applied set_factor_value fact so
  // the bonus accept turn's commit pipeline completes.
  const setFactorValueStub = async (invocation: { proposal?: unknown }) => {
    setFactorCalls.push({ proposal: invocation.proposal });
    return {
      assistant_text: 'Updated Marketing.',
      handler_facts: [
        {
          fact_type: 'set_factor_value' as const,
          fact_version: 1,
          noop: false,
          result: {
            target_id: FLIP_FACTOR_ID,
            status: 'applied' as const,
            before: { value: 0.1, raw_value: 5 },
            after: { value: 0.3, raw_value: EXPECTED_USER_SCALE_VALUE },
          },
        },
      ],
      llm_calls_used: 0,
    };
  };
  return new Map([
    ['what_would_flip', whatWouldFlipStub as unknown as ReturnType<HandlerRegistry['get']>],
    ['set_factor_value', setFactorValueStub as unknown as ReturnType<HandlerRegistry['get']>],
  ]) as unknown as HandlerRegistry;
}

describe('Branch A (PR #236) — flip-proposal EMIT through the real runTurnExecutor', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    setFactorCalls.length = 0;
    pendingActionsForRead = [whatWouldFlipPending()];
    priorTurnsForRead = [priorTurn()];
    priorFactsForRead = [successfulRunAnalysisFact()];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('a what_would_flip EXECUTE turn emits the "Test Marketing at 15" set_factor_value proposal chip + commits the apply_proposed_change pending', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('do it'), 'req-flip-emit', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });

    // The turn ran deterministically through the real executor: no LLM, the
    // what_would_flip handler dispatched, the validator accepted the
    // synthesised execute proposal.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.validation_error_code).toBeNull();
    expect(result.telemetry.stages_completed).toContain('execute');

    // --- EMIT assertion (the coverage gap) -------------------------------
    // Wrap the executor's suggested_actions as a FetchResult and run the
    // harness's own Branch A assertion. This proves the wire-shape contract
    // PR #236 promises (set_factor_value proposal chip, whole user-scale
    // value) fires through the REAL executor, not a synthetic fixture.
    const suggested_actions = result.response.suggested_actions ?? [];
    const emitAssertion = assertFlipProposalPresent({
      status: 200,
      body: { suggested_actions },
      elapsed_ms: 0,
    });
    expect(emitAssertion.ok).toBe(true);
    expect(emitAssertion.evidence).toContain(
      `user_scale_value=${EXPECTED_USER_SCALE_VALUE}`,
    );

    // Direct chip-shape checks (defence-in-depth alongside the harness
    // assertion): the prepended chip is a set_factor_value proposal whose
    // label carries the whole user-scale "15".
    const proposalChip = suggested_actions.find((c) => c.action_type === 'set_factor_value');
    expect(proposalChip).toBeDefined();
    expect(proposalChip!.id.startsWith('prop_')).toBe(true);
    expect(proposalChip!.label).toBe(`Test ${FLIP_FACTOR_LABEL} at ${EXPECTED_USER_SCALE_VALUE}`);

    // --- Committed pending assertion -------------------------------------
    // A matching apply_proposed_change pending was merged into the commit
    // metadata (turn-executor.ts:4992 `pendingForCommit`).
    expect(appendCalls).toHaveLength(1);
    const committedPendings = (
      appendCalls[0] as {
        pending_actions?: ReadonlyArray<{
          chip_id: string;
          action: { kind: string; inline_patch?: { handler_id?: string } };
        }>;
      }
    ).pending_actions;
    expect(committedPendings).toBeDefined();
    const applyPending = committedPendings!.find(
      (p) => p.action.kind === 'apply_proposed_change',
    );
    expect(applyPending).toBeDefined();
    // The pending mirrors the chip id (the proposal_ref bridge) and targets
    // the set_factor_value handler.
    expect(applyPending!.chip_id).toBe(proposalChip!.id);
    expect(applyPending!.action.inline_patch?.handler_id).toBe('set_factor_value');
  });

  // --- BONUS: accept turn (already covered by proposed-change-route-level;
  // included here as defence-in-depth on the full emit→accept loop) --------
  it('BONUS: accepting the emitted proposal resumes set_factor_value and persists the applied mutation', async () => {
    // Seed the next turn with the apply_proposed_change pending the producer
    // would have emitted (built by the REAL producer, exactly as
    // proposed-change-route-level.test.ts does), then drive a bare confirm.
    const emit = buildFlipProposalEmit(
      flipEnrichment(),
      (id) => (id === FLIP_FACTOR_ID ? { cap: FACTOR_CAP, unit: null } : undefined),
      {
        scenario_id: SCENARIO_ID,
        graph_hash: GRAPH_HASH,
        emitted_at_iso: EMITTED_AT_ISO,
        registry: getDefaultRegistry(),
      },
    );
    if (emit.status !== 'emitted') {
      throw new Error(`expected the real producer to emit, got ${emit.status}`);
    }
    pendingActionsForRead = [{ ...emit.pending, expires_at_iso: '2099-12-31T23:59:59.000Z' }];

    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('make that update'), 'req-flip-accept', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });

    // The set_factor_value handler dispatched exactly once.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(setFactorCalls).toHaveLength(1);

    // The accept response acknowledges the applied mutation (harness gate).
    const acceptAssertion = assertProposalAccepted({
      status: 200,
      body: { assistant_text: result.response.assistant_text },
      elapsed_ms: 0,
    });
    expect(acceptAssertion.ok).toBe(true);

    // The ACTUAL persisted set_factor_value fact (read back from the commit
    // metadata, not a hand-rolled duplicate) passes the DB read-back
    // contract — the same pure assertion the live `--db-readback` path runs.
    expect(appendCalls).toHaveLength(1);
    const committedFacts = (
      appendCalls[0] as {
        handler_facts?: ReadonlyArray<{
          fact_type?: string;
          noop?: boolean;
          result?: { status?: string; target_id?: string; before?: unknown; after?: unknown };
        }>;
      }
    ).handler_facts;
    expect(committedFacts).toBeDefined();
    const persistedSetFactorFact = committedFacts!.find(
      (f) => f.fact_type === 'set_factor_value',
    );
    expect(persistedSetFactorFact).toBeDefined();
    const dbAssertion = assertSetFactorValuePersisted(
      [
        {
          action_type: 'set_factor_value',
          noop: persistedSetFactorFact!.noop ?? false,
          result: persistedSetFactorFact!.result,
        },
      ],
      { validTargetIds: [FLIP_FACTOR_ID] },
    );
    expect(dbAssertion.ok).toBe(true);
  });
});
