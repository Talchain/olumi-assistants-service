/**
 * `authorizeScenarioOwnership` — caller-asserted identity is NOT an authority.
 *
 * ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
 * Demonstrated end-to-end against deployed staging, positive and negative
 * controls in one run, NOT reasoned about:
 *
 *   · READ  — an anonymous caller (no token) posting a scenario UUID with
 *     `user_id` set to the OWNER's id received that scenario's full graph,
 *     brief text and committed analysis (200). The same request with a
 *     DIFFERENT id, with NO id, and with a MALFORMED id all refused (404).
 *     The claimed identity string was the only variable.
 *   · WRITE — the same channel let an anonymous caller CREATE a scenario
 *     attributed to an arbitrary user id. 64 rows in staging are already owned
 *     by 56 ids that match no auth user, written through exactly this path.
 *
 * ── WHY THE FIX IS ONE LINE IN ONE FUNCTION ────────────────────────────────
 * DERIVED, not assumed: every read of the parsed `user_id` extension in the
 * service — five of them, in the three scenario routes, turn admission and
 * Stop — is the `claimedUserId` argument to this function. Nothing downstream
 * consumes the raw claimed value, so there is no second place to strip it out
 * of and a body strip would be a SECOND mechanism enforcing a rule that already
 * has exactly one enforcement point.
 *
 * ── THE PAIRS ARE THE POINT ────────────────────────────────────────────────
 * Every assertion binds by IDENTITY to the exact value handed to the ownership
 * oracle. The `verified` cases and the unverified cases are opposite-direction
 * twins: a regression that restores the old fallback must RED the unverified
 * ones while leaving the verified ones GREEN. One direction alone cannot tell
 * "the claim is ignored" from "the claim happens to equal the token subject".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `importOriginal` spread rather than a hand-listed factory: a `vi.mock`
 * factory REPLACES the module, and `build-turn-context.js` carries the whole
 * turn-context builder. A hand-listed mock would silently delete every other
 * export (CLAUDE.md trap 12).
 */
const { preflightEnsureScenario } = vi.hoisted(() => ({
  preflightEnsureScenario: vi.fn(),
}));

vi.mock('../../orchestrator-v5/build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  preflightEnsureScenario,
}));

const { authorizeScenarioOwnership } = await import('../route-v2-preflight.js');

const SCENARIO = '11111111-2222-4333-8444-555555555555';
const TOKEN_SUB = 'aaaaaaaa-1111-4111-8111-111111111111';
const SOMEONE_ELSE = 'bbbbbbbb-2222-4222-8222-222222222222';
const REQUEST_ID = 'req-s3';

/** The identity the ownership oracle was actually asked about. */
function askedAbout(): string | null {
  expect(preflightEnsureScenario).toHaveBeenCalledTimes(1);
  return preflightEnsureScenario.mock.calls[0][1] as string | null;
}

beforeEach(() => {
  preflightEnsureScenario.mockReset();
  preflightEnsureScenario.mockResolvedValue({ ok: true });
});

describe('a VERIFIED caller is their token subject, whatever they claim', () => {
  it('uses the token subject when nothing is claimed', async () => {
    await authorizeScenarioOwnership(SCENARIO, null, { mode: 'verified', userId: TOKEN_SUB }, REQUEST_ID);
    expect(askedAbout()).toBe(TOKEN_SUB);
  });

  it('uses the token subject when the claim AGREES', async () => {
    await authorizeScenarioOwnership(SCENARIO, TOKEN_SUB, { mode: 'verified', userId: TOKEN_SUB }, REQUEST_ID);
    expect(askedAbout()).toBe(TOKEN_SUB);
  });

  it('uses the token subject when the claim names SOMEONE ELSE', async () => {
    await authorizeScenarioOwnership(SCENARIO, SOMEONE_ELSE, { mode: 'verified', userId: TOKEN_SUB }, REQUEST_ID);
    // Bound by identity: not "not the claim", but exactly the token subject.
    expect(askedAbout()).toBe(TOKEN_SUB);
  });
});

describe('an UNVERIFIED caller is ANONYMOUS — the forgery channel, closed', () => {
  /**
   * ⚠ THESE ARE THE REGRESSION TESTS. Before the fix every one of them handed
   *   the ownership oracle the caller's own claim, so a stranger posting an
   *   owner's id WAS that owner as far as the check was concerned.
   */
  const unverified = [
    { label: "service_legacy (a key-authed caller with no token — and the /bff/cee edge injects the key for ANY visitor)", identity: { mode: 'service_legacy' as const } },
    { label: 'off (the flag down)', identity: { mode: 'off' as const } },
    { label: 'refused (a token was presented and did not verify)', identity: { mode: 'refused' as const, reason: 'invalid_token' as const } },
  ];

  for (const { label, identity } of unverified) {
    it(`${label}: a claimed id is NOT honoured`, async () => {
      await authorizeScenarioOwnership(SCENARIO, SOMEONE_ELSE, identity, REQUEST_ID);
      expect(askedAbout()).toBeNull();
    });

    it(`${label}: claiming NOTHING is identical to claiming an id`, async () => {
      // The twin that proves the null above is the RULE and not an artefact of
      // the particular id: both inputs must reach the oracle as the same value.
      await authorizeScenarioOwnership(SCENARIO, null, identity, REQUEST_ID);
      expect(askedAbout()).toBeNull();
    });
  }
});

describe('what this change does NOT do', () => {
  it('leaves the ownership verdict itself to the oracle — a guest scenario still passes', async () => {
    // Stored owner NULL is carved out inside `preflightEnsureScenario`, not
    // here. An anonymous caller on a guest scenario is still admitted, so this
    // change does not remove guest access — that is a separate, later change
    // with a much larger blast radius.
    preflightEnsureScenario.mockResolvedValue({ ok: true });
    const result = await authorizeScenarioOwnership(SCENARIO, null, { mode: 'off' }, REQUEST_ID);
    expect(result).toEqual({ ok: true, effectiveUserId: null });
  });

  it('propagates a refusal reason unchanged', async () => {
    preflightEnsureScenario.mockResolvedValue({
      ok: false,
      reason: 'scenario_requires_authenticated_owner',
    });
    const result = await authorizeScenarioOwnership(
      SCENARIO,
      SOMEONE_ELSE,
      { mode: 'service_legacy' },
      REQUEST_ID,
    );
    expect(result).toEqual({ ok: false, reason: 'scenario_requires_authenticated_owner' });
  });
});
