/**
 * V5 pre-flight ownership — IDOR fail-closed (Lane C).
 *
 * Pins the full ownership quadrant for {@link preflightEnsureScenario}. The
 * `authoritativeUserId` (stored owner, from `ensureScenarioExists`) and the
 * caller-supplied `userId` are each nullable, so there are four quadrants:
 *
 *   stored owner | caller id | verdict
 *   -------------|-----------|------------------------------------------------
 *   null         | null      | ALLOW  — guest scenario, anonymous caller
 *   null         | present   | ALLOW  — guest scenario, any caller
 *   present      | == owner  | ALLOW  — owner acting on own scenario
 *   present      | != owner  | REFUSE — cross-tenant (scenario_owned_by_other_user)
 *   present      | null      | REFUSE — IDOR-class: anonymous caller on an OWNED
 *                              scenario. Historically SKIPPED (either-null
 *                              short-circuit) → any request omitting user_id
 *                              could act on any owned scenario. This closes it.
 *
 * The fix fails closed for the LAST row ONLY. Guest scenarios (stored owner
 * NULL) remain open to every caller — that openness is a deliberate product
 * decision (VITE_AUTH_MODE=guest), and it is ALSO a real disclosure/mutation
 * surface: anyone holding a guest scenario's UUID can read and append to it.
 * Closing that requires a client-side credential the guest journey does not
 * yet have, so it is NOT closed here. See the Lane S report (2026-07-26).
 *
 * ── Ownership-ORACLE availability (Lane S, 2026-07-26) ────────────────────
 * The quadrant above can only be evaluated if `ensureScenarioExists` actually
 * answers. This file previously pinned "RPC/store error fails open", on the
 * stated grounds that "commit is the last line of defence". That premise was
 * verified and is FALSE for ownership: `append_turn_atomic` (all of v1/v2/v3)
 * reads `user_id` FROM the scenarios row to denormalise it onto the turn, and
 * never compares it to any caller identity. It guards scenario EXISTENCE, not
 * ownership. So an oracle failure removed the ownership check with nothing
 * behind it — the only bypass left for the one control that works.
 *
 * The two failures are now distinguished:
 *   - store NOT CONFIGURED (`getSessionStore()` throws) → skip, unchanged.
 *     There is no persistence in that environment, so there is no stored
 *     owner to protect and nothing to leak.
 *   - store configured but the RPC FAILS → fail CLOSED. We asked who owns
 *     this scenario and could not find out; proceeding would grant access we
 *     cannot justify.
 */
import { describe, it, expect, vi } from 'vitest';

import { preflightEnsureScenario } from '../build-turn-context.js';
import { SessionReadError, type SessionStore } from '../session/store.js';

// The store-unavailable path is only reachable when NO store is injected, so
// `getSessionStore()` is mocked to throw. Every other test here passes an
// explicit store and never reaches this mock.
vi.mock('../session/index.js', () => ({
  getSessionStore: () => {
    throw new Error('SUPABASE_URL is not configured');
  },
}));

const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const OWNER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Minimal SessionStore whose `ensureScenarioExists` reports a fixed stored
 * owner regardless of the caller-supplied user_id (mirrors the real RPC,
 * which returns the AUTHORITATIVE row owner, not the caller's claim).
 */
function storeReturningOwner(storedOwner: string | null): SessionStore {
  return {
    ensureScenarioExists: vi.fn(async () => ({ user_id: storedOwner })),
  } as unknown as SessionStore;
}

describe('preflightEnsureScenario — ownership quadrant (IDOR fail-closed)', () => {
  it('ALLOW: stored owner null + caller null (guest scenario, anonymous caller)', async () => {
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      null,
      REQUEST_ID,
      storeReturningOwner(null),
    );
    expect(result).toEqual({ ok: true });
  });

  it('ALLOW: stored owner null + caller present (guest scenario, any caller)', async () => {
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      OTHER_ID,
      REQUEST_ID,
      storeReturningOwner(null),
    );
    expect(result).toEqual({ ok: true });
  });

  it('ALLOW: stored owner present + caller is the owner', async () => {
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      OWNER_ID,
      REQUEST_ID,
      storeReturningOwner(OWNER_ID),
    );
    expect(result).toEqual({ ok: true });
  });

  it('REFUSE: stored owner present + caller is a DIFFERENT user (cross-tenant)', async () => {
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      OTHER_ID,
      REQUEST_ID,
      storeReturningOwner(OWNER_ID),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('scenario_owned_by_other_user');
  });

  it('REFUSE (IDOR fail-closed): stored owner present + caller ABSENT (null)', async () => {
    // The dangerous quadrant. Before the fix this returned { ok: true }
    // because the ownership check was skipped whenever EITHER side was null,
    // so any request omitting user_id bypassed ownership on an owned scenario.
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      null,
      REQUEST_ID,
      storeReturningOwner(OWNER_ID),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('scenario_requires_authenticated_owner');
  });

});

describe('preflightEnsureScenario — ownership oracle availability', () => {
  /** A configured store whose ownership RPC fails the way the real one does. */
  function storeWithFailingRpc(): SessionStore {
    return {
      ensureScenarioExists: vi.fn(async () => {
        throw new SessionReadError('ensureScenarioExists(...) failed: rpc down', {
          code: '57014',
        });
      }),
    } as unknown as SessionStore;
  }

  // ---- POSITIVE CONTROL ----------------------------------------------------
  // Before asserting that any path is CLOSED, prove this probe can observe an
  // OPEN one. Both controls below MUST report ok:true. If either ever starts
  // returning ok:false, the fail-closed assertions underneath are vacuous —
  // they would pass no matter what the code did.

  it('POSITIVE CONTROL: a healthy oracle on a guest scenario is OPEN (ok:true)', async () => {
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      null,
      REQUEST_ID,
      storeReturningOwner(null),
    );
    expect(result).toEqual({ ok: true });
  });

  it('POSITIVE CONTROL: no store CONFIGURED at all is still skipped-open (ok:true, skipped)', async () => {
    // No store injected → getSessionStore() throws (mocked at module scope).
    // This environment has no persistence, hence no stored owner to protect.
    // This is the one failure that must KEEP failing open; it is also proof
    // that the probe distinguishes "cannot configure" from "cannot answer".
    const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID);
    expect(result).toEqual({ ok: true, skipped: true });
  });

  // ---- THE CLOSED PATH -----------------------------------------------------

  it('REFUSE (fail closed): store configured but the ownership RPC fails — anonymous caller', async () => {
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      null,
      REQUEST_ID,
      storeWithFailingRpc(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('scenario_ownership_unverifiable');
  });

  it('REFUSE (fail closed): store configured but the ownership RPC fails — identified caller', async () => {
    // Identity does not rescue the turn: an unanswered oracle cannot confirm
    // that THIS caller is the owner, and a caller-supplied id proves nothing.
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      OWNER_ID,
      REQUEST_ID,
      storeWithFailingRpc(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('scenario_ownership_unverifiable');
  });

  it('an oracle failure must not be reported as a cross-tenant refusal', async () => {
    // Distinct reason codes matter: "we could not check" and "you are not the
    // owner" are different operational facts and must not be conflated in the
    // 422 the caller sees or in the logs an operator reads.
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      OTHER_ID,
      REQUEST_ID,
      storeWithFailingRpc(),
    );
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).not.toBe('scenario_owned_by_other_user');
    expect(result.reason).not.toBe('scenario_requires_authenticated_owner');
  });
});
