/**
 * Score run 3 HIDDEN ANSWERS (DL 12 Oct, Batch R4; `score/judge-run3-final.md` C6/U3 and §4 finding 27).
 * Rule: the answer is on the face, and only the Why sits below. Label, never withhold.
 *
 * The corpus is the served replies themselves (`fixtures/score-run3-hidden-answers.json`: run 3 on CEE 3fdf0f38 = C), each
 * sha-pinned, with the served composer's own log counts. Each input is rebuilt from its captured body (the reply without
 * the post-composer Why, the leader gate's typed closing, the guidance row's action) the way the route passes it, and on
 * the composer BEFORE this change each reproduces its served `_answer_shape` byte for byte (Why aside: R3 changed only its
 * markup), so the RED rows below are the served behaviour, not a model of it. Two producers hid the answer:
 *  - hiring 11/12, marketing 6: a conversational turn beside a co-held Run takes the Run face, which showed only the
 *    narrator's first sentence (served log: face_bullets 0); everything the reply answered sat under More detail;
 *  - deadline 2/8: the intervention appender. A reply the composer shipped whole was split into its first line and
 *    "More detail" (deadline 2), and a face bullet over eight words — the specific question — was moved there (deadline 8),
 *    while "Give your estimate" took the face.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fx from './fixtures/score-run3-hidden-answers.json';
import { composeReplyShape, type ReplyComposition } from '../compose-reply.js';
import { deriveAnswerTextFromShape } from '../../../routing/answer-shape.js';

type Rec = Record<string, any>;
const cases = fx.cases as unknown as Record<string, Rec>;
const DETAILS = /\n*<details>\n<summary>Why\?<\/summary>\n\n([\s\S]*?)\n\n<\/details>\s*$/;
const whyOf = (c: Rec): string => DETAILS.exec(String(c.served_shape.detail))![1]!;
/** What the chat shows above the Why: the whole reply when it ships whole, else the headline and bullets. */
const face = (c: ReplyComposition): string => (c.shape === null ? c.text.replace(/\n\nWhy\? [\s\S]*$/, '')
  : [c.shape.headline, ...c.shape.bullets].join('\n'));
/** A reply's sentences as written (list markers aside): what the composer's invariant keeps, each exactly once. */
const sentencesOf = (text: string): string[] => text.split('\n').map((l) => l.replace(/^\s*[-•*]\s+/, '').trim()).filter(Boolean)
  .flatMap((l) => l.split(/(?<=[.?!])\s+(?=\S)/));
const below = (c: ReplyComposition): string => (c.shape === null ? '' : c.shape.detail ?? '');
/** The gate appended its closing as the reply's last paragraph (`agent-v1-turn.ts` leaderGateClosing): typed by identity. */
const closingOf = (c: Rec): string => { const t = String(c.assistant_text).replace(DETAILS, ''); return t.slice(t.lastIndexOf('\n\n') + 2); };

function compose(name: string, over: Rec = {}): ReplyComposition {
  const c = cases[name]!;
  const s = c.served_shape as Rec;
  const label = c.slot1.label as string;
  // The reply as the composer received it: the served headline, the narrator's own face bullets (the appender's action
  // label is not the narrator's), then the served detail as written, without the appended Why.
  const bullets = (s.bullets as string[]).filter((b) => b !== label).map((b) => `- ${b}`).join('\n');
  const text = [s.headline, bullets, String(s.detail).replace(DETAILS, '')].filter(Boolean).join('\n\n');
  const route = c.route_face_contract === 'run'
    // Not a Run or Explain turn (no tool ran): the route marks it, and types the leader gate's closing.
    ? { faceContract: 'run', notRunOrExplain: true, obligations: [{ role: 'withheld_reason', text: closingOf(c) }] }
    : {};
  return composeReplyShape({ text, profile: 'coaching', ...route,
    eligibleIntervention: { policy_id: c.slot1.policy_id, variant_id: c.slot1.variant, name: 'Assumption-based planning', why: whyOf(c), trigger: 'served' },
    interventionActionLabel: label, ...over } as never);
}

