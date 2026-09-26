/**
 * Agent lane — whole-candidate admission.
 *
 * Composes the banked construction candidate (faithful builder + widener) into
 * a canonical GraphV3 plus a loss ledger, reusing the per-concern admitters.
 *
 * ⭐ IDS ARE DETERMINISTIC, AND THAT IS LOAD-BEARING. The same candidate must
 * produce byte-identical nodes and edges, because the graph identity hash is
 * computed over them and the write boundary's CAS and replay contract are
 * expressed in that hash. A random or insertion-ordered id would make an
 * identical candidate look like a different model on every attempt, which
 * would defeat the replay recovery this lane has to prove.
 *
 * Node ids are slugged to NODE_ID_PATTERN (`^[a-z0-9_:-]+$`, <=100 chars) and
 * de-duplicated by appending an ordinal, so two entities whose labels slug to
 * the same token stay distinct and stay stable.
 */

import { REPAIR_CODES, type RepairEntry } from '@talchain/schemas';
import {
  CEE_GOAL_THRESHOLD_FRAME,
  resolveGoalThresholdCapWithProvenance,
} from '../../utils/goal-threshold-cap.js';
import { admitGoalBaseline } from '../../cee/factor-extraction/goal-baseline-admissibility.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../orchestrator/context/constants.js';
import { MAY_NAME_LEADING_OPTION } from '../../orchestrator/context/constraint-feasibility.js';
import type { InterventionV3T } from '../../schemas/cee-v3.js';
import { DEFAULT_EXISTS_PROBABILITY, STRENGTH_DEFAULT_SIGNATURE } from '@talchain/schemas';
import { labelMatchesBaseline } from '../../cee/transforms/analysis-ready.js';
import { readIsBaseline } from '../../cee/baseline-identity.js';
import { REPAIR_AUTHORED_ORIGIN } from '../../graph/repair-authored-edge.js';
import { isPercentScaledUnit, unitPinnedScaleFrame } from '../../cee/draft/records/unit-scale-class.js';
import { CONNECTIVITY_REPAIR_WIRING_REASON } from '../../cee/unified-pipeline/stages/repair/status-quo-fix.js';
import { admitCandidateLinks, type CandidateLink, type AdmittedEdge } from './admit-candidate.js';
import {
  admitCandidateConstraints,
  canonicaliseLimitUnit,
  type CandidateConstraint,
  type AdmittedConstraint,
} from './admit-constraint.js';

const MAX_ID = 100;

/**
 * ⛔ 33, AND THE NUMBER IS DERIVED, NOT CHOSEN.
 *
 * `structural_add_edge` builds its handler fact's `safe_summary` as
 * `Connected ${fromLabel} to ${toLabel}` (`structural-add-edge.ts:494`) and the
 * fact schema caps that string at **80**. "Connected " + " to " is 14, so the two
 * labels together must fit 66 — and a per-label cap of 33 guarantees ANY pair
 * composes.
 *
 * Measured the hard way: an admitted model whose labels were 53 and 18 produced
 * `safe_summary` at 85 and CEE refused the write with
 * `refusal_reason: "fact_invalid"`, telling the user "I couldn't record that
 * properly, so I haven't changed the model." It committed the turn honestly and
 * wrote no graph. A long label does not degrade the model — it makes the model
 * UNEDITABLE.
 *
 * The full text is never discarded: it goes to `description`, which `NodeV3`
 * declares, and the shortening is recorded in the ledger.
 */
const MAX_LABEL = 33;

export type CandidateNodeKind =
  | 'goal' | 'option' | 'factor' | 'risk' | 'outcome' | 'constraint' | 'decision';

/**
 * The decision the brief is asking about.
 *
 * ⛔ WITHOUT THIS THE MODEL CANNOT BE ANALYSED AT ALL. Run through the real
 * endpoint, `analysis_ready.status` came back `blocked` and the first readiness
 * issue was "The model has no decision node." The banked construction contract
 * emits goal, options, factors, risks, outcomes and links — and no decision — so
 * every model admitted from it was unanalysable before anything else mattered.
 *
 * It is `ai_inferred`: nobody stated it, it is read off the question the brief
 * asks. The label is the goal metric's decision framing, not invented content.
 */

export interface CandidateModel {
  readonly goal: {
    metric: string; operator: string; unit: string; horizon_months: number | null; provenance: string;
    /**
     * `false` means the brief named a DIRECTION and no number. Optional because the
     * originally banked candidate contract has no such field: a candidate from before
     * it is treated as stating a target when `value` is a finite number, which is
     * exactly what it used to mean.
     */
    target_stated?: boolean;
    value: number | null;
    /**
     * The goal metric's CURRENT level, when there is one. Optional because the
     * banked contract has no such field: absent means no current level, which is
     * exactly what an older candidate meant. `baseline_known: true` is a figure
     * the brief gave; `false` with a finite value is Olumi's estimate.
     * `baseline_provenance` defaults to the goal's own `provenance`.
     */
    baseline_known?: boolean;
    baseline_value?: number | null;
    baseline_provenance?: string;
    /**
     * Whether the goal metric is one part or the whole (C46: "£20k MRR" — Pro MRR or total
     * MRR?). Optional because the banked contract has no such field: absent or `null` means
     * the drafter saw no part-or-whole reading, exactly what an older candidate meant.
     */
    scope?: GoalScopeDeclaration | null;
  };
  readonly constraints: readonly CandidateConstraint[];
  readonly options: readonly {
    label: string;
    provenance: string;
    /**
     * What this option DOES — the factor levels it sets. Optional because the
     * original banked contract has no such field; when it is absent the model
     * is unanalysable and the product must ask the user for the mapping.
     */
    interventions?: readonly {
      factor_label: string;
      value: number;
      unit?: string;
      provenance: string;
    }[];
    /**
     * Factors this option changes WITHOUT a stated level.
     *
     * ⛔ WITHOUT THIS, A QUALITATIVE OPTION IS A DEAD END. Measured on a real
     * build: 3 of 6 options declared no numeric intervention — "Grandfather
     * Existing Customers", "Phased Price Increase", "Test Price Before
     * Rollout" — and so had no edge into the model at all, even though the
     * factors they act on were admitted. They were structurally unreachable
     * from the decision and could never appear in an analysis.
     *
     * The alternative was to make the model invent a level for them, which is
     * the defect this whole lane exists to avoid. So the option says WHAT it
     * changes and stays silent on BY HOW MUCH.
     */
    changes?: readonly string[];
    /**
     * The drafter's declaration that this is the one option that keeps things as
     * they are (strict output sends `null` otherwise). Read by `wireInertStatusQuo`
     * BEFORE the label idioms, so a held status quo never depends on wording.
     */
    is_status_quo?: boolean | null;
  }[];
  readonly factors: readonly { label: string; role: 'controllable' | 'observable' | 'external'; baseline_known: boolean; baseline_value: number | null; unit: string | null; provenance: string; plausible_max?: number | null }[];
  readonly risks: readonly { label: string; provenance: string }[];
  readonly outcomes: readonly { label: string; provenance: string }[];
  readonly links: readonly CandidateLink[];
  /**
   * Quantities the drafter DECLARES to be other quantities multiplied together (C46). Never
   * inferred from a label. Optional because the banked contract has no such field: absent
   * means none was declared, exactly what an older candidate meant.
   */
  readonly identities?: readonly CandidateIdentity[];
}

/**
 * The drafter's declaration of what the goal metric covers when it could be one part or the
 * whole. `modelled` is the scope the model measures, `alternative` the other reading, and
 * `stated_in_brief` is true only when the brief itself says which.
 */
export interface GoalScopeDeclaration {
  readonly modelled: string;
  readonly alternative: string;
  readonly stated_in_brief: boolean;
}

/** "`outcome` is `factors` multiplied together" — a definition the drafter states, by exact label. */
export interface CandidateIdentity {
  readonly outcome: string;
  readonly operation: string;
  readonly factors: readonly string[];
  readonly provenance: string;
}

/**
 * ⛔ C46 — THE TYPED MARK FOR A PRODUCT THE ANALYSIS CAN ONLY ADD UP.
 *
 * The analyse path is a linear SCM (`node = intercept + Σ parent × strength`, #70 5841215337),
 * so a declared product is always approximated. When an option can push two of its inputs in
 * opposite directions, even the SIGN of the effect is not provable over the plausible range
 * (£49 → £59: −1,360 at 100 subscribers, +640 at 300; the linear model says −960 at both), and
 * the ruling (#70 5841314428) is that no leader or decision-grade claim may rest on it:
 * `sign_not_provable`. When every option moves the inputs the same way, the direction holds
 * over the non-negative range and only the size is approximate: `sign_stable_provisional`.
 * Two options that move the inputs DIFFERENTLY can swap places within the plausible range even
 * when each is stable alone, so they are `sign_not_provable` too (`comparisons_not_sign_stable`).
 *
 * ⭐ HOW IT REACHES THE LEADER CLAIM (C46 stage 1 (a)–(d), #70 5841833807). The mark itself is
 * construction's report. What is PERSISTED is the checked DECLARATION, on the product's node
 * (`cee-v3.ts` NodeV3 `nonlinear_identity`); `run_analysis` re-runs this same sign test on the
 * graph it analysed (`nonlinearIdentityLeaderWithhold`) and withholds the leader it names when
 * that leader is sign-unproven against another compared option.
 */
export type NonlinearIdentityVerdict = 'sign_not_provable' | 'sign_stable_provisional';
export interface NonlinearIdentityMark {
  readonly outcome_id: string;
  readonly operation: 'product';
  readonly factor_ids: readonly string[];
  readonly verdict: NonlinearIdentityVerdict;
  /**
   * Every option the verdict rests on, by node id, in model order: one that can move the inputs
   * apart on its own (against carrying on as now), one whose routes through and around the product
   * move the goal in opposite directions (also against carrying on as now), or one in a comparison
   * below. Empty when stable.
   */
  readonly options_not_sign_stable: readonly string[];
  /**
   * Pairs of options (model order) that move the product's inputs DIFFERENTLY — different inputs,
   * different signs, different levers for two inputs, or one moving none of them — or of which one
   * also reaches the goal AROUND the product, so which of the two does better can flip within the
   * plausible range (independent verification of 6e33b95e, B1; re-verification of d2362e9d, B1).
   */
  readonly comparisons_not_sign_stable: readonly (readonly [string, string])[];
}

/** The persisted carrier on the product's node (`cee-v3.ts` NodeV3 `nonlinear_identity`). */
export interface NonlinearIdentityCarrier {
  readonly operation: 'product';
  readonly factor_ids: readonly string[];
  readonly stated_in_brief: boolean;
}

/** A declaration that held structurally and bears on the goal — what the carrier persists. */
interface AcceptedProductIdentity {
  readonly outcome_id: string;
  readonly factor_ids: readonly string[];
  readonly stated_in_brief: boolean;
}

/**
 * The sign test's working, per marked product, for the Run-time leader check: which options
 * cannot be signed against carrying on as now on their own (`unproven_alone`), which move any of
 * the product's inputs or reach the goal (`moving`), and which pairs of those can swap places.
 */
interface ProductIdentityAnalysis {
  readonly outcome_id: string;
  readonly goal_id: string;
  readonly factor_ids: readonly string[];
  readonly stated_in_brief: boolean;
  readonly verdict: NonlinearIdentityVerdict;
  readonly unproven_alone: readonly string[];
  readonly moving: readonly string[];
  readonly pairs: readonly (readonly [string, string])[];
}

interface ProductIdentityFindings {
  marks: NonlinearIdentityMark[];
  loss: RepairEntry[];
  accepted: AcceptedProductIdentity[];
  analyses: ProductIdentityAnalysis[];
}

export interface WidenerAdditions {
  readonly proposed_options?: readonly { label: string }[];
  readonly proposed_factors?: readonly { label: string }[];
  readonly proposed_risks?: readonly { label: string }[];
  readonly proposed_outcomes?: readonly { label: string }[];
  readonly proposed_links?: readonly CandidateLink[];
}

/**
 * ⛔ A CONSTRUCTED LEVEL STATES WHERE ITS NUMBER CAME FROM, OR IT CAN NEVER BE REVISED.
 *
 * MEASURED on served staging (scenario A of the acceptance witness): these
 * cells were written as a bare `{ value }`, and the option-intervention writer
 * (`prepareOptionInterventionEdit`) refuses to overwrite an existing entry
 * with no `source` — `invalid_existing_intervention`. So a starting point that
 * REVISED a level the brief stated came back `partially_applied`: the user
 * approved it and the level did not move. The writer's rule is right (an entry
 * with no stated origin cannot be replaced with user authority without erasing
 * what it was), so the fix is here, at the producer.
 *
 * The claim is the same one `framedObservedState` makes for a baseline:
 * `explicit` means the brief stated it (`brief_extraction`), anything else is
 * Olumi's hypothesis (`cee_hypothesis`). `user_specified` is EXCLUDED from the
 * type on purpose: a machine-derived level never claims user authority, and
 * only the writer, on a user's approved change, mints that stamp.
 */
export type ConstructedLevelSource = Exclude<InterventionV3T['source'], 'user_specified'>;
export interface ConstructedLevel { value: number; source: ConstructedLevelSource }

const levelSourceFor = (provenance: string): ConstructedLevelSource =>
  provenance === 'explicit' ? 'brief_extraction' : 'cee_hypothesis';

export interface AdmittedNode {
  /** The full text, when the label had to be shortened to stay editable. */
  description?: string;
  /**
   * factor node id -> encoded level this option sets.
   *
   * Written at the node's TOP LEVEL because `interventions` is a DECLARED field
   * on `NodeV3` and `NodeV3` STRIPS UNDECLARED KEYS — a `data.interventions`
   * object, which is `edit_graph`'s canonical edit location, would not survive
   * persistence from here. `extractNumericIntervention` reads both.
   */
  interventions?: Record<string, ConstructedLevel>;
  id: string;
  kind: CandidateNodeKind;
  label: string;
  category?: 'controllable' | 'observable' | 'external';
  /**
   * `raw_value`, `cap` and `declared_scale` are the SCALE FRAME. They are
   * written by `framedObservedState` so a number above 1 is analysable at all
   * (`baseline_scale_unresolved` otherwise), and declared here because the
   * type was the reason three test files failed the typecheck ratchet while
   * `tsconfig.build.json` — which excludes tests — reported clean.
   */
  observed_state?: { value: number; unit?: string; source?: string; raw_value?: number; cap?: number; declared_scale?: string; baseline?: number };
  /**
   * `cee-v3.ts` `scale_frame`: the divisor this factor's levels are stated
   * on, for a factor with no baseline. The declared carrier; see the write site.
   */
  scale_frame?: number;
  goal_threshold?: number;
  /** `cee-v3.ts:210`. A threshold with no unit is not a threshold. */
  goal_threshold_unit?: string;
  /**
   * `cee-v3.ts:246`. The contract states a consumer must produce NO goal
   * probability when this is absent, so omitting it silently disables the goal.
   */
  goal_threshold_frame?: 'level' | 'delta';
  /**
   * ⛔ A NODE'S `provenance` IS A DISPLAY ENUM, NOT THE EDGE OBJECT
   * (`cee-v3.ts:363` — `from_brief | ai_inferred | user_set`). Edges carry the
   * structured `{source, reasoning}` (`:443`); nodes do not. Stamping the edge
   * shape here made the whole persisted graph fail `GraphV3.safeParse`, which
   * `structural-add-edge.ts:233` treats as CORRUPTION — so every write to the
   * scenario returned 500 until this was fixed.
   */
  provenance?: 'from_brief' | 'ai_inferred' | 'user_set';
  /**
   * `cee-v3.ts` option field. Written ONLY on the option the drafter DECLARED as the
   * status quo (`is_status_quo`) and that was wired as held — readiness's own first
   * baseline signal, so a declared status quo is held whatever its label. The idiom
   * fallback writes no stamp (readiness recognises the idiom itself).
   */
  is_baseline?: boolean;
  /** C46: the checked product declaration on this quantity (`cee-v3.ts` NodeV3 `nonlinear_identity`). */
  nonlinear_identity?: NonlinearIdentityCarrier;
  /** Normalised 0-1, per the contract. The stated number goes in `_raw`. */
  goal_threshold_raw?: number;
  goal_threshold_cap?: number;
  goal_threshold_cap_provenance?: string;
}

export interface AdmittedModel {
  readonly nodes: readonly AdmittedNode[];
  /** node id -> how it got here. Projection metadata; belongs in the ledger. */
  readonly inference_classes: Readonly<Record<string, InferenceClass>>;
  readonly edges: readonly AdmittedEdge[];
  readonly goal_constraints: readonly AdmittedConstraint[];
  readonly loss: readonly RepairEntry[];
  /**
   * `loop` is carried only on a `loop_closing_link` entry: the loop that link closed, in the
   * drafter's own labels, in loop order — so the producer's repair issue names exactly the
   * loop admission broke (`build-model.ts`, `loopIssues`). Never written to the wire.
   */
  readonly withheld: readonly { from: string; to: string; reason: string; detail: string; loop?: readonly string[] }[];
  /** Factors the model called controllable that no option changes — held as context (demoteUnreachedLevers). */
  readonly treated_as_context?: readonly string[];
  /** Declared products that options move (`markProductIdentities`); each is also a `loss` entry. */
  readonly nonlinear_identities?: readonly NonlinearIdentityMark[];
  /**
   * Options Olumi added that nothing the model holds tells apart from another option — withheld
   * (`option_indistinct`, `admitCandidateModel`), each with the step said to the user. Not in `withheld`,
   * which is a list of LINKS by contract; the ledger records each in `loss`.
   */
  readonly options_withheld?: readonly WithheldOption[];
  /** USER-stated options that nothing the model holds tells apart: all kept, and asked about ONCE per group. */
  readonly indistinct_stated_options?: readonly { readonly options: readonly string[]; readonly question: string }[];
}

export interface WithheldOption {
  /** The option's full text, as drafted. */
  readonly option: string;
  /** The option it cannot be told from, as drafted. */
  readonly like: string;
  readonly reason: 'option_indistinct';
  /** What the user is told, word for word. */
  readonly sentence: string;
}

/** Shorten to the label budget at a word boundary, never mid-word. */
export function shortLabel(full: string): string {
  if (full.length <= MAX_LABEL) return full;
  const cut = full.slice(0, MAX_LABEL - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > MAX_LABEL / 2 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.-]+$/, '') + '\u2026';
}

export function slugId(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_ID);
  return base.length > 0 ? base : 'node';
}

/** Same words, ignoring case and spacing — the test for "the same thing". */
const canonicalLabel = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Deterministic, collision-safe id assignment in a fixed traversal order.
 *
 * ⛔ A SUFFIXED DUPLICATE ORPHANS THE GOAL. This keyed the map by the EXACT
 * label string, so the goal metric `"monthly recurring revenue"` and the
 * outcome `"Monthly Recurring Revenue"` became two nodes, the second suffixed
 * `_2`. The model's links all named the outcome spelling, so the whole causal
 * chain terminated on the duplicate and the GOAL NODE WAS ISOLATED. Measured on
 * the built model: 6 of 6 options could not reach the goal and 16 of 38 nodes
 * had no edge at all — a model that is honest about its numbers and cannot be
 * analysed. It happened twice in one build (churn too).
 *
 * Entities that spell the same name resolve to ONE id, and because the goal
 * comes first in the traversal order it is the goal that survives. The map
 * still answers to BOTH spellings, so a link written either way resolves.
 *
 * The merge condition is deliberately narrow: identical words, ignoring case
 * and spacing. It never merges two different names.
 */
function assignIds(labels: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const byCanonical = new Map<string, string>();
  const used = new Set<string>();
  for (const label of labels) {
    if (out.has(label)) continue;
    const canonical = canonicalLabel(label);
    const existing = byCanonical.get(canonical);
    if (existing !== undefined) {
      // The same thing, spelled differently. One node, reachable by both names.
      out.set(label, existing);
      continue;
    }
    const base = slugId(label);
    let id = base;
    let n = 2;
    while (used.has(id)) {
      const suffix = `_${n++}`;
      id = base.slice(0, MAX_ID - suffix.length) + suffix;
    }
    used.add(id);
    byCanonical.set(canonical, id);
    out.set(label, id);
  }
  return out;
}

/**
 * 'explicit' means the user stated it IN THE BRIEF — `brief_extraction`, not
 * `user_specified`. See the note in `admit-candidate.ts`: the money invariant
 * (`src/cee/provenance/money-invariant.ts:211`) only audits figures stamped
 * `brief_extraction`, so the wrong stamp here silently exempted every
 * brief-derived figure from that audit.
 */

