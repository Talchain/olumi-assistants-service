/**
 * THE flip-threshold review-card row predicate — ONE definition, two readers.
 *
 * WHY THIS MODULE EXISTS (amendment round on PR #776, review finding A1).
 * The coach's ContextPack may carry a flip point's digits only when those digits
 * are ALREADY ON THE USER'S SCREEN, and the thing that puts them there is the
 * `flip_threshold` review card built by `buildFlipThresholdCards`
 * (./phase3-blocks.ts). The first cut derived the licence from a PARALLEL
 * predicate that was *nearly* the card's — it keyed on
 * `factor_id | node_id | id` and did not require `factor_label` — and the
 * reviewer reproduced two live shapes (D1/D2) where the pack carried digits
 * while ZERO cards shipped. A licence derived from a hand-kept copy of someone
 * else's predicate is the dominant defect class (CLAUDE.md trap 12) wearing a
 * safety rule's clothes.
 *
 * So the predicate lives HERE, once, and BOTH the card builder and the licence
 * derivation call it. Drift is not "guarded against"; it is impossible.
 *
 * DELIBERATELY A LEAF: this module imports NOTHING. `context/analysis-signals.ts`
 * consumes it, and `compose/phase3-blocks.ts` (which imports
 * `compose/claim-safety-cage.ts` → `context/freshness.ts`) also consumes it, so
 * anything with an import edge here would risk a `context ⇄ compose` cycle.
 * That is also why `FLIP_THRESHOLD_CARD_BODY_MAX` and {@link truncateCardProse}
 * are defined here rather than imported from phase3-blocks.
 *
 * ⚠ AND A CORRECTION TO THIS FILE'S OWN FIRST DRAFT, because it claimed a
 * guarantee it does not provide. It said the flip path retains "one remaining
 * mirror" (`BODY_MAX`) pinned by a fail-loud conformance test. That is FALSE:
 * `buildFlipThresholdCards` calls {@link flipThresholdCardBody}, which uses the
 * constant BELOW, so both sides move together and there is NO mirror to pin —
 * the mutant that drifts this constant 300 → 260 correctly turns NOTHING red,
 * which is exactly what "no mirror" looks like. phase3-blocks' private
 * `BODY_MAX` still governs its OTHER card bodies; it no longer governs this one.
 * The conformance test therefore exists for the regression that IS reachable:
 * phase3-blocks reverting to its own `truncate(narrative, BODY_MAX)` and drifting
 * away. That mutant does bite.
 *
 * SCOPE — what this module does and does NOT establish. It carries the row-shape
 * exits ONLY. `buildFlipThresholdCards` applies TWO further drops that need the
 * canonical graph and the prose/schema validator, and compose applies a THIRD
 * gate above all of them:
 *
 *   exit 1  row shape (factor_id / factor_label / narrative)   ← HERE
 *   exit 2  `lookup.get(factor_id)` misses, or is not a factor ← needs the graph
 *   exit 3  `validateProseAndSchemaOrDrop` drops the block     ← needs the validator
 *   exit 4  `truncate(narrative, BODY_MAX)` cuts the digits    ← HERE, via
 *           {@link flipThresholdCardBody} (a CONTENT cut, not a drop)
 *   exit 5  `dr.flip_thresholds` is not an array               ← HERE (caller)
 *
 * and above all five: on a STALE turn compose emits ONLY the stale-rerun
 * coaching block and suppresses every Phase 3 block (compose.ts:1185, :1258-1262),
 * so NO card ships at all. The licence consumer gates on that separately.
 * Exits 2 and 3 remain the disclosed residual — see the consumer.
 */

/**
 * The card-body character ceiling for the flip card. Seeded from phase3-blocks'
 * `BODY_MAX` (300) at extraction time and now the SOLE authority for this one
 * card kind — `buildFlipThresholdCards` reads it through
 * {@link flipThresholdCardBody}. Moving it moves the emitted card AND the
 * licence together, which is why no test pins it to phase3-blocks' constant:
 * there is nothing to pin (see this file's header correction).
 */
export const FLIP_THRESHOLD_CARD_BODY_MAX = 300;

/**
 * The prose truncation `buildFlipThresholdCards` applies, byte-identical to the
 * `truncate` it used before extraction. The conformance test asserts the EMITTED
 * block's body equals this function's output, so a phase3-blocks reversion to a
 * private truncate that later drifts goes RED.
 */
