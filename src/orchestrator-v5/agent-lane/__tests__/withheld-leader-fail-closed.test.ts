/**
 * ⛔ THE AGENT LANE'S FAIL-CLOSED LEADER GATE — the classifier, the projection and the permit.
 *
 * The real-wording evidence is AI Quality's corpus (`compose/__tests__/leader-gate-real-replies.test.ts`).
 * This file pins the classifier's two directions separately, because over-suppression is the worse
 * defect: 10 ranking sentences must be dropped AND 10 non-ranking ones — option labels without
 * ranking, numbers that are not probabilities, idioms that borrow ranking words — must be kept.
 */
import { describe, it, expect } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import {
  AGENT_NO_LEADER_SENTENCES,
  agentNoLeaderSentence,
  dropRankingSentences,
  enforceAgentLaneLeaderClaimsAtWire,
  rankingLabelContext,
  sentenceRanksOptions,
} from '../withheld-leader-fail-closed.js';
import { PROVISIONAL_FIGURES_CAVEAT } from '../../compose/leading-option-wire-enforcement.js';

/** Paraphrases the shared exact-label gate cannot see — none uses an option's label verbatim. */
const RANKING: readonly string[] = [
  'Raising Pro to £59 comes out on top of the three options.',
  'The phased path edges out keeping £49 on MRR.',
  'Keeping £49 is the front-runner under these assumptions.',
  'The model gives the release-timed rise an 83% chance of producing the most MRR.',
  'Across the simulations, the £59 route wins 83% of the time.',
  'The release-aligned increase scores higher than the other two options.',
  'On MRR, the £59 route is ahead of phasing.',
  'It is the most likely of the three to reach £20k MRR.',
  'The analysis favours the release-timed increase.',
  'Holding the price outperforms both alternatives in the modelled runs.',
];

/** Must survive a withheld turn byte-identical. */
const NON_RANKING: readonly string[] = [
  'Raise Pro to £59 at release sets the Pro price to £59 and price–release alignment to 100%.',
  'Keep Pro at £49 holds the price at £49/month, while Phase Pro price increase moves it to £54.',
  'Monthly churn is currently assumed at 3%, against your limit of 4%.',
  'The analysis also assumed that higher MRR is the goal direction.',
  'A higher price lowers conversion, which leads to fewer new Pro subscribers.',
  'The ordering is most sensitive to the monthly churn rate, which is your own figure.',
  'Changing price–release alignment to 97.92% is the tested switch point.',
  'This is a model-relative result, not a recommendation.',
  'Your team leads will need to agree the churn baseline before the next run.',
  'Tell me the lead time for the feature release and I will add it.',
];

/**
 * REAL non-ranking sentences the first cut would have dropped, verbatim from AI Quality's paired runs
 * (branch aiq/agent-reply-paired-evidence @7b68d8bd, `paired/57f903c/runs/<case>/<arm>/rep-N.text.txt`).
 * Found by running the classifier over all 43 replies there: 25 sentences flagged, 13 genuine
 * rankings (pricing-run-complete), 12 of these. None was written by a test author.
 */
const REAL_NON_RANKING: readonly string[] = [
  // hiring-run-blocked/M/rep-3
  '- **Hire a Tech Lead** sets tech-lead capacity to **8 capacity points (0–10)**.',
  // hiring-run-blocked/C1/rep-2
  '- A reasonable assumption is that it leaves **Tech-lead capacity at 4 capacity points (0–10)** and **Developer capacity at 8 capacity points (0–20)**—the current starting levels.',
  // hiring-construction/M/rep-2
  'Whether a Tech Lead will mainly lead and unblock work, or also deliver significant hands-on output.',
  // hiring-construction/M/rep-3
  'The model also flags three questions most likely to determine the result: your current team size/productivity, how hands-on the Tech Lead would be, and onboarding/mentoring capacity.',
];

