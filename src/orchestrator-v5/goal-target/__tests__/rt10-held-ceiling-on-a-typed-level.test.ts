/**
 * ⛔ RT-10 — "GET MONTHLY CHURN BELOW 2%" WAS RANKED BY THE LARGEST CHURN (red team #87 5992802436 / 5992853052,
 * deterministic 2/2, staging AND production; Science ruling (1), 5 Oct).
 *
 * The served goal holds the user's ceiling (`goal_direction '<'`) beside 2 `%` on a target the drafter TYPED `level`,
 * and `resolveGoalDirection` honoured a held ceiling only beside a user-stated current level in a NON-percent unit
 * (R1 S1). So nothing was sent, ISL ran its unattested maximiser, and the UI said "Your options were ordered by which
 * one produces the largest value at your goal". Science: a held ceiling on a goal typed `level` sends `minimise` in ANY
 * unit, with or without today's level; the level matters only to the goal chance, which keeps its own gates.
 *
 * THE PATH: the REAL `run_analysis` handler (PLoT faked at the transport): every assertion reads the request PLoT
 * receives, bound to the goal by id. CORPUS: the SERVED rows replay the red team's own captures verbatim
 * (`fixtures/served-rt10-churn-below-2pct.json`: staging a4977d9d — the tip this is built on — 91656b1b, and
 * production fdbef0ad). The TABLE rows are AUTHORED graphs in the shape admission writes (said so per row).
 *
 * ⚠ ORDER: CEE sends the sense; ISL orders the options by it (measured on isl-staging, `goal-direction.ts` header:
 * absent → the churn-MAXIMISING option leads; `minimise` → the ranking flips). The order by option id is witnessed on
 * the deployed build (the B2 brief through `/agent/v1/turn`), not faked here.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { log } from '../../../utils/telemetry.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { heldGoalPointsUp, resolveGoalDirection } from '../goal-direction.js';
import { ceilingTheUserWroteFor } from '../../agent-lane/stated-by-user.js';

type Rec = Record<string, unknown>;
type Node = Rec & { id: string; kind: string; label: string };
type Graph = Rec & { nodes: Node[]; edges: Rec[]; goal_constraints?: unknown[] };

const SCENARIO = '7c1e2d4a-5b3f-4e8a-9d10-1a2b3c4d5e6f';
const SERVED = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-rt10-churn-below-2pct.json', import.meta.url), 'utf8')) as {
  brief: string;
  captures: Record<string, { cee_build: string; graph: Rec }>;
};

/** The REAL `run_analysis` handler over `graph`, PLoT faked at the transport: the request PLoT receives. */
async function plotRequestFor(graph: Graph): Promise<Rec & { graph: Graph }> {
  const run = vi.fn(async (_request: unknown) => ({
    meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed',
  }) as unknown as V2RunResponseEnvelope);
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const snapshot = {
    graph, rawPersistedGraph: graph,
    goal_node_id: graph.nodes.find((n) => n.kind === 'goal')?.id ?? null,
    goal_constraints: graph.goal_constraints,
    options: graph.nodes.filter((n) => n.kind === 'option').map((n) => ({
      id: n.id, option_id: n.id, label: n.label, interventions: mergeInterventionSourceObjects(n as never),
    })),
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: vi.fn(async () => snapshot) });
  await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-rt10', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-rt10', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-rt10', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run, 'PLoT was called exactly once').toHaveBeenCalledTimes(1);
  return run.mock.calls[0]![0] as Rec & { graph: Graph };
}

/** The `cee.goal_direction.derived` records `run_analysis` logged. */
const directionLogs = (): Rec[] => vi.mocked(log.info).mock.calls
  .map((c) => c[0] as unknown as Rec)
  .filter((r) => r !== null && typeof r === 'object' && r.event === 'cee.goal_direction.derived');

beforeEach(() => { vi.mocked(log.info).mockClear(); });

