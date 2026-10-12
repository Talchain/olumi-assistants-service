/**
 * Score run 2 HIDDEN ANSWERS (DL 12 Oct; PL 6127523574 bullet 4; judge `score/JUDGE-RUN2-raw.md` findings 1, 20, 34).
 * Rule: the answer and any not-recorded fact are VISIBLE; label, never withhold.
 *
 * The corpus is the served replies themselves (`fixtures/score-run2-hidden-answers.json`: run 2 on CEE aadcf897, whose
 * compose-reply.ts is byte-identical at C a11bc90f), each sha-pinned. Every input is rebuilt from its captured body (the
 * text without the post-composer "Why?" block, the captured canonical cells, the estimates line, hiring's lead screen
 * finding as the route types it), and on the composer BEFORE this change each reproduces its served `_answer_shape` byte
 * for byte, so the RED rows below are the served behaviour, not a model of it.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fx from './fixtures/score-run2-hidden-answers.json';
import { composeReplyShape, type ReplyComposition } from '../compose-reply.js';
import { deriveAnswerTextFromShape } from '../../../routing/answer-shape.js';

type Rec = Record<string, any>;
const WHY = /\n*<details>[\s\S]*<\/details>\s*$/;
const cases = fx.cases as unknown as Record<string, Rec>;
const face = (c: ReplyComposition): string => (c.shape === null ? c.text : [c.shape.headline, ...c.shape.bullets].join('\n'));
const detail = (c: ReplyComposition): string => (c.shape === null ? '' : c.shape.detail ?? '');

function compose(name: string, over: Rec = {}): ReplyComposition {
  const c = cases[name]!;
  const text = String(c.assistant_text).replace(WHY, '').trim();
  const graph = { nodes: (c.goal_labels as string[]).map((label, i) => ({ id: `g${i}`, kind: 'goal', label })) };
  const estimatesLine = /Olumi's estimates: \d+, see Check estimates\./.exec(text)?.[0];
  const faceContract = name === 'deadline_13' ? undefined : name === 'capacity_1' ? 'draft' : 'run';
  // Hiring's headline is the route's typed screen finding for each withheld option (lead evidence).
  const obligations = name !== 'hiring_7b' ? [] : (c.chance_cells as Rec[]).filter((x) => x.kind === 'withheld')
    .map((_, i) => ({ role: 'evidence' as const, text: text.split('\n')[0]!, lead: true as const, subjects: [`o${i}`] }));
  return composeReplyShape({ text, ...(faceContract === undefined ? {} : { faceContract }), chanceCells: c.chance_cells, graph,
    ...(estimatesLine === undefined ? {} : { estimatesLine }), obligations, ...over } as never);
}

describe('IDENTITY: the four served replies, as captured', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`${name}: sha-pinned; the served shape held the answer under More detail`, () => {
      expect(createHash('sha256').update(String(c.assistant_text)).digest('hex')).toBe(c.text_sha256);
      expect(c.served_shape.detail).toContain(HIDDEN[name]![0]);
    });
  }
});

/** The answer each served reply hid, in its own words (the judge's citations). */
const HIDDEN: Record<string, string[]> = {
  capacity_1: ['I’ve built the comparison around your two staffing options and target.',
    'Your 80 tickets/week and 20 specialist throughput are recorded from your brief.'],
  capacity_3b: ['You already supplied 80 tickets per week for the existing team, so the missing baseline is a modelling gap, not missing information from you.'],
  hiring_7b: ['Nothing you entered changed.', 'This Run cannot establish a choice or confirm your limits.',
    '‘Productivity change’ cannot be checked in this model yet: Olumi hasn’t sized the links from its parts to it in this limit’s units.'],
  deadline_13: ['The tool did not recognise the seven-month forecast in your wording, so nothing was recorded.'],
};

