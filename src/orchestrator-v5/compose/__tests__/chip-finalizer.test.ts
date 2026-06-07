/**
 * V5 Lane 2 — deterministic chip-quality finalizer.
 *
 * Covers the SAFE-BY-DEFAULT contract: drops only unsafe (leak/raw-decimal)
 * and blank chips; never drops on an unfamiliar id; never collapses distinct
 * chips by action_type; budget-trims only the suggestion family while
 * preserving every clarification / candidate-pick chip. Plus proposal
 * protection, exact + near-duplicate dedupe, the em-dash regression, and
 * idempotency.
 */

import { describe, expect, it, vi } from 'vitest';

// Silence the per-drop structured warning; we assert on the returned report.
vi.mock('../../../utils/telemetry.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/telemetry.js')>(
    '../../../utils/telemetry.js',
  );
  return { ...actual, log: { ...actual.log, warn: vi.fn() } };
});

import { finalizeChips } from '../chip-finalizer.js';
import type { SuggestedAction } from '../types.js';

const explainChip: SuggestedAction = {
  id: 'chip_action_explain_results',
  label: 'Explain the result',
  message: 'Please explain the analysis result in plain language.',
  action_type: 'explain_results',
};
const flipChip: SuggestedAction = {
  id: 'chip_action_what_would_flip',
  label: 'What could change the outcome?',
  message: 'What could change the outcome of this analysis?',
  action_type: 'what_would_flip',
};
const validatePrompt: SuggestedAction = {
  id: 'chip_prompt_validate_decision',
  label: 'What should we validate?',
  message: 'What should we validate or research to build confidence in this decision?',
};
const flipProposal: SuggestedAction = {
  id: 'prop_aaaaaaaaaaaa',
  label: 'Test margin at 30%',
  message: 'Check whether margin at 30% changes the result.',
  action_type: 'set_factor_value',
};

const ids = (chips: readonly SuggestedAction[]): string[] => chips.map((c) => c.id);

describe('finalizeChips — positive (grounded chips pass unchanged)', () => {
  it('keeps known grounded chips, order and fields intact', () => {
    const input = [explainChip, flipChip, validatePrompt];
    const { chips, report } = finalizeChips(input);
    expect(chips).toEqual(input);
    expect(report.input).toBe(3);
    expect(report.output).toBe(3);
    expect(report.dropped_unsafe).toBe(0);
    expect(report.dropped_generic).toBe(0);
    expect(report.deduped).toBe(0);
    expect(report.over_budget_trimmed).toBe(0);
  });

  it('keeps a chip with a valid action_type even when its id is unfamiliar', () => {
    // Mirrors the route-v2-output-safety fixture: id `chip_explain`,
    // action_type `explain_result`.
    const chip: SuggestedAction = {
      id: 'chip_explain',
      label: 'Explain',
      message: 'Explain the decision.',
      action_type: 'explain_result',
    };
    expect(ids(finalizeChips([chip]).chips)).toEqual(['chip_explain']);
  });
});

describe('finalizeChips — drop unsafe', () => {
  it('drops a chip whose visible label leaks a handler id', () => {
    const leaky: SuggestedAction = {
      id: 'chip_action_x',
      label: 'Please run_analysis now',
      message: 'go',
      action_type: 'run_analysis',
    };
    const { chips, report } = finalizeChips([leaky, explainChip]);
    expect(ids(chips)).toEqual(['chip_action_explain_results']);
    expect(report.dropped_unsafe).toBe(1);
  });

  it('drops a chip whose label leaks a raw proposal id or JSON fragment', () => {
    const rawId: SuggestedAction = { id: 'chip_prompt_a', label: 'See prop_aabbccddeeff', message: 'x' };
    const json: SuggestedAction = { id: 'chip_prompt_b', label: '{"value":1}', message: 'y' };
    const { chips, report } = finalizeChips([rawId, json]);
    expect(chips).toEqual([]);
    expect(report.dropped_unsafe).toBe(2);
  });

  it('drops a bare high-precision raw decimal and counts it', () => {
    const dec: SuggestedAction = {
      id: 'chip_action_x',
      label: 'Confidence 0.4732',
      message: 'ok',
      action_type: 'explain_results',
    };
    const { chips, report } = finalizeChips([dec]);
    expect(chips).toEqual([]);
    expect(report.dropped_unsafe).toBe(1);
    expect(report.dropped_raw_decimal).toBe(1);
  });

  it('drops a raw decimal that appears only in the MESSAGE — #239 re-review', () => {
    // message is emitted in suggested_actions, so a leak there must drop too.
    const dec: SuggestedAction = {
      id: 'chip_action_run_analysis',
      label: 'Run analysis',
      message: 'Use 0.4732',
      action_type: 'run_analysis',
    };
    const { chips, report } = finalizeChips([dec]);
    expect(chips).toEqual([]);
    expect(report.dropped_raw_decimal).toBe(1);
  });

  it('keeps an embedded low-precision decimal in the message (route-v2 "= 0.8" case)', () => {
    const chip: SuggestedAction = {
      id: 'chip_action_run_analysis',
      label: 'Re-run with Delivery Cost',
      message: 'Re-run with Delivery Cost = 0.8',
      action_type: 'run_analysis',
    };
    expect(ids(finalizeChips([chip]).chips)).toEqual(['chip_action_run_analysis']);
  });

  it('drops an unsafe proposal label (prop_ id does not rescue it)', () => {
    const unsafeProp: SuggestedAction = {
      id: 'prop_bbbbbbbbbbbb',
      label: 'Apply graph_hash now',
      message: 'ok',
      action_type: 'set_factor_value',
    };
    const { chips, report } = finalizeChips([unsafeProp]);
    expect(chips).toEqual([]);
    expect(report.dropped_unsafe).toBe(1);
  });

  it('exempts a validated proposal carrying a high-precision FORMATTED decimal', () => {
    const proposal: SuggestedAction = {
      id: 'prop_cccccccccccc',
      label: 'Set rate to 12.567%',
      message: 'Check whether rate at 12.567% changes the result.',
      action_type: 'set_factor_value',
    };
    const nonProposal: SuggestedAction = {
      id: 'chip_action_set_rate',
      label: 'Set rate to 12.567%',
      message: 'Set rate to 12.567%.',
      action_type: 'set_factor_value',
    };
    expect(ids(finalizeChips([proposal]).chips)).toEqual(['prop_cccccccccccc']);
    expect(finalizeChips([nonProposal]).chips).toEqual([]);
  });
});

