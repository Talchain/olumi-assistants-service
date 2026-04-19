/**
 * V5 Phase 1.5 — HTTP boundary request extensions.
 *
 * `@talchain/schemas` v0.5.1 `OrchestratorTurnPayload` declares only the five
 * base fields (turn_id, scenario_id, message, turn_class, stage). The UI
 * actually sends `graph_state` and `analysis_state` on the same request body,
 * but they bypass B1 boundary validation because the base schema doesn't
 * mention them.
 *
 * This module adds a second, independent Zod parse over the same request body
 * — extracting `graph_state` + `analysis_state` with permissive content
 * schemas that match the ACTUAL wire shape (not the CEE response envelope).
 *
 * The contract:
 *   - Structural failures (missing id/kind/label on a node, missing from/to on
 *     an edge, missing analysis_status) → reject with a typed BoundaryError
 *     suitable for a 422 response.
 *   - Absent fields (no graph_state, no analysis_state, field = null) → pass
 *     through as null. Phase 1.5 accepts turns without graph (frame stage) and
 *     turns without analysis (pre-analysis decisions).
 *   - Unknown extra fields on nodes/edges/analysis objects → passthrough. The
 *     UI evolves faster than the boundary contract; we do not want to reject
 *     payloads because of additive fields.
 *
 * Shape decisions recorded in Docs/v5/phase1.5-wire-investigation.md and plan
 * corrections #1 (analysis schema loosened) and #2 (graph content, not CEE
 * response envelope).
 */

import { z } from 'zod';
import type { BoundaryError } from '@talchain/schemas/boundary';

import { emit, TelemetryEvents } from '../../utils/telemetry.js';

export const REQUEST_EXTENSIONS_VALIDATOR_NAME = 'V5RequestExtensions';

/**
 * Permissive graph content schema — matches what the UI actually sends on the
 * wire (`graph_state: { nodes, edges }`), not the CEE response envelope
 * (`CEEGraphResponseV3` with `schema_version`, `options`, `goal_node_id`).
 *
 * Required:
 *   - node: id, kind, label (everything the validator's GraphLookup needs)
 *   - edge: from, to (GraphLookup does not touch edges, but we reject
 *     structurally broken edges so downstream consumers don't have to)
 *
 * Passthrough elsewhere so `observed_state`, `strength`, `exists_probability`
 * et al. survive. The assembler passes nodes/edges through by reference.
 */
const NodeContentSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    label: z.string(),
  })
  .passthrough();

const EdgeContentSchema = z
  .object({
    from: z.string(),
    to: z.string(),
  })
  .passthrough();

export const GraphStateIngressSchema = z
  .object({
    nodes: z.array(NodeContentSchema),
    edges: z.array(EdgeContentSchema),
    options: z.array(z.unknown()).optional(),
    goal_node_id: z.string().optional(),
    goal_constraints: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Permissive analysis schema. Per plan correction #1: analysis arrives in
 * many shapes (complete, failed, partial, absent). Only `analysis_status`
 * is structurally required — everything else passthrough. `meta.response_hash`
 * is explicitly NOT required; a failed analysis may carry no meta at all.
 */
export const AnalysisStateIngressSchema = z
  .object({
    analysis_status: z.string(),
  })
  .passthrough();

/**
 * Types inferred directly from the Zod schemas above. Downstream consumers
 * (TurnExecutor, assembler, adapter) import these — nobody outside this
 * module should `as`-cast to GraphV3T / V2RunResponseEnvelope when carrying
 * an ingress payload, because those deeper types demand fields the wire
 * schema does not require.
 */
export type GraphStateIngress = z.infer<typeof GraphStateIngressSchema>;
export type AnalysisStateIngress = z.infer<typeof AnalysisStateIngressSchema>;

export type ParsedRequestExtensions = {
  graphState: GraphStateIngress | null;
  analysisState: AnalysisStateIngress | null;
};

export type ParseExtensionsResult =
  | { ok: true; value: ParsedRequestExtensions }
  | { ok: false; error: BoundaryError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimIssues(
  issues: z.ZodIssue[],
): Array<{ path: string; message: string; code: string }> {
  return issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
    code: i.code,
  }));
}

/**
 * Parse optional graph_state + analysis_state fields from a request body.
 * Absent/null fields return null (graceful). Structurally invalid fields
 * return a typed BoundaryError suitable for a 422 response.
 *
 * Does NOT re-validate the base B1 payload — call `validateIngress` first.
 */
export function parseRequestExtensions(
  body: unknown,
  requestId: string,
): ParseExtensionsResult {
  if (!isRecord(body)) {
    // Shouldn't happen after B1 ingress validation passed, but guard anyway.
    return {
      ok: true,
      value: { graphState: null, analysisState: null },
    };
  }

  const rawGraph = body.graph_state;
  const rawAnalysis = body.analysis_state;

  let graphState: GraphStateIngress | null = null;
  if (rawGraph !== undefined && rawGraph !== null) {
    const parsed = GraphStateIngressSchema.safeParse(rawGraph);
    if (!parsed.success) {
      emit(TelemetryEvents.BoundaryValidation, {
        boundary: 'B1',
        direction: 'ingress',
        validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
        contract_version: '1.5.0',
        pass: false,
        request_id: requestId,
        field: 'graph_state',
      });
      return {
        ok: false,
        error: {
          error: 'INGRESS_CONTRACT_VIOLATION',
          boundary: 'B1',
          direction: 'ingress',
          validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
          details: {
            field: 'graph_state',
            issues: trimIssues(parsed.error.issues),
          },
          request_id: requestId,
          retryable: false,
        },
      };
    }
    graphState = parsed.data;
  }

  let analysisState: AnalysisStateIngress | null = null;
  if (rawAnalysis !== undefined && rawAnalysis !== null) {
    const parsed = AnalysisStateIngressSchema.safeParse(rawAnalysis);
    if (!parsed.success) {
      emit(TelemetryEvents.BoundaryValidation, {
        boundary: 'B1',
        direction: 'ingress',
        validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
        contract_version: '1.5.0',
        pass: false,
        request_id: requestId,
        field: 'analysis_state',
      });
      return {
        ok: false,
        error: {
          error: 'INGRESS_CONTRACT_VIOLATION',
          boundary: 'B1',
          direction: 'ingress',
          validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
          details: {
            field: 'analysis_state',
            issues: trimIssues(parsed.error.issues),
          },
          request_id: requestId,
          retryable: false,
        },
      };
    }
    analysisState = parsed.data;
  }

  // Emit a success event only when at least one extension field was actually
  // validated. This keeps the telemetry trace aligned with what happened:
  // a body with no graph_state / analysis_state has nothing for this
  // validator to check, so we don't inflate boundary.validation counts.
  if (graphState !== null || analysisState !== null) {
    emit(TelemetryEvents.BoundaryValidation, {
      boundary: 'B1',
      direction: 'ingress',
      validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
      contract_version: '1.5.0',
      pass: true,
      request_id: requestId,
      graph_present: graphState !== null,
      analysis_present: analysisState !== null,
    });
  }

  return { ok: true, value: { graphState, analysisState } };
}
