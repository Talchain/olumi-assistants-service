/**
 * V5 `run_analysis` handler (slice C2) — first real handler on the C1 spine.
 *
 * Responsibility (F.6 ownership, locked at brief level):
 *   - Parse `RunAnalysisArgs` from the turn payload
 *   - Load a `RunAnalysisScenarioSnapshot` via the injected `ScenarioReader`
 *   - Build a PLoT-allowlisted payload (allowlist enforced upstream by
 *     PLoTClient.run → validateRunPayload)
 *   - Invoke PLoT via the existing client (no new HTTP path)
 *   - Wrap PLoT failures as `HandlerInvocationFailedError`
 *   - Build a `RunAnalysisHandlerFact` per Resolution 2 (enrichment escape
 *     hatch): minimal required result fields extracted; full validated PLoT
 *     response passed through verbatim under `result.enrichment`
 *   - Validate the constructed fact with `RunAnalysisHandlerFactSchema` and
 *     throw `HandlerResultInvalidError` on parse failure
 *   - Return `HandlerOutcome` with a factual `assistant_text` from the
 *     locked template enum, the fact, and `llm_calls_used: 0`
 *
 * Forbidden (per brief §2 ownership contract, grep-enforced in D9):
 *   - No LLM call inside this handler (the classifier ran upstream; narrate is
 *     post-handler and C2 skips it per Resolution 3)
 *   - No numeric interpretation of PLoT results in `assistant_text`
 *   - No recommendation language in `assistant_text`
 *   - No math/statistical helpers applied to result fields (grepped in D9:
 *     zero occurrences of `.toFixed`, `Math.round`, `Number(` on response
 *     fields, `parseFloat(`, `lodash/round`, `d3`, `simple-statistics`)
 *   - No graph mutation
 *   - No direct PLoT HTTP calls (all traffic through PLoTClient)
 *
 * AbortSignal chain (registry.ts JSDoc):
 *   invocation.signal (outer turn-budget) → plotClient.run({turnSignal}) →
 *   PLoTClient's retry/timeout wrapper. The outer abort always wins per
 *   Paul's constraint 7; turn-executor's outer catch checks
 *   `turnAbort.signal.aborted` BEFORE mapping handler errors, so
 *   BUDGET_EXCEEDED precedes HANDLER_INVOCATION_FAILED when both apply.
 *
 * Dependency injection: `createRunAnalysisHandler(deps)` returns a
 * `HandlerFn`. Production registration in registry.ts supplies the real
 * `PLoTClient` and a production `ScenarioReader`. Tests inject mocks. This
 * keeps the handler pure and the test surface small.
 */