describe('the ranking-sentence classifier', () => {
  it.each(RANKING.map((s) => [s]))('RANKING, dropped: %s', (s) => {
    expect(sentenceRanksOptions(s)).toBe(true);
  });

  it.each(NON_RANKING.map((s) => [s]))('NOT ranking, kept: %s', (s) => {
    expect(sentenceRanksOptions(s)).toBe(false);
  });

  it.each(REAL_NON_RANKING.map((s) => [s]))('REAL, NOT ranking, kept: %s', (s) => {
    expect(sentenceRanksOptions(s)).toBe(false);
  });

  it('a label that itself reads as ranking vocabulary is a NAME, not a claim — but its claim still is', () => {
    const graph = { nodes: [{ id: 'o1', kind: 'option', label: 'Become Market Leader' }, { id: 'o2', kind: 'option', label: 'Keep the team as is' }] };
    const labels = rankingLabelContext(graph, undefined);
    expect(labels.rankingShapedLabels).toEqual(['Become Market Leader']);
    expect(labels.rankingShapedLabelWords).toEqual(['Leader']);
    expect(sentenceRanksOptions('Become Market Leader raises marketing spend by 20%.', labels)).toBe(false);
    expect(sentenceRanksOptions('The Market Leader push adds two hires.', labels)).toBe(false);
    expect(sentenceRanksOptions('Become Market Leader leads the comparison.', labels)).toBe(true);
    // CONTROL: without the label context the same name reads as ranking — the context is what spares it.
    expect(sentenceRanksOptions('Become Market Leader raises marketing spend by 20%.')).toBe(true);
  });
});

describe('dropping ranking sentences', () => {
  it('keeps every other sentence byte-identical, drops the ranking ones, and keeps list shape', () => {
    const text = [
      'The model cannot yet say whether raising Pro to £59 meets your criteria.',
      '',
      `- ${RANKING[8]} ${NON_RANKING[3]}`,
      `- ${RANKING[2]}`,
      `- ${NON_RANKING[2]}`,
      '',
      `${NON_RANKING[7]}`,
    ].join('\n');
    const out = dropRankingSentences(text);
    expect(out.droppedSentences).toBe(2);
    expect(out.text).toBe([
      'The model cannot yet say whether raising Pro to £59 meets your criteria.',
      '',
      `- ${NON_RANKING[3]}`,
      `- ${NON_RANKING[2]}`,
      '',
      `${NON_RANKING[7]}`,
    ].join('\n'));
  });

  it('returns the SAME reference when nothing ranks', () => {
    const text = NON_RANKING.join(' ');
    expect(dropRankingSentences(text).text).toBe(text);
    expect(dropRankingSentences(text).droppedSentences).toBe(0);
  });

  it('never drops the server’s own provisional caveat, which defines the figures rather than ranking them', () => {
    expect(sentenceRanksOptions(PROVISIONAL_FIGURES_CAVEAT), 'the control: its words alone would trip the classifier').toBe(true);
    expect(dropRankingSentences(`Kept.\n\n${PROVISIONAL_FIGURES_CAVEAT}`).droppedSentences).toBe(0);
  });
});

describe('the no-leader sentence', () => {
  it('names the typed reason and one next action', () => {
    expect(agentNoLeaderSentence('constraint_verdict_withheld', undefined)).toBe(
      'No single option can be put forward yet, because a limit on your model was not shown to be met on this run; tell me whether that limit is right as it stands, then run the analysis again.',
    );
    expect(agentNoLeaderSentence('options_do_not_separate', undefined)).toContain('too close together');
    expect(agentNoLeaderSentence('separation_unavailable', undefined)).toContain('how far apart the options are was not established');
  });

  it('falls back to the admission’s typed reason when the claim itself did not withhold', () => {
    const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional', reasons: [{ field: 'permitted_analysis_mode', code: 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED' }] } };
    expect(agentNoLeaderSentence(undefined, analysisReady)).toContain('every estimate this comparison rests on is still Olumi');
  });

  it('says the reason is not recorded rather than guessing one', () => {
    expect(agentNoLeaderSentence('some_future_code', undefined)).toContain('the reason is not recorded');
  });

  it('every sentence is inert under its own classifier', () => {
    expect(AGENT_NO_LEADER_SENTENCES.length).toBeGreaterThanOrEqual(8);
    for (const s of AGENT_NO_LEADER_SENTENCES) expect(sentenceRanksOptions(s), s).toBe(false);
  });
});

