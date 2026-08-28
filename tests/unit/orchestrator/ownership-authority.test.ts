/**
 * THE CANONICAL OWNERSHIP-AUTHORITY RULE — deny by default, admit by named row.
 *
 * ── WHAT THIS SUITE IS FOR, AND WHAT IT CANNOT DO ──────────────────────────
 * It pins the RULE and the SHAPE of the carve-out table. It deliberately does
 * NOT claim to pin the deployed behaviour of `/orchestrate/v2/turn` — that is
 * the integration suite's job (`orchestrate-v2-turn-claimed-identity.test.ts`),
 * which runs the real `build()` and therefore the real auth plugin. A unit
 * suite that fabricates its own caller context proves the rule is written
 * correctly; only the integration suite proves the input to the rule is
 * computed correctly. Both are needed and neither substitutes for the other
 * (CLAUDE.md trap 16-inverse: a fixture you wrote yourself is not evidence
 * about the wire).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { attachCallerContext } from '../../../src/context/index.js';
import {
  AUTHORITATIVE_BASES,
  GUEST_BEHAVIOUR_DERIVED,
  OWNERSHIP_CLAIM_CARVE_OUTS,
  UNOWNED_ROW_CREATION,
  resolveAuthorityBasis,
  resolveOwnershipAuthority,
} from '../../../src/orchestrator/ownership-authority.js';
import type { UserIdentityResolution } from '../../../src/orchestrator/user-identity.js';

const CLAIM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const JWT_SUB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const OFF: UserIdentityResolution = { mode: 'off' };
const VERIFIED: UserIdentityResolution = { mode: 'verified', userId: JWT_SUB };
const SERVICE_LEGACY: UserIdentityResolution = { mode: 'service_legacy' };

/** A request with NO caller context at all — the auth plugin never ran. */
function unauthenticatedReq(): never {
  return {} as never;
}

/** A request authenticated with the SHARED assist key. */
function sharedKeyReq(): never {
  const req = {} as never;
  attachCallerContext(req, { keyId: 'authority-suite-shared', hmacAuth: false });
  return req;
}

/** A request whose HMAC signature PASSED verification. */
function hmacVerifiedReq(): never {
  const req = {} as never;
  attachCallerContext(req, { keyId: 'authority-suite-hmac', hmacAuth: true });
  return req;
}

describe('resolveAuthorityBasis — what did this caller actually prove?', () => {
  it('a verified JWT outranks everything, including a verified HMAC signature', () => {
    // Bound to the ORDERING, not merely to the happy case. A caller can hold
    // both credentials; the basis must be the strongest thing it proved, and a
    // rule that returned the first match in check order would be sensitive to
    // the order the branches happen to sit in.
    expect(resolveAuthorityBasis(hmacVerifiedReq(), VERIFIED)).toBe('verified_user_jwt');
  });

  it('a verified HMAC signature is a service basis', () => {
    expect(resolveAuthorityBasis(hmacVerifiedReq(), OFF)).toBe('verified_hmac_service');
  });

  it('the shared assist key is NOT a service basis', () => {
    expect(resolveAuthorityBasis(sharedKeyReq(), OFF)).toBe('shared_key');
  });

  it('no caller context at all reads as unauthenticated, not as shared_key', () => {
    // These two must stay distinguishable. Collapsing them would make "the
    // auth plugin did not run" indistinguishable from "the caller presented a
    // valid shared key", which is the kind of sameness that hides a
    // mis-wiring (CLAUDE.md trap 20: undiscriminated output looks like a real
    // result).
    expect(resolveAuthorityBasis(unauthenticatedReq(), OFF)).toBe('unauthenticated');
  });

  it('service_legacy identity mode does NOT by itself confer a service basis', () => {
    // `mode: 'service_legacy'` describes how the USER-identity layer classified
    // the request, not what the caller cryptographically proved. Treating it as
    // authoritative would re-open the hole through a different door.
    expect(resolveAuthorityBasis(sharedKeyReq(), SERVICE_LEGACY)).toBe('shared_key');
  });
});

