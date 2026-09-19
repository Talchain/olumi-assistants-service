/**
 * ⭐⭐ THE ESTIMATE BATCH — one proposal, one approval, one atomic write.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE HARM, witnessed end to end on deployed staging (2026-09-04).
 *
 * A founder asked whether to hire a tech lead or two developers. The product
 * built a model, then refused to analyse it because ten option-effect values
 * were unset. The user authorised filling them in THREE TIMES —
 *
 *   "Just put reasonable estimates in for each one, and then we'll review
 *    them together."
 *
 * — and the product could not act. Its own reasoning named the cause:
 * `set_factor_value` takes one value per call, so there was no deterministic
 * single action to execute. It offered instead to "work through them one at a
 * time", ten times over. That is data entry, and it is the thing this module
 * exists to remove.
 *
 * ⚠ AND THE DEFECT INSIDE THE OFFER, which is the sharper half. Asked to list
 * its recommendations, the assistant listed NINE. The blockers required TEN —
 * it dropped `Technical Leadership Capacity` for `Continue with Current Team`.
 * It disclosed the omission, to its credit. **An approved set that is short by
 * one still does not unblock the analysis.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐⭐ THE ONE DESIGN CONSTRAINT THE EVIDENCE FORCES.
 *
 *   THE MODEL SUPPLIES THE NUMBERS. IT NEVER SUPPLIES THE MEMBERSHIP.
 *
 * The cell set is DERIVED from the blocker list, here, in code. A set composed
 * in prose demonstrably drops a cell; a set derived from the producer cannot.
 * `buildValueBatchProposal` REJECTS an estimate set that does not cover the
 * derived membership EXACTLY — short by one is `incomplete`, and it names the
 * cells that are missing rather than silently proposing the nine it has.
 *
 * This is the whole reason the module is shaped as a validator around a
 * derivation rather than as a formatter around the model's list.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS REUSES, AND WHY IT MINTS NO SECOND AUTHORITY.
 *
 *   - MEMBERSHIP → `selectAnswerableBlockers` (`readiness-answer-chips.ts`),
 *     the estate's existing authority on which blockers a value answers.
 *     ⚠ ITS QUESTION AND OURS ARE THE SAME QUESTION — "is this a blocker a
 *     value resolves?" — which is why it is REUSED rather than mirrored. That
 *     module's own header warns against aliasing sets whose questions differ
 *     (trap 21); this is the inverse case, where a second copy of the code set
 *     would be the hand-maintained mirror. `membershipMatchesAnswerableLoop`
 *     below is the pin that goes RED if the two ever diverge.
 *     ⚠ SCOPE OF "CANNOT DROP A CELL", STATED EXACTLY: it is true RELATIVE TO
 *     that module's `ANSWERABLE_BLOCKER_CODES`, which is a hand-maintained set.
 *     A NEW blocker code that a value would answer lands outside the batch
 *     silently — the membership derivation cannot see what the code set does
 *     not admit. That is one list to keep, not two, which is the point of
 *     reusing it; it is not a claim that the list is complete.
 *   - READINESS → `assessCanonicalAnalysisReadiness`, THE readiness authority.
 *     No new admission predicate is introduced anywhere in this file.
 *   - APPLY → `parseEditGraphResponse` → `applyPatchOperations` →
 *     `encodeOptionInterventionsForEdit`, the SAME chain
 *     `option-effect-write-apply-chain.test.ts` pins for a single user-stated
 *     value. A batch is that chain with N operations on ONE candidate.
 *   - PROVENANCE → `InterventionV3.source`, which already distinguishes
 *     `cee_hypothesis` (ours) from `user_specified` (theirs) from
 *     `brief_extraction`. No new vocabulary is minted.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT REFUSES TO DO.
 *
 *   - IT NEVER GUESSES WHICH FACTOR. A blocker that names an option but no
 *     factor (`OPTION_NEEDS_MAPPING` — whose entire content is that the factor
 *     is unknown) is NOT estimable, and is carried in `unsettable` rather than
 *     dropped. Choosing a factor for it would be the same fabrication in a
 *     different field. The split is read off the producer's own data
 *     (`factor_id` present or absent), never judged here.
 *   - IT NEVER WRITES AN UNAPPROVED VALUE. `buildValueBatchProposal` composes;
 *     `executeValueBatch` applies. Nothing in this module reaches storage.
 *   - IT NEVER PARTIALLY APPLIES. One candidate graph, validated and
 *     reassessed as a whole; the caller commits it or discards it.
 *   - IT ACCEPTS "I CANNOT ESTIMATE THIS" as a first-class answer. A cell may
 *     carry `value: null`, which keeps the set COMPLETE and honest while
 *     writing nothing for that cell — visible absence over confident
 *     wrongness. A declined cell is still membership, so it can never be used
 *     to smuggle the nine-of-ten omission back in.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RANGES (CEE #1327) ARE A DEPENDENCY, NOT A CHOICE MADE HERE.
 *
 * The product measurably cannot hold a stated range today. `InterventionV3` is
 * `.passthrough()`, and this module writes the intervention as an OBJECT
 * rather than a bare number, so a range carrier can be added additively to
 * `ValueBatchEstimate` and to the written object WITHOUT a second migration.
 * No range parsing is done here and none is implied.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ TWO UNSTATED PRECONDITIONS THE WIRING LANE INHERITS. Both are true at
 * this commit and neither is enforced by this module, so both are written down
 * here rather than left to be rediscovered.
 *
 * ── 1. THE SECOND `user_specified` STAMPER, WHICH THIS PR DID NOT FIX ───────
 *
 * `normalise-option-interventions.ts` `freshInterventionV3` stamps
 * `source: 'user_specified'` UNCONDITIONALLY, and it runs at the persistence
 * chokepoint (`normaliseOptionInterventionContract`, called by
 * `projectGraphForPersistence`). It is a no-op for THIS module's output only
 * because `encodeOptionInterventionsForEdit` deletes `node.data.interventions`,
 * so its `recoverFromDataSources` finds nothing to promote.
 *
 * That ordering is the precondition. Commit BEFORE encode — or let a later turn
 * re-write `data.interventions` for the same cell — and every AI estimate
 * persists as `user_specified`, which `obligation-provenance.ts` classes
 * `user_stated` and `obligationFor` turns into **`required`**. The product then
 * DEMANDS that the user answer for numbers it invented, and attributes them to
 * the user. It is silent, and it is the exact inversion of `obligation:
 * "offered"`.
 *
 * `the mark survives the persistence projection` in the spec runs this module's
 * `appliedGraph` through `projectGraphForPersistence` and asserts
 * `cee_hypothesis` survives. It passes today and goes RED the day a successor
 * commits pre-encode.
 *
 * ── 2. THE FRAMEWORK HASH IS THE CAS, AND RE-DERIVATION IS NOT A SUBSTITUTE ──
 *
 * `buildValueBatchOffer` sets `preconditions.graph_hash`, and `route-v2.ts`
 * filters pending actions on it. THE WIRING LANE MUST ROUTE THROUGH THAT
 * HASH-CHECKED RESUME PATH. `executeValueBatch` takes no hash, and its
 * membership re-derivation is deliberately weaker than one: an interleaved turn
 * that changes a target factor's `observed_state.cap` from 10 to 100 leaves the
 * membership IDENTICAL (the cell still blocks) while changing what the approved
 * `0.4` MEANS by 10×. Only the hash catches that.
 */
