/**
 * V5 claim-safety cage — Tier-2 gate + Tier-3 deny set (Brief 5).
 *
 * THE CAGE, NOT THE ACTIVATION. This module makes the Brief 4
 * claim-permission doctrine MECHANICAL instead of advisory: a single
 * fail-closed decision function every future coaching / DSK surfacing
 * path must consult before making a claim about a science-bearing
 * enrichment field. It surfaces nothing itself, relaxes nothing, and
 * activates no field:
 *
 *   - Lock 1: `config.cee.coachingTier2Enabled`
 *     (CEE_COACHING_TIER2_ENABLED, default OFF).
 *   - Lock 2: {@link TIER2_COACHING_ALLOWLIST} — ships EMPTY. Moving a
 *     single field into it is Brief 4 gate G2: a separate, per-field
 *     decision with science sign-off (Neil / Jinghui, Brief 4 §9).
 *   - Tier-3 deny: {@link TIER3_LEAK_BLOCK_FIELDS} — blocked outright
 *     from every user-facing string, regardless of both locks.
 *
 * Decision order (Brief 5 §2, fail-closed at every fork):
 *   Tier-3 deny → Tier-2 lock 1 (flag) → lock 2 (allow-list) →
 *   companion-status gate → freshness gate.
 *
 * Two orthogonal axes (Brief 4 §0 C1): TRANSPORT-cleanliness is owned by
 * the `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` keep-list + strip in
 * compose.ts — this module does not touch it. CLAIM-permission — what
 * Olumi may SAY about a field — is owned here. A field can be
 * transport-clean yet claim-locked (canonical example: `flip_thresholds`
 * rides the wire but is Tier-3 claim-denied).
 *
 * Relationship to the frame's `claim-permissions.ts` (Increment 1): that
 * module holds the CLASS-level default-held table the frame annotates
 * responses with; this module is the FIELD-level runtime gate ("the
 * later, separately-reviewed increment [that] materialises the policy
 * logic" its header reserves). Both default to held/denied; neither
 * relaxes the other.
 *
 * The assurance-side scanner (tools/v5-journey-replay/assurance/
 * blocked-claim-fields.ts) imports {@link TIER3_LEAK_BLOCK_FIELDS} from
 * here, so the harness and the runtime cage share ONE source of truth
 * for the ratified Tier-3 keys and cannot drift.
 */

import type { AnalysisFreshness } from '../context/freshness.js';

/**
 * Tier-2 CANDIDATE fields (Brief 4 §3): deterministic, source-clean,
 * transport-kept, structured — usable for claims ONLY after G2 approval
 * moves them into {@link TIER2_COACHING_ALLOWLIST}. Documented here so
 * the candidate set is code-visible; membership in this list grants
 * NOTHING.
 */
export const TIER2_CANDIDATE_FIELDS: readonly string[] = Object.freeze([
  'factor_sensitivity',
  'confidence_tier',
  'robustness',
]);

/**
 * Lock 2 — the active Tier-2 claim allow-list. SHIPS EMPTY (Brief 5 §1:
 * "either lock alone yields zero surfaced fields"). Append-only via a
 * reviewed G2 decision; never populated by default. The unit test pins
 * emptiness so accidental population fails the required gate.
 *
 * Runtime immutability is REAL, not cosmetic: `Object.freeze` on a Set
 * does not stop `.add()/.delete()/.clear()` (they mutate internal slots),
 * so the mutators are overridden to throw — a runtime `.add()` from any
 * code that cast away the ReadonlySet type fails loudly instead of
 * silently opening lock 2 (adversarial review, Mission 2).
 */
export const TIER2_COACHING_ALLOWLIST: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  const throwReadonly = (): never => {
    throw new Error('TIER2_COACHING_ALLOWLIST is read-only — populating a field is Brief 4 gate G2, a reviewed code change, never a runtime mutation.');
  };
  set.add = throwReadonly;
  set.delete = throwReadonly;
  set.clear = throwReadonly;
  return Object.freeze(set);
})();

