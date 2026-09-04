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
 * estimates. Neither is a licence to say *"Robust"* about a model whose
 * comparison rests entirely on Olumi's own numbers. {@link PermittedAnalysisMode}
 * is that missing field, and it is why this module is not deduplication.
 *
 * ⚠ AND WHAT IT DOES NOT DO, said here so the field is not oversold downstream:
 * it makes the WHOLLY-machine-authored case impossible to claim a leader over.
 * It is a FLOOR — one user-stated parameter on the comparison's own substrate
 * clears it — so it does NOT certify that a model is well specified, that its
 * numbers are right, or that a mostly-machine-authored comparison is sound.
 * A surface that treats `comparative_leader` as a quality certificate has
 * misread it.
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
 * ⚠⚠ AND THE PREDICATE BELOW WAS ITSELF TOO PERMISSIVE — CORRECTED AGAIN, at an
 * independent review's measurement. `confidence_parameters_user_stated > 0` is
 * an EXISTENTIAL OVER THE WHOLE GRAPH: measured at `ad216f63`, ONE stamp
 * anywhere — a downstream baseline, a causal edge, the goal node, a bare
 * `extractionType: 'explicit'`, or an exogenous root no option touches — lifted
 * a wholly machine-authored model to `comparative_leader`. The nine-graph corpus
 * could not see it: every member reads 0 of 189, so it certified the ALL-MACHINE
 * case and was SILENT on the threshold — no member sat in the 1-of-N state at
 * all. **The corpus shared the predicate's blind spot.** The floor is now
 * MATERIALITY (see {@link semanticQualitySufficient}); the reasoning below about
 * WHICH parameters carry a confidence claim is unchanged and still load-bearing.
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
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHashSha256 } from '../context/graph-hash.js';
import type { CanonicalReadinessIssue } from '../../orchestrator/tools/analysis-ready-helper.js';
import { pickGoalThresholdTrio } from '../../utils/goal-threshold-trio.js';
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
  | 'NO_COMPARISON_SUBSTRATE'
  | 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED'
  | 'USER_STATED_PARAMETERS_NOT_MATERIAL'
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
  /**
   * WHOLE-MODEL census. Baseline nodes + causal edges: every parameter any
   * confidence claim about this model could rest on.
   *
   * ⚠ THIS IS NOT THE FLOOR, AND THE TWO MUST NOT BE CONFLATED. It answers
   * *"who authored this model's parameters?"* — which is what a coach needs to
   * say "every baseline here is my estimate, not yours". The floor asks a
   * NARROWER question, below. Two questions, named apart, both published
   * (CLAUDE.md trap 21).
   */
  readonly confidence_parameters_total: number;
  readonly confidence_parameters_user_stated: number;
  readonly confidence_parameters_machine_authored: number;
  readonly confidence_parameters_unattributed: number;
  /**
   * ⭐⭐ THE COMPARISON'S OWN CAUSAL SUBSTRATE — the parameters a LEADER claim
   * actually rests on, and the discriminator behind
   * {@link semanticQualitySufficient}.
   *
   * Material = on a directed path from a factor some option intervenes on, to a
   * goal. Derived by reachability over the same edges the census counts (see
   * {@link comparisonSubstrate}); no constant, no ratio, nothing tuned.
   *
   * ⚠ AN EXOGENOUS ROOT IS DELIBERATELY OUTSIDE IT. A factor no option touches
   * moves BOTH arms by the same amount, so the user's value for it is not a
   * judgement about which option leads. Measured on
   * `live-4day-week.cold-read.json`: 3 of its 10 confidence-bearing nodes are
   * such roots, and at `ad216f63` a single stamp on one of them lifted the whole
   * model to `comparative_leader`.
   */
  readonly material_parameters_total: number;
  readonly material_parameters_user_stated: number;
  /**
   * The STRICTEST slice, published so a stricter consumer needs no second
   * census: the baselines of the factors the options actually differ on — the
   * counterfactual reference the arms are perturbed around.
   *
   * ⚠ PUBLISHED, NOT ENFORCED. This lane does not make it a conjunct: that would
   * be a second, unmeasured tightening on top of the one the review asked for.
   * A consumer that wants it has the number without minting an opinion.
   */
  readonly intervened_factor_baselines_total: number;
  readonly intervened_factor_baselines_user_stated: number;
  /**
   * ⭐ HAS THE USER SAID WHAT "GOOD" MEANS? Derived from the estate's ONE
   * goal-target rule (`utils/goal-threshold-trio.ts`), so the raw anchor — not a
   * lone cap or unit — is what counts. Nothing is re-implemented here.
   *
   * ⚠⚠ IT IS DELIBERATELY **NOT** A CONJUNCT OF `comparative_leader`, AND THAT
   * IS A DECISION WITH A MEASUREMENT BEHIND IT, NOT AN OVERSIGHT.
   *
   *   · ON THE SEMANTICS: a stated target is a precondition for a GOAL-ATTAINMENT
   *     claim — *"100% of simulated scenarios"* — because without it the bar
   *     being cleared is one Olumi chose. It is NOT a precondition for a RANKING
   *     claim: *"Option A leads"* is an ordering over the goal and needs no
   *     definition of success. Folding both into one predicate would put two
   *     questions under one name, which is this estate's signature defect.
   *   · ON THE MEASUREMENT: **0 of 13 real captured graphs in this repo carry a
   *     goal target** (the nine draft/golden-journey members of this module's
   *     corpus, plus all four `context-integrity` cold-reads, which record it
   *     explicitly as `"absent"`). Making it a conjunct would render
   *     `comparative_leader` unreachable on every real graph the repo holds, and
   *     would collapse the only discriminating pair this change set has on real
   *     data — a mode that cannot fire, reported as a floor.
   *
   * A consumer gating goal-attainment wording reads THIS field and conjoins it,
   * exactly as it already conjoins `leader_claim.permitted` for the post-run
   * question. That is the seam, and it is why the signal is on the wire.
   */
  readonly goal_target_stated: boolean;
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
  /**
   * The subject this verdict is about, so a consumer can tell a stale one: the
   * 64-hex analysis-affecting hash of the graph the verdict was computed over.
   *
   * ⚠ NOT the 16-hex `freshness.current_graph_hash` token. Same projection, same
   * normaliser, different truncation — comparable only after truncating this
   * one, never by string equality against it.
   *
   * `null` means the subject could not be read (not a graph), which is the
   * honest unknown and never a fabricated identity.
   */
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
 * Is this element stripped by PLoT before the graph reaches the engine?
 *
 * `plot-lite-service src/normalisation/option-filter.ts:93-97`, staging
 * `3a3bee58` — a STATIC READ of that repo, not an execution witness. Counting a
 * stripped edge would let an option→factor stamp decide a claim the engine never
 * sees.
 */