import { RunAnalysisArgsSchema, RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type {
  RunAnalysisArgs,
  RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { PLoTError, PLoTTimeoutError } from '../../../orchestrator/plot-client.js';

import { getHandlerBudgetMs } from '../../budgets.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { collectInterventionControlledFactorIds } from '../../context/intervention-controlled-drivers.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import type {
  HandlerFn,
  HandlerInvocation,
  HandlerOutcome,
} from '../registry.js';
import {
  HandlerInvocationFailedError,
  HandlerResultInvalidError,
} from '../handler-errors.js';
import { emit, log, TelemetryEvents } from '../../../utils/telemetry.js';
import { type RunAnalysisTimings, PLOT_SLOW_LIKELY_MS } from '../../telemetry/turn-timings.js';
import { config } from '../../../config/index.js';
import { hasReducedSamplesDisclosure } from '../../compose/claim-safety-cage.js';

import { findFirstInvalidNumeric } from './numeric-integrity.js';
import { validateEnrichmentShadow } from './enrichment-validation.js';
import { guardAnalysisGraphIntercepts } from './run-analysis-intercept-guard.js';
import { AnalysisNotReadyError } from './analysis-ready-core.js';
import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
} from '../../coaching/analysis-result-headline.js';

// `PLOT_SLOW_LIKELY_MS` lives in the shared `../../telemetry/turn-timings.js`
// module so the turn-executor (error-path reconstruction) can apply the
// same threshold without importing from this handler — the registry-
// isolation pre-push hook forbids cross-file handler imports.

// Re-export handler-generic errors for backwards compatibility with test
// modules that imported them directly from run-analysis.js. The canonical
// location is now `../handler-errors.js`; tests that land after this point
// should import from there.
export {
  HandlerInvocationFailedError,
  HandlerResultInvalidError,
  type HandlerInvocationFailedCause,
} from '../handler-errors.js';

// ============================================================================
// Locked assistant_text templates (Refinement R1)
// ============================================================================
//
// Exactly two templates. D7 allowlist test imports this constant; the handler's
// prose output cannot drift from what tests accept. The strings are factual,
// carry no numeric interpretation, and use no recommendation language.

export const RUN_ANALYSIS_ASSISTANT_TEMPLATES = {
  DEFAULT: 'Ran analysis on your current scenario.',
  NO_RESULTS: 'Ran analysis on your current scenario. No options were compared.',
  // V5 alpha hardening Phase 2.3: permissive PLoT status accept.
  // `PARTIAL` fires when PLoT reports `analysis_status: "partial"` with
  // usable result fields present. Factual caveat, no numeric values.
  // `UNKNOWN_STATUS` fires when PLoT reports an unrecognised status but
  // still returns usable result fields — we proceed with a warning caveat.
  // Fatal statuses (`blocked`, `failed`) throw HandlerInvocationFailedError
  // and never reach the template layer.
  PARTIAL:
    'Ran analysis on your current scenario. Some results may be incomplete — treat with caution.',
  UNKNOWN_STATUS:
    'Ran analysis on your current scenario. The analysis engine reported an unfamiliar status — treat the result with caution.',
  // V5 alpha hardening follow-up: partial status with zero result
  // records. Pre-follow-up this fell through to NO_RESULTS silently,
  // dropping the partial-run caveat. The user needs to know the run
  // was flagged partial AND produced no comparable options so they can
  // distinguish "analysis ran cleanly, nothing to compare" from
  // "analysis was cut short and produced nothing". Contract Part C
  // requires a caveat for partial regardless of record count.
  PARTIAL_NO_RESULTS:
    'Ran analysis on your current scenario. The engine flagged the run as partial and produced no option comparisons — treat with caution.',
  // Seam item 3 (CRITIQUE_BUCKETS ruling): PLoT reported
  // SAMPLES_REDUCED_FOR_COMPLEXITY on an otherwise-ok run. Fires only when
  // the deterministic headline does not (the headline carries the same
  // disclosure as REDUCED_SAMPLES_SUFFIX); replaces DEFAULT only, so the
  // PARTIAL / UNKNOWN_STATUS caution templates are never compounded.
  REDUCED_SAMPLES:
    'Ran analysis on your current scenario. Because this model is complex, the analysis ran fewer simulations than usual, so results may be less precise.',
} as const;

// ============================================================================
// Lane 28 — brief pipeline: outbound brief wire bound
// ============================================================================

/**
 * Hard bound for the outbound `brief` field on the PLoT /v2/run payload.
 *
 * PLoT's run schema declares `brief: { type: 'string', maxLength: 10000 }`
 * and allowlists the key (plot-lite-service src/routes/v2/run.ts —
 * V2_RUN_ALLOWED_KEYS + the schema literal), rejecting anything longer. The
 * write side already caps `scenarios.brief_text` at 8000 chars (DB CHECK,
 * see session/normalise-brief-text.ts), which sits UNDER this wire max — so
 * a legitimately persisted brief is never touched and this bound is pure
 * defence-in-depth against a constraint drift. When it does fire, the
 * truncation is DISCLOSED via a warn log (never a silent slice).
 */
export const PLOT_BRIEF_MAX_CHARS = 10_000;

// ============================================================================
// ScenarioReader — dependency injection seam for reading scenario state
// ============================================================================

/**
 * A minimal snapshot of scenario state the handler needs to build a valid
 * PLoT run payload. Fields mirror the V4 ConversationContext subset that
 * `handleRunAnalysis` consumes plus PLoT's required payload shape.
 *
 * The handler does NOT interpret these fields beyond passing them to PLoT.
 * The reader produces them; PLoT consumes them; the handler is the conduit.
 */
export interface RunAnalysisScenarioSnapshot {
  /** The current graph (PLoT consumes as-is). */
  readonly graph: unknown;
  /** PLoT-shape options: each with {id, option_id, label, interventions{}}. */
  readonly options: ReadonlyArray<Record<string, unknown>>;
  /** Goal node id — required by PLoT. */
  readonly goal_node_id: string;
  /** Optional seed passed through to PLoT if present. */
  readonly seed?: number;
  /** Optional sample count passed through to PLoT if present. */
  readonly n_samples?: number;
  /** PLoT's `goal_constraints` field (not called `constraints`). */
  readonly goal_constraints?: unknown;
  /**
   * V5 state-trust: raw persisted graph BEFORE any parse, so the
   * freshness hash matches what turn-executor sees on follow-up
   * explain turns. Optional for backwards compat with test snapshots
   * built without it; production snapshots from
   * loadScenarioSnapshotForRunAnalysis always populate it.
   */
  readonly rawPersistedGraph?: unknown;
  /**
   * Lane 28 — brief pipeline: the persisted `scenarios.brief_text` for this
   * scenario, loaded by `loadScenarioSnapshotForRunAnalysis` in the same
   * round trip as the graph. Omitted when no brief has been persisted (or
   * the persisted value coerced to null). Forwarded to PLoT as the
   * top-level `brief` field ONLY behind `config.cee.sendBriefToPlot`
   * (default OFF — doctrine ask D5, brief-to-PLoT privacy, is Paul-gated).
   */
  readonly briefText?: string;
  /**
   * #343 CEE half — adopt-on-empty marker. True ONLY when the persisted
   * `scenarios.graph` was GENUINELY null and the reader adopted the
   * request-supplied ingress graph (after the full readiness core passed).
   * `rawPersistedGraph` then carries the canonical ADOPTED graph, and the
   * commit seams (chip-click dispatch / TurnExecutor STEP 7) persist it
   * atomically with the turn — behind a commit-time strict re-verify so a
   * concurrent canonical write is never overwritten. Omitted (never false)
   * on every non-adopted load, keeping existing snapshots byte-identical.
   */
  readonly adoptedIngressGraph?: true;
}

/**
 * Reader signature. Takes a scenario id and the outer AbortSignal (so the
 * underlying Supabase read respects turn-budget abort). Returns a snapshot,
 * or throws — the handler catches and re-wraps as
 * `HandlerInvocationFailedError('scenario_read_failed')`.
 *
 * C2 does not ship a default production reader in this module (a real
 * Supabase-backed reader is scope for a later slice that also owns
 * scenarios-table read conventions). Tests inject stubs; production
 * registration in registry.ts supplies whatever default the wider system
 * converges on. This keeps scenario-reading conventions out of C2's
 * ownership contract.
 */
export type ScenarioReader = (
  scenarioId: string,
  signal?: AbortSignal,
  /**
   * #343 CEE half — adopt-on-empty candidate: the request-supplied graph
   * (`invocation.graphForTurn` on the routed path; the boundary
   * `extensions.graphState` on the chip-click pre-load). Readers that
   * support adoption (the production `loadScenarioSnapshotForRunAnalysis`)
   * consult it ONLY when the strict persisted read returns a genuinely-null
   * graph; stub/one-shot readers may ignore it.
   */
  ingressGraph?: unknown,
) => Promise<RunAnalysisScenarioSnapshot>;

// ============================================================================
// Handler factory
// ============================================================================

export interface RunAnalysisHandlerDeps {
  /** PLoT transport. Reuse the existing client via createPLoTClient(). */
  readonly plotClient: PLoTClient;
  /** Scenario state reader — test injects mock, production injects real. */
  readonly scenarioReader: ScenarioReader;
}

/**
 * Build a `HandlerFn` for `run_analysis` with the given dependencies.
 *
 * Returned handler is a pure function modulo its deps — same invocation +
 * same deps → same outcome (modulo PLoT non-determinism, bounded by seed).
 */
export function createRunAnalysisHandler(deps: RunAnalysisHandlerDeps): HandlerFn {
  return async function runAnalysisHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    // --- 1. Parse RunAnalysisArgs -----------------------------------------
    // The classifier does not currently emit `seed` (Resolution 1 defers
    // classifier prompt updates). For C2 we derive `scenario_id` from the
    // turn payload; `seed` is left undefined and PLoT generates one.
    const argsCandidate: Record<string, unknown> = {
      scenario_id: invocation.payload.scenario_id,
    };
    const argsResult = RunAnalysisArgsSchema.safeParse(argsCandidate);
    if (!argsResult.success) {
      throw new HandlerInvocationFailedError(
        'RunAnalysisArgs failed validation',
        {
          cause_kind: 'args_validation_failed',
          retryable: false,
          details: {
            handler_id: 'run_analysis',
            specific_issue: argsResult.error.issues[0]?.message,
          },
          cause: argsResult.error,
        },
      );
    }
    const args: RunAnalysisArgs = argsResult.data;

    // --- 2. Load scenario snapshot ----------------------------------------
    // #343 adopt-on-empty: thread the per-turn ingress graph
    // (`invocation.graphForTurn` — the request graph_state when present) as
    // the adoption candidate. The production reader consults it ONLY when
    // the strict persisted read returns a genuinely-null graph; a present
    // persisted graph always wins (canonical-state doctrine intact).
    let snapshot: RunAnalysisScenarioSnapshot;
    try {
      snapshot = await deps.scenarioReader(
        args.scenario_id,
        invocation.signal,
        invocation.graphForTurn,
      );
    } catch (readError) {
      // EP2 (V5 Edit Safety Core): the read-boundary guard found the persisted
      // graph unrecoverable. Map to a typed RECOVERABLE failure (200 + honest
      // next-step + review chip), NOT the generic retryable scenario_read_failed
      // (which would read as an infra 500). No PLoT call, no run_analysis fact.
      if (readError instanceof AnalysisNotReadyError) {
        const verdict = readError.verdict;
        throw new HandlerInvocationFailedError(
          `Persisted graph is not analysis-ready for ${args.scenario_id}`,
          {
            cause_kind: 'analysis_not_ready',
            retryable: false,
            details: {
              handler_id: 'run_analysis',
              scenario_id: args.scenario_id,
              ...(verdict.reasonCodes[0] !== undefined ? { reason_code: verdict.reasonCodes[0] } : {}),
              ...(verdict.nextStep !== null ? { next_step: verdict.nextStep } : {}),
            },
            cause: readError,
          },
        );
      }
      throw new HandlerInvocationFailedError(
        `Scenario read failed for ${args.scenario_id}`,
        {
          cause_kind: 'scenario_read_failed',
          retryable: true,
          details: {
            handler_id: 'run_analysis',
            scenario_id: args.scenario_id,
          },
          cause: readError,
        },
      );
    }

    // --- 2.5. options_not_configured guard --------------------------------
    // The validator's "no_options_defined" precondition only checks the graph
    // shape. Handler owns the richer check: options exist but none have
    // non-empty interventions. First-option label is the minimal payload the
    // composer needs to produce a specific next-step chip.
    if (snapshot.options.length > 0) {
      const anyConfigured = snapshot.options.some((opt) => {
        const interventions = (opt as { interventions?: unknown }).interventions;
        return (
          interventions !== null &&
          typeof interventions === 'object' &&
          !Array.isArray(interventions) &&
          Object.keys(interventions as Record<string, unknown>).length > 0
        );
      });
      if (!anyConfigured) {
        const firstLabel = firstOptionLabel(snapshot.options);
        throw new HandlerInvocationFailedError(
          'Options exist but none have configured interventions',
          {
            cause_kind: 'options_not_configured',
            retryable: false,
            details: {
              handler_id: 'run_analysis',
              ...(firstLabel !== null ? { first_option_label: firstLabel } : {}),
              option_count: snapshot.options.length,
            },
          },
        );
      }
    }

    // --- 2.6. Load-time intercept guard (Track S 0.13c-1) -----------------
    // Legacy persisted graphs (drafted before #263 / Track S 0.13a) can carry
    // the duplicate observed-root pattern `intercept === observed_state.value`.
    // ISL evaluates a non-intervened root as `observed_state.value + intercept`,
    // so such a root is analysed at 2x baseline. #263 repairs this on the draft
    // path only; run_analysis loads `scenarios.graph` raw, so we apply the SAME
    // repair to an in-memory CLONE here before PLoT sees the graph. The
    // persisted `scenarios.graph` and `snapshot.rawPersistedGraph` (hashed
    // below for `graph_hash_at_run` / freshness) are deliberately left
    // untouched — this is a runtime guard, not a migration, and must not
    // perturb freshness.
    const graphForAnalysis = guardAnalysisGraphIntercepts(snapshot.graph, {
      requestId: invocation.requestId,
      scenarioId: args.scenario_id,
    }).graph;

    // --- 3. Build PLoT payload (allowlisted fields) -----------------------
    // validateRunPayload inside PLoTClient.run enforces the strict allowlist
    // shape. We only forward fields PLoT accepts. No interpretation, no
    // transformation beyond the 0.13c-1 intercept guard above.
    const plotPayload: Record<string, unknown> = {
      graph: graphForAnalysis,
      options: snapshot.options,
      goal_node_id: snapshot.goal_node_id,
      request_id: invocation.requestId,
    };
    if (snapshot.seed !== undefined) plotPayload.seed = snapshot.seed;
    if (snapshot.n_samples !== undefined) plotPayload.n_samples = snapshot.n_samples;
    if (snapshot.goal_constraints !== undefined) {
      plotPayload.goal_constraints = snapshot.goal_constraints;
    }
    // Lane 28 — brief pipeline seam 3: flag-gated brief leg
    // (CEE_SEND_BRIEF_TO_PLOT, default OFF — doctrine ask D5 is Paul-gated;
    // this ships the plumbing dark). PLoT allowlists top-level `brief`
    // (maxLength 10000) and gates its factor-review / M2 legs on
    // `!!body.brief`. Rules:
    //   - flag OFF → no `brief` key ever (wire byte-identical to today);
    //   - no / whitespace-only persisted brief → no `brief` key (never an
    //     empty string, so PLoT's `no_brief` skip stays honest);
    //   - over PLOT_BRIEF_MAX_CHARS (should be impossible — the DB CHECK
    //     caps at 8000) → bounded with a DISCLOSED warn log, never silent.
    if (config.cee.sendBriefToPlot && typeof snapshot.briefText === 'string') {
      const trimmedBrief = snapshot.briefText.trim();
      if (trimmedBrief.length > 0) {
        if (trimmedBrief.length > PLOT_BRIEF_MAX_CHARS) {
          log.warn(
            {
              request_id: invocation.requestId,
              scenario_id: args.scenario_id,
              brief_chars: trimmedBrief.length,
              bounded_to: PLOT_BRIEF_MAX_CHARS,
            },
            'run_analysis outbound brief exceeds the PLoT wire max — bounded before send (disclosed truncation; investigate how a >8000-char brief was persisted)',
          );
        }
        plotPayload.brief = trimmedBrief.slice(0, PLOT_BRIEF_MAX_CHARS);
      }
    }

    // --- 3.5. Capture freshness metadata BEFORE PLoT call -----------------
    // V5 state-trust: record the analysis-affecting graph hash and the ISO
    // timestamp of the run, so future turns can derive freshness by
    // comparing the recorded hash against the current graph hash. Both
    // fields are CEE-owned and live alongside `enrichment` (NOT inside it
    // — `enrichment` is byte-for-byte PLoT and the handler-ownership
    // invariant forbids derived CEE fields there). Schema 0.10.0+.
    //
    // The hash MUST be computed from the SAME representation turn-
    // executor sees on the next explain turn. snapshot.graph is V3-
    // parsed (top-level options/goal_node_id stripped) AND
    // snapshot.options is the PLoT-projection (numeric interventions,
    // missing target_match/status/raw_interventions). Hashing either
    // would produce a value that differs from what turn-executor
    // computes from the Ingress-parsed persisted graph — false-stale
    // on every explain turn (live regression observed at staging
    // build abc7d29).
    //
    // The single representation both sides agree on: the raw
    // persisted graph as stored in scenarios.graph BEFORE any parse.
    // Run it through GraphStateIngressSchema (the same parser turn-
    // executor uses) so the hash projection sees the same field shape.
    let graphHashAtRun: string | null = null;
    if (
      snapshot.rawPersistedGraph !== undefined &&
      snapshot.rawPersistedGraph !== null
    ) {
      const parsedForHash = GraphStateIngressSchema.safeParse(snapshot.rawPersistedGraph);
      if (parsedForHash.success) {
        graphHashAtRun = computeAnalysisAffectingGraphHash(parsedForHash.data);
      }
    }
    const runComputedAt = new Date().toISOString();

    // --- 4. Invoke PLoT ---------------------------------------------------
    let response: V2RunResponseEnvelope;
    // Fix 4 review fix (round 2): every timing site is gated on the flag.
    // Default-OFF production runs make zero `Date.now()` calls, allocate no
    // RunAnalysisTimings object, and emit no `v5.run_analysis.timings`
    // events; the PLoT outbound HTTP timing is provided to the client only
    // via its existing `turnStartedAt` knob (Date.now() captured once for
    // the budget calculation, which the client uses to compute its own
    // remaining budget — not for observability).
    const timingsEnabled = config.cee.timingDebugEnabled;
    const handlerStartedAt = timingsEnabled ? Date.now() : 0;
    // `plotStartedAt` is passed to plotClient.run as `turnStartedAt` so it
    // can compute its remaining budget — this is a production-required
    // input, NOT an observability timer. Always captured.
    const plotStartedAt = Date.now();
    let plotElapsedMs: number | null = null;
    // When timings are off, both helpers become no-ops; the build helper
    // returns an empty object so callers don't need a second flag check
    // for the error-details enrichment.
    const buildPlotTimings = (statusOverride?: string | null): RunAnalysisTimings => {
      if (!timingsEnabled) return {};
      return {
        handler_total_ms: Date.now() - handlerStartedAt,
        ...(plotElapsedMs !== null ? { plot_request_ms: plotElapsedMs } : {}),
        plot_status:
          statusOverride !== undefined
            ? statusOverride
            : null,
        plot_slow_likely:
          plotElapsedMs === null ? null : plotElapsedMs >= PLOT_SLOW_LIKELY_MS,
      };
    };
    const emitPlotTimings = (timings: RunAnalysisTimings): void => {
      if (!timingsEnabled) return;
      emit(TelemetryEvents.V5RunAnalysisTimings, {
        request_id: invocation.requestId,
        scenario_id: args.scenario_id,
        ...timings,
      });
    };
    try {
      response = await deps.plotClient.run(plotPayload, invocation.requestId, {
        turnSignal: invocation.signal,
        turnStartedAt: plotStartedAt,
        turnBudgetMs: getHandlerBudgetMs(),
      });
      if (timingsEnabled) plotElapsedMs = Date.now() - plotStartedAt;
    } catch (runError) {
      if (timingsEnabled) plotElapsedMs = Date.now() - plotStartedAt;
      // Emit timings on every PLoT-failure exit so dashboards can attribute
      // outage latency — gated so default-OFF production stays silent.
      const failureTimings = buildPlotTimings(null);
      emitPlotTimings(failureTimings);
      // Error details carry both `plot_request_ms` AND `handler_total_ms`
      // (handler-only wall clock) so the executor can reconstruct a
      // RunAnalysisTimings block that is shape-symmetric with the
      // success-path value. Without `handler_total_ms`, the executor's
      // fallback (`Date.now() - turn.startedAt`) inflates the figure with
      // build-context + context-pack + routing time. Both fields are
      // gated on `timingsEnabled`.
      const errorDetailsBase = {
        handler_id: 'run_analysis',
        ...(timingsEnabled && failureTimings.plot_request_ms !== undefined
          ? { plot_request_ms: failureTimings.plot_request_ms }
          : {}),
        ...(timingsEnabled && failureTimings.handler_total_ms !== undefined
          ? { handler_total_ms: failureTimings.handler_total_ms }
          : {}),
        ...(timingsEnabled && failureTimings.plot_slow_likely !== undefined
          ? { plot_slow_likely: failureTimings.plot_slow_likely }
          : {}),
      } as const;
      if (runError instanceof PLoTTimeoutError) {
        throw new HandlerInvocationFailedError(
          'PLoT timed out before returning a response',
          {
            cause_kind: 'plot_timeout',
            retryable: true,
            details: { ...errorDetailsBase },
            cause: runError,
          },
        );
      }
      if (runError instanceof PLoTError) {
        // Demo-readiness recovery: PLoT 422 "preflight validation failed"
        // for an option that does not specify at least one intervention is
        // a recoverable model-readiness failure, NOT a true internal
        // error. The pre-PLoT options_not_configured guard at the top of
        // this handler catches the common case (all options missing
        // interventions), but the PLoT preflight is stricter — it can
        // reject a graph where one option appears configured locally but
        // PLoT's normaliser still rejects it (e.g. interventions that
        // resolve to no usable effect). Route those into the existing
        // recoverable `options_not_configured` cause + composer template
        // so the user sees a typed 200 with the option name + "Configure
        // {option}" chip, NOT a generic 500.
        //
        // The check is narrow: only PLoT 422s carrying a structured
        // V2RunError with a preflight signal (analysis_status
        // === "preflight_validation_failed" OR status_reason includes
        // "preflight validation") AND a critique matching the
        // missing-intervention message. Any other PLoT error falls
        // through to the existing `plot_error` path unchanged — see
        // required behaviour rule #8. (Detailed predicates below.)
        const v2Err = runError.v2RunError;
        if (runError.status === 422 && v2Err) {
          // Scan ALL critique messages (not just the first) — PLoT critique
          // ordering is not contract-guaranteed; the missing-intervention
          // message may appear at any position in a multi-critique 422
          // (round-3 review finding). The first matching critique drives
          // option-label extraction.
          const critiqueMessages: string[] = Array.isArray(v2Err.critiques)
            ? v2Err.critiques
                .map((c) => (typeof c?.message === 'string' ? c.message : null))
                .filter((m): m is string => m !== null)
            : [];
          const statusReason =
            typeof v2Err.status_reason === 'string' ? v2Err.status_reason : null;
          const analysisStatus =
            typeof v2Err.analysis_status === 'string' ? v2Err.analysis_status : null;
          // Pattern match: the preflight rejects an option for missing
          // interventions. Two gates AND'd: preflight signal (via
          // analysis_status OR status_reason) AND missing-intervention
          // wording present in at least one critique. Conservative — we
          // don't absorb other PLoT 422 shapes.
          const isPreflight =
            analysisStatus === 'preflight_validation_failed' ||
            (statusReason ?? '').toLowerCase().includes('preflight validation');
          const missingInterventionCritique = critiqueMessages.find((m) => {
            const lower = m.toLowerCase();
            return (
              lower.includes('does not specify what it changes') ||
              lower.includes('must define at least one intervention')
            );
          });
          const isMissingIntervention = missingInterventionCritique !== undefined;
          if (isPreflight && isMissingIntervention) {
            // Extract the option label from the matching critique. PLoT
            // emits single-quoted labels in the message: "Option 'Foo Bar'
            // does not specify ...". Match conservatively; if extraction
            // fails, surface as the generic options_not_configured (no
            // label branch in the composer handles that cleanly).
            const labelMatch = missingInterventionCritique.match(/Option '([^']+)'/);
            const extractedLabel =
              labelMatch && labelMatch[1] && labelMatch[1].trim().length > 0
                ? labelMatch[1].trim()
                : null;
            throw new HandlerInvocationFailedError(
              'PLoT preflight rejected option for missing interventions',
              {
                cause_kind: 'options_not_configured',
                retryable: false,
                details: {
                  ...errorDetailsBase,
                  ...(extractedLabel !== null ? { first_option_label: extractedLabel } : {}),
                  plot_preflight_recovery: true,
                  analysis_status: analysisStatus ?? undefined,
                },
                cause: runError,
              },
            );
          }
        }
        // Dual-carry (seam item 3): when the PLoTError carries the typed
        // failure envelope, lift the critique codes into details so the
        // composer can key honest copy off them. A failed(200) envelope
        // (plot-client typed-failure carve-out) routes to `analysis_failed`,
        // unifying "PLoT said failed" with the parsed-envelope path — both
        // are fatal, so this is not a recoverability change. 422s keep
        // `plot_error` (the 422→recoverable reroute is War-Room-gated).
        const isTypedFailedEnvelope =
          runError.status !== 422 && v2Err?.analysis_status === 'failed';
        throw new HandlerInvocationFailedError(
          `PLoT returned error: ${runError.message}`,
          {
            cause_kind: isTypedFailedEnvelope ? 'analysis_failed' : 'plot_error',
            retryable: true,
            details: { ...errorDetailsBase, ...extractPlotFailureDetails(v2Err) },
            cause: runError,
          },
        );
      }
      // The PLoT client's outbound validator throws a plain Error with
      // orchestratorError attached (INTERNAL_PAYLOAD_ERROR). Distinguish so
      // telemetry + tests can separate "handler built a bad payload" from
      // "PLoT service error".
      if (
        runError != null &&
        typeof runError === 'object' &&
        'orchestratorError' in runError
      ) {
        const issueMsg = readOrchestratorErrorMessage(runError);
        throw new HandlerInvocationFailedError(
          'PLoT rejected outbound payload as invalid',
          {
            cause_kind: 'plot_payload_invalid',
            retryable: false,
            details: {
              ...errorDetailsBase,
              ...(issueMsg ? { specific_issue: issueMsg } : {}),
            },
            cause: runError,
          },
        );
      }
      throw new HandlerInvocationFailedError(
        'PLoT invocation failed with unknown error',
        {
          cause_kind: 'plot_unknown',
          retryable: true,
          details: { ...errorDetailsBase },
          cause: runError,
        },
      );
    }

    // --- 4.4. Enrichment shadow validation (Context v2 S6, 02 §Seam 3) ---
    // First CEE consumer of AnalysisEnrichmentSchema at the seam where the
    // response later attaches to the fact as `response as Record<string,
    // unknown>` (the untyped passthrough). Mode-gated (default 'off' → no
    // parse); shadow/enforce emit v5.enrichment.schema_mismatch on failure
    // and NEVER touch the turn — enforcement is a later stage behind the
    // 02 §Seam 3 preconditions.
    validateEnrichmentShadow(response as Record<string, unknown>, {
      requestId: invocation.requestId,
      scenarioId: args.scenario_id,
    });

    // --- 4.5. Numeric integrity guard (Phase 2 workstream E) -------------
    // Reject NaN / Infinity / -Infinity in any numeric field anywhere in the
    // PLoT response before downstream consumers (analysis projection, review-
    // card enricher, prose composer, format-analysis-value) see it. Structural
    // walk: every number is checked, so adding a new PLoT field cannot regress
    // the guard. Fail-fast: returns at the first non-finite value found.
    const invalidNumeric = findFirstInvalidNumeric(response);
    if (invalidNumeric !== null) {
      emit(TelemetryEvents.PlotResponseInvalidNumeric, {
        request_id: invocation.requestId,
        session_id: args.scenario_id,
        field_path: invalidNumeric.path,
        value_repr: invalidNumeric.value_repr,
      });
      throw new HandlerInvocationFailedError(
        'PLoT response carries non-finite numeric value',
        {
          cause_kind: 'analysis_failed',
          retryable: true,
          details: {
            handler_id: 'run_analysis',
            specific_issue: 'invalid_numeric',
            invalid_field: invalidNumeric.path,
            invalid_value_repr: invalidNumeric.value_repr,
          },
        },
      );
    }

    // --- 5. Check analysis status (V5 alpha hardening Phase 2.3) ---------
    // Permissive accept matrix per Docs/v5/v5-resilience-contract.md Part C.
    // Grounded against real staging capture at
    // tests/staging/artifacts/cross-service-2026-03-15T23-24-53-476Z/step-2-analysis.json
    // (analysis_status: "computed" with full option_comparison[] — hash
    // 2d2aab36...). Pre-hardening behaviour hard-matched on 'completed' only
    // and rejected 'computed' from real staging as analysis_not_completed.
    const analysisStatus = readAnalysisStatus(response);
    const resultRecords = readResultRecords(response);
    const statusOutcome = evaluateAnalysisStatus(analysisStatus, resultRecords, {
      request_id: invocation.requestId,
    });
    if (statusOutcome.kind === 'fatal') {
      // Fix 4 review fix: emit + attach plot timings on the fatal-status
      // exit too — PLoT responded but its result is unusable, so the
      // round-trip time is the latency-diagnosis signal we want preserved.
      const fatalTimings = buildPlotTimings(
        typeof analysisStatus === 'string' ? analysisStatus : null,
      );
      emitPlotTimings(fatalTimings);
      throw new HandlerInvocationFailedError(statusOutcome.message, {
        cause_kind: statusOutcome.cause_kind,
        retryable: statusOutcome.retryable,
        details: {
          handler_id: 'run_analysis',
          // Dual-carry (seam item 3): parsed failed/blocked envelopes keep
          // their critique codes so the composer can surface honest copy.
          ...extractPlotFailureDetails(response),
          ...(analysisStatus !== null ? { analysis_status: analysisStatus } : {}),
          ...(timingsEnabled && fatalTimings.plot_request_ms !== undefined
            ? { plot_request_ms: fatalTimings.plot_request_ms }
            : {}),
          ...(timingsEnabled && fatalTimings.handler_total_ms !== undefined
            ? { handler_total_ms: fatalTimings.handler_total_ms }
            : {}),
          ...(timingsEnabled && fatalTimings.plot_slow_likely !== undefined
            ? { plot_slow_likely: fatalTimings.plot_slow_likely }
            : {}),
        },
        cause: response,
      });
    }

    // --- 6. Build RunAnalysisHandlerFact (Resolution 2) ------------------
    const winProbabilities = extractWinProbabilities(resultRecords);
    const leadingOptionId = selectLeadingOptionId(resultRecords);
    // Template selection uses the status outcome. Correction 4 of the V5
    // alpha hardening plan: caveats for partial / unknown-status surface
    // through the existing `summary` / `assistant_text` fields only — do
    // NOT extend RunAnalysisHandlerFactSchema.
    const baseTemplate = selectTemplate(statusOutcome.kind, resultRecords.length);
    // Seam item 3: surface PLoT's reduced-samples disclosure. On the
    // template path it replaces DEFAULT only (PARTIAL/UNKNOWN caveats are
    // not compounded); on the headline path it rides as a suffix via
    // `samples_reduced` below. The presence check is cage-owned (claim-safety
    // ruling, Option B) and pinned to this single call site — do not add a
    // second consumer without a fresh claim-safety review.
    const samplesReduced = hasReducedSamplesDisclosure(
      response as Record<string, unknown>,
    );
    const template =
      samplesReduced && baseTemplate === RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT
        ? RUN_ANALYSIS_ASSISTANT_TEMPLATES.REDUCED_SAMPLES
        : baseTemplate;
    // Deterministic headline: when PLoT supplies enough data (winner label +
    // either a top driver, fragility, or a usable win_probability) the
    // headline replaces the bland template. Returns null when data is too
    // thin — handler falls back to the locked template string.
    const headlineStatusKind: 'ok' | 'partial' | 'unknown' =
      statusOutcome.kind === 'ok' || statusOutcome.kind === 'partial' || statusOutcome.kind === 'unknown'
        ? statusOutcome.kind
        : 'ok';
    const headlineInput = {
      enrichment: response as Record<string, unknown>,
      leading_option_id: leadingOptionId ?? '',
      status_kind: headlineStatusKind,
      samples_reduced: samplesReduced,
      // Spine A backstop: the headline reads raw `factor_sensitivity` directly
      // (bypassing projectTopDrivers), so it must skip option-controlled levers.
      // Source the controlled-id set from the RAW persisted graph (covers all
      // intervention locations), falling back to the canonical options array.
      interventionControlledFactorIds: collectInterventionControlledFactorIds(
        snapshot.rawPersistedGraph ?? { options: snapshot.options },
      ),
    };
    const headline = buildAnalysisResultHeadline(headlineInput);
    const summary = headline ?? template;

    // V5 link-safe response floor: when the deterministic headline builder
    // picks Case-E ("{label} currently leads.") because stronger cases
    // (A/B/C/D) did not qualify, emit a metadata-only telemetry event so
    // dashboards can track how often the floor saves users from the bland
    // locked template. Same pure descriptor source as the builder; never
    // includes raw user text, labels, prose, arrays, or nested objects.
    const headlineDescriptor = describeAnalysisHeadline(headlineInput);
    if (headlineDescriptor.case === 'E') {
      emit(TelemetryEvents.V5HeadlineFellBack, {
        request_id: invocation.requestId,
        scenario_id: args.scenario_id,
        reason: headlineDescriptor.reason,
        has_leading_option: headlineDescriptor.has_leading_option,
        has_clean_label: headlineDescriptor.has_clean_label,
        has_driver: headlineDescriptor.has_driver,
        has_fragility: headlineDescriptor.has_fragility,
        margin_bucket: headlineDescriptor.margin_bucket ?? 'unknown',
      });
    }

    const factCandidate: RunAnalysisHandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: args.scenario_id,
        leading_option_id: leadingOptionId,
        // Omit `win_probabilities` entirely when empty to match the optional
        // schema shape (zod strict rejects explicit undefined on optional
        // fields in some builds — safer to conditionally include).
        ...(winProbabilities !== null ? { win_probabilities: winProbabilities } : {}),
        summary,
        // Byte-for-byte pass-through of the validated PLoT envelope. No
        // projection, no stripping, no derived CEE-owned fields. F.6
        // ownership; the handler-ownership invariant enforces this pattern
        // verbatim ("enrichment: response as Record"). Scenario brief for
        // the decision_review auto-fire travels out-of-band via
        // TurnExecutor options; do not reintroduce brief attachment here.
        enrichment: response as Record<string, unknown>,
        // V5 state-trust freshness fields (schema 0.10.0+). Conditionally
        // included to keep parity with the existing optional-field idiom —
        // if the graph was empty (hash null), we omit graph_hash_at_run
        // rather than emitting an empty string.
        ...(graphHashAtRun !== null ? { graph_hash_at_run: graphHashAtRun } : {}),
        computed_at: runComputedAt,
      },
    };

    // --- 7. Zod-validate the fact ----------------------------------------
    const parsed = RunAnalysisHandlerFactSchema.safeParse(factCandidate);
    if (!parsed.success) {
      throw new HandlerResultInvalidError(
        'Constructed RunAnalysisHandlerFact failed schema validation',
        parsed.error,
      );
    }

    // --- 8. Emit HandlerOutcome ------------------------------------------
    // Fix 4 (observability): per-handler PLoT timings travel back to the
    // turn-executor via the typed `__plot_timings` slot on HandlerOutcome
    // (see ../registry.ts). The executor copies the block into the V5 turn
    // timings; it never reaches the wire envelope directly from here. Slow-
    // heuristic uses the PLOT_SLOW_LIKELY_MS threshold (see the constant's
    // doc comment) — the field is reported as `boolean | null` so consumers
    // know when it has been computed and is paired with `plot_request_ms`
    // for downstream dashboards.
    const plotTimings = buildPlotTimings(
      typeof analysisStatus === 'string' ? analysisStatus : null,
    );
    emitPlotTimings(plotTimings);
    // When timingsEnabled=false, `plotTimings` is the empty object and we
    // omit `__plot_timings` entirely so HandlerOutcome carries no debug
    // surface in default-OFF production.
    return {
      assistant_text: summary,
      handler_facts: [parsed.data],
      llm_calls_used: 0,
      ...(timingsEnabled ? { __plot_timings: plotTimings } : {}),
      // #343 adopt-on-empty: when the reader adopted the ingress graph (no
      // persisted model existed), surface the canonical adopted graph so the
      // commit seam persists it atomically with this turn. Internal channel
      // (same pattern as __plot_timings) — DELIBERATELY NOT `mutated_graph`:
      // that channel carries D1 ingress-echo-mutation semantics (persisted-
      // base merge, emitter enumeration pinned by the d1-mutated-graph-
      // emitters invariant), while this is a FIRST write onto a genuinely
      // empty scenarios.graph. Absent on every non-adopted run.
      ...(snapshot.adoptedIngressGraph === true && snapshot.rawPersistedGraph != null
        ? { __adopted_ingress_graph: snapshot.rawPersistedGraph }
        : {}),
    };
  };
}

