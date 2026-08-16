/**
 * EP2 — shared NEUTRAL analysis-readiness core (V5 Edit Safety Core, Phase 1).
 *
 * Read-boundary guard for `run_analysis`: given a persisted graph (any writer,
 * INCLUDING the DGAI canvas autosave that bypasses the backend commit
 * chokepoint), deterministically (a) canonicalise option interventions to the
 * analysis-ready top-level contract and (b) assess whether the graph can be
 * analysed — returning a VOCABULARY-NEUTRAL verdict (`analysis_ready` |
 * `repaired` | `unrecoverable`). Thin per-enforcement-point adapters map the
 * neutral verdict to their own vocabulary (EP2 → `ready` |
 * `repaired_for_analysis` | `blocked`).
 *
 * Composition (all EXISTING, evidence-backed checks — no new value-scale math):
 *   - option-intervention canonicalisation + DEFER on unencodable, via the #278
 *     `encodeOptionInterventionsForEdit` (promotes data.interventions/slash/
 *     node-level/top-level-raw → canonical top-level InterventionV3, deriving
 *     `value = raw_value / cap` through the canonical `normaliseFactorValue`;
 *     defers when the factor doesn't resolve, no cap exists, or the unit
 *     mismatches — NEVER invents a value). Run with NO touched set so every
 *     option may flag.
 *   - `GraphV3.safeParse` (baseline schema).
 *   - `validateGraphStructure` (cycle / orphan / no-path-to-goal /
 *     option-no-factor-edge / no-goal / no-decision / <2 options).
 *   - canonical `buildAnalysisReadyPayload` projection (whole-model status)
 *     for the options_not_configured completeness check.
 *
 * VALUE-PRESERVATION INVARIANT: `repaired` is permitted ONLY for value-preserving
 * canonicalisation of user-supplied data; anything requiring a fabricated /
 * defaulted / guessed cap / unit / value → `unrecoverable`. (Enforced by #278's
 * `deriveValue`, which defers rather than invents.)
 *
 * TOTALITY: this function MUST NEVER throw — it runs at the load-bearing Run
 * admission boundary and at graph-management parity checks. Any internal failure
 * resolves to `unrecoverable` (INTERNAL_ERROR) with a typed verdict, never an
 * exception that bypasses the recoverable Run response.
 *
 * SCOPE: V5 `/orchestrate/v2/turn` only. Does NOT guard the V4 `/orchestrate/v1/turn`
 * seam (documented residual). No EP1 (write boundary), no EP3 (frontend), no CAS.
 */
