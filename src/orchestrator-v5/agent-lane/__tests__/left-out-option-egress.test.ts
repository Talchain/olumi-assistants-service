/**
 * Q6 under the DL 58e392 scope ruling (8 Oct, #2810 CHANGES_REQUIRED @3b5221c2): when a reply NAMES an option the Run
 * left out, the deterministic correction is appended beside it. Nothing the narrator wrote is removed — no claim parsing,
 * no negation logic. Paul's served bullet (scenario 632b92b9, turn 1) is quoted verbatim; the other texts are arranged.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { type LeftOutRunOption, type RecordedRunOption } from '../../tools/handlers/option-participation.js';
import {
  appendLeftOutOptionCorrections, LEFT_OUT_COPY_REGEXES, leftOutOptionSentence, withLeftOutOptionCorrectionAtEgress,
} from '../left-out-option-egress.js';
import { withShapeOnlyIfItDerives } from '../reply/compose-reply.js';
import { deriveAnswerTextFromShape } from '../../routing/answer-shape.js';

const TEST = { option_id: 'test_54_pro_price', label: 'Test £54 Pro price', reason: 'olumi_proposed' };
const SENT: RecordedRunOption[] = [
  { option_id: 'keep_49', label: 'Keep £49' }, { option_id: 'raise_59', label: 'Raise Pro price to £59' },
];
const GRAPH = { nodes: [...SENT, TEST].map(o => ({ id: o.option_id, kind: 'option', label: o.label })), edges: [] };
const PART = [{ option_id: TEST.option_id, state: 'excluded_olumi_proposed' }];
const PAUL = '- £49 is held as today; £59 and an Olumi-suggested £54 test are included for comparison.';
const LINE = leftOutOptionSentence(TEST);
const opts = { analysisResult: undefined, optionParticipation: PART, graph: GRAPH, requestId: 'q6', exitPath: 'q6_unit' };
const correct = (text: string, excluded: readonly LeftOutRunOption[] = [TEST], sent = SENT) =>
  appendLeftOutOptionCorrections(text, excluded, sent);

describe('Q6: a named left-out option gets its correction; nothing is removed', () => {
  it('RED: Paul’s served bullet stays byte for byte and the correction line follows it once', () => {
    const text = `Current figures.\n${PAUL}`;
    const out = correct(text);
    expect(out.text).toBe(`${text}\n\n${LINE}`);
    expect(out.appended).toBe(1);
    expect(out.optionIds).toEqual([TEST.option_id]);
  });

  it.each([
    'Raise Pro price to £59 was assessed with the £54 test still awaiting your approval.',
    '- ‘Test £54 Pro price’: included for comparison.',
    'The £54 test was included for comparison, not as a recommendation.',
    'The £54 test wasn’t included.',
  ])('every sentence naming the left-out option is KEPT, and the truth is added beside it: %s', text => {
    expect(correct(text).text).toBe(`${text}\n\n${LINE}`);
  });

  it.each([
    'Raise Pro price to £59 was assessed and stayed below the churn limit.',
    'Keep £49 holds today’s price.',
    'At 54 £/subscriber/month (Olumi’s estimate), MRR stays at least that while 273 or more of the 300 stay.',
    'Raise Pro price to £59 was assessed with acquisition costs of £54 per customer.',
    '£54 is in this run too.',
  ])('a text that does not NAME the left-out option is byte-identical: %s', text => {
    expect(correct(text)).toEqual({ text, appended: 0, optionIds: [] });
  });

  it('a longer SENT label containing the left-out label never names it', () => {
    const packaging = { option_id: 'packaging', label: 'Test £54 Pro price incl. revised packaging' };
    const text = 'We analysed ‘Test £54 Pro price incl. revised packaging’.';
    expect(correct(text, [TEST], [...SENT, packaging]).text).toBe(text);
  });

  it('a figure shared with a sent label is not exclusive; the exact left-out label still names it', () => {
    const sent = [...SENT, { option_id: 'other_54', label: 'Keep £54' }];
    expect(correct('The £54 test was included.', [TEST], sent).appended).toBe(0);
    expect(correct('Test £54 Pro price was evaluated.', [TEST], sent).appended).toBe(1);
  });

  it('no left-out option → byte-identical; recorded empty / unrecorded at the egress → the same body object', () => {
    expect(correct(PAUL, []).text).toBe(PAUL);
    for (const participation of [undefined, null, [{ option_id: TEST.option_id, state: 'invented' }], []]) {
      const body = { assistant_text: PAUL };
      expect(withLeftOutOptionCorrectionAtEgress(body, { ...opts, optionParticipation: participation })).toBe(body);
    }
  });

  it('idempotent: a second pass adds nothing (the correction line names the option and is already there)', () => {
    const once = correct(PAUL).text;
    expect(correct(once).text).toBe(once);
  });

  it('two left-out options named → each correction once, in roster order', () => {
    const other = { option_id: 'test_64', label: 'Test £64 Pro price', reason: 'removed' };
    const text = 'We compared the £54 test and the £64 test.';
    expect(correct(text, [TEST, other]).text).toBe(`${text}\n\n${LINE}\n\n${leftOutOptionSentence(other)}`);
  });

  it.each(['Today’s figures.\n', ''])('the correction precedes a trailing Open Questions segment (lead %j)', lead => {
    const questions = 'Questions this model does not answer yet: Does "MRR" get there within 12 months?';
    const text = `${lead}${PAUL}\n\n${questions}`;
    expect(correct(text).text).toBe(`${lead}${PAUL}\n\n${LINE}\n\n${questions}`);
  });
});

describe('Q6 egress carriers', () => {
  it('assistant_text gets its correction; the narrator’s words are a prefix of the result', () => {
    const out = withLeftOutOptionCorrectionAtEgress({ assistant_text: PAUL }, opts);
    expect(out.assistant_text).toBe(`${PAUL}\n\n${LINE}`);
  });

  it.each(['heading', 'view', 'reasoning', 'confirm_step', 'because'] as const)(
    'a provisional view naming the left-out option in %s gets the correction once, after its view', field => {
      const view = { heading: 'Head.', view: 'View.', reasoning: 'Why.', confirm_step: 'Confirm.', because: 'Because.', [field]: 'The £54 test is in this run too.' };
      const out = withLeftOutOptionCorrectionAtEgress({ assistant_text: 'Body.', _agent: { provisional_view: view } }, opts);
      const shown = out._agent.provisional_view as Record<string, string>;
      expect(shown.view).toBe(`${view.view}\n\n${LINE}`);
      for (const f of ['heading', 'reasoning', 'confirm_step', 'because'] as const) expect(shown[f]).toBe(view[f]);
      expect(out.assistant_text).toBe('Body.');
    });

  it('a stale answer shape no longer derives after the append, so the reply ships whole; the sent control keeps it', () => {
    const shape = { headline: 'Current prices.', bullets: [PAUL.slice(2)], detail: '' };
    const body = { assistant_text: deriveAnswerTextFromShape(shape), _answer_shape: shape };
    const corrected = withShapeOnlyIfItDerives(withLeftOutOptionCorrectionAtEgress(body, opts));
    expect(corrected.assistant_text).toContain(LINE);
    expect(corrected).not.toHaveProperty('_answer_shape');
    expect(withShapeOnlyIfItDerives(withLeftOutOptionCorrectionAtEgress(body, { ...opts, optionParticipation: [] }))).toBe(body);
  });

  it('all three exits call the correction; replay is checked before its shape can ride', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route.split('withLeftOutOptionCorrectionAtEgress(').length - 1).toBe(3);
    expect(route).toContain('withLeftOutOptionCorrectionAtEgress(driverGatedReplay, {');
    expect(route).toContain('withLeftOutOptionCorrectionAtEgress(driverEditedView, {');
    expect(route).toContain('withLeftOutOptionCorrectionAtEgress(driverEdited, {');
    expect(route.indexOf('const optionGatedReplay = withLeftOutOptionCorrectionAtEgress(')).toBeLessThan(route.indexOf('return withShapeOnlyIfItDerives(gatedReplay);'));
  });
});

describe('Q6 timing', () => {
  for (const [name, regex] of Object.entries(LEFT_OUT_COPY_REGEXES)) {
    it.each([' '.repeat(20_000), '£54 '.repeat(20_000)])(`${name}: 20k whitespace / figure repeats < 50 ms`, text => {
      regex.lastIndex = 0;
      const start = performance.now();
      if (regex.global) void [...text.matchAll(regex)];
      else regex.test(text);
      const elapsed = performance.now() - start;
      regex.lastIndex = 0;
      expect(elapsed).toBeLessThan(50);
    });
  }
  it('the whole correction scales linearly: 20k → 160k "the £54 test " under 22×', () => {
    const time = (n: number) => { const t = 'the £54 test '.repeat(n); const s = performance.now(); correct(t); return performance.now() - s; };
    time(2_000);
    const small = Math.min(...Array.from({ length: 5 }, () => time(1_540)));
    const large = Math.min(...Array.from({ length: 5 }, () => time(12_310)));
    expect(large / small).toBeLessThan(22);
  });
});
