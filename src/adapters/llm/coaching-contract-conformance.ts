/**
 * Coaching contract conformance guard (2026-07-24, draft-honesty lane).
 *
 * WHY THIS EXISTS — the live defect it closes
 * -------------------------------------------
 * The day-3 drafting matrix observed `verification_status: failed_degraded`
 * ("Response does not conform to expected schema") on 8 of 9 SUCCESSFUL drafts.
 * The alarm was HONEST: the assembled response genuinely violated
 * `CEEDraftGraphResponseV1Schema` on `coaching`, every time coaching was
 * present. The one success that passed verification was the one whose coaching
 * pass was skipped for budget.
 *
 * Root cause: the post-draft coaching pass (ROADMAP 1.197, 2026-07-23) moved
 * coaching OUT of the draft grammar — where `DraftGraphOutput`'s Zod parse
 * enforced `StrengthenItemActionType` / `BiasType` at ingestion — into a
 * separate LLM call whose output reached the response with NO enum check. Its
 * prompt hand-typed a six-member `action_type` vocabulary that shares only two
 * members with the four-member contract enum, and offered `availability` as a
 * bias category, which is not a `BiasType`.
 *
 * WHAT THIS DOES
 * --------------
 * Makes any coaching block contract-valid before it is assembled onto the
 * response, deriving membership from the contract enums themselves
 * (`.options`) — never a hand-listed allowlist, which is the exact mirror that
 * drifted in the first place (CLAUDE.md trap 12).
 *
 * The handling is DELIBERATELY ASYMMETRIC, and the asymmetry is the honesty:
 *
 *  - `action_type` is a UI affordance CATEGORY. Coercing an unrecognised one to
 *    the generic canonical member asserts nothing false about the user's
 *    decision, and preserves the coaching text — which is where the value is.
 *    This follows the precedent already set twice in this codebase (the legacy
 *    `improve` → `add_constraint` map, and the Stage-5 missing-field default).
 *
 *  - `bias_category` / `bias_signals[*].type` are CLAIMS about the user's
 *    reasoning. Re-labelling `availability` as `anchoring` would be a
 *    FABRICATED CLAIM about a real person's thinking. So an unrecognised bias
 *    is DROPPED, never renamed: the optional `bias_category` field is removed,
 *    and a whole `bias_signals` entry whose required `type` cannot be named is
 *    removed. Losing a signal is honest; mislabelling one is not.
 *
 * Every substitution and every drop emits the already-registered
 * `cee.draft_graph.legacy_coaching_value_normalised` telemetry event, so
 * prompt-vs-contract drift is OBSERVABLE rather than silent. (Reused rather
 * than minting a new event: `field` / `original_value` / `normalised_value`
 * already carry the complete drift story, and the event registry is frozen.)
 */

import {
  BiasType,
  BriefCompleteness,
  StrengthenItemActionType,
  CausalClaimSchema,
  StrengthBand,
} from "@talchain/schemas";
import { emit, TelemetryEvents } from "../../utils/telemetry.js";

/**
 * The canonical vocabularies, DERIVED from the shared contract. Every
 * membership test and every prompt rendering in this service reads these —
 * there is no second copy to fall out of step.
 */
export const CANONICAL_ACTION_TYPES: readonly string[] = StrengthenItemActionType.options;
export const CANONICAL_BIAS_TYPES: readonly string[] = BiasType.options;