describe('finalizeChips — generic is BLANK-only / no-filler', () => {
  it('drops a chip that is blank after scrub', () => {
    const blank: SuggestedAction = { id: 'chip_prompt_a', label: '   ', message: 'x' };
    const { chips, report } = finalizeChips([blank]);
    expect(chips).toEqual([]);
    expect(report.dropped_generic).toBe(1);
  });

  it('does NOT drop a non-blank chip just because its id is unfamiliar', () => {
    const unfamiliar: SuggestedAction = { id: 'random_filler', label: 'Continue', message: 'Continue' };
    const { chips, report } = finalizeChips([unfamiliar]);
    expect(ids(chips)).toEqual(['random_filler']);
    expect(report.dropped_generic).toBe(0);
  });

  it('returns no chips when all are unsafe or blank (never pads)', () => {
    const unsafe: SuggestedAction = { id: 'chip_prompt_a', label: 'run_analysis', message: 'x' };
    const blank: SuggestedAction = { id: 'chip_prompt_b', label: '   ', message: '   ' };
    expect(finalizeChips([unsafe, blank]).chips).toEqual([]);
  });
});

describe('finalizeChips — preserves clarification / candidate chips (regression)', () => {
  it('keeps edit-clarify Cancel + label chips (no action_type, edit_clarify_ ids)', () => {
    const cancel: SuggestedAction = {
      id: 'edit_clarify_cancel',
      label: 'Cancel — keep model unchanged',
      message: 'Cancel that change — keep the model as it is.',
    };
    const label: SuggestedAction = {
      id: 'edit_clarify_fac_delivery',
      label: 'Change Delivery cost',
      message: 'For Delivery cost, what value should we use?',
    };
    expect(ids(finalizeChips([label, cancel]).chips)).toEqual([
      'edit_clarify_fac_delivery',
      'edit_clarify_cancel',
    ]);
  });

  it('keeps a candidate chip with a user-authored decimal label (Plan 2.5) — #239 review', () => {
    const planChip: SuggestedAction = {
      id: 'edit_clarify_plan_25',
      label: 'Plan 2.5',
      message: 'Use Plan 2.5',
    };
    expect(ids(finalizeChips([planChip]).chips)).toEqual(['edit_clarify_plan_25']);
  });

  it('keeps proposal-continuation and factor-affect and coaching-prefill chips', () => {
    const proposalRisk: SuggestedAction = { id: 'chip_proposal_apply_risk', label: 'Add as risk', message: 'Add this as a risk.' };
    const factorAffect: SuggestedAction = { id: 'chip_factor_affect_revenue', label: 'Revenue', message: 'How does Revenue affect this decision?' };
    const coachingPrefill: SuggestedAction = { id: 'chip_3f8a9c1d2e4b', label: 'Add evidence', message: 'What evidence would strengthen this factor?' };
    expect(ids(finalizeChips([proposalRisk, factorAffect, coachingPrefill]).chips)).toEqual([
      'chip_proposal_apply_risk',
      'chip_factor_affect_revenue',
      'chip_3f8a9c1d2e4b',
    ]);
  });

  it('does NOT count-trim a candidate-pick list beyond 3', () => {
    const labelChips: SuggestedAction[] = [0, 1, 2, 3].map((i) => ({
      id: `edit_clarify_node${i}`,
      label: `Change Factor ${i}`,
      message: `For Factor ${i}, what value should we use?`,
    }));
    const { chips, report } = finalizeChips(labelChips);
    expect(chips.length).toBe(4);
    expect(report.over_budget_trimmed).toBe(0);
  });

  it('keeps two ambiguous short-confirm candidates that share an action_type', () => {
    const p0: SuggestedAction = {
      id: 'chip_clarify_pending_0',
      label: 'Run the budget analysis',
      message: 'Run the budget analysis.',
      action_type: 'run_analysis',
    };
    const p1: SuggestedAction = {
      id: 'chip_clarify_pending_1',
      label: 'Run the headcount analysis',
      message: 'Run the headcount analysis.',
      action_type: 'run_analysis',
    };
    const { chips, report } = finalizeChips([p0, p1]);
    expect(ids(chips)).toEqual(['chip_clarify_pending_0', 'chip_clarify_pending_1']);
    expect(report.deduped).toBe(0);
    expect(report.over_budget_trimmed).toBe(0);
  });
});

