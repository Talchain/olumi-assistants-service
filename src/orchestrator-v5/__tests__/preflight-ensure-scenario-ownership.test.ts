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
 * NULL) remain open to every caller — that is a product feature, not a leak.
 */
import { describe, it, expect, vi } from 'vitest';

import { preflightEnsureScenario } from '../build-turn-context.js';
import type { SessionStore } from '../session/store.js';

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

  it('ALLOW (skipped): RPC/store error fails open — commit is the last line of defence', async () => {
    const throwingStore = {
      ensureScenarioExists: vi.fn(async () => {
        throw new Error('rpc down');
      }),
    } as unknown as SessionStore;
    const result = await preflightEnsureScenario(
      SCENARIO_ID,
      null,
      REQUEST_ID,
      throwingStore,
    );
    expect(result).toEqual({ ok: true, skipped: true });
  });
});
