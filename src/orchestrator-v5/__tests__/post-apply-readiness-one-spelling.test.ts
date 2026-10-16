/** C1: the kept held-approval writer owns candidate and committed readiness; legacy repair/value-batch exits were deleted. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('../handlers/approve-held-proposal.ts', import.meta.url), 'utf8');
const CANONICAL_CALLS = [
  'buildCanonicalAnalysisReadyFromGraph(outcome.appliedGraph)',
  'buildCanonicalAnalysisReadyFromGraph(committed.persistedGraph)',
] as const;

describe('held apply and readback readiness use the canonical producer', () => {
  it('POSITIVE CONTROL — the kept writer source was actually read', () => {
    expect(SRC.length).toBeGreaterThan(1_000);
    expect(SRC).toContain('const outcome = executeGmHeldResume({');
    expect(SRC).toContain('effectiveGraph: persisted.success ? persisted.data : null');
  });

  it('NEGATIVE CONTROL — it does not find a call that is not there', () => {
    expect(SRC).not.toContain('buildDefinitelyNotARealReadiness(');
  });

  it('both candidate and committed readbacks use the canonical builder exactly once', () => {
    for (const call of CANONICAL_CALLS) expect(SRC.split(call).length - 1, call).toBe(1);
  });

  it('neither readback uses the bare assessment, which omits may_run', () => {
    for (const graph of ['outcome.appliedGraph', 'committed.persistedGraph']) {
      expect(SRC).not.toContain(`assessCanonicalAnalysisReadiness(${graph})`);
    }
  });

  it('PLANTED MUTANT — replacing either canonical call is detected independently', () => {
    for (const call of CANONICAL_CALLS) {
      const mutant = SRC.replace(call, call.replace('buildCanonicalAnalysisReadyFromGraph', 'assessCanonicalAnalysisReadiness'));
      expect(mutant.split(call).length - 1).toBe(0);
      const other = CANONICAL_CALLS.find(candidate => candidate !== call)!;
      expect(mutant.split(other).length - 1).toBe(1);
    }
  });
});
