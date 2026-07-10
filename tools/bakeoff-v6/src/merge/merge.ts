/**
 * Deterministic arm-C merge — an M1 draft + M2 SUGGESTION OVERLAY.
 *
 * BENCHMARK CODE, NOT A MODEL. Every proposal lands in exactly one bucket —
 * applied, artifact, or a RECORDED failure. Nothing is silently dropped; an
 * invalid merge never crashes the run. Output key ordering is stable, so the
 * same inputs always produce byte-identical output.
 *
 * BY DESIGN, `applied` is ~0 and the merged graph ≈ the M1 draft: the M2
 * contract emits delta.node as {label, description} — "a suggestion for the
 * user, never an applied change" — which cannot satisfy NodeV3's required
 * id/kind, so node/edge proposals correctly land in the failure bucket and
 * question-type proposals in the artifact bucket. This is intentional and
 * ratified: arm-C is evaluated on SUGGESTION QUALITY (the proposals), never on
 * merge deltas. Do NOT read applied≈0 as a defect, and do NOT compare arm-C to
 * A/B on graph structure — the overlay leaves the structure ≈ the draft.
 */
import { NodeV3, EdgeV3, validateCandidate } from "../validate/validator.ts";
import { ProposalEnvelope, isArtifactType } from "./proposals.ts";
import type { DeferArtifact, MergeFailure, MergeReport } from "../types.ts";

interface GraphCandidate {
  schema_version?: string;
  nodes: Array<Record<string, unknown> & { id: string; kind: string; label: string }>;
  edges: Array<Record<string, unknown> & { from: string; to: string }>;
  // V3-egress shape only; the v8 LLM-boundary draft has NO top-level options[] /
  // goal_node_id (options are nodes with kind:"option"). Both are optional here so
  // the merge operates on either shape.
  options?: Array<Record<string, unknown> & { id: string; label: string }>;
  goal_node_id?: string;
  [key: string]: unknown;
}

export interface MergeOutcome {
  merged: unknown;
  report: MergeReport;
  artifacts: DeferArtifact[];
}

