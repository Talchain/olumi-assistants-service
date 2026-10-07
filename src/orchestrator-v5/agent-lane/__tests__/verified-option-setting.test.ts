import { describe, it, vi } from 'vitest';
import { censusRows, probeRows, integrityRows, seamRows, rawRows, registrationRows, probes, level, assertCell, type Row } from './fixtures/r5-verified-cases.js';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { findStatedAmounts } from '../../../cee/provenance/stated-amounts.js';
import type { CandidateModel } from '../admit-model.js';
import { verifiedOptionSetting } from '../verified-option-setting.js';
import { prepareProvisionalCandidate } from '../runtime/build-model.js';
import { log } from '../../../utils/telemetry.js';

for (const [name, rows] of [
  ['census: generic credits, known under-credits and source refusals', censusRows],
  ['all 44 probes and 12 witness inputs: including each of the 28 FALSE-CREDIT IDs', probeRows],
  ['E/F evidence integrity', integrityRows], ['construction seam and hash controls', seamRows],
  ['unchanged raw outputs and strict-schema compatibility', rawRows], ['registration witnesses', registrationRows],
] as const) {
  describe(name, () => { for (const row of rows) it(row.name, row.run); });
}



const S = 'We could keep the present timetable, open for 4 Saturday sessions each month, or extend weekday opening by 10 hours a week.';
export type R2Case = { name: string; expected: boolean; input: () => { model: CandidateModel; brief: string; option: string; factor: string } };
const clinicCase = (text: string) => {
  const p = probes.find(p => p.id === 'N0')!;
  const model = structuredClone(p.model); const brief = p.brief.replace(S, text);
  const located = brief.indexOf(S);
  const delta = located < 0 ? 0 : located - p.evidence.start;
  level(model, p.option, p.factor).stated_evidence = { ...p.evidence,
    start: p.evidence.start + delta, end: p.evidence.end + delta, amount_start: p.evidence.amount_start + delta,
    option_start: p.evidence.option_start + delta, option_end: p.evidence.option_end + delta };
  return { model, brief, option: p.option, factor: p.factor };
};
/** The credited sentence S replaced by `text`; the model quotes `quote` (offsets are ignored). */
const quoted = (text: string, quote: string) => {
  const i = clinicCase(text); const iv = level(i.model, i.option, i.factor);
  iv.stated_evidence = { ...iv.stated_evidence!, quote, option_quote: quote }; return i;
};
const ownSentence = (text: string) => quoted(text, text);
/** As `ownSentence`, with the drafter's option label rewritten (it may copy the brief's qualifier into the label). */
const relabelled = (text: string, label: string) => {
  const i = ownSentence(text); i.model.options.find(o => o.label === i.option)!.label = label; return { ...i, option: label };
};
/** The served clinic draft with its schema-impossible shape broken, as no strict provider answer can be. */
const malformed = (breakIt: (m: any) => void) => { const i = clinicCase(S); breakIt(i.model); return i; };
const S4 = S.replace('4 Saturday', 'four Saturday');
const setting = (sentence: string, option: string, factor: string, value: number, unit: string, siblings: string[] = []) => {
  const base = structuredClone(probes[0]!.model);
  const amountAt = findStatedAmounts(sentence).find(n => n.magnitude === value)?.index ?? sentence.indexOf('four');
  const template = structuredClone(base.options[1]!);
  template.label = option; template.interventions = [{ ...template.interventions![0]!, factor_label: factor, value, unit,
    stated_evidence: { quote: sentence, start: 0, end: sentence.length, amount_start: amountAt,
      option_quote: sentence, option_start: 0, option_end: sentence.length } }];
  const model: CandidateModel = { ...base,
    options: [template, { ...base.options[0]!, label: 'Continue unchanged' }, ...siblings.map(label => ({ ...base.options[0]!, label }))],
    factors: [{ ...base.factors[0]!, label: factor, unit }],
    links: [], risks: [], outcomes: [], constraints: [],
  };
  return { model, brief: sentence, option, factor };
};
export const r2Cases: R2Case[] = [
  { name: 'R0 unchanged served sentence', expected: true, input: () => clinicCase(S) },
  { name: 'R5 Olumi attribution in previous sentence', expected: false, input: () => clinicCase('Olumi suggested these options in its last reply. ' + S) },
  // ACCEPTED RESIDUAL (DL 7 Oct): copied-list attribution names neither Olumi nor the credited literal.
  { name: 'R6 ACCEPTED RESIDUAL (DL 7 Oct)', expected: true, input: () => clinicCase(S + " That list is copied from the clinic down the road's newsletter, not ours.") },
  { name: 'R7 ceiling repeats literal', expected: false, input: () => clinicCase(S + ' The 4 Saturday sessions are a ceiling, not a target.') },
  { name: 'R8 retraction repeats the 4', expected: false, input: () => clinicCase(S + ' Ignore the 4; we have not decided how many Saturday sessions.') },
  { name: 'R5c directContext source heading', expected: false, input: () => clinicCase('Olumi suggested:\n' + S) },
  { name: 'C source heading without Olumi attribution', expected: false, input: () => clinicCase('Advisor suggested:\n' + S) },
  // A sibling arm must name another option of the model (r2 buddy P1-3), as the drafter's model of this brief would.
  { name: 'G1 Our options are to', expected: true, input: () => setting('Our options are to run 4 Saturday clinics a month or provide remote consultations.', 'Saturday clinics', 'Saturday clinics', 4, 'clinics/month', ['Remote consultations']) },
  { name: 'G2 One option is to', expected: true, input: () => setting('One option is to run 4 Saturday clinics a month.', 'Saturday clinics', 'Saturday clinics', 4, 'clinics/month') },
  { name: 'G3 10 hours each week', expected: true, input: () => setting('Our options are to staff reception for 10 hours each week.', 'Staff reception', 'Reception hours', 10, 'hours/week') },
  { name: 'G4 engineering domain', expected: true, input: () => setting('One option is to hire 3 engineers.', 'Hire engineers', 'Engineers', 3, 'engineers') },
  { name: 'G5 price to GBP39', expected: true, input: () => setting('We will cut the retail price to £39.', 'Retail price', 'Retail price', 39, '£') },
  { name: 'G6 percentage unit', expected: true, input: () => setting('One option is to set the reserve allocation to 15%.', 'Reserve allocation', 'Reserve allocation', 15, '%') },
  { name: 'G7 figure in words', expected: true, input: () => setting('We will run four mobile clinics each month.', 'Mobile clinics', 'Mobile clinics', 4, 'clinics/month') },
  { name: 'G8 sibling uses each week', expected: true, input: () => {
    const i = clinicCase(S.replace('10 hours a week', '10 hours each week'));
    const e = level(i.model, i.option, i.factor).stated_evidence!;
    const quote = S.replace('10 hours a week', '10 hours each week');
    level(i.model, i.option, i.factor).stated_evidence = { ...e, quote, option_quote: quote,
      end: e.start + quote.length, option_end: e.option_start + quote.length }; return i;
  } },
  // The old starter_price branch was deleted. This positive rate is verified by the generic unit reader.
  { name: 'P2-2 positive starter_price with explicit subscriber denominator', expected: true, input: () => setting('One option is to launch the starter tier with a price of £39 per subscriber each month.', 'Launch starter tier', 'Starter price', 39, '£/subscriber/month') },
  { name: 'E wrong model offsets are ignored', expected: true, input: () => { const i = clinicCase(S); Object.assign(level(i.model, i.option, i.factor).stated_evidence!, { start: NaN, end: -1, amount_start: 1e300 }); return i; } },
  { name: 'E quote appears twice', expected: false, input: () => clinicCase(S + '\n\n' + S) },
  { name: 'E normalized duplicate appears twice', expected: false, input: () => clinicCase(S + '\n\n' + S.replace('4 Saturday', '４\t Saturday')) },
  { name: 'E NFKC and whitespace quote location', expected: true, input: () => clinicCase(S.replace('4 Saturday', '４\t Saturday')) },
  { name: 'E paraphrased quote is absent', expected: false, input: () => { const i = clinicCase(S); const iv = level(i.model, i.option, i.factor); iv.stated_evidence = { ...iv.stated_evidence!, quote: S.replace('We could', 'We might') }; return i; } },
  { name: 'N adjacent paragraph repeats literal (outside neighbour rule)', expected: true, input: () => clinicCase(S + '\n\nIgnore the 4 from a different proposal.') },
  { name: 'N you suggested', expected: false, input: () => clinicCase('You suggested these options. ' + S) },
  { name: 'N your suggestion', expected: false, input: () => clinicCase(S + ' This was your suggestion.') },
  { name: 'N your last reply', expected: false, input: () => clinicCase(S + ' This was your last reply.') },
  { name: 'N other number 40 is not literal 4', expected: true, input: () => clinicCase(S + ' The annual limit is 40 sessions.') },
  // An addition is a delta, and a setting cannot borrow an option named only in another clause/sentence.
  { name: 'F add 4 is a delta', expected: false, input: () => setting('One option is to add 4 mobile clinics each month.', 'Mobile clinics', 'Mobile clinics', 4, 'clinics/month') },
  { name: 'O option words in another clause', expected: false, input: () => setting('One option is to run mobile clinics; another proposal uses 4 clinics each month.', 'Mobile clinics', 'Mobile clinics', 4, 'clinics/month') },
  { name: 'O option words in another sentence', expected: false, input: () => { const i = setting('One option is to run 4 clinics each month.', 'Mobile clinics', 'Mobile clinics', 4, 'clinics/month'); i.brief = 'We could run mobile clinics. ' + i.brief; return i; } },
  { name: 'U missing subscriber denominator', expected: false, input: () => setting('One option is to launch the starter tier with a price of £39 each month.', 'Launch starter tier', 'Starter price', 39, '£/subscriber/month') },
  { name: 'F count noun with a rival entity', expected: false, input: () => { const i = setting('One option is to hire 3 engineers.', 'Hire engineers', 'Engineers', 3, 'engineers'); i.model.goal.metric = 'Senior engineers'; return i; } },
  { name: 'O third-party subject inside alternative clause', expected: false, input: () => setting('We could retain our service; their mobile clinics run 4 clinics each month.', 'Mobile clinics', 'Mobile clinics', 4, 'clinics/month') },
  { name: 'P range cannot supply a point', expected: false, input: () => setting('One option is to run 4 to 5 mobile clinics each month.', 'Mobile clinics', 'Mobile clinics', 4, 'clinics/month') },
  { name: 'O distinctive word must not merely be a prefix', expected: false, input: () => setting('One option is to run 4 Mondayish clinics each month.', 'Monday clinics', 'Monday clinics', 4, 'clinics/month') },
  { name: 'U count noun must not merely be a prefix', expected: false, input: () => setting('One option is to hire 3 engineerspecialists.', 'Hire engineers', 'Engineers', 3, 'engineers') },
  { name: 'U wrong period', expected: false, input: () => setting('We will run four mobile clinics each quarter.', 'Mobile clinics', 'Mobile clinics', 4, 'clinics/month') },
  // Q: the other clauses of the credited sentence. Each must be a sibling option arm; a qualifier, an elliptical
  // alternative or an attribution after the setting refuses. Only a range bracketing the figure may follow it.
  { name: 'Q ", at most" bounds the setting', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, at most.') },
  { name: 'Q ", as a ceiling" bounds the setting', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, as a ceiling.') },
  { name: 'Q ", or fewer" bounds the setting', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or fewer.') },
  { name: 'Q ", or 5" is a numeric alternative', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or 5.') },
  { name: 'Q ", or open for 5" is an elliptical alternative', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or open for 5.') },
  { name: 'Q ", or open for 5 Saturday sessions" names no other option', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or open for 5 Saturday sessions.') },
  { name: 'Q ", between 5 and 8" does not bracket the figure', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, between 5 and 8.') },
  { name: 'Q ", but we have not decided" withdraws the setting', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, but we have not decided.') },
  { name: 'Q ", like the clinic next door does" is a benchmark', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, like the clinic next door does.') },
  { name: 'Q Olumi named inside the credited clause', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month as Olumi suggested.') },
  { name: 'Q control: ", and extend weekday opening" is a sibling arm', expected: true, input: () => ownSentence('We could open for 4 Saturday sessions each month, and extend weekday opening by 10 hours a week.') },
  { name: 'Q "or provide remote consultations" names no option of the model', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month or provide remote consultations.') },
  { name: 'Q control: ", between 2 and 6" brackets the figure', expected: true, input: () => ownSentence('We could open for 4 Saturday sessions each month, between 2 and 6.') },
  // r2 buddy (Codex) reproducers and their twins. V: the credited clause may hold only the option's, the factor's and
  // the unit's words plus frame grammar; anything else refuses.
  { name: 'V control: "open for 4 Saturday sessions each month" credits', expected: true, input: () => ownSentence('We could open for 4 Saturday sessions each month.') },
  { name: 'V control: "open for about 4" credits (an approximate point is still the user\'s)', expected: true, input: () => ownSentence('We could open for about 4 Saturday sessions each month.') },
  { name: 'V "up to 4" is a ceiling (buddy P1-1)', expected: false, input: () => ownSentence('We could open for up to 4 Saturday sessions each month.') },
  { name: 'V "as a ceiling" without a comma (buddy P1-1)', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month as a ceiling.') },
  { name: 'V "under 4" is a bound', expected: false, input: () => ownSentence('We could open for under 4 Saturday sessions each month.') },
  { name: 'V "another 4" is a delta', expected: false, input: () => ownSentence('We could open for another 4 Saturday sessions each month.') },
  { name: 'V "according to your estimate" attributes the figure to Olumi (buddy P1-4)', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month according to your estimate.') },
  { name: 'Q ", or open for 5 sessions" names no other option (buddy P1-3)', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or open for 5 sessions.') },
  { name: 'Q ", or use that number as a ceiling" names no other option (buddy P1-3)', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or use that number as a ceiling.') },
  { name: 'Q Olumi named in a sibling arm that names another option', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or keep the present timetable as Olumi suggested.') },
  { name: 'Q ", as the present timetable allows" names an option but is not an arm', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, as the present timetable allows.') },
  { name: 'Q control: ", or keep the present timetable" is a sibling arm', expected: true, input: () => ownSentence('We could open for 4 Saturday sessions each month, or keep the present timetable.') },
  { name: 'N credited "four", neighbour retracts "the 4"', expected: false, input: () => quoted(S4 + ' Ignore the 4; we have not decided.', S4) },
  { name: 'N credited "4", neighbour retracts "the four"', expected: false, input: () => quoted(S + ' Ignore the four; we have not decided.', S) },
  { name: 'N control: credited "four" with no figure in a neighbour credits', expected: true, input: () => quoted(S4, S4) },
  // Independent review r2 (7 Oct) rows, verbatim inputs. A: a bound or delta the drafter copied into the LABEL still refuses.
  { name: 'A1 "up to 4", label "Up to four Saturday sessions"', expected: false, input: () => relabelled('We could open for up to 4 Saturday sessions each month.', 'Up to four Saturday sessions') },
  { name: 'A2 "another 4", label "Another four Saturday sessions"', expected: false, input: () => relabelled('We could open for another 4 Saturday sessions each month.', 'Another four Saturday sessions') },
  { name: 'A3 "under 4", label "Under four Saturday sessions"', expected: false, input: () => relabelled('We could open for under 4 Saturday sessions each month.', 'Under four Saturday sessions') },
  { name: 'A4 "nearly 4", label "Nearly four Saturday sessions"', expected: false, input: () => relabelled('We could open for nearly 4 Saturday sessions each month.', 'Nearly four Saturday sessions') },
  { name: 'A5 "over 4", label "Over four Saturday sessions"', expected: false, input: () => relabelled('We could open for over 4 Saturday sessions each month.', 'Over four Saturday sessions') },
  // B: any second person or "assistant" in the credited paragraph is Olumi (DL 7 Oct: fail-closed).
  { name: 'B1 "These are the options you proposed."', expected: false, input: () => clinicCase('These are the options you proposed. ' + S) },
  { name: 'B2 "You recommended these options."', expected: false, input: () => clinicCase('You recommended these options. ' + S) },
  { name: 'B3 "This list is from your previous answer."', expected: false, input: () => clinicCase('This list is from your previous answer. ' + S) },
  { name: 'B4 "The assistant suggested this list."', expected: false, input: () => clinicCase('The assistant suggested this list. ' + S) },
  { name: 'B5 "Copied from your earlier reply." after the setting', expected: false, input: () => clinicCase(S + ' Copied from your earlier reply.') },
  { name: 'E3 "as you proposed" inside a sibling arm', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or keep the present timetable as you proposed.') },
  // DL 7 Oct (i): a bound in the very next sentence qualifies the setting.
  { name: 'C1 next sentence "At most."', expected: false, input: () => clinicCase(S + ' At most.') },
  { name: 'C2 next sentence "Or fewer."', expected: false, input: () => clinicCase(S + ' Or fewer.') },
  { name: 'C3 next sentence "That number is only a ceiling."', expected: false, input: () => clinicCase(S + ' That number is only a ceiling.') },
  // DL 7 Oct (ii): Olumi named in either of the two paragraphs above. Control: three paragraphs up is outside the window.
  { name: 'D1 "Here is what Olumi proposed last time" one paragraph up', expected: false, input: () => { const i = clinicCase(S); i.brief = 'Here is what Olumi proposed last time\n\n' + i.brief; return i; } },
  { name: 'D2 Olumi named two paragraphs up', expected: false, input: () => { const i = clinicCase(S); i.brief = 'Olumi drafted these options.\n\n' + i.brief; return i; } },
  { name: 'D control: Olumi named three paragraphs up is outside the DL window', expected: true, input: () => { const i = clinicCase(S); i.brief = 'Olumi helped with an earlier decision.\n\nThis one is about clinic opening.\n\n' + i.brief; return i; } },
  // DL 7 Oct (iii): a sibling arm in the same sentence that repeats the credited figure.
  { name: 'E1 arm "and treat 4 as a ceiling"', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or keep the present timetable and treat 4 as a ceiling.') },
  { name: 'K1 arm "instead of the 4"', expected: false, input: () => ownSentence('We could open for 4 Saturday sessions each month, or keep the present timetable instead of the 4.') },
  // DL 7 Oct (iv). ACCEPTED RESIDUAL (DL 7 Oct): a third party as the subject of a prospective sentence, with the
  // drafter copying that third party into the option label. Contrived; documented so a change in it is seen.
  { name: 'H1 ACCEPTED RESIDUAL (DL 7 Oct): third-party prospective sentence, label "Clinic next door Saturday sessions"', expected: true, input: () => relabelled('The clinic next door would open for 4 Saturday sessions each month.', 'Clinic next door Saturday sessions') },
  // DL 7 Oct (v): schema-impossible drafter output refuses (and logs) instead of throwing.
  { name: 'X outcomes absent: no throw, refuses', expected: false, input: () => malformed(m => { delete m.outcomes; }) },
  { name: 'X constraints absent: no throw, refuses', expected: false, input: () => malformed(m => { delete m.constraints; }) },
  { name: 'X goal.metric null: no throw, refuses', expected: false, input: () => malformed(m => { m.goal.metric = null; }) },
];
export const r2Rows: Row[] = r2Cases.map(c => ({ name: c.name, run: () => {
  const i = c.input(), o = i.model.options.find(o => o.label === i.option)!;
  const iv = level(i.model, i.option, i.factor);
  assert.equal(verifiedOptionSetting(i.model, o, iv, i.brief), c.expected);
  assert.equal(level(prepareProvisionalCandidate(i.model, i.brief).candidate, i.option, i.factor).provenance, c.expected ? 'explicit' : 'ai_proposed');
  if (c.name.startsWith('R')) assertCell(i.model, i.brief, i.option, i.factor, c.expected ? 'explicit' : 'ai_proposed');
} }));
/** Scaling uses minima of five, never an absolute millisecond acceptance bar. */
export function scalingRow(verify = verifiedOptionSetting): { small: number; large: number; ratio: number } {
  const sample = (size: number): number => {
    const i = clinicCase('a'.repeat(size) + '\n' + S), o = i.model.options.find(o => o.label === i.option)!;
    const iv = level(i.model, i.option, i.factor); const times: number[] = [];
    verify(i.model, o, iv, i.brief); // warm up both sizes
    for (let k = 0; k < 5; k++) { const t = performance.now(); assert.equal(verify(i.model, o, iv, i.brief), true); times.push(performance.now() - t); }
    return Math.min(...times);
  };
  const small = sample(5000), large = sample(20000); return { small, large, ratio: large / small };
}
r2Rows.push({ name: 'P0 5k to 20k no-full-stop line scaling <8x (min of 5)', run: () => { assert.ok(scalingRow().ratio < 8); } });
/** r2 buddy P0: one quoted sentence of n clauses ("open for 4 hours, " × n). Refused at the sentence cap, linearly. */
export function longSentenceRow(verify = verifiedOptionSetting): { small: number; large: number; ratio: number } {
  const sample = (n: number): number => {
    const i = ownSentence('We could ' + 'open for 4 hours, '.repeat(n) + 'open for 4 Saturday sessions each month.');
    const o = i.model.options.find(o => o.label === i.option)!; const iv = level(i.model, i.option, i.factor); const times: number[] = [];
    verify(i.model, o, iv, i.brief);
    for (let k = 0; k < 5; k++) { const t = performance.now(); assert.equal(verify(i.model, o, iv, i.brief), false); times.push(performance.now() - t); }
    return Math.min(...times);
  };
  const small = sample(278), large = sample(1112); return { small, large, ratio: large / small };
}
r2Rows.push({ name: 'P0b one 5k to 20k sentence of 278 to 1,112 clauses: refused, scaling <8x (min of 5)', run: () => { assert.ok(longSentenceRow().ratio < 8); } });
describe('round 2 general, linear and fail-closed', () => { for (const row of r2Rows) it(row.name, row.run); });
describe('DL 7 Oct (v): a malformed draft refuses and logs; a well-formed refusal does not log', () => {
  const run = (i: ReturnType<typeof clinicCase>): { verified: boolean; logged: boolean } => {
    const spy = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
    try {
      const o = i.model.options.find(o => o.label === i.option)!;
      const verified = verifiedOptionSetting(i.model, o, level(i.model, i.option, i.factor), i.brief);
      return { verified, logged: spy.mock.calls.some(c => (c[0] as { event?: string } | undefined)?.event === 'agent_lane.stated_setting_unverifiable') };
    } finally { spy.mockRestore(); }
  };
  it('X outcomes absent: refuses and logs agent_lane.stated_setting_unverifiable', () => {
    assert.deepEqual(run(malformed(m => { delete m.outcomes; })), { verified: false, logged: true });
  });
  it('X control: R5 (well-formed, refused by the neighbour rule) does not log', () => {
    assert.deepEqual(run(clinicCase('Olumi suggested these options in its last reply. ' + S)), { verified: false, logged: false });
  });
});
