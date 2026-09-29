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
    // DL #70 5847835872: never "fix the limit, run again" when no typed cause proves the limit is what would change.
    expect(agentNoLeaderSentence('constraint_verdict_withheld', undefined)).toBe(
      'No single option can be put forward yet, because a limit on your model was not shown to be met on this run, and running the analysis again as it stands will not change that; ask me what the limit needs before it can be checked.',
    );
    expect(agentNoLeaderSentence('options_do_not_separate', undefined)).toContain('too close together');
    expect(agentNoLeaderSentence('separation_unavailable', undefined)).toContain('how far apart the options are was not established');
  });

  it('falls back to the admission’s typed reason when the claim itself did not withhold', () => {
    const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional', reasons: [{ field: 'permitted_analysis_mode', code: 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED' }] } };
    expect(agentNoLeaderSentence(undefined, analysisReady)).toContain('every estimate this comparison rests on is still Olumi');
  });

  it('C46 (H7): a product the analysis adds up is said as that — never "not recorded", never "run it again"', () => {
    expect(agentNoLeaderSentence('nonlinear_identity_sign_unproven', { status: 'ready' })).toBe(
      'No single option can be put forward yet, because Olumi reads your goal as depending on quantities that multiply ' +
      'together, and this model adds their effects up rather than multiplying them; running the analysis again will not change that.',
    );
  });

  /**
   * ⛔ C46 N-c — WHOSE READING IT IS (`admit-model.ts` `productIdentityClause`: the brief's own words are said as
   * fact, anything else as Olumi's reading). This sentence is a static map with no graph, so it cannot see
   * `stated_in_brief`; it must therefore never say the product as a fact about the user's goal. Driven through the
   * real wire gate on a graph whose ONE carrier is Olumi's reading (`stated_in_brief: false`).
   */
  it('C46 (H7, N-c): on a product Olumi inferred, the closing sentence says it as Olumi’s reading — never as the user’s goal', () => {
    const carrierOn = (stated: boolean) => ({
      nodes: [
        { id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: { operation: 'product', factor_ids: ['price', 'subs'], stated_in_brief: stated } },
        { id: 'price', kind: 'factor', label: 'Pro plan price' },
        { id: 'subs', kind: 'factor', label: 'Pro subscribers' },
        { id: 'keep', kind: 'option', label: 'Keep Pro at £49' },
        { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' },
      ],
      edges: [],
    });
    const analysisReady = { status: 'ready' };
    const closingOn = (stated: boolean): string => {
      const out = enforceAgentLaneLeaderClaimsAtWire(
        {
          assistant_text: `${RANKING[8]} ${NON_RANKING[0]}`, blocks: [], suggested_actions: [],
          analysis_state: { leader_claim: { permitted: false, withheld_reason: 'nonlinear_identity_sign_unproven' } },
        } as unknown as OlumiResponse,
        {
          requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false,
          leaderClaimWithheldReason: 'nonlinear_identity_sign_unproven', graph: carrierOn(stated), analysisReady,
        },
      );
      expect(out.response.assistant_text.startsWith(`${NON_RANKING[0]}\n\n`), 'the ranking sentence went, the rest stayed').toBe(true);
      return out.response.assistant_text.slice(`${NON_RANKING[0]}\n\n`.length);
    };
    const inferred = closingOn(false);
    expect(inferred).toBe(agentNoLeaderSentence('nonlinear_identity_sign_unproven', analysisReady));
    expect(inferred, 'the product is never said as a fact about the user’s goal').not.toMatch(/\byour goal (?:depends on|is)\b/i);
    expect(inferred).toContain('Olumi reads your goal as depending on quantities that multiply together');
    // The static map cannot see provenance, so a product the user STATED gets the same, never-over-claiming words.
    expect(closingOn(true)).toBe(inferred);
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
    // Codex 5826253038: a composition INSIDE one option is not a split over the options.
    'For the Keep Pro at £49 option, 40% of capacity is engineering and 60% is support.',
    'In the £59 path, 40% of customers are in Europe and 60% are in the US.',
    '40% of the £59 path’s customers are in Europe and 60% in the US.',
  ];
  it.each(DROP.map((s) => [s] as const))('dropped: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(true); });
  it.each(KEEP.map((s) => [s] as const))('kept: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(false); });
  it('the percentages may precede their options: "71% for the £59 path and 29% for holding" goes', () => {
    expect(sentenceRanksOptions('The runs gave 71% for the £59 path and 29% for holding.', labels)).toBe(true);
  });
  it('an option label is the cue: a label-named 100% split goes even with no option noun', () => {
    expect(sentenceRanksOptions('Keep Pro at £49 came to 29% and Raise Pro to £59 at release to 71%.', labels)).toBe(true);
  });
});

/** Review of #1871 at 5d1d066e (5826509657): a full split whose options follow the percentages, or are paraphrased. */
describe('review of #1871 at 5d1d066e — the respectively-order split', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const labels = rankingLabelContext(graph, undefined);
  const DROP: readonly string[] = [
    'The runs split 71% to 29% between the £59 path and holding.',
    'The runs split 71%–29% between the £59 path and holding.',
    'The runs split 71% to 29% between the £59 and £49 paths.',
    // Found while fixing: options named by NUMBER satisfied the old loose "between … and <digit>" range test.
    'The runs split 71% to 29% between options 1 and 2.',
    'The runs split 29% to 71% between holding and the £59 path.',
    'The runs split 71 per cent to 29 per cent between the £59 path and holding.',
    'Across the runs, the release-timed rise took 71% and the current price 29%.',
    'Of the 1,000 modelled runs, the rise came out ahead in 71% and the current price in 29%.',
    'Win share: 71% and 29% for the rise and the current price.',
    // No "split", no "runs": only the trailing legend names the options.
    'The result was 71% to 29% between the £59 path and holding.',
    'The result was 71% and 29% for Raise Pro to £59 at release and Keep Pro at £49 respectively.',
  ];
  const KEEP: readonly string[] = [
    // The reviewer's KEEP set.
    'Monthly churn could plausibly sit anywhere between 45% and 55%.',
    'Conversion is uncertain: somewhere from 30% to 70%.',
    'Churn could be 40% to 60%.',
    'Churn could be 40%–60%.',
    'The £59 path’s conversion could be 40% to 60%.',
    'On the £59 path conversion is 45%-55%, and holding is similar.',
    'For the Keep Pro at £49 option, 40% of capacity is engineering and 60% is support.',
    'In the £59 path, 40% of customers are in Europe and 60% are in the US.',
    // A driver split across the runs is not a win share.
    'Across the runs, 40% of the variance comes from churn and 60% from price.',
    // "Across the runs" with no winning verb is a statement about factors, not a share (it sums to ~100 by chance).
    'Across the runs, churn stays near 4% and retention near 96%.',
    // A change, not a split.
    'Retention could fall from 70% to 30%.',
    'Raising the price could cut retention 70% to 30%.',
    'Churn could be between roughly 45% and 55% per cent.',
  ];
  it.each(DROP.map((s) => [s] as const))('dropped: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(true); });
  it.each(KEEP.map((s) => [s] as const))('kept: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(false); });
  it('RED: through BOTH gates on a withheld turn, the respectively split never reaches the user', () => {
    const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
    const out = enforceAgentLaneLeaderClaimsAtWire(
      { assistant_text: 'The churn limit was not scored. The runs split 71% to 29% between the £59 path and holding. Churn is the input to check.', blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
    );
    expect(out.response.assistant_text).not.toMatch(/71%|29%/);
    expect(out.response.assistant_text).toContain('The churn limit was not scored.');
    expect(out.response.assistant_text).toContain('Churn is the input to check.');
  });
});

/** Review of #1871 at aae2cac7 (5827687841): the legend BEFORE the percentages, a split with no % sign, and two over-drops. */
describe('review of #1871 at aae2cac7 — the leading legend', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const labels = rankingLabelContext(graph, undefined);
  const DROP: readonly string[] = [
    'The £59 path and holding came in at 71% and 29%.',
    'The £59 path and holding came in at 71% and 29% respectively.',
    'Raising to £59 and holding: 71% and 29%.',
    'The two options, raising and holding, scored 71% and 29%.',
    'Raise Pro to £59 at release and Keep Pro at £49 came in at 71% and 29%.',
    // No % sign, when the sentence says split / win share and is about the runs or two options.
    'The runs split 71/29 between the £59 path and holding.',
    'The runs split 71–29 between the £59 path and holding.',
    'The win share split 71/29 between raising and holding.',
  ];
  const KEEP: readonly string[] = [
    'For the Keep Pro at £49 option, 40% of capacity is engineering and 60% is support.',
    'The churn limit is 4%, and 96% of customers stay each month on either option.',
    'The team split 60/40 between engineering and support.',
    // Over-drops the delta introduced (non-blocking in the verdict), now kept.
    'Retention could drop 70% to 30% on the £59 path compared with holding.',
    'Of the runs, 60% took longer than a year to break even and 40% did not, on both options.',
  ];
  it.each(DROP.map((s) => [s] as const))('dropped: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(true); });
  it.each(KEEP.map((s) => [s] as const))('kept: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(false); });
  it('RED: through BOTH gates on a withheld turn, the leading-legend split never reaches the user', () => {
    const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
    const out = enforceAgentLaneLeaderClaimsAtWire(
      { assistant_text: 'The churn limit was not scored. The £59 path and holding came in at 71% and 29%. Churn is the input to check.', blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
    );
    expect(out.response.assistant_text).not.toMatch(/71%|29%/);
    expect(out.response.assistant_text).toContain('Churn is the input to check.');
  });
});

/** Review of #1871 at 8f45ee2e (5827973102): a legend is DISTINCT OPTION REFERENCES, whatever word joins them. */
describe('review of #1871 at 8f45ee2e — a legend is counted, not parsed', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const labels = rankingLabelContext(graph, undefined);
  const DROP: readonly string[] = [
    'The £59 path over holding: 71% to 29%.',
    'The £59 path against holding: 71% and 29%.',
    'The £59 path compared with holding came in at 71% and 29%.',
    'Raising/holding: 71%/29%.',
    'Raise Pro to £59 at release against Keep Pro at £49: 71% and 29%.',
    // Joining words on no list: the count does not depend on the joiner.
    'The £59 path, then holding: 71% and 29%.',
    'Raising & holding: 71% and 29%.',
    // Item 2: one % sign on the last number, either order, and the count form.
    'Raising vs holding: 71-29%.',
    'Raising vs holding: 29-71%.',
    'The £59 path and holding: 71 and 29 per cent.',
    'The £59 path won 71 of 100 runs and holding 29.',
  ];
  const KEEP: readonly string[] = [
    'For the Keep Pro at £49 option, 40% of capacity is engineering and 60% is support.',
    'Retention could drop 70% to 30% on the £59 path compared with holding.',
    'The team split 60/40 between engineering and support.',
    'Churn could fall 70% to 30% over a year on either path.',
    'The churn limit is 4%, and 96% of customers stay each month on either option.',
    'We split the 2025/26 budget between the £59 path and holding.',
    'Both options split 50/50 on the retention question.',
    // Item 3: the figure applies to every option named.
    'On both the £59 path and holding, 96% of customers stay and 4% churn.',
    'For raising and holding alike, churn is 4% and retention 96%.',
    'The £59 path’s conversion could be 40% to 60%.',
  ];
  it.each(DROP.map((s) => [s] as const))('dropped: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(true); });
  it.each(KEEP.map((s) => [s] as const))('kept: %s', (s) => { expect(sentenceRanksOptions(s, labels)).toBe(false); });
  it('RED: through BOTH gates on a withheld turn, "X over Y: 71% to 29%" never reaches the user', () => {
    const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
    const out = enforceAgentLaneLeaderClaimsAtWire(
      { assistant_text: 'The churn limit was not scored. The £59 path over holding: 71% to 29%. Churn is the input to check.', blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
    );
    expect(out.response.assistant_text).not.toMatch(/71%|29%/);
    expect(out.response.assistant_text).toContain('Churn is the input to check.');
  });
});

/** Pre-review of #1871 at f36e7fea (5828141606): a metric per option is v6 class C2 — kept; a share is still dropped. */
describe('pre-review of #1871 at f36e7fea — a metric per option is not a share', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const labels = rankingLabelContext(graph, undefined);
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const wire = (sentence: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: `The churn limit was not scored. ${sentence} Churn is the input to check.`, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text;
  it.each([
    'On the supplied retention metric, the £59 path has 40% retention, while holding has 60% retention.',
    'The £59 path shows 40% uptake and holding 60% uptake.',
    // The quantifier genuinely scopes the OPTIONS.
    'On both the £59 and £49 paths, 96% of customers stay and 4% churn.',
    'On both the £59 path and holding, 96% of customers stay and 4% churn.',
  ])('RED: kept through BOTH gates (C2, a scoped metric): %s', (s) => { expect(wire(s)).toContain(s); });
  it.each([
    'The £59 path has 71% and holding 29%.',
    'The £59 path at 71% and holding at 29%.',
    'The £59 path wins 71% of runs while holding wins 29%.',
    // Says it is a win share, so a measure after each figure does not make it a metric reading.
    'The runs split 71% uptake for the £59 path and 29% uptake for holding.',
    // Only ONE percentage names a measure: not a metric reading — fail closed.
    'The £59 path has 71% retention and holding 29%.',
    // Pre-review addendum 5828219261: "both" scopes something other than the options — the split stands.
    'For both customer cohorts, the £59 path over holding: 71% to 29%.',
    'Across both regions, raising and holding came in at 71% and 29%.',
    // Pre-review addendum 5828272340: the quantifier's scope is its FOLLOWING phrase, not the punctuation.
    'For both customer cohorts \u2014 the £59 path over holding: 71% to 29%.',
    'For both customer cohorts the £59 path over holding: 71% to 29%.',
    'For both cohorts alike, the £59 path over holding: 71% to 29%.',
    'Both the £59 path and holding came in at 71% and 29%.',
  ])('CONTROL: a share is still removed through BOTH gates: %s', (s) => { expect(wire(s)).not.toMatch(/71%|29%/); });
  it('PERMITTED CONTROL: the same "both cohorts" sentence passes unchanged when a leader may be named', () => {
    const text = 'The churn limit was scored. For both customer cohorts, the £59 path over holding: 71% to 29%.';
    const out = enforceAgentLaneLeaderClaimsAtWire(
      { assistant_text: text, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: true } } } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: true, graph, analysisReady },
    );
    expect(out.response.assistant_text).toBe(text);
  });
  it('the classifier agrees', () => {
    expect(sentenceRanksOptions('On the supplied retention metric, the £59 path has 40% retention, while holding has 60% retention.', labels)).toBe(false);
    expect(sentenceRanksOptions('The £59 path has 71% and holding 29%.', labels)).toBe(true);
  });
});

/**
 * Review of #1871 at 18a706e2 (5828487458): a quantifier that really scopes the options exempts the figure only when the
 * sentence does not then set the options against each other. The phrase ends at its head noun, not at punctuation.
 */
describe('review of #1871 at 18a706e2 — a quantifier over the options, then a split', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const wire = (sentence: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: `The churn limit was not scored. ${sentence} Churn is the input to check.`, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text;
  it.each([
    // Item 1: the reviewer's eight rows.
    'Across both paths, raising over holding: 71% to 29%.',
    'Across all options, raising over holding: 71% to 29%.',
    'Across both paths, the £59 path and holding came in at 71% and 29%.',
    'On both options, the £59 path against holding: 71% and 29%.',
    'With both options modelled, the £59 path over holding: 71% to 29%.',
    'In all scenarios, the £59 path over holding: 71% to 29%.',
    'For each option in the runs, the £59 path over holding: 71% to 29%.',
    'Under either option set, raising/holding: 71%/29%.',
    // The phrase boundary is its head noun, not punctuation.
    'Across both paths raising over holding: 71% to 29%.',
    'On both options the £59 path against holding: 71% and 29%.',
    // A plural head ends the phrase, so the names after it are not part of the scope.
    'Across both paths raising and holding: 71% to 29%.',
    // The same class from the other side: options named BEFORE the quantifier are set against each other.
    'Raising over holding across both paths: 71% to 29%.',
    'The £59 path and holding, across both paths: 71% and 29%.',
    'Raising over holding for both cohorts: 71% to 29%.',
    'Raising over holding, both paths alike: 71% to 29%.',
    // Item 2: "alike", then a later clause that splits.
    'Raising and holding alike were modelled; the £59 path over holding: 71% to 29%.',
    // Item 3: a preference or run count is a share, not a metric.
    'The £59 path has 71% support and holding 29% support.',
    'The £59 path gets 71% preference and holding 29% preference.',
    'The £59 path took 71% runs and holding 29% runs.',
    'The £59 path has 71% backing and holding 29% backing.',
    'The £59 path carries 71% confidence and holding 29% confidence.',
  ])('RED: removed through BOTH gates: %s', (s) => { expect(wire(s)).not.toMatch(/71%|29%/); });
  it.each([
    'On both the £59 and £49 paths, 96% of customers stay and 4% churn.',
    'On both the £59 path and holding, 96% of customers stay and 4% churn.',
    'Across both paths, 96% of customers stay and 4% churn.',
    'Across both paths 96% of customers stay and 4% churn.',
    'Under either option, 96% of customers stay and 4% churn.',
    'Raising and holding alike keep 96% of customers and lose 4%.',
  ])('CONTROL: the figure applies to every option, so it is kept: %s', (s) => { expect(wire(s)).toContain(s); });
});

/**
 * Review of #1871 at b2b3d3c2 (5828786795): when the quantified phrase LISTS the options and a bare pair follows with
 * nothing but function or share words in between, the figures are distributed over the options, not shared by them.
 */
describe('review of #1871 at b2b3d3c2 — a bare pair after a listed phrase is distributed', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const wire = (sentence: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: `The churn limit was not scored. ${sentence} Churn is the input to check.`, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text;
  it.each([
    // The reviewer's rows.
    'For both raising and holding, 71% and 29% respectively.',
    'For both raising and holding, the shares are 71% and 29% respectively.',
    'For both Keep Pro at £49 and Raise Pro to £59 at release, 29% and 71% respectively.',
    'Under either the £59 path or holding, 71% and 29% respectively.',
    'For raising and holding alike, 71% and 29% respectively.',
    'For both raising and holding, 71% and 29%.',
    'For both raising and holding: 71% vs 29%.',
    'For both raising and holding, 71% versus 29%.',
    'For both raising and holding, 71%/29%.',
    'On both the £59 path and holding 71% to 29%.',
    // The same class, found on self-review.
    'For each of raising and holding, 71% and 29% respectively.',
    'For both raising and holding: 71% and 29%.',
    'On both the £59 path and holding, 71% and 29%.',
    'Raising and holding alike: 71% to 29%.',
    // Ascending: a pair after a listed phrase is its split in either order, never a range.
    'Raising and holding alike: 29% to 71%.',
    'Under either raising or holding, 71% vs 29%.',
    'For both raising and holding, the win share is 71% and 29%.',
    '71% and 29% across both the £59 path and holding.',
    // Self-review of ee11de4c: the words before a bare pair are an open class — only a change or range verb exempts.
    'For both raising and holding, it is 71% and 29%.',
    'For both raising and holding, the figures are 71% and 29%.',
    'For both raising and holding, the results come out at 71% and 29%.',
    'For both raising and holding we see 71% and 29%.',
    'On both the £59 path and holding, the outcome is 71% vs 29%.',
    'Raising and holding alike: the numbers were 71% and 29% respectively.',
    'On both the £59 path and holding, retention is 71% and 29%.',
    // Pre-review 5828932090: a bare pair naming no option still splits them — its legend may be another sentence.
    'Across both paths, 71% and 29%.',
    'On both options, 71% and 29% respectively.',
    // Review 5828992113 on ee11de4c: a content word before the pair, or a longer joiner between its figures.
    'For both Keep Pro at £49 and Raise Pro to £59 at release, the model shows 29% and 71% respectively.',
    'For both raising and holding, the model gives 71% and 29% respectively.',
    'For both raising and holding, the model gives 71% and 29%.',
    'For both raising and holding, the outcomes come to 71% and 29% respectively.',
    'For both raising and holding, the runs came out 71% and 29% respectively.',
    'On both the £59 path and holding, results were 71% and 29%.',
    'Raising and holding alike scored 71% and 29% respectively.',
    'Under either raising or holding the figures are 71% and 29%.',
    'For both raising and holding, 71% compared with 29%.',
    'For both raising and holding, 71% as against 29%.',
    'For both raising and holding, 71% and just 29%.',
    'For both raising and holding, 71% and then 29%.',
    'For both raising and holding, 71% and 29% are the win shares.',
    'For both raising and holding, 71% and 29% are the results.',
    'On both the £59 path and holding, 71% and 29% were the figures.',
    // Self-review of c39c789d: the share is the clause's head noun, not its first word.
    'For both raising and holding, 71% and 29% of model runs.',
    'For both raising and holding, 71% and 29% of the simulated draws.',
    // Pre-review 5829142299: the words BETWEEN the figures are an open class too — none gives a figure its own measure.
    'For both raising and holding, 71% rather than 29%.',
    'For both raising and holding, 71% & 29%.',
    'For both raising and holding, 71% rather than a mere 29%.',
    'For both raising and holding, 71% unlike 29%.',
    'For both raising and holding, 71% versus merely 29%.',
  ])('RED: removed through BOTH gates: %s', (s) => { expect(wire(s)).not.toMatch(/71%|29%/); });
  it.each([
    'We compared raising and holding, in that order. Across both paths, 71% and 29% respectively.',
    'We compared Raise Pro to £59 at release and Keep Pro at £49, in that order. Across both paths, 71% and 29% respectively.',
  ])('RED: the legend in the sentence before: %s', (lead) => {
    const out = enforceAgentLaneLeaderClaimsAtWire(
      { assistant_text: `${lead} Churn is the input to check.`, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
    ).response.assistant_text;
    expect(out).not.toMatch(/71%|29%/);
    expect(out).toContain(lead.split('. ')[0]!);
    expect(out).toContain('Churn is the input to check.');
  });
  it.each([
    'On both the £59 path and holding, 96% of customers stay and 4% churn.',
    'Raising and holding alike keep 96% of customers and lose 4%.',
    'Retention could move from 70% to 30% under either option.',
    // Review 5828992113's KEEPs: each figure says what it measures, or the pair is shared over another list.
    'For both raising and holding, 97% and 3% are the renewal and churn rates.',
    'For both raising and holding, 96% retention and 4% churn.',
    'For both raising and holding, retention is 96% and churn 4%.',
    'For both raising and holding, conversion is 50% and 50% is lost at trial.',
    'For both raising and holding, the split of revenue is 60% and 40% between annual and monthly plans.',
    // Two measures, not a bare pair: the last figure says what it measures.
    'For both raising and holding, the churn limit is 4%, and 96% of customers stay each month.',
    // The reviewer's KEEPs.
    'On both the £59 path and holding, 96% of customers stay and 4% churn, the same as today.',
    'For both raising and holding, 96% of customers stay and 4% churn.',
    'On both the £59 path and holding, 96% and 95% of customers stay respectively.',
    'Under either option, retention moves from 90% to 92%; holding keeps the price.',
    'On both options, churn falls 5% to 3%, whether we raise or hold.',
  ])('CONTROL: kept: %s', (s) => { expect(wire(s)).toContain(s); });
});

/**
 * Review of #1871 at c39c789d (5829185444): the EXITS are the tested class. Figures sharing ~100 after a phrase that
 * lists the options, or beside "respectively" / "in that order", are dropped whatever the joiner, verb or trailing
 * noun — unless each figure has a measure word of its own, or another list names what they are shared over.
 */
describe('review of #1871 at c39c789d — the exits, not the leaks, are the class', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const gate = (text: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: text, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text;
  const wire = (sentence: string) => gate(`The churn limit was not scored. ${sentence} Churn is the input to check.`);
  it.each([
    // §1: a trailing measure noun no longer exempts a labelled split.
    'For both Keep Pro at £49 and Raise Pro to £59 at release, 29% and 71% success rates respectively.',
    'For both raising and holding, 71% and 29% success rates respectively.',
    'For both raising and holding, 71% and 29% goal attainment respectively.',
    'For both raising and holding, 71% and 29% of model runs.',
    // §2: a change or range verb does not stop the pair mapping onto the options.
    'For both raising and holding, the odds changed to 71% and 29% respectively.',
    'For both Keep Pro at £49 and Raise Pro to £59 at release, the odds changed to 29% and 71% respectively.',
    'For both raising and holding, the chances moved to 71% and 29% respectively.',
    'Across both raising and holding, the runs divide between them 71% and 29%.',
    // §3: joiners outside any list.
    'For both raising and holding, 71% rather than 29%.',
    'For both raising and holding, 71% & 29%.',
    // §5: one word elsewhere no longer disables the test.
    'For both raising and holding, 71% and 29% respectively, not anywhere near a tie.',
    'Raising takes 71% and holding 29%, not anywhere near a tie.',
    // Pre-review 5829375898 and self-review of 03795a50: a measure must be ATTACHED to its figure, not a word on its side.
    'For both raising and holding, the analysis gives 71% and 29% success rates respectively.',
    'For both Keep Pro at £49 and Raise Pro to £59 at release, the analysis gives 29% and 71% success rates respectively.',
    'For both raising and holding, the analysis gives 71% and 29% success rates.',
    'For both raising and holding, the model gives 71% and the runs give 29%.',
    'For both raising and holding, the model gives 71% and the simulation reports 29%.',
    'For both raising and holding, 71% came from model A and 29% came from model B.',
    'For both raising and holding, the model shows 71% and then shows 29%.',
    'For both raising and holding, the first gets 71% and the second gets 29%.',
    'For both raising and holding, the former scores 71% and the latter 29%.',
    'For both raising and holding, 71% goes one way and 29% the other.',
    // A word the figures share by stem is neither's own ("shows … show").
    'For both raising and holding, 71% shows up in model A and 29% show up in model B.',
    // "respectively" maps the figures onto the options even when each has its own measure.
    'For both raising and holding, retention is 71% and churn 29% respectively.',
  ])('RED: removed through BOTH gates: %s', (s) => { expect(wire(s)).not.toMatch(/71|29/); });
  it.each([
    'We compared raising and holding, in that order. Across both paths, 71 and 29 per cent respectively.',
    'We compared raising and holding, in that order. Across both paths, 71/29 respectively.',
    'We compared raising and holding, in that order. Across both paths, 71-29% respectively.',
    'We compared holding and raising, in that order. Across both paths, 29% to 71% respectively.',
    'We compared holding and raising, in that order. Across both paths, 29-71% respectively.',
    'We compared Raise Pro to £59 at release and Keep Pro at £49, in that order. Across both paths, 71 and 29 per cent respectively.',
    'We compared Raise Pro to £59 at release and Keep Pro at £49, in that order. With the new inputs, their chances rose to 71% and 29% respectively.',
    'We compared raising and holding, in that order. With the new inputs, their chances rose to 71% and 29% respectively.',
  ])('RED (§2, §4): the legend in the sentence before, every form: %s', (lead) => {
    const out = gate(`${lead} Churn is the input to check.`);
    expect(out).not.toMatch(/71|29/);
    expect(out).toContain('Churn is the input to check.');
  });
  it.each([
    // Over-drops at c39c789d, kept again: no option is named, and another list says what the figures are over.
    'Annual and monthly plans are 70% and 30% respectively.',
    'The survey came back 55% and 45%.',
    // Still kept.
    'Churn and retention sit at 4% and 96% today.',
    'Annual and monthly plans are 70% and 30% of customers respectively.',
    'Your current base renews at 96% and churns at 4%.',
    'Last quarter, 60% and 40% of signups came from ads and referrals respectively.',
    'For both raising and holding, 96% of customers stay and 4% churn.',
    'Both options split 50/50 on the retention question.',
    'For both raising and holding, retention is 96% and churn 4%.',
    'For both raising and holding, 40% of customers are annual and 60% are monthly.',
  ])('CONTROL: kept: %s', (s) => { expect(wire(s)).toContain(s); });
  it.each([
    // RESIDUAL, named — over-drops in the fail-closed direction: a movement or span beside a list of both options.
    'On both the £59 path and holding, churn could fall 70% to 30%.',
    'On both the £59 path and holding, retention ranges 30% to 70%.',
    'For both raising and holding, retention is between 30% and 70%.',
  ])('RESIDUAL (fail closed, named): dropped: %s', (s) => { expect(wire(s)).not.toContain(s); });
  it.each([
    // RESIDUAL, named — kept: no option is named and nothing orders the figures.
    'It came out 71% to 29%.',
  ])('RESIDUAL (named): kept: %s', (s) => { expect(wire(s)).toContain(s); });
});

/**
 * Review of #1871 at 03795a50 (5829408359): the reply BEFORE a sentence counts. An earlier "in that order" orders a
 * later bare pair; an earlier sentence naming both options makes it theirs unless each figure has its own measure.
 */
describe('review of #1871 at 03795a50 — the ordering carries across sentences', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const gate = (text: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: text, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text;
  it.each([
    ['We compared Raise Pro to £59 at release and Keep Pro at £49, in that order.', 'The results were 71% and 29%.'],
    ['We compared raising and holding, in that order.', 'The results were 71% and 29%.'],
    ['We compared raising and holding, in that order.', 'Success came out 71% and 29%.'],
    ['We compared raising and holding, in that order.', 'It came out 71% to 29%.'],
    ['Here are raising and holding, respectively.', 'The results were 71% and 29%.'],
    // Naming both options earlier, with no ordering word, is enough when the figures have no measure of their own.
    ['We compared raising and holding.', 'The results were 71% and 29%.'],
    // An earlier "in that order" orders the figures even when each has its own measure.
    ['We compared raising and holding, in that order.', 'Retention is 71% and churn 29%.'],
  ])('RED: %s → "%s" is removed; the lead and the tail stay', (lead, pair) => {
    const out = gate(`${lead} ${pair} Churn is the input to check.`);
    expect(out).not.toMatch(/71|29/);
    expect(out).toContain('Churn is the input to check.');
  });
  it.each([
    // §2: the same measure repeated is no measure of either figure's own.
    'For both raising and holding, 71% goal attainment and 29% goal attainment respectively.',
    'For both raising and holding, 71% success rate and 29% success rate respectively.',
    'For both raising and holding, 71% hit the target and 29% hit the target.',
    'For both raising and holding, 71% meet the goal and 29% meet the goal respectively.',
  ])('RED: removed through BOTH gates: %s', (s) => {
    expect(gate(`The churn limit was not scored. ${s} Churn is the input to check.`)).not.toMatch(/71|29/);
  });
  it.each([
    // Both options named earlier, but each figure has its own measure: kept.
    ['We compared raising and holding.', 'Retention is 96% and churn 4%.'],
    ['We compared raising and holding.', 'Across the runs, 96% of customers stay and 4% churn.'],
    // No option named before it: the over-drop controls stay kept.
    ['The churn limit was not scored.', 'Annual and monthly plans are 70% and 30% respectively.'],
    ['The churn limit was not scored.', 'The survey came back 55% and 45%.'],
  ])('CONTROL: %s → "%s" is kept', (lead, pair) => { expect(gate(`${lead} ${pair}`)).toContain(pair); });
  it.each([
    // RESIDUAL, named — kept: pairs not written as percentages are out of this gate's scope.
    'For both raising and holding, 0.71 and 0.29 respectively.',
    'For both raising and holding, 71 in 100 and 29 in 100 respectively.',
    'For both raising and holding, seven in ten and three in ten respectively.',
  ])('RESIDUAL (named): kept: %s', (s) => {
    expect(gate(`The churn limit was not scored. ${s} Churn is the input to check.`)).toContain(s);
  });
});

/**
 * Self-review of #1871 at ae56cf4b: figures interleaved with the options are bound one-to-one (the metric and binding
 * rules decide them, so a per-option metric stays kept after a sentence naming both options), and a split written
 * across TWO sentences, one figure each, is read as one passage.
 */
describe('self-review of #1871 at ae56cf4b — interleaved figures, and a split across two sentences', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const gate = (text: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: text, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text;
  it.each([
    // v6 class C2 after a sentence naming both options: kept (an over-drop at ae56cf4b).
    ['We compared raising and holding.', 'The £59 path has 40% retention, while holding has 60% retention.'],
    ['We compared raising and holding.', 'The £59 path shows 40% uptake and holding 60% uptake.'],
    ['We compared raising and holding.', 'On the supplied retention metric, the £59 path has 40% retention, while holding has 60% retention.'],
    // Two sentences, each with its own measure: kept.
    ['We compared raising and holding.', 'The churn limit is 4%. Retention is 96%.'],
    ['We compared raising and holding.', 'The £59 path has 40% retention. Holding has 60% retention.'],
  ])('CONTROL: %s → "%s" is kept', (lead, rest) => { expect(gate(`${lead} ${rest}`)).toContain(rest); });
  it.each([
    'The £59 path gets 71%. Holding gets the other 29%.',
    'Raising: 71%. Holding: 29%.',
    'Raising came out at 71%. Holding came out at 29%.',
    'Raising wins 71% of runs. Holding wins 29%.',
    'Raise Pro to £59 at release: 71%. Keep Pro at £49: 29%.',
  ])('RED: a split across two sentences — both halves go: %s', (pair) => {
    const out = gate(`The churn limit was not scored. ${pair} Churn is the input to check.`);
    expect(out).not.toMatch(/71%|29%/);
    expect(out).toContain('The churn limit was not scored.');
    expect(out).toContain('Churn is the input to check.');
  });
});

/** Pre-review 5829596023 on ae56cf4b: a list in a clause that only accompanies the figures is not what they are shared over. */
describe('pre-review of #1871 at ae56cf4b — an accompanying list is not the receiving list', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const wire = (sentence: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: `The churn limit was not scored. ${sentence} Churn is the input to check.`, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text;
  it.each([
    'For both raising and holding, the results were 71% and 29% respectively, with speed and cost concerns still open.',
    'For both raising and holding, the results were 71% and 29% respectively with speed and cost concerns still open.',
    'For both raising and holding, 71% and 29% respectively while price and churn stay uncertain.',
    'For both raising and holding, 71% and 29% though price and churn are unscored.',
    'For both raising and holding, 71% and 29% because price and churn dominate.',
  ])('RED: removed through BOTH gates: %s', (s) => { expect(wire(s)).not.toMatch(/71%|29%/); });
  it.each([
    'Last quarter, 60% and 40% of signups came from ads and referrals respectively.',
    'For both raising and holding, the split of revenue is 60% and 40% between annual and monthly plans.',
    'For both raising and holding, 97% and 3% are the renewal and churn rates.',
  ])('CONTROL: the receiving list still lets the figures through: %s', (s) => { expect(wire(s)).toContain(s); });
});

/**
 * RC 5829662359 (b)/(c): served replies from the overnight captures, run through the gate offline. A ranked LIST goes as
 * a list — its siblings rank the rest once the leader's row is dropped — and an option's PLACE ("trails", "follows at")
 * is a ranking. Levels lists, and sentences whose neighbour ranks on its own, stay.
 */
describe('served captures — a ranked list goes as a list', () => {
  const gate = (text: string, nodes: Array<{ id: string; kind: string; label: string }>) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: text, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'near_tie' } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'near_tie', graph: { nodes }, analysisReady: { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } } },
  ).response.assistant_text;
  const pricing = [{ id: 'o1', kind: 'option', label: 'Raise Price at Release' }, { id: 'o2', kind: 'option', label: 'Keep Current Pro Price' }, { id: 'o3', kind: 'option', label: 'Pilot £59 at Release' }];
  const hiring = [{ id: 'o1', kind: 'option', label: 'Hire a Tech Lead' }, { id: 'o2', kind: 'option', label: 'Hire Two Developers' }, { id: 'o3', kind: 'option', label: 'Improve Delivery System' }, { id: 'f1', kind: 'factor', label: 'Development capacity' }, { id: 'f2', kind: 'factor', label: 'Technical leadership capacity' }];
  it('RED (captured c3b-467b591): every row of a ranked win-share list goes, the caveat stays', () => {
    const out = gate([
      '**What the current model implies**',
      '- **Raise Price at Release (£59):** leads in the model, with a **55%** chance of producing the strongest MRR outcome across the simulated scenarios.',
      '- **Pilot £59 at Release (20% rollout):** follows at **41%**.',
      '- **Keep £49:** is at **4%**.',
      '',
      '**Important limitation:** the model could **not assess the “monthly churn under 4%” constraint**.',
    ].join('\n'), pricing);
    expect(out).not.toMatch(/55%|41%|\*\*4%\*\*/);
    expect(out).toContain('**Important limitation:** the model could **not assess the “monthly churn under 4%” constraint**.');
  });
  it('RED (captured sprint-c4a6cce-A-hiring): "trails in this model (10.6%)" goes with its list', () => {
    const out = gate([
      '**What the current model implies**',
      '',
      '- Across all five options, **Improve Delivery System** is marginally most likely to raise velocity (**39.3%**), with **Hire Two Developers** very close (**36.7%**).',
      '- **Hire a Tech Lead** trails in this model (**10.6%**).',
      '- Restricting the question to your two hiring choices: **two developers leads the Tech Lead under these assumptions**.',
      '',
      'However, this is a **fragile near-tie**, not a firm conclusion.',
    ].join('\n'), hiring);
    expect(out).not.toMatch(/39\.3%|36\.7%|10\.6%|leads the Tech Lead/);
    expect(out).toContain('However, this is a **fragile near-tie**, not a firm conclusion.');
  });
  it('RED: an option\'s place with a share ranks in prose too', () => {
    expect(gate('The churn limit was not scored. Hire a Tech Lead trails in this model at 10.6%. Churn is the input to check.', hiring)).not.toContain('10.6%');
    expect(gate('The churn limit was not scored. The Pilot £59 at Release option follows at 41%. Churn is the input to check.', pricing)).not.toContain('41%');
  });
  it('CONTROL (captured construction reply): a levels list stays whole, beside the option-settings list', () => {
    const text = [
      '**Current position**',
      '- Technical leadership capacity: **40%** — partly covered, but potentially constrained.',
      '- Development capacity: **60%**.',
      '- Team coordination effectiveness: **60%**.',
      '- Onboarding workload: **10%**.',
      '',
      '**What each option would set**',
      '- **Hire a Tech Lead:** 1 Tech Lead; technical leadership capacity **70%**; coordination **75%**; onboarding workload **25%**.',
      '- **Hire two developers:** 6 developers; development capacity **85%**; coordination **50%**; onboarding workload **35%**.',
    ].join('\n');
    expect(gate(`I've set up a comparison model with three options: maintain current staffing, hire a Tech Lead, or hire two developers.\n\n${text}`, hiring)).toContain(text);
  });
  it('CONTROL: in a ranked list, a factor\'s level row and a row with a measured figure stay', () => {
    const out = gate([
      '- **Hire Two Developers** leads with **39.3%**.',
      '- Technical leadership capacity: **50%**',
      '- Pilot scope: **10%**, with churn at **4% per month**.',
    ].join('\n'), hiring);
    expect(out).not.toContain('39.3%');
    expect(out).toContain('- Technical leadership capacity: **50%**');
    expect(out).toContain('- Pilot scope: **10%**, with churn at **4% per month**.');
  });
  it('CONTROL: list items are judged as a list, never paired line by line', () => {
    const text = '- Coordination 40%\n- Onboarding 60%';
    expect(gate(`We compared hiring a Tech Lead and hiring two developers.\n\n${text}`, hiring)).toContain(text);
  });
  it('CONTROL (captured): a sentence whose neighbour ranks on its own is not taken with it', () => {
    const out = gate('4. **Pilot scope**\n   The pilot is set at **10%** as an assumption. The ordering is particularly sensitive to rollout scope: the model indicates that a pilot scope below roughly **15%** favours keeping £49 rather than the pilot, on these assumptions.', pricing);
    expect(out).toContain('The pilot is set at **10%** as an assumption.');
  });
});

/** Review of #1871 at ae56cf4b (5829704165) A: another list counts only in the figures' own clause. */
describe('review of #1871 at ae56cf4b — a list in a leading clause is not what the figures are shared over', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const gate = (text: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: text, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text;
  it.each([
    ['We compared raising and holding, in that order.', 'Taking price and churn into account, the runs came out 71% and 29%.'],
    ['We compared Raise Pro to £59 at release and Keep Pro at £49, in that order.', 'Weighing price and churn together, the results were 71% and 29%.'],
    ['We compared raising and holding, in that order.', 'With price and churn both modelled, the results were 71% and 29%.'],
    ['We compared raising and holding.', 'After accounting for price and churn, the results were 71% and 29%.'],
    ['Here are raising and holding, respectively.', 'Once revenue and churn are combined, the results were 71% and 29%.'],
  ])('RED: %s → "%s" is removed', (lead, pair) => {
    const out = gate(`${lead} ${pair} Churn is the input to check.`);
    expect(out).not.toMatch(/71%|29%/);
    expect(out).toContain('Churn is the input to check.');
  });
  it.each([
    ['We compared raising and holding.', 'Annual and monthly plans are 70% and 30% respectively.'],
    ['We compared raising and holding.', 'Ads and referrals brought in 60% and 40% of signups.'],
  ])('CONTROL: %s → "%s" is kept (the list is the figures\' own subject)', (lead, pair) => { expect(gate(`${lead} ${pair}`)).toContain(pair); });
});

/**
 * FOLLOW-UP OF #1871 — the residuals named in the independent APPROVE (5830799585), closed as one class: what makes a
 * row part of a ranked list, and what makes its figure a share rather than a level. Every row goes through the
 * production gate, and every assertion is bound to an exact line: kept byte-identical, or absent.
 */
const PRICING_NODES = [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }];
const withheldGate = (text: string, nodes: ReadonlyArray<{ id: string; kind: string; label: string }> = PRICING_NODES) => enforceAgentLaneLeaderClaimsAtWire(
  { assistant_text: text, blocks: [], suggested_actions: [], analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
  { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph: { nodes }, analysisReady: { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } } },
).response.assistant_text;
const linesOf = (s: string): string[] => s.split('\n');
const RANKED_ROW = '- **Raise Pro to £59 at release:** leads at **55%**.';
const CAVEAT = 'The churn limit was not scored.';

