import { legacyDoorGraph, reclassifiedCTurn, reclassifiedCPlan } from '../../../__tests__/licence-test-graphs.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { checkMethodTurn } from '../../../guidance/method-turn-check.js';
import { POLICY } from '../../../guidance/policy.js';
import type { MethodInputs, MethodTurnId } from '../../../guidance/types.js';
import { cardCallFor, fallbackReply, methodDirective, methodTurnForReadback, planPickChipId, PREMORTEM_PRESS_ID,
  settleMethodTurn, type MethodReadback, type RunMethodTurn } from '../../method-turn.js';
import type { SuppliedItem } from '../../../science/method-science-context.js';
import { capture, draftFor, readback, requireRun, turn } from './w9c-rows.js';

const load = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const base = load('../fixtures/w9c/r2-base-controls.json');
const pinned = load('../fixtures/w9c/r2-controls.json');
const served = load('../../../turn-context/__tests__/fixtures/rc-served-signal-cases.json').cases;
export const timings: Record<string, number[]> = {};
export const r2Rows: Record<string, () => void> = {};
function servedReadback(id: string): MethodReadback {
  const c = served.find((c: { id: string }) => c.id === id).body;
  return { graph: legacyDoorGraph(c.draft_graph), analysisState: c.analysis_state, analysisResult: c.analysis_result,
    optionParticipation: c.option_participation, analysisReady: { status: 'ready', may_run: true } };
}
// Science 393023 LICENCE (a)/(b), 7 Oct: std 0.125 → 0.1 on a clone preserves this independent claim; captured bytes stay unchanged.
function captureReadback(name: string): MethodReadback {
  if (name === 'C') {
    const c = load('../fixtures/w9b/C.json').j;
    return readback(c);
  }
  if (name.startsWith('draw')) return load('../fixtures/scout-premortem-paths.json')[name];
  if (name.startsWith('A-')) return servedReadback(name);
  return readback(capture(name));
}

r2Rows['P1-1: all 29 historical checker fixtures keep exact matches, failures and targets'] = () => {
  const fixtures = load('../../../__tests__/fixtures/reasoning-coach-acceptance.json').method_turn_fixtures;
  assert.equal(fixtures.length, 29);
  const numeric = /(?<![A-Za-z])[£$€]?\d[\d,]*(?:\.\d+)?\s*(?:%|k|m|bn)?/giu;
  for (const f of fixtures) {
    // Compare the marker-stripper's exact matches as well as downstream number-token matches.
    const old = f.reply.match(/^\s*[1-9]\.\s/gmu) ?? [];
    const fixed = f.reply.match(/^[ \t]*[1-9]\.\s/gmu) ?? [];
    assert.deepEqual(fixed, old, f.id);
    assert.deepEqual([...f.reply.replace(/^[ \t]*[1-9]\.\s/gmu, '').matchAll(numeric)].map(m => m[0]),
      [...f.reply.replace(/^\s*[1-9]\.\s/gmu, '').matchAll(numeric)].map(m => m[0]), f.id);
    const actual = checkMethodTurn(f.policy_id as MethodTurnId, f.reply, f.inputs as MethodInputs);
    assert.equal(actual.pass, f.expect === 'pass', f.id);
    assert.deepEqual(new Set(actual.failed), new Set(f.failing_checks ?? []), f.id);
    if (f.expect_targets) assert.deepEqual(actual.targets, f.expect_targets, f.id);
  }
  const source = JSON.parse(readFileSync(new URL('../../../guidance/reasoning-interventions.json', import.meta.url), 'utf8'));
  assert.deepEqual(POLICY, Object.fromEntries(Object.keys(POLICY).map(key => [key, source[key]])));
};
for (const [name, prefix] of Object.entries({ spaces: ' '.repeat(20_000), newlines: '\n'.repeat(20_000),
  'newlines + marker': '\n'.repeat(20_000) + '1. x\n', 'newlines + failing tail': '\n'.repeat(20_000) + ':)\n' })) {
  r2Rows[`P1-1 timing: 20k ${name} <50ms`] = () => {
    const out = turn(capture('w9b-2'));
    const reply = prefix + draftFor('w9b-2');
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const result = checkMethodTurn('RC-PREMORTEM', reply, out.check_inputs);
      const elapsed = performance.now() - start;
      times.push(elapsed);
      assert.ok(elapsed < 50, `${name}: ${elapsed}ms`);
      assert.deepEqual(result.failed, name === 'newlines + marker' ? ['PM-GROUNDED', 'PM-WATCH-MITIGATE'] : []);
    }
    timings[name] = times;
  };
}
for (const phrase of ['leading to lower renewals', 'a leading indicator', 'market-leading', 'team leader',
  'ranked price above features', '2 weeks', 'first 30 days']) {
  r2Rows[`P1-2 PASS exact: ${phrase}`] = () => {
    const out = turn(capture('w9b-2'));
    const reply = draftFor('w9b-2').replace('renewal objections and cancellations', phrase);
    const result = settleMethodTurn(out, reply);
    assert.equal(result.passed, true, `${phrase}: ${result.failed}`);
    assert.deepEqual(result.failed, []);
    assert.equal(result.reply, reply);
  };
}
for (const [phrase, failed] of Object.entries({
  'came out on top': ['PM-NO-WINNER'], 'the stronger option': ['PM-NO-WINNER'], 'X beats Y': ['PM-NO-WINNER'],
  'X is the best option': ['PM-NO-WINNER'], 'the winner': ['PM-NO-WINNER'],
  '47%': ['PM-NO-PROB', 'PM-NO-FIGURES'], 'about half': ['PM-NO-FIGURES'], 'forty-seven percent': ['PM-NO-FIGURES'],
  'is the leader': ['PM-NO-WINNER'], 'ranks first': ['PM-NO-WINNER'], 'top-ranked': ['PM-NO-WINNER'],
  'outperformed the other option': ['PM-NO-WINNER'],
})) {
  r2Rows[`P1-2 REJECT exact: ${phrase}`] = () => {
    const out = turn(capture('w9b-2'));
    const reply = `${phrase}.\n${draftFor('w9b-2')}`;
    const result = settleMethodTurn(out, reply);
    assert.equal(result.passed, false, phrase);
    assert.deepEqual(result.failed, failed, phrase);
    assert.equal(result.reply, fallbackReply(out.context));
  };
}
r2Rows['P2-6: the whole-ban label Leader cannot mask a leader assertion'] = () => {
  const out = turn(capture('w9b-2'));
  const result = checkMethodTurn('RC-PREMORTEM', `X is the Leader.\n${draftFor('w9b-2')}`,
    { ...out.check_inputs, model_labels: ['Leader'] });
  assert.deepEqual(result.failed, ['PM-NO-WINNER']);
};

