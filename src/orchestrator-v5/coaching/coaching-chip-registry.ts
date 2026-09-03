/**
 * ⭐ THE MISSING HALF OF THE TYPED COACHING-INTENT ARM — the chip identities
 * CEE ITSELF composes.
 *
 * ── THE DEFECT, MEASURED ON A REAL SESSION ─────────────────────────────────
 * `typed-intent-directive.ts` routes a coaching intent to its authored method
 * when the turn carries `chip.intent`. It works, and for the DGAI
 * pre-analysis sparks it is the whole answer. It is also structurally unable
 * to fire for any affordance CEE composed, and that is not a gap in the
 * registry — it is a gap in the WIRE:
 *
 *   - the outbound chip is `ActionSchema` (`@talchain/schemas` 0.50.0,
 *     `dist/boundary/olumi-response.d.ts:2`), declared `"strict"` with exactly
 *     `{ id, label, message, action_type?, detail? }`. There is NO `intent`
 *     key, so CEE cannot put one on a chip it emits, and adding one would be a
 *     shared-contract change in a different repo.
 *   - the only other channel a producer has is a CoachingBlock's
 *     `action_intent`, and its own producer comment says what that is worth:
 *     "It reaches the DOM as `data-action-intent` and NOTHING MORE …
 *     `SendChipMeta` has no `intent` field at all, so the chip sends
 *     `action_prompt` as an ordinary free-text turn. This is NOT a typed
 *     dispatch." (`handlers/draft-option-widening-blocks.ts:715-720`.)
 *
 * So `payload.chip.intent` is never populated for a CEE-authored affordance
 * and `resolveCoachingIntent` returns `undefined` every time. Live cost, from
 * the 3 Sep 2026 manual capture (`olumi-programme-docs`
 * `artefacts/manual-test-2026-09-03/olumi-debug-f2e2df1b-20260903.json`): at
 * 13:47:30Z the user clicked **"Run a pre-mortem"** — the chip
 * `chip_prompt_run_pre_mortem` composed by `compose/chip-generator.ts`'s
 * decide-stage fragile-robustness rule, identified by its message length of
 * 61, which matches that rule's em-dash phrasing exactly. The reply
 * (turn index 12) opened "If staying founder-led turned out to be the wrong
 * call…" and returned the same three drivers — ICP clarity, the
 * missing-integrations story, sales spend — as the `explain_results` turns
 * either side of it. **The pre-mortem method never reached the model.**
 *
 * ── WHY `chip.id` IS THE CHANNEL, AND THAT IT IS WIRE-WITNESSED ────────────
 * The UI already sends CEE's own chip id straight back. `sendChip` threads
 * `chip.id` into `dispatchAction` (`useConversation.ts:5939`), `buildChipMeta`
 * promotes it, and `buildV5Payload` writes `base.chip.id` for any chip- or
 * chip_click-sourced turn (`buildPayload.ts:202-208`) — no `action_type`
 * required, which is exactly the prompt-chip case. The same capture carries
 * the round-trip as a fact rather than a reading:
 * `payloads.cee_request.chip = { id: "chip_action_rerun_analysis_after_mutation",
 * action_type: "run_analysis" }` — a CEE-authored id, echoed verbatim.
 *
 * So the fix needs no schema change, no UI change and no new field: CEE reads
 * back the identity it issued.
 *
 * ── ⚠ IT STEERS, IT NEVER SUBSTITUTES ──────────────────────────────────────
 * This module changes WHICH METHOD the coach is asked to work through. It
 * composes no user-facing copy and claims no turn, so the floor stays what
 * `typed-intent-directive.ts` already argues: today's prose answer, plus a
 * frame. Nothing here can return less than the LLM would have returned,
 * because nothing here returns an answer.
 *
 * ── ⭐⭐ WHY THIS LIST IS NOT A HAND-MAINTAINED MIRROR ──────────────────────
 * It IS a hand-written list, and pretending otherwise would be the estate's
 * signature defect (trap 12). A guard DERIVED from this map could only ever
 * prove that its consumers agree with it — never that it is SHORT (trap 12d).
 * The completeness check therefore comes from OUTSIDE the list:
 * `__tests__/coaching-chip-registry.test.ts` scans the whole `src/` tree for
 * chip-id literals whose slug contains a routed intent token (the tokens
 * themselves derived from `ROUTED_COACHING_INTENTS`, not restated) and REDs
 * on any id this map does not resolve. A new coaching chip hand-rolled in a
 * composer goes red the day it lands, and the scan carries its own contrast
 * control so it cannot pass by being blind.
 */

import type { RoutedCoachingIntent } from './typed-intent-directive.js';

/**
 * CEE-authored chip ids that stand for a routed coaching method.
 *
 * ⚠ TWO IDS FOR ONE AFFORDANCE, AND THEY ARE BOTH KEPT ON PURPOSE. The
 * pre-mortem chip is composed at four sites under two id spellings —
 * `chip_prompt_run_pre_mortem` (`compose/chip-generator.ts`, twice, via
 * `promptChip`) and `chip_action_run_pre_mortem`
 * (`handlers/edit-graph-dispatch.ts`, `routing/post-analysis-label-intercept.ts`).
 * Collapsing them to one spelling would be a nicer registry and a worse
 * change: it edits the wire identity of live chips for no behavioural gain,
 * in files this lane has no reason to churn. Registering both costs one line
 * and changes nothing a user can see.
 *
 * `chip_action_*` ids here are for chips that carry NO `action_type` — see
 * `coachingIntentForChipId`'s refusal rule, which is what keeps this map from
 * colliding with the typed-pill path.
 */
const CHIP_ID_INTENT: ReadonlyMap<string, RoutedCoachingIntent> = new Map([
  ['chip_prompt_run_pre_mortem', 'pre_mortem'],
  ['chip_action_run_pre_mortem', 'pre_mortem'],
]);

/**
 * The routed coaching intent a CEE-authored chip id stands for, or
 * `undefined`.
 *
 * Pure, total, and case-sensitive: chip ids are minted by
 * `chip-generator.ts`'s `chipId()`, which already lowercases and normalises,
 * so a case-insensitive read here would only ever admit an id no producer can
 * mint.
 */
export function coachingIntentForChipId(
  chipId: string | undefined,
): RoutedCoachingIntent | undefined {
  if (typeof chipId !== 'string' || chipId.length === 0) return undefined;
  return CHIP_ID_INTENT.get(chipId);
}

/**
 * Every chip id this module claims. Exported for the completeness scan's
 * CONTRAST CONTROL: the scan must find at least these ids in the tree, or it
 * is looking at nothing and its silence is worthless (trap 13).
 */
export const REGISTERED_COACHING_CHIP_IDS: readonly string[] = Object.freeze([
  ...CHIP_ID_INTENT.keys(),
]);
