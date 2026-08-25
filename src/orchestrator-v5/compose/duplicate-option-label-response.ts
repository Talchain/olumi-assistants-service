/**
 * ⭐⭐ THE DUPLICATE-OPTION-LABEL EXIT — the ASK that could not be answered.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS REPLACES, measured at pristine `14aefde6` on the wire-captured
 * graph with one of its own option nodes cloned under a new id:
 *
 *   "Your message names 2 options — "subcontracting inner-city deliveries to a
 *    green courier" and "subcontracting inner-city deliveries to a green
 *    courier" — so I do not know which one 0.12 belongs to. … Pick one below"
 *
 * The product quoted ONE STRING TWICE and asked the user to choose between the
 * two. Both chips carried a byte-identical `label` AND a byte-identical
 * `message`, differing only in an ordinal id, because
 * `buildConfigureOptionAdvisedFormat` composes a chip out of LABELS and never
 * ids. Clicking either replayed a message that re-entered the same ask.
 *
 * ⭐ THE LOOP WAS CLOSED BY CONSTRUCTION, NOT BY ACCIDENT: every escape route
 * the product offered was spelled in the vocabulary that had collided. The only
 * escape was to select the node and press Delete — the one route that carries
 * IDENTITY rather than a LABEL, and the one route the product never names.
 * THE ESCAPE EXISTED BUT WAS UNNAMEABLE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY RENAME, AND NOT ONE OF THE THREE EXITS THAT WERE REJECTED.
 *
 *   MERGE the two options       → silently deletes a user's option. Over-
 *                                 suppression here is WORSE than the dead end.
 *   RENAME THEM FOR THE USER    → invents user-facing content (P5).
 *   PUT THE ID IN THE REPLAY    → the sibling composer states a copy contract
 *                                 banning `opt_*` in user-facing text.
 *                                 ⚠ THAT CONTRACT IS NOT ENFORCED, and an
 *                                 earlier draft of this header asserted it as
 *                                 fact. Measured: no detector in the repo
 *                                 matches `opt_*`, the one that would is
 *                                 excluded from the global list, and the
 *                                 egress guard is scoped to `assistant_text`
 *                                 only — while chip ids already ship
 *                                 snake_case on the wire by design, and the
 *                                 estate has ratified a chip whose replay
 *                                 differs from its display. An id-bearing chip
 *                                 was therefore a LIVE DESIGN OPTION, not a
 *                                 prohibited one. It is declined on the
 *                                 narrower ground below — this reply needs no
 *                                 chip at all — NOT because a rule forbids it.
 *   DECLINE                     → drops the turn to the edit LLM, i.e. the
 *                                 wrong-entity-write path `option-effect-write`
 *                                 exists to close. A visible dead end traded
 *                                 for a possible silent corruption.
 *
 * The fourth exit is the estate's ratified one for an unwinnable
 * disambiguation (CLAUDE.md trap 22f): MAKE THE AMBIGUITY THE PRODUCT. The
 * product genuinely cannot refer to these options by label, so it says exactly
 * that and names an action that resolves it — one the user performs through an
 * IDENTITY-CARRYING canvas selection, the surface that has no label ambiguity.
 *
 * ⚠⚠ THE COPY NAMES **DELETE**, NOT RENAME, AND THAT WAS MEASURED RATHER THAN
 * PREFERRED. Rename is the better remedy — it destroys nothing — and this
 * composer shipped it in draft. IT IS DARK IN THE UI AT THE DEPLOYED TIP
 * (`DecisionGuideAI` staging `39162243`), verified in that repo:
 *
 *   · `InspectorRouter.tsx` never passes `onLabelChange` to `InspectorShell`
 *     (0 occurrences; contrast `onClose=` reads 3 in the same file), so
 *     `EditableLabel.tsx:124-131` renders its READ-ONLY `<span>` branch —
 *     whose own comment is "no rename affordance, because there is no rename".
 *   · `requestNodeRename` has ZERO production callers (contrast: its sibling
 *     `clearNodeRename` reads 1).
 *   · `NODE_SETTER_AUTHORITY.setLabel` is hardcoded `'disabled'`, and the user
 *     is SHOWN a read-only notice. It is not flag-gated: no flag flip makes
 *     rename true, so this is not a dark-launch we can switch on.
 *   · It is dark for EVERY node kind, so there is no factor-only fallback.
 *
 * A GUARANTEE THAT SPANS SERVICES IS DARK UNTIL BOTH HALVES ARE LIVE. Naming
 * rename here would have replaced a dead end with a NEW dead end wearing better
 * prose — the one outcome worse than shipping nothing, and precisely the defect
 * class this composer exists to remove. Delete is verified reachable by two
 * independent ungated entry points (keyboard `Delete`/`Backspace` on a
 * selection, and right-click → Delete), and it is the route the witnessed user
 * actually escaped by.
 *
 * ⚠ IT IS PHRASED AS AN INSTRUCTION, NOT A GUARANTEE. Delete fails closed when
 * a canonical scenario has no current server hash, so "press Delete" is what to
 * DO, not a promise about what will happen. Do not tighten it into a promise.
 *
 * ⭐ WHEN RENAME IS WIRED, THIS COPY SHOULD CHANGE — removing an option is
 * lossier than renaming one, and the user should not have to destroy a distinct
 * strategy to answer a naming question.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHY THIS IS NOT FIXED AT THE MINT, on measured grounds.
 *
 * The draft prompt ALREADY instructs distinctness — `src/prompts/defaults.ts:686`:
 * "IMPORTANT: Each option must be distinct. Do not duplicate existing options
 * or create near-duplicates." The 17 Aug capture was drafted under that
 * instruction and carries THREE near-duplicate pairs anyway: six option nodes
 * that are three actions each written twice, once lifted verbatim from the
 * brief and once as a reworded synthesis of the same action. So mint-side
 * prevention by instruction is demonstrably weak, and an EXACT collision is
 * simply the tail of that same distribution — it occurs when the reworded label
 * lands on the brief's own phrasing, differing only in case or whitespace.
 *
 * ⚠ AND THE RAW MATERIAL IS ABUNDANT EVEN THOUGH THE OBSERVED RATE IS ZERO. In
 * a wire corpus (claude-sonnet-5, structured outputs off, n=15), 7 of 15
 * responses emitted TWO JSON documents whose option label sets are IDENTICAL
 * after normalisation. They reach a single node array only because
 * `extractJsonFromResponse` SELECTS one document. No claim is made that a
 * merging or appending path exists today — those paths were not traced — only
 * that the colliding bytes are already on the wire at high frequency, so this
 * exit is insurance against a masked condition rather than a rare-defect patch.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ IT SHIPS NO CHIP, DELIBERATELY. A chip's replay message is a SENTENCE, and
 * every sentence that names one of these options names both. A chip here could
 * only re-enter the loop it was minted to end — which is precisely how the
 * defect worked. The absence is asserted by the companion spec, so a later
 * tidy-up cannot add one back silently.
 *
 * ⚠ THE LABEL IS QUOTED EXACTLY ONCE, and the count is DERIVED. The old copy's
 * whole failure was repeating one string as if repetition distinguished it; a
 * three-way collision must read as "Three of your options share the name X",
 * never as the same string listed three times.
 *
 * COPY CONTRACT: "I have not changed the model." is taken VERBATIM from the
 * sibling `option-effect-ask-response.ts`, which ships it today — so it is
 * already proven against `FORBIDDEN_USER_FACING_PHRASES` (which bans
 * "nothing changed" and "no change was made", not this sentence).
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';

/**
 * Small counts read as words in ordinary English; anything larger reads better
 * as a digit. DERIVED from the count rather than written per-branch, so a
 * four-way collision cannot fall through to a sentence that says "two".
 */
function countWord(count: number): string {
  const words: Readonly<Record<number, string>> = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five' };
  return words[count] ?? String(count);
}

export interface ComposeDuplicateOptionLabelInput {
  /** The shared label, in the spelling the user sees. Quoted ONCE. */
  readonly collidingLabel: string;
  /** How many options carry it. Always >= 2 at every call site. */
  readonly collidingCount: number;
  readonly stage: StageType;
}

/**
 * Build the deterministic rename-coaching reply. Pure — no I/O, no LLM, no
 * invention: the label is a graph fact and the count is derived from it.
 */
export function composeDuplicateOptionLabelResponse(
  input: ComposeDuplicateOptionLabelInput,
): OlumiResponse {
  const assistant_text =
    `${countWord(input.collidingCount)} of your options share the name ` +
    `"${input.collidingLabel}", so I cannot tell which one you mean. ` +
    `I have not changed the model. Remove one of them on the canvas — select ` +
    `it and press Delete — then tell me the value again and I will record it.`;

  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text,
    stage: input.stage,
    // ⚠ EMPTY BY DESIGN — see the header. Every label-spelled chip re-enters
    // the collision, and an id-spelled one breaks the copy contract.
    suggested_actions: [],
  });
}
