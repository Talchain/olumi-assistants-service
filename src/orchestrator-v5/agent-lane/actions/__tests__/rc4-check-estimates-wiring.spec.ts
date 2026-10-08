import { describe, expect, it } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { assembleGuidanceSignals } from '../../turn-context/guidance-signals.js';
import { olumiEstimatesFeedingResult, sayOlumiEstimates } from '../../olumi-estimates-feeding-result.js';
import { actionFactsOf, estimatePointsOf, type ActionFacts, type ActionRead } from '../state.js';
import { actionBarOf, type ActionBarV1 } from '../rank.js';
import { decidePress } from '../handlers.js';
import { estimateGraph, estimateLicence } from './estimate-fixture.js';

const SCENARIO = '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const AT = '2026-10-07T12:00:00.000Z';
type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type EstimateAction = 'check_estimates' | 'bias_anchoring';

/** Same canonical Run-binding fixture as action-bar.test.ts. */
function ran(graph: Graph): ActionRead {
  const h = computeAnalysisAffectingGraphHash(graph as never)!;
  return {
    scenarioId: SCENARIO, graph, graphHash: h,
    analysisState: { run_state: { kind: 'complete_current', computed_at: AT }, usable_for_chips: true,
      leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } },
    analysisReady: { status: 'ready', may_run: true },
    analysisResult: { type: 'analysis_result', computed_against_hash: h, data: {} },
  };
}

function censusInput(read: ActionRead) {
  const signals = assembleGuidanceSignals({
    request: 'turn', offeredSpecific: [], graph: read.graph, analysisState: read.analysisState,
    analysisResult: read.analysisResult, optionParticipation: read.optionParticipation,
    identityEvaluations: [], guidance: {}, explicitRequest: null, leaderLicensed: false,
  });
  return { goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'], driverIds: [] };
}

function censusGraph(sizes: readonly ('olumi_estimate' | 'olumi_placeholder' | 'olumi_accepted' | 'user')[], olumiValue = false): Graph {
  const factors = sizes.map((_size, i) => ({
    id: i === 0 ? 'price' : `factor_${i}`, kind: 'factor', label: i === 0 ? 'Price' : `Factor ${i}`,
    observed_state: { value: 49 + i, unit: 'GBP', source: i === 0 && olumiValue ? 'cee_inference' : 'user_edited',
      extractionType: i === 0 && olumiValue ? 'inferred' : 'explicit' },
  }));
  const interventions = Object.fromEntries(factors.map(f => [f.id, 59]));
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Launch on time', observed_state: { unit: '% likelihood of on-time launch' },
        goal_horizon: { deadline: '2027-04-07' } },
      { id: 'a', kind: 'option', label: 'Hire', interventions },
      { id: 'b', kind: 'option', label: 'Train', interventions },
      ...factors,
      { id: 'off', kind: 'factor', label: 'Off path', observed_state: { value: 99, unit: 'GBP', extractionType: 'inferred' } },
      { id: 'other', kind: 'outcome', label: 'Other outcome' },
    ],
    edges: [
      ...sizes.map((size, i) => ({ from: factors[i]!.id, to: 'goal', strength: { mean: 0.7, std: 0.1 },
        provenance: size === 'user' ? { source: 'user_specified', magnitude: 'user_stated' }
          : size === 'olumi_accepted' ? { source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } }
            : { source: 'cee_hypothesis', magnitude: size } })),
      { from: 'off', to: 'other', strength: { mean: 0.7, std: 0.1 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } },
    ],
  };
}

function priceGraph(source: unknown, factorId = 'price'): Graph {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR', observed_state: { unit: 'GBP' } },
      { id: 'a', kind: 'option', label: 'Raise price', interventions: { [factorId]: { value: 59, source } } },
      { id: 'b', kind: 'option', label: 'Keep price', interventions: { price: { value: 49, source: 'user_specified' } } },
      { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 49, unit: 'GBP', source: 'user_edited' } },
      { id: 'off', kind: 'factor', label: 'Off path', observed_state: { value: 99, unit: 'GBP', source: 'user_edited' } },
      { id: 'other', kind: 'outcome', label: 'Other outcome' },
    ],
    edges: [
      { from: 'price', to: 'goal', strength: { mean: 0.7, std: 0.1 }, provenance: { source: 'user_specified', magnitude: 'user_stated' } },
      { from: 'off', to: 'other', strength: { mean: 0.7, std: 0.1 }, provenance: { source: 'user_specified', magnitude: 'user_stated' } },
    ],
  };
}

