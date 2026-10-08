/**
 * ⛔ DECISION-REPRESENTATION ROW 4 IN THE RUN (AIQ #2371 5914730220): `exploratory` withholds the goal CHANCE too.
 *
 * Served m1 after the identity card's Yes (R3 `cand2-8db2a62-1409Z/m1-yes-run`): the goal identity was evaluated, and the
 * Run said "Raise to £59" reaches £85k in 99.29% of runs, resting on Olumi's price → churn guess and churn counted once.
 * Under PTL P2 (#77 5914383843) the target can't be tested yet, so no option's chance is shown: `run_analysis` withholds
 * the affected option's target figures with `GOAL_FIGURES_TARGET_NOT_TESTABLE`. Gate A preserves a clean baseline.
 *
 * THE PATH: the served graph through the REAL loader and the REAL handler; the PLoT client returns the served run body.
 * Rung: TESTED (in-process), not a wire witness.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_WITHHELD_CODES, runWithheldGoalFigures } from '../../../../orchestrator/context/option-result-source.js';
import { withholdOptionGoalFigures } from '../../../../orchestrator/context/constraint-feasibility.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, withholdGoalFiguresForUntestableTarget } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Json = Record<string, any>;
const M1 = JSON.parse(readFileSync(new URL('./fixtures/r3-m1-card-yes-served-run-20260930.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Json; plot_body: Json;
};
const SCENARIO = 'c8108752-0000-4000-8000-000000002371';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function runOn(graph: Json, body: Json = M1.plot_body): Promise<Json> {
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: M1._provenance.brief_text })),
    loadGraph: vi.fn(async () => clone(graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-tt-load', store as never);
  const run = vi.fn(async () => clone(body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-tt-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-tt', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'req-tt-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return fact.result as Json;
}

/** Every `probability_of_goal` anywhere in the Run's result, by option id. */
const chances = (result: Json): Record<string, number> => {
  const out: Record<string, number> = {};
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const r = v as Json;
    if (typeof r.probability_of_goal === 'number') out[String(r.option_id ?? r.id)] = r.probability_of_goal;
    Object.values(r).forEach(walk);
  };
  walk(result);
  return out;
};
const warningsOf = (result: Json): Json[] => {
  const found: Json[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const r = v as Json;
    if (typeof r.code === 'string' && typeof r.message === 'string') found.push(r);
    Object.values(r).forEach(walk);
  };
  walk(result);
  return found;
};

describe('m1 after the identity card\'s Yes: target failures belong to their affected options', () => {
  it('PRECONDITION: the served body carries the chance this row withholds', () => {
    expect(chances(M1.plot_body)['59_price']).toBeCloseTo(0.9929, 4);
  });

  it('the served graph withholds the affected price option; the clean baseline keeps its zero', async () => {
    const result = await runOn(M1.graph);
    expect(chances(result)).toEqual({ current_price: 0 });
    const w = warningsOf(result).filter((x) => x.code === GOAL_FIGURES_TARGET_NOT_TESTABLE);
    // Both reasons remain on the affected price option; neither may spread to the clean baseline.
    expect(w).toHaveLength(1);
    expect(w[0].option_ids).toEqual(['59_price']);
    expect(Object.keys(w[0].per_option)).toEqual(['59_price']);
    const placeholder = warningsOf(result).find(x => x.code === GOAL_FIGURES_PLACEHOLDER_PATH)!;
    expect(placeholder.option_ids).toEqual(['59_price']);
    expect(GOAL_FIGURES_WITHHELD_CODES.has(placeholder.code)).toBe(true);
  });

  it('CONTROL: the user sized the route (price → churn → subscribers at 12 months) → the chance is shown', async () => {
    const g = clone(M1.graph);
    for (const e of g.edges as Json[]) {
      if ((e.to === 'monthly_churn_rate' || e.to === 'paying_subscribers_at_12_months') && (e.defaulted === true || String(e.provenance?.magnitude ?? '').startsWith('olumi_'))) {
        e.provenance = { ...(e.provenance ?? {}), source: 'user_specified' };
      }
    }
    const result = await runOn(g);
    expect(chances(result)['59_price']).toBeCloseTo(0.9929, 4);
    expect(warningsOf(result).some((x) => x.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)).toBe(false);
  });
});

/**
 * AIQ #2371 5915342964, executed: (S)'s placeholder withhold is PER OPTION. With one option's lever on a placeholder link,
 * "some figure was withheld" held, the DR gate stood down, and £59 kept 0.9929 under `exploratory`. The DR gate now
 * withholds whatever still shows, after every earlier withhold: this is AIQ's exact chain on m1's served body.
 */
