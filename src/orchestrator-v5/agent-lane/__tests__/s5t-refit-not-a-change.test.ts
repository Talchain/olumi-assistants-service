/**
 * ⛔ S5t-W (e7's witness #87 6011176086 on CEE 5f8f24c; Science Q2 6009456901: "a frame change must NEVER be narrated as a
 * change"; DL 07:0xZ): A LINK THE REFIT ONLY RESCALED IS NO CHANGE IN S7.
 *
 * Served (e7 stg4 investor, Run → rerun after the card press): "Olumi’s estimate for how much Integration-step trial
 * abandonment changes quarterly revenue changed; it is still slight." for two goal-inbound links the user never touched.
 * The refit moved the goal's frame (3.5M → 10M), so their β moved (−0.143 → −0.05) while their natural size stayed
 * (−£5,000/quarter per point). The snapshot carries no frames, so S7 read a β move inside one band as Olumi's re-estimate.
 *
 * The write that refits now records, on its own `adjust_edge_strength` receipt, the links the refit rescaled
 * (`result.after.frame_refit`: an open record, so no schema change). S7 chains those moves between the two Runs exactly as
 * #2647 chains the user's writes: a link whose whole move is the refit's is neither named nor counted. A link Olumi
 * re-estimated as well still is. And a band is said in the canvas's words ("very strong"), never the contract literal.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../../system-events/link-effect-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { edgeBandFromMagnitude, strengthBandFromEdgeBand } from '../../format/edge-strength-bands.js';
import { linkAuthorshipDigest } from '../../tools/handlers/run-input-residual.js';
import { diffRunInputs } from '../../coaching/run-input-changes.js';
import { frameRefitLinksForRunPair, userWrittenLinksForRunPair, withinBandLinkMovesForRunPair } from '../../coaching/build-run-delta.js';
import { rerunExplanationPlan } from '../rerun-explanation.js';
import { composeToolCallResponse } from '../../compose.js';

type Rec = Record<string, any>;
const fx = JSON.parse(readFileSync(new URL('./fixtures/s5t-stg4-investor-5f8f24c.json', import.meta.url), 'utf8')) as { graph: Rec; after: Rec };
const G4 = fx.graph;
const G5 = fx.after;
const GOAL = 'quarterly_revenue';
const EDITED = `enterprise_win_rate->${GOAL}`;
const SIBLINGS = [`integration_step_trial_abandonment->${GOAL}`, `quarterly_revenue_lost_to_ai_delivery_distraction->${GOAL}`];
const QUOTE = 'Every 1 percentage point more of Enterprise win rate adds about £100,000 per quarter of quarterly revenue.';
const EFFECT = { amount: 100000, amount_unit: '£/quarter', per_source_change: 1, per_source_change_unit: 'percentage point' };
const labelOf = (id: string): string | undefined => (G5.nodes as Rec[]).find((n) => n.id === id)?.label;
const edgeOf = (g: Rec, k: string) => (g.edges as Rec[]).find((e) => `${e.from}->${e.to}` === k)!;

/** The real ONE-link door's write (as `executeOptionInterventionBatch` calls it, `frameRefit`). */
function write(graph: Rec, effect: Rec) {
  const edge = edgeOf(graph, EDITED);
  return applyLinkEffectEdit({
    persistedGraph: structuredClone(graph), from: edge.from, to: edge.to, effect: effect as never, quote: QUOTE,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, edge.from, edge.to)! },
    reading_token: linkEffectReadingToken({ from: edge.from, to: edge.to, effect: effect as never, quote: QUOTE }),
    frameRefit: true,
  });
}

/** A Run's snapshot links, by the snapshot builder's own projection (`run-input-snapshot.ts`): mean, band, sizing, authorship. */
function snapshotOf(g: Rec, digest: string): Rec {
  const kindOf = new Map((g.nodes as Rec[]).map((n) => [n.id, n.kind]));
  const links = (g.edges as Rec[]).filter((e) => !['option', 'decision'].includes(kindOf.get(e.from))).map((e) => ({
    from: e.from, to: e.to, mean: e.strength.mean,
    band: strengthBandFromEdgeBand(edgeBandFromMagnitude(Math.abs(e.strength.mean))),
    sizing: linkSizing(e), authorship_digest: linkAuthorshipDigest(e),
  }));
  return { snapshot_version: 1, sent_digest: digest.repeat(64), goal: { node_id: GOAL, label: 'quarterly revenue', unit: '£/quarter' },
    options: [], options_not_sent: [], factors: [], constraints: [], links };
}
const T1 = '2026-10-06T06:58:00.000Z';
const T2 = '2026-10-06T07:00:30.000Z';
const AT = '2026-10-06T06:59:51.000Z';
const run = (id: string, at: string, snapshot: Rec): HandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: '222939b6-b0b1-4545-b18d-515489a68c48', leading_option_id: null, summary: 's', run_id: id, computed_at: at, input_snapshot: snapshot },
} as unknown as HandlerFact);
function pair(s1: Rec, s2: Rec) {
  const d = diffRunInputs(s1 as never, s2 as never);
  return {
    facts: [run('run_1', T1, s1), run('run_2', T2, s2)],
    delta: { endpoints: { prior: { run_id: 'run_1' }, current: { run_id: 'run_2' } }, input_coverage: d.complete ? 'complete' : 'partial', input_changes: d.rows, attribution_case: 'C1_attributable' },
  };
}
const S1 = snapshotOf(G4, 'a');
const S2 = snapshotOf(G5, 'b');

