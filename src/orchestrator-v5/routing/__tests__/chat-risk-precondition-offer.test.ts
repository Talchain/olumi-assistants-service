import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { chatRiskPreconditionOffersFor, chatRiskPreconditionOptionsFor, chatRiskPreconditionTimingFor } from '../chat-risk-precondition.js';
import { riskAddPressFor, widenAddCallOf } from '../../agent-lane/method-turn/widen-turn.js';
import { withRiskPreconditionChoice, withoutRiskPreconditionChoice } from '../../agent-lane/chat-risk-precondition-choice.js';
import { proposalRecord } from '../../agent-lane/proposal-object/record.js';
import type { PendingAction } from '../../session/pending-action.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

const brief = 'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, '
  + 'should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const graph = {
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Pro plan price' },
    { id: 'keep', kind: 'option', label: 'Keep £49', is_baseline: true },
    { id: 'raise_59', kind: 'option', label: 'Raise Pro price to £59' },
    { id: 'raise_54', kind: 'option', label: 'Raise Pro price to £54' },
  ],
  edges: [],
};
const offers = [
  { option_id: 'raise_59', option_label: 'Raise Pro price to £59' },
  { option_id: 'raise_54', option_label: 'Raise Pro price to £54' },
];
const press = (option_id = 'raise_59', option_label = 'Raise Pro price to £59', label = 'Feature release slips',
  binding?: { proposal_id: string; revision: string; digest: string }) =>
  riskAddPressFor({ label, mechanism: 'relies_on', hits: { id: option_id, label: option_label, kind: 'option' } }, binding);
const choiceHold = (g: unknown = graph, label = 'Feature release slips'): PendingAction => {
  const hold: PendingAction = {
    id: '11111111-1111-4111-8111-111111111111', scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', chip_id: 'gmh_0123456789ab',
    action: { kind: 'apply_proposed_change', proposal_ref: 'gmh_0123456789ab', public_label: 'Add release risk', public_message: 'Yes, add the release risk.',
      inline_patch: { handler_id: 'graph_management_held_v1', operations: [
        { op: 'add_node', path: 'release_risk', value: { id: 'release_risk', kind: 'risk', label } },
      ] } },
    preconditions: { graph_hash: computeAnalysisAffectingGraphHash(g as never)! },
    emitted_at_iso: new Date().toISOString(), expires_at_iso: new Date(Date.now() + 60_000).toISOString(), expires_at_turn_count: 99,
  };
  return withRiskPreconditionChoice(hold, g, [], 'Choose which option relies on this risk not happening.');
};