describe('the Agent-lane wire gate — withheld vs permitted', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const reply = `${RANKING[8]} ${NON_RANKING[0]}\n\n${NON_RANKING[2]}`;
  const gate = (permitted: boolean) => enforceAgentLaneLeaderClaimsAtWire(
    {
      assistant_text: reply, blocks: [], suggested_actions: [],
      analysis_state: { leader_claim: permitted ? { permitted: true, separation: 'separated' } : { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
    } as unknown as OlumiResponse,
    {
      requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: permitted, separationEstablished: permitted,
      ...(permitted ? {} : { leaderClaimWithheldReason: 'constraint_verdict_withheld' }), graph, analysisReady,
    },
  );

  it('WITHHELD: the ranking sentence goes, the rest stays byte-identical, and one no-leader sentence is appended', () => {
    const out = gate(false);
    expect(out.changed).toBe(true);
    expect(out.editedFields).toEqual(['assistant_text']);
    expect(out.response.assistant_text).toBe(`${NON_RANKING[0]}\n\n${NON_RANKING[2]}\n\n${agentNoLeaderSentence('constraint_verdict_withheld', analysisReady)}`);
  });

  it('PERMITTED: the same reply comes back untouched, by reference', () => {
    const out = gate(true);
    expect(out.changed).toBe(false);
    expect(out.response.assistant_text).toBe(reply);
  });

  it('IDEMPOTENT: gating the gated text changes nothing further', () => {
    const once = gate(false).response;
    const twice = enforceAgentLaneLeaderClaimsAtWire(once, {
      requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady,
    });
    expect(twice.changed).toBe(false);
    expect(twice.response.assistant_text).toBe(once.assistant_text);
  });
});

/**
 * ⛔ REVIEW OF #1871 (5825379110) and the Codex challenge (5825405499): synthetic probes the first head
 * kept, each with a same-family control that must stay kept, so neither direction is vacuous.
 */
describe('review of #1871 — the classifier in both directions', () => {
  const MUST_DROP: readonly string[] = [
    'The current model points more favourably to two senior engineers for shipping by Q3.',
    'The current model leans towards hiring two seniors for the Q3 outcome.',
    'Until then, the apparent £59 advantage is an unconstrained pricing result.',
    'So, the model-relative case for £59 is promising on MRR alone.',
    'Changing that relationship can switch the ordering to holding at £49/month.',
    'The £59 route has the greatest modelled MRR of the three.',
    'Raising to £59 delivers more MRR than keeping £49.',
    'The phased rise has better odds of reaching £20k.',
    'Raising to £59 dominates keeping £49 on every run.',
    'Holding at £49 is the most robust option here.',
    'Keeping £49 is the safer bet.',
    'The £59 path comes out first on MRR.',
    'Raising to £59 is my pick.',
    // Codex 5825405499: "highest plausible" was blanked whatever followed it.
    'The highest plausible MRR belongs to the £59-at-release path.',
    // A positive designation next to a negation word is still a designation.
    'The model favours £59, and neither of the others comes close.',
    'This shows which option leads: Raise to £59.',
    // A scope opening does not license an overall claim in the same sentence.
    'On the supplied MRR outcome, £59 is the best option.',
    // An UNSCOPED statistic comparison is not class C2 (fail-safe).
    'Raise Pro to £59 has a higher modelled median than Hold Pro at £49.',
  ];
  const MUST_KEEP: readonly string[] = [
    'The current model favours neither hiring plan as a decision, because it could not test your strict salary constraint.',
    'The model gives a provisional edge to neither option as a decision, because it could not test your strict salary limit.',
    'It cannot test the stated salary constraint, so no option can be treated as leading overall.',
    'On the supplied MRR outcome, Raise Pro to £59 has a higher modelled median than Hold Pro at £49 (0.285 against 0.270); the churn condition was not scored, so this does not establish which option leads overall.',
    'On the model’s internal normalised outcome scale, the £59 scenario produced the highest average outcome among the three tested prices.',
    'The model produced a comparative outcome ranking, but it ranked by “larger MRR outcome” because the MRR goal direction was not usable.',
    'The highest plausible value for churn is 6% a month.',
    'The biggest risk is that churn rises after the release.',
    'Price uncertainty dominates the result.',
  ];
  it.each(MUST_DROP.map((s) => [s] as const))('drops: %s', (s) => {
    expect(sentenceRanksOptions(s)).toBe(true);
  });
  it.each(MUST_KEEP.map((s) => [s] as const))('keeps: %s', (s) => {
    expect(sentenceRanksOptions(s)).toBe(false);
  });

  it('a win-share distribution is dropped whole; a factor’s own percentages are not', () => {
    const shares = 'Here is the split.\n\n- Raise to £59: 71%.\n- Keep £49: 29%.\n\nThe churn limit was not scored.';
    expect(dropRankingSentences(shares).text).toBe('Here is the split.\n\nThe churn limit was not scored.');
    const factors = 'Current assumptions:\n\n- Monthly churn: 4%.\n- New-Pro conversion: 5%.';
    expect(dropRankingSentences(factors).text).toBe(factors);
  });

  it('a table any row of which ranks is dropped whole, not left without its header', () => {
    const table = 'The runs:\n\n| Option | Win share |\n|---|---|\n| Raise to £59 | 71% |\n| Keep £49 | 29% |\n\nThe churn limit was not scored.';
    expect(dropRankingSentences(table).text).toBe('The runs:\n\nThe churn limit was not scored.');
    const factorTable = '| Factor | Value |\n|---|---|\n| Monthly churn | 4% |';
    expect(dropRankingSentences(factorTable).text).toBe(factorTable);
  });

  it('a ranking sentence behind an emphasised full stop goes without taking the next sentence', () => {
    const text = 'It produced the highest mean outcome, ahead of £54 (**0.212**). That comparison reflects price changes only.';
    expect(dropRankingSentences(text).text).toBe('That comparison reflects price changes only.');
  });
});

describe('review of #1871 — withheld is exactly the shared gate’s withhold arm', () => {
  const ready = (mode: string) => ({ analysis_admission: { structurally_analysable: true, permitted_analysis_mode: mode, reasons: [] } });
  const reply = 'Raise Pro to £59 at release is ahead on MRR. Monthly churn is assumed at 3%.';
  const gate = (o: { permitted: boolean; separated: boolean; mode: string; reason?: string }) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: reply, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: o.permitted, ...(o.separated ? { separation: 'separated' } : {}), ...(o.reason ? { withheld_reason: o.reason } : {}) } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: o.permitted, separationEstablished: o.separated, ...(o.reason ? { leaderClaimWithheldReason: o.reason } : {}), graph: undefined, analysisReady: ready(o.mode) },
  ).response.assistant_text;

  it('SEPARABLE PROVISIONAL (entitled, separated, quantified_provisional): caveat, not withhold — nothing is removed', () => {
    const out = gate({ permitted: true, separated: true, mode: 'quantified_provisional' });
    expect(out.startsWith(reply)).toBe(true);
    expect(out).toContain(PROVISIONAL_FIGURES_CAVEAT.trim().slice(0, 40));
  });
  it('the AUTOMATIC first run (not entitled) is withheld: the ranking sentence goes', () => {
    const out = gate({ permitted: false, separated: true, mode: 'quantified_provisional', reason: 'auto_initiated' });
    expect(out).not.toContain('is ahead on MRR');
    expect(out).toContain('Monthly churn is assumed at 3%.');
  });
  it('quantified_provisional WITHOUT separation is withheld', () => {
    expect(gate({ permitted: true, separated: false, mode: 'quantified_provisional' })).not.toContain('is ahead on MRR');
  });
  it('comparative_leader, entitled: permitted, untouched', () => {
    expect(gate({ permitted: true, separated: true, mode: 'comparative_leader' })).toBe(reply);
  });
});

