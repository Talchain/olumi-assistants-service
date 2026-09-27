/**
 * ⭐ C6-2: the per-item verbatim gate on the brief reading (AIQ ruling #70 5858767026).
 *
 * Fixtures are Paul's own first briefs and what gpt-4.1 actually returned for them in the measurement
 * (AIC #70 5858747922, `c62-spans-r1.jsonl`), including the ONE span that was not verbatim: "hire two developers"
 * for "hire a Tech lead or two developers".
 */
import { describe, it, expect, vi } from 'vitest';
import { gateBriefReading, readBrief, MAX_OPTIONS, BRIEF_READING_MODEL, BRIEF_READING_SCHEMA } from '../brief-reading.js';

const PAUL_C = 'We need to reach £100k MRR within 6 months with a £20k budget, while keeping monthly churn under 4%. Should we develop new features and increase our Pro plan price from £49 to £59 per month in the next release, or invest in additional advertising?';
const TECHLEAD = 'Should I hire a Tech lead or two developers to increase productivity, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we\'re lacking leadership. Our budget is £200,000, but we\'d like to spend less.';
const j = (v: unknown) => JSON.stringify(v);

describe('gateBriefReading — every item is the user\'s own words, or it is dropped', () => {
  it('keeps exact substrings of the user\'s message, verbatim (Paul\'s brief C as served by gpt-4.1)', () => {
    const out = gateBriefReading(PAUL_C, j({
      goal: 'reach £100k MRR within 6 months',
      options: ['develop new features and increase our Pro plan price from £49 to £59 per month in the next release', 'invest in additional advertising'],
    }));
    expect(out).toEqual({
      goal: 'reach £100k MRR within 6 months',
      options: ['develop new features and increase our Pro plan price from £49 to £59 per month in the next release', 'invest in additional advertising'],
    });
  });

  it('RED: the measured miss — "hire two developers" is not in the brief — is DROPPED, its sibling kept', () => {
    const out = gateBriefReading(TECHLEAD, j({ goal: 'increase productivity, while maintaining code quality', options: ['hire a Tech lead', 'hire two developers'] }));
    expect(out).toEqual({ goal: 'increase productivity, while maintaining code quality', options: ['hire a Tech lead'] });
  });

  it('never rewritten: a rescaled or paraphrased figure is not a substring, so it is dropped', () => {
    expect(gateBriefReading(PAUL_C, j({ goal: 'reach £100,000 MRR within 6 months', options: [] }))).toBeNull();
    expect(gateBriefReading(PAUL_C, j({ goal: null, options: ['Carry on as now', 'do nothing'] })), 'an invented "carry on" never survives').toBeNull();
  });

  it('whitespace is trimmed, duplicates and an option equal to the goal are dropped', () => {
    const out = gateBriefReading(PAUL_C, j({ goal: ' reach £100k MRR within 6 months ', options: ['invest in additional advertising', 'invest in additional advertising', 'reach £100k MRR within 6 months'] }));
    expect(out).toEqual({ goal: 'reach £100k MRR within 6 months', options: ['invest in additional advertising'] });
  });

  it(`more than ${MAX_OPTIONS} options drops them ALL (a partial list would misstate the choice); the goal survives`, () => {
    const brief = `Goal: grow. Options: ${Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `plan ${i}`).join(', ')}.`;
    const out = gateBriefReading(brief, j({ goal: 'grow', options: Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `plan ${i}`) }));
    expect(out).toEqual({ goal: 'grow', options: [] });
  });

  it('non-JSON, a non-object, wrong types or nothing surviving → null (fail closed)', () => {
    expect(gateBriefReading(PAUL_C, 'not json')).toBeNull();
    expect(gateBriefReading(PAUL_C, '[]')).toBeNull();
    expect(gateBriefReading(PAUL_C, j({ goal: 7, options: 'invest in additional advertising' }))).toBeNull();
    expect(gateBriefReading(PAUL_C, j({ goal: '', options: [''] }))).toBeNull();
  });
});

describe('readBrief — one call, never throws', () => {
  it('sends the user\'s message with the measured model and the goal+options schema (no limits field)', async () => {
    const call = vi.fn(async () => j({ goal: 'reach £100k MRR within 6 months', options: [] }));
    await expect(readBrief(PAUL_C, call)).resolves.toEqual({ goal: 'reach £100k MRR within 6 months', options: [] });
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ model: BRIEF_READING_MODEL, input: PAUL_C, schema: BRIEF_READING_SCHEMA }));
    expect(Object.keys((BRIEF_READING_SCHEMA['properties'] as Record<string, unknown>)).sort()).toEqual(['goal', 'options']);
  });

  it('a failing call is no reading, never an error; an empty message makes no call', async () => {
    await expect(readBrief(PAUL_C, async () => { throw new Error('openai_500'); })).resolves.toBeNull();
    const call = vi.fn(async () => '{}');
    await expect(readBrief('   ', call)).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
});
