/** Q6: Paul's served narrator words, paraphrases, negation, alias collisions, and the three exit bindings. */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { RunInputSnapshotSchema } from '@talchain/schemas/orchestrator';
import { runOptionSetForCopy, type LeftOutRunOption, type RecordedRunOption } from '../../tools/handlers/option-participation.js';
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
    '£54 is in this run too.',
    'Included for comparison: £59 and £54.',
  ])('must fire: %s, with its £54-sent byte-identical twin', text => {
    expect(edit(text).text).toBe(LINE);
    expect(edit(text, [], [...SENT, TEST]).text).toBe(text);
  });

  it.each([
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
    expect(edit('£59 was not included, but £54 was compared.').text).toBe(LINE);
    expect(edit('We haven’t tested the £59 change, and we compared the £54 test.').text).toBe(LINE);
    const trueTwin = 'We compared £59, and we didn’t include £54.';
    expect(edit(trueTwin).text).toBe(trueTwin);
  });

  it('a figure shared with a sent label is ambiguous; an exact excluded label still refers to its option', () => {
    const sent = [...SENT, { option_id: 'other_54', label: 'Keep £54' }];
    const ambiguous = '£54 was included for comparison.';
    expect(edit(ambiguous, [TEST], sent).text).toBe(ambiguous);
    expect(edit('Test £54 Pro price was evaluated.', [TEST], sent).text).toBe(LINE);
    expect(edit('We tested £54.', [TEST], [...SENT, { option_id: 'short', label: 'Test' }]).text).toBe(LINE);
  });

  it('bare number and percentage referents are exclusive too; larger numbers and decimals are distinct', () => {
    const percent = { option_id: 'percent', label: 'Test 54% retention', reason: 'removed' };
    expect(edit('54% was assessed.', [percent]).text).toBe(leftOutOptionSentence(percent));
    expect(edit('54% was assessed.', [percent], [{ option_id: 'shared', label: 'Keep 54% retention' }]).removed).toBe(0);
    const number = { option_id: 'number', label: 'Test 54 seats', reason: 'infeasible' };
    expect(edit('54 was tested.', [number]).text).toBe(leftOutOptionSentence(number));
    for (const text of ['£154 was compared.', '£54.5 was tested.', '£540 was included.']) expect(edit(text).text).toBe(text);
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

  it('drops a whole bullet, retains other bullets, and appends each named option’s reason once', () => {
    const other = { option_id: 'test_64', label: 'Test £64 price', reason: 'removed' };
    const text = `Today’s prices.\n- £54 and £64 were included.\n- £59 was tested.\nWe also compared £54.`;
    const out = edit(text, [TEST, other]);
    expect(out.text).toContain('- £59 was tested.');
    expect(out.text).not.toContain('- £54');
    expect(out.text.split(LINE).length - 1).toBe(1);
    expect(out.text.split(leftOutOptionSentence(other)).length - 1).toBe(1);
    const mixed = edit('- £54 was included; £64 was left out.', [TEST, other]).text;
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

  it('the existing snapshot schema supplies the Run’s complete exclusions and sent-label collision control', () => {
    const snapshot = RunInputSnapshotSchema.parse({ snapshot_version: 1, sent_digest: 'a'.repeat(64), goal: null,
      options: SENT.map(o => ({ ...o, settings: [] })), options_not_sent: [TEST], factors: [], constraints: [], links: [] });
    const set = runOptionSetForCopy({ input_snapshot: snapshot }, undefined, GRAPH);
    expect(set).toEqual({ leftOut: [TEST], sent: SENT });
    expect(withoutLeftOutOptionInclusionClaimsAtEgress({ assistant_text: PAUL }, { ...opts,
      analysisResult: { input_snapshot: snapshot }, optionParticipation: undefined }).assistant_text).toBe(LINE);
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
