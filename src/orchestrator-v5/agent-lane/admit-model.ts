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
import type { InterventionV3T } from '../../schemas/cee-v3.js';
import { DEFAULT_EXISTS_PROBABILITY, STRENGTH_DEFAULT_SIGNATURE } from '@talchain/schemas';
import { labelMatchesBaseline } from '../../cee/transforms/analysis-ready.js';
import { readIsBaseline } from '../../cee/baseline-identity.js';
import { REPAIR_AUTHORED_ORIGIN } from '../../graph/repair-authored-edge.js';
import { isPercentScaledUnit } from '../../cee/draft/records/unit-scale-class.js';
import { CONNECTIVITY_REPAIR_WIRING_REASON } from '../../cee/unified-pipeline/stages/repair/status-quo-fix.js';
import { admitCandidateLinks, type CandidateLink, type AdmittedEdge } from './admit-candidate.js';
import {
  admitCandidateConstraints,
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
 * ⚠ CARRIED IN CONSTRUCTION ONLY. NodeV3 declares no field for it and the leader permission
 * is written only in `run-analysis.ts`, so this mark cannot yet reach
 * `analysis_state.leader_claim` — a named handoff, not an omission.
 */
export type NonlinearIdentityVerdict = 'sign_not_provable' | 'sign_stable_provisional';
export interface NonlinearIdentityMark {
  readonly outcome_id: string;
  readonly operation: 'product';
  readonly factor_ids: readonly string[];
  readonly verdict: NonlinearIdentityVerdict;
  /**
   * Every option the verdict rests on, by node id, in model order: one that can move the inputs
   * apart on its own (against carrying on as now), or one in a comparison below. Empty when stable.
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
  readonly withheld: readonly { from: string; to: string; reason: string; detail: string }[];
  /** Factors the model called controllable that no option changes — held as context (demoteUnreachedLevers). */
  readonly treated_as_context?: readonly string[];
  /** Declared products that options move (`markProductIdentities`); each is also a `loss` entry. */
  readonly nonlinear_identities?: readonly NonlinearIdentityMark[];
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
 *    does not state (said as that, item b) — NOT provable (conservative).
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
 * that is not a declared factor, reaches no declared factor, and is not the product's carrier (the
 * one cause every factor's route runs through) — is only PART of that quantity, and is said so. A
 * cause a factor drives is still an addend (item c).
 */
function markProductIdentities(
  declared: readonly CandidateIdentity[],
  resolve: (label: string) => string | undefined,
  nodes: readonly AdmittedNode[],
  edges: readonly { from: string; to: string; effect_direction?: string; origin?: string }[],
  goalId: string | undefined,
  declaredStatusQuo: ReadonlySet<string> = new Set(),
): { marks: NonlinearIdentityMark[]; loss: RepairEntry[] } {
  const marks: NonlinearIdentityMark[] = [];
  const loss: RepairEntry[] = [];
  if (declared.length === 0) return { marks, loss };
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

    /**
     * N-c, re-verification of d2362e9d (item c): an ADDEND is a direct cause of the outcome that is not
     * a declared factor, feeds no declared factor, and is not the product's CARRIER (the one cause every
     * factor's route to the outcome runs through: price, subscribers -> Pro MRR -> MRR). A cause a
     * factor DRIVES is still an addend (Pro subscribers -> Non-Pro MRR -> MRR): the old descendant arm
     * ("a factor reaches it") counted it as part of the product and said "the whole of MRR".
     */
    const addends = [...new Set(edges.filter((e) => e.to === outcomeId).map((e) => e.from))].filter((p) => {
      const k = kindOf.get(p);
      if (k === 'decision' || k === 'option' || factorIds.includes(p)) return false;
      if (factorIds.some((f) => pathSigns(p, f, outcomeId).size > 0)) return false;
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

    const selfNotStable: { id: string; how: 'opposite' | 'separate' }[] = [];
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
    const aroundIds = moving.filter((m) => m.around && paired.has(m.id)).map((m) => m.id);
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
    loss.push({
      field_path: `nodes[${outcomeId}].nonlinear_identity`,
      before: { operation: 'product', factor_ids: factorIds },
      after: { verdict, options_not_sign_stable: notStable, comparisons_not_sign_stable: pairs },
      reason: verdict === 'sign_not_provable'
        ? `${head}, but Olumi's analysis cannot yet multiply quantities: it adds up each effect separately.` +
          oppositeSentence + separateSentence + differSentence + aroundSentence +
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
  return { marks, loss };
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

export function admitCandidateModel(
  candidateModel: CandidateModel,
  widened: WidenerAdditions = {},
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
  const constraintResult = admitCandidateConstraints(model.constraints, (metric) => {
    const exact = ids.get(metric);
    if (exact !== undefined) return exact;
    // Fall back to a case-insensitive label match; never a fuzzy guess.
    const wanted = metric.trim().toLowerCase();
    for (const [label, id] of ids) if (label.trim().toLowerCase() === wanted) return id;
    return undefined;
  });

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
  const riskRepairs: AdmittedEdge[] = [];
  let finalEdges = allEdges;

  if (goalForReach !== undefined) {
    const hasOutgoingNow = new Set(allEdges.map((e) => e.from));
    // A risk whose own link was withheld as direction-unknown was answered
    // "I cannot say which way" — not left unconnected.
    const directionDeclined = new Set(linkResult.withheld.map((w) => w.from));
    for (const r of nodes.filter((n) => n.kind === 'risk' && !hasOutgoingNow.has(n.id) && !directionDeclined.has(n.id))) {
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
          `The risk "${r.label}" was named but never connected to anything, which stops the whole ` +
          `model being analysed. It has been connected to "${goalForReach.label}" as a negative ` +
          'influence, with a placeholder strength — that link follows from it being a risk, not ' +
          'from anything you said, and neither it nor its strength is a measurement.',
        severity: 'warn',
      } as RepairEntry);
    }

    const edgesNow = [...allEdges, ...riskRepairs];
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

  return {
    nodes: levers.nodes,
    inference_classes,
    edges: finalEdges,
    ...(levers.demoted.length > 0 ? { treated_as_context: levers.demoted } : {}),
    ...(products.marks.length > 0 ? { nonlinear_identities: products.marks } : {}),
    goal_constraints: constraintResult.constraints,
    loss,
    // `withheld` is a list of LINKS by contract; a withheld NODE is reported
    // through `loss`, which is the channel the build result already surfaces.
    withheld: [...unresolved, ...linkResult.withheld],
  };
}
