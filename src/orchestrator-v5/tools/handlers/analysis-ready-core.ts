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
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import type { StructuralViolationCode } from '../../../orchestrator/graph-structure-validator.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import { projectReadinessRecovery } from '../../coaching/readiness-recovery.js';

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

const STRUCTURAL_NEXT_STEP: Record<StructuralViolationCode, string> = {
  NO_GOAL: 'Add a goal before this scenario can be analysed.',
  NO_DECISION: 'Add a decision before this scenario can be analysed.',
  FEWER_THAN_TWO_OPTIONS: 'Add at least two options before analysing.',
  ORPHAN_NODE: 'Connect the disconnected item to the rest of the model before analysing.',
  NO_PATH_TO_GOAL: 'Connect the model so every option reaches the goal, then analyse.',
  CYCLE_DETECTED: 'Fix the graph structure — a circular dependency was detected.',
  OPTION_NO_FACTOR_EDGES: 'Give each option at least one factor effect before analysing.',
  // PR #413 review FIXUP 3 — floating option (no decision → option edge).
  OPTION_NOT_LINKED_TO_DECISION: 'Connect the decision to each option before analysing.',
  NODE_LIMIT_EXCEEDED: 'Simplify the model — it has too many items to analyse.',
  EDGE_LIMIT_EXCEEDED: 'Simplify the model — it has too many connections to analyse.',
};

function unrecoverable(
  reasonCodes: readonly ReadinessReasonCode[],
  reasonCategory: ReadinessReasonCategory,
  nextStep: string,
): ReadinessResult {
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
  };
}

