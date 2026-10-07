import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { selectGuidance } from '../../../guidance/select.js';
import { assembleGuidanceSignals } from '../../../turn-context/guidance-signals.js';
import {
  cardCallFor, fallbackReply, methodTurnForReadback, methodTurnFromSignals, PREMORTEM_PRESS_ID, selectorSignalsOf, settleMethodTurn,
  type MethodReadback, type MethodTurn, type RunMethodTurn,
} from '../../method-turn.js';

type Graph = { nodes: Record<string, any>[]; edges: Record<string, any>[]; goal_constraints?: unknown };
type Read = {
  graph: Graph; analysis_state: unknown; analysis_result: unknown;
  current_read: { analysis_ready: unknown }; analysis_option_participation: unknown;
  analysis_identity_evaluated_node_ids?: string[];
};
const load = (path: string) => JSON.parse(readFileSync(new URL(`../fixtures/${path}.json`, import.meta.url), 'utf8'));
export const capture = (name: string): Read => load(`w9c/${name}-read`).j;
export const readback = (c: Read) => ({
  graph: c.graph, analysisState: c.analysis_state, analysisResult: c.analysis_result,
  analysisReady: c.current_read.analysis_ready, optionParticipation: c.analysis_option_participation,
  identityEvaluated: new Set(c.analysis_identity_evaluated_node_ids ?? []),
} satisfies MethodReadback);
export function requireRun(out: MethodTurn | null): RunMethodTurn {
  assert.equal(out?.kind, 'run');
  if (out?.kind !== 'run') throw new Error('expected a method run');
  return out;
}
export const turn = (c: Read) => requireRun(methodTurnForReadback(PREMORTEM_PRESS_ID, readback(c)));
export function draftFor(name: string): string {
  const price = name === 'w9b-2' ? 'Price rise' : 'Existing customer price rise';
  const starter = name === 'w9b-2' ? 'Starter tier launched' : 'Starter subscribers';
  return [
    'Imagine this decision has gone badly. Two failure stories to test:',
    `1. Raise prices 10%: ${price} drove customers away before the extra revenue could help monthly recurring revenue. Watch for: renewal objections and cancellations. Mitigate: test the change with a small customer group and review retention before expanding.`,
    `2. Launch starter tier: ${starter} fell short of the uptake the launch depended on. Watch for: slow signups and stalled activation. Mitigate: test demand with a small launch and adjust the offer before committing further.`,
    'Outside the model: what else could have blindsided this decision?',
  ].join('\n');
}
export const rows: Record<string, () => void> = {};
for (const name of ['w9b-2', 'w9b-3']) {
  rows[`${name}: real selector and adapter choose own-lever stories, with no card or mutation`] = () => {
    const c = capture(name);
    const before = JSON.stringify(c);
    const rb = readback(c);
    const request = load(`w9c/${name}-request`).request_body;
    assert.equal(request.chip.id, PREMORTEM_PRESS_ID);
    const signals = assembleGuidanceSignals({ ...rb, offeredSpecific: [], leaderLicensed: false,
      request: 'method', explicitRequest: 'RC-PREMORTEM' });
    const selected = selectGuidance({ ...selectorSignalsOf(signals, null), 'user.generic_method_press': true }, {});
    assert.equal(selected.runs_method, 'RC-PREMORTEM');
    assert.equal(selected.mode, 'decision_plan');
    const out = turn(c);
    assert.equal(out.context.plan, null);
    assert.equal(out.context.decision_level, true);
    assert.equal(out.context.dsk, null);
    assert.deepEqual(out.context.supplied_figures, []);
    assert.ok(out.directive.includes('give no Run figures, leader or ranking claims'));
    assert.ok(out.directive.includes('no model change or approval card'));
    const ownIds = new Set(c.graph.nodes.filter(n => n.kind === 'option' && n.id !== 'keep_pricing_as_it_is')
      .flatMap(n => Object.keys(n.interventions ?? {})));
    assert.ok(out.context.supplied_items.length >= 2);
    for (const item of out.context.supplied_items) {
      if (item.lever_option_labels !== undefined) assert.ok(ownIds.has(item.id));
      assert.equal(item.card, null);
      assert.equal(cardCallFor(item, c.graph), null);
    }
    const settled = settleMethodTurn(out, draftFor(name));
    assert.equal(settled.passed, true, JSON.stringify(settled.failed));
    assert.equal(settled.reply, draftFor(name));
    assert.equal(cardCallFor(settled.target, c.graph), null);
    assert.ok(!settled.reply.includes('Start with how'));
    assert.equal(JSON.stringify(c), before);
  };
  rows[`${name}: rejection and empty draft still send two qualitative stories without approval`] = () => {
    const c = capture(name);
    const out = turn(c);
    for (const draft of ['', '1. The winner had a 52% chance.']) {
      const settled = settleMethodTurn(out, draft);
      assert.equal(settled.passed, false);
      const rechecked = settleMethodTurn(out, settled.reply);
      assert.equal(rechecked.passed, true, JSON.stringify(rechecked.failed));
      assert.equal(settled.reply.split('Watch for:').length - 1, 2);
      assert.equal(settled.reply.split('Mitigate:').length - 1, 2);
      assert.ok(!settled.reply.includes('Start with'));
      assert.equal(cardCallFor(settled.target, c.graph), null);
    }
  };
}
rows['licensed-leader B: whole adapter, fallback and settlement remain byte-identical'] = () => {
  const c: Read = load('w9b/B').j;
  const actual = turn(c);
  const base = load('w9c/base-controls').leader as RunMethodTurn;
  assert.equal(JSON.stringify(actual), JSON.stringify(base));
  assert.equal(fallbackReply(actual.context), fallbackReply(base.context));
  const reply = [
    'Imagine this plan has gone badly.',
    ...base.context.supplied_items.slice(0, 2).map((item, i) => `${i + 1}. ${item.labels.join(' and ')} fell short. Watch for: early feedback. Mitigate: test the effect.`),
    'Outside the model: what else could have blindsided this?',
  ].join('\n');
  assert.equal(JSON.stringify(settleMethodTurn(actual, reply)), JSON.stringify(settleMethodTurn(base, reply)));
};
rows['must-not-fire: Run with no option paths retains the entire refusal'] = () => {
  const c = capture('w9b-2');
  c.graph.edges = [];
  assert.equal(JSON.stringify(methodTurnForReadback(PREMORTEM_PRESS_ID, readback(c))), JSON.stringify(load('w9c/base-controls').noPath));
};
rows['W9: all-user-sized model retains the entire refusal'] = () => {
  const c = load('scout-premortem-paths').draw1;
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
  assert.equal(JSON.stringify(methodTurnForReadback(PREMORTEM_PRESS_ID, { ...c, graph })), JSON.stringify(load('w9c/base-controls').allUser));
};
rows['decision items without intervention metadata still prepare no approval card'] = () => {
  const c = capture('w9b-2');
  // Hold the captured path projection while removing only science's lever metadata, isolating the card guard.
  const signals = assembleGuidanceSignals({ ...readback(c), offeredSpecific: [], leaderLicensed: false,
    request: 'method', explicitRequest: 'RC-PREMORTEM' });
  for (const node of c.graph.nodes) if (node.kind === 'option') delete node.interventions;
  const out = requireRun(methodTurnFromSignals(PREMORTEM_PRESS_ID, signals, c.graph));
  assert.ok(out.context.supplied_items.some(item => item.kind === 'link'));
  for (const item of out.context.supplied_items) {
    assert.equal(item.card, null);
    assert.equal(cardCallFor(item, c.graph), null);
  }
};
rows['class guard: leaders, rankings and withheld figures remain rejected; user-label digits pass'] = () => {
  const out = turn(capture('w9b-2'));
  assert.equal(settleMethodTurn(out, draftFor('w9b-2')).passed, true);
  for (const claim of ['Raise prices 10% is the leader.', 'Launch starter tier is leading.', 'The ranking favours the starter tier.',
    'Raise prices 10% wins.', 'Raise prices 10% is best.', 'The outcome was £126,000.', 'The chance was 52%.', 'It scored 0.5071333333333334.']) {
    const settled = settleMethodTurn(out, `${claim}\n${draftFor('w9b-2')}`);
    // P02: the refused sentence never reaches the wire; the passing stories are sent in the server's frame.
    assert.ok(!settled.reply.includes(claim), claim);
    assert.notEqual(settled.reply, `${claim}\n${draftFor('w9b-2')}`, claim);
    assert.ok(settled.failed.includes(claim.includes('£') || claim.includes('scored') ? 'PM-NO-FIGURES'
      : claim.includes('chance') ? 'PM-NO-PROB' : 'PM-NO-WINNER'), `${claim}: ${settled.failed}`);
  }
};
rows['timing: existing number parser on three 20k-whitespace shapes stays below 50 ms'] = () => {
  const out = turn(capture('w9b-2'));
  const space = ' '.repeat(20_000);
  const drafts = [`${space}${draftFor('w9b-2')}`, `The outcome was £126,000${space}.\n${draftFor('w9b-2')}`,
    `The chance was 52${space}%.\n${draftFor('w9b-2')}`];
  for (const draft of drafts) {
    const start = performance.now();
    const settled = settleMethodTurn(out, draft);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `${elapsed} ms`);
    // P02: the drafts with a figure in their opening are sent without it, never as written.
    assert.equal(settled.passed, true);
    assert.equal(settled.reply === draft, draft === drafts[0]);
  }
};