/** The node display vocabulary. `user_set` is reserved for a direct user edit. */
const displayProvenanceFor = (provenance: string): 'from_brief' | 'ai_inferred' =>
  provenance === 'explicit' ? 'from_brief' : 'ai_inferred';

/**
 * The inference CLASS, which the graph cannot carry.
 *
 * The node display enum collapses `inferred` and `ai_proposed` into
 * `ai_inferred`, and W3 has to score unsupported inference. So the class rides
 * in the admitted model beside the graph — and, being projection metadata rather
 * than canonical model data, it belongs in the ledger, not in `scenarios.graph`.
 */
export type InferenceClass = 'brief_stated' | 'builder_inferred' | 'model_proposed';

const inferenceClassFor = (provenance: string): InferenceClass => {
  if (provenance === 'explicit') return 'brief_stated';
  if (provenance === 'ai_proposed') return 'model_proposed';
  return 'builder_inferred';
};


/**
 * ⭐ A BARE AMOUNT IS UNANALYSABLE, AND THAT IS THE PRODUCT'S OWN RULE.
 *
 * ⛔ MEASURED LIVE, 22 Sep, served 877ae800, on a model with every factor
 * valued and zero structural blockers. Olumi refused:
 *
 *   "Pro feature value, Pro subscriber count, New Pro conversions, Revenue per
 *    Pro subscriber is recorded as a bare amount with no range for me to
 *    measure it against … I've stopped rather than show you a confident wrong
 *    answer."   -> `blocked_reason: baseline_scale_unresolved`
 *
 * `findScaleIncoherentBaselineFactorIds` accepts a factor on exactly three
 * grounds: it carries a `cap`; its value is already within [0, 1]; or its
 * `{value, raw_value}` pair encodes the frame (`raw > value`). Nothing else.
 *
 * ⛔ AND NO LATER EDIT CAN SUPPLY ONE. `factor_value_edit` is `.strict()` with
 * no cap field, and posting the pair directly is accepted with HTTP 200 and
 * then normalised back to `raw === value` — the one shape `recoverScaleFrame`
 * explicitly refuses. Measured on the wire, both arms. So the frame must be
 * established HERE, at construction, or the factor is permanently unanalysable.
 *
 * ⚠ THE CAP IS A FRAME, NOT A CLAIM. `raw_value` keeps the user's own number
 * untouched and `value` is that number read against the range, which is what
 * the engine compares across factors. The range is the model's proposal and is
 * recorded in the ledger as such — it is not a forecast, and it never replaces
 * what the user said.
 */
function framedObservedState(f: {
  baseline_value: number | null; unit: string | null; provenance: string; plausible_max?: number | null;
}): Record<string, unknown> {
  const raw = f.baseline_value as number;
  const base = {
    ...(f.unit ? { unit: f.unit } : {}),
    ...(f.provenance === 'explicit' ? { source: 'brief_extraction' } : {}),
  };
  const cap = f.plausible_max;
  // Already a proportion, or no usable range: leave it exactly as it was. A
  // cap that is not strictly above the value would encode a frame of 1 or less,
  // which `recoverScaleFrame` refuses and which would misstate the magnitude.
  //
  // ⛔⛔ `raw <= 0` USED TO DROP THE FRAME, AND A BASELINE OF ZERO IS ORDINARY.
  //
  // Measured on Paul's live journey (#63 item 1): "Enterprise customers" came out
  // as `{ value: 0, unit: 'customers' }` — no cap, no frame — because the builder's
  // `plausible_max` was thrown away here and `:524` below only wrote `scale_frame`
  // when NO baseline was known. So the one factor shape a user is most likely to
  // start from, a count that is currently zero, was permanently unanalysable:
  // `baseline_scale_unresolved` refuses it and no later edit can set a frame.
  //
  // Zero is a perfectly good baseline on a 0..cap frame — `0 / cap === 0` — so the
  // only genuinely unusable cases are a missing/non-finite cap, a cap that is not
  // strictly above 1, a NEGATIVE baseline (which a 0..cap frame cannot express),
  // and a baseline above the cap.
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 1 || raw < 0 || raw > cap) {
    return { value: raw, ...base };
  }
  return { value: raw / cap, raw_value: raw, cap, declared_scale: 'unit_interval', ...base };
}

/**
 * ⛔ AN AI ESTIMATE IS OLUMI'S FIGURE — KEPT, AND NEVER PASSED OFF AS THE USER'S.
 *
 * A factor the builder ESTIMATED (`baseline_known: false`, a finite
 * `baseline_value`) used to be dropped outright: the baseline branch below wrote
 * `observed_state` only for a KNOWN baseline, so a freshly built model had
 * nothing for a provisional first analysis to start from.
 *
 * ⭐ THE SHAPE IS CAPLESS, AND THAT IS BINDING. `{ value: raw / c, raw_value,
 * unit?, source: 'cee_inference', extractionType: 'inferred' }` beside the node's `scale_frame: c` — exactly
 * what `set_factor_value` writes when a user adopts a value on a framed factor
 * (`construction-range-carrier.test.ts`). NO `observed_state.cap` and NO
 * `declared_scale`: a capped shape would let Olumi's own guessed range refuse the
 * user's later correction through the revise path (#1767).
 *
 * `source` is written LAST, after every spread, so an estimate can never inherit
 * `brief_extraction` from a factor the user named. An estimate that cannot be
 * framed (no usable range, negative, or above the range) stays MISSING — it is
 * never written unframed, which would raise a blocking scale issue over a number
 * the user never gave.
 */
function estimatedObservedState(
  f: { baseline_known: boolean; baseline_value: number | null; unit: string | null },
  c: number | null | undefined,
): Record<string, unknown> | null {
  if (f.baseline_known) return null;
  const raw = f.baseline_value;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (typeof c !== 'number' || !Number.isFinite(c) || c <= 1 || raw < 0 || raw > c) return null;
  // `extractionType: 'inferred'` is the stamp the conventional builders write for a value the
  // brief did not state; the canvas reads it to say "Olumi estimate" (served UI b017e3c2 showed
  // "no source" without it). A value a person later sets withdraws it (`set-factor-value.ts`).
  return { value: raw / c, raw_value: raw, ...(f.unit ? { unit: f.unit } : {}), source: 'cee_inference', extractionType: 'inferred' };
}

/**
 * ⭐ A DEFAULT FRAME, DERIVED FROM THE DATA AND DISCLOSED — the backstop.
 *
 * The builder is required to state a `plausible_max` for every factor, and a
 * widener-proposed factor has no such field at all. A factor that reaches the
 * graph without a range is PERMANENTLY unanalysable: no system event can add a
 * cap afterwards (measured — `factor_value_edit` is `.strict()` with no cap
 * field, and posting a `{value, raw_value}` pair is accepted with HTTP 200 and
 * normalised back to `raw === value`). The only remedy would be rebuilding the
 * whole model, which is not a thing a user should be asked to do.
 *
 * ⚠ SO A FRAME IS SUPPLIED, AND THIS IS A REAL CONCESSION. Current CEE does
 * the same thing silently — it is why a user's £49 came back as 0.49. The
 * difference here is the whole point: the frame is the smallest power of ten
 * strictly above the largest number the model itself carries for that factor,
 * so it is DERIVED from the data rather than picked; `raw_value` keeps the
 * user's own number untouched; and it is recorded in the ledger as defaulted,
 * so the Agent says it out loud. It is a unit of measurement, not a claim.
 */
export function defaultFrameFor(largestMagnitude: number): number {
  const magnitude = Math.abs(largestMagnitude);
  if (!Number.isFinite(magnitude) || magnitude <= 1) return 1;
  return 10 ** Math.ceil(Math.log10(magnitude) + Number.EPSILON);
}

/**
 * ⛔ A LEVER NO OPTION PULLS IS CONTEXT, NOT A LEVER (served 23 Sep, `c4a6cce`,
 * canonical pricing brief). The builder marked "Pro feature release readiness"
 * `controllable`, but no option changes it — so readiness refused the whole
 * comparison (`Factor … is not connected to any option`, the sole blocker) even
 * after the user adopted every starting value. For THIS decision a factor that
 * no option reaches is held at its value while the options are compared: it is
 * context. It is reclassified `external` — never given an invented option or a
 * number — and the user is told, so they can say which option should change it.
 *
 * Pure over the admitted graph: an option reaches a factor through an edge
 * (transitively) or through its `interventions`.
 */
export function demoteUnreachedLevers<N extends { id: string; kind?: string; label?: string; category?: string; interventions?: Record<string, unknown> }>(
  nodes: readonly N[],
  edges: readonly { from: string; to: string }[],
): { nodes: N[]; demoted: string[] } {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  // ⛔ REACHED AND EXPANDED ARE SEPARATE (independent review of c222fc67): a
  // target named by an option's `interventions` is a ROOT to expand, not merely a
  // node to mark — pre-marking it skipped its downstream factors, so for
  // option → A → B an intervention on A relabelled a reachable B as context.
  const reached = new Set<string>();
  const queue: string[] = [];
  for (const n of nodes) {
    if (n.kind !== 'option') continue;
    queue.push(...Object.keys(n.interventions ?? {}), ...(next.get(n.id) ?? []));
  }
  while (queue.length > 0) {
    const x = queue.pop()!;
    if (reached.has(x)) continue;
    reached.add(x);
    queue.push(...(next.get(x) ?? []));
  }
  const demoted: string[] = [];
  const out = nodes.map((n) => {
    if (n.kind !== 'factor' || reached.has(n.id)) return n;
    if (n.category === 'external' || n.category === 'observable') return n;
    demoted.push(n.label ?? n.id);
    return { ...n, category: 'external' };
  });
  return { nodes: out, demoted };
}

/**
 * ⛔ AN INERT STATUS QUO IS A HELD BASELINE, NOT A BROKEN OPTION (Paul's ruling;
 * the conventional lane already does this in `status-quo-fix.ts`).
 *
 * "Maintain current staffing", given no `changes` and no `interventions`, got no
 * option→factor edge, so readiness raised `OPTION_NO_FACTOR_EDGES` — a blocker
 * that is not waivable by exclusion — and the WHOLE model was refused. It caused
 * 4 of 9 hiring builds to fail in an earlier witness. Yet "carry on as now" needs
 * no level: holding every factor at its starting value IS its specification.
 *
 * So the ONE option whose label reads as the status quo (`labelMatchesBaseline`,
 * the readiness authority's own idiom list) is connected to the factors the
 * OTHER options set levels on — falling back to the factors they connect to —
 * with deterministic repair edges. Readiness excludes exactly those edges from
 * its mapping count (`isRepairAuthoredOptionFactorEdge`), so the option is held,
 * not asked for a level it cannot have. Pure: it only DECIDES; the caller mints.
 *
 * Returns null — the option stays inert, named, and refused — when no label or
 * TWO labels match (ambiguity is not resolved by guessing), when the matching
 * option already has any option→factor edge, or when the basis is empty.
 */
export function wireInertStatusQuo(
  nodes: readonly { id: string; kind?: string; label?: string }[],
  edges: readonly { from: string; to: string }[],
  interventionsByOption: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  declaredStatusQuoIds: ReadonlySet<string> = new Set(),
): { optionId: string; factorIds: string[] } | null {
  const options = nodes.filter((n) => n.kind === 'option');
  const factorIds = new Set(nodes.filter((n) => n.kind === 'factor').map((n) => n.id));
  /** The factors this option would be held against, or null if it cannot be held (it acts, or nothing to hold). */
  const holdAgainst = (statusQuo: { id: string }): string[] | null => {
    if (edges.some((e) => e.from === statusQuo.id && factorIds.has(e.to))) return null;
    const others = options.filter((o) => o.id !== statusQuo.id);
    const basis = new Set<string>();
    for (const o of others) {
      for (const fid of Object.keys(interventionsByOption.get(o.id) ?? {})) if (factorIds.has(fid)) basis.add(fid);
    }
    if (basis.size === 0) {
      const otherIds = new Set(others.map((o) => o.id));
      for (const e of edges) if (otherIds.has(e.from) && factorIds.has(e.to)) basis.add(e.to);
    }
    return basis.size === 0 ? null : [...basis];
  };
  // ⭐ THE DRAFTER'S DECLARATION FIRST (served c673223: "Continue Current Staffing"
  // is not an idiom, and the turn blocked). Two declared → null: never guess.
  // ⛔ ONE WRONG FLAG MUST NOT BLOCK WHAT BASE HELD (review 5825562938, B1): a single
  // declared option that cannot be held (it acts, or there is nothing to hold it
  // against) falls back to the idiom list, exactly as if nothing were declared. No
  // idiom is added.
  const declared = options.filter((o) => declaredStatusQuoIds.has(o.id));
  if (declared.length > 1) return null;
  if (declared.length === 1) {
    const held = holdAgainst(declared[0]!);
    if (held !== null) return { optionId: declared[0]!.id, factorIds: held };
  }
  const matches = options.filter((o) => labelMatchesBaseline(o.label ?? ''));
  if (matches.length !== 1) return null;
  const held = holdAgainst(matches[0]!);
  return held === null ? null : { optionId: matches[0]!.id, factorIds: held };
}

/**
 * The shortest mechanism from `from` to `to` over `edges`, or null — THE
 * option→risk mechanism test (#1830), exported so the producer
 * (`runtime/build-model.ts`) asks the same question admission answers rather
 * than a second derivation of it. Pure breadth-first search in edge order; the
 * caller decides which edges count (admission removes every machine-authored
 * shortcut first, so no shortcut can be its own mechanism).
 */
export function findMechanismPath(
  edges: readonly { from: string; to: string }[],
  from: string,
  to: string,
): readonly string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const head = path[path.length - 1]!;
    if (head === to) return path;
    for (const next of adjacency.get(head) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

/**
 * ⛔ C46 — "£20k MRR" IS NEVER SILENTLY PRO MRR (#70 5841314428: "scope … must be clarified
 * or explicitly named before analysis; never silently pick one"). MEASURED on Paul's captured
 * brief: the goal came back as bare "MRR" while every path into it was Pro price and Pro
 * subscribers, and the scope question lived only in prose.
 *
 * Returns the scope to NAME and ASK about, or null: no declaration, a scope the brief itself
 * stated, or a declaration with nothing to name. Read only from the drafter's declaration —
 * never from the metric's wording.
 */
function unstatedGoalScope(goal: CandidateModel['goal']): { modelled: string; alternative: string } | null {
  const s = goal.scope;
  if (s === null || s === undefined || typeof s !== 'object' || s.stated_in_brief !== false) return null;
  const modelled = typeof s.modelled === 'string' ? s.modelled.trim() : '';
  const alternative = typeof s.alternative === 'string' ? s.alternative.trim() : '';
  if (modelled === '' || alternative === '') return null;
  return metricNamesScope(String(goal.metric ?? ''), modelled, alternative) ? null : { modelled, alternative };
}

/** Words that never tell one scope from another. */
const SCOPE_FILLER = new Set(['the', 'a', 'an', 'only', 'just', 'of', 'for', 'and', 'or', 'in', 'on', 'to', 'our', 'its', 'their']);
const scopeWords = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z0-9]+/)
  .filter((w) => w !== '' && !SCOPE_FILLER.has(w))
  .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)));

/**
 * Words that turn a scope into its COMPLEMENT ("Non-Pro MRR", "MRR excluding Pro", "plans other
 * than Pro"), after `scopeWords`' plural stripping. A metric carrying one names the part the model
 * does NOT measure, however many of the modelled scope's words it also contains.
 */
const SCOPE_COMPLEMENT = new Set([
  'non', 'not', 'no', 'ex', 'excl', 'exclude', 'excluding', 'excluded', 'exclusive', 'except', 'excepting', 'exception',
  'without', 'other', 'beside', 'minus', 'outside', 'rest', 'remaining', 'remainder', 'apart', 'beyond',
]);

/**
 * ⭐ N-a (independent verification of 6e33b95e): "Pro MRR" already SAYS which part it is. The
 * scope counts as stated when the metric's own words contain every word that tells the modelled
 * scope from the alternative ("pro" in "the Pro plan only" vs "all plans together") and none of
 * the alternative's. Anything less — bare "MRR", or "Total MRR" while the model measures the Pro
 * plan — is still named and asked. Plurals and filler words are ignored on both sides.
 *
 * ⛔ NEVER A COMPLEMENT (re-verification of d2362e9d, item a). "Non-Pro MRR", "MRR excluding Pro"
 * and "MRR from plans other than Pro" all contain "pro" and none of "all plans together", and each
 * names the OTHER part. A complement word counts against the metric unless the modelled scope uses
 * it itself ("plans other than Pro" is stated by "MRR from plans other than Pro"). Asking is the
 * safe side: a wrong "stated" silently picks the scope, a wrong "asked" costs one question.
 */
function metricNamesScope(metric: string, modelled: string, alternative: string): boolean {
  const said = scopeWords(metric);
  const mine = scopeWords(modelled);
  const other = scopeWords(alternative);
  if ([...said].some((w) => SCOPE_COMPLEMENT.has(w) && !mine.has(w))) return false;
  const own = [...mine].filter((w) => !other.has(w));
  const theirs = [...other].filter((w) => !mine.has(w));
  return own.length > 0 && own.every((w) => said.has(w)) && !theirs.some((w) => said.has(w));
}

/** `"A"`, `"A" and "B"`, `"A", "B" and "C"` — words, never ids. */
const quotedList = (items: readonly string[]): string => {
  const q = items.map((s) => `"${s}"`);
  return q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
};

/**
 * ⛔ C46 STAGE 1 — CHECK A DECLARED PRODUCT, THEN ASK WHETHER ITS SIGN IS PROVABLE.
 *
 * DETECTION IS THE DRAFTER'S DECLARATION, CHECKED STRUCTURALLY, NEVER A LABEL READ. A
 * declaration is used only when: the operation is `product`; the outcome and every factor
 * resolve to quantities (goal / outcome / factor) in the admitted model; there are at least two
 * distinct factors, none of them the outcome; and every factor FEEDS the outcome through the
 * admitted links. Anything else is rejected and said (`nonlinear_identity_rejected`), and
 * nothing about it is assumed. A product whose outcome does not reach the goal does not bear on
 * the comparison and is not marked.
 *
 * THE LEVERS. An option's levers are the nodes it acts on: every edge out of it except a held
 * status quo's repair edges, and — PER LEVER (N-b; re-verification of d2362e9d, item b) — except a
 * lever whose level equals that factor's baseline. So an option at today's level on every lever
 * moves nothing, and so does the declared status quo unless one of its levels differs from today
 * (a flag contradicted by a level is not trusted).
 *
 * THE SIGN TEST, PER OPTION. The sign of every simple causal path from a lever to each input is
 * taken over the admitted links (never through the outcome itself; a lever that IS an input
 * moves it +). Then:
 *  · one input moved (or none): the product moves with that input — stable;
 *  · two or more inputs moved by ONE lever, every path sign equal: they move together, and on
 *    non-negative quantities the product moves the same way — stable;
 *  · otherwise — opposite signs or a mixed input (said as "can push … in opposite directions"), or
 *    inputs moved one way through two or more separate levers whose relative size the structure
 *    does not state (said as that, item b) — NOT provable (conservative);
 *  · and, whatever the inputs do, an option that ALSO reaches the goal around the product (below) in
 *    the OPPOSITE direction to its route through it — NOT provable, even against carrying on as now
 *    (verification of 1047641f, findings 3 and 4; said as "can push … one way through … and the other
 *    way by another route"). Routes around that agree in direction keep the sign.
 *
 * ⛔ THE COMPARISON ARM (independent verification of 6e33b95e, B1). Checking each option only
 * against the status quo let two stable options be ranked by a sum of effects that cannot rank
 * them: an add-on raising revenue per user gains ΔR·S, a referral scheme raising subscribers
 * gains R·ΔS′, and which is larger depends on the levels R and S sit at. So every option that
 * reaches the goal carries a SIGNATURE — the sign with which it moves each input (or not at all)
 * and, when it moves two or more, the lever it moves them through — and any two options whose
 * signatures differ are a comparison the model cannot sign. Options that move the same one
 * input the same way, or move both through the same one lever, keep one ranking — unless one of
 * them also reaches the goal AROUND the product (re-verification of d2362e9d, B1): a lever with a
 * path to the goal that avoids the outcome, or one that reaches an addend of the outcome, gains
 * R·ΔS + ΔN against R·ΔS′, so it is paired with every other moving option. The comparison sentence
 * groups the options by how they move the inputs (item d), never one list read as "all differ".
 *
 * Any option or comparison not provable makes the verdict `sign_not_provable`; otherwise, if
 * any option moves an input, `sign_stable_provisional`, whose sentence never claims that a
 * result's or a comparison's direction holds. If no option moves an input, the comparison does
 * not rest on the product and nothing is marked.
 *
 * WHOSE READING, AND OF WHAT (N-c). A declaration the brief states (`explicit`) is said as fact;
 * any other is "Olumi reads …". A declaration on a quantity that has an ADDEND — a direct cause
 * that is not a declared factor and is not the product's carrier (the one cause every factor's
 * route runs through) — is only PART of that quantity, and is said so. A cause a factor drives is
 * still an addend (item c), and so is a cause that drives a factor (finding 3 of 1047641f).
 */
