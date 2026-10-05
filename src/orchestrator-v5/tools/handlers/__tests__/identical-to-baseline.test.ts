import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { readOptionResultSources, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_WITHHELD_CODES } from '../../../../orchestrator/context/option-result-source.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { buildIdenticalToBaselineDisclosure, IDENTICAL_TO_BASELINE_DISCLOSURE_RE_SRC } from '../../../coaching/scaffold-disclosure.js';
import { isAllowedRunAnalysisAssistantText, TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS } from '../../../coaching/analysis-result-headline.js';
import { detectIdenticalToBaseline, mergeIdenticalToBaselineArms } from '../identical-to-baseline.js';
import { createRunAnalysisHandler, leadingOptionAfterMerge, readResultRecords, selectLeadingOptionId, RUN_ANALYSIS_ASSISTANT_TEMPLATES } from '../run-analysis.js';
import happy from '../../../../../tests/fixtures/plot/v2-run-golden-happy.json' with { type: 'json' };

type Rec = Record<string, unknown>;
const options = [
  // Configured baseline: gate.held is EMPTY, deliberately discriminating the wrong-baseline mutant.
  { id: 'carry_on', option_id: 'carry_on', label: 'Carry On', is_baseline: true, interventions: { fac_capacity: 0.5 } },
  { id: 'hire_two', option_id: 'hire_two', label: 'Hire Two', interventions: { fac_capacity: 0.5 } },
  { id: 'tech_lead', option_id: 'tech_lead', label: 'Tech Lead', interventions: { fac_capacity: 0.8 } },
];
const disclosure = " Hire Two came out identical to Carry On: in this model it doesn't change the outcome.";

function resultRows(techShare = 0.6): Rec[] {
  const outcome = { p10: 10, p50: 20, p90: 30, mean: 20, std: 5, n_valid_samples: 1000 };
  const downside = { p05: 8, cvar_10: 6, expected_regret: 2 };
  return options.map((o, i) => ({
    option_id: o.option_id, option_label: o.label, status: 'computed',
    win_probability: i === 2 ? techShare : (1 - techShare) / 2,
    outcome: { ...outcome, ...(i === 2 ? { p50: 40, mean: 40 } : {}) },
    downside: { ...downside }, probability_of_goal: i === 2 ? 0.8 : 0.2,
  }));
}