import { createHash, randomUUID } from 'node:crypto';

import {
  CoachingBlockSchema,
  type CoachingBlock,
  type TargetRef,
} from '@talchain/schemas/boundary';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { guidanceSignalsForCoachingKind } from '../compose/guidance-signals.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import {
  assessCanonicalAnalysisReadiness,
  type CanonicalReadinessAssessment,
  type CanonicalReadinessIssue,
} from '../../orchestrator/tools/analysis-ready-helper.js';
import type {
  ObligationClass,
  StructureProvenance,
} from '../../cee/graph-readiness/obligation-provenance.js';
import { selectAnswerableBlockers } from '../routing/readiness-answer-chips.js';
import { parseEditGraphResponse } from '../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../orchestrator/tools/encode-option-interventions.js';
import type { PendingAction } from '../session/pending-action.js';
import { PENDING_ACTION_DEFAULT_WALL_TTL_MS } from '../session/pending-action.js';
import { GM_HELD_PENDING_TURN_TTL } from './edit-graph-referee-gate.js';

export const READINESS_VALUE_BATCH_HANDLER_ID = 'readiness_value_batch_v1';
export const READINESS_VALUE_BATCH_PROPOSAL_VERSION = 'readiness_value_batch_v1';

/**
 * The provenance every value this module writes carries, permanently.
 *
 * ⭐ `cee_hypothesis` is the EXISTING member of `InterventionV3.source` that
 * means "we chose this number". It is what makes an approved estimate
 * distinguishable from a user-stated figure (`user_specified`) and from one
 * lifted out of the brief (`brief_extraction`) — for the rest of the graph's
 * life, not merely in the turn that wrote it.
 */
export const VALUE_BATCH_INTERVENTION_SOURCE = 'cee_hypothesis' as const;

/**
 * The coaching kind the review card rides.
 *
 * ⭐ AN ESTIMATE THE PRODUCT MADE ABOUT THE USER'S MODEL IS AN ASSUMPTION, and
 * `assumption_check` is the existing member of `CoachingBlock['coaching_kind']`
 * whose whole job is to put one in front of the user. No new kind is minted —
 * one would be a `@talchain/schemas` change, which this lane ships none of.
 */
export const VALUE_BATCH_REVIEW_COACHING_KIND = 'assumption_check' as const;

/**
 * The 0–1 model-unit scale every option effect value lives on.
 *
 * ⚠ ASSERTED, NOT DERIVED FROM THE FACTOR. A factor whose canonical
 * intervention scale is not 0–1 would have its estimate refused as
 * `invalid_value` rather than encoded on its own scale. That FAILS CLOSED —
 * nothing is written and the cell is named — which is why it is acceptable
 * here rather than a defect; but it is an assumption, so it is written down.
 * The batch never touches raw magnitudes: it writes `value` directly, on this
 * scale, and never goes near `deriveValue`/`normaliseFactorValue`.
 */
const MODEL_UNIT_MIN = 0;
const MODEL_UNIT_MAX = 1;

/**
 * A gap this batch CAN set: the producer knows the option AND the factor, so
 * there is an unambiguous slot to write into.
 */
export interface ValueBatchCell {
  readonly issue_id: string;
  readonly option_id: string;
  readonly factor_id: string;
  readonly option_label: string | undefined;
  readonly factor_label: string | undefined;
  /** The producer's own question, carried verbatim — never re-authored here. */
  readonly prompt: string;
  readonly obligation: ObligationClass | undefined;
  readonly provenance: StructureProvenance | undefined;
}

