/**
 * ⭐ S-A REPLY SHAPE v1 (lane COPY-SHAPE, DL 0fd71f, 7 Oct 2026): the composer's contract, against Paul's words.
 *
 * Paul (prod test 7 Oct, scenario 6582edbc): "The coaching copy has got very long again. It was a better length before with
 * the three bullets as a construct." Detail belongs under progressive disclosure; every model follows one guideline,
 * enforced deterministically.
 *
 * ROWS FROM PAUL'S SESSION (#1, #3, #5, #13). Their words are the VERBATIM FRAGMENTS the forensics recorded from
 * `v5_conversation_turns` (`inflight/paul-prod-test-6582edbc-forensics.md` §2, D-03, D-12, D-14), joined in order with
 * nothing added. They are fragments, not the full rows (this lane does not read the shared database): they test the
 * reply's STRUCTURE (sentences, questions, the questions segment), never its wording.
 *
 * CORPUS ROWS: every served reply in the committed fixtures (agent-lane and orchestrator-v5 fixture folders) plus AI
 * Quality's 17 real gpt-5.6-terra replies (`compose/__tests__/fixtures/leader-gate-real-replies.json`). Text from outside
 * this author's head.
 */
import { RUN_RESULT_READY_TEXT } from '../../run-explanation.js';
import { chanceGoalDeadlineAsk, chanceGoalSentence } from '../../../goal-target/goal-kind.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scalingRatio } from '../../../../../tests/helpers/scaling-ratio.js';
import {
  composeReplyShape, sentencesOf, sentenceMultiset, REPLY_FACE_MAX_BULLETS, REPLY_SHAPE_INSTRUCTION,
  type ReplyComposition, type FaceObligation,
} from '../compose-reply.js';
import { deriveAnswerTextFromShape } from '../../../routing/answer-shape.js';
import { openQuestionsSegment, textAtRest } from '../../decision-input-ask.js';

const face = (c: ReplyComposition): string[] => (c.shape === null ? [] : [c.shape.headline, ...c.shape.bullets]);
/** Every sentence of `original` is in `shipped`, verbatim (bullet markers aside). */
const everySentenceKept = (original: string, shipped: string): void => {
  for (const line of original.split('\n')) {
    const body = line.replace(/^[ \t]{0,6}(?:[-•*]|\d{1,2}[.)])[ \t]{1,4}/, '');
    for (const s of sentencesOf(body)) expect(shipped, `kept: ${s.slice(0, 70)}`).toContain(s);
  }
};
/** RC6 changes the invariant only by the exact, occurrence-counted sentences the composer reports dropping. */
const everySentenceExceptReportedKept = (original: string, c: ReplyComposition): void => {
  const expected = sentenceMultiset(original);
  for (const dropped of c.measure?.said_once_dropped ?? []) {
    const sentences = sentenceMultiset(dropped);
    expect(sentences, 'each reported drop is one whole sentence').toHaveLength(1);
    const at = expected.indexOf(sentences[0]!);
    expect(at, `reported drop existed in the input: ${dropped}`).toBeGreaterThanOrEqual(0);
    expected.splice(at, 1);
  }
  expect(sentenceMultiset(c.text), 'input multiset minus exactly the reported dropped occurrences').toEqual(expected);
};

// ── Paul's session, verbatim fragments ─────────────────────────────────────────────────────────────
/** #1 08:43:43 (57.9 s): the build reply. D-03's two paragraphs, D-12's third question, D-14's orphaned count. */
const T1 = [
  'I’ve mapped the two hires plus “Carry On as Now”…',
  '',
  '…links from ‘Feature Delivery Capacity’ to ‘meet our next feature-launch deadline’ … whose strengths nobody has set yet. What is it, in % likelihood of on-time launch?',
  '',
  '…links from ‘Feature Delivery Capaci…’ to ‘meet our next feature-l…’ … whose strengths nobody has set yet. What is it, in % likelihood of on-time launch?',
  '',
  'How much does "Feature Delivery Capacity" change "meet our next feature-launch deadline"?',
  '',
  'Questions this model does not answer yet: The current likelihood of meeting the next feature-launch deadline is not stated, so no goal baseline has been assumed. (2 of 7 shown.)',
].join('\n');
const T1_REPEATED_ASK = 'What is it, in % likelihood of on-time launch?';
const T1_LAST_ASK_AT = T1.lastIndexOf(T1_REPEATED_ASK);
const T1_SAID_ONCE = T1.slice(0, T1_LAST_ASK_AT).trimEnd() + T1.slice(T1_LAST_ASK_AT + T1_REPEATED_ASK.length);
/** #3 09:06:12 (40.1 s): the recruitment-delay proposal. */
const T3 = 'This is a time-to-value risk… The link’s strength is a placeholder, not an estimate. This adds the risk, but does not quantify either timing threshold. Shall I add it?';
/** #5 09:14:06 (53.0 s): the freelance fallback proposal. */
const T5 = 'The six-month deadline isn’t encoded in the goal yet. The two-month trigger is in the wording, not a timed rule. Competitive recruitment and candidate quality also remain unmodelled. Shall I add this fallback option?';
/** #13 09:30:45 (46.8 s): the overlapping-costs proposal. */
const T13 = 'The £20,000 is earmarked for recruitment fees… The effect’s strength is a placeholder… This proposal does not record a budget limit. Is the £20,000 reserve included in the £200,000, or additional to it?';

describe('Paul’s replies: a headline, at most three bullets, the rest under More detail; the one question on the face', () => {
  it.each([
    ['#3', T3, 'Shall I add it?'],
    ['#5', T5, 'Shall I add this fallback option?'],
    ['#13', T13, 'Is the £20,000 reserve included in the £200,000, or additional to it?'],
  ])('%s (fragments, four sentences: the whole face): the ask is the last thing the user reads; never kept whole', (_turn, text, askSentence) => {
    const c = composeReplyShape({ text });
    expect(['shaped', 'already_in_shape']).toContain(c.outcome);
    const shown = c.shape === null ? sentencesOf(c.text) : face(c);
    expect(shown.at(-1)).toBe(askSentence);
    everySentenceKept(text, c.text);
  });

  it('#1: shaped; ONE question on the face (the last), the earlier repeated ask said once in detail (D-12 + RC6); the questions segment stays last, intact, for the panel’s toggle', () => {
    const c = composeReplyShape({ text: T1 });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets.length).toBeLessThanOrEqual(REPLY_FACE_MAX_BULLETS);
    expect(c.text, 'the identity tie').toBe(deriveAnswerTextFromShape(c.shape!));
    const onFace = face(c).filter((s) => s.trim().endsWith('?'));
    expect(onFace).toEqual(['How much does "Feature Delivery Capacity" change "meet our next feature-launch deadline"?']);
    expect(c.shape!.bullets.at(-1)).toBe(onFace[0]);
    expect(c.measure!.questions_in, 'the control: the reply asked three times').toBe(3);
    expect(c.shape!.detail.split('What is it, in % likelihood of on-time launch?'), 'the earlier repeated ask is in detail once').toHaveLength(2);
    expect(c.measure!.said_once_dropped).toEqual(['What is it, in % likelihood of on-time launch?']);
    expect(c.shape!.detail.endsWith('Questions this model does not answer yet: The current likelihood of meeting the next feature-launch deadline is not stated, so no goal baseline has been assumed. (2 of 7 shown.)')).toBe(true);
    // The panel's own predicate still finds the segment, now inside detail.
    expect(textAtRest(c.shape!.detail)).not.toContain('(2 of 7 shown.)');
    everySentenceExceptReportedKept(T1, c);
  });
});

