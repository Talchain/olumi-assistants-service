/**
 * ROADMAP 2.474 / A3 — WHAT THE USER IS TOLD WHEN A STRUCTURAL EDIT SPLITS.
 *
 * The witnessed defect was not only that over-cap batches died; it was that
 * they died SILENTLY as far as the user's next action is concerned. Probe C's
 * copy named a limit ("limit: 4 node ops, 8 edge ops") and offered "Break into
 * smaller steps" — a chip that asks the USER to work out the decomposition the
 * server had already computed and thrown away.
 *
 * This module builds the other half of the split: the sentence that says a
 * larger change arrived in steps, names EVERY operation still to come, and
 * offers the next step as a chip the user can take without rephrasing anything.
 *
 * ── EVERY OPERATION IS NAMED. NO COUNTS, NO ELLIPSIS ────────────────────────
 * The remainder subject comes from `describeChangeset`, the ONE source of
 * changeset description copy in the estate (hold ask, chip copy, applied
 * receipt all consume it), so the remainder is described in exactly the
 * vocabulary the hold above it uses. It is deliberately NOT clamped to the
 * first few items: "…and 3 more changes" is the opaque collapse ROADMAP 1.134
 * removed, and re-introducing it here to keep a sentence short would make the
 * split indistinguishable from truncation at the only place the user can see.
 *
 * ── DESCRIBED AGAINST THE WHOLE BATCH, NOT THE PART ────────────────────────
 * `describeChangeset` resolves a node id to a label from the graph OR from an
 * `add_node` earlier IN THE SAME ARRAY. A remainder described in isolation
 * would therefore render "add a link" wherever it referenced a node the first
 * step creates. So the caller describes the WHOLE batch once and slices the
 * per-operation items by the part's original indices — which is why
 * `StructuralEditPart` carries `indices` at all.
 *
 * ── COPY CONSTRAINTS (inherited, not invented) ─────────────────────────────
 * British English; no em dashes; no ids, op tokens or internal vocabulary; no
 * success claim (`SUCCESS_CLAIM_PATTERNS`) and no denial of change
 * (`FORBIDDEN_USER_FACING_PHRASES`). In particular the notice never says a
 * change "has been" anything, and never opens a line with a bare commit verb.
 */

import type { ChangesetDescription } from './describe-changeset.js';

/** The chip that carries the next step. Shaped like the boundary `Action`. */
export interface StructuralEditNextStepAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  /** The full remainder sentence, behind a short label (wave-2 ask #20). */
  readonly detail: string;
}

export interface StructuralEditSplitDisclosure {
  /** Appended to the assistant text of the FIRST part's proposal. */
  readonly notice: string;
  readonly action: StructuralEditNextStepAction;
}

/** Join items for prose: "a" / "a and b" / "a, b and c". Mirrors the joiner in
 *  `describe-changeset.ts`, whose own `joinItems` is module-private. */
function joinItems(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

export interface BuildSplitDisclosureInput {
  /** Per-operation descriptions of the WHOLE batch, order-preserving. */
  readonly wholeBatch: ChangesetDescription;
  /** Original-batch indices of the part being proposed NOW. */
  readonly proposedIndices: readonly number[];
  /** Total number of parts the request became (>= 2 for a disclosure). */
  readonly partCount: number;
  /**
   * True when any remaining part names a node the proposed part creates, so
   * the remainder genuinely cannot be proposed until this step is applied. The
   * copy says so instead of implying a free choice of order.
   */
  readonly remainderDependsOnThisStep: boolean;
}

/**
 * Build the disclosure, or null when there is nothing to disclose (one part, or
 * a remainder that describes to nothing — in which case saying nothing is
 * better than a sentence with an empty list in it).
 */
export function buildStructuralEditSplitDisclosure(
  input: BuildSplitDisclosureInput,
): StructuralEditSplitDisclosure | null {
  if (input.partCount < 2) return null;
  const proposed = new Set(input.proposedIndices);
  const remainderItems = input.wholeBatch.items.filter((_, i) => !proposed.has(i));
  if (remainderItems.length === 0) return null;

  const remainderSubject = joinItems(remainderItems);
  const stepsWord = `${input.partCount} steps`;
  const dependencyClause = input.remainderDependsOnThisStep
    ? ' Confirm this step first, because the rest builds on what it adds.'
    : '';

  const notice =
    `That is a larger change than I can propose in one step, so it comes in ${stepsWord} ` +
    `and this is the first. Still to come: ${remainderSubject}.${dependencyClause}`;

  return {
    notice,
    action: {
      // Deterministic and stable for the turn; the confirm chip for the held
      // part keeps its own gate-minted id, so these can never collide.
      id: 'structural_edit_next_step',
      label: 'Propose the next step',
      message: `Now ${remainderSubject}.`,
      detail: `Still to come: ${remainderSubject}.`,
    },
  };
}
