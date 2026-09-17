/**
 * ONE draft/redraft offer object — the chip copy AND the resumable pending
 * that makes consenting to it executable.
 *
 * ⭐ WHY THIS MODULE EXISTS (offer↔handler parity, 17 Sep 2026).
 *
 * Until now there were TWO rebuild offers in this service and only one of
 * them could be fulfilled:
 *
 *   A. The EXECUTABLE offer — `route-v2.ts`'s C4 decline emits the
 *      'Redraft the model' chip AND commits a `draft_graph` pending, so
 *      `resolveDraftOfferResume` can match the consent and
 *      `dispatchDraftGraph` runs. Reachable only behind the UI wire flag
 *      (`generate_model` / `explicit_generate`).
 *
 *   B. The UNEXECUTABLE offer — the two patch-rejection chips in
 *      `orchestrator/tools/edit-graph.ts` ('Rebuild from updated brief')
 *      and the matching sentence in `patch-rejection-helper.ts`. They
 *      seeded NO pending. Clicking the chip sent its `prompt` as the
 *      user's message, and on a POPULATED canvas every arm of the draft
 *      trigger (`route-v2.ts`, `isDraftGraphShape || isSemanticOpenFrameDraft
 *      || explicitGenerateDraft || clarifyV2DraftBrief`) is false, while
 *      `draft_graph` is deliberately absent from the routing tool's handler
 *      enum (`routing/tool-schema.ts`). So the turn fell to the
 *      conversational path and the product refused its own offer.
 *      Measured on Paul's 16 Sep capture (`olumi-debug-1994c9c1`).
 *
 * The rule this module makes structural: **an offer may only be emitted
 * together with the pending that executes it.** One builder, imported by
 * every emit site, so a second unexecutable offer cannot be minted by
 * copying a string.
 *
 * The chip copy lives here for the same reason. Its `prompt` is the message
 * the USER sends on click, so it must be a consent sentence, never the
 * assistant's own question replayed back (the defect the sibling
 * 'Simplify the change' chip was fixed for — see `edit-graph.ts`).
 */

import { randomUUID } from 'node:crypto';

import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
} from './pending-action.js';

/**
 * The patch-rejection redraft offer. The LABEL is unchanged from the copy
 * this product has been serving; the MESSAGE is new, because the old one
 * ('Would you like to rebuild the model from an updated brief instead?')
 * was a question posted as the user's own message.
 *
 * ⚠ These two strings are a RESUME KEY, not decoration. They are copied
 * onto the pending as `public_label` / `public_message`, and
 * `resolveDraftOfferResume` matches the next turn's message against THOSE
 * fields. Changing either string alone here is safe (the pending carries
 * whatever is emitted); changing one at an emit site without the other is
 * what breaks the resume, which is why no emit site spells them inline.
 */
export const REBUILD_OFFER_CHIP_LABEL = 'Rebuild from updated brief';
export const REBUILD_OFFER_CHIP_MESSAGE = 'Yes, rebuild the model from an updated brief.';

/**
 * Build the resumable `draft_graph` pending for a draft/redraft offer.
 *
 * Moved here verbatim from `route-v2.ts` (offer↔handler parity) so the
 * patch-rejection offer and the explicit-generate decline mint the SAME
 * object. Two builders for one pending shape would drift — this estate's
 * dominant defect.
 */
export function buildDraftOfferPending(input: {
  readonly scenarioId: string;
  readonly chipId: string;
  readonly publicLabel: string;
  readonly publicMessage: string;
  readonly briefSeed?: string;
  readonly redraft?: boolean;
  readonly graphHash?: string | null;
  readonly nowMs: number;
}): PendingAction {
  return {
    id: randomUUID(),
    scenario_id: input.scenarioId,
    chip_id: input.chipId,
    action: {
      kind: 'draft_graph',
      ...(input.briefSeed !== undefined ? { brief_seed: input.briefSeed } : {}),
      ...(input.redraft === true ? { redraft: true } : {}),
      public_label: input.publicLabel,
      public_message: input.publicMessage,
    },
    // The redraft offer pins the persisted graph's analysis-affecting hash
    // (when computable) so the commit carry-forward's existing hash rule
    // invalidates the offer if an edit lands between offer and consent —
    // consent must never silently cover a graph the user changed since.
    preconditions:
      typeof input.graphHash === 'string' && input.graphHash.length > 0
        ? { graph_hash: input.graphHash }
        : {},
    expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
    expires_at_iso: new Date(input.nowMs + PENDING_ACTION_DEFAULT_WALL_TTL_MS).toISOString(),
    emitted_at_iso: new Date(input.nowMs).toISOString(),
  };
}

/**
 * Identify the rebuild-offer chip on a turn's wire `suggested_actions`.
 *
 * Bound by IDENTITY (the exact label AND message this module owns), never
 * by a natural-language predicate over the copy — a regex over "rebuild"
 * would fire on the assistant's prose and on chips this offer does not own.
 * Renaming either constant moves both the emitter and this matcher at once,
 * which is the whole point of them living in one module.
 */
export function findRebuildOfferChip<
  T extends { readonly id?: unknown; readonly label?: unknown; readonly message?: unknown },
>(chips: readonly T[] | undefined): T | null {
  if (chips === undefined) return null;
  for (const chip of chips) {
    if (
      chip.label === REBUILD_OFFER_CHIP_LABEL &&
      chip.message === REBUILD_OFFER_CHIP_MESSAGE
    ) {
      return chip;
    }
  }
  return null;
}
