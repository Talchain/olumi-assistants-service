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
  const error: BoundaryError = {
    error: 'INGRESS_CONTRACT_VIOLATION',
    boundary: 'B1',
    direction: 'ingress',
    validator: INGRESS_VALIDATOR_NAME,
    details: { issues },
    request_id,
    retryable: false,
  };
  // Defensive: prove we emit a shape the BoundaryError schema itself accepts.
  // This catches drift between §6.4 and our construction.
  BoundaryErrorSchema.parse(error);

  emit(TelemetryEvents.BoundaryValidation, {
    boundary: 'B1',
    direction: 'ingress',
    validator: INGRESS_VALIDATOR_NAME,
    contract_version: CONTRACT_VERSION,
    pass: false,
    error_code: error.error,
    issue_count: issues.length,
    request_id,
  });
  return { ok: false, error };
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
    return { ok: true, value: parsed.data };
  }

  const issues = trimIssues(parsed.error.issues);
  emit(TelemetryEvents.BoundaryValidation, {
    boundary: 'B1',
    direction: 'egress',
    validator: EGRESS_VALIDATOR_NAME,
    contract_version: CONTRACT_VERSION,
    pass: false,
    error_code: 'EGRESS_CONTRACT_VIOLATION',
    issue_count: issues.length,
    request_id,
  });
  return { ok: false, fallback: buildEgressFallback() };
}
