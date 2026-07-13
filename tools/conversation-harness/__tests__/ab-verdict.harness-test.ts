/**
 * Self-test for the A/B verdict (scorer/ab-verdict.ts). Synthetic per-side
 * PromptDimScore[][] -> expected per-dim deltas + overall call, incl. the gating
 * and flaky-median rules. Pure — no I/O.
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
import { computeAbVerdict, NOISE_THRESHOLD, opsFromRows, type OpsMetrics } from '../scorer/ab-verdict.js';
import { pqCoherence, type TurnSurfaces } from '../scorer/prompt-dims.js';
import type { PromptDimScore, PromptDimDirection } from '../scorer/prompt-dims.js';
import type { TurnRow } from '../scorer/dims.js';

type Meta = { direction: PromptDimDirection; gating: boolean; flaky: boolean; unit: string };
const META: Record<string, Meta> = {
  'PQ1-brevity-density': { direction: 'lower-better', gating: false, flaky: true, unit: 'words' },
  'PQ2-question-asking': { direction: 'neutral', gating: false, flaky: true, unit: 'q/turn' },
  'PQ3-grounding': { direction: 'higher-better', gating: false, flaky: true, unit: 'fraction' },
  'PQ4-chip-correctness': { direction: 'higher-better', gating: false, flaky: true, unit: 'fraction' },
  'PQ5-guard-cleanliness': { direction: 'lower-better', gating: true, flaky: false, unit: 'hits' },
  'PQ6-coherence': { direction: 'lower-better', gating: true, flaky: true, unit: 'contradictions' },
};

function dim(name: string, value: number | null): PromptDimScore {
  return { dim: name, label: name, ...META[name], value, details: {}, notes: [] };
}

/** One run = the six dims with the given values. */
function run(values: Partial<Record<string, number | null>>): PromptDimScore[] {
  return Object.keys(META).map((name) => dim(name, name in values ? (values[name] as number | null) : 0));
}

const find = (v: ReturnType<typeof computeAbVerdict>, dimName: string) => v.dims.find((d) => d.dim === dimName)!;

