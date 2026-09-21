/**
 * B1 — CEE orchestrator boundary validator (v5 slice A0).
 *
 * Wraps the `OrchestratorTurnPayload` (ingress) and `OlumiResponse` (egress) Zod
 * schemas from `@talchain/schemas/boundary` with fail-closed semantics per
 * Boundary Contract v1.1 §3.2:
 *   - ingress failures → typed BoundaryError for HTTP 422
 *   - egress failures → typed OlumiResponse with error block (never 500)
 *
 * Every call emits a `boundary.validation` telemetry event (§4.4).
 * This module has no dependency on V4 pipeline code.
 */

import { z } from 'zod';
import {
  OrchestratorTurnPayloadSchema,
  OlumiResponseSchema,
  BoundaryErrorSchema,
  type OrchestratorTurnPayload,
  type OlumiResponse,
  type BoundaryError,
} from '@talchain/schemas/boundary';

import { emit, TelemetryEvents } from '../utils/telemetry.js';

export const CONTRACT_VERSION = '0.3.0';
export const INGRESS_VALIDATOR_NAME = 'OrchestratorTurnPayload';
export const EGRESS_VALIDATOR_NAME = 'OlumiResponse';

// Keep Zod issue payloads compact in telemetry + response bodies.
// Do not leak internal node paths or user content beyond what's in `path`/`message`.
function trimIssues(issues: z.ZodIssue[]): Array<{ path: string; message: string; code: string }> {
  return issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
    code: i.code,
  }));
}

export interface IngressOk { ok: true; value: OrchestratorTurnPayload }
export interface IngressFail { ok: false; error: BoundaryError }
export type IngressResult = IngressOk | IngressFail;

// Known-good BoundaryError literal, returned when our own error construction
// no longer satisfies §6.4 (i.e. a future schema tightening drifted past our
// factory). Fully typed so a compile-time change to BoundaryError will
// surface here, not at runtime. Must stay construction-free — no dynamic
// fields — so it cannot itself fail BoundaryErrorSchema.
function buildDriftFallbackError(request_id: string): BoundaryError {
  return {
    error: 'INTERNAL_ERROR',
    boundary: 'B1',
    direction: 'ingress',
    validator: INGRESS_VALIDATOR_NAME,
    details: { reason: 'boundary_error_schema_drift' },
    request_id,
    retryable: false,
  };
}

export function validateIngress(payload: unknown, request_id: string): IngressResult {
  const parsed = OrchestratorTurnPayloadSchema.safeParse(payload);
  if (parsed.success) {
    emit(TelemetryEvents.BoundaryValidation, {
      boundary: 'B1',
      direction: 'ingress',
      validator: INGRESS_VALIDATOR_NAME,
      contract_version: CONTRACT_VERSION,
      pass: true,
      request_id,
    });
    return { ok: true, value: parsed.data };
  }

  const issues = trimIssues(parsed.error.issues);
  const candidate: BoundaryError = {
    error: 'INGRESS_CONTRACT_VIOLATION',
    boundary: 'B1',
    direction: 'ingress',
    validator: INGRESS_VALIDATOR_NAME,
    details: { issues },
    request_id,
    retryable: false,
  };
  // Defensive: prove we emit a shape the BoundaryError schema itself accepts.
  // This catches drift between §6.4 and our construction. Fail-closed per
  // §3.2 — we must never throw past this boundary; on drift, emit a
  // drift-detection event and return a hardcoded fallback instead.
  const driftCheck = BoundaryErrorSchema.safeParse(candidate);
  if (!driftCheck.success) {
    emit(TelemetryEvents.BoundaryValidation, {
      boundary: 'B1',
      direction: 'ingress',
      validator: INGRESS_VALIDATOR_NAME,
      contract_version: CONTRACT_VERSION,
      pass: false,
      failure_class: 'schema_drift',
      error_code: 'INTERNAL_ERROR',
      drift_issue_count: driftCheck.error.issues.length,
      request_id,
    });
    return { ok: false, error: buildDriftFallbackError(request_id) };
  }

  emit(TelemetryEvents.BoundaryValidation, {
    boundary: 'B1',
    direction: 'ingress',
    validator: INGRESS_VALIDATOR_NAME,
    contract_version: CONTRACT_VERSION,
    pass: false,
    error_code: candidate.error,
    issue_count: issues.length,
    request_id,
  });
  return { ok: false, error: candidate };
}

/**
 * The ONLY top-level key this boundary will drop to rescue a reply.
 *
 * It qualifies on three counts, and a candidate that fails any one of them does
 * not belong here: (1) it is `.optional()` in the published contract, so its
 * absence is a state consumers already handle rather than a shape they have
 * never seen; (2) no user-facing surface renders it, so a user cannot perceive
 * the loss; (3) it is ADDITIVE — nothing downstream derives correctness from
 * its presence. Adding a second entry is a contract decision.
 */