describe('follow-up of #1871 — a loose list and an em-dash row are still one list (residuals 1 and 2)', () => {
  it.each([
    ['loose (the reviewer\'s rows)', `${RANKED_ROW}\n\n- **Keep £49:** **4%**.`, ['- **Keep £49:** **4%**.']],
    ['em-dash rows, tight', '- Raise Pro to £59 at release — leads at 55%\n- Keep £49 — 4%', ['- Raise Pro to £59 at release — leads at 55%', '- Keep £49 — 4%']],
    ['em-dash rows, loose', '- Raise Pro to £59 at release — leads at 55%\n\n- Keep £49 — 4%', ['- Raise Pro to £59 at release — leads at 55%', '- Keep £49 — 4%']],
  ])('RED: %s — every ranked row goes, the caveat stays', (_name, list, gone) => {
    const out = withheldGate(`Here is where the runs stand.\n\n${list}\n\n${CAVEAT}`);
    for (const row of [RANKED_ROW, ...gone]) expect(out).not.toContain(row);
    expect(out).not.toMatch(/55%|\b4%/);
    expect(linesOf(out)).toContain('Here is where the runs stand.');
    expect(linesOf(out)).toContain(CAVEAT);
  });
  // The same gap broke the other two list rules: a win-share distribution, and the value rows under a ranking heading.
  it.each([
    ['a loose win-share distribution', 'Here is the split.\n\n- The £59 path: 71%\n\n- Holding at £49: 29%', ['- The £59 path: 71%', '- Holding at £49: 29%'], 'Here is the split.'],
    ['loose value rows under a ranking heading', 'Win share in the modelled runs:\n\n- The release-timed rise: 55%\n\n- The pilot: 41%', ['- The release-timed rise: 55%', '- The pilot: 41%'], null],
  ])('RED: %s — every row goes, the caveat stays', (_name, text, gone, keptLead) => {
    const out = withheldGate(`${text}\n\n${CAVEAT}`);
    for (const row of gone) expect(out).not.toContain(row);
    if (keptLead !== null) expect(linesOf(out)).toContain(keptLead);
    expect(linesOf(out)).toContain(CAVEAT);
  });
  it('RED (captured c3b-467b591, with blank lines between the rows): "is at **4%**" goes with its list', () => {
    const pricing = [{ id: 'o1', kind: 'option', label: 'Raise Price at Release' }, { id: 'o2', kind: 'option', label: 'Keep Current Pro Price' }, { id: 'o3', kind: 'option', label: 'Pilot £59 at Release' }];
    const out = withheldGate([
      '**What the current model implies**',
      '',
      '- **Raise Price at Release (£59):** leads in the model, with a **55%** chance of producing the strongest MRR outcome across the simulated scenarios.',
      '',
      '- **Pilot £59 at Release (20% rollout):** follows at **41%**.',
      '',
      '- **Keep £49:** is at **4%**.',
      '',
      '**Important limitation:** the model could **not assess the “monthly churn under 4%” constraint**.',
    ].join('\n'), pricing);
    expect(out).not.toMatch(/55%|41%|\*\*4%\*\*/);
    expect(linesOf(out)).toContain('**Important limitation:** the model could **not assess the “monthly churn under 4%” constraint**.');
  });
  it.each([
    // A factor's level in em-dash form, in a ranked em-dash list.
    ['- Raise Pro to £59 at release — leads at 55%\n- Monthly churn — 4%', '- Monthly churn — 4%'],
    // A tight ranked list, a blank line, then a tight levels list: a change of spacing starts a new list.
    [`${RANKED_ROW}\n- **Keep £49:** **4%**.\n\n- Ownership now: 65%\n- Ownership later: 80%`, '- Ownership now: 65%\n- Ownership later: 80%'],
    // A paragraph between two lists ends the first one.
    [`${RANKED_ROW}\n\nThe levels we assumed:\n\n- Ownership now: 65%`, 'The levels we assumed:\n\n- Ownership now: 65%'],
  ])('CONTROL: %s → the level rows are kept byte-identical', (text, kept) => {
    const out = withheldGate(text);
    expect(out).not.toContain(RANKED_ROW);
    expect(out).toContain(kept);
  });
});

