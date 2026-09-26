/**
 * ⭐ AX2 — THE FIRST REPLY SAYS WHAT THE USER NEEDS, NOT EVERYTHING THE SERVER KNOWS (DL #70 5850471417).
 *
 * Measured on the served first reply of DL's joined run (`acceptance-f-runs/f-20260926T201724Z/01-F1-brief`):
 * 315 words, of which the model wrote 104. The server appended 211 — the parked questions (144: five whole questions
 * and "(and 3 more)"), the no-leader closing (46, on a turn that asked for no ranking), the save line (16) and the
 * readiness line (5). The questions below are the five that reply showed, verbatim; the three it cut are named as not
 * captured.
 */
import { describe, it, expect } from 'vitest';
import { narrateWriteOutcome, openQuestionsOf } from '../write-outcome.js';
import { AGENT_NO_LEADER_SENTENCES, enforceAgentLaneLeaderClaimsAtWire, sentenceRanksOptions } from '../withheld-leader-fail-closed.js';

const SERVED_QUESTIONS = [
  'The brief does not say whether your "MRR" goal covers the Pro plan only or MRR across all plans, so the model measures it for the Pro plan only. Which did you mean?',
  'Does "MRR" get there within 12 months? The model holds no deadline yet, so no result answers that.',
  'This model cannot answer that yet: Olumi reads "MRR" as depending on "Pro plan price" times "Pro paying subscribers", and the model adds those effects up rather than multiplying them.',
  'What is current Pro-plan MRR versus total-company MRR? The model provisionally treats the £20k MRR goal as Pro-plan MRR; please confirm the intended scope.',
  'How many paying Pro subscribers are there today? This is required to calculate the revenue effect of each price option and the subscriber count needed to reach £20k MRR.',
  '[not in the capture: 1 of 3 cut by "(and 3 more)"]', '[not in the capture: 2 of 3]', '[not in the capture: 3 of 3]',
];
/** The served block, as the reply carried it (144 words). */
const SERVED_BLOCK = ` Questions this model does not answer yet: ${SERVED_QUESTIONS.slice(0, 5).join(' ')} (and 3 more)`;
const words = (s: string) => s.trim().split(/\s+/).filter((w) => w !== '').length;

const built = (open_questions: string[]) => narrateWriteOutcome(
  'Here is the model.',
  [{ name: 'build_model_from_brief' }],
  [{ ok: true, mutated: true, model_version: { version_number: 1 }, open_questions }],
);
const statusOf = (open_questions: string[]) => String(built(open_questions).status ?? '');

describe('AX2 (c): the build turn shows the two priority questions and offers the rest', () => {
  it('PRECONDITION: the served block is the 144 words measured', () => {
    expect(words(SERVED_BLOCK)).toBe(144);
  });

  it('RED (served 01): the first two questions are shown whole, the third is not, and the rest are offered', () => {
    const line = statusOf(SERVED_QUESTIONS);
    expect(line).toContain(`Questions this model does not answer yet: ${SERVED_QUESTIONS[0]} ${SERVED_QUESTIONS[1]} Ask me for the other 6.`);
    expect(line).not.toContain(SERVED_QUESTIONS[2]!);
    const block = line.slice(line.indexOf('Questions this model does not answer yet'));
    expect(words(block), block).toBeLessThanOrEqual(65);
  });

  it('RED: one question over the two is offered as "the other one"', () => {
    expect(statusOf(SERVED_QUESTIONS.slice(0, 3))).toContain('Ask me for the other one.');
  });

  it('CONTRAST: two questions or fewer read exactly as before', () => {
    expect(statusOf(SERVED_QUESTIONS.slice(0, 2))).toContain(`Questions this model does not answer yet: ${SERVED_QUESTIONS[0]} ${SERVED_QUESTIONS[1]}`);
    expect(statusOf(SERVED_QUESTIONS.slice(0, 2))).not.toContain('Ask me for');
  });

  it('COMPLETE: the whole list, in the producer\'s order, is still readable for the wire', () => {
    expect(openQuestionsOf({ ok: true, open_questions: SERVED_QUESTIONS })).toEqual(SERVED_QUESTIONS);
  });
});

describe('AX2 (closing): the build turn drops a ranking without explaining an absence nobody asked about', () => {
  const RANKING = 'Raising Pro to £59 produces the strongest MRR outcome.';
  const opts = { requestId: 'r', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, graph: null, analysisReady: undefined } as const;
  const reply = (text: string) => ({ response_version: 2, assistant_text: text, suggested_actions: [], insights: [] }) as never;
  const said = (r: { response: { assistant_text?: unknown } }) => String(r.response.assistant_text);

  it('PRECONDITION: the classifier sees the ranking sentence (positive control)', () => {
    expect(sentenceRanksOptions(RANKING)).toBe(true);
  });

  it('RED (build turn): the ranking is dropped and no no-leader sentence is added', () => {
    const r = enforceAgentLaneLeaderClaimsAtWire(reply(`Here are Olumi's starting assumptions. ${RANKING}`), { ...opts, sayWhyWithheld: false });
    expect(said(r)).not.toContain(RANKING);
    expect(said(r)).toContain('Here are Olumi\'s starting assumptions.');
    for (const s of AGENT_NO_LEADER_SENTENCES) expect(said(r)).not.toContain(s);
  });

  it('CONTRAST (every other turn): the same drop still says why — the default is unchanged', () => {
    const r = enforceAgentLaneLeaderClaimsAtWire(reply(`Here are Olumi's starting assumptions. ${RANKING}`), opts);
    expect(said(r)).not.toContain(RANKING);
    expect(AGENT_NO_LEADER_SENTENCES.some((s) => said(r).includes(s))).toBe(true);
  });

  it('NEVER SILENT: a build-turn reply the drop would empty still gets the sentence', () => {
    const r = enforceAgentLaneLeaderClaimsAtWire(reply(RANKING), { ...opts, sayWhyWithheld: false });
    expect(AGENT_NO_LEADER_SENTENCES.some((s) => said(r).includes(s))).toBe(true);
  });
});