describe('computeAbVerdict', () => {
  it('calls a clean improvement "better"', () => {
    const baseline = [run({ 'PQ3-grounding': 0.4 })];
    const candidate = [run({ 'PQ3-grounding': 0.8 })];
    const v = computeAbVerdict(baseline, candidate);
    expect(v.overall).toBe('better');
    expect(find(v, 'PQ3-grounding').improved).toBe(true);
  });

  it('a gating regression (guard hit introduced) forces "worse" even with other gains', () => {
    const baseline = [run({ 'PQ3-grounding': 0.4, 'PQ5-guard-cleanliness': 0 })];
    const candidate = [run({ 'PQ3-grounding': 0.9, 'PQ5-guard-cleanliness': 2 })];
    const v = computeAbVerdict(baseline, candidate);
    expect(v.overall).toBe('worse');
    expect(v.reason).toContain('PQ5-guard-cleanliness');
    expect(find(v, 'PQ5-guard-cleanliness').regressed).toBe(true);
    expect(find(v, 'PQ5-guard-cleanliness').gating).toBe(true);
  });

  it('mixes when one dim improves and another (non-gating) regresses', () => {
    const baseline = [run({ 'PQ3-grounding': 0.4, 'PQ4-chip-correctness': 0.9 })];
    const candidate = [run({ 'PQ3-grounding': 0.9, 'PQ4-chip-correctness': 0.4 })];
    expect(computeAbVerdict(baseline, candidate).overall).toBe('mixed');
  });

  it('treats sub-threshold moves as flat -> no-change', () => {
    const baseline = [run({ 'PQ3-grounding': 0.5 })];
    const candidate = [run({ 'PQ3-grounding': 0.5 + NOISE_THRESHOLD['PQ3-grounding'] / 2 })];
    const v = computeAbVerdict(baseline, candidate);
    expect(v.overall).toBe('no-change');
    expect(find(v, 'PQ3-grounding').flat).toBe(true);
  });

  it('ignores the neutral dim in the overall call', () => {
    const baseline = [run({ 'PQ2-question-asking': 0 })];
    const candidate = [run({ 'PQ2-question-asking': 5 })];
    const v = computeAbVerdict(baseline, candidate);
    expect(v.overall).toBe('no-change'); // PQ2 delta is huge but neutral
    expect(find(v, 'PQ2-question-asking').improved).toBe(false);
    expect(find(v, 'PQ2-question-asking').regressed).toBe(false);
  });

  it('aggregates flaky dims by MEDIAN across reruns (an outlier run does not swing it)', () => {
    // grounding baseline median 0.4; candidate runs [0.9, 0.85, 0.1] -> median 0.85 (outlier 0.1 ignored)
    const baseline = [run({ 'PQ3-grounding': 0.4 }), run({ 'PQ3-grounding': 0.4 }), run({ 'PQ3-grounding': 0.4 })];
    const candidate = [run({ 'PQ3-grounding': 0.9 }), run({ 'PQ3-grounding': 0.85 }), run({ 'PQ3-grounding': 0.1 })];
    const v = computeAbVerdict(baseline, candidate);
    expect(find(v, 'PQ3-grounding').candidate).toBe(0.85);
    expect(v.overall).toBe('better');
    expect(v.low_confidence).toBe(false);
  });

  it('flags low confidence and excludes unmeasurable dims', () => {
    const baseline = [run({ 'PQ4-chip-correctness': null })];
    const candidate = [run({ 'PQ4-chip-correctness': null })];
    const v = computeAbVerdict(baseline, candidate);
    expect(v.low_confidence).toBe(true); // only 1 run per side
    expect(find(v, 'PQ4-chip-correctness').measurable).toBe(false);
  });

  // FIX 3 (PQ5 false-PASS): the SAFETY guard aggregates by WORST-run (any-hit),
  // not mean. An intermittent leak (1 of 3 reruns) gives mean 0.333 — under the
  // 0.5 floor, so it would NOT gate (the false-PASS). Worst-run = 1 must gate.
  it('gates on an INTERMITTENT safety-guard hit via worst-run aggregation (1 of 3 runs) [fix]', () => {
    const baseline = [run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 })];
    const candidate = [run({ 'PQ5-guard-cleanliness': 1 }), run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 })];
    const v = computeAbVerdict(baseline, candidate);
    // worst-run 1, NOT mean 0.333 and NOT median 0 — distinguishes the fix.
    expect(find(v, 'PQ5-guard-cleanliness').candidate).toBe(1);
    expect(find(v, 'PQ5-guard-cleanliness').regressed).toBe(true);
    expect(find(v, 'PQ5-guard-cleanliness').gating).toBe(true);
    expect(v.overall).toBe('worse');
  });

  it('does NOT gate the safety guard when no rerun leaks (worst-run 0)', () => {
    const baseline = [run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 })];
    const candidate = [run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 })];
    const v = computeAbVerdict(baseline, candidate);
    expect(find(v, 'PQ5-guard-cleanliness').candidate).toBe(0);
    expect(find(v, 'PQ5-guard-cleanliness').regressed).toBe(false);
  });

  it('a safety-guard IMPROVEMENT (candidate cleaner than baseline) reads as improved', () => {
    // Baseline leaks in its worst run; candidate is clean across all runs.
    const baseline = [run({ 'PQ5-guard-cleanliness': 1 }), run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 })];
    const candidate = [run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 }), run({ 'PQ5-guard-cleanliness': 0 })];
    const v = computeAbVerdict(baseline, candidate);
    expect(find(v, 'PQ5-guard-cleanliness').baseline).toBe(1); // worst-run
    expect(find(v, 'PQ5-guard-cleanliness').improved).toBe(true);
  });
});

// PQ6 worst-run fix, pinned END-TO-END through the REAL producer: dims built by
// pqCoherence (not hand-written metas), so the safety flag must travel
// producer -> scores.json shape -> ab-verdict worst-run aggregation.
describe('PQ6 coherence is worst-run aggregated (any-run contradiction gates) [fix]', () => {
  const trow = (partial: Partial<TurnRow> & { turn: string }): TurnRow => ({
    turnClassHint: 'coach',
    editIntent: false,
    onlyIf: null,
    skipped: false,
    duplicateOf: null,
    httpStatus: 200,
    startedAt: null,
    wallClockMs: null,
    assistantText: '',
    chips: [],
    substageTimings: null,
    guardHits: { forbidden: null, successClaim: null, heldScience: false, mutationLanguage: false, structuralSuccessClaim: false },
    ...partial,
  });
  const heldSurface: Record<string, TurnSurfaces> = {
    T1: {
      hasHeldProposal: true,
      winProbabilities: null,
      leadingOptionLabel: null,
      optionLabels: [],
      winPctByLabel: {},
      payloadPercentages: [],
    },
  };
  /** One run's PQ6 dim: contradictory (success claim while held) or clean. */
  const pq6Run = (contradictory: boolean): PromptDimScore[] => [
    pqCoherence(
      [
        trow({
          turn: 'T1',
          guardHits: {
            forbidden: null,
            successClaim: null,
            heldScience: false,
            mutationLanguage: false,
            structuralSuccessClaim: contradictory,
          },
        }),
      ],
      heldSurface,
    ),
  ];

  it('a contradiction in 1 of 3 candidate reruns forces WORSE (never medianed away)', () => {
    const baseline = [pq6Run(false), pq6Run(false), pq6Run(false)];
    const candidate = [pq6Run(true), pq6Run(false), pq6Run(false)];
    const v = computeAbVerdict(baseline, candidate);
    const pq6 = find(v, 'PQ6-coherence');
    // worst-run 1, NOT median 0 — distinguishes the fix from the old behaviour.
    expect(pq6.candidate).toBe(1);
    expect(pq6.regressed).toBe(true);
    expect(v.overall).toBe('worse');
  });

  it('clean candidate reruns still read flat', () => {
    const v = computeAbVerdict([pq6Run(false), pq6Run(false), pq6Run(false)], [pq6Run(false), pq6Run(false), pq6Run(false)]);
    expect(find(v, 'PQ6-coherence').flat).toBe(true);
  });
});