describe('the answer is visible: a withheld chance never folds the reply\'s own answer behind its status lines', () => {
  for (const name of ['capacity_1', 'capacity_3b', 'hiring_7b'] as const) {
    it(`${name}: every hidden answer sentence is on the face; the status lines stay; nothing is lost`, () => {
      const c = compose(name);
      expect(c.shape, c.reason).not.toBeNull();
      for (const s of HIDDEN[name]!) expect(face(c), s).toContain(s);
      // The existing face lines are unchanged (label, never withhold): the served headline still leads, its bullets stay.
      const served = cases[name]!.served_shape as Rec;
      expect(c.shape!.headline).toBe(served.headline);
      for (const b of served.bullets as string[]) expect(c.shape!.bullets).toContain(b);
      expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
      expect(c.outcome).toBe('shaped');
    });
  }
  it('capacity_1: the questions segment and the typed ask keep their places (no new question on the face)', () => {
    const c = compose('capacity_1');
    expect(detail(c)).toContain('Questions this model does not answer yet:');
    expect(c.shape!.bullets.at(-1)).toBe('What is today’s actual **Weekly support capacity**?');
  });
  it('CONTROL: a chance on the face (a figure) keeps today\'s face: the answer stays in detail, its reason the figure', () => {
    const c = compose('capacity_3b', { chanceCells: [{ kind: 'figure', display: '34%' }] });
    expect(face(c)).not.toContain(HIDDEN.capacity_3b![0]);
    expect(detail(c)).toContain(HIDDEN.capacity_3b![0]);
  });
});

describe('a not-recorded fact is visible: a write this turn refused (typed), so no reply line folds', () => {
  it('deadline_13: "… so nothing was recorded." is on the face; the reply ships whole, every byte', () => {
    const tools = cases.deadline_13!.tool_calls as Rec[];
    expect(tools.map((t) => [t.name, t.ok, t.refusal]), 'its reason: the served write refused').toEqual([['propose_team_time', false, 'team_time_not_stated']]);
    const c = compose('deadline_13', { notRecorded: true });
    expect([c.outcome, c.reason]).toEqual(['kept_whole', 'not_recorded']);
    expect(c.text).toContain(HIDDEN.deadline_13![0]);
    expect(c.text).toBe(String(cases.deadline_13!.assistant_text));
  });
  it('CONTROL: the same reply with no refused write folds as served (the flag is the cause)', () => {
    const c = compose('deadline_13');
    expect(detail(c)).toContain(HIDDEN.deadline_13![0]);
    expect(c.shape).toEqual(cases.deadline_13!.served_shape);
  });
});

/** Design controls (the run-2 words have none of these): the answer joins the face, today's other folds still apply. */
describe('the withheld-chance face keeps today\'s other folds: restated cause, typed basis, a second question', () => {
  const graph = { nodes: [{ id: 'support', kind: 'factor', label: 'Support cost' }, { id: 'loss', kind: 'goal', label: 'MRR lost to support strain' }] };
  const cause = 'The link from ‘Support cost’ to ‘MRR lost to support strain’ has no size yet.';
  const restatement = 'Support cost affects MRR lost to support strain, whose strength is not sized in the model yet.';
  const answer = 'The model keeps both options and every stated figure, so the team can see what still needs evidence.';
  const basis = 'Both options were compared on the same simulated draws.';
  const earlier = 'Should we revisit the support cost estimate later?';
  const ask = 'Which link should we size first?';
  const compose2 = (): ReplyComposition => composeReplyShape({ faceContract: 'run', graph,
    text: [restatement, answer, basis, cause, earlier, ask].join('\n\n'),
    chanceCells: [{ kind: 'withheld', why: 'Chance not shown yet', face: cause, reasons: [{ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', message: cause }] }],
    obligations: [
      { role: 'withheld_reason', text: cause, subjects: ['support→loss'] },
      { role: 'evidence', text: basis },
      { role: 'ask', text: ask },
    ] } as never);
  it('the reply\'s own answer is on the face, before the one ask', () => {
    const c = compose2();
    expect(c.shape, c.reason).not.toBeNull();
    expect(c.shape!.bullets.slice(-2)).toEqual([answer, ask]);
  });
  it('CONTROL: a narrator restatement of the typed withheld cause stays in detail (no repetition; its reason: the typed cause)', () => {
    const c = compose2();
    expect(c.measure!.restatements_to_detail).toBe(1);
    expect(face(c)).not.toContain(restatement);
    expect(detail(c)).toContain(restatement);
  });
  it('CONTROL: a typed comparison-basis line stays in detail (evidence keeps its own place)', () => {
    const c = compose2();
    expect(face(c)).not.toContain(basis);
    expect(detail(c)).toContain(basis);
  });
  it('CONTROL: only one question on the face (D-12): the earlier narrator question stays in detail', () => {
    const c = compose2();
    expect([c.shape!.headline, ...c.shape!.bullets].filter((line) => line.trim().endsWith('?'))).toEqual([ask]);
    expect(detail(c)).toContain(earlier);
  });
});