describe('follow-up of #1871 — N adjacent one-figure sentences that split ~100 over the options (residual 3)', () => {
  it.each([
    'Raising gets 55%. The pilot gets 41%. Keeping £49 gets 4%.',
    'Raising gets 50%. Phasing gets 30%. The pilot gets 15%. Keeping £49 gets 5%.',
    'Raising has 55%. The pilot has 41%. Keeping £49 has the other 4%.',
  ])('RED: every sentence of the split goes, and nothing else: %s', (split) => {
    const out = withheldGate(`${CAVEAT} ${split} Churn is the input to check.`);
    for (const s of split.split(/(?<=\.) /)) expect(out).not.toContain(s);
    expect(out.startsWith(`${CAVEAT} Churn is the input to check.`)).toBe(true);
  });
  it('CONTROL: a factor sentence after the split is not taken with it (the smallest ~100 run is the split)', () => {
    const out = withheldGate(`${CAVEAT} Raising gets 55%. The pilot gets 41%. Keeping £49 gets 4%. Churn is 3%. Churn is the input to check.`);
    expect(out).not.toMatch(/55%|41%|\b4%/);
    expect(out.startsWith(`${CAVEAT} Churn is 3%. Churn is the input to check.`)).toBe(true);
  });
  it('CONTROL: three levels that happen to sum to 100 and name no option stay', () => {
    const text = `${CAVEAT} Churn is 3%. Conversion is 5%. Retention is 92%. Churn is the input to check.`;
    expect(withheldGate(text)).toBe(text);
  });
});

