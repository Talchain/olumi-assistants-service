/**
 * ⭐⭐ THE READINESS ANSWER LOOP — the affordances that turn a named blocker
 * into something a user can actually answer.
 *
 * ## The gap this closes
 *
 * The product could already DERIVE every question it needed to ask, and could
 * already say them out loud. What it could not do was let anyone ANSWER one.
 * Witnessed on the deployed build (fresh guest, 2026-08-20, UI `2b6ec553` /
 * CEE `19a60fd`): every route a blocked model offered ended in a refusal, and
 * the only working path was typing `Set the <option> option's effect on
 * <factor> to <n>` — a sentence nobody would discover.
 *
 * `readiness-intake.ts` — the arm a typed `analysis_readiness` chip routes to —
 * returned `suggested_actions: []` in ALL THREE of its populated-canvas
 * branches. The chip routed correctly and arrived at prose with no affordance.
 *
 * ## Where the questions come from, and the trap in the obvious source
 *
 * ⚠ NOT from `repairProposal.unresolved_inputs`, and this is the sharpest thing
 * in the file. That array is built ONLY when `blockingIssues.length >= 2`
 * (`analysis-ready-helper.ts`). THIS LOOP CONVERGES TOWARD ONE BLOCKER — every
 * answer removes one — so a loop reading `unresolved_inputs` is correct for
 * questions 1..n-1 and goes BLANK at question n, exactly when the user is one
 * step from running. Any corpus that never plays the loop to completion passes
 * it. Measured over the J4 capture: 5 configured options ⇒ 1 blocker ⇒
 * `repairProposal === null`.
 *
 * So the answerable set is derived from `blockingIssues` directly, through the
 * SAME `repairability === 'human_input_required'` filter `requiredInputForIssue`
 * applies — the authority on "whose gap is this", minus a gate that is about
 * proposal SHAPE rather than about answerability.
 *
 * ## ⛔ THE FABRICATION BOUNDARY — read before adding a value-bearing chip
 *
 * The natural design is a calibrated row (`Small · 0.25` / `Moderate · 0.5` /
 * `Large · 0.8`) that turns a typed sentence into one click. **The estate has
 * already ruled against it, in three places**, and this module conforms:
 *
 *   - `configure-option-chip-text.ts` (on `buildRepairPairChipMessage`):
 *     a chip bearing a plausible number "would put a fabricated intervention
 *     one click away behind a control that reads as the product's
 *     recommendation".
 *   - `routing/configure-option-clarify.ts`: same posture, stated at length.
 *   - `compose/repair-value-ask-response.ts` proves the rule by conforming —
 *     it DOES carry a value in its chip, and that value is documented as
 *     "The user's value, verbatim".
 *
 * The rule, as the estate draws it: **a chip may carry a value the USER has
 * stated; a chip may never carry a value the PRODUCT chose.** So these chips
 * complete the IDENTIFICATION — they name the option and, where the producer
 * knows it, the factor — and leave the number to the user. The clarify
 * composer then asks for it with the 0–1 scale glossed and a concrete example.
 *
 * That boundary is pinned by a test, not just by this comment
 * (`__tests__/readiness-answer-loop.spec.ts`, "THE FABRICATION BOUNDARY").
 *
 * ## No new copy authority
 *
 * Every chip message is built by `configure-option-chip-text.ts`, the estate's
 * single source of configure-option chip copy and the same module the route
 * detector matches against — so a chip minted here is, by construction, a chip
 * the router accepts. Display labels are cut by `elideLabelAtWordBoundary`, the
 * canonical label-elision owner, and only ever in the DISPLAY position: an
 * elided label inside a chip MESSAGE names an entity that exists in no graph,
 * which is the closed loop `configure-option-chip-text.ts` documents at length.
 */

import type { CanonicalReadinessIssue } from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  buildConfigureOptionChipMessage,
  buildRepairPairChipMessage,
} from '../configure-option-chip-text.js';
import { elideLabelAtWordBoundary } from '../../utils/label-elision.js';

/** Display budget for an entity name inside a chip label. */
const MAX_CHIP_LABEL_CHARS = 32;

