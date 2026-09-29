/**
 * THE PARITY CHECK THAT EXISTS HAS ONE CALLER, AND EGRESS IS NOT IT.
 *
 * `validateAndFilterChips` (`chip-generator.ts:184`) already implements exactly
 * the right policy — *"dead or misleading chips are worse than missing chips.
 * No fallback action_type is invented; the offending chip is suppressed."* It
 * consults `HandlerValidationRegistry` and drops any chip naming a handler that
 * cannot be dispatched.
 *
 * ⛔ IT RUNS IN EXACTLY ONE PLACE. The egress finalizer `finalizeChips`
 * (`chip-finalizer.ts`), the chokepoint every response passes through, takes no
 * registry at all — measured, with the contrast control in the same sweep:
 *
 *     chip-finalizer.ts   occurrences of "egistry" :  0
 *     chip-generator.ts   occurrences of "egistry" : 16
 *
 * So every chip produced OUTSIDE chip-generator reaches the user unchecked. The
 * measured consequence is Paul's session: the "rebuild the model from an updated
 * brief" chip (`orchestrator/tools/edit-graph.ts:3039`) carries only
 * `{role, label, prompt}` — NO `action_type` at all — so clicking it replays
 * free text and the model answers conversationally instead of rebuilding.
 *
 * ⭐ THE FIX IS NOT A NEW REGISTRY. Three registries are already in exact parity
 * (dispatch, validation, routing tool-schema — same 7 ids, zero drift), and on
 * the typed-chip axis the gap is ZERO. The fix is to run the check that works
 * at the place that does not run it.
 *
 * ⚠ SCOPE, STATED. This closes ONE of five offer channels — the typed
 * `suggested_actions[].action_type` one. `action_intent` pills are documented
 * inert by their own producer, `strengthen_items[].action_type` is LLM-authored,
 * and prose offers carry no affordance. Those are separate and larger.
 *
 * ⚠ FIXTURE NOTE. An earlier draft of this spec used chips carrying `label` but
 * no `message`. `classify()` rule 3 drops those as `generic` BEFORE any registry
 * question arises, so every chip vanished and the first assertion passed for the
 * wrong reason — a test passing on the wrong object. The contrast control is
 * what caught it: it expects a chip to SURVIVE, and an empty output fails it.
 */

import { describe, expect, it } from 'vitest';

import { finalizeChips } from '../chip-finalizer.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { SuggestedAction } from '../types.js';

/** A chip naming a handler that is NOT dispatchable. */
const UNREGISTERED: SuggestedAction = {
  id: 'chip_action_unregistered',
  label: 'Rebuild the model',
  message: 'Rebuild the model from an updated brief',
  action_type: 'reframe_goal',
} as unknown as SuggestedAction;

/** A chip naming a handler that IS dispatchable — the contrast control. */
const REGISTERED: SuggestedAction = {
  id: 'chip_action_explain_results',
  label: 'Explain the results',
  message: 'Explain what the analysis found',
  action_type: 'explain_results',
} as unknown as SuggestedAction;

/** A prompt-only chip: no action_type at all. Must survive untouched. */
const PROMPT_ONLY: SuggestedAction = {
  id: 'chip_prompt_more',
  label: 'Tell me more',
  message: 'Tell me more about the churn risk',
} as unknown as SuggestedAction;

const idsOf = (r: { chips: readonly SuggestedAction[] }) =>
  r.chips.map((c) => (c as { id?: string }).id);

describe('egress finalizer enforces handler parity', () => {
  it('DROPS a chip naming an unregistered handler', () => {
    const out = finalizeChips([UNREGISTERED, REGISTERED], {
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });
    expect(idsOf(out)).not.toContain('chip_action_unregistered');
  });

  it('CONTRAST CONTROL: a registered handler survives, so the check discriminates', () => {
    const out = finalizeChips([UNREGISTERED, REGISTERED], {
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });
    expect(idsOf(out)).toContain('chip_action_explain_results');
  });

  it('a prompt-only chip with no action_type is untouched', () => {
    // The policy is about chips that NAME a handler. A chip that names none is
    // free text by design and is not this check's business.
    const out = finalizeChips([PROMPT_ONLY], {
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });
    expect(idsOf(out)).toContain('chip_prompt_more');
  });

  it('BACKWARD COMPATIBLE: with no registry supplied, nothing new is dropped', () => {
    // ~20 producers call the finalizer without a registry today. They must keep
    // their current behaviour exactly, or this change is not additive.
    const out = finalizeChips([UNREGISTERED, REGISTERED]);
    expect(idsOf(out)).toContain('chip_action_unregistered');
    expect(idsOf(out)).toContain('chip_action_explain_results');
  });
});
