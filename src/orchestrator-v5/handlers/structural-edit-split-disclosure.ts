/**
 * ROADMAP 2.474 / A3 — WHAT THE USER IS TOLD WHEN A STRUCTURAL EDIT SPLITS.
 *
 * The witnessed defect was not only that over-cap batches died; it was that
 * they died SILENTLY as far as the user's next action is concerned. Probe C's
 * copy named a limit ("limit: 4 node ops, 8 edge ops") and offered "Break into
 * smaller steps" — a chip that asks the USER to work out the decomposition the
 * server had already computed and thrown away.
 *
 * This module builds the other half of the split. It builds it as TWO
 * STATEMENTS WITH INDEPENDENT PRECONDITIONS, because welding them together is
 * how this feature shipped its second defect (ROADMAP 2.620):
 *
 *   SCOPE        — "only the first of N parts was put to the gate; the rest
 *                  were never judged". A fact about THIS TURN'S REQUEST, true
 *                  whatever the gate then said about the part it judged.
 *                  ⭐ SCOPE SURVIVES REFUSAL.
 *   CONTINUATION — "here is step 2", plus any chip that carries it. An OFFER,
 *                  and an offer needs a live path to continue.
 *
 * ── ⚠ WHY THEY ARE TWO FUNCTIONS AND NOT ONE WITH A FLAG ───────────────────
 * The first version of this module returned one object holding both, and the
 * call site gated the whole object on the turn having produced a proposal. The
 * measured consequence: on a rejected, stale or clarify turn the user read
 * "I couldn't take that change forward, so the model is unchanged" and WAS
 * NEVER TOLD that 8 of their 12 operations had not been submitted at all. The
 * turn went from contradictory to coherent-and-silent, which is worse: silent
 * truncation at the only place the user can see it.
 *
 * A shared flag would have the same failure mode one refactor later. Two
 * functions cannot be gated together by accident: the continuation gate has
 * nothing to say about the scope notice because it is not an argument to it.
 *
 * Three in-repo authorities say scope must survive a refusal, and they are the
 * reason this is a structural fix rather than a moved condition:
 *   · this feature's own doctrine (`structural-edit-batch-split.ts`) — "batch
 *     splitting with disclosure (NEVER silent truncation), not refusal";
 *   · the sibling unmapped-part disclosure at the same seam
 *     (`edit-graph-dispatch.ts`), whose comment states the rule verbatim:
 *     "Deliberately NOT gated on `!editResult.wasRejected`: two of the three
 *     observed failures ended on the generic cajole, which is precisely where
 *     the silence was worst";
 *   · ROADMAP 1.134, which removed the opaque collapse this would recreate.
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
 * The scope notice carries the extra constraint that it must read correctly
 * BESIDE A REFUSAL, so it claims nothing about the outcome of the part that
 * was judged.
 */

import type { ChangesetDescription } from './describe-changeset.js';
import { RERUN_ACTION } from '../routing/stale-rerun-guard.js';

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

/**
 * The chip that carries the next step. Shaped like the boundary `Action`.
 *
 * ⚠ `action_type` is snake_case DELIBERATELY (ROADMAP 2.623(c)). Every sibling
 * field on the boundary action is already snake_case, and the earlier camelCase
 * spelling forced the call site to remap the object field by field — a shape in
 * which adding a sixth field silently drops it on the wire with nothing red.
 * Matching the wire name lets the call site spread this object whole.
 */
export interface StructuralEditNextStepAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  /** The full remainder sentence, behind a short label (wave-2 ask #20). */
  readonly detail: string;
  /** Set only for the executable re-run chip, so the UI can run it directly. */
  readonly action_type?: 'run_analysis';
}

/** What follows the held step: prose (optional) plus the chip that carries it. */
export interface StructuralEditContinuation {
  /** Appended after the scope notice. Null when the chip says it all. */
  readonly notice: string | null;
  readonly action: StructuralEditNextStepAction;
}

/** The shared identification of the split: which part went, how many there are. */
export interface StructuralEditSplitScopeInput {
  /** Per-operation descriptions of the WHOLE batch, order-preserving. */
  readonly wholeBatch: ChangesetDescription;
  /** Original-batch indices of the part that was submitted on this turn. */
  readonly proposedIndices: readonly number[];
  /** Total number of parts the request became (>= 2 for a disclosure). */
  readonly partCount: number;
}

export interface BuildContinuationInput extends StructuralEditSplitScopeInput {
  /**
   * True when any remaining part names a node the proposed part creates, so
   * the remainder genuinely cannot be proposed until this step is applied. The
   * copy says so instead of implying a free choice of order.
   */
  readonly remainderDependsOnThisStep: boolean;
  /**
   * ⚠⚠ TRUE WHEN A RE-RUN MUST HAPPEN BETWEEN THIS STEP AND THE NEXT — and
   * then the next step CANNOT be proposed immediately, whatever this copy
   * would like to say.
   *
   * Two things have to be true at once, and the caller derives BOTH rather
   * than restating either:
   *   (i)  the scenario already carries a successful analysis, so applying
   *        part 1 moves the graph hash and flips freshness to `stale` (a
   *        pre-analysis scenario stays at `none` and is unaffected);
   *   (ii) a `stale` frame actually blocks an apply for a STRUCTURAL
   *        candidate — asked of the frame gate itself
   *        (`staleAnalysisBlocksApply`), never restated here, so the
   *        staleness-editability ruling changes this copy automatically
   *        rather than leaving a stale sentence behind.
   *
   * Note WHY this was invisible for a whole review round: every test of this
   * feature ran on a PRE-ANALYSIS scenario (`freshness:'none'`, reason
   * `no_successful_run_analysis_fact`), which is the one state where the next
   * step does work — and it is NOT the normal state for someone restructuring
   * a model they have already analysed.
   *
   * So when this is true the copy states the real order (confirm, re-run, then
   * the rest) and the chip offered is the RE-RUN. Offering "Propose the next
   * step" here would be the estate's named dominant defect: a control that
   * cannot do what it says.
   */
  readonly rerunRequiredBeforeNextStep: boolean;
}

