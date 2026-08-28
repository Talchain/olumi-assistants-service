/**
 * WHO IS THIS CALLER ENTITLED TO ACT AS? — the canonical answer, in one place.
 *
 * ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 * Scenario ownership used to be decided by one expression:
 *
 *     let effectiveUserId = claimedUserId;                  // route-v2-preflight
 *     if (identity.mode === 'verified') effectiveUserId = identity.userId;
 *
 * That is a DEFAULT, not a rule. It says "the caller's claim wins unless
 * something better turns up", so every caller that was not JWT-verified —
 * including anything merely holding the shared assist key — named the user it
 * acted as. The rule nobody wrote down was the one that mattered, and its
 * absence was the IDOR witnessed on staging on 28 Aug 2026.
 *
 * This module inverts the polarity. Authority is DENIED unless a named
 * carve-out admits it, each carve-out is a DATA ROW carrying its own reason,
 * and the decision returns WHY as well as WHAT. An exclusion without a reason
 * is an omission wearing a badge; making the reasons enumerable is what stops
 * the next one being added silently.
 *
 * ── THE TWO QUESTIONS, KEPT APART ──────────────────────────────────────────
 * This module answers "may this caller NAME an identity at all?".
 * `authorizeScenarioOwnership` answers "does that identity own this scenario?".
 * They were one question until now, which is exactly how the hole survived
 * review — CLAUDE.md trap 21, two concepts under one name. They stay apart.
 *
 * ── WHAT THIS MODULE DOES *NOT* DECIDE ─────────────────────────────────────
 * Guest (unowned) scenarios. Nothing here mentions them, deliberately: the
 * guest carve-out is not an authority question, it is an OWNERSHIP question,
 * and it is decided downstream in `preflightEnsureScenario` by whether the
 * stored row has a null `user_id`. See `GUEST_BEHAVIOUR_DERIVED` below for the
 * derivation, which is recorded here because this is the file a reviewer reads
 * when asking "what can an unauthenticated caller still do?".
 */

import type { FastifyRequest } from 'fastify';

import { getCallerContext } from '../context/index.js';
import type { UserIdentityResolution } from './user-identity.js';

/**
 * What makes an identity AUTHORITATIVE — i.e. usable as an input to an
 * ownership decision. Ordered most to least trusted.
 *
 * The two authoritative bases share one property and it is the whole test:
 * **the caller proved something it could not have guessed.** A JWT is signed
 * by the identity provider over the subject; an HMAC signature is computed per
 * request over method+path+body with a secret that never crosses the wire.
 * A shared bearer key proves only membership of the set of things holding that
 * key, which is a statement about key distribution, not about identity.
 */
export type AuthorityBasis =
  /** A JWT verified by CEE; `sub` is the user. Authoritative. */
  | 'verified_user_jwt'
  /** A per-request HMAC signature that PASSED verification. Authoritative. */
  | 'verified_hmac_service'
  /** Authenticated with the shared assist key. NOT authoritative. */
  | 'shared_key'
  /** No recognised credential reached the authority layer. NOT authoritative. */
  | 'unauthenticated';

/** The bases from which a caller-asserted identity may be honoured. */
export const AUTHORITATIVE_BASES: readonly AuthorityBasis[] = Object.freeze([
  'verified_user_jwt',
  'verified_hmac_service',
]);

/**
 * A carve-out is a documented reason why a particular caller class MAY assert
 * the identity it acts as. Recorded as DATA so it is enumerable, testable and
 * reviewable — a comment cannot be asserted against.
 */
export interface OwnershipClaimCarveOut {
  /** Stable id; appears in logs so a live admission is traceable to its row. */
  readonly id: string;
  /** The basis this carve-out admits. */
  readonly basis: AuthorityBasis;
  /** WHY this caller class is entitled to name an identity. */
  readonly reason: string;
  /**
   * What a reviewer must check to confirm the carve-out still holds. Written
   * as an obligation, not a description: carve-outs decay silently otherwise.
   */
  readonly standingEvidence: string;
  /** Routes on which this carve-out applies. */
  readonly scope: readonly string[];
  /**
   * Routes INSIDE `scope` where the carve-out is nevertheless unavailable,
   * each with its reason and the suite that measures it.
   *
   * ── WHY THIS FIELD EXISTS ──────────────────────────────────────────────
   * `scope` alone over-states a carve-out: it records where the rule APPLIES,
   * not where a caller can actually SATISFY it. The two differ here, and the
   * difference is not visible from this file — it comes from how another route
   * re-enters this one. A reviewer reading `scope` in isolation would conclude
   * the carve-out is available on every path that reaches the turn handler.
   */
  readonly knownUnavailableOn: readonly {
    readonly route: string;
    readonly reason: string;
    /** The suite that MEASURES this, so the record cannot drift from reality. */
    readonly pinnedBy: string;
  }[];
}