const storyRows: Array<[string, SuppliedItem, string]> = [
  ['lever', { id: 'lever', kind: 'factor', labels: ['Migration effort'], card: null, lever_option_labels: ['Migrate'] },
    'The effect of ‘Migration effort’ fell short of what ‘Monthly spend’ needed. Watch for: early results diverging from the expected effect. Mitigate: test this lever with a small group before expanding.'],
  ['link', { id: 'a->b', kind: 'link', labels: ['Monthly cloud savings', 'Monthly spend'], card: null },
    'The relationship between ‘Monthly cloud savings’ and ‘Monthly spend’ differed from the model, undermining progress towards ‘Monthly spend’. Watch for: the observed relationship diverging from the model. Mitigate: check this relationship before relying on it.'],
  ['risk', { id: 'risk', kind: 'risk', labels: ['Migration outage'], card: null },
    '‘Migration outage’ materialised and undermined progress towards ‘Monthly spend’. Watch for: early signs of this risk. Mitigate: prepare a response before committing further.'],
  ['limit', { id: 'limit', kind: 'limit', labels: ['Budget cap'], card: null },
    '‘Budget cap’ was breached, undermining progress towards ‘Monthly spend’. Watch for: approaching this limit. Mitigate: set a checkpoint before committing further.'],
  ['factor', { id: 'factor', kind: 'factor', labels: ['Migration preparation effort'], card: null },
    '‘Migration preparation effort’ differed from the model, undermining progress towards ‘Monthly spend’. Watch for: observations diverging from the model. Mitigate: check this assumption before relying on it.'],
];
for (const [kind, item, story] of storyRows) {
  r2Rows[`P1-3 exact fallback: ${kind}`] = () => {
    const out = requireRun(methodTurnForReadback(PREMORTEM_PRESS_ID, servedReadback('A-STALE-SILENT')));
    const context = { ...out.context, supplied_items: [item], goal_label: 'Monthly spend' };
    const reply = fallbackReply(context);
    assert.equal(reply, `Imagine this decision has gone badly. Two failure stories to test:\n1. ${story}\n2. ${story}\nOutside the model: what else could have blindsided this decision?`);
    assert.deepEqual(checkMethodTurn('RC-PREMORTEM', reply,
      { ...out.check_inputs, supplied_items: [{ id: item.id, labels: item.labels }] }).failed, []);
    assert.equal(cardCallFor(item, {}), null);
  };
}
r2Rows['P1-3 served A-STALE-SILENT: exact kind-correct link fallback without levers or cards'] = () => {
  const rb = servedReadback('A-STALE-SILENT');
  const out = requireRun(methodTurnForReadback(PREMORTEM_PRESS_ID, rb));
  assert.ok(out.context.supplied_items.every(i => i.lever_option_labels === undefined && i.card === null));
  assert.equal(fallbackReply(out.context), pinned['A-STALE-SILENT'].fallback);
  assert.equal(settleMethodTurn(out, fallbackReply(out.context)).passed, true);
};

