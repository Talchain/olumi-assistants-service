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

  it('RED (served 01): the first two questions are shown whole, the third is not, and the count is said — no promise', () => {
    const line = statusOf(SERVED_QUESTIONS);
    expect(line).toContain(`Questions this model does not answer yet: ${SERVED_QUESTIONS[0]} ${SERVED_QUESTIONS[1]} (2 of 8 shown.)`);
    // DL 5851835121: never a promise the Agent does not keep.
    expect(line).not.toContain('Ask me for');
    expect(line).not.toContain(SERVED_QUESTIONS[2]!);
    const block = line.slice(line.indexOf('Questions this model does not answer yet'));
    expect(words(block), block).toBeLessThanOrEqual(65);
  });

  it('RED: one question over the two is counted, not promised', () => {
    expect(statusOf(SERVED_QUESTIONS.slice(0, 3))).toContain('(2 of 3 shown.)');
  });

  it('CONTRAST: two questions or fewer read exactly as before', () => {
    expect(statusOf(SERVED_QUESTIONS.slice(0, 2))).toContain(`Questions this model does not answer yet: ${SERVED_QUESTIONS[0]} ${SERVED_QUESTIONS[1]}`);
    expect(statusOf(SERVED_QUESTIONS.slice(0, 2))).not.toContain('Ask me for');
  });

  it('COMPLETE: the whole list, in the producer\'s order, is still readable for the wire', () => {
    expect(openQuestionsOf({ ok: true, mutated: false, open_questions: SERVED_QUESTIONS })).toEqual(SERVED_QUESTIONS);
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

describe('AX2 (item 2): a Run reply states the product reason ONCE', () => {
  /** The served replies before the module's sentence (`f-20260926T201724Z/05` and `/12`), and that sentence, verbatim. */
  const SERVED_05 = 'No option can be put forward on MRR yet: the model treats MRR as depending on **Pro price × Pro subscribers**, but its comparison currently adds those effects rather than multiplying them.\n\n- The £59-with-AI scenario and the alternatives were all analysed, and each stayed under the **10% monthly churn** limit in nearly all simulated cases under the current assumptions.\n- But the £20k MRR threshold cannot yet be checked: the model lacks an observed MRR baseline to express that level in the analysis frame, and it does not represent the 12‑month deadline.';
  const SERVED_12 = 'With monthly churn set to **12%**, the churn constraint becomes the central unresolved issue.\n\n- Continuing as now meets it in **8.22%**.\n- The cohort-test and paid-add-on scenarios show **0%** compliance in this run, but both were treated as leaving AI unavailable; the add-on price is also unknown.\n- No option can be put forward on MRR: the model still cannot multiply price by subscriber count, and it cannot test the £20k threshold or 12‑month deadline.';
  const SERVED_CLOSING = 'No single option can be put forward yet, because Olumi reads your goal as depending on quantities that multiply together, and this model adds their effects up rather than multiplying them; running the analysis again will not change that.';
  const RANKING = 'Raising Pro to £59 produces the strongest MRR outcome.';
  const GRAPH = { nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR' }], edges: [] };
  const run = (text: string, reason = 'nonlinear_identity_sign_unproven', graph: unknown = GRAPH) => String(enforceAgentLaneLeaderClaimsAtWire(
    { response_version: 2, assistant_text: `${text}\n\n${RANKING}`, suggested_actions: [], insights: [] } as never,
    { requestId: 'r', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: reason, graph: graph as never, analysisReady: undefined },
  ).response.assistant_text);

  it('PRECONDITION: the served closing is this module\'s product-identity sentence', async () => {
    const { agentNoLeaderSentence } = await import('../withheld-leader-fail-closed.js');
    expect(agentNoLeaderSentence('nonlinear_identity_sign_unproven', undefined)).toBe(SERVED_CLOSING);
  });

  it('RED (served 05): the model\'s lead already says it — the ranking goes, the duplicate is not added', () => {
    const said = run(SERVED_05);
    expect(said).not.toContain(RANKING);
    expect(said).toContain('No option can be put forward on MRR yet');
    expect(said).not.toContain(SERVED_CLOSING);
  });

  it('RED (served 12): said in a bullet — still once', () => {
    const said = run(SERVED_12);
    expect(said).not.toContain(RANKING);
    expect(said).not.toContain(SERVED_CLOSING);
  });

  it('RED (R&C B1, fail closed): arithmetic that names the goal and multiplying is not a reason — the sentence is kept', () => {
    // R&C's probes (#2054 5850645728), verbatim: AX1-style arithmetic, which says nothing about why no option is named.
    expect(run('Your \u00a320k MRR target means multiplying price by subscribers: it needs 339 subscribers at \u00a359, or 409 at \u00a349.')).toContain(SERVED_CLOSING);
    expect(run('To reach \u00a320k MRR, multiply \u00a359 by 339 subscribers.')).toContain(SERVED_CLOSING);
  });

  it('CONTRAST: a reply that does not state the reason keeps the sentence', () => {
    const withoutLead = SERVED_05.slice(SERVED_05.indexOf('- The'));
    expect(run(withoutLead)).toContain(SERVED_CLOSING);
  });

  it('CONTRAST: another reason keeps its own sentence, whatever the reply says about multiplying', async () => {
    const { agentNoLeaderSentence } = await import('../withheld-leader-fail-closed.js');
    expect(run(SERVED_05, 'constraint_verdict_withheld')).toContain(agentNoLeaderSentence('constraint_verdict_withheld', undefined));
  });

  it('CONTRAST: with no goal to read, nothing is assumed said', () => {
    expect(run(SERVED_05, 'nonlinear_identity_sign_unproven', { nodes: [], edges: [] })).toContain(SERVED_CLOSING);
  });
});
