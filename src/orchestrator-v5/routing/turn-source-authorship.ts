/**
 * ⭐⭐ #1231 — WHICH INGRESS SOURCES ASSERT THAT A HUMAN AUTHORED THIS TEXT?
 *
 * A routing guard that must tell "the user just typed this command" apart from
 * "the product is replaying its own affordance" cannot ask the TEXT — the two
 * are byte-identical by construction (`describe-changeset.ts:257` renders a
 * rename op as `rename 'X' to 'Y'`, and `buildGmHeldPublicCopy` capitalises it
 * into the held-proposal confirm chip's LABEL). The only honest discriminator
 * is the ingress `source`, which a user cannot type.
 *
 * ⚠⚠ WHY THIS IS A MODULE AND NOT AN INLINE `=== 'chip_click'`. The first cut
 * of the #1231 guard compared against `'chip_click'` alone. The wire union has
 * FOUR members, and the deployed UI sends the held-confirm chip as `'chip'`:
 * `buildPayload.ts:148-164` (DecisionGuideAI `staging`) promotes to
 * `'chip_click'` ONLY when a PUBLISHED, CEE-ACCEPTED `action_type` is present,
 * and the held-confirm chip carries none — so it lands as `'chip'`, and the
 * guard was dark on the one ingress real users hit. A hand-written subset of a
 * contract union is the hand-maintained-mirror defect this estate keeps paying
 * for; the classification below is EXHAUSTIVE OVER THE CONTRACT TYPE, so a
 * fifth member is a TYPECHECK ERROR here (missing key) rather than a silent
 * default, and `turn-source-authorship.test.ts` additionally asserts the keys
 * equal `TurnSource.options` AT RUNTIME so a type/runtime drift also REDs.
 *
 * ⭐ THE CLASSIFICATION, DERIVED — each member's verdict with its evidence:
 *
 *   · `composer`   → FRESHLY AUTHORED. The typing surface. The only member
 *                    that carries a human's authoring act for THIS turn, and
 *                    the one the #1231 rename gain exists to serve.
 *
 *   · `chip`       → REPLAYED. The product's own affordance. The contract's own
 *   · `chip_click` →   refinement names exactly this pair as the chip-origin
 *                    sources — `turn-payload.ts`: `const isChipSource =
 *                    source === 'chip' || source === 'chip_click'`, the two
 *                    members permitted to carry a `chip` sub-object. The text
 *                    on such a turn is copy the product rendered, not prose a
 *                    user composed.
 *
 *   · `retry`      → REPLAYED. Not "a user typing" and not, itself, a chip —
 *                    a VERBATIM RESEND of the previous user send, with the
 *                    original provenance ERASED (the contract forbids a `chip`
 *                    sub-object on a retry; `retry_of` is the only trace, and
 *                    the live UI leaves it unset). DERIVED, not assumed: the
 *                    UI's `retryLast` resends `lastUserInputRef.current.message`
 *                    with `source: 'retry'` (useConversation.ts:5604), and that
 *                    ref is written on EVERY non-hidden user send INCLUDING
 *                    chip clicks (:3586-3596 — the same branch whose telemetry
 *                    labels `chip`/`chip_click` as "clicked chip"). So a retry
 *                    CAN carry the confirm chip's own label verbatim: click the
 *                    rename chip → the turn fails → "Try again" → the same
 *                    rename copy arrives as `retry`. A retry never ADDS an
 *                    authoring act; at most it repeats one.
 *
 * ⭐ AND THE ASYMMETRY IS DELIBERATE, because the two errors are not equal.
 * Misreading a replay as fresh REDRAFTS: the edit lane mints a SECOND hold and
 * renders ANOTHER confirm chip — the confirm-click-returns-another-confirm loop
 * #1231 exists to close, and it is self-sustaining. Misreading a fresh command
 * as a replay costs at most ONE coach turn, which the user recovers by asking
 * again. Where a member carries no authoring evidence, this classifies it
 * REPLAYED.
 *
 * SCOPE: this answers ONE question — "did a human author this text on this
 * turn?". It is not consent, not permission, and not "may this resume a held
 * proposal?" (a different question with its own term at the call site; see
 * route-v2.ts and trap 21).
 */
import { TurnSource } from '@talchain/schemas/boundary';
import type { TurnSourceLiteral } from '@talchain/schemas/boundary';

export type TurnAuthorship = 'freshly_authored' | 'replayed';

/**
 * EXHAUSTIVE over the contract union. Adding a member to `TurnSource` without
 * classifying it here is a compile error — never a silent default.
 */
const TURN_SOURCE_AUTHORSHIP: Record<TurnSourceLiteral, TurnAuthorship> = {
  composer: 'freshly_authored',
  chip: 'replayed',
  chip_click: 'replayed',
  retry: 'replayed',
};

/** The contract's own member list, for the runtime completeness guard. */
export const TURN_SOURCE_MEMBERS: readonly TurnSourceLiteral[] = TurnSource.options;

/** The classification map, exposed so the guard test can assert its keys. */
export const TURN_SOURCE_AUTHORSHIP_MAP: Readonly<Record<TurnSourceLiteral, TurnAuthorship>> =
  TURN_SOURCE_AUTHORSHIP;

/**
 * True when the ingress asserts a human authored this text on THIS turn.
 * Only `composer` does.
 */
export function isFreshlyAuthoredTurnSource(source: TurnSourceLiteral): boolean {
  return TURN_SOURCE_AUTHORSHIP[source] === 'freshly_authored';
}

/**
 * True when the text arrived by replay rather than by authoring — the product's
 * own chip copy (`chip` / `chip_click`) or a verbatim resend of a prior send
 * (`retry`). The complement of `isFreshlyAuthoredTurnSource` by construction.
 */
export function isReplayedTurnSource(source: TurnSourceLiteral): boolean {
  return TURN_SOURCE_AUTHORSHIP[source] === 'replayed';
}