describe('SERVED (red team captures, verbatim): the churn goal\'s held "<" reaches PLoT as minimise', () => {
  it.each(Object.entries(SERVED.captures))('⭐ RED %s: goal "monthly_churn" → goal_direction "minimise", logged stated_comparator', async (_key, capture) => {
    const graph = GraphV3.parse(capture.graph) as unknown as Graph;
    const goal = graph.nodes.find((n) => n.kind === 'goal')!;
    // The producer's output, as served: the "<" and the typed level frame were never lost before attestation.
    expect(goal).toMatchObject({
      id: 'monthly_churn', goal_direction: '<', goal_threshold_frame: 'level', goal_threshold_raw: 2, goal_threshold_unit: '%',
    });
    expect(Object.hasOwn(goal, 'observed_state'), 'no current level was stated').toBe(false);
    const req = await plotRequestFor(graph);
    expect(req.goal_node_id).toBe('monthly_churn');
    expect(req.goal_direction).toBe('minimise');
    expect(directionLogs()).toEqual([expect.objectContaining({
      goal_direction: 'minimise', goal_node_id: 'monthly_churn', provenance: 'stated_comparator',
    })]);
  });
});

/** A today's level as admission writes it (`briefGoalObservedState`): the user's, in the target's unit. */
type Today = { readonly raw: number; readonly cap: number; readonly unit: string };

/**
 * ⚠ AUTHORED: a three-option graph in the shape admission writes a held goal target (`holdStatedGoalAttributes` +
 * the level path of `admit-model.ts`). `frame` undefined ⇒ the key is absent (a graph saved before the frame).
 */