describe('follow-up of #1871 — a measure named before the figure makes it a level, not a share (residual 4)', () => {
  it.each([
    '- **Keep Pro at £49:** Monthly churn: **4%**.',
    '- **Keep Pro at £49:** Monthly churn: 4%.',
    '- **Keep Pro at £49:** churn rate: **4%**.',
    '- **Keep Pro at £49:** monthly churn **4%**.',
  ])('KEPT beside a ranked row: %s', (row) => {
    const out = withheldGate(`${RANKED_ROW}\n${row}\n\n${CAVEAT}`);
    expect(out).not.toContain(RANKED_ROW);
    expect(linesOf(out)).toContain(row);
  });
  it.each([
    '- **Keep Pro at £49:** **4%**.',
    '- **Keep Pro at £49:** **45%**.',
    '- **Keep Pro at £49:** Win probability: **41%**',
    '- **Keep Pro at £49:** Share of runs: 41%',
    '- **Keep Pro at £49:** Score: 45%',
    // A measure word beside a share word is still a share.
    '- **Keep Pro at £49:** Probability of higher MRR: **41%**',
    // The option's own head is the item's head, never a measure.
    '- Keep current price: 45%',
    // …and a head that names no option is not a measure either: the option named after the figure makes it a share.
    '- **Current model:** **55%** for the £59-at-release path.',
  ])('CONTROL, dropped beside a ranked row: %s', (row) => {
    const out = withheldGate(`${RANKED_ROW}\n${row}\n\n${CAVEAT}`);
    expect(out).not.toContain(RANKED_ROW);
    expect(out).not.toContain(row);
    expect(linesOf(out)).toContain(CAVEAT);
  });
});

