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
 */
import { createHash, randomUUID } from 'node:crypto';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
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

/** The 0–1 model-unit scale every option effect value lives on. */
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
 * This chip carries NO NUMBER. The estimates and their reasoning are shown in
 * the reviewed proposal, in full, and the chip approves what the user has
 * already read. That is the reviewed path the rule protects, not the one-click
 * bypass it forbids — and it stays on the safe side of the pinned guard by
 * carrying no digit at all.
 */
export function buildValueBatchOffer(input: {
  readonly proposal: ValueBatchProposal;
  readonly currentGraphHash: string;
  readonly scenarioId: string;
}): ValueBatchOffer | null {
  const writable = writableCells(input.proposal);
  if (writable.length === 0) return null;
  const ref = proposalRef(input.scenarioId, input.currentGraphHash);
  const count = writable.length;
  const label = count === 1 ? 'Apply the estimate' : `Apply all ${count} estimates`;
  const message = count === 1
    ? 'Approved — apply the estimate.'
    : `Approved — apply all ${count} estimates.`;
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
  return { pending, chip: { id: ref, label, message } };
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
