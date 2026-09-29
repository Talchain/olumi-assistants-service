import { describe, it, expect } from 'vitest';
import type { TurnRow, ChipRef } from '../scorer/dims.js';
import type { TurnSurfaces } from '../scorer/prompt-dims.js';
import { computePromotionVerdict, renderPromotionMd, aggregateWorst, opsDimsForSide, GATE_FLOORS, type PromotionSide } from '../scorer/promotion-verdict.js';
import { computeSplit } from '../scorer/holdout.js';
import type { GateTurn } from '../scorer/gate-dims.js';

const HOLDOUT = ['h-alpha', 'h-beta'];
const ITERATION = ['i-one', 'i-two'];
// A hand-made split so the fixture does not depend on the real journeys/ dir.
const SPLIT = { ok: true, seed: 'test-seed', total: 4, iteration: ITERATION, holdout: HOLDOUT, problems: [] };

function chip(label: string): ChipRef {
  return { id: `c_${Math.random().toString(36).slice(2)}`, label, action: 'apply_edit' };
}
function surfaces(p: Partial<TurnSurfaces> = {}): TurnSurfaces {
  return { hasHeldProposal: false, winProbabilities: null, leadingOptionLabel: null, optionLabels: [], winPctByLabel: {}, payloadPercentages: [], ...p };
}
function row(p: Partial<TurnRow> & { turn: string }): TurnRow {
  return { turnClassHint: null, editIntent: false, onlyIf: null, skipped: false, duplicateOf: null, httpStatus: 200, startedAt: null, wallClockMs: 1000, assistantText: '', chips: [], substageTimings: null, ...p };
}

/** A transcript that clears every floor. */
function goodScenario(): GateTurn[] {
  return [
    { row: row({ turn: 'T1', editIntent: true, mutationCommitted: true, assistantText: 'Added. What is your budget?', chips: [chip('Add a factor')] }), surfaces: surfaces({ optionLabels: ['Plan Alpha'] }), userMessage: 'add a factor' },
    { row: row({ turn: 'T2', editIntent: false, mutationCommitted: false, assistantText: 'Plan Alpha wins 62% of the time. Which market matters most?', chips: [chip('Compare Plan Alpha')] }), surfaces: surfaces({ optionLabels: ['Plan Alpha'], payloadPercentages: [62] }), userMessage: 'how does Plan Alpha look?' },
  ];
}

/** Same shape, but the coach fabricates a figure (fails G4's 1.0 floor). */
function fabricatingScenario(): GateTurn[] {
  const s = goodScenario();
  s[1].row.assistantText = 'Plan Alpha wins 62% of the time with 95% confidence. Which market matters most?';
  return s;
}

function rows(tokens: Array<number | null>): Record<string, unknown>[] {
  return tokens.map((t, i) => ({ turn: `T${i + 1}`, skipped: false, wall_clock_ms: 1000, llm_tokens_in: t, llm_tokens_out: t, fallback_engaged: false }));
}

function side(scenarioIds: string[], make: () => GateTurn[], tokenPlan: Array<number | null> = [50, 50]): PromotionSide {
  return {
    scenarios: Object.fromEntries(scenarioIds.map((id) => [id, make()])),
    rows: Object.fromEntries(scenarioIds.map((id) => [id, rows(tokenPlan)])),
  };
}

const CHECKER = { unsupportedClaimChecker: (t: GateTurn) => (/the simulation showed/i.test(t.row.assistantText) ? 'fabricated_result_reference' : null) };
const OPTS = { mode: 'holdout' as const, split: SPLIT, ...CHECKER };

describe('promotion verdict — the happy path', () => {
  it('PROMOTEs a candidate that clears every floor', () => {
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, goodScenario), OPTS);
    expect(v.blocking_dims).toEqual([]);
    expect(v.promote).toBe(true);
    expect(v.overall).toBe('PROMOTE');
    expect(v.holdout_scenarios).toEqual(HOLDOUT);
    expect(v.dims.every((d) => d.status === 'pass')).toBe(true);
  });

  it('emits a machine-readable per-dimension verdict', () => {
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, goodScenario), OPTS);
    const ids = v.dims.map((d) => d.dim);
    expect(ids).toContain('G1-decision-advancement');
    expect(ids).toContain('G5-unsupported-claim');
    expect(ids).toContain('OPS-latency-median');
    expect(ids).toContain('OPS-cost-tokens');
    for (const d of v.dims) {
      expect(['pass', 'fail', 'unmeasurable']).toContain(d.status);
      expect(d.reason.length).toBeGreaterThan(0);
    }
    expect(JSON.parse(JSON.stringify(v))).toEqual(v); // serialisable
  });
});