describe('chat precondition offer — bounded stored timing, human choice and current identity', () => {
  it('P44 offers both options, and neither selects an option nor requires a factor or goal', () => {
    expect(chatRiskPreconditionOffersFor('Feature release slips', graph, brief)).toEqual(offers);
    expect(chatRiskPreconditionTimingFor('Feature release slips', graph, brief)).toEqual({
      phrase: 'with the next Pro feature release', source: 'brief',
    });
    const hold = choiceHold();
    const binding = proposalRecord(hold, graph)!;
    for (const offer of offers) {
      const action = press(offer.option_id, offer.option_label, 'Feature release slips', binding);
      expect(action.label).toBe(`Add to ‘${offer.option_label}’`);
      expect(action.message).toBe(`Add the risk ‘Feature release slips’ to ‘${offer.option_label}’: `
        + 'that option relies on this not happening. The Run leaves it out until it can apply to that option alone.');
      expect(widenAddCallOf(action.id, action.message, { graph }, [hold])).toMatchObject({
        tool: 'propose_new_risk', relies_on: offer, choice_binding: { proposal_id: binding.proposal_id, revision: binding.revision, digest: binding.digest },
        args: { label: 'Feature release slips', affects: [], caused_by: [], whole_request: true },
      });
    }
  });

  it('controls: unrelated risks, missing timing, content outside the phrase, and function words do not corroborate', () => {
    expect(chatRiskPreconditionOffersFor('Competitor cuts prices', graph, brief)).toEqual([]);
    expect(chatRiskPreconditionOffersFor('Feature release slips', graph, 'The Pro feature release matters to the change.')).toEqual([]);
    expect(chatRiskPreconditionOffersFor('Feature release slips', graph, 'Feature release slips. Launch with the next campaign.')).toEqual([]);
    expect(chatRiskPreconditionOffersFor('Feature release slips', graph, 'Launch with the next campaign. The feature release matters.')).toEqual([]);
    expect(chatRiskPreconditionOffersFor('Should happen when risks happen', graph, brief)).toEqual([]);
    expect(chatRiskPreconditionOffersFor('Upcoming event fails', graph, 'Launch with the upcoming campaign.')).toEqual([]);
  });

  it.each(['with', 'at', 'after', 'alongside', 'once', 'when'])('accepts %s and the shared four-letter stem within the phrase', (marker) => {
    expect(chatRiskPreconditionTimingFor('Releasing slips', graph, `Launch ${marker} the coming release.`)).toEqual({
      phrase: `${marker} the coming release`, source: 'brief',
    });
  });

  it('reads decision labels, excludes decision descriptions, respects punctuation and enforces 1–6 words', () => {
    const decision = { ...graph, nodes: [{ id: 'decision', kind: 'decision', label: 'Launch after the upcoming feature release' }] };
    expect(chatRiskPreconditionTimingFor('Feature release slips', decision)).toEqual({
      phrase: 'after the upcoming feature release', source: 'decision',
    });
    const description = { ...graph, nodes: [{ id: 'decision', kind: 'decision', label: 'Launch', description: 'with the next feature release' }] };
    expect(chatRiskPreconditionTimingFor('Feature release slips', description)).toBeUndefined();
    expect(chatRiskPreconditionTimingFor('Feature release slips', graph, 'Launch with the next; feature release.')).toBeUndefined();
    expect(chatRiskPreconditionTimingFor('Feature release slips', graph, 'Launch with the next one two three four five feature.')).toBeDefined();
    expect(chatRiskPreconditionTimingFor('Feature release slips', graph, 'Launch with the next one two three four five six feature.')).toBeUndefined();
    expect(chatRiskPreconditionTimingFor('Feature release slips', graph, 'Launch with the next feature one two three four five six.')).toBeUndefined();
    expect(chatRiskPreconditionTimingFor('Feature release slips', graph, 'Launch with the next.')).toBeUndefined();
  });

  it.each([
    ['unicode-ellipsis', '…'],
    ['curly-closing-single-quote', '’'],
    ['curly-closing-double-quote', '”'],
    ['straight-closing-single-quote', "'"],
    ['straight-closing-double-quote', '"'],
  ])('chat-precondition-offer-punctuation-boundary %s RED: content after punctuation cannot corroborate', (_name, punctuation) => {
    const text = `Launch with the next Pro feature release${punctuation} Competitor cuts prices.`;
    expect(chatRiskPreconditionTimingFor('Competitor cuts prices', graph, text)).toBeUndefined();
    expect(chatRiskPreconditionOffersFor('Competitor cuts prices', graph, text)).toEqual([]);
    expect(chatRiskPreconditionTimingFor('Feature release slips', graph, text)).toEqual({
      phrase: 'with the next Pro feature release', source: 'brief',
    });
  });

  it('never offers either baseline surface, status quo or a duplicate identity', () => {
    const split = { ...graph, nodes: graph.nodes.map((node) => node.id === 'raise_59'
      ? { ...node, is_baseline: false, data: { is_baseline: true } } : node) };
    expect(chatRiskPreconditionOffersFor('Feature release slips', split, brief)).toEqual([offers[1]]);
    const reverse = { ...graph, nodes: graph.nodes.map((node) => node.id === 'raise_59'
      ? { ...node, is_baseline: true, data: { is_baseline: false } } : node) };
    expect(chatRiskPreconditionOffersFor('Feature release slips', reverse, brief)).toEqual([offers[1]]);
    const labelled = { ...graph, nodes: graph.nodes.map((node) => node.id === 'keep'
      ? { ...node, is_baseline: undefined, label: 'Status quo' } : node) };
    expect(chatRiskPreconditionOffersFor('Feature release slips', labelled, brief)).toEqual(offers);
    const duplicate = { ...graph, nodes: [...graph.nodes, { id: 'raise_59', kind: 'factor' }] };
    expect(chatRiskPreconditionOptionsFor(duplicate)).toEqual([offers[1]]);
  });

  it('press rejects baseline, changed/remapped identity, changed kind, removed option and forged message/id', () => {
    const hold = choiceHold();
    const binding = proposalRecord(hold, graph)!;
    const action = press('raise_59', 'Raise Pro price to £59', 'Feature release slips', binding);
    const current = (nodes: unknown[]) => ({ ...graph, nodes });
    const baseline = press('keep', 'Keep £49', 'Feature release slips', binding);
    expect(widenAddCallOf(baseline.id, baseline.message, { graph }, [hold])).toBeNull();
    for (const nodes of [
      graph.nodes.filter((node) => node.id !== 'raise_59'),
      graph.nodes.map((node) => node.id === 'raise_59' ? { ...node, kind: 'factor' } : node),
      graph.nodes.map((node) => node.id === 'raise_59' ? { ...node, is_baseline: true } : node),
      graph.nodes.map((node) => node.id === 'raise_59' ? { ...node, id: 'different_identity' } : node),
      graph.nodes.map((node) => node.id === 'raise_59' ? { ...node, label: 'Renamed option' } : node),
    ]) expect(widenAddCallOf(action.id, action.message, { graph: current(nodes) }, [hold])).toBeNull();
    expect(widenAddCallOf('agent-widen-add:0000000000000000', action.message, { graph }, [hold])).toBeNull();
    expect(widenAddCallOf(action.id, action.message.replace('£59', '£54'), { graph }, [hold])).toBeNull();
    expect(widenAddCallOf(action.id, `${action.message}${' '.repeat(600)}`, { graph }, [hold])).toBeNull();
  });

  it('option-only press refuses a naked, retired, declined or replaced held revision/digest', () => {
    const hold = choiceHold();
    const binding = proposalRecord(hold, graph)!;
    const action = press('raise_59', 'Raise Pro price to £59', 'Feature release slips', binding);
    expect(widenAddCallOf(action.id, action.message, { graph })).toBeNull();
    expect(widenAddCallOf(action.id, action.message, { graph }, [])).toBeNull();
    expect(widenAddCallOf(press().id, press().message, { graph }, [hold])).toBeNull();
    expect(widenAddCallOf(action.id, action.message, { graph }, [withoutRiskPreconditionChoice(hold)])).toBeNull();
    const replaced = { ...hold, id: '22222222-2222-4222-8222-222222222222' };
    expect(widenAddCallOf(action.id, action.message, { graph }, [replaced])).toBeNull();
    if (hold.action.kind !== 'apply_proposed_change') throw new Error('the fixture must be a held proposal');
    const changed = { ...hold, action: { ...hold.action, public_message: 'Yes, add a different release risk.' } };
    expect(widenAddCallOf(action.id, action.message, { graph }, [changed])).toBeNull();
  });

  it('option-only labels containing curly quotes and risk names longer than 60 characters remain pressable', () => {
    const option_label = 'Team’s ‘Pro’ release';
    const risk_label = `Team’s feature release slips${' with consequences'.repeat(3)}`;
    const quotedGraph = { nodes: [{ id: 'quoted', kind: 'option', label: option_label }], edges: [] };
    const hold = choiceHold(quotedGraph, risk_label);
    const action = press('quoted', option_label, risk_label, proposalRecord(hold, quotedGraph)!);
    expect(widenAddCallOf(action.id, action.message, { graph: quotedGraph }, [hold])).toMatchObject({
      relies_on: { option_id: 'quoted', option_label }, args: { label: risk_label, affects: [], caused_by: [] },
    });
  });

  it('20k-character adversarial timing input scales below 20 times the 2k input', () => {
    const measure = (text: string) => {
      const start = performance.now();
      for (let count = 0; count < 200; count += 1) chatRiskPreconditionOffersFor('Feature release slips', graph, text);
      return performance.now() - start;
    };
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    const repeated = 'with the next one two three four five six seven ';
    const cases = [
      { shape: 'long-token', short: 'with the next '.padEnd(2_000, 'x'), long: 'with the next '.padEnd(20_000, 'x') },
      { shape: 'repeated-markers', short: repeated.repeat(Math.ceil(2_000 / repeated.length)).slice(0, 2_000),
        long: repeated.repeat(Math.ceil(20_000 / repeated.length)).slice(0, 20_000) },
    ];
    for (const { shape, short, long } of cases) {
      expect(chatRiskPreconditionOffersFor('Feature release slips', graph, long)).toEqual([]);
      measure(short); measure(long);
      const shortMs = median(Array.from({ length: 5 }, () => measure(short)));
      const longMs = median(Array.from({ length: 5 }, () => measure(long)));
      const ratio = longMs / Math.max(shortMs, 0.01);
      process.stdout.write(`${JSON.stringify({ row: 'chat-precondition-20k-scaling', shape, short_ms: shortMs, long_ms: longMs, ratio })}\n`);
      expect(ratio, shape).toBeLessThan(20);
    }
  });
});
