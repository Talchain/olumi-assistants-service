import { describe, expect, it } from 'vitest';
import { statedRangeSpread } from '../../stated-range-spread.js';
import { linkEffectFloorFromStatement, linkEffectFloorQuestion, type LinkEffectFloor } from '../../agent-lane/link-effect-lower-bound.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { boundedLinkEffectText, findLinkEffectBounds, hasLinkEffectRange } from '../../agent-lane/link-effect-figures.js';
import { linkEffectQuoteContextMiss, linkEffectStatementClassification, linkEffectStatementNamesEndpoints, linkEffectTheUserStated } from '../../agent-lane/stated-by-user.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken, type ApplyLinkEffectEditParams } from '../link-effect-edit.js';
import { prepareLinkEffectUnitReadings, readLinkEffectClarificationAnswer, readLinkEffectCurrentFloorAnswer, type LinkEffectClarificationReading } from '../link-effect-unit-reading.js';

const graph = {
  goal_node_id: 'profit',
  nodes: [
    { id: 'profit', kind: 'goal', label: 'Daily profit' },
    { id: 'price', kind: 'factor', label: 'Café price',
      observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: '£', source: 'user_override' } },
    { id: 'margin', kind: 'factor', label: 'Gross margin',
      observed_state: { value: 0.3, raw_value: 30, cap: 100, unit: '%', source: 'user_override' } },
  ],
  edges: [{ from: 'price', to: 'margin', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.9,
    effect_direction: 'positive', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } }],
};
const quote = 'Raising the café price by £1 will increase gross margin by 5%.';
const effect = { amount: 5, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£' };
const clarification = { node_id: 'margin', quote, answer: 'percentage points', from_id: 'price', to_id: 'margin',
  statement_classification: 'asserted' as const, source_text: quote };
const boundParaphrases = [
  'at least 5%', 'at least +5%', 'no less than 5%', 'at minimum 5%', 'a minimum of 5%',
  'minimum of 5%', 'upwards of 5%', 'more than 5%', 'over 5%', '5% or more', '+5% or more',
  'no more than 5%', 'at most 5%', 'up to 5%', '5% or less', 'a maximum of 5%',
  'less than 5%', 'under 5%', 'no greater than 5%',
] as const;
const params = (marker: LinkEffectClarificationReading | null = clarification): ApplyLinkEffectEditParams => {
  const reading = { persistedGraph: graph, from: 'price', to: 'margin', effect, quote,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, 'price', 'margin')! },
    ...(marker !== null ? { clarification: marker } : {}),
  };
  return { ...reading, reading_token: linkEffectReadingToken(reading) };
};

