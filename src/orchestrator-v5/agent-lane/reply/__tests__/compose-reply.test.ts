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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  composeReplyShape, consentLabelsOf, sentencesOf, REPLY_FACE_MAX_BULLETS, REPLY_SHAPE_INSTRUCTION,
  type ReplyComposition,
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

  it.each(['method_turn', 'leader_free_envelope', 'consent_with_figures'] as const)('keepWhole %s → byte-identical, no sidecar (identity of the turn, never the words)', (reason) => {
    const c = composeReplyShape({ text: T5, keepWhole: reason });
    expect(c).toMatchObject({ outcome: 'kept_whole', reason, shape: null, text: T5 });
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

describe('obligations (DL ruling R1, 7 Oct): the headline, the ONE ask, the withheld reason and the consent line stay on the face', () => {
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

  it('CONSENT (R1 exception): every sentence naming what this turn’s proposal adds stays on the face', () => {
    const LABEL = 'Recruitment process taking a long time';
    const text = `This is a time-to-value risk for the deadline. Hiring may take longer than the six months you have. Its link to the deadline is not sized yet, so it moves no figure until you size it. Competitive recruitment is not modelled either. I can add the risk ‘${LABEL}’ to the model, linked to the deadline. ‘${LABEL}’ would sit beside the onboarding risk. Shall I add it?`;
    const c = composeReplyShape({ text, consentLabels: [LABEL] });
    expect(c.outcome).toBe('shaped');
    expect(face(c)).toContain(`I can add the risk ‘${LABEL}’ to the model, linked to the deadline.`);
    expect(c.shape!.bullets.at(-1)).toBe('Shall I add it?');
    expect(face(c), 'every mention of the proposed item is a consent line (Codex r1 P2)').toContain(`‘${LABEL}’ would sit beside the onboarding risk.`);
    expect(c.measure!.consent_units).toBe(2);
    // CONTRAST: with no consent label, that sentence is not on the face (only position puts lines there).
    expect(face(composeReplyShape({ text }))).not.toContain(`I can add the risk ‘${LABEL}’ to the model, linked to the deadline.`);
    everySentenceKept(text, c.text);
  });

  it('Codex r1 P2 (#2748): a short label ("AI") binds by whole word, and an introductory mention cannot hide the proposal sentence', () => {
    // Long enough to exceed the 75-word face budget, so the composer shapes it (a shorter reply ships whole, untouched).
    const P = 'Plans differ. Check timing. Check capacity. Check candidates. Validate these assumptions against actual recruitment lead times and onboarding requirements before relying on this comparison for planning. Each of these checks changes how much the comparison can tell you, because the model still carries Olumi’s placeholder strengths on the links that matter most to the deadline. None of them is sized yet, so no option can be put forward on the deadline today.';
    const short = composeReplyShape({ text: `${P} I can add AI as a risk linked to Revenue. Shall I add it?`, consentLabels: ['AI'] });
    expect(face(short)).toContain('I can add AI as a risk linked to Revenue.');
    // CONTROL: "AI" inside a longer word is not a mention.
    expect(composeReplyShape({ text: `${P} I said a risk is linked to Revenue. Shall I add it?`, consentLabels: ['AI'] }).measure!.consent_units).toBe(0);
    const intro = composeReplyShape({ text: `Recruitment delay is a concern. ${P} I can add the risk Recruitment delay, linked to Revenue. Shall I add it?`, consentLabels: ['Recruitment delay'] });
    expect(face(intro)).toContain('I can add the risk Recruitment delay, linked to Revenue.');
  });

  it('Codex r1 P2 (#2748): an earlier question in a bullet does not displace the reply’s last question', () => {
    const text = 'Recruitment remains uncertain.\n- Check lead times.\n- Shall I add a risk?\n\nWe should test this assumption against actual recruitment lead times before relying on this comparison in planning. What is today’s delivery capacity?';
    const c = composeReplyShape({ text });
    expect(c.shape!.bullets.at(-1)).toBe('What is today’s delivery capacity?');
    expect(c.shape!.detail).toContain('Shall I add a risk?');
  });

  it('more must-face lines than three bullets → the reply ships whole (an obligation is never hidden)', () => {
    const W2 = 'No single option can be put forward on this result yet.';
    const text = `${NARRATOR}\n\n${WITHHELD}\n\n${W2}\n\nI can add the risk ‘Overlapping costs’ to the model.\n\n${ASK}`;
    const c = composeReplyShape({ text, consentLabels: ['Overlapping costs'], obligations: [{ role: 'withheld_reason', text: WITHHELD }, { role: 'withheld_reason', text: W2 }, { role: 'ask', text: ASK }] });
    expect(c).toMatchObject({ outcome: 'kept_whole', reason: 'face_over_cap', text });
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

describe('timing: every regex on the path scales linearly (5k → 20k, min of 5, ratio < 8×)', () => {
  const minMs = (f: () => void): number => {
    let best = Infinity;
    for (let i = 0; i < 5; i += 1) { const t = performance.now(); f(); best = Math.min(best, performance.now() - t); }
    return best;
  };
  const shapes: [string, (n: number) => string][] = [
    ['whitespace', (n) => `Lead.${' '.repeat(n)}Next. ${'\t'.repeat(n)}`],
    ['terminators', (n) => `${'.'.repeat(n)} A${'?'.repeat(n)}`],
    ['sentences and bullets', (n) => Array.from({ length: Math.ceil(n / 20) }, (_, i) => (i % 3 === 0 ? `- Point ${i} is here.` : `Sentence ${i} is here.`)).join('\n')],
  ];
  it.each(shapes)('%s', (_name, make) => {
    const small = make(5_000);
    const large = make(20_000);
    expect(large.length).toBeGreaterThanOrEqual(small.length * 3);
    const tSmall = Math.max(minMs(() => composeReplyShape({ text: small })), 0.05);
    const tLarge = minMs(() => composeReplyShape({ text: large }));
    expect(tLarge / tSmall, `5k ${tSmall.toFixed(2)} ms → 20k ${tLarge.toFixed(2)} ms`).toBeLessThan(8);
  });
});

describe('consent labels come from the proposal’s identity (R1 exception): `consentLabelsOf`', () => {
  it('reads the typed results of the three structural doors and stored add_node labels; nothing else', () => {
    expect(consentLabelsOf([
      { result: { risk: { label: 'Overlapping costs', threatens: ['Budget (lowers it)'] } } },
      { result: { option: { label: 'Bring in a freelance resource' } } },
      { result: { factors: [{ label: 'Senior salary' }, { label: 'Junior salary' }] } },
      { operations: [{ op: 'add_node', value: { kind: 'factor', label: 'Notice period' } }, { op: 'add_edge', value: { label: 'not a node' } }] },
      { result: { public_label: 'Add the risk "Ignored"' } },
    ])).toEqual(['Overlapping costs', 'Bring in a freelance resource', 'Senior salary', 'Junior salary', 'Notice period']);
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