describe('controls: a reply already in shape ships exactly as written', () => {
  it.each([
    ['a lead and three bullets', 'Your model compares two hires and carrying on as now.\n\n- Recruitment time is the main risk to the deadline.\n- The freelance fallback is not timed yet.\n- Size the capacity link to compare options.'],
    ['three sentences', 'Added the risk ‘Overlapping costs’. Saved as version 3. Run it again to see the comparison.'],
    ['one sentence', 'Saved.'],
    ['a lead, two bullets and a question', 'Two links are still unsized.\n\n- Capacity to deadline.\n- Onboarding to capacity.\n\nWhich one do you know best?'],
  ])('%s → already_in_shape, byte-identical, no sidecar', (_what, text) => {
    const c = composeReplyShape({ text });
    expect(c.outcome).toBe('already_in_shape');
    expect(c.text).toBe(text);
    expect(c.shape).toBeNull();
  });

  it('too little to hide (under 15 words would go behind the toggle) → ships whole', () => {
    const text = 'Lead sentence here. Point one is here. Point two is here. Point three is here. One more short line.';
    const c = composeReplyShape({ text });
    expect(c.outcome).toBe('already_in_shape');
    expect(c.text).toBe(text);
  });

  it('keepWhole leader_free_envelope → byte-identical, no sidecar, no RC6 drop (identity of the turn, never the words)', () => {
    const c = composeReplyShape({ text: T1, keepWhole: 'leader_free_envelope' });
    expect(c).toMatchObject({ outcome: 'kept_whole', reason: 'leader_free_envelope', shape: null, text: T1 });
    expect(c.measure!.said_once_dropped).toEqual([]);
  });

  it('CONTROL: keepWhole leader_free_envelope with no duplicate → byte-identical, no sidecar', () => {
    const c = composeReplyShape({ text: T1_SAID_ONCE, keepWhole: 'leader_free_envelope' });
    expect(c).toMatchObject({ outcome: 'kept_whole', reason: 'leader_free_envelope', shape: null, text: T1_SAID_ONCE });
    expect(c.measure!.said_once_dropped).toEqual([]);
  });

});

describe('TYPED RESPONSE PROFILES (DL, AIE line review 6037446159 item 5): chosen by turn kind, rows per profile', () => {
  it('coaching: the long reply is shaped (≤3 bullets, ≤75 face words)', () => {
    const c = composeReplyShape({ text: T1, profile: 'coaching' });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets.length).toBeLessThanOrEqual(3);
    expect(c.measure!.face_words).toBeLessThanOrEqual(75);
  });
  it.each(['method_step', 'proposal'] as const)('%s: the SAME long reply ships whole, byte-identical, no sidecar, no RC6 drop (worksheet verbatim / consent card disclosure)', (profile) => {
    const c = composeReplyShape({ text: T1, profile });
    expect(c).toMatchObject({ outcome: 'kept_whole', reason: profile, shape: null, text: T1 });
    expect(c.measure!.said_once_dropped).toEqual([]);
  });
  it.each(['method_step', 'proposal'] as const)('CONTROL %s: no duplicate → byte-identical, no sidecar', (profile) => {
    const c = composeReplyShape({ text: T1_SAID_ONCE, profile });
    expect(c).toMatchObject({ outcome: 'kept_whole', reason: profile, shape: null, text: T1_SAID_ONCE });
    expect(c.measure!.said_once_dropped).toEqual([]);
  });
  it('CONTROL: no profile behaves exactly as coaching', () => {
    expect(composeReplyShape({ text: T1 }).text).toBe(composeReplyShape({ text: T1, profile: 'coaching' }).text);
  });
});

describe('the AIE face budget (#87 6037293086 §5–7): ≤75 initial words, one ask; a challenge is never deleted', () => {
  const S = (i: number) => `Point ${i} names a different assumption in the hiring model that the deadline rests on.`;
  it('a reply within 75 words and one question ships whole, byte-identical (raw = shown)', () => {
    const text = `${S(1)} ${S(2)} ${S(3)} ${S(4)} Which do you trust least?`;
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(75);
    expect(composeReplyShape({ text })).toMatchObject({ outcome: 'already_in_shape', text });
  });
  it('CONTRAST: the same words with a second question → one ask on the face, the other question in detail (nothing deleted)', () => {
    const text = `${S(1)} Is that right? ${S(2)} ${S(3)} ${S(4)} ${S(5)} ${S(6)} Which do you trust least?`;
    const c = composeReplyShape({ text });
    expect(c.outcome).toBe('shaped');
    expect(face(c).filter((x) => x.endsWith('?'))).toEqual(['Which do you trust least?']);
    expect(c.shape!.detail).toContain('Is that right?');
    everySentenceKept(text, c.text);
  });
  it('the face fills to ≤75 words: long points stop the fill before the cap; a challenge left over sits in detail, kept', () => {
    const long = (i: number) => `Challenge ${i}: the model assumes two developers ramp up as fast as a tech lead, but onboarding a pair usually takes longer and costs the existing team more of its own delivery time than one senior hire does.`;
    const text = `The comparison rests on ramp-up time. ${long(1)} ${long(2)} ${long(3)} What ramp-up do you expect?`;
    const c = composeReplyShape({ text });
    expect(c.outcome).toBe('shaped');
    expect(c.measure!.face_words).toBeLessThanOrEqual(75);
    expect(c.shape!.bullets).toEqual([long(1), 'What ramp-up do you expect?']);
    expect(c.shape!.detail).toContain(long(2));
    expect(c.shape!.detail).toContain(long(3));
    everySentenceKept(text, c.text);
  });
});