describe('resolveOwnershipAuthority — deny by default', () => {
  it('DISCARDS a shared-key caller’s claim and records that it was made', () => {
    const authority = resolveOwnershipAuthority(sharedKeyReq(), CLAIM, OFF);

    expect(authority.userId).toBeNull();
    expect(authority.claimAdmitted).toBe(false);
    expect(authority.carveOutId).toBeNull();
    // The signal survives the discard. This is the half that the first cut of
    // this fix silently deleted.
    expect(authority.observedClaim).toBe(CLAIM);
  });

  it('DISCARDS an unauthenticated caller’s claim', () => {
    const authority = resolveOwnershipAuthority(unauthenticatedReq(), CLAIM, OFF);
    expect(authority.userId).toBeNull();
    expect(authority.claimAdmitted).toBe(false);
  });

  it('ADMITS a verified HMAC caller’s claim, and names the row that permitted it', () => {
    const authority = resolveOwnershipAuthority(hmacVerifiedReq(), CLAIM, OFF);

    expect(authority.userId).toBe(CLAIM);
    expect(authority.claimAdmitted).toBe(true);
    // Bound by IDENTITY: the admission is traceable to a specific carve-out
    // row, not merely to "some carve-out matched". A future second row could
    // otherwise satisfy a truthiness assertion while admitting for a reason
    // nobody reviewed (CLAUDE.md trap 19).
    expect(authority.carveOutId).toBe('verified_hmac_service_caller');
  });

  it('a verified JWT wins and the body claim is NOT admitted even when it agrees', () => {
    const authority = resolveOwnershipAuthority(sharedKeyReq(), JWT_SUB, VERIFIED);

    expect(authority.userId).toBe(JWT_SUB);
    // The value is right, but it came from the TOKEN, not from the body. If
    // `claimAdmitted` were true here, an agreeing claim would be indistinguish-
    // able from an honoured one, and the next reader would conclude body ids
    // are honoured under a verified JWT.
    expect(authority.claimAdmitted).toBe(false);
    expect(authority.observedClaim).toBe(JWT_SUB);
  });

  it('a verified JWT wins over a DISAGREEING body claim, and the claim stays observable', () => {
    const authority = resolveOwnershipAuthority(sharedKeyReq(), CLAIM, VERIFIED);

    expect(authority.userId).toBe(JWT_SUB);
    expect(authority.claimAdmitted).toBe(false);
    // This is what the misrepresentation alarm reads.
    expect(authority.observedClaim).toBe(CLAIM);
  });

  it('a caller with no claim is not credited with one, even under a carve-out', () => {
    const authority = resolveOwnershipAuthority(hmacVerifiedReq(), null, OFF);
    expect(authority.userId).toBeNull();
    expect(authority.claimAdmitted).toBe(false);
    expect(authority.carveOutId).toBe('verified_hmac_service_caller');
  });
});