/**
 * ── causal_claims (added 2026-07-27, P0) ──────────────────────────────────
 *
 * WHY THESE LIVE HERE. The 2026-07-24 fix above derived the two COACHING
 * vocabularies from the contract and pinned them with a drift test — and left
 * the coaching-pass prompt's `causal_claims` line HAND-TYPED. It offered
 * `"type": "direct"` (the contract's discriminator is `direct_effect`) and the
 * retired 3-band `weak | moderate | strong` (the contract has been 4-band since
 * schemas 0.11.0). Both mismatches are independently fatal, and
 * `validateCausalClaims` calls `CausalClaimSchema.safeParse` raw, so EVERY claim
 * the prompt produced was dropped, on every draft turn, from 2026-07-23 until
 * this commit — ~209 completion tokens/turn generated and discarded.
 *
 * The hand-maintained mirror survived inside the very commit that removed its
 * siblings (CLAUDE.md trap 12). So these are derived from the contract by the
 * SAME mechanism, and the prompt interpolates them rather than reciting them.
 */
export const CANONICAL_STRENGTH_BANDS: readonly string[] = StrengthBand.options;

/**
 * The claim-type discriminators, read off the discriminated union itself
 * (`optionsMap` is keyed by the discriminator value), so a new claim variant in
 * a future contract appears here with no edit.
 */
export const CANONICAL_CAUSAL_CLAIM_TYPES: readonly string[] = [
  ...CausalClaimSchema.optionsMap.keys(),
].map(String);

/**
 * The one claim variant that carries `stated_strength` — the shape the coaching
 * prompt asks for. DERIVED by asking each union member which fields it declares,
 * never hand-typed: that is exactly the literal that drifted.
 *
 * Fails loud at module load if the contract stops having exactly one such
 * variant, rather than silently rendering a prompt nobody can satisfy (the
 * mirror must FAIL on drift, never assume-good).
 */
const strengthBearing = [...CausalClaimSchema.optionsMap.entries()]
  .filter(([, schema]) => "stated_strength" in schema.shape)
  .map(([discriminator]) => String(discriminator));
if (strengthBearing.length !== 1) {
  throw new Error(
    `coaching-contract-conformance: expected EXACTLY ONE CausalClaim variant carrying ` +
      `stated_strength, found ${strengthBearing.length} (${strengthBearing.join(" | ")}). ` +
      `The contract moved — the coaching prompt's causal-claim shape must be re-derived.`,
  );
}
export const STRENGTH_BEARING_CLAIM_TYPE: string = strengthBearing[0]!;

/**
 * `widening_log.brief_completeness` — the THIRD enum this prompt recited by
 * hand. It happens to be correct today, which is exactly why it is worth
 * deriving now: the causal-claims line was also correct once. Leaving a known
 * mirror standing beside the one you just removed is how the 24 Jul fix created
 * this 27 Jul P0.
 */
export const CANONICAL_BRIEF_COMPLETENESS: readonly string[] = BriefCompleteness.options;

/**
 * The generic canonical action used when the model supplies an action category
 * outside the contract. Asserted against the contract at module load so a
 * future enum change cannot leave a dangling literal here (fail loud, never
 * assume-good).
 */
export const GENERIC_ACTION_TYPE = "add_constraint";
if (!CANONICAL_ACTION_TYPES.includes(GENERIC_ACTION_TYPE)) {
  throw new Error(
    `coaching-contract-conformance: GENERIC_ACTION_TYPE "${GENERIC_ACTION_TYPE}" is not a member of ` +
      `StrengthenItemActionType (${CANONICAL_ACTION_TYPES.join(" | ")}) — the contract moved and this ` +
      `fallback must be re-chosen.`,
  );
}

/**
 * The ONE faithful semantic map. `clarify_goal` (retired coaching-pass
 * vocabulary) and `reframe_goal` (contract) mean the same thing, so mapping it
 * preserves meaning rather than inventing it. Everything else unrecognised
 * takes the generic fallback — we do not guess at semantics.
 *
 * Validated against the contract at module load.
 */
const FAITHFUL_ACTION_TYPE_MAP: Readonly<Record<string, string>> = {
  clarify_goal: "reframe_goal",
};
for (const [from, to] of Object.entries(FAITHFUL_ACTION_TYPE_MAP)) {
  if (!CANONICAL_ACTION_TYPES.includes(to)) {
    throw new Error(
      `coaching-contract-conformance: FAITHFUL_ACTION_TYPE_MAP maps "${from}" to "${to}", which is not a ` +
        `member of StrengthenItemActionType (${CANONICAL_ACTION_TYPES.join(" | ")}).`,
    );
  }
}

