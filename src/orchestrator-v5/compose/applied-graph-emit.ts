/**
 * V5 applied-graph wire-emit helper (F2-CEE — applied edits must return a
 * graph payload).
 *
 * Diagnosis (1.16 run-3 + DB probe): the edit_graph apply family (the normal
 * edit_graph apply in edit-graph-dispatch.ts and the GM held-consent apply in
 * turn-executor.ts `commitGmHeldResume`) committed the post-mutation graph to
 * `scenarios.graph` but shipped a wire response with `blocks: []` and NO graph
 * payload, on the assumption that the UI re-reads `scenarios.graph`. The UI
 * never does: its only inline-graph ingestion path is the top-level
 * `draft_graph` field (`adaptDraftResponse` / `applyDraftResult`, CEE v0.8.0+
 * contract), and its DB re-fetch is gated to the draft flow. Result: applied
 * server edits were invisible on the canvas until a full reload.
 *
 * Fix: populate the EXISTING `draft_graph` wire field (OlumiResponseSchema
 * 0.8.0+, unchanged in the pinned 0.15.0 — no new wire fields) on applied-edit
 * responses, with EXACTLY the shape the draft path emits
 * (draft-graph-dispatch.ts `draftGraphField`): `nodes`, `edges`, and
 * authoritative `node_count` / `edge_count` derived from the same graph.
 *
 * Callers MUST pass the graph view whose nodes/edges are identical to what was
 * durably committed this turn (edit_graph: `editResult.appliedGraph`; GM held
 * consent: `outcome.appliedGraph`) and MUST attach the field only AFTER the
 * commit succeeded — a failed commit must never advertise unpersisted state.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

import type { GraphV3T } from '../../schemas/cee-v3.js';

/** The top-level `draft_graph` wire field (DraftGraphBlockSchema minus `type`). */
export type AppliedGraphWireField = NonNullable<OlumiResponse['draft_graph']>;

/**
 * Build the `draft_graph` wire field from the applied post-mutation graph.
 * Mirrors the draft path's `draftGraphField` construction byte-for-byte in
 * shape: permissive node/edge arrays plus counts from the SAME graph.
 */
export function buildAppliedGraphWireField(graph: GraphV3T): AppliedGraphWireField {
  return {
    nodes: graph.nodes as unknown[],
    edges: graph.edges as unknown[],
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
  };
}