export function truncateCardProse(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Bound on a producer-authored display string. A string of arbitrary length
 * must not be able to move the display-analysis char budget.
 *
 * ROADMAP 2.267 — MOVED HERE from `../context/analysis-signals.ts`, which
 * re-exports it so its consumers keep their import stable. It moved because
 * the display strings now have TWO readers: the licence (which asks whether the
 * user saw the digits) and {@link flipThresholdFallbackBody} (which PUTS them
 * on the card when the narrative is withheld). Two readers of one shape is
 * exactly the condition this module exists to serve.
 */
export const FLIP_DISPLAY_MAX_CHARS = 40;

/** A `decision_review.flip_thresholds[]` row that PASSES the card's row-shape gate. */
export interface FlipThresholdCardRow {
  readonly factor_id: string;
  readonly factor_label: string;
  readonly narrative: string;
  /**
   * The producer's display strings, bounded and trimmed — or null when the row
   * carries none that is usable.
   *
   * ⚠ THESE ARE NOT PART OF EXIT 1. A row with no usable display string still
   * PASSES the row-shape gate and still produces a card, exactly as before;
   * these fields only tell a consumer what it may quote. Making them required
   * would silently narrow the card gate and delete cards that ship today.
   */
  readonly current_display: string | null;
  readonly flip_display: string | null;
}

function readLicensedDisplay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > FLIP_DISPLAY_MAX_CHARS) return null;
  return trimmed;
}

/**
 * Exit 1, verbatim from the card builder: `factor_id` must be a non-empty
 * STRING under the key `factor_id` and nothing else (no `node_id` / `id`
 * fallback — that fallback was the D1/D2 drift); `factor_label` and `narrative`
 * must be non-empty after trimming.
 *
 * Returns the normalised row, or null when the card builder would `continue`.
 */
export function readFlipThresholdCardRow(raw: unknown): FlipThresholdCardRow | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const factorId = typeof entry.factor_id === 'string' ? entry.factor_id : '';
  const factorLabel = typeof entry.factor_label === 'string' ? entry.factor_label.trim() : '';
  const narrative = typeof entry.narrative === 'string' ? entry.narrative.trim() : '';
  if (factorId.length === 0 || factorLabel.length === 0 || narrative.length === 0) return null;
  return {
    factor_id: factorId,
    factor_label: factorLabel,
    narrative,
    current_display: readLicensedDisplay(entry.current_display),
    flip_display: readLicensedDisplay(entry.flip_display),
  };
}

/**
 * ROADMAP 2.267 (D-2) — the NON-NAMING card body, used when the option-naming
 * guard refuses the LLM's narrative.
 *
 * WHY THIS EXISTS. The witnessed defect (`witness-2265-targeted-flip.md` §4)
 * is a card that named `the Status Quo` while the row it was built from
 * attested `opt_bristol`. The card must not ship that sentence — but dropping
 * the card deletes the only dock surface a flip has, so the remedy is to keep
 * the card and lose the NAME, which is the one part of the sentence that was
 * never attested.
 *
 * ⚠ THE DIGITS ARE DELIBERATELY PRESERVED, AND THAT IS A CORRECTNESS
 * REQUIREMENT, NOT A NICETY. The coach's display LICENCE
 * (`../context/analysis-signals.ts:deriveFlipDisplayLicences`) grants the coach
 * permission to speak these digits on the strength of "the card put them on the
 * user's screen", and it models the card body as
 * {@link flipThresholdCardBody}`(narrative)` — it cannot see this guard (it has
 * no graph). A digit-free fallback would therefore leave the licence GRANTED
 * while the digits vanished from the screen: the coach would quote a number the
 * user never saw. Building the fallback out of the row's OWN display strings
 * keeps the licence's conclusion true in both branches by construction.
 *
 * When either display string is absent the licence is never granted in the
 * first place (that function `continue`s on a null display), so the
 * display-free sentence below cannot strand a licence either.
 *
 * The prose is not invented vocabulary: every clause below is byte-present in a
 * card that shipped on the live wire on 2026-08-01 — run B's card reads
 * *"If Operational Readiness Level increases from 50% to 77%, the leading
 * option would change."* So it is already proven to survive the forbidden-phrase
 * guard and the terminology rewrite.
 */
export function flipThresholdFallbackBody(
  factorLabel: string,
  currentDisplay: string | null,
  flipDisplay: string | null,
): string {
  const body =
    currentDisplay !== null && flipDisplay !== null
      ? `If ${factorLabel} moves from ${currentDisplay} to ${flipDisplay}, the leading option would change.`
      : `If ${factorLabel} moves far enough, the leading option would change.`;
  return truncateCardProse(body, FLIP_THRESHOLD_CARD_BODY_MAX);
}

/**
 * Exit 4 — the card BODY exactly as emitted. The licence consumer requires the
 * display digits to be present in THIS string, not in the untruncated
 * narrative: a 400-character narrative whose flip value sits at character 380
 * is cut out of the card, so the user never saw it.
 */
export function flipThresholdCardBody(narrative: string): string {
  return truncateCardProse(narrative, FLIP_THRESHOLD_CARD_BODY_MAX);
}