// ============================================================================
// Result extraction helpers
// ============================================================================

/**
 * Read the `analysis_status` string from a V2RunResponseEnvelope. Returns
 * `null` when absent (happy path PLoT responses may omit it). Interpretation
 * of the value is centralised in `evaluateAnalysisStatus`.
 */
function readAnalysisStatus(response: V2RunResponseEnvelope): string | null {
  const raw = (response as Record<string, unknown>).analysis_status;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return null;
}

/**
 * Dual-carry of PLoT's typed failure codes (seam item 3): safely extract the
 * critique codes / status fields from a V2RunError or a raw PLoT envelope
 * into `plot_*`-prefixed HandlerFailureDetails keys. The composer keys
 * honest, CEE-authored copy off `plot_primary_code`; `plot_user_message` is
 * PLoT-authored prose carried for DIAGNOSTICS ONLY — it must never be
 * rendered (no prose-safety gate exists on this path). Returns {} for
 * shapes with nothing to carry, so unknown-error fallbacks stay unchanged.
 */
function extractPlotFailureDetails(source: unknown): Record<string, unknown> {
  if (source === null || typeof source !== 'object') return {};
  const rec = source as Record<string, unknown>;
  const critiques = Array.isArray(rec.critiques) ? rec.critiques : [];
  const codes = critiques
    .map((c) =>
      c !== null && typeof c === 'object' && typeof (c as Record<string, unknown>).code === 'string'
        ? ((c as Record<string, unknown>).code as string)
        : null,
    )
    .filter((c): c is string => c !== null && c.length > 0);
  const userMessage = critiques
    .map((c) =>
      c !== null && typeof c === 'object' && typeof (c as Record<string, unknown>).user_message === 'string'
        ? ((c as Record<string, unknown>).user_message as string)
        : null,
    )
    .find((m): m is string => m !== null && m.length > 0);
  const statusReason = typeof rec.status_reason === 'string' && rec.status_reason.length > 0
    ? rec.status_reason
    : undefined;
  const analysisStatus = typeof rec.analysis_status === 'string' && rec.analysis_status.length > 0
    ? rec.analysis_status
    : undefined;
  return {
    ...(codes.length > 0 ? { plot_critique_codes: codes, plot_primary_code: codes[0] } : {}),
    ...(userMessage !== undefined ? { plot_user_message: userMessage } : {}),
    ...(statusReason !== undefined ? { plot_status_reason: statusReason } : {}),
    ...(analysisStatus !== undefined ? { plot_analysis_status: analysisStatus } : {}),
  };
}