describe('the writer: a refit records the links it rescaled on its own receipt', () => {
  it('PRECONDITION: the real write of e7\'s figure on e7\'s graph refits the goal and yields e7\'s served graph', () => {
    const out = write(G4, EFFECT);
    expect(out.kind).toBe('mutated');
    const g = (out as { mutatedGraph: Rec }).mutatedGraph;
    for (const k of [EDITED, ...SIBLINGS]) expect(edgeOf(g, k).strength.mean).toBeCloseTo(edgeOf(G5, k).strength.mean, 12);
    // The siblings' natural size is unchanged: the move is the frame's alone.
    for (const k of SIBLINGS) expect(edgeOf(g, k).provenance.natural_effect.amount).toBe(edgeOf(G4, k).provenance.natural_effect.amount);
  });

  it('⭐ RED: the receipt names exactly the two rescaled siblings, by link, with their persisted means before and after', () => {
    const out = write(G4, EFFECT) as { handlerFacts: Rec[] };
    const after = out.handlerFacts[0]!.result.after;
    expect(after.frame_refit).toEqual(SIBLINGS.map((k) => {
      const [from, to] = k.split('->');
      return { from, to, before_mean: edgeOf(G4, k).strength.mean, after_mean: edgeOf(G5, k).strength.mean };
    }));
    // The user's own link is the receipt's target, never a refit move.
    expect(after.frame_refit.map((m: Rec) => `${m.from}->${m.to}`)).not.toContain(EDITED);
  });

  it('CONTROL: a figure the frames already hold refits nothing and records no `frame_refit`', () => {
    const out = write(G4, { ...EFFECT, amount: 20000 }) as { kind: string; handlerFacts: Rec[]; mutatedGraph: Rec };
    expect(out.kind).toBe('mutated');
    expect(out.mutatedGraph.nodes.find((n: Rec) => n.id === GOAL).observed_state.cap).toBe(G4.nodes.find((n: Rec) => n.id === GOAL).observed_state.cap);
    expect(out.handlerFacts[0]!.result.after).not.toHaveProperty('frame_refit');
  });
});

describe('S7 on e7\'s Run pair: a link the refit only rescaled is no change', () => {
  const receipt = (write(G4, EFFECT) as { handlerFacts: HandlerFact[] }).handlerFacts[0]!;
  const timed = [{ fact: receipt, created_at: AT }];

  it('PRECONDITION (the served defect): without the receipt, both siblings read as Olumi\'s re-estimate inside "slight"', () => {
    const { facts, delta } = pair(S1, S2);
    const moves = withinBandLinkMovesForRunPair(facts, delta, []);
    expect(moves.filter((m) => SIBLINGS.includes(`${m.from}->${m.to}`)).map((m) => [m.author, m.band])).toEqual([['olumi', 'slight'], ['olumi', 'slight']]);
  });

  it('⭐ RED: with the write\'s receipt between the Runs, no sibling is a within-band move, and the line names only the user\'s link', () => {
    const { facts, delta } = pair(S1, S2);
    const moves = withinBandLinkMovesForRunPair(facts, delta, timed);
    expect(moves.map((m) => `${m.from}->${m.to}`).filter((k) => SIBLINGS.includes(k))).toEqual([]);
    const plan = rerunExplanationPlan(delta, labelOf, [], false, [], moves,
      new Set(userWrittenLinksForRunPair(facts, delta, timed)), new Set(frameRefitLinksForRunPair(facts, delta, timed)))!;
    expect(plan.codeLine).not.toMatch(/Olumi’s estimate for how much .* changed/u);
    expect(plan.codeLine).not.toMatch(/Other things also differed/u);
    expect(plan.codeLine).toContain('You gave your own estimate for how much Enterprise win rate changes quarterly revenue: moderate → very strong.');
  });

  it('⭐ CONTROL (Review Desk 6b): Olumi re-estimated a sibling AFTER the refit → its move is not the refit\'s, and it is still said', () => {
    const s2 = structuredClone(S2);
    const sib = (s2.links as Rec[]).find((l) => `${l.from}->${l.to}` === SIBLINGS[0])!;
    sib.mean = -0.06; // still "slight", but not the refit's −0.05
    const { facts, delta } = pair(S1, s2);
    const moves = withinBandLinkMovesForRunPair(facts, delta, timed);
    expect(moves.filter((m) => `${m.from}->${m.to}` === SIBLINGS[0]).map((m) => m.author)).toEqual(['olumi']);
    expect(moves.map((m) => `${m.from}->${m.to}`)).not.toContain(SIBLINGS[1]);
    const plan = rerunExplanationPlan(delta, labelOf, [], false, [], moves,
      new Set(userWrittenLinksForRunPair(facts, delta, timed)), new Set(frameRefitLinksForRunPair(facts, delta, timed)))!;
    expect(plan.codeLine).toContain('Olumi’s estimate for how much Integration-step trial abandonment changes quarterly revenue changed; it is still slight.');
  });

  it('CONTROL: the same receipt BEFORE the prior Run frees nothing (only a move between the two Runs is the refit\'s)', () => {
    const { facts, delta } = pair(S1, S2);
    const moves = withinBandLinkMovesForRunPair(facts, delta, [{ fact: receipt, created_at: '2026-10-06T06:50:00.000Z' }]);
    expect(moves.filter((m) => SIBLINGS.includes(`${m.from}->${m.to}`))).toHaveLength(2);
  });

  it('⭐ (Review Desk 6b) the user\'s own write on that SAME receipt still binds "You" for its link (the new key moves nothing #2647 reads)', () => {
    const { facts, delta } = pair(S1, S2);
    expect(userWrittenLinksForRunPair(facts, delta, timed)).toEqual([EDITED]);
    expect(frameRefitLinksForRunPair(facts, delta, timed)).not.toContain(EDITED);
  });
});