function markProductIdentities(
  declared: readonly CandidateIdentity[],
  resolve: (label: string) => string | undefined,
  nodes: readonly AdmittedNode[],
  edges: readonly { from: string; to: string; effect_direction?: string; origin?: string }[],
  goalId: string | undefined,
  declaredStatusQuo: ReadonlySet<string> = new Set(),
): ProductIdentityFindings {
  const marks: NonlinearIdentityMark[] = [];
  const loss: RepairEntry[] = [];
  const accepted: AcceptedProductIdentity[] = [];
  const analyses: ProductIdentityAnalysis[] = [];
  if (declared.length === 0) return { marks, loss, accepted, analyses };
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  const labelOf = (id: string): string => nodeOf.get(id)?.label ?? id;
  const QUANTITY = new Set<CandidateNodeKind>(['goal', 'outcome', 'factor']);
  const INPUT = new Set<CandidateNodeKind>(['outcome', 'factor']);

  // Causal links only: an option's edges are its LEVERS, the decision's are topology.
  const causal = new Map<string, { to: string; sign: 1 | -1 }[]>();
  for (const e of edges) {
    const k = kindOf.get(e.from);
    if (k === 'decision' || k === 'option') continue;
    causal.set(e.from, [...(causal.get(e.from) ?? []), { to: e.to, sign: e.effect_direction === 'negative' ? -1 : 1 }]);
  }
  const reaches = (from: string, to: string): boolean => findMechanismPath(edges, from, to) !== null;
  /** Signs of every simple causal path from → to, never passing through `avoid`. Over budget ⇒ both. */
  const pathSigns = (from: string, to: string, avoid: string): Set<number> => {
    if (from === to) return new Set([1]);
    const signs = new Set<number>();
    let budget = 20_000;
    const seen = new Set([from]);
    const walk = (at: string, sign: number): void => {
      if (signs.size === 2 || --budget <= 0) return;
      if (at === to) { signs.add(sign); return; }
      for (const next of causal.get(at) ?? []) {
        if (seen.has(next.to) || next.to === avoid) continue;
        seen.add(next.to);
        walk(next.to, sign * next.sign);
        seen.delete(next.to);
      }
    };
    walk(from, 1);
    return budget <= 0 ? new Set([1, -1]) : signs;
  };

  // N-b: the levers each option really moves, PER LEVER (re-verification of d2362e9d, item b): a
  // lever left at today's level moves nothing, whatever the option's other levers do. A declared
  // status quo moves nothing unless it sets some lever off today's level (a flag contradicted by a
  // level is not trusted).
  const TODAY_EPSILON = 1e-9;
  const todayOf = (factorId: string): number | undefined => {
    const v = nodeOf.get(factorId)?.observed_state?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const leversOf = (o: AdmittedNode): string[] => {
    const levers = [...new Set(edges.filter((e) => e.from === o.id && e.origin !== REPAIR_AUTHORED_ORIGIN).map((e) => e.to))];
    const levelOf = (t: string): number | undefined => o.interventions?.[t]?.value;
    const atToday = (t: string): boolean => {
      const level = levelOf(t);
      const today = todayOf(t);
      return level !== undefined && today !== undefined && Math.abs(level - today) <= TODAY_EPSILON;
    };
    const moved = levers.filter((t) => !atToday(t));
    // The declared status quo's flag holds unless one of its own levels contradicts it.
    if (declaredStatusQuo.has(o.id) && !moved.some((t) => levelOf(t) !== undefined)) return [];
    return moved;
  };

  for (const d of declared) {
    const outcomeId = resolve(d.outcome);
    const factors = Array.isArray(d.factors) ? d.factors : [];
    const reject = (why: string): void => {
      loss.push({
        field_path: `nodes[${outcomeId ?? slugId(String(d.outcome))}].nonlinear_identity_rejected`,
        before: { outcome: d.outcome, operation: d.operation, factors: [...factors] },
        after: null,
        reason:
          `Olumi read "${d.outcome}" as ${quotedList(factors)} multiplied together, but ${why}, so that ` +
          'was not used and nothing about it is assumed.',
        severity: 'warn',
      } as RepairEntry);
    };
    if (d.operation !== 'product') { reject(`"${String(d.operation)}" is not a relationship Olumi can check`); continue; }
    if (outcomeId === undefined) { reject(`"${d.outcome}" is not in the model`); continue; }
    if (!QUANTITY.has(kindOf.get(outcomeId)!)) { reject(`"${d.outcome}" is not a quantity in the model`); continue; }
    const factorIds: string[] = [];
    let why: string | null = null;
    for (const f of factors) {
      const id = resolve(f);
      if (id === undefined) { why = `"${f}" is not in the model`; break; }
      if (!INPUT.has(kindOf.get(id)!)) { why = `"${f}" is not a quantity in the model`; break; }
      if (id === outcomeId) { why = `"${f}" cannot be multiplied into itself`; break; }
      if (!reaches(id, outcomeId)) { why = `"${f}" does not feed into "${d.outcome}" in the model`; break; }
      if (!factorIds.includes(id)) factorIds.push(id);
    }
    if (why === null && factorIds.length < 2) why = 'a product needs at least two different quantities';
    if (why !== null) { reject(why); continue; }
    if (goalId === undefined || (outcomeId !== goalId && !reaches(outcomeId, goalId))) continue;
    // The DECLARATION holds and bears on the goal: it is persisted as the node's carrier whatever the
    // options do today, so a Run re-judges it on the graph it analyses (an option added later included).
    accepted.push({ outcome_id: outcomeId, factor_ids: [...factorIds], stated_in_brief: d.provenance === 'explicit' });

    /**
     * N-c, re-verification of d2362e9d (item c): an ADDEND is a direct cause of the outcome that is not
     * a declared factor and is not the product's CARRIER (the one cause every factor's route to the
     * outcome runs through: price, subscribers -> Pro MRR -> MRR). A cause a factor DRIVES is still an
     * addend (Pro subscribers -> Non-Pro MRR -> MRR): the old descendant arm ("a factor reaches it")
     * counted it as part of the product and said "the whole of MRR".
     * ⛔ AND SO IS A CAUSE THAT DRIVES A FACTOR (verification of 1047641f, finding 3 — the ancestor arm):
     * "Annual discount" -> Pro subscribers AND -> MRR directly. Its direct link is a term the analysis
     * ADDS to the product, whatever else it feeds; excluding it left a lever on it neither an addend nor
     * around the product, so with MRR itself the product its − route was invisible and the discount was
     * said to move MRR "only one way".
     */
    const addends = [...new Set(edges.filter((e) => e.to === outcomeId).map((e) => e.from))].filter((p) => {
      const k = kindOf.get(p);
      if (k === 'decision' || k === 'option' || factorIds.includes(p)) return false;
      const carrier = factorIds.every((f) => pathSigns(f, outcomeId, p).size === 0);
      return !carrier;
    });
    /**
     * ⛔ AROUND THE PRODUCT (re-verification of d2362e9d, B1). A lever that reaches the goal by a path
     * that avoids the outcome, or that reaches (or is) an addend of the outcome, changes the goal other
     * than through the product: its gain is R·ΔS + ΔN while an option moving S alone gains R·ΔS′, and
     * which is larger depends on the level R sits at. The addend arm is the same shape when the product
     * is declared on the goal itself (no path can avoid it) or on an outcome with its own addend.
     */
    const around = (l: string): boolean =>
      l === goalId || pathSigns(l, goalId, outcomeId).size > 0 || addends.some((p) => l === p || pathSigns(l, p, outcomeId).size > 0);
    /**
     * ⛔ THE DIRECTION OF EACH ROUTE ON THE GOAL (verification of 1047641f, findings 3 and 4). THROUGH the product:
     * the sign a lever moves an input with (on non-negative quantities the product moves with it), carried to the
     * goal by the outcome's own route. AROUND it: the `around` routes above, signed — a path to the goal avoiding
     * the outcome, or a route into an addend, that addend's link into the outcome, then the outcome's route. When
     * one option's routes disagree, its gain is R·ΔS against −ΔN: which is larger depends on the level R sits at,
     * so its sign is not proven even against an option that moves nothing (`opposed` below). Routes that agree
     * keep it.
     */
    const times = (a: ReadonlySet<number>, b: ReadonlySet<number>): Set<number> => new Set([...a].flatMap((x) => [...b].map((y) => x * y)));
    const toGoal = outcomeId === goalId ? new Set([1]) : pathSigns(outcomeId, goalId, outcomeId);
    const linkSigns = (from: string, to: string): Set<number> =>
      new Set(edges.filter((e) => e.from === from && e.to === to).map((e) => (e.effect_direction === 'negative' ? -1 : 1)));
    const throughSigns = (l: string): Set<number> => times(new Set(factorIds.flatMap((f) => [...pathSigns(l, f, outcomeId)])), toGoal);
    const aroundSigns = (l: string): Set<number> => new Set([
      ...(l === goalId ? [1] : []),
      ...pathSigns(l, goalId, outcomeId),
      ...addends.flatMap((p) => [...times(times(pathSigns(l, p, outcomeId), linkSigns(p, outcomeId)), toGoal)]),
    ]);
    const opposed = (levers: readonly string[]): boolean => {
      const through = new Set(levers.flatMap((l) => [...throughSigns(l)]));
      const aside = new Set(levers.flatMap((l) => [...aroundSigns(l)]));
      return [...through].some((t) => [...aside].some((a) => a !== t));
    };

    const selfNotStable: { id: string; how: 'opposite' | 'separate' | 'around' }[] = [];
    const moving: { id: string; signature: string; around: boolean; zero: boolean; bothWays: boolean }[] = [];
    let movedAny = false;
    for (const o of nodes) {
      if (o.kind !== 'option') continue;
      const levers = leversOf(o);
      const reaching = levers
        .map((l) => ({ lever: l, signs: factorIds.map((f) => pathSigns(l, f, outcomeId)) }))
        .filter((r) => r.signs.some((s) => s.size > 0));
      const goesAround = levers.some(around);
      // An option that reaches the goal only around the product still takes part in the comparison.
      if (reaching.length === 0 && !goesAround && !levers.some((l) => l === goalId || reaches(l, goalId))) continue;
      const pattern = factorIds.map((_, i) => {
        const u = new Set(reaching.flatMap((r) => [...r.signs[i]!]));
        return u.size === 0 ? '0' : u.size === 2 ? '±' : u.has(1) ? '+' : '-';
      });
      const moved = pattern.filter((p) => p !== '0').length;
      if (moved > 0) movedAny = true;
      if (moved >= 2) {
        const signs = new Set(reaching.flatMap((r) => r.signs.flatMap((s) => [...s])));
        // Opposite signs anywhere: the option can push the inputs apart. One sign through two or more
        // levers: every input moves the same way, but by amounts the structure does not relate (b).
        if (!(reaching.length === 1 && signs.size === 1)) selfNotStable.push({ id: o.id, how: signs.size === 2 ? 'opposite' : 'separate' });
      }
      // Findings 3 and 4: one route through the product and another around it, in opposite directions.
      if (moved > 0 && goesAround && !selfNotStable.some((x) => x.id === o.id) && opposed(levers)) selfNotStable.push({ id: o.id, how: 'around' });
      const through = moved >= 2 ? `|${reaching.map((r) => r.lever).sort().join(',')}` : '';
      moving.push({
        id: o.id, signature: `${pattern.join(',')}${through}${goesAround ? '|around' : ''}`,
        around: goesAround, zero: moved === 0, bothWays: pattern.includes('±'),
      });
    }
    if (!movedAny) continue;

    // Any two moving options whose signatures differ, or either of which goes around the product.
    const pairs: [string, string][] = [];
    for (let i = 0; i < moving.length; i++) {
      for (let j = i + 1; j < moving.length; j++) {
        const a = moving[i]!;
        const b = moving[j]!;
        if (a.signature !== b.signature || a.around || b.around) pairs.push([a.id, b.id]);
      }
    }
    const paired = new Set(pairs.flat());
    const named = new Set([...selfNotStable.map((x) => x.id), ...paired]);
    const notStable = nodes.filter((n) => named.has(n.id)).map((n) => n.id);

    const verdict: NonlinearIdentityVerdict = notStable.length > 0 ? 'sign_not_provable' : 'sign_stable_provisional';
    const outcomeLabel = labelOf(outcomeId);
    const inputs = quotedList(factorIds.map(labelOf));
    const labels = (ids: readonly string[]): string => quotedList(ids.map(labelOf));
    const RANKED_WRONG = 'depends on the levels those quantities are at — and adding the effects up can rank them the wrong way round.';

    // (b) Each option that cannot be signed on its own, in its own words.
    const opposite = selfNotStable.filter((x) => x.how === 'opposite').map((x) => x.id);
    const separate = selfNotStable.filter((x) => x.how === 'separate').map((x) => x.id);
    const oppositeSentence = opposite.length === 0 ? '' :
      ` ${labels(opposite)} can push ${inputs} in opposite directions, so whether "${outcomeLabel}" rises or falls depends on ` +
      'how large each change is — and adding the effects up can get even that direction wrong.';
    const separateSentence = separate.length === 0 ? '' :
      ` ${labels(separate)} ${separate.length === 1 ? 'moves' : 'move'} ${inputs} through separate levers whose relative size the ` +
      `model does not state, so how much ${separate.length === 1 ? 'it changes' : 'each changes'} "${outcomeLabel}", and how ` +
      `${separate.length === 1 ? 'it compares' : 'they compare'} with the other options, ${RANKED_WRONG}`;

    const routesDisagree = selfNotStable.filter((x) => x.how === 'around').map((x) => x.id);
    const routesDisagreeSentence = routesDisagree.length === 0 ? '' :
      ` ${labels(routesDisagree)} can push "${labelOf(goalId)}" one way through ${inputs} multiplied together and the other way by ` +
      `another route, so whether ${routesDisagree.length === 1 ? 'it raises or lowers' : 'each raises or lowers'} "${labelOf(goalId)}" ` +
      'depends on the levels those quantities are at — and adding the effects up can get even that direction wrong.';

    // (d) The comparisons, grouped by how the options move the inputs — never one list that reads as
    // "all of these differ" when two of them move the inputs the same way.
    const straight = moving.filter((m) => !m.around);
    const groups: { ids: string[]; zero: boolean }[] = [];
    for (const m of straight) {
      const g = groups.find((x) => moving.find((y) => y.id === x.ids[0])!.signature === m.signature);
      if (g !== undefined) g.ids.push(m.id); else groups.push({ ids: [m.id], zero: m.zero });
    }
    let differSentence = '';
    if (groups.length >= 2 && groups.every((g) => g.ids.length === 1)) {
      const ids = groups.map((g) => g.ids[0]!);
      differSentence = ids.length === 2
        ? ` ${labels(ids)} do not move ${inputs} the same way, so which of them does better ${RANKED_WRONG}`
        : ` ${labels(ids)} each move ${inputs} a different way, so which of them does better ${RANKED_WRONG}`;
    } else if (groups.length >= 2) {
      const WAYS = ['one way', 'another', 'a third', 'a fourth', 'a fifth'];
      let ways = 0;
      const clauses = groups.map((g, i) => {
        const verb = g.ids.length === 1 ? 'moves' : 'move';
        const what = i === 0 ? inputs : 'them';
        if (g.zero) return `${labels(g.ids)} ${verb} ${factorIds.length === 2 ? 'neither' : 'none'} of ${what}`;
        return `${labels(g.ids)} ${verb} ${what} ${WAYS[ways++] ?? 'another'}`;
      });
      differSentence = ` ${clauses.join('; ')}, so which of those ways does better ${RANKED_WRONG}`;
    }
    // An option already said to push the goal both ways is not said again as merely "other than through".
    const aroundIds = moving.filter((m) => m.around && paired.has(m.id) && !routesDisagree.includes(m.id)).map((m) => m.id);
    const aroundSentence = aroundIds.length === 0 ? '' :
      ` ${labels(aroundIds)} ${aroundIds.length === 1 ? 'changes' : 'change'} "${labelOf(goalId)}" other than through ${inputs} ` +
      `multiplied together, so how ${aroundIds.length === 1 ? 'it compares' : 'they compare'} with the other options ${RANKED_WRONG}`;

    // N-c: whose reading it is, and whether it is the whole of the quantity.
    const partial = addends.length > 0;
    const stated = d.provenance === 'explicit';
    const head = stated
      ? `${partial ? 'Part of ' : ''}"${outcomeLabel}" is ${inputs} multiplied together`
      : `Olumi reads ${partial ? 'part of ' : ''}"${outcomeLabel}" as ${inputs} multiplied together`;
    // (b) "only one way" only when it is true of every option that moves an input.
    const oneWay = !moving.some((m) => m.bothWays);
    marks.push({
      outcome_id: outcomeId, operation: 'product', factor_ids: factorIds, verdict,
      options_not_sign_stable: notStable, comparisons_not_sign_stable: pairs,
    });
    analyses.push({
      outcome_id: outcomeId, goal_id: goalId, factor_ids: [...factorIds], stated_in_brief: stated, verdict,
      unproven_alone: selfNotStable.map((x) => x.id),
      moving: moving.map((m) => m.id),
      pairs: pairs.map(([a, b]) => [a, b] as const),
    });
    loss.push({
      field_path: `nodes[${outcomeId}].nonlinear_identity`,
      before: { operation: 'product', factor_ids: factorIds },
      after: { verdict, options_not_sign_stable: notStable, comparisons_not_sign_stable: pairs },
      reason: verdict === 'sign_not_provable'
        ? `${head}, but Olumi's analysis cannot yet multiply quantities: it adds up each effect separately.` +
          oppositeSentence + separateSentence + routesDisagreeSentence + differSentence + aroundSentence +
          ` So this model cannot yet show which option does better on "${labelOf(goalId)}": treat its figures as a ` +
          'rough approximation, not a decision.'
        : `${head}, and Olumi's analysis adds effects up rather than multiplying them, so its figures for ` +
          `"${outcomeLabel}" are an approximation` +
          (oneWay
            ? `. Each option that changes them moves them only one way, so whether that option raises or lowers ` +
              `"${outcomeLabel}" should hold; treat the size of every effect, and any gap between the options, as provisional.`
            : '; treat the size of every effect, and any gap between the options, as provisional.'),
      severity: verdict === 'sign_not_provable' ? 'warn' : 'info',
    } as RepairEntry);
  }
  return { marks, loss, accepted, analyses };
}

/** `"a" times "b"`, `"a" times "b" times "c"` — labels, never ids. */
const timesList = (labels: readonly string[]): string => labels.map((l) => `"${l}"`).join(' times ');

/**
 * What the product IS, in words: names the goal and every factor, states no direction, no
 * figure and no option. Whose reading it is follows the declaration (`stated_in_brief`): the
 * brief's own words are said as fact, anything else as Olumi's reading.
 */
function productIdentityClause(goal: string, outcome: string, factors: readonly string[], stated: boolean, sameNode: boolean): string {
  const times = timesList(factors);
  if (sameNode) return stated ? `"${goal}" depends on ${times}` : `Olumi reads "${goal}" as depending on ${times}`;
  return stated
    ? `"${goal}" depends on "${outcome}", which is ${times}`
    : `"${goal}" depends on "${outcome}", which Olumi reads as ${times}`;
}

/**
 * ⛔ C46 — THE QUESTION ASKED WHERE THE USER ALWAYS SEES IT (`open_questions`, appended to the reply
 * by the server every time: `write-outcome.ts` `openQuestionsLine`). The typed mark's sentence reaches
 * `not_represented`, which only the Agent's model reads — the gap staging #1939 closed for the
 * deadline. One per product marked `sign_not_provable`; nothing for a stable or a linear model.
 */
export function productIdentityOpenQuestions(admitted: Pick<AdmittedModel, 'nodes' | 'nonlinear_identities'>): string[] {
  const goal = admitted.nodes.find((n) => n.kind === 'goal');
  if (goal === undefined) return [];
  const labelOf = (id: string): string => admitted.nodes.find((n) => n.id === id)?.label ?? id;
  return (admitted.nonlinear_identities ?? [])
    .filter((m) => m.verdict === 'sign_not_provable')
    .map((m) => {
      const stated = admitted.nodes.find((n) => n.id === m.outcome_id)?.nonlinear_identity?.stated_in_brief === true;
      const clause = productIdentityClause(goal.label, labelOf(m.outcome_id), m.factor_ids.map(labelOf), stated, m.outcome_id === goal.id);
      return `Which option does better on "${goal.label}"? This model cannot answer that yet: ${clause}, and the model ` +
        'adds those effects up rather than multiplying them.';
    });
}

/** The Run-time check's finding: the named leader cannot be signed against `against`. */
export interface NonlinearIdentityLeaderWithhold {
  /** The leader judged, or `null` when no leader was named and EVERY compared option was judged. */
  readonly leader_id: string | null;
  readonly outcome_id: string;
  readonly goal_id: string;
  readonly factor_ids: readonly string[];
  /** Compared options the leader's sign against is not proven, by id, in graph order. */
  readonly against: readonly string[];
  /** Plain English: names the goal and the factors; no direction, no figure, no option. */
  readonly sentence: string;
}

type GraphNodeLike = { readonly id?: unknown; readonly kind?: unknown; readonly label?: unknown } & Record<string, unknown>;

function readCarrier(n: GraphNodeLike): NonlinearIdentityCarrier | null {
  const c = n.nonlinear_identity as { operation?: unknown; factor_ids?: unknown; stated_in_brief?: unknown } | undefined;
  if (c === null || typeof c !== 'object' || c.operation !== 'product' || typeof c.stated_in_brief !== 'boolean') return null;
  if (!Array.isArray(c.factor_ids) || c.factor_ids.length < 2 || !c.factor_ids.every((f) => typeof f === 'string' && f !== '')) return null;
  return { operation: 'product', factor_ids: c.factor_ids as string[], stated_in_brief: c.stated_in_brief };
}

/** A persisted level as `{ value }` — the stored shape is either a number or an object carrying one. */
function levelObject(v: unknown): ConstructedLevel | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return { value: v } as ConstructedLevel;
  const inner = v !== null && typeof v === 'object' ? (v as { value?: unknown }).value : undefined;
  return typeof inner === 'number' && Number.isFinite(inner) ? ({ value: inner } as ConstructedLevel) : undefined;
}

