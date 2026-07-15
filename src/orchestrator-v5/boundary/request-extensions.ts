/**
 * V5 Phase 1.5 — HTTP boundary request extensions.
 *
 * `@talchain/schemas` v0.7.0 `OrchestratorTurnPayload` is a discriminated
 * union on `kind: 'message' | 'system_event'`. The `kind: 'message'` variant
 * declares base fields (turn_id, scenario_id, message, turn_class, stage,
 * source, and optional chip / retry_of). The UI ALSO sends `graph_state`,
 * `analysis_state`, and `user_id` on the same request body, but they bypass
 * B1 boundary validation because the base schema (`.strict()`) does not
 * declare them.
 *
 * This module adds a second, independent Zod parse over the same request body
 * — extracting `graph_state`, `analysis_state`, and `user_id` with permissive
 * content schemas that match the ACTUAL wire shape (not the CEE response
 * envelope).
 *
 * `user_id` was added 2026-04-21 as part of the upsert-on-append pre-flight
 * (see supabase/migrations/20260421000000_v5_ensure_scenario_exists.sql).
 * It carries the caller-trusted Supabase Auth user_id that CEE writes into
 * scenarios.user_id when creating a row on-demand. ⚠ Trust-the-caller is
 * PoC scope only; production must upgrade to a JWT-scoped client that
 * derives identity from auth.uid(). See migration-file header.
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
import { assertIngressGraphNumericBounds } from '../../validators/numeric-bounds.js';

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

/**
 * UUID shape for user_id. Zod's `.uuid()` accepts both v4 and the Supabase-
 * issued variant formats. Absence is allowed and callers MUST treat `null`
 * as "upsert pre-flight skipped, fall back to existence check".
 */
export const UserIdIngressSchema = z.string().uuid();

/**
 * UI-side selection context. The DecisionGuideAI client emits
 * `selected_elements: { node_ids?: string[]; edge_ids?: string[] }` on
 * conversation/explain/chip turns (see UI services/turn-request-builder.ts).
 * The V5 deterministic value-update pre-route consumes `node_ids` as a
 * tie-breaker when label evidence is ambiguous AND the user used a deictic
 * reference like "that factor" — strictly factor-kind narrowing only.
 *
 * Permissive parse: arrays of strings; both `node_ids` and `edge_ids` are
 * optional. Older clients send a bare string array (legacy V4 shape) — we
 * accept that too and treat it as `node_ids` so the V5 path doesn't reject
 * traffic from clients that haven't migrated. Empty arrays pass through.
 */
export const SelectedElementsIngressSchema = z.union([
  z
    .object({
      node_ids: z.array(z.string()).optional(),
      edge_ids: z.array(z.string()).optional(),
    })
    .passthrough(),
  z.array(z.string()),
]);

export type SelectedElementsIngress = {
  readonly node_ids: readonly string[];
  readonly edge_ids: readonly string[];
};

function normaliseSelectedElements(
  parsed: z.infer<typeof SelectedElementsIngressSchema>,
): SelectedElementsIngress {
  if (Array.isArray(parsed)) {
    return { node_ids: parsed, edge_ids: [] };
  }
  return {
    node_ids: parsed.node_ids ?? [],
    edge_ids: parsed.edge_ids ?? [],
  };
}

