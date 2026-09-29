/**
 * Readiness is available the moment the model exists.
 *
 * ⛔ MEASURED on the real browser transport (`/proxy/v5/turn`, staging Origin).
 * After a 60-90 s construction turn the response carried `draft_graph` and NO
 * `analysis_ready`, so the readiness panel was empty at exactly the point a
 * user has just built a model and wants to know what it still needs. The
 * estate's own live-journey gate names the same gap:
 * `turn 1: analysis_ready.options=0, expected >= 2`.
 *
 * The fix is a PURE function of the graph — the one readiness authority named
 * in CLAUDE.md — so it costs a call, not a second orchestrator turn.
 */

import { describe, it, expect } from 'vitest';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';

/**
 * ⛔ NOT A HAND-WRITTEN FIXTURE. The first version of this test invented a
 * plausible-looking graph and the authority answered `SCHEMA_INVALID` — which
 * would have made the test measure my fixture, not the product. This graph is
 * what construction ACTUALLY admits, from the same function the route uses.
 */
const admitted = admitCandidateModel({
  goal: { metric: 'Monthly recurring revenue', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  constraints: [], risks: [], outcomes: [], unknowns: [],
  options: [
    { label: 'Raise to £59', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 59, unit: 'GBP', provenance: 'explicit' }] },
    { label: 'Hold £49', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 49, unit: 'GBP', provenance: 'explicit' }] },
  ],
  factors: [{ label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', plausible_max: 200, provenance: 'explicit' }],
  links: [{ from: 'Pro plan price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' }],
} as unknown as CandidateModel);
const GRAPH = { nodes: admitted.nodes, edges: admitted.edges };

describe('readiness computed straight from the persisted graph', () => {
  it('names every option, so the panel is populated before any analysis runs', () => {
    const a = assessCanonicalAnalysisReadiness(GRAPH);
    expect(a.analysisReady, JSON.stringify(a.issues.map((i) => i.code))).toBeDefined();
    const ids = (a.analysisReady!.options ?? []).map((o) => o.option_id).sort();
    // Bound by IDENTITY: both options, by id. A count alone would pass on the
    // wrong two.
    expect(ids).toEqual(['hold_49', 'raise_to_59']);
    // ⛔ The measured assertion the live-journey gate makes.
    expect((a.analysisReady!.options ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('is pure — the same graph twice gives the same answer, and it mutates nothing', () => {
    const before = JSON.stringify(GRAPH);
    const a = assessCanonicalAnalysisReadiness(GRAPH);
    const b = assessCanonicalAnalysisReadiness(GRAPH);
    expect(JSON.stringify(a.analysisReady)).toBe(JSON.stringify(b.analysisReady));
    expect(JSON.stringify(GRAPH), 'the graph was mutated').toBe(before);
  });

  it('CONTRAST CONTROL: an empty graph yields no options rather than inventing them', () => {
    const a = assessCanonicalAnalysisReadiness({ nodes: [], edges: [] });
    expect((a.analysisReady?.options ?? []).length).toBe(0);
  });

  it('never throws on a malformed graph — readiness is a disclosure, not a gate', () => {
    for (const bad of [null, undefined, {}, { nodes: 'x' }, { nodes: [{ id: 1 }] }]) {
      expect(() => assessCanonicalAnalysisReadiness(bad)).not.toThrow();
    }
  });
});
