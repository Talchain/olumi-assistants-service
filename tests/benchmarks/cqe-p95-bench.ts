import { extractQuantities } from '../../src/orchestrator-v5/context/cqe/extract-quantities.js';

// Targeted p95 harness for the 5-case benchmark matrix in
// cqe-investigation-proposal.md §8.2. Vitest's bench reporter emits p75
// and p99 but not p95; this script collects N samples per case, sorts,
// and reports explicit p50/p75/p95/p99/p999 plus the breach-tolerance
// margin vs the proposal's p95 target.
//
// Run via: pnpm exec tsx tests/benchmarks/cqe-p95-bench.ts
// Output is plain text intended to be pasted into cqe-results.md.

interface Case {
  id: string;
  label: string;
  input: string;
  samples: number;
  targetP95Ms: number;
}

const CASES: Case[] = [
  { id: '1', label: 'Idle path (no numbers)', input: 'what about churn?', samples: 2000, targetP95Ms: 1 },
  { id: '2', label: 'Multi-pattern realistic', input: 'set A to 5%, B to 10%, and C between 20 and 30', samples: 1000, targetP95Ms: 5 },
  { id: '3', label: 'Adversarial backtracking', input: 'reduce recruitment by roughly a third, then set overhead from £50k to £75k, and keep between 3% and 7% margin while adding 2 to 4 hires', samples: 1500, targetP95Ms: 50 },
  { id: '4', label: '2000-char cap boundary', input: 'set speed to 0.9 and budget to £150k. '.repeat(60).slice(0, 2000), samples: 400, targetP95Ms: 20 },
  { id: '5', label: 'Compromise-only fallback', input: 'the project rolled forward 7 weeks then back 3, settling at week 42', samples: 400, targetP95Ms: 10 },
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

function runCase(c: Case): {
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  p999: number;
  min: number;
  max: number;
  passed: boolean;
  breachMarginPct: number;
} {
  // Warm-up to avoid first-call compile and cache cost.
  for (let i = 0; i < 50; i++) extractQuantities(c.input);

  const times: number[] = new Array(c.samples);
  for (let i = 0; i < c.samples; i++) {
    const t0 = performance.now();
    extractQuantities(c.input);
    times[i] = performance.now() - t0;
  }
  times.sort((a, b) => a - b);

  const p50 = percentile(times, 50);
  const p75 = percentile(times, 75);
  const p95 = percentile(times, 95);
  const p99 = percentile(times, 99);
  const p999 = percentile(times, 99.9);
  const min = times[0] ?? 0;
  const max = times[times.length - 1] ?? 0;
  const passed = p95 <= c.targetP95Ms;
  const breachMarginPct = c.targetP95Ms === 0 ? 0 : ((p95 - c.targetP95Ms) / c.targetP95Ms) * 100;

  return { p50, p75, p95, p99, p999, min, max, passed, breachMarginPct };
}

function fmt(x: number): string {
  return x.toFixed(3);
}

console.log('| # | Case | samples | p50 | p75 | **p95** | p99 | p999 | target p95 | breach % | pass |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of CASES) {
  const r = runCase(c);
  const margin = r.breachMarginPct >= 0
    ? `+${r.breachMarginPct.toFixed(1)}%`
    : `${r.breachMarginPct.toFixed(1)}%`;
  console.log(
    `| ${c.id} | ${c.label} | ${c.samples} | ${fmt(r.p50)} | ${fmt(r.p75)} | **${fmt(r.p95)}** | ${fmt(r.p99)} | ${fmt(r.p999)} | <${c.targetP95Ms}ms | ${margin} | ${r.passed ? '✓' : '✗'} |`,
  );
}