const ALLOWED_NODE_KINDS: Record<string, string[]> = {
  added_option: ["option"],
  added_risk: ["risk"],
  added_assumption: ["factor", "risk"],
};

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export function mergeProposals(m1Candidate: unknown, proposals: unknown[]): MergeOutcome {
  const failures: MergeFailure[] = [];
  const artifacts: DeferArtifact[] = [];
  let applied = 0;

  const base = structuredClone(m1Candidate) as GraphCandidate;
  const nodeIds = new Set(base.nodes.map((n) => n.id));
  const nodeLabels = new Set(base.nodes.map((n) => normalizeLabel(n.label)));
  const edgePairs = new Set(base.edges.map((e) => `${e.from}→${e.to}`));
  // Option ids come from the NODES (kind:"option") — the authoritative source in the
  // v8 draft, and equivalent to base.options[] in the V3 shape. Never deref base.options
  // directly: it is absent on v8 drafts and dereferencing it threw on every live arm-C run.
  const optionIds = new Set(base.nodes.filter((n) => n.kind === "option").map((n) => n.id));

  const fail = (index: number, type: string | null, reason: string) => {
    failures.push({ proposal_index: index, proposal_type: type, reason });
  };

  proposals.forEach((raw, index) => {
    const envelope = ProposalEnvelope.safeParse(raw);
    if (!envelope.success) {
      const type =
        raw !== null && typeof raw === "object" && typeof (raw as { type?: unknown }).type === "string"
          ? String((raw as { type: string }).type)
          : null;
      fail(index, type, `malformed proposal: ${envelope.error.issues[0]?.message ?? "invalid shape"}`);
      return;
    }
    const proposal = envelope.data;

    if (isArtifactType(proposal.type)) {
      if (proposal.delta.node != null || proposal.delta.edge != null) {
        fail(index, proposal.type, "artifact proposal must not carry node/edge deltas");
        return;
      }
      const question = proposal.delta.question?.trim() ?? "";
      if (question.length === 0) {
        fail(index, proposal.type, "artifact proposal must state its question/gap");
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

    // Mutating proposal — validate payloads against the REAL contract schemas.
    let nodeToAdd: (Record<string, unknown> & { id: string; kind: string; label: string }) | null = null;
    if (proposal.type !== "added_causal_link") {
      if (proposal.delta.node == null) {
        fail(index, proposal.type, "node proposal missing delta.node");
        return;
      }
      const nodeParse = NodeV3.safeParse(proposal.delta.node);
      if (!nodeParse.success) {
        fail(index, proposal.type, `delta.node fails NodeV3: ${nodeParse.error.issues[0]?.message}`);
        return;
      }
      const node = nodeParse.data as typeof nodeParse.data & Record<string, unknown>;
      const allowedKinds = ALLOWED_NODE_KINDS[proposal.type] ?? [];
      if (!allowedKinds.includes(node.kind)) {
        fail(index, proposal.type, `node kind "${node.kind}" not allowed for ${proposal.type} (allowed: ${allowedKinds.join(", ")})`);
        return;
      }
      if (nodeIds.has(node.id)) {
        fail(index, proposal.type, `duplicate node id "${node.id}"`);
        return;
      }
      if (nodeLabels.has(normalizeLabel(node.label))) {
        fail(index, proposal.type, `duplicate node label "${node.label}"`);
        return;
      }
      nodeToAdd = node;
    } else if (proposal.delta.edge == null) {
      fail(index, proposal.type, "added_causal_link missing delta.edge");
      return;
    }

    let edgeToAdd: (Record<string, unknown> & { from: string; to: string }) | null = null;
    if (proposal.delta.edge != null) {
      const edgeParse = EdgeV3.safeParse(proposal.delta.edge);
      if (!edgeParse.success) {
        fail(index, proposal.type, `delta.edge fails EdgeV3: ${edgeParse.error.issues[0]?.message}`);
        return;
      }
      const edge = edgeParse.data as typeof edgeParse.data & Record<string, unknown>;
      const knownWithProposal = (id: string) => nodeIds.has(id) || (nodeToAdd !== null && nodeToAdd.id === id);
      if (!knownWithProposal(edge.from) || !knownWithProposal(edge.to)) {
        fail(index, proposal.type, `edge endpoint missing from graph: ${edge.from}→${edge.to}`);
        return;
      }
      if (edgePairs.has(`${edge.from}→${edge.to}`)) {
        fail(index, proposal.type, `duplicate edge ${edge.from}→${edge.to}`);
        return;
      }
      const meanSign = edge.strength.mean >= 0 ? "positive" : "negative";
      if (edge.effect_direction !== meanSign) {
        fail(index, proposal.type, `effect_direction "${edge.effect_direction}" inconsistent with strength.mean ${edge.strength.mean}`);
        return;
      }
      edgeToAdd = edge;
    }

    // All checks passed — apply atomically.
    if (nodeToAdd) {
      base.nodes.push(nodeToAdd);
      nodeIds.add(nodeToAdd.id);
      nodeLabels.add(normalizeLabel(nodeToAdd.label));
      if (proposal.type === "added_option" && !optionIds.has(nodeToAdd.id)) {
        // The option NODE is already pushed above (base.nodes). Only mirror it into a
        // top-level options[] when that V3-shape array exists; v8 drafts have none.
        if (Array.isArray(base.options)) {
          base.options.push({
            id: nodeToAdd.id,
            label: nodeToAdd.label,
            status: "needs_user_mapping",
            interventions: {},
          });
        }
        optionIds.add(nodeToAdd.id);
      }
    }
    if (edgeToAdd) {
      base.edges.push(edgeToAdd);
      edgePairs.add(`${edgeToAdd.from}→${edgeToAdd.to}`);
    }
    applied++;
  });

  const postMerge = validateCandidate(base);

  return {
    merged: base,
    report: {
      proposals_total: proposals.length,
      applied,
      artifacts: artifacts.length,
      failures,
      post_merge_valid: postMerge.valid,
      post_merge_errors: postMerge.errors,
    },
    artifacts,
  };
}