function strippedByPlot(kind: string | undefined): boolean {
  return kind === 'option' || kind === 'decision' || kind === 'constraint';
}

/** The factor ids some option states an intervention on. The comparison's seeds. */
function intervenedFactorIds(nodes: readonly Record<string, unknown>[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'option') continue;
    const interventions =
      asRecord(node.interventions) ?? asRecord(asRecord(node.data)?.interventions);
    if (!interventions) continue;
    for (const factorId of Object.keys(interventions)) ids.add(factorId);
  }
  return ids;
}

/**
 * ⭐⭐ THE COMPARISON'S OWN CAUSAL SUBSTRATE — what a LEADER claim rests on.
 *
 * A node is MATERIAL when it lies on a directed path from a factor some option
 * intervenes on, to a goal:
 *
 *     material = reachable-forward-from(intervened factors)
 *                ∩ reachable-backward-from(goals)
 *
 * over exactly the edges the census already counts (option / decision /
 * constraint incident edges excluded, because PLoT strips them). An edge is
 * material when BOTH its endpoints are.
 *
 * ⚠ WHY REACHABILITY AND NOT A SCORE. The alternative on offer was a ratio —
 * "enough of the parameters are the user's" — which is a constant somebody
 * chooses, and this estate has already paid four oscillating rounds for a
 * predicate settled by arbitrary constants (CLAUDE.md trap 22f). Reachability is
 * derived from the graph the run will actually be performed on, so it cannot be
 * tuned and cannot drift.
 *
 * ⚠ EVERY FAILURE DIRECTION COSTS COVERAGE, NEVER TRUTH. An empty intervention
 * set, an unreadable graph, or a goal nothing reaches all yield an EMPTY
 * substrate, hence `semantic_quality_sufficient: false`, hence a WEAKER
 * permitted mode. There is no input for which a defect here can license a
 * STRONGER claim than the evidence supports.
 *
 * ⚠ AND THE HONEST LIMIT, stated where it cannot be missed: an exogenous root's
 * uncertainty does still widen BOTH arms, so it bears on how often a ranking
 * flips. Excluding it therefore errs — and it errs toward refusing a claim we
 * could have allowed, which is the direction this module is required to fail in.
 * The whole-model census remains published for any consumer that wants the
 * wider population.
 *
 * TOTAL: never throws. An unreadable graph yields empty sets.
 */