describe('the carve-out table is COMPLETE, and widening it is a deliberate act', () => {
  it('contains EXACTLY the reviewed set of carve-out ids', () => {
    // ⚠ A TRIPWIRE, NOT A TAUTOLOGY. This assertion exists so that adding a
    // row — which widens an authorization boundary — cannot happen without
    // editing this line, and therefore without a reviewer seeing it. If you
    // are here because this test went red, the question to answer is not
    // "what is the new id?" but "why is this caller class entitled to name an
    // identity, and what evidence keeps that true?".
    expect(OWNERSHIP_CLAIM_CARVE_OUTS.map((c) => c.id)).toEqual([
      'verified_hmac_service_caller',
    ]);
  });

  it('admits ONLY bases that are in the authoritative set', () => {
    // Derived, not mirrored: the check reads both lists rather than restating
    // a third. A carve-out admitting `shared_key` is the exact defect this
    // whole change exists to remove, and it would pass an id-only assertion.
    for (const carveOut of OWNERSHIP_CLAIM_CARVE_OUTS) {
      expect(AUTHORITATIVE_BASES).toContain(carveOut.basis);
    }
  });

  it('every carve-out carries a reason AND a standing-evidence obligation', () => {
    // An exclusion without a reason is an omission wearing a badge. Length
    // floors are crude, and deliberately so: they cannot judge quality, they
    // only stop a row shipping with an empty or placeholder justification.
    for (const carveOut of OWNERSHIP_CLAIM_CARVE_OUTS) {
      expect(carveOut.reason.length).toBeGreaterThan(60);
      expect(carveOut.standingEvidence.length).toBeGreaterThan(60);
      expect(carveOut.scope.length).toBeGreaterThan(0);
    }
  });

  it('records where a carve-out is UNAVAILABLE despite being in scope, and what measures it', () => {
    // `scope` records where the rule APPLIES; this records where a caller can
    // actually SATISFY it. The two differ for the HMAC row, and the difference
    // is invisible from the module itself — it comes from `/orchestrate/v2/turn/
    // stream` re-entering the turn handler with a path-bound signature that can
    // no longer verify. Without this pin, a reader of `scope` would conclude the
    // carve-out is available on every path reaching the handler.
    const hmac = OWNERSHIP_CLAIM_CARVE_OUTS.find(
      (c) => c.id === 'verified_hmac_service_caller',
    );
    expect(hmac).toBeDefined();

    const stream = hmac?.knownUnavailableOn.find(
      (u) => u.route === '/orchestrate/v2/turn/stream',
    );
    expect(stream, 'the streamed re-entry limitation must stay recorded').toBeDefined();
    // Bound to the MEASURING suite by name, so this record cannot become a
    // free-floating claim if that suite is ever moved or deleted.
    expect(stream?.pinnedBy).toBe('tests/integration/streamed-turn-hmac.test.ts');
  });

  it('every pinnedBy reference names a suite that EXISTS', () => {
    // DERIVED, not mirrored. Without this the `pinnedBy` field is prose that
    // happens to be stored in a string: renaming or deleting the measuring
    // suite would leave a confident citation pointing at nothing, and every
    // other assertion here would stay green. Resolving it against the repo
    // root is what makes the citation load-bearing.
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const referenced = OWNERSHIP_CLAIM_CARVE_OUTS.flatMap((c) =>
      c.knownUnavailableOn.map((u) => u.pinnedBy),
    );
    // Guard against the check passing by finding nothing (CLAUDE.md trap 13:
    // an absence probe needs to prove it can see a presence).
    expect(referenced.length).toBeGreaterThan(0);
    for (const rel of referenced) {
      expect(existsSync(join(repoRoot, rel)), `missing suite: ${rel}`).toBe(true);
    }
  });

  it('no carve-out claims a scope beyond the two turn routes', () => {
    // The three /assist/v1/scenarios/* routes pass the sentinel unconditionally
    // and must not acquire a carve-out by a table edit alone.
    const permitted = ['/orchestrate/v2/turn', '/orchestrate/v2/turn/stop'];
    for (const carveOut of OWNERSHIP_CLAIM_CARVE_OUTS) {
      for (const route of carveOut.scope) expect(permitted).toContain(route);
    }
  });
});

describe('recorded derivations travel with the code', () => {
  it('the guest derivation names where the decision is actually made', () => {
    // The value of this record is that it points AWAY from this module. A
    // reader asking "what can an anonymous caller do?" must end up in
    // `preflightEnsureScenario`, not conclude the answer lives here.
    expect(GUEST_BEHAVIOUR_DERIVED.decidedIn).toContain('preflightEnsureScenario');
    expect(GUEST_BEHAVIOUR_DERIVED.permitted.length).toBeGreaterThan(0);
    expect(GUEST_BEHAVIOUR_DERIVED.refused.length).toBeGreaterThan(0);
  });

  it('the ensureScenarioExists analysis states BOTH reachability halves', () => {
    // The honest finding is "reachable before and after, but one class's
    // outcome changed". A record asserting only the reassuring half would be
    // the symptom-metric defect (CLAUDE.md trap 23).
    expect(UNOWNED_ROW_CREATION.reachableBeforeThisChange).toBe(true);
    expect(UNOWNED_ROW_CREATION.reachableAfterThisChange).toBe(true);
    expect(UNOWNED_ROW_CREATION.outcomeChangedForClass.length).toBeGreaterThan(60);
  });
});