const DEGRADABLE_EGRESS_FIELD = 'model_version_receipt' as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface EgressOk { ok: true; value: OlumiResponse }
export interface EgressFail { ok: false; fallback: OlumiResponse }
export type EgressResult = EgressOk | EgressFail;

// Egress fallback per Boundary Contract v1.1 §3.2.3 — never 500; always a
// typed OlumiResponse with an `error` block.
function buildEgressFallback(): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'The server produced a response that failed validation.',
    blocks: [
      { type: 'error', error_code: 'EGRESS_CONTRACT_VIOLATION', severity: 'error' },
    ],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  };
}

/**
 * ⭐ B1 EGRESS IS A GATE, NOT A TRANSFORM — IT RETURNS THE OBJECT IT WAS HANDED.
 *
 * ⚠ `return { ok: true, value: parsed.data }` WAS A HASH/PAYLOAD FORK ON THE
 * PRODUCTION WIRE. Zod's `safeParse` REBUILDS its input, and the rebuild applies
 * the graph contract's own `edge_type: EdgeType.optional().default('directed')`
 * (`@talchain/schemas` `dist/graph.js:286`, the only live `.default(` in the
 * package) to every edge that omitted the key. `route-v2.ts:1096` ships
 * `egress.value`, so every `model_version_receipt` left this boundary carrying
 * an `edge_type` its own `full_hash` was NOT computed over.
 *
 * MEASURED, not inferred:
 *   - Whole `model_versions` table (601 rows, 11,955 edges): `edge_type` present
 *     on ZERO. Contrast control in the same sweep: `origin` on 11,724.
 *   - Golden-journey capture `20260826T212322Z-fresh-extended-507050`, three
 *     independent receipts (T1_DRAFT 15/15 edges, T4_EDIT 15/15, T5C_CONFIRM
 *     19/19): every one shipped `edge_type: 'directed'` on every edge, while the
 *     cold read of the same scenario (T7_RELOAD) carried it on ZERO. Removing
 *     `edge_type` — and NOTHING ELSE — reproduced each shipped `full_hash`
 *     EXACTLY. So a client that recomputes `H(receipt.graph)` and compares
 *     concludes the server lied, on every turn.
 *   - Full-object diff of `parsed.data` against its input over five real
 *     captured payloads: the `edge_type` injection is the ONLY difference —
 *     zero drops, zero coercions, zero other additions; the receipt-free
 *     `T3_ANALYSE` body came back byte-identical (0 differences), which is the
 *     negative control showing the rebuild is otherwise faithful.
 *
 * `edge_type` is a genuine canonical field — it is in the published contract's
 * `CANONICAL_GRAPH_HASH_NESTED_PROJECTION.edge.fields`, and `'bidirected'`
 * changes reachability and counterfactual construction. But `'directed'` is the
 * value CEE's own readers already IMPLY from absence (`graph/reachability.ts:91`,
 * `schemas/graph.ts:501-504`: "Absent edge_type is treated as 'directed'"), so
 * injecting it adds no information to any consumer and only moves the hash. This
 * is the schemas package's own ratified doctrine applied to the field next door:
 * "NEVER `.default()` this field — absent means the producer did not state
 * provenance" / "Substituting … for a build that sent nothing would manufacture a
 * provenance claim PLoT never received" (`dist/boundary/enrichment.js:138-142`).
 *
 * ⚠ DO NOT "IMPROVE" THIS BACK TO `parsed.data`. The parse still does ALL the
 * validation work — this branch is only reached when it SUCCEEDED. The cast
 * narrows the type and performs no runtime work, exactly as `GraphVerbatim`'s
 * `.transform((v) => v as CanonicalReceiptGraph)` does on the receipt path and as
 * `commit.ts` does on the persist path ("so the carrier's hashes describe the
 * persisted bytes by construction rather than by coincidence"). This is the same
 * pattern's THIRD seam, and this module's own header already describes its job as
 * fail-closed VALIDATION — never normalisation.
 *
 * ⭐ THE CAST LOSES EXACTLY ONE BEHAVIOUR, AND LOSING IT CLOSES TWO MORE FORKS
 * OF THE SAME CLASS. A schema-tree walk over the 622 paths reachable from
 * `OlumiResponseSchema` (independent review) finds exactly ONE default path,
 * ZERO transforms/catches/pipelines, and exactly TWO strip points — matching a
 * direct census of `dist/graph.js`: 8 `z.object({` sites against 7
 * `.passthrough()` calls.
 *   1. `StrengthSchema` (graph.js:274-277), a bare `z.object({mean, std})`
 *   2. `nodes[].state_space.range` (graph.js:180-183), an inner anonymous
 *      `z.object({min, max})` — `StateSpaceSchema` itself IS passthrough,
 *      which is exactly why this one hides
 * Both silently DELETED additive keys from the wire while `full_hash` describes
 * the persisted bytes: the same hash/payload fork as the default, in the other
 * direction. Both were latent (11,902 persisted `strength` objects, zero
 * additive keys), and returning the caller's object closes BOTH.
 *
 * WHICH AUTHORITY SURVIVES: the persisted graph. The egress-invented alternative
 * disappears entirely; there is no compatibility branch to delete later.
 */