/** Golden run-analysis envelope shape, with current PLoT outcome/downside and named comparison carriers. */
function body(techShare = 0.6): Rec {
  const rows = resultRows(techShare);
  return {
    ...structuredClone(happy), option_comparison: structuredClone(rows), results: structuredClone(rows),
    win_probabilities: { carry_on: (1 - techShare) / 2, hire_two: (1 - techShare) / 2, tech_lead: techShare },
    decision_brief: {
      options: rows.map((r, i) => ({ ...structuredClone(r), rank: i + 1 })),
      headline: 'Hire Two currently leads.',
      headline_banded: { option_id: 'hire_two', text: 'Hire Two currently leads.' },
      analysis_summary: { leading_option: { option_id: 'hire_two', label: 'Hire Two' }, near_tie: ['carry_on', 'hire_two'] },
      what_would_change: { alternative_winner_id: 'hire_two' },
    },
    robustness: {
      level: 'moderate', near_tie: { is_tie: true, option_ids: ['carry_on', 'hire_two'], gap: 0 },
      recommended_option_id: 'hire_two', recommended_option_label: 'Hire Two', recommended_option_compliance: 'feasible',
      fragile_edges: [{ edge_id: 'dup', alternative_winner_id: 'hire_two' }, { edge_id: 'keep', alternative_winner_id: 'tech_lead' }],
      robust_edges: [{ edge_id: 'dup', alternative_winner_id: 'hire_two' }],
      flip_thresholds: [{ alternative_winner_id: 'hire_two' }],
    },
    flip_thresholds: [{ alternative_winner_id: 'hire_two' }, { alternative_winner_id: 'tech_lead' }],
    conditional_winners: [{ winner_id: 'hire_two', conditions: [] }, { winner_id: 'tech_lead', conditions: [] }],
    constraint_results: [{ option_id: 'hire_two', constraint_id: 'c1' }, { option_id: 'carry_on', constraint_id: 'c1' }],
    critiques: [{ code: 'fixture', affected_option_ids: ['hire_two', 'tech_lead'] }],
    m1_coaching: {
      story_headlines: { hire_two: 'A contender', tech_lead: 'Another contender' },
      narrative_summary: 'Hire Two currently leads.',
      next_actions: [{ target_id: 'hire_two' }, { target_id: 'fac_capacity' }],
    },
    decision_review: { story_headlines: { hire_two: 'A contender', tech_lead: 'Another contender' } },
    m1_review: { story_headlines: { hire_two: 'A contender', tech_lead: 'Another contender' }, narrative_summary: 'Hire Two currently leads.',
      decision_quality_prompts: [{ question: 'Would Hire Two help?' }, { question: 'What evidence matters?' }] },
    edge_e_values: [{ edge_id: 'dup', baseline_winner_id: 'hire_two' }, { edge_id: 'keep', baseline_winner_id: 'tech_lead' }],
    factor_flip_values: [{ factor_id: 'fac_capacity', baseline_winner_id: 'hire_two' }],
    sensitivity_reference_option_id: 'hire_two', leading_option_id: 'hire_two',
    fact_objects: [{ fact_type: 'option_comparison', fact_id: 'f1', data: { lead: 'hire_two', margin: 0 } }],
    review_cards: [{ card_id: 'rc1', title: 'Leading option', body: 'Hire Two currently leads.' }],
    inference_warnings: [{ code: 'EXISTING', message: 'Existing warning' }],
  };
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe('gate 1 v2 — returned outcome identity with the submitted baseline', () => {
  it('(a) set-to-today arm: sums shares, removes the arm from every array and strips named carriers', () => {
    const input = body();
    const identical = detectIdenticalToBaseline(input, options);
    expect(identical).toEqual([{ option_id: 'hire_two', label: 'Hire Two', baseline_option_id: 'carry_on',
      baseline_label: 'Carry On', merged_win_probability: 0.4 }]);
    const merged = mergeIdenticalToBaselineArms(input, identical);
    for (const source of readOptionResultSources(merged)) {
      expect(source.map((r) => r.option_id)).not.toContain('hire_two');
      expect(source.find((r) => r.option_id === 'carry_on')?.win_probability).toBeCloseTo(0.4, 14);
    }
    expect(merged.win_probabilities).toEqual({ carry_on: 0.4, tech_lead: 0.6 });
    const brief = merged.decision_brief as Rec;
    expect(brief).not.toHaveProperty('headline');
    expect(brief).not.toHaveProperty('headline_banded');
    expect(brief).not.toHaveProperty('analysis_summary');
    expect(brief).not.toHaveProperty('what_would_change');
    expect((brief.options as Rec[]).map((r) => [r.option_id, r.rank])).toEqual([['tech_lead', 1], ['carry_on', 2]]);
    const robustness = merged.robustness as Rec;
    expect(robustness).not.toHaveProperty('near_tie');
    expect(Object.keys(robustness).some((k) => k.startsWith('recommended_option_'))).toBe(false);
    expect(robustness.fragile_edges).toEqual([{ edge_id: 'keep', alternative_winner_id: 'tech_lead' }]);
    expect(robustness.robust_edges).toEqual([]);
    expect(robustness.flip_thresholds).toEqual([]);
    expect(merged.flip_thresholds).toEqual([{ alternative_winner_id: 'tech_lead' }]);
    expect(merged.conditional_winners).toEqual([{ winner_id: 'tech_lead', conditions: [] }]);
    expect(merged.constraint_results).toEqual([{ option_id: 'carry_on', constraint_id: 'c1' }]);
    expect(merged.critiques).toEqual([{ code: 'fixture', affected_option_ids: ['tech_lead'] }]);
    expect(merged.m1_coaching).toEqual({ story_headlines: { tech_lead: 'Another contender' }, next_actions: [{ target_id: 'fac_capacity' }] });
    expect(merged.decision_review).toEqual({ story_headlines: { tech_lead: 'Another contender' } });
    expect(merged.m1_review).toEqual({ story_headlines: { tech_lead: 'Another contender' }, decision_quality_prompts: [{ question: 'What evidence matters?' }] });
    expect(merged.edge_e_values).toEqual([{ edge_id: 'keep', baseline_winner_id: 'tech_lead' }]);
    expect(merged.factor_flip_values).toEqual([]);
    expect(merged).not.toHaveProperty('sensitivity_reference_option_id');
    expect(merged).not.toHaveProperty('leading_option_id');
    expect(merged.fact_objects).toEqual([]);
    expect(merged.review_cards).toEqual([]);
    expect((merged.inference_warnings as Rec[]).map((w) => w.code)).toEqual(['EXISTING', 'OPTION_IDENTICAL_TO_BASELINE']);
    expect(GOAL_FIGURES_WITHHELD_CODES.has('OPTION_IDENTICAL_TO_BASELINE')).toBe(false);
    expect(buildIdenticalToBaselineDisclosure(identical)).toBe(disclosure);
  });

  it('covers all nested result arrays and both id- and label-keyed maps', () => {
    const input = body();
    input.results = { option_comparison: resultRows(), options: resultRows(), option_results: resultRows(),
      win_probabilities: { 'Carry On': 0.2, 'Hire Two': 0.2, 'Tech Lead': 0.6 } };
    const merged = mergeIdenticalToBaselineArms(input, detectIdenticalToBaseline(input, options));
    for (const key of ['option_comparison', 'options', 'option_results']) {
      const rows = (merged.results as Rec)[key] as Rec[];
      expect(rows.map((r) => r.option_id)).toEqual(['carry_on', 'tech_lead']);
      expect(rows[0]!.win_probability).toBe(0.4);
    }
    expect((merged.results as Rec).win_probabilities).toEqual({ 'Carry On': 0.4, 'Tech Lead': 0.6 });
  });

  it('(b) no-path arm: identical stats merge with cause-neutral wording', () => {
    const noPathOptions = options.map((o) => o.option_id === 'hire_two' ? { ...o, interventions: { fac_unconnected: 0.9 } } : o);
    const input = body();
    const identical = detectIdenticalToBaseline(input, noPathOptions);
    expect(identical).toHaveLength(1);
    expect((mergeIdenticalToBaselineArms(input, identical).option_comparison as Rec[])).toHaveLength(2);
    expect(buildIdenticalToBaselineDisclosure(identical)).toBe(disclosure);
    expect(buildIdenticalToBaselineDisclosure(identical)).not.toContain("today's level");
  });

  it.each(['p10', 'p50', 'p90', 'mean', 'std', 'p05', 'cvar_10', 'expected_regret'])('(c) %s differing by relative 1e-6 is retained', (field) => {
    const input = body(), rows = input.option_comparison as Rec[];
    const stats = rows[1]![field in (rows[1]!.outcome as Rec) ? 'outcome' : 'downside'] as Rec;
    stats[field] = (stats[field] as number) * (1 + 1e-6);
    const identical = detectIdenticalToBaseline(input, options);
    expect(identical).toEqual([]);
    expect(mergeIdenticalToBaselineArms(input, identical)).toEqual(input);
  });

  it('(d) no baseline or two explicit baselines detects nothing', () => {
    for (const submitted of [options.map((o) => ({ ...o, is_baseline: false })),
      options.map((o) => ({ ...o, is_baseline: o.option_id !== 'tech_lead' }))]) {
      const input = body(), identical = detectIdenticalToBaseline(input, submitted);
      expect(identical).toEqual([]);
      expect(mergeIdenticalToBaselineArms(input, identical)).toEqual(input);
    }
  });

  it('(e) a merged arm never leads; a baseline alone has no crown; Tech Lead can still lead', () => {
    const input = body();
    const merged = mergeIdenticalToBaselineArms(input, detectIdenticalToBaseline(input, options));
    expect(leadingOptionAfterMerge(readResultRecords(merged as V2RunResponseEnvelope), 1)).toBe('tech_lead');
    const two = body(0);
    two.option_comparison = (two.option_comparison as Rec[]).slice(0, 2);
    two.results = (two.results as Rec[]).slice(0, 2);
    (two.decision_brief as Rec).options = ((two.decision_brief as Rec).options as Rec[]).slice(0, 2);
    const onlyBaseline = mergeIdenticalToBaselineArms(two, detectIdenticalToBaseline(two, options.slice(0, 2)));
    expect(leadingOptionAfterMerge(readResultRecords(onlyBaseline as V2RunResponseEnvelope), 1)).toBeNull();
    // Contrast: with NO merge the R2 single-result rule is unchanged — a lone option still leads.
    expect(leadingOptionAfterMerge(readResultRecords(onlyBaseline as V2RunResponseEnvelope), 0)).toBe('carry_on');
    expect(selectLeadingOptionId(readResultRecords(onlyBaseline as V2RunResponseEnvelope))).toBe('carry_on');
    const baselineWins = body(0.2);
    const wins = mergeIdenticalToBaselineArms(baselineWins, detectIdenticalToBaseline(baselineWins, options));
    expect(leadingOptionAfterMerge(readResultRecords(wins as V2RunResponseEnvelope), 1)).toBe('carry_on');
  });

  it.each([0, 1])('(f) missing downside on side %s keeps the arm', (side) => {
    const input = body();
    delete (input.option_comparison as Rec[])[side]!.downside;
    expect(detectIdenticalToBaseline(input, options)).toEqual([]);
  });

  it.each([undefined, NaN, Infinity, -Infinity])('missing/non-finite fields fail toward keeping: %s', (value) => {
    const input = body();
    ((input.option_comparison as Rec[])[1]!.outcome as Rec).std = value;
    expect(detectIdenticalToBaseline(input, options)).toEqual([]);
  });

  it('sample counts must be present and equal; exact zeros equal but tiny nonzero does not equal zero', () => {
    const input = body(), rows = input.option_comparison as Rec[];
    (rows[1]!.outcome as Rec).n_valid_samples = 999;
    expect(detectIdenticalToBaseline(input, options)).toEqual([]);
    delete (rows[1]!.outcome as Rec).n_valid_samples;
    expect(detectIdenticalToBaseline(input, options)).toEqual([]);
    (rows[1]!.outcome as Rec).n_valid_samples = 1000;
    (rows[0]!.downside as Rec).expected_regret = 0;
    (rows[1]!.downside as Rec).expected_regret = 0;
    expect(detectIdenticalToBaseline(input, options)).toHaveLength(1);
    (rows[1]!.downside as Rec).expected_regret = 1e-100;
    expect(detectIdenticalToBaseline(input, options)).toEqual([]);
  });

  it('relative 1e-13 is within tolerance; multiple arms add once and disclose once each', () => {
    const input = body(), rows = input.option_comparison as Rec[];
    (rows[1]!.outcome as Rec).mean = 20 * (1 + 1e-13);
    expect(detectIdenticalToBaseline(input, options)).toHaveLength(1);
    const third = { ...options[1]!, id: 'hire_one', option_id: 'hire_one', label: 'Hire One' };
    rows.push({ ...structuredClone(rows[0]!), option_id: third.option_id, option_label: third.label, win_probability: 0.1 });
    rows[2]!.win_probability = 0.5;
    input.results = structuredClone(rows);
    (input.decision_brief as Rec).options = rows.map((r, i) => ({ ...structuredClone(r), rank: i + 1 }));
    input.win_probabilities = { carry_on: 0.2, hire_two: 0.2, tech_lead: 0.5, hire_one: 0.1 };
    const records = detectIdenticalToBaseline(input, [...options, third]);
    expect(records).toHaveLength(2);
    const merged = mergeIdenticalToBaselineArms(input, records);
    expect((merged.option_comparison as Rec[]).find((r) => r.option_id === 'carry_on')?.win_probability).toBe(0.5);
    expect((merged.inference_warnings as Rec[]).filter((w) => w.code === 'OPTION_IDENTICAL_TO_BASELINE')).toHaveLength(1);
    expect(buildIdenticalToBaselineDisclosure(records)).toBe(disclosure
      + " Hire One came out identical to Carry On: in this model it doesn't change the outcome.");
  });

  it('uses current-first shared reader, retaining an arm when only a stale fallback claims identity', () => {
    const input = body();
    delete (input.option_comparison as Rec[])[1]!.outcome;
    expect(detectIdenticalToBaseline(input, options)).toEqual([]);
  });

  it('(g) purity: frozen inputs and submitted options remain unchanged', () => {
    const input = freezeDeep(body()), before = structuredClone(input);
    const submitted = freezeDeep(structuredClone(options));
    const merged = mergeIdenticalToBaselineArms(input, detectIdenticalToBaseline(input, submitted));
    expect(merged).not.toBe(input);
    expect(input).toEqual(before);
    expect(submitted).toEqual(options);
    expect(mergeIdenticalToBaselineArms(input, [])).not.toBe(input);
  });

  it('registers the exact sentence on both the template and headline channels', () => {
    const suffix = buildIdenticalToBaselineDisclosure(detectIdenticalToBaseline(body(), options));
    expect(new RegExp(`^(?:${IDENTICAL_TO_BASELINE_DISCLOSURE_RE_SRC})$`).test(suffix)).toBe(true);
    expect(TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.some((g) => g.name === 'IDENTICAL_TO_BASELINE_DISCLOSURE_RE_SRC')).toBe(true);
    expect(isAllowedRunAnalysisAssistantText(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT + suffix)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText('Tech Lead currently leads.' + suffix)).toBe(true);
  });
});

describe('gate 1 v2 — run_analysis path', () => {
  it.each([false, true])('stores the merged response and exact summary without crowning a sole baseline (sole=%s)', async (sole) => {
    const scenarioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const submitted = sole ? options.slice(0, 2) : options;
    const graph = {
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        { id: 'fac_capacity', kind: 'factor', label: 'Capacity', observed_state: { value: 0.5 } },
        ...submitted.map((o) => ({ ...o, kind: 'option' })),
      ],
      edges: [{ from: 'fac_capacity', to: 'g', strength: 0.8, strength_std: 0.05, confidence: 0.9,
        provenance: 'user_specified' }],
    };
    const response = body(sole ? 0 : 0.6);
    if (sole) {
      response.option_comparison = (response.option_comparison as Rec[]).slice(0, 2);
      response.results = (response.results as Rec[]).slice(0, 2);
      (response.decision_brief as Rec).options = ((response.decision_brief as Rec).options as Rec[]).slice(0, 2);
      delete (response.win_probabilities as Rec).tech_lead;
    }
    const before = structuredClone(response);
    const run = vi.fn(async (_request: Rec) => structuredClone(response) as V2RunResponseEnvelope);
    const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: async () => ({ graph, rawPersistedGraph: graph, options: submitted, goal_node_id: 'g' }),
    });
    // Copied from the existing run-analysis.test.ts invocation harness.
    const invocation: HandlerInvocation = {
      context: {
        stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
        messages: [{ role: 'user', content: 'run analysis' }], session_id: scenarioId, request_id: 'req-g1v2',
        budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
        scenarioBriefText: null, persistedGraph: null,
      } as unknown as HandlerInvocation['context'],
      payload: makeMessagePayload({ turn_id: 't1', scenario_id: scenarioId, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-g1v2', signal: new AbortController().signal, orientationText: '',
    };
    const outcome = await handler(invocation);
    expect(run).toHaveBeenCalledTimes(1);
    const sent = run.mock.calls[0]![0].options as Rec[];
    expect(sent.map((o) => o.option_id)).toContain('hire_two');
    expect(sent.find((o) => o.option_id === 'carry_on')?.is_baseline).toBe(true);
    expect(outcome.__scaffolded_options ?? []).toEqual([]);
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    const enrichment = fact.result.enrichment as Rec;
    for (const rows of readOptionResultSources(enrichment)) expect(rows.map((r) => r.option_id)).not.toContain('hire_two');
    expect(outcome.__identical_to_baseline).toHaveLength(1);
    expect(outcome.__identical_to_baseline?.[0]?.option_id).toBe('hire_two');
    expect(outcome.__excluded_options ?? []).toEqual([]);
    expect(outcome.assistant_text).toContain(disclosure);
    expect(fact.result.summary).toBe(outcome.assistant_text);
    expect(fact.result.leading_option_id).not.toBe('hire_two');
    if (sole) {
      expect(fact.result.leading_option_id).toBeNull();
      expect(outcome.assistant_text).not.toMatch(/currently leads|scored highest/);
      expect(readOptionResultSources(enrichment)[0]?.map((r) => r.option_id)).toEqual(['carry_on']);
    }
    expect(response).toEqual(before);
  });

  it('DL ruling: a merged arm whose only path is an unsized (placeholder) link still withholds the goal figure — on its baseline', async () => {
    const scenarioId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const submitted = [
      { ...options[0]!, interventions: { fac_capacity: 0.5 } },
      // MOVES Hires (0.3 today → 0.6) through an unsized link: identical outcomes are measured UNDER the placeholder.
      { ...options[1]!, interventions: { fac_hire: 0.6 } },
      { ...options[2]!, interventions: { fac_capacity: 0.8 } },
    ];
    const graph = (placeholder: boolean) => ({
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        { id: 'fac_capacity', kind: 'factor', label: 'Capacity', observed_state: { value: 0.5 } },
        { id: 'fac_hire', kind: 'factor', label: 'Hires', observed_state: { value: 0.3 } },
        ...submitted.map((o) => ({ ...o, kind: 'option' })),
      ],
      edges: [
        { from: 'fac_capacity', to: 'g', strength: 0.8, strength_std: 0.05, confidence: 0.9, provenance: { source: 'user_specified' } },
        { from: 'fac_hire', to: 'g', strength: 0.5, strength_std: 0.1, confidence: 0.5,
          provenance: placeholder ? { source: 'olumi', magnitude: 'olumi_placeholder' } : { source: 'user_specified' } },
      ],
    });
    const runWith = async (placeholder: boolean) => {
      const g = graph(placeholder);
      const plotClient = { run: vi.fn(async () => structuredClone(body(0.6)) as V2RunResponseEnvelope),
        validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
      const handler = createRunAnalysisHandler({
        plotClient, scenarioReader: async () => ({ graph: g, rawPersistedGraph: g, options: submitted, goal_node_id: 'g' }),
      });
      const invocation: HandlerInvocation = {
        context: {
          stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
          messages: [{ role: 'user', content: 'run analysis' }], session_id: scenarioId, request_id: 'req-g1v2-w',
          budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
          scenarioBriefText: null, persistedGraph: null,
        } as unknown as HandlerInvocation['context'],
        payload: makeMessagePayload({ turn_id: 't1', scenario_id: scenarioId, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
        requestId: 'req-g1v2-w', signal: new AbortController().signal, orientationText: '',
      };
      const outcome = await handler(invocation);
      const fact = outcome.handler_facts[0]!;
      if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
      return { outcome, enrichment: fact.result.enrichment as Rec };
    };
    const withPlaceholder = await runWith(true);
    expect(withPlaceholder.outcome.__identical_to_baseline?.map((r) => r.option_id)).toEqual(['hire_two']);
    const rows = readOptionResultSources(withPlaceholder.enrichment).flat();
    expect(rows.map((r) => r.option_id)).not.toContain('hire_two');
    // The baseline's merged share rests on the unsized link, so its goal figure is withheld (bound by id).
    expect(rows.filter((r) => r.option_id === 'carry_on').every((r) => r.win_probability === undefined)).toBe(true);
    expect((withPlaceholder.enrichment.inference_warnings as Rec[] | undefined ?? [])
      .some((w) => w.code === GOAL_FIGURES_PLACEHOLDER_PATH)).toBe(true);
    // Contrast: the same merge over a USER-sized link keeps the baseline's figure.
    const sized = await runWith(false);
    expect(sized.outcome.__identical_to_baseline?.map((r) => r.option_id)).toEqual(['hire_two']);
    const sizedRows = readOptionResultSources(sized.enrichment).flat().filter((r) => r.option_id === 'carry_on');
    expect(sizedRows.length).toBeGreaterThan(0);
    expect(sizedRows.every((r) => typeof r.win_probability === 'number')).toBe(true);
  });
});