describe('same-endpoint points answer bound into canonical approval', () => {
  it('F1d RED: a legacy approval marker missing the original assertion context cannot write', () => {
    const shown = params({ node_id: 'margin', quote, answer: 'percentage points' });
    expect(applyLinkEffectEdit(shown)).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it.each([
    ['at least 5%', 'lower', true], ['no less than 5%', 'lower', true], ['5% or more', 'lower', true],
    ['+5 points or more', 'lower', true],
    ['more than 5%', 'lower', false], ['over 5%', 'lower', false], ['above 5%', 'lower', false],
    ['at most 5%', 'upper', true], ['no more than 5%', 'upper', true], ['5% or less', 'upper', true],
    ['less than 5%', 'upper', false], ['under 5%', 'upper', false], ['below 5%', 'upper', false],
  ] as const)('the shared detector records %s as a %s bound, inclusive=%s', (bound, direction, inclusive) => {
    const boundedQuote = `Raising the café price by £1 will increase gross margin by ${bound}.`;
    expect(findLinkEffectBounds(boundedQuote)).toMatchObject([{ direction, inclusive, amount: { magnitude: 5 } }]);
  });

  it.each([
    ['I do not believe this claim: ', 'denied'],
    ['Can we assume this claim: ', 'question'],
    ['Imagine this claim: ', 'hypothetical'],
    ['According to our adviser: ', 'reported'],
    ['Our adviser said: ', 'reported'],
    ['Our adviser said this and I agree: ', 'asserted'],
    ['', 'asserted'],
  ] as const)('the whole enclosing statement classifies %j as %s', (lead, classification) => {
    const enclosing = `${lead}${quote}`;
    expect(linkEffectStatementClassification(quote, enclosing)).toBe(classification);
  });

  it('causal conditions remain assertions and attached no-less/no-more bounds do not negate them', () => {
    const own = 'If the café price rises by £1, gross margin will increase by no less than 5 points.';
    expect(linkEffectStatementClassification(own, own)).toBe('asserted');
    const baseline = 'Current gross margin is no more than 30%, and raising the café price by £1 will increase gross margin by 5%.';
    expect(linkEffectStatementClassification(quote, `${baseline}\n${quote}`)).toBe('asserted');
    expect(linkEffectQuoteContextMiss(baseline, baseline)).toBeNull();
  });

  it('the binder endpoint rule distinguishes the claimed churn link from gross margin', () => {
    const churn = 'Raising the café price by £1 will increase monthly churn by at least 1 point.';
    expect(linkEffectStatementNamesEndpoints(churn, { source: 'Café price', target: 'Monthly churn' })).toBe(true);
    expect(linkEffectStatementNamesEndpoints(churn, { source: 'Café price', target: 'Gross margin' })).toBe(false);
  });

  it.each(boundParaphrases)('RC2 review: %s is a bound to carry, never a stated point or a denial', bound => {
    const boundedQuote = `Raising the café price by £1 will increase gross margin by ${bound}.`;
    expect(boundedLinkEffectText(boundedQuote), boundedQuote).toBeDefined();
    expect(hasLinkEffectRange(boundedQuote), boundedQuote).toBe(true);
    expect(linkEffectQuoteContextMiss(boundedQuote, boundedQuote), boundedQuote).toBeNull();
    expect(linkEffectTheUserStated(boundedQuote, effect,
      { source: 'Café price', target: 'Gross margin' },
      { quantities: ['Café price', 'Gross margin'], target_units: ['%'] }), boundedQuote).toBe('unclear_figure');
    const marker = { ...clarification, quote: boundedQuote, source_text: boundedQuote };
    expect(prepareLinkEffectUnitReadings(graph, 'price', 'margin', effect, boundedQuote, { clarification: marker }).ask,
      boundedQuote).toBeDefined();
    const approved = { ...params(), quote: boundedQuote, clarification: marker };
    expect(applyLinkEffectEdit({ ...approved, reading_token: linkEffectReadingToken(approved) }), boundedQuote)
      .toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it.each(['5 percentage points or more', 'no less than 5 points'])(
    'RC2 reviewer reproduction: increase gross margin by %s cannot license exactly 5', bound => {
      const boundedQuote = `Raising the café price by £1 will increase gross margin by ${bound}.`;
      expect(boundedLinkEffectText(boundedQuote)).toBeDefined();
      expect(linkEffectQuoteContextMiss(boundedQuote, boundedQuote)).toBeNull();
      expect(linkEffectTheUserStated(boundedQuote, effect,
        { source: 'Café price', target: 'Gross margin' },
        { quantities: ['Café price', 'Gross margin'], target_units: ['%'] })).toBe('unclear_figure');
    },
  );

  it('a points-only reply preserves the question and cannot write a stored figure', () => {
    expect(prepareLinkEffectUnitReadings(graph, 'price', 'margin', effect, quote, { clarification }).ask).toBeDefined();
    expect(applyLinkEffectEdit(params())).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('the existing bare-percent question and refusal remain unchanged without an answer marker', () => {
    const reading = prepareLinkEffectUnitReadings(graph, 'price', 'margin', effect, quote);
    expect(reading.ask).toContain('5-point rise');
    expect(reading.ask).toContain('5% of today');
    expect(applyLinkEffectEdit(params(null))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it.each([
    { ...clarification, node_id: 'price' },
    { ...clarification, node_id: 'another-link-target' },
    { ...clarification, quote: 'Invented replacement words.' },
    { ...clarification, answer: 'relative' },
    { ...clarification, answer: 'perhaps percentage points' },
    { ...clarification, answer: 'one percentage point' },
    { ...clarification, answer: 'five percentage points' },
  ])('a stored statement is never licensed by its answer: %j', marker => {
    expect(applyLinkEffectEdit(params(marker))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('changing or omitting the answer marker invalidates the approval token', () => {
    const approved = params();
    expect(applyLinkEffectEdit({ ...approved, clarification: { ...clarification, answer: 'relative' } })).toMatchObject({
      kind: 'refused', reason: 'reading_not_confirmed',
    });
    expect(applyLinkEffectEdit({ ...approved, clarification: undefined })).toMatchObject({ kind: 'refused', reason: 'reading_not_confirmed' });
  });

  it.each(['at least', 'at least +', 'no less than', 'more than', 'at most'])('the %s bound stays refused even after an explicit points answer', bound => {
    const boundedQuote = `Raising the café price by £1 will increase gross margin by ${bound} 5%.`;
    const approved = { ...params(), quote: boundedQuote, clarification: { ...clarification, quote: boundedQuote, source_text: boundedQuote } };
    const reading = { ...approved, reading_token: linkEffectReadingToken(approved) };
    expect(applyLinkEffectEdit(reading)).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('a bounded current level cannot make a stored effect writable through a points-only reply', () => {
    const baselineQuote = 'Current gross margin is at least 30%, and raising the café price by £1 will increase gross margin by 5%.';
    const approved = { ...params(), quote: baselineQuote, clarification: { ...clarification, quote: baselineQuote, source_text: baselineQuote } };
    expect(applyLinkEffectEdit({ ...approved, reading_token: linkEffectReadingToken(approved) }).kind).toBe('refused');
  });

  it.each(['higher', 'lower', 'extra'])('recognizes the %s comparative as a change bound rather than a current level', comparative => {
    const boundedQuote = comparative === 'extra'
      ? 'Raising the café price by £1 leaves gross margin with at least 5 extra percentage points.'
      : `Raising the café price by £1 leaves gross margin at least 5 percentage points ${comparative}.`;
    expect(boundedLinkEffectText(boundedQuote)).toBe('at least 5');
    expect(hasLinkEffectRange(boundedQuote)).toBe(true);
  });

  it.each(['higher', 'lower', 'extra'])('a %s comparative bound cannot become a canonical size after choosing points', comparative => {
    const boundedQuote = `Raising the café price by £1 leaves gross margin at least 5% ${comparative}.`;
    const approved = { ...params(), quote: boundedQuote,
      clarification: { ...clarification, quote: boundedQuote, source_text: boundedQuote },
      ...(comparative === 'lower' ? { effect: { ...effect, amount: -5 }, reversal: { from: 'positive' as const, to: 'negative' as const } } : {}),
    };
    const result = applyLinkEffectEdit({ ...approved, reading_token: linkEffectReadingToken(approved) });
    expect(result).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
});


const floor: LinkEffectFloor = { from_id: 'price', to_id: 'margin', value: 1, unit: 'percentage points', reading: 'points',
  words: 'at least 1 point', per_source_change: 1, per_source_change_unit: '£', reading_answer: 'points',
  source_quote: "This price increase will raise gross margin by at least 1%.", from_label: 'Café price', target_label: 'Gross margin' };
function currentWrite(answer: string, amount: number, extra: Partial<LinkEffectClarificationReading> = {}) {
  const shown = { ...params(null), quote: answer, effect: { ...effect, amount }, clarification: {
    node_id: 'margin', from_id: 'price', to_id: 'margin', current_turn: true as const, statement_classification: 'asserted' as const,
    source_text: answer, quote: answer, answer, reading: 'points' as const, ...extra,
  } };
  return applyLinkEffectEdit({ ...shown, reading_token: linkEffectReadingToken(shown) });
}

describe('RC2a current-turn-only canonical figures', () => {
  it('a short current guess in the resolved points reading writes its own figure', () => {
    const result = currentWrite('2', 2);
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect((result.mutatedGraph as typeof graph).edges[0]!.provenance).toMatchObject({ source_quote: '2', natural_effect: {
      amount: 2, amount_unit: 'percentage points', per_source_change: 1,
    } });
  });

  it('a recorded floor stays context while the current guess, lowest and highest supply spread at 0.9', () => {
    const answer = '2, lowest 0.5, highest 3';
    const result = currentWrite(answer, 2, { floor, upper: 3 });
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const spread = statedRangeSpread(0.5, 3, 0.9);
    expect(spread.ok).toBe(true);
    const provenance = (result.mutatedGraph as typeof graph).edges[0]!.provenance;
    expect(provenance).toMatchObject({ source_quote: answer,
      natural_effect: { amount: 2, per_source_change: 1 }, stated_effect_lower: 0.5, stated_effect_upper: 3,
      stated_effect_std: spread.ok ? spread.std : undefined });
    expect(provenance).not.toHaveProperty('stated_effect_floor');
  });

  it('a current guess alone is a point and carries no recorded floor or invented range', () => {
    const result = currentWrite('2 points', 2, { floor });
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const provenance = (result.mutatedGraph as typeof graph).edges[0]!.provenance;
    expect(provenance).toMatchObject({ source_quote: '2 points', natural_effect: { amount: 2 } });
    expect(provenance).not.toHaveProperty('stated_effect_floor');
    expect(provenance).not.toHaveProperty('stated_effect_upper');
    expect(provenance).not.toHaveProperty('stated_effect_std');
  });

  it('a full current statement writes only its current point without carrying a recorded floor or range', () => {
    const result = currentWrite('Raising the café price by £1 will increase gross margin by 2 points.', 2, { floor });
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const provenance = (result.mutatedGraph as typeof graph).edges[0]!.provenance;
    expect(provenance).toMatchObject({ source_quote: 'Raising the café price by £1 will increase gross margin by 2 points.',
      natural_effect: { amount: 2, per_source_change: 1 } });
    expect(provenance).not.toHaveProperty('stated_effect_floor');
    expect(provenance).not.toHaveProperty('stated_effect_upper');
    expect(provenance).not.toHaveProperty('stated_effect_std');
  });

  it('only a full current source figure supplies a multi-unit denominator; the recorded floor cannot validate it', () => {
    const quote = 'Raising the café price by £2 will increase gross margin by 2 points.';
    const marker: LinkEffectClarificationReading = { node_id: 'margin', from_id: 'price', to_id: 'margin', quote, answer: quote,
      source_text: quote, current_turn: true, statement_classification: 'asserted', reading: 'points', floor: { ...floor, per_source_change: 2 } };
    const statement = { ...effect, amount: 2, per_source_change: 2 };
    expect(readLinkEffectCurrentFloorAnswer(marker, statement, quote, { source: 'Café price', target: 'Gross margin' })).toEqual({ ok: true, guess: 2 });
    expect(readLinkEffectCurrentFloorAnswer({ ...marker, quote: '2 points', answer: '2 points', source_text: '2 points' }, statement, '2 points').ok).toBe(false);
    expect(readLinkEffectCurrentFloorAnswer({ ...marker, floor }, statement, quote, { source: 'Café price', target: 'Gross margin' }))
      .toEqual({ ok: true, guess: 2 });
  });

  it('a floor from another link cannot refuse a fully named current statement', () => {
    const result = currentWrite('Raising the café price by £1 will increase gross margin by 2 points.', 2,
      { floor: { ...floor, to_id: 'another_target' } });
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect((result.mutatedGraph as typeof graph).edges[0]!.provenance).not.toHaveProperty('stated_effect_floor');
  });

  it.each(['points', 'relative', 'at least 2 points', 'I reject this claim: 2 points', 'According to our adviser: 2 points'])(
    'no current best guess in %j can size the link', answer => {
      expect(currentWrite(answer, 2, { floor }).kind).toBe('refused');
    });

  it('current guess cannot borrow the stored source denominator', () => {
    const c: LinkEffectClarificationReading = { node_id: 'margin', from_id: 'price', to_id: 'margin', quote: '2 points', answer: '2 points',
      source_text: '2 points', current_turn: true, statement_classification: 'asserted', reading: 'points' };
    expect(readLinkEffectClarificationAnswer(c, { ...effect, amount: 2, per_source_change: 4.7 }, '2 points')).toBe(false);
  });

  it('mixed normalized/raw option frames do not derive a source change for a floor', () => {
    const mixed = structuredClone(graph) as Record<string, any>;
    mixed.nodes[1].observed_state = { value: 0.3, cap: 10, unit: '£', source: 'user_override' };
    mixed.nodes.push({ id: 'raise', kind: 'option', label: 'Raise price', interventions: { price: { raw_value: 5, source: 'user_specified' } } });
    const recorded = linkEffectFloorFromStatement(mixed, 'price', 'margin', floor.source_quote!, { ...effect, amount: 1, per_source_change: 4.7 }, 'percentage points');
    expect(recorded).toMatchObject({ value: 1, per_source_change: 1 });
    expect(linkEffectFloorQuestion(recorded!)).toBe(`You said ‘${floor.source_quote}’. What's your best single guess, and the lowest and highest it could plausibly be?`);
  });

  it('RC2a class MUTANT: a stored floor getter cannot reach writer validation or spread', () => {
    const unreadableFloor = { ...floor, get value(): number { throw new Error('stored floor reached the writer'); } };
    let result: ReturnType<typeof currentWrite> | undefined;
    expect(() => { result = currentWrite('2 points', 2, { floor: unreadableFloor }); }).not.toThrow();
    expect(result?.kind).toBe('mutated');
    if (result?.kind !== 'mutated') return;
    expect((result.mutatedGraph as typeof graph).edges[0]!.provenance).not.toHaveProperty('stated_effect_floor');
  });
});
