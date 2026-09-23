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
import { STRUCTURAL_EDGE_DEFAULTS } from '../../orchestrator/context/constants.js';
import { DEFAULT_EXISTS_PROBABILITY, STRENGTH_DEFAULT_SIGNATURE } from '@talchain/schemas';
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
  readonly goal: { metric: string; operator: string; value: number; unit: string; horizon_months: number | null; provenance: string };
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
  }[];
  readonly factors: readonly { label: string; role: 'controllable' | 'observable' | 'external'; baseline_known: boolean; baseline_value: number | null; unit: string | null; provenance: string; plausible_max?: number | null }[];
  readonly risks: readonly { label: string; provenance: string }[];
  readonly outcomes: readonly { label: string; provenance: string }[];
  readonly links: readonly CandidateLink[];
}

export interface WidenerAdditions {
  readonly proposed_options?: readonly { label: string }[];
  readonly proposed_factors?: readonly { label: string }[];
  readonly proposed_risks?: readonly { label: string }[];
  readonly proposed_outcomes?: readonly { label: string }[];
  readonly proposed_links?: readonly CandidateLink[];
}

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
  interventions?: Record<string, { value: number }>;
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
  observed_state?: { value: number; unit?: string; source?: string; raw_value?: number; cap?: number; declared_scale?: string };
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
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 1 || raw <= 0 || raw > cap) {
    return { value: raw, ...base };
  }
  return { value: raw / cap, raw_value: raw, cap, declared_scale: 'unit_interval', ...base };
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

