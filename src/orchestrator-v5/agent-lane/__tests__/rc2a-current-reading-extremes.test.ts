import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { linkEffectClarificationOnRefusal, type LinkEffectClarificationPending } from '../link-effect-clarification.js';
import { findLinkEffectBounds } from '../link-effect-figures.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../../system-events/link-effect-edit.js';
import { readLinkEffectCurrentAnswer, type LinkEffectClarificationReading } from '../../system-events/link-effect-unit-reading.js';
import { statedRangeSpread } from '../../stated-range-spread.js';

type Json = Record<string, any>;
const scenarioId = '550e8400-e29b-41d4-a716-4466554400a7';
const original = 'Raising prices by £1 will increase gross margin by at least 5%.';
const graph = {
  goal_node_id: 'profit',
  nodes: [
    { id: 'profit', kind: 'goal', label: 'Daily profit' },
    { id: 'price', kind: 'factor', label: 'Prices',
      observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: '£', source: 'user_override' } },
    { id: 'margin', kind: 'factor', label: 'Gross margin',
      observed_state: { value: 0.3, raw_value: 30, cap: 100, unit: '%', source: 'user_override' } },
  ],
  edges: [{ from: 'price', to: 'margin', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.9,
    effect_direction: 'positive', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } }],
};
const effect = (amount: number, amountUnit = 'percentage points') =>
  ({ amount, amount_unit: amountUnit, per_source_change: 1, per_source_change_unit: '£' });
const question = `You said ‘${original}’. What's your best single guess, and the lowest and highest it could plausibly be?`;
const pending = (reading?: 'points' | 'relative'): LinkEffectClarificationPending => linkEffectClarificationOnRefusal({
  scenarioId, graph, message: original, emittedAtIso: new Date().toISOString(),
  action: { from_id: 'price', to_id: 'margin', from_label: 'Prices', to_label: 'Gross margin',
    quote: original, question, refusal: 'unit_mismatch', ...(reading === undefined ? {} : { resolved_reading: reading }) },
})!;
const marker = (quote: string, reading?: 'points' | 'relative', bounds: { lower?: number; upper?: number } = {}): LinkEffectClarificationReading => ({
  current_turn: true, node_id: 'margin', from_id: 'price', to_id: 'margin', from_label: 'Prices', to_label: 'Gross margin',
  quote, answer: quote, source_text: quote, statement_classification: 'asserted',
  ...(reading === undefined ? {} : { reading }), ...bounds,
});
function writer(quote: string, amount: number, reading?: 'points' | 'relative', amountUnit = 'percentage points', bounds: { lower?: number; upper?: number } = {}) {
  const params = { persistedGraph: graph, from: 'price', to: 'margin', effect: effect(amount, amountUnit), quote,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, 'price', 'margin')! },
    clarification: marker(quote, reading, bounds) };
  return applyLinkEffectEdit({ ...params, reading_token: linkEffectReadingToken(params) });
}
function writerWithoutMarker(quote: string, amount: number) {
  const params = { persistedGraph: graph, from: 'price', to: 'margin', effect: effect(amount), quote,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, 'price', 'margin')! } };
  return applyLinkEffectEdit({ ...params, reading_token: linkEffectReadingToken(params) });
}
async function capability(grouped: boolean, quote: string, amount: number, reading?: 'points' | 'relative',
  amountUnit = 'percentage points', bounds: { lower?: number; upper?: number } = {}, carryAsk = true, providerQuote = quote) {
  const store = new ProposalStore();
  const calls: string[] = [];
  const dispatch: InternalDispatch = async path => {
    calls.push(path);
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const ask = carryAsk ? pending(reading) : null;
  if (carryAsk) expect(ask).not.toBeNull();
  const caps = createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { readPendingActions: async () => ask === null ? [] : [ask] });
  const args = { from_label: 'Prices', to_label: 'Gross margin', ...effect(amount, amountUnit), quote: providerQuote, ...bounds };
  const result = await caps.proposeLinkEffect!({ scenario_id: scenarioId, authenticated_user_id: null, request_id: 'rc2a-reading-extremes', user_text: quote },
    grouped ? { links: [args] } : args) as Json;
  return { result, store, calls };
}
function oneRefusal(outcome: Awaited<ReturnType<typeof capability>>, expectedQuestion = question) {
  expect(outcome.result.ok, JSON.stringify(outcome.result)).toBe(false);
  expect(outcome.result.proposal_id).toBeUndefined();
  expect(outcome.store.size()).toBe(0);
  const questions = outcome.result.links_not_accepted === undefined
    ? [outcome.result.question] : outcome.result.links_not_accepted.map((entry: Json) => entry.question);
  expect(questions).toEqual([expectedQuestion]);
  expect(outcome.calls.length).toBeGreaterThan(0);
  expect(outcome.calls.every(path => path.endsWith('/graph'))).toBe(true);
}

