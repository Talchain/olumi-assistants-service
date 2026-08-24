/**
 * ⭐ WHO AUTHORED THIS VALUE → HOW WIDELY MAY WE SAMPLE IT?
 *
 * The one place in `decision-review` that turns an `observed_state.source`
 * stamp into an {@link ExtractionType}, which `TYPE_MULTIPLIERS`
 * (`transforms/value-uncertainty-derivation.ts`) then multiplies the derived
 * `value_std` by — `explicit: 1.0` (tight), `inferred: 1.5` (wide).
 *
 * ## THE DEFECT THIS FILE REPLACES, AND ITS POLARITY
 *
 * `graph-normalizer.ts` used to derive the type inline:
 *
 *     source === 'brief_extraction' ? 'explicit' : 'inferred'
 *
 * beside a LOCAL `ObservedStateV3` interface declaring
 * `source?: 'brief_extraction' | 'cee_inference'` — a hand-maintained TWO-member
 * mirror of a TWELVE-member contract enum (CLAUDE.md trap 12). The ternary
 * looked exhaustive against the mirror and was blind to ten literals.
 *
 * ⚠ THE CONSEQUENCE WAS AN INVERTED SIGN, NOT A MISSING CASE.
 * `user_confirmed`, `user_override`, `user_edited`, `user_calibration`, `user`
 * and `panel_elicited` all fell to the `: 'inferred'` arm — the SAME arm as
 * `cee_inference`. A server-verified named participant's panel answer was
 * therefore sampled **50% WIDER** than the model's own reading of the brief.
 * Not "the same weight as a model guess": *worse than* a model guess.
 *
 * ## THE RULE, AND WHY IT IS THE ONLY DEFENSIBLE DIRECTION
 *
 * A value the user supplied MUST NOT be sampled wider than a value the model
 * inferred. The user is the authority on their own domain; widening their
 * figure tells the sampler to trust them less than it trusts itself.
 *
 * ## DERIVED, NOT MIRRORED
 *
 * {@link SOURCE_EXTRACTION_TYPE} is keyed on
 * `Record<KnownObservedStateSourceLiteral, ExtractionType>`, so the re-vendor
 * that adds a THIRTEENTH literal **fails typecheck here** rather than bucketing
 * it silently. That guard is the durable half of this change; the corrected
 * polarity is only the visible half.
 *
 * ## RELATIONSHIP TO `graph-readiness/obligation-provenance.ts` (trap 21)
 *
 * That module is the estate's other authority over this vocabulary, and it
 * answers a DIFFERENT QUESTION — *"may this gap be DEMANDED of the user?"*
 * (INV-P6). This one answers *"how widely may the sampler draw this number?"*.
 * The two agree on eleven of the twelve literals and the agreement is asserted
 * in `tests/unit/cee.graph-normalizer.provenance-width.test.ts`, which also
 * pins the ONE deliberate divergence exactly, in both directions:
 *
 *   `user_assumption` is `user_stated` for OBLIGATION (the user said it, so a
 *   gap over it may be demanded) and `inferred` for WIDTH (the user marked it
 *   as an assumption — a declared guess and a model's guess share the wide
 *   bucket). It is also today's behaviour, so nothing is re-tuned by it.
 *
 * ## ⛔ WHAT THIS FILE IS NOT, AND MUST NOT BECOME
 *
 * This is **not** the precision-weighting capability, and it must not be copied
 * into PLoT's shared std ladder as though it were. PLoT's own type
 * documentation (`plot-lite-service/src/types/engine-v3.ts:93-119`) records that
 * `observed_state.source` arrives as an UNVALIDATED FREE-TEXT STRING which PLoT
 * neither parses nor re-derives — so weighting on it at PLoT would let a caller
 * buy a narrower Monte Carlo by typing a string. That work is **gated on ROADMAP
 * 2.525 (forgeability)** and additionally requires widening the
 * analysis-affecting graph hash (`orchestrator-v5/context/graph-hash.ts`
 * `projectObservedState` picks `['value','baseline','cap']` and omits `std`).
 *
 * Inside CEE the stamp is sound — `observed_state.source` is
 * `field_class: 'provenance_owned'` in the shared editable-field table, i.e.
 * denied to the AI edit lane and written server-side by the executor — which is
 * why correcting the polarity HERE is safe while exporting it is not.
 */
import {
  type KnownObservedStateSourceLiteral,
} from '@talchain/schemas';

import type { ExtractionType } from '../transforms/value-uncertainty-derivation.js';

