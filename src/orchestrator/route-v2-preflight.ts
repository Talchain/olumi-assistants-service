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
 *
 * ── ROADMAP 2.236 — STEPS 0 AND 3 ARE NOW SHARED WITH THE STOP ROUTE ────────
 * `POST /proxy/v5/turn/stop` had NO identity and NO ownership check at all
 * (Codex audit C finding C-1): a caller who knew a scenario UUID could forge an
 * allowed Origin, post an invented `turn_id`, and the fence upsert allocated a
 * NEW generation — superseding a legitimate in-flight turn, which then lost its
 * graph write at `OLTF2`. The ruled fix is that Stop goes through the SAME
 * verified-identity + scenario-ownership pre-flight as turn admission.
 *
 * ⚠ THE OBVIOUS IMPLEMENTATION IS THE WRONG ONE. Re-deriving "is this caller
 *   the owner" inside turn-stop.ts would be a second copy of an authorization
 *   rule — CLAUDE.md trap 12 with an authorization blast radius, and the drift
 *   would be silent (a divergent copy still answers 200). So steps 0 and 3 are
 *   extracted here as `resolveVerifiedIdentityOrRefuse` and
 *   `authorizeScenarioOwnership`, and BOTH `runPreFlight` and
 *   `recordExplicitTurnStop` call them. There is one implementation of each
 *   rule; changing it changes both rungs at once, by construction.
 *
 *   The extraction is behaviour-preserving for `runPreFlight`: the ORDER above
 *   is unchanged (identity strictly before body validation — an unauthenticated
 *   caller still learns nothing about payload validity), and the 401/422
 *   envelopes are byte-identical.
 */

