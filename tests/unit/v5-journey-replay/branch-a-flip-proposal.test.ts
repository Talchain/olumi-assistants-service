/**
 * V5 replay harness — Branch A flip-proposal assertion self-tests.
 *
 * Pins the contract of the `assertFlipProposalPresent` step + its two
 * exported helpers (`findSetFactorValueProposalChip`,
 * `extractWholeUserScaleValue`). These run today against synthetic
 * `what_would_flip` responses so the assertion is proven correct and
 * ready to enforce on the day PR #236 (feat/v5-p0-2-continuity) ships the
 * real "Test X at N" proposal chip.
 */

import { describe, it, expect } from 'vitest';

import {
  assertFlipProposalPresent,
  extractWholeUserScaleValue,
  findSetFactorValueProposalChip,
} from '../../../tools/v5-journey-replay/assertions.js';
import type { FetchResult } from '../../../tools/v5-journey-replay/client.js';

type Chip = { id: string; label: string; message: string; action_type?: string };

function mkResult(chips: Chip[]): FetchResult {
  return {
    status: 200,
    body: { assistant_text: 'Flip prose.', suggested_actions: chips },
    elapsed_ms: 5,
  };
}

const setFactorChip = (label: string, id = 'prop_abc123def456'): Chip => ({
  id,
  label,
  message: `Let's ${label.toLowerCase()}.`,
  action_type: 'set_factor_value',
});

describe('extractWholeUserScaleValue', () => {
  it.each([
    ['Test Hiring Budget at £50,000', 50000],
    ['Test Spend at $2,000,000', 2000000],
    ['Test Margin at 15%', 15],
    ['Test Headcount at 12', 12],
    // Factor name contains a digit — the trailing N must win, not the "3".
    ['Test Q3 Budget at 20000', 20000],
    // No thousands separator + currency.
    ['Test Budget at £500', 500],
  ])('parses a whole user-scale value from %s', (label, expected) => {
    const parsed = extractWholeUserScaleValue(label);
    expect(parsed).not.toBeNull();
    expect(parsed!.value).toBe(expected);
    expect(parsed!.isWhole).toBe(true);
  });

  it.each([
    ['Test Budget at 14.5', 14.5],
    // The normalised model value must NOT pass as a user-scale whole.
    ['Test Quality at 0.3', 0.3],
    ['Test Spend at £1,234.50', 1234.5],
  ])('flags a non-whole value in %s', (label, expected) => {
    const parsed = extractWholeUserScaleValue(label);
    expect(parsed).not.toBeNull();
    expect(parsed!.value).toBe(expected);
    expect(parsed!.isWhole).toBe(false);
  });

  it('returns null when the label carries no number', () => {
    expect(extractWholeUserScaleValue('Test the hiring budget')).toBeNull();
  });
});

describe('findSetFactorValueProposalChip', () => {
  it('finds a chip by set_factor_value action_type', () => {
    const chip = findSetFactorValueProposalChip([
      { id: 'chip_action_explain_results', label: 'Explain', message: 'Explain.', action_type: 'explain_results' },
      setFactorChip('Test Budget at 15'),
    ]);
    expect(chip?.action_type).toBe('set_factor_value');
  });

  it('finds a chip by prop_ id prefix even if action_type drifts', () => {
    const chip = findSetFactorValueProposalChip([
      { id: 'prop_deadbeef0001', label: 'Test Budget at 15', message: 'Do it.' },
    ]);
    expect(chip?.id).toBe('prop_deadbeef0001');
  });

  it('returns null when no proposal chip is present', () => {
    expect(
      findSetFactorValueProposalChip([
        { id: 'chip_action_rerun_analysis', label: 'Re-run analysis', message: 'Re-run.', action_type: 'run_analysis' },
      ]),
    ).toBeNull();
    expect(findSetFactorValueProposalChip([])).toBeNull();
    expect(findSetFactorValueProposalChip(undefined)).toBeNull();
  });
});

describe('assertFlipProposalPresent', () => {
  it('passes when a Test-X-at-N proposal with a whole user-scale value is present', () => {
    const r = assertFlipProposalPresent(mkResult([setFactorChip('Test Hiring Budget at £50,000')]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.evidence).toContain('user_scale_value=50000');
  });

  it('fails when no set_factor_value proposal chip is present', () => {
    const r = assertFlipProposalPresent(
      mkResult([
        { id: 'chip_action_rerun_analysis', label: 'Re-run analysis', message: 'Re-run.', action_type: 'run_analysis' },
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('branch_a_flip_proposal_chip_absent');
  });

  it('fails when the proposal label carries no value', () => {
    const r = assertFlipProposalPresent(mkResult([setFactorChip('Test the hiring budget')]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('branch_a_flip_proposal_no_value');
  });

  it('fails when the proposal value is not a whole user-scale number', () => {
    const r = assertFlipProposalPresent(mkResult([setFactorChip('Test Quality at 0.3')]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('branch_a_flip_proposal_value_not_whole');
  });

  it('fails when no flip response was captured', () => {
    const r = assertFlipProposalPresent({ status: 200, body: { __body_parse_failed: true }, elapsed_ms: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('branch_a_flip_no_captured_response');
  });
});
