import { bench, describe } from 'vitest';
import { extractQuantities } from '../../src/orchestrator-v5/context/cqe/extract-quantities.js';

// CQE benchmarks per cqe-investigation-proposal.md §8.2 (5-case matrix).
// Run via `pnpm exec vitest bench --run --config tests/benchmarks/vitest.benchmark.config.ts tests/benchmarks/cqe.bench.ts`.
// Explicit-p95 harness: `pnpm exec tsx tests/benchmarks/cqe-p95-bench.ts` (evidence in tests/benchmarks/cqe-results.md).
// Target p95 thresholds (guidance, not hard limits in-process):
//   Case 1 idle path                     <1ms
//   Case 2 multi-pattern realistic       <5ms
//   Case 3 adversarial backtracking      <50ms (timeout cap)
//   Case 4 2000-char cap boundary        <20ms
//   Case 5 compromise-only fallback      <10ms

const CASE_1_IDLE = 'what about churn?';

const CASE_2_MULTI =
  'set A to 5%, B to 10%, and C between 20 and 30';

// Adversarial regex inputs designed to stress backtracking. Real-world
// plausible yet rich in patterns.
const CASE_3_ADVERSARIAL =
  'reduce recruitment by roughly a third, then set overhead from £50k to £75k, and keep between 3% and 7% margin while adding 2 to 4 hires';

const CASE_4_LONG = 'set speed to 0.9 and budget to £150k. '.repeat(60).slice(0, 2000);

// compromise-only: phrases with no CQE rule matches, so compromise handles.
const CASE_5_COMPROMISE =
  'the project rolled forward 7 weeks then back 3, settling at week 42';

describe('CQE bench (proposal §8.2)', () => {
  bench('Case 1: idle path (no numbers)', () => {
    extractQuantities(CASE_1_IDLE);
  });

  bench('Case 2: multi-pattern realistic', () => {
    extractQuantities(CASE_2_MULTI);
  });

  bench('Case 3: adversarial backtracking', () => {
    extractQuantities(CASE_3_ADVERSARIAL);
  });

  bench('Case 4: 2000-char cap boundary', () => {
    extractQuantities(CASE_4_LONG);
  });

  bench('Case 5: compromise-only fallback', () => {
    extractQuantities(CASE_5_COMPROMISE);
  });
});
