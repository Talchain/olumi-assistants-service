/**
 * ⭐⭐ THE ONE ANALYSIS-ADMISSION RESULT — computed once, consumed unchanged.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS EXISTS FOR (driven journey, deployed staging, 2026-09-03)
 *
 * A fresh guest was driven end to end. The product ran an analysis the user
 * never asked for and reported *"100% of simulated scenarios"*, *"Stable
 * ranking"*, *"Robust"* — over a model whose entire quantitative substrate the
 * product had authored itself. Then it refused the analysis the user actually
 * requested.
 *
 * ⚠ SCOPE OF THAT WITNESS: n = 1 fresh guest. It is a WITNESS, not a rate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ FIRST, THE QUESTION EACH EXISTING AUTHORITY ANSWERS — because two
 * authorities that answer DIFFERENT questions must be NAMED APART, never
 * aligned (CLAUDE.md trap 21), and merging them is how this estate loses
 * capability.
 *
 *   `resolveRunAdmission(...).willProceed`
 *       "Will the engine proceed if asked, right now — after the run's own
 *        exclusions?"  ONE predicate, already shared by every run path.
 *
 *   `analysis_ready.status`
 *       "Is this model ready AS IT STANDS?"  Strictly stronger. A turn can be
 *       `needs_user_input` AND admissible; that cell is the readiness loop's
 *       payoff and is deliberate.
 *
 *   `/assist/v1/graph-readiness` `can_run_analysis`
 *       `assessment.safeToAnalyse` — i.e. the SAME question as `status`, under
 *       a name that reads like the same question as `may_run`. That naming is
 *       a hazard; it is not a second predicate.
 *
 *   the executor's refusal (`build-turn-context.ts`) and the post-draft
 *   auto-run's implicit yes (`handlers/auto-run-after-draft.ts`)
 *       BOTH are `resolveRunAdmission(...).willProceed`, on DIFFERENT GRAPHS —
 *       the auto-run reads the pre-sigma-floor draft graph, the executor reads
 *       the sigma-floored persisted graph. Same question, same predicate,
 *       different subject.
 *
 * ⭐⭐ SO THE FINDING IS **NOT** "FOUR RIVAL RUN GATES". CEE already has ONE.
 * The missing authority is a DIFFERENT QUESTION THAT NOTHING ASKS:
 *
 *       **"Given how this model was authored, what may the product CLAIM
 *         from a run of it?"**
 *
 * Nothing in the product expresses that. `willProceed` answers *can the engine
 * execute*; `leader_claim.permitted` (`compose/analysis-state-v1.ts`) answers
 * *did THIS RESULT separate the arms* — a post-run question about the numbers,
 * which is satisfied by strong separation between two machine-invented
 * estimates. Neither is a licence to say *"Robust"* about a model no user has
 * touched. {@link PermittedAnalysisMode} is that missing field, and it is why
 * this module is not deduplication.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ COMPUTE ONCE, CONSUME UNCHANGED — STRUCTURALLY, NOT BY CONVENTION
 *
 * {@link analysisAdmissionFrom} takes an ALREADY-RESOLVED {@link RunAdmission}.
 * Every caller that already holds one passes it, so the run verdict published
 * here is byte-for-byte the one that caller admitted (or refused) on.
 * {@link resolveAnalysisAdmission} is the convenience wrapper for a caller that
 * holds only a graph, and it resolves EXACTLY ONCE.
 *
 * A previous attempt in this estate failed because `computeScaffoldPlan` ran on
 * one branch and its result was discarded, so admission and execution could not
 * share it. `RunAdmission` already fixed that by EXPOSING its assessment
 * (`RunAdmission.assessment`); this module reads that exposed assessment and
 * never calls `assessCanonicalAnalysisReadiness` itself. Verified at this tip:
 * this file imports no assessor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ `semantic_quality_sufficient` — DERIVED FROM AN EXISTING AUTHORITY, AND
 * FROM A MEASUREMENT THAT REFUTED THE OBVIOUS PREDICATE.
 *
 * NO SCORING MODEL IS INVENTED HERE. The only authority consulted is
 * `cee/graph-readiness/obligation-provenance.ts` — the estate's ONE derivation
 * of *who authored this*.
 *
 * ⚠ THE FIRST PREDICATE I WROTE WAS VACUOUS, AND ONLY A CORPUS SHOWED IT.
 * "Does the model carry ANY user-stated quantity?" reads TRUE on every fresh
 * draft, because a draft's option interventions are stamped `brief_extraction`
 * — which `obligation-provenance.ts` classifies as `user_stated`, correctly (a
 * brief is the user's own words). Measured over NINE real captured draft graphs
 * (`acceptance-evidence/draft-speed/*`, `acceptance-evidence/artefact-appendix-casing/*`,
 * `tools/golden-journey-harness/fixtures/*`), the naive predicate would have
 * passed 9 of 9 — a guard that cannot fire on the exact case it exists to
 * catch.
 *
 * ⭐ THE CORRECTED PREDICATE, AND WHY IT IS THE RIGHT ONE ON THE COMPUTE, not
 * merely the one that fits the corpus. A robustness comparison's DIRECTION comes
 * from the option interventions — the user's own figures from the brief. Its
 * CONFIDENCE — "100% of scenarios", "Stable ranking", "Robust" — comes from the
 * factor baselines the arms are perturbed around and the edge strengths that
 * propagate them. Those are the parameters that turn a delta into a probability.
 * So the question this field answers is precisely:
 *
 *       **are the CONFIDENCE-BEARING parameters wholly machine-authored?**
 *
 * Measured over the same nine graphs, with the contrast control IN THE SAME
 * SWEEP (an absence claim needs one, CLAUDE.md trap 13e):
 *
 *   confidence-bearing parameters      user_stated =   0 / 189
 *     · baseline nodes (factor/outcome/goal/risk)     0 / 57
 *         (14 `cee_inference` → ai_drafted; 43 unstamped → unattributed)
 *     · causal edge provenance                        0 / 132
 *         (132 `cee_hypothesis` → ai_drafted; 8 absent)
 *   CONTRAST, same graphs, same probe   user_stated =  43 / 43
 *     · option interventions                         43 `brief_extraction`
 *
 * The contrast reads non-zero, so the zero is a real absence and not probe
 * blindness. EVIDENCE CLASS: nine STATIC CAPTURES of draft-path graphs in this
 * repo, read at this tip. Not an execution witness, and not a claim about
 * post-edit or mid-session graphs — those are exactly the graphs expected to
 * carry a user-authored value stamp (the vocabulary is
 * `obligation-provenance.ts`'s, and is deliberately NOT re-listed here: copying
 * two of its keys into prose is the hand-maintained mirror this estate pays for)
 * and therefore to flip this field TRUE, which is the behaviour `__tests__` pins
 * in both directions.
 *
 * ⚠ THIS IS DELIBERATELY A ONE-BIT FLOOR, NOT A QUALITY SCORE. It says *"no
 * human judgement has entered the parameters this claim rests on"* and nothing
 * finer. It is the founder's own ratified reason the post-draft auto-run's first
 * result is not to be trusted (`handlers/auto-run-after-draft.ts:10-15`),
 * expressed as a field instead of as a comment.
 *
 * ⚠ WHAT IT DOES **NOT** YET READ, stated so it is not mistaken for coverage:
 * the flat-goal-layer / strength-clustering signal is being made able to fire in
 * CEE #1331, which owns `src/cee/structure/index.ts` and
 * `src/cee/unified-pipeline/stages/package.ts`. This lane does not touch those
 * files. {@link SemanticQualitySignals} is the seam it plugs into — add the
 * detector's verdict as a second conjunct there, and every consumer of this
 * result inherits it with no other change.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ A REFUSAL IS NEVER SILENT. `permitted_analysis_mode: 'none'` always ships
 * with at least one {@link AnalysisAdmissionReason} naming the FIELD that
 * refused and what would change it. A bare boolean is what produced the original
 * defect; an invariant test asserts the reasons are non-empty on every refusing
 * verdict, and a mutant proves it bites.
 */