describe('finalizeChips — dedupe', () => {
  it('drops an exact-id duplicate', () => {
    const { chips, report } = finalizeChips([explainChip, { ...explainChip }]);
    expect(ids(chips)).toEqual(['chip_action_explain_results']);
    expect(report.deduped).toBe(1);
  });

  it('drops a near-duplicate by normalized label', () => {
    const a: SuggestedAction = { id: 'chip_prompt_a', label: 'Run analysis', message: 'one' };
    const b: SuggestedAction = { id: 'chip_prompt_b', label: 'run analysis.', message: 'two' };
    const { chips, report } = finalizeChips([a, b]);
    expect(ids(chips)).toEqual(['chip_prompt_a']);
    expect(report.deduped).toBe(1);
  });

  it('does NOT collapse two distinct chips that merely share an action_type', () => {
    const a: SuggestedAction = {
      id: 'chip_action_run_analysis',
      label: 'Run analysis',
      message: 'Run analysis.',
      action_type: 'run_analysis',
    };
    const b: SuggestedAction = {
      id: 'chip_action_run_more',
      label: 'Run it now',
      message: 'Do the run now.',
      action_type: 'run_analysis',
    };
    const { chips, report } = finalizeChips([a, b]);
    expect(ids(chips)).toEqual(['chip_action_run_analysis', 'chip_action_run_more']);
    expect(report.deduped).toBe(0);
  });
});

describe('finalizeChips — proposal protection & budget', () => {
  it('keeps the proposal when the suggestion budget is exceeded', () => {
    const c1: SuggestedAction = { id: 'chip_prompt_a', label: 'A', message: 'Alpha' };
    const c2: SuggestedAction = { id: 'chip_prompt_b', label: 'B', message: 'Bravo' };
    const c3: SuggestedAction = { id: 'chip_prompt_c', label: 'C', message: 'Charlie' };
    const { chips, report } = finalizeChips([flipProposal, c1, c2, c3]);
    expect(ids(chips)).toContain('prop_aaaaaaaaaaaa');
    expect(chips.length).toBe(3);
    expect(report.proposal_protected).toBe(1);
    expect(report.over_budget_trimmed).toBe(1);
  });

  it('is NOT deduped away by a generic variant placed first', () => {
    const genericDup: SuggestedAction = {
      id: 'chip_prompt_x',
      label: 'Test margin at 30%',
      message: 'Check whether margin at 30% changes the result.',
    };
    const { chips, report } = finalizeChips([genericDup, flipProposal]);
    expect(ids(chips)).toEqual(['prop_aaaaaaaaaaaa']);
    expect(report.proposal_protected).toBe(1);
    expect(report.deduped).toBe(1);
  });

  it('caps the suggestion family at 3 and counts the trim', () => {
    const five: SuggestedAction[] = ['a', 'b', 'c', 'd', 'e'].map((k) => ({
      id: `chip_prompt_${k}`,
      label: `Option ${k.toUpperCase()}`,
      message: `Message ${k}`,
    }));
    const { chips, report } = finalizeChips(five);
    expect(chips.length).toBe(3);
    expect(report.over_budget_trimmed).toBe(2);
  });

  it('budget counts only the suggestion family, never candidate chips', () => {
    const suggestions: SuggestedAction[] = ['a', 'b', 'c', 'd'].map((k) => ({
      id: `chip_prompt_${k}`,
      label: `Suggestion ${k.toUpperCase()}`,
      message: `Suggestion message ${k}`,
    }));
    const candidates: SuggestedAction[] = [0, 1, 2, 3].map((i) => ({
      id: `edit_clarify_node${i}`,
      label: `Change Factor ${i}`,
      message: `For Factor ${i}, what value should we use?`,
    }));
    const { chips, report } = finalizeChips([...suggestions, ...candidates]);
    // 3 of 4 suggestions kept (1 trimmed); all 4 candidates kept.
    expect(chips.length).toBe(7);
    expect(report.over_budget_trimmed).toBe(1);
  });
});

