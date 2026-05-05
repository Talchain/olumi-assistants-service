/**
 * Flagship regression test for the brief's evidence #1.
 *
 * After a successful explain_results turn, the chip set must include a
 * what_would_flip ACTION chip (action_type='what_would_flip'), not a
 * prompt-only chip. Wave 1's derive-pending-actions then auto-persists
 * a matching pending action so a typed "yes" or chip click on the next
 * turn can resume via the deterministic short-confirm pre-route.
 *
 * This test pins the runtime path. An earlier Wave 2.5 attempt put the
 * gating rule on `findHandlerJustRan === 'explain_results'`, which is
 * dead code because findHandlerJustRan only ever returns 'run_analysis'.
 * The fix moved the gate onto a dedicated successful-explain finder.
 */

import { describe, expect, it } from 'vitest';

import { generateChips } from '../chip-generator.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';

function successfulExplainResultsFact(): HandlerFact {
  return {
    fact_type: 'explain_results',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      assistant_text: 'The leading option performs best by 14 points.',
      answer_source: 'sonnet',
    } as never,
  } as HandlerFact;
}

function noopExplainResultsFact(): HandlerFact {
  return {
    fact_type: 'explain_results',
    fact_version: 1,
    noop: true,
    result: {
      precondition_unmet: true,
    } as never,
  } as HandlerFact;
}

describe('chip-generator — what_would_flip chip after successful explain_results', () => {
  it('emits an action chip with action_type=what_would_flip after a successful (non-noop) explain_results', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [successfulExplainResultsFact()],
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label).toBe('Explore what would change this');
    // The crucial assertion — without action_type the chip is a
    // prompt-only chip and Wave 1's derive-pending-actions does not
    // persist a pending action for it. With it, a typed "yes" on the
    // next turn resumes via the deterministic short-confirm
    // pre-route.
    expect(chips[0]?.action_type).toBe('what_would_flip');
  });

  it('does NOT emit the chip after a noop (precondition-unmet) explain_results — the precondition rule fires instead', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [noopExplainResultsFact()],
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
      analysisReady: { status: 'ready' } as never,
    });
    // The precondition-unmet rule emits a single Run-analysis action
    // chip. Whichever chip surfaces, it must NOT be a what_would_flip
    // chip — running what_would_flip when analysis is missing would
    // produce a misleading answer.
    for (const chip of chips) {
      expect(chip.action_type).not.toBe('what_would_flip');
    }
  });
});
