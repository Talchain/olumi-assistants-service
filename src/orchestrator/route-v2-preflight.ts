/**
 * V5 orchestrator route pre-flight helper.
 *
 * Runs, in order, the three ingress-side checks that EVERY dispatch branch
 * in route-v2.ts depends on:
 *
 *   1. Extension parse  — `parseRequestExtensions`
 *   2. B1 ingress       — `validateIngress` (on the body with extension keys stripped)
 *   3. Scenario upsert  — `preflightEnsureScenario`
 *
 * Returns a discriminated union so the caller stays the single owner of
 * `reply.code(...).send(...)`. On failure, the caller sends the 422; on
 * success, the caller destructures `context` and proceeds to dispatch.
 *
 * This helper exists so the "all branches share pre-flight" invariant is
 * preserved by structure, not convention. See Docs/v5/route-v2-branch-audit.md
 * for the audit that motivated this split. A file-scoped ESLint rule in
 * eslint.config.js forbids route-v2.ts from invoking the three primitives
 * directly — new dispatch branches must read `PreFlightContext` from this
 * helper's return value.
 *
 * Side effects: emits telemetry and structured logs via the primitives'
 * own instrumentation plus the `log.warn` calls below on failure. Does NOT
 * mutate the Fastify request or reply. Does NOT call any reply method.
 */

import type { FastifyRequest } from 'fastify';
import type { BoundaryError, OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { getOrGenerateRequestId } from '../utils/request-id.js';
import { log } from '../utils/telemetry.js';
import { validateIngress } from '../validators/b1.js';
import {
  parseRequestExtensions,
  type ParsedRequestExtensions,
} from '../orchestrator-v5/boundary/request-extensions.js';
import { preflightEnsureScenario } from '../orchestrator-v5/build-turn-context.js';

// `@talchain/schemas` `OrchestratorTurnPayload` is `.strict()` and would
// reject `graph_state` / `analysis_state` / `user_id` as unknown keys. We
// strip them off the body before B1, then parse them with the dedicated
// extensions validator. Order is load-bearing: extensions first so that
// an invalid `graph_state` shape surfaces a field-named 422 rather than a
// generic "unknown key" one.
//
// `user_id` was added 2026-04-21 for upsert-on-append pre-flight (see
// supabase/migrations/…_v5_ensure_scenario_exists.sql).
const V5_EXTENSION_FIELDS = ['graph_state', 'analysis_state', 'user_id'] as const;

function stripExtensionFields(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const k of V5_EXTENSION_FIELDS) delete copy[k];
  return copy;
}

export interface PreFlightContext {
  readonly requestId: string;
  readonly ingress: OrchestratorTurnPayload;
  readonly extensions: ParsedRequestExtensions;
}

export type PreFlightOutcome =
  | { readonly ok: true; readonly context: PreFlightContext }
  | { readonly ok: false; readonly status: 422; readonly error: BoundaryError };

export async function runPreFlight(req: FastifyRequest): Promise<PreFlightOutcome> {
  const requestId = getOrGenerateRequestId(req);

  const extensions = parseRequestExtensions(req.body, requestId);
  if (!extensions.ok) {
    log.warn(
      {
        request_id: requestId,
        error: extensions.error.error,
        field: (extensions.error.details as { field?: string }).field,
        issue_count: (extensions.error.details as { issues?: unknown[] }).issues?.length ?? 0,
      },
      'V5 request-extensions validation failed',
    );
    return { ok: false, status: 422, error: extensions.error };
  }

  const strippedBody = stripExtensionFields(req.body);
  const ingress = validateIngress(strippedBody, requestId);
  if (!ingress.ok) {
    log.warn(
      {
        request_id: requestId,
        error: ingress.error.error,
        issue_count: (ingress.error.details as { issues?: unknown[] }).issues?.length ?? 0,
      },
      'V5 B1 ingress validation failed',
    );
    return { ok: false, status: 422, error: ingress.error };
  }

  const preflight = await preflightEnsureScenario(
    ingress.value.scenario_id,
    extensions.value.userId,
    requestId,
  );
  if (!preflight.ok) {
    const preflightError: BoundaryError = {
      error: 'INGRESS_CONTRACT_VIOLATION',
      boundary: 'B1',
      direction: 'ingress',
      validator: 'scenario_preflight',
      details: { reason: preflight.reason, scenario_id: ingress.value.scenario_id },
      request_id: requestId,
      retryable: false,
    };
    return { ok: false, status: 422, error: preflightError };
  }

  return {
    ok: true,
    context: {
      requestId,
      ingress: ingress.value,
      extensions: extensions.value,
    },
  };
}
