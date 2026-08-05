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

/**
 * ── THE HONEST REFUSAL, for a request no partition can rescue ──────────────
 *
 * Reached when the batch is over the pipeline's operation count, when a single
 * operation is larger than one reviewable change, or when the partition would
 * need more parts than may be offered. It replaces the rulebook's dead-end
 * copy, which named a limit ("limit: 4 node ops, 8 edge ops") and no next step.
 *
 * Three properties, each deliberate:
 *  · it says WHAT happened, in the user's terms, without a number they have no
 *    way to act on;
 *  · it names a SMALLER ASK that will work, rather than telling the user to
 *    "break this into smaller steps" and leaving the decomposition to them;
 *  · it never claims a change was made and never denies that changes exist —
 *    both swept by the estate's own guards in the tests.
 */
export const STRUCTURAL_EDIT_TOO_LARGE_TEXT =
  'That is a bigger change than I can put to you in one go, even in steps. ' +
  'Ask me for one part of it and I will propose that: the changes for a ' +
  'single option, for example, or just the new factors without the links.';

export const STRUCTURAL_EDIT_TOO_LARGE_ACTIONS: readonly {
  readonly label: string;
  readonly prompt: string;
  readonly role: 'facilitator' | 'challenger';
}[] = [
  {
    role: 'facilitator',
    label: 'Do one option at a time',
    prompt: 'Make that change for one option first, then we can do the others.',
  },
  {
    role: 'facilitator',
    label: 'Just the new factors',
    prompt: 'Add the new factors first, without linking them up yet.',
  },
];

/** The chip that carries the next step. Shaped like the boundary `Action`. */
export interface StructuralEditNextStepAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  /** The full remainder sentence, behind a short label (wave-2 ask #20). */
  readonly detail: string;
  /** Set only for the executable re-run chip, so the UI can run it directly. */
  readonly actionType?: 'run_analysis';
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
  /**
   * ⚠⚠ TRUE WHEN THE SCENARIO HAS ALREADY BEEN ANALYSED — and then the next
   * step CANNOT be proposed immediately, whatever this copy would like to say.
   *
   * Measured at the seam the dispatcher uses: once part 1 is confirmed and
   * applied the graph hash moves, so a scenario carrying a successful
   * run_analysis fact flips to `stale`; a STRUCTURAL candidate trusts only
   * `fresh`/`none` (`frame-gate.ts`, where the `stale` relaxation is
   * tunable-only), so the gate returns `governing:'stale'`, `blockApply:true`,
   * `ANALYSIS_NOT_FRESH` and `pendingActions: null`. No proposal, no chip.
   *
   * Note WHY this was invisible: every test of this feature ran on a
   * PRE-ANALYSIS scenario (`freshness:'none'`, reason
   * `no_successful_run_analysis_fact`), which is the one state where the next
   * step does work — and it is NOT the normal state for someone restructuring
   * a model they have already analysed.
   *
   * So when this is true the copy states the real order (confirm, re-run, then
   * the rest) and the chip offered is the RE-RUN, which is a control that can
   * actually deliver. Offering "Propose the next step" here would be the
   * estate's named dominant defect: a control that cannot do what it says.
   */
  readonly rerunRequiredBeforeNextStep: boolean;
}

/**
 * The re-run chip.
 *
 * ⚠ id / label / message / action_type are the estate's CANONICAL re-run chip,
 * which already exists in two module-private copies
 * (`routing/post-analysis-label-intercept.ts` RERUN_ANALYSIS_CHIP and
 * `routing/run-comparison-gate.ts` RERUN_ACTION). Neither is exported, and
 * extracting a shared leaf would widen this PR beyond its remit — so this is
 * knowingly a THIRD copy, and it is guarded rather than trusted: the spec for
 * this module reads both existing definitions out of their source and fails if
 * this triple drifts from them. Extraction to one leaf is rowed.
 */
export const STRUCTURAL_EDIT_RERUN_ACTION = Object.freeze({
  id: 'chip_action_rerun_analysis',
  label: 'Re-run analysis',
  message: 'Re-run the analysis.',
  action_type: 'run_analysis' as const,
});

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
  const opening =
    `That is a larger change than I can propose in one step, so it comes in ${stepsWord} ` +
    `and this is the first. Still to come: ${remainderSubject}.`;

  // ── THE ALREADY-ANALYSED CASE — say the real order, offer the real control ─
  if (input.rerunRequiredBeforeNextStep) {
    return {
      notice:
        `${opening} You have already analysed this model, so once you confirm this step ` +
        'the figures will need refreshing before I can propose the rest. Re-run the ' +
        'analysis after confirming, then ask me for the rest.',
      action: {
        id: STRUCTURAL_EDIT_RERUN_ACTION.id,
        label: STRUCTURAL_EDIT_RERUN_ACTION.label,
        message: STRUCTURAL_EDIT_RERUN_ACTION.message,
        actionType: STRUCTURAL_EDIT_RERUN_ACTION.action_type,
        detail: `Still to come: ${remainderSubject}.`,
      },
    };
  }

  const dependencyClause = input.remainderDependsOnThisStep
    ? ' Confirm this step first, because the rest builds on what it adds.'
    : '';

  return {
    notice: `${opening}${dependencyClause}`,
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
