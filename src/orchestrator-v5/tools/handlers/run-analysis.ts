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
import {
  deriveConstraintVerdict,
  readRatifiedConstraints,
  projectClaimSafety,
} from '../../../orchestrator/context/constraint-feasibility.js';
import { buildConstraintDisclosure } from '../../coaching/constraint-gap-disclosure.js';
// ROADMAP 2.579 — the intake axis: did the graph keep every option the brief
// spelled out? Derived here, at the point of the claim, from the two pieces of
// canonical persisted state this handler already holds (`snapshot.briefText`
// and the graph's option labels). Not persisted and not stamped: `enrichment`
// is a byte-for-byte PLoT pass-through by handler-ownership invariant §6, and a
// copy of labels on the fact would be a second thing to drift (trap 12) — the
// sibling `withheld-reason-tail.ts` records the identical decision for the
// ratified constraint labels it names.
import {
  deriveIntakeOptionReconciliation,
  readGraphOptionLabels,
  applyIntakeToLeaderPermission,
} from '../../../orchestrator/context/intake-option-reconciliation.js';
import { buildIntakeOptionDisclosure } from '../../coaching/intake-option-disclosure.js';
import { composeObjectiveContradictionDisclosure } from '../../coaching/objective-contradiction.js';
import type { PLoTClient, V2RunError } from '../../../orchestrator/plot-client.js';
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
// P0 (analysis-500 diagnosis §8 FIX A) — DERIVED from the composer's copy table,
// so a code added there stops tripping the unknown-code wire with nothing else
// to update (trap 12: derive, never mirror).
import { isKnownPlotFailureCode } from '../../compose/handler-failure-responses.js';

