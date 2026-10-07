/** W9b: untouched A2 read captures, through the same method adapter as the route. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import {
  PREMORTEM_PRESS_ID, cardCallFor, fallbackReply, methodTurnForReadback,
  planPickChipId, settleMethodTurn, type MethodReadback, type MethodTurn, type RunMethodTurn,
} from '../method-turn.js';

type Graph = { nodes: Record<string, any>[]; edges: Record<string, any>[]; goal_constraints?: unknown };
type Read = {
  graph: Graph; analysis_state: unknown; analysis_result: unknown;
  current_read: { analysis_ready: unknown }; analysis_option_participation: unknown;
  analysis_identity_evaluated_node_ids?: string[];
};
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/w9b/${name}.json`, import.meta.url), 'utf8'));
const captured = (name: string): Read => load(name).j;
const base = load('base-turns') as Record<string, MethodTurn>;
const readback = (c: Read): MethodReadback => ({
  graph: c.graph, analysisState: c.analysis_state, analysisResult: c.analysis_result,
  analysisReady: c.current_read.analysis_ready, optionParticipation: c.analysis_option_participation,
  ...(c.analysis_identity_evaluated_node_ids !== undefined
    ? { identityEvaluated: new Set(c.analysis_identity_evaluated_node_ids) } : {}),
});
const turn = (c: Read, chip = PREMORTEM_PRESS_ID) => methodTurnForReadback(chip, readback(c));
const run = (out: MethodTurn | null): RunMethodTurn => {
  assert.equal(out?.kind, 'run');
  if (out?.kind !== 'run') throw new Error('expected decision method, not refusal');
  return out;
};

describe('W9b: near-tie completed decision pre-mortem', () => {
  it('A: RED at base — runs the decision on both paths without mutating captured keys or naming a leader', () => {
    const c = captured('A');
    const before = JSON.stringify(c);
    const out = run(turn(c));
    assert.equal(out.context.plan, null);
    assert.equal(out.context.decision_level, true);
    assert.equal(out.context.dsk, null);
    assert.equal(out.context.not_cited, 'no_identified_plan');
    assert.deepEqual(out.context.supplied_items.map(i => i.id), ['price_change_from_current', 'starter_tier_launched']);
    assert.ok(out.directive.includes('Stress-test the whole decision.'));
    assert.equal(out.check_inputs.plan_label, undefined);
    assert.equal(out.check_inputs.decision_level, true);
    // The existing directive bans ranking; no selected option or ranking data is supplied.
    assert.deepEqual(out.context.supplied_figures, []);
    assert.ok(!/\b(?:leads|ahead)\b/i.test(out.directive));
    assert.ok(!/\b(?:best|winner|leads|ahead)\b/i.test(fallbackReply(out.context)));
    assert.equal(cardCallFor(out.context.supplied_items[0], c.graph)?.tool, 'propose_assumptions');
    assert.equal(JSON.stringify(c), before);
  });

  it('A: two grounded decision stories pass the existing method checker', () => {
    const out = run(turn(captured('A')));
    const draft = [
      'Two ways this decision went badly.',
      '1. Price change from current overshot what customers accepted. Watch for: renewal complaints. Mitigate: test the price change.',
      '2. Starter tier launched stalled before customers could join. Watch for: delayed signups. Mitigate: test the launch with a small group.',
      'Outside the model: what else could have blindsided this?',
    ].join('\n');
    assert.equal(settleMethodTurn(out, draft).passed, true);
  });

  it('B: entire grounded licensed-plan output is byte-equivalent to the base replay', () => {
    assert.equal(JSON.stringify(turn(captured('B'))), JSON.stringify(base.B));
  });

  it('C: entire decision-union output and first-link fallback/card are unchanged', () => {
    const c = captured('C');
    const out = run(turn(c));
    assert.equal(JSON.stringify(out), JSON.stringify(base.C));
    assert.equal(fallbackReply(out.context), 'Imagine this decision has gone badly. Start with how ‘Support capacity strain’ affects ‘monthly recurring revenue’: how would you notice it early, and what would you do?');
    assert.equal(cardCallFor(out.context.supplied_items[0], c.graph)?.tool, 'propose_link_strengths');
  });

  it('W9 all-user-sized links/values still refuse', () => {
    const c = JSON.parse(readFileSync(new URL('./fixtures/scout-premortem-paths.json', import.meta.url), 'utf8')).draw1;
    const graph: Graph = structuredClone(c.graph);
    graph.nodes = graph.nodes.filter(n => n.kind !== 'risk');
    const ids = new Set(graph.nodes.map(n => n.id));
    graph.edges = graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => ({
      ...e, provenance: { source: 'user_specified', magnitude: 'user_stated' },
    }));
    graph.nodes = graph.nodes.map(n => n.kind === 'factor' ? {
      ...n, observed_state: { ...n.observed_state, source: 'user_specified' },
    } : n);
    delete graph.goal_constraints;
    const out = methodTurnForReadback(PREMORTEM_PRESS_ID, { ...c, graph });
    assert.equal(out?.kind, 'unavailable');
    assert.equal(out?.kind === 'unavailable' && out.reason, 'no_grounded_item');
  });

  it('explicit unlicensed A pick retains the base empty-path refusal', () => {
    const out = turn(captured('A'), planPickChipId('raise_prices_by_10'));
    assert.equal(out?.kind, 'unavailable');
    assert.equal(out?.kind === 'unavailable' && out.reason, 'no_grounded_item');
    assert.ok(out?.kind === 'unavailable' && out.reply.includes('‘Raise prices by 10%’'));
  });

  it('an inferred factor off the decision paths cannot rescue an all-user-sized union', () => {
    const c = captured('A');
    for (const n of c.graph.nodes.filter(n => n.kind === 'factor')) n.observed_state.source = 'user_specified';
    c.graph.nodes.push({ id: 'off_path', kind: 'factor', label: 'Off path',
      observed_state: { source: 'cee_inference', value: 10 } });
    assert.equal(turn(c)?.kind, 'unavailable');
  });

  for (const change of ['user_source', 'brief_source', 'explicit_type', 'node_explicit_type', 'accepted', 'no_value', 'no_source', 'stale'] as const) {
    it(`empty union stays conservative: ${change}`, () => {
      const c = captured('A');
      for (const n of c.graph.nodes.filter(n => n.kind === 'factor')) {
        if (change === 'user_source') n.observed_state.source = 'user_specified';
        if (change === 'brief_source') n.observed_state.source = 'brief_extraction';
        if (change === 'explicit_type') n.observed_state.extractionType = 'explicit';
        if (change === 'node_explicit_type') n.extractionType = 'explicit';
        if (change === 'accepted') n.observed_state.reviewed_by_user = { intent: 'confirm' };
        if (change === 'no_value') delete n.observed_state.value;
        if (change === 'no_source') delete n.observed_state.source;
      }
      if (change === 'stale') (c.analysis_state as { run_state: { kind: string } }).run_state.kind = 'complete_stale';
      assert.equal(turn(c)?.kind, 'unavailable');
    });
  }
});
