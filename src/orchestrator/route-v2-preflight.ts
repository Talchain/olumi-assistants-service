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
import { resolveOwnershipAuthority } from './ownership-authority.js';
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
/**
 * What a route passes as `claimedUserId` when its surface derives ownership
 * from the verified token subject alone.
 *
 * ── WHY A NAMED SENTINEL RATHER THAN A BARE `null` ─────────────────────────
 * A bare `null` at a call site reads as "no identity was available", which is
 * a statement about the REQUEST. This is a statement about the SURFACE: on
 * these routes a request-supplied identifier is not an input to the ownership
 * decision at all. Naming it keeps that intent legible at the call site and
 * makes a future re-introduction a visible edit rather than a silent one.
 *
 * ── WHY THIS IS SCOPED TO THE CALL SITES, NOT TO THE SHARED FUNCTION ───────
 * `authorizeScenarioOwnership` is shared with `/orchestrate/v2/turn{,/stop}`,
 * where a key-authed service caller acting on a user's behalf is the
 * documented and intended behaviour (`user-identity.ts`), and where a positive
 * control in `turn-stop-authorization.test.ts` pins that seam deliberately.
 * Changing the shared function would move behaviour on those routes too.
 *
 * Scoping the change to the scenario call sites leaves that control green,
 * because nothing it guards has moved: the two surfaces have different
 * requirements, and this expresses the difference where the difference lives.
 *
 * ── ⚠ CEE_REQUIRE_USER_JWT=false IS NOW AN OUTAGE, NOT A ROLLBACK LEVER ────
 * Because the verified token subject is the ONLY ownership input on these
 * surfaces, the flag that decides whether a token is verified at all became
 * load-bearing the moment this sentinel was introduced. With it off,
 * `resolveUserIdentity` returns `{mode:"off"}` for everyone, the effective
 * user is null, and every OWNED scenario is refused to its OWN owner on all
 * six /assist/v1/scenarios/* endpoints — reads and writes alike. Our own
 * record has previously described this flag as an incident lever; reaching for
 * it in an incident would now lock every signed-in user out of their own
 * scenarios. Guest (unowned) scenarios are unaffected.
 *
 * It is disclosed at boot (`config.scenario_ownership_posture`, server.ts) and
 * pinned in the suite as a KNOWN MISCONFIGURATION rather than as correct
 * behaviour (scenario-routes-claimed-identity.test.ts). Making the two
 * failures distinguishable to the caller is deliberately NOT done here and is
 * rowed separately.
 */
export const CALLER_ASSERTED_IDENTITY_NOT_ADMISSIBLE: string | null = null;

/**
 * Is this caller entitled to assert WHO IT IS ACTING AS via a body `user_id`?
 *
 * ── THE QUESTION THIS ANSWERS, AND THE ONE IT DOES NOT ─────────────────────
 * `authorizeScenarioOwnership` answers "does this identity own this
 * scenario?". This answers a different and prior question: "may this caller
 * NAME an identity at all?". They were one question until now, which is how
 * the hole below survived — CLAUDE.md trap 21, two concepts under one name.
 * Keeping them apart is the point of this helper existing rather than another
 * conjunct inside the ownership function.
 *
 * ── THE HOLE THIS CLOSES (witnessed on staging, 28 Aug 2026) ───────────────
 * `POST /bff/orchestrate/v2/turn` with NO Authorization header and a body of
 * `{scenario_id: <A's>, user_id: <A's sub>}` returned 200 and ran a full turn
 * on user A's owned scenario. The discriminating control — the same request
 * with a DIFFERENT `user_id` — returned 422 `scenario_owned_by_other_user`,
 * so the acceptance was specifically the ownership hole and not a permissive
 * route. The edge injected the shared assist key server-side, so an anonymous
 * browser inherited a full-trust service credential, and
 * `effectiveUserId = claimedUserId` did the rest.
 *
 * The browser-reachable half is closed at the edge (UI #927 — /bff/orchestrate/*
 * now 404s). This closes the CEE half so the hole cannot be re-inherited by a
 * future edge route, a new proxy, or a caller that simply holds the key.
 *
 * ── WHY HMAC IS THE LINE ───────────────────────────────────────────────────
 * The assist key is a SHARED bearer credential: everything holding it is
 * indistinguishable, so "the caller said so" is worth exactly as much as the
 * key's distribution, which is not an authorization argument. An HMAC caller
 * signs a per-request canonical string over method+path+body with a secret it
 * never transmits, so it is a genuinely identified service. `user-identity.ts`
 * already documents the service carve-out as being for such callers; this
 * makes the code agree with that sentence.
 *
 * ⚠ `hmacAuth` WAS FORGEABLE UNTIL THIS PR — see `plugins/auth.ts`. An empty
 *   `x-olumi-signature: ""` header set it true with no verification, which
 *   would have made this predicate bypassable by one header and turned the
 *   whole control into guarantee theatre. It is repaired in the same commit,
 *   deliberately: a control and the input it trusts are one change, not two.
 *   `hmacAuth` had NO behavioural reader in src/ before this — it fed
 *   telemetry only — so this is its first load-bearing use and the repair is
 *   what makes it load-bearing-worthy.
 *
 * Returns the sentinel (null) rather than throwing: an inadmissible claim is
 * not an error, it is simply not an ownership input. A caller that names an
 * identity it may not name is treated exactly as one that named none — which
 * on an OWNED scenario is a refusal, and on a GUEST scenario is unchanged.
 *
 * ── THE RULE ITSELF LIVES IN `ownership-authority.ts` ──────────────────────
 * This is now a thin accessor over `resolveOwnershipAuthority`, which states
 * the rule canonically: authority is DENIED unless a named carve-out row
 * admits it, and each row carries its own reason as data. This function keeps
 * the `string | null` shape for the call sites and tests that already bind to
 * it; anything needing the REASON should call the resolver directly, because
 * this shape necessarily throws the reason away.
 */