describe('a refit move that crosses a band: no row is said and none is counted', () => {
  // The investor sibling's β crosses a band when the goal frame grows enough: e7's pair with the sibling's band moved.
  const s1 = structuredClone(S1); const s2 = structuredClone(S2);
  const [from, to] = SIBLINGS[0]!.split('->');
  const l1 = (s1.links as Rec[]).find((l) => l.from === from && l.to === to)!;
  const l2 = (s2.links as Rec[]).find((l) => l.from === from && l.to === to)!;
  l1.mean = -0.5; l1.band = strengthBandFromEdgeBand(edgeBandFromMagnitude(0.5));
  l2.mean = -0.175; l2.band = strengthBandFromEdgeBand(edgeBandFromMagnitude(0.175));
  const refit = { fact_type: 'adjust_edge_strength', fact_version: 1, noop: false, result: { status: 'applied', target_id: `${EDITED.replace('->', '→')}`,
    before: { strength: { mean: edgeOf(G4, EDITED).strength.mean } }, after: { strength: { mean: edgeOf(G5, EDITED).strength.mean },
      frame_refit: [{ from, to, before_mean: -0.5, after_mean: -0.175 }] } } } as unknown as HandlerFact;
  const timed = [{ fact: refit, created_at: AT }];

  it('PRECONDITION: the pair carries a strength row for the sibling', () => {
    const { delta } = pair(s1, s2);
    expect(delta.input_changes.filter((r: Rec) => r.field === 'strength').map((r: Rec) => `${r.link.from}->${r.link.to}`)).toContain(SIBLINGS[0]);
  });

  it('⭐ RED: the refit\'s band row is neither said nor counted as "other things also differed"', () => {
    const { facts, delta } = pair(s1, s2);
    const frame = new Set(frameRefitLinksForRunPair(facts, delta, timed));
    expect([...frame]).toEqual([SIBLINGS[0]]);
    const plan = rerunExplanationPlan(delta, labelOf, [], false, [], withinBandLinkMovesForRunPair(facts, delta, timed),
      new Set(userWrittenLinksForRunPair(facts, delta, timed)), frame)!;
    expect(plan.codeLine).not.toMatch(/Integration-step trial abandonment/u);
    expect(plan.codeLine).not.toMatch(/Other things also differed/u);
  });

  it('CONTROL: without the receipt the same band row is counted (unsaid, "other things also differed")', () => {
    const { facts, delta } = pair(s1, s2);
    const plan = rerunExplanationPlan(delta, labelOf, [], false, [], withinBandLinkMovesForRunPair(facts, delta, []),
      new Set(userWrittenLinksForRunPair(facts, delta, [])), new Set(frameRefitLinksForRunPair(facts, delta, [])))!;
    expect(plan.codeLine).toMatch(/Other things also differed/u);
  });
});

describe('the wire: the refit record is S7\'s internal carrier, never a graph_patch field', () => {
  it('⭐ RED: the receipt composed as a `graph_patch` block carries the user\'s link, and no `frame_refit`', () => {
    const fact = (write(G4, EFFECT) as { handlerFacts: HandlerFact[] }).handlerFacts[0]!;
    expect((fact as Rec).result.after.frame_refit, 'CONTROL: the receipt does carry it').toHaveLength(2);
    const env = composeToolCallResponse({ answerKind: 'functional', orientation: 'Recorded.', confirmation: '', coaching: null, stage: 'analyse', handlerFacts: [fact] });
    const patch = (env.blocks as Rec[]).find((b) => b.type === 'graph_patch')!;
    expect(patch.target_id).toBe('enterprise_win_rate→quarterly_revenue');
    expect(patch.after.strength.mean).toBe(1);
    expect(patch.after).not.toHaveProperty('frame_refit');
  });
});