/**
 * A gap this batch CANNOT set, and why — carried, never dropped.
 *
 * ⚠ `factor_unknown` is DERIVED (the blocker carries no `factor_id`), not
 * judged. Presenting the batch without these would tell the user the plan
 * covers everything open when it does not.
 */
export interface ValueBatchUnsettable {
  readonly issue_id: string;
  readonly reason: 'factor_unknown';
  readonly option_id: string;
  readonly option_label: string | undefined;
  readonly prompt: string;
}

export interface ValueBatchMembership {
  readonly cells: readonly ValueBatchCell[];
  readonly unsettable: readonly ValueBatchUnsettable[];
}

/** One cell's answer from the model. `value: null` = cannot estimate defensibly. */
export interface ValueBatchEstimate {
  readonly option_id: string;
  readonly factor_id: string;
  readonly value: number | null;
  readonly reasoning?: string;
  readonly confidence?: 'high' | 'medium' | 'low';
  /** Required when `value` is null: what stops us estimating this one. */
  readonly declined_reason?: string;
}

export interface ValueBatchProposedCell extends ValueBatchCell {
  readonly value: number | null;
  readonly reasoning: string | undefined;
  readonly confidence: 'high' | 'medium' | 'low' | undefined;
  readonly declined_reason: string | undefined;
}

export interface ValueBatchProposal {
  readonly proposal_version: typeof READINESS_VALUE_BATCH_PROPOSAL_VERSION;
  /**
   * `complete` is a claim about MEMBERSHIP, not about resolution: every
   * settable cell the producer named is represented here. Declined cells keep
   * it true; a missing cell makes the proposal unbuildable, not incomplete.
   */
  readonly complete: true;
  readonly cells: readonly ValueBatchProposedCell[];
  readonly unsettable: readonly ValueBatchUnsettable[];
}

/** Cell identity. Canonical ids exclude `|`, so it cannot collide. */
function cellKey(optionId: string, factorId: string): string {
  return `${optionId}|${factorId}`;
}

function labelOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * ⭐ THE MEMBERSHIP DERIVATION — the source of truth for what a batch covers.
 *
 * Reads `selectAnswerableBlockers` (already filtered to
 * `repairability === 'human_input_required'`, an answerable blocker code, and a
 * present `option_id`), then splits on whether the producer also knows the
 * FACTOR. Nothing about the split is a judgement made here.
 */
export function selectValueBatchMembership(
  assessment: CanonicalReadinessAssessment,
): ValueBatchMembership {
  const answerable: readonly CanonicalReadinessIssue[] = selectAnswerableBlockers(
    assessment.blockingIssues,
  );
  const cells: ValueBatchCell[] = [];
  const unsettable: ValueBatchUnsettable[] = [];
  for (const issue of answerable) {
    // `selectAnswerableBlockers` already guarantees a string `option_id`.
    const optionId = issue.option_id as string;
    const optionLabel = labelOrUndefined(issue.option_label);
    if (typeof issue.factor_id === 'string' && issue.factor_id.length > 0) {
      cells.push({
        issue_id: issue.issue_id,
        option_id: optionId,
        factor_id: issue.factor_id,
        option_label: optionLabel,
        factor_label: labelOrUndefined(issue.factor_label),
        prompt: issue.message,
        obligation: issue.obligation,
        provenance: issue.provenance,
      });
    } else {
      unsettable.push({
        issue_id: issue.issue_id,
        reason: 'factor_unknown',
        option_id: optionId,
        option_label: optionLabel,
        prompt: issue.message,
      });
    }
  }
  return { cells, unsettable };
}

export type ValueBatchProposalResult =
  | { readonly status: 'ok'; readonly proposal: ValueBatchProposal }
  | {
      readonly status: 'invalid';
      readonly reason: 'no_cells';
    }
  | {
      /** ⭐ THE WITNESSED DEFECT: the estimate set is short. Named, never patched over. */
      readonly status: 'invalid';
      readonly reason: 'incomplete';
      readonly missing: readonly ValueBatchCell[];
    }
  | {
      readonly status: 'invalid';
      readonly reason: 'unknown_cell' | 'duplicate_cell';
      readonly cells: readonly { readonly option_id: string; readonly factor_id: string }[];
    }
  | {
      readonly status: 'invalid';
      readonly reason: 'invalid_value' | 'declined_without_reason';
      readonly cells: readonly { readonly option_id: string; readonly factor_id: string }[];
    };

/**
 * Compose a reviewable proposal from a DERIVED membership and a supplied set
 * of estimates. Rejects — by name — every way the estimate set can fail to be
 * exactly the membership.
 *
 * ⚠ THE ORDER IS THE PRODUCER'S. Cells come back in the blocker list's own
 * order, not in the order the estimates arrived, so the reviewed list cannot
 * be reordered by whoever supplied the numbers.
 */
