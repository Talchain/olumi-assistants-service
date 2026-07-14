/**
 * Baseline identity — SINGLE SOURCE OF TRUTH for reading the effective
 * `is_baseline` flag across the two surfaces an option can carry it on
 * (`node.is_baseline` and `node.data.is_baseline`).
 *
 * WHY THIS EXISTS
 *
 * The draft LLM sometimes emits the two surfaces DISAGREEING on the same
 * option — measured `node.is_baseline: true` with `data.is_baseline: false`
 * (5/30 samples, both prompt versions). Every consumer that decides "is this
 * the status-quo / baseline option?" MUST agree on how to reconcile that
 * split, otherwise the same option is a baseline on one code path and not on
 * another (the F3 / ROADMAP 2.55 defect: the #456 auto-baseline-dedup reader
 * resolved split→true, but schema-v3's `dataBaseline ?? nodeBaseline` let
 * `data:false` MASK the explicit `node:true`, so the DISPLAY / analysis-ready
 * path mis-rendered the option as "not the current arrangement").
 *
 * RULE: an EXPLICIT `true` on EITHER surface wins. Everything else keeps the
 * historical data-first semantics.
 *
 * Truth table (data.is_baseline × node.is_baseline → result):
 *
 *   data \ node │ true   false   absent
 *   ────────────┼──────────────────────
 *   true        │ true   true    true
 *   false       │ true*  false   false
 *   absent      │ true   false   undefined
 *
 *   (*) the split-field cell — explicit true is never masked by the sibling
 *       surface's false. false/absent combinations are unchanged:
 *       explicit-false-only reads false (never baseline/deletion-eligible),
 *       absent-both reads undefined (heuristics' territory). Non-boolean junk
 *       on a surface is ignored.
 */

/** Minimal shape an option can carry the baseline flag on. Structurally
 *  compatible with the pipeline `OptionLike`, the raw V1 option node, and a
 *  flattened V3 option (which only ever populates the node-level surface). */
export interface BaselineFlagSurfaces {
  readonly is_baseline?: boolean;
  readonly data?: {
    readonly is_baseline?: boolean;
  };
}

/**
 * Read the effective `is_baseline` across both surfaces.
 *
 * @returns `true`/`false` when either surface carries an explicit boolean,
 *          `undefined` when neither does (caller may then fall back to
 *          label/id heuristics).
 */
export function readIsBaseline(o: BaselineFlagSurfaces): boolean | undefined {
  // Explicit true on either surface wins — never masked by the sibling
  // surface's false.
  if (o.data?.is_baseline === true || o.is_baseline === true) return true;
  if (typeof o.data?.is_baseline === "boolean") return o.data.is_baseline;
  if (typeof o.is_baseline === "boolean") return o.is_baseline;
  return undefined;
}