/**
 * The complete shared-contract vocabulary for `observed_state.source`, mapped to
 * the sampling-width bucket it earns.
 *
 * Exhaustive by TYPE. Adding a literal to the contract without adding it here is
 * a compile error, and so is naming one the contract does not declare.
 *
 * ⚠ ONLY `explicit` and `inferred` appear as targets, deliberately. `range` is
 * not a width — it switches `deriveValueUncertainty` onto a bounds-based branch
 * that needs `rangeMin`/`rangeMax`, so routing a provenance stamp there would
 * change the code path, not the multiplier. `observed` carries the same 1.0
 * multiplier as `explicit` with no additional meaning on this axis. Both are
 * left to the extraction pipeline, which is the producer that can actually tell
 * a range from a point.
 */
const SOURCE_EXTRACTION_TYPE: Readonly<
  Record<KnownObservedStateSourceLiteral, ExtractionType>
> = {
  // ── The user speaking, directly or through their own brief ──────────────
  // A brief is the user's own words, so a value extracted from it is the
  // user's figure. Byte-unchanged: this was the one arm the old ternary
  // already got right.
  brief_extraction: 'explicit',
  // The extraction-type sibling that producers also stamp into `source`. Its
  // own name is the answer; the old ternary sent it to `inferred`.
  explicit: 'explicit',
  // Every user-edit writer in the estate. Contract provenance, verbatim:
  //   user              — Model-tab factor-value edits
  //   user_override     — typed value (UI edit surfaces AND CEE
  //                       set_factor_value / chat edits)
  //   user_confirmed    — "confirm as is"
  //   user_edited       — OutputsDock transition bridge
  //   user_calibration  — inspector calibration
  user: 'explicit',
  user_override: 'explicit',
  user_confirmed: 'explicit',
  user_edited: 'explicit',
  user_calibration: 'explicit',
  // Elicited from a named participant through a panel round and verified by
  // CEE against its own collab store before the stamp is written
  // (`collab/apply-verification.ts` `verifyAppliedFrom`, six server-side
  // bindings). This is the most strongly attested value in the system and it
  // was the most widely sampled.
  panel_elicited: 'explicit',

  // ── The model's own estimates: unchanged, and they must stay unchanged ───
  cee_inference: 'inferred',
  inferred: 'inferred',
  cee_repair: 'inferred',

  // ── The one deliberate divergence from obligation-provenance ────────────
  // "Mark as assumption": the user is telling us this is a guess. A declared
  // guess and a model's guess share the wide bucket. Also today's behaviour,
  // so this line re-tunes nothing. See the header for why this is a different
  // answer from the same literal's OBLIGATION class.
  user_assumption: 'inferred',
};

/**
 * The bucket for an absent or unrecognised stamp.
 *
 * The shared contract is explicit that this must not be a guess:
 * *"Absence means the producer stamped no provenance — a consumer MUST NOT read
 * absence as any particular class; classify unknown/absent as neutral, never
 * guess."* On a WIDTH axis the honest-neutral answer is the wider bucket: not
 * knowing who authored a value is not a reason to sample it tightly. It is also
 * exactly today's behaviour, so no unstamped graph changes.
 */
export const UNATTRIBUTED_EXTRACTION_TYPE: ExtractionType = 'inferred';

/**
 * Map one `observed_state.source` stamp to its sampling-width bucket.
 *
 * The wire field is `z.string()` by deliberate contract design, so this accepts
 * `unknown` and falls to {@link UNATTRIBUTED_EXTRACTION_TYPE} for anything it
 * does not recognise — never a guessed tightening.
 */
export function extractionTypeForSource(source: unknown): ExtractionType {
  if (typeof source !== 'string') return UNATTRIBUTED_EXTRACTION_TYPE;
  if (Object.prototype.hasOwnProperty.call(SOURCE_EXTRACTION_TYPE, source)) {
    return SOURCE_EXTRACTION_TYPE[source as KnownObservedStateSourceLiteral];
  }
  return UNATTRIBUTED_EXTRACTION_TYPE;
}

/**
 * The mapping as data, exported so a test can assert it against the canonical
 * literal list and against `obligation-provenance`'s classification of the same
 * vocabulary. Not for product use — call {@link extractionTypeForSource}.
 */
export const SOURCE_EXTRACTION_TYPE_TABLE: Readonly<
  Record<KnownObservedStateSourceLiteral, ExtractionType>
> = SOURCE_EXTRACTION_TYPE;