export function buildValueBatchProposal(input: {
  readonly assessment: CanonicalReadinessAssessment;
  readonly estimates: readonly ValueBatchEstimate[];
}): ValueBatchProposalResult {
  const membership = selectValueBatchMembership(input.assessment);
  if (membership.cells.length === 0) return { status: 'invalid', reason: 'no_cells' };

  const byKey = new Map<string, ValueBatchEstimate>();
  const duplicates: { option_id: string; factor_id: string }[] = [];
  for (const estimate of input.estimates) {
    const key = cellKey(estimate.option_id, estimate.factor_id);
    if (byKey.has(key)) {
      duplicates.push({ option_id: estimate.option_id, factor_id: estimate.factor_id });
      continue;
    }
    byKey.set(key, estimate);
  }
  if (duplicates.length > 0) {
    return { status: 'invalid', reason: 'duplicate_cell', cells: duplicates };
  }

  const membershipKeys = new Set(membership.cells.map((c) => cellKey(c.option_id, c.factor_id)));
  const unknown = input.estimates
    .filter((e) => !membershipKeys.has(cellKey(e.option_id, e.factor_id)))
    .map((e) => ({ option_id: e.option_id, factor_id: e.factor_id }));
  if (unknown.length > 0) {
    return { status: 'invalid', reason: 'unknown_cell', cells: unknown };
  }

  // ⭐ THE GUARD THE WITNESSED TURN NEEDED. Nine estimates against ten blockers
  // stops here, naming the tenth, instead of composing a plan that cannot
  // unblock the analysis.
  const missing = membership.cells.filter(
    (c) => !byKey.has(cellKey(c.option_id, c.factor_id)),
  );
  if (missing.length > 0) return { status: 'invalid', reason: 'incomplete', missing };

  const badValues: { option_id: string; factor_id: string }[] = [];
  const declinedWithoutReason: { option_id: string; factor_id: string }[] = [];
  for (const cell of membership.cells) {
    const estimate = byKey.get(cellKey(cell.option_id, cell.factor_id))!;
    if (estimate.value === null) {
      if (
        typeof estimate.declined_reason !== 'string'
        || estimate.declined_reason.trim().length === 0
      ) {
        // A silent decline is indistinguishable from an omission at the surface
        // that renders it. Refusing to estimate is allowed; refusing to say why
        // is not.
        declinedWithoutReason.push({ option_id: cell.option_id, factor_id: cell.factor_id });
      }
      continue;
    }
    if (
      !Number.isFinite(estimate.value)
      || estimate.value < MODEL_UNIT_MIN
      || estimate.value > MODEL_UNIT_MAX
    ) {
      badValues.push({ option_id: cell.option_id, factor_id: cell.factor_id });
    }
  }
  if (badValues.length > 0) {
    return { status: 'invalid', reason: 'invalid_value', cells: badValues };
  }
  if (declinedWithoutReason.length > 0) {
    return { status: 'invalid', reason: 'declined_without_reason', cells: declinedWithoutReason };
  }

  const cells: ValueBatchProposedCell[] = membership.cells.map((cell) => {
    const estimate = byKey.get(cellKey(cell.option_id, cell.factor_id))!;
    return {
      ...cell,
      value: estimate.value,
      reasoning: estimate.reasoning,
      confidence: estimate.confidence,
      declined_reason: estimate.value === null ? estimate.declined_reason : undefined,
    };
  });
  return {
    status: 'ok',
    proposal: {
      proposal_version: READINESS_VALUE_BATCH_PROPOSAL_VERSION,
      complete: true,
      cells,
      unsettable: membership.unsettable,
    },
  };
}

export interface ValueBatchChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
}

export interface ValueBatchOffer {
  readonly pending: PendingAction;
  readonly chip: ValueBatchChip;
}

/**
 * ⭐ THE ALL-DECLINED CASE IS A RESULT, NOT AN ABSENCE.
 *
 * This module goes to real trouble to refuse a SILENT decline at compose time
 * (`declined_without_reason`): a cell the model will not estimate must say why,
 * because visible absence beats confident wrongness. Returning a bare `null`
 * when EVERY cell declines threw that away again — the reasons and the
 * `unsettable` list both vanished, and a caller could not tell "there was
 * nothing to offer" from "we looked at all ten and here is why we can do none
 * of them".
 *
 * That is the witnessed harm's shape arriving through a new door: the user asks
 * a fifth time, the model declines every cell with good reasons, and the
 * product shows them nothing.
 *
 * So the outcome is DISCRIMINATED. `no_writable` carries the whole proposal, so
 * the wiring lane can surface the declined reasons and the unsettable gaps
 * instead of falling silent. There is still no chip, because there is still
 * nothing to approve.
 */
export type ValueBatchOfferOutcome =
  | { readonly kind: 'offer'; readonly offer: ValueBatchOffer }
  | { readonly kind: 'no_writable'; readonly proposal: ValueBatchProposal };