/**
 * The blocker codes this loop can put to a user as an answerable question.
 *
 * ⭐ IDENTICAL to `WAIVABLE_BY_EXCLUSION` in `analysis-ready-core.ts`, and that
 * is not a coincidence worth hiding: a blocker the exclusion can answer is
 * exactly a blocker about one option having no usable effect — which is exactly
 * the blocker a user can answer by supplying one. The two sets are kept
 * separate because they answer different questions (may the RUN waive this? vs
 * may the LOOP ask about this?) — trap 21: same membership today, different
 * meanings, so they must not be aliased.
 */
const ANSWERABLE_BLOCKER_CODES: ReadonlySet<string> = new Set<string>([
  'MISSING_OPTION_VALUE',
  'OPTION_NEEDS_ENCODING',
  'OPTION_NEEDS_MAPPING',
]);

export interface ReadinessAnswerChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
}

interface LabelLookup {
  label(id: string | undefined): string | null;
}

/** Resolve node labels off the graph the assessment was taken over. */
export function buildLabelLookup(graph: unknown): LabelLookup {
  const byId = new Map<string, string>();
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (node === null || typeof node !== 'object') continue;
      const record = node as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : null;
      const label = typeof record.label === 'string' ? record.label.trim() : '';
      if (id !== null && label.length > 0) byId.set(id, label);
    }
  }
  return {
    label(id) {
      if (typeof id !== 'string') return null;
      return byId.get(id) ?? null;
    },
  };
}

/**
 * The blockers this loop may ASK about, in the producer's own order.
 *
 * `human_input_required` is the same filter `requiredInputForIssue` uses to
 * decide what goes into `unresolved_inputs`; reading it here rather than
 * reading that array is what keeps the final question answerable (see header).
 */
export function selectAnswerableBlockers(
  blockingIssues: readonly CanonicalReadinessIssue[],
): readonly CanonicalReadinessIssue[] {
  return blockingIssues.filter(
    (issue) =>
      issue.repairability === 'human_input_required'
      && ANSWERABLE_BLOCKER_CODES.has(issue.code)
      && typeof issue.option_id === 'string',
  );
}

/**
 * One chip per blocker, naming as much as the producer genuinely knows.
 *
 * Two shapes, and the difference is a fact about the blocker rather than a
 * style choice:
 *
 *   - the producer knows the option AND the factor (`MISSING_OPTION_VALUE`) ⇒
 *     the identity-carrying pair chip, which names the exact slot. A chip that
 *     named only the option would leave the model to choose WHICH factor it
 *     meant — the witnessed defect `buildRepairPairChipMessage` was minted to
 *     fix.
 *   - the producer knows only the option (`OPTION_NEEDS_MAPPING`, whose whole
 *     content is that the factor is unknown) ⇒ the labelled configure chip.
 *     Composing a slot sentence here would mean INVENTING the factor, which is
 *     the same fabrication in a different field.
 */
export function buildAnswerChips(
  blockers: readonly CanonicalReadinessIssue[],
  lookup: LabelLookup,
  limit: number,
): readonly ReadinessAnswerChip[] {
  const chips: ReadinessAnswerChip[] = [];
  for (const issue of blockers) {
    if (chips.length >= limit) break;
    const optionLabel = lookup.label(issue.option_id);
    // No resolvable label ⇒ no chip. A chip naming an entity that resolves to
    // nothing cannot route back into the lane that offered it.
    if (optionLabel === null) continue;
    const factorLabel = lookup.label(issue.factor_id);
    const display = elideLabelAtWordBoundary(optionLabel, MAX_CHIP_LABEL_CHARS);
    chips.push(
      factorLabel !== null
        ? {
            id: `chip_readiness_answer_${issue.issue_id}`,
            label: `Set ${display}`,
            // FULL labels in the message, elided only in the label above.
            message: buildRepairPairChipMessage(optionLabel, factorLabel),
          }
        : {
            id: `chip_readiness_answer_${issue.issue_id}`,
            label: `Configure ${display}`,
            message: buildConfigureOptionChipMessage(optionLabel),
          },
    );
  }
  return chips;
}
