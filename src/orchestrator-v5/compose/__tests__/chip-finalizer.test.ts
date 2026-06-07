/**
 * V5 Lane 2 — deterministic chip-quality finalizer.
 *
 * Covers classification-driven drops (unsafe / generic), the conservative
 * generic rule (any valid action_type is grounded), exact + near-duplicate
 * dedupe, the safer singleton-only action_type collapse (amendment 3),
 * proposal protection (partition-before-dedupe + budget), the no-filler /
 * empty-safe contract, the 2–3 budget, the em-dash regression, and
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

  it('keeps a chip with a valid action_type even when its id is unfamiliar (conservative)', () => {
    // Mirrors the route-v2-output-safety fixture: id `chip_explain`,
    // action_type `explain_result` — grounded by action_type, never generic.
    const chip: SuggestedAction = {
      id: 'chip_explain',
      label: 'Explain',
      message: 'Explain the decision.',
      action_type: 'explain_result',
    };
    const { chips } = finalizeChips([chip]);
    expect(ids(chips)).toEqual(['chip_explain']);
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

describe('finalizeChips — drop generic / no-filler', () => {
  it('drops an unrecognised chip with no action_type', () => {
    const filler: SuggestedAction = { id: 'random_filler', label: 'Continue', message: 'Continue' };
    const { chips, report } = finalizeChips([filler]);
    expect(chips).toEqual([]);
    expect(report.dropped_generic).toBe(1);
  });

  it('returns no chips when nothing is safely grounded (never pads)', () => {
    const unsafe: SuggestedAction = { id: 'chip_prompt_a', label: 'run_analysis', message: 'x' };
    const generic: SuggestedAction = { id: 'mystery', label: 'Hmm', message: 'Hmm' };
    expect(finalizeChips([unsafe, generic]).chips).toEqual([]);
  });

  it('drops a chip that is blank after scrub', () => {
    const blank: SuggestedAction = { id: 'chip_prompt_a', label: '   ', message: 'x' };
    const { chips, report } = finalizeChips([blank]);
    expect(chips).toEqual([]);
    expect(report.dropped_generic).toBe(1);
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

  it('collapses a SINGLETON action_type duplicate (run_analysis)', () => {
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
    expect(ids(chips)).toEqual(['chip_action_run_analysis']);
    expect(report.deduped).toBe(1);
  });

  it('KEEPS two distinct grounded chips sharing a NON-singleton action_type (different targets) — amendment 3', () => {
    const setPrice: SuggestedAction = {
      id: 'chip_action_set_price',
      label: 'Set price to £50',
      message: 'Set price to £50.',
      action_type: 'set_factor_value',
    };
    const setMargin: SuggestedAction = {
      id: 'chip_action_set_margin',
      label: 'Set margin to 30%',
      message: 'Set margin to 30%.',
      action_type: 'set_factor_value',
    };
    const { chips, report } = finalizeChips([setPrice, setMargin]);
    expect(ids(chips)).toEqual(['chip_action_set_price', 'chip_action_set_margin']);
    expect(report.deduped).toBe(0);
  });
});

describe('finalizeChips — proposal protection', () => {
  it('keeps the proposal when the budget is exceeded', () => {
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
});

describe('finalizeChips — budget and em-dash regression', () => {
  it('caps at 3 useful chips and counts the trim', () => {
    const five: SuggestedAction[] = ['a', 'b', 'c', 'd', 'e'].map((k) => ({
      id: `chip_prompt_${k}`,
      label: `Option ${k.toUpperCase()}`,
      message: `Message ${k}`,
    }));
    const { chips, report } = finalizeChips(five);
    expect(chips.length).toBe(3);
    expect(report.over_budget_trimmed).toBe(2);
  });

  it('does NOT drop a legitimate em-dash chip (pre-mortem)', () => {
    const preMortem: SuggestedAction = {
      id: 'chip_prompt_run_pre_mortem',
      label: 'Run a pre-mortem',
      message: 'Imagine this decision went wrong — what would have caused it?',
    };
    expect(ids(finalizeChips([preMortem]).chips)).toEqual(['chip_prompt_run_pre_mortem']);
  });

  it('does NOT drop the edit-clarify Cancel chip (em dash)', () => {
    const cancel: SuggestedAction = {
      id: 'chip_prompt_cancel',
      label: 'Cancel — keep model unchanged',
      message: 'Cancel that change — keep the model as it is.',
    };
    expect(ids(finalizeChips([cancel]).chips)).toEqual(['chip_prompt_cancel']);
  });
});

describe('finalizeChips — edge cases', () => {
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
