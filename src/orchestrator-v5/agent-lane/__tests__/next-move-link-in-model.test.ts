/**
 * ⭐ C4 — THE LINK MOVE NAMES A LINK THE MODEL HAS. RED-first on a SERVED capture (R&C served check, CEE 9bd3747, hiring
 * brief, auto first pass, 27 Sep 18:47Z).
 *
 * THE DEFECT: the run's robustness named ONE fragile edge, `tech_lead_hires_change_from_today → delivery_capacity`, and the
 * run's own graph (hash-bound: recomputed hash == `computed_against_hash`) has NO such edge — Tech lead hires reaches
 * Delivery capacity only through three mediators. The served card asked the user to "Pressure-test" that link, and the
 * Agent's reply to the click had to say "There is no direct Tech Lead hires → Delivery capacity link in the current model".
 * A move about a link the model does not hold is invented evidence.
 *
 * THE RULE (`coaching/next-move.ts` `modelLinks`): with a bound graph, the link move considers only fragile edges that are
 * edges of that graph; when none is, no link card (`link_not_in_model`) — never the no-flagged-link card, which would say
 * nothing was flagged. The producer's edge is reported upstream (engine lanes); this is the consumer's own invariant.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  runTurnCoaching,
  runTurnNextMove,
  type CapturedAnalysis,
  type RunTurnCoachingFinal,
} from '../analysis-coaching-pass-through.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Rec = Record<string, any>;
const f = JSON.parse(readFileSync(
  new URL('../../coaching/__tests__/fixtures/served-hiring-9bd3747-link-not-in-model.json', import.meta.url), 'utf8',
)) as Rec;
const PHANTOM = 'tech_lead_hires_change_from_today→delivery_capacity';
// A DERIVED graph is re-hashed through the real hash function, so the run stays bound to it.
const args = (graph: Rec = f.draft_graph): [CapturedAnalysis, RunTurnCoachingFinal] => {
  const hash = graph === f.draft_graph ? f.graph_hash : computeAnalysisAffectingGraphHash(graph as never)!;
  const result = { ...f.analysis_result, computed_against_hash: hash };
  return [
    { scenario_id: 'hiring', status: 200, trigger: f.trigger, analysis_state: f.analysis_state, analysis_ready: f.analysis_ready, blocks: [result] },
    { scenarioId: 'hiring', graphHash: hash, analysisState: f.analysis_state, analysisResult: result, graph, constraintVerdictState: f.constraint_verdict_state },
  ];
};
const cards = (blocks: readonly { signal_id: string }[]) => blocks.filter((b) => /^coach:[a-z_]+:/.test(b.signal_id));
const edgesOf = (g: Rec): string[] => g.edges.map((e: Rec) => `${e.from}→${e.to}`);
const fragile = (): string[] => f.analysis_result.enrichment.robustness.fragile_edges.map((e: Rec) => `${e.from_id}→${e.to_id}`);

describe('C4: the link move names a link the model has (served hiring, CEE 9bd3747)', () => {
  it('precondition: the served graph IS the run\'s graph, its one fragile edge is not an edge of it, and the served card targeted it', () => {
    expect(computeAnalysisAffectingGraphHash(f.draft_graph as never)).toBe(f.graph_hash);
    expect(f.analysis_result.computed_against_hash).toBe(f.graph_hash);
    expect(fragile()).toEqual([PHANTOM]);
    expect(edgesOf(f.draft_graph)).not.toContain(PHANTOM);
    expect(edgesOf(f.draft_graph)).toContain('tech_lead_hires_change_from_today→work_prioritisation_quality');
    expect(f.served_card_signal_ids[0].startsWith(`coach:fragile_link:${PHANTOM}:`)).toBe(true);
  });

  it('RED: no card and no move names the link the model does not have; the reason says so', () => {
    const got = cards(runTurnCoaching(...args()).blocks) as Rec[];
    expect(got.filter((c) => c.signal_id.includes(PHANTOM))).toEqual([]);
    const r = runTurnNextMove(...args());
    expect(r.nextMove?.target_ids ?? []).not.toContain(PHANTOM);
    expect(r.nextMove?.kind).not.toBe('link_view');
    if (r.nextMove === null) expect(r.eligibility).toEqual({ eligible: false, reason: 'link_not_in_model' });
  });

  it('never the no-flagged-link card: a link WAS flagged, it is just not one the model holds', () => {
    const got = cards(runTurnCoaching(...args()).blocks) as Rec[];
    expect(got.filter((c) => c.signal_id.startsWith('coach:no_flagged_link:'))).toEqual([]);
  });

  it('CONTRAST: when the model DOES have that edge (re-hashed), the served card comes back — the rule is membership, nothing else', () => {
    const src = f.draft_graph.edges.find((e: Rec) => e.to === 'delivery_capacity');
    const withEdge = { ...f.draft_graph, edges: [...f.draft_graph.edges, { ...src, from: 'tech_lead_hires_change_from_today', to: 'delivery_capacity' }] };
    const r = runTurnNextMove(...args(withEdge));
    expect(r.nextMove).toMatchObject({ kind: 'link_view', target_ids: [PHANTOM] });
  });
});