import type { RunAdmission } from '../tools/handlers/analysis-ready-core.js';
import { resolveRunAdmission } from '../tools/handlers/analysis-ready-core.js';
import type { CanonicalReadinessIssue } from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  classifyValueSource,
  structureProvenance,
  type ObligationClass,
  type StructureProvenance,
} from '../../cee/graph-readiness/obligation-provenance.js';

// ============================================================================
// Vocabulary
// ============================================================================

/**
 * WHAT THE PRODUCT MAY CLAIM from a run of this model. The load-bearing field.
 *
 * It is an UPPER BOUND on claim strength set BEFORE the run, from how the model
 * was authored. It never licenses a claim on its own: a surface must conjoin it
 * with the post-run evidence it already has (`leader_claim.permitted`, which
 * asks whether THIS RESULT separated the arms). Two conjuncts, two questions.
 *
 *   `none`
 *       Nothing may run and nothing may be claimed. The model has blockers.
 *
 *   `exploratory`
 *       The model is well-formed but there is nothing to COMPARE — the
 *       legitimate shape a team reaches when they have named what they think is
 *       going on but no course of action yet. Structure and direction may be
 *       discussed; no comparative figure may be shown, because none exists.
 *
 *   `quantified_provisional`
 *       The run may proceed and its figures may be shown, LABELLED PROVISIONAL.
 *       No leading option may be named, and no stability or robustness claim may
 *       be made — the confidence those claims rest on is wholly machine-authored.
 *       ⭐ THIS IS THE CELL THE 3 SEP JOURNEY WAS IN while the product said
 *       "Stable ranking" and "Robust".
 *
 *   `comparative_leader`
 *       The run may proceed and, if the result itself separates the arms, a
 *       leading option may be named.
 *
 * ⚠ ORDER IS SEMANTIC — see {@link ANALYSIS_MODE_RANK}. A consumer that needs
 * "at least X" must compare ranks, never string-match, or a new member silently
 * reads as the weakest.
 */
