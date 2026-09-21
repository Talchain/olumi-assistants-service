/**
 * ⭐⭐ THE PROPOSAL THAT MOVES A MISPLACED LIMIT — the producer half of
 * `add_constraint`'s `corrects_node_id` (Codex CX-171).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * `corrects_node_id` lets the writer MOVE a limit instead of appending a
 * second one. Shipped alone it has NO CALLER, and a capability with no
 * producer is this estate's single most expensive failure mode — 42 roadmap
 * items have been working code no user could reach. This is the caller.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 * ⛔ It does not move anything. It builds a PROPOSAL, which the user must
 * confirm. Re-targeting a user's limit on the system's own reading would be
 * exactly the confident wrongness the admissibility check exists to prevent —
 * and the same error one level up from the one that put the limit on a risk
 * node in the first place.
 *
 * ⛔ It mints no new machinery. `emitProposedChange` already materialises the
 * chip AND the `apply_proposed_change` pending; `proposed-change-synthesis.ts`
 * projects `inline_patch.params` one ProposalParameter per top-level key (a
 * FLAT projection with no allowlist, read at the bytes); and the validator
 * skips parameters it does not declare (`validator.ts:504`, `if (!schema)
 * continue`, a pinned contract). So `corrects_node_id` reaches the handler
 * with no change anywhere between here and there.
 *
 * ── REFUSALS ──────────────────────────────────────────────────────────────
 * Returns `null` — propose nothing — when the alternative is the node already
 * targeted (nothing to move), or when any identifier needed to make the move
 * exact is missing. It never proposes a move it cannot specify completely.
 *
 * ⚠ THE COPY CARRIES NO IDS AND NO RAW DECIMALS, because `emitProposedChange`
 * REFUSES such copy at emit time and a refusal here would orphan the pending.
 * The spec proves this by running the REAL emitter rather than asserting that
 * the filter would have been happy.
 *
 * PURE: no I/O, no clock, no graph mutation.
 */
import type { ProposedChange } from '../types/proposed-change.js';

export interface MisplacedLimit {
  /** The node the limit is recorded against today — the one being corrected. */
  readonly nodeId: string;
  /** Its user-facing label, for the copy. */
  readonly nodeLabel: string;
  readonly operator: '>=' | '<=';
  readonly value: number;
  readonly unit: string;
}

export interface CorrectionTarget {
  readonly nodeId: string;
  readonly label: string;
}

/**
 * Render an amount the way a person wrote it, never as a raw decimal.
 *
 * ⚠ `emitProposedChange` refuses copy containing a high-precision or
 * standalone raw decimal, so a naive `${value}` would make the emit fail and
 * silently drop the proposal. Thousands separators and at most two decimal
 * places keep it both readable and emittable.
 */
function formatAmount(value: number, unit: string): string {
  const abs = Math.abs(value);
  const digits = Number.isInteger(value) ? 0 : abs < 10 ? 2 : 0;
  const rendered = value.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // A symbol hugs its number; a code stands apart. "£200,000" / "200,000 FTE".
  return /^[^\w\s]$/u.test(unit) ? `${unit}${rendered}` : `${rendered} ${unit}`;
}

export function buildConstraintTargetCorrection(input: {
  readonly misplaced: MisplacedLimit;
  readonly alternative: CorrectionTarget;
}): ProposedChange | null {
  const { misplaced, alternative } = input;
  if (alternative.nodeId === misplaced.nodeId) return null;
  if (
    misplaced.nodeId.trim() === '' ||
    alternative.nodeId.trim() === '' ||
    misplaced.nodeLabel.trim() === '' ||
    alternative.label.trim() === '' ||
    misplaced.unit.trim() === '' ||
    !Number.isFinite(misplaced.value)
  ) {
    return null;
  }

  const amount = formatAmount(misplaced.value, misplaced.unit);
  const bound = misplaced.operator === '<=' ? 'at most' : 'at least';

  return {
    intent: 'add_constraint',
    label: `Move the limit to ${alternative.label}`,
    message:
      `Put the ${bound} ${amount} limit on ${alternative.label} instead of `
      + `${misplaced.nodeLabel}, and drop it from ${misplaced.nodeLabel}.`,
    params: {
      constraint_type: misplaced.operator === '<=' ? 'at_most' : 'at_least',
      value: misplaced.value,
      unit: misplaced.unit,
      // ⭐ THE WHOLE POINT. Without this the confirmed proposal APPENDS a
      // second row and leaves the original, un-evaluable limit in place —
      // the defect this exists to close, re-created by its own fix.
      corrects_node_id: misplaced.nodeId,
    },
    target_entity_ids: [alternative.nodeId, misplaced.nodeId],
  };
}
