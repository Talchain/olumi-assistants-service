import { describe, it, expect } from 'vitest';
import {
  classifyAnalyticalIntent,
  hasMutationSignal,
} from '../analytical-intent.js';

describe('classifyAnalyticalIntent — what_changed class (V5 P0.2)', () => {
  it('classifies past-tense result-comparison phrasing as what_changed', () => {
    for (const m of [
      'What changed?',
      "What's changed?",
      'What has changed since the last run?',
      'What just changed?',
      'Why did the result change?',
      'Why has the outcome changed?',
      'How did the ranking change?',
      'Did the leading option change?',
      'Did the winner change?',
    ]) {
      expect(classifyAnalyticalIntent(m)).toBe('what_changed');
    }
  });

  it('keeps future/hypothetical "what would change" as what_would_flip (precedence)', () => {
    expect(classifyAnalyticalIntent('What would change the result?')).toBe('what_would_flip');
    expect(classifyAnalyticalIntent('What would flip this?')).toBe('what_would_flip');
    expect(classifyAnalyticalIntent('What would need to change?')).toBe('what_would_flip');
  });

  it('does not steal existing what_drove / explain / rerun phrasings', () => {
    expect(classifyAnalyticalIntent('What drove this result?')).toBe('what_drove');
    expect(classifyAnalyticalIntent('Why did this win?')).toBe('what_drove');
    expect(classifyAnalyticalIntent('Explain the results')).toBe('explain');
    expect(classifyAnalyticalIntent('Should I rerun the analysis?')).toBe('rerun_question');
  });

  it('returns null for non-analytical messages', () => {
    expect(classifyAnalyticalIntent('Hello there')).toBeNull();
    expect(classifyAnalyticalIntent('Draft a model for my hiring decision')).toBeNull();
  });

  it('keeps concrete edits as a mutation signal (anti-hijack)', () => {
    expect(hasMutationSignal('Set pricing to 0.7')).toBe(true);
    expect(hasMutationSignal('Change marketing channel to TikTok')).toBe(true);
    expect(hasMutationSignal('What changed?')).toBe(false);
  });
});