/**
 * ⛔ C46 STAGE 1 (b) — MAY THIS RUN NAME ITS LEADER, GIVEN A PRODUCT IT CAN ONLY ADD UP?
 *
 * Reads the carrier (`cee-v3.ts` NodeV3 `nonlinear_identity`) on the graph the analysis ran on,
 * and re-runs construction's OWN sign test (`markProductIdentities`) on that graph — so an option
 * added after construction is judged, and nothing is re-derived a second way. Then, for the leader
 * PLoT ranked first (by id), against the options it was compared with:
 *  · the leader cannot be signed against carrying on as now on its own (`unproven_alone`) — not
 *    proven against ANY other compared option;
 *  · the leader and another compared option move the product's inputs differently (a pair) — not
 *    proven against that option;
 *  · the leader moves none of the product's inputs and reaches the goal no other way (carrying on
 *    as now), while a compared option cannot be signed against it — not proven against that one.
 * "Proven" is the structural sign test only — never the linear engine's own interval (AI Quality
 * #70 5842580505). No carrier ⇒ `null`: every graph persisted before the carrier, and every
 * linear brief, reads exactly as before. A leader that is not an option in this graph is not
 * proven against any compared option (fail closed — the check cannot see it).
 *
 * `leaderId: null` asks the Agent-view question (the leader is withheld from every readback): is
 * EVERY compared option unprovable as a leader? Only then is the sentence true of whichever led.
 *
 * Pure and total: a malformed graph or carrier is `null`, never a throw on a Run.
 */
export function nonlinearIdentityLeaderWithhold(
  graph: unknown,
  leaderId: string | null,
  opts: { readonly comparedOptionIds?: readonly string[]; readonly goalId?: string } = {},
): NonlinearIdentityLeaderWithhold | null {
  const rawNodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const rawEdges = (graph as { edges?: unknown } | null | undefined)?.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;
  const nodes = rawNodes.filter((n): n is GraphNodeLike => n !== null && typeof n === 'object' && typeof (n as GraphNodeLike).id === 'string' && typeof (n as GraphNodeLike).kind === 'string');
  const carried = nodes.map((n) => ({ id: n.id as string, carrier: readCarrier(n) })).filter((c): c is { id: string; carrier: NonlinearIdentityCarrier } => c.carrier !== null);
  if (carried.length === 0) return null;
  const goals = nodes.filter((n) => n.kind === 'goal').map((n) => n.id as string);
  const goalId = opts.goalId ?? (goals.length === 1 ? goals[0] : undefined);
  if (goalId === undefined || !goals.includes(goalId)) return null;

  const admittedLike: AdmittedNode[] = nodes.map((n) => {
    const levels = n.interventions !== null && typeof n.interventions === 'object'
      ? Object.fromEntries(Object.entries(n.interventions as Record<string, unknown>).flatMap(([k, v]) => {
        const l = levelObject(v);
        return l === undefined ? [] : [[k, l]];
      }))
      : undefined;
    const today = (n.observed_state as { value?: unknown } | undefined)?.value;
    return {
      id: n.id as string, kind: n.kind as CandidateNodeKind, label: typeof n.label === 'string' ? n.label : (n.id as string),
      ...(levels !== undefined ? { interventions: levels } : {}),
      ...(typeof today === 'number' && Number.isFinite(today) ? { observed_state: { value: today } } : {}),
    } as AdmittedNode;
  });
  const edges = rawEdges
    .filter((e): e is { from: string; to: string; effect_direction?: unknown; origin?: unknown } =>
      e !== null && typeof e === 'object' && typeof (e as { from?: unknown }).from === 'string' && typeof (e as { to?: unknown }).to === 'string')
    .map((e) => ({
      from: e.from, to: e.to,
      ...(typeof e.effect_direction === 'string' ? { effect_direction: e.effect_direction } : {}),
      ...(typeof e.origin === 'string' ? { origin: e.origin } : {}),
    }));
  const ids = new Set(admittedLike.map((n) => n.id));
  const optionIds = admittedLike.filter((n) => n.kind === 'option').map((n) => n.id);
  const statusQuo = new Set(nodes.filter((n) => n.kind === 'option' && readIsBaseline(n as never) === true).map((n) => n.id as string));
  const { analyses } = markProductIdentities(
    carried.map((c) => ({ outcome: c.id, operation: 'product', factors: [...c.carrier.factor_ids], provenance: c.carrier.stated_in_brief ? 'explicit' : 'inferred' })),
    (id) => (typeof id === 'string' && ids.has(id) ? id : undefined),
    admittedLike,
    edges,
    goalId,
    statusQuo,
  );
  const compared = (opts.comparedOptionIds ?? optionIds).filter((id, i, all) => all.indexOf(id) === i);
  const comparedSet = new Set(compared);
  const labelOf = (id: string): string => admittedLike.find((n) => n.id === id)?.label ?? id;

  for (const a of analyses) {
    const unprovenAgainst = (leader: string): string[] => {
      const others = compared.filter((x) => x !== leader);
      if (!optionIds.includes(leader) || a.unproven_alone.includes(leader)) return others;
      const against = new Set<string>();
      for (const [x, y] of a.pairs) {
        if (x === leader && comparedSet.has(y)) against.add(y);
        if (y === leader && comparedSet.has(x)) against.add(x);
      }
      if (!a.moving.includes(leader)) for (const x of a.unproven_alone) if (x !== leader && comparedSet.has(x)) against.add(x);
      return others.filter((x) => against.has(x));
    };
    let against: string[];
    if (leaderId !== null) {
      against = unprovenAgainst(leaderId);
    } else {
      if (compared.length < 2) continue;
      const each = compared.map(unprovenAgainst);
      if (each.some((x) => x.length === 0)) continue;
      against = compared.filter((id) => each.some((x) => x.includes(id)));
    }
    if (against.length === 0) continue;
    const goalLabel = labelOf(goalId);
    const clause = productIdentityClause(goalLabel, labelOf(a.outcome_id), a.factor_ids.map(labelOf), a.stated_in_brief, a.outcome_id === goalId);
    return {
      leader_id: leaderId,
      outcome_id: a.outcome_id,
      goal_id: goalId,
      factor_ids: a.factor_ids,
      against,
      sentence: `No option can be put forward on "${goalLabel}" yet: ${clause}, and this model adds those effects up ` +
        'rather than multiplying them, so it cannot say which option does better.',
    };
  }
  return null;
}

/**
 * ⛔ C46 (d) — THE AGENT'S VIEW OF A PRODUCT THE ANALYSIS ADDS UP.
 *
 * Every readback nulls the leader on a withheld run, so the Agent's view cannot ask about ONE leader.
 * It returns a finding when EITHER the persisted reason already names the product (`reasonNamesIt` —
 * the Run's own finding, bound to its leader at the stamp; any option's finding supplies the words,
 * which name no option) OR every option the graph compares is unprovable as a leader, so the sentence
 * is true of whichever led. Otherwise `null`: a finding about some other pair is not said as the
 * reason this leader was withheld.
 */
export function nonlinearIdentityForAgent(graph: unknown, reasonNamesIt: boolean): NonlinearIdentityLeaderWithhold | null {
  const every = nonlinearIdentityLeaderWithhold(graph, null);
  if (every !== null || !reasonNamesIt) return every;
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const options = Array.isArray(nodes)
    ? nodes.filter((n) => (n as GraphNodeLike | null)?.kind === 'option' && typeof (n as GraphNodeLike).id === 'string').map((n) => (n as GraphNodeLike).id as string)
    : [];
  for (const id of options) {
    const f = nonlinearIdentityLeaderWithhold(graph, id);
    if (f !== null) return f;
  }
  return null;
}

/**
 * ⛔ C46 STAGE 1 (b) — FOLD THE FINDING INTO THE PERSISTED LEADER PERMISSION.
 *
 * The `applyIntakeToLeaderPermission` precedent (`intake-option-reconciliation.ts`), applied at the
 * same single stamp in `run_analysis`: a CONJUNCTION that can only REMOVE the permission — `null`
 * (no finding) returns the verdict unchanged, byte for byte — and it never touches
 * `constraint_verdict_state`, which is a statement about the constraint evidence that this axis has
 * nothing true to say about. That untouched state is also how a reader tells, later, that the
 * constraint verdict itself permitted (`nonlinearIdentityLeaderClaimCause`).
 */
export function applyNonlinearIdentityToLeaderPermission<P extends { readonly may_name_leading_option: boolean; readonly constraint_verdict_state: string }>(
  persisted: P,
  finding: NonlinearIdentityLeaderWithhold | null,
): P {
  if (finding === null) return persisted;
  return { ...persisted, may_name_leading_option: false };
}

/** The PLoT results' option ids, in order — the options this run actually compared. */
function comparedOptionIdsOf(enrichment: unknown): string[] | undefined {
  const results = (enrichment as { results?: unknown } | null | undefined)?.results;
  if (!Array.isArray(results)) return undefined;
  const ids = results
    .map((r) => (r !== null && typeof r === 'object' ? (r as { option_id?: unknown }).option_id : undefined))
    .filter((id): id is string => typeof id === 'string' && id !== '');
  return ids.length > 0 ? ids : undefined;
}

/**
 * ⛔ C46 (c) — WHY A PERSISTED FACT'S LEADER WAS WITHHELD, when the reason is the product.
 *
 * For the callers of `composeAnalysisStateV1` that hold the fact AND the graph (the scenario read
 * route and the V5 finaliser). True only when ALL of these hold, each read, never re-derived:
 *  · the fact's persisted permission is `false` while its persisted constraint state PERMITS a
 *    leader (`MAY_NAME_LEADING_OPTION`) — so the stamp that withheld it was not the constraint's;
 *  · the Run-time check (`nonlinearIdentityLeaderWithhold`) finds the fact's leader, by id, not
 *    proven against an option the run compared (the PLoT envelope's own `results`).
 * Split by who asked (AI Quality #70 5841878117): an unrequested first pass keeps the unrequested
 * code (policy), a requested run names the product. While the constraint verdict withholds, both are
 * false and `constraint_verdict_withheld` stands (option (i), #70 5842615260).
 */
export function nonlinearIdentityLeaderClaimCause(input: {
  readonly graph: unknown;
  readonly result: unknown;
  readonly requested: boolean;
}): { readonly withheldBecauseUnrequested: boolean; readonly withheldBecauseNonlinearIdentity: boolean } {
  const none = { withheldBecauseUnrequested: false, withheldBecauseNonlinearIdentity: false } as const;
  const result = input.result as { leading_option_id?: unknown; constraint_verdict?: unknown; enrichment?: unknown } | null | undefined;
  const verdict = result?.constraint_verdict as { may_name_leading_option?: unknown; constraint_verdict_state?: unknown } | undefined;
  if (verdict?.may_name_leading_option !== false) return none;
  const state = verdict.constraint_verdict_state;
  if (typeof state !== 'string' || !Object.prototype.hasOwnProperty.call(MAY_NAME_LEADING_OPTION, state)) return none;
  if (MAY_NAME_LEADING_OPTION[state as keyof typeof MAY_NAME_LEADING_OPTION] !== true) return none;
  const leader = result?.leading_option_id;
  if (typeof leader !== 'string' || leader === '') return none;
  const compared = comparedOptionIdsOf(result?.enrichment);
  const finding = nonlinearIdentityLeaderWithhold(input.graph, leader, compared !== undefined ? { comparedOptionIds: compared } : {});
  if (finding === null) return none;
  return input.requested
    ? { withheldBecauseUnrequested: false, withheldBecauseNonlinearIdentity: true }
    : { withheldBecauseUnrequested: true, withheldBecauseNonlinearIdentity: false };
}

/**
 * The first directed loop that runs through an edge `mayBreak` accepts, as its
 * edges in order (that edge first), or null. Pure, deterministic in edge order:
 * each accepted edge `u -> v` is tried in turn and the loop is closed by the
 * shortest path `v ~> u`. A self-loop is a loop of one edge.
 *
 * Admission's own (`breakLoops`). The producer's repair issue reads admission's
 * VERDICT (`withheld`, `loop_closing_link`), never a second derivation over the
 * candidate's raw links (review of f504b8e0, (c)).
 */
function findBreakableLoop<E extends { from: string; to: string }>(
  edges: readonly E[],
  mayBreak: (e: E) => boolean,
): E[] | null {
  const out = new Map<string, E[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  for (const e of edges) {
    if (!mayBreak(e)) continue;
    if (e.to === e.from) return [e];
    const via = new Map<string, E>();
    const seen = new Set([e.to]);
    const queue = [e.to];
    while (queue.length > 0 && !via.has(e.from)) {
      const at = queue.shift()!;
      for (const next of out.get(at) ?? []) {
        if (seen.has(next.to)) continue;
        seen.add(next.to);
        via.set(next.to, next);
        if (next.to === e.from) break;
        queue.push(next.to);
      }
    }
    if (!via.has(e.from)) continue;
    const back: E[] = [];
    for (let at = e.from; at !== e.to;) {
      const step = via.get(at)!;
      back.unshift(step);
      at = step.from;
    }
    return [e, ...back];
  }
  return null;
}

/** Where each kind sits on the option -> factor -> risk -> outcome -> goal flow. */
const FLOW_RANK: Readonly<Record<string, number>> = { decision: 0, option: 1, factor: 2, constraint: 2, risk: 3, outcome: 4, goal: 5 };

/** Nodes that reach `goalId`, with the length of their shortest path to it. */
function distancesToGoal(edges: readonly { from: string; to: string }[], goalId: string | undefined): Map<string, number> {
  const d = new Map<string, number>();
  if (goalId === undefined) return d;
  const into = new Map<string, string[]>();
  for (const e of edges) into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
  d.set(goalId, 0);
  const queue = [goalId];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const from of into.get(at) ?? []) {
      if (d.has(from)) continue;
      d.set(from, d.get(at)! + 1);
      queue.push(from);
    }
  }
  return d;
}

/**
 * ⛔ A REGISTERED FIRST MODEL MUST BE A DAG — the one loop-breaking rule.
 *
 * SERVED (CEE bdd43f4a, Paul's pricing brief, acceptance run f-20260925T231546Z):
 * the drafter stated `AI feature availability -> AI release delay` AND the
 * reverse, both Olumi's hypotheses; both were registered, readiness refused the
 * whole model on `CYCLE_DETECTED` (its only blocker), and nothing told Paul why.
 * Readiness's check (`graph-structure-validator.ts` `checkCycles`) walks EVERY
 * directed edge, so this runs over the whole admitted edge set.
 *
 * ⛔ ONE LINK IS ONE (from, to) PAIR, AND ANY USER-STATED INSTANCE MAKES IT THE
 * USER'S (review of f504b8e0, BLOCKING-2). The drafter restates the user's links as
 * its own; judged instance by instance, the restatement was "Olumi's link", so it was
 * withheld and said as Olumi's — while the user's instance of the SAME link stayed in
 * the graph and its projection entries were deleted with the restatement's. So a pair
 * may be withheld only when EVERY instance of it may be, and withholding it removes
 * every instance: the decision and the sentence are about the link, not a copy of it.
 *
 * ONE link per loop is withheld, chosen in this order:
 *  1. never one `mayWithhold` refuses for any instance of its pair (the caller
 *     refuses the user's own links and the structural option edges) — a loop made
 *     only of those is KEPT and returned in `kept`, because choosing between the
 *     user's links is theirs;
 *  2. the link whose absence leaves every node that reached the goal still
 *     reaching it — a loop must never be traded for a dead end when another
 *     choice exists (on the served model the risk's threat to availability is its
 *     ONLY route to MRR; withholding it would swap CYCLE_DETECTED for
 *     NO_PATH_TO_GOAL);
 *  3. the link pointing furthest AWAY from the goal (its target is further from
 *     the goal than its source) — against the flow toward the goal;
 *  4. the link pointing furthest back along option -> factor -> risk -> outcome
 *     -> goal by kind;
 *  5. the lower `from`/`to` id pair, so the choice never depends on luck.
 *
 * ⭐ RULING KEPT (builder's open ruling on f504b8e0): "strands no node" (2) and
 * "points away from the goal" (3) outrank kind (4); kind is only a tie-break. On
 * the served model the risk's threat to availability is its ONLY route to MRR —
 * kind alone would withhold exactly that link.
 *
 * Pure: it decides; the caller records and says.
 */
