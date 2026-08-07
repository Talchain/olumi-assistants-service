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

  it('F9 — with NO status key, only a VALID factor_sensitivity value is claim-safe', () => {
    // POSITIVE CONTROL: real PLoT sensitivity rows (factor_id-bearing objects).
    expect(
      deriveCompanionClaimSafe(
        factWith({ [FIELD]: [{ factor_id: 'fac_a', influence_score: 0.8 }, { factor_id: 'fac_b', influence_score: 0.2 }] }),
        FIELD,
      ),
    ).toBe(true);
    // F9 shape-fuzz — malformed values must NOT pass when the status is absent:
    expect(deriveCompanionClaimSafe(factWith({ [FIELD]: [] }), FIELD)).toBe(false); // empty array
    expect(deriveCompanionClaimSafe(factWith({ [FIELD]: [{}] }), FIELD)).toBe(false); // rows without factor_id
    expect(deriveCompanionClaimSafe(factWith({ [FIELD]: [1, 2] }), FIELD)).toBe(false); // non-object rows (was TRUE pre-F9)
    expect(deriveCompanionClaimSafe(factWith({ [FIELD]: '' }), FIELD)).toBe(false); // empty string
    expect(deriveCompanionClaimSafe(factWith({ [FIELD]: {} }), FIELD)).toBe(false); // object, not array
    expect(deriveCompanionClaimSafe(factWith({}), FIELD)).toBe(false); // absent
  });
});

describe('F9 — strict per-field companion value schemas (absent status)', () => {
  it('confidence_tier: only a non-empty string is claim-safe', () => {
    expect(deriveCompanionClaimSafe(factWith({ confidence_tier: 'strong' }), 'confidence_tier')).toBe(true);
    // shape-fuzz — the exact Codex F9 malformed values:
    expect(deriveCompanionClaimSafe(factWith({ confidence_tier: '' }), 'confidence_tier')).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({ confidence_tier: '   ' }), 'confidence_tier')).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({ confidence_tier: false }), 'confidence_tier')).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({ confidence_tier: 0 }), 'confidence_tier')).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({ confidence_tier: {} }), 'confidence_tier')).toBe(false);
  });

  it('robustness: only a non-empty object is claim-safe', () => {
    expect(deriveCompanionClaimSafe(factWith({ robustness: { score: 0.7 } }), 'robustness')).toBe(true);
    // shape-fuzz:
    expect(deriveCompanionClaimSafe(factWith({ robustness: {} }), 'robustness')).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({ robustness: false }), 'robustness')).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({ robustness: 0 }), 'robustness')).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({ robustness: '' }), 'robustness')).toBe(false);
    expect(deriveCompanionClaimSafe(factWith({ robustness: [] }), 'robustness')).toBe(false);
  });

  it('an allow-listed status of computed still short-circuits to claim-safe (regression guard)', () => {
    expect(deriveCompanionClaimSafe(factWith({ confidence_tier_status: 'computed' }), 'confidence_tier')).toBe(true);
    expect(deriveCompanionClaimSafe(factWith({ robustness_status: 'computed' }), 'robustness')).toBe(true);
  });
});
