/**
 * ⭐⭐⭐ THE REVIEWING MODEL HAS NEVER HAD THE GRAPH.
 *
 * Measured on a real user session, 16 Sep 2026. `v5.context_budget` for
 * `call_site: "decision_review"`:
 *
 *   section_chars: { brief: "sha8:…", graph_json: 21, isl_results: 8096,
 *                    deterministic_coaching: 1513, decision_context: 404,
 *                    flip_threshold_data: 300 }
 *   total_chars: 10647   budget_chars: 43100
 *
 * Twenty-one characters is `<GRAPH>\n\n{}\n\n</GRAPH>`. Arithmetic checked:
 * `{}` renders 21, `{nodes:[],edges:[]}` renders 51, a one-node graph 103. So
 * the graph was **absent entirely**, not present-and-empty — while
 * `factor_sensitivity` (6 rows) and `option_comparison` (5 rows) in the SAME
 * enrichment were full. `v5.decision_review.completed` agreed:
 * `enrichment_has_graph: false`, node and edge counts 0.
 *
 * ⛔ AND IT IS NOT AN OUTAGE — IT IS THE DOCUMENTED STEADY STATE. CEE's own
 * conformance manifest lists `enrichment.graph` among the keys PLoT does not
 * emit at top level, and `readGraph`'s docstring says it outright: "On staging
 * the run-analysis envelope often has NO top-level `graph` — callers must
 * tolerate an empty result and fall back to inline labels."
 *
 * ⭐ COMPOSE ALREADY SOLVED THIS ONE LAYER DOWN. `buildGraphNodeLookup(fact,
 * fallbackGraph)` reads `enrichment.graph` first and falls back to a hash-gated
 * `persistedGraph`. The enricher runs EARLIER and feeds the LLM, and never got
 * the same fallback — the remedy was scoped to the instance and nothing swept
 * its sibling. `brief` on the very same call is already threaded this way.
 *
 * ⚠ THE FALLBACK IS ORDERED, NOT OVERRIDING. The enrichment's own graph still
 * wins wherever it speaks; the canonical graph is consulted only when the
 * envelope yields nothing at all. A producer that starts emitting one is
 * therefore authoritative the day it does.
 */
import { describe, expect, it } from 'vitest';

import { buildInvokeInputForTests } from '../decision-review-enricher.js';

const NODES = [
  { id: 'fac_lead', label: 'Team Leadership Coverage', kind: 'factor' },
  { id: 'out_quality', label: 'Code Quality Level', kind: 'outcome' },
];
const CANONICAL = { nodes: NODES, edges: [{ id: 'e1', from: 'fac_lead', to: 'out_quality' }] };

/** The live shape: enrichment with everything EXCEPT a graph. */
const ENRICHMENT_WITHOUT_GRAPH = () => ({
  option_comparison: [
    { option_id: 'opt_a', option_label: 'Hire One Tech Lead', win_probability: 0.61 },
    { option_id: 'opt_b', option_label: 'Two Developers', win_probability: 0.3 },
  ],
  factor_sensitivity: [{ factor_id: 'fac_lead', confidence: 0.608 }],
});

const build = (enrichment: Record<string, unknown>, canonical?: unknown) =>
  buildInvokeInputForTests('Should I hire a tech lead or two developers?', enrichment, 'opt_a', undefined, true, canonical) as
    | (Record<string, any> | null);

describe('G1 — the canonical graph reaches the reviewing model', () => {
  it('G1a PRECONDITION: without it, the graph handed to the model is empty', () => {
    const input = build(ENRICHMENT_WITHOUT_GRAPH());
    expect(input, 'precondition: the input is built at all').not.toBeNull();
    expect(Object.keys(input?.graph ?? {}), 'this is the live 21-character `{}`').toEqual([]);
  });

  it('G1b with it, the model receives the real nodes', () => {
    const input = build(ENRICHMENT_WITHOUT_GRAPH(), CANONICAL);
    expect(input?.graph?.nodes, 'the reviewing model can finally see the model').toHaveLength(2);
    expect(JSON.stringify(input?.graph)).toContain('Team Leadership Coverage');
  });
});

describe('G2 — the fallback is ordered, never overriding', () => {
  it('G2a an enrichment that DOES carry a graph still wins', () => {
    const own = { nodes: [{ id: 'fac_own', label: 'Producer Graph Node', kind: 'factor' }] };
    const input = build({ ...ENRICHMENT_WITHOUT_GRAPH(), graph: own }, CANONICAL);
    expect(input?.graph?.nodes, 'the producer is authoritative wherever it speaks').toHaveLength(1);
    expect(JSON.stringify(input?.graph)).toContain('Producer Graph Node');
    expect(JSON.stringify(input?.graph)).not.toContain('Team Leadership Coverage');
  });

  it('G2b absent canonical graph behaves exactly as before — byte-identical', () => {
    expect(JSON.stringify(build(ENRICHMENT_WITHOUT_GRAPH())?.graph)).toBe(
      JSON.stringify(build(ENRICHMENT_WITHOUT_GRAPH(), undefined)?.graph),
    );
  });

  it('G2c a malformed canonical graph is ignored, not propagated', () => {
    for (const junk of [null, 'a string', 42, ['an array']]) {
      expect(Object.keys(build(ENRICHMENT_WITHOUT_GRAPH(), junk)?.graph ?? {})).toEqual([]);
    }
  });
});