export function admitCandidateModel(
  model: CandidateModel,
  widened: WidenerAdditions = {},
): AdmittedModel {

  /**
   * The scale frame for each factor, keyed by LABEL because it must be known
   * before the nodes are built — the baseline is normalised as the node is
   * created. The builder's stated range wins; anything left without one gets a
   * frame DERIVED from the largest figure the model already carries for it,
   * recorded below as defaulted.
   */
  const capByLabel = new Map<string, number>();
  const largestByLabel = new Map<string, number>();
  const noteMagnitude = (label: string, v: unknown): void => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    largestByLabel.set(label, Math.max(largestByLabel.get(label) ?? 0, Math.abs(v)));
  };
  for (const f of model.factors) {
    if (typeof f.plausible_max === 'number' && Number.isFinite(f.plausible_max) && f.plausible_max > 1) {
      capByLabel.set(f.label, f.plausible_max);
    }
    if (f.baseline_known) noteMagnitude(f.label, f.baseline_value);
  }
  for (const o of model.options) {
    for (const iv of o.interventions ?? []) noteMagnitude(iv.factor_label, iv.value);
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
        const raw = model.goal.value;
        const resolved = resolveGoalThresholdCapWithProvenance(
          undefined, raw, model.goal.unit, undefined,
        );
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
        ...((): Record<string, number> => {
          if (f.baseline_known && typeof f.baseline_value === 'number') return {};
          const c = capFor(f.label) ?? f.plausible_max;
          return typeof c === 'number' && Number.isFinite(c) && c > 1 ? { scale_frame: c } : {};
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
    // A factor whose baseline is NOT known gets no observed_state at all —
    // an absent value is the honest record; a zero would be a measurement.
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
  const interventionsByOption = new Map<string, Record<string, { value: number }>>();
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
    loss.push({
      field_path: `nodes[${ids.get(d.label) ?? d.label}].observed_state.cap`,
      before: null,
      after: d.frame,
      reason:
        `No range was stated for "${d.label}", and a number above 1 with no range cannot be analysed ` +
        `at all \u2014 nor can a range be added afterwards. A range of 0 to ${d.frame} has been used, taken ` +
        'from the largest figure the model already holds for it. That is a unit of measurement, not a ' +
        'forecast or a limit, and your own figures are stored unchanged beside it.',
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
    const bundle: Record<string, { value: number }> = {};
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
      const cap = capByFactorId.get(factorId);
      // Only when the level genuinely sits inside the declared range. A level
      // outside it is left exactly as stated and the mismatch is recorded —
      // silently clamping a user's number would be the worse failure.
      if (cap !== undefined && iv.value >= 0 && iv.value <= cap) {
        bundle[factorId] = { value: iv.value / cap };
      } else {
        if (cap !== undefined) {
          loss.push({
            field_path: `nodes[${optionId}].interventions.${factorId}`,
            before: iv.value,
            after: iv.value,
            reason:
              `"${o.label}" sets "${iv.factor_label}" to ${iv.value}, which is outside the range ` +
              `0 to ${cap} the model states for that factor. It has been kept exactly as stated ` +
              'rather than squeezed into the range — say so, and correct either the level or the range.',
            severity: 'warn',
          } as RepairEntry);
        }
        bundle[factorId] = { value: iv.value };
      }
      actsOn.add(factorId);
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
  const causalEdges = linkResult.edges.filter((e) => !duplicatePairs.has(`${e.from}::${e.to}`));
  const causalLoss = linkResult.loss.filter((l) => {
    const m = /^edges\[(.+?)\]\./.exec(String(l.field_path ?? ''));
    return m === null || !duplicatePairs.has(m[1]!);
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
   * ⛔ AN ORPHANED GOAL MAKES THE WHOLE MODEL UNANALYSABLE, and it is invisible
   * in every count. Measured twice on real briefs: a goal metric "Productivity
   * change" while every causal chain terminated on an invented near-synonym
   * outcome "Productivity Improvement" — 35 nodes, 40 edges, all healthy
   * looking, and 0 of 6 options able to reach the goal.
   *
   * The id-level dedupe above only merges IDENTICAL labels, deliberately:
   * merging "Productivity change" with "Productivity Improvement" by
   * similarity would be guessing, and guessing is the defect this lane exists
   * to avoid. So this does NOT rename or merge anything. It connects the
   * dangling terminal outcomes INTO the goal and RECORDS that it did, as a
   * projection the user is told about — an explicit, disclosed inference beats
   * a model that silently cannot be analysed.
   *
   * It fires only when the goal has no incoming edge at all. If the model
   * connected the goal properly, nothing here runs.
   */
  const allEdges = [...topologyEdges, ...causalEdges];
  const goalNode = nodes.find((n) => n.kind === 'goal');
  const repaired: AdmittedEdge[] = [];
  if (goalNode !== undefined && !allEdges.some((e) => e.to === goalNode.id)) {
    const hasOutgoing = new Set(allEdges.map((e) => e.from));
    const hasIncoming = new Set(allEdges.map((e) => e.to));
    // Terminal outcomes: something feeds them, nothing leaves them. Those are
    // where the model's own causal chains actually end.
    const terminals = nodes.filter(
      (n) => n.kind === 'outcome' && hasIncoming.has(n.id) && !hasOutgoing.has(n.id),
    );
    for (const t of terminals) {
      repaired.push({
        from: t.id,
        to: goalNode.id,
        effect_direction: 'positive',
        strength: { mean: STRENGTH_DEFAULT_SIGNATURE.mean, std: STRENGTH_DEFAULT_SIGNATURE.std },
        exists_probability: DEFAULT_EXISTS_PROBABILITY,
        defaulted: true,
      } as AdmittedEdge);
      loss.push({
        field_path: `edges[${t.id}->${goalNode.id}]`,
        before: null,
        after: 'connected',
        reason:
          `Nothing the model produced reached the goal "${goalNode.label}", so it could not be ` +
          `analysed at all. "${t.label}" is where its causal chains actually end, so it has been ` +
          'connected to the goal as an ASSUMPTION, with a placeholder strength. Neither the link ' +
          'nor its strength came from you or from the brief — say so, and correct it if the two ' +
          'are not the same thing.',
        severity: 'warn',
      } as RepairEntry);
    }
  }

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
   *    goal, so the link is entailed by the node's own kind. Same move the
   *    terminal-outcome repair above already makes, and disclosed the same way.
   * 2. Anything that STILL cannot reach the goal is withheld from the admitted
   *    graph and named in `loss`, because there is no non-guessing repair for
   *    it — and a model nobody can analyse is worse than a model that says
   *    plainly which pieces it could not wire in.
   *
   * Measured effect of exactly this, on exactly that model: 17 of 20 nodes
   * retained (every risk kept), structural blockers 5 -> 0.
   */
  const withRepairs = [...allEdges, ...repaired];
  const goalForReach = nodes.find((n) => n.kind === 'goal');
  const riskRepairs: AdmittedEdge[] = [];
  let finalEdges = withRepairs;

  if (goalForReach !== undefined) {
    const hasOutgoingNow = new Set(withRepairs.map((e) => e.from));
    for (const r of nodes.filter((n) => n.kind === 'risk' && !hasOutgoingNow.has(n.id))) {
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

    const edgesNow = [...withRepairs, ...riskRepairs];
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

  return {
    nodes,
    inference_classes,
    edges: finalEdges,
    goal_constraints: constraintResult.constraints,
    loss,
    // `withheld` is a list of LINKS by contract; a withheld NODE is reported
    // through `loss`, which is the channel the build result already surfaces.
    withheld: [...unresolved, ...linkResult.withheld],
  };
}
