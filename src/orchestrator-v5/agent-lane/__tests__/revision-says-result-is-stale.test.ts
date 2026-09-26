/**
 * ⭐ AN AUTHORISED REVISION SAYS WHAT IT DID TO THE RESULT ON SCREEN (R&C 5842738466; Delivery Lead 5842745019).
 *
 * Served on CEE e3b0844 (Paul's journey): the user approved "Monthly churn 5% → 4%" and read "Saved. No version
 * number was recorded for it. The analysis can run now." — never that the analysis on screen predates the change.
 * The same approve turn carried `run_state {kind: 'complete_stale', cause: 'graph_changed'}` and `requires_rerun`.
 *
 * FIXTURE: that served approve turn's typed fields, verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { staleResultLine } from '../write-outcome.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-approve-stale-e3b0844.json', import.meta.url), 'utf8')) as {
  analysis_state: Record<string, unknown> & { run_state: Record<string, unknown> }; analysis_ready: { may_run: boolean };
};
const RERUN = 'The analysis on screen was computed before this change; run it again to see the comparison with this change.';

describe('the approve reply says the result on screen predates the change', () => {
  it('RED: the served approve turn (stale because the graph changed, a rerun required, a run admitted) → "run it again"', () => {
    expect(served.analysis_state.requires_rerun).toBe(true);
    expect(staleResultLine(served.analysis_state, served.analysis_ready)).toBe(RERUN);
  });

  it('CONTRAST: a current result → nothing to say', () => {
    const current = { ...served.analysis_state, run_state: { ...served.analysis_state.run_state, kind: 'complete_current' }, requires_rerun: false };
    expect(staleResultLine(current, served.analysis_ready)).toBeNull();
  });

  it('CONTRAST: stale for another reason, or no rerun required → nothing to say', () => {
    expect(staleResultLine({ ...served.analysis_state, run_state: { ...served.analysis_state.run_state, cause: 'engine_changed' } }, served.analysis_ready)).toBeNull();
    expect(staleResultLine({ ...served.analysis_state, requires_rerun: false }, served.analysis_ready)).toBeNull();
    expect(staleResultLine(undefined, served.analysis_ready)).toBeNull();
  });

  it('stale, but the run is not admitted → says the result predates the change, never "run it again"', () => {
    expect(staleResultLine(served.analysis_state, { may_run: false })).toBe('The analysis on screen was computed before this change.');
    expect(staleResultLine(served.analysis_state, undefined)).toBe('The analysis on screen was computed before this change.');
  });

  it('RED: the Agent route puts it in the reply, after the save line, from THIS turn\'s readback', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('const staleLine = wroteThisTurn ? staleResultLine(analysisState, analysisReady) : null;');
    expect(route).toMatch(/\[narration\.status, notAdoptedLine\(result\.tool_calls, result\.tool_results\), staleLine, readinessLine\]/);
  });
});
