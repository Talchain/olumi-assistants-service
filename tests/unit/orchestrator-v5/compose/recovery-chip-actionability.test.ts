/**
 * ⭐⭐⭐ THE NO-DEAD-END RULE FOR RECOVERY CHIPS — the cross-composer pin.
 *
 * THE RULE
 *   A chip with no `action_type` re-submits its `message`/`prompt` as a fresh
 *   user turn and routes normally. That text is therefore THE WHOLE of what the
 *   product receives. It must NAME A MOVE: an instruction ("Add churn rate to
 *   the model.") or something to look at ("Show me what's in my model.").
 *   **A sentence about HOW THE USER WILL SPEAK NEXT is not a move.**
 *
 * WHY THIS FILE EXISTS RATHER THAN A PREDICATE
 *   "Carries no actionable instruction" is a predicate over open natural
 *   language. This estate has measured what happens to those: CLAUDE.md trap
 *   22f — four consecutive rounds on one such predicate, each fixing one
 *   direction and opening the other, until a reviewer proved the NEXT round
 *   oscillates too. And it could not be complete even in principle here: chip
 *   text can be MODEL-AUTHORED (`coaching/post-analysis-wrapper.ts`
 *   `buildChipFromCard` builds `message` from review-card prose), so the input
 *   space is unbounded. Trap 22f's own stated exit is to pin the KNOWN set
 *   explicitly, with a test that REDs if the set GROWS OR SHRINKS. That is what
 *   this file is. It is NOT a suppression list: nothing here filters anything
 *   at runtime.
 *
 * WHY NOT AT EGRESS
 *   `compose/looping-chip-guard.ts` already stops the sibling shape (a chip
 *   that replays the user's own message) and its predicate is STRUCTURAL —
 *   `normalise(chip.message) === normalise(userMessage)` — so it needs no prose
 *   judgement. This shape has no such oracle: the refusal the product actually
 *   emitted was LLM prose, not a deterministic guard (zero occurrences of that
 *   sentence in this repo). And an egress guard DROPS chips, leaving the user
 *   with fewer options rather than better ones — which is why that guard's own
 *   log line prescribes the composer fix instead.
 *
 * THE MEASUREMENT THIS PINS (staging, 2026-09-14, scenario 9677de7d)
 *   17:13:20Z request 809d0ee2 — `v5.edit_graph.turn outcome:"rejected"
 *   failure_code:"OPERATION_DID_NOT_LAND"` → `mapCodeToRejectionReason` →
 *   `unknown_failure` → `buildEditRejectionResponse` offered
 *   `prompt: 'Let me describe the change differently.'`. The user clicked it;
 *   the product answered that the message "doesn't yet say what you want to
 *   update". A dead end the product built, offered, and then refused.
 *
 * ⚠ THE HISTORIC CORPUS BELOW IS EVIDENCE, NOT A FIXTURE (CLAUDE.md trap 14b).
 *   Each entry is a sentence this product ACTUALLY SHIPPED as a chip and that
 *   was measured, or derived, to name nothing routable. It is APPEND-ONLY. Add
 *   to it when a new dead end is found; never edit or delete an entry, because
 *   that would falsify the record of what was once offered.
 */

import { describe, it, expect } from 'vitest';

import {
  buildEditRejectionResponse,
  type EditRejectionReason,
} from '../../../../src/orchestrator-v5/handlers/edit-rejection-text.js';
import { composeUnsupportedActionResponse } from '../../../../src/orchestrator-v5/compose/unsupported-action-response.js';
import { composeHandlerFailureBody } from '../../../../src/orchestrator-v5/compose/handler-failure-responses.js';
import { OVER_CAP_SPLIT_CHIPS } from '../../../../src/orchestrator/tools/edit-graph.js';
import { HandlerInvocationFailedError } from '../../../../src/orchestrator-v5/tools/handler-errors.js';
import type { ComposeContext } from '../../../../src/orchestrator-v5/compose/types.js';

// ───────────────────────────────────────────────────────────────────────────
// The historic dead-end corpus. APPEND-ONLY. See the header.
// ───────────────────────────────────────────────────────────────────────────
const HISTORIC_DEAD_END_CHIP_TEXT: readonly string[] = [
  // edit-rejection-text.ts — structural_validation / internal_failure /
  // unknown_failure. The one Paul clicked (scenario 9677de7d, 2026-09-14).
  'Let me describe the change differently.',
  // edit-rejection-text.ts — parse_failure (same shape; no live producer today,
  // fixed with its siblings rather than left as the next instance).
  'Let me try describing the edit differently.',
  // unsupported-action-response.ts — the generic fallback chip.
  "Let's try a different approach.",
  // edit-graph.ts — the over-cap split refusal's first chip. Only the user
  // knows which change is most important, so this named nothing.
  "Let's start with the single most important change.",
  // handler-failure-responses.ts — parameter_invalid_at_execute. Role-inverted:
  // our prose, addressed TO the user, sent BY the user, so a click asked the
  // product what the PRODUCT wanted changed.
  "Tell me what you'd like to change.",
];

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

const HISTORIC_NORMALISED = new Set(HISTORIC_DEAD_END_CHIP_TEXT.map(normalise));

/** The click-submitted text of a chip, whichever field carries it. */
function chipText(chip: { message?: string; prompt?: string }): string {
  return chip.message ?? chip.prompt ?? '';
}

