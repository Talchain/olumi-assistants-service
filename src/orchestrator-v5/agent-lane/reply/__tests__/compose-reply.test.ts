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
import { noLeaderBecauseSentences } from '../../withheld-leader-fail-closed.js';
import { chanceGoalDeadlineAsk, chanceGoalSentence } from '../../../goal-target/goal-kind.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scalingRatio } from '../../../../../tests/helpers/scaling-ratio.js';
import {
  composeReplyShape, sentencesOf, sentenceMultiset, REPLY_FACE_MAX_BULLETS, REPLY_SHAPE_INSTRUCTION,
  HORIZON_MARKER, ROBUSTNESS_MARKER, WIDENED_RISK_MARKER,
  type ReplyComposition, type FaceObligation,
} from '../compose-reply.js';
import { deriveAnswerTextFromShape } from '../../../routing/answer-shape.js';
import { openQuestionsSegment, textAtRest, untestedHorizonLine } from '../../decision-input-ask.js';

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
  it('coaching: the long reply is shaped (≤3 bullets, ≤80 face words)', () => {
    const c = composeReplyShape({ text: T1, profile: 'coaching' });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets.length).toBeLessThanOrEqual(3);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
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

describe('the AIE face budget (#87 6037293086 §5–7): ≤80 initial words, one ask; a challenge is never deleted', () => {
  const S = (i: number) => `Point ${i} names a different assumption in the hiring model that the deadline rests on.`;
  it('a reply within 80 words and one question ships whole, byte-identical (raw = shown)', () => {
    const text = `${S(1)} ${S(2)} ${S(3)} ${S(4)} Which do you trust least?`;
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(80);
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
  it('the face fills to ≤80 words: long points stop the fill before the cap; a challenge left over sits in detail, kept', () => {
    const long = (i: number) => `Challenge ${i}: the model assumes two developers ramp up as fast as a tech lead, but onboarding a pair usually takes longer and costs the existing team more of its own delivery time than one senior hire does.`;
    const text = `The comparison rests on ramp-up time. ${long(1)} ${long(2)} ${long(3)} What ramp-up do you expect?`;
    const c = composeReplyShape({ text });
    expect(c.outcome).toBe('shaped');
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
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
    // The global budget is now 80; keep this selector fixture outside the already-in-shape branch.
    const text = `${NARRATOR} Evidence should support the recorded assumptions. Which option feels closest to your plan?\n\n${ASK}`;
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
    // Keep the untyped selector control outside the newly allowed 80-word passthrough.
    const arithmetic = `${ARITHMETIC} The assumptions remain available for review.`;
    const text = `${IDENTITY}\n\n${arithmetic}`;
    expect(composeReplyShape({ text, obligations: [{ role: 'ask', text: IDENTITY }, { role: 'host', text: arithmetic }] }))
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
  const longContext = 'The model compares four options on twelve months of revenue. Each figure rests on the values in your model today. Several of those values are Olumi estimates rather than yours. Changing any estimate changes what this model implies. The analysis does not rank the options for you.';
  const faceOf = (c: ReturnType<typeof composeReplyShape>): string => [c.shape?.headline ?? c.text, ...(c.shape?.bullets ?? [])].join('\n');
  it('prefer the typed copy (Codex r1 P1-2): an earlier untyped copy goes; the typed multi-sentence unit stays whole on the face', () => {
    const typed = 'Revenue is £100. Churn is 5%.';
    const text = ['Revenue is £100.', longContext, typed].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'evidence', text: typed }] });
    expect(c.measure!.said_once_dropped).toEqual(['Revenue is £100.']);
    expect(faceOf(c)).toContain(typed);
  });
  it('prefer the typed copy (Codex r1 P1-2): a typed atomic statement + question keeps its question; the earlier loose copy goes', () => {
    const typed = 'The price link is not sized yet. How sure are you of that size?';
    const text = ['How sure are you of that size?', longContext, typed].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'evidence', text: typed }] });
    expect(c.measure!.said_once_dropped).toEqual(['How sure are you of that size?']);
    expect(faceOf(c)).toContain(typed);
  });
  it('Codex r2 P1: a colon frame never contains a typed finding away ("The following claim is false: …")', () => {
    const finding = 'The link is sized.';
    const text = [finding, longContext, 'The following claim is false: the link is sized.'].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'evidence', text: finding }] });
    expect(c.measure!.said_once_dropped).toEqual([]);
    expect(faceOf(c)).toContain(finding);
  });
  it('Codex r2 P1: an untyped container never carries part of a typed unit away; the typed unit stays whole on the face', () => {
    const typed = 'Revenue is £100. Churn is 5%.';
    const text = ['The baseline needs confirmation because revenue is £100.', longContext, typed].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'evidence', text: typed }] });
    expect(c.measure!.said_once_dropped).toEqual([]);
    expect(faceOf(c)).toContain(typed);
  });
  it('Codex r2 P1: an earlier typed HOST copy of a question never takes it from the typed ask (strongest role stays)', () => {
    const q = 'Which figure should we check first?';
    const askUnit = `The baseline is unconfirmed. ${q}`;
    const text = [`Ready. ${q}`, longContext, askUnit].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'host', text: `Ready. ${q}` }, { role: 'ask', text: askUnit }] });
    expect(faceOf(c).trimEnd().endsWith(q), faceOf(c)).toBe(true);
    expect(c.text.split(q)).toHaveLength(2);
  });
  it('Codex r3 P1: a typed host container never takes one sentence out of a typed multi-sentence evidence unit', () => {
    const typed = 'Revenue is £100. Churn is 5%.';
    const host = 'The baseline needs confirmation because revenue is £100.';
    const text = [host, longContext, typed].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'host', text: host }, { role: 'evidence', text: typed }] });
    expect(c.measure!.said_once_dropped).toEqual([]);
    expect(faceOf(c)).toContain(typed);
  });
  it('idempotent (Codex r1 P1-3): composing twice keeps the same face, the typed closing ask last both times', () => {
    const closing = 'HOW sure are you?';
    const text = [longContext, 'How sure are you?', 'Which assumption matters most?', closing].join('\n\n');
    const obligations = [{ role: 'ask' as const, text: closing }];
    const once = composeReplyShape({ text, obligations });
    const twice = composeReplyShape({ text: once.text, obligations });
    expect(twice.text).toBe(once.text);
    expect(faceOf(twice)).toBe(faceOf(once));
    expect(faceOf(once).trimEnd().endsWith(closing)).toBe(true);
  });
  it.each([
    ['negation', 'The link is sized.', 'It is not true that the link is sized.'],
    ['reported belief', 'Churn rises.', 'Nobody expects that churn rises.'],
    ['condition', 'The goal is met.', 'If the price holds, the goal is met.'],
  ])('a sentence inside another FRAME (%s) means something else: both are kept', (_why, short, framed) => {
    const filler = 'The model compares four options on twelve months of revenue. Each figure rests on the values in your model today. Several of those values are Olumi estimates rather than yours. Changing any estimate changes what this model implies.';
    const c = composeReplyShape({ text: `${short} ${filler} ${framed}` });
    expect(c.measure?.said_once_dropped ?? []).toEqual([]);
    expect(c.text).toContain(short);
    expect(c.text).toContain(framed);
  });
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
  const chanceIntro = 'This run doesn’t yet show each option’s chance of meeting your goal.';
  // These captured replies predate the words ruling. Project only their opening into today's no-graph producer form;
  // preserve the archived fixture and every reason, question and quote-restyling control.
  for (const key of ['explain_00_24_38', 'explain_00_30_46'] as const) {
    served[key] = served[key].replace(/This run doesn’t show how often each option reaches[^\n.]{1,80}\./gu, chanceIntro);
  }
  const context = 'Current estimates need evidence before anyone relies on this comparison for planning across teams. Recruitment takes time, and new starters may need the existing team to stop and help them. Capacity is only one part of the path from hiring to timely delivery of a release. The evidence should show how the new people affect work already planned for this quarter.';

  it.each([
    ['explain_00_24_38', served.explain_00_24_38],
    ['explain_00_30_46', served.explain_00_30_46],
  ])('P1 %s with the ROUTE’s typing (Codex r4: the gate types coHold.why WITHOUT its period): the standalone copy still goes', (_id, text) => {
    const why = served.withhold_sentence.replace(/\.$/, '');
    const c = composeReplyShape({ text, obligations: [
      { role: 'withheld_reason', text: served.no_leader_with_reason },
      { role: 'withheld_reason', text: why },
    ] });
    expect(count(c.text, served.withhold_sentence)).toBe(1);
    expect(c.measure!.said_once_dropped).toEqual([served.withhold_sentence]);
    everySentenceExceptReportedKept(text, c);
  });

  it.each([['plain', 'Option A', 'Option B'], ['markdown', '## Option A', '## Option B'], ['bold', '**Option A**', '**Option B**']])(
    'the same finding under two %s headings is two findings (Codex r6): both stay', (_form, a, b) => {
      const text = [a, '- Revenue may dip in month one.', b, '- Revenue may dip in month one.', '- Cash runs short in month three.', context].join('\n');
      const c = composeReplyShape({ text });
      expect(c.measure!.said_once_dropped).toEqual([]);
      expect(count(c.text, 'Revenue may dip in month one.')).toBe(2);
    });
  it.each([
    ['explain_00_24_38', served.explain_00_24_38],
    ['explain_00_30_46', served.explain_00_30_46],
  ])('P1 %s with the route’s IDENTITY typing of the gate’s closing (noLeaderBecauseSentences; Codex r6/r8): the standalone copy goes', (_id, text) => {
    const why = served.withhold_sentence.replace(/\.$/, '');
    const [closing] = noLeaderBecauseSentences({ why });
    expect(closing, 'the gate’s own words are the served bullet').toBe(served.no_leader_with_reason);
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: why }, { role: 'withheld_reason', text: closing! }] });
    expect(count(c.text, served.withhold_sentence)).toBe(1);
    expect(c.measure!.said_once_dropped).toEqual([served.withhold_sentence]);
    // control: with the closing untyped, nothing is contained away (an untyped frame never absorbs a typed finding)
    const untyped = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: why }] });
    expect(untyped.measure?.said_once_dropped ?? []).toEqual([]);
  });
  it('Codex r8 P1: a hypothetical frame never absorbs a typed fact', () => {
    const fact = 'The sources of this comparison’s factor starting values are unavailable.';
    const text = [fact, context, 'If that were true, we would need to pause because the sources of this comparison’s factor starting values are unavailable.'].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'evidence', text: fact }] });
    expect(c.measure!.said_once_dropped).toEqual([]);
    expect(c.text).toContain(fact);
  });

  it.each([['markdown with a period', '## Option A.', '## Option B.'], ['bold with a period', '**Option A.**', '**Option B.**'], ['sentence above a list', 'Option A.', 'Option B.']])(
    'repeated %s headings stay (Codex r7): a finding is never re-parented', (_form, a, b) => {
      const text = [a, '- Revenue may dip in month one.', b, '- Churn may rise above 4%.', a, '- Cash runs short in month three.', context].join('\n');
      const c = composeReplyShape({ text });
      expect(c.measure!.said_once_dropped).toEqual([]);
      const cash = c.text.indexOf('Cash runs short');
      expect(c.text.lastIndexOf(a, cash)).toBeGreaterThan(c.text.lastIndexOf(b, cash));
    });
  it.each([['straight', "isn't"], ['curly', 'isn’t']])('a %s contraction negates too (Codex r7): both stay', (_form, isnt) => {
    const reason = 'The price link is not sized.';
    const text = [reason, context, `The result ${isnt} withheld because the price link is not sized.`].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: reason }] });
    expect(c.measure!.said_once_dropped).toEqual([]);
    expect(c.text).toContain(reason);
  });
  it('a negated "because" denies the reason: both stay', () => {
    const reason = 'The price link is not sized.';
    const text = [reason, context, 'The result is not withheld because the price link is not sized.'].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: reason }] });
    expect(c.measure!.said_once_dropped).toEqual([]);
    expect(c.text).toContain(reason);
  });
  it.each([['colon', 'Option A:', 'Option B:'], ['plain', 'Option A', 'Option B'], ['markdown', '## Option A', '## Option B'], ['bold', '**Option A**', '**Option B**']])(
    'repeated %s headings stay (Codex r4/r5): a finding is never re-parented under another option', (_form, a, b) => {
      const text = [a, '- Revenue may dip in month one.', b, '- Churn may rise above 4%.', a, '- Cash runs short in month three.', context].join('\n');
      const c = composeReplyShape({ text });
      expect(c.measure!.said_once_dropped).toEqual([]);
      expect(count(c.text, a)).toBe(2);
      const cash = c.text.indexOf('Cash runs short');
      expect(c.text.lastIndexOf(a, cash)).toBeGreaterThan(c.text.lastIndexOf(b, cash));
    });

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
  ])('never-both + normalisation chain, %s: untyped prose loses only the equal copy; nothing is contained away', (_order, lines) => {
    const text = (lines as string[]).join('\n');
    const c = composeReplyShape({ text });
    // Untyped (Agent) prose loses only EXACT copies: the equal copy goes; containment never applies to it (Codex r2).
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset([largest, middle, smallest].join(' ')));
    expect(c.measure!.said_once_dropped).toEqual([equalSmallest]);
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
      // The leader gate's own closing (typed by the route): containment applies only between typed sentences.
      { role: 'withheld_reason', text: containing },
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

  it('an equal normalised earlier question goes; the TYPED closing ask survives in its own wording (prefer the typed copy)', () => {
    const first = 'How sure are you of “Revenue” *rising*?';
    const closing = '“HOW sure are you of Revenue  \t rising”?';
    const text = [context, first, closing].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'ask', text: closing }] });
    expect(['shaped', 'already_in_shape']).toContain(c.outcome);
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.text.trimEnd().endsWith(closing)).toBe(true);
    expect(c.text).not.toContain(first);
    expect(c.measure!.said_once_dropped).toEqual([first]);
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
    const containing = 'No option can be put forward yet, because the cost is uncertain.';
    const contained = 'The cost is uncertain.';
    const segment = `Questions this model does not answer yet:\n- ${contained}`;
    const text = [containing, context, contained, segment].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: contained, lead: true }, { role: 'withheld_reason', text: containing }] });
    expect(c.outcome).toBe('shaped');
    expect(c.reason).not.toBe('obligation_unlocated');
    expect(c.shape!.headline).toBe(containing);
    expect(c.measure!.obligations_on_face).toBe(1);
    expect(openQuestionsSegment(c.text)?.segment).toBe(segment);
    expect(count(c.text.toLowerCase(), contained.toLowerCase()), 'only the containing finding and protected segment carry the shorter copy').toBe(2);
    expect(c.measure!.said_once_dropped).toEqual([contained]);
    everySentenceExceptReportedKept(text, c);
  });

  it('Open Questions keeps its protected identity; an untyped "Saved:" frame never absorbs the lead (containment is typed-only)', () => {
    const lead = 'Revenue may fall.';
    const question = 'How sure are you?';
    const segment = `Questions this model does not answer yet: We need evidence. ${question}`;
    const after = `Saved: ${lead} ${context}`;
    const text = [lead, segment, after].join('\n\n');
    expect(openQuestionsSegment(text)?.segment, 'the input has a recognised protected segment').toBe(segment);
    const c = composeReplyShape({ text });
    expect(c.measure!.said_once_dropped).toEqual([]);
    expect(openQuestionsSegment(c.text)?.segment).toBe(segment);
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

  it('Codex r9 P1: two options sharing a qualification keep it each; only the shared QUESTION is asked once', () => {
    const qual = 'It rests most on the size you set: if that effect is weaker than that, the chance falls.';
    const q = 'How sure are you of that size?';
    const a = `‘Raise prices 10%’: about 47% chance of meeting your goal, in this model. ${qual} ${q}`;
    const b = `‘Launch starter tier’: about 34% chance of meeting your goal, in this model. ${qual} ${q}`;
    const text = [a, b, context].join('\n\n');
    const c = composeReplyShape({ text, obligations: [{ role: 'evidence', text: a, lead: true }, { role: 'evidence', text: b, lead: true }] });
    expect(count(c.text, qual), 'each option keeps its own qualification').toBe(2);
    expect(count(c.text, q), 'the shared question is asked once').toBe(1);
    expect(c.measure!.said_once_dropped).toEqual([q]);
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

describe('timing: every regex on the path scales linearly (20k -> 160k, min of 7 batches, ratio < 22x)', () => {
  // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793.
  // Measured locally 8 Oct: terminators 20k 0.19 ms -> 80k 0.69 ms -> 320k 2.74 ms per call (linear); CI read 8.32x once.
  const shapes: [string, (n: number) => string][] = [
    ['whitespace', (n) => `Lead.${' '.repeat(n)}Next. ${'\t'.repeat(n)}`],
    ['terminators', (n) => `${'.'.repeat(n)} A${'?'.repeat(n)}`],
    ['sentences and bullets', (n) => Array.from({ length: Math.ceil(n / 20) }, (_, i) => (i % 3 === 0 ? `- Point ${i} is here.` : `Sentence ${i} is here.`)).join('\n')],
  ];
  it.each(shapes)('%s', (_name, make) => {
    const small = make(20_000);
    const large = make(160_000);
    expect(large.length).toBeGreaterThanOrEqual(small.length * 3);
    const runLarge = (): void => { composeReplyShape({ text: large }); };
    const runSmall = (): void => { composeReplyShape({ text: small }); };
    const growth = scalingRatio(runSmall, runLarge);
    expect(growth.ratio, growth.detail).toBeLessThan(22);
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

describe('Draft contract: partial typed cause keeps punctuation and the card owns its question', () => {
  it.each(['prose', 'bullet'] as const)('partial typed withheld reason before terminal punctuation: %s detail conserves the exact source sentence', (kind) => {
    const headline = 'Olumi built your pricing model.';
    const why = "Olumi can't show each option’s chance because it doesn't have MRR's current level";
    const cardQuestion = 'Shall we check the current level?';
    const body = `${why}. The rest of this Run's results still stand. ${cardQuestion}`;
    const text = `${headline}\n\n${kind === 'bullet' ? '- ' : ''}${body}`;
    const c = composeReplyShape({ faceContract: 'draft', text, obligations: [{ role: 'withheld_reason', text: why, subjects: ['mrr→goal'] }],
      typedControlQuestions: [cardQuestion] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual([]);
    expect(c.shape!.detail).toBe(`${kind === 'bullet' ? '- ' : ''}${body}`);
    expect(c.shape!.detail).toContain(`${why}.`);
    expect(c.shape!.detail).not.toContain(`${why} .`);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(text));
    everySentenceKept(text, c.text);
  });

});

describe('ONE reply contract: typed controls own only their matching next step', () => {
  const headline = 'Olumi built your pricing model.';
  const question = 'Is that how you work it out?';
  const identity = `Olumi reads ‘MRR’ as plan price × paying subscribers. ${question}`;
  const context = 'The model records the price and subscriber assumptions, with evidence still needed to establish how many people would stay after a price increase.';

  it.each([
    ['question-only card', question],
    ['whole identity card', identity],
  ])('%s: the typed identity ask and its narrator echo move to detail; the card is N', (_name, cardQuestion) => {
    const text = [headline, `The reading needs your check. ${question} Please confirm on the button.`, context, identity].join('\n\n');
    const c = composeReplyShape({ faceContract: 'draft', text, obligations: [{ role: 'ask', text: identity }], typedControlQuestions: [cardQuestion] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual([]);
    expect(face(c).join('\n')).not.toContain(question);
    expect(c.shape!.detail).toContain(identity);
    expect(c.shape!.detail).toContain('Please confirm on the button.');
    expect(c.text.split(question)).toHaveLength(2);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceExceptReportedKept(text, c);
  });

  it.each([false, true])('typed chance with a card question: chance and own note remain H; matching question detail (another ask = %s)', (anotherAsk) => {
    const chance = 'Price rise: 47% chance. It depends on subscribers staying after the price increase.';
    const cardQuestion = 'Shall we confirm?';
    const finding = `${chance} ${cardQuestion}`;
    const ask = 'Which assumption should we check first?';
    const text = [finding, context, ...(anotherAsk ? [ask] : [])].join('\n\n');
    const c = composeReplyShape({ faceContract: 'draft', text, obligations: [
      { role: 'evidence', text: finding, lead: true, subjects: ['price'] },
      ...(anotherAsk ? [{ role: 'ask' as const, text: ask }] : []),
    ], typedControlQuestions: [cardQuestion] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual(anotherAsk ? [ask] : []);
    expect(face(c).join('\n')).not.toContain(cardQuestion);
    expect(c.shape!.detail).toContain(cardQuestion);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceKept(text, c.text);
  });

  it('a question-bearing ordinary bullet: only its question is N; the preceding host sentence stays in detail', () => {
    const ask = 'Which assumption should we check first?';
    const prefix = 'We should check the recorded assumptions before relying on this result.';
    // Long enough that the contract shapes it (a reply already within the face ships whole, as on staging).
    const longer = Array.from({ length: 12 }, (_, i) => `Supporting point ${i + 1} explains one more part of the model in plain words.`).join(' ');
    const text = `${headline}\n- ${prefix} ${ask}\n\n${context}\n\n${longer}`;
    const c = composeReplyShape({ faceContract: 'draft', text });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual([ask]);
    expect(c.shape!.detail).toContain(prefix);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceKept(text, c.text);
  });

  it('a different typed control cannot hide the last host ask: it is the one N on the face', () => {
    const ask = 'Which assumption should we check first?';
    const text = [headline, context, identity, ask].join('\n\n');
    const c = composeReplyShape({ faceContract: 'draft', text, obligations: [{ role: 'ask', text: identity }, { role: 'ask', text: ask }],
      typedControlQuestions: [question] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual([ask]);
    expect(c.shape!.detail).toContain(identity);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceKept(text, c.text);
  });
});

describe('ONE reply contract: R4 licensed Run order, budget demotion and R5 typed science exceptions', () => {
  const estimatesLine = "Olumi's estimates: 5, see Check estimates.";
  const whatChanges = 'Changing churn would change these chances most.';
  const ask = 'Which assumption should we check first?';
  const context = 'The model retains all the assumptions and evidence behind these figures so the team can examine them before using the comparison in its planning.';
  const shortChances = ['Starter tier: 34% chance.', 'Price rise: 47% chance.'];
  const longChances = shortChances.map(line => `${line} This rests on how many subscribers stay after launch, at today’s estimated churn, and on whether the current price assumption is supported by the evidence available to the team.`);
  const compose = (chances: string[], change = whatChanges) => {
    const text = [...chances, context, ask].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, whatChanges: change, estimatesLine, profile: 'coaching', obligations: [
      ...chances.map((text, index) => ({ role: 'evidence' as const, text, lead: true as const, subjects: [`option-${index}`] })),
      { role: 'ask', text: ask },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset([text, change, estimatesLine].join('\n\n')));
    return c;
  };

  it('R4 licensed Run: atomic chances, then W, then E, then exactly one N; face ≤80', () => {
    const c = compose(shortChances);
    expect(c.shape!.headline).toBe(shortChances[0]);
    expect(c.shape!.bullets).toEqual([shortChances[1], whatChanges, estimatesLine, ask]);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
    expect(c.shape!.detail).toBe(context);
  });

  it('guided Run finding leads beside a shown chance, owns N, and leaves progress and other asks in detail', () => {
    const guided = "The chance isn't shown yet: the model doesn't yet say how strongly ‘A’ affects ‘B’, so any figure would be a guess. Give a rough strength for it to see the chance.";
    const reason = 'The goal target needs a starting level.';
    const progress = '2 more to go.';
    const chance = shortChances[0]!;
    const text = [chance, reason, guided, progress, context, ask].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'withheld_reason', text: reason },
      { role: 'withheld_reason', text: guided, lead: true, ownsNextStep: true },
      { role: 'host', text: progress },
      { role: 'ask', text: ask },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(guided);
    expect(c.shape!.bullets).toEqual([chance]);
    expect(c.shape!.detail).toContain(progress);
    expect(c.shape!.detail).toContain(reason);
    expect(c.shape!.detail).toContain(ask);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
    expect(c.text.split(guided)).toHaveLength(2);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceKept(text, c.text);
  });

  it('R4 separate typed chance note: its own companion stays adjacent; a companion of another chance goes to detail', () => {
    const chance = shortChances[0]!;
    const ownNote = 'This depends on subscriber retention after launch.';
    const otherNote = 'This spread applies to the separate price rise option.';
    const text = [chance, context, ownNote, otherNote, ask].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, whatChanges, estimatesLine, obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'evidence', text: ownNote, companionOf: 'starter' },
      { role: 'evidence', text: otherNote, companionOf: 'price' },
      { role: 'ask', text: ask },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual([ownNote, whatChanges, estimatesLine, ask]);
    expect(c.shape!.detail).not.toContain(ownNote);
    expect(c.shape!.detail).toContain(otherNote);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset([text, whatChanges, estimatesLine].join('\n\n')));
  });

  it('R4 own note also typed as a caveat: overlapping roles cannot demote the chance’s own note', () => {
    const chance = longChances[0]!;
    const ownNote = `${context} The range keeps every uncertainty in view, including how subscribers respond, how quickly those responses appear, and whether the evidence supports the recorded causal relationship between the price change and retention.`;
    const text = [chance, ownNote, ask].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, whatChanges, estimatesLine, obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'evidence', text: ownNote, companionOf: 'starter' },
      { role: 'caveat', text: ownNote, subjects: ['starter'] },
      { role: 'ask', text: ask },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual([ownNote, ask]);
    expect(c.shape!.detail).not.toContain(ownNote);
    expect(c.shape!.detail).toContain(whatChanges);
    expect(c.shape!.detail).toContain(estimatesLine);
    expect(c.measure!.face_words).toBeGreaterThan(80);
    expect(c.measure!.face_over_word_budget).toBe(true);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset([text, whatChanges, estimatesLine].join('\n\n')));
  });

  it('R4 over budget: E goes to detail first; W and each chance’s own note stay on the face', () => {
    const c = compose(longChances);
    expect(c.shape!.headline).toBe(longChances[0]);
    expect(c.shape!.bullets).toEqual([longChances[1], whatChanges, ask]);
    expect(c.shape!.detail).toContain(estimatesLine);
    expect(c.shape!.detail).not.toContain(whatChanges);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
  });

  it('R4 over budget after E: W goes to detail next; H, chance notes and N never move', () => {
    const longChange = 'Changing churn and the recorded price response would change these chances most.';
    const c = compose(longChances, longChange);
    expect(c.shape!.headline).toBe(longChances[0]);
    expect(c.shape!.bullets).toEqual([longChances[1], ask]);
    expect(c.shape!.detail).toContain(estimatesLine);
    expect(c.shape!.detail).toContain(longChange);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
  });

  it('R4 irreducible H plus N: over 80 words still ships its face and counts face_over_word_budget', () => {
    const irreducibleChance = `${longChances[0]} The uncertainty remains part of this chance finding and cannot be hidden from the team when they read this result. This finding retains the full range of possible subscriber responses, the time needed for any changes to appear, and the uncertainty about whether the available evidence supports the current causal relationship.`;
    const c = compose([irreducibleChance]);
    expect(c.shape!.headline).toBe(irreducibleChance);
    expect(c.shape!.bullets).toEqual([ask]);
    expect(c.measure!.face_words).toBeGreaterThan(80);
    expect(c.measure!.face_over_word_budget).toBe(true);
    expect(c.shape!.detail).toContain(estimatesLine);
    expect(c.shape!.detail).toContain(whatChanges);
  });

  it.each([
    ['same subject', 'starter', true],
    ['another subject', 'price', false],
  ])('R5 science exception: firmness disclosure with %s %s faces only by typed identity', (_name, subject, matches) => {
    const chance = 'Starter tier: 34% chance.';
    const firmness = 'This chance is provisional because its churn input is estimated.';
    const text = [chance, context, firmness, ask].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, profile: 'coaching', obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'caveat', text: firmness, subjects: [subject] },
      { role: 'ask', text: ask },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual(matches ? [firmness, ask] : [ask]);
    expect(c.shape!.detail.includes(firmness)).toBe(!matches);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(text));
  });

  it('R5 over budget: matching firmness is mandatory after E and W demote, with chance-owned notes', () => {
    const firmness = 'These chances are provisional because the current churn input is estimated and still needs independent evidence.';
    const text = [...longChances, context, firmness, ask].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, whatChanges, estimatesLine, obligations: [
      ...longChances.map((text, index) => ({ role: 'evidence' as const, text, lead: true as const, subjects: [`option-${index}`] })),
      { role: 'caveat', text: firmness, subjects: ['option-0'] },
      { role: 'ask', text: ask },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(longChances[0]);
    expect(c.shape!.bullets).toEqual([firmness, longChances[1], ask]);
    for (const line of [estimatesLine, whatChanges]) expect(c.shape!.detail).toContain(line);
    expect(c.shape!.detail).not.toContain(firmness);
    expect(c.measure!.face_words).toBeGreaterThan(80);
    expect(c.measure!.face_over_word_budget).toBe(true);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
  });
});



describe('r2 scope and mandatory horizon units', () => {
  const chance = 'Starter tier: 34% chance.';
  const chance2 = 'Price rise: 47% chance.';
  const horizonLine = "These chances use the model's numbers as they are today; the model doesn't project how they change over time yet.";
  const ask = 'Which assumption should we check first?';
  const whatChanges = 'Changing churn would change these chances most.';
  const estimatesLine = "Olumi's estimates: 5, see Check estimates.";

  it('ordinary converse keeps its lead and three bullets on the face; typed contract inputs cannot opt it in', () => {
    const headline = 'The main risks are retention, hiring delays and support costs.';
    const bullets = ['Check whether subscribers stay after the price rise.', 'Test the hiring lead time against recent evidence.', 'Check whether support costs grow with each subscriber.'];
    const detail = 'The team should retain its evidence and uncertainty for every assumption so it can later compare expectations with observed outcomes and learn from the result. Each participant can contribute a different interpretation, challenge unsupported claims, and identify which evidence would most improve the shared reasoning.';
    const text = [headline, ...bullets.map(line => `- ${line}`), '', detail].join('\n');
    const c = composeReplyShape({ text, estimatesLine, whatChanges, horizonLine, typedControlQuestions: [bullets[2]!] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual(bullets);
    expect(c.shape!.detail).toBe(detail);
    expect(c.text).not.toContain(estimatesLine);
    expect(c.text).not.toContain(whatChanges);
    expect(c.text).not.toContain(horizonLine);
    everySentenceKept(text, c.text);
  });

  it.each([false, true])('Run binds the horizon marker after chances and own notes, with the full sentence once in detail (existing = %s)', existing => {
    const ownNote = 'This depends on subscribers staying after launch.';
    const context = 'The team retains the assumptions and evidence behind the figures for later review.';
    const text = [chance, chance2, ownNote, context, ...(existing ? [horizonLine] : []), ask].join('\n\n');
    const c = composeReplyShape({ text, faceContract: 'run', horizonLine, whatChanges, estimatesLine, obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'evidence', text: chance2, lead: true, subjects: ['price'] },
      { role: 'evidence', text: ownNote, companionOf: 'price' },
      { role: 'ask', text: ask },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(chance);
    expect(HORIZON_MARKER).toBe("At today's numbers; not projected forward yet");
    expect(c.shape!.bullets).toEqual([chance2, ownNote, HORIZON_MARKER, whatChanges, estimatesLine, ask]);
    expect(face(c).join('\n')).not.toContain(horizonLine);
    expect(c.shape!.detail.split(horizonLine)).toHaveLength(2);
    expect(c.text.split(horizonLine)).toHaveLength(2);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset([text, ...(existing ? [] : [horizonLine]), HORIZON_MARKER, whatChanges, estimatesLine].join('\n\n')));
  });

  it('short horizon marker lets the chance frame stay at 79 words; matched notes stay face and optional E/W move to detail', () => {
    const frame = 'For your goal, on current information:';
    const finding = `${chance} It rests on how many subscribers stay after launch and whether the current estimate represents the evidence available to the team.`;
    const ownNote = 'The range retains each uncertainty about subscriber response, delivery timing and the available evidence behind the relationship.';
    const firmness = 'This chance is provisional because its churn input is estimated and still needs independent evidence from the team.';
    const text = [frame, finding, ownNote, firmness, ask].join('\n\n');
    const c = composeReplyShape({ text, faceContract: 'run', horizonLine, whatChanges, estimatesLine, obligations: [
      { role: 'evidence', text: finding, lead: true, subjects: ['starter'] },
      { role: 'evidence', text: ownNote, companionOf: 'starter' },
      { role: 'caveat', text: firmness, subjects: ['starter'] },
      { role: 'ask', text: ask },
    ] });
    expect(c.outcome).toBe('shaped');
    expect([c.shape!.headline, ...c.shape!.bullets]).toEqual([`${frame}\n${finding}`, ownNote, firmness, HORIZON_MARKER, ask]);
    expect(face(c).join('\n')).not.toContain(horizonLine);
    expect(c.shape!.detail.split(horizonLine)).toHaveLength(2);
    for (const line of [estimatesLine, whatChanges]) expect(c.shape!.detail).toContain(line);
    expect(c.shape!.detail).not.toContain(frame);
    expect(c.measure!.face_words).toBe(79);
    expect(c.measure!.face_over_word_budget).toBe(false);
    expect(c.text.split(horizonLine)).toHaveLength(2);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceKept(text, c.text);
  });

  it('a draft without a chance cannot synthesize the short horizon form', () => {
    const c = composeReplyShape({ text: 'I mapped your strategy.', faceContract: 'draft', horizonLine });
    // Already the whole face: shipped as written, with no horizon line added.
    expect(c.outcome).toBe('already_in_shape');
    expect(c.text).toBe('I mapped your strategy.');
    expect(c.text).not.toContain(horizonLine);
  });
});

describe('r5 progressive disclosure: typed markers stay beside their figures and full notes stay once in detail', () => {
  const chance = 'Starter tier: 34% chance.';
  const chance2 = 'Price rise: 47% chance.';
  const chance3 = 'Keep pricing as it is: less than 1% chance.';
  const fullHorizon = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £20,000 within 12 months.";
  const shortHorizon = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet.";
  const pluralHorizon = "These chances use the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £20,000 within 12 months.";
  const context = 'The model retains the assumptions, evidence and uncertainty behind each figure for later review by the team.';
  const ask = 'Which assumption should we check first?';
  const count = (text: string, sentence: string) => text.split(sentence).length - 1;
  const assertDisclosure = (c: ReplyComposition, marker: string, full: string) => {
    expect(c.outcome).toBe('shaped');
    expect(count(face(c).join('\n'), marker), 'the exact marker is must-face once').toBe(1);
    expect(face(c).join('\n'), 'the full sentence is under More detail').not.toContain(full);
    expect(count(c.shape!.detail, full), 'the full sentence is verbatim once in detail').toBe(1);
    expect(count(c.text, full)).toBe(1);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
  };

  it.each([
    ['B1 single chance / FULL', [chance], fullHorizon, 12],
    ['B1 single chance / SHORT', [chance], shortHorizon, undefined],
    ['T1b plural chances / FULL', [chance, chance2, chance3], pluralHorizon, 12],
  ] as const)('%s: one marker follows the chance lines; full horizon moves to detail; face stays under the old 137 words', (_row, chances, full, months) => {
    const graph = { nodes: [{ id: 'goal', kind: 'goal', label: 'MRR', goal_threshold_raw: 20000, goal_threshold_unit: '£/month',
      ...(months === undefined ? {} : { goal_horizon_months: months }) }], edges: [] };
    expect(untestedHorizonLine(graph, { besideChance: true, plural: chances.length > 1 })).toBe(full);
    const c = composeReplyShape({ faceContract: 'run', text: [...chances, context, ask].join('\n\n'), horizonLine: full,
      obligations: [...chances.map((text, index) => ({ role: 'evidence' as const, text, lead: true as const, subjects: [`option-${index}`] })),
        { role: 'ask', text: ask }] });
    expect(HORIZON_MARKER).toBe("At today's numbers; not projected forward yet");
    expect(c.shape!.headline).toBe(chances[0]);
    expect(c.shape!.bullets).toEqual([...chances.slice(1), HORIZON_MARKER, ask]);
    assertDisclosure(c, HORIZON_MARKER, full);
    expect(c.measure!.face_words).toBeLessThanOrEqual(80);
    expect(c.measure!.face_words).toBeLessThan(137);
  });

  it.each([
    ['missing_current_level', "Not shown: MRR's current level is missing"],
    ['unconfirmed_identity', "Not shown: how MRR is worked out isn't confirmed"],
    ['unsized_links', "Not shown: some relationships aren't sized yet"],
    ['no_target', 'Not shown: no target figure yet'],
    ['other', 'Not shown yet; why is under More detail'],
  ] as const)('R3 withheld Run: typed %s cause supplies the exact marker, independently of the note words', (cause, marker) => {
    // The note deliberately does not provide the marker noun phrase: the typed source owns that choice.
    const note = 'This figure cannot be shown from the current model; the recorded inputs need your check.';
    const c = composeReplyShape({ faceContract: 'run', text: [chance, context, note, ask].join('\n\n'), obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['mrr'] },
      { role: 'withheld_reason', text: note, subjects: ['mrr'], disclosure: { kind: 'withhold', cause, goalLabel: 'MRR' } },
      { role: 'ask', text: ask },
    ] });
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual([marker, ask]);
    assertDisclosure(c, marker, note);
  });

  it('a typed withheld note for another subject stays in detail without a face marker', () => {
    const note = 'The other goal has no recorded current level yet.';
    const c = composeReplyShape({ faceContract: 'run', text: [chance, context, note, ask].join('\n\n'), obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['mrr'] },
      { role: 'withheld_reason', text: note, subjects: ['cost'], disclosure: { kind: 'withhold', cause: 'missing_current_level', goalLabel: 'Cost' } },
      { role: 'ask', text: ask },
    ] });
    expect(c.shape!.bullets).toEqual([ask]);
    expect(c.shape!.detail).toContain(note);
    expect(c.text).not.toContain("Not shown: Cost's current level is missing");
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
  });

  it('firmness uses the typed source figure as written and sits immediately after its matched chance', () => {
    const note = "The chance may look firmer because an Olumi estimate is used as exact; 99% is a different figure mentioned in this explanation.";
    const marker = "May look firmer: uses Olumi's 5% as exact";
    const c = composeReplyShape({ faceContract: 'run', text: [chance, chance2, context, note, ask].join('\n\n'), obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'evidence', text: chance2, lead: true, subjects: ['price'] },
      { role: 'caveat', text: note, subjects: ['starter'], disclosure: { kind: 'firmness', figure: '5%' } },
      { role: 'ask', text: ask },
    ] });
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual([marker, chance2, ask]);
    assertDisclosure(c, marker, note);
    expect(c.text).not.toContain("May look firmer: uses Olumi's 99% as exact");
  });

  it('matching firmness marker is mandatory when optional estimates and what-changes demote', () => {
    const finding = `${chance} The chance retains the uncertainty in subscriber response and the causal relationship to revenue, and it still depends on how quickly the team can deliver the recorded strategy under the current hiring assumptions and available evidence. The team needs evidence for each of these assumptions before treating the finding as reliable.`;
    const note = 'The current churn estimate is treated as exact by this run; that makes this chance look firmer than the evidence supports.';
    const marker = "May look firmer: uses Olumi's 5% as exact";
    const estimatesLine = "Olumi's estimates: 5, see Check estimates.";
    const whatChanges = 'Changing the churn assumption and the price response could substantially change this chance of meeting the goal.';
    const c = composeReplyShape({ faceContract: 'run', text: [finding, context, note, ask].join('\n\n'), estimatesLine, whatChanges, obligations: [
      { role: 'evidence', text: finding, lead: true, subjects: ['starter'] },
      { role: 'caveat', text: note, subjects: ['starter'], disclosure: { kind: 'firmness', figure: '5%' } },
      { role: 'ask', text: ask },
    ] });
    expect(c.shape!.bullets).toEqual([marker, ask]);
    for (const optional of [estimatesLine, whatChanges]) expect(c.shape!.detail).toContain(optional);
    assertDisclosure(c, marker, note);
  });

  it('robustness exports the single user-specified marker and moves the full caveat once to detail', () => {
    const note = 'The result is not yet robust — small changes could flip it.';
    const c = composeReplyShape({ faceContract: 'run', text: [chance, context, note, ask].join('\n\n'), obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'caveat', text: note, subjects: ['starter'], disclosure: { kind: 'robustness' } },
      { role: 'ask', text: ask },
    ] });
    expect(ROBUSTNESS_MARKER).toBe('Not yet robust: small changes could flip it');
    expect(c.shape!.bullets).toEqual([ROBUSTNESS_MARKER, ask]);
    assertDisclosure(c, ROBUSTNESS_MARKER, note);
  });

  it('quote-restyled typed disclosure still supplies its marker and retains the note glyphs as written', () => {
    const typed = 'The chance is withheld because ‘MRR’ has no recorded current level.';
    const written = typed.replace(/[‘’]/g, "'");
    const marker = "Not shown: MRR's current level is missing";
    const c = composeReplyShape({ faceContract: 'run', text: [chance, context, written, ask].join('\n\n'), obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['mrr'] },
      { role: 'withheld_reason', text: typed, subjects: ['mrr'], disclosure: { kind: 'withhold', cause: 'missing_current_level', goalLabel: 'MRR' } },
      { role: 'ask', text: ask },
    ] });
    expect(c.shape!.bullets).toEqual([marker, ask]);
    assertDisclosure(c, marker, written);
    expect(c.text).not.toContain(typed);
  });

  it('robustness with only the second chance subject follows that chance, not the first', () => {
    const note = 'The result is not yet robust — small changes could flip it.';
    const c = composeReplyShape({ faceContract: 'run', text: [chance, chance2, context, note, ask].join('\n\n'), obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'evidence', text: chance2, lead: true, subjects: ['price'] },
      { role: 'caveat', text: note, subjects: ['price'], disclosure: { kind: 'robustness' } },
      { role: 'ask', text: ask },
    ] });
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual([chance2, ROBUSTNESS_MARKER, ask]);
    assertDisclosure(c, ROBUSTNESS_MARKER, note);
  });

  it('overlapping typed withheld cause and closing keep the complete closing once, without an orphan or extra fragment', () => {
    const cause = 'some relationships are not sized yet';
    const closing = `No single option can be put forward yet, because ${cause}.`;
    const marker = "Not shown: some relationships aren't sized yet";
    const text = [closing, context].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, obligations: [
      { role: 'withheld_reason', text: cause, lead: true, subjects: ['mrr→goal'], disclosure: { kind: 'withhold', cause: 'unsized_links' } },
      { role: 'withheld_reason', text: closing, subjects: ['mrr→goal'], disclosure: { kind: 'withhold', cause: 'unsized_links' } },
    ] });
    expect(c.shape, c.reason).not.toBeNull();
    expect(c.shape!.headline).toBe(marker);
    expect(count(face(c).join('\n'), marker)).toBe(1);
    expect(face(c).join('\n')).not.toContain(closing);
    expect(count(c.shape!.detail, closing)).toBe(1);
    expect(count(c.shape!.detail, cause), 'only the cause inside its complete closing remains').toBe(1);
    expect(c.text).not.toContain('because .');
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceExceptReportedKept([text, marker].join('\n\n'), c);
  });

  it('a lone partial typed cause moves its complete containing sentence to detail without rewriting its syntax', () => {
    const cause = 'some relationships are not sized yet';
    const closing = `No single option can be put forward yet, because ${cause}.`;
    const marker = "Not shown: some relationships aren't sized yet";
    const text = [closing, context].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, obligations: [
      { role: 'withheld_reason', text: cause, lead: true, subjects: ['mrr→goal'], disclosure: { kind: 'withhold', cause: 'unsized_links' } },
    ] });
    expect(c.shape, c.reason).not.toBeNull();
    expect(c.shape!.headline).toBe(marker);
    expect(count(face(c).join('\n'), marker)).toBe(1);
    expect(face(c).join('\n')).not.toContain(closing);
    expect(count(c.shape!.detail, closing)).toBe(1);
    expect(count(c.shape!.detail, cause)).toBe(1);
    expect(c.text).not.toContain('because .');
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceExceptReportedKept([text, marker].join('\n\n'), c);
  });
  it.each(['withhold', 'firmness'] as const)('a matched %s marker precedes the chance companion immediately after the figure', kind => {
    const companion = 'This chance also carries the recorded spread in subscriber outcomes.';
    const note = kind === 'firmness'
      ? 'The churn input is held as an exact Olumi estimate in this Run.'
      : 'The alternate result cannot be shown until the missing current level is provided.';
    const disclosure: NonNullable<FaceObligation['disclosure']> = kind === 'firmness'
      ? { kind: 'firmness', figure: '5%' }
      : { kind: 'withhold', cause: 'missing_current_level', goalLabel: 'MRR' };
    const marker = kind === 'firmness'
      ? "May look firmer: uses Olumi's 5% as exact"
      : "Not shown: MRR's current level is missing";
    const c = composeReplyShape({ faceContract: 'run', text: [chance, context, companion, note, ask].join('\n\n'), obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'evidence', text: companion, companionOf: 'starter', subjects: ['starter'] },
      { role: kind === 'firmness' ? 'caveat' : 'withheld_reason', text: note, subjects: ['starter'], disclosure },
      { role: 'ask', text: ask },
    ] });
    expect(c.shape, c.reason).not.toBeNull();
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual([marker, companion, ask]);
    assertDisclosure(c, marker, note);
    expect(c.shape!.detail).not.toContain(companion);
    expect(count(c.text, companion)).toBe(1);
  });

  it('a robustness note whose typed subject has no face figure stays in detail without synthesising a marker', () => {
    const note = 'The result is not yet robust — small changes could flip it.';
    const text = [chance, context, note, ask].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, obligations: [
      { role: 'evidence', text: chance, lead: true, subjects: ['starter'] },
      { role: 'caveat', text: note, subjects: ['unshown-option'], disclosure: { kind: 'robustness' } },
      { role: 'ask', text: ask },
    ] });
    expect(c.shape, c.reason).not.toBeNull();
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual([ask]);
    expect(c.text).not.toContain(ROBUSTNESS_MARKER);
    expect(face(c).join('\n')).not.toContain(note);
    expect(count(c.shape!.detail, note)).toBe(1);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceExceptReportedKept(text, c);
  });

});

