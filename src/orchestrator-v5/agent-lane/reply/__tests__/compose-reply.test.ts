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
import { textAtRest } from '../../decision-input-ask.js';

const face = (c: ReplyComposition): string[] => (c.shape === null ? [] : [c.shape.headline, ...c.shape.bullets]);
/** Every sentence of `original` is in `shipped`, verbatim (bullet markers aside). */
const everySentenceKept = (original: string, shipped: string): void => {
  for (const line of original.split('\n')) {
    const body = line.replace(/^[ \t]{0,6}(?:[-•*]|\d{1,2}[.)])[ \t]{1,4}/, '');
    for (const s of sentencesOf(body)) expect(shipped, `kept: ${s.slice(0, 70)}`).toContain(s);
  }
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

  it('#1: shaped; ONE question on the face (the last), the other two in detail (D-12); the questions segment stays last, intact, for the panel’s toggle', () => {
    const c = composeReplyShape({ text: T1 });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets.length).toBeLessThanOrEqual(REPLY_FACE_MAX_BULLETS);
    expect(c.text, 'the identity tie').toBe(deriveAnswerTextFromShape(c.shape!));
    const onFace = face(c).filter((s) => s.trim().endsWith('?'));
    expect(onFace).toEqual(['How much does "Feature Delivery Capacity" change "meet our next feature-launch deadline"?']);
    expect(c.shape!.bullets.at(-1)).toBe(onFace[0]);
    expect(c.measure!.questions_in, 'the control: the reply asked three times').toBe(3);
    expect(c.shape!.detail.split('What is it, in % likelihood of on-time launch?'), 'both earlier asks are in detail').toHaveLength(3);
    expect(c.shape!.detail.endsWith('Questions this model does not answer yet: The current likelihood of meeting the next feature-launch deadline is not stated, so no goal baseline has been assumed. (2 of 7 shown.)')).toBe(true);
    // The panel's own predicate still finds the segment, now inside detail.
    expect(textAtRest(c.shape!.detail)).not.toContain('(2 of 7 shown.)');
    everySentenceKept(T1, c.text);
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

  it('keepWhole leader_free_envelope → byte-identical, no sidecar (identity of the turn, never the words)', () => {
    expect(composeReplyShape({ text: T1, keepWhole: 'leader_free_envelope' })).toMatchObject({ outcome: 'kept_whole', reason: 'leader_free_envelope', shape: null, text: T1 });
  });

});

describe('TYPED RESPONSE PROFILES (DL, AIE line review 6037446159 item 5): chosen by turn kind, rows per profile', () => {
  it('coaching: the long reply is shaped (≤3 bullets, ≤75 face words)', () => {
    const c = composeReplyShape({ text: T1, profile: 'coaching' });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets.length).toBeLessThanOrEqual(3);
    expect(c.measure!.face_words).toBeLessThanOrEqual(75);
  });
  it.each(['method_step', 'proposal'] as const)('%s: the SAME long reply ships whole, byte-identical, no sidecar (one structured prompt / card + disclosure)', (profile) => {
    expect(composeReplyShape({ text: T1, profile })).toMatchObject({ outcome: 'kept_whole', reason: profile, shape: null, text: T1 });
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
  it('⛔ a lead-in stays with what it introduces: three chance lines after "…, on current information:" fill the face, so → whole', () => {
    const text = `No single option can be put forward: the comparison is a near tie.\n\n${LEAD}\n\n${EQ} ${EL} ${EK}\n\n${TAIL} ${TAIL2}`;
    expect(composeReplyShape({ text, obligations: evidence })).toMatchObject({ outcome: 'kept_whole', reason: 'lead_in_split', text });
  });
  it('CONTROL: the same lines with no lead-in are shaped, in the reply’s order (a line ending on its own question is evidence, never moved to close the face)', () => {
    const text = `No single option can be put forward: the comparison is a near tie.\n\n${EQ} ${EL} ${EK}\n\n${TAIL} ${TAIL2}`;
    const c = composeReplyShape({ text, obligations: evidence });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets).toEqual([EQ, EL, EK]);
    everySentenceKept(text, c.text);
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

  it('every reply: never throws; shaped ⇒ ≤3 bullets, the identity tie, every sentence kept; otherwise byte-identical', () => {
    const outcomes: Record<string, number> = {};
    for (const r of all) {
      const c = composeReplyShape({ text: r.text });
      outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
      if (c.outcome === 'shaped') {
        expect(c.shape!.bullets.length, r.source).toBeLessThanOrEqual(REPLY_FACE_MAX_BULLETS);
        expect(c.text, r.source).toBe(deriveAnswerTextFromShape(c.shape!));
        everySentenceKept(r.text, c.text);
      } else {
        expect(c.text, r.source).toBe(r.text);
      }
    }
    // The class is exercised: most long served replies are reshaped, and none fails its own invariant.
    expect(outcomes.shaped ?? 0).toBeGreaterThanOrEqual(Math.floor(all.length / 2));
    expect(all.filter((r) => composeReplyShape({ text: r.text }).reason === 'invariant_failed').map((r) => r.source)).toEqual([]);
  });

  it('a composed reply composed again still keeps every sentence and at most three face bullets (stable contract)', () => {
    for (const r of all) {
      const once = composeReplyShape({ text: r.text });
      const twice = composeReplyShape({ text: once.text });
      if (twice.shape !== null) expect(twice.shape.bullets.length, r.source).toBeLessThanOrEqual(REPLY_FACE_MAX_BULLETS);
      everySentenceKept(r.text, twice.text);
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
    expect(c.shape!.headline).toBe(chances[0]);
    expect([...c.shape!.bullets, c.shape!.detail].join('\n')).toContain(share);
    expect(c.shape!.bullets).toEqual(chances.slice(1));
    assertDerivation(text, c);
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
    expect(c.shape!.headline).toBe(joined);
    expect(c.shape!.bullets).toEqual([second, reason, ask]);
    expect(c.shape!.detail).toContain(share);
    assertDerivation(atomicText, c);
  });

  it('a typed chance absent from final text does not change the no-chance path', () => {
    const noChance = `${share} Check the assumptions before relying on these runs.`;
    expect(composeReplyShape({ text: noChance, obligations })).toEqual(composeReplyShape({ text: noChance }));
  });
});