/** Join items for prose: "a" / "a and b" / "a, b and c". Mirrors the joiner in
 *  `describe-changeset.ts`, whose own `joinItems` is module-private. */
function joinItems(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/**
 * The remainder, in the whole batch's own vocabulary — or null when there is
 * nothing to disclose (one part, or a remainder that describes to nothing, in
 * which case saying nothing is better than a sentence with an empty list in
 * it).
 *
 * Shared by both builders so the two statements can never disagree about what
 * is outstanding, and so "is there anything to say?" is answered once.
 */
function remainderSubjectOf(input: StructuralEditSplitScopeInput): string | null {
  if (input.partCount < 2) return null;
  const proposed = new Set(input.proposedIndices);
  const remainderItems = input.wholeBatch.items.filter((_, i) => !proposed.has(i));
  if (remainderItems.length === 0) return null;
  return joinItems(remainderItems);
}

/**
 * ⭐⭐ THE SCOPE NOTICE — WHAT WAS PUT TO THE GATE, AND WHAT WAS NOT.
 *
 * Takes NO verdict, NO outcome and NO chip. That is the fix, expressed as a
 * signature: this sentence cannot be gated on the outcome of the judged part
 * because the outcome is not available to it. It is emitted on applied, held,
 * rejected, stale and clarify alike.
 *
 * ⚠ WHAT IT MUST NOT SAY. It must not say "this is the first" — on a refused
 * turn nothing was proposed, and that is precisely the contradiction the first
 * version of this module shipped. It claims nothing about what happened to the
 * submitted part, only that the rest were never submitted.
 *
 * ⚠ IT IS ALSO NOT A DISCLOSED-PARTIAL NOTICE. The remaining operations were
 * not applied, not rejected and not judged; they never reached the gate. The
 * copy says "were not looked at on this turn", never that part of a judged
 * batch was dropped.
 */
export function buildStructuralEditScopeNotice(
  input: StructuralEditSplitScopeInput,
): string | null {
  const remainderSubject = remainderSubjectOf(input);
  if (remainderSubject === null) return null;
  return (
    `That is a larger change than I can work through in one go, so I split it ` +
    `into ${input.partCount} steps and only the first of them is covered by ` +
    `what I have just said. The rest were not looked at on this turn. ` +
    `Still to come: ${remainderSubject}.`
  );
}

/**
 * ⭐⭐ MAY THIS TURN OFFER A CONTINUATION?
 *
 * A continuation says "here is step 2" and hands over a control that takes it.
 * Step 2 only exists if step 1 is still on the table, so the precondition is a
 * LIVE HELD PROPOSAL — a held verdict that actually minted a pending the user
 * can confirm.
 *
 * The predicate itself lives on the PRODUCER of that verdict
 * (`hasLiveHeldProposal`, `edit-graph-referee-gate.ts`), not here, because
 * three call sites in the dispatcher were independently reconstructing it out
 * of two nullable fields (ROADMAP 2.623(a)). This module consumes it; it does
 * not own a fourth copy.
 */

/**
 * Build the continuation, or null when there is nothing outstanding to
 * continue to. The caller is responsible for the precondition above — this
 * function deliberately does not take a verdict, for the same reason the scope
 * notice does not: a shared argument is a shared gate waiting to happen.
 */
export function buildStructuralEditContinuation(
  input: BuildContinuationInput,
): StructuralEditContinuation | null {
  const remainderSubject = remainderSubjectOf(input);
  if (remainderSubject === null) return null;

  // ── THE ALREADY-ANALYSED CASE — say the real order, offer the real control ─
  if (input.rerunRequiredBeforeNextStep) {
    return {
      notice:
        'You have already analysed this model, so once you confirm this step ' +
        'the figures will need refreshing before I can propose the rest. ' +
        'Re-run the analysis after confirming, then ask me for the rest.',
      action: {
        // ⚠ CONSUMED, NOT COPIED (ROADMAP 2.621). This id/label/message/type
        // quadruple is the estate's canonical re-run chip and had reached EIGHT
        // definitions in non-test source, two of which have already drifted
        // ("Rerun" against everyone else's "Re-run"). `RERUN_ACTION` is the
        // exported one, already cross-imported by the coaching post-check, so
        // this call site adds a CONSUMER rather than a ninth copy — and the
        // 27-line source-reading drift guard that a copy would have needed is
        // deleted with it. A guard that reads two of eight sites checks
        // agreement between the copies it happens to know about; consuming the
        // export removes the thing it was checking.
        id: RERUN_ACTION.id,
        label: RERUN_ACTION.label,
        message: RERUN_ACTION.message,
        action_type: RERUN_ACTION.action_type,
        detail: `Still to come: ${remainderSubject}.`,
      },
    };
  }

  return {
    notice: input.remainderDependsOnThisStep
      ? 'Confirm this step first, because the rest builds on what it adds.'
      : null,
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
