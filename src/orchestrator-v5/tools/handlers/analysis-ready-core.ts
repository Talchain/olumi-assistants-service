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