// OPS promotion criteria fix: ab-verdict must ALSO evaluate latency medians,
// token cost, and fallback-engagement — the B1 experiment showed a candidate
// can "win" on PQ dims while regressing all three unexamined.
describe('OPS metrics in the verdict [fix]', () => {
  const opsRow = (wall: number | null, tin: number | null, tout: number | null, fb: boolean | null, skipped = false) => ({
    turn: 'T',
    skipped,
    wall_clock_ms: wall,
    llm_tokens_in: tin,
    llm_tokens_out: tout,
    fallback_engaged: fb,
  });

  it('opsFromRows derives latency median, total tokens, and fallback rate (null-honest)', () => {
    const ops = opsFromRows([
      opsRow(10_000, 1000, 200, false),
      opsRow(20_000, 2000, 300, true),
      opsRow(30_000, null, null, null),
      opsRow(99_999, 9999, 9999, true, true), // skipped — excluded
    ]);
    expect(ops.latencyMedianMs).toBe(20_000);
    expect(ops.totalTokens).toBe(3500);
    expect(ops.fallbackRate).toBe(0.5); // of the 2 rows with a known fallback signal
  });

  it('opsFromRows is null across the board when the rows carry no signals (old artifacts)', () => {
    const ops = opsFromRows([{ turn: 'T', skipped: false }]);
    expect(ops.latencyMedianMs).toBeNull();
    expect(ops.totalTokens).toBeNull();
    expect(ops.fallbackRate).toBeNull();
  });

  const OPS = (latency: number, tokens: number, fallback: number): OpsMetrics => ({
    latencyMedianMs: latency,
    totalTokens: tokens,
    fallbackRate: fallback,
  });

  it('a beyond-noise latency regression makes the verdict WORSE', () => {
    const baseline = [run({}), run({}), run({})];
    const candidate = [run({}), run({}), run({})];
    const v = computeAbVerdict(baseline, candidate, {
      baselineOps: [OPS(10_000, 20_000, 0), OPS(10_000, 20_000, 0), OPS(10_000, 20_000, 0)],
      candidateOps: [OPS(16_000, 20_000, 0), OPS(16_000, 20_000, 0), OPS(16_000, 20_000, 0)],
    });
    const lat = find(v, 'OPS-latency-median');
    expect(lat.regressed).toBe(true);
    expect(v.overall).toBe('worse');
    // cost + fallback present and flat
    expect(find(v, 'OPS-cost-tokens').flat).toBe(true);
    expect(find(v, 'OPS-fallback-rate').flat).toBe(true);
  });

  it('cost and fallback regressions are scored too', () => {
    const mk = (tokens: number, fb: number) => [OPS(10_000, tokens, fb), OPS(10_000, tokens, fb), OPS(10_000, tokens, fb)];
    const v = computeAbVerdict([run({}), run({}), run({})], [run({}), run({}), run({})], {
      baselineOps: mk(20_000, 0),
      candidateOps: mk(40_000, 0.5),
    });
    expect(find(v, 'OPS-cost-tokens').regressed).toBe(true);
    expect(find(v, 'OPS-fallback-rate').regressed).toBe(true);
    expect(v.overall).toBe('worse');
  });

  it('missing ops (old scores.json) are excluded, never treated as 0', () => {
    const v = computeAbVerdict([run({})], [run({})], {
      baselineOps: [null],
      candidateOps: [null],
    });
    expect(find(v, 'OPS-latency-median').measurable).toBe(false);
    expect(find(v, 'OPS-cost-tokens').measurable).toBe(false);
  });
});
