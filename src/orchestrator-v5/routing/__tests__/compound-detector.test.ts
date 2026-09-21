import { describe, expect, it } from 'vitest';

import { detectCompound } from '../compound-detector.js';

describe('detectCompound — true positives', () => {
  it('"set churn to 5% and run the analysis" → detected, segments split on "and"', () => {
    const r = detectCompound('set churn to 5% and run the analysis');
    expect(r.detected).toBe(true);
    expect(r.segments).toEqual(['set churn to 5%', 'run the analysis']);
    expect(r.telemetry.pattern_matched).toBe('and');
  });

  it('"update the price then add a constraint" → detected with "then"', () => {
    const r = detectCompound('update the price then add a constraint');
    expect(r.detected).toBe(true);
    expect(r.telemetry.pattern_matched).toBe('then');
  });

  it('three segments: "set A and change B and run analysis"', () => {
    const r = detectCompound('set A and change B and run analysis');
    expect(r.detected).toBe(true);
    expect(r.segments?.length).toBe(3);
  });

  it('"reduce the cost plus add another option" → plus conjunction', () => {
    const r = detectCompound('reduce the cost plus add another option');
    expect(r.detected).toBe(true);
    expect(r.telemetry.pattern_matched).toBe('plus');
  });
});

describe('detectCompound — true negatives (must not false-positive)', () => {
  it('"between 5 and 10" → not detected (no action verbs)', () => {
    const r = detectCompound('between 5 and 10');
    expect(r.detected).toBe(false);
    expect(r.telemetry.pattern_matched).toBeNull();
  });

  it('"I want to think about marketing and pricing" → not detected (no action verbs)', () => {
    const r = detectCompound('I want to think about marketing and pricing');
    expect(r.detected).toBe(false);
  });

  it('single-action message: "run the analysis" → not detected', () => {
    const r = detectCompound('run the analysis');
    expect(r.detected).toBe(false);
  });

  it('empty string → not detected', () => {
    const r = detectCompound('');
    expect(r.detected).toBe(false);
  });

  it('"and" inside a value literal: "run with seed 42 and continue" → single action-verb side only, not compound', () => {
    // "run" is an action verb on the left segment. "continue" is NOT in
    // ACTION_VERBS, so only one side has an action verb → not compound.
    const r = detectCompound('run with seed 42 and continue');
    expect(r.detected).toBe(false);
  });

  it('"please also review the options" → not detected (just "also" with no second action)', () => {
    const r = detectCompound('please also review the options');
    expect(r.detected).toBe(false);
  });
});
