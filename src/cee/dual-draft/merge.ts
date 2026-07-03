/**
 * V6 dual-draft deterministic merge.
 *
 * Ported from the bake-off arm-C merge and adapted to the live GraphV3 seam:
 *   source:  tools/bakeoff-v6/src/merge/merge.ts
 *   branch:  claude/bakeoff-v6-platform @ 5af022c87 (byte-identical to 373479c36)
 *   sha256:  9c9e6adbe4220adda6e64b0ad85d807e5e6520b2c06c298dfd8dca89f8685302
 *
 * Live adaptations (vs the bake-off source):
 *   - operates on GraphV3T ({nodes, edges, goal_constraints?}) — the persisted
 *     seam has NO top-level options[] (that lives on CEEGraphResponseV3), so
 *     the bake-off's options-append has no target here;
 *   - D1 policy: `added_option` becomes a DEFER ARTIFACT, never a mutation —
 *     a value-less option would flip a ready draft away from immediate
 *     analysis, and inventing intervention values is prohibited;
 *   - proposal cap (G5), engine-boundary claim scan (G14), node/edge field
 *     allowlists + numeric sanity bounds (G10), graph caps (G11), option/
 *     decision endpoint restriction + self-loop + cycle rejection (analysis-
 *     readiness protection), all as coded failure reasons;
 *   - post-merge re-validation against the REAL GraphV3 schema.
 *
 * Invariants (pinned by __tests__/merge.test.ts):
 *   - every proposal lands in EXACTLY one bucket: applied | artifact | failure;
 *   - nothing is silently dropped; the merge never throws on hostile input;
 *   - the input graph is never mutated; same inputs → deep-equal outputs.
 */
