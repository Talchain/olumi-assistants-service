/**
 * B3 MODEL FIDELITY + ADMISSION — acceptance rows B3-1, B3-2, B3-3, B3-5, B3-6 and controls B3-C1, B3-C2, run
 * end-to-end at 0 LLM: the stored graph SHAPE → the real Run loader (`loadScenarioSnapshotForRunAnalysis`, which holds
 * the one readiness authority and the two-term admission) → the real `run_analysis` handler → the PLoT submission.
 * Only PLoT's calculation is stubbed, and it scores exactly the options it is SENT — so an option absent from the
 * submission is absent from `option_comparison`, `decision_brief.options` and the win probabilities by construction.
 *
 * Every assertion binds an option by its ID (and, for the copy, its exact label) — never a value predicate another
 * option could satisfy.
 *
 * Brief: `olumi-programme-docs` `output/b3-model-fidelity/BRIEF.md` @ c5da102e.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';

vi.mock('../../../session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../session/index.js')>()),
  getSessionStore: () => ({
    readRecent: vi.fn().mockResolvedValue([]),
    readFactsFor: vi.fn().mockResolvedValue([]),
    readFactsWithTurnFor: vi.fn().mockResolvedValue([]),
    readScenarioRunAnalysisFactsFor: vi.fn().mockResolvedValue({ facts: [], total_count: 0 }),
    readAnalysisInvalidatedAt: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));

import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../run-analysis.js';
import { gateAnalysableOptions } from '../analysable-option-gate.js';
import { B3_IDS as I, B3_LABELS as L, b3PricingGraph, type B3ShapeOptions } from './fixtures/b3-pricing-shape.js';

type Rec = Record<string, any>;
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;
const SCENARIO = 'b3b3b3b3-0000-4000-8000-000000000003';

function invocation(turnId: string): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO, request_id: turnId,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: turnId, scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: turnId, signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
}

/** A PLoT that scores exactly the options it is sent, in order. */
function scoringPlot(bodies: Rec[]): PLoTClient {
  return {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      bodies.push(structuredClone(body));
      const response = structuredClone(happy) as Rec;
      const options = body.options as Rec[];
      response.results = options.map((o, index) => ({
        option_id: o.option_id, option_label: o.label,
        win_probability: Number((1 / (index + 2)).toFixed(4)), percentile_p10: 0.1, percentile_p90: 0.9,
      }));
      response.fact_objects = [];
      response.review_cards = [];
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
}

interface RunOutcome {
  readonly result?: Rec;
  readonly error?: Rec;
  readonly bodies: Rec[];
}

async function runThroughLoader(graph: Rec): Promise<RunOutcome> {
  const bodies: Rec[] = [];
  const handler = createRunAnalysisHandler({
    plotClient: scoringPlot(bodies),
    scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'b3-run', createNoopSessionStore({ loadGraphResult: structuredClone(graph) })),
  });
  try {
    return { result: await handler(invocation('b3-turn')) as unknown as Rec, bodies };
  } catch (error) {
    return { error: error as Rec, bodies };
  }
}

const sentIds = (o: RunOutcome): string[] => (o.bodies[0]?.options as Rec[] | undefined)?.map((x) => x.option_id) ?? [];
const scoredIds = (o: RunOutcome): string[] =>
  ((o.result?.handler_facts as Rec[] | undefined)?.find((f) => f.fact_type === 'run_analysis')?.result?.enrichment?.results as Rec[] | undefined)
    ?.map((r) => r.option_id) ?? [];
const excludedOf = (o: RunOutcome, id: string): Rec | undefined =>
  (o.result?.__excluded_options as Rec[] | undefined)?.find((e) => e.option_id === id);
const readyOption = (graph: Rec, id: string): Rec | undefined =>
  (buildCanonicalAnalysisReadyFromGraph(graph as never) as Rec | undefined)?.options?.find((o: Rec) => o.option_id === id);

const pricing = (opts: B3ShapeOptions = {}): Rec => b3PricingGraph(opts);