describe('finalizeChips — pending-bearing protection (#239 re-review)', () => {
  it('keeps a pending-bearing run_analysis chip over a same-label prompt-only duplicate placed first', () => {
    const promptDup: SuggestedAction = {
      id: 'chip_prompt_rerun',
      label: 'Re-run analysis',
      message: 'Re-run analysis.',
    };
    const resumable: SuggestedAction = {
      id: 'chip_action_rerun_analysis',
      label: 'Re-run analysis',
      message: 'Re-run analysis.',
      action_type: 'run_analysis',
    };
    const { chips, report } = finalizeChips([promptDup, resumable]);
    expect(ids(chips)).toEqual(['chip_action_rerun_analysis']);
    expect(report.deduped).toBe(1);
    // Full-object equality pins that the SURVIVOR is the exact protected chip
    // (action_type + copy preserved, not rewritten or swapped for the prompt-only
    // dup) — the pure pass-through contract that
    // `derivePendingActionsFromFinalizedChips` relies on to read `action_type`.
    expect(chips).toEqual([resumable]);
  });

  it('keeps a pending-bearing what_would_flip chip over a same-label prompt-only duplicate', () => {
    const promptDup: SuggestedAction = {
      id: 'chip_prompt_flip',
      label: 'What could change the outcome?',
      message: 'What could change the outcome of this analysis?',
    };
    const resumable: SuggestedAction = {
      id: 'chip_action_what_would_flip',
      label: 'What could change the outcome?',
      message: 'What could change the outcome of this analysis?',
      action_type: 'what_would_flip',
    };
    const { chips } = finalizeChips([promptDup, resumable]);
    expect(ids(chips)).toEqual(['chip_action_what_would_flip']);
    // Survivor is the exact protected object, action_type intact (see above).
    expect(chips).toEqual([resumable]);
  });

  it('does not budget-trim a pending-bearing chip behind 3 generic suggestions', () => {
    const s1: SuggestedAction = { id: 'chip_prompt_a', label: 'A', message: 'Alpha' };
    const s2: SuggestedAction = { id: 'chip_prompt_b', label: 'B', message: 'Bravo' };
    const s3: SuggestedAction = { id: 'chip_prompt_c', label: 'C', message: 'Charlie' };
    const resumable: SuggestedAction = {
      id: 'chip_action_run_analysis',
      label: 'Run analysis',
      message: 'Run analysis.',
      action_type: 'run_analysis',
    };
    const { chips, report } = finalizeChips([s1, s2, s3, resumable]);
    expect(ids(chips)).toContain('chip_action_run_analysis');
    expect(chips.length).toBe(3);
    expect(report.over_budget_trimmed).toBe(1);
  });

  it('does NOT pull a candidate-list pending-bearing chip into the budget (stays a never-trimmed candidate)', () => {
    // chip_clarify_pending_* carries action_type run_analysis but a
    // candidate-class id — a full pick-list that must never be budget-trimmed.
    const four: SuggestedAction[] = [0, 1, 2, 3].map((i): SuggestedAction => ({
      id: `chip_clarify_pending_${i}`,
      label: `Run the ${i} analysis`,
      message: `Run the ${i} analysis.`,
      action_type: 'run_analysis',
    }));
    const { chips, report } = finalizeChips(four);
    expect(chips.length).toBe(4);
    expect(report.over_budget_trimmed).toBe(0);
  });
});

describe('finalizeChips — em-dash regression & edge cases', () => {
  it('does NOT drop a legitimate em-dash chip (pre-mortem)', () => {
    const preMortem: SuggestedAction = {
      id: 'chip_prompt_run_pre_mortem',
      label: 'Run a pre-mortem',
      message: 'Imagine this decision went wrong — what would have caused it?',
    };
    expect(ids(finalizeChips([preMortem]).chips)).toEqual(['chip_prompt_run_pre_mortem']);
  });

  it('handles empty input', () => {
    const { chips, report } = finalizeChips([]);
    expect(chips).toEqual([]);
    expect(report).toMatchObject({ input: 0, output: 0, deduped: 0, dropped_unsafe: 0 });
  });

  it('is idempotent', () => {
    const input = [flipProposal, explainChip, flipChip, validatePrompt];
    const once = finalizeChips(input).chips;
    const twice = finalizeChips(once).chips;
    expect(twice).toEqual(once);
  });
});