// ============================================================================
// Permissive status matrix (V5 alpha hardening Phase 2.3)
// ============================================================================

/**
 * Outcome kinds for the permissive status matrix:
 *   - `ok`           null | 'completed' | 'computed'
 *   - `partial`      'partial' — accepted with a caveat template
 *   - `unknown`      unrecognised status string with usable result fields —
 *                    accepted with a distinct caveat template + warning log
 *   - `fatal`        'blocked' | 'failed' | unrecognised with no usable
 *                    fields → HandlerInvocationFailedError
 *
 * Reference: Docs/v5/v5-resilience-contract.md Part C, grounded against the
 * real staging capture at
 * tests/staging/artifacts/cross-service-2026-03-15T23-24-53-476Z/step-2-analysis.json
 */
export type AnalysisStatusOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'partial' }
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'fatal';
      readonly cause_kind: 'analysis_blocked' | 'analysis_failed' | 'analysis_not_completed';
      readonly message: string;
      readonly retryable: boolean;
    };

const OK_STATUSES: ReadonlySet<string> = new Set(['completed', 'computed']);

/**
 * Determine whether result records satisfy the minimum usable-fields
 * contract from Part C: at least one entry carries a string `option_id` or
 * `option_label` AND a finite numeric `win_probability`. Matches the
 * downstream consumer shape in `selectLeadingOptionId` /
 * `extractWinProbabilities`.
 */
