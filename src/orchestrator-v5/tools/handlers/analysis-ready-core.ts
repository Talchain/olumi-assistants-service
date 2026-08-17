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
  return readinessResultFrom(assessCanonicalAnalysisReadiness(rawGraph));
}

/**
 * Map ONE canonical assessment to the neutral verdict.
 *
 * Split out of {@link assessAnalysisReadiness} so {@link resolveRunAdmission}
 * can reuse a single assessment instead of running the assessor twice.
 *
 * ⚠ THE PERFORMANCE FIGURE THIS COMMENT ORIGINALLY CARRIED IS WITHDRAWN. It
 * claimed "+19.5 ms per admission (12.9 → 32.3)". That was measured while a
 * full test suite and two sibling lanes' suites were running on the same
 * machine, so it described CPU contention, not this code. Re-measured clean,
 * warm, 300 iterations on the same graph: removing the duplicate assessment
 * saves **~4.7%** (5.44 ms → 5.18 ms per route call). Real, and an order of
 * magnitude smaller than advertised.
 *
 * ⭐ THE LOAD-BEARING REASON IS NOT SPEED — it is that two independent
 * assessments of one graph can, in principle, disagree, and a module whose
 * entire purpose is "one authority, one answer" must not contain two calls to
 * the authority. The saving is a bonus; the invariant is the point.
 */