export function validateEgress(response: unknown, request_id: string): EgressResult {
  const parsed = OlumiResponseSchema.safeParse(response);
  if (parsed.success) {
    emit(TelemetryEvents.BoundaryValidation, {
      boundary: 'B1',
      direction: 'egress',
      validator: EGRESS_VALIDATOR_NAME,
      contract_version: CONTRACT_VERSION,
      pass: true,
      request_id,
    });
    return { ok: true, value: response as OlumiResponse };
  }

  const issues = trimIssues(parsed.error.issues);

  // ⭐ DEGRADE ONE OPTIONAL CARRIER RATHER THAN DELETE THE WHOLE REPLY.
  //
  // WITNESSED ON STAGING 28 Aug 2026 (build 674a4f2a): an ordinary open brief
  // drafted a 16-node graph that rendered on the canvas, and the user's entire
  // assistant reply was replaced by 'The server produced a response that failed
  // validation.' The sole Zod issue was
  // `model_version_receipt.graph.nodes.0.label` — "at most 200 character(s)" —
  // on a 212-character goal label CEE had copied verbatim from a brief
  // sentence. Re-driven the same day with a long goal sentence: reproduced on
  // consecutive turns, 258-character label.
  //
  // WHY THE PRODUCER AND THIS VALIDATOR DISAGREE (two schemas, one name —
  // CLAUDE.md trap 21). The receipt's own admissibility gate is
  // `model-management/mutation-receipt.ts:68` `GraphVerbatim`, which
  // superRefines against `GraphV3` from CEE-LOCAL `schemas/cee-v3.ts`, whose
  // `NodeV3.label` is a bare `z.string()` (`cee-v3.ts:162`) — UNBOUNDED. This
  // boundary validates against the PUBLISHED `GraphV3Schema`, whose
  // `NodeV3Schema.label` is `.min(1).max(200)` (`@talchain/schemas` 0.50.0,
  // `dist/graph.js:259`). So CEE mints a receipt its own validator accepts and
  // this one rejects, in the same request. `mutation-receipt.ts` states the
  // rule it breaks — "The ADMISSIBILITY question must be the same one the
  // version carrier asked" — and closed the gap for `strength.std` only.
  //
  // ⚠ THIS IS NOT A RELAXATION. The retry runs the SAME `OlumiResponseSchema`.
  // Nothing unvalidated leaves: the offending carrier is DELETED and the
  // remainder must pass identically. Any issue outside `model_version_receipt`
  // still takes the hard fallback below, unchanged.
  //
  // ⚠ WHY THIS KEY AND NO OTHER. `model_version_receipt` is `.optional()` in
  // the published contract, so its absence is a contract-valid state every
  // consumer already handles, and no user-facing surface renders it — a user
  // loses nothing they can see. `blocks`, `analysis_ready` and the rest ARE the
  // product. This list stays exactly one key long; widening it is a contract
  // decision, not a robustness tweak.
  //
  // ⚠ THIS IS THE INTERIM. The durable fix is to stop minting >200-character
  // labels at the producer, which must land BEFORE the durable commit because
  // changing a label changes `full_hash`.
  const receiptOnly =
    parsed.error.issues.length > 0 &&
    parsed.error.issues.every((i) => i.path[0] === DEGRADABLE_EGRESS_FIELD) &&
    isPlainObject(response) &&
    Object.prototype.hasOwnProperty.call(response, DEGRADABLE_EGRESS_FIELD);
  if (receiptOnly) {
    // Shallow copy minus the carrier. Every surviving value is passed by
    // REFERENCE, so this stays a gate and not a transform — a Zod rebuild here
    // would re-open the `edge_type` hash/payload fork documented above.
    const { [DEGRADABLE_EGRESS_FIELD]: _dropped, ...withoutReceipt } =
      response as Record<string, unknown>;
    const retry = OlumiResponseSchema.safeParse(withoutReceipt);
    if (retry.success) {
      emit(TelemetryEvents.BoundaryValidation, {
        boundary: 'B1',
        direction: 'egress',
        validator: EGRESS_VALIDATOR_NAME,
        contract_version: CONTRACT_VERSION,
        pass: true,
        degraded_field: DEGRADABLE_EGRESS_FIELD,
        issue_count: issues.length,
        issues,
        request_id,
      });
      return { ok: true, value: withoutReceipt as OlumiResponse };
    }
    // Dropping the carrier did not rescue it — fall through to the hard
    // fallback rather than shipping a second, differently-broken response.
  }

  emit(TelemetryEvents.BoundaryValidation, {
    boundary: 'B1',
    direction: 'egress',
    validator: EGRESS_VALIDATOR_NAME,
    contract_version: CONTRACT_VERSION,
    pass: false,
    error_code: 'EGRESS_CONTRACT_VIOLATION',
    issue_count: issues.length,
    issues,
    request_id,
  });
  return { ok: false, fallback: buildEgressFallback() };
}