describe('follow-up of #1871 — a row headed by something that is not an option gives a level (residual 5)', () => {
  const HIRING_NODES = [{ id: 'o1', kind: 'option', label: 'Hire a Tech Lead' }, { id: 'o2', kind: 'option', label: 'Hire Two Developers' }, { id: 'f1', kind: 'factor', label: 'Development capacity' }];
  const CLINIC_NODES = [{ id: 'o1', kind: 'option', label: 'Video by Default' }, { id: 'o2', kind: 'option', label: 'Keep Face to Face' }, { id: 'f1', kind: 'factor', label: 'Video follow-up share' }];
  it.each([
    ['pricing', `${RANKED_ROW}\n- Churn assumption: **4%**`, '- Churn assumption: **4%**', PRICING_NODES],
    ['hiring', '- **Hire Two Developers** leads with **39.3%**.\n- Onboarding workload: **10%**', '- Onboarding workload: **10%**', HIRING_NODES],
    // A generic option noun under a quantifier names no one option: the level applies to both.
    ['hiring', '- **Hire Two Developers** leads with **39.3%**.\n- Onboarding workload: **10%** on both paths', '- Onboarding workload: **10%** on both paths', HIRING_NODES],
    // A row headed by another node's label gives that node's level, whatever option it also names.
    ['pricing', `${RANKED_ROW}\n- **Monthly churn** (Keep Pro at £49): **4%**`, '- **Monthly churn** (Keep Pro at £49): **4%**', PRICING_NODES],
    // "Video" opens an option's label AND a factor's: it does not make "Video uptake" an option.
    ['clinic', '- **Video by Default** leads with **57.5%**.\n- Video uptake: **20%**', '- Video uptake: **20%**', CLINIC_NODES],
  ] as const)('KEPT (%s): %s', (_graph, text, row, nodes) => {
    const out = withheldGate(`${text}\n\n${CAVEAT}`, nodes);
    expect(out).not.toMatch(/55%|39\.3%|57\.5%/);
    expect(linesOf(out)).toContain(row);
  });
  it.each([
    ['- **Keep £49:** **4%**', PRICING_NODES],
    ['- Keep £49: 4%', PRICING_NODES],
    ['- Raising: **4%**', PRICING_NODES],
    ['- **Hire two devs:** **36.7%**', HIRING_NODES],
    // Paraphrased heads the stricter rule must still read as options: a generic option noun, a word from one label.
    ['- **The £49 path:** **4%**', PRICING_NODES],
    ['- **The status-quo path:** **4%**', PRICING_NODES],
    ['- **Two developers:** **36.7%**', HIRING_NODES],
  ] as const)('CONTROL, an option-shaped head with a bare share still goes: %s', (row, nodes) => {
    const lead = nodes === HIRING_NODES ? '- **Hire a Tech Lead** leads with **39.3%**.' : RANKED_ROW;
    const out = withheldGate(`${lead}\n${row}\n\n${CAVEAT}`, nodes);
    expect(out).not.toContain(lead);
    expect(out).not.toContain(row);
    expect(linesOf(out)).toContain(CAVEAT);
  });
  it('CONTROL (captured c10-d2afc2c): a paraphrased option head whose every word is also in a factor label still goes', () => {
    const nodes = [
      { id: 'o1', kind: 'option', label: 'Hire a Tech Lead' }, { id: 'o2', kind: 'option', label: 'Hire Two Developers' },
      { id: 'o3', kind: 'option', label: 'Continue Current Staffing' }, { id: 'o4', kind: 'option', label: 'Tech Lead Plus Developer' },
      { id: 'f1', kind: 'factor', label: 'Tech lead hires' }, { id: 'f2', kind: 'factor', label: 'Developer hires' }, { id: 'f3', kind: 'factor', label: 'Onboarding load' },
    ];
    const out = withheldGate([
      'Re-run complete. Nothing changed in the model since the prior run, so the result is unchanged.',
      '',
      '- **Hire a Tech Lead:** 37.0% likelihood of leading in this model  ',
      '- **Continue current staffing:** 27.4%  ',
      '- **Hire Two Developers:** 26.5%  ',
      '- **Tech Lead + Developer:** 9.1%  ',
      '',
      'This remains a **fragile near tie**—the model cannot put a single option forward confidently.',
    ].join('\n'), nodes);
    expect(out).not.toMatch(/37\.0%|27\.4%|26\.5%|9\.1%/);
    expect(linesOf(out)).toContain('This remains a **fragile near tie**—the model cannot put a single option forward confidently.');
  });
});