export type PermittedAnalysisMode =
  | 'none'
  | 'exploratory'
  | 'quantified_provisional'
  | 'comparative_leader';

/**
 * The claim-strength lattice, ascending.
 *
 * DERIVED SHAPE, not a hand-kept mirror: `Record<PermittedAnalysisMode, number>`
 * means a new mode FAILS TYPECHECK here rather than falling into a silent
 * default (CLAUDE.md trap 12).
 */
export const ANALYSIS_MODE_RANK: Readonly<Record<PermittedAnalysisMode, number>> = {
  none: 0,
  exploratory: 1,
  quantified_provisional: 2,
  comparative_leader: 3,
};

/** Every mode, derived from the lattice so the two can never disagree. */
export const PERMITTED_ANALYSIS_MODES = Object.keys(
  ANALYSIS_MODE_RANK,
) as readonly PermittedAnalysisMode[];

/** True when `mode` licenses at least `atLeast`. Rank comparison, never a string test. */
export function modePermitsAtLeast(
  mode: PermittedAnalysisMode,
  atLeast: PermittedAnalysisMode,
): boolean {
  return ANALYSIS_MODE_RANK[mode] >= ANALYSIS_MODE_RANK[atLeast];
}

/** Which field of the result a reason explains. One reason always names one field. */
export type AdmissionField =
  | 'structurally_analysable'
  | 'missing_important_inputs'
  | 'semantic_quality_sufficient'
  | 'permitted_analysis_mode';

/**
 * Stable machine code for a reason, plus the sentence to show a user.
 *
 * ⚠ `message` IS USER-FACING and carries no internal id, no code name and no
 * process narration. `code` is for consumers and telemetry.
 */