for (const name of ['w9b-2', 'w9b-3', 'C', 'A-Q-D1-BUILD', 'draw2']) {
  r2Rows[`P1-4 union + A2 option-grounding intersection: ${name}`] = () => {
    const rb = captureReadback(name);
    const out = requireRun(methodTurnForReadback(PREMORTEM_PRESS_ID, rb));
    const items = out.context.supplied_items;
    assert.ok(items.some(i => i.lever_option_labels !== undefined));
    const firstUnion = items.findIndex(i => i.lever_option_labels === undefined);
    assert.ok(firstUnion > 0);
    assert.ok(items.slice(firstUnion).every(i => i.lever_option_labels === undefined));
    assert.ok(items.every(i => i.card === null));
    for (const item of base[name].turn.context.supplied_items as SuppliedItem[]) {
      const actual = items.find(i => i.id === item.id);
      assert.ok(actual, `${name}: lost ${item.id}`);
      assert.equal(actual.kind, item.kind);
      assert.deepEqual(actual.labels, item.labels);
    }
    let groundedOptions = 0;
    for (const [id, recorded] of Object.entries(base[name].plans) as Array<[string, RunMethodTurn]>) {
      // Science 393023 LICENCE (a)/(b), 7 Oct: C's option-scoped turns also gain their newly unsized path link; all other fields stay pinned.
      const original = name === 'C' ? reclassifiedCPlan(recorded, id) : recorded;
      const scoped = methodTurnForReadback(planPickChipId(id), rb);
      assert.equal(JSON.stringify(scoped), JSON.stringify(original), `${name} option ${id}`);
      if (original?.kind !== 'run') continue;
      const expected = original.context.supplied_items.filter(i => (i.kind === 'factor' || i.kind === 'link')
        && (name === 'C' ? reclassifiedCTurn(base[name].turn) : base[name].turn).context.supplied_items.some((b: SuppliedItem) => b.id === i.id && b.kind === i.kind));
      if (expected.length > 0) groundedOptions++;
      // A2 premortem.ts:173-175 requires a row's labels/id/kind in both generic and option-scoped turns.
      const actual = original.context.supplied_items.filter(i => (i.kind === 'factor' || i.kind === 'link')
        && items.some(b => b.id === i.id && b.kind === i.kind && JSON.stringify(b.labels) === JSON.stringify(i.labels)));
      assert.deepEqual(actual.map(i => i.id), expected.map(i => i.id));
    }
    assert.ok(groundedOptions > 0, `${name}: no baseline A2 grounding`);
  };
}
r2Rows['P1-4 R1: the ORIGINAL served D1 GOOD draft passes verbatim with no card'] = () => {
  const rb = servedReadback('A-Q-D1-BUILD');
  const out = requireRun(methodTurnForReadback(PREMORTEM_PRESS_ID, rb));
  const graph = rb.graph as { nodes: { id: string; label: string }[] };
  const label = (id: string) => graph.nodes.find(n => n.id === id)!.label;
  const reply = [
    'Two ways this could go wrong, so you can watch for them early.',
    `1. It is a year later and the plan went badly because ${label('sprint_capacity_for_ai_reporting')} stayed thin, so ${label('ai_reporting_module_availability')} slipped. Watch for: a missed demo date. Mitigate: protect the sprint.`,
    `2. ${label('integration_step_bug_resolution')} was left undone and ${label('trial_profile_abandonment_rate')} kept rising. Watch for: trial sign-ups going quiet. Mitigate: fix the worst step first.`,
    'Outside the model: what could blindside this that none of these figures covers?',
  ].join('\n');
  const actual = settleMethodTurn(out, reply);
  assert.equal(actual.passed, true, JSON.stringify(actual.failed));
  assert.deepEqual(actual.failed, []);
  assert.equal(actual.reply, reply);
  assert.equal(cardCallFor(actual.target, rb.graph), null);
};
r2Rows['P2: near-tie C WHOLE turn, check_inputs, directive and exact fallback/settlement pin'] = () => {
  const out = requireRun(methodTurnForReadback(PREMORTEM_PRESS_ID, captureReadback('C')));
  // Science 393023 LICENCE (a)/(b), 7 Oct: two → four unsized grounding links; fallback and settlement stay pinned.
  assert.equal(JSON.stringify(out), JSON.stringify(reclassifiedCTurn(pinned.C.turn)));
  assert.equal(fallbackReply(out.context), pinned.C.fallback);
  assert.equal(JSON.stringify(settleMethodTurn(out, '')), JSON.stringify(pinned.C.settled));
};
r2Rows['P2 scope: licensed W9 draw1 WHOLE adapter, fallback and settlement stay byte-identical'] = () => {
  const rb = captureReadback('draw1');
  const out = requireRun(methodTurnForReadback(PREMORTEM_PRESS_ID, rb));
  assert.equal(JSON.stringify(out), JSON.stringify(base.draw1.turn));
  assert.equal(fallbackReply(out.context), base.draw1.fallback);
  assert.equal(JSON.stringify(settleMethodTurn(out, '')), JSON.stringify(base.draw1.settled));
  const draft = `Two ways this went badly.\n1. Price rise MRR uplift and monthly recurring revenue diverged. Watch for: early feedback. Mitigate: check it.\n2. Customer losses from price rise materialised. Watch for: cancellations. Mitigate: prepare a response.\nOutside the model: what else could blindside this?`;
  assert.equal(JSON.stringify(settleMethodTurn(out, draft)), JSON.stringify(settleMethodTurn(base.draw1.turn, draft)));
  // The original licensed W9 checker allowed non-probability quantities and plain leader vocabulary.
  for (const prefix of ['The schedule involved 47 tasks.', 'The team leader left.', 'It achieved about half of the target.']) {
    const reply = `${prefix}\n${draft}`;
    const settled = settleMethodTurn(out, reply);
    assert.equal(settled.passed, true, `${prefix}: ${settled.failed}`);
    assert.equal(settled.reply, reply);
  }
};
r2Rows['P2 scope: non-near-tie D1 and stale decision changes are whole-object pinned'] = () => {
  for (const name of ['A-Q-D1-BUILD', 'A-STALE-SILENT', 'draw2']) {
    const out = requireRun(methodTurnForReadback(PREMORTEM_PRESS_ID, captureReadback(name)));
    assert.notEqual(JSON.stringify(out), JSON.stringify(base[name].turn));
    assert.equal(JSON.stringify(out), JSON.stringify(pinned[name].turn));
    assert.equal(fallbackReply(out.context), pinned[name].fallback);
  }
};
r2Rows['P2-5: one own lever uses a surviving union item for the second story'] = () => {
  const c = capture('w9b-2');
  for (const option of c.graph.nodes.filter(n => n.kind === 'option' && n.id !== 'raise_prices_10')) delete option.interventions;
  const out = turn(c);
  assert.equal(out.context.supplied_items.filter(i => i.lever_option_labels !== undefined).length, 1);
  assert.ok(out.context.supplied_items.length > 1);
  const reply = fallbackReply(out.context);
  assert.equal(reply.split('The effect of ‘Price rise’').length - 1, 1);
  assert.ok(reply.includes('2. ‘Customers lost after price rise’ materialised'));
  assert.equal(settleMethodTurn(out, reply).passed, true);
  assert.ok(methodDirective(out.context).includes('no model change or approval card'));
};

r2Rows['Science 393023: as-served C supplies two newly grounded links; D1 differs from its legacy control'] = () => {
  const c = captureReadback('C');
  const current = requireRun(methodTurnForReadback(PREMORTEM_PRESS_ID, c));
  assert.deepEqual(current.context.supplied_items.filter(i => ['price_rise->price_rise_churn', 'starter_tier_support_cost->support_capacity_strain'].includes(i.id)).map(i => i.id),
    ['price_rise->price_rise_churn', 'starter_tier_support_cost->support_capacity_strain']);
  const legacy = captureReadback('A-Q-D1-BUILD');
  const graph = served.find((c: { id: string }) => c.id === 'A-Q-D1-BUILD').body.draft_graph;
  assert.notEqual(JSON.stringify(methodTurnForReadback(PREMORTEM_PRESS_ID, { ...legacy, graph })), JSON.stringify(methodTurnForReadback(PREMORTEM_PRESS_ID, legacy)));
};