describe('obligations on a coaching reply (DL R1 + AIE): the headline, the ONE ask, the withheld reason, caveats and required evidence stay on the face', () => {
  const NARRATOR = 'Your options differ mainly in how fast they add capacity. Hiring two developers adds more hands but needs more onboarding. A tech lead adds less capacity at first but may lift the whole team. The freelance option covers the gap only if it starts quickly. Each of these rests on links Olumi has not sized.';
  const ASK = 'What figure should "meet our next feature-launch deadline" reach or stay under? I’ll propose it as your target.';
  const WITHHELD = 'No single option can be put forward yet, because a link on the way to your goal has no recorded strength.';
  const BASIS = 'The sources of this comparison’s factor starting values are unavailable.';
  const SAVED = 'Saved as version 3.';

  it('the host ask (two sentences, one unit) closes the face; the withheld reason is on the face; disclosures and receipts go to detail', () => {
    const text = `${NARRATOR}\n\n${WITHHELD}\n\n${BASIS} ${SAVED}\n\n${ASK}`;
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: WITHHELD }, { role: 'ask', text: ASK }] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe('Your options differ mainly in how fast they add capacity.');
    expect(c.shape!.bullets).toEqual(['Hiring two developers adds more hands but needs more onboarding.', WITHHELD, ASK]);
    expect(c.shape!.detail, 'R1: a host disclosure may move to detail').toContain(BASIS);
    expect(c.shape!.detail, 'R1: a receipt may move to detail').toContain(SAVED);
    everySentenceKept(text, c.text);
  });

  it('CONTRAST: the same text with NO obligations → the withheld reason goes to detail and the two-sentence host ask is no longer one unit', () => {
    const text = `${NARRATOR}\n\n${WITHHELD}\n\n${BASIS} ${SAVED}\n\n${ASK}`;
    const c = composeReplyShape({ text });
    expect(c.shape!.detail).toContain(WITHHELD);
    expect(face(c)).not.toContain(ASK);
  });

  it('overlapping obligations (the gate’s closing carries the ask) are ONE unit: it closes the face, said once', () => {
    const CLOSING = 'This comparison turns on the link from ‘Feature Delivery Capacity’ to ‘meet our next feature-launch deadline’, whose strength isn\'t sized in the model yet. To size it, I first need today’s level of ‘meet our next feature-launch deadline’. What is it, in % likelihood of on-time launch?';
    const ASK_PART = 'What is it, in % likelihood of on-time launch?';
    const text = `${NARRATOR}\n\n${CLOSING}`;
    const c = composeReplyShape({ text, obligations: [{ role: 'ask', text: ASK_PART }, { role: 'withheld_reason', text: CLOSING }] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets.at(-1)).toBe(CLOSING);
    expect(c.text.split(ASK_PART)).toHaveLength(2);
  });

  it('a host ask beats a narrator question for the face; the narrator’s question goes to detail', () => {
    const text = `${NARRATOR} Which option feels closest to your plan?\n\n${ASK}`;
    const c = composeReplyShape({ text, obligations: [{ role: 'ask', text: ASK }] });
    expect(c.shape!.bullets.at(-1)).toBe(ASK);
    expect(c.shape!.detail).toContain('Which option feels closest to your plan?');
  });

  it('Codex r1 P2 (#2748): an earlier question in a bullet does not displace the reply’s last question', () => {
    const text = 'Recruitment remains uncertain.\n- Check lead times.\n- Shall I add a risk?\n\nWe should test this assumption against actual recruitment lead times before relying on this comparison in planning. What is today’s delivery capacity?';
    const c = composeReplyShape({ text });
    expect(c.shape!.bullets.at(-1)).toBe('What is today’s delivery capacity?');
    expect(c.shape!.detail).toContain('Shall I add a risk?');
  });

  it('more must-face lines than three bullets → the reply ships whole (required evidence is never hidden)', () => {
    const W2 = 'No single option can be put forward on this result yet.';
    const E1 = '‘Hire a Tech Lead’: about 40% chance of meeting your goal, in this model.';
    const text = `${NARRATOR}\n\n${WITHHELD}\n\n${W2}\n\n${E1}\n\n${ASK}`;
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: WITHHELD }, { role: 'withheld_reason', text: W2 }, { role: 'evidence', text: E1 }, { role: 'ask', text: ASK }] });
    expect(c).toMatchObject({ outcome: 'kept_whole', reason: 'face_over_cap', text });
  });

  // Served shape (S4c B5 T1b readback, waveB-screen-chance-lines-20261007.json): three screen chance lines after a lead-in,
  // two of them ending on their own question.
  const LEAD = 'For reaching at least £126,000 monthly recurring revenue, on current information:';
  const EQ = '‘Raise prices 10%’: about 47% chance of meeting your goal, in this model. It rests most on how strongly ‘Price rise’ affects ‘monthly recurring revenue’, at the size you set. How sure are you of that size?';
  const EL = '‘Launch £49 starter tier’: about 34% chance of meeting your goal, in this model. It rests most on how strongly ‘Starter tier monthly price’ affects ‘New starter subscribers’, at the size you set. How sure are you of that size?';
  const EK = '‘Keep pricing as it is’: less than 1% chance of meeting your goal, in this model.';
  const TAIL = 'This model doesn’t yet say whether any option gets there within nine months, because the deadline is not encoded in the goal.';
  const TAIL2 = 'Sizing the price link first would show how much the chances move when that one assumption changes.';
  const evidence = [EQ, EL, EK].map((t) => ({ role: 'evidence' as const, text: t }));
  const EL_SAID_ONCE = EL.replace(' How sure are you of that size?', '');
  it('⛔ a lead-in stays with what it introduces: three chance lines after "…, on current information:" fill the face, so → whole', () => {
    const text = `No single option can be put forward: the comparison is a near tie.\n\n${LEAD}\n\n${EQ} ${EL} ${EK}\n\n${TAIL} ${TAIL2}`;
    const c = composeReplyShape({ text, obligations: evidence });
    expect(c).toMatchObject({ outcome: 'kept_whole', reason: 'lead_in_split', text: text.replace(EL, EL_SAID_ONCE) });
    expect(c.measure!.said_once_dropped).toEqual(['How sure are you of that size?']);
    everySentenceExceptReportedKept(text, c);
  });
  it('CONTROL: the same lines with no lead-in are shaped, in the reply’s order (a line ending on its own question is evidence, never moved to close the face)', () => {
    const text = `No single option can be put forward: the comparison is a near tie.\n\n${EQ} ${EL} ${EK}\n\n${TAIL} ${TAIL2}`;
    const c = composeReplyShape({ text, obligations: evidence });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets).toEqual([EQ, EL_SAID_ONCE, EK]);
    expect(c.measure!.said_once_dropped).toEqual(['How sure are you of that size?']);
    everySentenceExceptReportedKept(text, c);
  });

  // S-A host parts (DL: "host lines as typed parts inserted by identity"); served words from run-outcome-follow-ups / s5t.
  const IDENTITY = "The figures don't add up: Pro plan price × Pro paying subscribers gives £14,700/month, but you said MRR is £20,000/month. Which is right?";
  const ARITHMETIC = 'If MRR is Pro plan price × Pro paying subscribers: at £49/month and 300 Pro paying subscribers, MRR is £14,700/month today. At £59/month, MRR stays at least that while 250 or more of the 300 stay. £20,000/month needs 339 at £59/month or 409 at £49/month. This is arithmetic on these figures, not the analysis ranking the options.';
  const RECEIPT = 'Recorded your figure for how "Enterprise win rate" moves "quarterly revenue", as you confirmed. Olumi rescaled ‘quarterly revenue’ so your figure fits. Your other links mean the same as before, though some strength words may read differently.';
  it('a reply made only of host parts (the identity ask + the arithmetic) ships as the host composed it', () => {
    const text = `${IDENTITY}\n\n${ARITHMETIC}`;
    expect(composeReplyShape({ text, obligations: [{ role: 'ask', text: IDENTITY }, { role: 'host', text: ARITHMETIC }] }))
      .toMatchObject({ outcome: 'kept_whole', reason: 'no_headline', text });
    expect(composeReplyShape({ text }).text, 'the control: untyped, the same words are reshaped').not.toBe(text);
  });
  it('B15 / 2b-0: all typed host parts → first screen chance headline; no-marker control retains host headline', () => {
    const evidence = ['‘Keep Pro at £49’: about 34% chance of meeting your goal, in this model.',
      '‘Raise Pro to £59 at release’: about 47% chance of meeting your goal, in this model.'];
    const text = [RUN_RESULT_READY_TEXT, ...evidence, RECEIPT, ARITHMETIC].join('\n\n');
    const obligations = [{ role: 'host' as const, text: RUN_RESULT_READY_TEXT },
      ...evidence.map(text => ({ role: 'evidence' as const, text, lead: true as const })),
      ...[RECEIPT, ARITHMETIC].map(text => ({ role: 'host' as const, text }))];
    const c = composeReplyShape({ text, obligations, profile: 'coaching' });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(evidence[0]);
    expect(c.shape!.bullets).toEqual(evidence.slice(1));
    expect(c.shape!.detail).toBe(`${RUN_RESULT_READY_TEXT}\n\n${RECEIPT}\n\n${ARITHMETIC}`);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    expect(c.text.startsWith(evidence[0]!)).toBe(true);
    const control = composeReplyShape({ text, obligations: obligations.map(({ role, text }) => ({ role, text })) });
    expect(control.shape!.headline, 'positive control: no typed lead retains 2b-0').toBe(RUN_RESULT_READY_TEXT);
    expect(control.shape!.bullets).toEqual(evidence);
    expect(control.shape!.detail).toBe(`${RECEIPT}\n\n${ARITHMETIC}`);
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(text));
    expect(composeReplyShape({ text, obligations, keepWhole: 'host_composed' }))
      .toMatchObject({ text, shape: null, reason: 'host_composed' });
  });
  it('a host part is ONE unit, never split: right after the headline it still sits whole (under More detail, R1)', () => {
    const text = `The figure is recorded in the model now. ${RECEIPT} ${NARRATOR}\n\n${ASK}`;
    const c = composeReplyShape({ text, obligations: [{ role: 'host', text: RECEIPT }, { role: 'ask', text: ASK }] });
    expect(c.outcome).toBe('shaped');
    expect(c.text).toContain(RECEIPT);
    expect(face(c)).not.toContain(RECEIPT);
    const untyped = composeReplyShape({ text, obligations: [{ role: 'ask', text: ASK }] });
    expect(untyped.text, 'the control: untyped, the face takes the receipt apart').not.toContain(RECEIPT);
  });
  it('overlapping parts carry the strongest role: a host line holding the withheld reason is on the face', () => {
    const HOST = `${WITHHELD} ${BASIS}`;
    const text = `${NARRATOR}\n\n${HOST}\n\n${SAVED} More words follow here to pass the detail floor easily enough.`;
    const c = composeReplyShape({ text, obligations: [{ role: 'host', text: HOST }, { role: 'withheld_reason', text: WITHHELD }] });
    expect(face(c)).toContain(HOST);
  });

  it('S-E GOALS (#2742): the chance-goal sentence (withheld reason) and the deadline ask stay on the face, by their producers’ words', () => {
    const CHANCE = chanceGoalSentence(undefined);
    const DEADLINE = chanceGoalDeadlineAsk('meet our next feature-launch deadline');
    const text = `${NARRATOR}\n\n${CHANCE}\n\n${DEADLINE}`;
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: CHANCE }, { role: 'ask', text: DEADLINE }] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets.slice(-2)).toEqual([CHANCE, DEADLINE]);
    expect(composeReplyShape({ text }).shape!.detail, 'the control: untyped, the chance sentence goes to detail').toContain(CHANCE);
  });

  it('an obligation a gate already removed is no longer owed: the reply is shaped without it', () => {
    const text = `${NARRATOR} ${T5}`;
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: WITHHELD }] });
    expect(c.outcome).toBe('shaped');
    expect(composeReplyShape({ text }).text, 'the control: an absent obligation changes nothing').toBe(c.text);
  });

  it('⛔ an obligation that sits INSIDE a sentence never splits that sentence: the invariant keeps the reply whole', () => {
    const text = `${NARRATOR} Note that no single option can be put forward yet for now, so read the figures with care. More words follow here to pass the floor easily.`;
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: 'no single option can be put forward yet' }] });
    expect(c).toMatchObject({ outcome: 'kept_whole', reason: 'invariant_failed', text });
  });
});

