/**
 * THE PARSER AND THE DIRECTIVE — the two places a model's output could leak
 * authority it has not earned.
 *
 * The parser must be readable ONLY as a positively-asserted verdict; anything
 * else is "I don't know", because "I don't know" costs nothing and
 * "impoverished" costs a redraw. The directive must carry codes and counts and
 * NOTHING ELSE, because it lands in the system-authority region of the next
 * prompt where user-derived text is an injection carrier.
 */

import { describe, it, expect } from 'vitest';
import { parseJudgeOutput } from '../judge.js';
import { buildImpoverishmentDirective } from '../directive.js';
import { computeDraftCoverage } from '../coverage.js';
import { IMPOVERISHMENT_GROUNDS } from '../types.js';

describe('parseJudgeOutput — a verdict must be asserted, never inferred', () => {
  it('accepts a well-formed adequate verdict', () => {
    expect(parseJudgeOutput('{"verdict":"adequate"}')).toEqual({ kind: 'adequate' });
  });

  it('accepts a well-formed impoverished verdict with recognised grounds', () => {
    expect(
      parseJudgeOutput('{"verdict":"impoverished","grounds":["collapsed_dimensions"]}'),
    ).toEqual({ kind: 'impoverished', grounds: ['collapsed_dimensions'] });
  });

  it('tolerates a fenced code block (models add them unbidden)', () => {
    expect(parseJudgeOutput('```json\n{"verdict":"adequate"}\n```')).toEqual({ kind: 'adequate' });
  });

  it.each([
    ['not JSON at all', 'the model looks fine to me'],
    ['valid JSON, wrong shape', '{"quality":"good"}'],
    ['an array', '[{"verdict":"adequate"}]'],
    ['a null', 'null'],
    ['an unrecognised verdict word', '{"verdict":"terrible"}'],
    ['empty', ''],
    ['impoverished with NO grounds', '{"verdict":"impoverished"}'],
    ['impoverished with only unrecognised grounds', '{"verdict":"impoverished","grounds":["vibes"]}'],
  ])('⛔ %s → unavailable (fails OPEN), never impoverished', (_label, raw) => {
    const verdict = parseJudgeOutput(raw);
    expect(verdict.kind).toBe('unavailable');
    // The load-bearing half: garbage must not be readable as a reason to spend.
    expect(verdict.kind).not.toBe('impoverished');
  });

  it('drops unrecognised grounds while keeping recognised ones', () => {
    expect(
      parseJudgeOutput(
        '{"verdict":"impoverished","grounds":["vibes","missing_risks","missing_risks"]}',
      ),
    ).toEqual({ kind: 'impoverished', grounds: ['missing_risks'] });
  });

  it('there is NO channel through which model-authored content can arrive', () => {
    const verdict = parseJudgeOutput(
      '{"verdict":"impoverished","grounds":["off_brief"],' +
        '"suggested_factors":["Board control"],"explanation":"add a control factor"}',
    );
    // Everything but the two modelled fields is discarded. An enriching pass
    // cannot be reintroduced by prompt edit — it would need a type change.
    expect(verdict).toEqual({ kind: 'impoverished', grounds: ['off_brief'] });
    expect(JSON.stringify(verdict)).not.toContain('Board control');
  });
});

describe('buildImpoverishmentDirective — system-authority region, so codes and counts only', () => {
  const COVERAGE = computeDraftCoverage({
    nodes: [
      { id: 'dec_1', kind: 'decision' },
      { id: 'opt_a', kind: 'option', label: 'Top-tier VC on tough terms' },
      { id: 'opt_b', kind: 'option', label: 'Bootstrap another year' },
      { id: 'fac_1', kind: 'factor', label: 'Equity dilution' },
      { id: 'out_1', kind: 'outcome', label: 'Founder ownership' },
      { id: 'goal_1', kind: 'goal', label: 'Fund the company' },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a' },
      { from: 'dec_1', to: 'opt_b' },
      { from: 'opt_a', to: 'fac_1' },
      { from: 'opt_b', to: 'fac_1' },
      { from: 'fac_1', to: 'out_1' },
      { from: 'out_1', to: 'goal_1' },
    ],
  });

  it('⭐ carries NO node label, id or brief content', () => {
    const directive = buildImpoverishmentDirective(['collapsed_dimensions'], COVERAGE);
    expect(directive).not.toBeNull();
    for (const leak of [
      'Top-tier VC on tough terms',
      'Bootstrap another year',
      'Equity dilution',
      'Founder ownership',
      'opt_a',
      'fac_1',
      'goal_1',
    ]) {
      expect(directive).not.toContain(leak);
    }
    // CONTRAST CONTROL — the sweep can see what IS there, so the absences above
    // are evidence rather than a blind instrument.
    expect(directive).toContain('2 options');
    expect(directive).toContain('1 distinct consideration');
  });

  it('never instructs the model to add a specific thing — only what was inadequate', () => {
    const directive = buildImpoverishmentDirective(['collapsed_dimensions'], COVERAGE) ?? '';
    // The closing rule is what stops "connect everything" being satisfied by
    // inventing a link. Without it, the cheapest compliance is fabrication.
    expect(directive).toContain('Do not invent');
    expect(directive).toContain('leaving something out is better');
  });

  it('every ground has a sentence — a code cannot vanish from the model view', () => {
    for (const ground of IMPOVERISHMENT_GROUNDS) {
      const directive = buildImpoverishmentDirective([ground], null) ?? '';
      expect(directive.length).toBeGreaterThan(0);
      // The gloss table is TOTAL over the enum (`satisfies Record<...>`), so a
      // new ground fails typecheck rather than silently producing a bare code.
      expect(directive).not.toContain(ground);
    }
  });

  it('returns null on an empty grounds list rather than a contentless instruction', () => {
    expect(buildImpoverishmentDirective([], COVERAGE)).toBeNull();
  });
});