import { findFirstInvalidNumeric } from './numeric-integrity.js';
import { validateEnrichmentShadow } from './enrichment-validation.js';
import { guardAnalysisGraphIntercepts } from './run-analysis-intercept-guard.js';
import { AnalysisNotReadyError } from './analysis-ready-core.js';
import {
  gateAnalysableOptions,
  PLOT_MIN_COMPARISON_OPTIONS,
  type ExcludedOptionRecord,
} from './analysable-option-gate.js';
// NOTE the path: `orchestrator-v5/context/`, NOT `orchestrator-v5/coaching/context/`.
import { sanitiseLabel } from '../../context/enrichment-graph-labels.js';
import {
  buildFactorScaleMap,
  projectRequestInterventionsToWireScale,
  summariseConversions,
  summaryIsNoteworthy,
  findScaleIncoherentBaselineFactorIds,
  decideAnalysisScaleBlock,
} from '../plot-intervention-scale.js';
import { isRecommendableOption } from './recommendable-option.js';
import {
  buildAnalysisSubmissionDisclosure,
  partitionScaffoldedByAnalysisPresence,
} from '../../coaching/scaffold-disclosure.js';
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

    // --- 2.55. Analysable-option gate (no-rank ruling, 2026-08-14) ---------
    // Paul's ruling: an unanalysable/placeholder option must NOT be included in
    // comparative ranking or probabilities. It stays visible as a proposed /
    // unanalysed alternative with a clear reason and an action to resolve it.
    //
    // So an option with no interventions is EXCLUDED from this submission
    // entirely — nothing is minted for it, so it cannot reach
    // `option_comparison[]` or `decision_brief.options[]`. The ONE exception is
    // the status quo (`is_baseline`), for which "hold every factor where it is"
    // is not a placeholder but the complete and correct specification of "no
    // change"; that option is HELD and submitted.
    //
    // Supersedes the scaffold-and-rank consequence of D-ask-1 (ROADMAP 2.11
    // P0-1). The scaffold's anti-422 job survives, discharged by exclusion.
    // Never overwrites a configured option or an option with persisted
    // intervention intent; purely an outbound-projection change (the persisted
    // graph, and therefore graph_hash_at_run / freshness, is untouched).
    const gate = gateAnalysableOptions({
      options: snapshot.options,
      graph: snapshot.graph,
      rawPersistedGraph: snapshot.rawPersistedGraph,
      // P1-1 (one scale convention): the egress scale net is UNCONDITIONAL
      // since 2026-07-20 (O-7 wave 2: CEE_PLOT_EGRESS_SCALE_NET_ENABLED
      // deleted) — the gate routes its hold candidates through the same
      // always-on RAW-scale projection as the configured siblings.
      // (`scaleNetEnabled` survives as a pure-function parameter, pinned true
      // at this, its only production call site.)
      scaleNetEnabled: true,
    });
    if (gate.held.length > 0 || gate.excluded.length > 0) {
      emit(TelemetryEvents.V5RunAnalysisOptionsScaffolded, {
        request_id: invocation.requestId,
        scenario_id: args.scenario_id,
        // Redacted: ids + counts only — no labels, no magnitudes.
        scaffolded_option_ids: gate.held.map((s) => s.option_id),
        scaffolded_factor_counts: gate.held.map((s) => s.factor_ids.length),
        excluded_option_ids: gate.excluded.map((s) => s.option_id),
        option_count: snapshot.options.length,
      });
    }

    // --- 2.56. Too few analysable options to compare -----------------------
    // Exclusion can leave a submission PLoT will refuse: its `/v2/run` Ajv
    // request schema declares `options` with `minItems: 2`, and
    // `decision-brief.ts::buildBandedHeadline` returns null below two options
    // ("no comparative claim without a comparison"). So we refuse FIRST, and
    // say why in terms the user can act on — rather than let a 400 surface as
    // an engine fault, or ship a "comparison" of one whose win probability is
    // 1.0 by construction.
    //
    // Gated on `gate.excluded.length > 0` DELIBERATELY: a scenario that always
    // had a single configured option is a pre-existing shape, not this lane's
    // to alter. Its twin is pinned so the distinction cannot drift.
    //
    // `analysis_not_ready` is already in RECOVERABLE_HANDLER_CAUSES and its
    // composer renders `details.next_step` VERBATIM — so this needs no new
    // cause kind and no War-Room gate.
    if (gate.excluded.length > 0 && gate.options.length < PLOT_MIN_COMPARISON_OPTIONS) {
      const excludedLabel = firstUsableExcludedLabel(gate.excluded);
      throw new HandlerInvocationFailedError(
        'Excluding unanalysable options leaves too few to compare',
        {
          cause_kind: 'analysis_not_ready',
          retryable: false,
          details: {
            handler_id: 'run_analysis',
            scenario_id: args.scenario_id,
            reason_code: 'insufficient_analysable_options',
            next_step:
              excludedLabel !== null
                ? `I've left out the options that don't have any values set yet, and that leaves ` +
                  `only one option — which isn't a comparison, so I've stopped rather than show ` +
                  `you a result that just means "it was the only one". Tell me what ` +
                  `'${excludedLabel}' changes and I'll write it into the model, then ask me to ` +
                  `run the analysis again.`
                : `I've left out the options that don't have any values set yet, and that leaves ` +
                  `only one option — which isn't a comparison, so I've stopped rather than show ` +
                  `you a result that just means "it was the only one". Tell me what your other ` +
                  `options change and I'll write them into the model, then ask me to run the ` +
                  `analysis again.`,
          },
        },
      );
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

    // --- 3. ONE request-level scale projection, on the FINAL option set -----
    // ROUND 4: the projection runs HERE — after the scaffold, immediately
    // before the payload is built — because it is the LAST transformation of
    // the options. Round 3 projected and attested inside the snapshot loader,
    // and the scaffold then mutated the options AFTER the guard (TOCTOU): the
    // loader attested `allWithinUnitInterval: true` while the wire shipped a
    // raw-scale neutral beside demoted unit values, corrupting the configured
    // cost factor 100,000× (round-3 review, executed against real PLoT
    // b9f6b5a). Options up to this point carry the ORIGINAL merged
    // intervention OBJECTS (loader) plus the scaffold's neutral candidate
    // OBJECTS; the wire numbers exist only from here on.
    const graphNodesForScale = (graphForAnalysis as { nodes?: unknown })?.nodes;
    const factorScaleById = buildFactorScaleMap(graphNodesForScale);
    const submittedOptions = gate.options as ReadonlyArray<Record<string, unknown>>;
    const rawObjectsPerOption = submittedOptions.map((opt) =>
      opt.interventions !== null && typeof opt.interventions === 'object'
        ? (opt.interventions as Record<string, unknown>)
        : {},
    );
    // ROUND 5 — provenance for the scale decision. `gate.held` already records
    // exactly which factor ids CEE supplied on which option, so nothing new has
    // to be derived or remembered: the marker is read off the gate's own
    // disclosure record. A CEE-supplied value must not establish the scale
    // reference frame for a value the user authored.
    const scaffoldedFactorIdsByOptionId = new Map<string, ReadonlySet<string>>();
    for (const record of gate.held) {
      scaffoldedFactorIdsByOptionId.set(record.option_id, new Set(record.factor_ids));
    }
    const EMPTY_SYNTHESISED: ReadonlySet<string> = new Set<string>();
    const synthesisedByOption = submittedOptions.map((opt) => {
      const optionId =
        typeof opt.option_id === 'string' && opt.option_id.length > 0
          ? opt.option_id
          : typeof opt.id === 'string' && opt.id.length > 0
            ? opt.id
            : null;
      return (optionId !== null ? scaffoldedFactorIdsByOptionId.get(optionId) : undefined) ?? EMPTY_SYNTHESISED;
    });
    const requestProjection = projectRequestInterventionsToWireScale(
      rawObjectsPerOption,
      factorScaleById,
      synthesisedByOption,
    );
    const conversionSummary = summariseConversions(requestProjection.conversions);
    if (summaryIsNoteworthy(conversionSummary) || requestProjection.demoted) {
      log.info(
        {
          event: 'run_analysis.intervention_scale_egress',
          request_id: invocation.requestId,
          scenario_id: args.scenario_id,
          by_rule: conversionSummary.by_rule,
          cap_denormalised_factors: conversionSummary.cap_denormalised_factors,
          inconsistent_scale_factors: conversionSummary.inconsistent_scale_factors,
          ambiguous_no_evidence_factors: conversionSummary.ambiguous_no_evidence_factors,
          by_rule_outside_unit_interval: requestProjection.outsideUnitIntervalByRule,
          scale_demoted: requestProjection.demoted,
          demoted_factors: requestProjection.demotedFactors,
          wire_all_within_unit_interval: requestProjection.allWithinUnitInterval,
        },
        'run_analysis egress intervention value-scale projection (redacted; no magnitudes)',
      );
    }

    // --- 3.1. Unresolvable-mixed requests DO NOT COMPUTE --------------------
    // Orchestrator ruling (round 4): a request the system itself classified as
    // unresolvable-mixed must not reach PLoT — its gate would re-scale every
    // stranded value (unit-scale costs annihilated; encoded categories like
    // "buy"=1 renormalised to 0.5). Routed to the EXISTING recoverable
    // `analysis_not_ready` shape (200 + honest next step + review chip); the
    // copy names the factors and asks for their units. This replaces the
    // round-3 log-only warn, which let the run ship `robustness: high` with no
    // hedge on numbers computed from a corrupted payload.
    // Row 2.1085 (PR #926 rounds 2–3): the BASELINE gate — within-factor
    // scale coherence. Interventions were gated above; a capless factor's
    // observed BASELINE also reaches the compute (PLoT feeds a structural
    // root's observed_state.value straight into the linear sum), and a raw
    // one beside framed levels was measured shipping under a fully green
    // intervention verdict. Scoped by the factor's OWN user-authored
    // interventions (see the predicate's doc for the two prior cases it
    // reconciles — R2-2 corruption vs the ratified round-5 astride-1 class);
    // provenance comes from the scaffold's own disclosure record, exactly as
    // the request projection's synthesised-marker does above.
    const caplessRawBaselineIds = findScaleIncoherentBaselineFactorIds(
      graphNodesForScale,
      rawObjectsPerOption,
      synthesisedByOption,
    );
    const scaleBlock = decideAnalysisScaleBlock(requestProjection, caplessRawBaselineIds);
    if (scaleBlock.blocked) {
      const labelById = new Map<string, string>();
      if (Array.isArray(graphNodesForScale)) {
        for (const n of graphNodesForScale) {
          const node = n as { id?: unknown; label?: unknown };
          if (typeof node.id === 'string' && typeof node.label === 'string') {
            labelById.set(node.id, node.label);
          }
        }
      }
      const factorNames = scaleBlock.unresolvedFactorIds
        .map((id) => labelById.get(id))
        .filter((l): l is string => typeof l === 'string' && l.trim().length > 0);
      const named = factorNames.length > 0 ? factorNames.join(', ') : 'some of the factors';
      log.warn(
        {
          event:
            scaleBlock.reason_code === 'mixed_scale_unresolved'
              ? 'run_analysis.intervention_scale_mixed_unresolved'
              : 'run_analysis.baseline_scale_unresolved',
          request_id: invocation.requestId,
          scenario_id: args.scenario_id,
          unresolved_factor_ids: scaleBlock.unresolvedFactorIds,
          by_rule_outside_unit_interval: requestProjection.outsideUnitIntervalByRule,
          capless_raw_baseline_ids: caplessRawBaselineIds,
        },
        'run_analysis outbound payload has an unresolvable value scale — analysis BLOCKED with a typed ask (never computed)',
      );
      throw new HandlerInvocationFailedError(
        'Outbound analysis payload carries value scales CEE cannot safely resolve',
        {
          cause_kind: 'analysis_not_ready',
          retryable: false,
          details: {
            handler_id: 'run_analysis',
            scenario_id: args.scenario_id,
            reason_code: scaleBlock.reason_code,
            // ── THE COPY (row 2.1091, 2026-08-13) ─────────────────────────
            // The previous wording said "the scale of X is unclear — some
            // values look like raw amounts and others like 0–1 proportions"
            // and asked for a UNIT. Both halves were defects:
            //
            //  · FALSE AS A STATEMENT ABOUT THE USER'S MODEL in 4 of 4
            //    refusals measured on deployed staging (2026-08-13). In two of
            //    them the persisted graph contained NO out-of-[0,1] value at
            //    all — the raw magnitude was one CEE had synthesised into the
            //    request moments earlier.
            //  · THE ASK WAS INERT. `FactorScaleInfo.unit` is declared,
            //    written twice and read by NO predicate on this path (see
            //    plot-intervention-scale.ts:80). Measured closed loop: the
            //    product asked for a unit and then declined the answer, "this
            //    factor is recorded without a unit". Its own "Review the
            //    model" chip replied "nothing needs 'fixing' structurally",
            //    and the one edit that DID apply landed the user on the
            //    baseline refusal below having destroyed a correctly-framed
            //    pair.
            //
            // GOVERNING RULE: the product may describe what IT did; it may not
            // tell the user what THEY said or did wrong.
            //
            // ⚠ AND IT MAY NOT CLAIM THE VALUE IS CEE'S EITHER. Every measured
            // refusal was CEE-manufactured, but a USER-authored out-of-range
            // value on a capless factor beside an `ambiguous_no_evidence`
            // sibling reaches this same branch, so "this number is mine, not
            // yours" would be false there. What IS true in every branch — the
            // three that reach `mixedUnresolved` (undemotable mixture, an
            // encoded code outside [0,1], a demotion postcondition violation)
            // and the baseline gate — is that the INABILITY is CEE's: this is
            // CEE's own verdict on the request CEE assembled. So the copy owns
            // the limit and makes no claim about authorship.
            //
            // It also promises no remedy. All three remedies the old copy
            // implied were measured NOT to clear the block, and one made the
            // user strictly worse off. A refusal that prescribes a futile
            // action is worse than one that says plainly it cannot proceed.
            next_step:
              scaleBlock.reason_code === 'mixed_scale_unresolved'
                ? `I can't run this analysis safely. The request I assembled carries values for ${named} that the analysis engine would silently rescale, so the numbers it gave back would not be the ones your model states — I've stopped rather than show you a confident wrong answer. Nothing in your model has changed, and this is a limit in how I prepare the analysis, not a verdict on your model. I don't have a step I can promise will clear it, so please don't rewrite your own numbers to try; ask me to run it again after any change and I'll re-check.`
                : `I can't run this analysis safely. ${named} is recorded as a bare amount with no range for me to measure it against, so I can't tell the analysis engine what it means next to everything else, and the numbers would not be the ones your model states — I've stopped rather than show you a confident wrong answer. Nothing in your model has changed, and this is a limit in how I record and prepare values, not a verdict on your model. Telling me the same amount again won't clear it; ask me to run it again after any change and I'll re-check.`,
          },
        },
      );
    }

    // --- 3.2. HARD postcondition on the FINAL wire values -------------------
    // Belt and braces at the true seam: the projection above IS the last
    // transformation, and this assertion re-checks its output right where the
    // payload is assembled. `postconditionViolated` means the decision
    // predicates and the postcondition disagree — fail CLOSED, never compute.
    if (requestProjection.postconditionViolated) {
      log.error(
        {
          event: 'run_analysis.intervention_scale_postcondition_violated',
          request_id: invocation.requestId,
          scenario_id: args.scenario_id,
          demoted_factors: requestProjection.demotedFactors,
        },
        'run_analysis INVARIANT VIOLATION: demotion was chosen but the final payload is still not within [0,1] — refusing to compute on a corrupted payload',
      );
      throw new HandlerInvocationFailedError(
        'Analysis payload failed its scale-coherence postcondition',
        {
          cause_kind: 'analysis_not_ready',
          retryable: false,
          details: {
            handler_id: 'run_analysis',
            scenario_id: args.scenario_id,
            reason_code: 'scale_postcondition_violated',
            next_step: 'This scenario needs a quick fix before it can be analysed.',
          },
        },
      );
    }

    // --- 3.3. Build PLoT payload (allowlisted fields) -----------------------
    // validateRunPayload inside PLoTClient.run enforces the strict allowlist
    // shape. We only forward fields PLoT accepts. The options carry the
    // request-projected wire numbers; NOTHING may transform them between here
    // and `plotClient.run` (that gap was the round-3 defect).
    const finalWireOptions = submittedOptions.map((opt, index) => ({
      ...opt,
      interventions: requestProjection.perOption[index] ?? {},
    }));
    const plotPayload: Record<string, unknown> = {
      graph: graphForAnalysis,
      // No-rank ruling (2026-08-14): the GATED submission set — identical to
      // snapshot.options unless the gate held the status quo at its observed
      // position, or EXCLUDED an option with no values set (disclosed below).
      // An excluded option is absent here, which is what makes "no rank, no
      // probability" true by construction rather than by suppression.
      options: finalWireOptions,
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
          // P0 (analysis-500 diagnosis §4) — the CODES, scanned across every
          // critique for the same reason the messages are: PLoT does not
          // guarantee ordering, and the live 429 capture put
          // `NORMALIZATION_WARNING` first (see run-analysis-downstream-busy).
          const critiqueCodes = critiqueCodesOf(v2Err);
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
          // P0 (analysis-500 diagnosis §4, 2026-08-14) — MATCH THE CODE, NOT
          // ONLY THE PROSE. The two gates above depend entirely on English
          // sentences owned by ANOTHER SERVICE: `analysis_status ===
          // 'preflight_validation_failed'` is never emitted at all (PLoT
          // hard-codes `'blocked'` — `run.ts:1651`; DIAGNOSIS §9 premise 5), so
          // `isPreflight` survives only on the `status_reason` substring, and
          // the critique gate substring-matches a second sentence. A PLoT reword
          // silently converts this honest refusal into a 500 with no signal
          // anywhere.
          //
          // `EMPTY_INTERVENTIONS` is the canonical `BLOCKER_CODES` member for
          // this blocker (PLoT `types/engine-v3.ts:817`, emitted at
          // `preflight-v2.ts:189-191`) and is preflight-exclusive, so the code's
          // presence IS the preflight signal — no prose gate is needed with it.
          //
          // ⚠ BOTH GATES ARE KEPT, and that is deliberate (trap 12d): deriving a
          // guard from a code list MOVES the risk onto the list, it does not
          // remove it. The code path survives a PLoT copy edit; the prose path
          // survives a PLoT code RENAME. Neither is load-bearing alone, and each
          // has its own pin.
          const hasEmptyInterventionsCode = critiqueCodes.includes('EMPTY_INTERVENTIONS');
          if (hasEmptyInterventionsCode || (isPreflight && isMissingIntervention)) {
            // Extract the option label from the matching critique. PLoT
            // emits single-quoted labels in the message: "Option 'Foo Bar'
            // does not specify ...". Match conservatively; if extraction
            // fails, surface as the generic options_not_configured (no
            // label branch in the composer handles that cleanly).
            //
            // P0: when only the CODE matched (a PLoT reword), there is no
            // prose-matched critique to read the label from — take the message
            // belonging to the EMPTY_INTERVENTIONS critique instead. Bound by
            // IDENTITY (the critique's own code), never by position or by a
            // predicate another critique could satisfy (trap 19). Without this
            // the reword path would recover honestly but lose the option name,
            // silently degrading a specific chip into the generic one.
            const labelSource =
              missingInterventionCritique ??
              (Array.isArray(v2Err.critiques)
                ? v2Err.critiques.find(
                    (c) => c?.code === 'EMPTY_INTERVENTIONS' && typeof c?.message === 'string',
                  )?.message
                : undefined) ??
              '';
            const labelMatch = labelSource.match(/Option '([^']+)'/);
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
        // ====================================================================
        // P0 (analysis-500 diagnosis §8 FIX A, 2026-08-14) — A TYPED, BLAME-FREE
        // DOWNSTREAM REFUSAL IS NOT `INTERNAL_ERROR`.
        //
        // Regression Shield arm A `run-2`: 3 of 12 first-use analyse turns
        // returned HTTP 500 `plot_error`. The seam is byte-verified (§3): the
        // plot-client's typed-failure carve-out fires only on `response.ok`, so
        // every non-422 non-2xx arrives with `v2RunError` unset, and
        // `isTypedFailedEnvelope` additionally excludes 422 — so a 422 `blocked`
        // and a 503 both fell to `plot_error` → `handler_failure` → 500.
        //
        // ⚠⚠ TWO DISPOSITIONS, TWO DIFFERENT USER QUESTIONS — SEPARATE BRANCHES,
        // SEPARATE COPY, SEPARATE PINS (trap 21). This is not tidiness. The
        // 429-vs-display-scope pair (#709/#737) recreated a harm precisely
        // because two authorities answering different questions were reconciled
        // under one predicate:
        //
        //   503 → "can the engine take an analysis right now?"  NO, and it is
        //         nothing to do with this model. Blame-free, retryable.
        //   422 → "can the engine answer THIS model?"  NO, and here is what to
        //         change. An honest verdict ABOUT the model, not a retry promise.
        //
        // Telling a 422-blocked user to "try again shortly" would be a lie, and
        // telling a 503 user to edit their graph would blame them for an
        // infrastructure state — PLoT's own comment makes exactly that point
        // when explaining why admission refusal is 503 and not 422
        // (`compute-admission.ts:745-753`).
        //
        // ⚠ WHAT IS DELIBERATELY *NOT* RECOVERED (trap 22b — closing a gap must
        // not invent the mirror lie). DIAGNOSIS §7.1 could not establish which
        // disposition caused the three banked 500s, so this fix must be correct
        // for BOTH — and it must not become "every failure is retryable":
        //   - a PLoT 200 `failed` envelope stays `analysis_failed` (fatal);
        //   - a 422 with NO typed envelope stays `plot_error` (fatal) — an
        //     unparseable body is not a typed refusal, whatever its status;
        //   - a 422 whose envelope claims `failed` rather than `blocked` stays
        //     fatal — `blocked` is the only 422 disposition PLoT documents as an
        //     honest verdict (`run.ts:1651`);
        //   - a PLoT 500/502 stays `plot_error` (fatal).
        // Each of those has its own pin in
        // `__tests__/run-analysis-typed-refusal-not-500.test.ts`.
        // ====================================================================

        // ARM 1 — PLoT 422 `blocked`: PLoT has DECIDED it cannot answer this
        // model. That is not a CEE fault and not an internal error; it is the
        // engine's honest verdict, and `analysis_blocked` is the cause that
        // already says exactly that (`handler-errors.ts:42`, on
        // `RECOVERABLE_HANDLER_CAUSES`, with its own composer branch AND the
        // `plot_primary_code` copy table already keyed for it). Gated on PLoT's
        // DECLARED envelope status, not on the status code alone, so an untyped
        // or off-contract 422 keeps the fatal mapping.
        //
        // ⭐⭐ THIS IS THE MEASURED ARM. Settled at the Render logs, 14 Aug 2026
        // (`TRIGGER-SETTLED-LANE-F2.md`): all THREE banked 500s were
        // `PLoT run 422 — V2RunError`, `analysis_status: 'blocked'`,
        // `code: 'DUPLICATE_EDGE_CONFLICT'` — never the 503 the diagnosis
        // favoured. The 503 arm below is the speculative half; this one fires on
        // real users, 3 of 12 first-use analyse turns.
        //
        // ⚠⚠ WHY THE DISPOSITION IS KEYED ON `analysis_status`, NOT ON A
        // BLOCKER-CODE ALLOWLIST — measured, not preferred. The obvious design
        // is to enumerate PLoT's `BLOCKER_CODES` (`types/engine-v3.ts:811-838`,
        // 26 entries) and decide each. **`DUPLICATE_EDGE_CONFLICT` IS NOT IN
        // `BLOCKER_CODES`.** It lives in `INLINE_CRITIQUE_CODES` (`:884`,
        // commented *"Registered late (both already emitted via
        // buildBlockedResponse)"*), as do `GRAPH_TOO_COMPLEX` and
        // `MIXED_RANGE_DERIVATION`. So an allowlist derived from the canonical
        // blocker list would have OMITTED THE CODE THAT CAUSED ALL THREE 500s,
        // and this P0 would have shipped its own fix and survived. There is no
        // single list in PLoT enumerating "codes that can accompany a 422
        // blocked": the true set is `BLOCKER_CODES` ∪ an unmarked subset of
        // `INLINE_CRITIQUE_CODES`, recoverable only by reading all ~20
        // `reply.status(422)` sites — the textbook hand-maintained mirror
        // (trap 12), whose drift always reads green.
        //
        // What IS structural, and therefore safe to key on: every one of those
        // sites goes through `buildBlockedResponse`, which hard-codes
        // `analysis_status: 'blocked'` (`run.ts:1651`). That is the producer's
        // declared semantics (trap 13c), so it is what the predicate reads.
        //
        // DIRECTION OF FAILURE, which is the whole argument: this list's failure
        // mode is a slightly-too-generic honest refusal. An allowlist's failure
        // mode is a 500 — the P0 itself. Two lists, opposite blast radii.
        const blockedCritiqueCodes = critiqueCodesOf(v2Err);
        if (runError.status === 422 && v2Err?.analysis_status === 'blocked') {
          // EXPLICIT DISPOSITION 1 of 3 — codes that mean OUR SIDE BROKE, not
          // "your model is unanswerable". A 422 carrying one of these is
          // off-contract (PLoT's internal catch returns 200 `failed`, not 422 —
          // DIAGNOSIS §9 premise 2), and dressing genuine breakage as a model
          // verdict would blame the user for our failure — the same
          // misattribution PLoT itself refuses to commit when it chooses 503
          // over 422 for admission failure (`compute-admission.ts:745-751`).
          // These stay FATAL and visible.
          const fatalCode = blockedCritiqueCodes.find((c) => PLOT_BLOCKED_FATAL_CODES.has(c));
          if (fatalCode === undefined) {
            // EXPLICIT DISPOSITION 2 of 3 — every other blocked code is an
            // honest verdict about the model. Known codes get specific copy from
            // the existing `PLOT_FAILURE_CODE_COPY` table; unknown codes get the
            // generic blocked copy AND a loud tripwire.
            //
            // EXPLICIT DISPOSITION 3 of 3 — UNKNOWN CODES FAIL VISIBLE, and
            // "visible" means the warn log below plus the `v5.recovery_response`
            // telemetry event, whose `template_used` separates generic
            // `analysis_blocked` from `analysis_blocked_<code>`. NOT "500 for the
            // user": a 500 on a verdict PLoT deliberately typed is precisely the
            // confident wrongness being fixed here, and it would re-open this P0
            // for the next code PLoT adds. So the honest refusal ships and
            // `plot_blocker_code_known: false` marks it — the same tripwire
            // pattern as `downstream_http_status_parsed: false` below, which
            // exists for the same reason (a cross-service coupling that can stop
            // working silently).
            //
            // ⚠ CORRECTED (review #949 F3): this comment used to say "visible in
            // telemetry and ON THE WIRE". That was FALSE, and the review caught
            // it. `diagnostics` ride the `handler_failure` (500) arm only; this
            // branch RECOVERS to a 200, so the flag never reaches a wire body. It
            // is a logs-and-telemetry tripwire. Saying otherwise would send the
            // next reader hunting a field that is not there — the
            // hand-maintained-mirror defect, in a comment.
            //
            // ⚠ F2 (review #949): KEY THE FLAG ON THE CODE THE USER ACTUALLY SAW.
            // This used to be `codes.find(isKnownPlotFailureCode)` — "does ANY
            // code have copy?" — while `composePlotCodeKeyedBody` keys on
            // `plot_primary_code`, i.e. `codes[0]`. Two different questions under
            // one flag name (trap 21). A blocked envelope whose FIRST code lacks
            // copy but whose SECOND has it shipped GENERIC copy while the flag
            // said `true` and the warn stayed silent — the tripwire blind exactly
            // when it was needed. Both now read `codes[0]`, so the flag answers
            // the only question worth asking: did the sentence this user was
            // shown come from the code table?
            const renderedCode = blockedCritiqueCodes[0];
            const renderedCodeHasCopy =
              renderedCode !== undefined && isKnownPlotFailureCode(renderedCode);
            if (!renderedCodeHasCopy) {
              log.warn(
                {
                  request_id: invocation.requestId,
                  plot_critique_codes: blockedCritiqueCodes,
                  plot_status_reason: v2Err.status_reason,
                },
                'PLoT blocked the analysis with no code CEE has copy for — honest generic refusal shipped; add copy for this code',
              );
            }
            throw new HandlerInvocationFailedError(
              `PLoT blocked the analysis: ${runError.message}`,
              {
                cause_kind: 'analysis_blocked',
                // The MODEL must change first; a bare re-run reproduces the
                // verdict byte for byte. The composer's chip for this cause is a
                // text prompt, never a retry action — the two agree deliberately,
                // and that agreement is what stops this becoming the mirror lie
                // ("everything is retryable") the 503 arm is careful not to be.
                retryable: false,
                details: {
                  ...errorDetailsBase,
                  ...extractPlotFailureDetails(v2Err),
                  downstream_http_status: 422,
                  plot_blocker_code_known: renderedCodeHasCopy,
                },
                cause: runError,
              },
            );
          }
          // Fell through deliberately: a fatal code keeps the existing
          // `plot_error` mapping below, and carries WHY it stayed fatal.
          log.error(
            {
              request_id: invocation.requestId,
              plot_error_code: fatalCode,
              plot_critique_codes: blockedCritiqueCodes,
            },
            'PLoT sent a 422 blocked carrying an internal-failure code — kept FATAL, not dressed as a model verdict',
          );
        }

        // ARM 2 — PLoT 503: capacity/infrastructure state, blame-free and
        // self-healing. Two carriers, both real, both derived at PLoT
        // `a5345a5e`: `ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE`
        // (`compute-admission.ts:798` — a typed blocked body sent with 503) and
        // `BREAKER_OPEN` (`errors.ts:100` — an `error.v1` envelope with no
        // `analysis_status`). CEE cannot tell them apart by envelope shape and
        // does not need to: the product truth is identical, and
        // `downstreamErrorCode` carries which one fired for telemetry.
        //
        // Keyed on the STATUS, not on the envelope — the admission 503's body
        // carries `retryable: false` (PLoT `run.ts:1653`, contradicting its own
        // documented rationale at `compute-admission.ts:749`; DIAGNOSIS §5
        // records it as a PLoT defect to row). Reading that field here would
        // reinstate the 500 on the very disposition this branch exists for, so
        // the recoverability decision deliberately does not consult it.
        if (runError.status === 503) {
          throw new HandlerInvocationFailedError(
            `PLoT analysis engine unavailable: ${runError.message}`,
            {
              cause_kind: 'analysis_engine_busy',
              retryable: true,
              details: {
                ...errorDetailsBase,
                ...extractPlotFailureDetails(v2Err),
                downstream_http_status: 503,
                ...(runError.downstreamErrorCode !== undefined
                  ? { plot_error_code: runError.downstreamErrorCode }
                  : {}),
              },
              cause: runError,
            },
          );
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

        // ROADMAP 2.202 fix ③ — BUSY, not INTERNAL_ERROR. Two ways a 429
        // reaches this seam, and both mean the same product truth ("the engine
        // is at capacity; retry shortly"):
        //   1. PLoT's own limiter rejected CEE            → runError.status 429
        //   2. ISL's compute governor rejected PLoT       → typed FAILED
        //      envelope whose status_reason names HTTP 429
        // Narrow on purpose. `blocked` is excluded (PLoT DECIDED it cannot
        // answer — telling the user to retry that would be a lie), and every
        // non-429 status keeps the fatal `analysis_failed` mapping so genuine
        // breakage stays a visible 500.
        const parsedStatus = isTypedFailedEnvelope ? readDownstreamHttpStatus(v2Err) : null;
        const downstreamStatus = runError.status === 429 ? 429 : parsedStatus;
        if (downstreamStatus === 429) {
          throw new HandlerInvocationFailedError(
            `PLoT returned error: ${runError.message}`,
            {
              cause_kind: 'analysis_engine_busy',
              retryable: true,
              details: {
                ...errorDetailsBase,
                ...extractPlotFailureDetails(v2Err),
                downstream_http_status: 429,
              },
              cause: runError,
            },
          );
        }

        // N1 — CARRY THE PARSE OUTCOME ON THE FATAL PATH TOO.
        // The busy classification rests on a prose read of a template owned by
        // ANOTHER SERVICE. If PLoT rewords it, busy-classification dies and
        // every 429 quietly returns to being a 500 — and without this, with no
        // signal anywhere. That is the guarantee-theatre shape: machinery that
        // stops working and says nothing. So the fatal error carries the status
        // when one was read, and an explicit `downstream_http_status_parsed:
        // false` when a typed failure arrived bearing a status_reason the
        // pattern could NOT read. The second is the tripwire: a sudden run of
        // them IS the rewording, visible in telemetry before anyone has to
        // notice a rise in 500s.
        const unreadableStatusReason =
          isTypedFailedEnvelope &&
          typeof v2Err?.status_reason === 'string' &&
          v2Err.status_reason.length > 0 &&
          parsedStatus === null;
        // P0 (analysis-500 diagnosis §3 THE OBSERVABILITY DEFECT) — a FATAL PLoT
        // failure must be ATTRIBUTABLE. Lane F could not name the disposition
        // because the surviving 500s carried no PLoT status at all; it took
        // Render log access to settle what the wire should have said.
        //
        // `parsedStatus` wins when present: it is the status PLoT read off ISL,
        // which is the more specific fact, and the existing pins depend on it
        // (a 200 typed-failed envelope naming HTTP 500 must keep reporting 500,
        // never PLoT's own 200). Only when no ISL status was parsed does PLoT's
        // OWN transport status fill the field — and never for a 200, where
        // "downstream status 200" would be a meaningless value crowding out the
        // `downstream_http_status_parsed: false` tripwire.
        const plotTransportStatus =
          parsedStatus === null && runError.status !== 200 ? runError.status : null;
        throw new HandlerInvocationFailedError(
          `PLoT returned error: ${runError.message}`,
          {
            cause_kind: isTypedFailedEnvelope ? 'analysis_failed' : 'plot_error',
            retryable: true,
            details: {
              ...errorDetailsBase,
              ...extractPlotFailureDetails(v2Err),
              ...(parsedStatus !== null ? { downstream_http_status: parsedStatus } : {}),
              ...(plotTransportStatus !== null
                ? { downstream_http_status: plotTransportStatus }
                : {}),
              ...(runError.downstreamErrorCode !== undefined
                ? { plot_error_code: runError.downstreamErrorCode }
                : {}),
              ...(unreadableStatusReason ? { downstream_http_status_parsed: false } : {}),
            },
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
    // D-ask-1 disclosure honesty (2026-07-25): the option ids that ACTUALLY
    // reached the comparison. Read off the same records the win-probability
    // map and the leader selection are built from, so "was it analysed?" and
    // "is it in the numbers the user sees?" cannot answer differently.
    const analysedOptionIds = readAnalysedOptionIds(resultRecords);
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
    // T1 — a user-ratified hard constraint that was APPLIED and then never
    // evaluated to decision grade. PLoT already computes and ships this
    // verdict (`inference_warnings` codes CONSTRAINT_OUT_OF_DOMAIN /
    // CONSTRAINT_TARGET_UNRELIABLE, `constraints_status: 'unavailable'`, and
    // the per-option `constraint_probabilities` it withholds); we READ it off
    // the wire and never re-derive it. The ratified set comes from CEE's own
    // persisted `goal_constraints` — the only record of what the user agreed
    // to. With no ratified constraints this is byte-identical to before.
    //
    // Distinct from `constraint_infeasible` below: that means "the leader
    // breaks a limit we DID check"; this means "we never checked the limit".
    // `deriveWinnerConstraintInfeasibility` cannot cover this case — it fails
    // OPEN when constraint probabilities are absent, which is precisely what
    // PLoT withholds on the suppressed-unreliable path.
    // Prefer the snapshot's own `goal_constraints` — that is the exact array
    // this handler forwards to PLoT (see the plotPayload assembly above), so
    // "we asked PLoT to enforce it" and "PLoT never scored it" are compared
    // against the same bytes. Falls back to the persisted graph for snapshots
    // that carry the constraints only there. Hoisted so the identity telemetry
    // below can report what we actually asked for.
    const ratifiedConstraints = readRatifiedConstraints(
      snapshot.goal_constraints ?? snapshot.rawPersistedGraph ?? snapshot.graph,
    );
    // ONE verdict, five states, each declaring whether a leading option may be
    // named. Both withholding predicates (never evaluated / the leader breaks a
    // checked limit) and the seam's third answer (we could not reconcile which
    // condition was evaluated) come from this single call, so no two surfaces
    // can disagree about what the constraint evidence said.
    const constraintVerdict = deriveConstraintVerdict(
      response as Record<string, unknown>,
      ratifiedConstraints,
      leadingOptionId ?? null,
    );
    if (constraintVerdict.state === 'unevaluated') {
      emit(TelemetryEvents.V5RunAnalysisConstraintUnevaluated, {
        request_id: invocation.requestId,
        scenario_id: args.scenario_id,
        // Redacted: ids + codes only — no labels, no thresholds, no units.
        constraint_ids: constraintVerdict.constraints.map((c) => c.constraint_id),
        codes: constraintVerdict.codes,
      });
    }
    if (constraintVerdict.state === 'identity_unresolved') {
      // FAIL LOUD. PLoT scored constraints under ids that reconcile with
      // nothing we ratified, so BOTH confident verdicts were withheld rather
      // than asserted. That is the honest outcome, but it must be visible — an
      // unmatched id space is a real contract divergence at an unenforced seam,
      // and it costs the user a recommendation every time it happens.
      emit(TelemetryEvents.V5RunAnalysisConstraintIdentityUnresolved, {
        request_id: invocation.requestId,
        scenario_id: args.scenario_id,
        // Redacted: ids + counts only — no labels, no thresholds, no units.
        ratified_constraint_ids: ratifiedConstraints.map((c) => c.constraint_id),
        ratified_count: ratifiedConstraints.length,
      });
    }

    // ROADMAP 2.579 — THE INTAKE AXIS, derived beside the constraint verdict
    // and kept entirely separate from it (trap 21: two authorities, two
    // questions, named apart rather than aligned).
    //
    // Option labels come from the SAME `snapshot.options` array this handler
    // forwards to PLoT — the tightest possible statement of "what we asked the
    // engine to rank" — falling back to the raw persisted graph for snapshots
    // that carry labels only there. That mirrors `readRatifiedConstraints`'s
    // two-shape read above and for the same reason: never depend on which
    // mirror a call site happens to hold.
    //
    // Fails toward TODAY'S BEHAVIOUR at every step: no brief, no explicit
    // enumeration, or a brief whose words reconcile with nothing on the graph
    // all yield `not_applicable`, which declares `mayNameLeadingOption: true`
    // and leaves both the headline and the persisted verdict byte-identical.
    const snapshotOptionLabels = readGraphOptionLabels(snapshot.options);
    const intakeReconciliation = deriveIntakeOptionReconciliation(
      snapshot.briefText,
      snapshotOptionLabels.length > 0
        ? snapshotOptionLabels
        : readGraphOptionLabels(snapshot.rawPersistedGraph ?? snapshot.graph),
    );
    // ⚠ NO TELEMETRY EVENT HERE, AND THAT IS A DISCLOSED GAP RATHER THAN AN
    // OVERSIGHT. The obvious move — reuse `V5RunAnalysisConstraintUnevaluated`
    // with a discriminating code — is the exact conflation this module's
    // separation exists to prevent: it would file a drafter defect inside a
    // producer statistic, and the first dashboard to read it would be wrong
    // about both. A registered `V5RunAnalysisIntakeOptionsMissing` event is its
    // own change (the telemetry-validation workflow owns that registry).
    //
    // Stated exactly, because a wrong observability claim is worse than none:
    // this withhold emits NO event at all today. The `V5HeadlineFellBack` emit
    // below cannot cover it — that fires only on `descriptor.case === 'E'`, and
    // every withholding branch (this one and all three constraint branches)
    // returns `case: null`, which is precisely why each constraint branch
    // carries its own explicit emit. The user-facing disclosure is the only
    // signal until the registered event lands.
    const headlineInput = {
      enrichment: response as Record<string, unknown>,
      leading_option_id: leadingOptionId ?? '',
      status_kind: headlineStatusKind,
      // T1: withhold the confident "{X} currently leads" claim while any
      // ratified condition is unchecked. A recommendation must not exist
      // unless every user-ratified hard constraint is decision-grade.
      constraint_unevaluated: constraintVerdict.state === 'unevaluated',
      // T1, the third answer: the producer evaluated constraints under ids we
      // could not reconcile. Withheld under its own reason so "we could not
      // tell" is never logged or worded as "the engine did not check".
      constraint_identity_unresolved:
        constraintVerdict.state === 'identity_unresolved',
      // Trust-spine board #1 (CEE half): withhold the confident "{X} currently
      // leads" headline when the leading option violates a hard constraint.
      //
      // The gate stays. It is read HERE, at the caller, exactly as it is at the
      // other two call sites (analysis-compact, decision-review-enricher) —
      // `deriveConstraintVerdict` is pure, so the verdict is computed the same
      // way whether or not the flag is on, and only the ACTING on it is gated.
      // Retiring the flag is a real change to a claim-safety withhold's
      // switch-off path and belongs in its own PR, not bundled with the verdict
      // rewrite. NOTE for that PR: the comment previously on this line said
      // "Gate default OFF → always false → byte-identical headline path", which
      // had been false since 18 Jul (`constraintInfeasibleGate:
      // booleanString.default(true)`, config/index.ts:728). Two identical stale
      // claims remain, at analysis-compact.ts and decision-review-enricher.ts.
      constraint_infeasible:
        config.features.constraintInfeasibleGate &&
        constraintVerdict.state === 'evaluated_infeasible',
      // ROADMAP 2.579 — block the RANKING, not the analysis. The brief
      // enumerated an option the graph does not carry, so "{X} currently leads"
      // is a claim about which option is best over a set that is missing a
      // candidate. UNGATED BY ANY FEATURE FLAG, deliberately: the estate's
      // standing rule is no new env-var gates, and a flag here would mean the
      // product keeps making the false claim by default.
      intake_options_missing: intakeReconciliation.state === 'options_missing',
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
    // D-ask-1 (2.11 P0-1) disclosure — claim-safety-critical: when the run
    // only completed because the scaffold filled placeholder interventions,
    // the summary MUST say those numbers are defaults and point at the
    // configure route. Appended LAST (after every headline tail / status
    // suffix), matching the registry egress grammar in
    // analysis-result-headline.ts so the disclosure survives to the wire on
    // both the chat receipt and the analysis_result block.
    //
    // 2026-07-25 — the claim is now DERIVED FROM THE RETURNED RESULT, not
    // from the scaffold's intent. Reproduced on deployed staging (scenario
    // 454c14fb…, CEE 74c785f): a scaffolded option can be scaffolded and
    // still not reach `option_comparison`, because the scaffold's neutral
    // rule ("the factor's current position") coincides with how the drafter
    // defines the baseline / status-quo option, so PLoT/ISL removes the arm
    // (`IDENTICAL_OPTIONS_DEDUPED`). The summary then told the user
    // "Placeholder values were used for 'X'" while X was absent from the
    // comparison AND from `win_probabilities`. The partition below reads
    // what actually came back, so any downstream filter — dedup today, a
    // status gate or a future rule tomorrow — is disclosed automatically
    // instead of being mirrored here (trap-12).
    //
    // ⚠ ONLY THE HELD RECORDS GO THROUGH THIS PARTITION. It DERIVES omission
    // from the returned `option_comparison[]`, and its fail-safe classifies
    // every record as `analysed` when no option identity came back. That is
    // right for a DERIVED verdict — but for a never-submitted option it would
    // ship a disclosure about an option nothing was minted for. Exclusion is a
    // fact CEE knows at submission time, so it is passed to the composer
    // directly (trap 21: a fail-safe correct for a derived verdict is the wrong
    // one for a known verdict).
    const heldPresence = partitionScaffoldedByAnalysisPresence(
      gate.held,
      analysedOptionIds,
    );
    if (heldPresence.omitted.length > 0) {
      emit(TelemetryEvents.V5RunAnalysisOptionsScaffolded, {
        request_id: invocation.requestId,
        scenario_id: args.scenario_id,
        // Redacted: ids + counts only — no labels, no magnitudes.
        scaffolded_option_ids: heldPresence.omitted.map((s) => s.option_id),
        scaffolded_factor_counts: heldPresence.omitted.map((s) => s.factor_ids.length),
        option_count: snapshot.options.length,
        outcome: 'omitted_from_comparison',
      });
    }
    // 2.120(c), 2026-07-29 — the omission sentence now carries the ENGINE'S
    // reason where the engine gave one. Previously it said the option was left
    // out "because it has no values set", while the payload's own reason was
    // `IDENTICAL_OPTIONS_DEDUPED` (identical interventions to another option).
    // The proxy reason is causally related but points the user at the wrong
    // repair, and it is outright wrong for an option whose values ARE set to
    // the same numbers as another's — dedup is a fingerprint match, not an
    // emptiness test. The resolver reads the warning crossed with the returned
    // comparison; no warning ⇒ null ⇒ the previous sentence ships unchanged.
    const dedupKeptLabelFor = buildDedupKeptLabelResolver(
      response,
      resultRecords,
      analysedOptionIds,
    );
    const scaffoldDisclosure =
      gate.held.length > 0 || gate.excluded.length > 0
        ? buildAnalysisSubmissionDisclosure(heldPresence, gate.excluded, dedupKeptLabelFor)
        : '';
    // T1 disclosure. The VERDICT is passed whole: which sentence is honest
    // depends on which state the producer evidence selected, and that pairing
    // is made inside the builder rather than here — `unevaluated` names the
    // condition that was not checked and gives the units repair step;
    // `identity_unresolved` says the results could not be matched to the
    // conditions set, and asks for a re-statement instead. Every other state
    // discloses nothing. Appended after the scaffold disclosure so it is the
    // LAST thing in the primary message — the headline has already been
    // withheld above, so the message can no longer lead with an option while
    // this is present.
    // WS-A round 2, B1 — the brief rides along so the quote rung can VERIFY
    // *"From your brief: …"* against the text the user actually submitted.
    // `source_quote` is written by the model, and the measured paraphrase mode
    // STRIPS THE NEGATION (`cee/compound-goal/direction-gate.ts:331-336`), so
    // an unchecked quote could state the opposite of the limit beside it. Same
    // `snapshot.briefText` the intake reconciliation above reads; absent ⇒ the
    // quote stands down and the labelled disclosure ships unchanged.
    const constraintGapDisclosure = buildConstraintDisclosure(
      constraintVerdict,
      snapshot.briefText,
    );
    // ROADMAP 2.579 disclosure, LAST of the three. It names the option(s) the
    // brief listed and the graph does not carry, and gives BOTH repair paths
    // (add it, or confirm the omission was deliberate). Appended after the
    // constraint gap so the user reads the more fundamental fact — the set
    // being ranked is not the set they described — at the end of the message,
    // where the headline has already been withheld above. Additive, never
    // exclusive: a turn can carry a scaffold disclosure, a constraint-gap
    // disclosure AND this one, and none of them may eat another.
    const intakeDisclosure = buildIntakeOptionDisclosure(intakeReconciliation);
    // Objective-contradiction honesty surface (pricing-objective FINDINGS fix
    // 1), LAST of the four. The 14 Aug investigation measured, at the
    // producers, that the comparison NEVER evaluates the user's stated
    // objective: "wins" is argmax of the goal-node scalar per draw, so the
    // leading option can carry `probability_of_goal = 0.0` while winning 70%.
    // This does not fix the scoring rule — it says so where the product names
    // a leader.
    //
    // ⚠ `headline !== null` IS THE LEADER PERMISSION, not a convenience. This
    // tail NAMES options, so on a withheld turn it must ship nothing: appending
    // it there would assert the leader the withhold had just denied, which is
    // the G-CEE-1 defect class with five recorded producers. The builder
    // enforces the same precondition internally; passing it here is what makes
    // the handler's own intent legible.
    //
    // Fed from the RAW PERSISTED GRAPH (goal label + option interventions) and
    // the SAME `resultRecords` every other seam on this path reads, so the
    // sentence can never describe a different run than the summary it rides on.
    const objectiveContradictionDisclosure = composeObjectiveContradictionDisclosure(
      snapshot.rawPersistedGraph,
      resultRecords,
      headline !== null,
    );
    const summary = `${headline ?? template}${scaffoldDisclosure}${constraintGapDisclosure}${intakeDisclosure}${objectiveContradictionDisclosure}`;

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
        // T1 claim safety, LAYER 2 — "may a leading option be named" is a FACT
        // ABOUT THIS ANALYSIS, so it is persisted WITH the analysis facts and
        // read back on every path that rebuilds from them, rather than
        // re-derived at each call site (which is how two surfaces end up
        // contradicting each other inside one HTTP response — CLAUDE.md trap
        // #12).
        //
        // FIRST-CLASS since @talchain/schemas 0.25.0. It rode
        // `enrichment.__cee_claim_safety` from #710 until this release, because
        // `RunAnalysisResultSchema` is `.strict()` and the field could not be
        // added without a package release (blocked behind V5-CI-01). This is
        // that release, and the contract's `ConstraintVerdictSchema` mirrors
        // `PersistedClaimSafety` verbatim — enforced at compile time by the
        // drift bolt in constraint-feasibility.ts.
        //
        // Written HERE, inside the validated fact, not bolted on afterwards:
        // the field is CEE-OWNED and sits alongside the other CEE-owned fields
        // (`graph_hash_at_run`, `computed_at`), so the handler-ownership
        // invariant that `enrichment` is byte-for-byte PLoT
        // (`scripts/validate-handler-ownership.sh` §6) is satisfied by
        // construction instead of by a second parse.
        //
        // Live-proven harm this closes (G-CEE-1 walk, staging 1c078f0): the
        // confirmation said "no option can be put forward yet" while
        // `blocks[1].body` in the SAME response said "The MacBook Pro leads by
        // a margin of about 52 percentage points".
        // ROADMAP 2.579 — the intake answer folds into the SAME persisted
        // permission, so the withhold reaches every egress surface that already
        // reads it (compose, the leading-option egress guard, the coaching
        // surfaces, the analysis_result block) instead of only the headline.
        // Gating the headline alone would ship a contradiction inside one HTTP
        // response, which is the defect class ROADMAP 1.218 exists to close.
        // A conjunction: the intake axis can only ever REMOVE the permission,
        // and it leaves `constraint_verdict_state` untouched because it has
        // nothing true to say about the constraint evidence — see
        // `applyIntakeToLeaderPermission` for the full statement of that
        // residual.
        constraint_verdict: applyIntakeToLeaderPermission(
          projectClaimSafety(constraintVerdict),
          intakeReconciliation,
        ),
      },
    };

    // --- 7. Zod-validate the fact ----------------------------------------
    //
    // ONE parse, not two. Until 0.25.0 the claim-safety verdict had to be
    // bolted onto `enrichment` AFTER this parse and the fact re-validated,
    // because `RunAnalysisResultSchema` is `.strict()` and had no home for it.
    // The verdict is now a declared member of that schema, so it is validated
    // by this parse like every other CEE-owned field — and the second
    // safeParse it needed is gone with it.
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
      // Internal channel (never the wire envelope directly) — the
      // turn-executor / chip-click dispatch thread this to the chip generator
      // and to the decision-review enricher. Stamped with the derived
      // `in_comparison` verdict so the DR prompt disclosure inherits it
      // without a second channel (see partitionScaffoldedByAnalysisPresence).
      //
      // ⚠ SINCE THE NO-RANK RULING THIS CHANNEL CARRIES ONLY STATUS-QUO HOLDS.
      // Excluded options deliberately do NOT ride it: they carry no
      // `value_defaulted` and no `factor_ids`, because nothing was minted for
      // them. Their disclosure is the summary suffix above, which names them
      // and gives the configure route.
      // The configure chip's source (see chip-generator): the options a
      // configure step actually repairs.
      ...(gate.excluded.length > 0 ? { __excluded_options: gate.excluded } : {}),
      ...(gate.held.length > 0
        ? { __scaffolded_options: heldPresence.stamped }
        : {}),
      // ROADMAP 2.804 — `__leading_option_claim_withheld` USED TO BE SET HERE
      // and is deliberately gone. It carried THIS RUN's verdict to the STEP-5
      // coaching detector, which is a narrower question than that slot asks:
      // the slot needs the TURN-level, display-bound permission, and this
      // channel could never carry the displayed-analysis conjunct #737 added
      // because a handler outcome never sees the fact array. The coaching slot
      // now derives the permission from the fact chain in
      // `applyCoachingSignal`, so this field had no consumer left and a second
      // authority sitting here is an invitation for a future handler to start
      // writing one. The persisted `constraint_verdict` above is the channel a
      // handler influences the leader claim through.
      //
      // ⚠ SCOPE, STATED NARROWLY BECAUSE AN EARLIER DRAFT OF THIS COMMENT
      // OVERSTATED IT. This unifies the PROSE channel only. It is NOT true that
      // `constraint_verdict` is "the one channel" for the leader claim on the
      // wire: `compose.ts`'s `analysis_result` block gates `leading_option_id`
      // and `summary` on `mayNameLeadingOptionForFact` — the PER-FACT leaf
      // reader — and the TURN-level verdict never reaches `compose.ts` at all
      // (zero references, verified repo-wide). So on the exact divergence path
      // this change addresses, the response withholds the leader in prose and
      // still ships `leading_option_id` in the structured block, because the
      // current fact's own verdict permits. That gate is PRE-EXISTING, is not
      // touched here, and whether the block channel should honour the
      // turn-level verdict is rowed separately as ROADMAP 2.844.
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
/**
 * ROADMAP 2.202 fix ③ — recover the DOWNSTREAM HTTP status from PLoT's typed
 * failure envelope.
 *
 * ⚠ THIS IS A PROSE READ, AND THAT IS THE ONLY CARRIER THAT EXISTS. PLoT's
 * envelope has no structured downstream-status field on the wire: the critique
 * codes (`ISL_ERROR`, `ISL_CALL_FAILED`) do not distinguish a 429 from a 500,
 * and `isl_status_reason` is not lifted by the plot-client's
 * `extractTypedFailureEnvelope` (which carries `analysis_status`,
 * `status_reason`, `critiques` only).
 *
 * The template is fixed and verified at PLoT's own staging tip `5ab93383`,
 * `src/routes/v2/run.ts:1606` (`buildIslFailureDetail`):
 *
 *     error.code === 'ISL_ERROR' && error.status
 *       ? `The analysis service returned an error (HTTP ${error.status}).`
 *       : classStatusReason
 *
 * So the `(HTTP <n>)` suffix is emitted by exactly one site, only for
 * `ISL_ERROR`, and always in that form. We parse the STATUS NUMBER rather than
 * substring-matching "429", so the reader states what it means and a 500 can
 * never be mistaken for a 429.
 *
 * Fail-CLOSED by construction: no match ⇒ `null` ⇒ the caller keeps the
 * existing fatal mapping. If PLoT ever reworded the template the effect is a
 * return to today's behaviour (an honest 500), never a false "busy" — the safe
 * direction. Should PLoT gain a structured status field, prefer it and delete
 * this.
 */
/**
 * P0 (analysis-500 diagnosis §8 FIX A / `TRIGGER-SETTLED-LANE-F2.md`) — the
 * codes on a PLoT 422 `blocked` that mean **PLoT or ISL broke**, as opposed to
 * "this model cannot be answered".
 *
 * These keep the FATAL `plot_error` mapping and stay a visible 500. Dressing our
 * own breakage as a verdict about the user's model would blame them for our
 * failure — the exact misattribution PLoT refuses to commit when it returns 503
 * rather than 422 for an admission failure (`compute-admission.ts:745-751`).
 *
 * ⚠ THIS IS A HAND-MAINTAINED LIST AND ITS FAILURE MODE IS THE SAFE ONE, which
 * is the only reason it is acceptable here (trap 12). If PLoT adds an
 * internal-failure code and this set omits it, the result is an honest but
 * too-generic refusal — a degraded 200. The inverse design (an ALLOWLIST of
 * recoverable blocker codes) fails to a 500, i.e. straight back into this P0,
 * and would already have omitted `DUPLICATE_EDGE_CONFLICT`. Same mirror, opposite
 * blast radius; pick the direction that cannot recreate the defect.
 *
 * Off-contract by construction: PLoT's outermost catch returns **200** with
 * `analysis_status: 'failed'` (`run.ts:8783-8811`; DIAGNOSIS §9 premise 2), so
 * none of these SHOULD reach a 422. The set exists for the day one does.
 */
const PLOT_BLOCKED_FATAL_CODES: ReadonlySet<string> = new Set([
  'PLOT_INTERNAL_ERROR',
  'ISL_CALL_FAILED',
  'ISL_EMPTY_RESULTS',
]);

/**
 * Every critique code on a typed PLoT envelope, in wire order.
 *
 * Scanned across ALL critiques, never just the first: PLoT does not guarantee
 * ordering, and the live 429 capture put `NORMALIZATION_WARNING` first (see
 * `run-analysis-downstream-busy.test.ts`). A first-only read would have missed
 * the discriminating code on that very shape.
 */
function critiqueCodesOf(v2Err: V2RunError | undefined): string[] {
  return Array.isArray(v2Err?.critiques)
    ? v2Err.critiques
        .map((c) => (typeof c?.code === 'string' ? c.code : null))
        .filter((c): c is string => c !== null && c.length > 0)
    : [];
}

const PLOT_DOWNSTREAM_HTTP_STATUS_RE = /\(HTTP\s+(\d{3})\)/;

function readDownstreamHttpStatus(v2Err: V2RunError | undefined): number | null {
  const reason = v2Err?.status_reason;
  if (typeof reason !== 'string') return null;
  const match = PLOT_DOWNSTREAM_HTTP_STATUS_RE.exec(reason);
  if (match === null || match[1] === undefined) return null;
  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : null;
}

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
 * The set of option ids present in the returned per-option records.
 *
 * Deliberately id-only (never labels): the scaffold record carries
 * `option_id`, and matching on ids avoids the label-collision class. An
 * empty set means the envelope carried no readable option identity — the
 * caller MUST treat that as "cannot derive", never as "everything was
 * omitted" (trap-13: prove a PRESENCE before asserting an ABSENCE).
 */
export function readAnalysedOptionIds(
  records: ReadonlyArray<Record<string, unknown>>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const record of records) {
    const id = record.option_id;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return ids;
}

/**
 * ROADMAP 2.120(c) — resolve, for each option the engine REMOVED as a
 * duplicate, the label of the option it was indistinguishable from.
 *
 * Why this exists: the omission disclosure used to give "because it has no
 * values set" as the reason an option was left out. That is not the engine's
 * reason — the engine's reason is `IDENTICAL_OPTIONS_DEDUPED`, a fingerprint
 * match on the interventions, which fires whether or not values were set. The
 * accurate sentence has to NAME the option that was kept, and that name is only
 * derivable here, where the warning and the returned comparison are both in
 * hand. See `coaching/scaffold-disclosure.ts` for the copy.
 *
 * PROVENANCE OF THE FIELD, verified at the bytes on PLoT `3d13e0a`:
 * `validation/preflight-v2.ts:433-441` composes the warning with
 * `affected_option_ids`, `routes/v2/run.ts:6268` aggregates it into
 * `critiques`, and `:3496` publishes it through `addUserMessages`, which
 * SPREADS each critique (`critique-humaniser.ts:499-502`) — so no field is
 * dropped on the way to us. (The CEE→UI turn payload does strip it; that is a
 * different hop and the reason a wire capture cannot answer this question.)
 *
 * ⚠ WHICH ID IS THE KEPT ONE IS **DERIVED, NOT POSITIONAL**. PLoT happens to
 * emit `[keptOption.id, droppedOption.id]` today, but encoding that order here
 * would be a hand-maintained mirror of another repo's array literal — trap-12,
 * silent and green when it drifts. Instead: the KEPT option is the one PRESENT
 * in the returned comparison and the REMOVED ones are those ABSENT from it,
 * read off the same `analysedOptionIds` the omission partition uses. So
 * "which option do we name?" and "which option did we say was left out?"
 * cannot answer differently, and a PLoT order flip changes nothing here.
 *
 * Trap-13 built in: a warning is only honoured when EXACTLY ONE of its affected
 * ids is present in the comparison AND at least one is absent. Anything else
 * (no comparison read at all, both present, both absent, no resolvable label)
 * resolves to null, and the caller falls back to the pre-existing sentence — we
 * never name an option we did not see in the results.
 */
export function buildDedupKeptLabelResolver(
  response: V2RunResponseEnvelope,
  resultRecords: ReadonlyArray<Record<string, unknown>>,
  analysedOptionIds: ReadonlySet<string>,
): (omittedOptionId: string) => string | null {
  const rawCritiques = (response as Record<string, unknown>).critiques;
  if (!Array.isArray(rawCritiques) || analysedOptionIds.size === 0) return () => null;

  const labelById = new Map<string, string>();
  for (const record of resultRecords) {
    const id = record.option_id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const label =
      typeof record.option_label === 'string' && record.option_label.length > 0
        ? record.option_label
        : typeof record.label === 'string' && record.label.length > 0
          ? record.label
          : null;
    if (label !== null) labelById.set(id, label);
  }

  const keptLabelByRemovedId = new Map<string, string>();
  for (const critique of rawCritiques) {
    if (!isRecord(critique)) continue;
    if (critique.code !== 'IDENTICAL_OPTIONS_DEDUPED') continue;
    const affected = critique.affected_option_ids;
    if (!Array.isArray(affected)) continue;
    const ids = affected.filter((id): id is string => typeof id === 'string' && id.length > 0);
    const present = ids.filter((id) => analysedOptionIds.has(id));
    const absent = ids.filter((id) => !analysedOptionIds.has(id));
    if (present.length !== 1 || absent.length === 0) continue;
    const keptLabel = labelById.get(present[0]!);
    if (keptLabel === undefined) continue;
    for (const removedId of absent) {
      // First warning wins: a second warning naming the same removed option is
      // a shape we have never observed, and picking arbitrarily between two
      // kept labels would be a claim neither warning supports on its own.
      if (!keptLabelByRemovedId.has(removedId)) keptLabelByRemovedId.set(removedId, keptLabel);
    }
  }

  if (keptLabelByRemovedId.size === 0) return () => null;
  return (omittedOptionId: string): string | null =>
    keptLabelByRemovedId.get(omittedOptionId) ?? null;
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
 *
 * Status gate (2026-07-20): options whose per-option ISL `status` is not
 * recommendable (`'error'` / `'skipped'`) are removed BEFORE any R2 rule is
 * applied. Previously this function was status-blind, so a failed option
 * carrying a top win-probability was crowned as the leader — the same
 * silent-wrong-value defect Codex reproduced in PLoT (fixed there in PR #238).
 * See `recommendable-option.ts` for the predicate and why it is a status-only
 * mirror of PLoT's `isCrownableCandidate`.
 *
 * The R2 rules below are unchanged and now operate on the recommendable
 * records only. When NO record is recommendable the result is `null` — the
 * pre-existing, already-modelled "no leader" state (same value produced by an
 * empty result set or an unbroken tie), NOT a new wire shape.
 */
function selectLeadingOptionId(
  allRecords: ReadonlyArray<Record<string, unknown>>,
): string | null {
  if (allRecords.length === 0) return null;

  // Status gate. An errored/skipped option is never crowned, exactly as PLoT
  // never counts it in a near-tie. Absent status stays recommendable (legacy
  // and most current payloads carry no per-option status) — narrowing this
  // would silently withhold leaders that legitimately exist.
  const records = allRecords.filter(isRecommendableOption);
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
/**
 * The first EXCLUDED option that can be safely named to the user, or null when
 * none can be — in which case the caller ships its generic twin.
 *
 * Guarded by `sanitiseLabel` (the same guard every other user-facing label
 * crosses): an empty label, a label that is just the option id, an ID-shaped
 * label or a UUID is NOT a name a user recognises, and putting one in a
 * next-step would prescribe a step against a token they have never seen.
 *
 * Exported for the spec that pins the named/generic pair — the generic branch
 * is unreachable from the labelled fixtures, so without a direct test it would
 * be a branch nothing exercises.
 */
export function firstUsableExcludedLabel(
  excluded: readonly ExcludedOptionRecord[],
): string | null {
  for (const record of excluded) {
    if (record.label === null) continue;
    const clean = sanitiseLabel(record.label, record.option_id);
    if (clean !== null) return clean;
  }
  return null;
}

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
