/**
 * ⭐ DL ruling 14 Oct (hiring robust to the drafter's variance): where the drafter left the reading's period unstated and the
 * user has confirmed a deadline, the confirmed deadline supplies the period; with no deadline held, today's behaviour (the
 * reading is absent and the reply asks when the target must be met).
 *
 * Served draft: `cee_drafter_raw_responses` a3ad3689 (14:54Z, CEE fb79407b), md5 79e45e5d2b0bccaa5825f0a11803cbc1, on the hiring
 * brief (sha256 4011bff7…). 24 drafts of this brief held "3"; this one sent `basis.period_months: null` and no horizon, so the
 * whole reading was dropped and no later deadline could complete it (live/runs/2026-10-14T153524Z-hiring-t1h-after-3071-r2).
 * The pressed deadline card's goal fields are byte for byte from live/runs/2026-10-14T140600Z-hiring-e2e-8f52bfd5-5ebc9b0c.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../../agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { goalTargetBasisOf } from '../goal-target-basis.js';
import { goalHorizonVerdict } from '../goal-horizon-verdict.js';
import { applyGoalReadingEdit } from '../goal-reading-write.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const RAW = readFileSync(new URL('./fixtures/hiring-a3ad3689-null-period-raw.txt', import.meta.url), 'utf8');
const BRIEF = readFileSync(new URL('./fixtures/hiring-a3ad3689-brief.txt', import.meta.url), 'utf8');
const SID = 'a3ad3689-0000-4000-8000-00000a3ad368';
const GOAL = 'productivity';
const ASK_PERIOD = 'when the target must be met (the number of months)';

async function construct(raw = RAW): Promise<{ graph: Rec; out: Rec }> {
  let graph: Rec | null = null;
  const call = (async () => ({ text: raw })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SID, BRIEF, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 600)).toBe(true);
  return { graph: GraphV3.parse(graph) as unknown as Rec, out };
}
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === GOAL)!;
/** The pressed deadline card's goal fields, byte for byte from the served read. */
const pressed = (g: Rec): Rec => {
  const c = structuredClone(g);
  Object.assign(goalOf(c), { goal_horizon: { deadline: '2027-01-14' }, goal_horizon_months: 3, goal_deadline_as_stated: 'three months' });
  return c;
};
/** The user's answer to the reading's open question, through its one writer (`goal-reading-write.ts`). */
const answered = (g: Rec): Rec => {
  const w = applyGoalReadingEdit(g, { goal_id: GOAL, expected_basis: goalOf(g).goal_target_basis }) as Rec;
  expect(w.kind, JSON.stringify(w).slice(0, 300)).toBe('mutated');
  return w.mutatedGraph as Rec;
};