export function admissibleClaimedUserId(
  req: FastifyRequest,
  parsedUserId: string | null,
  identity: UserIdentityResolution = { mode: 'off' },
): string | null {
  const authority = resolveOwnershipAuthority(req, parsedUserId, identity);
  return authority.claimAdmitted ? authority.userId : CALLER_ASSERTED_IDENTITY_NOT_ADMISSIBLE;
}

export async function authorizeScenarioOwnership(
  scenarioId: string,
  claimedUserId: string | null,
  identity: UserIdentityResolution,
  requestId: string,
  /**
   * OBSERVATION ONLY — the body `user_id` AS SENT, before admissibility.
   * NEVER an ownership input; it exists solely to keep the misrepresentation
   * alarm alive.
   *
   * ── WHY THIS PARAMETER HAD TO BE ADDED (a defect in the first cut) ────────
   * Gating admissibility at the CALL SITE — passing `admissibleClaimedUserId(…)`
   * in place of the parsed id — discarded the claim before this function ever
   * saw it. That closed the hole and, in the same motion, silently deleted the
   * `UserJwtIdentityMismatch` alarm from the only two routes still able to
   * reach it: after the change, `claimedUserId !== null` became unsatisfiable
   * for every non-HMAC caller on all five call sites, so a browser presenting
   * a valid JWT and a DISAGREEING body `user_id` produced no signal at all.
   *
   * The comment below already recorded this loss for the three scenario routes
   * and deferred the repair on the grounds that fixing it "needs an
   * observation-only parameter on this shared function, which is a change to
   * the turn/Stop seam this PR deliberately does not touch". That PR now DOES
   * touch that seam, so the deferral expired and the parameter is here.
   *
   * `undefined` means NOT SUPPLIED and preserves the legacy behaviour exactly
   * (fall back to `claimedUserId`), which is what keeps the three scenario
   * routes and the direct unit tests unmoved. An explicit `null` means
   * "supplied, and there was no claim" — a different statement.
   */
  observedClaim?: string | null,
): Promise<
  | { readonly ok: true; readonly effectiveUserId: string | null }
  | { readonly ok: false; readonly reason: string }
> {
  const observed = observedClaim === undefined ? claimedUserId : observedClaim;

  // A claim was made and DISCARDED. This is the attack signature the
  // admissibility rule exists to stop, and it is worth a line even though the
  // request may go on to succeed harmlessly on a guest scenario. Logged at
  // WARN because a caller naming an identity it may not name is an
  // operational event, not a debugging detail.
  if (observed !== null && observed !== claimedUserId && identity.mode !== 'verified') {
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        claimed_user_id_prefix: observed.slice(0, 8),
        identity_mode: identity.mode,
      },
      'V5 pre-flight: caller-asserted user_id discarded — caller is not entitled to name an identity',
    );
  }

  let effectiveUserId = claimedUserId;
  if (identity.mode === 'verified') {
    // ⚠ THIS ALARM IS NO LONGER REACHABLE FROM THE SCENARIO ROUTES, BY
    // CONSTRUCTION — and it still looks live, which is why this note exists.
    //
    // All three /assist/v1/scenarios/* call sites now pass
    // CALLER_ASSERTED_IDENTITY_NOT_ADMISSIBLE (a literal null), so
    // `claimedUserId !== null` is UNSATISFIABLE for them and the mismatch can
    // never fire on those six endpoints again. Only the turn and Stop routes,
    // which still pass a parsed body id, can reach it.
    //
    // One argument was answering two questions — "who owns this?" and "is this
    // caller misrepresenting itself?" — and removing it as an ownership input
    // silently removed the second (CLAUDE.md trap 21). Recorded rather than
    // repaired: splitting them needs an observation-only parameter on this
    // shared function, which is a change to the turn/Stop seam this PR
    // deliberately does not touch.
    //
    // NOT OVERSTATED: only the COMPARISON is lost. The B1 boundary log still
    // emits `user_id_present` per request, so the presence of a body-supplied
    // id on a scenario call remains observable.
    // ⚠ COMPARES `observed`, NOT `claimedUserId`. On the turn and Stop routes
    // `claimedUserId` has already been through admissibility and is null for
    // every non-HMAC caller, so comparing it would make this alarm dead code
    // on exactly the surfaces that can still be misrepresented. `observed` is
    // the body id as sent, which is the thing whose disagreement is the signal.
    if (observed !== null && observed !== identity.userId) {
      emit(TelemetryEvents.UserJwtIdentityMismatch, {
        request_id: requestId,
        claimed_user_id_prefix: observed.slice(0, 8),
        verified_user_id_prefix: identity.userId.slice(0, 8),
      });
      log.warn(
        {
          request_id: requestId,
          claimed_user_id_prefix: observed.slice(0, 8),
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
  // Admissibility is decided BEFORE ownership, and by the canonical rule in
  // `ownership-authority.ts`: a shared-key caller may not name the identity it
  // acts as. The raw claim travels alongside as an OBSERVATION so discarding
  // it does not also discard the alarm that it was made.
  const authority = resolveOwnershipAuthority(req, extensions.value.userId, identity);
  const owned = await authorizeScenarioOwnership(
    ingress.value.scenario_id,
    authority.claimAdmitted ? authority.userId : CALLER_ASSERTED_IDENTITY_NOT_ADMISSIBLE,
    identity,
    requestId,
    authority.observedClaim,
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