export function comparisonSubstrate(graph: unknown): {
  readonly materialNodeIds: ReadonlySet<string>;
  readonly intervenedFactorIds: ReadonlySet<string>;
} {
  const nodes = arrayOf(graph, 'nodes');
  const kindById = new Map<string, string>();
  for (const node of nodes) {
    if (typeof node.id === 'string' && typeof node.kind === 'string') {
      kindById.set(node.id, node.kind);
    }
  }

  const intervened = intervenedFactorIds(nodes);
  const goals = new Set(
    nodes
      .filter((n) => n.kind === 'goal' && typeof n.id === 'string')
      .map((n) => n.id as string),
  );

  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const edge of arrayOf(graph, 'edges')) {
    const from = typeof edge.from === 'string' ? edge.from : undefined;
    const to = typeof edge.to === 'string' ? edge.to : undefined;
    if (from === undefined || to === undefined) continue;
    if (strippedByPlot(kindById.get(from)) || strippedByPlot(kindById.get(to))) continue;
    (forward.get(from) ?? forward.set(from, []).get(from)!).push(to);
    (backward.get(to) ?? backward.set(to, []).get(to)!).push(from);
  }

  const reach = (seeds: ReadonlySet<string>, adjacency: Map<string, string[]>): Set<string> => {
    const seen = new Set(seeds);
    const frontier = [...seeds];
    while (frontier.length > 0) {
      const current = frontier.pop() as string;
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        frontier.push(next);
      }
    }
    return seen;
  };

  const downstreamOfInterventions = reach(intervened, forward);
  const upstreamOfGoals = reach(goals, backward);
  const materialNodeIds = new Set(
    [...downstreamOfInterventions].filter((id) => upstreamOfGoals.has(id)),
  );

  return { materialNodeIds, intervenedFactorIds: intervened };
}

/**
 * Does this graph carry a target the user can be said to have SET?
 *
 * Delegates to `pickGoalThresholdTrio` — the estate's ONE goal-target rule — so
 * the RAW ANCHOR is what counts and a lone cap or unit is not mistaken for a
 * stated target. Nothing about goal targets is re-derived here.
 */
function goalTargetStated(graph: unknown): boolean {
  for (const node of arrayOf(graph, 'nodes')) {
    if (node.kind !== 'goal') continue;
    // The node itself, and the legacy `data.` carrier the rest of this module
    // already reads for `observed_state` / `interventions`.
    for (const carrier of [node, asRecord(node.data)]) {
      if (carrier !== null && 'goal_threshold_raw' in pickGoalThresholdTrio(carrier)) return true;
    }
  }
  return false;
}

/**
 * Census the confidence-bearing parameters of a graph by authorship — over the
 * WHOLE model, and again over the COMPARISON'S OWN SUBSTRATE.
 *
 * Consults `obligation-provenance.ts` and derives no authorship rule of its own:
 *   · baseline nodes → {@link structureProvenance} (observed_state.source, then
 *     .extractionType, then a repair-authored incoming edge);
 *   · causal edges   → {@link classifyValueSource} over `provenance.source`.
 *
 * ⚠ Edges INCIDENT TO an option/decision/constraint node are excluded from BOTH
 * populations — see {@link strippedByPlot}.
 *
 * TOTAL: never throws. A graph it cannot read censuses as all-zero, which
 * yields `semantic_quality_sufficient: false` — absence is not sufficiency.
 */
