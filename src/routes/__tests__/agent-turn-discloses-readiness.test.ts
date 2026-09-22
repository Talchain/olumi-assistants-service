/**
 * THE AGENT ROUTE MUST DISCLOSE READINESS, OR THE USER IS NEVER TOLD THEIR
 * RESULTS ARE STALE.
 *
 * ⛔ MEASURED on deployed staging (`dfb31ed`, again on `a76f1a0`), with the
 *    conventional route as a SAME-RUN control:
 *
 *      /agent/v1/turn        analysis_ready: ABSENT   blocks: 0
 *      /orchestrate/v2/turn  analysis_ready: PRESENT  blocks: 3   (same graph_hash)
 *
 *    The deployed UI renders staleness on FOUR flag-free surfaces — the
 *    freshness notice, the re-analyse bar (with its live Re-analyse button),
 *    the staleness pill and the coaching-card currency notice. Every one binds
 *    to `analysis_ready.freshness` or `blocks[].freshness`. With both absent a
 *    user on this route can edit the model and never learn the results predate
 *    the edit. That is silence, not a refusal.
 *
 * ⚠ WHAT THIS SUITE CAN AND CANNOT DO. Driving `/agent/v1/turn` end to end
 *   needs an agent-loop (LLM) harness this repo does not have, so the route
 *   assertion below is SOURCE-DERIVED — the same shape, and for the same
 *   stated reason, as `proxy-target-parity.test.ts`: it pins the DECISION, not
 *   a string. The first test is executable and pins the contract the route
 *   depends on. Neither is a substitute for the deployed witness, which has a
 *   row for this and currently reads FAIL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { assessCanonicalAnalysisReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';

const routeSource = (): string => readFileSync(new URL('../agent-v1-turn.ts', import.meta.url), 'utf8');

/**
 * Source with comments removed.
 *
 * ⛔ MY FIRST VERSION OF THE FRESHNESS ASSERTION BELOW FAILED ON MY OWN PROSE.
 *    The route's docblock explains WHY it does not call `deriveAnalysisFreshness`,
 *    so a bare substring search found the name in a comment and reported a call
 *    that does not exist. A grep hit proves a string exists, not what the
 *    enclosing statement does — so these assertions read CODE only.
 */
const routeCode = (): string =>
  routeSource().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A graph of the shape the Agent actually builds: options, a goal, factors, edges. */
const REAL_SHAPE = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow ARR' },
    { id: 'opt_a', kind: 'option', label: 'Germany First' },
    { id: 'opt_b', kind: 'option', label: 'Nordics First' },
    { id: 'fac_1', kind: 'factor', label: 'Market Size', observed_state: { value: 0.5 } },
  ],
  edges: [
    { id: 'e1', source: 'fac_1', target: 'goal_1', kind: 'causal' },
    { id: 'e2', source: 'opt_a', target: 'fac_1', kind: 'causal' },
  ],
};

describe('the readiness contract the agent route depends on', () => {
  it('assessCanonicalAnalysisReadiness is a PURE function of the graph and yields a payload', () => {
    const out = assessCanonicalAnalysisReadiness(REAL_SHAPE);
    expect(out, 'the route calls this with the readback graph and attaches .analysisReady').toBeDefined();
    // Either a payload or a stated set of blocking issues — never both empty,
    // which would make the disclosure meaningless.
    const hasVerdict = out.analysisReady !== undefined || out.blockingIssues.length > 0;
    expect(hasVerdict, 'a readiness assessment that says nothing cannot disclose anything').toBe(true);
  });

  it('CONTROL — it refuses a null graph rather than inventing readiness', () => {
    const out = assessCanonicalAnalysisReadiness(null);
    expect(out.analysisReady).toBeUndefined();
    expect(out.blockingIssues.map((i) => i.code)).toContain('NO_GRAPH');
  });
});

describe('the agent route discloses readiness, from the one authority', () => {
  it('RED: it derives analysis_ready rather than leaving the field absent', () => {
    const src = routeCode();
    expect(
      src,
      'without this the four flag-free UI staleness surfaces have nothing to bind to',
    ).toContain('assessCanonicalAnalysisReadiness');
    expect(src).toContain('analysis_ready');
  });

  it('the readback answer WINS — this must never become a second producer', () => {
    const src = routeCode();
    const guard = /if \(analysisReady === undefined\)\s*\{[\s\S]{0,200}?assessCanonicalAnalysisReadiness/.exec(src);
    expect(
      guard,
      'the local derivation must be guarded on the readback having said nothing, so that if that ' +
        'endpoint ever carries the field this becomes a no-op instead of a rival verdict',
    ).not.toBeNull();
  });

  it('it does NOT synthesise a freshness verdict it has no evidence for', () => {
    const src = routeCode();
    expect(
      src.includes('deriveAnalysisFreshness'),
      'freshness needs priorFacts (a v5_handler_facts read this route does not do); a payload ' +
        'silent on freshness is read as `changed`, which is the safe direction to be wrong in',
    ).toBe(false);
  });
});

describe('the comment stripper is load-bearing', () => {
  it('CONTROL — the name IS present in the source and ABSENT from the code', () => {
    expect(
      routeSource().includes('deriveAnalysisFreshness'),
      'the route explains in prose why it does not call this; if that explanation is ever removed ' +
        'this control goes stale and the freshness assertion above becomes vacuous',
    ).toBe(true);
    expect(routeCode().includes('deriveAnalysisFreshness')).toBe(false);
  });
});