describe('review of #1871 — the no-leader sentence names the admission’s reason before the claim token', () => {
  it('Panel 5825404689: constraint_verdict_withheld on an all-estimates admission names the estimates, never "a limit"', () => {
    const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional', reasons: [{ field: 'permitted_analysis_mode', code: 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED' }] } };
    const s = agentNoLeaderSentence('constraint_verdict_withheld', analysisReady);
    expect(s).toContain('every estimate this comparison rests on is still Olumi');
    expect(s).not.toContain('limit');
  });
  it('a real constraint verdict on a comparative admission still names the limit', () => {
    const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
    expect(agentNoLeaderSentence('constraint_verdict_withheld', analysisReady)).toContain('a limit on your model');
  });
});

/**
 * ⭐ SERVED SURVEY — real gpt-5.6-terra replies from 37 witness logs on served builds (90 withheld,
 * analysis-bearing turns; `output/paul-test-20260923/construction-witness/raw/*turns.jsonl`), not
 * sentences written for this test. Every drop was labelled by hand against policy #63 5824816357.
 */
describe('served survey — real replies on withheld turns', () => {
  const SERVED_C1: readonly string[] = [
    'The other paths are materially behind:',
    '- Germany is close behind despite the assumed five-person team and 3-percentage-point launch margin impact.',
    'The £3m option’s advantage rests on assumptions I authored, not evidence you supplied.',
    'If it leaves you at roughly 65%, the current model’s case for raising strengthens.',
    'If less runway is needed to preserve growth, continuing or bootstrapping becomes more competitive.',
    'So the apparent MRR-only lead for keeping £49/month is a tentative finding, not a reliable decision conclusion.',
    // The positive contrast of the served negation above.
    'The first pass names Raise to £59 as the leading option.',
    'The current analysis cannot score this limit correctly, so its £59 lead does not demonstrate compliance with the churn requirement.',
  ];
  const SERVED_KEEP: readonly string[] = [
    'The current 1 Tech Lead baseline is your board edit, not evidence of an actual available or effective lead capacity.',
    'If it were much lower, because the lead is unavailable, too stretched, or not empowered, the causal benefit would weaken.',
    'How much of the current lead’s week is spent on technical direction, unblocking decisions, review quality, and cross-team coordination?',
    'Would another lead remove a specific bottleneck, or create another coordination layer?',
    'Slow-ramping lead: the Tech Lead’s benefit arrives only after a material ramp-up period.',
    'Hiring delay and role mismatch were not set, so the analysis defaulted them to zero; that makes the comparison illustrative rather than evidence-led.',
    'They reflect the interpretation that the same release ships in both feature-led paths, while deferral retains today’s price.',
    'The churn limit is currently unscored, so the model withholds an overall leader.',
    'But the analysis itself rates robustness only moderate, and it withheld a full leader verdict because it could not score the constraint.',
    'It is not yet a recommendation.',
    'This is moderately robust, not a final recommendation.',
    'The strongest modelled drivers are delivery coordination, implementation capacity, and technical leadership capacity.',
    'The adopted 250 Pro subscribers assumption is the strongest MRR driver.',
    'These are the biggest MRR drivers.',
    'Establishing how Germany’s servicing, pricing and channel costs affect gross margin is the highest-priority correction.',
    'The £20k target is not expressed as a checkable 12-month MRR outcome in this result; it ranks relative MRR instead.',
    'The analysis engine has not been told to rank lower turnover as better, so its numerical ordering should not be read as evidence.',
    'The analysis also assumed that a higher waiting-list-reduction score is preferable.',
    'The key unknown is which bottleneck dominates today.',
    'Estimate price elasticity from past price tests, win/loss data, or customer research.',
    'The current model cannot distinguish a clear choice between hiring a Tech lead and hiring two developers.',
    'Both were starting assumptions rather than measured inputs; changing either can change which option leads.',
    'SaaS has upside, but the current 30% product-market-fit likelihood assumption constrains it.',
    // Served 21e3b38 (c23), the automatic first pass:
    '- The provisional first pass is not validated and does not name a leading option.',
    'There is no leading option yet.',
  ];
  it.each(SERVED_C1.map((s) => [s] as const))('served C1 dropped: %s', (s) => {
    expect(sentenceRanksOptions(s)).toBe(true);
  });
  it.each(SERVED_KEEP.map((s) => [s] as const))('served non-ranking kept: %s', (s) => {
    expect(sentenceRanksOptions(s)).toBe(false);
  });

  it('two percentage lists in one reply are judged separately: the win shares go, the ownership levels stay', () => {
    const text = 'The other results:\n\n- Raise £3m seed now: 66.7%\n- Continue current plan: 16.2%\n- Bootstrap for one year: 12.7%\n- Raise a phased seed: 4.4%\n\nAssumed ownership levels:\n- £3m seed: 65%\n- Bootstrap: 80%\n- Phased seed: 72%';
    expect(dropRankingSentences(text).text).toBe('The other results:\n\nAssumed ownership levels:\n- £3m seed: 65%\n- Bootstrap: 80%\n- Phased seed: 72%');
  });

  it('two lists separated only by a blank line are separate runs (the paragraph break closes a run)', () => {
    const text = '- Raise now: 60%\n- Wait a year: 40%\n\n- Ownership now: 65%\n- Ownership later: 80%';
    expect(dropRankingSentences(text).text).toBe('- Ownership now: 65%\n- Ownership later: 80%');
  });

  it('an ordered-list item is dropped whole, never leaving its bare number behind', () => {
    const text = 'The ordering is most sensitive to:\n\n1. **The link between growth and ARR** — this can switch the leading path towards bootstrap.\n2. **Runway** — a slower burn buys time.';
    expect(dropRankingSentences(text).text).toBe('The ordering is most sensitive to:\n\n2. **Runway** — a slower burn buys time.');
  });
});

