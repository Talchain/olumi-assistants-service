/**
 * R8 (CEE half) — deterministic `held_proposal` block builder.
 *
 * Consciously flips the #405 surface-bolt gate: the 0.15.0 block kind was
 * contract-acknowledged but emission-locked (see
 * __tests__/block-type-allowlist.test.ts). This builder is the ONLY source
 * of held_proposal blocks; the single call site is the edit_graph referee
 * gate's held branch, and the dispatch seam appends the built block
 * unconditionally (R8 flag deleted per Paul's NO-DARK-LAUNCHES ruling; UI
 * card #382 is live). Fail-closed `null` here means nothing is appended.
 *
 * Mirrors the R4 `ui-directive.ts` discipline:
 *   - pure function, fail-closed `null` at every guard;
 *   - typed codes + action refs only — NO free prose, NO doctrine wording
 *     (`blocker.readable` is deliberately never carried; `reason_code`
 *     exists to replace it — 1.43 leak class);
 *   - fixed-template `summary` with a label resolved via the shared
 *     resolve-label walker (never an id-as-label);
 *   - strict pre-emit `HeldProposalBlockSchema.safeParse` — a malformed
 *     KNOWN block strict-fails the whole envelope UI-side (R4 hazard
 *     class), so it is a full-valid block or nothing.
 */

import {
  HeldProposalBlockSchema,
  type HeldProposalBlock,
} from '@talchain/schemas/boundary';

import { resolveLabel, type LabelResolverContext } from './resolve-label.js';
import { sanitisePublicCopyOrFallback } from './proposed-change.js';

/**
 * The `held`-reachable subset of the referee's MutationReasonCode vocabulary
 * that the 0.15.0 HeldProposalReasonCode enum ratifies. Identity mapping by
 * design — the enum members restate CEE's codes (blocks.js Track-3 note).
 * Codes OUTSIDE this set (e.g. GRAPH_OPTIONS_MALFORMED, READINESS_DOWNGRADE)
 * are consciously NOT surfaced: the builder fails closed and today's
 * public-reason block remains the only carrier. Extend only together with
 * the boundary enum (additive schema change first).
 */
const SURFACEABLE_REASON_CODES: ReadonlySet<string> = new Set([
  'STRUCTURAL_APPLY_HELD',
  'TUNABLE_APPLY_HELD',
  'REMOVE_UNCONFIRMED',
  'ADD_OPTION_APPLY_UNWIRED',
  'OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE',
  'FRAME_UNAVAILABLE',
  'CURRENT_GRAPH_UNREADABLE',
  'CLASSIFY_FAILED',
]);

export interface HeldProposalBlockInput {
  /** The deterministic held handle (`gmh_…`) — also the confirm chip id. */
  readonly proposalId: string;
  /** Id of the REAL confirm chip on this response's suggested_actions. */
  readonly confirmActionId: string;
  /** Referee mutation_class — only 'structural' | 'tunable' are emittable. */
  readonly mutationClass: string | null;
  /** Referee blocker code — must map into HeldProposalReasonCode. */
  readonly blockerCode: string | null;
  /**
   * Held-target key from `mutationTargetKey` (`node:<id>` / `edge:<a>-><b>`
   * / `ref:<id>` / `candidate:<id>`). Only node targets resolve to a label;
   * everything else takes the generic summary.
   */
  readonly targetKey: string;
  /** Frame-authority PRE-edit graph for label resolution (may be null). */
  readonly graph: LabelResolverContext['graph'];
  /**
   * Wave-2 ask #20 — the FULL changeset description from
   * `describeHeldOperationsSubject` (1.134 changeset-honesty seam: one
   * specific clause per operation). When present and render-safe it becomes
   * the card-body `summary`, so the user can read exactly what a confirm
   * applies even though the chip label is now clamped short. Null / unsafe
   * falls back to the pre-#20 single-target template.
   */
  readonly changesetDescription?: string | null;
}

/** True iff `text` survives the render-safety sweep verbatim (same
 *  predicate as the referee gate's `subjectIsSafe`). */
function descriptionIsSafe(text: string): boolean {
  return sanitisePublicCopyOrFallback(text, ' ') === text.trim();
}

/**
 * Summary — display-safe by construction, no doctrine prose.
 *
 * Wave-2 ask #20: when the full changeset description is available and
 * render-safe, the card body carries it VERBATIM (the chip label is now
 * clamped short, so this summary is where the user reads exactly what a
 * confirm applies — the safety property the UI deliberately refused to
 * solve with truncation). Otherwise the pre-#20 fixed templates.
 */
function heldSummary(
  targetKey: string,
  graph: LabelResolverContext['graph'],
  changesetDescription: string | null | undefined,
): string {
  if (
    typeof changesetDescription === 'string' &&
    changesetDescription.trim().length > 0 &&
    descriptionIsSafe(changesetDescription)
  ) {
    return `Held for your confirmation: ${changesetDescription.trim()}.`;
  }
  if (targetKey.startsWith('node:')) {
    const id = targetKey.slice('node:'.length);
    const label = resolveLabel(id, { graph });
    if (label !== null) {
      return `A change to '${label}' is held for your confirmation.`;
    }
  }
  return 'A change to the model is held for your confirmation.';
}

/**
 * Build the single held_proposal block for the governing held verdict, or
 * `null` when any input falls outside the ratified wire vocabulary.
 */
export function buildHeldProposalBlock(
  input: HeldProposalBlockInput,
): HeldProposalBlock | null {
  if (input.proposalId.length === 0 || input.confirmActionId.length === 0) return null;
  if (input.mutationClass !== 'structural' && input.mutationClass !== 'tunable') return null;
  if (input.blockerCode === null || !SURFACEABLE_REASON_CODES.has(input.blockerCode)) return null;

  const candidate = {
    type: 'held_proposal' as const,
    proposal_id: input.proposalId,
    summary: heldSummary(input.targetKey, input.graph, input.changesetDescription),
    mutation_class: input.mutationClass,
    reason_code: input.blockerCode,
    confirm_action_id: input.confirmActionId,
  };
  const parsed = HeldProposalBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