/** The answer each served reply hid, in its own words. */
const HIDDEN: Record<string, string[]> = {
  hiring_11: ['Add non-development time as a separate factor.', 'Clarify how each hire changes that time.',
    'Define monthly output and acceptable quality.', 'Your 20–30% range isn’t represented in the model.'],
  hiring_12: ['Keep “Delivery capacity” at today’s relative baseline.', 'Add non-development time as a separate factor.',
    'Leave hiring effects and quality measures unresolved.',
    'The available update stores one starting percentage, not your full **20–30% range**.', 'Nothing has been changed yet.'],
  marketing_6: ['Keep annual marketing spend within £100,000.', 'Keep your time commitment within 25%.',
    'Both success conditions must be met—not traded against each other.',
    'The current model’s broad campaign goal does not yet track them separately.'],
  deadline_2: ['Specify the feature-launch deadline.', 'Estimate today’s team’s likely completion-time range.',
    'When is the deadline, and how long would today’s team likely take to finish the launch without either hire?'],
  deadline_8: ['How many months from today would completion likely take, from the faster end to the slower end, without either hire?'],
};

describe('IDENTITY: the five served replies, as captured', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`${name}: sha-pinned; the served face lacked the answer, which sat under More detail`, () => {
      expect(createHash('sha256').update(String(c.assistant_text)).digest('hex')).toBe(c.text_sha256);
      const servedFace = [c.served_shape.headline, ...c.served_shape.bullets].join('\n');
      for (const s of HIDDEN[name]!) {
        expect(servedFace, s).not.toContain(s);
        expect(c.served_shape.detail, s).toContain(s);
      }
    });
  }
});

describe('the answer is on the face; what the composer folds sits below', () => {
  for (const name of Object.keys(HIDDEN)) {
    // Technique (c) (AIE 6130197656 §3, DL 12 Oct; re-pinned from "the Why is the last paragraph, once"): the method's
    // Why? rides the guidance row, never the reply.
    it(`${name}: every hidden answer line is on the face; no Why? in the reply (technique (c)); no line is lost`, () => {
      const c = compose(name);
      for (const s of HIDDEN[name]!) expect(face(c), s).toContain(s);
      expect(c.text).not.toContain('Why?');
      expect(c.text).not.toContain(whyOf(cases[name]!));
      // Every served sentence (the Why markup aside) is still said, byte for byte.
      for (const sentence of sentencesOf(String(cases[name]!.assistant_text).replace(DETAILS, ''))) expect(c.text, sentence).toContain(sentence);
      if (c.shape !== null) expect(c.text).toBe(deriveAnswerTextFromShape(c.shape));
    });
  }
  for (const name of ['hiring_11', 'hiring_12', 'marketing_6'] as const) {
    it(`${name}: the served headline still leads; the leader gate's typed closing keeps its place under More detail`, () => {
      const c = compose(name);
      expect(c.shape, c.reason).not.toBeNull();
      expect(c.shape!.headline).toBe(cases[name]!.served_shape.headline);
      expect(face(c)).not.toContain(closingOf(cases[name]!));
      expect(below(c)).toContain(closingOf(cases[name]!));
    });
  }
  it('deadline_2: the reply the composer kept whole ships whole, every byte, then the action (no Why: technique (c))', () => {
    const c = compose('deadline_2');
    expect(c.shape).toBeNull();
    const reply = String(compose('deadline_2', { eligibleIntervention: undefined, interventionActionLabel: undefined }).text);
    expect(c.text).toBe(`${reply}\n\n- Give your estimate`);
  });
  it('deadline_8: the composer\'s face stays exactly as composed (its question included); the action that no longer fits sits below (no Why: technique (c))', () => {
    const c = compose('deadline_8');
    const plain = compose('deadline_8', { eligibleIntervention: undefined, interventionActionLabel: undefined });
    expect(c.shape!.headline).toBe(plain.shape!.headline);
    expect(c.shape!.bullets).toEqual(plain.shape!.bullets);
    expect(c.shape!.bullets).toHaveLength(3);
    expect(below(c)).toBe(`${plain.shape!.detail}\n\n- Give your estimate`);
  });
});

