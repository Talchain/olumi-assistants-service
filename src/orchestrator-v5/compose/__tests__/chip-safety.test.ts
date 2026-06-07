/**
 * V5 Lane 2 — egress chip-safety primitives.
 *
 * Covers the leakage-only token subset (SSOT containment with the proposal
 * superset), the em-dash / glossary exclusions that prevent false drops of
 * legitimate chips, and the narrow raw-decimal heuristic with the
 * validated-proposal exemption.
 */

import { describe, expect, it } from 'vitest';

import {
  CHIP_EGRESS_FORBIDDEN_TOKENS,
  findChipLeakToken,
  findChipRawDecimalLeak,
} from '../chip-safety.js';
import { SAFETY_FORBIDDEN_TOKENS } from '../proposed-change.js';

describe('CHIP_EGRESS_FORBIDDEN_TOKENS — SSOT containment', () => {
  it('is a strict subset of the proposal SAFETY_FORBIDDEN_TOKENS superset', () => {
    for (const token of CHIP_EGRESS_FORBIDDEN_TOKENS) {
      expect(SAFETY_FORBIDDEN_TOKENS).toContain(token);
    }
  });

  it('EXCLUDES the typographic em dash (kept only in the proposal superset)', () => {
    expect(SAFETY_FORBIDDEN_TOKENS).toContain('—');
    expect(CHIP_EGRESS_FORBIDDEN_TOKENS).not.toContain('—');
  });

  it('EXCLUDES the `":` fragment (kept only in the proposal superset)', () => {
    expect(SAFETY_FORBIDDEN_TOKENS).toContain('":');
    expect(CHIP_EGRESS_FORBIDDEN_TOKENS).not.toContain('":');
  });

  it('does NOT contain any Communication Glossary words', () => {
    for (const glossary of ['winner', 'recommendation', 'graph', 'node', 'edge']) {
      expect(CHIP_EGRESS_FORBIDDEN_TOKENS).not.toContain(glossary);
    }
  });
});

describe('findChipLeakToken — catches real leaks', () => {
  it.each([
    ['handler id', 'Please run_analysis again', 'run_analysis'],
    ['mutation id', 'do add_constraint', 'add_constraint'],
    ['raw proposal id', 'See prop_aabbccddeeff', 'prop_'],
    ['raw chip id', 'open chip_action_run_analysis', 'run_analysis'],
    ['internal field', 'graph_hash mismatch', 'graph_hash'],
    ['json fragment', '{"value":1}', '{"'],
    ['schema jargon', 'precondition_unmet here', 'precondition_unmet'],
  ])('flags %s', (_desc, text, expectedSubstr) => {
    const hit = findChipLeakToken(text);
    expect(hit).not.toBeNull();
    expect((hit as string).toLowerCase()).toContain(expectedSubstr.toLowerCase());
  });
});

describe('findChipLeakToken — does NOT false-positive', () => {
  it.each([
    ['pre-mortem em-dash message', 'Imagine this decision went wrong — what would have caused it?'],
    ['edit-clarify cancel chip', 'Cancel — keep model unchanged'],
    ['title-case handler label', 'Run analysis'],
    ['plain explanation label', 'Explain the result'],
    ['flip question', 'What could change the outcome?'],
    ['glossary: knowledge contains edge', 'Use your knowledge to decide'],
    ['glossary: graph word', 'Look at the graph of options'],
    ['glossary: node word', 'The anode and the node'],
    ['glossary: winner word', 'Pick the winner'],
    ['glossary: recommendation word', 'My recommendation stands'],
  ])('leaves %s untouched', (_desc, text) => {
    expect(findChipLeakToken(text)).toBeNull();
  });
});

describe('findChipRawDecimalLeak — narrow heuristic', () => {
  const NON_PROPOSAL = { isValidatedProposal: false } as const;
  const VALIDATED_PROPOSAL = { isValidatedProposal: true } as const;

  it('flags a STANDALONE bare decimal (non-proposal)', () => {
    expect(findChipRawDecimalLeak('0.5', '', NON_PROPOSAL)).toBe(true);
    expect(findChipRawDecimalLeak('= 0.8', '', NON_PROPOSAL)).toBe(true);
  });

  it('KEEPS a low-precision decimal embedded in a user-authored name', () => {
    // #239 review: user-authored candidate/option labels like `Plan 2.5` must
    // NOT be dropped solely for a decimal.
    expect(findChipRawDecimalLeak('Plan 2.5', 'Use Plan 2.5', NON_PROPOSAL)).toBe(false);
    expect(findChipRawDecimalLeak('Option 3.5', '', NON_PROPOSAL)).toBe(false);
    expect(findChipRawDecimalLeak('Confidence is 0.5', '', NON_PROPOSAL)).toBe(false);
  });

  it('flags a high-precision bare decimal (non-proposal)', () => {
    expect(findChipRawDecimalLeak('value 0.4732', '', NON_PROPOSAL)).toBe(true);
  });

  it('flags a high-precision decimal even with a unit (non-proposal)', () => {
    expect(findChipRawDecimalLeak('rate 12.567%', '', NON_PROPOSAL)).toBe(true);
  });

  it.each([
    ['percent', '12.5%'],
    ['currency £', '£1.50'],
    ['currency $', '$2.25'],
    ['currency €', '€3.10'],
  ])('leaves a low-precision formatted decimal clean (%s, non-proposal)', (_d, value) => {
    expect(findChipRawDecimalLeak(`Set cap to ${value}`, '', NON_PROPOSAL)).toBe(false);
  });

  it.each([
    ['percent whole', 'Test margin at 30%'],
    ['currency whole', 'Test budget at £50,000'],
    ['time whole', 'Test runway at 12 months'],
    ['unit whole', 'Test team at 20 engineers'],
    ['plain integer', 'Test count at 30'],
  ])('leaves whole-number flip-style copy clean (%s)', (_d, label) => {
    // formatFactorValue only ever emits whole numbers, so flip labels carry
    // no decimal at all — proving the rule cannot break the #236 flip path.
    expect(findChipRawDecimalLeak(label, '', NON_PROPOSAL)).toBe(false);
    expect(findChipRawDecimalLeak(label, '', VALIDATED_PROPOSAL)).toBe(false);
  });

  it('EXEMPTS a validated proposal carrying a high-precision FORMATTED decimal', () => {
    expect(findChipRawDecimalLeak('Set rate to 12.567%', '', VALIDATED_PROPOSAL)).toBe(false);
  });

  it('does NOT exempt a validated proposal carrying an UNFORMATTED high-precision decimal', () => {
    expect(findChipRawDecimalLeak('Set rate to 0.4732', '', VALIDATED_PROPOSAL)).toBe(true);
  });

  it('does NOT exempt a validated proposal carrying a STANDALONE bare decimal', () => {
    expect(findChipRawDecimalLeak('0.8', '', VALIDATED_PROPOSAL)).toBe(true);
  });

  it('returns false when there is no decimal at all', () => {
    expect(findChipRawDecimalLeak('Run the analysis', 'Run analysis.', NON_PROPOSAL)).toBe(false);
  });
});