/** The REAL Run handler on the graph (snapshot loaded as served), PLoT faked; the AI's timing reading on the press. */
async function runEnvelope(graph: Rec): Promise<Rec> {
  const stored = GraphV3.parse(structuredClone(graph)) as unknown as Rec;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'req-load', {
    readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(stored), briefText: BRIEF }),
    loadGraph: async () => structuredClone(stored),
  } as never);
  const plotRun = vi.fn(async (sent: unknown) => {
    const payload = sent as Rec;
    return { ...structuredClone(minimalFixture), inference_warnings: [],
      results: payload.options.map((o: Rec, i: number) => ({ option_id: o.id ?? o.option_id, option_label: o.label, win_probability: [0.3, 0.5, 0.2][i] })),
      option_comparison: payload.options.map((o: Rec, i: number) => ({ option_id: o.id ?? o.option_id, option_label: o.label,
        win_probability: [0.3, 0.5, 0.2][i], probability_of_goal: [0.3, 0.45, 0][i],
        outcome: { p10: 2, p50: 8 + i, p90: 14, mean: 8 + i, std: 4, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' } })),
    } as unknown as V2RunResponseEnvelope;
  });
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot });
  const outcome = await handler({ payload: { kind: 'message', scenario_id: SID, turn_id: 't-run', chip: { parameters: { effects_timing: 'in_place_by_period' } } },
    requestId: 'req-run', signal: new AbortController().signal, context: {}, orientationText: '' } as unknown as HandlerInvocation) as unknown as Rec;
  expect(plotRun).toHaveBeenCalledOnce();
  return (outcome.handler_facts as Rec[]).find((f) => f.fact_type === 'run_analysis')!.result.enrichment as Rec;
}
const codesOf = (e: Rec): string[] => (e.inference_warnings as Rec[]).map((w) => String(w.code));

describe('hiring: a reading the drafter left without its period waits for the user\'s confirmed deadline', () => {
  it('fixture control: the served draft leaves the period and the deadline unstated, beside a valid reading', () => {
    const goal = JSON.parse(RAW).goal;
    expect(goal).toMatchObject({ frame: 'change_abs', quantity_frame: 'change', horizon_months: null, deadline_words: null });
    expect(goal.basis).toMatchObject({ reference: 'today', period_months: null, effects_at_period_end: false });
  });

  it('⭐ RED (construction): the reading is kept without its period, the target admitted, and the reply still asks for the period', async () => {
    const { graph, out } = await construct();
    const goal = goalOf(graph);
    expect(goal.goal_target_basis).toMatchObject({ reference: 'today', target_frame: 'change_abs', effects_at_period_end: false });
    expect(goal.goal_target_basis).not.toHaveProperty('period_months');
    expect(goal).toMatchObject({ goal_threshold_frame: 'change_abs', goal_threshold_raw: 10 });
    expect(typeof goal.goal_threshold).toBe('number');
    // No deadline held: no reading speaks (today's behaviour), and the reply asks when the target must be met.
    expect(goalTargetBasisOf(goal)).toBeUndefined();
    expect(JSON.stringify(out.not_represented ?? out)).toContain(ASK_PERIOD);
  });

  it('⭐ RED (deadline confirmed): the held months supply the period; once the reading\'s question is answered the Run no longer says "only today\'s numbers"', async () => {
    const { graph } = await construct();
    const held = pressed(graph);
    expect(goalTargetBasisOf(goalOf(held))).toMatchObject({ period_months: 3, reference: 'today' });
    // The drafter's own question still holds the chance back until it is answered (amendment 3), unchanged.
    expect(goalHorizonVerdict(held)).toBe('withhold');
    const ready = answered(held);
    expect(goalTargetBasisOf(goalOf(ready))).toMatchObject({ period_months: 3 });
    expect(goalTargetBasisOf(goalOf(ready))).not.toHaveProperty('open_question');
    expect(goalHorizonVerdict(ready)).toBe('no_horizon');
    const envelope = await runEnvelope(ready);
    expect(codesOf(envelope)).not.toContain('GOAL_FIGURES_HORIZON_NOT_TESTED');
    // Honest: the served draft's links are Olumi's unsized placeholders, so the figures still wait on their sizes.
    expect(codesOf(envelope)).toContain('GOAL_FIGURES_PLACEHOLDER_PATH');
  });

  it('NEGATIVE: an invalid drafted period (0) is still refused whole, and a held deadline never revives it', async () => {
    const zero = JSON.parse(RAW); zero.goal.basis.period_months = 0;
    const { graph } = await construct(JSON.stringify(zero));
    expect(goalOf(graph)).not.toHaveProperty('goal_target_basis');
    expect(goalTargetBasisOf(goalOf(pressed(graph)))).toBeUndefined();
  });

  it('NEGATIVE: a stored period is never replaced by the held months (a different deadline stays a different month)', async () => {
    const { graph } = await construct();
    const withPeriod = structuredClone(graph); goalOf(withPeriod).goal_target_basis.period_months = 6;
    expect(goalTargetBasisOf(goalOf(pressed(withPeriod)))).toMatchObject({ period_months: 6 });
    expect(goalHorizonVerdict(answered(pressed(withPeriod)))).toBe('withhold');
  });
});