describe('B3-1 — the free month, declared missing, is admitted as incomplete and never compared', () => {
  const graph = pricing({ declared: true, withoutPerSeat: true });

  it('readiness: needs_user_mapping, unresolved_targets ⊇ ["free first month"], and the question names it', () => {
    const intro = readyOption(graph, I.intro);
    expect(intro?.status).toBe('needs_user_mapping');
    expect(intro?.unresolved_targets).toEqual(expect.arrayContaining(['free first month']));
    expect((intro?.user_questions as string[]).join(' ')).toContain('free first month');
    expect((intro?.user_questions as string[]).join(' ')).toContain(L.intro);
  });

  it('run: the introductory offer is not sent, not scored, and is excluded with a typed reason naming what is missing', async () => {
    const out = await runThroughLoader(graph);
    expect(out.error, String(out.error?.message)).toBeUndefined();
    expect(sentIds(out)).not.toContain(I.intro);
    expect(scoredIds(out)).not.toContain(I.intro);
    expect(sentIds(out)).toEqual([I.keep, I.p59, I.p54]);
    expect(excludedOf(out, I.intro)).toEqual({ option_id: I.intro, label: L.intro, reason: 'incomplete', missing: ['free first month'] });
    // Still visible with a reason and an action: the reply says it was left out, why, and how to include it.
    expect(String(out.result?.assistant_text)).toContain('was left out of this comparison because it does not model the free first month yet');
  });
});

describe('B3-1 on a drafter-created graph — a top-level options[] mirror never shadows the node\'s declaration', () => {
  it('the mirror entry reconcile appends (levels only, status ready) still reads as incomplete, and the run leaves it out', async () => {
    const graph = pricing({ declared: true, withoutPerSeat: true });
    // What `reconcileTopLevelOptionsFromNodes` writes for each option node of a graph that HAS an options[] array:
    // id, label, a status from its levels, the levels — and nothing about gaps.
    graph.options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => ({
      id: n.id, label: n.label, status: Object.keys(n.interventions ?? {}).length > 0 ? 'ready' : 'needs_encoding',
      interventions: n.interventions ?? {}, ...(n.is_baseline === true ? { is_baseline: true } : {}),
    }));
    const intro = readyOption(graph, I.intro);
    expect(intro?.status).toBe('needs_user_mapping');
    expect(intro?.unresolved_targets).toEqual(['free first month']);
    const out = await runThroughLoader(graph);
    expect(out.error, String(out.error?.message)).toBeUndefined();
    expect(sentIds(out)).toEqual([I.keep, I.p59, I.p54]);
    expect(excludedOf(out, I.intro)?.reason).toBe('incomplete');
  });
});

describe('B3-2 — two options with identical intervention vectors are not ranked as two', () => {
  // Written exactly as today: the introductory offer carries ONLY the ongoing price, byte-identical to £59, and no gap.
  const graph = pricing({ withoutPerSeat: true });

  it('the later twin is left out and names the option it duplicates; £59 itself is compared', async () => {
    const out = await runThroughLoader(graph);
    expect(out.error, String(out.error?.message)).toBeUndefined();
    expect(sentIds(out)).toEqual([I.keep, I.p59, I.p54]);
    expect(scoredIds(out)).not.toContain(I.intro);
    expect(excludedOf(out, I.intro)).toEqual({
      option_id: I.intro, label: L.intro, reason: 'duplicate', duplicate_of: I.p59, duplicate_of_label: L.p59,
    });
    expect(String(out.result?.assistant_text)).toContain(`indistinguishable from '${L.p59}'`);
  });

  it('CONTROL: £59 and £54 differ in one value, so both are compared and nothing is excluded', async () => {
    const out = await runThroughLoader(pricing({ withoutPerSeat: true, withoutIntro: true }));
    expect(out.error, String(out.error?.message)).toBeUndefined();
    expect(sentIds(out)).toEqual([I.keep, I.p59, I.p54]);
    expect(out.result?.__excluded_options).toBeUndefined();
  });
});

describe('B3-3 — per-seat pricing with no billable seats is admitted as incomplete and never compared', () => {
  const graph = pricing({ declared: true, withoutIntro: true });

  it('readiness: needs_user_mapping with unresolved_targets ⊇ ["billable seats"]', () => {
    const perSeat = readyOption(graph, I.perSeat);
    expect(perSeat?.status).toBe('needs_user_mapping');
    expect(perSeat?.unresolved_targets).toEqual(expect.arrayContaining(['billable seats']));
    expect((perSeat?.user_questions as string[]).join(' ')).toContain('billable seats');
  });

  it('run: per-seat is not sent, not scored, and is excluded naming the billable seats', async () => {
    const out = await runThroughLoader(graph);
    expect(out.error, String(out.error?.message)).toBeUndefined();
    expect(sentIds(out)).toEqual([I.keep, I.p59, I.p54]);
    expect(scoredIds(out)).not.toContain(I.perSeat);
    expect(excludedOf(out, I.perSeat)).toEqual({ option_id: I.perSeat, label: L.perSeat, reason: 'incomplete', missing: ['billable seats'] });
  });
});

