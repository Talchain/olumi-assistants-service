/**
 * V5 orchestrator route pre-flight helper.
 *
 * Runs, in order, the ingress-side checks that EVERY dispatch branch
 * in route-v2.ts depends on:
 *
 *   0. User identity    — `resolveUserIdentity` (flag-gated Supabase-JWT
 *      verification, CEE_REQUIRE_USER_JWT, default OFF — login 3.4 CEE-half.
 *      Runs FIRST: authentication precedes body validation, so an
 *      unauthenticated caller learns nothing about payload validity. When
 *      the flag is off this is a single config read — dormant.)
 *   1. Extension parse  — `parseRequestExtensions`
 *   2. B1 ingress       — `validateIngress` (on the body with extension keys stripped)
 *   3. Scenario upsert  — `preflightEnsureScenario` (fed by the VERIFIED
 *      identity when step 0 derived one — the caller-supplied `user_id`
 *      extension is ignored on verified turns)
 *
 * Returns a discriminated union so the caller stays the single owner of
 * `reply.code(...).send(...)`. On failure, the caller sends the 401/422; on
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
import { emit, log, TelemetryEvents } from '../utils/telemetry.js';
import { validateIngress } from '../validators/b1.js';
import {
  parseRequestExtensions,
  type ParsedRequestExtensions,
} from '../orchestrator-v5/boundary/request-extensions.js';
import { preflightEnsureScenario } from '../orchestrator-v5/build-turn-context.js';
import { buildSignInRequiredError, resolveUserIdentity } from './user-identity.js';

// `@talchain/schemas` `OrchestratorTurnPayload` is `.strict()` and would
// reject `graph_state` / `analysis_state` / `user_id` as unknown keys. We
// strip them off the body before B1, then parse them with the dedicated
// extensions validator. Order is load-bearing: extensions first so that
// an invalid `graph_state` shape surfaces a field-named 422 rather than a
// generic "unknown key" one.
//
// `user_id` was added 2026-04-21 for upsert-on-append pre-flight (see
// supabase/migrations/…_v5_ensure_scenario_exists.sql).
//
// `selected_elements` was added with Wave 2 of the P0 V5 golden-path
// repair (deterministic value-update with selection narrowing /
// selected-deictic). Same strip-then-parse pattern: B1 strict() would
// otherwise reject the key as unknown.
const V5_EXTENSION_FIELDS = [
  'graph_state',
  'analysis_state',
  'user_id',
  'selected_elements',
] as const;

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
  | { readonly ok: false; readonly status: 401 | 422; readonly error: BoundaryError };

export async function runPreFlight(req: FastifyRequest): Promise<PreFlightOutcome> {
  const requestId = getOrGenerateRequestId(req);

  // Step 0 — flag-gated user-identity resolution (CEE_REQUIRE_USER_JWT).
  // 'off' (flag down) and 'service_legacy' (key-authed direct caller, no
  // JWT) leave today's behaviour untouched; 'refused' short-circuits with
  // the typed recoverable sign_in_required 401 BEFORE any body validation.
  const identity = await resolveUserIdentity(req, requestId);
  if (identity.mode === 'refused') {
    log.warn(
      { request_id: requestId, auth_reason: identity.reason },
      'V5 pre-flight: unauthenticated turn refused (sign_in_required)',
    );
    return {
      ok: false,
      status: 401,
      error: buildSignInRequiredError(identity.reason, requestId),
    };
  }

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

  // Effective identity: on a verified turn the JWT-derived user_id is
  // authoritative and the caller-supplied `user_id` extension is IGNORED
  // (spec: after the flip, client identity from any public path is dead
  // input). A mismatch is telemetry-only — the verified value wins.
  let effectiveUserId = extensions.value.userId;
  if (identity.mode === 'verified') {
    if (extensions.value.userId !== null && extensions.value.userId !== identity.userId) {
      emit(TelemetryEvents.UserJwtIdentityMismatch, {
        request_id: requestId,
        claimed_user_id_prefix: extensions.value.userId.slice(0, 8),
        verified_user_id_prefix: identity.userId.slice(0, 8),
      });
      log.warn(
        {
          request_id: requestId,
          claimed_user_id_prefix: extensions.value.userId.slice(0, 8),
          verified_user_id_prefix: identity.userId.slice(0, 8),
        },
        'V5 pre-flight: caller-supplied user_id differs from verified JWT sub — using verified identity',
      );
    }
    effectiveUserId = identity.userId;
  }

  const preflight = await preflightEnsureScenario(
    ingress.value.scenario_id,
    effectiveUserId,
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
      // Thread the effective (verified-when-available) identity to every
      // downstream consumer — ownership checks and RPC p_user_id all read
      // extensions.userId.
      extensions: { ...extensions.value, userId: effectiveUserId },
    },
  };
}
