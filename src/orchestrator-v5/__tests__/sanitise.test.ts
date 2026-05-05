import { describe, it, expect } from 'vitest';
import { sanitiseNarrateOutput } from '../sanitise.js';

describe('sanitiseNarrateOutput', () => {
  it('passes clean text through unchanged', () => {
    const input = 'Plain prose with no tags or dashes.';
    const { output, contamination_detected } = sanitiseNarrateOutput(input);
    expect(output).toBe(input);
    expect(contamination_detected).toBe(false);
  });

  it('strips XML-like tags and flags contamination', () => {
    const input = '<thinking>inner reflection</thinking>The real answer.';
    const { output, contamination_detected } = sanitiseNarrateOutput(input);
    expect(output).toContain('The real answer.');
    expect(output).not.toMatch(/<thinking>|<\/thinking>/);
    expect(contamination_detected).toBe(true);
  });

  it('strips multiple tag types in one pass', () => {
    const input = '<a>one</a> middle <b>two</b> tail';
    const { output, contamination_detected } = sanitiseNarrateOutput(input);
    expect(output).not.toMatch(/<[a-zA-Z]/);
    expect(output).toContain('one');
    expect(output).toContain('middle');
    expect(output).toContain('two');
    expect(output).toContain('tail');
    expect(contamination_detected).toBe(true);
  });

  it('replaces em-dashes without flagging contamination', () => {
    const input = 'Two forces \u2014 cost and speed.';
    const { output, contamination_detected } = sanitiseNarrateOutput(input);
    expect(output).not.toContain('\u2014');
    expect(output).toContain(',');
    expect(contamination_detected).toBe(false);
  });

  it('replaces en-dashes with a hyphen without flagging contamination', () => {
    const input = 'Range 5\u201310 items.';
    const { output, contamination_detected } = sanitiseNarrateOutput(input);
    expect(output).not.toContain('\u2013');
    expect(output).toContain('-');
    expect(contamination_detected).toBe(false);
  });

  it('flags contamination and handles mixed XML + em-dash input', () => {
    const input = '<summary>two forces \u2014 cost vs speed</summary>';
    const { output, contamination_detected } = sanitiseNarrateOutput(input);
    expect(output).not.toMatch(/<[a-zA-Z]|\u2014/);
    expect(output).toContain('two forces');
    expect(contamination_detected).toBe(true);
  });

  it('collapses runs of whitespace left behind by tag strips', () => {
    const input = '<a></a>  double    spaces <b></b>';
    const { output } = sanitiseNarrateOutput(input);
    expect(output).not.toMatch(/ {2,}/);
  });

  // V4 parity: banned internal terms are logged via contamination flag but
  // text is preserved verbatim — rewriting risks mangled sentences where a
  // word is a legitimate noun. Mirrors src/orchestrator/deterministic/
  // sanitise-output.ts behaviour (log + flag, no rewrite).
  it('flags banned internal term without rewriting user-facing text', () => {
    const input = 'We will apply a graph_patch to the model now.';
    const { output, contamination_detected } = sanitiseNarrateOutput(input);
    expect(output).toBe(input); // text preserved verbatim
    expect(contamination_detected).toBe(true);
  });

  // Wave 4 — extended internal-vocabulary denylist. Identifier-style
  // tokens are word-boundary matched. Common English words are
  // matched only in code-path contexts so legitimate prose is not
  // flagged.
  describe('Wave 4 internal-vocabulary denylist', () => {
    it.each([
      ['Internal note: noop = true.'],
      ['fact_type was missing.'],
      ['BUDGET_TARGET exceeded.'],
      ['graph_hash mismatch.'],
      ['Zod failed to parse.'],
    ])('flags identifier-style token: %j', (input) => {
      const { contamination_detected } = sanitiseNarrateOutput(input);
      expect(contamination_detected).toBe(true);
    });

    it.each([
      ['mean: 0.5 std: 0.1'],
      ['normalised=true'],
      ['MEAN value present'],
      ['STD computed'],
    ])('flags ambiguous tokens in label/all-caps context: %j', (input) => {
      const { contamination_detected } = sanitiseNarrateOutput(input);
      expect(contamination_detected).toBe(true);
    });

    // Plain English use of `mean`/`std`/`normalised` must not be
    // flagged. (`patch` as a verb is a separate matter — the V4
    // BANNED_TERMS regex flags it across all contexts; that's
    // pre-existing behaviour, not a Wave 4 concern.)
    it.each([
      ['The mean response time was good last quarter.'],
      ['The budget std could be reduced by hiring early.'],
      ['Cost is normalised across the team.'],
    ])('does NOT flag plain English use of mean/std/normalised: %j', (input) => {
      const { contamination_detected } = sanitiseNarrateOutput(input);
      expect(contamination_detected).toBe(false);
    });
  });
});
