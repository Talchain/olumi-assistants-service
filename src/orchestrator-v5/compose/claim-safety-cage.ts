/**
 * V5 claim-safety cage — Tier-2 gate + Tier-3 deny set (Brief 5).
 *
 * THE CAGE. This module makes the Brief 4 claim-permission doctrine
 * MECHANICAL instead of advisory: a single fail-closed decision function
 * every coaching / DSK / lens surfacing path must consult before making a
 * claim about a science-bearing enrichment field. It surfaces nothing
 * itself and relaxes nothing. As of ROADMAP 1.203 (wave-3 σ) it is
 * ACTIVATED: `isClaimUsable` has a live caller (`composeCagedField` in
 * phase3-blocks.ts) and Lock 2 is A1-seeded with the three
 * review-blessed candidate fields (see {@link TIER2_COACHING_ALLOWLIST}).
 *
 *   - Lock 1: the caller's `tier2Enabled` activation signal. The former
 *     CEE_COACHING_TIER2_ENABLED env flag was deleted 2026-07-20 (O-7
 *     wave 2, Appendix A4 — then zero production callers); the deliberate
 *     activation signal is now `TIER2_ACTIVATION_ENABLED` (a reviewed code
 *     constant per Brief 4 gate G2 / the no-env-gates doctrine), NOT an env
 *     bit — see phase3-blocks.ts.
 *   - Lock 2: {@link TIER2_COACHING_ALLOWLIST} — A1-seeded (wave-3 σ) with
 *     the three {@link TIER2_CANDIDATE_FIELDS}. Moving any FURTHER field
 *     into it is Brief 4 gate G2: a separate, per-field decision with
 *     science sign-off (Neil / Jinghui, Brief 4 §9). Paul reviews the
 *     seeded set in-PR.
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
 * Lock 2 — the active Tier-2 claim allow-list. A1-SEEDED (ROADMAP 1.203
 * wave-3 σ) with the three {@link TIER2_CANDIDATE_FIELDS} — the
 * review-blessed, display-safe candidates (`factor_sensitivity`,
 * `confidence_tier`, `robustness`). Paul reviews the seeded set in-PR;
 * Neil ratifies per-field. Append-only via a reviewed G2 decision; the
 * seed is a REVIEWED CODE CHANGE (populated at construction, before the
 * mutators are sealed), never a runtime or env mutation. The unit test
 * pins the exact seeded membership so an accidental addition/removal fails
 * the required gate.
 *
 * Runtime immutability is REAL, not cosmetic: `Object.freeze` on a Set
 * does not stop `.add()/.delete()/.clear()` (they mutate internal slots),
 * so the mutators are overridden to throw — a runtime `.add()` from any
 * code that cast away the ReadonlySet type fails loudly instead of
 * silently opening lock 2 (adversarial review, Mission 2).
 */
export const TIER2_COACHING_ALLOWLIST: ReadonlySet<string> = (() => {
  // G2 seed: the review-blessed candidate fields, populated HERE (a reviewed
  // code change) before the mutators are sealed to throw.
  const set = new Set<string>(TIER2_CANDIDATE_FIELDS);
  const throwReadonly = (): never => {
    throw new Error('TIER2_COACHING_ALLOWLIST is read-only — populating a field is Brief 4 gate G2, a reviewed code change, never a runtime mutation.');
  };
  set.add = throwReadonly;
  set.delete = throwReadonly;
  set.clear = throwReadonly;
  return Object.freeze(set);
})();

/**
 * Lock 1 — the deliberate Tier-2 activation signal (Brief 4 gate G2). Replaces
 * the deleted CEE_COACHING_TIER2_ENABLED env flag with a REVIEWED CODE CONSTANT
 * per the no-env-gates doctrine: activation is a code change under review, not a
 * runtime/env bit. Callers thread this as `ClaimUsableInput.tier2Enabled`.
 * Wave-3 σ (ROADMAP 1.203) sets it ON now that Lock 2 carries an A1-seeded set
 * and `composeCagedField` is a live caller. Rollback = code revert.
 */