function proposalRef(scenarioId: string, graphHash: string): string {
  const digest = createHash('sha256')
    .update(`${scenarioId}:${graphHash}:${READINESS_VALUE_BATCH_HANDLER_ID}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
  return `rvb_${digest}`;
}

/** Cells this proposal will actually write (a declined cell writes nothing). */
export function writableCells(
  proposal: ValueBatchProposal,
): readonly (ValueBatchProposedCell & { readonly value: number })[] {
  return proposal.cells.filter(
    (c): c is ValueBatchProposedCell & { value: number } => c.value !== null,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * ⭐⭐⭐ THE REVIEW SURFACE — the half that makes "you reviewed them" true.
 *
 * The user is being asked to write N model-authored numbers into their own
 * model in one click. The product's ruling is that HUMANS REMAIN THE AUTHORS
 * AND THE DECISION-MAKERS, so the numbers have to be ON SCREEN before the
 * click, not merely inside the pending action the click resumes.
 *
 * ⚠ WHY `assistant_text` CARRIES THE NUMBERS AND THE BLOCK DOES NOT.
 * `CoachingBlockSchema.body` is `z.string().min(1).max(300)` (vendored
 * `@talchain/schemas` 0.55.0, `boundary/blocks.js:485` `PHASE3_BODY_MAX = 300`).
 * The witnessed harm is TEN cells; ten lines with their reasoning do not fit in
 * 300 characters, and a body that truncates would drop cells SILENTLY — the
 * same defect one layer over. `OlumiResponse.assistant_text` is a bare
 * `z.string()` with no bound, it is the assistant's message itself, and it is
 * rendered on every turn with no pacing cap and no adapter in the way. So the
 * NUMBERS go there, complete, and the typed block carries the machine-authored
 * MARK and the entity identities. Neither restates the other, so they cannot
 * drift apart (trap 12).
 *
 * ⛔ NO CONTRACT WIDENING. `OlumiResponseSchema` is `.strict()`; `coaching` is
 * an existing member of its `blocks` discriminated union
 * (`boundary/blocks.js:1185`) and `assistant_text` an existing key. Nothing new
 * is minted at the wire.
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * The 0–1 model unit rendered the way the estate has ALREADY ruled these
 * values must be rendered.
 *
 * ⚠ PERCENTAGES, NEVER RAW DECIMALS, and this is not a style choice made here:
 *   - `RAW_DECIMAL_RE` (`compose/forbidden-user-facing-phrases.ts:395`,
 *     `/(?:^|[\s(=,])(?:0\.\d|\.\d)/`) bans a leading-decimal probability from
 *     user-facing prose, and the Phase-3 prose guard DROPS a block that carries
 *     one. A body reading "0.4" would delete the card that carries the mark.
 *   - `formatEffectSlotReask` (`tools/handlers/d1-shared/format-confirmation.ts`)
 * ⚠⚠ AND THE OBVIOUS STRONGER CLAIM IS FALSE — MEASURED, NOT ASSUMED. This
 * comment first said the output "cannot trip `RAW_DECIMAL_RE`, because the
 * domain is [0, 1] so any decimal point is preceded by a digit". Fuzzed over
 * 300,000 values in [0, 1] with the real regex and a positive control: **2,958
 * hit**. Every one is a value under 0.01, which renders `0.001%` — a leading
 * `0.` after a space, exactly what the guard bans. The TRUE statement is the
 * narrow one: these per-cell lines go ONLY into `assistant_text`, whose egress
 * guard is `applyEgressForbiddenPhraseGuard` + the entity-id scrub and does NOT
 * include `RAW_DECIMAL_RE`; the `coaching` BODY this module builds carries no
 * value at all, only integer counts. Pinned by
 * `route-v2-value-batch-review-visible.test.ts`, which runs the imported regex
 * over the emitted body with a positive control. Move a value into that body
 * and the pin REDs.
 *     already renders THIS EXACT cell type — an option's effect on a factor —
 *     as `${Math.round(v * 100)}%` "of the top", on the ratified ground that a
 *     strategic user must never be asked to understand the internal normalised
 *     coefficient scale.
 *
 * ⚠ AND IT IS LOSSLESS, DELIBERATELY, WHERE THAT SIBLING ROUNDS. The sibling is
 * re-asking for a value, so a rounded reading is the thing being offered. Here
 * the number displayed is the number that will be WRITTEN, and display must
 * equal execute (`compose/format-factor-value.ts` states the same rule for the
 * flip proposal). `0.405` therefore renders `40.5%`, not `41%`. `toPrecision(12)`
 * removes the binary-float tail (`0.07 * 100 === 7.000000000000001`) without
 * discarding a digit the model actually chose.
 */
export function formatModelUnitPercent(value: number): string {
  return `${Number((value * 100).toPrecision(12))}%`;
}

/** How the user sees one cell: which option, which factor, which number. */
function cellAddress(cell: ValueBatchProposedCell): string {
  return `"${cell.option_label ?? cell.option_id}" on "${cell.factor_label ?? cell.factor_id}"`;
}

/**
 * One reviewable line per proposed value. Exported so the route-level suite can
 * bind an assertion to a NAMED CELL rather than to a number another cell could
 * also carry — a value predicate is satisfiable by the wrong object (trap 19).
 */
export function renderValueBatchProposedLine(
  cell: ValueBatchProposedCell & { readonly value: number },
): string {
  const reason = cell.reasoning !== undefined && cell.reasoning.trim().length > 0
    ? ` Why: ${cell.reasoning.trim()}`
    : '';
  return `${cellAddress(cell)}: ${formatModelUnitPercent(cell.value)} of the top.${reason}`;
}

/** One line per cell the model would not estimate, carrying its stated reason. */
export function renderValueBatchDeclinedLine(cell: ValueBatchProposedCell): string {
  return `${cellAddress(cell)}: not estimated. Why not: ${cell.declined_reason ?? 'no reason was given'}`;
}

/**
 * ⭐ THE WHOLE PROPOSAL, AS THE USER READS IT, BEFORE ANY APPROVAL EXISTS.
 *
 * Covers all three populations the module already separates and which the
 * pre-fix wiring dropped together: the values that would be WRITTEN, the cells
 * the model DECLINED (with the reason `buildValueBatchProposal` refuses to let
 * it omit), and the `unsettable` gaps this batch cannot touch at all. Showing
 * the writable set alone would tell the user the plan covers everything open
 * when it does not.
 *
 * ⛔ NO CHOICE DIRECTIVE, NO RECOMMENDATION NOUN. `applyEgressForbiddenPhraseGuard`
 * replaces the WHOLE assistant_text on a hit, so the copy states what the
 * product would do and hands the decision back; it never advises a pick.
 */
export function composeValueBatchReviewText(proposal: ValueBatchProposal): string {
  const writable = writableCells(proposal);
  const declined = proposal.cells.filter((c) => c.value === null);
  const parts: string[] = [];

  if (writable.length > 0) {
    parts.push(
      `Here ${writable.length === 1 ? 'is the number' : `are the ${writable.length} numbers`} I would write. `
      + `I chose ${writable.length === 1 ? 'it' : 'them'}, you did not: `
      + `${writable.length === 1 ? 'it is' : 'each is'} my estimate from your brief and the model. `
      // ⚠ THE SEMANTICS ARE THE PRODUCER'S, QUOTED BACK. The estimator prompt
      // (`readiness-value-estimator.ts`) asks for "the level the factor reaches
      // WHEN THAT OPTION IS TAKEN ... 0 means zero, 1 means its top", and
      // `formatEffectSlotReask` renders the same cell "X% of the top". Calling
      // it the strength of the option's effect would be a different quantity
      // under the same digits.
      + `Each one is the level that factor reaches if you take that option, `
      + `where 100% is the factor's top. Nothing is written until you approve.`,
    );
    parts.push(writable.map(renderValueBatchProposedLine).join('\n'));
  }

  if (declined.length > 0) {
    parts.push(
      `${declined.length === 1 ? 'One value' : `${declined.length} values`} I could not estimate defensibly, `
      + `so ${declined.length === 1 ? 'it stays' : 'they stay'} open for you:`,
    );
    parts.push(declined.map(renderValueBatchDeclinedLine).join('\n'));
  }

  if (proposal.unsettable.length > 0) {
    const n = proposal.unsettable.length;
    parts.push(
      `${n === 1 ? 'One further gap is' : `${n} further gaps are`} outside this set entirely, `
      + `because the model does not yet say which factor ${n === 1 ? 'it affects' : 'they affect'}: `
      + `${proposal.unsettable.map((u) => `"${u.option_label ?? u.option_id}"`).join(', ')}.`,
    );
  }

  return parts.join('\n\n');
}

