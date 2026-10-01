/**
 * 0.71.0 — `input_coverage: 'complete'` means VERIFIED, on the REAL wire (DL ruling on #2482, 5939864517).
 *
 * Real `run_analysis` handler, real snapshot builder and residual, the served c96fc4bb graph (Paul's MRR journey). Each
 * row edits the STORED graph between two Runs, proves the request PLoT received actually moved (or did not), and reads
 * the pair's coverage through `diffRunInputs`.
 *
 *   R0  identical Runs → equal residuals → complete, [] (control).
 *   R1  CODEX repro: a factor's σ only (not recorded) → residuals differ → partial, [].
 *   R2  CODEX repro: the goal's ENCODED threshold only (not recorded) → partial, [].
 *   R3  a link's sign flips → partial (the band row never absorbs it).
 *   R4  the Accept step (Olumi's placeholder → the estimate the user accepted, no number moved) → complete + ONE sizing row.
 *   R5  a band move with the writer's own spread (who sized it unchanged) → complete + ONE strength row.
 *   R6  £59 → £60 on an option → complete + ONE option_setting row.
 *   R7  MEASURED: a factor value edit (churn 3% → 4%) — the row, and the coverage the wire supports.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { RunInputSnapshot } from '@talchain/schemas/orchestrator';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { diffRunInputs } from '../../../coaching/run-input-changes.js';
import { olumiSpreadForMean } from '../../../../cee/magnitude/olumi-spread.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { sentDigest } from '../run-input-snapshot.js';

type Rec = Record<string, any>;
const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const served = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec };
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;

function invocation(turnId: string): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO,
      request_id: turnId, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: turnId, scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: turnId, signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
}

/** Run the real handler on `graph`; return the Run's recorded snapshot and the request PLoT received. */
async function runOn(graph: Rec, turn: string): Promise<{ snapshot: RunInputSnapshot; sent: Rec }> {
  const bodies: Rec[] = [];
  const plotClient = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      bodies.push(structuredClone(body));
      const response = structuredClone(happy) as Rec;
      response.results = (body.options as Rec[]).map((o, index) => ({
        option_id: o.option_id, option_label: o.label, win_probability: [0.6, 0.4][index] ?? 0, percentile_p10: 0.1, percentile_p90: 0.9,
      }));
      response.fact_objects = [];
      response.review_cards = [];
      response.meta = { ...(response.meta as Rec), seed_used: '1' };
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'residual', createNoopSessionStore({ loadGraphResult: structuredClone(graph) })),
  });
  const out = await handler(invocation(turn));
  const fact = out.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec | undefined;
  const snapshot = fact?.result?.input_snapshot as RunInputSnapshot | undefined;
  expect(snapshot, 'the Run recorded its inputs').toBeDefined();
  expect(snapshot!.residual_digest, 'and its residual').toMatch(/^[0-9a-f]{64}$/);
  return { snapshot: snapshot!, sent: bodies[0]! };
}

const base = () => {
  const g = structuredClone(served.graph);
  g.nodes.find((n: Rec) => n.id === 'keep_current_price')!.interventions = {
    pro_plan_price: { value: 0.245, raw_value: 49, unit: 'GBP/month', source: 'brief_extraction' },
  };
  return g;
};
const node = (g: Rec, id: string) => g.nodes.find((n: Rec) => n.id === id)!;
const edge = (g: Rec, from: string, to: string) => g.edges.find((e: Rec) => e.from === from && e.to === to)!;
const LINK = ['pro_plan_price', 'monthly_churn'] as const;

/** Two Runs: `edit` changes the stored graph between them. */
async function pair(edit: (g: Rec) => void, setup: (g: Rec) => void = () => {}) {
  const g = base();
  setup(g);
  const a = await runOn(g, 'turn-a');
  edit(g);
  const b = await runOn(g, 'turn-b');
  return { a, b, ...diffRunInputs(a.snapshot, b.snapshot), wireMoved: sentDigest(a.sent) !== sentDigest(b.sent) };
}