export const TIER2_ACTIVATION_ENABLED = true;

/**
 * The four RATIFIED, literal-bearing Tier-3 deny keys (Brief 5 §1
 * "coverage honesty": these are the Tier-3 categories that have a field
 * today; the vocabulary-only categories — scientific-warning wording,
 * report-level confidence, evidence quality, bias claims,
 * provenance-as-claim — have no ratified string form yet and are
 * escalated to Brief 4 §9, NOT silently covered here).
 *
 * Blocked outright from user-facing strings, both locks notwithstanding.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⭐ ROADMAP 2.205 — THE PRACTICAL RESOLUTION, ADJUDICATED 2026-07-31.
 *
 * 2.205 asked: *is the Tier-3 deny composition-only by design, or do LLM prose
 * echoes need a numeric-token scan?* (raised at
 * `phase3-blocks.ts:1478`, after that file measured that `buildFlipThresholdCards`
 * already ships narratives the prompt ORDERS to restate unrounded flip values).
 *
 * THE RULE (orchestrator ruling; Paul veto open; grounded in his data+coaching
 * doctrine): **a number already DISPLAY-LICENSED to the USER on the same turn
 * is speakable by the coach — same licence, same register. The Tier-3 deny
 * continues to bind any value NOT shown to the user.**
 *
 * WHAT CHANGED, AND WHAT DID NOT.
 *   - NOTHING in this file changed. `flip_thresholds` is still Tier-3
 *     claim-denied, `classifyClaimUsable` still denies it at the first fork,
 *     and no COMPOSITION surface may author a flip number from the raw field.
 *   - What the resolution permits is narrower and lives entirely in the
 *     coach's CONTEXT ASSEMBLY: the ContextPack may carry the flip point as
 *     the PRE-FORMATTED DISPLAY STRING the producer already wrote for the
 *     user's screen, for exactly those factors whose flip_threshold review card
 *     shipped. Trace + fail-closed rules:
 *     `../context/analysis-signals.ts` → `deriveFlipDisplayLicences`;
 *     float cage + the emitted string:
 *     `../format/format-analysis-for-context.ts` → `formatFlipPointDisplay`.
 *   - The two OTHER quantities the un-banding brief proposed did NOT qualify
 *     and stay banded: the sensitivity magnitude (no CEE surface renders it —
 *     compose reads only `factor_sensitivity[].confidence`, banded, and
 *     `.interpretation`, prose) and the VOI score (`m1_coaching` is
 *     TRANSPORT-banned, see {@link TIER3_TRANSPORT_BANNED_FIELDS} — it never
 *     reaches the wire, so it can never have a display licence).
 *   - The general question 2.205 raised — whether producer prose echoes need a
 *     numeric-token scan — is NOT answered by this ruling and stays open. The
 *     ruling is about what the COACH may be TOLD, not about widening what any
 *     producer may SAY.
 *
 * Evidence, with the complete manifests and the scope of each absence claim:
 * `PHASE0-EVIDENCE-2026-07-28/fix-context-unband.md`.
 * ─────────────────────────────────────────────────────────────────────────────
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
  /**
   * Lock 1 — the Tier-2 activation signal. No config field exists for this
   * any more (CEE_COACHING_TIER2_ENABLED deleted 2026-07-20, O-7 wave 2);
   * a production caller must wire a deliberate, separately-approved
   * activation decision. Defaults CLOSED like everything else here.
   */
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
 * The reason a claim was DENIED, in fork order. Lets a caller emit a
 * reason-tagged drop-observability event (never a silent no-op — the
 * broken-alarm class) without re-deriving the fork logic.
 */