function hasUsableResultFields(records: ReadonlyArray<Record<string, unknown>>): boolean {
  if (records.length === 0) return false;
  for (const r of records) {
    const hasLabel =
      (typeof r.option_label === 'string' && r.option_label.length > 0) ||
      (typeof r.option_id === 'string' && r.option_id.length > 0);
    const wp = r.win_probability;
    const hasFiniteProb = typeof wp === 'number' && Number.isFinite(wp);
    if (hasLabel && hasFiniteProb) return true;
  }
  return false;
}

export function evaluateAnalysisStatus(
  status: string | null,
  resultRecords: ReadonlyArray<Record<string, unknown>>,
  ctx: { readonly request_id: string },
): AnalysisStatusOutcome {
  if (status === null || OK_STATUSES.has(status)) {
    return { kind: 'ok' };
  }
  if (status === 'partial') {
    return { kind: 'partial' };
  }
  if (status === 'blocked') {
    return {
      kind: 'fatal',
      cause_kind: 'analysis_blocked',
      message: 'PLoT analysis is blocked for this scenario',
      retryable: false,
    };
  }
  if (status === 'failed') {
    return {
      kind: 'fatal',
      cause_kind: 'analysis_failed',
      message: 'PLoT analysis failed for this scenario',
      retryable: true,
    };
  }
  // Unrecognised status — degraded accept when usable fields are present,
  // fatal when they are not. Emit a warning with enough context to
  // recognise the new status next time, but NO raw response body (security
  // gate: no user decision text in logs).
  if (hasUsableResultFields(resultRecords)) {
    log.warn(
      {
        event: 'external_contract_unknown_status',
        request_id: ctx.request_id,
        handler_id: 'run_analysis',
        analysis_status: status,
      },
      'V5 run_analysis: unfamiliar PLoT status — proceeding with usable results',
    );
    return { kind: 'unknown' };
  }
  log.warn(
    {
      event: 'external_contract_unknown_status',
      request_id: ctx.request_id,
      handler_id: 'run_analysis',
      analysis_status: status,
      usable_fields: false,
    },
    'V5 run_analysis: unfamiliar PLoT status with no usable results — raising fatal',
  );
  return {
    kind: 'fatal',
    cause_kind: 'analysis_not_completed',
    message: `PLoT analysis returned unrecognised status "${status}" with no usable result fields`,
    retryable: true,
  };
}

