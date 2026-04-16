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
});