describe('follow-up of #1871 — a markdown table is judged row by row (residual 6)', () => {
  // Captured g11-0415b19 (construction reply), verbatim.
  const CLINIC_NODES = [
    { id: 'o1', kind: 'option', label: 'Video by Default' }, { id: 'o2', kind: 'option', label: 'Keep Face to Face' }, { id: 'o3', kind: 'option', label: 'Clinician Case Choice' },
    { id: 'f1', kind: 'factor', label: 'Video follow-up share' }, { id: 'f2', kind: 'factor', label: 'Clinical suitability matching' }, { id: 'f3', kind: 'factor', label: 'Patient digital access' },
    { id: 'f4', kind: 'factor', label: 'Patients over 75' }, { id: 'g', kind: 'goal', label: 'Waiting-list reduction' },
  ];
  const CLINIC_TABLE = [
    '| Item | Proposed level | Basis |',
    '|---|---:|---|',
    '| Current video follow-up share | 20% | Assumes video is currently used for a minority of follow-ups. |',
    '| Clinical suitability matching | 70% | Assumes current pathways can reliably route about seven in ten follow-ups to the appropriate mode. |',
    '| Patient digital access | 70% | Assumes access/support is below universal, materially relevant with 30% over 75. |',
    '| **Video by Default:** video follow-up share | 70% | Most suitable follow-ups move to video, with exceptions retained. |',
    '| **Video by Default:** clinical suitability matching | 65% | Defaulting to video raises the risk of a poor mode match despite screening. |',
    '| **Keep Face to Face:** video follow-up share | 5% | Video remains exceptional. |',
    '| **Keep Face to Face:** clinical suitability matching | 85% | Face-to-face is suitable for most cases, although more intensive than necessary for some. |',
    '| **Clinician Case Choice:** video follow-up share | 35% | Clinicians use video selectively rather than as the default. |',
  ];
  const RANKING_TABLE_ROW = '| **Clinician Case Choice:** clinical suitability matching | 90% | Case-by-case triage should give the strongest fit between patient need and consultation mode. |';
  it('KEPT (captured g11-0415b19): only the ranking row goes; the header, separator and every other row stay', () => {
    const out = withheldGate(`I propose the following as **assumptions to adopt or correct — not measurements**:\n\n${[...CLINIC_TABLE, RANKING_TABLE_ROW].join('\n')}\n\nThe key unknowns to test next are: the share genuinely suitable for video.`, CLINIC_NODES);
    expect(out).not.toContain(RANKING_TABLE_ROW);
    expect(out).toContain(`\n\n${CLINIC_TABLE.join('\n')}\n\nThe key unknowns to test next are: the share genuinely suitable for video.`);
  });
  it.each([
    ['captured c4a-0a470d2', ['| Hire a Tech Lead | 50.3% chance of leading | 42.5% |', '| Hire Two Developers | 34.6% | 41.8% |']],
    // The same rows paraphrased: no exact label, so only the row-by-row sweep can take the second one.
    ['paraphrased', ['| Tech Lead | 50.3% chance of leading | 42.5% |', '| Two developers | 34.6% | 41.8% |']],
  ])('CONTROL (%s): a table of option shares beside a ranked row still goes', (_name, rows) => {
    const hiring = [{ id: 'o1', kind: 'option', label: 'Hire a Tech Lead' }, { id: 'o2', kind: 'option', label: 'Hire Two Developers' }, { id: 'o3', kind: 'option', label: 'Phase Developer Hiring' }, { id: 'o4', kind: 'option', label: 'Maintain Current Staffing' }];
    const out = withheldGate([
      'Your board edit changed the current Tech Lead baseline from **0 to 1 person**. It mattered substantially to the headline comparison:',
      '',
      '| Option | Before the edit | After the edit |',
      '|---|---:|---:|',
      ...rows,
      '',
      'There is an important modelling reason.',
    ].join('\n'), hiring);
    expect(out).not.toMatch(/50\.3%|42\.5%|34\.6%|41\.8%/);
    expect(linesOf(out)).toContain('There is an important modelling reason.');
  });
  it('CONTROL: a ranking HEADER still takes its table (it says what every row means)', () => {
    const out = withheldGate(`Runs:\n\n| Pricing move | Wins |\n|---|---|\n| The release-timed rise | 71% |\n| Holding at £49 | 29% |\n\n${CAVEAT}`);
    expect(out).not.toMatch(/71%|29%|\| Wins \|/);
    expect(linesOf(out)).toContain(CAVEAT);
  });
  it('CONTROL: a row whose cell holds a ranking sentence goes whole, never leaving half a row', () => {
    const row = '| **Keep Face to Face:** clinical suitability matching | 85% | Suitable for most cases. It is the strongest fit here. |';
    const out = withheldGate(`${CLINIC_TABLE.slice(0, 3).join('\n')}\n${row}\n\n${CAVEAT}`, CLINIC_NODES);
    expect(out).not.toContain('| **Keep Face to Face:** clinical suitability matching | 85% |');
    expect(out).toContain(`${CLINIC_TABLE.slice(0, 3).join('\n')}\n\n${CAVEAT}`);
  });
  it('CONTROL: an option row with a bare share goes with its ranking sibling row, as in a list', () => {
    const out = withheldGate(`| Path | Result |\n|---|---|\n| The £59 path | 48%, the strongest |\n| Holding | 30% |\n\n${CAVEAT}`);
    expect(out).not.toMatch(/48%|30%/);
    expect(linesOf(out)).toContain(CAVEAT);
  });
});