export type ClaimDenyReason =
  | 'tier3_denied' // a Tier-3 leak-block field — denied outright
  | 'tier2_not_activated' // Lock 1 off (tier2Enabled !== true)
  | 'not_allowlisted' // Lock 2 — field not in the seeded allow-list
  | 'companion_unverified' // companion status not verified claim-safe
  | 'not_fresh'; // freshness verdict is not 'fresh'

/**
 * THE decision, with its reason. Fail-closed at every fork; an unknown
 * field is NOT claim-usable (it is neither allow-listed nor exempt —
 * deny-by-default covers fields that have not even been classified yet).
 * This is the SINGLE fork; both {@link isClaimUsable} (the boolean) and any
 * reason-tagged observability derive from it, so they cannot drift.
 */
export function classifyClaimUsable(
  field: string,
  input: ClaimUsableInput,
): { readonly usable: true } | { readonly usable: false; readonly reason: ClaimDenyReason } {
  // Tier-3 deny — both locks notwithstanding.
  if (TIER3_LEAK_BLOCK_FIELDS.includes(field)) return { usable: false, reason: 'tier3_denied' };
  // Lock 1 — master flag (default OFF).
  if (!input.tier2Enabled) return { usable: false, reason: 'tier2_not_activated' };
  // Lock 2 — allow-list (only the A1-seeded fields pass).
  if (!TIER2_COACHING_ALLOWLIST.has(field)) return { usable: false, reason: 'not_allowlisted' };
  // Companion-status gate — unverified ⇒ closed.
  if (input.companionStatusClaimSafe !== true) return { usable: false, reason: 'companion_unverified' };
  // Freshness gate — only a confirmed-fresh verdict may ground a claim.
  if (input.freshness !== 'fresh') return { usable: false, reason: 'not_fresh' };
  return { usable: true };
}

/**
 * THE decision function: may a coaching / DSK / lens surface make a claim
 * that uses `field`? Delegates to {@link classifyClaimUsable} (the single
 * fork) — behaviour is unchanged from the original boolean gate.
 */
export function isClaimUsable(field: string, input: ClaimUsableInput): boolean {
  return classifyClaimUsable(field, input).usable;
}

/**
 * Convenience for leak tests and assurance scanners: true when `field`
 * is one of the four ratified Tier-3 deny keys.
 */
export function isTier3LeakBlocked(field: string): boolean {
  return TIER3_LEAK_BLOCK_FIELDS.includes(field);
}

/**
 * Reduced-samples disclosure presence check (claim-safety ruling on
 * `parallel-briefs/W2-CLAIM-SAFETY-CASE.md`, Option B — 2026-07-11).
 *
 * PLoT discloses that it reduced the simulation count for a complex model
 * by riding a `SAMPLES_REDUCED_FOR_COMPLEXITY` code on its warning channel
 * (a Tier-3 deny field) and, belt-and-braces, on `critiques`. The ruling
 * classifies a presence-only membership test on the CODE as deterministic
 * honest disclosure (density-wall class), NOT a claim from the field's
 * content — nothing here reads, stores, or interpolates any value or
 * wording from the entries.
 *
 * The check lives in THIS file by design: the cage stays the sole owner of
 * what may be presence-tested against Tier-3 fields, so no user-facing
 * string producer ever carries the deny-key literal (the static scan in
 * tests/contract/tier3-leak-guard.static.guard.test.ts stays maximally
 * strict). Consumption is pinned to exactly ONE call site
 * (tests/contract/reduced-samples-disclosure-single-site.guard.test.ts) —
 * a second consumer requires a fresh claim-safety review, not a new import.
 */
export function hasReducedSamplesDisclosure(
  response: Record<string, unknown>,
): boolean {
  for (const key of ['inference_warnings', 'critiques'] as const) {
    const arr = response[key];
    if (
      Array.isArray(arr) &&
      arr.some(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          (entry as Record<string, unknown>).code === 'SAMPLES_REDUCED_FOR_COMPLEXITY',
      )
    ) {
      return true;
    }
  }
  return false;
}