import type { StructuralViolationCode } from '../../../orchestrator/graph-structure-validator.js';
import {
  assessCanonicalAnalysisReadiness,
  type CanonicalReadinessIssue,
  type CanonicalReadinessIssueCode,
  type CanonicalReadinessRepairProposal,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import { computeScaffoldPlan, type ScaffoldPlan } from './analysable-option-gate.js';

// ============================================================================
// Neutral verdict vocabulary
// ============================================================================

export type ReadinessStatus = 'analysis_ready' | 'repaired' | 'unrecoverable';

export type ReadinessReasonCode =
  | 'OPTION_INTERVENTION_PROMOTED'
  | 'OPTION_VALUE_DERIVED_FROM_CAP'
  | 'NO_CAP_UNRECOVERABLE'
  | 'UNIT_MISMATCH'
  | 'OPTION_INTERVENTION_UNRESOLVABLE'
  | 'OPTIONS_NOT_CONFIGURED'
  | 'SCHEMA_INVALID'
  // No persisted graph at all (null/undefined) — distinct from SCHEMA_INVALID,
  // which is a present-but-malformed graph. NO_GRAPH means "create a model",
  // SCHEMA_INVALID means "fix the model you have".
  | 'NO_GRAPH'
  | CanonicalReadinessIssueCode
  | StructuralViolationCode
  | 'INTERNAL_ERROR';

export type ReadinessReasonCategory =
  | 'option_values'
  | 'graph_structure'
  | 'numeric_integrity'
  | 'internal';

export interface ReadinessResult {
  readonly status: ReadinessStatus;
  readonly reasonCodes: readonly ReadinessReasonCode[];
  readonly reasonCategory: ReadinessReasonCategory | null;
  readonly deterministicRecovery: boolean;
  readonly safeToAnalyse: boolean;
  readonly safeToPersist: boolean;
  readonly userActionRequired: boolean;
  /** The canonical graph (raw shape, option interventions promoted) when ready/repaired; null when unrecoverable. */
  readonly canonicalGraph: unknown | null;
  /** User-safe, no-internal-ID next step (only when unrecoverable). */
  readonly nextStep: string | null;
  /** Exhaustive structural + semantic record from the canonical authority. */
  readonly issues?: readonly CanonicalReadinessIssue[];
  /** Complete review plan only for a genuine two-or-more blocker state. */
  readonly repairProposal?: CanonicalReadinessRepairProposal | null;
}

// ============================================================================
// canonicaliseForAnalysis — deterministic, idempotent, total
// ============================================================================

/**
 * Return the canonical RAW graph (option interventions promoted/derived to the
 * top-level contract). Deterministic and IDEMPOTENT — already-canonical in →
 * structurally-equal out; total — never throws. Used to compute BOTH the
 * run-time `graph_hash_at_run` AND the later freshness hash from the SAME
 * projection, so a repaired run is not falsely stale (brief §6).
 */
export function canonicaliseForAnalysis(graph: unknown): unknown {
  try {
    return encodeOptionInterventionsForEdit(graph).graph;
  } catch {
    return graph;
  }
}

// ============================================================================
// assessAnalysisReadiness — the neutral core (TOTAL)
// ============================================================================

/**
 * Assess whether a persisted graph can be analysed. TOTAL — never throws.
 */
export function assessAnalysisReadiness(rawGraph: unknown): ReadinessResult {
  const assessment = assessCanonicalAnalysisReadiness(rawGraph);
  if (assessment.safeToAnalyse) {
    return {
      status: assessment.repairedForAnalysis ? 'repaired' : 'analysis_ready',
      reasonCodes: assessment.repairedForAnalysis ? ['OPTION_INTERVENTION_PROMOTED'] : [],
      reasonCategory: assessment.repairedForAnalysis ? 'option_values' : null,
      deterministicRecovery: assessment.repairedForAnalysis,
      safeToAnalyse: true,
      safeToPersist: true,
      userActionRequired: false,
      canonicalGraph: assessment.canonicalGraph,
      nextStep: null,
      issues: assessment.issues,
      repairProposal: null,
    };
  }
  const reasonCodes = [
    ...new Set(assessment.blockingIssues.map((issue) => issue.code)),
  ] as ReadinessReasonCode[];
  const first = assessment.blockingIssues[0];
  const reasonCategory: ReadinessReasonCategory =
    first?.category === 'graph_structure'
      ? 'graph_structure'
      : first?.category === 'numeric_integrity'
        ? 'numeric_integrity'
        : first?.category === 'internal'
          ? 'internal'
          : 'option_values';
  const nextStep = assessment.blockingIssues.length === 1
    ? first?.message ?? 'Review the model before analysis.'
    : `Review all ${assessment.blockingIssues.length} readiness issues together before analysis.`;
  return {
    status: 'unrecoverable',
    reasonCodes,
    reasonCategory,
    deterministicRecovery: false,
    safeToAnalyse: false,
    safeToPersist: false,
    userActionRequired: true,
    canonicalGraph: null,
    nextStep,
    issues: assessment.issues,
    repairProposal: assessment.repairProposal,
  };
}

// ============================================================================
// EP2 adapter (maps the neutral verdict → EP2 vocabulary)
// ============================================================================

export type Ep2State = 'ready' | 'repaired_for_analysis' | 'blocked';

export function ep2State(result: ReadinessResult): Ep2State {
  switch (result.status) {
    case 'analysis_ready':
      return 'ready';
    case 'repaired':
      return 'repaired_for_analysis';
    case 'unrecoverable':
    default:
      return 'blocked';
  }
}

// ============================================================================
// RUN ADMISSION — the TWO-TERM gate (row 2.1235 / NEW-1 / L-63)
// ============================================================================

/**
 * THE ONE ADMISSION PREDICATE. Both the `/graph-readiness` route and the V5 run
 * path read this, so "may analysis run?" has exactly one answer per graph.
 *
 * ## Why it exists — the drift it closes, measured
 *
 * F4 (21 Jul) fixed a readiness↔run disagreement in ONE direction: the run
 * proceeded on a partly-configured model while the panel said "blocked". The
 * cure was `scaffold_plan.will_scaffold_options` — a pre-run PROJECTION of what
 * `gateAnalysableOptions` would do — and the deployed UI composes it as
 *     allowed = can_run_analysis || scaffold_plan.will_scaffold_options
 * (`DecisionGuideAI@f15bccaf canRunAnalysis.ts:230-232`, `:255`).
 *
 * **#983 then moved the RUN's admission UPSTREAM of the gate that projection
 * describes, and the drift flipped direction.** `build-turn-context.ts` now
 * refuses on `assessAnalysisReadiness` alone — a ONE-term gate — and throws
 * before `run-analysis.ts` §2.55 can exclude anything. So the panel offers a Run
 * the server refuses: F4's symptom, mirrored.
 *
 * Measured at deployed CEE `2988eac` (2026-08-16), `/assist/v1/graph-readiness`,
 * three arms of one graph — the probe DISCRIMINATES, so this is not instrument
 * blindness:
 *
 *   | options configured | can_run_analysis | will_scaffold_options | diverges |
 *   |--------------------|------------------|-----------------------|----------|
 *   | 4 of 4             | true             | false                 | no       |
 *   | **2 of 4**         | **false**        | **true**              | **YES**  |
 *   | 0 of 4             | false            | false                 | no       |
 *
 * The mixed arm is what a FRESH DRAFT produces, which is why a first-time user
 * could not reach a single analysis in 24 minutes and 9 turns.
 *
 * ## What it does NOT do
 *
 * It never waives a blocker the exclusion cannot answer. A blocker is waivable
 * only when the run will drop or hold the very option it names — i.e. it is a
 * per-option `option_values` / `option_mapping` issue carrying an `option_id`
 * that {@link computeScaffoldPlan} lists as touched. A structural, numeric or
 * internal blocker (or an option-value blocker on an option that WILL be
 * submitted) keeps the refusal, because the run really would fail.
 *
 * ⭐ Nothing is fabricated by admitting. The excluded options are dropped from
 * the PLoT submission and disclosed BY NAME by the existing omitted-suffix
 * machinery (`coaching/scaffold-disclosure.ts`) — no minted values, no rank, no
 * win probability. Admission changes WHICH options are compared, never what any
 * number means.
 *
 * TOTAL: never throws. Any internal failure returns the strict verdict, i.e.
 * today's refusal — an admission gate must fail toward saying no.
 */
export interface RunAdmission {
  /** The strict, whole-model verdict — unchanged, always computed. */
  readonly strict: ReadinessResult;
  /** The pre-run projection of the run path's submission decision. */
  readonly plan: ScaffoldPlan;
  /**
   * True when the run WILL proceed: either the model is strictly ready, or
   * every blocker names an option the run is about to exclude/hold and at least
   * {@link computeScaffoldPlan}'s two-option minimum survives.
   */
  readonly willProceed: boolean;
  /** Options whose blockers are answered by exclusion/hold, not by the user. */
  readonly waivedOptionIds: readonly string[];
  /**
   * The strict value-preserving canonical graph, or null when a carrier is
   * unencodable. Null is safe — the caller falls back to the graph it holds.
   */
  readonly canonicalGraph: unknown | null;
}

/** A blocker the exclusion can answer: per-option, and on a touched option. */
function isWaivableByExclusion(
  issue: CanonicalReadinessIssue,
  touchedOptionIds: ReadonlySet<string>,
): boolean {
  if (issue.category !== 'option_values' && issue.category !== 'option_mapping') return false;
  return typeof issue.option_id === 'string' && touchedOptionIds.has(issue.option_id);
}

/**
 * Resolve the two-term admission for a graph. Pure and total.
 */
export function resolveRunAdmission(rawGraph: unknown): RunAdmission {
  const strict = assessAnalysisReadiness(rawGraph);
  const empty: ScaffoldPlan = {
    will_scaffold_options: false,
    option_count: 0,
    scaffolded_option_ids: [],
  };
  if (strict.status !== 'unrecoverable') {
    return {
      strict,
      plan: empty,
      willProceed: true,
      waivedOptionIds: [],
      canonicalGraph: strict.canonicalGraph,
    };
  }
  try {
    const assessment = assessCanonicalAnalysisReadiness(rawGraph);
    const canonicalGraph = assessment.canonicalGraph;
    const wireOptions = assessment.analysisReady?.options ?? [];
    if (wireOptions.length === 0) {
      return { strict, plan: empty, willProceed: false, waivedOptionIds: [], canonicalGraph: null };
    }
    // The SAME predicate the route advertises and `run_analysis` executes —
    // `computeScaffoldPlan` delegates to `gateAnalysableOptions` rather than
    // re-deriving, so there is deliberately no second predicate to keep in sync.
    const plan = computeScaffoldPlan({
      options: wireOptions.map((option) => ({
        id: option.option_id,
        option_id: option.option_id,
        label: option.label,
        interventions: option.interventions ?? {},
        // Carried through so a status-quo arm is HELD rather than excluded,
        // matching the run path's own gate input. Absent on the wire shape ⇒
        // undefined ⇒ `isBaselineOption`'s strict `=== true` excludes, which is
        // the conservative direction (fewer survivors ⇒ readier to refuse).
        ...((option as { is_baseline?: boolean }).is_baseline === true
          ? { is_baseline: true }
          : {}),
      })),
      graph: rawGraph,
      rawPersistedGraph: rawGraph,
      // Matches run_analysis' pinned-true call site (the egress scale net has
      // been unconditional since 2026-07-20, O-7 wave 2).
      scaleNetEnabled: true,
    });
    if (!plan.will_scaffold_options) {
      return { strict, plan, willProceed: false, waivedOptionIds: [], canonicalGraph };
    }
    const touched = new Set(plan.scaffolded_option_ids);
    const blockers = assessment.blockingIssues;
    // EVERY blocker must be answered by the exclusion. One that is not means the
    // run would fail after admission — the drift in the other direction, which
    // is exactly what F4 exists to prevent. An EMPTY blocker set cannot reach
    // here (the strict verdict was `unrecoverable`, which requires ≥1), and
    // `every` over an empty array is vacuously true, so it is rejected by name
    // rather than left to a silent vacuous pass.
    if (blockers.length === 0 || !blockers.every((i) => isWaivableByExclusion(i, touched))) {
      return { strict, plan, willProceed: false, waivedOptionIds: [], canonicalGraph };
    }
    return {
      strict,
      plan,
      willProceed: true,
      waivedOptionIds: [...touched],
      canonicalGraph,
    };
  } catch {
    // An admission gate fails toward saying no.
    return { strict, plan: empty, willProceed: false, waivedOptionIds: [], canonicalGraph: null };
  }
}

/**
 * The admitted verdict for a graph the two-term gate lets through. Reported as
 * `repaired` (not `analysis_ready`): the run is proceeding on a MODIFIED
 * submission, and calling that "ready" would overstate it.
 */
export function admittedVerdict(admission: RunAdmission): ReadinessResult {
  if (admission.strict.status !== 'unrecoverable') return admission.strict;
  return {
    status: 'repaired',
    reasonCodes: ['OPTIONS_NOT_CONFIGURED'],
    reasonCategory: 'option_values',
    deterministicRecovery: false,
    safeToAnalyse: true,
    safeToPersist: true,
    userActionRequired: false,
    canonicalGraph: admission.canonicalGraph,
    nextStep: null,
    issues: admission.strict.issues,
    repairProposal: null,
  };
}

/**
 * Thrown by the run_analysis snapshot reader when EP2 finds the persisted graph
 * `unrecoverable`. The run_analysis handler maps this to a typed `analysis_not_ready`
 * recoverable failure (a 200 with honest next-step copy + recovery chip) — NOT a
 * 500. Carries the neutral verdict so the composer can surface the reason/next-step.
 */
export class AnalysisNotReadyError extends Error {
  readonly verdict: ReadinessResult;
  constructor(verdict: ReadinessResult) {
    super(`Persisted graph is not analysis-ready: ${verdict.reasonCodes.join(',') || 'unknown'}`);
    this.name = 'AnalysisNotReadyError';
    this.verdict = verdict;
  }
}