/**
 * Post-merge review of #1920 (5834268638; RC 5834279977): a status quo paraphrased without a word of its label kept its
 * win share once the leader's row went. The held baseline has a closed set of names of its own; only the WHOLE head
 * counts, so a level whose head merely starts with one of them stays.
 */
describe('post-merge review of #1920 — a paraphrased status quo gives its share', () => {
  const STAFFING_NODES = [{ id: 'o1', kind: 'option', label: 'Hire a Tech Lead' }, { id: 'o2', kind: 'option', label: 'Maintain Current Staffing' }, { id: 'f1', kind: 'factor', label: 'Development capacity' }, { id: 'f2', kind: 'factor', label: 'Monthly churn' }];
  const LEAD = '- Hire a Tech Lead leads at 55%';
  it('RED (the reviewer\'s exact list): "- Status quo: 45%" goes with its ranked sibling', () => {
    const out = withheldGate(`${LEAD}\n- Status quo: 45%\n\n${CAVEAT}`, STAFFING_NODES);
    expect(out).not.toMatch(/55%|45%/);
    expect(linesOf(out)).toContain(CAVEAT);
  });
  it.each([
    '- **Status quo:** **45%**',
    '- The status quo: 45%',
    '- Baseline: 45%',
    '- Do nothing: 45%',
    '- Business as usual: 45%',
    '- Current approach: 45%',
  ])('RED, a status-quo name as the whole head: %s', (row) => {
    const out = withheldGate(`${LEAD}\n${row}\n\n${CAVEAT}`, STAFFING_NODES);
    expect(out).not.toMatch(/55%|45%/);
    expect(linesOf(out)).toContain(CAVEAT);
  });
  it.each([
    '- Churn assumption: 4%',
    '- Baseline churn: 4%',
    '- Status quo churn: 4%',
    '- Development capacity: 60%',
    '- Status quo: 45% retained each month',
  ])('CONTROL, a level stays in the same ranked list: %s', (row) => {
    const out = withheldGate(`${LEAD}\n${row}\n\n${CAVEAT}`, STAFFING_NODES);
    expect(out).not.toContain('55%');
    expect(linesOf(out)).toContain(row);
  });
  it('CONTROL: with no ranked sibling, a levels list keeps "Status quo: 45%" (the sweep only follows a dropped ranking)', () => {
    const text = `- Status quo: 45%\n- Monthly churn: 4%\n\n${CAVEAT}`;
    expect(linesOf(withheldGate(text, STAFFING_NODES))).toContain('- Status quo: 45%');
  });
});

