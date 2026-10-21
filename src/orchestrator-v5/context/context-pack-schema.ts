/**
 * V5 ContextPack — the surviving constants and the model-facing run-delta type.
 *
 * The canonical `ContextPackSchema` and every sub-schema it composed were
 * deleted (Track 2 deletion 9, 22 Oct 2026) once nothing served reached them.
 * What remains is what reached code still imports:
 *   - `CONTEXT_PACK_BRIEF_CHAR_CAP` and `CONTEXT_PACK_RECENT_TURNS_CAP`
 *     (`./context-policy.ts`);
 *   - the `ContextPackRunDelta` type (the agent-lane run-delta readers and
 *     `./model-facing-run-delta.ts`).
 */

import type { RunDelta } from '@talchain/schemas/boundary';

/**
 * Lane 28 — brief pipeline: size bound for the projected decision brief.
 *
 * The brief is the user's OWN text (no display-safety banding applies — it is
 * not model output), but it is prompt-budget-bounded here so a pathological
 * 8,000-char persisted brief (the `scenarios.brief_text` DB CHECK ceiling)
 * cannot claim an unbounded share of the ~30k-char routing prompt. Truncation
 * is DISCLOSED, never silent: the projection carries a `truncated` flag and
 * the `original_chars` count (see `projectBrief` in
 * `./context-pack-assembler.ts`), so downstream consumers — and the LLM —
 * can see that the text is bounded.
 *
 * The Zod schema that once enforced this bound was deleted (Track 2 deletion
 * 9); the constant survives as the `brief` row of `./context-policy.ts`.
 */
export const CONTEXT_PACK_BRIEF_CHAR_CAP = 2000;

/**
 * Verbatim conversation memory window — the number of most-recent turns the
 * ContextPack carries in full (turns beyond it are folded into the rolling
 * summary). Raised 5 → 8 per the D-59-11 "S5 flip" (2026-07-24).
 *
 * SINGLE SOURCE OF TRUTH (FINAL-SWEEP, 2026-07-24; Codex quality F4). Previously
 * this literal was hand-typed in BOTH the assembler (CONTEXT_PACK_RECENT_TURNS_CAP)
 * and the policy (POLICY_VERBATIM_TURNS) with a "move both together" comment and a
 * conformance test pinning them equal — the exact hand-mirror trap-12 hazard. It
 * now lives in this cycle-safe leaf (both the assembler and the policy already
 * import from here) and both derive from it, so it CANNOT drift.
 */
export const CONTEXT_PACK_RECENT_TURNS_CAP = 8;

/**
 * RUN-OVER-RUN CONSEQUENCE — the model-facing face of the WIRE `RunDelta`
 * (`@talchain/schemas/boundary`), derived from the wire type so it cannot
 * drift from it.
 *
 * ⛔ The omitted keys are claim-safety omissions, not oversights — do not
 * "fix" them by passing them through:
 *   - `flip_thresholds`: the producer emits it FROZEN EMPTY
 *     (`RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED`, `compose/claim-safety-cage.ts`)
 *     because the flip-threshold join is deferred; serialising `[]` would tell
 *     a naive reader there are no flip thresholds, which is a claim.
 *   - SC-24's `endpoints` / `input_coverage` / `input_changes`: an
 *     `input_changes` row carries no author, so a model handed it would assert
 *     authorship nothing recorded (AIQ binding rule, schemas #76 5916401270).
 *   - `win_probabilities_unavailable` and `goal_chances` are likewise not part
 *     of the model-facing run delta.
 */
export type ContextPackRunDelta = Omit<RunDelta, 'flip_thresholds' | 'endpoints' | 'input_coverage' | 'input_changes' | 'win_probabilities_unavailable' | 'goal_chances'>;
