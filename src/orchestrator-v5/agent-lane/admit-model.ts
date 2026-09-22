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
  }[];
  readonly factors: readonly { label: string; role: 'controllable' | 'observable' | 'external'; baseline_known: boolean; baseline_value: number | null; unit: string | null; provenance: string }[];
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
  observed_state?: { value: number; unit?: string; source?: string };
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

/** Deterministic, collision-safe id assignment in a fixed traversal order. */
function assignIds(labels: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const label of labels) {
    if (out.has(label)) continue;
    const base = slugId(label);
    let id = base;
    let n = 2;
    while (used.has(id)) {
      const suffix = `_${n++}`;
      id = base.slice(0, MAX_ID - suffix.length) + suffix;
    }
    used.add(id);
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

export function admitCandidateModel(
  model: CandidateModel,
  widened: WidenerAdditions = {},
): AdmittedModel {
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
          ? {
              observed_state: {
                value: f.baseline_value,
                ...(f.unit ? { unit: f.unit } : {}),
                ...(f.provenance === 'explicit' ? { source: 'brief_extraction' } : {}),
              },
            }
          : {}),
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
  for (const o of model.options) {
    const optionId = ids.get(o.label);
    if (optionId === undefined) continue;
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
      bundle[factorId] = { value: iv.value };
    }
    if (Object.keys(bundle).length > 0) interventionsByOption.set(optionId, bundle);
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
      Object.keys(o.interventions ?? {}).map((factorId) => topo(o.id, factorId)),
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

  loss.push(...linkResult.loss, ...constraintResult.loss);

  return {
    nodes,
    inference_classes,
    edges: [...topologyEdges, ...linkResult.edges],
    goal_constraints: constraintResult.constraints,
    loss,
    withheld: [...unresolved, ...linkResult.withheld],
  };
}