export interface AnalysisAdmissionReason {
  readonly field: AdmissionField;
  readonly code: AdmissionReasonCode;
  readonly message: string;
}

export type AdmissionReasonCode =
  | 'MODEL_HAS_BLOCKERS'
  | 'NOTHING_TO_COMPARE'
  | 'RUN_WILL_EXCLUDE_OPTIONS'
  | 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED'
  | 'CONFIDENCE_PARAMETERS_PARTLY_USER_STATED'
  | 'READY_TO_COMPARE';

/**
 * ONE input the model is missing, with WHY IT MATTERS rather than only what it is.
 *
 * `waived_by_exclusion` is carried per-item because an offer made while it is
 * true must say so out loud ("Run analysis — I'll leave out Option B"). That is
 * a property of the individual gap, never of the response.
 */
export interface MissingImportantInput {
  readonly issue_id: string;
  readonly code: string;
  readonly option_id?: string;
  readonly option_label?: string;
  readonly factor_id?: string;
  readonly factor_label?: string;
  /** User-facing: what is missing and why the analysis needs it. */
  readonly why_it_matters: string;
  /** `required` = may be asked as a demand; `offered` = OLUMI authored it (INV-P6). */
  readonly obligation?: ObligationClass;
  readonly waived_by_exclusion: boolean;
}

/**
 * The provenance census behind {@link AnalysisAdmission.semantic_quality_sufficient}.
 *
 * ⭐ EXPOSED DELIBERATELY. A verdict a surface cannot explain is the defect the
 * driven journey found (the assistant could not answer questions about what the
 * user was looking at). These counts are what a coach or a ContextPack needs to
 * say *"every baseline in this model is my estimate, not yours"* without
 * deriving a second opinion.
 *
 * ⭐ AND IT IS THE EXTENSION SEAM. A further semantic signal — CEE #1331's
 * flat-goal-layer detector is the next one — joins as an additional field here
 * and an additional conjunct in {@link semanticQualitySufficient}. Nothing else
 * changes.
 */
export interface SemanticQualitySignals {
  /** Baseline nodes + causal edges: the parameters a confidence claim rests on. */
  readonly confidence_parameters_total: number;
  readonly confidence_parameters_user_stated: number;
  readonly confidence_parameters_machine_authored: number;
  readonly confidence_parameters_unattributed: number;
}

/** THE result. One object, four verdict fields, their reasons, and its subject. */
export interface AnalysisAdmission {
  /** Can the engine execute this at all, right now? `RunAdmission.willProceed`. */
  readonly structurally_analysable: boolean;
  /** Which inputs are missing, and why they matter. */
  readonly missing_important_inputs: readonly MissingImportantInput[];
  /** Does the model represent the brief well enough to carry a confidence claim? */
  readonly semantic_quality_sufficient: boolean;
  /** The upper bound on what the product may claim. */
  readonly permitted_analysis_mode: PermittedAnalysisMode;
  /** User-facing, one per field that has something to say. Never empty on a refusal. */
  readonly reasons: readonly AnalysisAdmissionReason[];
  /** The subject this verdict is about, so a consumer can tell a stale one. */
  readonly graph_hash: string | null;
  /** The census behind `semantic_quality_sufficient`. */
  readonly semantic_signals: SemanticQualitySignals;
}

// ============================================================================
// Reading the graph — provenance census
// ============================================================================

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOf(graph: unknown, key: 'nodes' | 'edges'): readonly Record<string, unknown>[] {
  const raw = asRecord(graph)?.[key];
  if (!Array.isArray(raw)) return [];
  return raw.map(asRecord).filter((n): n is Record<string, unknown> => n !== null);
}