function goalGraph(goal: {
  readonly id: string; readonly label: string; readonly held?: string; readonly raw?: number; readonly unit: string;
  readonly cap: number; readonly frame?: string; readonly today?: Today;
}): Graph {
  const node: Rec = {
    id: goal.id, kind: 'goal', label: goal.label,
    ...(goal.held !== undefined ? { goal_direction: goal.held } : {}),
    ...(goal.frame !== undefined ? { goal_threshold_frame: goal.frame } : {}),
    goal_threshold_unit: goal.unit,
    ...(goal.raw !== undefined ? {
      goal_threshold_raw: goal.raw, goal_threshold_cap: goal.cap, goal_threshold: goal.raw / goal.cap, threshold_source: 'brief_extraction',
    } : {}),
    ...(goal.today !== undefined ? {
      observed_state: {
        value: goal.today.raw / goal.today.cap, baseline: goal.today.raw / goal.today.cap, raw_value: goal.today.raw,
        cap: goal.today.cap, unit: goal.today.unit, source: 'brief_extraction',
      },
    } : {}),
  };
  return GraphV3.parse({
    nodes: [
      node,
      { id: 'opt_more', kind: 'option', label: 'Push the lever up', interventions: { fac_lever: 0.8 } },
      { id: 'opt_less', kind: 'option', label: 'Ease the lever off', interventions: { fac_lever: 0.2 } },
      { id: 'opt_none', kind: 'option', label: 'Do nothing', is_baseline: true },
      { id: 'fac_lever', kind: 'factor', label: 'Lever', observed_state: { value: 0.5, source: 'brief_extraction' } },
    ],
    edges: [{ from: 'fac_lever', to: goal.id, strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' }],
  }) as unknown as Graph;
}

const CHURN = { id: 'monthly_churn', label: 'Monthly churn', unit: '%', cap: 100 } as const;
const CONVERSION = { id: 'trial_conversion', label: 'Trial conversion', unit: '%', cap: 100 } as const;
const TICKETS = { id: 'monthly_tickets', label: 'Monthly support tickets', unit: 'tickets per month', cap: 15000 } as const;
const VISITS = { id: 'completed_appointments', label: 'Completed appointments', unit: 'appointments', cap: 1375 } as const;

describe('THE TABLE (authored, admission\'s shape): a held CEILING on a typed level minimises in any unit; nothing else moves', () => {
  // [row, goal, expected direction on the wire]. Each is read twice: the attestation and the request PLoT receives.
  const rows: readonly (readonly [string, Parameters<typeof goalGraph>[0], 'minimise' | undefined])[] = [
    ['% DECREASE, no baseline ("churn below 2%")', { ...CHURN, held: '<', raw: 2, frame: 'level' }, 'minimise'],
    ['% DECREASE, with the user\'s baseline ("3% today, at most 2%")', { ...CHURN, held: '<=', raw: 2, frame: 'level', today: { raw: 3, cap: 100, unit: '%' } }, 'minimise'],
    ['% INCREASE, no baseline ("conversion above 5%")', { ...CONVERSION, held: '>', raw: 5, frame: 'level' }, undefined],
    ['% INCREASE, with the user\'s baseline ("3% today, at least 5%")', { ...CONVERSION, held: '>=', raw: 5, frame: 'level', today: { raw: 3, cap: 100, unit: '%' } }, undefined],
    ['COUNT DECREASE, no baseline ("under 10,000 tickets a month")', { ...TICKETS, held: '<', raw: 10000, frame: 'level' }, 'minimise'],
    ['COUNT DECREASE, with the user\'s baseline ("12,000 today, at most 10,000")', { ...TICKETS, held: '<=', raw: 10000, frame: 'level', today: { raw: 12000, cap: 15000, unit: 'tickets per month' } }, 'minimise'],
    ['COUNT INCREASE, no baseline ("reach 1,100 appointments")', { ...VISITS, held: '>=', raw: 1100, frame: 'level' }, undefined],
    ['COUNT INCREASE, with the user\'s baseline ("900 today, at least 1,100")', { ...VISITS, held: '>=', raw: 1100, frame: 'level', today: { raw: 900, cap: 1375, unit: 'appointments' } }, undefined],
    ['NO DIRECTION (control): the target is held, no comparator ("churn of 2%")', { ...CHURN, raw: 2, frame: 'level' }, undefined],
  ];

  it.each(rows)('%s', async (_row, goal, expected) => {
    const graph = goalGraph(goal);
    expect(resolveGoalDirection(graph, goal.id)?.direction).toBe(expected);
    const req = await plotRequestFor(graph);
    expect(req.goal_node_id).toBe(goal.id);
    if (expected === undefined) {
      expect('goal_direction' in req).toBe(false);
      expect(directionLogs()).toEqual([]);
    } else {
      expect(req.goal_direction).toBe(expected);
      expect(directionLogs()).toEqual([expect.objectContaining({ goal_direction: expected, goal_node_id: goal.id, provenance: 'stated_comparator' })]);
    }
  });

  it('the increase rows still read as the USER\'S floor (the headline does not say the direction was assumed)', () => {
    expect(heldGoalPointsUp(goalGraph({ ...CONVERSION, held: '>', raw: 5, frame: 'level' }), CONVERSION.id)).toBe(true);
    expect(heldGoalPointsUp(goalGraph({ ...VISITS, held: '>=', raw: 1100, frame: 'level' }), VISITS.id)).toBe(true);
  });
});

describe('CONTRASTS: what is not a ceiling on a typed level stays exactly as base', () => {
  it('⭐ a target unit that NAMES a change ("% reduction": "reduce costs by at most 10%", a pre-R1 draft whose frame defaulted to level) → nothing sent', async () => {
    for (const unit of ['% reduction', '% cut', '% decrease', '% increase']) {
      const graph = goalGraph({ id: 'costs', label: 'costs', unit, cap: 100, held: '<=', raw: 10, frame: 'level' });
      expect(resolveGoalDirection(graph, 'costs'), unit).toBeUndefined();
      vi.mocked(log.info).mockClear();
      const req = await plotRequestFor(graph);
      expect('goal_direction' in req, unit).toBe(false);
    }
  });

  it('⭐ a COUNTED event keeps its noun (Codex P1-b: "patient falls below 2 per month") → minimised, never read as a change', () => {
    const graph = goalGraph({ id: 'patient_falls', label: 'Patient falls', unit: 'falls per month', cap: 10, held: '<', raw: 2, frame: 'level' });
    expect(resolveGoalDirection(graph, 'patient_falls')).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
    expect(resolveGoalDirection(goalGraph({ id: 'outages', label: 'Power cuts', unit: 'power cuts per month', cap: 10, held: '<=', raw: 3, frame: 'level' }), 'outages')?.direction).toBe('minimise');
  });

  it('⭐ an UNTYPED frame (no `goal_threshold_frame`: a graph saved before it) — the level proof still decides, so "%" with no level sends nothing', () => {
    expect(resolveGoalDirection(goalGraph({ ...CHURN, held: '<', raw: 2 }), CHURN.id)).toBeUndefined();
  });

  it('a held ceiling with NO held target figure (the comparator of nothing) → nothing sent', () => {
    expect(resolveGoalDirection(goalGraph({ ...CHURN, held: '<', frame: 'level' }), CHURN.id)).toBeUndefined();
  });

  it('a typed CHANGE ceiling ("cut by 15%", change_rel) still minimises from its own branch, as before', () => {
    const graph = goalGraph({ id: 'monthly_bill', label: 'Monthly cloud bill', unit: 'GBP per month', cap: 100, held: '<=', raw: -0.15, frame: 'change_rel' });
    expect(resolveGoalDirection(graph, 'monthly_bill')).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
  });
});

describe('ceilingTheUserWroteFor: a ceiling is the USER\'S only where the brief writes THAT figure as one (Codex P1-a/c on #2585)', () => {
  it('⭐ the SERVED B2 brief writes "below 2%" → the 2 % ceiling is the user\'s (while "more than a day" sits elsewhere)', () => {
    expect(ceilingTheUserWroteFor(2, '%', SERVED.brief)).toBe(true);
    // CONTRAST, same brief: the 4% the brief gives for churn after a long wait is never written as a ceiling.
    expect(ceilingTheUserWroteFor(4, '%', SERVED.brief)).toBe(false);
  });

  it('⭐ SCOPE (Codex P1-a round 2): "Churn target 2%; tax below 2%" never lends tax\'s ceiling to churn; the churn clause still can', () => {
    const scope = { target: ['Monthly churn'], others: ['Tax rate', 'Monthly support tickets'] };
    expect(ceilingTheUserWroteFor(2, '%', 'Churn target 2%; tax below 2%.', scope)).toBe(false);
    expect(ceilingTheUserWroteFor(2, '%', 'Keep churn below 2%; tax is 3%.', scope)).toBe(true);
  });

  it('⭐ SCOPE alone (one writing): "Keep the GCP unit-cost saving below 4%" is that saving\'s ceiling, never downtime\'s', () => {
    const scope = { target: ['Downtime'], others: ['GCP unit-cost saving', 'Migration waves'] };
    expect(ceilingTheUserWroteFor(4, '%', 'Keep the GCP unit-cost saving below 4%.', scope)).toBe(false);
    expect(ceilingTheUserWroteFor(4, '%', 'Keep the GCP unit-cost saving below 4%.'), 'unscoped, the words alone would lend it').toBe(true);
  });

  it('⭐ ROUND 4 (Codex on a351e007): a figure written TWICE is a ceiling only when both writings are ("tax" is not in the model)', () => {
    expect(ceilingTheUserWroteFor(36000, 'GBP/month', 'Monthly spend target £36k; tax below £36k.')).toBe(false);
    expect(ceilingTheUserWroteFor(2, '%', 'Keep churn below 2%; tax is 2%.'), 'the second writing is not a ceiling: under-claim, by design').toBe(false);
    const churn = { target: ['Monthly churn'], others: ['Tax rate'] };
    expect(ceilingTheUserWroteFor(2, '%', 'Keep churn below 2%; keep it below 2%.', churn), 'CONTROL: both writings are the goal\'s ceilings').toBe(true);
    // Round 5 (Codex on 101ab77a): the goal AT its target today, and an unmodelled quantity's ceiling on the same figure.
    expect(ceilingTheUserWroteFor(36000, 'GBP/month', 'Monthly spend is at its £36k target; tax below £36k.', { target: ['Monthly spend'], others: [] }, true)).toBe(false);
    // Today's level is the same figure, written plainly once: that writing is today's, the other is the ceiling.
    expect(ceilingTheUserWroteFor(36000, 'GBP/month', 'Monthly spend is £36k; keep it to at most £36k.', undefined, true)).toBe(true);
    expect(ceilingTheUserWroteFor(36000, 'GBP/month', 'Monthly spend is £36k; keep it to at most £36k.'), 'not today\'s: unaccounted').toBe(false);
  });

  it('⭐ the SERVED B2 brief, scoped with the SERVED graph\'s own labels → the 2% ceiling is churn\'s', () => {
    const graph = SERVED.captures.staging_a4977d9d!.graph as { nodes: { kind: string; label: string }[] };
    const others = graph.nodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision' && n.label !== 'monthly churn').map((n) => n.label);
    expect(others.length, 'the served graph names other quantities').toBeGreaterThan(3);
    expect(ceilingTheUserWroteFor(2, '%', SERVED.brief, { target: ['monthly churn'], others })).toBe(true);
  });

  it.each([
    ['below, before the figure', 'Keep patient falls below 2 per month.', 2, 'falls per month', true],
    ['at most, money', 'We want to cut it to at most £36k a month.', 36000, 'GBP/month', true],
    ['or less, after the figure', 'Keep churn at 2% or less.', 2, '%', true],
    ['under about', 'Keep MRR churn under about 3%.', 3, '%', true],
    ['a target with NO comparator written (P1-a)', 'Our monthly churn target is 2%.', 2, '%', false],
    ['"by at most": a change, not a level (P1-c)', 'Reduce monthly churn by at most 2%.', 2, '%', false],
    ['"by up to": a change', 'Cut costs by up to 10%.', 10, '%', false],
    ['negated: a FLOOR ("must not go below")', 'Margin must not go below 2%.', 2, '%', false],
    ['negated: "never drops below"', 'Make sure margin never drops below 2%.', 2, '%', false],
    ['negated: "don\'t let it fall below"', "Don't let margin fall below 2%.", 2, '%', false],
    ['a FLOOR', 'Get conversion above 5%.', 5, '%', false],
    ['the words on ANOTHER figure', 'Get churn to 2% with no more than 3 new hires.', 2, '%', false],
    // Codex buddy round 2 on df3cbd84:
    ['"by … or less": a change, the after-figure words too', 'Reduce churn by 2% or less.', 2, '%', false],
    ['"by a maximum of": a change', 'Reduce churn by a maximum of 2%.', 2, '%', false],
    ['"no less than": a FLOOR', 'Keep margin no less than 2%.', 2, '%', false],
    // Codex buddy round 3 on dee7bbc6:
    ['"cannot fall below": a FLOOR', 'Monthly spend cannot fall below £36k.', 36000, 'GBP/month', false],
    ['"avoid falling below": a FLOOR', 'Avoid margin falling below 2%.', 2, '%', false],
    ['"without dropping below": a FLOOR', 'Grow output without margin dropping below 2%.', 2, '%', false],
    ['"below or equal to"', 'Keep churn below or equal to 2%.', 2, '%', true],
    ['"under the 2% target"', 'Keep churn under the 2% target.', 2, '%', true],

    // MC's served-brief NEGATIVES (#87 RT-10, MC frozen corpus): a horizon, an option that keeps things as they are, a
    // qualitative limit with no figure. None is ever the user's ceiling.
    ['MC: a horizon, "within 9 months"', 'Our goal is to get monthly churn below 2% within 9 months.', 9, 'months', false],
    ['MC: a horizon, "within the next 6 months"', 'We want to reach £240,000 within the next 6 months.', 6, 'months', false],
    ['MC: an option, "keep pricing as it is"', 'We could keep pricing as it is at £49 a month.', 49, 'GBP per month', false],
    ['MC: an option, "keep the present timetable"', 'Or we keep the present timetable of 12 weeks.', 12, 'weeks', false],
    ['MC: a qualitative limit, no figure', 'Returns and packing capacity could limit how much of the extra output actually sells.', 1, 'units', false],
  ] as const)('%s → %s', (_n, text, value, unit, expected) => {
    expect(ceilingTheUserWroteFor(value, unit, text)).toBe(expected);
  });
});