const estimateOfferIds = (bar: ActionBarV1) => [...bar.priority, ...bar.standard, ...bar.more]
  .filter(o => o.action_id === 'check_estimates' || o.action_id === 'bias_anchoring').map(o => o.action_id);

function replyFor(action: EstimateAction, facts: ActionFacts, bar?: ActionBarV1) {
  const decision = decidePress({ id: `act:${action}` }, facts, bar);
  expect(decision.kind).toBe('reply');
  if (decision.kind !== 'reply') throw new Error('Expected the typed action reply');
  expect(decision.press.action).toBe(action);
  return decision.reply;
}

describe('RC4: Check estimates uses the same bound census as its producer', () => {
  it.each(['cee_hypothesis', 'user_specified', 'brief_extraction'] as const)('%s option setting: its own provenance controls the distinct price estimate', source => {
    const read = ran(priceGraph(source));
    const expected = olumiEstimatesFeedingResult({ ...censusInput(read), optionSettings: [
      { id: 'a:price', label: 'Price under Raise price', authorship: source === 'cee_hypothesis' ? 'olumi_estimate' : 'user' },
      { id: 'b:price', label: 'Price under Keep price', authorship: 'user' },
    ] });
    const facts = actionFactsOf(read);
    expect(facts.runBound).toBe(true);
    expect(facts.olumiEstimates).toEqual(expected);
    expect(expected).toMatchObject({ count: source === 'cee_hypothesis' ? 1 : 0, accepted: 0, placeholderLinks: 0 });
    expect(estimatePointsOf(facts)).toEqual([]);
    expect(estimateOfferIds(actionBarOf(facts))).toEqual(source === 'cee_hypothesis' ? ['check_estimates'] : []);
    if (source === 'cee_hypothesis') {
      const reply = replyFor('check_estimates', facts);
      expect(reply).toEqual({ text: sayOlumiEstimates(expected).join('\n'), exits: [], outcome: 'ran' });
      expect(reply.text).toContain('Price under Raise price (value)');
    }
  });

  it('an Olumi option setting on an off-path factor is excluded', () => {
    const facts = actionFactsOf(ran(priceGraph('cee_hypothesis', 'off')));
    expect(facts.olumiEstimates).toMatchObject({ count: 0, values: [], accepted: 0, placeholderLinks: 0 });
    expect(estimateOfferIds(actionBarOf(facts))).toEqual([]);
  });

  it('a baseline option mirroring today\'s level is not a setting Olumi filled, even when stamped cee_hypothesis', () => {
    const graph = priceGraph('user_specified');
    Object.assign(graph.nodes.find(n => n.id === 'b')!, { is_baseline: true, interventions: { price: { value: 49, source: 'cee_hypothesis' } } });
    const facts = actionFactsOf(ran(graph));
    expect(facts.olumiEstimates).toMatchObject({ count: 0, values: [], accepted: 0, placeholderLinks: 0 });
    expect(estimateOfferIds(actionBarOf(facts))).toEqual([]);
    // Control: the same cell on a non-baseline option is Olumi's setting.
    const control = priceGraph('user_specified');
    control.nodes.find(n => n.id === 'b')!.interventions = { price: { value: 49, source: 'cee_hypothesis' } };
    expect(actionFactsOf(ran(control)).olumiEstimates).toMatchObject({ count: 1 });
  });

  it('a historical data.interventions carrier is read when the top-level one is absent', () => {
    const graph = priceGraph('cee_hypothesis');
    const a = graph.nodes.find(n => n.id === 'a')!;
    a.data = { interventions: a.interventions }; delete a.interventions;
    const facts = actionFactsOf(ran(graph));
    expect(facts.olumiEstimates).toMatchObject({ count: 1, accepted: 0, placeholderLinks: 0 });
    expect(estimateOfferIds(actionBarOf(facts))).toEqual(['check_estimates']);
  });

  it.each(['olumi_accepted', undefined, 17])('unknown or malformed intervention source %s is skipped', source => {
    const facts = actionFactsOf(ran(priceGraph(source)));
    expect(facts.olumiEstimates).toMatchObject({ count: 0, values: [], accepted: 0, placeholderLinks: 0 });
    expect(estimateOfferIds(actionBarOf(facts))).toEqual([]);
  });

  it('only settings of options analysed by the bound Run are counted', () => {
    const graph = priceGraph('cee_hypothesis');
    graph.nodes.find(n => n.id === 'b')!.interventions = { price: { value: 69, source: 'cee_hypothesis' } };
    const bound = ran(graph);
    const read = { ...bound, analysisResult: { ...(bound.analysisResult as object), enrichment: {
      option_comparison: [{ option_id: 'a' }], results: [{ option_id: 'b' }],
    } } };
    const expected = olumiEstimatesFeedingResult({ ...censusInput(read), optionSettings: [
      { id: 'a:price', label: 'Price under Raise price', authorship: 'olumi_estimate' },
    ] });
    const facts = actionFactsOf(read);
    expect(facts.olumiEstimates).toEqual(expected);
    expect(expected.count).toBe(1);
    expect(estimateOfferIds(actionBarOf(facts))).toEqual(['check_estimates']);
    expect(replyFor('check_estimates', facts)).toEqual({ text: sayOlumiEstimates(expected).join('\n'), exits: [], outcome: 'ran' });
  });

  it.each([false, true])('dangling edge = %s: unreadable signals stay null; readable control keeps the census', dangling => {
    const graph = priceGraph('cee_hypothesis');
    if (dangling) graph.edges.push({ from: 'price', to: 'ghost' });
    const read = ran(graph);
    const facts = actionFactsOf(read);
    expect(facts.runBound).toBe(true);
    if (dangling) {
      expect(facts.olumiEstimates).toBeNull();
      expect(estimateOfferIds(actionBarOf(facts))).toEqual([]);
      const reply = replyFor('check_estimates', facts);
      expect(reply).toEqual({ text: 'I can’t show the estimates yet: it needs a current analysis first.', reason: 'needs_current_analysis', exits: [{ kind: 'run' }] });
      expect(reply.text).not.toContain('None');
    } else {
      const expected = olumiEstimatesFeedingResult({ ...censusInput(read), optionSettings: [
        { id: 'a:price', label: 'Price under Raise price', authorship: 'olumi_estimate' },
        { id: 'b:price', label: 'Price under Keep price', authorship: 'user' },
      ] });
      expect(facts.olumiEstimates).toEqual(expected);
      expect(expected.count).toBe(1);
      expect(estimateOfferIds(actionBarOf(facts))).toEqual(['check_estimates']);
      expect(replyFor('check_estimates', facts)).toEqual({ text: sayOlumiEstimates(expected).join('\n'), exits: [], outcome: 'ran' });
    }
  });

  it("Paul's shape: 1 value + 8 link sizes + 2 placeholders + 1 accepted; exact producer reply", () => {
    const bound = ran(censusGraph([
      ...Array.from({ length: 8 }, () => 'olumi_estimate' as const), 'olumi_placeholder', 'olumi_placeholder', 'olumi_accepted',
    ], true));
    // The existing factor-driver reader is option-ordered, so even a licensed price driver is not global priority.
    const read: ActionRead = { ...bound, analysisResult: { ...(bound.analysisResult as object), enrichment: {
      inference_warnings: [estimateLicence({ a: 'price', b: 'price' })],
    } } };
    const sameInput = censusInput(read);
    const expected = olumiEstimatesFeedingResult(sameInput);
    expect(expected).toMatchObject({ count: 9, accepted: 1, placeholderLinks: 2, ordered: false });
    const facts = actionFactsOf(read);
    expect(facts.runBound).toBe(true);
    const reply = replyFor('check_estimates', facts);
    expect(reply).toEqual({ text: sayOlumiEstimates(expected).join('\n'), exits: [], outcome: 'ran' });
    expect(reply.text).toContain('9 in total; here are 3.');
    expect(reply.text).toContain('For example:');
    expect(reply.text).not.toContain('The 3 that matter most');
    expect(facts.olumiEstimates).toEqual(expected);
  });

  it('link-only: offers check_estimates, replies by identity, and never offers bias_anchoring; old rank hides both', () => {
    const read = ran(censusGraph(['olumi_estimate', 'olumi_estimate']));
    const facts = actionFactsOf(read);
    expect(estimatePointsOf(facts)).toEqual([]);
    const bar = actionBarOf(facts);
    expect(estimateOfferIds(bar)).toEqual(['check_estimates']);
    // Contrast on these SAME facts: reverting the shared points eligibility hides the link-only action.
    const withOldEligibility = estimateOfferIds(bar).filter(() => facts.runBound && estimatePointsOf(facts).length > 0);
    expect(withOldEligibility).toEqual([]);
    const expected = olumiEstimatesFeedingResult(censusInput(read));
    expect(expected).toMatchObject({ count: 2, values: [], accepted: 0, placeholderLinks: 0 });
    expect(replyFor('check_estimates', facts)).toEqual({ text: sayOlumiEstimates(expected).join('\n'), exits: [], outcome: 'ran' });
    expect(replyFor('bias_anchoring', facts)).toEqual({ text: "None of these patterns' triggers fire in this model.", reason: 'nothing_in_scope', exits: [] });
  });

  it.each(['not runBound', 'stale', 'unread'] as const)('%s: null census, no Check estimates offer, cannot-yet press and never None', state => {
    const bound = ran(censusGraph(['olumi_estimate'], true));
    const read: ActionRead = state === 'unread' ? { ...bound, graph: { nodes: 'unreadable' } }
      : state === 'stale' ? { ...bound, analysisState: { run_state: { kind: 'complete_stale', computed_at: AT } } }
        : { ...bound, analysisState: undefined, analysisResult: undefined };
    const facts = actionFactsOf(read);
    expect(estimateOfferIds(actionBarOf(facts))).toEqual([]);
    const reply = replyFor('check_estimates', facts);
    expect(reply.text).toBe('I can’t show the estimates yet: it needs a current analysis first.');
    expect(reply.reason).toBe('needs_current_analysis');
    expect(reply.exits).toEqual([{ kind: 'run' }]);
    expect(reply.text).not.toContain('None');
    expect(facts.olumiEstimates).toBeNull();
  });

  it('bias_anchoring keeps its pre-change literal reply while Check estimates retains a separate uncapped census', () => {
    const bound = ran(estimateGraph());
    const read: ActionRead = { ...bound, analysisResult: { ...(bound.analysisResult as object), enrichment: {
      inference_warnings: [estimateLicence()],
    } } };
    const facts = actionFactsOf(read);
    const expected = [
      "A first number can pull later estimates towards it. Here are Olumi's figures this result leans on, to test against your own evidence.",
      "- Olumi put ‘Far’ at 25%. That's Olumi's estimate, not a measured figure. What would make the real value much lower than that? And what would make it much higher? From your own evidence, what range would you give, and what is it based on?",
      "- Olumi put ‘Near’ at 15%. That's Olumi's estimate, not a measured figure. What would make the real value much lower than that? And what would make it much higher? From your own evidence, what range would you give, and what is it based on?",
      "- Olumi put ‘Extra’ at 10%. That's Olumi's estimate, not a measured figure. What would make the real value much lower than that? And what would make it much higher? From your own evidence, what range would you give, and what is it based on?",
      'Which of these would you check first?',
    ].join('\n');
    expect(replyFor('bias_anchoring', facts)).toMatchObject({ text: expected, exits: [], outcome: 'ran' });
    expect(facts.olumiEstimates).toEqual(olumiEstimatesFeedingResult(censusInput(read)));
  });

  it.each(['olumi_accepted', 'olumi_placeholder'] as const)('%s-only census: offered despite zero estimates and empty anchoring points', size => {
    const read = ran(censusGraph([size]));
    const facts = actionFactsOf(read);
    expect(estimatePointsOf(facts)).toEqual([]);
    expect(estimateOfferIds(actionBarOf(facts))).toEqual(['check_estimates']);
    const expected = olumiEstimatesFeedingResult(censusInput(read));
    expect(expected.count).toBe(0);
    expect(replyFor('check_estimates', facts)).toEqual({ text: sayOlumiEstimates(expected).join('\n'), exits: [], outcome: 'ran' });
  });
});
