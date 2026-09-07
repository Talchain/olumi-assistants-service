/**
 * THE CEE-AUTHORED COACHING CHIP → METHOD ARM.
 *
 * What these tests are FOR, stated so a later reader does not mistake them for
 * "the map has two entries":
 *
 *   1. THE ROUND-TRIP IS THE CLAIM. `resolveCoachingIntent` must answer
 *      `pre_mortem` for the exact payload the UI sends when a user clicks the
 *      chip CEE composed — chip-sourced, `chip.intent` ABSENT (the wire has no
 *      such key on an outbound chip), `chip.id` echoed back. That payload
 *      shape is not invented here; it is the shape witnessed on the wire in
 *      the 3 Sep 2026 capture and the shape `buildV5Payload` constructs.
 *   2. THE DECLARED INTENT STILL WINS, AND A DECLINE IS STILL A DECLINE. An
 *      id-based fallback that overrode a producer's own token, or that
 *      resurrected an intent CEE deliberately does not route, would be a
 *      second authority on one question — this estate's signature defect.
 *   3. THE ORDERING INVARIANT STAYS TRUE BY CONSTRUCTION. The turn-executor
 *      pins "no affordance carries both" a coaching intent and a typed
 *      `action_type` pill. The fallback refuses any chip carrying an
 *      `action_type` so that proof cannot be falsified by a future
 *      registration.
 *
 * Binding is by IDENTITY throughout (exact chip id, exact intent token), never
 * by a predicate another chip could satisfy (CLAUDE.md trap 19).
 */

import { describe, expect, it } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import {
  REGISTERED_COACHING_CHIP_IDS,
  coachingIntentForChipId,
} from '../coaching-chip-registry.js';
import { ROUTED_COACHING_INTENTS, resolveCoachingIntent } from '../typed-intent-directive.js';

/**
 * The payload the UI actually sends for a CEE-composed PROMPT chip.
 *
 * Derived from `buildV5Payload` (DGAI `src/v5/buildPayload.ts:150-208`) at UI
 * `86786efb`, the deployed build in the capture: a chip with no `action_type`
 * leaves `hasBoundAction` false, so `source` resolves to `'chip'`, and
 * `base.chip` is written with `id` alone — `wireActionType` and `wireIntent`
 * are both undefined and their keys are omitted entirely.
 */
function ceeComposedPromptChipTurn(chipId: string): MessageTurnPayload {
  return {
    kind: 'message',
    message: 'Imagine this decision went wrong — what would have caused it?',
    turn_class: 'decide',
    source: 'chip',
    chip: { id: chipId },
  } as unknown as MessageTurnPayload;
}

describe('coachingIntentForChipId — CEE reads back the identity it issued', () => {
  it('resolves the pre-mortem chip the decide-stage rule composes', () => {
    expect(coachingIntentForChipId('chip_prompt_run_pre_mortem')).toBe('pre_mortem');
  });

  it('resolves the pre-mortem chip the dispatch and intercept sites compose', () => {
    expect(coachingIntentForChipId('chip_action_run_pre_mortem')).toBe('pre_mortem');
  });

  it('answers undefined for a chip id that is not a coaching method', () => {
    // CONTRAST: a real, live chip id from the same composers. If this resolved,
    // the map would be matching on something other than identity.
    expect(coachingIntentForChipId('chip_action_explain_results')).toBeUndefined();
    expect(coachingIntentForChipId('chip_action_rerun_analysis')).toBeUndefined();
  });

  it('answers undefined for absent / empty input rather than throwing', () => {
    expect(coachingIntentForChipId(undefined)).toBeUndefined();
    expect(coachingIntentForChipId('')).toBeUndefined();
  });

  it('every registered id maps to a token the arm actually routes', () => {
    // A registration naming an intent `ROUTED_COACHING_INTENTS` does not carry
    // would build a directive for a method with no entry in `INTENT_METHOD` —
    // a crash, or worse a silent skip. Derived from the arm, not restated.
    for (const id of REGISTERED_COACHING_CHIP_IDS) {
      const intent = coachingIntentForChipId(id);
      expect(intent, `chip id ${id}`).toBeDefined();
      expect(ROUTED_COACHING_INTENTS as readonly string[]).toContain(intent as string);
    }
  });
});

describe('resolveCoachingIntent — the CEE-authored chip now routes', () => {
  it('routes the pre-mortem chip a user clicks, with NO chip.intent on the wire', () => {
    // ⭐ THE WHOLE DEFECT IN ONE ASSERTION. This payload is what the 3 Sep
    // capture's 13:47:30Z "Run a pre-mortem" click produced, and before this
    // change it resolved to `undefined` — so the pre-mortem method never
    // reached the model and the answer came back as generic post-analysis
    // prose indistinguishable from the `explain_results` turns either side.
    expect(resolveCoachingIntent(ceeComposedPromptChipTurn('chip_prompt_run_pre_mortem'))).toBe(
      'pre_mortem',
    );
    expect(resolveCoachingIntent(ceeComposedPromptChipTurn('chip_action_run_pre_mortem'))).toBe(
      'pre_mortem',
    );
  });

  it('does not route a composer turn that happens to carry a chip id', () => {
    const typed = {
      ...ceeComposedPromptChipTurn('chip_prompt_run_pre_mortem'),
      source: 'composer',
    } as unknown as MessageTurnPayload;
    expect(resolveCoachingIntent(typed)).toBeUndefined();
  });

  it('a DECLARED intent still wins over the id', () => {
    // Two authorities on one question is the failure this guard exists to
    // prevent. The producer's own token is the authority; the id is only ever
    // consulted when there is no token at all.
    const declared = {
      ...ceeComposedPromptChipTurn('chip_prompt_run_pre_mortem'),
      chip: { id: 'chip_prompt_run_pre_mortem', intent: 'outside_view' },
    } as unknown as MessageTurnPayload;
    expect(resolveCoachingIntent(declared)).toBe('outside_view');
  });

  it('a DECLINED intent stays declined — the id must not resurrect it', () => {
    // `estimate_help` is deliberately unrouted (its spark also carries a
    // deterministic `analysis_readiness` pre-route). A fallback that ignored a
    // present-but-declined token would route it into a dead arm.
    const declined = {
      ...ceeComposedPromptChipTurn('chip_prompt_run_pre_mortem'),
      chip: { id: 'chip_prompt_run_pre_mortem', intent: 'estimate_help' },
    } as unknown as MessageTurnPayload;
    expect(resolveCoachingIntent(declined)).toBeUndefined();
  });

  it('refuses a chip carrying an action_type, keeping the turn-executor ordering pin true', () => {
    const typedPill = {
      ...ceeComposedPromptChipTurn('chip_action_run_pre_mortem'),
      source: 'chip_click',
      chip: { id: 'chip_action_run_pre_mortem', action_type: 'explain_results' },
    } as unknown as MessageTurnPayload;
    expect(resolveCoachingIntent(typedPill)).toBeUndefined();
  });
});