import { GraphV3, NodeV3, EdgeV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from '../../config/graphCaps.js';
import { ProposalEnvelope, isArtifactType, PROPOSAL_CAP } from './proposals.js';
import {
  findAnalysisClaim,
  checkEdgeNumericSanity,
  findForbiddenProposalField,
  findOversizedProposalField,
  ALLOWED_NODE_DELTA_FIELDS,
  ALLOWED_EDGE_DELTA_FIELDS,
} from './guards.js';

export type MergeFailureCode =
  | 'proposal_cap_exceeded'
  | 'malformed_proposal'
  | 'engine_boundary_violation'
  | 'proposal_field_too_large'
  | 'artifact_carries_delta'
  | 'artifact_missing_question'
  | 'option_missing_label'
  | 'node_missing'
  | 'node_schema_invalid'
  | 'forbidden_node_field'
  | 'kind_not_allowed'
  | 'duplicate_node_id'
  | 'duplicate_node_label'
  | 'edge_missing'
  | 'edge_schema_invalid'
  | 'forbidden_edge_field'
  | 'edge_numeric_bounds'
  | 'edge_endpoint_missing'
  | 'edge_endpoint_restricted'
  | 'edge_self_loop'
  | 'edge_creates_cycle'
  | 'duplicate_edge'
  | 'effect_direction_inconsistent'
  | 'graph_cap_exceeded';

export interface MergeFailure {
  readonly proposal_index: number;
  readonly proposal_type: string | null;
  readonly reason_code: MergeFailureCode;
  readonly reason: string;
}

export interface DeferArtifact {
  readonly type: string;
  readonly question: string;
  readonly rationale: string | null;
  readonly evidence_pointer: string;
}

export interface MergeReport {
  readonly proposals_total: number;
  readonly applied: number;
  readonly artifacts: number;
  readonly failures: readonly MergeFailure[];
  readonly post_merge_valid: boolean;
  readonly post_merge_errors: readonly string[];
}

export interface MergeOutcome {
  readonly merged: GraphV3T;
  readonly report: MergeReport;
  readonly artifacts: readonly DeferArtifact[];
}

// Mutating node kinds per proposal type. `added_option` is deliberately
// absent — D1 policy converts it to a defer artifact before this map is
// consulted. `added_causal_link` carries no node.
const ALLOWED_NODE_KINDS: Record<string, readonly string[]> = {
  added_risk: ['risk'],
  added_assumption: ['factor', 'risk'],
};

// Node kinds a proposed edge may touch. Option and decision nodes carry the
// engine's intervention structure — an M2 edge on them could silently change
// an existing option's readiness, so they are closed to the reviewer.
const RESTRICTED_ENDPOINT_KINDS = new Set(['option', 'decision']);

function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * True iff `to` can already reach `from` via directed edges (adding from→to
 * would close a cycle). Bidirected edges (unmeasured confounders) are skipped
 * — they are not directed causal paths and cannot form cycles, mirroring the
 * canonical detectCycles/isDAG semantics (src/utils/graphGuards.ts via
 * isDirectedEdge in src/schemas/graph.ts).
 */
function wouldCreateCycle(
  edges: ReadonlyArray<{ from: string; to: string; edge_type?: string }>,
  from: string,
  to: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (e.edge_type === 'bidirected') continue;
    const list = adjacency.get(e.from);
    if (list) list.push(e.to);
    else adjacency.set(e.from, [e.to]);
  }
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

export function mergeProposals(m1Graph: GraphV3T, proposals: readonly unknown[]): MergeOutcome {
  const failures: MergeFailure[] = [];
  const artifacts: DeferArtifact[] = [];
  let applied = 0;

  const base = structuredClone(m1Graph) as GraphV3T;
  const nodeIds = new Set(base.nodes.map((n) => n.id));
  const nodeLabels = new Set(base.nodes.map((n) => normaliseLabel(n.label)));
  const edgePairs = new Set(base.edges.map((e) => `${e.from}→${e.to}`));
  const kindById = new Map(base.nodes.map((n) => [n.id, n.kind as string]));

  const fail = (index: number, type: string | null, code: MergeFailureCode, reason: string) => {
    failures.push({ proposal_index: index, proposal_type: type, reason_code: code, reason });
  };

  proposals.forEach((raw, index) => {
    const rawType =
      raw !== null && typeof raw === 'object' && typeof (raw as { type?: unknown }).type === 'string'
        ? String((raw as { type: string }).type)
        : null;

    // G5 — proposal cap. Checked first so an over-long batch is accounted
    // deterministically regardless of the tail's validity.
    if (index >= PROPOSAL_CAP) {
      fail(index, rawType, 'proposal_cap_exceeded', `proposal index ${index} exceeds cap ${PROPOSAL_CAP}`);
      return;
    }

    const envelope = ProposalEnvelope.safeParse(raw);
    if (!envelope.success) {
      fail(
        index,
        rawType,
        'malformed_proposal',
        `malformed proposal: ${envelope.error.issues[0]?.message ?? 'invalid shape'}`,
      );
      return;
    }
    const proposal = envelope.data;

    // G14 — engine-boundary claim scan across every free-text channel,
    // including proposed labels/descriptions and the allowlisted
    // uncertainty_drivers string array (all canvas-visible if applied).
    const rawNode = (proposal.delta.node ?? null) as Record<string, unknown> | null;
    const rawDrivers = Array.isArray(rawNode?.uncertainty_drivers)
      ? (rawNode.uncertainty_drivers as unknown[]).filter((d): d is string => typeof d === 'string')
      : [];
    const claim = findAnalysisClaim(
      proposal.evidence_pointer,
      proposal.rationale,
      proposal.delta.question,
      typeof rawNode?.label === 'string' ? (rawNode.label as string) : null,
      typeof rawNode?.description === 'string' ? (rawNode.description as string) : null,
      ...rawDrivers,
    );
    if (claim !== null) {
      fail(index, proposal.type, 'engine_boundary_violation', `engine-owned analysis claim (${claim}) in proposal text`);
      return;
    }

    // G-size — per-proposal text-size caps. THE authoritative enforcement point
    // (the JSON schema only fences the model, which may ignore maxLength).
    // Rejected INDIVIDUALLY (never truncated: a clipped label would silently
    // alter M2's committed content) so one oversized proposal cannot collapse a
    // batch of otherwise-valid ones — symmetric with the G14 scan above and
    // applied before the artifact/option/node branches so every text channel
    // (envelope + node) is covered uniformly.
    const oversized = findOversizedProposalField(proposal);
    if (oversized !== null) {
      fail(
        index,
        proposal.type,
        'proposal_field_too_large',
        `proposal field "${oversized.field}" size ${oversized.length} exceeds cap ${oversized.cap}`,
      );
      return;
    }

    // Non-mutating defer artifacts.
    if (isArtifactType(proposal.type)) {
      if (proposal.delta.node != null || proposal.delta.edge != null) {
        fail(index, proposal.type, 'artifact_carries_delta', 'artifact proposal must not carry node/edge deltas');
        return;
      }
      const question = proposal.delta.question?.trim() ?? '';
      if (question.length === 0) {
        fail(index, proposal.type, 'artifact_missing_question', 'artifact proposal must state its question/gap');
        return;
      }
      artifacts.push({
        type: proposal.type,
        question,
        rationale: proposal.rationale ?? null,
        evidence_pointer: proposal.evidence_pointer,
      });
      return;
    }

    // D1 policy — added_option defers. A merged value-less option would flip
    // a ready draft to needs_user_mapping (killing immediate run_analysis),
    // and inventing intervention values is prohibited. First fast-follow
    // after the MVP is full option enrichment.
    if (proposal.type === 'added_option') {
      const label = typeof rawNode?.label === 'string' ? (rawNode.label as string).trim() : '';
      if (label.length === 0) {
        fail(index, proposal.type, 'option_missing_label', 'option proposal has no usable label to defer');
        return;
      }
      artifacts.push({
        type: 'added_option',
        question: `Consider an additional option: "${label}"`,
        rationale: proposal.rationale ?? null,
        evidence_pointer: proposal.evidence_pointer,
      });
      return;
    }

    // Mutating node proposals (added_risk / added_assumption).
    let nodeToAdd: GraphV3T['nodes'][number] | null = null;
    if (proposal.type !== 'added_causal_link') {
      if (proposal.delta.node == null) {
        fail(index, proposal.type, 'node_missing', 'node proposal missing delta.node');
        return;
      }
      const nodeParse = NodeV3.safeParse(proposal.delta.node);
      if (!nodeParse.success) {
        fail(index, proposal.type, 'node_schema_invalid', `delta.node fails NodeV3: ${nodeParse.error.issues[0]?.message}`);
        return;
      }
      const forbiddenField = findForbiddenProposalField(proposal.delta.node, ALLOWED_NODE_DELTA_FIELDS);
      if (forbiddenField !== null) {
        fail(index, proposal.type, 'forbidden_node_field', `node field "${forbiddenField}" is not proposable (value-bearing or pipeline-owned)`);
        return;
      }
      const node = nodeParse.data;
      const allowedKinds = ALLOWED_NODE_KINDS[proposal.type] ?? [];
      if (!allowedKinds.includes(node.kind)) {
        fail(index, proposal.type, 'kind_not_allowed', `node kind "${node.kind}" not allowed for ${proposal.type} (allowed: ${allowedKinds.join(', ')})`);
        return;
      }
      if (nodeIds.has(node.id)) {
        fail(index, proposal.type, 'duplicate_node_id', `duplicate node id "${node.id}"`);
        return;
      }
      if (nodeLabels.has(normaliseLabel(node.label))) {
        fail(index, proposal.type, 'duplicate_node_label', `duplicate node label "${node.label}"`);
        return;
      }
      nodeToAdd = node;
    } else if (proposal.delta.edge == null) {
      fail(index, proposal.type, 'edge_missing', 'added_causal_link missing delta.edge');
      return;
    }

    // Edge validation (required for added_causal_link; optional companion on
    // node proposals — an edge endpoint may be the proposal's own node).
    let edgeToAdd: GraphV3T['edges'][number] | null = null;
    if (proposal.delta.edge != null) {
      const edgeParse = EdgeV3.safeParse(proposal.delta.edge);
      if (!edgeParse.success) {
        fail(index, proposal.type, 'edge_schema_invalid', `delta.edge fails EdgeV3: ${edgeParse.error.issues[0]?.message}`);
        return;
      }
      const forbiddenEdgeField = findForbiddenProposalField(proposal.delta.edge, ALLOWED_EDGE_DELTA_FIELDS);
      if (forbiddenEdgeField !== null) {
        fail(index, proposal.type, 'forbidden_edge_field', `edge field "${forbiddenEdgeField}" is not proposable (pipeline-owned)`);
        return;
      }
      const edge = edgeParse.data;
      const numericIssue = checkEdgeNumericSanity(edge);
      if (numericIssue !== null) {
        fail(index, proposal.type, 'edge_numeric_bounds', numericIssue);
        return;
      }
      const kindOf = (id: string): string | undefined =>
        nodeToAdd !== null && nodeToAdd.id === id ? nodeToAdd.kind : kindById.get(id);
      const fromKind = kindOf(edge.from);
      const toKind = kindOf(edge.to);
      if (fromKind === undefined || toKind === undefined) {
        fail(index, proposal.type, 'edge_endpoint_missing', `edge endpoint missing from graph: ${edge.from}→${edge.to}`);
        return;
      }
      if (RESTRICTED_ENDPOINT_KINDS.has(fromKind) || RESTRICTED_ENDPOINT_KINDS.has(toKind)) {
        fail(index, proposal.type, 'edge_endpoint_restricted', `edge may not touch option/decision nodes: ${edge.from}→${edge.to}`);
        return;
      }
      if (edge.from === edge.to) {
        fail(index, proposal.type, 'edge_self_loop', `self-loop edge ${edge.from}→${edge.to}`);
        return;
      }
      if (edgePairs.has(`${edge.from}→${edge.to}`)) {
        fail(index, proposal.type, 'duplicate_edge', `duplicate edge ${edge.from}→${edge.to}`);
        return;
      }
      if (wouldCreateCycle(base.edges, edge.from, edge.to)) {
        fail(index, proposal.type, 'edge_creates_cycle', `edge ${edge.from}→${edge.to} would create a directed cycle`);
        return;
      }
      const meanSign = edge.strength.mean >= 0 ? 'positive' : 'negative';
      if (edge.effect_direction !== meanSign) {
        fail(index, proposal.type, 'effect_direction_inconsistent', `effect_direction "${edge.effect_direction}" inconsistent with strength.mean ${edge.strength.mean}`);
        return;
      }
      edgeToAdd = edge;
    }

    // G11 — graph caps, checked against the running (partially merged) counts
    // BEFORE applying, so the merged graph can never exceed the PLoT-aligned
    // limits the pipeline enforces for its own output.
    const nodeCountAfter = base.nodes.length + (nodeToAdd ? 1 : 0);
    const edgeCountAfter = base.edges.length + (edgeToAdd ? 1 : 0);
    if (nodeCountAfter > GRAPH_MAX_NODES || edgeCountAfter > GRAPH_MAX_EDGES) {
      fail(index, proposal.type, 'graph_cap_exceeded', `proposal would exceed graph caps (nodes ${nodeCountAfter}/${GRAPH_MAX_NODES}, edges ${edgeCountAfter}/${GRAPH_MAX_EDGES})`);
      return;
    }

    // All checks passed — apply atomically.
    if (nodeToAdd) {
      base.nodes.push(nodeToAdd);
      nodeIds.add(nodeToAdd.id);
      nodeLabels.add(normaliseLabel(nodeToAdd.label));
      kindById.set(nodeToAdd.id, nodeToAdd.kind);
    }
    if (edgeToAdd) {
      base.edges.push(edgeToAdd);
      edgePairs.add(`${edgeToAdd.from}→${edgeToAdd.to}`);
    }
    applied++;
  });

  // Post-merge re-validation against the REAL contract. The commit path
  // safeParses again independently — two deterministic gates before persist.
  const postMerge = GraphV3.safeParse(base);
  const postMergeErrors = postMerge.success
    ? []
    : postMerge.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

  return {
    merged: base,
    report: {
      proposals_total: proposals.length,
      applied,
      artifacts: artifacts.length,
      failures,
      post_merge_valid: postMerge.success,
      post_merge_errors: postMergeErrors,
    },
    artifacts,
  };
}