type Dict = Record<string, unknown>;
function isPlainObject(v: unknown): v is Dict {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Classify WHY a touched option could not be encoded (read-only; mirrors the
 * decision points in #278 `deriveValue` without re-deriving): no resolvable cap
 * → NO_CAP_UNRECOVERABLE; intervention unit present and incompatible with the
 * factor unit → UNIT_MISMATCH; otherwise the generic unresolvable code. Used
 * only to pick the user-safe reason; the AUTHORITATIVE encodable/defer decision
 * remains #278's.
 */
function classifyUnresolvedOptions(
  graph: unknown,
  unresolvedIds: readonly string[],
): ReadinessReasonCode {
  try {
    if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return 'OPTION_INTERVENTION_UNRESOLVABLE';
    const factorById = new Map<string, Dict>();
    for (const n of graph.nodes) {
      if (isPlainObject(n) && n.kind === 'factor' && typeof n.id === 'string') factorById.set(n.id, n);
    }
    const unresolved = new Set(unresolvedIds);
    for (const node of graph.nodes) {
      if (!isPlainObject(node) || node.kind !== 'option') continue;
      if (typeof node.id !== 'string' || !unresolved.has(node.id)) continue;
      const bundle = isPlainObject(node.data) && isPlainObject(node.data.interventions)
        ? (node.data.interventions as Dict)
        : isPlainObject(node.interventions)
          ? (node.interventions as Dict)
          : {};
      for (const [fac, srcRaw] of Object.entries(bundle)) {
        const src = isPlainObject(srcRaw) ? srcRaw : {};
        if (finiteNum(src.value) !== undefined) continue; // value present → not the blocker
        // NO_CAP / UNIT_MISMATCH are honest blockers ONLY when there is actual raw-value
        // intent to normalise. An empty/malformed entry (no value AND no raw_value) is NOT a
        // missing-cap or unit problem — it falls through to the generic reason so the recovery
        // copy never wrongly tells the user the factor "needs a bound". (Codex 4524991061.)
        if (finiteNum(src.raw_value) === undefined) continue;
        const factor = factorById.get(fac);
        // Target factor doesn't resolve (or SHAPE-2 ambiguous): not specifically a cap or
        // unit problem → fall through to the generic OPTION_INTERVENTION_UNRESOLVABLE reason.
        if (factor === undefined) continue;
        const obs = isPlainObject(factor.observed_state) ? factor.observed_state : undefined;
        const interventionUnit = typeof src.unit === 'string' ? src.unit : undefined;
        const factorUnit = obs && typeof obs.unit === 'string' ? obs.unit : undefined;
        if (
          interventionUnit !== undefined &&
          factorUnit !== undefined &&
          interventionUnit.trim().toLowerCase() !== factorUnit.trim().toLowerCase()
        ) {
          return 'UNIT_MISMATCH';
        }
        const cap = finiteNum(src.cap) ?? (obs ? finiteNum(obs.cap) : undefined);
        if (cap === undefined) return 'NO_CAP_UNRECOVERABLE';
      }
    }
    return 'OPTION_INTERVENTION_UNRESOLVABLE';
  } catch {
    return 'OPTION_INTERVENTION_UNRESOLVABLE';
  }
}

const UNRESOLVED_NEXT_STEP: Record<string, string> = {
  NO_CAP_UNRECOVERABLE: 'Review the option values — this option needs a bound (cap) before it can be analysed.',
  UNIT_MISMATCH: "Review the option values — the unit doesn't match this factor.",
  OPTION_INTERVENTION_UNRESOLVABLE: 'Review the option values — at least one option cannot be analysed yet.',
};

/**
 * Assess whether a persisted graph can be analysed. TOTAL — never throws.
 */
export function assessAnalysisReadiness(rawGraph: unknown): ReadinessResult {
  try {
    if (rawGraph === undefined || rawGraph === null) {
      // No persisted graph at all (e.g. a guest scenario that never drafted/saved a
      // model). The honest next step is to CREATE a model, not to fix one — so this
      // is NO_GRAPH, not SCHEMA_INVALID.
      return unrecoverable(['NO_GRAPH'], 'graph_structure', 'Draft or save a model first, then run analysis.');
    }

    // 1. Canonicalise option interventions (value-preserving) + DEFER on unencodable (#278).
    const enc = encodeOptionInterventionsForEdit(rawGraph); // no touched set → every option may flag
    if (enc.unresolvedOptionIds.length > 0) {
      const code = classifyUnresolvedOptions(rawGraph, enc.unresolvedOptionIds);
      return unrecoverable([code], 'option_values', UNRESOLVED_NEXT_STEP[code] ?? UNRESOLVED_NEXT_STEP.OPTION_INTERVENTION_UNRESOLVABLE);
    }
    const canonical = enc.graph;
    const repaired = canonical !== rawGraph; // #278 returns a clone only when it changed something

    // 2. Baseline schema parse (on the canonical graph).
    const parsed = GraphV3.safeParse(canonical);
    if (!parsed.success) {
      return unrecoverable(['SCHEMA_INVALID'], 'graph_structure', 'This graph cannot be analysed — its structure is invalid.');
    }
    const parsedGraph: GraphV3T = parsed.data;

    // 3. Structural validity (cycle / orphan / path-to-goal / option-factor-edge / required kinds).
    const struct = validateGraphStructure(parsedGraph);
    if (struct.violations.length > 0) {
      const code = struct.violations[0].code;
      return unrecoverable([code], 'graph_structure', STRUCTURAL_NEXT_STEP[code] ?? 'Fix the graph structure before analysing.');
    }

    // 4. Canonical goal + whole-model completeness. The producer's payload
    // status is authoritative here; in particular an unreachable controllable
    // factor is `needs_user_mapping` even when every option already carries a
    // numeric effect. The former "any ready option" test admitted that graph.
    const readiness = buildCanonicalAnalysisReadyFromGraph(canonical);
    if (!readiness || !readiness.goal_node_id) {
      return unrecoverable(['NO_GOAL'], 'graph_structure', STRUCTURAL_NEXT_STEP.NO_GOAL);
    }
    if (readiness.status !== 'ready') {
      const recovery = projectReadinessRecovery(readiness, parsedGraph.nodes);
      return unrecoverable(
        ['OPTIONS_NOT_CONFIGURED'],
        'option_values',
        recovery.nextStep.replace(/^Next,\s*/i, ''),
      );
    }

    // 5. Ready / repaired.
    return {
      status: repaired ? 'repaired' : 'analysis_ready',
      reasonCodes: repaired ? ['OPTION_INTERVENTION_PROMOTED'] : [],
      reasonCategory: repaired ? 'option_values' : null,
      deterministicRecovery: repaired,
      safeToAnalyse: true,
      safeToPersist: true,
      userActionRequired: false,
      canonicalGraph: canonical,
      nextStep: null,
    };
  } catch {
    // TOTALITY: any unexpected failure resolves to unrecoverable, never a throw.
    return unrecoverable(['INTERNAL_ERROR'], 'internal', 'This graph could not be checked for analysis — please review it.');
  }
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