import type { FastifyRequest } from 'fastify';
import type { BoundaryError, OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { getOrGenerateRequestId } from '../utils/request-id.js';
import { emit, log, TelemetryEvents } from '../utils/telemetry.js';
import { validateIngress } from '../validators/b1.js';
import {
  parseRequestExtensions,
  V5RequestExtensionsSchema,
  type ParsedRequestExtensions,
} from '../orchestrator-v5/boundary/request-extensions.js';
import { preflightEnsureScenario } from '../orchestrator-v5/build-turn-context.js';
import {
  buildSignInRequiredError,
  resolveUserIdentity,
  type UserIdentityResolution,
} from './user-identity.js';

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
//
// DERIVED, not mirrored (trap-12 discipline): the strip-list is exactly the
// key set of the V5 extension contract (`V5RequestExtensionsSchema`), which is
// itself built from the field schemas `parseRequestExtensions` runs. Adding an
// extension field there adds it here automatically — there is no second hand-
// maintained list to forget. The drift tripwire in
// `tests/contract/v5-extension-fields-derived.test.ts` fails loudly if the
// strip-set and the parser's consumed-set ever diverge.
export const V5_EXTENSION_FIELDS: readonly string[] = Object.keys(
  V5RequestExtensionsSchema.shape,
);

export function stripExtensionFields(body: unknown): unknown {
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

/**
 * STEP 0, EXTRACTED — flag-gated user-identity resolution
 * (CEE_REQUIRE_USER_JWT).
 *
 * 'off' (flag down) and 'service_legacy' (key-authed caller, no JWT — the
 * browser proxy refuses JWT-less turns at its own front door when the flag is
 * on, so no browser path reaches the carve-out) leave today's behaviour
 * untouched; 'refused' (present-but-invalid/expired JWT, or missing
 * verification material) short-circuits with the typed recoverable
 * sign_in_required 401 BEFORE any body validation.
 *
 * ⚠ The refusal is about the CALLER'S TOKEN, never about the scenario — it
 *   carries no scenario-existence and no scenario-ownership information, which
 *   is what lets the Stop route surface it without leaking (see turn-stop.ts on
 *   the indistinguishable refusal).
 *
 * Shared by `runPreFlight` (turn admission) and `recordExplicitTurnStop`
 * (2.236). ONE implementation — see the file header.
 */
export async function resolveVerifiedIdentityOrRefuse(
  req: FastifyRequest,
  requestId: string,
): Promise<
  | { readonly ok: true; readonly identity: UserIdentityResolution }
  | { readonly ok: false; readonly status: 401; readonly error: BoundaryError }
> {
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
  return { ok: true, identity };
}

/**
 * STEP 3, EXTRACTED — effective identity + scenario ownership.
 *
 * On a verified turn the JWT-derived user_id is authoritative and the
 * caller-supplied `user_id` extension is IGNORED (spec: after the flip, client
 * identity from any public path is dead input). A mismatch is telemetry-only —
 * the verified value wins.
 *
 * The ownership decision itself stays `preflightEnsureScenario`'s, unchanged:
 * it fails CLOSED when the ownership oracle is unavailable, refuses an
 * anonymous caller on an OWNED scenario, refuses a cross-tenant caller, and
 * carves out GUEST (unowned) scenarios by design.
 *
 * Returns the refusal REASON rather than a finished envelope, because the two
 * callers must wrap it differently: turn admission answers a typed 422 that
 * NAMES the reason (the UI distinguishes the branches), while Stop answers ONE
 * indistinguishable refusal — naming the reason there would leak whether the
 * scenario exists and whether it is yours. See turn-stop.ts.
 *
 * Shared by `runPreFlight` and `recordExplicitTurnStop` (2.236).
 */
export async function authorizeScenarioOwnership(
  scenarioId: string,
  claimedUserId: string | null,
  identity: UserIdentityResolution,
  requestId: string,
): Promise<
  | { readonly ok: true; readonly effectiveUserId: string | null }
  | { readonly ok: false; readonly reason: string }
> {
  let effectiveUserId = claimedUserId;
  if (identity.mode === 'verified') {
    if (claimedUserId !== null && claimedUserId !== identity.userId) {
      emit(TelemetryEvents.UserJwtIdentityMismatch, {
        request_id: requestId,
        claimed_user_id_prefix: claimedUserId.slice(0, 8),
        verified_user_id_prefix: identity.userId.slice(0, 8),
      });
      log.warn(
        {
          request_id: requestId,
          claimed_user_id_prefix: claimedUserId.slice(0, 8),
          verified_user_id_prefix: identity.userId.slice(0, 8),
        },
        'V5 pre-flight: caller-supplied user_id differs from verified JWT sub — using verified identity',
      );
    }
    effectiveUserId = identity.userId;
  }

  const preflight = await preflightEnsureScenario(scenarioId, effectiveUserId, requestId);
  if (!preflight.ok) {
    return { ok: false, reason: preflight.reason };
  }
  return { ok: true, effectiveUserId };
}

export async function runPreFlight(req: FastifyRequest): Promise<PreFlightOutcome> {
  const requestId = getOrGenerateRequestId(req);

  // Step 0 — see `resolveVerifiedIdentityOrRefuse` above. Runs BEFORE any body
  // validation; that ordering is load-bearing and is pinned by the suites.
  const resolved = await resolveVerifiedIdentityOrRefuse(req, requestId);
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.error };
  }
  const identity = resolved.identity;

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

  // Step 3 — effective identity + scenario ownership. See
  // `authorizeScenarioOwnership` above; the Stop route calls the same function.
  const owned = await authorizeScenarioOwnership(
    ingress.value.scenario_id,
    extensions.value.userId,
    identity,
    requestId,
  );
  if (!owned.ok) {
    const preflightError: BoundaryError = {
      error: 'INGRESS_CONTRACT_VIOLATION',
      boundary: 'B1',
      direction: 'ingress',
      validator: 'scenario_preflight',
      details: { reason: owned.reason, scenario_id: ingress.value.scenario_id },
      request_id: requestId,
      retryable: false,
    };
    return { ok: false, status: 422, error: preflightError };
  }
  const effectiveUserId = owned.effectiveUserId;

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
