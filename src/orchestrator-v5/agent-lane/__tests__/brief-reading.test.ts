/**
 * ⭐ C6-2: the per-item verbatim gate on the brief reading (AIQ ruling #70 5858767026).
 *
 * Fixtures are Paul's own first briefs and what gpt-4.1 actually returned for them in the measurement
 * (AIC #70 5858747922, `c62-spans-r1.jsonl`), including the ONE span that was not verbatim: "hire two developers"
 * for "hire a Tech lead or two developers".
 */
import { describe, it, expect, vi } from 'vitest';
import { gateBriefReading, readBrief, MAX_OPTIONS, BRIEF_READING_MODEL, BRIEF_READING_SCHEMA } from '../brief-reading.js';
import { readFileSync } from 'node:fs';

const corpus = JSON.parse(readFileSync(new URL('./fixtures/brief-reading-corpus.json', import.meta.url), 'utf8')) as {
  briefs: Record<string, string>; not_limits: Record<string, string[]>; responses: { id: string; draw: number; spans: unknown }[];
};

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
      limits: [],
    });
  });

  it('RED: the measured miss — "hire two developers" is not in the brief — is DROPPED, its sibling kept', () => {
    const out = gateBriefReading(TECHLEAD, j({ goal: 'increase productivity, while maintaining code quality', options: ['hire a Tech lead', 'hire two developers'] }));
    expect(out).toEqual({ goal: 'increase productivity, while maintaining code quality', options: ['hire a Tech lead'], limits: [] });
  });

  it('never rewritten: a rescaled or paraphrased figure is not a substring, so it is dropped', () => {
    expect(gateBriefReading(PAUL_C, j({ goal: 'reach £100,000 MRR within 6 months', options: [] }))).toBeNull();
    expect(gateBriefReading(PAUL_C, j({ goal: null, options: ['Carry on as now', 'do nothing'] })), 'an invented "carry on" never survives').toBeNull();
  });

  it('whitespace is trimmed, duplicates and an option equal to the goal are dropped', () => {
    const out = gateBriefReading(PAUL_C, j({ goal: ' reach £100k MRR within 6 months ', options: ['invest in additional advertising', 'invest in additional advertising', 'reach £100k MRR within 6 months'] }));
    expect(out).toEqual({ goal: 'reach £100k MRR within 6 months', options: ['invest in additional advertising'], limits: [] });
  });

  it(`more than ${MAX_OPTIONS} options drops them ALL (a partial list would misstate the choice); the goal survives`, () => {
    const brief = `Goal: grow. Options: ${Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `plan ${i}`).join(', ')}.`;
    const out = gateBriefReading(brief, j({ goal: 'grow', options: Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `plan ${i}`) }));
    expect(out).toEqual({ goal: 'grow', options: [], limits: [] });
  });

  it('non-JSON, a non-object, wrong types or nothing surviving → null (fail closed)', () => {
    expect(gateBriefReading(PAUL_C, 'not json')).toBeNull();
    expect(gateBriefReading(PAUL_C, '[]')).toBeNull();
    expect(gateBriefReading(PAUL_C, j({ goal: 7, options: 'invest in additional advertising' }))).toBeNull();
    expect(gateBriefReading(PAUL_C, j({ goal: '', options: [''] }))).toBeNull();
  });
});

describe('readBrief — one call, never throws', () => {
  it('sends the user\'s message with the measured model and the goal / limits / options schema', async () => {
    const call = vi.fn(async () => j({ goal: 'reach £100k MRR within 6 months', options: [] }));
    await expect(readBrief(PAUL_C, call)).resolves.toEqual({ goal: 'reach £100k MRR within 6 months', options: [], limits: [] });
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ model: BRIEF_READING_MODEL, input: PAUL_C, schema: BRIEF_READING_SCHEMA }));
    expect(Object.keys((BRIEF_READING_SCHEMA['properties'] as Record<string, unknown>)).sort()).toEqual(['goal', 'limits', 'options']);
  });

  it('a failing call is no reading, never an error; an empty message makes no call', async () => {
    await expect(readBrief(PAUL_C, async () => { throw new Error('openai_500'); })).resolves.toBeNull();
    const call = vi.fn(async () => '{}');
    await expect(readBrief('   ', call)).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
});

describe('v2 limits — shown only with their own comparator cue, and never a goal\'s or an option\'s words (AIQ GO #70 5859288025)', () => {
  const ASSISTANT = (corpus.briefs as Record<string, string>)['assistant']!;
  const TECHLEAD_LIMITS = ['budget is £200,000', "budget is £200,000, but we'd like to spend less"];

  it('keeps cue-bearing limits verbatim ("£20k budget", "monthly churn under 4%")', () => {
    expect(gateBriefReading(PAUL_C, j({ goal: null, options: [], limits: ['£20k budget', 'monthly churn under 4%'] }))?.limits)
      .toEqual(['£20k budget', 'monthly churn under 4%']);
  });

  it('RED: a cost is never called a limit ("$40,000 to $50,000", "$10,000 per year" carry no cue)', () => {
    expect(gateBriefReading(ASSISTANT, j({ goal: null, options: ['hire a personal assistant'], limits: ['$40,000 to $50,000', '$10,000 per year'] }))?.limits).toEqual([]);
  });

  it('RED: role exclusivity — an option\'s words are never also shown as a limit, whole or in part', () => {
    const brief = 'Should we raise the ad budget to £5k or hire a freelancer?';
    const out = gateBriefReading(brief, j({ goal: null, options: ['raise the ad budget to £5k', 'hire a freelancer'], limits: ['raise the ad budget to £5k', 'ad budget to £5k'] }));
    expect(out).toEqual({ goal: null, options: ['raise the ad budget to £5k', 'hire a freelancer'], limits: [] });
  });

  it('overlapping limits show the longer span only', () => {
    expect(gateBriefReading(TECHLEAD, j({ goal: null, options: [], limits: TECHLEAD_LIMITS }))?.limits).toEqual([TECHLEAD_LIMITS[1]]);
  });

  it('⭐ STANDING REGRESSION: gpt-4.1\'s own 40 responses on 20 briefs (10 external) show 0 costs or facts as limits', () => {
    const briefs = corpus.briefs as Record<string, string>;
    const notLimits = corpus.not_limits as Record<string, string[]>;
    let shown = 0;
    const slips: string[] = [];
    for (const r of corpus.responses as { id: string; draw: number; spans: unknown }[]) {
      const out = gateBriefReading(briefs[r.id]!, JSON.stringify(r.spans));
      shown += out?.limits.length ?? 0;
      for (const l of out?.limits ?? []) if ((notLimits[r.id] ?? []).some((x) => x === l || x.includes(l) || l.includes(x))) slips.push(`${r.id}#${r.draw}: ${l}`);
    }
    expect(Object.keys(briefs), 'control: the whole corpus is here').toHaveLength(20);
    expect(shown, 'control: limits ARE shown across the corpus (a filter that drops everything would pass the next line)').toBeGreaterThanOrEqual(20);
    expect(slips, 'any slip turns limits off (AIQ)').toEqual([]);
  });
});