/**
 * Pick the assistant_text template from `RUN_ANALYSIS_ASSISTANT_TEMPLATES`
 * based on the status outcome + result record count. Partial / unknown-
 * status outcomes surface their caveat through the `summary` and
 * `assistant_text` fields only — the handler fact schema is not extended.
 */
function selectTemplate(
  outcomeKind: 'ok' | 'partial' | 'unknown',
  resultCount: number,
): string {
  // Caveat-bearing outcomes take precedence over the bare NO_RESULTS
  // template — the user needs to know the run was flagged partial /
  // unknown-status regardless of whether any records survived to be
  // compared. Contract Part C: partial REQUIRES a caveat.
  if (outcomeKind === 'partial') {
    return resultCount === 0
      ? RUN_ANALYSIS_ASSISTANT_TEMPLATES.PARTIAL_NO_RESULTS
      : RUN_ANALYSIS_ASSISTANT_TEMPLATES.PARTIAL;
  }
  if (outcomeKind === 'unknown') {
    // Unknown with zero records is a fatal path (see evaluateAnalysisStatus)
    // and does not reach here. Kept for exhaustiveness.
    return RUN_ANALYSIS_ASSISTANT_TEMPLATES.UNKNOWN_STATUS;
  }
  if (resultCount === 0) return RUN_ANALYSIS_ASSISTANT_TEMPLATES.NO_RESULTS;
  return RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT;
}

