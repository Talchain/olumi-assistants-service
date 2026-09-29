/**
 * V5 M5 — composer-liveness ownership (characterization).
 *
 * Pins WHO owns the final user-facing text on live tool/action turns at the
 * confirmation-template seam (the function the turn-executor's STEP 4 CONFIRM
 * runs via renderConfirmation). This is a READ-ONLY characterization of the
 * CURRENT behaviour — NOT a refactor — so the ownership finding for the durable
 * composer / typed-edit lane (#288) is regression-pinned.
 *
 * Verdict: MIXED (C).
 *   - mutation handlers (set_factor_value / add_constraint / adjust_edge_strength)
 *     forward the handler-authored DETERMINISTIC confirmation verbatim;
 *   - run_analysis is deterministically GATED to a locked allowlist;
 *   - explanation handlers (explain_results / what_would_flip /
 *     explain_from_structure) forward the handler outcome's assistant_text
 *     VERBATIM — and that string CAN be Sonnet's free-form answer_text. So free
 *     LLM text can reach the wire on explanation tool-turns; Brief 4's STEP 6.6
 *     structural-success gate is the reactive honesty rail that catches false
 *     structural-completion claims downstream.
 */
import { describe, expect, it } from 'vitest';

import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';

function confirm(handlerId: string, outcome: unknown): string {
  const tmpl = HANDLER_VALIDATION_REGISTRY[handlerId]?.confirmation_template;
  return typeof tmpl === 'function' ? tmpl(outcome) : String(tmpl ?? '');
}

describe('composer-liveness ownership (characterization)', () => {
  it('explanation handlers FORWARD assistant_text verbatim → free LLM text can reach the wire', () => {
    // On a valid explain turn the handler returns Sonnet's answer_text as
    // outcome.assistant_text; the confirmation template forwards it unchanged.
    const llmAuthored =
      'Option A currently leads because the budget driver dominates — a free-form Sonnet answer.';
    for (const handler of ['explain_results', 'what_would_flip', 'explain_from_structure']) {
      expect(confirm(handler, { assistant_text: llmAuthored }), handler).toBe(llmAuthored);
    }
  });

  it('mutation handlers FORWARD the handler-authored (deterministic) confirmation verbatim', () => {
    // Mutation handlers compose deterministic templated text (no LLM call); the
    // confirmation template forwards it. The HANDLER owns the user-visible string.
    const deterministic = 'Set the budget factor to £5,000.';
    for (const handler of ['set_factor_value', 'add_constraint', 'adjust_edge_strength']) {
      expect(confirm(handler, { assistant_text: deterministic }), handler).toBe(deterministic);
    }
  });

  it('run_analysis confirmation is DETERMINISTICALLY GATED — arbitrary text → locked fallback', () => {
    // run_analysis is the one tool-turn whose success text is NOT a free
    // passthrough: text outside the locked allowlist is swapped for a safe
    // deterministic fallback so a misbehaving handler/mock cannot reach the wire.
    const arbitrary = 'I went ahead and rebuilt your entire decision model from scratch.';
    const out = confirm('run_analysis', { assistant_text: arbitrary });
    expect(out).not.toBe(arbitrary);
    expect(out).toBe('Ran analysis on your current scenario.');
  });
});