export type ParsedRequestExtensions = {
  graphState: GraphStateIngress | null;
  analysisState: AnalysisStateIngress | null;
  userId: string | null;
  selectedElements: SelectedElementsIngress | null;
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
      value: {
        graphState: null,
        analysisState: null,
        userId: null,
        selectedElements: null,
      },
    };
  }

  const rawGraph = body.graph_state;
  const rawAnalysis = body.analysis_state;
  const rawUserId = body.user_id;
  const rawSelectedElements = body.selected_elements;

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
    // W2E-2 numeric-bounds gate (schema-hard-boundary): the shape schema above
    // is deliberately permissive (passthrough), so numeric graph values need an
    // explicit check against the vendored @talchain/schemas ranges before they
    // can flow onwards to PLoT/ISL. Contract-declared ranges (exists_probability
    // [0,1], strength.mean [-1,1], strength.std > 0, observed_state.std > 0)
    // plus universal finiteness (NaN/±Infinity — JSON.parse("1e999") yields
    // Infinity, so this IS reachable from the wire).
    //
    // This is path (a): PERSISTED state re-entering CEE on every turn. Per the
    // doctrine (src/validators/numeric-bounds.ts header), this gate is
    // IDENTITY-PRESERVING: it rejects or it hands the graph straight back, and
    // it NEVER rewrites a value. `strength.std` is part of the
    // analysis-affecting hash projection, and every hash token is minted off
    // the UNREPAIRED persisted graph at other parse sites — so repairing here
    // would fork graph identity and silently desync those tokens
    // (clarify_hash_mismatch on every pending proposal). A sigma <= 0 therefore
    // passes through untouched and is floored at the COMPUTE boundary instead
    // (PLoTClient.run → floorGraphSigmaForCompute), where it is actually
    // consumed and where nothing hashes the result.
    //
    // Values with no safe reading (non-finite, out-of-range probability/mean)
    // reject here, with the same BoundaryError shape as a structural failure so
    // the UI's existing CEE-validation-error handling renders them. Messages
    // carry field paths and bounds only — no values, no labels (PII rule).
    const bounds = assertIngressGraphNumericBounds(parsed.data);
    if (!bounds.ok) {
      emit(TelemetryEvents.BoundaryValidation, {
        boundary: 'B1',
        direction: 'ingress',
        validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
        contract_version: '1.5.0',
        pass: false,
        request_id: requestId,
        field: 'graph_state',
        reason: 'numeric_bounds',
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
            issues: bounds.issues,
          },
          request_id: requestId,
          retryable: false,
        },
      };
    }
    graphState = bounds.graph;
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

  let userId: string | null = null;
  if (rawUserId !== undefined && rawUserId !== null) {
    const parsed = UserIdIngressSchema.safeParse(rawUserId);
    if (!parsed.success) {
      emit(TelemetryEvents.BoundaryValidation, {
        boundary: 'B1',
        direction: 'ingress',
        validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
        contract_version: '1.5.0',
        pass: false,
        request_id: requestId,
        field: 'user_id',
      });
      return {
        ok: false,
        error: {
          error: 'INGRESS_CONTRACT_VIOLATION',
          boundary: 'B1',
          direction: 'ingress',
          validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
          details: {
            field: 'user_id',
            issues: trimIssues(parsed.error.issues),
          },
          request_id: requestId,
          retryable: false,
        },
      };
    }
    userId = parsed.data;
  }

  let selectedElements: SelectedElementsIngress | null = null;
  if (rawSelectedElements !== undefined && rawSelectedElements !== null) {
    const parsed = SelectedElementsIngressSchema.safeParse(rawSelectedElements);
    if (!parsed.success) {
      // Selection is best-effort context; a structurally invalid value
      // does not abort the turn. Drop it silently with telemetry — the
      // pre-route falls back to label-only matching, identical to a
      // turn that didn't carry selection at all.
      emit(TelemetryEvents.BoundaryValidation, {
        boundary: 'B1',
        direction: 'ingress',
        validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
        contract_version: '1.5.0',
        pass: false,
        request_id: requestId,
        field: 'selected_elements',
      });
    } else {
      selectedElements = normaliseSelectedElements(parsed.data);
    }
  }

  // Emit a success event only when at least one extension field was actually
  // validated. This keeps the telemetry trace aligned with what happened:
  // a body with no extension fields has nothing for this validator to check,
  // so we don't inflate boundary.validation counts.
  if (
    graphState !== null ||
    analysisState !== null ||
    userId !== null ||
    selectedElements !== null
  ) {
    emit(TelemetryEvents.BoundaryValidation, {
      boundary: 'B1',
      direction: 'ingress',
      validator: REQUEST_EXTENSIONS_VALIDATOR_NAME,
      contract_version: '1.5.0',
      pass: true,
      request_id: requestId,
      graph_present: graphState !== null,
      analysis_present: analysisState !== null,
      user_id_present: userId !== null,
      selected_elements_present: selectedElements !== null,
    });
  }

  return {
    ok: true,
    value: { graphState, analysisState, userId, selectedElements },
  };
}