/**
 * The typed, machine-readable MARK on the turn: these numbers are the product's,
 * and here are the entities they would change.
 *
 * ⭐ WHY A `coaching` BLOCK, DERIVED AT THE BYTES RATHER THAN CHOSEN BY TASTE.
 * The claim "the UI renders this" was verified end to end against
 * `Talchain/DecisionGuideAI` `staging` (c4c6f508):
 *   `responseParser.ts:161` puts `'coaching'` in `PHASE3_TOLERATED_BLOCK_TYPES`
 *   → `:460` lifts it out of `blocks[]` → `:842` stashes it under
 *   `PHASE3_SIDECAR_BLOCKS_KEY` → `extractPhase3FromV5Response.ts:613` collects
 *   it (called unconditionally per V5 turn at `useConversation.ts:4858`) →
 *   `useConversation.ts:5158` `composePhase3BridgedBlocks` → `:1745`
 *   `adaptTypedCoachingBlock` → `InlineBlocks.tsx:805` renders
 *   `<V5CoachingBlock>` → `V5CoachingBlock.tsx:353` renders `body` verbatim at
 *   `data-testid="v5-coaching-body"` and `:422` renders the `target_refs` pills.
 * The UI pins the SAME vendored 0.55.0 tarball, so the shape this builds is the
 * shape that adapter reads.
 *
 * ⚠ `coaching_kind: 'assumption_check'` is not decoration. These ARE the
 * product's assumptions about the user's model, offered to be checked before
 * they are adopted, and the signal/category/priority come from the estate's one
 * authority (`guidanceSignalsForCoachingKind`) rather than being hand-picked
 * here — a hand-picked triple is the mirror that drifts.
 *
 * ⛔ NO `action_intent` / `action_label` / `action_prompt`. The approval already
 * has an affordance (the chip), and the on-card action pill is display-only on
 * the live UI; a second, inert one would be an affordance that does nothing.
 *
 * Returns `null` when the composed block fails its own schema — fail closed, and
 * the caller keeps the numbers in `assistant_text` either way.
 */
