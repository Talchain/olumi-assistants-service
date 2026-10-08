/** Validate V5 extensions and ingress after the central scenario-ownership preHandler. */

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
/**
 * THE ONE TRUE SENTENCE A DELETED-SCENARIO REFUSAL CAN CARRY TODAY.
 *
 * ── WHY COPY IS ON THIS ENVELOPE AT ALL ────────────────────────────────────
 * Refusing a turn must not turn a silent resurrection into a silent failure.
 * Derived at the client (DecisionGuideAI `staging`), the 422 IS surfaced — a
 * synthetic assistant bubble in the transcript, plus the composer's hero
 * failure copy — so the refusal is visible. But the client's guidance table
 * (`failureTypeRetryability.ts`, `OWNERSHIP_REASON_GUIDANCE`) maps only the
 * three PRE-EXISTING reasons, and an unmapped reason on the
 * `scenario_preflight` validator falls through to its server-fault line:
 * "Something on our side isn't working — your message was fine. Please try
 * again in a moment." Both halves of that are FALSE for a deleted scenario,
 * and the wait it prescribes can never succeed.
 *
 * `details` is `passthrough` on `BoundaryErrorSchema` at both pins, and the
 * client already reads `details.recovery.{suggestion,hints}` and the flat
 * `details.recovery_suggestion` mirror — and renders them ABOVE the guidance
 * line. So CEE can put a true statement in front of the user unilaterally,
 * which is why this ships here rather than waiting.
 *
 * ⚠ WHAT THIS DOES NOT FIX, AND IT IS NOT CLAIMED AS FIXED: the false
 *   server-fault sentence still renders BELOW this copy until the client adds
 *   a `scenario_deleted` row to `OWNERSHIP_REASON_GUIDANCE`. That is a
 *   one-line change in the other repo, it is NOT in this lane's write slot,
 *   and until it lands the user reads an accurate sentence followed by a
 *   contradictory one. That is strictly better than a silently resurrected
 *   decision and strictly worse than the finished state.
 *
 * ⚠ A NEW TOP-LEVEL WIRE CODE WOULD BE WORSE THAN DOING NOTHING.
 *   `BoundaryErrorSchema` is `.strict()` over a CLOSED nine-member enum, so a
 *   new `error` value (or any extra top-level key) fails the client's
 *   `safeParse`, collapses to `INTERNAL_ERROR` and shows "Something went wrong
 *   on our side. Please retry." with a Try-again chip. The refusal therefore
 *   rides the existing code and validator, and varies only `details.reason`.
 */
export const SCENARIO_DELETED_RECOVERY_BODY = Object.freeze({
  suggestion:
    'This decision has been deleted, so nothing further can be saved to it. ' +
    'If you did not delete it yourself, it was deleted in another tab or window.',
  hints: Object.freeze([
    'Trying again will not restore it.',
    'Start a new decision, or open a different one from your list.',
  ]),
});

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

  const effectiveUserId = req.scenarioAccess?.callerUserId ?? null;

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