/**
 * THE COMPLETE SET OF CARVE-OUTS. If a caller class is not here, its
 * body-supplied `user_id` is not an ownership input — full stop.
 *
 * ⚠ ADDING A ROW HERE WIDENS AN AUTHORIZATION BOUNDARY. The completeness of
 *   this table is pinned by `ownership-authority.test.ts`, which asserts the
 *   EXACT id set, so a new row cannot arrive without a deliberate test edit
 *   and the review that comes with it. That is the point of the assertion —
 *   it is not a tautology, it is a tripwire.
 *
 * ⭐ THE SINGLE ROW BELOW HAS NO KNOWN LIVE CONSUMER, AND SAYING SO IS THE
 *   HONEST SUMMARY OF THIS WHOLE MODULE. Derived, 28 Aug 2026, across five
 *   fresh clones with a firing contrast control: no production caller sends a
 *   body `user_id` to either turn route at all. The UI carries identity as an
 *   `X-User-Id` HEADER, which has ZERO readers on the turn path (positive
 *   control in `proxy-v5-turn.test.ts`: `authorization` returns 9 readers,
 *   `x-user-id` none), and CEE strips body `user_id` on both proxy rungs.
 *   `tests/integration/streamed-turn-hmac.test.ts` further shows a pure-HMAC
 *   caller cannot use the streamed route at all.
 *
 *   So on live traffic the rule below currently evaluates to "deny, always".
 *   That is a statement about today's callers, NOT a reason to delete the
 *   carve-out: the row exists so that the documented service-caller behaviour
 *   in `user-identity.ts` has one reviewed, testable expression rather than
 *   being re-invented ad hoc the first time a service integration needs it.
 *   But a reviewer should know that nothing exercises it in production, and
 *   therefore that no live behaviour depends on its being right — only on its
 *   being CLOSED, which the suites do pin.
 */
export const OWNERSHIP_CLAIM_CARVE_OUTS: readonly OwnershipClaimCarveOut[] = Object.freeze([
  Object.freeze({
    id: 'verified_hmac_service_caller',
    basis: 'verified_hmac_service' as const,
    reason:
      'A caller that signs each request with a secret it never transmits is a ' +
      'genuinely identified service, not an anonymous holder of a shared bearer ' +
      'token. `user-identity.ts` documents such a caller acting on a user’s ' +
      'behalf as intended behaviour; this row is where the code agrees with it.',
    standingEvidence:
      'plugins/auth.ts must set `hmacAuth: true` ONLY after ' +
      '`verifyHmacSignature(...).valid === true`. It was previously computed as ' +
      '`hasSignature !== undefined && …`, which an EMPTY `x-olumi-signature: ""` ' +
      'header satisfied without any verification — a forgeable flag under a ' +
      'load-bearing name. Re-check that binding before trusting this row.',
    scope: Object.freeze(['/orchestrate/v2/turn', '/orchestrate/v2/turn/stop']),
    knownUnavailableOn: Object.freeze([
      Object.freeze({
        route: '/orchestrate/v2/turn/stream',
        reason:
          'The streamed route re-enters `/orchestrate/v2/turn` via `app.inject()`, ' +
          'forwarding the signature headers verbatim. The HMAC canonical string is ' +
          'PATH-BOUND (`METHOD\\nPATH\\nTS\\nNONCE\\nBODYHASH`, verified over ' +
          '`request.url`) and the nonce is consumed by the OUTER verification, so ' +
          'the inner request cannot verify. It falls through to the API-key path, ' +
          'so an HMAC caller reaches the ownership decision as `shared_key` and its ' +
          'claim is discarded. FAIL-CLOSED, and deliberately not fixed here — the ' +
          'route is unconditionally registered (server.ts), so this is live ' +
          'behaviour, not a hypothetical.',
        pinnedBy: 'tests/integration/streamed-turn-hmac.test.ts',
      }),
    ]),
  }),
]);