function isCanonicalActionType(v: unknown): v is string {
  return typeof v === "string" && CANONICAL_ACTION_TYPES.includes(v);
}

function isCanonicalBiasType(v: unknown): v is string {
  return typeof v === "string" && CANONICAL_BIAS_TYPES.includes(v);
}

/** Counts of what the guard had to do — surfaced for tests and callers. */
export interface CoachingConformanceResult {
  action_types_coerced: number;
  bias_categories_dropped: number;
  bias_signals_dropped: number;
}

/**
 * Force `coaching` onto the declared contract, in place.
 *
 * Safe to call on an absent / shape-invalid block (no-op). Idempotent: a
 * conformant block is returned untouched with all-zero counts.
 */
export function enforceCoachingContract(
  coaching: unknown,
  requestId: string | undefined,
): CoachingConformanceResult {
  const result: CoachingConformanceResult = {
    action_types_coerced: 0,
    bias_categories_dropped: 0,
    bias_signals_dropped: 0,
  };
  if (!coaching || typeof coaching !== "object") return result;
  const c = coaching as Record<string, unknown>;

  // ── strengthen_items[*] ────────────────────────────────────────────────
  const items = c.strengthen_items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;

      // action_type: coerce (affordance category — nothing false is asserted).
      // A missing action_type takes the same generic fallback: the contract
      // requires the field, so absence and off-contract both resolve here.
      const action = obj.action_type;
      if (!isCanonicalActionType(action)) {
        const original = action === undefined || action === null ? "<missing>" : String(action);
        const normalised =
          (typeof action === "string" ? FAITHFUL_ACTION_TYPE_MAP[action] : undefined) ??
          GENERIC_ACTION_TYPE;
        emit(TelemetryEvents.DraftGraphLegacyCoachingValueNormalised, {
          field: "coaching.strengthen_items[*].action_type",
          original_value: original,
          normalised_value: normalised,
          request_id: requestId,
        });
        obj.action_type = normalised;
        result.action_types_coerced += 1;
      }

      // bias_category: OPTIONAL in the contract, and a claim about the user.
      // Drop rather than re-label.
      if (obj.bias_category !== undefined && !isCanonicalBiasType(obj.bias_category)) {
        emit(TelemetryEvents.DraftGraphLegacyCoachingValueNormalised, {
          field: "coaching.strengthen_items[*].bias_category",
          original_value: String(obj.bias_category),
          normalised_value: "<dropped>",
          request_id: requestId,
        });
        delete obj.bias_category;
        result.bias_categories_dropped += 1;
      }
    }
  }

  // ── bias_signals[*] ────────────────────────────────────────────────────
  // `type` is REQUIRED by the contract, so an unnameable bias cannot be
  // represented at all — drop the whole signal rather than assert a different
  // bias about the user.
  const signals = c.bias_signals;
  if (Array.isArray(signals)) {
    const kept: unknown[] = [];
    for (const sig of signals) {
      if (!sig || typeof sig !== "object") {
        kept.push(sig);
        continue;
      }
      const obj = sig as Record<string, unknown>;
      if (isCanonicalBiasType(obj.type)) {
        kept.push(sig);
        continue;
      }
      emit(TelemetryEvents.DraftGraphLegacyCoachingValueNormalised, {
        field: "coaching.bias_signals[*].type",
        original_value: obj.type === undefined || obj.type === null ? "<missing>" : String(obj.type),
        normalised_value: "<dropped>",
        request_id: requestId,
      });
      result.bias_signals_dropped += 1;
    }
    if (kept.length !== signals.length) {
      c.bias_signals = kept;
    }
  }

  return result;
}