describe('r5 P05b widening inputs use the typed Draft/Run contract', () => {
  const headline = 'Olumi built your pricing model.';
  const chance = 'Starter tier: 34% chance.';
  const context = 'The model retains its existing assumptions and evidence so the team can review the whole strategic framing before relying on a result.';
  const widenedLine = 'Olumi added 3 risks and 2 ideas to widen the model.';
  const widenedRiskNote = 'The 3 risks Olumi added are not included in this chance of meeting your goal.';
  const count = (text: string, sentence: string) => text.split(sentence).length - 1;

  it('draft: widenedLine is mandatory immediately after H; widenedRiskNote is once in detail', () => {
    const c = composeReplyShape({ faceContract: 'draft', text: [headline, context].join('\n\n'), widenedLine, widenedRiskNote });
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual([widenedLine]);
    expect(c.shape!.detail).toContain(widenedRiskNote);
    expect(face(c).join('\n')).not.toContain(widenedRiskNote);
    expect(count(c.text, widenedLine)).toBe(1);
    expect(count(c.shape!.detail, widenedRiskNote)).toBe(1);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
  });

  it('run: widenedLine goes to detail; the added-risks marker is must-face after chances, full note once in detail', () => {
    const c = composeReplyShape({ faceContract: 'run', text: [chance, context].join('\n\n'), widenedLine, widenedRiskNote,
      obligations: [{ role: 'evidence', text: chance, lead: true, subjects: ['starter'] }] });
    expect(WIDENED_RISK_MARKER).toBe("Olumi's added risks aren't in this chance");
    expect(c.shape!.headline).toBe(chance);
    expect(c.shape!.bullets).toEqual([WIDENED_RISK_MARKER]);
    for (const line of [widenedLine, widenedRiskNote]) {
      expect(face(c).join('\n')).not.toContain(line);
      expect(count(c.shape!.detail, line)).toBe(1);
    }
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
  });

  it('no contract: widening inputs are ignored and the text stays byte-identical', () => {
    const text = 'The strategy needs more evidence.';
    const c = composeReplyShape({ text, widenedLine, widenedRiskNote });
    expect(c).toMatchObject({ text, shape: null, outcome: 'already_in_shape' });
    expect(c).toEqual(composeReplyShape({ text }));
  });

  it('draft over budget: widenedLine never demotes when W/E go to detail', () => {
    const longHeadline = `${headline} The model keeps the team's strategic assumptions, causal relationships, evidence, disagreements and uncertainty visible for careful review before any recommendation can be relied on, while preserving the different contributions and expected outcomes that people will later compare with what actually happens. Participants can challenge the assumptions and preserve different interpretations while they test the evidence behind the strategy.`;
    const c = composeReplyShape({ faceContract: 'draft', text: [longHeadline, context].join('\n\n'), widenedLine,
      obligations: [{ role: 'evidence', text: longHeadline, lead: true, subjects: ['strategy'] }],
      whatChanges: 'Changing the current subscriber assumption would change the projected revenue the most.',
      estimatesLine: "Olumi's estimates: 5, see Check estimates." });
    expect(c.shape!.headline).toBe(longHeadline);
    expect(c.shape!.bullets[0]).toBe(widenedLine);
    expect(c.shape!.detail).not.toContain(widenedLine);
    expect(c.shape!.detail).toContain("Olumi's estimates: 5, see Check estimates.");
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
  });
});