export function censusConfidenceParameters(graph: unknown): SemanticQualitySignals {
  let userStated = 0;
  let machineAuthored = 0;
  let unattributed = 0;
  let materialTotal = 0;
  let materialUserStated = 0;
  let intervenedTotal = 0;
  let intervenedUserStated = 0;

  const tally = (provenance: StructureProvenance): void => {
    if (provenance === 'user_stated') userStated += 1;
    else if (provenance === 'unattributed') unattributed += 1;
    else machineAuthored += 1;
  };
  const tallyMaterial = (provenance: StructureProvenance): void => {
    materialTotal += 1;
    if (provenance === 'user_stated') materialUserStated += 1;
  };

  const nodes = arrayOf(graph, 'nodes');
  const kindById = new Map<string, string>();
  for (const node of nodes) {
    if (typeof node.id === 'string' && typeof node.kind === 'string') {
      kindById.set(node.id, node.kind);
    }
  }

  const { materialNodeIds, intervenedFactorIds: intervened } = comparisonSubstrate(graph);

  for (const node of nodes) {
    if (typeof node.kind !== 'string') continue;
    if (!CONFIDENCE_BEARING_NODE_KINDS.includes(node.kind)) continue;
    const provenance = structureProvenance(node, graph);
    tally(provenance);
    const id = typeof node.id === 'string' ? node.id : undefined;
    if (id !== undefined && materialNodeIds.has(id)) tallyMaterial(provenance);
    if (id !== undefined && intervened.has(id)) {
      intervenedTotal += 1;
      if (provenance === 'user_stated') intervenedUserStated += 1;
    }
  }

  for (const edge of arrayOf(graph, 'edges')) {
    const from = typeof edge.from === 'string' ? edge.from : undefined;
    const to = typeof edge.to === 'string' ? edge.to : undefined;
    if (strippedByPlot(from === undefined ? undefined : kindById.get(from))) continue;
    if (strippedByPlot(to === undefined ? undefined : kindById.get(to))) continue;
    const provenance = classifyValueSource(asRecord(edge.provenance)?.source);
    tally(provenance);
    if (
      from !== undefined &&
      to !== undefined &&
      materialNodeIds.has(from) &&
      materialNodeIds.has(to)
    ) {
      tallyMaterial(provenance);
    }
  }

  return {
    confidence_parameters_total: userStated + machineAuthored + unattributed,
    confidence_parameters_user_stated: userStated,
    confidence_parameters_machine_authored: machineAuthored,
    confidence_parameters_unattributed: unattributed,
    material_parameters_total: materialTotal,
    material_parameters_user_stated: materialUserStated,
    intervened_factor_baselines_total: intervenedTotal,
    intervened_factor_baselines_user_stated: intervenedUserStated,
    goal_target_stated: goalTargetStated(graph),
  };
}

/**
 * ⭐⭐ WHY THIS VERDICT REFUSED — one cause, derived, mutually exclusive.
 *
 * A single boolean cannot say WHICH conjunct refused, and a refusal that
 * misnames its own cause is worse than a silent one: it tells the user to fix
 * something that is not wrong. `user_stated_not_material` exists precisely
 * because the "everything here is Olumi's" sentence is FALSE in that cell.
 */
export type SemanticVerdictCause =
  | 'no_comparison_substrate'
  | 'all_machine_authored'
  | 'user_stated_not_material'
  | 'material_user_stated';

export function semanticVerdictCause(signals: SemanticQualitySignals): SemanticVerdictCause {
  if (signals.material_parameters_user_stated > 0) return 'material_user_stated';
  if (signals.material_parameters_total === 0) return 'no_comparison_substrate';
  if (signals.confidence_parameters_user_stated > 0) return 'user_stated_not_material';
  return 'all_machine_authored';
}

