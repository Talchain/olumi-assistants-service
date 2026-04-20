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
import type {
  HandlerFn,
  HandlerInvocation,
  HandlerOutcome,
} from '../registry.js';
import {
  HandlerInvocationFailedError,
  HandlerResultInvalidError,
} from '../handler-errors.js';

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
} as const;

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
  /** Goal node id, required by PLoT. */
  readonly goal_node_id: string;
  /** Optional seed passed through to PLoT if present. */
  readonly seed?: number;
  /** Optional sample count passed through to PLoT if present. */
  readonly n_samples?: number;
  /** PLoT's `goal_constraints` field (not called `constraints`). */
  readonly goal_constraints?: unknown;
  /**
   * Scenario brief text. Consumed by the V5 Group 1 decision_review auto-fire
   * (Task B) which invokes the decision_review LLM with the brief as input.
   * Null when the scenario has no brief populated; decision_review skips in
   * that case and run_analysis still succeeds with thin content. Production
   * ScenarioReader should prefer `scenario_snapshots.brief_text` (text) over
   * `scenarios.brief` (jsonb) for a plain-string projection.
   */
  readonly brief?: string | null;
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
    let snapshot: RunAnalysisScenarioSnapshot;
    try {
      snapshot = await deps.scenarioReader(args.scenario_id, invocation.signal);
    } catch (readError) {
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

    // --- 3. Build PLoT payload (allowlisted fields) -----------------------
    // validateRunPayload inside PLoTClient.run enforces the strict allowlist
    // shape. We only forward fields PLoT accepts. No interpretation, no
    // transformation.
    const plotPayload: Record<string, unknown> = {
      graph: snapshot.graph,
      options: snapshot.options,
      goal_node_id: snapshot.goal_node_id,
      request_id: invocation.requestId,
    };
    if (snapshot.seed !== undefined) plotPayload.seed = snapshot.seed;
    if (snapshot.n_samples !== undefined) plotPayload.n_samples = snapshot.n_samples;
    if (snapshot.goal_constraints !== undefined) {
      plotPayload.goal_constraints = snapshot.goal_constraints;
    }

    // --- 4. Invoke PLoT ---------------------------------------------------
    let response: V2RunResponseEnvelope;
    const plotStartedAt = Date.now();
    try {
      response = await deps.plotClient.run(plotPayload, invocation.requestId, {
        turnSignal: invocation.signal,
        turnStartedAt: plotStartedAt,
        turnBudgetMs: getHandlerBudgetMs(),
      });
    } catch (runError) {
      if (runError instanceof PLoTTimeoutError) {
        throw new HandlerInvocationFailedError(
          'PLoT timed out before returning a response',
          {
            cause_kind: 'plot_timeout',
            retryable: true,
            details: { handler_id: 'run_analysis' },
            cause: runError,
          },
        );
      }
      if (runError instanceof PLoTError) {
        throw new HandlerInvocationFailedError(
          `PLoT returned error: ${runError.message}`,
          {
            cause_kind: 'plot_error',
            retryable: true,
            details: { handler_id: 'run_analysis' },
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
              handler_id: 'run_analysis',
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
          details: { handler_id: 'run_analysis' },
          cause: runError,
        },
      );
    }

    // --- 5. Check analysis status ----------------------------------------
    // V4 treats non-completed as a user-visible recovery state; C2 treats
    // it as HANDLER_INVOCATION_FAILED to keep the happy-path fact shape
    // uniform. Later slices may add a dedicated fact variant for blocked
    // analyses; that's out of C2 scope.
    const analysisStatus = readAnalysisStatus(response);
    if (analysisStatus !== null && analysisStatus !== 'completed') {
      throw new HandlerInvocationFailedError(
        `PLoT analysis did not complete: status=${analysisStatus}`,
        {
          cause_kind: 'analysis_not_completed',
          retryable: true,
          details: {
            handler_id: 'run_analysis',
            analysis_status: analysisStatus,
          },
          cause: response,
        },
      );
    }

    // --- 6. Build RunAnalysisHandlerFact (Resolution 2) ------------------
    const resultRecords = readResultRecords(response);
    const winProbabilities = extractWinProbabilities(resultRecords);
    const leadingOptionId = selectLeadingOptionId(resultRecords);
    const template = resultRecords.length === 0
      ? RUN_ANALYSIS_ASSISTANT_TEMPLATES.NO_RESULTS
      : RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT;

    // Attach the scenario brief to enrichment under a V5-specific namespace
    // so the Task B decision_review enricher can read it downstream without
    // re-fetching. Namespaced (`v5.brief`) to avoid collision with PLoT's
    // passthrough keys. Absent when the snapshot had no brief.
    const v5Enrichment: Record<string, unknown> = { ...(response as Record<string, unknown>) };
    if (typeof snapshot.brief === 'string' && snapshot.brief.length > 0) {
      v5Enrichment['v5.brief'] = snapshot.brief;
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
        // fields in some builds; safer to conditionally include).
        ...(winProbabilities !== null ? { win_probabilities: winProbabilities } : {}),
        summary: template,
        // Pass-through of the validated PLoT envelope plus V5-namespaced
        // additions (v5.brief). No projection or stripping of PLoT fields.
        enrichment: v5Enrichment,
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
    return {
      assistant_text: template,
      handler_facts: [parsed.data],
      llm_calls_used: 0,
    };
  };
}

// ============================================================================
// Result extraction helpers
// ============================================================================

/**
 * Read the `analysis_status` string from a V2RunResponseEnvelope. Returns
 * `null` when absent (happy path PLoT responses may omit it). A non-null
 * value that isn't `'completed'` triggers HANDLER_INVOCATION_FAILED.
 */
function readAnalysisStatus(response: V2RunResponseEnvelope): string | null {
  const raw = (response as Record<string, unknown>).analysis_status;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return null;
}

/**
 * Pull the array of per-option result records from the envelope. PLoT
 * returns `results[]` in canonical shape, but some older/alt endpoints emit
 * `option_comparison[]` (see `V2RunResponseMinimal` in plot-client.ts).
 * We accept either; preference is `results` when both are populated
 * (canonical name). Returns an empty array when neither is populated —
 * that's the NO_RESULTS template branch.
 */
function readResultRecords(response: V2RunResponseEnvelope): ReadonlyArray<Record<string, unknown>> {
  const envelope = response as Record<string, unknown>;
  const rawResults = envelope.results;
  if (Array.isArray(rawResults) && rawResults.length > 0) {
    return rawResults.filter(isRecord) as ReadonlyArray<Record<string, unknown>>;
  }
  const rawComparison = envelope.option_comparison;
  if (Array.isArray(rawComparison) && rawComparison.length > 0) {
    return rawComparison.filter(isRecord) as ReadonlyArray<Record<string, unknown>>;
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