describe('the model wrote a list: its lead-in becomes the headline, its first points the face', () => {
  it('"Suggest risks" shape: a lead-in line ending ":" + four bullets → lead-in headline, three bullets, the fourth in detail', () => {
    const text = [
      'Consider these possible risks, not established facts:',
      '- Recruitment delay: hiring takes longer than the deadline allows.',
      '- Wrong bottleneck: capacity is not what limits delivery.',
      '- Coordination drag: more people slow each other down.',
      '- Quality trade-off: speed now costs rework later, which eats the time you gained.',
      '',
      'None has been added. Each is a possibility to test against your situation, not an established finding, and each would need its own link into the deadline before it could move any figure in the comparison. Which feels most credible in your situation?',
    ].join('\n');
    const c = composeReplyShape({ text });
    expect(c.shape!.headline).toBe('Consider these possible risks, not established facts:');
    expect(c.shape!.bullets).toEqual([
      'Recruitment delay: hiring takes longer than the deadline allows.',
      'Wrong bottleneck: capacity is not what limits delivery.',
      'Which feels most credible in your situation?',
    ]);
    expect(c.shape!.detail).toBe('- Coordination drag: more people slow each other down.\n- Quality trade-off: speed now costs rework later, which eats the time you gained.\n\nNone has been added. Each is a possibility to test against your situation, not an established finding, and each would need its own link into the deadline before it could move any figure in the comparison.');
    everySentenceKept(text, c.text);
  });
});

