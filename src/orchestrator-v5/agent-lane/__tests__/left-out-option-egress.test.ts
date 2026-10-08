/** Q6: Paul's served narrator words, paraphrases, negation, alias collisions, and the three exit bindings. */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { type LeftOutRunOption, type RecordedRunOption } from '../../tools/handlers/option-participation.js';
import {
  LEFT_OUT_COPY_REGEXES, leftOutOptionSentence, removeLeftOutOptionInclusionClaims,
  withoutLeftOutOptionInclusionClaimsAtEgress,
} from '../left-out-option-egress.js';
import { withShapeOnlyIfItDerives } from '../reply/compose-reply.js';
import { deriveAnswerTextFromShape } from '../../routing/answer-shape.js';

const TEST = { option_id: 'test_54_pro_price', label: 'Test £54 Pro price', reason: 'olumi_proposed' };
const SENT: RecordedRunOption[] = [
  { option_id: 'keep_49', label: 'Keep £49' }, { option_id: 'raise_59', label: 'Raise Pro price to £59' },
];
const GRAPH = { nodes: [...SENT, TEST].map(o => ({ id: o.option_id, kind: 'option', label: o.label })), edges: [] };
const PART = [{ option_id: TEST.option_id, state: 'excluded_olumi_proposed' }];
/** Only this bullet is served verbatim in the brief; the arithmetic/control text below is arranged. */
const PAUL = '- £49 is held as today; £59 and an Olumi-suggested £54 test are included for comparison.';
const LINE = leftOutOptionSentence(TEST);
const opts = { analysisResult: undefined, optionParticipation: PART, graph: GRAPH, requestId: 'q6', exitPath: 'q6_unit' };
const edit = (text: string, excluded: readonly LeftOutRunOption[] = [TEST], sent = SENT) =>
  removeLeftOutOptionInclusionClaims(text, excluded, sent);