describe('0.71.0 residual on the real wire — complete means verified', () => {
  it('R0 (control): identical Runs → equal residuals → complete, []', async () => {
    const p = await pair(() => {});
    expect(p.wireMoved).toBe(false);
    expect(p.a.snapshot.residual_digest).toBe(p.b.snapshot.residual_digest);
    expect([p.complete, p.rows]).toEqual([true, []]);
  });

  it('R1 (CODEX repro): a factor\'s σ only — the wire moves, no recorded field does → partial, []', async () => {
    const p = await pair((g) => { node(g, 'monthly_churn').observed_state.std = 0.02; });
    expect(p.wireMoved, 'precondition: the σ reached PLoT').toBe(true);
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  it('R2 (CODEX repro): the goal\'s ENCODED threshold only → partial, []', async () => {
    const p = await pair((g) => { node(g, 'mrr').goal_threshold = 0.82; });
    expect(p.wireMoved, 'precondition: the encoded threshold reached PLoT').toBe(true);
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  it('R3: a link\'s sign flips (+0.1 → −0.4, direction negative) → partial', async () => {
    const p = await pair((g) => {
      const e = edge(g, ...LINK);
      e.strength = { mean: -0.4, std: olumiSpreadForMean({ oldMean: 0.1, oldStd: 0.05, newMean: -0.4 }) };
      e.effect_direction = 'negative';
    });
    expect(p.wireMoved).toBe(true);
    expect(p.complete).toBe(false);
  });

  it('R4 (the Accept step): Olumi\'s placeholder → the estimate the user accepted → complete + ONE sizing row', async () => {
    const p = await pair(
      (g) => {
        const e = edge(g, ...LINK);
        e.provenance = { ...e.provenance, magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } };
      },
      (g) => {
        const e = edge(g, ...LINK);
        e.provenance = { ...e.provenance, magnitude: 'olumi_placeholder' };
      },
    );
    expect(p.wireMoved, 'precondition: the magnitude literal reached PLoT').toBe(true);
    expect(p.complete).toBe(true);
    expect(p.rows.map((r) => [r.field, r.before, r.after])).toEqual([['sizing', { raw: 'placeholder' }, { raw: 'olumi_accepted' }]]);
  });

  it('R5: a band move with the writer\'s own spread (who sized it unchanged) → complete + ONE strength row', async () => {
    const p = await pair((g) => {
      edge(g, ...LINK).strength = { mean: 0.6, std: olumiSpreadForMean({ oldMean: 0.1, oldStd: 0.05, newMean: 0.6 }) };
    });
    expect(p.wireMoved).toBe(true);
    expect(p.complete).toBe(true);
    expect(p.rows.map((r) => [r.field, r.before, r.after])).toEqual([['strength', { raw: 'slight' }, { raw: 'strong' }]]);
  });

  it('R6: £59 → £60 on an option → complete + ONE option_setting row', async () => {
    const p = await pair((g) => {
      const iv = node(g, 'raise_price_to_59').interventions.pro_plan_price;
      node(g, 'raise_price_to_59').interventions.pro_plan_price = { ...iv, value: 0.3, raw_value: 60 };
    });
    expect(p.wireMoved).toBe(true);
    expect(p.complete).toBe(true);
    expect(p.rows.map((r) => [r.entity_kind, r.before?.raw, r.after?.raw])).toEqual([['option_setting', 59, 60]]);
  });

  it('R7 (measured): a factor value edit (churn 3% → 4%) — one factor row; coverage as the wire supports', async () => {
    const p = await pair((g) => {
      node(g, 'monthly_churn').observed_state = { ...node(g, 'monthly_churn').observed_state, value: 0.04, raw_value: 4 };
    });
    expect(p.wireMoved).toBe(true);
    expect(p.rows.map((r) => [r.entity_kind, r.before?.raw, r.after?.raw])).toEqual([['factor_value', 3, 4]]);
    expect(p.complete).toBe(true);
  });
});