function readinessResultFrom(
  assessment: ReturnType<typeof assessCanonicalAnalysisReadiness>,
): ReadinessResult {
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
  /**
   * The canonical assessment this admission was derived from.
   *
   * EXPOSED so a caller that also needs `analysisReady` / `blockingIssues` can
   * reuse THIS assessment instead of running the assessor a second time. The
   * `/graph-readiness` route did exactly that. The saving is modest (~4.7%,
   * measured clean — see `readinessResultFrom`, whose earlier and much larger
   * figure was contention and is withdrawn); the REASON is that two independent
   * calls could in principle disagree about one graph, which is the whole
   * hazard this module exists to remove.
   */
  readonly assessment: ReturnType<typeof assessCanonicalAnalysisReadiness>;
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

/**
 * The blocker codes the EXCLUSION genuinely answers — i.e. the ones that mean
 * *"nothing is set for this option"*.
 *
 * ⚠ KEYED ON CODE, NOT ON CATEGORY, AND THE DIFFERENCE IS AN HONESTY DEFECT I
 * SHIPPED AND A MUTANT CAUGHT. The first version of this predicate waived any
 * `option_values` / `option_mapping` blocker on a touched option. A mutant that
 * dropped the category check SURVIVED, which said the category was not doing the
 * discriminating work — and probing why produced a real case:
 *
 *   an option carrying `data.interventions: { fac_budget: { raw_value: 250000 } }`
 *   on a CAPLESS factor raises `NO_CAP_UNRECOVERABLE`, whose category is
 *   `option_values`, and whose WIRE projection has empty interventions — so it is
 *   "touched" by the exclusion plan and the category rule waived it.
 *
 * That option HAS a value. Excluding it makes the run proceed while the
 * disclosure says *"left out of this comparison because it has no values set"* —
 * **false**. A user's £250,000 becomes a sentence claiming they entered nothing.
 * Admission may absorb an ABSENCE; it may never absorb a value it cannot read.
 *
 * The five codes below are exactly the ones `blockerIssue` and
 * `appendSemanticIssues` emit when no usable value exists. The excluded ones —
 * `NO_CAP_UNRECOVERABLE`, `UNIT_MISMATCH`, `OPTION_INTERVENTION_UNRESOLVABLE`,
 * `AMBIGUOUS_OPTION_VALUE`, `CONSTRAINT_REVIEW_REQUIRED` — every one means a
 * value or a judgement IS present and is not yet usable. Those keep the refusal,
 * so the user is told the truth about their own input.
 *
 * This rides on a distinction the assessor already draws deliberately:
 * `analysis-ready-helper.ts` suppresses the duplicate `MISSING_OPTION_VALUE` on
 * any pair the strict encoder has already named (`strictEncoderPairs`), so the
 * two classes never collide on one option×factor.
 */
/**
 * ⚠ TWO CODES WERE REMOVED FROM THIS SET AS UNREACHABLE, derived at the bytes
 * with a contrast control in the same sweep (an absence claim needs one):
 *
 *   - `UNREACHABLE_CONTROLLABLE_FACTOR` — `analysis-ready-helper.ts:612` emits
 *     it ONLY inside a branch guarded by `!optionId`, so the issue can never
 *     carry an `option_id`, so the second conjunct below can never hold. It was
 *     dead the moment it was written.
 *   - `MISSING_OPTION_CONNECTION` — requires `blocker_type: 'missing_connection'`,
 *     which NO producer in this repo emits. Sweep over `blocker_type:` writes:
 *     `missing_value` × 2 and `constraint_dropped` × 1 (the contrast reads
 *     non-zero, so the probe can see producers), `missing_connection` × 0.
 *
 * They are removed rather than kept-and-commented: an allowlist entry that can
 * never match reads as coverage it does not provide, and a branch no production
 * path can reach — kept alive by its own tests — is how a rule quietly stops
 * being enforced. Removal is also the FAIL-SAFE direction: if either code gains
 * a producer, the run refuses rather than silently waiving something new. The
 * two reachability facts are pinned by tests, so they RED if either changes.
 */
const WAIVABLE_BY_EXCLUSION: ReadonlySet<string> = new Set<string>([
  'MISSING_OPTION_VALUE',
  'OPTION_NEEDS_ENCODING',
  'OPTION_NEEDS_MAPPING',
]);

/**
 * Mark one blocker as answered by the exclusion rather than by the user.
 *
 * ⚠ Scoped to the blockers the exclusion GENUINELY answers, not to every blocker
 * on an admitted graph. A structural blocker on a graph admitted by exclusion is
 * still the user's to fix, and stamping it waived would make the offer copy lie
 * about which options are being dropped.
 */
function stampWaiver(
  issue: CanonicalReadinessIssue,
  touchedOptionIds: ReadonlySet<string>,
): CanonicalReadinessIssue {
  return isWaivableByExclusion(issue, touchedOptionIds)
    ? { ...issue, waived_by_exclusion: true }
    : issue;
}

/** A blocker the exclusion can answer: nothing-is-set, and on a touched option. */
function isWaivableByExclusion(
  issue: CanonicalReadinessIssue,
  touchedOptionIds: ReadonlySet<string>,
): boolean {
  if (!WAIVABLE_BY_EXCLUSION.has(issue.code)) return false;
  return typeof issue.option_id === 'string' && touchedOptionIds.has(issue.option_id);
}

/**
 * Resolve the two-term admission for a graph. Pure and total.
 */
export function resolveRunAdmission(rawGraph: unknown): RunAdmission {
  const empty: ScaffoldPlan = {
    will_scaffold_options: false,
    option_count: 0,
    scaffolded_option_ids: [],
  };
  // ONE assessment, shared by the strict verdict and the exclusion projection.
  // Not primarily for speed (~4.7%): two independent assessments of one graph
  // could disagree, and this module exists to make that impossible.
  let assessment: ReturnType<typeof assessCanonicalAnalysisReadiness>;
  let strict: ReadinessResult;
  try {
    assessment = assessCanonicalAnalysisReadiness(rawGraph);
    strict = readinessResultFrom(assessment);
  } catch {
    // `assessCanonicalAnalysisReadiness` is declared TOTAL and carries its own
    // internal catch, so this is belt-and-braces. It builds the refusal INLINE
    // rather than re-calling the function that just threw — a fallback whose
    // first act is to repeat the failing call is not a fallback.
    // The assessor threw, so there is no assessment to expose. Synthesise the
    // same refusal shape rather than re-calling it — a fallback whose first act
    // is to repeat the failing call is not a fallback.
    const internalIssue: CanonicalReadinessIssue = {
      issue_id: 'internal_1',
      code: 'INTERNAL_ERROR',
      category: 'internal',
      message: 'This model could not be checked safely.',
      repairability: 'human_input_required',
    };
    return {
      strict: {
        status: 'unrecoverable',
        reasonCodes: ['INTERNAL_ERROR'],
        reasonCategory: 'internal',
        deterministicRecovery: false,
        safeToAnalyse: false,
        safeToPersist: false,
        userActionRequired: true,
        canonicalGraph: null,
        nextStep: 'This model could not be checked safely. Review it, then run the analysis again.',
        issues: [internalIssue],
      },
      assessment: {
        analysisReady: undefined,
        issues: [internalIssue],
        blockingIssues: [internalIssue],
        repairProposal: null,
        canonicalGraph: null,
        proposedGraph: null,
        repairedForAnalysis: false,
        safeToAnalyse: false,
      },
      plan: empty,
      willProceed: false,
      waivedOptionIds: [],
      canonicalGraph: null,
    };
  }
  if (strict.status !== 'unrecoverable') {
    return {
      strict,
      assessment,
      plan: empty,
      willProceed: true,
      waivedOptionIds: [],
      canonicalGraph: strict.canonicalGraph,
    };
  }
  try {
    const canonicalGraph = assessment.canonicalGraph;
    const wireOptions = assessment.analysisReady?.options ?? [];
    if (wireOptions.length === 0) {
      return { strict, assessment, plan: empty, willProceed: false, waivedOptionIds: [], canonicalGraph: null };
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
      return { strict, assessment, plan, willProceed: false, waivedOptionIds: [], canonicalGraph };
    }
    const touched = new Set<string>(plan.scaffolded_option_ids);
    const blockers = assessment.blockingIssues;
    // EVERY blocker must be answered by the exclusion. One that is not means the
    // run would fail after admission — the drift in the other direction, which
    // is exactly what F4 exists to prevent. An EMPTY blocker set cannot reach
    // here (the strict verdict was `unrecoverable`, which requires ≥1), and
    // `every` over an empty array is vacuously true, so it is rejected by name
    // rather than left to a silent vacuous pass.
    if (blockers.length === 0 || !blockers.every((i) => isWaivableByExclusion(i, touched))) {
      return { strict, assessment, plan, willProceed: false, waivedOptionIds: [], canonicalGraph };
    }
    // ⭐ MOVE 1 — THE UNIT OF THE FIX IS THE BLOCKER, NOT A NEW BOOLEAN.
    //
    // The run is about to proceed by excluding or holding the options these
    // blockers name. Stamp that ON EACH BLOCKER so the offer can say it out loud
    // ("Run analysis — I'll leave out Option B and Option C") instead of a panel
    // rendering an unqualified refusal beside an enabled Run button. That
    // simultaneous offer-and-refuse is the founder-witnessed screenshot, and no
    // response-level boolean can express it: in that state the offer is TRUE and
    // the blockers are TRUE, and the harm is that neither is qualified.
    //
    // Stamped here rather than in the assessor because only the ADMISSION knows
    // the exclusion plan — the assessor is deliberately ignorant of it.
    const waivedAssessment: typeof assessment = {
      ...assessment,
      issues: assessment.issues.map((issue) => stampWaiver(issue, touched)),
      blockingIssues: blockers.map((issue) => stampWaiver(issue, touched)),
    };
    return {
      strict,
      assessment: waivedAssessment,
      plan,
      willProceed: true,
      waivedOptionIds: [...touched],
      canonicalGraph,
    };
  } catch {
    // An admission gate fails toward saying no.
    return { strict, assessment, plan: empty, willProceed: false, waivedOptionIds: [], canonicalGraph: null };
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