/**
 * ⛔ "<OPTION> IS (PROVISIONALLY) SEPARATED" NAMES A LEADER (Canonical 5845848896, MEASURED at staging bc09bb14 on
 * AI Quality's served reply 5845776236). On the permit-with-caveat turn that sentence is Paul's ruling working
 * ("caveat, not withhold", #38 5576895511) and must stay. On a WITHHELD turn whose separation is still
 * `separated` (a limit not shown met, a run not confirmed), it is a leader claim in words the classifier did not
 * read, and it survived the drop. Only a SINGULAR subject counts: "the two options are separated by less than
 * a point" states a near tie, not a leader.
 */
describe('a sentence naming ONE option as separated ranks the options', () => {
  const SERVED = 'Release to All Now is provisionally separated in this model, but the comparison is fragile.';
  const NEUTRAL = '- The result turns most on AI assistant adoption rate, an Olumi estimate, not evidence you supplied.';
  const graph = { nodes: [{ id: 'all', kind: 'option', label: 'Release to All Now' }, { id: 'beta', kind: 'option', label: 'Staged Beta to Top Accounts' }] };

  it('RED: the served sentence and its paraphrases rank the options', () => {
    for (const s of [
      SERVED,
      'Release to All Now is clearly separated from the staged beta.',
      'Staged Beta to Top Accounts separates from the other option on MRR.',
      'The broad release stands apart from the staged beta in this model.',
      'Release to All Now is now separated from the alternative.',
    ]) expect(sentenceRanksOptions(s, rankingLabelContext(graph, undefined)), s).toBe(true);
  });

  it('CONTROL: plural near-tie, negation and the separation question itself do not rank', () => {
    for (const s of [
      'The two options are separated by less than a point, so they cannot be told apart.',
      'The options are not separated on this run.',
      'Release to All Now is not separated from the staged beta.',
      'How far apart the options are was not established on this run.',
      'Separation between the options was not measured.',
      'Price and churn are separated in the model by the conversion factor.',
    ]) expect(sentenceRanksOptions(s, rankingLabelContext(graph, undefined)), s).toBe(false);
  });

  const reply = `${SERVED}\n\n${NEUTRAL}`;
  const gate = (o: { permitted: boolean; reason?: string }) => enforceAgentLaneLeaderClaimsAtWire(
    {
      assistant_text: reply, blocks: [], suggested_actions: [],
      analysis_state: { leader_claim: { permitted: o.permitted, separation: 'separated', ...(o.reason ? { withheld_reason: o.reason } : {}) } },
    } as unknown as OlumiResponse,
    {
      requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: o.permitted, separationEstablished: true,
      ...(o.reason ? { leaderClaimWithheldReason: o.reason } : {}), graph,
      analysisReady: { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional', reasons: [] } },
    },
  ).response.assistant_text;

  it('RED: on a WITHHELD turn (a limit not shown met, separation still "separated") the served headline goes; the rest stays', () => {
    const out = gate({ permitted: false, reason: 'constraint_verdict_withheld' });
    expect(out).not.toContain('is provisionally separated');
    expect(out).toContain(NEUTRAL);
  });

  it('CONTROL: on the permit-with-caveat turn (entitled, separated, quantified_provisional) the served headline is kept', () => {
    expect(gate({ permitted: true }).startsWith(reply)).toBe(true);
  });
});
