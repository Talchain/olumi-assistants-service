/**
 * Wave-3 λ×σ COMPOSITION (ROADMAP 1.203) — the deterministic lens selector's
 * grounding-field map composes with the claim-safety cage.
 *
 * The selector (`lens-selector.ts`) owns the single lens→grounding-field map
 * (`GROUNDING_FIELD_BY_RATIONALE`); the cage (`claim-safety-cage.ts`) owns which
 * fields may be surfaced (`TIER2_COACHING_ALLOWLIST`). This test LOCKS the two
 * together so they cannot silently desync (trap-12 derive-don't-mirror): every
 * rationale's grounding field must classify deterministically under the cage —
 * allow-listed → usable, everything else → the honest denial. If a future
 * rationale grounds in an unexpected field, or the allow-list drifts, exactly
 * one assertion here goes RED.
 *
 * Mutation witness: moving `option_comparison` INTO the allow-list (the drift the
 * cage exists to prevent) turns the outcome-bearing-lens assertion RED.
 */
import { describe, expect, it } from 'vitest';

import {
  GROUNDING_FIELD_BY_RATIONALE,
  type LensRationaleCode,
} from '../lens-selector.js';
import {
  classifyClaimUsable,
  TIER2_COACHING_ALLOWLIST,
  type ClaimUsableInput,
} from '../claim-safety-cage.js';

// The cage's four gates all OPEN except lock 2 (the allow-list) — so this test
// isolates the allow-list decision, which is exactly the selector↔cage coupling.
const FULLY_OPEN: ClaimUsableInput = {
  tier2Enabled: true,
  companionStatusClaimSafe: true,
  freshness: 'fresh',
};

describe('λ×σ composition — selector grounding fields ⟷ claim-safety cage', () => {
  const rationales = Object.keys(GROUNDING_FIELD_BY_RATIONALE) as LensRationaleCode[];

  it('every rationale grounds in a field the cage classifies (allow-listed → usable; else denied)', () => {
    // The map is compile-exhaustive over LensRationaleCode, so this iterates the
    // WHOLE lens set — a new lens/rationale is force-included by the compiler.
    expect(rationales.length).toBeGreaterThan(0);
    for (const code of rationales) {
      const field = GROUNDING_FIELD_BY_RATIONALE[code];
      const decision = classifyClaimUsable(field, FULLY_OPEN);
      const label = `${code} → ${field}`;
      if (TIER2_COACHING_ALLOWLIST.has(field)) {
        expect(decision.usable, label).toBe(true);
      } else {
        expect(decision.usable, label).toBe(false);
      }
    }
  });

  it('outcome-bearing lenses ground in option_comparison → the cage DENIES (the outcome number stays omitted until G2/Neil)', () => {
    // WIN_PROB_MODERATE (pre-mortem) and WHATIF_EXPLORE_DRIVER (what-if) both make
    // a claim about the OUTCOME (option win probability). That field is NOT
    // allow-listed by design, so σ denies surfacing its value — the honest
    // coupling that keeps the counterfactual/pre-mortem outcome number omitted.
    expect(GROUNDING_FIELD_BY_RATIONALE.WIN_PROB_MODERATE).toBe('option_comparison');
    expect(GROUNDING_FIELD_BY_RATIONALE.WHATIF_EXPLORE_DRIVER).toBe('option_comparison');
    expect(classifyClaimUsable('option_comparison', FULLY_OPEN).usable).toBe(false);
  });

  it('the intrinsic-lens grounding fields are all allow-listed (they surface safe by omission today, cage-ready for values)', () => {
    for (const field of ['factor_sensitivity', 'confidence_tier'] as const) {
      expect(TIER2_COACHING_ALLOWLIST.has(field), field).toBe(true);
      expect(classifyClaimUsable(field, FULLY_OPEN).usable, field).toBe(true);
    }
  });
});