describe('RC2a fix 2 current unit reading enforcement', () => {
  it.each([false, true])('P1 current-unit RED: stored points cannot override current relative percent, grouped=%s', async grouped => {
    const current = 'Raising prices by £1 will increase gross margin by 4 relative percent';
    oneRefusal(await capability(grouped, current, 4, 'points'));
  });
  it.each([false, true])('P1 current-unit quote-span RED: provider cannot omit the current relative unit, grouped=%s', async grouped => {
    const providerQuote = 'Raising prices by £1 will increase gross margin by 4';
    const current = `${providerQuote} relative percent`;
    oneRefusal(await capability(grouped, current, 4, 'points', 'percentage points', {}, true, providerQuote));
  });
  it.each([false, true])('the first current statement cannot clip its explicit relative unit, grouped=%s', async grouped => {
    const providerQuote = 'Raising prices by £1 will increase gross margin by 4';
    const current = `${providerQuote} relative percent`;
    oneRefusal(await capability(grouped, current, 4, undefined, 'percentage points', {}, false, providerQuote),
      `You said ‘${providerQuote}’. What's your best single guess, and the lowest and highest it could plausibly be?`);
  });
  it('P1 current-unit RED: canonical writer refuses points against the current relative percent', () => {
    const current = 'Raising prices by £1 will increase gross margin by 4 relative percent';
    expect(writer(current, 4, 'points')).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it.each([false, true])('ambiguous current statements for the same link cannot select the convenient unit, grouped=%s', async grouped => {
    const first = 'Raising prices by £1 will increase gross margin by 4 points.';
    const current = `${first} Raising prices by £1 will increase gross margin by 6 relative percent.`;
    oneRefusal(await capability(grouped, current, 4, 'points', 'percentage points', {}, true, first));
  });
  it.each([false, true])('without a stored ask, repeated current claims for the same link remain refused, grouped=%s', async grouped => {
    const first = 'Raising prices by £1 will increase gross margin by 4 points.';
    const current = `${first} Raising prices by £1 will increase gross margin by 6 relative percent.`;
    oneRefusal(await capability(grouped, current, 4, undefined, 'percentage points', {}, false, first),
      `You said ‘${first}’. What's your best single guess, and the lowest and highest it could plausibly be?`);
  });
  it.each([false, true])('P1 RED reviewer repro: resolved relative + bare 4 + provider points refuses one question, grouped=%s', async grouped => {
    oneRefusal(await capability(grouped, '4', 4, 'relative'));
  });
  it('P1 RED reviewer repro: canonical writer cannot write provider points from bare 4 after resolved relative', () => {
    expect(writer('4', 4, 'relative')).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it('P1 RED: without a resolved reading, a bare 4 cannot inherit the provider-selected points unit', () => {
    expect(readLinkEffectCurrentAnswer(marker('4'), effect(4), '4')).toMatchObject({ ok: false });
    expect(writer('4', 4)).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it.each([false, true])('P1 named fallback RED: current named bare 4 after resolved relative refuses provider points, grouped=%s', async grouped => {
    const quote = 'Raising prices by £1 will increase gross margin by 4';
    oneRefusal(await capability(grouped, quote, 4, 'relative'));
  });
  it('P1 named fallback RED: canonical writer refuses named bare 4 without a resolved points reading', () => {
    const quote = 'Raising prices by £1 will increase gross margin by 4';
    expect(writer(quote, 4, 'relative')).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
    expect(writer(quote, 4)).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it.each([false, true])('P1 RED: bare 4 under resolved relative cannot be written as provider-selected relative percent, grouped=%s', async grouped => {
    oneRefusal(await capability(grouped, '4', 4, 'relative', '%'));
  });
  it('P1 RED: the current percent answer cannot silently switch a resolved points reading to relative', () => {
    expect(readLinkEffectCurrentAnswer(marker('4%', 'points'), effect(4, '%'), '4%')).toMatchObject({ ok: false });
  });
  it('a fresh explicit points answer states its own unit after a previously relative reading', () => {
    expect(writer('4 points', 4, 'relative').kind).toBe('mutated');
  });
  it('a bare current 4 remains writable under the resolved points reading', () => {
    expect(writer('4', 4, 'points').kind).toBe('mutated');
  });
});

describe('RC2a fix 2 first current statement has the same unit and range enforcement', () => {
  const bare = 'Raising prices by £1 will increase gross margin by 4';
  const valid = 'Raising prices by £1 will increase gross margin by 6 points; lowest 2 points; highest 8 points';
  const outside = 'Raising prices by £1 will increase gross margin by 6 points; lowest 7 points; highest 8 points';
  it.each([false, true])('P1 no-ask RED: a first named bare 4 cannot inherit provider points, grouped=%s', async grouped => {
    oneRefusal(await capability(grouped, bare, 4, undefined, 'percentage points', {}, false),
      `You said ‘${bare}’. What's your best single guess, and the lowest and highest it could plausibly be?`);
  });
  it('P1 no-marker RED: direct writer refuses the first named bare 4', () => {
    expect(writerWithoutMarker(bare, 4)).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it.each([false, true])('P1 no-ask RED: a first fully named current triplet uses its literal range, grouped=%s', async grouped => {
    const { result, store } = await capability(grouped, valid, 6, undefined, 'percentage points', {}, false);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const operation = store.get(String(result.proposal_id))!.operations[0]!;
    const params = { persistedGraph: graph, ...(operation.value as Json),
      expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, 'price', 'margin')! } };
    const written = applyLinkEffectEdit({ ...params, reading_token: linkEffectReadingToken(params as never) } as never);
    expect(written.kind, JSON.stringify(written)).toBe('mutated');
    if (written.kind !== 'mutated') return;
    const spread = statedRangeSpread(2, 8, 0.9);
    expect((written.mutatedGraph as Json).edges[0].provenance).toMatchObject({
      stated_effect_lower: 2, stated_effect_upper: 8, stated_effect_std: spread.ok ? spread.std : undefined,
    });
  });
  it('P1 no-marker RED: direct writer uses the first fully named current triplet for spread', () => {
    const written = writerWithoutMarker(valid, 6);
    expect(written.kind, JSON.stringify(written)).toBe('mutated');
    if (written.kind !== 'mutated') return;
    const spread = statedRangeSpread(2, 8, 0.9);
    expect((written.mutatedGraph as Json).edges[0].provenance).toMatchObject({
      stated_effect_lower: 2, stated_effect_upper: 8, stated_effect_std: spread.ok ? spread.std : undefined,
    });
  });
  it('the first named current guess outside its extremes remains refused without any marker', () => {
    expect(writerWithoutMarker(outside, 6)).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
});

describe('RC2a fix 2 current extremes are mandatory in every door', () => {
  const outside = 'Raising prices by £1 will increase gross margin by 6 points; lowest 7 points; highest 8 points';
  it.each([false, true])('P1 current-extremes quote-span RED: the provider quote cannot drop the current extremes, grouped=%s', async grouped => {
    oneRefusal(await capability(grouped, outside, 6, 'points', 'percentage points', {}, true, outside.split(';')[0]!));
  });
  it.each([false, true])('P1 first-current-extremes quote-span RED: without a stored ask, the provider cannot drop extremes, grouped=%s', async grouped => {
    oneRefusal(await capability(grouped, outside, 6, undefined, 'percentage points', {}, false, outside.split(';')[0]!),
      `You said ‘${outside.split(';')[0]}’. What's your best single guess, and the lowest and highest it could plausibly be?`);
  });
  it.each([
    'lowest 7 points',
    'highest 8 points; lowest 7 points',
    'lowest 2 points; lowest 3 points; highest 8 points',
  ])('a provider cannot truncate incomplete or ambiguous current bounds: %s', async suffix => {
    const providerQuote = 'Raising prices by £1 will increase gross margin by 6 points';
    oneRefusal(await capability(false, `${providerQuote}; ${suffix}`, 6, undefined, 'percentage points', {}, false, providerQuote),
      `You said ‘${providerQuote}’. What's your best single guess, and the lowest and highest it could plausibly be?`);
  });
  it.each([false, true])('ambiguous same-link current ranges cannot select a convenient triplet, grouped=%s', async grouped => {
    const first = 'Raising prices by £1 will increase gross margin by 6 points; lowest 2 points; highest 8 points.';
    const current = `${first} Raising prices by £1 will increase gross margin by 6 points; lowest 7 points; highest 9 points.`;
    oneRefusal(await capability(grouped, current, 6, 'points', 'percentage points', {}, true, first));
  });
  it('the canonical writer refuses multiple current claims for the same link', () => {
    const current = 'Raising prices by £1 will increase gross margin by 4 points. Raising prices by £1 will increase gross margin by 6 relative percent.';
    expect(writer(current, 4, 'points')).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it.each([false, true])('a shorter provider quote retains a valid whole-current range through canonical writing, grouped=%s', async grouped => {
    const current = 'Raising prices by £1 will increase gross margin by 6 points; lowest 2 points; highest 8 points';
    const { result, store } = await capability(grouped, current, 6, 'points', 'percentage points', {}, true, current.split(';')[0]!);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const operation = store.get(String(result.proposal_id))!.operations[0]!;
    const params = { persistedGraph: graph, ...(operation.value as Json),
      expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, 'price', 'margin')! } };
    const written = applyLinkEffectEdit({ ...params, reading_token: linkEffectReadingToken(params as never) } as never);
    expect(written.kind, JSON.stringify(written)).toBe('mutated');
    if (written.kind !== 'mutated') return;
    const spread = statedRangeSpread(2, 8, 0.9);
    expect((written.mutatedGraph as Json).edges[0].provenance).toMatchObject({
      source_quote: current, stated_effect_lower: 2, stated_effect_upper: 8, stated_effect_std: spread.ok ? spread.std : undefined,
    });
  });
  it('grouped current statements retain each target range and unit through canonical writing', async () => {
    const groupedGraph = { ...graph, nodes: [...graph.nodes, { id: 'cost', kind: 'factor', label: 'Daily costs',
      observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: '£', source: 'user_override' } }],
    edges: [...graph.edges, { ...graph.edges[0]!, to: 'cost' }] };
    const margin = 'Raising prices by £1 will increase gross margin by 6 points';
    const cost = 'Raising prices by £1 will increase daily costs by £4';
    const current = `${margin}; lowest 2 points; highest 8 points. ${cost}; lowest £1; highest £5`;
    const store = new ProposalStore();
    const dispatch: InternalDispatch = async path => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: groupedGraph,
        graph_hash: computeAnalysisAffectingGraphHash(groupedGraph as never) } };
      throw new Error(`unexpected dispatch ${path}`);
    };
    const caps = createAgentCapabilities(dispatch, store);
    const result = await caps.proposeLinkEffect!({ scenario_id: scenarioId, authenticated_user_id: null,
      request_id: 'grouped-current-scopes', user_text: current }, { links: [
      { from_label: 'Prices', to_label: 'Gross margin', ...effect(6), quote: margin },
      { from_label: 'Prices', to_label: 'Daily costs', ...effect(4, '£'), quote: cost },
    ] }) as Json;
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.not_prepared, JSON.stringify(result)).toBeUndefined();
    expect(store.get(String(result.proposal_id))!.operations).toHaveLength(2);
    let working: unknown = groupedGraph;
    for (const operation of store.get(String(result.proposal_id))!.operations) {
      const value = operation.value as Json;
      const params = { persistedGraph: working, ...value,
        expected: { graph_hash: computeAnalysisAffectingGraphHash(working as never)!,
          edge_token: linkEffectEdgeToken(working, 'price', value.to)! } };
      const written = applyLinkEffectEdit({ ...params, reading_token: linkEffectReadingToken(params as never) } as never);
      expect(written.kind, JSON.stringify(written)).toBe('mutated');
      if (written.kind !== 'mutated') return;
      working = written.mutatedGraph;
    }
    expect((working as Json).edges.map((edge: Json) => edge.provenance)).toMatchObject([
      { natural_effect: { amount_unit: 'percentage points' }, stated_effect_lower: 2, stated_effect_upper: 8 },
      { natural_effect: { amount_unit: '£' }, stated_effect_lower: 1, stated_effect_upper: 5 },
    ]);
  });
  it.each([false, true])('P1 RED exact reviewer repro: named 6 with lowest 7 and highest 8 refuses when provider omits bounds, grouped=%s', async grouped => {
    const outcome = await capability(grouped, outside, 6, 'points');
    oneRefusal(outcome);
    const refusal = outcome.result.links_not_accepted?.[0]?.refusal ?? outcome.result.refusal;
    expect(refusal).toBe('outside_stated_bounds');
  });
  it('P1 RED exact reviewer repro: canonical writer refuses named 6 outside current [7, 8]', () => {
    expect(writer(outside, 6, 'points')).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it.each([
    ['lowest 2 points; highest 8 points', 2, 8],
    ['at the low end 2 points; at the high end 8 points', 2, 8],
    ['lowest it could plausibly be is 2 points; highest it could plausibly be is 8 points', 2, 8],
  ] as const)('P1 RED: common detector attaches both current extremes in %s', (suffix, lower, upper) => {
    expect(findLinkEffectBounds(`Raising prices by £1 will increase gross margin by 6 points; ${suffix}`))
      .toMatchObject([{ direction: 'lower', inclusive: true, amount: { magnitude: lower } },
        { direction: 'upper', inclusive: true, amount: { magnitude: upper } }]);
  });
  it.each([false, true])('P1 RED: provider lower/upper disagreeing with named current [2, 8] refuse, grouped=%s', async grouped => {
    const quote = 'Raising prices by £1 will increase gross margin by 6 points; lowest 2 points; highest 8 points';
    oneRefusal(await capability(grouped, quote, 6, 'points', 'percentage points', { lower: 3, upper: 9 }));
  });
  it('P1 RED: writer refuses provider bounds disagreeing with the current named extremes', () => {
    const quote = 'Raising prices by £1 will increase gross margin by 6 points; lowest 2 points; highest 8 points';
    expect(writer(quote, 6, 'points', 'percentage points', { lower: 3, upper: 9 }))
      .toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it.each([false, true])('P1 RED: named current [2, 8] supplies the stated range when provider omits it, grouped=%s', async grouped => {
    const quote = 'Raising prices by £1 will increase gross margin by 6 points; lowest 2 points; highest 8 points';
    const { result, store } = await capability(grouped, quote, 6, 'points');
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const operation = store.get(String(result.proposal_id))!.operations[0]!;
    const params = { persistedGraph: graph, ...(operation.value as Json),
      expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, 'price', 'margin')! } };
    const written = applyLinkEffectEdit({ ...params, reading_token: linkEffectReadingToken(params as never) } as never);
    expect(written.kind, JSON.stringify(written)).toBe('mutated');
    if (written.kind !== 'mutated') return;
    const spread = statedRangeSpread(2, 8, 0.9);
    expect((written.mutatedGraph as Json).edges[0].provenance).toMatchObject({
      stated_effect_lower: 2, stated_effect_upper: 8, stated_effect_std: spread.ok ? spread.std : undefined,
    });
  });
  it('P1 RED: short low/high-end terms produce their current range without provider bounds', () => {
    const quote = '6 points; at the low end 2 points; at the high end 8 points';
    const spread = statedRangeSpread(2, 8, 0.9);
    expect(readLinkEffectCurrentAnswer(marker(quote, 'points'), effect(6), quote))
      .toEqual({ ok: true, guess: 6, lower: 2, upper: 8, std: spread.ok ? spread.std : undefined });
  });
  it.each([false, true])('P1 named-negative RED: a current decrease preserves -6 inside current [-8, -2], grouped=%s', async grouped => {
    const quote = 'Raising prices by £1 will decrease gross margin by 6 points; lowest -8 points; highest -2 points';
    const { result } = await capability(grouped, quote, -6, 'points');
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
  it('P1 named-negative RED: the current target decrease, independently of the source rise, signs the current range', () => {
    const quote = 'Raising prices by £1 will decrease gross margin by 6 points; lowest -8 points; highest -2 points';
    const spread = statedRangeSpread(-8, -2, 0.9);
    expect(readLinkEffectCurrentAnswer(marker(quote, 'points'), effect(-6), quote))
      .toEqual({ ok: true, guess: -6, lower: -8, upper: -2, std: spread.ok ? spread.std : undefined });
  });
  it('named-negative sign control: a current source decrease cannot negate the target increase', () => {
    const quote = 'Lowering prices by £1 will increase gross margin by 6 points; lowest 2 points; highest 8 points';
    const spread = statedRangeSpread(2, 8, 0.9);
    expect(readLinkEffectCurrentAnswer(marker(quote, 'points'), { ...effect(6), per_source_change: -1 }, quote))
      .toEqual({ ok: true, guess: 6, lower: 2, upper: 8, std: spread.ok ? spread.std : undefined });
  });
});
