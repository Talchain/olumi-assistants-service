/**
 * Shared `run_delta` fact fixtures.
 *
 * Extracted so the two suites that pin this wire read from ONE definition:
 *
 *   - run-delta-wire.route-level.test.ts   — assembler → buildUserMessage
 *   - ../../__tests__/run-delta-leader-wire.turn-executor.test.ts
 *                                          — turn-executor → assembler
 *
 * Copying the pair into the second suite would have made it a hand-maintained
 * mirror of the first: identical today, silently divergent the moment either is
 * edited, and the divergence reads as green. One definition, two consumers.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';

/**
 * A persisted `run_analysis` fact carrying the four PRODUCER ECHOES the
 * producer requires (`seed_used`, `graph_hash_at_run`, `_meta.builds`,
 * `n_samples`) plus the run's own leader-claim verdict.
 */
export function runAnalysisFact(
  options: readonly { id: string; win: number }[],
  seed: string,
  hash: string,
  at: string,
  mayName = true,
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: {
        analysis_status: 'completed',
        results: options.map((o) => ({
          option_id: o.id,
          option_label: o.id === 'opt-a' ? 'Offshore partner' : 'Hire locally',
          win_probability: o.win,
        })),
        meta: { seed_used: seed, n_samples: 10_000 },
        _meta: { builds: { plot: 'p1', isl: 'i1' } },
      },
      computed_at: at,
      graph_hash_at_run: hash,
      constraint_verdict: {
        may_name_leading_option: mayName,
        constraint_verdict_state: 'evaluated_feasible' as const,
      },
    },
  } as unknown as HandlerFact;
}

/** A genuine pair: the leader flips opt-a → opt-b across an edit (hashes differ). */
export const PRESENT_PAIR: readonly HandlerFact[] = [
  runAnalysisFact([{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }], '222', 'hash-b', '2026-06-07T00:00:00.000Z'),
  runAnalysisFact([{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '111', 'hash-a', '2026-06-06T00:00:00.000Z'),
];

/**
 * A pair the producer REFUSES: exactly ONE successful run in the window, so
 * `selectTwoNewestRunAnalysisFacts` returns null → `insufficient_runs`.
 */
export const REFUSED_PAIR: readonly HandlerFact[] = [PRESENT_PAIR[0]!];