describe('BOUNDARY (hiring 12): the reply that reached the composer asked nothing', () => {
  it('no question in the served words; the leader gate dropped one sentence before the composer (served log, words not stored)', () => {
    const c = cases.hiring_12!;
    expect(String(c.assistant_text).replace(DETAILS, '')).not.toContain('?');
    expect(c.served_composer_log.questions_in).toBe(0);
    expect(c.served_leader_gate_log).toMatchObject({ dropped_sentences: 1, withheld_reason: 'goal_path_unsized' });
  });
});

describe('controls: each placement keeps its own reason', () => {
  it('CONTROL: the same hiring 11 words on a Run or Explain turn keep that turn\'s face (its reason: the turn ran)', () => {
    const c = compose('hiring_11', { notRunOrExplain: undefined });
    expect(c.shape!.bullets).toEqual([]);
    for (const s of HIDDEN.hiring_11!) expect(below(c), s).toContain(s);
  });
  it('CONTROL: with room on the face (marketing 6\'s words as a plain coaching reply: two face bullets), the action joins the face as before', () => {
    const c = compose('marketing_6', { faceContract: undefined, notRunOrExplain: undefined, obligations: [] });
    expect(c.shape!.bullets).toEqual(['Keep annual marketing spend within £100,000.', 'Keep your time commitment within 25%.', 'Give your estimate']);
  });
  // Technique (c) supersedes E6 Why-once: no reply carries the Why?, so there is nothing to say once.
  it('CONTROL: the action is still carried; the Why? never is (technique (c), superseding E6 Why-once)', () => {
    const c = compose('deadline_8');
    expect(c.text).not.toContain('Why?');
    expect(below(c).endsWith('- Give your estimate')).toBe(true);
    expect(face(c)).toContain(HIDDEN.deadline_8![0]);
  });
  it('CONTROL: only a line that IS the action stands for it: a sentence holding its words still gets the action; a bullet that is it is not repeated', () => {
    const ei = { policy_id: 'RC-STRENGTHEN-ITEM', variant_id: 'S3L', name: 'x', why: 'W.', trigger: 't' };
    const inSentence = composeReplyShape({ text: 'Give your estimate of the delivery time when you are ready.', profile: 'coaching',
      interventionActionLabel: 'Give your estimate', eligibleIntervention: ei } as never);
    expect(inSentence.text).toBe('Give your estimate of the delivery time when you are ready.\n\n- Give your estimate');
    const asBullet = composeReplyShape({ text: 'The delivery time is still open.\n\n- Give your estimate', profile: 'coaching',
      interventionActionLabel: 'Give your estimate', eligibleIntervention: ei } as never);
    expect(asBullet.text.split('Give your estimate').length - 1).toBe(1);
  });
  it('CONTROL: one long paragraph with an action keeps its words on the face; the action never replaces it', () => {
    const long = `${Array.from({ length: 9 }, (_, i) => `Point ${i + 1} of the plan keeps the team's stated budget and timing in view`).join(', ')}.`;
    const c = composeReplyShape({ text: long, profile: 'coaching', interventionActionLabel: 'Give your estimate',
      eligibleIntervention: { policy_id: 'RC-STRENGTHEN-ITEM', variant_id: 'S3L', name: 'x', why: 'W.', trigger: 't' } } as never);
    expect(long.split(/\s+/).length).toBeGreaterThan(80);
    expect(c.shape).toBeNull();
    expect(c.text).toBe(`${long}\n\n- Give your estimate`);
  });
});
