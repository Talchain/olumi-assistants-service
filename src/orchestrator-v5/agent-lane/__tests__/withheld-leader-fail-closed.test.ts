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

describe('the ranking-sentence classifier', () => {
  it.each(RANKING.map((s) => [s]))('RANKING, dropped: %s', (s) => {
    expect(sentenceRanksOptions(s)).toBe(true);
  });

  it.each(NON_RANKING.map((s) => [s]))('NOT ranking, kept: %s', (s) => {
    expect(sentenceRanksOptions(s)).toBe(false);
  });

  it('a label that itself reads as ranking vocabulary is a NAME, not a claim — but its claim still is', () => {
    const graph = { nodes: [{ id: 'o1', kind: 'option', label: 'Hire a Lead Engineer' }, { id: 'o2', kind: 'option', label: 'Keep the team as is' }] };
    const labels = rankingLabelContext(graph, undefined);
    expect(labels.rankingShapedLabels).toEqual(['Hire a Lead Engineer']);
    expect(sentenceRanksOptions('Hire a Lead Engineer raises delivery capacity by 20%.', labels)).toBe(false);
    expect(sentenceRanksOptions('The Lead Engineer hire adds one person to the team.', labels)).toBe(false);
    expect(sentenceRanksOptions('Hire a Lead Engineer leads the comparison.', labels)).toBe(true);
    // CONTROL: without the label context the same name reads as ranking — the context is what spares it.
    expect(sentenceRanksOptions('Hire a Lead Engineer raises delivery capacity by 20%.')).toBe(true);
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
