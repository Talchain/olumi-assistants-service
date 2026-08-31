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
import type { GraphPatchBlockData } from '../../../orchestrator/types.js';
import {
  assessCanonicalAnalysisReadiness,
  type CanonicalReadinessIssue,
  type CanonicalReadinessIssueCode,
  type CanonicalReadinessRepairProposal,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import {
  computeScaffoldPlan,
  PLOT_MIN_COMPARISON_OPTIONS,
  type ScaffoldPlan,
} from './analysable-option-gate.js';

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
  /**
   * The next step to PUT TO THE USER, or `null` when the run will proceed.
   *
   * ⚠⚠ THIS EXISTS BECAUSE `strict.nextStep` ANSWERS A DIFFERENT QUESTION AND
   * THE TWO WERE BEING TOLD APART BY HAND, AT ONE CALL SITE.
   *
   * `strict.nextStep` is the STRICT term's prescription — "what would the user
   * have to fix for the WHOLE model to be analysable". It is legitimately
   * non-null while {@link willProceed} is true, because the two terms answer
   * different questions (that is the entire point of a two-term gate). But it
   * reads as an obligation, and rendering it while the run proceeds tells the
   * user to "review all N readiness issues together BEFORE ANALYSIS" about an
   * analysis that is about to run anyway — a demand the system does not impose.
   * That is the manufactured-obligation defect, one level up from the blockers
   * `stampWaiver` already qualifies.
   *
   * Until now the rule `willProceed ? null : strict.nextStep` was written out by
   * hand at `edit-graph-dispatch.ts`, the single consumer that needed it. One
   * hand-kept copy of a coherence rule is a mirror waiting to drift, and the
   * next consumer to read `strict.nextStep` directly would have shipped the
   * incoherence with nothing to catch it. Derived here, once, so no consumer can
   * get it wrong: if you want the sentence to show a user, this is the field.
   *
   * Surfaced by the graph-size lane, which removed a spurious structural blocker
   * and thereby moved a real witness fixture from `willProceed:false` to
   * `willProceed:true` for the first time — the state in which the two fields
   * disagree.
   */
  readonly blockedNextStep: string | null;
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
 * ⭐⭐ THE SECOND WAIVER, AND IT ANSWERS A DIFFERENT QUESTION FROM THE FIRST.
 * The two are named apart deliberately: this estate's most expensive defect
 * class is two authorities under one name (CLAUDE.md trap 21), and collapsing
 * these into one predicate is exactly how that starts.
 *
 *   `isWaivableByExclusion`     — *"is the run about to DROP the option this
 *                                 blocker names?"* If so nothing is analysed
 *                                 for it, so the missing value cannot matter.
 *   `isWaivableByComputeDiscard` — *"may this gap be DEMANDED of the user at
 *                                 all, and does the compute consume it?"* It
 *                                 answers the first half by CONSULTING the
 *                                 existing `obligation` stamp rather than
 *                                 minting a rival predicate beside it.
 *
 * ## Why a missing option×factor value on a VALUED option is not consumed
 *
 * The blocker is minted per option→factor EDGE (`cee/transforms/analysis-ready.ts`).
 * **PLoT strips every edge incident to an `option`/`decision`/`constraint` node
 * before the graph reaches the engine** (`plot-lite-service`
 * `src/normalisation/option-filter.ts:93-97`, staging `3a3bee58`), so
 * `option.interventions` is the ONLY channel by which an option touches a
 * factor. An option→factor edge with no matching intervention key is a **no-op
 * at the compute** — CEE was minting a mandatory obligation from an artefact
 * the engine never receives.
 *
 * What the engine actually does with a factor the option does not intervene on
 * (`Inference-Service-Layer` `src/services/robustness_analyzer_v2.py:1428-1452`,
 * staging `28fe0c95`) is one of three things, none of them a refusal: it is
 * SAMPLED every Monte Carlo iteration when it carries a `parameter_uncertainty`
 * (shared across options as common random numbers, so it widens the outcome
 * distribution without differentiating the arms); it is HELD at
 * `observed_state.value` when it is a root; or it is RECOMPUTED from its parents
 * by the structural equation when it is not. Uncertainty is represented, not
 * invented.
 *
 * ⚠ AND THE PART THAT IS **NOT** WAIVED, STATED SO IT IS NOT LOST: PLoT's
 * preflight refuses an option whose `interventions` map is EMPTY
 * (`validation/preflight-v2.ts:184-187` — `Object.keys(...).length === 0`, and
 * nothing else). That refusal is real, so this waiver requires the option to
 * carry **at least one** real value, and requires at least
 * {@link PLOT_MIN_COMPARISON_OPTIONS} options to carry one. A wholly-empty
 * option is still the exclusion's business, not this one's.
 *
 * ⚠ SCOPE, because a waiver that grows is how a gate stops being a gate: ONLY
 * `MISSING_OPTION_VALUE`. `OPTION_NEEDS_ENCODING` and `OPTION_NEEDS_MAPPING`
 * are NOT here — an unencodable or unmapped value is not a value the compute
 * silently handles, it is one CEE could not resolve. Structural, numeric,
 * ambiguous-value and internal blockers keep the refusal exactly as before.
 *
 * ⚠ EVIDENCE CLASS: the PLoT/ISL facts above are STATIC READS of those repos'
 * own bytes at the SHAs named — not execution witnesses. They are why this
 * waiver is *correct*; they are not why it is *safe*. What makes it safe is the
 * monotonicity invariant it restores, which IS proven by execution against this
 * module (`__tests__/run-admission-monotonicity.test.ts`).
 */
function isWaivableByComputeDiscard(
  issue: CanonicalReadinessIssue,
  valuedOptionIds: ReadonlySet<string>,
): boolean {
  // (1) THE PER-(OPTION,FACTOR) AXIS ONLY. The over-demand that has been
  //     measured is confined to this axis; every other blocker code keeps its
  //     refusal until compute's discard is proven for it SEPARATELY.
  if (issue.code !== 'MISSING_OPTION_VALUE') return false;

  // (2) ⭐ THE EXISTING AUTHORITY — CONSULTED, NOT RE-DERIVED.
  //     `classifyIssueObligation` (`cee/graph-readiness/obligation-provenance.ts`)
  //     already stamps every issue with `obligation`, and its rule is one line in
  //     one place by design: *"`user_stated` and only `user_stated` earns a
  //     demand"* (`obligationFor`). An option→factor effect is `user_stated` only
  //     when BOTH ends are the user's — the weakest end wins — so a gap over
  //     structure the DRAFTER authored is `offered`, i.e. it may be put to the
  //     user as an offer and never as a demand.
  //
  //     That is exactly the defect this fix exists to remove: readiness was
  //     minting a MANDATORY per-(option,factor) obligation from an edge no user
  //     drew. Reading the stamped field rather than writing a second predicate is
  //     deliberate — a rival authority beside this one is the defect class this
  //     estate pays for most often, and `obligation-provenance.ts` says so itself.
  //
  //     `undefined` is treated as NOT waivable: an unstamped issue means the
  //     classifier did not run, and a missing verdict must not read as consent.
  if (issue.obligation !== 'offered') return false;

  // (3) PLoT'S REAL REFUSAL, WHICH IS NOT WAIVED. `EMPTY_INTERVENTIONS` fires on
  //     `Object.keys(option.interventions ?? {}).length === 0` and nothing else
  //     (`plot-lite-service` `src/validation/preflight-v2.ts:184-187`, staging
  //     `3a3bee58`), and a blocker fails the whole preflight. So the option must
  //     carry at least ONE real value. Without this conjunct an empty option's
  //     blocker would be waived here and the run would be admitted straight into
  //     a preflight refusal — F4 drift in the false-admission direction.
  return typeof issue.option_id === 'string' && valuedOptionIds.has(issue.option_id);
}

/**
 * PLoT's `IDENTICAL_OPTIONS` floor, in ONE place for BOTH admission paths.
 *
 * ⭐⭐ THIS IS A MODULE-LEVEL FUNCTION FOR A MEASURED REASON. It used to be a
 * closure inside the `strict.status === 'unrecoverable'` waiver branch, which
 * made it UNREACHABLE on the strictly-ready path — and a strictly-ready graph
 * whose options carry the SAME intervention map was therefore admitted straight
 * into a preflight refusal. Measured 2026-08-26, both sides run, CEE `d80e8133`
 * / PLoT `3a3bee58`: CEE `willProceed: true`, `waivedOptionIds: []`,
 * assessment `status: "ready"`; PLoT `runPreflightValidation` on that exact
 * snapshot → `blockers: ["IDENTICAL_OPTIONS"]`. Contrast, same probe, distinct
 * values → `blockers: []`.
 *
 * ⚠ THE CAUSE WAS NOT FINGERPRINT DRIFT — the two fingerprints AGREE (both
 * produced `"fac_velocity:0.5"`). A guard can be correct and simply never run;
 * "the predicate matches PLoT's" and "the predicate is reached" are different
 * claims, and only the second one was false.
 *
 * Mirrors `plot-lite-service` `src/validation/identical-options.ts`
 * (`canonicaliseInterventions` + `deduplicateOptions`) and the blocker at
 * `src/validation/preflight-v2.ts:443-449`, staging `3a3bee58`: an option is
 * fingerprinted as its `nodeId:value` pairs, sorted, values snapped to 1e-9;
 * options sharing a fingerprint collapse; fewer than two survivors is the
 * blocker.
 *
 * ⚠ KNOWN NARROWER THAN PLoT, DELIBERATELY. PLoT collapses every non-numeric
 * value to `NaN`, so two options with DIFFERENT invalid values fingerprint
 * IDENTICALLY there and distinctly here. That divergence is NOT closed, because
 * whether a non-numeric value can reach this function is UNPROVEN —
 * `resolveRunAdmission` takes `unknown`, but the validated contract types
 * interventions as `number | { value: number }`. Closing it on an unproven
 * reachability would be guessing. Settle the reachability first, then close it.
 */
function comparisonSurvivesDedup(
  wireOptions: ReadonlyArray<{ interventions?: Record<string, unknown> }>,
): boolean {
  const fingerprint = (o: { interventions?: Record<string, unknown> }): string =>
    Object.entries(o.interventions ?? {})
      .map(([key, raw]) => {
        const v =
          raw !== null && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
            ? (raw as { value: unknown }).value
            : raw;
        return `${key}:${typeof v === 'number' ? Math.round(v / 1e-9) * 1e-9 : String(v)}`;
      })
      .sort()
      .join('|');
  const distinctValuedMaps = new Set<string>(
    wireOptions
      .filter((o) => Object.keys(o.interventions ?? {}).length > 0)
      .map((o) => fingerprint(o)),
  );
  return distinctValuedMaps.size >= PLOT_MIN_COMPARISON_OPTIONS;
}

/**
 * The next step for a refusal that STRICT READINESS had no complaint about.
 *
 * ── WHY THIS CONSTANT EXISTS ───────────────────────────────────────────────
 * The two admission terms answer different questions (trap 21). Strict
 * readiness asks *"is each option individually well-formed?"*; the
 * `IDENTICAL_OPTIONS` floor asks *"is there a comparison here at all?"*. A
 * graph can pass the first and fail the second — most cleanly when it holds NO
 * alternatives, which is the legitimate exploratory-map shape a team reaches
 * when they have named what they think is going on but no course of action yet.
 *
 * In that cell `strict.nextStep` is `null`, because strict readiness had
 * nothing to say. The refusal therefore reached the user with `willProceed:
 * false` and NO reason and NO next step — measured at `1a3f8c56`. Every other
 * refusal in the branch space carried a sentence; only this one was silent.
 *
 * That silence is the failure mode this product can least afford: a team brings
 * competing EXPLANATIONS, the model correctly declines to rank them, and says
 * nothing about why or what would help. The honest answer is not to invent a
 * comparison so the run can proceed — it is to say plainly that there is
 * nothing to compare yet, and to ask for the thing that is genuinely missing.
 *
 * ⚠ COACHING, NOT AN APOLOGY, and not an error. It names the user's next move.
 */
export const NO_COMPARISON_NEXT_STEP =
  'Name at least two different options you are weighing, then run analysis.';

/**
 * Resolve the two-term admission for a graph. Pure and total.
 */
export function resolveRunAdmission(rawGraph: unknown): RunAdmission {
  // ⭐ ONE DERIVATION OF THE COHERENCE RULE, wrapping the seven return sites
  // below rather than adding an eighth thing each of them must remember. Every
  // one of those returns already sets `willProceed`; deriving
  // `blockedNextStep` from it here makes the two structurally incapable of
  // disagreeing. Same reasoning as `readinessResultFrom`'s single-assessment
  // rule directly above: a module whose purpose is "one authority, one answer"
  // must not contain two places where that answer is computed.
  //
  // ⭐⭐ AND THE COROLLARY THAT WAS MISSING: A REFUSAL MUST NEVER BE SILENT.
  // `strict.nextStep` is `null` whenever strict readiness had no complaint, so
  // inheriting it unconditionally produced a refusal with no reason for every
  // graph refused by the SECOND term alone (see `NO_COMPARISON_NEXT_STEP`).
  //
  // ⛔ THE `??` IS EXACT AND MUST STAY EXACT. It fills ONLY an absent reason. A
  // specific refusal — "Draft or save a model first", "Review all 2 readiness
  // issues" — keeps its own sentence untouched, because replacing those with
  // this generic one would delete working guidance from three branches to fix
  // one, which is strictly worse than the defect. Both directions are pinned in
  // `tests/unit/analysis-refusal-carries-a-reason.test.ts`.
  const admission = resolveRunAdmissionTerms(rawGraph);
  return {
    ...admission,
    blockedNextStep: admission.willProceed
      ? null
      : admission.strict.nextStep ?? NO_COMPARISON_NEXT_STEP,
  };
}

function resolveRunAdmissionTerms(
  rawGraph: unknown,
): Omit<RunAdmission, 'blockedNextStep'> {
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
    // ⭐ THE IDENTICAL_OPTIONS FLOOR APPLIES HERE TOO. Strictly ready means "every
    // option is individually well-formed"; it says NOTHING about whether the
    // options DIFFER FROM EACH OTHER. PLoT's `IDENTICAL_OPTIONS` is a predicate
    // over the option SET, so a graph can be strictly ready and still carry no
    // comparison at all — which is exactly the state this branch used to admit.
    //
    // ⛔ DIRECTION, and it is the same argument the waiver branch makes: a false
    // admission here dies as an opaque HTTP 422 a network hop away, at the wrong
    // layer. A local refusal is immediate and explicable. This floor can only
    // convert a false admission into a refusal, and every case it converts is one
    // PLoT refuses anyway — so it cannot cost a run that would have succeeded.
    if (!comparisonSurvivesDedup(assessment.analysisReady?.options ?? [])) {
      return {
        strict,
        assessment,
        plan: empty,
        willProceed: false,
        waivedOptionIds: [],
        canonicalGraph: strict.canonicalGraph,
      };
    }
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
    // ⭐ REPAIR MONOTONICITY (founder ruling, 2026-08-25), SCOPED — and the
    // scope is a measured boundary, not a hedge:
    //
    //   "USER INFORMATION THAT KEEPS THE OPTION SET DISTINGUISHABLE cannot make
    //    the model less analysable."
    //
    // ⚠ THE UNQUALIFIED FORM IS VERY SLIGHTLY TOO STRONG, and the exception is
    // REAL rather than a defect to be fixed later. Two options whose
    // intervention maps become IDENTICAL are, for analysis purposes, ONE option
    // — so user information that collapses two options into one genuinely DOES
    // reduce analysability, and refusing is the honest answer. The distinct-map
    // floor below therefore adds EXACTLY ONE monotonicity violation
    // (`collision_2opt`, pinned in `run-admission-monotonicity.test.ts`).
    // Stating the invariant unqualified with a known exception is the shape that
    // goes stale and then licenses a weakened test; a scoped claim with the
    // boundary named survives (CLAUDE.md trap 22f).
    //
    // Options carrying AT LEAST ONE real value.
    //
    // ⚠⚠ PREMISE CORRECTED IN PLACE, 2026-08-26 (PR #1129 review, Gate 2) —
    // OLD SENTENCE RETAINED SO THE NARROWER ORIGINAL PREMISE STAYS VISIBLE:
    //   ~~"PLoT's `EMPTY_INTERVENTIONS` predicate is exactly this emptiness test
    //     AND NOTHING ELSE (`preflight-v2.ts:184-187`), so an option in this set
    //     is one PLoT will accept."~~
    // **That is FALSE at PLoT's bytes.** A NON-EMPTY option can still trip
    // several preflight blockers — so "non-empty ⇒ PLoT will accept" does not
    // hold. `constraint` is also NOT in `NON_CAUSAL_NODE_KINDS`. The old claim
    // was inherited from a narrower reading that PLoT has already flagged against
    // itself.
    //
    // ⚠⚠ THE BLOCKER COUNTS BELOW WERE RE-DERIVED 2026-08-26 AT PLoT `3a3bee58`,
    // AND THE PREVIOUS SENTENCE HERE WAS A HAND-MAINTAINED MIRROR — it read
    // "18 distinct blocker codes, ALL LIVE ON THE V2 RUN PATH". The 18 is right;
    // the "all" is what had drifted. THREE DIFFERENT LEVELS, named separately,
    // because flattening them is how this comment went wrong in the first place:
    //
    //   • **24** — codes DECLARED in `BLOCKER_CODES`
    //     (`plot-lite-service` `src/types/engine-v3.ts:813`). That array is
    //     PLoT's own declared source of truth; derive from it, never re-type it.
    //   • **18** — codes reachable through PREFLIGHT: 14 emitted inside
    //     `runPreflightValidation` (`src/validation/preflight-v2.ts:861`) plus 4
    //     blocker-severity codes from `validateGoalConstraints` (`:534`, a
    //     SEPARATE entry point — it is NOT called by `runPreflightValidation`).
    //     The old sentence's parenthetical "14 + 4" was correct.
    //   • **22** — codes live on the V2 RUN PATH: the 18 above plus
    //     `GOAL_NODE_NOT_CAUSAL` (`routes/v2/run.ts:5519`) and three categorical
    //     codes via `validation/categorical-detector.ts`, none of which pass
    //     through preflight at all. The remaining 2 of the 24 are elsewhere:
    //     `IDENTIFIABILITY_ISSUE` (`trust/critique-builder.ts`) and
    //     `ISL_CANNOT_IDENTIFY` (`routes/v1/run.ts` — the V1 path, not this one).
    //
    // ⭐ AND THE SHARPER FACT, which the counts alone hide: CEE's ENTIRE blocking
    // vocabulary is THREE kinds (`canonicalise_option_interventions`,
    // `missing_value`, `model_structure`), and **13 of PLoT's 24 codes have ZERO
    // references anywhere in CEE `src/`, measured at CEE `02058e1f` — this PR's
    // reviewed head, and re-measured unchanged at the commit that corrected this
    // paragraph — against PLoT `3a3bee58`** (same-sweep contrast:
    // `IDENTICAL_OPTIONS` = 50 lines / 18 files, so the sweep was not blind;
    // zero + non-zero = 24, so it was not short either).
    //
    // ⚠ THE CEE ANCHOR ABOVE READ `02058e1e` UNTIL 2026-08-27 AND DID NOT RESOLVE
    // — one character off, and inherited from a brief rather than derived.
    // Corrected to `02058e1f`. Recorded rather than silently repaired, because an
    // unresolvable sha is WORSE than no sha: it reads as verifiable, so a reader
    // who trusts it stops looking. Both anchors here are now checked with
    // `git cat-file -t` in their own repos (a bogus sha fatals, so the check
    // discriminates); PLoT `3a3bee58` also verified an ancestor of PLoT staging. The gap is not "a few violations" — it is a refusal
    // vocabulary CEE has largely never heard of, and a floor can only be written
    // for a code someone has read.
    //
    // ⚠⚠ THIS FIGURE IS TIP-RELATIVE AND SELF-REFERENTIAL — WHICH IS WHY IT NOW
    // CARRIES A COMMIT. Corrected 2026-08-26 (PR #1143 review): the number
    // shipped here as **14**, and 14 is wrong at every tip — it measures **15**
    // at base `d80e8133` and **13** at head, because THIS PR's own prose adds the
    // first CEE references to two previously-unmentioned codes. A zero-reference
    // count is moved BY THE ACT OF NAMING A CODE IN THIS COMMENT, so anyone
    // citing a blocker code here must re-derive the count in the same commit.
    // The contrast figure was sound (40 lines at base, matching exactly), so the
    // original sweep was real and only its headline was mis-transcribed — a bare
    // count is a hand-maintained mirror the moment the tree moves, which is
    // precisely the defect this whole block was written to abolish. Re-derive:
    // for each code in PLoT's `BLOCKER_CODES`, `git grep -a -F <code> <rev> -- src`.
    //
    // WHAT THE WAIVER ACTUALLY COVERS, stated as what it is: *the one blocker
    // this waiver's population can newly trip is `IDENTICAL_OPTIONS` — and that
    // one is closed by the distinct-map floor below.* The waiver is not a claim
    // that PLoT accepts everything non-empty.
    // See {@link isWaivableByComputeDiscard} and {@link comparisonSurvivesDedup}.
    const valued = new Set<string>(
      wireOptions
        .filter((o) => Object.keys(o.interventions ?? {}).length > 0)
        .map((o) => o.option_id)
        .filter((id): id is string => typeof id === 'string'),
    );
    // The two-option minimum is PLoT's `options.minItems: 2` (`routes/v2/run.ts:1455`)
    // and `buildBandedHeadline`'s "no comparative claim without a comparison".
    // It is LOAD-BEARING here for the same reason it is inside
    // `computeScaffoldPlan`: admitting a run PLoT will refuse is the F4 drift in
    // the other direction.
    // ⭐ PLoT does not need two VALUED options — it needs two DISTINCT ones.
    // `identical-options.ts:102-119` fingerprints an option as its sorted
    // `nodeId:value` pairs (snapped to 1e-9) and DEDUPLICATES; when fewer than
    // two unique remain, `preflight-v2.ts:443-449` raises the
    // `IDENTICAL_OPTIONS` BLOCKER and the run 422s. Counting valued options
    // rather than distinct ones admits precisely the partly-specified states
    // where two maps most likely coincide — measured: two options each carrying
    // only `{fac_a: 0.5}` are refused at base and ADMITTED without this.
    //
    // ⛔ DIRECTION IS WHY THIS IS THE HONEST SIDE: a false admission here dies as
    // an opaque HTTP 422 a network hop away, at the wrong layer, on the
    // two-option minimum. A local refusal is immediate and explicable.
    const comparisonSurvives = comparisonSurvivesDedup(wireOptions);
    const blockers = assessment.blockingIssues;
    const touched = new Set<string>(plan.scaffolded_option_ids);

    // ⭐⭐ THE TWO WAIVERS COMPOSE PER BLOCKER, NOT PER ROUTE — and getting this
    // wrong is a NON-MONOTONICITY ALL BY ITSELF, measured on the lattice
    // (`__tests__/run-admission-monotonicity.test.ts`).
    //
    // A graph can carry BOTH kinds of blocker at once: a wholly-empty option the
    // run will EXCLUDE, beside a partly-valued option the run will SUBMIT. When
    // the routes were tried one after the other, each answered its own blockers
    // and neither answered all of them, so the graph refused — and adding one
    // value to the partly-valued option is precisely what creates that mixture.
    // Nine lattice violations survived a two-route version of this fix; they are
    // all that shape.
    //
    // Each waiver carries its OWN viability precondition rather than sharing
    // one, because they are viable for different reasons: the exclusion needs
    // the run to actually be dropping/holding options and still have two left
    // (`plan.will_scaffold_options`), while the compute-discard needs two
    // options carrying values for PLoT to compare. Folding those into a single
    // condition would be the two-questions-one-name defect this fix exists to
    // remove.
    const answeredByExclusion = (i: CanonicalReadinessIssue): boolean =>
      plan.will_scaffold_options && isWaivableByExclusion(i, touched);
    const answeredByComputeDiscard = (i: CanonicalReadinessIssue): boolean =>
      comparisonSurvives && isWaivableByComputeDiscard(i, valued);

    // EVERY blocker must be answered by one of the two. One that is not means
    // the run would fail after admission — the drift in the other direction,
    // which is exactly what F4 exists to prevent. An EMPTY blocker set cannot
    // reach here (the strict verdict was `unrecoverable`, which requires ≥1),
    // and `every` over an empty array is vacuously true, so it is rejected by
    // name rather than left to a silent vacuous pass.
    if (
      blockers.length === 0 ||
      !blockers.every((i) => answeredByExclusion(i) || answeredByComputeDiscard(i))
    ) {
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
 * ⭐ THE NAMED QUESTIONS BEHIND A REFUSAL — derived here because this module
 * already owns `nextStep`, i.e. "what do I tell the user is outstanding".
 *
 * `nextStep` answers that question as a COUNT ("Review all 6 readiness issues
 * together before analysis."). This answers it as the LIST. They are the same
 * question at two grains, so they live together: a second module deriving the
 * list would be a second authority on what is outstanding, which is the defect
 * shape this file exists to remove.
 *
 * The content is not composed here and is never invented: every prompt is
 * `repairProposal.unresolved_inputs[].prompt`, already minted by
 * `requiredInputForIssue` from the issue's own message, and already carrying
 * the option and factor the issue names. This function only SELECTS.
 *
 * ⚠ WITNESSED 2026-08-20: the refusal printed the count and discarded all six
 * prompts, having just told the user (via the panel) to "ask in the chat what
 * they need". CEE was holding the answer at the moment it said it could not
 * break the blockers out by name.
 */
export function readinessQuestions(verdict: ReadinessResult): readonly string[] {
  const inputs = verdict.repairProposal?.unresolved_inputs ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const input of inputs) {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (prompt.length === 0 || seen.has(prompt)) continue;
    seen.add(prompt);
    out.push(prompt);
  }
  return out;
}

/**
 * Thrown by the run_analysis snapshot reader when EP2 finds the persisted graph
 * `unrecoverable`. The run_analysis handler maps this to a typed `analysis_not_ready`
 * recoverable failure (a 200 with honest next-step copy + recovery chip) — NOT a
 * 500. Carries the neutral verdict so the composer can surface the reason/next-step.
 *
 * ⭐ AND THE MODEL'S IDENTITY, WHEN THE REFUSAL HAS ONE. The verdict says WHY the
 * run was refused; it cannot say WHAT was refused. A refusal that names no goal
 * and no options is not honest filtering — a goal needs no value to be
 * identified — it is the product denying the existence of the model on the
 * user's screen. That is what a signed-in user got on a freshly drafted model:
 * `status:"blocked" goal_node_id:"" options:[] blocked_reason:
 * "MISSING_OPTION_VALUE"`.
 *
 * The identity is not derived here and nothing is invented. The Run admission at
 * `build-turn-context.ts` has ALREADY assessed the GraphV3-valid compute
 * projection two lines above its throw, and {@link RunAdmission.assessment} is
 * exposed for exactly this reason: so a caller that also needs `analysisReady`
 * reuses THAT assessment rather than running the assessor twice (two
 * assessments of one graph could disagree, which is the hazard this module
 * exists to remove). The thrower hands over what it already holds.
 *
 * ⚠ OPTIONAL, AND LEGITIMATELY ABSENT. `NO_GRAPH` and `SCHEMA_INVALID` have no
 * identity to carry — the semantic projector returns `undefined` for both, so
 * their throws stay one-argument and this field stays absent. Absence therefore
 * means "this refusal has no model to name", never "withheld".
 */
export class AnalysisNotReadyError extends Error {
  readonly verdict: ReadinessResult;
  /**
   * The canonical readiness projection of the graph that was refused, when one
   * exists — `{ ...assessment.analysisReady, may_run: willProceed }`, the same
   * shape `buildCanonicalAnalysisReadyFromGraph` publishes.
   *
   * Consulted ONLY for the model's identity (`goal_node_id`, `options`).
   * `buildAnalysisRefusalReadiness` — not the thrower and not the reader —
   * decides which refusals keep it, from the `may_run` verdict it carries.
   */
  readonly structuralReadiness?: NonNullable<GraphPatchBlockData['analysis_ready']>;
  constructor(
    verdict: ReadinessResult,
    structuralReadiness?: NonNullable<GraphPatchBlockData['analysis_ready']>,
  ) {
    super(`Persisted graph is not analysis-ready: ${verdict.reasonCodes.join(',') || 'unknown'}`);
    this.name = 'AnalysisNotReadyError';
    this.verdict = verdict;
    if (structuralReadiness !== undefined) this.structuralReadiness = structuralReadiness;
  }
}