/**
 * GUEST BEHAVIOUR — DERIVED, NOT ASSUMED (28 Aug 2026).
 *
 * Derived by reading `preflightEnsureScenario`
 * (`orchestrator-v5/build-turn-context.ts`) and the RPC it calls
 * (`session/supabase-store.ts::ensureScenarioExists`), not by inference from
 * the flag name. Recorded as data so the claims are assertable; the suite
 * `ownership-authority.test.ts` drives each one.
 *
 * The mechanism: `preflightEnsureScenario` calls `ensureScenarioExists`, which
 * runs `INSERT … ON CONFLICT (id) DO NOTHING` and returns the AUTHORITATIVE
 * `user_id` from the stored row. The entire ownership block is then guarded by
 * `if (authoritativeUserId !== null)`. So a null stored owner does not merely
 * relax the check — it SKIPS IT ENTIRELY, for every caller.
 *
 * ⚠ THE NON-OBVIOUS HALF: "the stored row has a null owner" covers TWO cases
 *   that look identical downstream —
 *     (a) a pre-existing guest scenario (the product feature), and
 *     (b) a row this very request just CREATED with a null owner, because the
 *         scenario id did not exist and the caller had no admissible identity.
 *   Both return `user_id: null` and both skip the block. Case (b) is the
 *   `ensureScenarioExists` write side effect analysed in
 *   `UNOWNED_ROW_CREATION` below.
 */
export const GUEST_BEHAVIOUR_DERIVED = Object.freeze({
  /** What ANY caller — including a wholly unauthenticated one — may do. */
  permitted: Object.freeze([
    'Run a turn on a scenario whose stored user_id IS NULL. The ownership ' +
      'block is skipped, so no identity is required and none is checked.',
    'Cause a scenario row to be CREATED with a null owner by naming a ' +
      'previously-unused scenario_id (see UNOWNED_ROW_CREATION).',
  ]),
  /** What it may NOT do. */
  refused: Object.freeze([
    'Act on a scenario whose stored user_id is NON-NULL while presenting no ' +
      'admissible identity → `scenario_requires_authenticated_owner` (422).',
    'Act on a scenario owned by a DIFFERENT user while presenting an ' +
      'admissible identity → `scenario_owned_by_other_user` (422).',
    'Convert a guest scenario into an owned one by asserting a body `user_id`: ' +
      'the claim is discarded before it reaches the store, so the row stays ' +
      'unowned rather than being adopted.',
  ]),
  /** Where the behaviour is decided — NOT in this module. */
  decidedIn: 'orchestrator-v5/build-turn-context.ts::preflightEnsureScenario',
});

/**
 * `ensureScenarioExists` IS A WRITE, AND IT SITS INSIDE AN AUTHORIZATION CHECK.
 *
 * `INSERT … ON CONFLICT (id) DO NOTHING` means the ownership pre-flight
 * CREATES the row it is about to check when that row does not exist. An
 * authorization check with a write side effect is worth naming even when it is
 * benign, because its blast radius changes whenever the identity fed to it
 * changes — which is precisely what this module does.
 *
 * ── DOES THE ADMISSIBILITY RULE MAKE UNOWNED-ROW CREATION MORE REACHABLE? ──
 * Derived, and the honest answer has two halves:
 *
 *   NO, for reachability. Unowned-row creation was ALREADY reachable before
 *   this change, by the simpler route of omitting `user_id` entirely: a
 *   shared-key caller posting a fresh UUID with no claim created a null-owner
 *   row then, and creates one now. No new caller class gains the ability, and
 *   no new request shape is required.
 *
 *   YES, for one request class's OUTCOME. A shared-key caller that names user
 *   X on a not-yet-existing scenario id previously created a row OWNED BY X;
 *   it now creates an UNOWNED row. The count of unowned rows a given attacker
 *   can create is unchanged; what changed is that a request which used to
 *   plant a row inside X's account now plants a public one instead.
 *
 * Both harms are real and they are not the same harm. Planting an owned row
 * plants content in a victim's account (an integrity attack on X); planting an
 * unowned row creates a world-readable object at a guessable-only-if-known
 * UUID. This change trades the first for the second, which is the correct
 * direction — a caller with no admissible identity should not be able to write
 * anything into a named user's account — but the second is not nothing, and it
 * is recorded here rather than left implied.
 *
 * ⚠ NOT FIXED HERE, AND DELIBERATELY. Making the pre-flight side-effect-free
 *   (split `ensureScenarioExists` into a read-only ownership probe plus an
 *   explicit create) is a change to the store interface and to all five
 *   `authorizeScenarioOwnership` call sites. That is a different lane, and
 *   "while we're here" work is prohibited. Recorded, scoped, handed on.
 */