/** Codex 5825866849: one option's share under a ranking heading, and a lone option share row. */
describe('a single option share row', () => {
  const graph = { nodes: [{ id: 'raise', kind: 'option', label: 'Raise to £59' }, { id: 'keep', kind: 'option', label: 'Keep £49' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const labels = rankingLabelContext(graph, undefined);
  it('RED: a ranking heading takes its value rows with it', () => {
    const text = 'Win share in the modelled runs:\n- Raise to £59: 71%.\n\nThe churn limit was not scored.';
    expect(dropRankingSentences(text, labels).text).toBe('The churn limit was not scored.');
  });
  it('RED: a PARAPHRASED row under a ranking heading goes too (only the heading can tell what it means)', () => {
    const text = 'Win share in the modelled runs:\n- The release-timed rise: 71%.\n\nThe churn limit was not scored.';
    expect(dropRankingSentences(text, labels).text).toBe('The churn limit was not scored.');
  });
  it('RED: a lone "<option>: N%" row is dropped even without a heading', () => {
    const text = 'Here is where things stand.\n\n- Raise to £59: 71%.\n\nThe churn limit was not scored.';
    expect(dropRankingSentences(text, labels).text).toBe('Here is where things stand.\n\nThe churn limit was not scored.');
  });
  it('CONTROL: a factor’s own percentage row under a neutral heading stays', () => {
    const text = 'Current assumptions:\n- Monthly churn: 4%.\n\nThe churn limit was not scored.';
    expect(dropRankingSentences(text, labels).text).toBe(text);
  });
  it('CONTROL: a caveat list survives its ranking heading — only value rows go with it', () => {
    const text = 'Why this model favours Raise to £59:\n- It assumes churn stays at 3%, which was not measured.\n- Raise to £59: 71%.';
    expect(dropRankingSentences(text, labels).text).toBe('- It assumes churn stays at 3%, which was not measured.');
  });
  it('through BOTH wire gates on a withheld turn, 71% never reaches the user', () => {
    const out = enforceAgentLaneLeaderClaimsAtWire(
      { assistant_text: 'Win share in the modelled runs:\n- Raise to £59: 71%.\n\nThe churn limit was not scored.', blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady: { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } } },
    );
    expect(out.response.assistant_text).not.toContain('71%');
    expect(out.response.assistant_text).toContain('The churn limit was not scored.');
  });
});

/**
 * ⛔ REVIEW OF #1871 AT 9cc81d60 (5825898337): the served-survey idioms were too broad and blanked the
 * POSITIVE result form. Each probe below is the reviewer's own; each served KEEP pin above still holds.
 */
describe('review of #1871 at 9cc81d60 — the result forms stay ranking', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }] };
  const labels = rankingLabelContext(graph, undefined);
  const REVIEWER_C1: readonly string[] = [
    'The current lead is the £59-at-release path.',
    'The lead is narrow, and it belongs to the £59 path.',
    'The price-rise lead is about four points.',
    'Raising Pro to £59 is the highest-priority move for you.',
    'On these runs, the £59 path appears to rank first.',
    'The £59 path ranks on top across the runs.',
    'The £59 path should be ranked first.',
    'Higher MRR under the £59 path is preferable to holding at £49.',
    'The £59 path came out at 71% and holding at £49 at 29%.',
  ];
  it.each(REVIEWER_C1.map((s) => [s] as const))('dropped: %s', (s) => {
    expect(sentenceRanksOptions(s, labels)).toBe(true);
  });
  it('KEPT: the served method sentence the narrowed idiom was written for', () => {
    expect(sentenceRanksOptions('Confirm that the waiting-list goal should be ranked as more reduction is better.', labels)).toBe(false);
  });
  it('em-dash share rows go, as colon rows do', () => {
    expect(dropRankingSentences('Split:\n\n- The £59 path — 71%\n- Holding at £49 — 29%\n\nThe churn limit was not scored.', labels).text)
      .toBe('Split:\n\nThe churn limit was not scored.');
  });
  it('a share table whose header has no ranking word goes whole; a factor table with a likelihood column stays', () => {
    const share = 'Runs:\n\n| Option | Share |\n|---|---|\n| Raise Pro to £59 at release | 71% |\n| Keep Pro at £49 | 29% |\n\nThe churn limit was not scored.';
    expect(dropRankingSentences(share, labels).text).toBe('Runs:\n\nThe churn limit was not scored.');
    const factors = '| Factor | Likelihood |\n|---|---|\n| Product-market fit | 30% |';
    expect(dropRankingSentences(factors, labels).text).toBe(factors);
  });
});