describe('B3-1 + B3-3 together — the served shape, both declared', () => {
  it('only the three complete options are compared; both incomplete ones are named', async () => {
    const out = await runThroughLoader(pricing({ declared: true }));
    expect(out.error, String(out.error?.message)).toBeUndefined();
    expect(sentIds(out)).toEqual([I.keep, I.p59, I.p54]);
    expect((out.result?.__excluded_options as Rec[]).map((e) => [e.option_id, e.reason])).toEqual([
      [I.intro, 'incomplete'], [I.perSeat, 'incomplete'],
    ]);
  });
});

describe('B3-5 — supplying the missing mechanism puts per-seat back in the comparison', () => {
  it('a billable-seats factor with a value and a path to MRR, and the gap cleared: ready, sent, scored, nothing stale', async () => {
    const graph = pricing({ declared: true, withoutIntro: true, seatsResolved: true });
    expect(readyOption(graph, I.perSeat)?.status).toBe('ready');
    expect(readyOption(graph, I.perSeat)?.unresolved_targets).toBeUndefined();
    const out = await runThroughLoader(graph);
    expect(out.error, String(out.error?.message)).toBeUndefined();
    expect(sentIds(out)).toEqual([I.keep, I.p59, I.p54, I.perSeat]);
    expect(scoredIds(out)).toContain(I.perSeat);
    expect(excludedOf(out, I.perSeat)).toBeUndefined();
  });
});

describe('B3-6 — when exclusion leaves fewer than two options, nothing runs and the refusal names what is needed', () => {
  it('through admission: no PLoT call, and the questions name each incomplete option and its missing mechanism', async () => {
    const out = await runThroughLoader(pricing({ declared: true, withoutP54: true, withoutP59: true }));
    expect(out.bodies).toEqual([]);
    expect(out.error?.cause_kind).toBe('analysis_not_ready');
    const asks = (out.error?.details?.readiness_questions as string[]).join(' ');
    expect(asks).toContain(`"${L.intro}" does not model the free first month yet`);
    expect(asks).toContain(`"${L.perSeat}" does not model the billable seats yet`);
  });

  it('at the run gate itself: the insufficient_analysable_options refusal names the incomplete option and what it needs', async () => {
    const bodies: Rec[] = [];
    const snapshot = {
      graph: b3PricingGraph({ withoutP54: true, withoutP59: true, withoutPerSeat: true }),
      goal_node_id: I.goal,
      rawPersistedGraph: b3PricingGraph({ withoutP54: true, withoutP59: true, withoutPerSeat: true }),
      options: [
        { id: I.keep, option_id: I.keep, label: L.keep, interventions: {}, is_baseline: true, status: 'ready' },
        {
          id: I.intro, option_id: I.intro, label: L.intro, is_baseline: false, status: 'needs_user_mapping',
          interventions: { [I.price]: { value: 0.295, raw_value: 59 } }, unresolved_targets: ['free first month'],
        },
      ],
    } as unknown as RunAnalysisScenarioSnapshot;
    const handler = createRunAnalysisHandler({ plotClient: scoringPlot(bodies), scenarioReader: async () => snapshot });
    const error = await handler(invocation('b3-six')).then(() => undefined, (e: unknown) => e as Rec);
    expect(bodies).toEqual([]);
    expect(error?.details?.reason_code).toBe('insufficient_analysable_options');
    expect(String(error?.details?.next_step)).toContain(`'${L.intro}' does not model the free first month yet`);
  });
});