describe('RC6 said once', () => {
  it('quote fold (Science #2787 P1-A): a typed obligation in curly quotes binds the reply’s straight-quoted words, so it faces', () => {
    const typed = 'No single option can be put forward yet, because ‘MRR’ is read as ‘Pro plan price’ × ‘Pro paying subscribers’, which is not confirmed.';
    const written = typed.replace(/[‘’]/g, "'");
    const filler = ['The model compares four options on twelve months of revenue.', 'Each figure rests on the values in your model today.',
      'Several of those values are Olumi’s estimates rather than yours.', 'Changing any estimate changes what this model implies.',
      'The analysis does not rank the options for you.', 'It shows what the current model implies under its assumptions.'];
    const text = [...filler, written].join(' ');
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: typed }] });
    expect(c.shape, c.reason).not.toBeNull();
    expect([c.shape!.headline, ...c.shape!.bullets].join('\n'), 'the withheld reason faces, in the reply’s own glyphs').toContain(written);
    expect(c.shape!.detail).not.toContain(written);
  });
  const served = JSON.parse(readFileSync(new URL('./fixtures/paul-test-20261008-explain.json', import.meta.url), 'utf8')) as {
    explain_00_24_38: string;
    explain_00_30_46: string;
    withhold_sentence: string;
    no_leader_with_reason: string;
  };
  const count = (text: string, sentence: string): number => text.split(sentence).length - 1;
  const chanceIntro = 'This run doesn’t show how often each option reaches the goal’s target.';
  const context = 'Current estimates need evidence before anyone relies on this comparison for planning across teams. Recruitment takes time, and new starters may need the existing team to stop and help them. Capacity is only one part of the path from hiring to timely delivery of a release. The evidence should show how the new people affect work already planned for this quarter.';

  it.each([
    ['explain_00_24_38', served.explain_00_24_38, 'What is ‘Monthly churn rate’ today?'],
    ['explain_00_30_46', served.explain_00_30_46, 'How much does ‘Pro plan price’ change ‘Monthly churn rate’?'],
  ])('P1 %s: the contained withhold sentence is said only inside the face bullet; removing the standalone copy by hand is today’s byte-identical control', (_id, text, ask) => {
    const obligations: FaceObligation[] = [
      { role: 'withheld_reason', text: served.no_leader_with_reason },
      { role: 'withheld_reason', text: served.withhold_sentence },
      { role: 'ask', text: ask },
    ];
    const c = composeReplyShape({ text, obligations });
    expect(c.outcome).toBe('shaped');
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.shape!.bullets).toContain(served.no_leader_with_reason);
    expect(c.shape!.bullets.at(-1)).toBe(ask);
    expect(count(c.text, served.withhold_sentence)).toBe(1);
    expect(c.shape!.detail).not.toContain(served.withhold_sentence);
    expect(c.measure!.said_once_dropped).toEqual([served.withhold_sentence]);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceExceptReportedKept(text, c);

    // The served fixture is read-only. Remove only its standalone detail copy in this local control.
    const controlText = text.replace(`${chanceIntro} ${served.withhold_sentence}`, chanceIntro);
    expect(count(controlText, served.withhold_sentence)).toBe(1);
    const control = composeReplyShape({ text: controlText, obligations });
    expect(control.outcome).toBe('shaped');
    expect(control.text, 'the no-drop control is byte-identical to today’s already-shaped served words').toBe(controlText);
    expect(control.measure!.said_once_dropped).toEqual([]);
    expect(c.text).toBe(control.text);
    everySentenceExceptReportedKept(controlText, control);
  });

  it('R2: two atomic chance+depends findings ask the same question once, on the FIRST finding; the second obligation still binds and the headline is unchanged', () => {
    const question = 'How sure are you of that size?';
    const lead = 'For reaching at least £126,000 monthly recurring revenue, on current information:';
    const first = `‘Raise prices 10%’: about 47% chance of meeting your goal, in this model. It rests most on how strongly ‘Price rise’ affects ‘monthly recurring revenue’, at the size you set. ${question}`;
    const secondWithoutQuestion = '‘Launch £49 starter tier’: about 34% chance of meeting your goal, in this model. It rests most on how strongly ‘Starter tier monthly price’ affects ‘New starter subscribers’, at the size you set.';
    const second = `${secondWithoutQuestion} ${question}`;
    const withheld = 'No single option can be put forward: the comparison is a near tie.';
    const text = [withheld, lead, first, second, context].join('\n\n');
    const obligations: FaceObligation[] = [
      { role: 'evidence', text: first, lead: true },
      { role: 'evidence', text: second, lead: true },
      { role: 'withheld_reason', text: withheld },
    ];
    const c = composeReplyShape({ text, obligations });
    expect(c.outcome).toBe('shaped');
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.shape!.headline).toBe(`${lead}\n${first}`);
    expect(c.shape!.bullets).toContain(secondWithoutQuestion);
    expect(c.shape!.bullets).toContain(withheld);
    expect(c.shape!.detail).not.toContain(secondWithoutQuestion);
    expect(count(c.text, question)).toBe(1);
    expect(c.measure!.said_once_dropped).toEqual([question]);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceExceptReportedKept(text, c);

    const again = composeReplyShape({ text: c.text, obligations });
    expect(again.reason).not.toBe('obligation_unlocated');
    expect(again.measure!.said_once_dropped).toEqual([]);
    everySentenceExceptReportedKept(c.text, again);
  });

  it.each([
    ['bold', '**'],
    ['backtick', '`'],
    ['underscore', '_'],
  ])('R2 %s with twelve-space sentence gaps: normalised equal questions on one line preserve the first formatted atomic headline and re-bind the second finding', (_format, mark) => {
    const gap = ' '.repeat(12);
    const firstQuestion = `${mark}How sure are you of that size?${mark}`;
    const secondQuestion = `${mark}HOW sure are you of that size?${mark}`;
    const first = [
      'First option: about 20% chance of meeting your goal, in this model.',
      'It rests on the size you set for recruitment.',
      firstQuestion,
    ].join(gap);
    const secondWithoutQuestion = [
      'Second option: about 30% chance of meeting your goal, in this model.',
      'It rests on the size you set for onboarding.',
    ].join(gap);
    const second = `${secondWithoutQuestion}${gap}${secondQuestion}`;
    const text = `${first}${gap}${second}\n\n${context}`;
    const c = composeReplyShape({ text, obligations: [
      { role: 'evidence', text: first, lead: true },
      { role: 'evidence', text: second, lead: true },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.shape!.headline).toBe(first);
    expect(c.shape!.bullets).toContain(secondWithoutQuestion);
    expect(c.shape!.detail).not.toContain(secondWithoutQuestion);
    expect(count(c.text, firstQuestion), 'the first question keeps its original casing and emphasis').toBe(1);
    expect(c.text).not.toContain(secondQuestion);
    expect(c.measure!.said_once_dropped).toEqual([secondQuestion]);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceExceptReportedKept(text, c);
  });

  const largest = 'This comparison is withheld because the outcome depends on revenue falling after churn.';
  const middle = 'The outcome depends on revenue falling after churn.';
  const smallest = 'Revenue falling after churn.';
  const equalSmallest = '“REVENUE” **falling**  \t after _churn_!';
  it.each([
    ['container first', [largest, middle, smallest, equalSmallest]],
    ['container last', [middle, smallest, equalSmallest, largest]],
  ])('never-both + normalisation chain, %s: nested containment and equal copies leave exactly the one full carrier', (_order, lines) => {
    const text = (lines as string[]).join('\n');
    const c = composeReplyShape({ text });
    expect(sentenceMultiset(c.text)).toEqual([largest]);
    expect(c.measure!.said_once_dropped).toEqual([middle, smallest, equalSmallest]);
    everySentenceExceptReportedKept(text, c);
  });

  it('a dropped typed sentence re-binds its strongest role, lead marker and directed-link subjects to the containing unit by identity', () => {
    const contained = 'The link from ‘Support cost’ to ‘MRR lost to support strain’ has no size yet.';
    const containing = 'No single option can be put forward, because the link from ‘Support cost’ to ‘MRR lost to support strain’ has no size yet.';
    const restatement = 'Support cost affects MRR lost to support strain, whose strength is not sized in the model yet.';
    const graph = { nodes: [
      { id: 'support', label: 'Support cost' }, { id: 'loss', label: 'MRR lost to support strain' },
    ] };
    const text = [restatement, context, containing, contained].join('\n\n');
    const c = composeReplyShape({ text, graph, obligations: [
      { role: 'evidence', text: contained, lead: true },
      { role: 'withheld_reason', text: contained, subjects: ['support→loss'] },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.shape!.headline).toBe(containing);
    expect(c.measure!.obligations_on_face).toBe(1);
    expect(face(c)).not.toContain(restatement);
    expect(c.shape!.detail).toContain(restatement);
    expect(c.measure!.restatements_to_detail).toBe(1);
    expect(c.measure!.said_once_dropped).toEqual([contained]);
    everySentenceExceptReportedKept(text, c);
  });

  it('the one unique typed closing ask stays on the face even when its whole normalised text is inside an earlier larger question', () => {
    const earlier = 'Before we rerun, which input should we check first?';
    const ask = 'Which input should we check first?';
    const text = [context, earlier, ask].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'ask', text: ask }] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets.at(-1)).toBe(ask);
    expect(c.text).toContain(earlier);
    expect(c.measure!.said_once_dropped).toEqual([]);
    everySentenceExceptReportedKept(text, c);
  });

  it('an equal normalised earlier question becomes the typed closing ask; the FIRST wording survives unchanged', () => {
    const first = 'How sure are you of “Revenue” *rising*?';
    const closing = '“HOW sure are you of Revenue  \t rising”?';
    const text = [context, first, closing].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'ask', text: closing }] });
    // One question left and little to hide: it ships as written, deduplicated (D-12 holds: one question, last).
    expect(['shaped', 'already_in_shape']).toContain(c.outcome);
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.text.trimEnd().endsWith(first)).toBe(true);
    expect(c.text.split(first)).toHaveLength(2);
    expect(c.text).not.toContain(closing);
    expect(c.measure!.said_once_dropped).toEqual([closing]);
    everySentenceExceptReportedKept(text, c);
  });

  it('Open Questions is untouched, including a copy of the face finding and repeated questions inside the protected segment', () => {
    const finding = 'Revenue may fall after churn.';
    const question = 'How sure are you of that size?';
    const segment = `Questions this model does not answer yet:\n- ${finding}\n- ${question}\n- ${question}`;
    const text = [finding, context, segment].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'evidence', text: finding, lead: true }] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(finding);
    expect(openQuestionsSegment(c.text)?.segment).toBe(segment);
    expect(c.shape!.detail.endsWith(segment)).toBe(true);
    expect(count(c.text, finding)).toBe(2);
    expect(count(c.text, question)).toBe(2);
    expect(c.measure!.said_once_dropped).toEqual([]);
    everySentenceExceptReportedKept(text, c);
  });

  it('a protected later Open Questions copy cannot steal the dropped face sentence’s obligation identity', () => {
    const containing = 'Note: The cost is uncertain.';
    const contained = 'The cost is uncertain.';
    const segment = `Questions this model does not answer yet:\n- ${contained}`;
    const text = [containing, context, contained, segment].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: contained, lead: true }] });
    expect(c.outcome).toBe('shaped');
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.shape!.headline).toBe(containing);
    expect(c.measure!.obligations_on_face).toBe(1);
    expect(openQuestionsSegment(c.text)?.segment).toBe(segment);
    expect(count(c.text, contained), 'only the containing finding and protected segment carry the shorter copy').toBe(2);
    expect(c.measure!.said_once_dropped).toEqual([contained]);
    everySentenceExceptReportedKept(text, c);
  });

  it('Open Questions keeps its original protected identity when the only original lead sentence is dropped into its after-segment carrier', () => {
    const lead = 'Revenue may fall.';
    const question = 'How sure are you?';
    const segment = `Questions this model does not answer yet: We need evidence. ${question}`;
    const after = `Saved: ${lead} ${context}`;
    const text = [lead, segment, after].join('\n\n');
    expect(openQuestionsSegment(text)?.segment, 'the input has a recognised protected segment').toBe(segment);
    const c = composeReplyShape({ text });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(`Saved: ${lead}`);
    expect(face(c).join('\n')).not.toContain(question);
    expect(c.shape!.detail.endsWith(segment)).toBe(true);
    expect(openQuestionsSegment(c.text)?.segment).toBe(segment);
    expect(c.measure!.open_questions_segment).toBe(true);
    expect(c.measure!.said_once_dropped).toEqual([lead]);
    expect(count(c.text, question)).toBe(1);
    everySentenceExceptReportedKept(text, c);
  });

  it('a protected later copy of the typed closing ask never causes the unique outside ask to drop or lose its face identity', () => {
    const earlier = 'Before we rerun, which input should we check first?';
    const ask = 'Which input should we check first?';
    const segment = `Questions this model does not answer yet:\n- ${ask}`;
    const text = [context, earlier, ask, segment].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'ask', text: ask }] });
    expect(c.outcome).toBe('shaped');
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.shape!.bullets.at(-1)).toBe(ask);
    expect(c.text).toContain(earlier);
    expect(openQuestionsSegment(c.text)?.segment).toBe(segment);
    expect(count(c.text, ask)).toBe(2);
    expect(c.measure!.said_once_dropped).toEqual([]);
    everySentenceExceptReportedKept(text, c);
  });

  it('an exactly repeated multi-sentence atomic finding retains the first complete span and lead identity when both later sentences drop', () => {
    const firstSentence = 'The chance is low.';
    const secondSentence = 'The premise is estimated.';
    const atomic = `${firstSentence} ${secondSentence}`;
    const text = [atomic, context, atomic].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'evidence', text: atomic, lead: true }] });
    expect(c.outcome).toBe('shaped');
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.shape!.headline).toBe(atomic);
    expect(c.measure!.obligations_on_face).toBe(1);
    expect(count(c.text, firstSentence)).toBe(1);
    expect(count(c.text, secondSentence)).toBe(1);
    expect(c.measure!.said_once_dropped).toEqual([firstSentence, secondSentence]);
    everySentenceExceptReportedKept(text, c);
  });

  it('negative: two different sentences sharing a long prefix both ship whole', () => {
    const prefix = 'The outcome depends on how quickly newly recruited people add useful capacity to the existing delivery team, ';
    const before = `${prefix}before the next feature deadline.`;
    const after = `${prefix}after the next feature deadline.`;
    const text = [context, before, after].join('\n\n');
    const c = composeReplyShape({ text });
    expect(c.text).toContain(before);
    expect(c.text).toContain(after);
    expect(c.measure!.said_once_dropped).toEqual([]);
    everySentenceExceptReportedKept(text, c);
  });
});