/**
 * The node kinds whose value a confidence claim rests on.
 *
 * ⚠ `option` AND `decision` ARE DELIBERATELY ABSENT, and their absence is the
 * measured correction described in this module's header: an option's stamps are
 * `brief_extraction` on every fresh draft, so including them makes the predicate
 * read TRUE on 9 of 9 real captures — vacuous on the exact case it exists to
 * catch. Options supply the comparison's DIRECTION (the user's own figures);
 * these kinds supply its CONFIDENCE.
 *
 * `Record<…, true>` so the set and its type cannot drift apart.
 */
export const CONFIDENCE_BEARING_NODE_KINDS = Object.keys({
  factor: true,
  outcome: true,
  goal: true,
  risk: true,
} satisfies Record<'factor' | 'outcome' | 'goal' | 'risk', true>) as readonly string[];

/**
 * Census the CONFIDENCE-BEARING parameters of a graph by authorship.
 *
 * Consults `obligation-provenance.ts` and derives nothing of its own:
 *   · baseline nodes → {@link structureProvenance} (observed_state.source, then
 *     .extractionType, then a repair-authored incoming edge);
 *   · causal edges   → {@link classifyValueSource} over `provenance.source`.
 *
 * ⚠ Edges INCIDENT TO an option/decision/constraint node are excluded: PLoT
 * strips them before the graph reaches the engine
 * (`plot-lite-service src/normalisation/option-filter.ts:93-97`, staging
 * `3a3bee58` — a STATIC READ of that repo, not an execution witness), so they
 * carry no confidence. Counting them would let an option→factor edge's stamp
 * decide a claim the engine never sees.
 *
 * TOTAL: never throws. A graph it cannot read censuses as all-zero, which
 * yields `semantic_quality_sufficient: false` — absence is not sufficiency.
 */
export function censusConfidenceParameters(graph: unknown): SemanticQualitySignals {
  let userStated = 0;
  let machineAuthored = 0;
  let unattributed = 0;

  const tally = (provenance: StructureProvenance): void => {
    if (provenance === 'user_stated') userStated += 1;
    else if (provenance === 'unattributed') unattributed += 1;
    else machineAuthored += 1;
  };

  const nodes = arrayOf(graph, 'nodes');
  const kindById = new Map<string, string>();
  for (const node of nodes) {
    if (typeof node.id === 'string' && typeof node.kind === 'string') {
      kindById.set(node.id, node.kind);
    }
  }

  for (const node of nodes) {
    if (typeof node.kind !== 'string') continue;
    if (!CONFIDENCE_BEARING_NODE_KINDS.includes(node.kind)) continue;
    tally(structureProvenance(node, graph));
  }

  for (const edge of arrayOf(graph, 'edges')) {
    const fromKind = typeof edge.from === 'string' ? kindById.get(edge.from) : undefined;
    const toKind = typeof edge.to === 'string' ? kindById.get(edge.to) : undefined;
    const strippedByPlot = (kind: string | undefined): boolean =>
      kind === 'option' || kind === 'decision' || kind === 'constraint';
    if (strippedByPlot(fromKind) || strippedByPlot(toKind)) continue;
    tally(classifyValueSource(asRecord(edge.provenance)?.source));
  }

  return {
    confidence_parameters_total: userStated + machineAuthored + unattributed,
    confidence_parameters_user_stated: userStated,
    confidence_parameters_machine_authored: machineAuthored,
    confidence_parameters_unattributed: unattributed,
  };
}

/**
 * THE semantic rule. One line, one place, so no surface holds a second opinion.
 *
 * A model's confidence claims are sufficient exactly when at least one of the
 * parameters they rest on is the USER's. Absence of parameters is NOT
 * sufficiency — a census of zero is `false`, deliberately: a claim resting on
 * nothing is not a claim resting on the user's judgement.
 */
export function semanticQualitySufficient(signals: SemanticQualitySignals): boolean {
  return signals.confidence_parameters_user_stated > 0;
}

// ============================================================================
// Building the result
// ============================================================================