describe('B3-C1 — CONTROL: fully modelled options are untouched', () => {
  const hiring: Rec = {
    nodes: [
      { id: 'should_we_hire', kind: 'decision', label: 'Should we hire?' },
      { id: 'delivery', kind: 'goal', label: 'Features shipped per quarter', goal_direction: '>',
        observed_state: { value: 0.4, raw_value: 8, cap: 20, unit: 'features', source: 'brief_extraction' } },
      { id: 'status_quo', kind: 'option', label: 'Keep the current team', is_baseline: true },
      { id: 'hire_two', kind: 'option', label: 'Hire 2 engineers',
        interventions: { headcount: { value: 0.35, raw_value: 7, unit: 'engineers', source: 'user_specified',
          target_match: { node_id: 'headcount', match_type: 'exact_id', confidence: 'high' } } } },
      { id: 'hire_one', kind: 'option', label: 'Hire 1 engineer',
        interventions: { headcount: { value: 0.3, raw_value: 6, unit: 'engineers', source: 'user_specified',
          target_match: { node_id: 'headcount', match_type: 'exact_id', confidence: 'high' } } } },
      { id: 'headcount', kind: 'factor', label: 'Engineering headcount', category: 'controllable',
        observed_state: { value: 0.25, raw_value: 5, cap: 20, unit: 'engineers', declared_scale: 'unit_interval', source: 'brief_extraction' } },
    ],
    edges: [
      { from: 'should_we_hire', to: 'status_quo', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'should_we_hire', to: 'hire_two', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'should_we_hire', to: 'hire_one', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'status_quo', to: 'headcount', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', origin: 'repair' },
      { from: 'hire_two', to: 'headcount', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'hire_one', to: 'headcount', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'headcount', to: 'delivery', strength: { mean: 0.6, std: 0.15 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  };

  it('hiring: every option ready, all three sent as before, no exclusion, no false "incomplete"', async () => {
    for (const id of ['status_quo', 'hire_two', 'hire_one']) expect(readyOption(hiring, id)?.status).toBe('ready');
    const out = await runThroughLoader(hiring);
    expect(out.error, String(out.error?.message)).toBeUndefined();
    // Measured on unchanged staging 9a9bf022: this exact submission.
    expect((out.bodies[0]!.options as Rec[]).map((o) => [o.option_id, o.interventions])).toEqual([
      ['status_quo', { headcount: 5 }], ['hire_two', { headcount: 7 }], ['hire_one', { headcount: 6 }],
    ]);
    expect(out.result?.__excluded_options).toBeUndefined();
  });

  it('pricing without the two Agent options: the submission is the one staging sent, and the gate is a by-reference no-op', async () => {
    const graph = pricing({ withoutIntro: true, withoutPerSeat: true });
    const out = await runThroughLoader(graph);
    expect((out.bodies[0]!.options as Rec[]).map((o) => [o.option_id, o.interventions])).toEqual([
      [I.keep, { [I.price]: 49 }], [I.p59, { [I.price]: 59 }], [I.p54, { [I.price]: 54 }],
    ]);
    const options = [
      { option_id: I.p59, label: L.p59, status: 'ready', interventions: { [I.price]: { value: 0.295, raw_value: 59 } } },
      { option_id: I.p54, label: L.p54, status: 'ready', interventions: { [I.price]: { value: 0.27, raw_value: 54 } } },
    ];
    expect(gateAnalysableOptions({ options, graph, scaleNetEnabled: true }).options).toBe(options);
  });
});

describe('B3-C2 — the drafter\'s own unresolved_targets keep today\'s readiness projection', () => {
  it('a drafter option carrying unresolved_targets + user_questions on the top-level options mirror is projected exactly as before', () => {
    const graph = pricing({ withoutIntro: true, withoutPerSeat: true });
    graph.options = [
      { id: I.keep, label: L.keep, status: 'ready', interventions: {}, is_baseline: true },
      { id: I.p59, label: L.p59, status: 'ready', interventions: { [I.price]: { value: 0.295, raw_value: 59, source: 'brief_extraction',
        target_match: { node_id: I.price, match_type: 'exact_id', confidence: 'high' } } } },
      { id: I.p54, label: L.p54, status: 'ready', unresolved_targets: ['annual billing'], user_questions: ['What does annual billing change?'],
        interventions: { [I.price]: { value: 0.27, raw_value: 54, source: 'brief_extraction',
          target_match: { node_id: I.price, match_type: 'exact_id', confidence: 'high' } } } },
    ];
    const p54 = readyOption(graph, I.p54);
    // Measured on unchanged staging 9a9bf022.
    expect({ status: p54?.status, unresolved_targets: p54?.unresolved_targets, user_questions: p54?.user_questions }).toEqual({
      status: 'needs_user_mapping', unresolved_targets: ['annual billing'], user_questions: ['What does annual billing change?'],
    });
  });
});