describe('AIQ\'s chain: an earlier per-option withhold never leaves another option\'s chance showing', () => {
  // The served m1 Run scores two options (£59 and today's price); (S) takes one of them.
  const placeholderOnToday = { code: GOAL_FIGURES_PLACEHOLDER_PATH, message: 'Not shown. A link on the way is not sized.', severity: 'warning', node_ids: ['launch_promotion'], option_ids: ['current_price'] };

  it('PRECONDITION: (S) on today\'s price alone counts as "the run withheld goal figures", took ITS chance, and £59 still shows 0.9929', () => {
    const afterS = withholdOptionGoalFigures(clone(M1.plot_body), new Set(['current_price']), placeholderOnToday);
    expect(runWithheldGoalFigures(afterS as Json)).toBe(true);
    expect(chances(afterS)).toEqual({ '59_price': chances(M1.plot_body)['59_price'] });
    expect(chances(afterS)['59_price']).toBeCloseTo(0.9929, 4);
  });

  it('RED: then the DR gate → no option\'s chance; (S) keeps its own reason, the rest say DR\'s', () => {
    const afterS = withholdOptionGoalFigures(clone(M1.plot_body), new Set(['current_price']), placeholderOnToday);
    const after = withholdGoalFiguresForUntestableTarget(afterS, M1.graph);
    expect(chances(after)).toEqual({});
    const codes = warningsOf(after).map((w) => w.code);
    expect(codes).toContain(GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(codes).toContain(GOAL_FIGURES_TARGET_NOT_TESTABLE);
    const dr = warningsOf(after).find((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)!;
    expect([...dr.option_ids]).toEqual(['59_price']);
  });

  it('RED, THROUGH THE HANDLER: a run body that already withheld today\'s price alone → £59 loses its chance too', async () => {
    const withheldOne = withholdOptionGoalFigures(clone(M1.plot_body), new Set(['current_price']), placeholderOnToday);
    const result = await runOn(M1.graph, withheldOne as Json);
    expect(chances(result)).toEqual({});
    const dr = warningsOf(result).find((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE);
    expect(dr?.option_ids ? [...dr.option_ids] : null).toEqual(['59_price']);
  });

  it('no goal figure and no earlier withhold: the fallback records only the affected option', () => {
    const noFigures = clone(M1.plot_body);
    const strip = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(strip); return; }
      if (v === null || typeof v !== 'object') return;
      const r = v as Json; delete r.probability_of_goal; delete r.probability_of_joint_goal; Object.values(r).forEach(strip);
    };
    strip(noFigures);
    expect(runWithheldGoalFigures(noFigures)).toBe(false);
    const after = withholdGoalFiguresForUntestableTarget(noFigures, M1.graph);
    expect(after).not.toBe(noFigures);
    const dr = warningsOf(after).find((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE);
    expect(dr?.option_ids ? [...dr.option_ids].sort() : null).toEqual(['59_price']);
  });

  it('CONTROL: nothing left to withhold → the same object back (no second warning)', () => {
    const allGone = withholdOptionGoalFigures(clone(M1.plot_body), new Set(['59_price', 'current_price']), placeholderOnToday);
    expect(withholdGoalFiguresForUntestableTarget(allGone, M1.graph)).toBe(allGone);
  });
});

/**
 * ⭐ F1b [R1] YES (DL 5930827933): when every failure is about how the TARGET is stated (P2–P4), each option keeps its
 * outcome distribution (centre AND spread); the goal chance, joint, downside and shares still go, and the warning says
 * exactly which claims went (`withheld_claims`). P5 (a path resting on a guess) still withholds the outcome.
 */
describe('F1b [R1]: an off-scale target withholds the claims against it, not the options\' outcomes', () => {
  /** The user sized the route (the CONTROL above: testable), then the target is set off the level scale (P2 only). */
  const offScale = (): Json => {
    const g = clone(M1.graph);
    for (const e of g.edges as Json[]) {
      if ((e.to === 'monthly_churn_rate' || e.to === 'paying_subscribers_at_12_months') && (e.defaulted === true || String(e.provenance?.magnitude ?? '').startsWith('olumi_'))) {
        e.provenance = { ...(e.provenance ?? {}), source: 'user_specified' };
      }
    }
    const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
    goal.goal_threshold = 1.5;
    return g;
  };
  const outcomeOf = (result: Json, id: string): Json | undefined =>
    (result.option_comparison as Json[] | undefined)?.find((o) => (o.option_id ?? o.id) === id)?.outcome;

  it('PRECONDITION: the off-scale graph fails P2 alone, and the served body carries £59\'s outcome', async () => {
    const { targetTestabilityOf } = await import('../../../admission/target-testability.js');
    const v = targetTestabilityOf(offScale());
    expect(v.kind === 'not_testable' && v.failures.map((f) => f.precondition)).toEqual(['P2']);
    expect(typeof outcomeOf(M1.plot_body, '59_price')?.mean).toBe('number');
  });

  it('RED: P2 → no goal chance, but every option keeps its outcome centre and spread; the warning names the claims withheld', () => {
    const after = withholdGoalFiguresForUntestableTarget(clone(M1.plot_body), offScale()) as Json;
    expect(chances(after)).toEqual({});
    const o = outcomeOf(after, '59_price')!;
    expect(o).toMatchObject({ mean: outcomeOf(M1.plot_body, '59_price')!.mean, p10: expect.any(Number), p90: expect.any(Number) });
    const w = warningsOf(after).find((x) => x.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)!;
    // RE-PINNED, RT-10 B′ R2 (Science #87 5999608477; DL e8 CONFIRMED): the shares are no longer a claim against the
    // target (`win_share` left the list; the share stays, by option). `downside` still goes.
    expect(w.withheld_claims).toEqual(['goal_probability', 'joint_probability', 'downside']);
    const first = (M1.plot_body.option_comparison as Json[])[0]!;
    expect(((after.option_comparison as Json[])[0]!).win_probability).toBe(first.win_probability);
  });

  it('CONTROL: P5 (m1 as served: a path resting on Olumi\'s guess) still withholds the outcome, and records every claim', () => {
    const after = withholdGoalFiguresForUntestableTarget(clone(M1.plot_body), M1.graph) as Json;
    expect(outcomeOf(after, '59_price')?.mean).toBeUndefined();
    // RE-PINNED, RT-10 B′ R2: the record now names every claim it withheld (it used to omit the list, meaning "every
    // class"); the shares are kept, so `win_share` is not among them.
    expect(warningsOf(after).find((x) => x.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)?.withheld_claims)
      .toEqual(['goal_probability', 'joint_probability', 'outcome', 'downside']);
  });
});

/**
 * DL condition (1) on #2448 (5931324913): the kept outcomes reach the Agent's view, so its note licenses one option's own
 * range and forbids every comparative use. Read through the REAL Agent reader on the REAL withheld body.
 */
describe('F1b [R1] condition (1): the Agent may describe a kept outcome, never rank by it', () => {
  it('RED: P2 → the Agent\'s note is the outcome-kept licence (no rank, no leader, no better/worse)', async () => {
    const { goalChanceWithheldForAgent, TARGET_ONLY_OUTCOME_KEPT_NOTE } = await import('../../../agent-lane/goal-chance-withheld.js');
    const g = clone(M1.graph);
    for (const e of g.edges as Json[]) {
      if ((e.to === 'monthly_churn_rate' || e.to === 'paying_subscribers_at_12_months') && (e.defaulted === true || String(e.provenance?.magnitude ?? '').startsWith('olumi_'))) {
        e.provenance = { ...(e.provenance ?? {}), source: 'user_specified' };
      }
    }
    (g.nodes as Json[]).find((n) => n.kind === 'goal')!.goal_threshold = 1.5;
    const after = withholdGoalFiguresForUntestableTarget(clone(M1.plot_body), g) as Json;
    const agent = goalChanceWithheldForAgent({ enrichment: after })!;
    // RE-PINNED, RT-10 B′ R2: the target-only licence (the shares and the leader are this run's findings); every
    // comparative use of the KEPT outcomes is still forbidden (DL #2448 condition (1)).
    expect(agent.note).toBe(TARGET_ONLY_OUTCOME_KEPT_NOTE);
    expect(agent.note).toMatch(/you are not given those figures, so never quote or estimate one, never rank or order the options by those outcomes/);
    expect(agent.note).toMatch(/never say one option is better or worse/);
  });

  it('P5 (outcome withheld) scopes the ban to the affected option; the baseline stays licensed', async () => {
    const { goalChanceWithheldForAgent } = await import('../../../agent-lane/goal-chance-withheld.js');
    const after = withholdGoalFiguresForUntestableTarget(clone(M1.plot_body), M1.graph) as Json;
    // RE-PINNED, RT-10 B′ R2: the target-only licence, which keeps the ban on quoting or estimating any option's outcome.
    const agent = goalChanceWithheldForAgent({ enrichment: after })!;
    expect(agent.option_ids).toEqual(['59_price']);
    expect(agent.note).not.toContain('EVERY option');
    expect(agent.note).toContain('Other options');
  });
});

/**
 * ⭐ DL #2448 item 1 (ii) (5931658539): the outcomes a P2–P4 withhold KEEPS are for the panel only. The Agent's view of the
 * Run carries none of them, so the LLM cannot rank what it never sees. Whole-view VALUE scan, not a key list: every
 * number the panel keeps (centre, spread, percentiles) must be absent from the projected result.
 */
describe('F1b [R1] condition 1(ii): the Agent\'s view of the Run carries no kept outcome figure', () => {
  const offScaleSized = (): Json => {
    const g = clone(M1.graph);
    for (const e of g.edges as Json[]) {
      if ((e.to === 'monthly_churn_rate' || e.to === 'paying_subscribers_at_12_months') && (e.defaulted === true || String(e.provenance?.magnitude ?? '').startsWith('olumi_'))) {
        e.provenance = { ...(e.provenance ?? {}), source: 'user_specified' };
      }
    }
    (g.nodes as Json[]).find((n) => n.kind === 'goal')!.goal_threshold = 1.5;
    return g;
  };
  /** Every outcome figure the body carries for any option, wherever it sits. */
  const outcomeFigures = (body: Json): number[] => {
    const out: number[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v === null || typeof v !== 'object') return;
      const r = v as Json;
      for (const carrier of [r.outcome, r.expected_outcome]) {
        if (carrier !== null && typeof carrier === 'object') {
          for (const k of ['mean', 'std', 'p10', 'p50', 'p90']) if (typeof (carrier as Json)[k] === 'number') out.push((carrier as Json)[k]);
        } else if (typeof carrier === 'number') out.push(carrier);
      }
      Object.values(r).forEach(walk);
    };
    walk(body);
    // 0 and 1 are structural everywhere (flags, bounds); a figure the scan could confuse proves nothing.
    return [...new Set(out)].filter((n) => n !== 0 && n !== 1);
  };
  const numbersIn = (v: unknown): Set<number> => {
    const out = new Set<number>();
    const walk = (x: unknown): void => {
      if (typeof x === 'number') { out.add(x); return; }
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (x !== null && typeof x === 'object') Object.values(x).forEach(walk);
    };
    walk(v);
    return out;
  };

  it('PRECONDITION: the P2 withhold keeps outcome figures for the panel (the scan has something to find)', () => {
    const after = withholdGoalFiguresForUntestableTarget(clone(M1.plot_body), offScaleSized()) as Json;
    expect(outcomeFigures(after).length).toBeGreaterThanOrEqual(6);
  });

  it('RED: P2 → the Agent\'s view of the Run holds none of the kept outcome figures, for any option', async () => {
    const { analysisResultForAgent } = await import('../../../agent-lane/decision-sensitivity.js');
    const after = withholdGoalFiguresForUntestableTarget(clone(M1.plot_body), offScaleSized()) as Json;
    const kept = outcomeFigures(after);
    const seen = numbersIn(analysisResultForAgent({ enrichment: after }));
    expect(kept.filter((n) => seen.has(n))).toEqual([]);
  });

  it('CONTROL: a Run nothing withheld → the Agent still sees every option\'s outcome figures', async () => {
    const { analysisResultForAgent } = await import('../../../agent-lane/decision-sensitivity.js');
    const body = clone(M1.plot_body);
    const kept = outcomeFigures(body);
    expect(kept.length).toBeGreaterThanOrEqual(6);
    const seen = numbersIn(analysisResultForAgent({ enrichment: body }));
    expect(kept.filter((n) => !seen.has(n))).toEqual([]);
  });

  it('CONTROL: a warning with no option list hides every option\'s outcome (fail closed)', async () => {
    const { analysisResultForAgent } = await import('../../../agent-lane/decision-sensitivity.js');
    const after = withholdGoalFiguresForUntestableTarget(clone(M1.plot_body), offScaleSized()) as Json;
    for (const w of after.inference_warnings as Json[]) if (w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE) delete w.option_ids;
    const seen = numbersIn(analysisResultForAgent({ enrichment: after }));
    expect(outcomeFigures(after).filter((n) => seen.has(n))).toEqual([]);
  });
});