describe('promotion verdict — BLOCKS on quality', () => {
  it('BLOCKS a candidate that fabricates a figure (G4 floor is 1.0)', () => {
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, fabricatingScenario), OPTS);
    expect(v.promote).toBe(false);
    expect(v.overall).toBe('BLOCK');
    expect(v.blocking_dims).toContain('G4-canonical-state-use');
  });

  it('BLOCKS on an unsupported claim even if everything else is perfect', () => {
    const cand = side(HOLDOUT, () => {
      const s = goodScenario();
      s[1].row.assistantText = 'The simulation showed Plan Alpha wins 62%. Which market matters most?';
      return s;
    });
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), cand, OPTS);
    expect(v.promote).toBe(false);
    expect(v.blocking_dims).toContain('G5-unsupported-claim');
  });

  it('is a FLOOR, not a ranking: better-than-baseline still BLOCKS if the floor is missed', () => {
    // Baseline is worse than the candidate on G4 — yet the candidate still misses the floor.
    const baseline = side(HOLDOUT, () => {
      const s = goodScenario();
      s[1].row.assistantText = 'Plan Alpha wins 62% with 95% confidence and 88% upside. Which market?';
      return s;
    });
    const v = computePromotionVerdict(baseline, side(HOLDOUT, fabricatingScenario), OPTS);
    const g4 = v.dims.find((d) => d.dim === 'G4-canonical-state-use')!;
    expect(g4.candidate!).toBeGreaterThan(g4.baseline!); // candidate beats baseline...
    expect(g4.status).toBe('fail'); // ...and is still blocked
    expect(v.promote).toBe(false);
  });

  it('ANTI-GAMING: worst-case aggregation — one bad holdout scenario cannot be averaged away', () => {
    const cand: PromotionSide = {
      scenarios: { 'h-alpha': goodScenario(), 'h-beta': fabricatingScenario() },
      rows: { 'h-alpha': rows([50, 50]), 'h-beta': rows([50, 50]) },
    };
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), cand, OPTS);
    expect(v.promote).toBe(false);
    expect(v.blocking_dims).toContain('G4-canonical-state-use');
    // The mean would have been 0.75 — above no floor, but the point is it isn't used.
    expect(v.dims.find((d) => d.dim === 'G4-canonical-state-use')!.candidate).toBe(0.5);
  });
});

describe('promotion verdict — FAILS CLOSED on missing/incomplete data', () => {
  it('BLOCKS when a holdout scenario is missing from the candidate', () => {
    const cand: PromotionSide = { scenarios: { 'h-alpha': goodScenario() }, rows: { 'h-alpha': rows([50, 50]) } };
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), cand, OPTS);
    expect(v.promote).toBe(false);
    expect(v.reason).toMatch(/missing holdout scenario/);
  });

  it('BLOCKS when no unsupported-claim checker is wired ("we did not check" != clean)', () => {
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, goodScenario), { mode: 'holdout', split: SPLIT });
    expect(v.promote).toBe(false);
    expect(v.blocking_dims).toContain('G5-unsupported-claim');
    expect(v.dims.find((d) => d.dim === 'G5-unsupported-claim')!.status).toBe('unmeasurable');
  });

  it('BLOCKS when rows are absent — latency/cost unmeasurable', () => {
    const v = computePromotionVerdict(
      { scenarios: side(HOLDOUT, goodScenario).scenarios },
      { scenarios: side(HOLDOUT, goodScenario).scenarios },
      OPTS,
    );
    expect(v.promote).toBe(false);
    expect(v.blocking_dims).toContain('OPS-cost-tokens');
    expect(v.blocking_dims).toContain('OPS-latency-median');
  });

  it('F14 REUSE: an incomplete cost-bearing turn makes cost UNMEASURABLE -> BLOCK, never "cheaper"', () => {
    // Candidate looks cheap ONLY because one turn was never measured.
    const cand = side(HOLDOUT, goodScenario, [50, null]);
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario, [50, 50]), cand, OPTS);
    const cost = v.dims.find((d) => d.dim === 'OPS-cost-tokens')!;
    expect(cost.candidate).toBeNull();
    expect(cost.status).toBe('unmeasurable');
    expect(cost.reason).toMatch(/F14|incomplete/i);
    expect(v.promote).toBe(false);
  });

  it('BLOCKS on an empty candidate transcript (the vacuous-pass attack)', () => {
    const empty: PromotionSide = {
      scenarios: Object.fromEntries(HOLDOUT.map((id) => [id, []])),
      rows: Object.fromEntries(HOLDOUT.map((id) => [id, []])),
    };
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), empty, OPTS);
    expect(v.promote).toBe(false);
    expect(v.blocking_dims.length).toBeGreaterThan(0);
  });

  it('BLOCKS when the candidate smuggles in non-holdout scenarios', () => {
    const cand = side([...HOLDOUT, 'i-one'], goodScenario);
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), cand, OPTS);
    expect(v.promote).toBe(false);
    expect(v.reason).toMatch(/non-holdout scenario/);
  });

  it('aggregateWorst propagates null — a floor over an unknown subset is not a floor', () => {
    expect(aggregateWorst([1, null, 0.9], 'higher-better')).toBeNull();
    expect(aggregateWorst([], 'higher-better')).toBeNull();
    expect(aggregateWorst([1, 0.5, 0.9], 'higher-better')).toBe(0.5);
    expect(aggregateWorst([1, 0.5, 0.9], 'lower-better')).toBe(1);
  });
});