export function buildValueBatchReviewBlock(input: {
  readonly proposal: ValueBatchProposal;
  readonly currentGraphHash: string;
  readonly createdAtIso: string;
}): CoachingBlock | null {
  const writable = writableCells(input.proposal);
  const declined = input.proposal.cells.length - writable.length;
  // Identity, not prose: `target_refs` is a STRUCTURED field, so the egress
  // entity-id scrub leaves it alone (`compose/output-safety.ts`, the `coaching`
  // case names it untouched) and the ids survive to the client verbatim. This
  // is what binds each proposed value to the exact option and factor it would
  // change, rather than to a label another entity could share.
  const refs = new Map<string, TargetRef>();
  for (const cell of input.proposal.cells) {
    if (!refs.has(cell.option_id)) {
      refs.set(cell.option_id, {
        id: cell.option_id,
        label: cell.option_label ?? cell.option_id,
        kind: 'option',
      });
    }
    if (!refs.has(cell.factor_id)) {
      refs.set(cell.factor_id, {
        id: cell.factor_id,
        label: cell.factor_label ?? cell.factor_id,
        kind: 'factor',
      });
    }
  }
  const signal_id = `coach:value_batch_review:${input.currentGraphHash}`;
  const candidate = {
    block_id: deterministicBlockId(signal_id),
    signal_id,
    created_at: input.createdAtIso,
    source_handler: READINESS_VALUE_BATCH_HANDLER_ID,
    graph_hash_at_generation: input.currentGraphHash,
    freshness: 'fresh' as const,
    type: 'coaching' as const,
    coaching_kind: VALUE_BATCH_REVIEW_COACHING_KIND,
    title: 'Estimates I made, for you to check',
    // ⚠ BOUNDED BY CONSTRUCTION, not by truncation: every part is a fixed
    // sentence plus two small integers, so this cannot approach the 300-char
    // cap and cannot silently lose a cell. The cells themselves are in
    // `assistant_text`, which has no cap.
    body:
      `${writable.length === 1 ? 'One estimate is' : `${writable.length} estimates are`} waiting for your check`
      + (declined > 0
        ? `, and ${declined} ${declined === 1 ? 'value' : 'values'} I could not estimate`
        : '')
      + `. Every number here is mine, not yours. Nothing is written to your model until you approve.`,
    source: 'deterministic_signal' as const,
    target_refs: [...refs.values()],
    priority_rank: 1,
    ...guidanceSignalsForCoachingKind(VALUE_BATCH_REVIEW_COACHING_KIND),
  };
  const parsed = CoachingBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * ⭐ ONE APPROVAL FOR THE WHOLE SET — the affordance the witnessed turn could
 * not offer.
 *
 * ⛔ THE FABRICATION BOUNDARY IS RESPECTED, AND THE DISTINCTION IS EXACT.
 * The estate's standing rule — pinned in `readiness-answer-loop.spec.ts` and
 * stated in three modules — is that **a chip may carry a value the USER
 * stated; never a value the PRODUCT chose**, because a number on a chip reads
 * as a recommendation and puts a fabricated intervention one click away.
 *
 * This chip carries NO NUMBER. The estimates and their reasoning are rendered
 * on the SAME TURN by `composeValueBatchReviewText` (into `assistant_text`) and
 * marked machine-authored by `buildValueBatchReviewBlock` (a typed `coaching`
 * block), and the chip approves what the user has already read. That is the
 * reviewed path the rule protects, not the one-click bypass it forbids — and it
 * stays on the safe side of the pinned guard by carrying no digit at all.
 *
 * ⚠⚠ THIS SENTENCE WAS FALSE FOR THE WHOLE OF THIS MODULE'S FIRST LIFE, AND
 * THAT IS WHY IT NOW NAMES THE TWO FUNCTIONS RATHER THAN A "REVIEWED PROPOSAL".
 * `proposal` rode into the pending action's `inline_patch` and was read by
 * NOTHING on the way out: `route-v2.ts` consumed `valueBatchOffer.kind` and
 * `.offer` only, the readiness response was composed BEFORE the estimator ran,
 * the chip carried no `detail` and `params: {}`, and `OlumiResponseSchema` is
 * `.strict()` with no pending/inline_patch key — so no client could have
 * rendered it however it was written. Six machine-chosen numbers sat one click
 * away and three separate sites said the user had reviewed them.
 *
 * ⭐ THE COUPLING IS NOW STRUCTURAL, NOT REMEMBERED. `route-v2.ts` takes the
 * value-batch apply control ONLY on a turn where the review text was appended
 * to `assistant_text`; there is no branch that emits the chip without it. A
 * comment asserting visibility is what failed last time — the caller's
 * `valueBatchReviewShown` flag is what replaces it.
 */
export function buildValueBatchOffer(input: {
  readonly proposal: ValueBatchProposal;
  readonly currentGraphHash: string;
  readonly scenarioId: string;
}): ValueBatchOfferOutcome {
  const writable = writableCells(input.proposal);
  // Not `null`: the declined reasons and the unsettable gaps are the only thing
  // the user can be told here, and a bare absence deletes them.
  if (writable.length === 0) return { kind: 'no_writable', proposal: input.proposal };
  const ref = proposalRef(input.scenarioId, input.currentGraphHash);
  const count = writable.length;
  const label = count === 1 ? 'Apply the estimate' : `Apply all ${count} estimates`;
  // ⛔ NO EM DASH. The em dash is a SAFETY_FORBIDDEN_TOKEN
  // (`compose/proposed-change.ts`), so `resolveProposalRenderCopy` replaces any
  // message carrying one with the generic fallback "Apply the proposed change".
  // That fallback is what the deterministic label/ordinal pre-route then matches
  // against, so a chip click replaying THIS message matched NOTHING and the
  // approval fell through to the LLM. Measured with a contrast control: the
  // sibling `readiness_multi_repair_v1` message survives the sanitiser and
  // matches; this one did not. The feature was unreachable by its own
  // affordance because of one character.
  const message = count === 1
    ? 'Approved, apply the estimate.'
    : `Approved, apply all ${count} estimates.`;
  const now = Date.now();
  const pending: PendingAction = {
    id: randomUUID(),
    scenario_id: input.scenarioId,
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: READINESS_VALUE_BATCH_HANDLER_ID,
        proposal: input.proposal,
        params: {},
        target_entity_ids: [...new Set(writable.map((c) => c.option_id))],
      },
      public_label: label,
      public_message: message,
    },
    preconditions: { graph_hash: input.currentGraphHash },
    expires_at_turn_count: GM_HELD_PENDING_TURN_TTL,
    expires_at_iso: new Date(now + PENDING_ACTION_DEFAULT_WALL_TTL_MS).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
  };
  return { kind: 'offer', offer: { pending, chip: { id: ref, label, message } } };
}