// ── the served corpus: properties over text from outside this author's head ─────────────────────────
function corpus(): { source: string; text: string }[] {
  const out: { source: string; text: string }[] = [];
  const seen = new Set<string>();
  const walk = (o: unknown, source: string): void => {
    if (Array.isArray(o)) { for (const x of o) walk(x, source); return; }
    if (o === null || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if ((k === 'assistant_text' || k === 'assistant_message' || k === 'text') && typeof v === 'string' && v.length > 120 && !seen.has(v)) {
        seen.add(v); out.push({ source, text: v });
      } else walk(v, source);
    }
  };
  const roots = ['../../__tests__/fixtures', '../../../__tests__/fixtures'].map((r) => new URL(r, import.meta.url).pathname);
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.json') ? [p] : [];
  });
  for (const f of roots.flatMap(files)) {
    try { walk(JSON.parse(readFileSync(f, 'utf8')), f); } catch { /* not JSON we can read: skipped */ }
  }
  const aiq = JSON.parse(readFileSync(new URL('../../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as { replies: { id: string; text: string }[] };
  for (const r of aiq.replies) if (!seen.has(r.text)) { seen.add(r.text); out.push({ source: `aiq:${r.id}`, text: r.text }); }
  return out;
}

describe('the served corpus', () => {
  const all = corpus();
  it('the control: the corpus is real and sizeable', () => {
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(all.some((r) => r.source.startsWith('aiq:'))).toBe(true);
  });

  it('every reply: never throws; shaped ⇒ ≤3 bullets and the identity tie; every sentence except recorded RC6 drops kept; no-drop passthrough is byte-identical', () => {
    const outcomes: Record<string, number> = {};
    for (const r of all) {
      const c = composeReplyShape({ text: r.text });
      outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
      if (c.outcome === 'shaped') {
        expect(c.shape!.bullets.length, r.source).toBeLessThanOrEqual(REPLY_FACE_MAX_BULLETS);
        expect(c.text, r.source).toBe(deriveAnswerTextFromShape(c.shape!));
      } else if ((c.measure?.said_once_dropped.length ?? 0) === 0) {
        expect(c.text, r.source).toBe(r.text);
      }
      everySentenceExceptReportedKept(r.text, c);
    }
    // The class is exercised: most long served replies are reshaped, and none fails its own invariant.
    expect(outcomes.shaped ?? 0).toBeGreaterThanOrEqual(Math.floor(all.length / 2));
    expect(all.filter((r) => composeReplyShape({ text: r.text }).reason === 'invariant_failed').map((r) => r.source)).toEqual([]);
  });

  it('a composed reply composed again keeps every sentence except its reported RC6 drops and at most three face bullets (stable contract)', () => {
    for (const r of all) {
      const once = composeReplyShape({ text: r.text });
      const twice = composeReplyShape({ text: once.text });
      if (twice.shape !== null) expect(twice.shape.bullets.length, r.source).toBeLessThanOrEqual(REPLY_FACE_MAX_BULLETS);
      everySentenceExceptReportedKept(r.text, once);
      everySentenceExceptReportedKept(once.text, twice);
      expect(twice.measure?.said_once_dropped ?? [], r.source).toEqual([]);
    }
  });
});

describe('the producer half: one shape rule for every model', () => {
  it('names the construct: one sentence, at most three bullets, More detail, the question last', () => {
    expect(REPLY_SHAPE_INSTRUCTION).toContain('begin with one short sentence that answers');
    expect(REPLY_SHAPE_INSTRUCTION).toContain('at most three bullets');
    expect(REPLY_SHAPE_INSTRUCTION).toContain('under 20 words');
    expect(REPLY_SHAPE_INSTRUCTION).toContain('More detail');
    expect(REPLY_SHAPE_INSTRUCTION).toContain('If you ask a question, it stays your last sentence.');
    expect(REPLY_SHAPE_INSTRUCTION).not.toMatch(/[‒-―]/);
    expect(REPLY_SHAPE_INSTRUCTION).toContain('under 75 words, with one reasoning move and at most one question or next action');
    expect(REPLY_SHAPE_INSTRUCTION.match(/\d+/g)).toEqual(['20', '75']);
  });
});

describe('timing: every regex on the path scales linearly (20k -> 80k, min of 7 batches, ratio < 8x)', () => {
  // P51's calibrated helper (min of 7 batches, LARGE sample >= ~60 ms). Linear ~ 4x, quadratic ~ 16x; the bar stays < 8x.
  // Measured locally 8 Oct: terminators 20k 0.19 ms -> 80k 0.69 ms -> 320k 2.74 ms per call (linear); CI read 8.32x once.
  const shapes: [string, (n: number) => string][] = [
    ['whitespace', (n) => `Lead.${' '.repeat(n)}Next. ${'\t'.repeat(n)}`],
    ['terminators', (n) => `${'.'.repeat(n)} A${'?'.repeat(n)}`],
    ['sentences and bullets', (n) => Array.from({ length: Math.ceil(n / 20) }, (_, i) => (i % 3 === 0 ? `- Point ${i} is here.` : `Sentence ${i} is here.`)).join('\n')],
  ];
  it.each(shapes)('%s', (_name, make) => {
    const small = make(20_000);
    const large = make(80_000);
    expect(large.length).toBeGreaterThanOrEqual(small.length * 3);
    const runLarge = (): void => { composeReplyShape({ text: large }); };
    const runSmall = (): void => { composeReplyShape({ text: small }); };
    const growth = scalingRatio(runSmall, runLarge);
    expect(growth.ratio, growth.detail).toBeLessThan(8);
  });
});

describe('the ONE label rule (`reply/labels.ts`, D-04): never cut mid-word', () => {
  it('shortens to a whole-word prefix plus an ellipsis; a short label is untouched; a single over-long word is omitted, never sliced', async () => {
    const { compactWordLabel } = await import('../labels.js');
    expect(compactWordLabel('Feature Delivery Capacity', 22)).toBe('Feature Delivery…');
    expect(compactWordLabel('meet our next feature-launch deadline', 22)).toBe('meet our next…');
    expect(compactWordLabel('Revenue', 22)).toBe('Revenue');
    expect(compactWordLabel('Supercalifragilistic', 8)).toBe('…');
  });
});

describe('B15: a present typed goal-chance finding is the headline, by identity', () => {
  // Served R-3.chat.txt lines 28–32, verbatim; the first option is not the largest chance.
  const servedLines = [
    "In this model, 73% of runs supported ‘Launch starter tier’, provisionally on Olumi’s starting estimates. That share is not its chance of meeting your target.",
    "For your goal of at least £126,000/month, chances of meeting it, in this model, are:",
    "Raise prices 10%: about 16%.",
    "Launch starter tier: about 52%.",
    "Keep pricing as it is: less than 1%.",
  ];
  const text = servedLines.join('\n');
  const share = sentencesOf(servedLines[0]!)[0]!;
  const chances = servedLines.slice(2);
  // Deliberately reverse the obligation order: text order alone determines the headline.
  const obligations: FaceObligation[] = [...chances].reverse().map(text => ({ role: 'evidence', text, lead: true }));
  const assertDerivation = (original: string, c: ReplyComposition) => {
    expect(c.outcome).toBe('shaped');
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(original));
  };

  it('R4: served share-first reply → first typed chance exactly; share in bullets/detail; invariant', () => {
    const c = composeReplyShape({ text, obligations });
    expect(c.shape, 'typed goal chance produces a headline even below the face budget').not.toBeNull();
    expect(c.shape!.headline).toBe(`${servedLines[1]}\n${chances[0]}`);
    expect([...c.shape!.bullets, c.shape!.detail].join('\n')).toContain(share);
    expect(c.shape!.bullets).toEqual(chances.slice(1));
    expect(c.shape!.detail, 'the lead-in is never left in detail, introducing nothing').not.toContain(servedLines[1]);
    assertDerivation(text, c);
  });

  it('R10 (Codex on 297d1f1b P2): another finding’s colon frame never joins the chance headline; a chance frame two paragraphs up never does either', () => {
    const risk = 'Risks to assess for Raise prices 10%:';
    const framed = [share, risk, chances[0]!, chances[1]!].join('\n');
    expect(composeReplyShape({ text: framed, obligations }).shape?.headline).toBe(chances[0]);
    const far = [share, servedLines[1]!, '', 'Something else entirely.', '', chances[0]!, chances[1]!].join('\n');
    expect(composeReplyShape({ text: far, obligations }).shape?.headline).toBe(chances[0]);
    // Codex re-review 7ff59a6e P2: a goal-keyword frame for another finding never joins.
    const goalRisk = [share, 'Risks to meeting your goal with Raise prices 10%:', chances[0]!, chances[1]!].join('\n');
    expect(composeReplyShape({ text: goalRisk, obligations }).shape?.headline).toBe(chances[0]);
    // …and a chance frame in bold still joins (trailing emphasis aside).
    const bold = [share, `**${servedLines[1]!}**`, chances[0]!, chances[1]!].join('\n');
    expect(composeReplyShape({ text: bold, obligations }).shape?.headline).toBe(`**${servedLines[1]}**\n${chances[0]}`);
    // control: the chance frame directly before joins
    const near = [share, servedLines[1]!, chances[0]!, chances[1]!].join('\n');
    expect(composeReplyShape({ text: near, obligations }).shape?.headline).toBe(`${servedLines[1]}\n${chances[0]}`);
  });

  it('R9 (DL #2783 reading order): no lead-in → the chance alone leads; a lead-in NOT ending in ":" never joins it', () => {
    const plainLead = [share, chances[0]!, chances[1]!].join('\n');
    expect(composeReplyShape({ text: plainLead, obligations }).shape?.headline).toBe(chances[0]);
    const sentenceLead = [share, 'These are the chances in this model.', chances[0]!, chances[1]!].join('\n');
    expect(composeReplyShape({ text: sentenceLead, obligations }).shape?.headline).toBe(chances[0]);
  });

  it('R5 control: identical words without chance obligations → today’s byte-identical passthrough', () => {
    const c = composeReplyShape({ text });
    expect(c).toMatchObject({ outcome: 'already_in_shape', shape: null, text });
    expect(sentencesOf(c.text.split('\n')[0]!)[0]).toBe(share);
  });

  it('R5 evidence control: no lead marker retains today’s byte-identical behaviour', () => {
    const c = composeReplyShape({ text, obligations: chances.map(text => ({ role: 'evidence', text })) });
    expect(c).toMatchObject({ outcome: 'already_in_shape', shape: null, text });
  });

  it('R6: chance first, share later → chance headline; existing bullet order is unchanged', () => {
    const points = ['Check the assumptions.', 'Keep the evidence visible.', share];
    const reordered = [chances[0]!, ...points.map(p => `- ${p}`)].join('\n');
    const c = composeReplyShape({ text: reordered, obligations });
    expect(c.shape!.headline).toBe(chances[0]);
    expect(c.shape!.bullets).toEqual(points);
    assertDerivation(reordered, c);
  });

  it('R8 (Codex r1 P1 #2783): a bullet carrying the share AND a chance never leads; its own-unit control does', () => {
    const mixed = [`- ${share} ${chances[1]}`, '- Check the assumptions.', '- Keep the evidence visible.', chances[0]].join('\n');
    const c = composeReplyShape({ text: mixed, obligations });
    expect(c.shape?.headline ?? '', 'the share-led bullet is not the headline').not.toContain(share);
    expect(c.shape?.headline, 'the chance standing as its own unit leads').toBe(chances[0]);
    const alone = [`- ${chances[1]}`, '- Check the assumptions.', '- Keep the evidence visible.'].join('\n');
    expect(composeReplyShape({ text: alone, obligations }).shape?.headline, 'control: a bullet that IS the chance leads').toBe(chances[1]);
  });

  it('R7: all-host Run → chance outranks the atomic ready headline; ready goes to detail', () => {
    const hostText = [RUN_RESULT_READY_TEXT, ...chances.slice(0, 2)].join('\n\n');
    const c = composeReplyShape({ text: hostText, obligations: [
      { role: 'host', text: RUN_RESULT_READY_TEXT }, ...obligations,
    ] });
    expect(c.shape!.headline).toBe(chances[0]);
    expect(c.shape!.bullets).toEqual([chances[1]]);
    expect(c.shape!.detail).toBe(RUN_RESULT_READY_TEXT);
    assertDerivation(hostText, c);
  });

  it('atomic two-sentence chance+depends outranks lead-in; other evidence, withheld reason and ask stay on face', () => {
    const chance = '‘Launch starter tier’: about 52% chance of meeting your goal, in this model.';
    const depends = 'It depends most on whether starter subscribers affect revenue at all, which Olumi assumed.';
    const joined = `${chance} ${depends}`;
    const reason = 'No single option can be put forward on this result yet.';
    const ask = 'Which assumption should we test first?';
    const second = '‘Raise prices 10%’: about 16% chance of meeting your goal, in this model.';
    const atomicText = [share, 'For your goal, on current information:', joined, second, reason, ask].join('\n');
    const c = composeReplyShape({ text: atomicText, obligations: [
      { role: 'evidence', text: joined, lead: true },
      { role: 'evidence', text: chance, lead: true }, { role: 'evidence', text: depends },
      { role: 'evidence', text: second, lead: true },
      { role: 'withheld_reason', text: reason }, { role: 'ask', text: ask },
    ] });
    // The lead-in travels with the first chance finding (DL, composed texts 8 Oct): it still introduces the list.
    expect(c.shape!.headline).toBe(`For your goal, on current information:\n${joined}`);
    expect(c.shape!.bullets).toEqual([second, reason, ask]);
    expect(c.shape!.detail).toContain(share);
    assertDerivation(atomicText, c);
  });

  it('a typed chance absent from final text does not change the no-chance path', () => {
    const noChance = `${share} Check the assumptions before relying on these runs.`;
    expect(composeReplyShape({ text: noChance, obligations })).toEqual(composeReplyShape({ text: noChance }));
  });
});
