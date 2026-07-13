/**
 * Self-test for the LLM-judge PURE logic (scorer/llm-judge.ts): response
 * parsing, aggregation (mean/stdev), and the baseline→candidate delta call. The
 * live model call (judgeMessage) is NOT exercised here — it's a thin wrapper and
 * is opt-in behind LLM_JUDGE=1 + credentials.
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aggregateJudge,
  buildJudgePrompt,
  factsFromSurfaces,
  judgeDelta,
  pairTurns,
  parseJudgeScores,
  turnsFromRun,
  type JudgeScores,
  type JudgeTurn,
} from '../scorer/llm-judge.js';
import type { TurnSurfaces } from '../scorer/prompt-dims.js';

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

// Judge grounding fix: llm-judge accepted decision facts but the CLI never
// provided them — the judge rewarded FABRICATED specificity. These pin the fact
// rendering + the wire->prompt threading + the corresponding-turn pairing.
describe('factsFromSurfaces (judge grounding) [fix]', () => {
  const surf = (partial: Partial<TurnSurfaces>): TurnSurfaces => ({
    hasHeldProposal: false,
    winProbabilities: null,
    leadingOptionLabel: null,
    optionLabels: [],
    winPctByLabel: {},
    payloadPercentages: [],
    ...partial,
  });

  it('renders options, win-%, leading option, payload figures, and the fabrication instruction', () => {
    const facts = factsFromSurfaces(
      surf({
        optionLabels: ['Option A', 'Option B'],
        winPctByLabel: { 'Option A': 78, 'Option B': 22 },
        leadingOptionLabel: 'Option A',
        payloadPercentages: [78, 22, 92],
      }),
    )!;
    expect(facts).toContain('Option A (win 78%)');
    expect(facts).toContain('Leading option per the analysis: Option A');
    expect(facts).toContain('22, 78, 92');
    expect(facts.toLowerCase()).toContain('fabricated');
  });

  it('renders the HELD state and is null when there is nothing to ground on', () => {
    expect(factsFromSurfaces(surf({ hasHeldProposal: true }))!).toContain('HELD');
    expect(factsFromSurfaces(surf({}))).toBeNull();
    expect(factsFromSurfaces(null)).toBeNull();
  });
});

describe('turnsFromRun threads wire payload facts into the judge turns [fix]', () => {
  it('reads coach turns from scores.json and facts from the run dir wires', () => {
    const dir = mkdtempSync(join(tmpdir(), 'judge-run-'));
    writeFileSync(
      join(dir, 'scores.json'),
      JSON.stringify({
        rows: [
          { turn: 'K1', turn_class_hint: 'coach', text: 'Option A leads at 78%.' },
          { turn: 'R1', turn_class_hint: 'run_analysis', text: 'ignored (not coach)' },
        ],
      }),
    );
    mkdirSync(join(dir, 'turns', 'K1'), { recursive: true });
    writeFileSync(
      join(dir, 'turns', 'K1', 'wire.json'),
      JSON.stringify({
        assistant_text: 'Option A leads at 78%.',
        blocks: [{ type: 'analysis_result', win_probabilities: { 'Option A': 0.78, 'Option B': 0.22 } }],
      }),
    );
    const turns = turnsFromRun(dir);
    expect(turns).toHaveLength(1);
    expect(turns[0].turn).toBe('K1');
    expect(turns[0].graphFacts).toContain('Option A (win 78%)');
  });

  it('graphFacts is null (not fabricated) when the wire is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'judge-run-'));
    writeFileSync(join(dir, 'scores.json'), JSON.stringify({ rows: [{ turn: 'K1', turn_class_hint: 'coach', text: 'hello there world' }] }));
    expect(turnsFromRun(dir)[0].graphFacts).toBeNull();
  });
});

describe('pairTurns (corresponding-turn pairing) [fix]', () => {
  const jt = (turn: string): JudgeTurn => ({ turn, text: `text-${turn}`, graphFacts: null });
  it('pairs by turn id and reports unpaired turns on both sides', () => {
    const { pairs, unpairedBase, unpairedCand } = pairTurns([jt('K1'), jt('K2'), jt('K3')], [jt('K2'), jt('K1'), jt('K9')]);
    expect(pairs.map((p) => p.turn)).toEqual(['K1', 'K2']); // baseline order, K3/K9 unpaired
    expect(unpairedBase).toEqual(['K3']);
    expect(unpairedCand).toEqual(['K9']);
  });
  it('returns no pairs when the sides share no turns', () => {
    expect(pairTurns([jt('A')], [jt('B')]).pairs).toEqual([]);
  });
});