/**
 * Pull the array of per-option result records from the envelope.
 *
 * MM P1 (ROADMAP 1.25 hygiene batch, item 7 — read-order cleanup): PLoT's
 * actual `/v2/run` wire response emits `option_comparison[]`, NOT
 * `results[]` — verified against `plot-lite-service` `origin/staging`
 * (`3cf5433`) `src/routes/v2/run.ts`, which never sets a top-level
 * `results` key, and against CEE's own `V2RunResponseMinimal` Zod schema
 * (`src/orchestrator/plot-client.ts`), whose comment states this plainly:
 * "PLoT returns option data in `option_comparison` (not `results`)".
 * `results` is accepted there only for defensive tolerance against a
 * hypothetical future/alt shape — it has never actually been observed on
 * the wire. The previous read order checked `results` FIRST (documented
 * here as "canonical", which was the inverse of reality), so in production
 * this always fell through to `option_comparison` anyway; this reorders to
 * match what PLoT actually emits and corrects the stale doc comment.
 * Returns an empty array when neither is populated — that's the
 * NO_RESULTS template branch.
 */
export function readResultRecords(response: V2RunResponseEnvelope): ReadonlyArray<Record<string, unknown>> {
  const envelope = response as Record<string, unknown>;
  const rawComparison = envelope.option_comparison;
  if (Array.isArray(rawComparison) && rawComparison.length > 0) {
    return rawComparison.filter(isRecord) as ReadonlyArray<Record<string, unknown>>;
  }
  const rawResults = envelope.results;
  if (Array.isArray(rawResults) && rawResults.length > 0) {
    return rawResults.filter(isRecord) as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Build the `win_probabilities` map per Resolution 2 §3. Keyed by
 * `option_label` when present, falling back to `option_id`. Skips records
 * that have no usable key or no numeric `win_probability`.
 *
 * Returns `null` when the resulting map would be empty — the handler omits
 * `win_probabilities` entirely in that case rather than emitting an empty
 * object (matches the optional-schema shape cleanly).
 */
function extractWinProbabilities(
  records: ReadonlyArray<Record<string, unknown>>,
): Record<string, number> | null {
  const map: Record<string, number> = {};
  for (const record of records) {
    const key = typeof record.option_label === 'string' && record.option_label.length > 0
      ? record.option_label
      : typeof record.option_id === 'string' && record.option_id.length > 0
        ? record.option_id
        : null;
    if (key === null) continue;
    const prob = record.win_probability;
    if (typeof prob !== 'number' || !Number.isFinite(prob)) continue;
    map[key] = prob;
  }
  return Object.keys(map).length > 0 ? map : null;
}

/**
 * Pick the leading option per Refinement R2 (Paul 2026-04-18). Returns
 * `null` whenever there is no unambiguous leader — NEVER interprets a tie
 * as "roughly leader". See Docs/v5/slice-c2-schemas-audit.md §3.1 for the
 * full rule matrix.
 */
function selectLeadingOptionId(
  records: ReadonlyArray<Record<string, unknown>>,
): string | null {
  if (records.length === 0) return null;

  // Single result: that's the leader regardless of win_probability value
  // (presence wins over magnitude — zero-probability single options still
  // classify as "the leading option" because there's no alternative).
  if (records.length === 1) {
    return extractOptionId(records[0]);
  }

  // Multiple results: find the strictly maximum win_probability. If any
  // record is missing a numeric probability, we cannot compute — return
  // null (matches Resolution 2 §3.1 "missing probability → null").
  const probabilities: Array<{ id: string | null; prob: number }> = [];
  for (const record of records) {
    const prob = record.win_probability;
    if (typeof prob !== 'number' || !Number.isFinite(prob)) return null;
    probabilities.push({ id: extractOptionId(record), prob });
  }

  let maxProb = -Infinity;
  for (const entry of probabilities) {
    if (entry.prob > maxProb) maxProb = entry.prob;
  }
  const leaders = probabilities.filter((p) => p.prob === maxProb);
  if (leaders.length !== 1) return null; // tie → no interpretation
  return leaders[0].id;
}

function extractOptionId(record: Record<string, unknown>): string | null {
  if (typeof record.option_id === 'string' && record.option_id.length > 0) {
    return record.option_id;
  }
  if (typeof record.option_label === 'string' && record.option_label.length > 0) {
    return record.option_label;
  }
  return null;
}

/**
 * Read the `label` field from the first snapshot option record, when
 * present. The handler only uses this for the options_not_configured
 * composer payload; a null value still produces a coherent (if generic)
 * user-facing message.
 */
function firstOptionLabel(
  options: ReadonlyArray<Record<string, unknown>>,
): string | null {
  const first = options[0];
  if (!first) return null;
  const label = first.label;
  return typeof label === 'string' && label.trim().length > 0 ? label.trim() : null;
}

/**
 * Extract a user-safe description string from the PLoT client's
 * orchestratorError-bearing payload-validator error. The surface area is
 * small: the field is a plain Error-like object with a string `.message`.
 * We never forward structured payloads to the user.
 */
function readOrchestratorErrorMessage(runError: unknown): string | null {
  if (runError === null || typeof runError !== 'object') return null;
  const record = runError as Record<string, unknown>;
  const orch = record.orchestratorError;
  if (orch === null || typeof orch !== 'object') return null;
  const message = (orch as Record<string, unknown>).message;
  return typeof message === 'string' && message.trim().length > 0 ? message : null;
}