/**
 * ⭐⭐ THE SEMANTIC FLOOR. One line, one place, so no surface holds a second
 * opinion.
 *
 * A model's confidence claims are sufficient exactly when at least one parameter
 * **the comparison itself rests on** is the USER's.
 *
 * ⚠⚠ THE PREVIOUS FLOOR WAS `confidence_parameters_user_stated > 0`, AND IT WAS
 * TOO PERMISSIVE — an EXISTENTIAL over the whole graph. Measured at `ad216f63`
 * on `live-4day-week.cold-read.json`, moving its single `brief_extraction` stamp
 * from `out_csat` (on the path from an intervened factor to the goal) to
 * `fac_productivity` (an exogenous root no option touches) left the count
 * IDENTICAL at 1, and the verdict stayed `comparative_leader`. One inspector edit
 * anywhere in a model licensed naming a winner.
 *
 * ⚠ AND THE CORPUS THAT SHIPPED WITH IT COULD NOT SEE THAT. All nine members
 * read 0 user-stated of 189, so the corpus certified the ALL-MACHINE case and was
 * silent on the threshold: it had no member in the 1-of-N state at all. A corpus
 * that omits a class the contract admits cannot certify the code over that class.
 * `__tests__` now carries that class in BOTH directions, on a real capture.
 *
 * ⚠ STILL A FLOOR, NOT A QUALITY SCORE. One material user-stated parameter is
 * enough. It says *"the user's judgement has entered what this comparison turns
 * on"* and nothing finer. A consumer wanting a stricter bar reads
 * {@link SemanticQualitySignals} — which now publishes the material counts and
 * the intervened-baseline counts for exactly that — rather than minting a second
 * opinion here.
 */
export function semanticQualitySufficient(signals: SemanticQualitySignals): boolean {
  return signals.material_parameters_user_stated > 0;
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

/**
 * The sentence for each SEMANTIC cause. User-facing: no internal id, no code
 * name, no process narration.
 *
 * ⚠⚠ `material_user_stated`'s SENTENCE WAS CORRECTED, AND THE OLD ONE IS KEPT
 * VISIBLE (CLAUDE.md trap 14 — an honest label must not be quietly overwritten).
 * It read:
 *
 *   ~~"Your own estimates are in this model, so a comparison can name a leader."~~
 *
 * PLURAL, on a floor that fires at ONE user-stated parameter. Measured on the
 * corpus this module ships with: the cell it is emitted in is n = 1 of 189. A
 * user who has set a single number would be told their estimates — plural, and
 * by implication the ones this comparison rests on — are in the model. That is
 * the same over-claim, one level down, as the "Robust" this whole module exists
 * to stop, and it is declared user-facing, so it would have been read aloud by
 * the product. The replacement says exactly what was measured.
 *
 * DERIVED SHAPE: `Record<SemanticVerdictCause, …>` means a new cause FAILS
 * TYPECHECK here rather than falling into a silent default (trap 12).
 */
const SEMANTIC_REASON: Readonly<
  Record<SemanticVerdictCause, { code: AdmissionReasonCode; message: string }>
> = {
  no_comparison_substrate: {
    code: 'NO_COMPARISON_SUBSTRATE',
    message:
      'Nothing in this model connects the options to your goal, so there is no comparison to draw a leader from.',
  },
  all_machine_authored: {
    code: 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED',
    message:
      'Every estimate this comparison rests on is Olumi’s, not yours. Figures can be shown as provisional, but no option can be called the leader and no result can be called stable or robust until you have set at least one of them.',
  },
  user_stated_not_material: {
    code: 'USER_STATED_PARAMETERS_NOT_MATERIAL',
    message:
      'The values you have set sit outside what this comparison turns on, so every estimate behind it is still Olumi’s. Figures can be shown as provisional, but no option can be called the leader until you have set a value on a factor one of the options changes, or somewhere on the chain from there to your goal.',
  },
  material_user_stated: {
    code: 'CONFIDENCE_PARAMETERS_PARTLY_USER_STATED',
    message:
      'At least one of the estimates this comparison rests on is yours, so a leading option can be named.',
  },
};

/**
 * The sentence for each MODE.
 *
 * ⚠ `quantified_provisional` IS DELIBERATELY ABSENT. Its sentence depends on
 * WHICH conjunct refused, and a single fixed sentence there was how the
 * `user_stated_not_material` cell would have shipped a false explanation — the
 * product telling a user who HAS set a value that everything in the model is
 * Olumi's. `SEMANTIC_REASON` supplies it; the omission is enforced by the type.
 */
const MODE_REASON: Readonly<
  Record<
    Exclude<PermittedAnalysisMode, 'quantified_provisional'>,
    { code: AdmissionReasonCode; message: string }
  >
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
  comparative_leader: SEMANTIC_REASON.material_user_stated,
};