export type ValueBatchExecuteOutcome =
  | {
      readonly status: 'invalid';
      readonly reason:
        | 'membership_moved'
        | 'nothing_to_write'
        | 'candidate_invalid'
        | 'encode_unresolved'
        | 'no_progress'
        | 'new_issue';
    }
  | {
      readonly status: 'executed';
      readonly appliedGraph: GraphV3T;
      readonly operations: readonly PatchOperation[];
      readonly assessmentAfter: CanonicalReadinessAssessment;
      readonly writtenCells: readonly (ValueBatchProposedCell & { readonly value: number })[];
    };

/**
 * Build and reassess exactly ONE candidate. Never writes, never partially
 * applies.
 *
 * ⭐ ATOMICITY IS STRUCTURAL, NOT PROCEDURAL. Every operation is applied to a
 * single in-memory candidate by `applyPatchOperations` (which deep-clones and
 * returns a new graph); the candidate is then validated and reassessed AS A
 * WHOLE. Every rejection below returns before any graph leaves this function,
 * so a batch containing one bad cell writes nothing at all — there is no code
 * path that emits a partially-applied graph.
 *
 * ⚠ MEMBERSHIP IS RE-DERIVED, NOT TRUSTED. The graph may have moved between
 * the proposal and the approval; if the derived membership no longer matches
 * the proposal's cell set exactly, this refuses rather than writing estimates
 * against a model the user did not review.
 */
export function executeValueBatch(input: {
  readonly proposal: ValueBatchProposal;
  readonly currentGraph: unknown;
}): ValueBatchExecuteOutcome {
  const before = assessCanonicalAnalysisReadiness(input.currentGraph);
  const membership = selectValueBatchMembership(before);
  const membershipKeys = new Set(membership.cells.map((c) => cellKey(c.option_id, c.factor_id)));
  const proposalKeys = new Set(input.proposal.cells.map((c) => cellKey(c.option_id, c.factor_id)));
  if (
    membershipKeys.size !== proposalKeys.size
    || [...proposalKeys].some((key) => !membershipKeys.has(key))
  ) {
    return { status: 'invalid', reason: 'membership_moved' };
  }

  const writable = writableCells(input.proposal);
  if (writable.length === 0) return { status: 'invalid', reason: 'nothing_to_write' };

  const preParsed = GraphV3.safeParse(input.currentGraph);
  if (!preParsed.success) return { status: 'invalid', reason: 'candidate_invalid' };

  // The served edit prompt's EXAMPLE-2 shape, canonicalised through the SAME
  // parser the model's own output goes through — so a batch-composed operation
  // cannot drift from the LLM path's.
  const raw = writable.map((cell) => ({
    op: 'update_node',
    path: `/nodes/${cell.option_id}/data/interventions/${cell.factor_id}`,
    value: {
      value: cell.value,
      // ⭐ THE PERMANENT MARK. Written into the graph, not merely into the turn.
      source: VALUE_BATCH_INTERVENTION_SOURCE,
      ...(cell.confidence !== undefined ? { value_confidence: cell.confidence } : {}),
      ...(cell.reasoning !== undefined ? { reasoning: cell.reasoning } : {}),
    },
    old_value: null,
    impact: 'moderate',
    rationale: `Applies the reviewed estimate for ${cell.option_label ?? cell.option_id} on ${cell.factor_label ?? cell.factor_id}.`,
  }));
  const operations = parseEditGraphResponse(
    JSON.stringify({ operations: raw, removed_edges: [], warnings: [], coaching: null }),
  ).operations as PatchOperation[];
  if (operations.length !== writable.length) {
    return { status: 'invalid', reason: 'candidate_invalid' };
  }

  const applied = applyPatchOperations(preParsed.data, operations);
  const touched = new Set(writable.map((cell) => cell.option_id));
  const { graph: encoded, unresolvedOptionIds } = encodeOptionInterventionsForEdit(
    applied,
    touched,
  );
  // The encoder's own contract: a non-empty list means the caller MUST defer
  // without committing. Deferring the WHOLE batch is what atomicity means here.
  if (unresolvedOptionIds.length > 0) {
    return { status: 'invalid', reason: 'encode_unresolved' };
  }
  const candidateParsed = GraphV3.safeParse(encoded);
  if (!candidateParsed.success) return { status: 'invalid', reason: 'candidate_invalid' };

  const after = assessCanonicalAnalysisReadiness(encoded);
  // Every cell we wrote must have stopped blocking. If any still does, the
  // write did not achieve what the user approved and the batch is discarded.
  const remaining = new Set(
    selectValueBatchMembership(after).cells.map((c) => cellKey(c.option_id, c.factor_id)),
  );
  if (writable.some((cell) => remaining.has(cellKey(cell.option_id, cell.factor_id)))) {
    return { status: 'invalid', reason: 'no_progress' };
  }
  const beforeKeys = new Set(before.blockingIssues.map(issueKey));
  if (after.blockingIssues.some((issue) => !beforeKeys.has(issueKey(issue)))) {
    return { status: 'invalid', reason: 'new_issue' };
  }
  return {
    status: 'executed',
    appliedGraph: candidateParsed.data,
    operations,
    assessmentAfter: after,
    writtenCells: writable,
  };
}

function issueKey(issue: CanonicalReadinessIssue): string {
  return [issue.code, issue.option_id ?? '', issue.factor_id ?? ''].join(':');
}