/**
 * The four RATIFIED, literal-bearing Tier-3 deny keys (Brief 5 §1
 * "coverage honesty": these are the Tier-3 categories that have a field
 * today; the vocabulary-only categories — scientific-warning wording,
 * report-level confidence, evidence quality, bias claims,
 * provenance-as-claim — have no ratified string form yet and are
 * escalated to Brief 4 §9, NOT silently covered here).
 *
 * Blocked outright from user-facing strings, both locks notwithstanding.
 */
export const TIER3_LEAK_BLOCK_FIELDS: readonly string[] = Object.freeze([
  'flip_thresholds',
  'edge_e_values',
  'inference_warnings',
  'm1_coaching',
]);

/**
 * The subset of Tier-3 deny fields that are ALSO transport-banned (not in
 * the P0B keep-list): these must not appear on the WIRE at all, so the
 * response-finaliser backstop DELETES them from block enrichment rather
 * than merely suppressing known prose leaves — an unknown prose field
 * inside a transport-banned subtree must not ride to users just because
 * the walker did not know its name (adversarial review, Mission 2).
 *
 * Deliberately NOT the whole Tier-3 set: `flip_thresholds`,
 * `edge_e_values` and `inference_warnings` are keep-listed
 * (transport-clean, claim-denied — Brief 4 C1's two-axes split), so
 * deleting them would break the transport contract. And deliberately
 * NOT applied on the enricher/fact path: the m1 adapter reads
 * m1_coaching's structured enums for the v11 prompt; deleting the
 * subtree there would recreate the adapter-v1 starvation regression.
 */
export const TIER3_TRANSPORT_BANNED_FIELDS: readonly string[] = Object.freeze([
  'm1_coaching',
]);

/** Inputs to the claim-permission decision. Everything defaults CLOSED. */
export interface ClaimUsableInput {
  /** Lock 1 — pass `config.cee.coachingTier2Enabled`. */
  readonly tier2Enabled: boolean;
  /**
   * Companion-status gate (Brief 5 §10): the field's companion status
   * (e.g. `option_comparison_status === 'computed'`) verified claim-safe
   * by the CALLER. Omitted ⇒ false ⇒ not claim-usable — a caller that
   * has not wired companion-status verification cannot pass the gate.
   */
  readonly companionStatusClaimSafe?: boolean;
  /**
   * Freshness gate (Brief 5 §9): the live `deriveAnalysisFreshness`
   * verdict. Anything but 'fresh' — including absence — is not
   * claim-usable (absent / stale / unknown / degraded ⇒ closed).
   */
  readonly freshness?: AnalysisFreshness | null;
}

/**
 * THE decision function: may a coaching / DSK surface make a claim that
 * uses `field`? Fail-closed at every fork; an unknown field is NOT
 * claim-usable (it is neither allow-listed nor exempt — deny-by-default
 * covers fields that have not even been classified yet).
 */
export function isClaimUsable(field: string, input: ClaimUsableInput): boolean {
  // Tier-3 deny — both locks notwithstanding.
  if (TIER3_LEAK_BLOCK_FIELDS.includes(field)) return false;
  // Lock 1 — master flag (default OFF).
  if (!input.tier2Enabled) return false;
  // Lock 2 — allow-list (ships empty ⇒ all fields denied).
  if (!TIER2_COACHING_ALLOWLIST.has(field)) return false;
  // Companion-status gate — unverified ⇒ closed.
  if (input.companionStatusClaimSafe !== true) return false;
  // Freshness gate — only a confirmed-fresh verdict may ground a claim.
  if (input.freshness !== 'fresh') return false;
  return true;
}

/**
 * Convenience for leak tests and assurance scanners: true when `field`
 * is one of the four ratified Tier-3 deny keys.
 */
export function isTier3LeakBlocked(field: string): boolean {
  return TIER3_LEAK_BLOCK_FIELDS.includes(field);
}
