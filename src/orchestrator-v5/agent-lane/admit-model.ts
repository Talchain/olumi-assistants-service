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
import { CEE_GOAL_THRESHOLD_FRAME } from '../../utils/goal-threshold-cap.js';
import { admitCandidateLinks, type CandidateLink, type AdmittedEdge } from './admit-candidate.js';
import {
  admitCandidateConstraints,
  type CandidateConstraint,
  type AdmittedConstraint,
} from './admit-constraint.js';

const MAX_ID = 100;
const MAX_LABEL = 200;

export type CandidateNodeKind = 'goal' | 'option' | 'factor' | 'risk' | 'outcome' | 'constraint';

export interface CandidateModel {
  readonly goal: { metric: string; operator: string; value: number; unit: string; horizon_months: number | null; provenance: string };
  readonly constraints: readonly CandidateConstraint[];
  readonly options: readonly { label: string; provenance: string }[];
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
   * `reasoning` carries the inference CLASS. `source` alone cannot: `inferred`
   * (the builder's reading of the brief) and `ai_proposed` (the widener's
   * addition beyond it) both map to `cee_hypothesis`, and W3 has to score
   * unsupported inference. They are NOT split across `source` values because
   * `domain_knowledge` is absent from the narrower enums in
   * `src/schemas/analysis-ready.ts:41` and `cee-v3.ts:560,:590`, so stamping it
   * would risk a cross-schema validation failure for a cosmetic gain.
   */
  provenance?: { source: string; reasoning?: string };
}

export interface AdmittedModel {
  readonly nodes: readonly AdmittedNode[];
  readonly edges: readonly AdmittedEdge[];
  readonly goal_constraints: readonly AdmittedConstraint[];
  readonly loss: readonly RepairEntry[];
  readonly withheld: readonly { from: string; to: string; reason: string; detail: string }[];
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
const sourceFor = (provenance: string): string =>
  provenance === 'explicit' ? 'brief_extraction' : 'cee_hypothesis';

/** The inference class, preserved where `source` cannot express it. */
const reasoningFor = (provenance: string): string => {
  if (provenance === 'explicit') return 'Stated in the brief by the user.';
  if (provenance === 'ai_proposed') {
    return 'Added by the widening pass, beyond the brief. A proposal, not a fact.';
  }
  return 'Inferred from the brief by the faithful builder; not stated there.';
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
      node: {
        goal_threshold: model.goal.value,
        // A bare number is indistinguishable from a cost cap with no deadline.
        ...(model.goal.unit ? { goal_threshold_unit: model.goal.unit } : {}),
        goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME,
      },
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

  const ids = assignIds(entities.map((e) => e.label));
  const nodes: AdmittedNode[] = [];
  const seen = new Set<string>();
  for (const e of entities) {
    const id = ids.get(e.label)!;
    if (seen.has(id)) continue;
    seen.add(id);
    // A factor whose baseline is NOT known gets no observed_state at all —
    // an absent value is the honest record; a zero would be a measurement.
    nodes.push({
      id,
      kind: e.kind,
      label: e.label.slice(0, MAX_LABEL),
      provenance: { source: sourceFor(e.provenance), reasoning: reasoningFor(e.provenance) },
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

  const linkResult = admitCandidateLinks(resolvable);
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
    edges: linkResult.edges,
    goal_constraints: constraintResult.constraints,
    loss,
    withheld: [...unresolved, ...linkResult.withheld],
  };
}