function assertNoHistoricDeadEnd(chips: readonly { message?: string; prompt?: string }[], where: string): void {
  for (const chip of chips) {
    const text = chipText(chip);
    expect(text.length, `${where}: chip has no click-submitted text`).toBeGreaterThan(0);
    expect(
      HISTORIC_NORMALISED.has(normalise(text)),
      `${where}: chip text "${text}" is a HISTORIC DEAD END — it was shipped, measured as unroutable, and must not come back. Offer a move (an instruction, or something to look at), or say plainly there is none.`,
    ).toBe(false);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 1. edit-rejection-text.ts — the composer that produced the live defect.
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⭐ EXHAUSTIVE BY THE COMPILER, not by hand (CLAUDE.md trap 12) — the same
 * pattern as `edit-rejection-text.test.ts`. A new `EditRejectionReason` that
 * does not appear here fails TYPECHECK, so a new arm cannot silently escape
 * the rule. The VALUE is the exact set of click-submitted chip texts, in
 * order: it REDs if the set grows OR shrinks, which is trap 22f's stated exit
 * for a rule no predicate can bound.
 */
const EXPECTED_EDIT_REJECTION_CHIP_TEXT: Record<EditRejectionReason, readonly string[]> = {
  too_many_operations: ['Add just the main element to start.'],
  structural_validation: ["Show me what's in my model."],
  parse_failure: ["Show me what's in my model."],
  service_unavailable: ['Try that change again.'],
  internal_failure: ['Try that change again.', "Show me what's in my model."],
  unknown_failure: ['Try that change again.', "Show me what's in my model."],
  entity_not_found: ['Add churn rate to the model.'],
};

const EDIT_REJECTION_REASONS = Object.keys(
  EXPECTED_EDIT_REJECTION_CHIP_TEXT,
) as EditRejectionReason[];

describe('no-dead-end rule — buildEditRejectionResponse', () => {
  for (const reason of EDIT_REJECTION_REASONS) {
    const ctx = reason === 'entity_not_found' ? { label: 'churn rate' } : undefined;

    it(`${reason}: emits EXACTLY the pinned chip text`, () => {
      const { suggestedActions } = buildEditRejectionResponse(reason, ctx);
      expect(suggestedActions.map(chipText)).toEqual([
        ...EXPECTED_EDIT_REJECTION_CHIP_TEXT[reason],
      ]);
    });

    it(`${reason}: no chip repeats a historic dead end`, () => {
      const { suggestedActions } = buildEditRejectionResponse(reason, ctx);
      expect(suggestedActions.length, `${reason} must still offer a next move`).toBeGreaterThanOrEqual(1);
      assertNoHistoricDeadEnd(suggestedActions, `buildEditRejectionResponse(${reason})`);
    });
  }

  /**
   * The negative control for the whole file: the corpus must be able to FIRE.
   * Without this, every assertion above is consistent with a corpus that
   * matches nothing at all (CLAUDE.md trap 13 — an absence assertion needs a
   * positive control, or it passes by testing nothing).
   */
  it('positive control — the corpus DOES match the text that was shipped', () => {
    expect(HISTORIC_NORMALISED.size).toBe(HISTORIC_DEAD_END_CHIP_TEXT.length);
    expect(() =>
      assertNoHistoricDeadEnd(
        [{ prompt: 'Let me describe the change differently.' }],
        'positive control',
      ),
    ).toThrow(/HISTORIC DEAD END/);
    // …and tolerates a trailing-punctuation / case variant of the same sentence.
    expect(() =>
      assertNoHistoricDeadEnd(
        [{ prompt: 'let me describe the change differently' }],
        'positive control (normalised)',
      ),
    ).toThrow(/HISTORIC DEAD END/);
  });

  it('contrast control — a routable sentence does NOT trip the corpus', () => {
    expect(() =>
      assertNoHistoricDeadEnd([{ prompt: 'Add churn rate to the model.' }], 'contrast'),
    ).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The siblings. The remedy is NOT scoped to the one instance: every composer
//    that emitted a chip of this class is covered here, so a regression in any
//    of them REDs this file rather than waiting for the next user to find it.
// ───────────────────────────────────────────────────────────────────────────

describe('no-dead-end rule — sibling composers', () => {
  it('unsupported-action fallback chip names a move', () => {
    // Empty registry → the text-prompt fallback, which is the chip that
    // carried "Let's try a different approach.".
    const ctx: ComposeContext = { handlerRegistry: {} };
    const { response } = composeUnsupportedActionResponse({
      handlerId: 'add_option',
      context: ctx,
      stage: 'frame',
      hasAnalysis: false,
    });
    expect(response.suggested_actions).toHaveLength(1);
    expect(response.suggested_actions[0]!.action_type).toBeUndefined();
    expect(chipText(response.suggested_actions[0]!)).toBe("Show me what's in my model.");
    assertNoHistoricDeadEnd(response.suggested_actions, 'composeUnsupportedActionResponse');
  });

  it('handler-failure parameter_invalid_at_execute chip speaks in the USER voice', () => {
    const err = new HandlerInvocationFailedError('test', {
      cause_kind: 'parameter_invalid_at_execute',
      retryable: false,
      details: { handler_id: 'set_factor_value', specific_issue: 'The value is ambiguous.' },
    });
    const { body } = composeHandlerFailureBody(err);
    expect(body.suggested_actions).toHaveLength(1);
    expect(chipText(body.suggested_actions[0]!)).toBe('Tell me what I can change in my model.');
    assertNoHistoricDeadEnd(body.suggested_actions, 'composeHandlerFailureBody');
  });

  it('over-cap split chips both name a move', () => {
    expect(OVER_CAP_SPLIT_CHIPS.map(chipText)).toEqual([
      'Make just the most important part of that change and leave the rest for now.',
      'Help me break this into a few smaller edits.',
    ]);
    assertNoHistoricDeadEnd(OVER_CAP_SPLIT_CHIPS, 'OVER_CAP_SPLIT_CHIPS');
  });
});