describe('promotion verdict — holdout doctrine is enforced structurally', () => {
  it('THROWS if run in iterate mode', () => {
    expect(() => computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, goodScenario), { ...OPTS, mode: 'iterate' })).toThrow(
      /requires mode "holdout"/,
    );
  });

  it('THROWS if run in full mode (reads tuned-against scenarios)', () => {
    expect(() => computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, goodScenario), { ...OPTS, mode: 'full' })).toThrow(
      /requires mode "holdout"/,
    );
  });

  it('THROWS on a degenerate split rather than passing on a 1-scenario "holdout"', () => {
    const bad = computeSplit(['only-one']);
    expect(() => computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, goodScenario), { ...OPTS, split: bad })).toThrow(
      /not usable as a promotion floor/,
    );
  });

  it('takes exactly ONE candidate — the API cannot express best-of-K on the holdout', () => {
    // Compile-time contract, asserted structurally: the signature is
    // (baseline, candidate, opts) with no array-of-candidates form.
    expect(computePromotionVerdict.length).toBe(3);
  });
});

describe('promotion verdict — OPS non-inferiority', () => {
  it('BLOCKS a cost regression beyond noise even when quality is fine', () => {
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario, [50, 50]), side(HOLDOUT, goodScenario, [9000, 9000]), OPTS);
    const cost = v.dims.find((d) => d.dim === 'OPS-cost-tokens')!;
    expect(cost.status).toBe('fail');
    expect(cost.reason).toMatch(/regressed/);
    expect(v.promote).toBe(false);
  });

  it('tolerates within-noise cost jitter', () => {
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario, [50, 50]), side(HOLDOUT, goodScenario, [60, 60]), OPTS);
    expect(v.dims.find((d) => d.dim === 'OPS-cost-tokens')!.status).toBe('pass');
    expect(v.promote).toBe(true);
  });

  it('opsDimsForSide sums cost across scenarios and nulls on any incomplete turn', () => {
    const ok = opsDimsForSide({ a: rows([10, 10]), b: rows([10, 10]) }, ['a', 'b']);
    expect(ok.find((d) => d.dim === 'OPS-cost-tokens')!.value).toBe(80);
    const bad = opsDimsForSide({ a: rows([10, null]), b: rows([10, 10]) }, ['a', 'b']);
    expect(bad.find((d) => d.dim === 'OPS-cost-tokens')!.value).toBeNull();
  });
});

describe('promotion verdict — report', () => {
  it('renders a markdown report that states the verdict and the doctrine', () => {
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, fabricatingScenario), OPTS);
    const md = renderPromotionMd(v);
    expect(md).toMatch(/# Promotion verdict: BLOCK/);
    expect(md).toMatch(/FLOOR, never a ranking/);
    expect(md).toMatch(/G4-canonical-state-use/);
  });

  it('every floored dim has a floor defined (no ungated dimension can pass)', () => {
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, goodScenario), OPTS);
    for (const d of v.dims.filter((x) => x.gateKind === 'floor')) {
      expect(GATE_FLOORS[d.dim], `${d.dim} has no floor`).toBeTypeOf('number');
    }
  });

  it('PII: no decision labels or figures leak into the verdict artifact', () => {
    const v = computePromotionVerdict(side(HOLDOUT, goodScenario), side(HOLDOUT, fabricatingScenario), OPTS);
    const blob = JSON.stringify(v) + renderPromotionMd(v);
    expect(blob).not.toMatch(/Plan Alpha/);
    expect(blob).not.toMatch(/budget/i);
  });
});