describe('Q6 narrator inclusion about an option the Run left out', () => {
  it('RED: Paul’s verbatim bullet goes; correction is once; £49 figures and arithmetic stay untouched', () => {
    const arithmetic = 'At £49, 100 subscribers give £4,900 MRR. £49 × 100 = £4,900.';
    const text = `Current figures.\n${PAUL}\n${arithmetic}`;
    const out = edit(text);
    expect(out.text).not.toContain(PAUL);
    expect(out.text).toContain(arithmetic);
    expect(out.text.split(LINE).length - 1).toBe(1);
    expect(out.removed).toBe(1);
    expect(out.optionIds).toEqual([TEST.option_id]);
    expect(out.text.split('\n').some(l => ['-', '*', '•'].includes(l.trim()))).toBe(false);
    expect(edit(text, [], [...SENT, TEST]).text, 'CONTROL: same words, £54 sent').toBe(text);
  });

  it.each([
    'We also compared the £54 test.',
    'The analysis covers Keep £49, Raise to £59 and Test £54 Pro price.',
    '‘Test £54 Pro price’ was analysed alongside the others.',
    'The £54 test is in this run too.',
  ])('must fire: %s, with its £54-sent byte-identical twin', text => {
    expect(edit(text).text).toBe(LINE);
    expect(edit(text, [], [...SENT, TEST]).text).toBe(text);
  });

  it.each(['option', 'test', 'variant', 'plan', 'tier', 'price', 'offer'])('option noun %s beside an exclusive figure refers', noun => {
    const text = `The £54 ${noun} was assessed.`;
    expect(edit(text).text).toBe(LINE);
    expect(edit(text, [], [...SENT, TEST]).text).toBe(text);
  });

  it.each([
    // r1 referent class: a bare figure without an adjacent label word or option noun is not a referent.
    '£54 is in this run too.',
    'Included for comparison: £59 and £54.',
    'The £54 test wasn’t included.',
    '£54 was left out of this run.',
    'At 54 £/subscriber/month (Olumi’s estimate), MRR stays at least that…',
    '£59 was included for comparison.',
    '£54 was not analysed.',
    "£54 wasn't evaluated.",
    "£54 isn't in this run.",
    "£54 and £59 aren't included.",
    "£54 and £59 weren't tested.",
    '£54 was never assessed.',
    '£54 was excluded from this run.',
    'This comparison was tested without £54.',
    LINE,
    '£54 was left out; £59 was included.',
    '£54 was not included, but £59 was compared.',
  ])('must not fire: %s', text => {
    expect(edit(text)).toEqual({ text, removed: 0, optionIds: [] });
  });

  it('a different clause’s negation does not hide a positive £54 inclusion', () => {
    expect(edit('£59 was not included, but the £54 test was compared.').text).toBe(LINE);
    expect(edit('We haven’t tested the £59 change, and we compared the £54 test.').text).toBe(LINE);
    const trueTwin = 'We compared £59, and we didn’t include £54.';
    expect(edit(trueTwin).text).toBe(trueTwin);
  });

  it.each([
    ['P1-2 review verbatim, superseded by the bare-figure referent rule', '£54 was included for comparison, and £49 was not changed.', false],
    ['P1-2 RED-before: currency subject in the next clause', 'The £54 test was included for comparison, and £49 was not changed.', true],
    ['P1-2 negative first clause with the review’s currency subjects', '£54 was not included, and £59 was compared.', false],
    ['P1-2 negative first clause with an adjacent referent', 'The £54 test was not included, and £59 was compared.', false],
    ['P1-2 RED-before: quoted subject in the next clause', 'The £54 test was included for comparison, and “Keep £49” was not changed.', true],
    ['P1-2 RED-before: numeric subject in the next clause', 'The £54 test was included for comparison, and 49 was not changed.', true],
  ] as const)('%s', (_name, text, mustFire) => {
    expect(edit(text).text).toBe(mustFire ? LINE : text);
    expect(edit(text, [], [...SENT, TEST]).text, '£54-sent twin').toBe(text);
  });

  it.each([';', ':', ', and', ', but', ', while', ', whereas', ', although', ', though', ', yet', ' but', ' whereas'])
    ('P1-2 clause boundary %j keeps another clause’s negation local', boundary => {
      const text = `The £54 test was assessed${boundary} £49 was not changed.`;
      expect(edit(text).text).toBe(LINE);
      expect(edit(text, [], [...SENT, TEST]).text).toBe(text);
      const negative = `The £54 test was not assessed${boundary} £59 was compared.`;
      expect(edit(negative).text).toBe(negative);
      expect(edit(negative, [], [...SENT, TEST]).text).toBe(negative);
    });

  it('P1-3 RED-before: the review’s longer sent label is masked before the excluded-label search', () => {
    const sent = [...SENT, { option_id: 'packaging_54', label: 'Test £54 Pro price with revised packaging' }];
    const text = '‘Test £54 Pro price with revised packaging’ was analysed.';
    expect(edit(text, [TEST], sent).text).toBe(text);
    expect(edit(text, [], [...sent, TEST]).text, '£54-sent twin').toBe(text);
    const repeated = `${text} “TEST £54 PRO PRICE WITH REVISED PACKAGING” was assessed.`;
    expect(edit(repeated, [TEST], sent).text).toBe(repeated);
  });

  it('P1-3 masking is longest-first and quote-folded for every sent-label occurrence', () => {
    const option = { option_id: 'quoted', label: 'Test “Pro” plan', reason: 'removed' };
    const sent = [
      { option_id: 'shorter', label: 'Test “Pro”' },
      { option_id: 'longer', label: 'Test “Pro” plan with revised packaging' },
    ];
    const text = '‘Test "Pro" plan with revised packaging’ was analysed. ‘TEST “PRO” PLAN WITH REVISED PACKAGING’ was assessed.';
    expect(edit(text, [option], sent).text).toBe(text);
    expect(edit(text, [], [...sent, option]).text).toBe(text);
  });

  it.each([
    'Raise Pro price to £59 was assessed with acquisition costs of £54 per customer.',
    'Raise Pro price to £59 was assessed with £54 acquisition cost.',
  ])('P1-4 RED-before: unrelated acquisition arithmetic is not an excluded-option referent: %s', text => {
    expect(edit(text).text).toBe(text);
    expect(edit(text, [], [...SENT, TEST]).text, '£54-sent twin').toBe(text);
  });

  it('P1-4 RED-before: the review’s date is not an excluded-option referent', () => {
    const option = { option_id: 'launch_2026', label: 'Launch in 2026', reason: 'removed' };
    const text = 'Keep £49 was assessed using 2026 market data.';
    expect(edit(text, [option]).text).toBe(text);
    expect(edit(text, [], [...SENT, option]).text, '2026-sent twin').toBe(text);
  });

  it.each([
    'The £54 test was included.',
    'An Olumi-suggested £54 test was included.',
    'The £54 Pro price was analysed.',
    'Test £54 was evaluated.',
    'The £54 carefully-scoped test was assessed.',
    'The £54 regional test was compared.',
  ])('an exclusive figure within two word tokens of a label word or option noun refers: %s', text => {
    expect(edit(text).text).toBe(LINE);
    expect(edit(text, [], [...SENT, TEST]).text).toBe(text);
  });

  it.each([
    'The analysis assessed £54 per customer.',
    'The analysis assessed £54 acquisition cost.',
    'The analysis assessed £54 regional customer test costs.',
    'The analysis assessed an Olumi-suggested £54 figure.',
  ])('a figure without an adjacent option noun or label word is not a referent: %s', text => {
    expect(edit(text).text).toBe(text);
    expect(edit(text, [], [...SENT, TEST]).text).toBe(text);
  });

  it.each([
    'The run includes an Olumi-suggested £54 test.',
    'The analysis covered the £54 test.',
  ])('P1-5 RED-before review verbatim, with sent twin: %s', text => {
    expect(edit(text).text).toBe(LINE);
    expect(edit(text, [], [...SENT, TEST]).text).toBe(text);
  });

  it.each([
    'The run included the £54 test.',
    'The run is including the £54 test.',
    'The run compares the £54 test.',
    'The run is comparing the £54 test.',
    'The run analyses the £54 test.',
    'The run analyzes the £54 test.',
    'The run is analysing the £54 test.',
    'The run is analyzing the £54 test.',
    'The run evaluates the £54 test.',
    'The run is evaluating the £54 test.',
    'The run assesses the £54 test.',
    'The run is assessing the £54 test.',
    'The run covers the £54 test.',
    'The run is covering the £54 test.',
    'The £54 test was considered in this run.',
    'The £54 test was considered as part of the comparison.',
    'The £54 test is part of the analysis.',
    'The £54 test is in this analysis.',
    'The £54 test is in this comparison.',
    'The £54 test was alongside the sent options.',
    'The analysis runs with the £54 test.',
    'The analysis run with the £54 test is complete.',
  ])('inclusion vocabulary and inflections: %s', text => {
    expect(edit(text).text).toBe(LINE);
    expect(edit(text, [], [...SENT, TEST]).text).toBe(text);
  });

  it.each([
    'The £54 test was considered.',
    'The £54 test was considered an interesting suggestion.',
    'Test £54 Pro price could improve retention.',
    'Test £54 Pro price.',
    'The analysis recommends the £54 test.',
    'This comparison needs the £54 test.',
  ])('label words and unrestricted consider* do not supply an inclusion verb: %s', text => {
    expect(edit(text).text).toBe(text);
    expect(edit(text, [], [...SENT, TEST]).text).toBe(text);
  });

  it('a figure shared with a sent label is ambiguous; an exact excluded label still refers to its option', () => {
    const sent = [...SENT, { option_id: 'other_54', label: 'Keep £54' }];
    const ambiguous = '£54 was included for comparison.';
    expect(edit(ambiguous, [TEST], sent).text).toBe(ambiguous);
    expect(edit('Test £54 Pro price was evaluated.', [TEST], sent).text).toBe(LINE);
    // A sent label that would supply the only adjacent option noun is masked before referent search.
    expect(edit('We assessed the £54 Test.', [TEST], [...SENT, { option_id: 'short', label: 'Test' }]).removed).toBe(0);
    // A genuine inclusion verb is not itself an option noun: “tested” is distinct from the label word “Test”.
    expect(edit('We tested £54.').removed).toBe(0);
  });

  it('number and percentage aliases need adjacency and exclusivity; larger numbers and decimals are distinct', () => {
    const percent = { option_id: 'percent', label: 'Test 54% retention', reason: 'removed' };
    expect(edit('The 54% retention test was assessed.', [percent]).text).toBe(leftOutOptionSentence(percent));
    expect(edit('The 54% retention test was assessed.', [percent], [{ option_id: 'shared', label: 'Keep 54% retention' }]).removed).toBe(0);
    const number = { option_id: 'number', label: 'Test 54 seats', reason: 'infeasible' };
    expect(edit('The 54 seats test was tested.', [number]).text).toBe(leftOutOptionSentence(number));
    expect(edit('54% was assessed.', [percent]).removed).toBe(0);
    expect(edit('54 was tested.', [number]).removed).toBe(0);
    for (const text of ['54% was assessed.', '54 was tested.', '£154 test was compared.', '£54.5 test was tested.', '£540 test was included.']) expect(edit(text).text).toBe(text);
  });

  it('quote-folded, case-insensitive exact labels work without a numeric alias', () => {
    const option = { option_id: 'words', label: 'Try “Pro” plan', reason: 'not_analysable' };
    expect(edit('TRY "PRO" PLAN was analyzed.', [option]).text).toBe(leftOutOptionSentence(option));
    const partial = 'Try "Pro" planner was tested.';
    expect(edit(partial, [option]).text).toBe(partial);
  });

  it('negation words in a label do not negate its inclusion, while an actual negative verb does', () => {
    const option = { option_id: 'without', label: 'Expand without debt', reason: 'olumi_proposed' };
    expect(edit('‘Expand without debt’ was analysed alongside the others.', [option]).text).toBe(leftOutOptionSentence(option));
    const negative = '‘Expand without debt’ wasn’t included.';
    expect(edit(negative, [option]).text).toBe(negative);
  });

  it.each(['Plan: Expand', 'Expand, and retain customers', 'Expand but preserve jobs'])
    ('exact labels retain their referent across clause words inside the label: %s', label => {
      const option = { option_id: 'clause_label', label, reason: 'removed' };
      const text = `‘${label}’ was analysed.`;
      expect(edit(text, [option]).text).toBe(leftOutOptionSentence(option));
      expect(edit(text, [], [...SENT, option]).text).toBe(text);
    });

  it.each(['Plan: not analysed', 'Expand, and never compare', 'Test assessed alternatives'])
    ('a referent’s own negation/inclusion words are masked before assertion testing: %s', label => {
      const option = { option_id: 'assertion_label', label, reason: 'removed' };
      const included = `‘${label}’ was assessed.`;
      const neutral = `‘${label}’ remains a suggestion.`;
      expect(edit(included, [option]).text).toBe(leftOutOptionSentence(option));
      expect(edit(neutral, [option]).text).toBe(neutral);
      expect(edit(included, [], [...SENT, option]).text).toBe(included);
      expect(edit(neutral, [], [...SENT, option]).text).toBe(neutral);
    });

  it('drops a whole bullet, retains other bullets, and appends each named option’s reason once', () => {
    const other = { option_id: 'test_64', label: 'Test £64 price', reason: 'removed' };
    const text = `Today’s prices.\n- The £54 test and £64 price were included.\n- £59 was tested.\nWe also compared the £54 test.`;
    const out = edit(text, [TEST, other]);
    expect(out.text).toContain('- £59 was tested.');
    expect(out.text).not.toContain('- The £54 test');
    expect(out.text.split(LINE).length - 1).toBe(1);
    expect(out.text.split(leftOutOptionSentence(other)).length - 1).toBe(1);
    const mixed = edit('- The £54 test was included; the £64 price was left out.', [TEST, other]).text;
    expect(mixed).toContain(LINE);
    expect(mixed).toContain(leftOutOptionSentence(other));
  });

  it('a sentence naming only sent options and its figures pass byte for byte', () => {
    const text = 'Keep £49 was evaluated. Raise Pro price to £59 was included in this comparison.';
    expect(edit(text).text).toBe(text);
  });

  it('idempotent: egress(egress(x)) === egress(x), including already-present correction deduplication', () => {
    const once = withoutLeftOutOptionInclusionClaimsAtEgress({ assistant_text: `${PAUL}\n\n${LINE}` }, opts);
    const twice = withoutLeftOutOptionInclusionClaimsAtEgress(once, opts);
    expect(twice).toBe(once);
    expect(once.assistant_text).toBe(LINE);
    expect(edit(edit(PAUL).text).text).toBe(edit(PAUL).text);
  });

  it.each(['Today’s figures.\n', ''])('correction precedes the trailing Open Questions segment with lead %j', lead => {
    const questions = 'Questions this model does not answer yet: How strong is the price effect?';
    const out = edit(`${lead}${PAUL}\n\n${questions}`).text;
    expect(out.indexOf(LINE)).toBeLessThan(out.indexOf(questions));
    expect(out.endsWith(questions)).toBe(true);
  });

  it('a struck sentence in Open Questions is never restored by the original-segment fallback', () => {
    const out = edit('Body stays.\n\nQuestions this model does not answer yet: We also compared the £54 test.').text;
    expect(out).not.toContain('We also compared the £54 test.');
    expect(out).toContain(LINE);
  });
});