export const UNOWNED_ROW_CREATION = Object.freeze({
  reachableBeforeThisChange: true,
  reachableAfterThisChange: true,
  /** The change alters the OUTCOME for one class, not the reachable SET. */
  outcomeChangedForClass:
    'shared-key caller + body user_id + not-yet-existing scenario_id: ' +
    'previously created a row owned by the named user, now creates an unowned row',
  mechanism: 'session/supabase-store.ts::ensureScenarioExists — INSERT … ON CONFLICT (id) DO NOTHING',
  notFixedHere: 'the ownership pre-flight remains a write; splitting it is a separate lane',
});

/**
 * The resolved answer to "who is this caller entitled to act as?".
 *
 * Structured rather than a bare `string | null` on purpose: a bare value
 * discards the reason, and the reason is what a reviewer, an operator reading
 * a log line, and the next change to this file all need. Returning WHY beside
 * WHAT is what makes the rule canonical rather than merely correct today.
 */
export interface OwnershipAuthority {
  /**
   * The identity to feed to the ownership decision. `null` means "no
   * authoritative identity" — which on an OWNED scenario is a refusal and on
   * an unowned one is unremarkable.
   */
  readonly userId: string | null;
  /** What the caller actually proved. */
  readonly basis: AuthorityBasis;
  /** The carve-out that admitted a claim, or null when none did. */
  readonly carveOutId: string | null;
  /**
   * The body `user_id` AS SENT, regardless of admissibility.
   *
   * OBSERVATION ONLY — never an ownership input. It exists so that discarding
   * a claim does not also discard the SIGNAL that a claim was made, which is
   * the misrepresentation alarm. Nulling the claim at the call site (the
   * previous shape) silently deleted that alarm along with the vulnerability;
   * the alarm is the part worth keeping.
   */
  readonly observedClaim: string | null;
  /** True when `observedClaim` was present AND honoured. */
  readonly claimAdmitted: boolean;
}

/**
 * What basis did this caller actually establish?
 *
 * ⚠ `verified_user_jwt` outranks `verified_hmac_service` and both outrank
 *   `shared_key`. A caller can hold more than one credential; the basis is the
 *   STRONGEST thing it proved, not the first one checked.
 */
export function resolveAuthorityBasis(
  req: FastifyRequest,
  identity: UserIdentityResolution,
): AuthorityBasis {
  if (identity.mode === 'verified') return 'verified_user_jwt';
  // `hmacAuth` is true ONLY after `verifyHmacSignature(...).valid === true`
  // (plugins/auth.ts). Every other path through that plugin sets it false
  // explicitly. "A signature header is present" is NOT this claim.
  if (getCallerContext(req)?.hmacAuth === true) return 'verified_hmac_service';
  return getCallerContext(req) !== undefined ? 'shared_key' : 'unauthenticated';
}

/**
 * THE CANONICAL RULE. Deny by default; admit only via a named carve-out.
 *
 * Note the shape: there is no `else` that falls through to the claim. The only
 * way `userId` becomes the caller's claim is for a carve-out row to match,
 * and the row's id travels with the answer so a live admission is traceable to
 * the reason that permitted it.
 */
export function resolveOwnershipAuthority(
  req: FastifyRequest,
  claimedUserId: string | null,
  identity: UserIdentityResolution,
): OwnershipAuthority {
  const basis = resolveAuthorityBasis(req, identity);

  // A verified JWT is self-describing: the subject IS the identity, and a body
  // claim adds nothing it could be trusted for. `authorizeScenarioOwnership`
  // overwrites with `identity.userId` anyway; stating it here means the two
  // agree by construction rather than by coincidence.
  if (identity.mode === 'verified') {
    return {
      userId: identity.userId,
      basis,
      carveOutId: null,
      observedClaim: claimedUserId,
      claimAdmitted: false,
    };
  }

  const carveOut = OWNERSHIP_CLAIM_CARVE_OUTS.find((c) => c.basis === basis);
  if (carveOut !== undefined) {
    return {
      userId: claimedUserId,
      basis,
      carveOutId: carveOut.id,
      observedClaim: claimedUserId,
      claimAdmitted: claimedUserId !== null,
    };
  }

  // DENIED — the default, and the only path for an ordinary shared-key caller.
  return {
    userId: null,
    basis,
    carveOutId: null,
    observedClaim: claimedUserId,
    claimAdmitted: false,
  };
}