function toMissingInput(issue: CanonicalReadinessIssue): MissingImportantInput {
  return {
    issue_id: issue.issue_id,
    code: issue.code,
    ...(issue.option_id !== undefined ? { option_id: issue.option_id } : {}),
    ...(issue.option_label !== undefined ? { option_label: issue.option_label } : {}),
    ...(issue.factor_id !== undefined ? { factor_id: issue.factor_id } : {}),
    ...(issue.factor_label !== undefined ? { factor_label: issue.factor_label } : {}),
    // The assessor's own user-facing sentence. READ, never re-worded: a second
    // phrasing of one gap is a second authority on what the gap is.
    why_it_matters: issue.message,
    ...(issue.obligation !== undefined ? { obligation: issue.obligation } : {}),
    waived_by_exclusion: issue.waived_by_exclusion === true,
  };
}

/**
 * Derive the mode. Every cell is decided by a STRUCTURAL fact, never by matching
 * a sentence — a mode that depended on `strict.nextStep`'s wording would break
 * the next time that copy changed.
 *
 * `strict.safeToAnalyse === true` while `willProceed === false` is the exact
 * "strict readiness had no complaint; the second term refused" cell — which, at
 * this tip, is reachable only through the comparison floor
 * (`comparisonSurvivesDedup`). That is `exploratory`: a well-formed model with
 * nothing to compare.
 */
function deriveMode(
  admission: RunAdmission,
  semanticSufficient: boolean,
): PermittedAnalysisMode {
  if (!admission.willProceed) {
    return admission.strict.safeToAnalyse ? 'exploratory' : 'none';
  }
  return semanticSufficient ? 'comparative_leader' : 'quantified_provisional';
}

const MODE_REASON: Readonly<
  Record<PermittedAnalysisMode, { code: AdmissionReasonCode; message: string }>
> = {
  none: {
    code: 'MODEL_HAS_BLOCKERS',
    message: 'This model cannot be analysed yet.',
  },
  exploratory: {
    code: 'NOTHING_TO_COMPARE',
    message:
      'There is nothing to compare yet, so no figures can be produced. Name at least two different options you are weighing.',
  },
  quantified_provisional: {
    code: 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED',
    message:
      'Every estimate this comparison rests on is Olumi’s, not yours. Figures can be shown as provisional, but no option can be called the leader and no result can be called stable or robust until you have set at least one of them.',
  },
  comparative_leader: {
    code: 'CONFIDENCE_PARAMETERS_PARTLY_USER_STATED',
    message: 'Your own estimates are in this model, so a comparison can name a leader.',
  },
};

/**
 * ⭐⭐ THE PUBLIC ENTRY THAT MAKES "COMPUTE ONCE" STRUCTURAL.
 *
 * Takes the {@link RunAdmission} the caller ALREADY resolved, so the verdict
 * published here cannot disagree with the one that caller ran (or refused) on.
 * Pure and TOTAL — an admission gate's companion must fail toward saying less,
 * never throw at the boundary.
 *
 * @param admission the caller's own already-resolved run admission
 * @param graph     the SAME graph that admission was resolved over
 * @param graphHash the turn's existing analysis-affecting hash, or null
 *
 * ⚠ `graphHash` IS AN INPUT, NOT MINTED HERE, AND THAT IS DELIBERATE. This repo
 * already holds two hash authorities — `computeGraphHash` (16-hex, over
 * `JSON.stringify`, key-order dependent) and the 64-hex analysis-affecting hash
 * that reaches `freshness.current_graph_hash`. Minting a third would be this
 * estate's signature defect (two `generateGraphHash` twins). Callers pass the
 * one their turn already holds; `null` means "this turn has no hash", which is
 * the honest unknown and never a fabricated identity.
 */
