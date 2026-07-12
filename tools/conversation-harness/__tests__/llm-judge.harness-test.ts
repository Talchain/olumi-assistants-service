/**
 * Self-test for the LLM-judge PURE logic (scorer/llm-judge.ts): response
 * parsing, aggregation (mean/stdev), and the baseline→candidate delta call. The
 * live model call (judgeMessage) is NOT exercised here — it's a thin wrapper and
 * is opt-in behind LLM_JUDGE=1 + credentials.
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateJudge,
  buildJudgePrompt,
  judgeDelta,
  parseJudgeScores,
  type JudgeScores,
} from '../scorer/llm-judge.js';

const S = (specificity: number, actionability: number, coaching_depth: number, no_generic_filler: number): JudgeScores => ({
  specificity,
  actionability,
  coaching_depth,
  no_generic_filler,
});

describe('parseJudgeScores', () => {
  it('extracts and clamps the four criteria from a JSON-bearing response', () => {
    const p = parseJudgeScores('Here you go: {"specificity":4,"actionability":5,"coaching_depth":3,"no_generic_filler":9}');
    expect(p).toEqual(S(4, 5, 3, 5)); // 9 clamped to 5
  });
  it('returns null on unparseable or incomplete output', () => {
    expect(parseJudgeScores('no json here')).toBeNull();
    expect(parseJudgeScores('{"specificity":4}')).toBeNull(); // missing criteria
  });
});

describe('buildJudgePrompt', () => {
  it('includes the message and optional grounding facts', () => {
    const { system, user } = buildJudgePrompt('You should hire the tech lead.', 'leading option = Tech Lead');
    expect(system).toContain('specificity');
    expect(user).toContain('You should hire the tech lead.');
    expect(user).toContain('leading option = Tech Lead');
  });
});

describe('aggregateJudge', () => {
  it('computes per-criterion and overall mean/stdev over N runs', () => {
    const agg = aggregateJudge([S(4, 4, 4, 4), S(2, 4, 4, 4)]);
    expect(agg.n).toBe(2);
    expect(agg.perCriterion.specificity.mean).toBe(3);
    expect(agg.perCriterion.specificity.stdev).toBe(1);
    expect(agg.overallMean).toBe(3.75); // run overalls: 4.0 and 3.5 -> mean 3.75
  });
});

describe('judgeDelta', () => {
  it('calls a clear, above-noise improvement "better"', () => {
    const base = aggregateJudge([S(2, 2, 2, 2), S(2, 2, 2, 2)]); // stdev 0
    const cand = aggregateJudge([S(4, 4, 4, 4), S(4, 4, 4, 4)]);
    const d = judgeDelta(base, cand);
    expect(d.call).toBe('better');
    expect(d.overall.delta).toBe(2);
    expect(d.perCriterion.every((c) => c.aboveNoise && c.delta === 2)).toBe(true);
  });

  it('treats a delta inside the combined rerun noise as no-change', () => {
    const base = aggregateJudge([S(2, 2, 2, 2), S(4, 4, 4, 4)]); // stdev 1 each
    const cand = aggregateJudge([S(3, 3, 3, 3), S(4, 4, 4, 4)]); // mean 3.5 vs 3, Δ0.5 < noise
    const d = judgeDelta(base, cand);
    expect(d.call).toBe('no-change');
    expect(d.perCriterion.every((c) => c.aboveNoise === false)).toBe(true);
  });

  it('mixes when one criterion clearly rises and another clearly falls', () => {
    const base = aggregateJudge([S(2, 5, 3, 3), S(2, 5, 3, 3)]);
    const cand = aggregateJudge([S(5, 2, 3, 3), S(5, 2, 3, 3)]);
    expect(judgeDelta(base, cand).call).toBe('mixed');
  });
});