describe('Q6 recorded-set reader and final egress carriers', () => {
  it.each([undefined, null, [{ option_id: TEST.option_id, state: 'invented' }], []])('unrecorded/refused/recorded-empty %j leaves the body by reference', participation => {
    const body = { assistant_text: PAUL };
    expect(withoutLeftOutOptionInclusionClaimsAtEgress(body, { ...opts, optionParticipation: participation })).toBe(body);
  });

  it('kept_olumi_provisional is sent, even if the graph still calls it an Olumi proposal', () => {
    const body = { assistant_text: PAUL };
    expect(withoutLeftOutOptionInclusionClaimsAtEgress(body, { ...opts, graph: {
      ...GRAPH, nodes: GRAPH.nodes.map(n => ({ ...n, proposed_by: 'olumi' })),
    }, optionParticipation: [{ option_id: TEST.option_id, state: 'kept_olumi_provisional', unanalysable_user_option_ids: ['missing'] }] })).toBe(body);
  });

  // Production analysis_result has no input_snapshot. Real stored-fact reader coverage lives in the
  // read-freshness / saved-Explain / runAnalysis rows; do not reintroduce a fixture-only result field here.

  it('P1-1 RED-before: the same-fact recorded-set carrier handles the review’s not_analysable wording', () => {
    const option = { ...TEST, reason: 'not_analysable' };
    const text = 'Test £54 Pro price was analysed';
    const runOptionSet = { leftOut: [option], sent: SENT };
    const out = withoutLeftOutOptionInclusionClaimsAtEgress({ assistant_text: text }, {
      ...opts, analysisResult: {}, optionParticipation: [], runOptionSet,
    });
    expect(out.assistant_text).toBe(leftOutOptionSentence(option));
    const twin = { assistant_text: text };
    expect(withoutLeftOutOptionInclusionClaimsAtEgress(twin, {
      ...opts, analysisResult: {}, optionParticipation: [], runOptionSet: { leftOut: [], sent: [...SENT, TEST] },
    })).toBe(twin);
  });

  it.each(['excluded_infeasible', 'excluded_removed'])('%s uses the generic deterministic exclusion line', state => {
    const out = withoutLeftOutOptionInclusionClaimsAtEgress({ assistant_text: PAUL }, {
      ...opts, optionParticipation: [{ option_id: TEST.option_id, state }],
    });
    expect(out.assistant_text).toBe('‘Test £54 Pro price’ was left out of this comparison.');
  });

  it('an excluded id without a recorded or graph label cannot strike or invent a name', () => {
    const body = { assistant_text: PAUL };
    expect(withoutLeftOutOptionInclusionClaimsAtEgress(body, { ...opts, graph: { nodes: SENT.map(o => ({
      id: o.option_id, kind: 'option', label: o.label,
    })) } })).toBe(body);
  });

  it('provisional-view reasoning is the same edited carrier as assistant_text', () => {
    const body = { assistant_text: 'Today’s figures.', _agent: { provisional_view: { reasoning: PAUL, view: 'Size the price effect.' } } };
    const out = withoutLeftOutOptionInclusionClaimsAtEgress(body, opts);
    expect(out.assistant_text).toBe(body.assistant_text);
    expect(out._agent.provisional_view).toEqual({ reasoning: LINE, view: 'Size the price effect.' });
  });

  it.each(['view', 'confirm_step'] as const)('P1-6 review verbatim in %s follows the superseding bare-figure rule', field => {
    // The r1 referent class intentionally no longer fires on the review’s bare £54 figure.
    const text = '£54 is in this run too, so test the churn assumption.';
    const body = { assistant_text: 'Today’s figures.', _agent: { provisional_view: { [field]: text } } };
    expect(withoutLeftOutOptionInclusionClaimsAtEgress(body, opts)).toBe(body);
    expect(withoutLeftOutOptionInclusionClaimsAtEgress(body, { ...opts, optionParticipation: [] })).toBe(body);
  });

  it.each(['heading', 'view', 'reasoning', 'confirm_step', 'because'] as const)
    ('P1-6 RED-before: every displayed provisional-view string is edited, including %s', field => {
      // provisional-view.ts:161-169 and its sidecar reader enumerate all five displayed strings.
      const text = 'The £54 test is in this run too, so test the churn assumption.';
      const provisional = {
        heading: 'Provisional view', view: 'Size the price effect.', reasoning: 'The churn link is uncertain.',
        confirm_step: 'Check the churn assumption.', because: 'It needs a user figure.', [field]: text,
      };
      const body = { assistant_text: 'Today’s figures.', _agent: { provisional_view: provisional, session_id: 'q6' } };
      const out = withoutLeftOutOptionInclusionClaimsAtEgress(body, opts);
      expect(out.assistant_text).toBe(body.assistant_text);
      expect(out._agent.provisional_view).toEqual({ ...provisional, [field]: LINE });
      expect(out._agent.session_id).toBe('q6');
      expect(withoutLeftOutOptionInclusionClaimsAtEgress(body, { ...opts, optionParticipation: [] }), '£54-sent twin').toBe(body);
      expect(withoutLeftOutOptionInclusionClaimsAtEgress(out, opts), 'sidecar idempotence').toBe(out);
    });

  it('a stale answer shape drops after the strike; a sent option’s deriving shape is retained', () => {
    const shape = { headline: 'Current prices.', bullets: [PAUL.slice(2)], detail: '' };
    const body = { assistant_text: deriveAnswerTextFromShape(shape), _answer_shape: shape };
    const struck = withShapeOnlyIfItDerives(withoutLeftOutOptionInclusionClaimsAtEgress(body, opts));
    expect(struck.assistant_text).not.toContain('£54 test are included');
    expect(struck).not.toHaveProperty('_answer_shape');
    const sent = withShapeOnlyIfItDerives(withoutLeftOutOptionInclusionClaimsAtEgress(body, { ...opts, optionParticipation: [] }));
    expect(sent).toBe(body);
  });

  it('all three existing driver exits apply the exclusion edit; replay is checked before its shape can ride', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route.split('withoutLeftOutOptionInclusionClaimsAtEgress(').length - 1).toBe(3);
    expect(route).toContain('withoutLeftOutOptionInclusionClaimsAtEgress(driverGatedReplay, {');
    expect(route).toContain('withoutLeftOutOptionInclusionClaimsAtEgress(driverEditedView, {');
    expect(route).toContain('withoutLeftOutOptionInclusionClaimsAtEgress(driverEdited, {');
    const replay = route.indexOf('const gatedReplay = withoutLeftOutOptionInclusionClaimsAtEgress(');
    expect(replay).toBeLessThan(route.indexOf('return withShapeOnlyIfItDerives(gatedReplay);'));
  });
});

describe('Q6 regex timings (bounded repetitions)', () => {
  for (const [name, regex] of Object.entries(LEFT_OUT_COPY_REGEXES)) {
    it.each([' '.repeat(20_000), '£54 '.repeat(20_000)])(`${name}: 20k whitespace / figure repeats < 50 ms`, text => {
      regex.lastIndex = 0;
      const start = performance.now();
      if (regex.global) [...text.matchAll(regex)];
      else regex.test(text);
      const elapsed = performance.now() - start;
      regex.lastIndex = 0;
      expect(elapsed).toBeLessThan(50);
    });
  }
});
