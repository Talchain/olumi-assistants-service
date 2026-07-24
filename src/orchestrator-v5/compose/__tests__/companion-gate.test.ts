/**
 * egress-F2 (2026-07-24) — the cage companion-gate must fail CLOSED on a present
 * but non-string `<field>_status`. Before the fix, only a STRING status was
 * honoured; a present-but-malformed status (object/number/bool — e.g. an upstream
 * enrichment drift to `{state:'computed'}`) fell through to the value-presence
 * branch and read as claim-safe (the one fail-OPEN fork in a fail-closed chain).
 */
import { describe, expect, it } from 'vitest';

import { deriveCompanionClaimSafe } from '../phase3-blocks.js';

const FIELD = 'factor_sensitivity';
function factWith(enrichment: Record<string, unknown>): any {
  return { result: { enrichment } };
}

describe('deriveCompanionClaimSafe — companion-gate fail-closed', () => {
  it("a string status of 'computed' is claim-safe", () => {
    expect(deriveCompanionClaimSafe(factWith({ [`${FIELD}_status`]: 'computed' }), FIELD)).toBe(true);
  });

  it("a string status other than 'computed' is DENIED", () => {
    expect(deriveCompanionClaimSafe(factWith({ [`${FIELD}_status`]: 'pending' }), FIELD)).toBe(false);
  });

  it('POSITIVE CONTROL — a present OBJECT status denies even when the value exists (fail closed)', () => {
    // The exact drift the fix guards: an upstream enrichment shape change to an
    // object status. Pre-fix this returned TRUE via the value-presence branch.
    expect(
      deriveCompanionClaimSafe(
        factWith({ [`${FIELD}_status`]: { state: 'computed' }, [FIELD]: [1, 2, 3] }),
        FIELD,
      ),
    ).toBe(false);
  });

  it('a present NUMBER / BOOLEAN status also denies (any non-string present status)', () => {
    expect(deriveCompanionClaimSafe(factWith({ [`${FIELD}_status`]: 1, [FIELD]: [1] }), FIELD)).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({ [`${FIELD}_status`]: true, [FIELD]: [1] }), FIELD)).toBe(false);
  });

  it('with NO status key, a non-empty value is claim-safe (unchanged heuristic)', () => {
    expect(deriveCompanionClaimSafe(factWith({ [FIELD]: [1, 2] }), FIELD)).toBe(true);
    expect(deriveCompanionClaimSafe(factWith({ [FIELD]: [] }), FIELD)).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({}), FIELD)).toBe(false);
  });
});