/** The reason for a mode, routed through the semantic cause where the mode needs it. */
function modeReason(
  mode: PermittedAnalysisMode,
  cause: SemanticVerdictCause,
): { code: AdmissionReasonCode; message: string } {
  return mode === 'quantified_provisional' ? SEMANTIC_REASON[cause] : MODE_REASON[mode];
}

/**
 * The 64-hex analysis-affecting hash of the graph this verdict is about.
 *
 * ⚠⚠ READ FROM THE EXISTING AUTHORITY, NEVER MINTED HERE. This repo already
 * holds two — `computeDeterministicGraphHash` (16-hex, topology only) and the
 * analysis-affecting projection, whose 16-hex form reaches
 * `freshness.current_graph_hash` and whose full SHA-256 form is the durable
 * model-version identity. This calls the SECOND one's 64-hex export, so there is
 * one projection and one normaliser, not a third twin.
 *
 * ⚠ IT IS THE 64-HEX FORM, WHICH IS NOT THE 16-HEX FRESHNESS TOKEN. The two are
 * prefixes of one digest over the same projection, so they are comparable ONLY
 * after truncation — a consumer must never string-equal one against the other.
 *
 * TOTAL, because {@link analysisAdmissionFrom} is: anything that is not a
 * readable `{nodes, edges}` graph yields `null`, the honest unknown.
 */
function analysisAffectingHashOf(graph: unknown): string | null {
  const record = asRecord(graph);
  if (!record || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) return null;
  try {
    return computeAnalysisAffectingGraphHashSha256(graph as GraphStateIngress);
  } catch {
    return null;
  }
}

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
 * @param graphHash OPTIONAL override — the hash the turn already holds. OMIT it
 *                  and the analysis-affecting hash of `graph` is read from the
 *                  existing authority; pass `null` to publish no subject at all.
 *
 * ⚠⚠ THE DEFAULT CHANGED, AND THIS IS THE FINDING IT CLOSES. `graphHash` used to
 * DEFAULT TO `null`, and the ONE production mint path
 * (`canonicalAnalysisReadyFrom`) calls this with TWO arguments — so **every wire
 * payload across all ~30 `buildCanonicalAnalysisReadyFromGraph` call sites
 * carried `graph_hash: null`**, while the field's own contract promised "the
 * subject this verdict is about, so a consumer can tell a stale one". A promise
 * no consumer could ever redeem is guarantee theatre, and a `string | null`
 * whose null branch is the only reachable one is a field that cannot fire.
 *
 * ⚠ NO THIRD HASH IS MINTED. {@link analysisAffectingHashOf} READS the existing
 * analysis-affecting projection — same projection, same normaliser as
 * `freshness` — in its 64-hex form. Minting a third would be this estate's
 * signature defect (two `generateGraphHash` twins).
 */
export function analysisAdmissionFrom(
  admission: RunAdmission,
  graph: unknown,
  graphHash?: string | null,
): AnalysisAdmission {
  const signals = censusConfidenceParameters(graph);
  const semanticSufficient = semanticQualitySufficient(signals);
  const cause = semanticVerdictCause(signals);
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
  // ⚠ THE REASON NAMES THE CONJUNCT, NOT JUST THE VERDICT. A refusal that says
  // "everything here is Olumi's" to a user who HAS set a value is a false
  // sentence, and it prescribes a futile action — which is worse than saying
  // nothing. `semanticVerdictCause` is derived from the same signals the floor
  // reads, so the two cannot disagree; a test pins that.
  reasons.push({
    field: 'semantic_quality_sufficient',
    code: SEMANTIC_REASON[cause].code,
    message: SEMANTIC_REASON[cause].message,
  });

  // ── permitted_analysis_mode ────────────────────────────────────────────────
  reasons.push({
    field: 'permitted_analysis_mode',
    ...modeReason(mode, cause),
  });

  return {
    structurally_analysable: admission.willProceed,
    missing_important_inputs: missing,
    semantic_quality_sufficient: semanticSufficient,
    permitted_analysis_mode: mode,
    reasons,
    graph_hash: graphHash !== undefined ? graphHash : analysisAffectingHashOf(graph),
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
  graphHash?: string | null,
): AnalysisAdmission {
  return analysisAdmissionFrom(resolveRunAdmission(graph), graph, graphHash);
}