export function analysisAdmissionFrom(
  admission: RunAdmission,
  graph: unknown,
  graphHash: string | null = null,
): AnalysisAdmission {
  const signals = censusConfidenceParameters(graph);
  const semanticSufficient = semanticQualitySufficient(signals);
  const mode = deriveMode(admission, semanticSufficient);

  // ⚠ `assessment.blockingIssues`, NOT `strict.issues`. `strict.issues` is the
  // EXHAUSTIVE record (carrier + blocking); this field is what is MISSING. And
  // it must come off the ADMISSION's exposed assessment rather than a fresh one,
  // because `resolveRunAdmission` replaces both issue arrays with WAIVER-STAMPED
  // copies on its admitting branch (`analysis-ready-core.ts:908-909`) — read a
  // second assessment and `waived_by_exclusion` could never be true, i.e. a
  // field that cannot fire. Pinned by a test that asserts a waived population.
  const missing = admission.assessment.blockingIssues.map(toMissingInput);

  const reasons: AnalysisAdmissionReason[] = [];

  // ── structurally_analysable ────────────────────────────────────────────────
  // ⚠ A REFUSAL IS NEVER SILENT. `blockedNextStep` is `RunAdmission`'s own
  // never-null-on-refusal field (it fills an absent strict reason with the
  // no-comparison sentence), so this branch cannot ship an empty reason set.
  if (!admission.willProceed) {
    reasons.push({
      field: 'structurally_analysable',
      code: admission.strict.safeToAnalyse ? 'NOTHING_TO_COMPARE' : 'MODEL_HAS_BLOCKERS',
      message: admission.blockedNextStep ?? MODE_REASON.none.message,
    });
  } else if (admission.waivedOptionIds.length > 0) {
    reasons.push({
      field: 'structurally_analysable',
      code: 'RUN_WILL_EXCLUDE_OPTIONS',
      message: `Analysis can run, leaving out ${admission.waivedOptionIds.length === 1 ? 'one option' : `${admission.waivedOptionIds.length} options`} you have not set values for.`,
    });
  } else {
    reasons.push({
      field: 'structurally_analysable',
      code: 'READY_TO_COMPARE',
      message: 'Analysis can run on this model as it stands.',
    });
  }

  // ── missing_important_inputs ───────────────────────────────────────────────
  if (missing.length > 0) {
    const demanded = missing.filter((m) => m.obligation !== 'offered').length;
    reasons.push({
      field: 'missing_important_inputs',
      code: 'MODEL_HAS_BLOCKERS',
      message:
        demanded > 0
          ? `${demanded === 1 ? 'One input is' : `${demanded} inputs are`} still needed from you.`
          : 'Olumi filled in the gaps here itself; you can review them, and nothing is required of you.',
    });
  }

  // ── semantic_quality_sufficient ────────────────────────────────────────────
  reasons.push({
    field: 'semantic_quality_sufficient',
    code: semanticSufficient
      ? 'CONFIDENCE_PARAMETERS_PARTLY_USER_STATED'
      : 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED',
    message: semanticSufficient
      ? MODE_REASON.comparative_leader.message
      : MODE_REASON.quantified_provisional.message,
  });

  // ── permitted_analysis_mode ────────────────────────────────────────────────
  reasons.push({
    field: 'permitted_analysis_mode',
    code: MODE_REASON[mode].code,
    message: MODE_REASON[mode].message,
  });

  return {
    structurally_analysable: admission.willProceed,
    missing_important_inputs: missing,
    semantic_quality_sufficient: semanticSufficient,
    permitted_analysis_mode: mode,
    reasons,
    graph_hash: graphHash,
    semantic_signals: signals,
  };
}

/**
 * Convenience entry for a caller that holds only a graph. Resolves the run
 * admission EXACTLY ONCE and hands it straight to {@link analysisAdmissionFrom}.
 *
 * ⚠ A caller that ALREADY holds a `RunAdmission` must use
 * {@link analysisAdmissionFrom} instead — resolving a second time would put two
 * computations of one verdict in the tree, which is the hazard this module and
 * `analysis-ready-core` both exist to remove.
 */
export function resolveAnalysisAdmission(
  graph: unknown,
  graphHash: string | null = null,
): AnalysisAdmission {
  return analysisAdmissionFrom(resolveRunAdmission(graph), graph, graphHash);
}