export function breakLoops<E extends { from: string; to: string }>(
  edges: readonly E[],
  opts: { mayWithhold: (e: E) => boolean; goalId?: string; kindOf: (id: string) => string | undefined },
): { edges: E[]; withheld: { edge: E; loop: E[] }[]; kept: E[][] } {
  const pair = (e: { from: string; to: string }): string => `${e.from}\u0000${e.to}`;
  const rank = (id: string): number => FLOW_RANK[opts.kindOf(id) ?? ''] ?? FLOW_RANK.factor!;
  // A pair any instance of which may not be withheld is not withheld at all.
  const protectedPairs = new Set(edges.filter((e) => !opts.mayWithhold(e)).map(pair));
  const mayWithhold = (e: E): boolean => !protectedPairs.has(pair(e));
  let current = [...edges];
  const withheld: { edge: E; loop: E[] }[] = [];
  for (;;) {
    const loop = findBreakableLoop(current, mayWithhold);
    if (loop === null) break;
    const distance = distancesToGoal(current, opts.goalId);
    const choices = loop.filter(mayWithhold).map((edge) => {
      // The same link stated twice is one belief: withheld together.
      const without = current.filter((x) => pair(x) !== pair(edge));
      const from = distance.get(edge.from);
      const to = distance.get(edge.to);
      return {
        edge,
        without,
        strands: distance.size - distancesToGoal(without, opts.goalId).size,
        away: from === undefined || to === undefined ? 0 : to - from,
        backByKind: rank(edge.from) - rank(edge.to),
        key: pair(edge),
      };
    });
    choices.sort((a, b) =>
      a.strands - b.strands || b.away - a.away || b.backByKind - a.backByKind || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const pick = choices[0]!;
    withheld.push({ edge: pick.edge, loop });
    current = pick.without;
  }
  // What is left can only be loops nobody may break: find each, name it, leave it.
  const kept: E[][] = [];
  let probe = current;
  for (;;) {
    const loop = findBreakableLoop(probe, () => true);
    if (loop === null) break;
    kept.push(loop);
    const closing = pair(loop[0]!);
    probe = probe.filter((x) => pair(x) !== closing);
  }
  return { edges: current, withheld, kept };
}

const quoted = (labels: readonly string[]): string =>
  labels.length === 1 ? `"${labels[0]}"`
    : `${labels.slice(0, -1).map((l) => `"${l}"`).join(', ')} and "${labels[labels.length - 1]}"`;
const chain = (labels: readonly string[]): string => [...labels, labels[0]!].map((l) => `"${l}"`).join(' → ');

/** What the user is told when one of Olumi's links was left out of a loop. */
function sayWithheldLoopLink(from: string, to: string, loopLabels: readonly string[]): string {
  const whose = "(it was Olumi's reading, not something you said)";
  if (loopLabels.length === 1) {
    return `"${from}" was linked to itself; a model cannot hold a loop, so that link was left out ${whose}.`;
  }
  if (loopLabels.length === 2) {
    return `${quoted(loopLabels)} were linked both ways; a model cannot hold a loop, so the link from "${from}" to "${to}" `
      + `was left out ${whose} — say which way it runs if both matter.`;
  }
  return `${quoted(loopLabels)} were linked in a loop (${chain(loopLabels)}); a model cannot hold a loop, so the link from `
    + `"${from}" to "${to}" was left out ${whose} — say so if that link matters more than another in the loop.`;
}

/** One link of a kept loop: whether the user stated it, or it is how the model is built (`structural`). */
interface KeptLoopLink { readonly from: string; readonly to: string; readonly yours: boolean; readonly fromDecision: boolean }

/**
 * What the user is told when a loop is made only of links that are not Olumi's to drop.
 *
 * ⛔ NEVER "YOU LINKED" OLUMI'S PART OF IT (review of f504b8e0, (d)). A kept loop can run
 * through a STRUCTURAL edge — what an option sets (often Olumi's own `ai_proposed`
 * level), the held status quo — which is not the user's statement. Only links the user
 * stated are said to be theirs; a structural edge is named as what it is.
 */
function sayKeptLoop(loopLabels: readonly string[], links: readonly KeptLoopLink[]): string {
  if (links.every((l) => l.yours)) {
    if (loopLabels.length === 1) {
      return `You linked "${loopLabels[0]}" to itself. A model cannot hold a loop, and that link is yours, so it was kept `
        + `and the analysis cannot run yet — say what drives "${loopLabels[0]}" instead, or that the link should go.`;
    }
    const shape = loopLabels.length === 2 ? `${quoted(loopLabels)} both ways` : `${quoted(loopLabels)} in a loop`;
    return `You linked ${shape} (${chain(loopLabels)}). A model cannot hold a loop, and none of these links is Olumi's `
      + 'to drop, so all were kept and the analysis cannot run yet — say which way it runs, or which link should go.';
  }
  const shape = loopLabels.length === 2 ? 'are linked both ways' : 'are linked in a loop';
  const yours = links.filter((l) => l.yours).map((l) => `"${l.from}" to "${l.to}"`);
  const built = links.filter((l) => !l.yours).map((l) => l.fromDecision
    ? `the link from "${l.from}" to "${l.to}" is how the decision holds that option`
    : `the link from "${l.from}" to "${l.to}" is what that option sets`);
  const yourPart = yours.length === 0 ? '' : ` You linked ${yours.join(' and ')};`;
  return `${quoted(loopLabels)} ${shape} (${chain(loopLabels)}).${yourPart} ${built.join('; ')}. A model cannot hold a loop, `
    + 'and none of these links is one Olumi can drop, so all were kept and the analysis cannot run yet — say which way it '
    + 'runs, or which link should go.';
}

/**
 * ⛔ A SIGNED PERCENTAGE CHANGE IS STATED AS THE LEVEL IT PRODUCES.
 *
 * Served CEE 06325c6 (#69 5835137365): "respond to the competitor's price cut" built
 * "Cut List Price 15%" as `list_price_change = -15` beside a sibling's `0.1` on the same
 * 0..100 factor, and `run_analysis` refused the comparison (`mixed_scale_unresolved`).
 * Normalising the cut does not help: the analysis seam is sign-symmetric — a wire value
 * below 0 rescales the whole request exactly as one above 1 does — so `-0.15` is refused too,
 * and an all-raw `-15`/`10` is refused beside any ordinary estimated sibling. Measured through
 * the real handler (`signed-change-one-value-space.test.ts`). The conventional drafter refuses
 * negatives for the same reason (`records/projector.ts`).
 *
 * A percentage CHANGE whose value today is KNOWN to be 0 is the level of that quantity relative to
 * today, less 100. So it is restated as that level — today 100, "cut 15%"
 * 85, "raise 10%" 110 — on a frame of 0..200 (wider only when a level needs it). Nothing is
 * invented: every level is the user's number plus 100, the sign survives as the side of today
 * each option sits on, the link's direction is unchanged (the level rises with the change), and
 * the restatement is said. Only when EVERY level on the factor can be restated; otherwise the
 * factor is left alone and admission withholds the negative levels (below).
 *
 * ⛔ ONLY `baseline_known === true && baseline_value === 0` LICENSES IT (review 5835754404, B1).
 * The gate used to admit an UNKNOWN today (`null`) as well, and the restated factor came out
 * `baseline_known: true, 100` under the factor's own provenance — so on an `explicit` factor
 * `framedObservedState` stamped `source: 'brief_extraction'` on a baseline the user never gave.
 * An unknown today also says nothing about whether the factor is a change at all: a percent
 * LEVEL (a margin at -5 vs 12) would have been misread as "5% below today". An unknown baseline,
 * or an unknown 0, is left alone and its negative levels are withheld and said, as for any other
 * level that cannot be restated. A known 0 the builder inferred keeps no `source`; a known 0 the
 * user stated ("no change today") keeps `brief_extraction`, which it is.
 *
 * ⚠ KNOWN LIMITATION (independent verification of B1): admission cannot tell a percentage CHANGE
 * from a percent LEVEL that happens to be KNOWN as 0 today (a margin of 0 with options at -5 and
 * 12). That level is restated too, and read as "95 / 112 % of today". The transform is affine
 * (level = 100 + the stated figure), so order, sign and link direction survive and it is said;
 * only the "% of today" reading is wrong for that shape. Telling the two apart needs a
 * change-versus-level classification whose corpus must come from served captures, not from
 * this file's author, so it is not guessed here.
 */
const TODAY_LEVEL = 100;
const TODAY_UNIT = '% of today';
function restateSignedPercentChanges(model: CandidateModel): {
  model: CandidateModel;
  restated: { label: string; frame: number }[];
} {
  const restated: { label: string; frame: number }[] = [];
  const restatedLabels = new Set<string>();
  const factors = model.factors.map((f) => {
    if (!isPercentScaledUnit(f.unit ?? undefined)) return f;
    if (model.factors.filter((x) => x.label === f.label).length !== 1) return f;
    const today = f.baseline_value;
    // ⛔ ONLY A KNOWN ZERO TODAY (review 5835754404, B1). An unknown baseline is never restated.
    if (f.baseline_known !== true || today !== 0) return f;
    const levels = model.options.flatMap((o) =>
      (o.interventions ?? []).filter((i) => i.factor_label === f.label).map((i) => i.value));
    if (!levels.some((v) => v < 0)) return f;
    if (levels.some((v) => !Number.isFinite(v) || TODAY_LEVEL + v < 0)) return f;
    const top = Math.max(TODAY_LEVEL, ...levels.map((v) => TODAY_LEVEL + v));
    const frame = top <= 2 * TODAY_LEVEL ? 2 * TODAY_LEVEL : defaultFrameFor(top);
    restated.push({ label: f.label, frame });
    restatedLabels.add(f.label);
    return { ...f, baseline_known: true, baseline_value: TODAY_LEVEL, unit: TODAY_UNIT, plausible_max: frame };
  });
  if (restated.length === 0) return { model, restated };
  const options = model.options.map((o) => o.interventions === undefined ? o : {
    ...o,
    interventions: o.interventions.map((i) => !restatedLabels.has(i.factor_label) ? i
      : { ...i, value: TODAY_LEVEL + i.value, unit: TODAY_UNIT }),
  });
  return { model: { ...model, factors, options }, restated };
}

/**
 * ⛔ CONSTRUCTION NEVER RETURNS OPTIONS THAT ARE IDENTICAL BY CONSTRUCTION (Delivery Lead, #70
 * 5842361028 / 5842400604 — MG (b)).
 *
 * MEASURED on served CEE ef99a97 and cb1778b, Paul's pricing brief: the drafter added "Test £59 with AI
 * release" — no level, acting on the same two factors as the user's £59 option. The starting point
 * filled both from the same source, they came out identical, and the run refused `NOTHING_TO_COMPARE`
 * with `may_run: false`. 2 of 29 served first passes in the DL corpus (scanned 26 Sep 03:11Z); the fill is reproduced exactly
 * in `construction-no-identical-options.test.ts`.
 *
 * ⭐ "IDENTICAL" IS PLoT'S IDENTITY AFTER THAT FILL, because `NOTHING_TO_COMPARE` is PLoT's refusal: an
 * option is its intervention map, `nodeId:value` pairs snapped to 1e-9 (`analysis-ready-core.ts`
 * `comparisonSurvivesDedup`, mirroring PLoT `identical-options.ts`). One cell per option per factor,
 * read off the ADMITTED graph (after levels are known):
 *  · `set`  — the option sets a level (its `interventions`): a key with a value;
 *  · `open` — it acts on the factor with no level yet (an option -> factor edge other than the held
 *    status quo's repair edge, `REPAIR_AUTHORED_ORIGIN`): a key the fill will give a value;
 *  · `held` — it does not act on the factor: no key.
 *
 * ⛔ WITHHELD ONLY WHEN ANOTHER OPTION COVERS IT — ONE WAY, NEVER "CANNOT BE TOLD APART" (independent review
 * of b0a51c3e, 26 Sep). `b` COVERS `a` when they hold the same factors (a key one has and the other lacks is
 * a difference no fill undoes) and every level `a` sets, `b` sets to the same level. `a` then sets nothing
 * the model can hold that `b` does not — the DL's "differs only in something unmodelled" — and the same-source
 * fill turns it into `b` (on the wire, it did). An open cell can equal at most ONE level, so it never makes
 * two options with different set levels alike: the first rule's symmetric reading withheld an Olumi "£54"
 * as a level-less test's twin, and made every priced Olumi option a twin of a user option with no price.
 *  · An option with a level no other option sets to that level is never covered, so it is always kept.
 *  · Covering is transitive, so the option a withheld one is named against is always one that stays.
 *  · Two options that cover each other are identical as drafted: the user's stays, else the first drafted.
 *
 * ⛔ THE STATUS QUO IS NEVER A CANDIDATE, AND A LEVEL EQUAL TO TODAY IS STILL A COMPARATOR. Its map is EMPTY,
 * never filled, and PLoT counts only valued maps (EXECUTED on all four served runs, first pass and approval).
 * So it is neither withheld nor named, and an option acting like it is judged against the other options only
 * — as a twin it withheld the served "£49 with AI release" once the status quo acted on factors. Measured: the
 * served approved model with the test option removed refuses `NO_COMPARISON_NEXT_STEP`; with that option set
 * to today's £49 alone it PROCEEDS — an Olumi option that only restates today's level is the valued stand-in
 * the run needs (`construction-no-identical-options.test.ts`).
 */
const sameLevel = (a: number, b: number): boolean => Math.round(a / 1e-9) === Math.round(b / 1e-9);
type Cell = { readonly kind: 'set'; readonly value: number } | { readonly kind: 'open' } | { readonly kind: 'held' };
/** On one factor, `b` covers `a`: both hold it or neither does, and a level `a` sets is `b`'s level too. */
function cellCovered(a: Cell, b: Cell): boolean {
  if ((a.kind === 'held') !== (b.kind === 'held')) return false;
  return a.kind !== 'set' || (b.kind === 'set' && sameLevel(a.value, b.value));
}

const fullLabelOf = (n: { label: string; description?: string }): string => n.description ?? n.label;

/**
 * Pure over an admitted model. Returns the Olumi-added options to withhold (each with a KEPT option that
 * covers it) and the groups of USER-stated options to ask about once.
 *
 * Never withheld: a USER-stated option (`inferenceClassFor` → `brief_stated`, i.e. provenance
 * `explicit`); the status quo (stamped `is_baseline`, held by repair edges, declared `is_status_quo`, or
 * read as one by the readiness idioms, `labelMatchesBaseline`); and an option that acts on nothing —
 * `option_changes_nothing` owns that shape and keeps it, named (`goal-reachability.test.ts`). The last two
 * are never named either.
 */
function judgeOptionIdentity(
  admitted: AdmittedModel,
  declaredStatusQuoLabels: ReadonlySet<string>,
): { withheld: { id: string; option: string; like: string }[]; statedGroups: string[][] } {
  const factors = admitted.nodes.filter((n) => n.kind === 'factor');
  const factorIds = new Set(factors.map((f) => f.id));
  const options = admitted.nodes.filter((n) => n.kind === 'option');
  const actsOn = new Map(options.map((o) => [o.id, new Set<string>()] as const));
  const heldByRepair = new Set<string>();
  for (const e of admitted.edges) {
    if (!actsOn.has(e.from) || !factorIds.has(e.to)) continue;
    if ((e as { origin?: unknown }).origin === REPAIR_AUTHORED_ORIGIN) { heldByRepair.add(e.from); continue; }
    actsOn.get(e.from)!.add(e.to);
  }
  const cell = (o: AdmittedNode, f: string): Cell => {
    const lv = o.interventions?.[f];
    if (lv !== undefined && Number.isFinite(lv.value)) return { kind: 'set', value: lv.value };
    if (actsOn.get(o.id)!.has(f)) return { kind: 'open' };
    return { kind: 'held' };
  };
  const covers = (b: AdmittedNode, a: AdmittedNode): boolean => factors.every((f) => cellCovered(cell(a, f.id), cell(b, f.id)));
  const isStatusQuo = (o: AdmittedNode): boolean =>
    o.is_baseline === true || heldByRepair.has(o.id)
    || declaredStatusQuoLabels.has(canonicalLabel(fullLabelOf(o))) || labelMatchesBaseline(fullLabelOf(o));
  const actsOnNothing = (o: AdmittedNode): boolean => actsOn.get(o.id)!.size === 0 && Object.keys(o.interventions ?? {}).length === 0;
  const userStated = (o: AdmittedNode): boolean => admitted.inference_classes[o.id] === 'brief_stated';
  const order = new Map(options.map((o, i) => [o.id, i] as const));
  /** Of two options identical as drafted, the one that stays: the user's, then the first drafted. */
  const outranks = (p: AdmittedNode, o: AdmittedNode): boolean =>
    (Number(userStated(p)) - Number(userStated(o)) || order.get(o.id)! - order.get(p.id)!) > 0;
  /** A strict order: `p` covers `o`, and `o` does not cover `p` back unless `p` outranks it. */
  const dominates = (p: AdmittedNode, o: AdmittedNode): boolean =>
    p.id !== o.id && covers(p, o) && (!covers(o, p) || outranks(p, o));

  const pool = options.filter((o) => !isStatusQuo(o) && !actsOnNothing(o));
  const out = new Set(pool.filter((o) => !userStated(o) && pool.some((p) => dominates(p, o))).map((o) => o.id));
  // Named against the first drafted option that covers it and STAYS — one always exists (a maximal cover).
  const withheld = pool.filter((o) => out.has(o.id)).map((o) => {
    const like = pool.find((p) => !out.has(p.id) && dominates(p, o))!;
    return { id: o.id, option: fullLabelOf(o), like: fullLabelOf(like) };
  });

  // A USER option another user option covers: asked about once, with the first drafted user option that covers
  // it and that none covers in turn. Every pair in a group is then alike on every level either sets.
  const stated = pool.filter(userStated);
  const groups = new Map<string, AdmittedNode[]>();
  for (const o of stated) {
    const head = stated.find((p) => dominates(p, o) && !stated.some((q) => dominates(q, p)));
    if (head !== undefined) groups.set(head.id, [...(groups.get(head.id) ?? [head]), o]);
  }
  const statedGroups = [...groups.values()]
    .map((g) => [...g].sort((a, b) => order.get(a.id)! - order.get(b.id)!).map(fullLabelOf));
  return { withheld, statedGroups };
}

/**
 * The step the user is told, in the words the server appends (`write-outcome.ts` `openQuestionsLine`). Domain
 * neutral on purpose: the same shape was drafted for pricing ("Test £59 with AI release", served) and hiring
 * ("Pilot Developer Hire", `fixtures/live-hiring-envelope-candidate-20260923.json`). "As drafted": Olumi's draft,
 * never the user's words.
 */
const indistinctStep = (option: string, like: string): string =>
  `I left out "${option}" as a separate option: as drafted it sets nothing the model can hold that "${like}" does not — `
  + 'a test, pilot or staged rollout needs its own level on a factor the model holds. It stays open as a next step.';
const statedIndistinctQuestion = (labels: readonly string[]): string => {
  const quoted = labels.map((l) => `"${l}"`);
  const which = quoted.length === 2
    ? `${quoted[0]} different from ${quoted[1]}`
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]} different from each other`;
  return `What makes ${which}? As drafted, nothing the model holds tells them apart, so the analysis cannot compare them yet.`;
};

/**
 * What an adopted retry must still say (never silently): a withheld option the retry does not carry at
 * all. One the retry keeps, or withholds itself, is the retry's to report.
 */
export function carryWithheldOptions(first: AdmittedModel, retry: AdmittedModel): readonly WithheldOption[] {
  const present = new Set([
    ...retry.nodes.filter((n) => n.kind === 'option').map((n) => canonicalLabel(fullLabelOf(n))),
    ...(retry.options_withheld ?? []).map((w) => canonicalLabel(w.option)),
  ]);
  return (first.options_withheld ?? []).filter((w) => !present.has(canonicalLabel(w.option)));
}

/**
 * Admission, with options identical by construction withheld (see `judgeOptionIdentity`).
 *
 * ⭐ WITHHELD BEFORE ANYTHING IS MEASURED OR REGISTERED. When an Olumi option is withheld, the candidate
 * is admitted AGAIN without it (and without every link naming it), so ids, the held status quo, reach,
 * levers and the size gate (`build-model.ts` measures `assessConstructionSize(admitted)`) all see
 * exactly the graph that is registered — as if the drafter had never drafted it. It is said, never
 * silent: `options_withheld` carries the step, and the ledger records it.
 */
export function admitCandidateModel(
  candidateModel: CandidateModel,
  widened: WidenerAdditions = {},
): AdmittedModel {
  const declared = new Set(candidateModel.options
    .filter((o) => readIsBaseline({ ...(typeof o.is_status_quo === 'boolean' ? { is_baseline: o.is_status_quo } : {}) }) === true)
    .map((o) => canonicalLabel(o.label)));
  const first = admitOnce(candidateModel, widened);
  const verdict = judgeOptionIdentity(first, declared);
  // Never withhold a name another entity shares: removing its links would take that entity's with it.
  const otherNames = new Set([
    candidateModel.goal.metric, ...candidateModel.factors.map((f) => f.label), ...candidateModel.risks.map((r) => r.label),
    ...candidateModel.outcomes.map((o) => o.label),
  ].map(canonicalLabel));
  const withheld = verdict.withheld.filter((w) => !otherNames.has(canonicalLabel(w.option)));
  const questionsFor = (m: AdmittedModel, groups: string[][]) =>
    groups.length === 0 ? m : { ...m, indistinct_stated_options: groups.map((g) => ({ options: g, question: statedIndistinctQuestion(g) })) };
  if (withheld.length === 0) return questionsFor(first, verdict.statedGroups);

  const gone = new Set(withheld.map((w) => canonicalLabel(w.option)));
  const names = (l: { from: string; to: string }) => gone.has(canonicalLabel(l.from)) || gone.has(canonicalLabel(l.to));
  const second = admitOnce(
    { ...candidateModel, options: candidateModel.options.filter((o) => !gone.has(canonicalLabel(o.label))), links: candidateModel.links.filter((l) => !names(l)) },
    {
      ...widened,
      ...(widened.proposed_options !== undefined ? { proposed_options: widened.proposed_options.filter((o) => !gone.has(canonicalLabel(o.label))) } : {}),
      ...(widened.proposed_links !== undefined ? { proposed_links: widened.proposed_links.filter((l) => !names(l)) } : {}),
    },
  );
  const options_withheld: WithheldOption[] = withheld.map((w) => ({
    option: w.option, like: w.like, reason: 'option_indistinct', sentence: indistinctStep(w.option, w.like),
  }));
  return {
    ...questionsFor(second, judgeOptionIdentity(second, declared).statedGroups),
    loss: [
      ...second.loss,
      ...withheld.map((w, i) => ({
        field_path: `nodes[${w.id}].option_indistinct`,
        before: w.option,
        after: null,
        reason: options_withheld[i]!.sentence,
        severity: 'warn',
      } as RepairEntry)),
    ],
    options_withheld,
  };
}

function admitOnce(
  candidateModel: CandidateModel,
  widened: WidenerAdditions,
): AdmittedModel {
  const { model, restated: restatedChanges } = restateSignedPercentChanges(candidateModel);

  /**
   * The scale frame for each factor, keyed by LABEL because it must be known
   * before the nodes are built — the baseline is normalised as the node is
   * created. The builder's stated range wins; anything left without one gets a
   * frame DERIVED from the largest figure the model already carries for it,
   * recorded below as defaulted.
   */
  const capByLabel = new Map<string, number>();
  const largestByLabel = new Map<string, number>();
  /** Labels whose derived frame rests on at least one figure the USER stated. */
  const userStatedFigureLabels = new Set<string>();
  const noteMagnitude = (label: string, v: unknown, provenance: string): void => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    largestByLabel.set(label, Math.max(largestByLabel.get(label) ?? 0, Math.abs(v)));
    if (provenance === 'explicit') userStatedFigureLabels.add(label);
  };
  for (const f of model.factors) {
    if (typeof f.plausible_max === 'number' && Number.isFinite(f.plausible_max) && f.plausible_max > 1) {
      capByLabel.set(f.label, f.plausible_max);
    }
    // ⛔ ONLY A KNOWN BASELINE. An AI estimate (`baseline_known: false`) must never
    // derive its own frame: a guess that sets the scale it is then read against
    // is a guess dressed as a measurement.
    if (f.baseline_known) noteMagnitude(f.label, f.baseline_value, f.provenance);
  }
  for (const o of model.options) {
    for (const iv of o.interventions ?? []) noteMagnitude(iv.factor_label, iv.value, iv.provenance);
  }
  /**
   * ⛔ A LEVEL ABOVE THE STATED RANGE WIDENS THE RANGE; IT IS NEVER KEPT RAW BESIDE NORMALISED
   * SIBLINGS. It used to be written as stated (`150`) while every other level on the factor was
   * divided by the range (`0.05`): two value spaces on one factor, which `run_analysis` refuses
   * outright (`mixed_scale_unresolved`, the same refusal as #69 5835137365). The range is a unit
   * of measurement, so it is widened to the smallest power of ten above the level — derived,
   * as a defaulted frame is, and said.
   */
  const widenedFrames: { label: string; stated: number; frame: number; option: string; value: number }[] = [];
  for (const o of model.options) {
    for (const iv of o.interventions ?? []) {
      const stated = capByLabel.get(iv.factor_label);
      if (stated === undefined || !Number.isFinite(iv.value) || iv.value <= stated) continue;
      const frame = defaultFrameFor(iv.value);
      const prior = widenedFrames.find((w) => w.label === iv.factor_label);
      if (prior !== undefined && prior.frame >= frame) continue;
      if (prior !== undefined) widenedFrames.splice(widenedFrames.indexOf(prior), 1);
      widenedFrames.push({ label: iv.factor_label, stated: prior?.stated ?? stated, frame, option: o.label, value: iv.value });
      capByLabel.set(iv.factor_label, frame);
    }
  }
  const defaultedFrames: { label: string; frame: number }[] = [];
  for (const [label, largest] of largestByLabel) {
    if (capByLabel.has(label) || largest <= 1) continue;
    const frame = defaultFrameFor(largest);
    capByLabel.set(label, frame);
    defaultedFrames.push({ label, frame });
  }
  const capFor = (label: string): number | undefined => capByLabel.get(label);
  const loss: RepairEntry[] = [];

  /**
   * ⭐ AN UNSTATED SCOPE IS SAID AS OLUMI'S ASSUMPTION (C46; `unstatedGoalScope`) — NEVER ON THE NODE.
   *
   * ⛔ NOT IN THE LABEL (independent verification of 6e33b95e, B2). The goal node carries the
   * BRIEF's provenance (`from_brief`), so a label rewritten to "MRR (the Pro plan only)" showed
   * Olumi's choice of scope as the user's own words.
   *
   * ⛔ NOT IN THE DESCRIPTION EITHER (re-verification of d2362e9d, item e). `get_canonical_state`
   * shows a node's description to the Agent as its `full_label` (`projectEntity`,
   * `agent-capabilities.ts`), so the goal read back as "Measured for the Pro plan only — Olumi's
   * assumption; …" — Olumi's words presented as the user's metric. The node is left exactly as it
   * is with no scope question; the assumption is the `goal_scope` ledger entry's `after`, which the
   * build says first in `not_represented`, and its `reason` is the question it asks first in
   * `open_questions` (`build-model.ts`).
   */
  const goalScope = unstatedGoalScope(model.goal);

  // Fixed traversal order => deterministic ids.
  const entities: { label: string; kind: CandidateNodeKind; provenance: string; node?: Partial<AdmittedNode> }[] = [
    {
      label: model.goal.metric,
      kind: 'goal',
      provenance: model.goal.provenance,
      node: (() => {
        // ⭐ `goal_threshold` is NORMALISED 0-1 (`raw / cap`), not the stated
        // number. Writing 20000 into it was out of range by four orders of
        // magnitude. The cap rule is reused, never re-derived:
        // `resolveGoalThresholdCapWithProvenance` owns it.
        /**
         * ⛔ NO THRESHOLD AT ALL WHEN THE USER NAMED NO NUMBER (#63 5811781699).
         * `raw` was written unconditionally, so a goal the brief stated only as a
         * DIRECTION arrived as `goal_threshold_raw: 0` with the goal's own
         * `from_brief` provenance — the product telling the user they had asked for a
         * 0% increase. The trio is now written only when a target really was stated.
         *
         * ⭐ NOTHING DOWNSTREAM NEEDS A CHANGE, and that is checked rather than hoped:
         * `goalTargetStated` (`admission/analysis-admission.ts:776-786`) is
         * `'goal_threshold_raw' in pickGoalThresholdTrio(carrier)` — KEY PRESENCE. So
         * omitting the trio makes `semantic_signals.goal_target_stated` read `false`
         * on its own, which is the truth, instead of `true` about a fabricated 0.
         *
         * ⚠ BACKWARD COMPATIBLE BY DESIGN: `target_stated` absent plus a finite
         * `value` still writes the trio, so a candidate built before this field
         * behaves exactly as it did. Only an explicit `false`, or a non-finite value,
         * withholds it.
         */
        const raw = model.goal.value;
        const stated = model.goal.target_stated !== false && typeof raw === 'number' && Number.isFinite(raw);
        if (!stated) {
          return {
            ...(model.goal.unit ? { goal_threshold_unit: model.goal.unit } : {}),
            goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME,
          };
        }
        const resolved = resolveGoalThresholdCapWithProvenance(
          undefined, raw, model.goal.unit, undefined,
        );
        /**
         * ⛔ A LEVEL FRAME WITH NO BASELINE HAS NO GOAL FIT. ISL reads the level
         * frame against `observed_state.baseline` and refuses without it
         * (`missing_goal_baseline`, `GOAL_THRESHOLD_NOT_CONVERTIBLE`), so PLoT has
         * no `probability_of_goal` to copy. The draft path carries a stated current
         * level (`enricher.ts` `goal_baseline`); this writes the SAME shape its
         * projection sends (`transforms/schema-v3.ts`, the goal limb):
         * `{ value: B, baseline: B, unit?, source, raw_value, cap }`, B on the
         * threshold's OWN cap. `value` repeats `baseline` because ISL requires it
         * (see that limb). Admission is the shared rule (`admitGoalBaseline`),
         * never restated: a level above the target is a decrease the `>=` frame
         * would invert, and is withheld and said, not written.
         *
         * Stated in the brief → `brief_extraction`; anything else → Olumi's
         * (`cee_inference`). No current level → nothing, and nothing is derived
         * from the target.
         */
        const baselineRaw = model.goal.baseline_value;
        let observed_state: AdmittedNode['observed_state'];
        const withheld = (reason: string): void => {
          loss.push({
            field_path: `nodes[${slugId(model.goal.metric)}].observed_state.baseline`,
            before: baselineRaw ?? null,
            after: null,
            reason,
            severity: 'warn',
          } as RepairEntry);
        };
        /**
         * ⛔ ONLY "AT LEAST" IS SCORED CORRECTLY TODAY. The operator has no GraphV3
         * carrier (see the `goal_operator` loss below), and the level consumer scores
         * P(level >= threshold) whatever the brief said (ISL
         * `robustness_analyzer_v2.py`, `compared >= threshold`). So a baseline is
         * written ONLY for `>=`:
         *  · `<=` / `<` ("keep churn at or below 5%; 4% now") would be scored on the
         *    WRONG tail;
         *  · `>` ("grow MRR above £20k; £20k now") would count equality as met — a
         *    held status quo would score 100% on a goal it has not reached.
         * Withheld, and said with the shortest truthful repair, until the comparator
         * is carried and honoured end to end. The target itself is kept as before.
         */
        const scoresTheRightTail = model.goal.operator === '>=';
        /**
         * ⛔ AND ONLY A LEVEL THE BRIEF STATES (review 5824085993; RC ruling 5824518762,
         * fix (a)). An estimate of the goal's current level would set the chance of
         * reaching the user's target on Olumi's own guess, and nothing downstream says
         * so for a goal (the inferred-value disclosure covers factors only). So an
         * estimate is withheld from Goal fit and said, with the one step that makes it
         * count. A target-only brief stays admissible: only the Goal-fit figure waits.
         */
        // ⛔ "Known" alone is not enough (verdict 5824647383): the strict schema cannot tie
        // `baseline_known` to its provenance, so a level the model marks known but
        // attributes to itself (`ai_proposed`/`inferred`) is Olumi's, and is withheld too.
        const estimated = !(model.goal.baseline_known === true
          && (model.goal.baseline_provenance ?? model.goal.provenance) === 'explicit');
        if (resolved !== null && typeof baselineRaw === 'number' && Number.isFinite(baselineRaw) && estimated) {
          withheld(
            `Olumi's own estimate of the current level of "${model.goal.metric}" (${baselineRaw}) was not used, ` +
            `so no chance of reaching ${raw} is shown: that figure would rest on a guess, not on anything you ` +
            `said. Tell me the current level of "${model.goal.metric}" and the chance of reaching it can be shown.`,
          );
        } else if (resolved !== null && typeof baselineRaw === 'number' && Number.isFinite(baselineRaw)) {
          const admission = scoresTheRightTail
            ? admitGoalBaseline({ rawTarget: raw, rawBaseline: baselineRaw, cap: resolved.cap })
            : null;
          if (admission === null && model.goal.operator === '>') {
            withheld(
              `"${model.goal.metric}" is a goal to get strictly above ${raw}, and the chance of meeting it ` +
              `cannot be calculated exactly yet: reaching ${raw} itself would be counted as success. So its ` +
              `current level (${baselineRaw}) was not used for that, and no chance of meeting the goal will be ` +
              `shown. If reaching ${raw} is enough, say the goal is "at least ${raw}" and it can be shown.`,
            );
          } else if (admission === null) {
            withheld(
              `"${model.goal.metric}" is a goal to stay ${model.goal.operator === '<' ? 'below' : 'at or below'} ${raw}, and the chance of meeting a ` +
              'goal of that kind cannot be calculated correctly yet, so its current level ' +
              `(${baselineRaw}) was not used for that. The options can still be compared on everything ` +
              'else; no chance of meeting the goal will be shown.',
            );
          } else if (admission.admitted) {
            // Only the user's stated level reaches here (see `estimated` above).
            observed_state = {
              value: admission.normalised,
              baseline: admission.normalised,
              ...(model.goal.unit ? { unit: model.goal.unit } : {}),
              source: 'brief_extraction',
              raw_value: baselineRaw,
              cap: resolved.cap,
            };
          } else if (admission.reason === 'baseline_off_cap_scale') {
            withheld(
              `The current level of "${model.goal.metric}" (${baselineRaw}) is outside the range the target of ${raw} ` +
              `is measured on (0 to ${resolved.cap}), so the chance of reaching the target cannot be shown. The target ` +
              'is kept. If either figure is wrong, say which and it can be corrected.',
            );
          } else {
            withheld(
              `The current level of "${model.goal.metric}" (${baselineRaw}) is already above the target ` +
              `of ${raw}, so the chance of reaching the target cannot be shown: read that way the question ` +
              'would be upside down. The target is kept. If the goal is to get back below a level, or if ' +
              'either figure is wrong, say which and it can be corrected.',
            );
          }
        }
        return {
          ...(model.goal.unit ? { goal_threshold_unit: model.goal.unit } : {}),
          goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME,
          goal_threshold_raw: raw,
          ...(resolved !== null
            ? {
                goal_threshold_cap: resolved.cap,
                goal_threshold_cap_provenance: resolved.provenance,
                goal_threshold: raw / resolved.cap,
              }
            : {}),
          ...(observed_state !== undefined ? { observed_state } : {}),
        };
      })(),
    },
    ...model.options.map((o) => ({ label: o.label, kind: 'option' as const, provenance: o.provenance })),
    ...model.factors.map((f) => ({
      label: f.label,
      kind: 'factor' as const,
      provenance: f.provenance,
      node: {
        category: f.role,
        // A baseline is written ONLY when the candidate says one is known.
        //
        // ⭐ `observed_state.source` IS A DIFFERENT CLAIM FROM `provenance.source`,
        // and both are required. `provenance.source` says who put this ENTITY in
        // the model; `observed_state.source` says where this VALUE came from — and
        // it is the latter that `src/cee/provenance/money-invariant.ts:211` reads
        // to decide whether to audit the figure against the brief. Correcting only
        // the entity stamp left the figure unaudited; measured, not assumed.
        ...(f.baseline_known && typeof f.baseline_value === 'number'
          ? { observed_state: framedObservedState({ ...f, plausible_max: capFor(f.label) ?? f.plausible_max }) }
          : {}),
        // An ESTIMATE is kept on the same frame `scale_frame` carries below, as
        // Olumi's (`estimatedObservedState`). A known baseline never reaches it.
        ...((): Record<string, unknown> => {
          const os = estimatedObservedState(f, capFor(f.label) ?? f.plausible_max);
          return os === null ? {} : { observed_state: os };
        })(),
        // ⭐ THE FRAME TRAVELS WITH THE NODE, not only with the baseline. A
        // factor with no value today still needs its range, because the value
        // a user adopts LATER is normalised against it, and so is every level
        // an option sets on it (the interventions below divide by this same
        // lookup).
        //
        // ⛔ IT MUST BE THE DECLARED CARRIER, `scale_frame`. This used to write
        // a node-level `cap`. `NodeV3` does not declare one, so every parse
        // strips it, and the edit seam parses first. MEASURED on staging
        // 29ffda8a (Paul's session, 450acd25): the option's level sat on the
        // construction range, the user's later "5 FTE" found no frame, and the
        // adoption path derived a SECOND range (0 to 10) from the figure. Two
        // frames for one factor, and "hire two developers" read as shrinking
        // the team. `scale_frame` is what the draft's pass 3d writes on a
        // framed factor with no baseline (`records/projector.ts`), and what
        // the value writer reads (`normalise-factor-value.ts`, "FRAMED").
        //
        // Written only when there is NO baseline. A baselined factor carries
        // its frame inside `observed_state` (above), and a second carrier
        // there could disagree with an unframed pair.
        //
        // ⛔⛔ AND ALSO WHEN A BASELINE IS KNOWN BUT `framedObservedState` COULD NOT
        // FRAME IT. The condition used to be "no baseline", which left a whole class
        // of factor with NEITHER carrier — a known baseline the framer rejected
        // (negative, or above the cap) got no `observed_state.cap` and no
        // `scale_frame`, so the Run refused it forever and no later edit could
        // repair it. #63 item 1.
        //
        // The invariant the old comment was protecting still holds and is now
        // enforced rather than approximated: `scale_frame` is written ONLY when the
        // observed state does not already carry a frame, so the two carriers can
        // never disagree. It is derived from the SAME cap the framer was given, so
        // nothing new is invented here.
        ...((): Record<string, number> => {
          const c = capFor(f.label) ?? f.plausible_max;
          if (!(typeof c === 'number' && Number.isFinite(c) && c > 1)) return {};
          if (f.baseline_known && typeof f.baseline_value === 'number') {
            const os = framedObservedState({ ...f, plausible_max: c }) as { cap?: unknown };
            // Already framed inside `observed_state` — a second carrier could
            // disagree with it, so do not write one.
            if (typeof os.cap === 'number') return {};
          }
          return { scale_frame: c };
        })(),
      },
    })),
    ...model.risks.map((r) => ({ label: r.label, kind: 'risk' as const, provenance: r.provenance })),
    ...model.outcomes.map((o) => ({ label: o.label, kind: 'outcome' as const, provenance: o.provenance })),
    ...(widened.proposed_options ?? []).map((o) => ({ label: o.label, kind: 'option' as const, provenance: 'ai_proposed' })),
    ...(widened.proposed_factors ?? []).map((f) => ({ label: f.label, kind: 'factor' as const, provenance: 'ai_proposed' })),
    ...(widened.proposed_risks ?? []).map((r) => ({ label: r.label, kind: 'risk' as const, provenance: 'ai_proposed' })),
    ...(widened.proposed_outcomes ?? []).map((o) => ({ label: o.label, kind: 'outcome' as const, provenance: 'ai_proposed' })),
  ];

  // The goal's operator and horizon have NO GraphV3 home. Recording them is the
  // only way they survive the projection at all.
  //
  // ⚠ `REPAIR_CODES` has no member meaning "a representation was dropped" —
  // the closest is RESOLVE_BELIEF_PRECEDENCE. That is a gap in the shared
  // vocabulary, named here rather than papered over with a code that misdescribes
  // what happened.
  if (typeof model.goal.horizon_months === 'number') {
    loss.push({
      code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
      layer: 'cee',
      field_path: `nodes[${slugId(model.goal.metric)}].horizon_months`,
      before: model.goal.horizon_months,
      after: null,
      reason:
        `The goal is stated with a ${model.goal.horizon_months}-month horizon, and GraphV3 has ` +
        'nowhere to put it. The projection therefore expresses a threshold with no deadline: ' +
        '"reach it" and "reach it within a year" become the same goal. The horizon survives only ' +
        'in this record and in the rich model.',
      severity: 'warn',
    });
  }
  if (typeof model.goal.operator === 'string' && model.goal.operator.length > 0) {
    loss.push({
      code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
      layer: 'cee',
      field_path: `nodes[${slugId(model.goal.metric)}].goal_operator`,
      before: model.goal.operator,
      after: null,
      reason:
        `The goal direction ("${model.goal.operator}") is not carried by \`goal_threshold\`, which ` +
        'is a bare number. A consumer cannot tell a floor from a ceiling from the projection alone.',
      severity: 'warn',
    });
  }

  // The decision node is prepended so it takes a stable id before any entity
  // whose label might slug to the same token.
  const DECISION_LABEL = `Decision: ${model.goal.metric}`;
  entities.unshift({ label: DECISION_LABEL, kind: 'decision', provenance: 'inferred' });

  const ids = assignIds(entities.map((e) => e.label));
  const nodes: AdmittedNode[] = [];
  const inference_classes: Record<string, InferenceClass> = {};
  const seen = new Set<string>();
  for (const e of entities) {
    const id = ids.get(e.label)!;
    if (seen.has(id)) continue;
    seen.add(id);
    inference_classes[id] = inferenceClassFor(e.provenance);
    // A factor with NO baseline value gets no observed_state at all — an absent
    // value is the honest record; a zero would be a measurement. (An ESTIMATED
    // value is kept, stamped as Olumi's: `estimatedObservedState`.)
    const label = shortLabel(e.label);
    if (label !== e.label) {
      loss.push({
        code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
        layer: 'cee',
        field_path: `nodes[${id}].label`,
        before: e.label,
        after: label,
        reason:
          `The label was ${e.label.length} characters. Any structural edit composes two labels into ` +
          `a summary capped at 80, so a label over ${MAX_LABEL} makes the model uneditable. The full ` +
          'text is preserved on the node description and here.',
        severity: 'info',
      });
    }
    nodes.push({
      id,
      kind: e.kind,
      label,
      ...(label !== e.label ? { description: e.label } : {}),
      provenance: displayProvenanceFor(e.provenance),
      ...(e.node ?? {}),
    });
  }

  // The scope choice, recorded with both readings: its `after` IS the assumption the build says, and
  // its `reason` IS the question the build asks.
  if (goalScope !== null) {
    loss.push({
      field_path: `nodes[${ids.get(model.goal.metric)!}].goal_scope`,
      before: { metric: model.goal.metric, modelled: goalScope.modelled, alternative: goalScope.alternative },
      after:
        `The model measures your "${model.goal.metric}" goal for ${goalScope.modelled} \u2014 Olumi's assumption; the ` +
        `brief does not say whether it covers ${goalScope.modelled} or ${goalScope.alternative}.`,
      reason:
        `The brief does not say whether your "${model.goal.metric}" goal covers ${goalScope.modelled} or ` +
        `${goalScope.alternative}, so the model measures it for ${goalScope.modelled}. Which did you mean?`,
      severity: 'warn',
    } as RepairEntry);
  }

  /** The node a limit names: its exact label, else a case-insensitive label match; never a fuzzy guess. */
  const nodeIdForMetric = (metric: string): string | undefined => {
    const exact = ids.get(metric);
    if (exact !== undefined) return exact;
    const wanted = metric.trim().toLowerCase();
    for (const [label, id] of ids) if (label.trim().toLowerCase() === wanted) return id;
    return undefined;
  };

  /**
   * ⛔ A LIMIT THE USER STATED ON A LEVEL NAMES A QUANTITY THAT CAN HOLD ONE (R&C 5842795947, DL 5842800634).
   *
   * SERVED (CEE 08f6f90, Paul's brief "…keeping monthly churn under 10%…"): in about 2 of 7 first passes the drafter
   * made "Monthly churn" an OUTCOME. The limit attached, but Paul's "about 4% today, from our billing data" had nowhere
   * to land — "Monthly churn is currently an outcome, not a factor that can hold a starting value" — because the value
   * writer takes only a factor (`SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS`). Drafted as a factor, the same journey
   * reached a proposal 5/5.
   *
   * So an OUTCOME named by a limit that (a) the user stated (the brief-stated class, `admit-constraint.ts`
   * `isUserAuthored`'s rule) and (b) is a percentage LEVEL is admitted as an observable FACTOR: the same id, label,
   * authorship and links, and exactly the served factor-kind shape. A level here is a unit that pins a frame on its own
   * (`unitPinnedScaleFrame`) AND that the limit canonicaliser carries as a plain `"%"` on that frame — a percent head
   * with at most a period ("% per month"), above 1 and up to 100. "percentage points" / "pp" (a change), "% change vs …", a money or
   * count limit, a goal and a risk are left exactly as they were. The frame is the one the unit pins (a unit of
   * measurement, which is what the served factor-kind node carries); no starting value is written — the slot stays
   * empty for the user's own figure. An outcome carries no value or frame to keep (its entity has no `node` payload).
   */
  const limitedLevelFrames = new Map<string, number>();
  for (const c of model.constraints) {
    if (inferenceClassFor(c.provenance) !== 'brief_stated') continue;
    const frame = unitPinnedScaleFrame(c.unit, c.value);
    if (frame === undefined || canonicaliseLimitUnit(c.value, c.unit, { scale_frame: frame }).unit !== '%') continue;
    const id = nodeIdForMetric(c.metric);
    if (id !== undefined) limitedLevelFrames.set(id, frame);
  }
  for (const n of nodes) {
    const frame = limitedLevelFrames.get(n.id);
    if (frame === undefined || n.kind !== 'outcome') continue;
    n.kind = 'factor';
    n.category = 'observable';
    n.scale_frame = frame;
  }

  const allLinks: CandidateLink[] = [...model.links, ...(widened.proposed_links ?? [])];
  const resolvable: CandidateLink[] = [];
  const unresolved: { from: string; to: string; reason: string; detail: string }[] = [];
  for (const l of allLinks) {
    const from = ids.get(l.from);
    const to = ids.get(l.to);
    if (from === undefined || to === undefined) {
      unresolved.push({
        from: l.from,
        to: l.to,
        reason: 'unresolved_endpoint',
        detail: `Link references ${from === undefined ? `"${l.from}"` : `"${l.to}"`}, which the candidate never declared as an entity. Withheld rather than attached to an invented node.`,
      });
      continue;
    }
    resolvable.push({ ...l, from, to });
  }

  // ── interventions ────────────────────────────────────────────────────────
  // An intervention names a factor by LABEL. Resolving it to a node id is an
  // exact match only: attaching "what this option changes" to a guessed factor
  // would put the user's own number on the wrong quantity.
  const interventionsByOption = new Map<string, Record<string, ConstructedLevel>>();
  /**
   * ⛔ AN OPTION'S LEVEL MUST BE ON THE SAME SCALE AS THE FACTOR'S BASELINE.
   *
   * MEASURED LIVE at served a1e35b40, and this defect was introduced by the
   * scale frame itself: the baseline started being written as `raw / cap`
   * while the option levels were still written raw, so one factor carried a
   * baseline of `0.245` and an intervention of `59`. `run_analysis` refused
   * the whole comparison with `mixed_scale_unresolved` and named four factors
   * — "values … that the analysis engine would silently rescale".
   *
   * A frame that is applied to only one of the two numbers is worse than no
   * frame at all, because each is individually coherent and the pair is not.
   * So the SAME cap normalises both, here, from one lookup.
   */
  const capByFactorId = new Map<string, number>();
  for (const f of model.factors) {
    const fid = ids.get(f.label);
    const c = capByLabel.get(f.label);
    if (fid !== undefined && c !== undefined) capByFactorId.set(fid, c);
  }
  for (const d of defaultedFrames) {
    // "Your own figures" only when a figure the user stated fed the frame; when
    // every figure is Olumi's, saying so is the honest record.
    const whose = userStatedFigureLabels.has(d.label)
      ? 'your own figures are stored unchanged beside it.'
      : "the figures it was taken from are Olumi's own estimates, not figures you gave, and are stored unchanged beside it.";
    loss.push({
      field_path: `nodes[${ids.get(d.label) ?? d.label}].observed_state.cap`,
      before: null,
      after: d.frame,
      reason:
        `No range was stated for "${d.label}", and a number above 1 with no range cannot be analysed ` +
        `at all \u2014 nor can a range be added afterwards. A range of 0 to ${d.frame} has been used, taken ` +
        'from the largest figure the model already holds for it. That is a unit of measurement, not a ' +
        `forecast or a limit, and ${whose}`,
      severity: 'warn',
    } as RepairEntry);
  }

  for (const w of widenedFrames) {
    loss.push({
      field_path: `nodes[${ids.get(w.label) ?? w.label}].observed_state.frame_widened`,
      before: w.stated,
      after: w.frame,
      reason:
        `"${w.label}" was given a range of 0 to ${w.stated}, but "${w.option}" sets it to ${w.value}, so the range ` +
        `is now 0 to ${w.frame} and every figure for it is read against that one range. A range is a unit of ` +
        'measurement, not a forecast or a limit; no figure was changed.',
      severity: 'warn',
    } as RepairEntry);
  }
  for (const r of restatedChanges) {
    const levels = candidateModel.options.flatMap((o) => (o.interventions ?? [])
      .filter((i) => i.factor_label === r.label)
      .map((i) => `"${o.label}" ${TODAY_LEVEL + i.value}`));
    loss.push({
      field_path: `nodes[${ids.get(r.label) ?? r.label}].observed_state.level_restated`,
      before: 0,
      after: TODAY_LEVEL,
      reason:
        `"${r.label}" is a change from today, and a change below zero cannot be analysed beside the others, so it ` +
        `is measured as its level relative to today instead: today is ${TODAY_LEVEL}, and each option's change is ` +
        `added to it (${levels.join(', ')}), on a range of 0 to ${r.frame}. The sign of every change is kept and ` +
        'no figure you gave was altered.',
      severity: 'warn',
    } as RepairEntry);
  }

  /** option id -> factor ids it acts on, with or without a stated level. */
  const actsOnByOption = new Map<string, Set<string>>();
  for (const o of model.options) {
    const optionId = ids.get(o.label);
    if (optionId === undefined) continue;
    const actsOn = new Set<string>();
    actsOnByOption.set(optionId, actsOn);
    for (const factorLabel of o.changes ?? []) {
      const factorId = ids.get(factorLabel);
      if (factorId === undefined) {
        unresolved.push({
          from: o.label,
          to: factorLabel,
          reason: 'unresolved_change_target',
          detail:
            `This option says it changes "${factorLabel}", but no entity of that name was ` +
            'admitted. Withheld rather than attached to a guessed factor.',
        });
        continue;
      }
      actsOn.add(factorId);
    }
    const bundle: Record<string, ConstructedLevel> = {};
    for (const iv of o.interventions ?? []) {
      const factorId = ids.get(iv.factor_label);
      if (factorId === undefined) {
        unresolved.push({
          from: o.label,
          to: iv.factor_label,
          reason: 'unresolved_intervention_target',
          detail:
            `This option states it sets "${iv.factor_label}" to ${iv.value}${iv.unit ?? ''}, but no ` +
            'factor of that name was admitted. Withheld rather than attached to a guessed factor — ' +
            "putting the user's own number on the wrong quantity is worse than not carrying it.",
        });
        continue;
      }
      actsOn.add(factorId);
      /**
       * ⛔ ONE VALUE SPACE PER FACTOR (#69 5835137365). A level below zero that could not be
       * restated as a level relative to today (`restateSignedPercentChanges`) has no place in
       * the factor's frame, and writing it raw beside normalised siblings is what made the
       * served comparison refuse. It is WITHHELD — never squeezed, never registered in a second
       * space — the option keeps acting on the factor with no level of its own, and it is said.
       * Every other level sits inside its frame by construction (a stated range below a level
       * is widened above), so it is divided by the same range as the factor's baseline.
       */
      if (iv.value < 0) {
        loss.push({
          field_path: `nodes[${optionId}].interventions.${factorId}.signed_level_withheld`,
          before: iv.value,
          after: null,
          reason:
            `"${o.label}" puts "${iv.factor_label}" at ${iv.value}${iv.unit ? ` ${iv.unit}` : ''}, and a level ` +
            `below zero cannot be analysed beside the others, so no level was set: the option is kept as changing ` +
            `"${iv.factor_label}", with no level of its own. Say what "${iv.factor_label}" would be after ` +
            `"${o.label}" and it becomes a level.`,
          severity: 'warn',
        } as RepairEntry);
        continue;
      }
      const cap = capByFactorId.get(factorId);
      bundle[factorId] = { value: cap !== undefined ? iv.value / cap : iv.value, source: levelSourceFor(iv.provenance) };
    }
    if (Object.keys(bundle).length > 0) interventionsByOption.set(optionId, bundle);
  }
  /**
   * ⛔ AN OPTION THAT CHANGES NOTHING CANNOT BE COMPARED TO ANYTHING.
   *
   * Measured on a real 35-node model: 0 of 7 options carried an intervention.
   * Every option reached the goal, every count looked healthy, and the analysis
   * could still never discriminate between "direct sales hiring" and "channel
   * partnerships" — because nothing said what either one DOES. Supplying the
   * 17 missing factor values would not have helped: the defect is structural,
   * not numeric, and no readiness number reveals it.
   *
   * This does not invent a level. It records, per option, that the option is
   * inert, so the Agent can say so and ask — which is the honest move when the
   * brief genuinely did not say what an option changes.
   */
  for (const o of model.options) {
    const optionId = ids.get(o.label);
    if (optionId === undefined) continue;
    const actsOn = actsOnByOption.get(optionId);
    if (actsOn !== undefined && actsOn.size > 0) continue;
    unresolved.push({
      from: o.label,
      to: '(nothing)',
      reason: 'option_changes_nothing',
      detail:
        `"${o.label}" does not say what it changes — no factor level it sets, and no factor it ` +
        'acts on. It can appear in the model but can never be compared with another option, ' +
        'whatever values are filled in later. Ask what this option actually does differently.',
    });
  }

  for (const n of nodes) {
    const bundle = interventionsByOption.get(n.id);
    if (bundle !== undefined) n.interventions = bundle;
  }

  const linkResult = admitCandidateLinks(resolvable);

  // decision -> option edges are TOPOLOGY, not causal belief. They use the
  // canonical structural constant and are deliberately NOT marked `defaulted`
  // and NOT ledgered: there is no magnitude here that anyone could have
  // authored, so recording one as a projection would dilute the ledger and hide
  // the real projections.
  const decisionId = ids.get(DECISION_LABEL)!;
  const topo = (from: string, to: string) => ({
    from,
    to,
    strength: { ...STRUCTURAL_EDGE_DEFAULTS.strength },
    exists_probability: STRUCTURAL_EDGE_DEFAULTS.exists_probability,
    effect_direction: STRUCTURAL_EDGE_DEFAULTS.effect_direction,
    provenance: { source: 'cee_hypothesis' },
  });
  const optionNodes = nodes.filter((n) => n.kind === 'option');
  const topologyEdges = [
    ...optionNodes.map((o) => topo(decisionId, o.id)),
    // ⭐ option -> factor, one per intervention. NOT invented: an option that
    // states it sets a factor's level is connected to that factor by
    // construction, and the readiness check says so in the user's terms —
    // "An option has no factor connections and cannot be analysed." Derived
    // strictly from an intervention that already resolved, so an option with no
    // stated intervention gets no edge and stays honestly unmapped.
    ...optionNodes.flatMap((o) =>
      [...(actsOnByOption.get(o.id) ?? [])].map((factorId) => topo(o.id, factorId)),
    ),
  ];
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const constraintResult = admitCandidateConstraints(
    model.constraints,
    nodeIdForMetric,
    // A limit's unit is canonicalised against ITS node's scale — the one PLoT will normalise it against.
    (nodeId) => {
      const n = nodeById.get(nodeId);
      if (n === undefined) return undefined;
      return { ...(n.observed_state ?? {}), ...(n.scale_frame !== undefined ? { scale_frame: n.scale_frame } : {}) };
    },
  );

  /**
   * ⛔ ONE CONNECTION, ONE EDGE — an option's link to a factor it already acts on
   * is the SAME connection, not a second one.
   *
   * MEASURED LIVE (23 Sep, Paul's hiring brief, gpt-5.6-terra): the drafter named
   * each option's factors in `changes`/`interventions` AND restated them as
   * `links`, so admission emitted the canonical structural edge AND a causal
   * duplicate for the same option -> factor pair — 4 duplicates, 28 real links
   * reported as 32, and the first model was refused as oversized. The duplicate
   * is also wrong in kind: an option -> factor edge must carry the canonical
   * structural values (`graph-validator.ts`, STRUCTURAL_EDGE_NOT_CANONICAL_ERROR),
   * which the causal projection (0.5 / 0.125 / 0.8) does not.
   *
   * So the structural edge is kept and the duplicate is dropped, with the
   * projection entries it generated, and the drop is recorded — nothing silent.
   * A candidate option -> factor link with NO structural twin is untouched.
   */
  const topologyPairs = new Set(topologyEdges.map((e) => `${e.from}\u0000${e.to}`));
  const optionIdSet = new Set(optionNodes.map((o) => o.id));
  const duplicatePairs = new Set(
    linkResult.edges
      .filter((e) => optionIdSet.has(e.from) && topologyPairs.has(`${e.from}\u0000${e.to}`))
      .map((e) => `${e.from}::${e.to}`),
  );
  /**
   * ⛔ …AND THE DROP MUST NOT TAKE THE USER'S AUTHORSHIP WITH IT (Panel review
   * 5793954535, B2). The live drafter restates 4 of 4 options this way, and an
   * `explicit` restatement is the only carrier of `brief_extraction` on that
   * connection. Dropping it emptied `brief_stated_keys.edges`, so #1710's identity
   * check (`keepsEveryUserStatedIdentity`) had nothing to compare and a retry that
   * moved the user's option onto a different factor was adopted silently. So the
   * kept structural edge inherits the user's stamp — only a user stamp: an
   * `ai_proposed` / `inferred` restatement confers nothing, and the edge keeps the
   * canonical structural values, which is all the validator checks.
   */
  const USER_AUTHORED_EDGE_SOURCES = new Set(['brief_extraction', 'user_specified']);
  for (const t of topologyEdges) {
    if (!duplicatePairs.has(`${t.from}::${t.to}`)) continue;
    const userStated = linkResult.edges.find(
      (e) => e.from === t.from && e.to === t.to && USER_AUTHORED_EDGE_SOURCES.has(String(e.provenance?.source ?? '')),
    );
    if (userStated?.provenance !== undefined) t.provenance = { source: userStated.provenance.source };
  }
  const causalEdges = linkResult.edges.filter((e) => !duplicatePairs.has(`${e.from}::${e.to}`));

  /**
   * ⛔ AN OPTION LINKED STRAIGHT TO A RISK MAKES THE WHOLE MODEL UNANALYSABLE —
   * AND IT IS OLUMI'S OWN HYPOTHESIS THAT BLOCKS OLUMI'S OWN ANALYSIS.
   *
   * MEASURED on the banked live capture (`__tests__/fixtures/live-hiring-envelope-candidate-20260923.json`,
   * gpt-5.6-terra, Paul's hiring brief) plus the one link Paul's own draw added:
   * `optionsNeedingMapping` went 0 -> 1 and readiness raised
   *
   *     OPTION_NEEDS_MAPPING  "How does Hire a Tech Lead change Hiring delay?
   *                            The proposed relationship is retained, but its
   *                            mechanism and value still need clarification."
   *
   * on an edge carrying `provenance.source: "cee_hypothesis"`, `defaulted: true`.
   * The rule is `cee/transforms/analysis-ready.ts`, in `buildAnalysisReadyPayload`'s
   * prologue: ANY directed `option -> risk` edge forces that option to
   * `needs_user_mapping`, so one machine-authored shortcut stops the ENTIRE model
   * being run.
   *
   * ⚠ WHY THE DRAFTER EMITS IT. Nothing in the construction contract forbade it.
   * "THE GOAL METRIC MUST BE THE TERMINAL NODE. Every option needs a causal path
   * that ends at the goal metric" makes `option -> risk -> goal` the SHORTEST
   * compliant path, and the risk clause only says "Give every risk a link to what
   * it threatens" — a rule about what leaves a risk, silent on what enters it.
   * So `build-model.ts` now forbids the shape at the producer. This is the
   * deterministic backstop, because an instruction alone has already been proved
   * insufficient for the wiring rules directly above.
   *
   * ⛔ AND THE BACKSTOP IS NOT MEDIATOR SYNTHESIS. Inventing the missing
   * `factor -> risk` link means choosing a direction nobody stated — forbidden by
   * Release Control #63 5793252993, the same ruling that removed the
   * `factor -> goal` repair documented below. Nor is it a deletion: the
   * hypothesis and its uncertainty are the author's to keep.
   *
   * So exactly two outcomes, decided by what the model ALREADY says:
   *
   * 1. THE MECHANISM IS ALREADY THERE. The drafter itself stated
   *    `Tech leads hired -> Hiring delay` and the option acts on
   *    `Tech leads hired`, so the direct edge is that same belief stated twice —
   *    the case the "ONE CONNECTION, ONE EDGE" repair above already handles for
   *    `option -> factor`. The shortcut is folded onto the mechanism and the fold
   *    is recorded. The risk keeps its incoming link and still reaches the goal.
   * 2. THERE IS NO MECHANISM. The edge is KEPT — nothing is deleted, no sign is
   *    invented, `may_run` is not forced — and an explicit actionable repair
   *    proposal is recorded. `build-model.ts` surfaces it in `not_represented`,
   *    the channel the Agent is already expected to say out loud.
   *
   * ⚠ ONLY A MACHINE-AUTHORED SHORTCUT IS FOLDED. A shortcut the USER stated is
   * their claim about their own decision, and folding it would strip the
   * authorship that `brief_stated_keys.edges` and `keepsEveryUserStatedIdentity`
   * read (Panel review 5793954535, B2). It gets the proposal instead.
   *
   * ⚠ REACHABILITY IS COMPUTED WITH **EVERY** SHORTCUT REMOVED, not just the one
   * under examination, so no shortcut can be its own mechanism (or another
   * shortcut's) and the verdict cannot depend on evaluation order.
   */
  const kindById = new Map(nodes.map((n) => [n.id, n.kind]));
  const labelById = new Map(nodes.map((n) => [n.id, n.label]));
  const shortcutEdges = causalEdges.filter((e) =>
    kindById.get(e.from) === 'option'
    && kindById.get(e.to) === 'risk'
    && !USER_AUTHORED_EDGE_SOURCES.has(String(e.provenance?.source ?? '')));
  const shortcutPairs = new Set(shortcutEdges.map((e) => `${e.from}\u0000${e.to}`));
  const mechanismGraph = [...topologyEdges, ...causalEdges].filter((e) => !shortcutPairs.has(`${e.from}\u0000${e.to}`));
  const mechanismPath = (from: string, to: string): readonly string[] | null => findMechanismPath(mechanismGraph, from, to);
  const foldedShortcutPairs = new Set<string>();
  for (const s of shortcutEdges) {
    const optionLabel = labelById.get(s.from) ?? s.from;
    const riskLabel = labelById.get(s.to) ?? s.to;
    const path = mechanismPath(s.from, s.to);
    if (path !== null) {
      foldedShortcutPairs.add(`${s.from}::${s.to}`);
      const chain = path.map((id) => `"${labelById.get(id) ?? id}"`).join(' \u2192 ');
      const mediatorLabel = labelById.get(path[1] ?? '') ?? String(path[1] ?? '');
      loss.push({
        code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
        layer: 'cee',
        field_path: `edges[${s.from}::${s.to}].mechanism`,
        before: s.effect_direction,
        after: 'mechanism',
        reason:
          `The link straight from "${optionLabel}" to "${riskLabel}" is a shortcut over a mechanism `
          + `this model already states: ${chain}. A bare option-to-risk link cannot be analysed at all `
          + `\u2014 Olumi would have to ask how that option changes that risk before ANY of the model could `
          + `run \u2014 so the belief is kept once, on the mechanism, and the shortcut is not drawn. Nothing `
          + `was removed: "${riskLabel}" keeps its own link, and "${optionLabel}" still reaches it through `
          + `"${mediatorLabel}".`,
        severity: 'info',
      });
      continue;
    }
    loss.push({
      code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
      layer: 'cee',
      field_path: `edges[${s.from}::${s.to}].mechanism_missing`,
      before: null,
      after: s.effect_direction,
      reason:
        `Olumi's own hypothesis that "${optionLabel}" changes "${riskLabel}" is kept, but nothing in the `
        + `model says HOW \u2014 and a bare option-to-risk link stops the WHOLE model being analysed, not `
        + `just that option. It has not been deleted, and no mediator or strength has been invented for `
        + `it. Say which factor "${optionLabel}" changes that drives "${riskLabel}" and the link can be `
        + `redrawn through it \u2014 or say the link should go.`,
      severity: 'warn',
    });
  }
  const mechanismEdges = causalEdges.filter((e) => !foldedShortcutPairs.has(`${e.from}::${e.to}`));

  const causalLoss = linkResult.loss.filter((l) => {
    const m = /^edges\[(.+?)\]\./.exec(String(l.field_path ?? ''));
    return m === null || !(duplicatePairs.has(m[1]!) || foldedShortcutPairs.has(m[1]!));
  });
  for (const pair of duplicatePairs) {
    const [from, to] = pair.split('::');
    const stated = linkResult.edges.find((e) => e.from === from && e.to === to);
    loss.push({
      field_path: `edges[${pair}]`,
      before: stated?.effect_direction ?? null,
      after: 'structural',
      reason:
        'This option already acts on this factor, so the link was the same connection stated twice. ' +
        'It is kept once, as the structural option-to-factor edge; what the option sets the factor to ' +
        'is carried by the option itself, not by the sign of this edge.',
      severity: 'info',
    } as RepairEntry);
  }

  loss.push(...causalLoss, ...constraintResult.loss);

  /**
   * ⛔ AN ORPHANED GOAL IS NAMED, NEVER REPAIRED WITH A SIGN NOBODY STATED.
   *
   * Measured twice on real briefs: a goal metric "Productivity change" while every
   * causal chain terminated on an invented near-synonym outcome "Productivity
   * Improvement" — 35 nodes, 40 edges, all healthy looking, and 0 of 6 options
   * able to reach the goal.
   *
   * ⛔ A REPAIR USED TO LIVE HERE AND WAS REMOVED BY RULING. When nothing reached
   * the goal it connected every terminal outcome to the goal as `positive`,
   * `defaulted`, with NO provenance — and, because it never consulted
   * `linkResult.withheld`, it did so even over an outcome -> goal link the drafter
   * had explicitly stated as `unknown` (Panel review 5793954535, B1, probe P1:
   * readiness `ready` while the server told the user the same question was still
   * open). Release Control #63 5793252993: no default sign on a link to the goal;
   * disclosure does not make an arbitrary sign sound; where direction is unknown,
   * ASK. It is the same ruling that already forbids a factor -> goal repair.
   *
   * So an orphaned goal stays orphaned: the reachability pass below names every
   * node that cannot reach it, readiness reports `NO_PATH_TO_GOAL`, the withheld
   * link travels in `withheld`, and the construction contract (`build-model.ts`)
   * is what makes the drafter state the link in the first place.
   */
  /**
   * ⭐ THE HELD STATUS QUO (`wireInertStatusQuo`). It shares the conventional
   * lane's connectivity repair's `origin: 'repair'` and its "no effect value is
   * implied" wording (`CONNECTIVITY_REPAIR_WIRING_REASON`), because `origin` is the
   * one discriminator readiness reads to hold the option rather than ask for a
   * level. The provenance SOURCE deliberately differs: that repair stamps
   * `synthetic` (`status-quo-fix.ts:247`), while this lane stamps
   * `cee_hypothesis`, the source every other machine-authored edge it admits
   * carries. No level, no intervention, no `is_baseline` stamp and no user
   * authority are written: the only claim made is the one disclosed below, and
   * it is correctable.
   */
  // Read through the shared baseline-identity reader, so "is this the status quo?"
  // has one truth table across the estate.
  const declaredStatusQuoIds = new Set(
    model.options
      .filter((o) => readIsBaseline({ ...(typeof o.is_status_quo === 'boolean' ? { is_baseline: o.is_status_quo } : {}) }) === true)
      .map((o) => ids.get(o.label))
      .filter((id): id is string => id !== undefined),
  );
  const heldStatusQuo = wireInertStatusQuo(nodes, [...topologyEdges, ...mechanismEdges], interventionsByOption, declaredStatusQuoIds);
  const heldStatusQuoEdges = (heldStatusQuo?.factorIds ?? []).map((factorId) => ({
    ...topo(heldStatusQuo!.optionId, factorId),
    origin: REPAIR_AUTHORED_ORIGIN,
    provenance: { source: 'cee_hypothesis', reasoning: CONNECTIVITY_REPAIR_WIRING_REASON },
  }));
  if (heldStatusQuo !== null && declaredStatusQuoIds.has(heldStatusQuo.optionId)) {
    const declaredNode = nodes.find((n) => n.id === heldStatusQuo.optionId);
    if (declaredNode !== undefined) declaredNode.is_baseline = true;
  }
  if (heldStatusQuo !== null) {
    const optionLabel = labelById.get(heldStatusQuo.optionId) ?? heldStatusQuo.optionId;
    const names = heldStatusQuo.factorIds.map((id) => labelById.get(id) ?? id);
    const factorList = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    // The option is no longer inert, so it is no longer reported as one.
    for (let i = unresolved.length - 1; i >= 0; i--) {
      const w = unresolved[i]!;
      if (w.reason === 'option_changes_nothing' && ids.get(w.from) === heldStatusQuo.optionId) unresolved.splice(i, 1);
    }
    loss.push({
      field_path: `nodes[${heldStatusQuo.optionId}].status_quo_held`,
      before: null,
      after: heldStatusQuo.factorIds,
      reason:
        `'${optionLabel}' reads as carrying on as now, so I connected it to ${factorList} with no level of its own; ` +
        'the analysis holds each at its starting value, which may be an estimate rather than a figure you gave. ' +
        'If carrying on as now would itself change any of them, say how.',
      severity: 'info',
    } as RepairEntry);
  }

  const allEdges = [...topologyEdges, ...heldStatusQuoEdges, ...mechanismEdges];

  /**
   * ⭐ A NODE THAT CANNOT REACH THE GOAL BLOCKS THE WHOLE ANALYSIS.
   *
   * ⛔ MEASURED LIVE, 22 Sep, served 877ae800, on the canonical pricing model.
   * Every factor had a value and the analysis was still refused:
   *
   *     blocked_reason: "ORPHAN_NODE"   ← 6 nodes with no edge at all
   *
   * and with those six removed, in a controlled arm on a registered copy:
   *
   *     blocked_reason: "NO_PATH_TO_GOAL"  ← 2 more, connected but dead-ended
   *
   * Eight of twenty nodes were structurally inert, ALL FIVE risks among them.
   * The builder is told to wire everything to the goal and it does not, so an
   * instruction alone is not the fix — this is the deterministic backstop.
   *
   * Two steps, in order, because they are different kinds of claim:
   *
   * 1. A RISK with no outgoing edge is connected to the goal, negative and
   *    `defaulted`. This is NOT a guess about which factor it threatens: in
   *    this taxonomy a risk is by definition something that threatens the
   *    goal, so the link is entailed by the node's own kind (whether that
   *    entailment stands is Release Control's call — Panel N7, 5793954535).
   *    ⛔ EXCEPT a risk whose link the drafter STATED with direction `unknown`:
   *    that risk was not "never connected" — its direction was declined, and a
   *    default `negative` would override the stated uncertainty (Panel review
   *    5793954535, B1, probe P3; #63 5793252993: ASK instead of defaulting). It
   *    stays unconnected, named below, and its withheld link is the question.
   * 2. Anything that STILL cannot reach the goal is withheld from the admitted
   *    graph and named in `loss`, because there is no non-guessing repair for
   *    it — and a model nobody can analyse is worse than a model that says
   *    plainly which pieces it could not wire in.
   *
   * Measured effect of exactly this, on exactly that model: 17 of 20 nodes
   * retained (every risk kept), structural blockers 5 -> 0.
   */
  const goalForReach = nodes.find((n) => n.kind === 'goal');

  /**
   * ⛔ NO LOOP IS REGISTERED THAT ONE OF OLUMI'S OWN LINKS CLOSES (`breakLoops`).
   *
   * Run over the edge set readiness checks — every edge admitted, the risk repairs
   * below included — and BEFORE the reachability pass, so a node a withheld link
   * leaves unconnected is named there like any other. The structural edges (the
   * decision's options, what each option sets, the held status quo) and the user's
   * own links are never withheld; a loop made only of those is kept and said.
   * Everything withheld travels in `withheld` and is said in `not_represented`,
   * and the projection entries for a withheld link go with it, as for a fold.
   *
   * ⛔ BROKEN FIRST, THEN THE RISK REPAIRS (review of f504b8e0, (a)). The repair list
   * was read off the edges BEFORE a loop was broken, so a risk whose only link was the
   * one withheld looked connected, got no repair, and readiness swapped CYCLE_DETECTED
   * for NO_PATH_TO_GOAL. The repairs are now computed from the broken edge set; a
   * second pass then breaks any loop a repair itself closes (a repair is Olumi's link).
   */
  const structuralEdges = new Set<object>([...topologyEdges, ...heldStatusQuoEdges]);
  const loopWithheld: { from: string; to: string; reason: string; detail: string; loop: readonly string[] }[] = [];
  const acyclic = <E extends AdmittedEdge>(edges: readonly E[], reportKept: boolean): E[] => {
    const labelsOf = (loop: readonly { from: string }[]) => loop.map((e) => labelById.get(e.from) ?? e.from);
    // The drafter's own words (a shortened label keeps its full text as `description`).
    const drafterLabel = (id: string): string => {
      const n = nodes.find((x) => x.id === id);
      return String((n as { description?: unknown } | undefined)?.description ?? n?.label ?? id);
    };
    const isUsers = (e: E): boolean => USER_AUTHORED_EDGE_SOURCES.has(String(e.provenance?.source ?? ''));
    const pairKey = (e: { from: string; to: string }): string => `${e.from}\u0000${e.to}`;
    const userPairs = new Set(edges.filter(isUsers).map(pairKey));
    const result = breakLoops(edges, {
      mayWithhold: (e) => !structuralEdges.has(e) && !isUsers(e),
      goalId: goalForReach?.id,
      kindOf: (id) => kindById.get(id),
    });
    for (const { edge, loop } of result.withheld) {
      const detail = sayWithheldLoopLink(labelById.get(edge.from) ?? edge.from, labelById.get(edge.to) ?? edge.to, labelsOf(loop));
      for (let i = loss.length - 1; i >= 0; i--) {
        const fp = String(loss[i]!.field_path ?? '');
        if (fp.startsWith(`edges[${edge.from}::${edge.to}]`) || fp === `edges[${edge.from}->${edge.to}]`) loss.splice(i, 1);
      }
      loss.push({
        code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
        layer: 'cee',
        field_path: `edges[${edge.from}::${edge.to}].loop_withheld`,
        before: edge.effect_direction ?? null,
        after: null,
        reason: detail,
        severity: 'warn',
      });
      loopWithheld.push({ from: edge.from, to: edge.to, reason: 'loop_closing_link', detail, loop: loop.map((e) => drafterLabel(e.from)) });
    }
    // A loop left after the second pass was already left (and said) by the first: a repair is breakable.
    for (const loop of reportKept ? result.kept : []) {
      loss.push({
        code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
        layer: 'cee',
        field_path: `edges[${loop[0]!.from}::${loop[0]!.to}].loop_kept`,
        before: null,
        after: null,
        reason: sayKeptLoop(labelsOf(loop), loop.map((e) => ({
          from: labelById.get(e.from) ?? e.from,
          to: labelById.get(e.to) ?? e.to,
          yours: userPairs.has(pairKey(e)),
          fromDecision: kindById.get(e.from) === 'decision',
        }))),
        severity: 'warn',
      });
    }
    return result.edges;
  };

  const riskRepairs: AdmittedEdge[] = [];
  const brokenEdges = acyclic(allEdges, true);
  let finalEdges: AdmittedEdge[] = brokenEdges;

  if (goalForReach !== undefined) {
    const hasOutgoingNow = new Set(brokenEdges.map((e) => e.from));
    // A risk whose own link was withheld as direction-unknown was answered
    // "I cannot say which way" — not left unconnected.
    const directionDeclined = new Set(linkResult.withheld.map((w) => w.from));
    for (const r of nodes.filter((n) => n.kind === 'risk' && !hasOutgoingNow.has(n.id) && !directionDeclined.has(n.id))) {
      const lostToLoop = loopWithheld.filter((w) => w.from === r.id).map((w) => `"${labelById.get(w.to) ?? w.to}"`);
      riskRepairs.push({
        from: r.id,
        to: goalForReach.id,
        effect_direction: 'negative',
        strength: { mean: STRENGTH_DEFAULT_SIGNATURE.mean, std: STRENGTH_DEFAULT_SIGNATURE.std },
        exists_probability: DEFAULT_EXISTS_PROBABILITY,
        // The same structured provenance every other machine-authored edge
        // carries — a repaired link is a hypothesis, and must read as one.
        provenance: { source: 'cee_hypothesis' },
        defaulted: true,
      } as AdmittedEdge);
      loss.push({
        field_path: `edges[${r.id}->${goalForReach.id}]`,
        before: null,
        after: 'connected',
        reason:
          (lostToLoop.length > 0
            ? `The risk "${r.label}" led only to ${lostToLoop.join(' and ')}, and ${lostToLoop.length === 1 ? 'that link was' : 'those links were'} left out to break a loop, ` +
              'so it no longer led anywhere, which stops the whole model being analysed. '
            : `The risk "${r.label}" was named but never connected to anything, which stops the whole ` +
              'model being analysed. ') +
          `It has been connected to "${goalForReach.label}" as a negative ` +
          'influence, with a placeholder strength — that link follows from it being a risk, not ' +
          'from anything you said, and neither it nor its strength is a measurement.',
        severity: 'warn',
      } as RepairEntry);
    }

    const edgesNow = riskRepairs.length === 0 ? brokenEdges : acyclic([...brokenEdges, ...riskRepairs], false);
    /**
     * ⛔ REPORTED, NOT ENFORCED — and that is a deliberate reversal.
     *
     * Withholding every unreachable node DOES clear the blocker: measured on a
     * registered copy of the live model, `ORPHAN_NODE` then `NO_PATH_TO_GOAL`
     * both went away and structural blockers fell 5 -> 0. It was implemented,
     * and then withdrawn, for two reasons that outrank it.
     *
     * 1. THE NODES IT DELETES ARE THE STRATEGIC ONES. The widener's additions
     *    are precisely the ones least likely to be wired by the builder, so
     *    "drop what cannot reach the goal" thins the model exactly where its
     *    strategic richness lives — the quality this lane is measured on.
     * 2. IT DOES NOT DELIVER A RUNNING ANALYSIS ANYWAY. With blockers at 0 the
     *    same run was still refused, `baseline_scale_unresolved`. Paying in
     *    lost content for a blocker that is not the last one is a bad trade.
     *
     * So an unreachable node stays, and is NAMED. The Agent reads it from
     * `structural_facts.entities_that_cannot_reach_goal`, raises it when it
     * describes the model, and the user says what it affects — which the
     * existing `propose_model_change` capability already turns into a link.
     * A question to the author beats a deletion behind their back.
     */
    const adjacencyNow = new Map<string, string[]>();
    for (const e of edgesNow) adjacencyNow.set(e.from, [...(adjacencyNow.get(e.from) ?? []), e.to]);
    const reachesGoal = (from: string): boolean => {
      const seen = new Set<string>([from]);
      const stack = [from];
      while (stack.length > 0) {
        const x = stack.pop()!;
        if (x === goalForReach.id) return true;
        for (const y of adjacencyNow.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
      }
      return false;
    };
    for (const n of nodes) {
      if (n.id === goalForReach.id || n.kind === 'decision' || reachesGoal(n.id)) continue;
      loss.push({
        field_path: `nodes[${n.id}]`,
        before: n.label,
        after: n.label,
        reason:
          `"${n.label}" is in the model but no chain of causes runs from it to "${goalForReach.label}", ` +
          'so the analysis cannot be run while it is unconnected. It has been kept rather than ' +
          'deleted — ask what it affects, and the link can be added.',
        severity: 'warn',
      } as RepairEntry);
    }
    finalEdges = edgesNow;
  }

  const levers = demoteUnreachedLevers(nodes, finalEdges);
  for (const label of levers.demoted) {
    loss.push({
      field_path: `nodes[${label}].category`,
      before: 'controllable',
      after: 'external',
      reason: `No option in this decision changes "${label}", so it is held at its value as context while the options are compared, not treated as a lever. If one of the options should change it, say which and it can be connected.`,
      severity: 'info',
    } as RepairEntry);
  }

  // C46: declared products, checked against the FINAL admitted structure (`markProductIdentities`).
  // An exact label first, then the same words ignoring case and spacing — never a fuzzy guess.
  const resolveEntity = (label: string): string | undefined => {
    if (typeof label !== 'string') return undefined;
    const exact = ids.get(label);
    if (exact !== undefined) return exact;
    const wanted = canonicalLabel(label);
    for (const [l, id] of ids) if (canonicalLabel(l) === wanted) return id;
    return undefined;
  };
  const products = markProductIdentities(
    Array.isArray(model.identities) ? model.identities : [],
    resolveEntity,
    levers.nodes,
    finalEdges,
    goalForReach?.id,
    declaredStatusQuoIds,
  );
  loss.push(...products.loss);
  /**
   * ⛔ C46 (a) — THE CARRIER. Each checked declaration that bears on the goal is written on its
   * product's node, so `run_analysis` can re-judge the leader it names on the graph it analysed.
   * The DECLARATION only (which nodes multiply, and whose reading it is) — never the verdict, which
   * depends on options a later edit can add. One per node: a second declaration on the same node is
   * still marked and said above, but only the first is carried. A model with no declaration gains
   * nothing, so a linear brief registers byte-identical.
   */
  const carriers = new Map<string, NonlinearIdentityCarrier>();
  for (const a of products.accepted) {
    if (!carriers.has(a.outcome_id)) {
      carriers.set(a.outcome_id, { operation: 'product', factor_ids: [...a.factor_ids], stated_in_brief: a.stated_in_brief });
    }
  }
  const admittedNodes = carriers.size === 0
    ? levers.nodes
    : levers.nodes.map((n) => (carriers.has(n.id) ? { ...n, nonlinear_identity: carriers.get(n.id)! } : n));

  return {
    nodes: admittedNodes,
    inference_classes,
    edges: finalEdges,
    ...(levers.demoted.length > 0 ? { treated_as_context: levers.demoted } : {}),
    ...(products.marks.length > 0 ? { nonlinear_identities: products.marks } : {}),
    goal_constraints: constraintResult.constraints,
    loss,
    // `withheld` is a list of LINKS by contract; a withheld NODE is reported
    // through `loss`, which is the channel the build result already surfaces.
    withheld: [...unresolved, ...linkResult.withheld, ...loopWithheld],
  };
}