/** Codex 5826046448: a win-share split in running prose, under a ranking heading. */
describe('a share split in prose', () => {
  const graph = { nodes: [{ id: 'raise', kind: 'option', label: 'Raise to £59' }, { id: 'keep', kind: 'option', label: 'Keep £49' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  it('RED: through BOTH gates on a withheld turn, the 71/29 split never reaches the user', () => {
    const out = enforceAgentLaneLeaderClaimsAtWire(
      { assistant_text: 'Win shares in modelled runs:\nThe £59 path at 71% and holding at 29%.\nThe churn limit was not scored.', blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
    );
    expect(out.response.assistant_text).not.toMatch(/71%|29%/);
    expect(out.response.assistant_text).toContain('The churn limit was not scored.');
  });
  it('CONTROL: two percentages that are not a split stay (a factor against its limit)', () => {
    expect(sentenceRanksOptions('Monthly churn is assumed at 3.5%, against your limit of 4%.')).toBe(false);
    expect(sentenceRanksOptions('Conversion is 5% and churn is 3%.')).toBe(false);
  });
});

/** Review of #1871 at c0da634c (5825189511 / 5826189511) and Codex 5826167622. */
describe('review of #1871 at c0da634c', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const labels = rankingLabelContext(graph, undefined);
  const DROP: readonly string[] = [
    'There is no best option other than the £59 path.',
    'There is no clear winner except raising to £59.',
    'The highest-priority fix is to raise Pro to £59 at release.',
    'The £59 path at 71 per cent and holding at 29 per cent.',
    'The current lead is effective.',
  ];
  const KEEP: readonly string[] = [
    'Monthly churn could plausibly sit anywhere between 45% and 55%.',
    'Conversion is uncertain: somewhere from 30% to 70%.',
    'In the current model, 40% of capacity is engineering and 60% is support.',
    '40% of responses supported the plan and 60% raised concerns.',
    'The highest-priority correction is to measure churn against its baseline.',
    'There is no leading option yet.',
  ];
  it.each(DROP.map((s) => [s] as const))('dropped: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(true); });
  it.each(KEEP.map((s) => [s] as const))('kept: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(false); });
  it('an option label is the cue: a label-named 100% split goes even with no option noun', () => {
    expect(sentenceRanksOptions('Keep Pro at £49 came to 29% and Raise Pro to £59 at release to 71%.', labels)).toBe(true);
  });
});
